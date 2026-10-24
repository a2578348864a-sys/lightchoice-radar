// Third-party policy leads, read-only.
//
// These rows are what the AMZ123 lead source stored: a third-party report that looks like an Amazon
// US policy change, kept as a candidate and never turned into a policy record. This module is the
// only read path for them. It returns whitelisted metadata — never `body_text`, `body_html`, a body
// excerpt or the whole `raw` object — and it never touches `publications`, `fact_articles` or the
// search index, so the public pool keeps its meaning.
import type {
  LeadClaim, LeadCounts, LeadDetail, LeadListItem, LeadSourceStatus, LeadsResponse, LeadState,
} from "@aihot/contracts/site";
import { sql } from "../db.ts";

/** The one third-party lead source the site may show. */
export const LEAD_SOURCE_ID = "amz123-policy-leads";
/** How the report's publisher is named on the page. */
export const LEAD_SOURCE_LABEL = "AMZ123";
/** The dedicated worker's role key (same value as apps/worker/src/instance-lock.ts). */
const LEAD_LOCK_KEY = 7_204_229_003;
const LIST_LIMIT = 100;
const EXCERPT_MAX = 300;

/** Shown with the list and on every detail: what these records are, and what they are not. */
export const LEAD_LIMITATIONS = [
  "这些记录是第三方媒体 AMZ123 的报道线索，不是 Amazon 官方已确认的政策。",
  "本项目只保存标题、短摘要、发布日期与核实状态，不保存也不展示报道正文。",
  "官方核实只比对项目已收录的官方来源（公告博客、Selling Partners、联邦公报等）；没有匹配记录时保持「仅第三方报道」。",
  "线索不进入公开情报池、搜索索引与事实表，也不会自动转成平台政策记录。",
];

const STATES: readonly LeadState[] = ["active", "excluded", "all"];

export function leadState(value: string | undefined): LeadState {
  return STATES.includes(value as LeadState) ? (value as LeadState) : "active";
}

interface LeadRow {
  id: string;
  title: string;
  url: string;
  author: string | null;
  source_id: string;
  published_at: Date | null;
  source_updated_at: Date | null;
  discovered_at: Date;
  excerpt: string | null;
  processing_state: string;
  section: string | null;
  column_name: string | null;
  lead_tags: string[] | null;
  rule_ids: string[] | null;
  radar_tags: string[] | null;
  radar_rule_ids: string[] | null;
  official_status: string | null;
  official_note: string | null;
  official_url: string | null;
  official_source: string | null;
  effective_date_label: string | null;
  official_claims: unknown;
  official_verified_at: string | null;
  /** A date the official record itself states. The verifier stores none today, so this is null. */
  official_effective_date: string | null;
  effective_date: string | null;
  event_state: string | null;
  exclusion_reason: string | null;
}

/** The columns every list row reads: metadata only, one `left()` on the description. */
const LIST_COLUMNS = sql`
  a.id, a.title, a.url, a.author, a.source_id, a.published_at, a.source_updated_at, a.discovered_at,
  left(a.excerpt, ${EXCERPT_MAX}) AS excerpt, a.processing_state,
  a.raw->'lead'->>'section' AS section,
  a.raw->'lead'->>'column' AS column_name,
  a.raw->'lead'->'sourceTags' AS lead_tags,
  a.raw->'lead'->'sourceRuleIds' AS rule_ids,
  a.raw->'lead'->'radarTags' AS radar_tags,
  a.raw->'lead'->'radarRuleIds' AS radar_rule_ids,
  a.raw->'lead'->'officialVerification'->>'status' AS official_status,
  a.raw->'lead'->'officialVerification'->>'note' AS official_note,
  a.raw->'lead'->'officialVerification'->>'officialUrl' AS official_url,
  a.raw->'lead'->'officialVerification'->>'effectiveDate' AS official_effective_date,
  a.raw->'lead'->'officialVerification'->>'officialSource' AS official_source,
  a.raw->'lead'->'officialVerification'->>'effectiveDateLabel' AS effective_date_label,
  a.raw->'lead'->'officialVerification'->'claims' AS official_claims,
  a.raw->'lead'->'officialVerification'->>'verifiedAt' AS official_verified_at,
  coalesce(a.raw->'lead'->>'effectiveDate', a.raw->'lead'->'event'->>'effectiveDate') AS effective_date,
  a.raw->'lead'->'event'->>'state' AS event_state,
  coalesce(a.raw->'lead'->'review'->>'reason', a.raw->'lead'->'review'->>'verdict') AS exclusion_reason
`;

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/** Per-claim verification records, whitelisted field by field: nothing else from the jsonb passes. */
function officialClaims(value: unknown): LeadClaim[] | null {
  if (!Array.isArray(value)) return null;
  const claims: LeadClaim[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    if (typeof record.claim !== "string" || (record.verdict !== "supported" && record.verdict !== "unverified")) continue;
    claims.push({
      claim: record.claim,
      verdict: record.verdict,
      evidence: typeof record.evidence === "string" ? record.evidence : null,
      note: typeof record.note === "string" ? record.note : null,
    });
  }
  return claims.length ? claims : null;
}

