// The third lane (consumer voice) — its data model on the existing tables, no migration.
//
// Everything lives where the first two lanes already put things:
//   study + batch definitions  → settings (jsonb kv)
//   raw materials + versions   → articles + article_revisions (identity_key = se:<question_id>)
//   thread / L1 / L2 / review  → articles.raw.voc
//   pain themes + evidence     → stories (frame.lane = "voc") + facts + fact_articles
//
// Permissions are per USE, per BATCH: storing a record does not license model processing or
// export. A record admitted by two batches keeps both bases; revoking one recomputes the record's
// effective permissions from the remaining batches — atomically, in SQL, not by read-then-write.
import { sql } from "../db.ts";

/** The five uses a record or a source can be licensed for, judged separately. */
export const VOC_USES = ["store", "privateRead", "modelSend", "export", "display"] as const;
export type VocUse = (typeof VOC_USES)[number];

/** One batch's permission basis: which uses it licenses, and the human-readable basis. */
export interface VocLicenseBasis {
  uses: VocUse[];
  basis: string;
}

export interface VocBatch {
  id: string;
  sourceId: string;
  label: string;
  importedAt: string;
  license: VocLicenseBasis;
  /** Set when the whole batch is revoked; the reason is kept for the audit trail. */
  revokedAt?: string;
  revokeReason?: string;
}

export interface VocStudyTerms {
  category: string;
  models?: string[];
  asins?: string[];
  scenarios?: string[];
  positive: string[];
  neutral: string[];
  negative: string[];
  exclude: string[];
}

export type VocStudyStatus = "defined" | "importing" | "analyzing" | "review" | "archived";

export interface VocStudy {
  id: string;
  name: string;
  status: VocStudyStatus;
  terms: VocStudyTerms;
  /** Source ids allowed for this study; each must be admitted and licensed before use. */
  sourceIds: string[];
  materialFrom?: string;
  materialTo?: string;
  caps?: { maxMaterials?: number };
  createdAt: string;
}

export type VocMaterialForm = "firsthand" | "question" | "answer" | "comment" | "quote" | "agency" | "manufacturer" | "unknown";
export type VocAuthorRole = "consumer" | "peer" | "vendor" | "agency" | "unknown";

/** A thread's preserved context — what L2/L3 judgments must be able to see. */
export interface VocThreadAnswer {
  id: number;
  score: number;
  isAccepted: boolean;
  authorRole: VocAuthorRole;
  body: string;
  /** The licence the API returned for THIS answer — may differ from the question's. */
  contentLicense?: string;
  comments: Array<{ id: number; body: string; authorRole: VocAuthorRole; contentLicense?: string }>;
}

export interface VocThread {
  questionId: number;
  title: string;
  body: string;
  tags: string[];
  authorRole: VocAuthorRole;
  createdAt: string;
  lastActivityAt: string;
  /** The question's own licence as the API returned it — answers and comments carry theirs. */
  contentLicense?: string;
  answers: VocThreadAnswer[];
  /** The question's own comment thread — part of the discussion context, preserved verbatim.
      Each comment keeps its own licence; a missing one stays undefined (never the parent's). */
  comments: Array<{ id: number; body: string; authorRole: VocAuthorRole; contentLicense?: string }>;
  /** The asker's own follow-up that confirms/refutes a fix, when present in the thread. */
  askerFollowUp?: string;
}

/** Deterministic L1 classification — labels and keywords, never a translation. */
export interface VocL1 {
  language: "en" | "zh" | "mixed" | "unknown";
  categories: string[];
  polarity: "positive" | "negative" | "neutral" | "mixed" | "unknown";
  needsReview: boolean;
  notes: string[];
}

/** The model's structured Chinese understanding of one thread (L2). Produced only by the gated
    lane; bound to the evidence revision it was produced from. */
