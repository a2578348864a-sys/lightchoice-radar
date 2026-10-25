// The fourth lane (market signals) — data model on the existing tables, zero migration (VOC precedent).
//
// Storage layout (same philosophy as voc/*):
//   source registry + permissions → settings (market.source.*)
//   keyword weekly snapshots      → articles (identity market:kw:<source>:<periodStart>, raw.market)
//   product/chart observations    → articles (identity market:us:asin:<ASIN>, raw.market.product; chart
//                                   snapshots identity market:chart:<chartId>:<periodKey>)
//   computed signals/metrics      → recomputed from snapshots on read (deterministic, versioned formulas)
//   opportunities/reviews/alerts  → settings namespaces (market.opp.*) + per-opportunity articles-independent
//                                   store in settings (small volumes, human-scale)
//
// Time semantics (8 stamps, never conflated — master plan §3.1):
//   sourcePeriodStart/End, sourcePublishedAt, sourceUpdatedAt, observedAt, ingestedAt, computedAt,
//   aiExplainedAt (reserved, no model calls this round), humanDecidedAt.
import { sql } from "../db.ts";

/* ---------------------------------------------------------------- permissions */

/** The six uses every market source is judged for, independently (master plan §9.1). */
export const MARKET_USES = ["fetch", "store", "compute", "modelSend", "display", "export"] as const;
export type MarketUse = (typeof MARKET_USES)[number];

export interface MarketPermissionBasis {
  uses: MarketUse[];
  /** Who granted it and on what grounds; "operator grant (manual observation)" for managed observation. */
  basis: string;
  /** Evidence level for the underlying data path: L1 doc / L2 eligibility / L3 verified sample. */
  evidence: "L1" | "L2" | "L3";
}

/** One registered market source: the adapter kind plus its per-use permission state. */
export interface MarketSource {
  id: string;
  kind: "amz123-keywords" | "amazon-chart-manual" | "generic-import" | "api-pending" | "external-pending";
  label: string;
  /** The original data producer (e.g. "Amazon ABA via AMZ123 display") — never the re-publisher alone. */
  producer: string;
  marketplace: "US" | "other";
  permission: MarketPermissionBasis;
  /** Whether the operator has enabled it for actual runs — sources default OFF. */
  enabled: boolean;
  /** Adapter state machine (master plan §5.2), kept as an honest record. */
  automation: "manual-import-only" | "authorized-periodic" | "blocked-no-license" | "pending-credentials";
  /** Uses whose grant by the SOURCE SITE is not verified — operator-private-research use never
      silently upgrades into a site licence (R6-CLOSE task 2). */
  unverifiedUses?: MarketUse[];
  /** Set when the operator revokes the source; downstream observations/metrics/alerts retire. */
  revokedAt?: string;
  revokeReason?: string;
  notes?: string;
}

export interface MarketKeywordSnapshotRow {
  keyword: string;
  rankThisWeek: number;
  rankLastWeek: number | null;
  /** |lastWeek − thisWeek| as published by the source; direction derived, never trusted (R0-DATA finding). */
  rankDeltaAbsolute: number | null;
}

export interface MarketKeywordSnapshot {
  sourceId: string;
  periodStart: string; // ISO date of the source's weekly window start
  periodEnd: string;
  sourceUpdatedAt: string | null;
  observedAt: string;
  producer: string;
  /** ABA-style secondary display flag — keeps re-publishers from counting as independent evidence. */
  secondaryDisplay: boolean;
  rows: MarketKeywordSnapshotRow[];
}

export interface MarketChartObservation {
  asin: string;
  chartRank: number | null;
  price: string | null; // "$11.97" — kept verbatim with the source's formatting
  title: string | null;
}

export interface MarketChartSnapshot {
  sourceId: string;
  chartId: string; // e.g. "amazon-us-bestsellers-beauty"
  chartKind: "bestsellers" | "new-releases" | "movers-shakers" | "most-wished" | "other";
  marketplace: "US";
  /** The category scope the chart itself declares (a name, not a node id — category tree is L2-pending). */
  categoryLabel: string | null;
  /** Top-N coverage actually observed this run (page 1 = first N of the chart's own order). */
  topN: number;
  complete: boolean; // full chart page observed without pagination gaps
  periodKey: string; // observedAt day (charts do not declare their own period — master plan §3.1 honest gap)
  observedAt: string;
  rows: MarketChartObservation[];
}

/** A product's accumulated identity + observations, kept on its identity-keyed article. */
export interface MarketProductRecord {
  marketplace: "US";
  asin: string;
  parentAsin: string | null;
  brand: string | null;
  model: string | null;
  title: string | null;
  /** Four-way first-seen record (master plan §3.2) — never conflated. */
  firstObservedAt: string;
  firstChartedAt: string | null;
  pageLaunchClaim: string | null;
  evidenceBackedLaunch: string | null;
  /** Latest per-chart ranks keyed by chartId → { rank, periodKey } for "current state" display. */
  chartRanks: Record<string, { rank: number; periodKey: string }>;
  lastPrice: string | null;
  categoryLabel: string | null;
}