/**
 * Dates a lead may show. Two separate questions, and the second one is not answered by the first:
 *
 * - Matching an official page proves the report points at a real official record. It does **not**
 *   prove the date the report gives, so the report's date never becomes a policy effective date.
 * - Only a date the official record itself states (`officialVerification.effectiveDate`, which the
 *   verifier does not store today) can be shown as the policy's effective date.
 *
 * Everything else stays a claim: the report's date lives in `reportedEffectiveDate`, and the page
 * either labels it as the report's claim or hides it.
 */
export function leadEffectiveDates(officialStatus: string, reported: string | null, officialEffectiveDate: string | null = null): {
  effectiveDate: string | null;
  reportedEffectiveDate: string | null;
  effectiveDateVerified: boolean;
} {
  const effectiveDateVerified = officialStatus === "matched-official" && !!officialEffectiveDate;
  return {
    effectiveDate: effectiveDateVerified ? officialEffectiveDate : null,
    reportedEffectiveDate: reported,
    effectiveDateVerified,
  };
}

function mapRow(row: LeadRow): LeadListItem {
  const dates = leadEffectiveDates(row.official_status ?? "unknown", row.effective_date, row.official_effective_date);
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    author: row.author,
    sourceId: row.source_id,
    sourceName: LEAD_SOURCE_LABEL,
    publishedAt: iso(row.published_at),
    sourceUpdatedAt: iso(row.source_updated_at),
    discoveredAt: row.discovered_at.toISOString(),
    excerpt: row.excerpt,
    processingState: row.processing_state,
    excluded: row.processing_state === "skipped",
    exclusionReason: row.exclusion_reason,
    officialStatus: row.official_status ?? "unknown",
    officialNote: row.official_note,
    officialUrl: row.official_url,
    officialSource: row.official_source,
    effectiveDateLabel: row.effective_date_label,
    officialClaims: officialClaims(row.official_claims),
    officialVerifiedAt: row.official_verified_at,
    ...dates,
    leadTags: textArray(row.lead_tags),
    ruleIds: textArray(row.rule_ids),
    radarTags: textArray(row.radar_tags),
    radarRuleIds: textArray(row.radar_rule_ids),
    section: row.section,
    column: row.column_name,
    eventState: row.event_state,
  };
}

async function leadCounts(): Promise<LeadCounts> {
  const [row] = await sql<{ active: number; excluded: number; all: number }[]>`
    SELECT count(*) FILTER (WHERE processing_state <> 'skipped')::int AS active,
           count(*) FILTER (WHERE processing_state = 'skipped')::int AS excluded,
           count(*)::int AS all
    FROM articles WHERE source_id = ${LEAD_SOURCE_ID}`;
  return row ?? { active: 0, excluded: 0, all: 0 };
}

export interface LeadQuery {
  state?: string;
  verification?: string | null;
  processing?: string | null;
}

/** The candidate list: excluded reports never appear in the default state. */
export async function loadLeads(query: LeadQuery = {}): Promise<LeadsResponse> {
  const state = leadState(query.state);
  const verification = query.verification?.trim().slice(0, 40) || null;
  const processing = query.processing?.trim().slice(0, 40) || null;
  const rows = await sql<LeadRow[]>`
    SELECT ${LIST_COLUMNS}
    FROM articles a
    WHERE a.source_id = ${LEAD_SOURCE_ID}
      AND (${state} = 'all'
        OR (${state} = 'active' AND a.processing_state <> 'skipped')
        OR (${state} = 'excluded' AND a.processing_state = 'skipped'))
      AND (${verification}::text IS NULL OR a.raw->'lead'->'officialVerification'->>'status' = ${verification})
      AND (${processing}::text IS NULL OR a.processing_state = ${processing})
    ORDER BY coalesce(a.published_at, a.discovered_at) DESC, a.discovered_at DESC
    LIMIT ${LIST_LIMIT}`;
  const [source] = await sql<{ id: string; name: string; enabled: boolean; interval_minutes: number }[]>`
    SELECT id, name, enabled, interval_minutes FROM sources WHERE id = ${LEAD_SOURCE_ID}`;
  return {
    items: rows.map(mapRow),
    counts: await leadCounts(),
    filters: { state, verification, processing },
    source: {
      id: LEAD_SOURCE_ID,
      name: LEAD_SOURCE_LABEL,
      enabled: source?.enabled ?? false,
      intervalMinutes: source?.interval_minutes ?? 0,
    },
    limitations: LEAD_LIMITATIONS,
  };
}

