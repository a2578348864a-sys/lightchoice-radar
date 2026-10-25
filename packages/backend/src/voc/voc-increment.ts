// Bounded incremental discovery, revision and recovery for a licensed VOC source.
//
// The API's `last_activity_date` is documented only as "[date]" — the official docs define no
// guarantee that comments, edits or new answers bump it. So completeness here never relies on
// activity semantics. Every run re-fetches FULL threads for a round-robin slice of the stored
// topics and diffs them through applyImport's content hashes; that catches new answers, new
// comments (on the question or on answers), body edits and licence changes regardless of what
// the activity timestamp does. Discovery of NEW topics uses `sort=creation` from an inclusive
// watermark. Deletions are observable only as absence (the API returns no deleted items) — a
// requested-but-missing id is recorded, never acted on destructively.
//
// Gates, before any network call:
//   1. the study exists, is not archived, and names this source;
//   2. the source row is enabled (the operator's standing authorisation);
//   3. the increment batch exists and is NOT revoked — saveBatch is an upsert, so a run pointing
//      at a revoked batch would silently clear the revocation; refusing is the safe behaviour;
//   4. a per-source advisory lock serialises runs (no overlapping duplicate batches);
//   5. every request is counted; the run stops at the budget instead of retrying past it; a 429
//      aborts the run immediately (recorded, never bypassed).
//
// Watermark semantics: the first run initialises it from the source's earliest batch importedAt —
// the moment the collection last LOOKED at the source — so no question created between that look
// and the first increment run can fall into a blind window, while deliberately-unselected older
// candidates are never backfilled (use --backfill-epoch for that). `min` on SE search is
// inclusive, and stored ids are subtracted from discovery, so same-second boundary records are
// re-seen and filtered, never skipped. The watermark and recheck offset advance only after a
// successful run; a failed run leaves both untouched so the next run resumes exactly here.
// Nothing here is scheduled — the module runs when the operator runs it, never from page loads.
import { sql } from "../db.ts";
import { applyImport } from "./voc-ingest.ts";
import { loadBatches, loadStudy } from "./voc-model.ts";
import { seFetchThreads, seSearchQuestionIds, type SeClientOptions } from "./voc-stackexchange.ts";

/** Request budget per run: recheck + discovery + candidate fetch stay inside the 300/day quota. */
export const INCREMENT_MAX_REQUESTS = 6;
/** Stored topics fully re-fetched per run (one request per ≤100 ids); round-robin across runs. */
export const INCREMENT_RECHECK_SLICE = 100;
/** Distinct advisory-lock key: serialises increment runs (no overlapping duplicate batches). */
export const INCREMENT_LOCK_KEY = 7_204_229_007;

export interface VocIncrementState {
  sourceId: string;
  /** SE epoch seconds: questions created at/after this count as new candidates. */
  createdWatermark: number;
  /** Round-robin cursor into the stored-topic order for the recheck slice. */
  recheckOffset?: number;
  lastRunAt?: string;
  lastResult?: string;
  /** Full-fetch ids left over from the last bounded run; resumed first. */
  carryOver?: number[];
}

export interface VocIncrementStats {
  requests: number;
  quotaRemaining: number;
  discovered: number;
  rechecked: number;
  /** Requested stored topics the API did not return — observational deletion signal. */
  missing: number[];
  stored: number;
  revised: number;
  skipped: number;
  carryOver: number;
}

export type VocIncrementResult =
  | { status: "processed" | "failed"; stats: VocIncrementStats; reason?: string }
  | { status: "refused"; reason: string };

const stateKey = (sourceId: string) => `voc.increment.${sourceId}`;

async function loadState(sourceId: string): Promise<VocIncrementState | null> {
  const [row] = await sql<{ value: VocIncrementState }[]>`SELECT value FROM settings WHERE key = ${stateKey(sourceId)}`;
  return row?.value ?? null;
}

