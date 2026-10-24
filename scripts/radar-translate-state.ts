// The one reader of "is the automatic translation running, and what has it spent".
//
// Two entry points need the same answer — `radar-ops status` (the detailed developer view) and
// `radar-local status` (what `status-radar.cmd` shows a normal user) — so the queries live here once.
// The state is never "the switch is set": running means the worker's own session advisory lock is held,
// or a heartbeat fresh enough to matter whose PID the OS confirms is this worker. A stored run record
// alone is the opposite signal — it says a worker started and did not clean up, which is a fault.
import { sql } from "@aihot/backend/db";
import { heartbeatAlive, readRunRecord, type RunRecord } from "../apps/worker/src/control.ts";
import { commandLineMatches, expectedCommandFragment, queryWindowsProcess } from "../apps/worker/src/process-identity.ts";

/** The role's advisory lock key (same value as apps/worker/src/instance-lock.ts). */
export const TRANSLATE_LOCK_KEY = 7_204_229_004;

/**
 * The first lane's official/regulatory sources: the only ones the content worker may analyse and
 * translate. Anything else — the AMZ123 leads, Ads, the retired Accelerate feed, the community RSS —
 * stays outside this list on purpose.
 */
export const TRANSLATE_SOURCES = [
  "amazon-us-announcements",
  "amazon-us-fee-updates",
  "rss-cpsc-recalls",
  "us-federal-register-cpsc",
  "us-federal-register-ftc",
] as const;

export const TRANSLATE_SOURCE_LABEL = "官方/监管五来源（公告·费用·CPSC·联邦公报 CPSC·联邦公报 FTC）";

export interface TranslationBudgetView {
  round: string;
  requests: number;
  spentCny: number;
  limits: { maxRequests?: number; maxArticles?: number; budgetCny?: number; expiresAt?: string };
}

export interface TranslationState {
  /** The worker holds the role's session lock: it is running, whatever the files say. */
  lock: boolean;
  /** A heartbeat written less than a minute ago (only meaningful together with the process check). */
  alive: boolean;
  record: RunRecord | null;
  requests: number;
  spent: number;
  limits: { maxRequests?: number; maxArticles?: number; budgetCny?: number; expiresAt?: string };
  /** The window's caps are used up: no further request would be sent even while the worker runs. */
  exhausted: boolean;
  round: string;
  /** The instant the incremental path starts from (settings.translate.baseline), ISO or null. */
  baseline: string | null;
  lastOk: { at: Date | null; n: number } | null;
  lastFail: { article_id: string; reason: string | null; updated_at: Date } | null;
  /** Official items after the baseline with no current Chinese title and no exhausted attempts. */
  pending: number;
  lastRun: { status: string; started_at: Date; detail: { done?: unknown[]; reason?: string } | null; error: string | null } | null;
  cumulative: { requests: number; spent: number };
}