/** One lead, with the fields the detail page explains the record with. */
export async function loadLeadDetail(id: string): Promise<LeadDetail | null> {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return null;
  const [row] = await sql<(LeadRow & {
    site_tags: string[] | null;
    market: string | null;
    market_evidence: string | null;
    gate_version: string | null;
    discovered_via: string | null;
    event_key: string | null;
    official_title: string | null;
    official_published_at: string | null;
    reviewed_at: string | null;
  })[]>`
    SELECT ${LIST_COLUMNS},
      a.raw->'lead'->'siteTags' AS site_tags,
      a.raw->'lead'->>'market' AS market,
      a.raw->'lead'->>'marketEvidence' AS market_evidence,
      a.raw->'lead'->>'gateVersion' AS gate_version,
      a.raw->'lead'->>'discoveredVia' AS discovered_via,
      a.raw->'lead'->'event'->>'key' AS event_key,
      a.raw->'lead'->'officialVerification'->>'officialTitle' AS official_title,
      a.raw->'lead'->'officialVerification'->>'officialPublishedAt' AS official_published_at,
      a.raw->'lead'->'review'->>'reviewedAt' AS reviewed_at
    FROM articles a
    WHERE a.id = ${id} AND a.source_id = ${LEAD_SOURCE_ID}`;
  if (!row) return null;
  return {
    ...mapRow(row),
    siteTags: textArray(row.site_tags),
    market: row.market,
    marketEvidence: row.market_evidence,
    gateVersion: row.gate_version,
    discoveredVia: row.discovered_via,
    eventKey: row.event_key,
    officialTitle: row.official_title,
    officialPublishedAt: row.official_published_at,
    reviewedAt: row.reviewed_at,
  };
}

/**
 * Whether the dedicated worker holds its role: the session advisory lock exists only while that
 * process is connected, so trying to take it answers the question without a new table. The lock is
 * released immediately when this caller got it (the worker was not running).
 */
async function workerRunning(): Promise<boolean> {
  const connection = await sql.reserve();
  try {
    const [row] = await connection<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${LEAD_LOCK_KEY}::bigint) AS locked`;
    if (row?.locked) {
      await connection`SELECT pg_advisory_unlock(${LEAD_LOCK_KEY}::bigint)`;
      return false;
    }
    return true;
  } finally {
    await connection.release();
  }
}

/** The source row, the worker's lock and the last round, kept apart so the page cannot merge them. */
export async function loadLeadStatus(): Promise<LeadSourceStatus> {
  const [source] = await sql<{
    id: string; enabled: boolean; health: string; fail_count: number; interval_minutes: number;
    last_error: string | null; next_fetch_at: Date | null; last_ok_at: Date | null;
  }[]>`
    SELECT id, enabled, health, fail_count, interval_minutes, last_error, next_fetch_at, last_ok_at
    FROM sources WHERE id = ${LEAD_SOURCE_ID}`;
  const [run] = await sql<{
    id: number; status: string; found_count: number; new_count: number; started_at: Date; error: string | null;
  }[]>`
    SELECT id, status, found_count, new_count, started_at, error
    FROM fetch_runs WHERE source_id = ${LEAD_SOURCE_ID} ORDER BY id DESC LIMIT 1`;
  return {
    source: {
      id: LEAD_SOURCE_ID,
      name: LEAD_SOURCE_LABEL,
      enabled: source?.enabled ?? false,
      health: source?.health ?? "unknown",
      failCount: source?.fail_count ?? 0,
      intervalMinutes: source?.interval_minutes ?? 0,
      lastError: source?.last_error ?? null,
      nextFetchAt: iso(source?.next_fetch_at ?? null),
      lastOkAt: iso(source?.last_ok_at ?? null),
    },
    worker: { running: await workerRunning(), signal: "advisory-lock" },
    lastRun: run
      ? { id: run.id, status: run.status, found: run.found_count, created: run.new_count, startedAt: run.started_at.toISOString(), error: run.error }
      : null,
    nextFetchIsPlanOnly: true,
  };
}