export interface VocL2Result {
  product: string | null;
  model: string | null;
  scenario: string | null;
  viewpointType: "firsthand" | "question" | "hearsay" | "agency" | "unknown";
  experienceType: "positive" | "negative" | "neutral" | "mixed" | "unknown";
  chineseSummary: string;
  positiveSignals: string[];
  negativeSignals: string[];
  existingSolutions: string[];
  resolutionStatus: "solved-candidate" | "unsolved" | "undetermined";
  uncertainties: string[];
  citationIds: number[];
}

/** One stored L2 result with its provenance. */
export interface VocL2Stored {
  inputRevision: number;
  modelId: string;
  modelMode: string;
  promptVersion: string;
  generatedAt: string;
  partial: boolean;
  partialReason: string | null;
  result: VocL2Result;
  quality: "pass" | "partial" | "failed";
  receiptId: number;
}

export interface VocL3Hypothesis {
  id: string;
  statement: string;
  supportingFactIds: number[];
  counterFactIds: number[];
  existingSolutions: string[];
  resolutionStatus: "solved" | "unsolved" | "undetermined";
  limits: string[];
  toVerify: string[];
}

export type VocReviewStatus = "pending" | "confirmed" | "rejected" | "insufficient" | "merged" | "archived";

export interface VocReview {
  status: VocReviewStatus;
  note?: string;
  /** The evidence version the decision was made on; a change re-marks it REVIEW_REQUIRED. */
  evidenceRevision?: number;
  decidedAt?: string;
  decidedBy?: string;
  /** Who physically recorded it — "user" or the agent's name when the user dictated it. */
  recordedBy?: string;
}

/** The per-record voc payload kept in articles.raw. */
export interface VocRecord {
  studyIds: string[];
  batches: string[];
  /** The licence the API actually returned for THIS item (never hardcoded site-wide). */
  contentLicense?: string;
  /** The item's canonical link as the API returned it (CC BY-SA attribution target). */
  canonicalLink?: string;
  thread?: VocThread;
  form: VocMaterialForm;
  /** Independence unknown for scraped/threads; firsthand requires the asker's own words. */
  authorRole: VocAuthorRole;
  market: "US" | "non-US" | "unknown";
  l1?: VocL1;
  l2?: VocL2Stored;
  hypotheses?: VocL3Hypothesis[];
  review?: VocReview;
  /** Set to the revoking batch when every licensing batch is gone; reading layers filter on it. */
  revokedBy?: string;
}

/* ------------------------------------------------------------- settings kv */

export async function saveStudy(study: VocStudy): Promise<void> {
  await sql`INSERT INTO settings (key, value, updated_by) VALUES (${`voc.study.${study.id}`}, ${sql.json(study as never)}, 'voc')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

export async function loadStudies(): Promise<VocStudy[]> {
  const rows = await sql<{ value: VocStudy }[]>`SELECT value FROM settings WHERE key LIKE 'voc.study.%' ORDER BY key`;
  return rows.map((r) => r.value);
}

export async function loadStudy(id: string): Promise<VocStudy | null> {
  const [row] = await sql<{ value: VocStudy }[]>`SELECT value FROM settings WHERE key = ${`voc.study.${id}`}`;
  return row?.value ?? null;
}

export async function saveBatch(batch: VocBatch): Promise<void> {
  await sql`INSERT INTO settings (key, value, updated_by) VALUES (${`voc.batch.${batch.id}`}, ${sql.json(batch as never)}, 'voc')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

export async function loadBatches(): Promise<VocBatch[]> {
  const rows = await sql<{ value: VocBatch }[]>`SELECT value FROM settings WHERE key LIKE 'voc.batch.%' ORDER BY key`;
  return rows.map((r) => r.value);
}

/** Effective permissions of a record: the union of its non-revoked batches' licensed uses. */
export function effectiveUses(record: { batches: string[] }, batchesById: Map<string, VocBatch>): Set<VocUse> {
  const uses = new Set<VocUse>();
  for (const id of record.batches) {
    const batch = batchesById.get(id);
    if (!batch || batch.revokedAt) continue;
    for (const use of batch.license.uses) uses.add(use);
  }
  return uses;
}