export type MarketReviewStatus = "pending" | "deep-dive" | "watch" | "need-evidence" | "high-risk" | "excluded" | "reviewed";
export type MarketReviewAction = "deep-dive" | "watch" | "need-evidence" | "high-risk" | "exclude" | "mark-reviewed";

export interface MarketReview {
  status: MarketReviewStatus;
  note?: string;
  /** The evidence version the decision was made on; upstream revision → REVIEW_REQUIRED. */
  basisVersion?: string;
  decidedAt?: string;
  decidedBy?: string;
}

/* ------------------------------------------------------------------- settings */

export async function saveMarketSource(source: MarketSource): Promise<void> {
  await sql`INSERT INTO settings (key, value, updated_by) VALUES (${`market.source.${source.id}`}, ${sql.json(source as never)}, 'market')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

export async function loadMarketSources(): Promise<MarketSource[]> {
  const rows = await sql<{ value: MarketSource }[]>`SELECT value FROM settings WHERE key LIKE 'market.source.%' ORDER BY key`;
  return rows.map((r) => r.value);
}

export async function loadMarketSource(id: string): Promise<MarketSource | null> {
  const [row] = await sql<{ value: MarketSource }[]>`SELECT value FROM settings WHERE key = ${`market.source.${id}`}`;
  return row?.value ?? null;
}

/** Effective uses of a source — the single gate every adapter/import path must call. */
export function sourceUses(source: MarketSource | null): Set<MarketUse> {
  return new Set(source?.enabled ? source.permission.uses : []);
}

/** True only when the source is registered, enabled, and licensed for the specific use. */
export function sourceAllows(source: MarketSource | null, use: MarketUse): boolean {
  return sourceUses(source).has(use);
}

/* -------------------------------------------------------- opportunity store */

export interface MarketOpportunityEvidence {
  kind: "demand" | "supply" | "pain" | "competition" | "price" | "external" | "counter";
  /** Where it came from: a market source id or a lane reference like "voc:grinder-v1". */
  origin: string;
  producer: string;
  statement: string;
  /** Independence group: two ABA re-publishes share a group so they never count as two evidences. */
  evidenceGroup: string;
}

export interface MarketOpportunity {
  id: string;
  title: string;
  summaryZh: string;
  status: "candidate" | "needs-evidence" | "rejected";
  /** Which of the 12 modules produced it. */
  module: string;
  evidence: MarketOpportunityEvidence[];
  counterEvidence: MarketOpportunityEvidence[];
  dataGaps: string[];
  score: { version: string; total: number | null; components: Record<string, number>; refusedReason?: string } | null;
  review: MarketReview;
  basisVersion: string;
  createdAt: string;
}

export interface MarketAlertRule {
  id: string;
  name: string;
  module: string;
  /** Deterministic predicate config, e.g. keyword rank rise ≥ N within the observed window. */
  rule: { kind: "keyword-rank-rise" | "keyword-rank-drop" | "product-rank-change" | "price-change" | "qualified-opportunity"; threshold: number; window?: string };
  cooldownHours: number;
  enabled: boolean;
}

/** Alert types are business-distinct (R6-CLOSE task 3): a plain change is never displayed as a
    qualified opportunity; source failures and revocations are their own kinds. */
export type MarketAlertKind = "market-change" | "research-lead" | "qualified-opportunity" | "source-failure" | "revision-revocation";

export interface MarketAlert {
  id: string;
  ruleId: string;
  kind: MarketAlertKind;
  subject: string;
  detailZh: string;
  /** Why this alert fired — rule, threshold, evidence version; rendered verbatim. */
  reasonZh: string;
  firedAt: string;
  evidenceRefs: string[];
  status: "new" | "acknowledged" | "retired";
  /** Dedup key: same subject+rule+window fires once. */
  dedupKey: string;
}

const OPP_KEY = (id: string) => `market.opp.${id}`;
const ALERT_RULE_KEY = (id: string) => `market.alert-rule.${id}`;
const ALERT_KEY = (id: string) => `market.alert.${id}`;

export async function saveMarketOpportunity(opp: MarketOpportunity): Promise<void> {
  await sql`INSERT INTO settings (key, value, updated_by) VALUES (${OPP_KEY(opp.id)}, ${sql.json(opp as never)}, 'market')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

export async function loadMarketOpportunities(): Promise<MarketOpportunity[]> {
  const rows = await sql<{ key: string; value: MarketOpportunity }[]>`SELECT key, value FROM settings WHERE key LIKE 'market.opp.%' ORDER BY key`;
  return rows.map((r) => r.value);
}

export async function loadMarketOpportunity(id: string): Promise<MarketOpportunity | null> {
  const [row] = await sql<{ value: MarketOpportunity }[]>`SELECT value FROM settings WHERE key = ${OPP_KEY(id)}`;
  return row?.value ?? null;
}

export async function saveMarketAlertRule(rule: MarketAlertRule): Promise<void> {
  await sql`INSERT INTO settings (key, value, updated_by) VALUES (${ALERT_RULE_KEY(rule.id)}, ${sql.json(rule as never)}, 'market')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

export async function loadMarketAlertRules(): Promise<MarketAlertRule[]> {
  const rows = await sql<{ value: MarketAlertRule }[]>`SELECT value FROM settings WHERE key LIKE 'market.alert-rule.%' ORDER BY key`;
  return rows.map((r) => r.value);
}

export async function saveMarketAlerts(alerts: MarketAlert[]): Promise<void> {
  for (const a of alerts) {
    await sql`INSERT INTO settings (key, value, updated_by) VALUES (${ALERT_KEY(a.id)}, ${sql.json(a as never)}, 'market')
              ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  }
}