async function saveState(state: VocIncrementState): Promise<void> {
  await sql`INSERT INTO settings (key, value, updated_by) VALUES (${stateKey(state.sourceId)}, ${sql.json(state as never)}, 'voc-increment')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

const epochOf = (iso: string | null | undefined) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : 0);

export async function runVocIncrement(input: {
  studyId: string;
  sourceId: string;
  batchId: string;
  /** SE API site name, e.g. "coffee". */
  site: string;
  /** Optional discovery tag (the study's collection tag, as the initial import used). */
  tagged?: string;
  /** Deliberate backfill start; omit for the batch-derived default. */
  initialWatermark?: number;
  maxRequests?: number;
  recheckSlice?: number;
  fetchImpl?: typeof fetch;
}): Promise<VocIncrementResult> {
  const maxRequests = input.maxRequests ?? INCREMENT_MAX_REQUESTS;
  const sliceSize = input.recheckSlice ?? INCREMENT_RECHECK_SLICE;
  const empty: VocIncrementStats = { requests: 0, quotaRemaining: -1, discovered: 0, rechecked: 0, missing: [], stored: 0, revised: 0, skipped: 0, carryOver: 0 };

  // ---- authorisation gates (no network before these pass) ----
  const study = await loadStudy(input.studyId);
  if (!study) return { status: "refused", reason: `study ${input.studyId} not found` };
  if (study.status === "archived") return { status: "refused", reason: "study archived" };
  if (!study.sourceIds.includes(input.sourceId)) return { status: "refused", reason: "study does not name this source" };
  const [sourceRow] = await sql<{ enabled: boolean }[]>`SELECT enabled FROM sources WHERE id = ${input.sourceId}`;
  if (!sourceRow) return { status: "refused", reason: "source row missing" };
  if (!sourceRow.enabled) return { status: "refused", reason: "source not enabled — operator authorisation absent" };
  const batches = await loadBatches();
  const batch = batches.find((b) => b.id === input.batchId);
  if (!batch) return { status: "refused", reason: `batch ${input.batchId} not defined` };
  if (batch.revokedAt) return { status: "refused", reason: "batch revoked — an increment may never resurrect a revoked licence basis" };

  // ---- per-source serialisation: no overlapping duplicate runs ----
  const connection = await sql.reserve();
  let quota = -1;
  let used = 0;
  let runState: VocIncrementState = { sourceId: input.sourceId, createdWatermark: 0 };
  try {
    const [lock] = await connection<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${INCREMENT_LOCK_KEY}::bigint) AS locked`;
    if (!lock?.locked) return { status: "refused", reason: "another increment run is in progress (advisory lock held)" };
    try {
      runState = (await loadState(input.sourceId))
        ?? { sourceId: input.sourceId, createdWatermark: input.initialWatermark ?? (await defaultWatermark(input.sourceId)) };
      const countedFetch: typeof fetch = async (url, init) => {
        if (used >= maxRequests) throw new Error(`request budget exhausted (${maxRequests} per run)`);
        used += 1;
        return (input.fetchImpl ?? fetch)(url, init);
      };
      const opts: SeClientOptions = {
        guard: async (sourceId, studyIds) =>
          sourceId === input.sourceId && studyIds.includes(input.studyId)
            ? { allowed: true, reason: "" }
            : { allowed: false, reason: "increment run is scoped to its own study and source" },
        fetchImpl: countedFetch,
      };

      // ---- stored-topic index (stable order by article id: the recheck rotation depends on it) ----
      const storedRows = await sql<{ qid: string | null }[]>`
        SELECT raw->'voc'->'thread'->>'questionId' AS qid
        FROM articles WHERE source_id = ${input.sourceId} AND raw->'voc'->'thread' IS NOT NULL ORDER BY id`;
      const storedIds = storedRows.map((r) => (r.qid ? Number(r.qid) : null)).filter((v): v is number => v !== null);
      const storedSet = new Set(storedIds);

      // ---- recheck slice: full threads for a rotating slice of known topics ----
      const offset = storedIds.length ? (runState.recheckOffset ?? 0) % storedIds.length : 0;
      const slice = storedIds.slice(offset, offset + sliceSize);
      const nextOffset = storedIds.length ? (offset + slice.length) % storedIds.length : 0;
      const missing: number[] = [];
      let rechecked = 0;
      let importResult = { stored: 0, revised: 0, skipped: 0 };
      let maxCreationSeen = runState.createdWatermark;
      const doImport = async (threads: Awaited<ReturnType<typeof seFetchThreads>>["threads"]) => {
        if (!threads.length) return { stored: 0, revised: 0, skipped: 0 };
        return applyImport({
          batch: { id: input.batchId, sourceId: input.sourceId, label: batch.label, license: batch.license },
          studyIds: [input.studyId],
          rows: threads.map((t) => ({
            url: `https://${input.site}.stackexchange.com/q/${t.questionId}`,
            title: t.title,
            body: t.body,
            publishedAt: new Date(t.createdAt),
            thread: t,
            contentLicense: t.contentLicense,
          })),
        });
      };
      if (slice.length) {
        const fresh = await seFetchThreads(slice, input.site, opts, [input.studyId]);
        quota = fresh.quotaRemaining;
        const returned = new Set(fresh.threads.map((t) => t.questionId));
        for (const id of slice) if (!returned.has(id)) missing.push(id);
        rechecked = fresh.threads.length;
        importResult = addImport(importResult, await doImport(fresh.threads));
        for (const t of fresh.threads) maxCreationSeen = Math.max(maxCreationSeen, epochOf(t.createdAt));
      }

      // ---- discovery of new topics (skip while resuming a carry-over) ----
      let discoveredIds: number[] = [];
      if (!runState.carryOver?.length) {
        const search = await seSearchQuestionIds(study.terms, input.site, opts, [input.studyId], 1, {
          sort: "creation",
          minEpoch: runState.createdWatermark || undefined,
          tagged: input.tagged,
          taggedOnly: !!input.tagged,
        });
        quota = search.quotaRemaining;
        discoveredIds = search.ids.filter((id) => !storedSet.has(id));
      }

      // ---- bounded full fetch of new topics: carry-over resumes first ----
      const pending = [...new Set([...(runState.carryOver ?? []), ...discoveredIds])];
      const candidates = pending.slice(0, sliceSize);
      const carry = pending.slice(sliceSize);
      if (candidates.length) {
        const full = await seFetchThreads(candidates, input.site, opts, [input.studyId]);
        quota = full.quotaRemaining;
        const returned = new Set(full.threads.map((t) => t.questionId));
        for (const id of candidates) if (!returned.has(id)) missing.push(id);
        importResult = addImport(importResult, await doImport(full.threads));
        for (const t of full.threads) maxCreationSeen = Math.max(maxCreationSeen, epochOf(t.createdAt));
      }

      const stats: VocIncrementStats = {
        requests: used,
        quotaRemaining: quota,
        discovered: discoveredIds.length,
        rechecked,
        missing,
        ...importResult,
        carryOver: carry.length,
      };
      // Watermark, rotation cursor and carry-over advance only after a successful run.
      await saveState({
        sourceId: input.sourceId,
        createdWatermark: maxCreationSeen,
        recheckOffset: nextOffset,
        lastRunAt: new Date().toISOString(),
        lastResult: "ok",
        carryOver: carry.length ? carry : undefined,
      });
      return { status: "processed", stats };
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error).slice(0, 200);
      // The watermark, cursor and carry-over stay exactly as they were — the next run resumes here.
      await saveState({ ...runState, lastRunAt: new Date().toISOString(), lastResult: message });
      return { status: "failed", reason: message, stats: { ...empty, requests: used, quotaRemaining: quota, carryOver: runState.carryOver?.length ?? 0 } };
    } finally {
      // The reserved connection returns to the pool with its session alive: the session-level
      // advisory lock MUST be released here, or every later run would be refused forever.
      await connection`SELECT pg_advisory_unlock(${INCREMENT_LOCK_KEY}::bigint)`;
    }
  } finally {
    await connection.release();
  }
}

const addImport = (
  a: { stored: number; revised: number; skipped: number },
  b: { stored: number; revised: number; skipped: number },
) => ({ stored: a.stored + b.stored, revised: a.revised + b.revised, skipped: a.skipped + b.skipped });

/**
 * First-run watermark: the earliest batch's importedAt for this source — the moment the operator's
 * collection last looked at the source. Questions created after that are genuinely new to the
 * project; anything older was inside the initial collection's own discovery window.
 */
async function defaultWatermark(sourceId: string): Promise<number> {
  const rows = await sql<{ imported_at: string | null }[]>`
    SELECT value->>'importedAt' AS imported_at FROM settings
    WHERE key LIKE 'voc.batch.%' AND value->>'sourceId' = ${sourceId} AND value->>'revokedAt' IS NULL
    ORDER BY value->>'importedAt' ASC LIMIT 1`;
  return epochOf(rows[0]?.imported_at) || Math.floor(Date.now() / 1000);
}

/** Reads the increment state without running anything (the system page's status line). */
export async function loadVocIncrementState(sourceId: string): Promise<VocIncrementState | null> {
  return loadState(sourceId);
}