/** Whether a role's session lock is free. `null` when the database cannot answer. */
export async function translateLockHeld(): Promise<boolean | null> {
  try {
    const connection = await sql.reserve();
    try {
      const [row] = await connection<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${TRANSLATE_LOCK_KEY}::bigint) AS locked`;
      if (row?.locked) await connection`SELECT pg_advisory_unlock(${TRANSLATE_LOCK_KEY}::bigint)`;
      return !row?.locked;
    } finally {
      connection.release();
    }
  } catch {
    return null;
  }
}

/**
 * Whether the recorded pid really is this worker. A fresh heartbeat alone is not proof for a minute
 * after a crash, and a pid can be reused: the OS command line is the tie-breaker.
 */
export async function translationProcessAlive(record: { pid: number } | null): Promise<boolean> {
  if (!record) return false;
  const process = await queryWindowsProcess(record.pid);
  // Slash- and case-insensitive on purpose: Windows reports the command line with backslashes while
  // the expected fragment is written with forward slashes. The fragment still names the worker's
  // entry path, so an unrelated node process (or another project's main.ts) never matches.
  return !!process && commandLineMatches(process.commandLine, expectedCommandFragment("radar-translate"));
}

export async function readTranslationState(): Promise<TranslationState> {
  const lock = (await translateLockHeld()) ?? false;
  const alive = heartbeatAlive("radar-translate");
  const record = readRunRecord("radar-translate");
  const [budget] = await sql<{ value: TranslationBudgetView }[]>`SELECT value FROM settings WHERE key = 'translate.budget'`;
  const [baseline] = await sql<{ value: { at?: string } }[]>`SELECT value FROM settings WHERE key = 'translate.baseline'`;
  const [lastOk] = await sql<{ at: Date | null; n: number }[]>`
    SELECT max(created_at) AS at, count(*)::int AS n FROM translations WHERE lang = 'zh'`;
  const [lastFail] = await sql<{ article_id: string; reason: string | null; updated_at: Date }[]>`
    SELECT article_id, reason, updated_at FROM translation_attempts WHERE outcome = 'failed' ORDER BY updated_at DESC LIMIT 1`;
  const [pending] = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM publications p
    JOIN articles a ON a.id = p.article_id JOIN sources s ON s.id = p.source_id
    LEFT JOIN translations tr ON tr.article_id = p.article_id AND tr.lang = 'zh' AND tr.revision >= a.revision
    WHERE s.tier = 'T1' AND s.participation_mode = 'editorial' AND s.enabled
      AND s.id = ANY(${TRANSLATE_SOURCES as unknown as string[]}::text[])
      AND p.visibility = 'public'
      AND p.discovered_at >= ${baseline?.value?.at ?? "9999-01-01"}::timestamptz
      AND tr.article_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM translation_attempts t WHERE t.article_id = p.article_id AND t.revision = a.revision
                      AND (t.outcome IN ('translated', 'partial') OR t.attempts >= 3))`;
  const [lastRun] = await sql<{ status: string; started_at: Date; detail: { done?: unknown[]; reason?: string } | null; error: string | null }[]>`
    SELECT status, started_at, detail, error FROM job_runs WHERE job = 'content.translate' ORDER BY id DESC LIMIT 1`;
  const [archived] = await sql<{ requests: number; spent: number }[]>`
    SELECT coalesce(sum((r->>'requests')::int), 0)::int AS requests, coalesce(sum((r->>'spentCny')::numeric), 0)::float8 AS spent
    FROM settings, jsonb_array_elements(coalesce(value, '[]'::jsonb)) AS r WHERE key = 'translate.rounds'`;
  const limits = budget?.value?.limits ?? {};
  const requests = Number(budget?.value?.requests ?? 0);
  const spent = Number(budget?.value?.spentCny ?? 0);
  const exhausted = (limits.maxRequests !== undefined && requests >= limits.maxRequests)
    || (limits.budgetCny !== undefined && spent >= limits.budgetCny);
  return {
    lock, alive, record, requests, spent, limits, exhausted,
    round: budget?.value?.round ?? "", baseline: baseline?.value?.at ?? null,
    lastOk: lastOk ?? null, lastFail: lastFail ?? null, pending: pending?.n ?? 0, lastRun: lastRun ?? null,
    cumulative: { requests: requests + Number(archived?.requests ?? 0), spent: spent + Number(archived?.spent ?? 0) },
  };
}

/** Running = the lock is held, or a fresh heartbeat whose process the OS confirms is the worker. */
export async function translationRunning(state: TranslationState): Promise<boolean> {
  if (state.lock) return true;
  return state.alive && await translationProcessAlive(state.record);
}

/** Stored timestamps are UTC; an operator reads Beijing time. */
export function beijingStamp(at: Date | string): string {
  const date = typeof at === "string" ? new Date(at) : at;
  return new Date(date.getTime() + 8 * 3600_000).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * The four states a reader has to be able to tell apart. A stale run record means the last worker died
 * without cleaning up — reported as a fault, never as "running", and never as "off" either, because the
 * translation gate may still be set.
 */
export function translationHeadline(state: TranslationState, running: boolean): string {
  if (running) return state.exhausted ? "运行中（预算已用完，不再发新请求）" : "运行中";
  if (state.record) return "故障（上次未正常退出）";
  return state.exhausted ? "预算已用完（未运行）" : "未启用（未运行）";
}

/** How many items the last recorded run actually translated (0 when it only checked). */
export function lastRunProcessed(state: TranslationState): number {
  const done = state.lastRun?.detail?.done;
  return Array.isArray(done) ? done.length : 0;
}

/** The reason a run ended early, when it recorded one. */
export function lastRunReason(state: TranslationState): string | null {
  const reason = state.lastRun?.detail?.reason;
  return typeof reason === "string" && reason ? reason : null;
}