/** Revokes a source: disabled + stamped; downstream propagation lives in market-opportunity. */
export async function revokeMarketSource(id: string, reason: string): Promise<MarketSource | null> {
  const source = await loadMarketSource(id);
  if (!source) return null;
  const revoked: MarketSource = { ...source, enabled: false, revokedAt: new Date().toISOString(), revokeReason: reason };
  await saveMarketSource(revoked);
  return revoked;
}

export async function loadMarketAlerts(): Promise<MarketAlert[]> {
  const rows = await sql<{ value: MarketAlert }[]>`SELECT value FROM settings WHERE key LIKE 'market.alert.%' ORDER BY key`;
  return rows.map((r) => r.value);
}

/* ------------------------------------------------ external platforms & innovations */

export interface MarketExternalRecord {
  id: string;
  platform: "ebay" | "etsy" | "walmart" | "tiktok" | "other";
  externalId: string;
  title: string;
  price: string | null;
  currency: string;
  url?: string;
  observedAt: string;
  candidateAsin?: string | null;
  matchConfidence?: number;
  notes?: string;
}

export interface MarketInnovationCue {
  id: string;
  title: string;
  cueType: "feature-diff" | "pain-point-fix" | "substitute-solution" | "patent-trend";
  targetKeywordOrAsin?: string;
  differenceSummaryZh: string;
  source: string;
  observedAt: string;
  verified: boolean;
  notes?: string;
}

export async function saveMarketExternalRecord(rec: MarketExternalRecord): Promise<void> {
  await sql`INSERT INTO settings (key, value, updated_by) VALUES (${`market.external.${rec.id}`}, ${sql.json(rec as never)}, 'market')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

export async function loadMarketExternalRecords(): Promise<MarketExternalRecord[]> {
  const rows = await sql<{ value: MarketExternalRecord }[]>`SELECT value FROM settings WHERE key LIKE 'market.external.%' ORDER BY key`;
  return rows.map((r) => r.value);
}

export async function saveMarketInnovationCue(cue: MarketInnovationCue): Promise<void> {
  await sql`INSERT INTO settings (key, value, updated_by) VALUES (${`market.innovation.${cue.id}`}, ${sql.json(cue as never)}, 'market')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

export async function loadMarketInnovationCues(): Promise<MarketInnovationCue[]> {
  const rows = await sql<{ value: MarketInnovationCue }[]>`SELECT value FROM settings WHERE key LIKE 'market.innovation.%' ORDER BY key`;
  return rows.map((r) => r.value);
}

/* ------------------------------------------------------- evidence versioning */

/** Snapshot articles carry a basis version = sourceId + period + content hash; opportunities bind to it. */
export function keywordSnapshotBasisVersion(snap: { sourceId: string; periodStart: string; rows: unknown[] }): string {
  return `${snap.sourceId}@${snap.periodStart}#rows=${snap.rows.length}`;
}

export function chartSnapshotBasisVersion(snap: { chartId: string; periodKey: string; rows: unknown[] }): string {
  return `${snap.chartId}@${snap.periodKey}#rows=${snap.rows.length}`;
}

/** A revision of upstream evidence invalidates bound human decisions → REVIEW_REQUIRED (VOC semantics). */
export function reviewAfterBasisChange(review: MarketReview, newBasis: string): MarketReview {
  if (review.basisVersion === newBasis || review.status === "pending") return review;
  return { ...review, status: "need-evidence", note: `REVIEW_REQUIRED: 证据版本已变化（${review.basisVersion} → ${newBasis}）` };
}
