// Pain-theme grouping, the gated L2/L3 lane, human review and revocation propagation.
//
// Grouping is deterministic: product + scenario + issue category, from L1 and the thread's own
// words. Evidence links are facts on the existing stories model (lane = "voc"); support and
// counter-evidence ride fact_articles' role. L2/L3 model work lives behind a valve that defaults to
// closed — the third lane carries ¥0 of model authorisation, so the lane refuses until the
// operator opens it with a funded, budgeted window. Revocation recomputes permissions atomically.
import { sql } from "../db.ts";
import { config } from "../config.ts";
import { sha256 } from "../lib/ids.ts";
import { effectiveUses, loadBatches, type VocRecord, type VocThread } from "./voc-model.ts";
import { resolutionStatusOf } from "./voc-stackexchange.ts";

/* ------------------------------------------------------------- pain grouping */

export interface PainCandidate {
  key: string;
  product: string;
  scenario: string;
  issueCategory: string;
  articleIds: string[];
  resolvedCandidate: number;
  unresolved: number;
  undetermined: number;
}

/** Product/型号 candidates from a thread's title+tags: the model-noun words, bounded. */
export function productOf(thread: VocThread): string {
  const brandModel = /(baratza|encore|virtuoso|sette|breville|smart grinder|capresso|bodum|porlex|hario|commandante|1zpresso|comandante|eureka|mazzer|df64|normcore|timemore|kinu|fellow|ode|opx|varia|hellix)\s*(\w*)/i.exec(`${thread.title} ${thread.tags.join(" ")}`);
  if (brandModel) return `${brandModel[1]}${brandModel[2] ? " " + brandModel[2] : ""}`.trim();
  return "未知型号";
}

/** Deterministic pain key: same product + same scenario family + same issue class group together. */
export function painKeyOf(record: VocRecord): string | null {
  const thread = record.thread;
  if (!thread || !record.l1) return null;
  const product = productOf(thread);
  const category = record.l1.categories[0] ?? "未归类";
  const scenario = /(espresso)/i.test(thread.tags.join(" ")) ? "espresso" : /(pour.?over|v60|chemex)/i.test(thread.tags.join(" ")) ? "pourover" : /(french press|press)/i.test(thread.tags.join(" ")) ? "frenchpress" : "通用";
  return `${product}|${scenario}|${category}`;
}

/** Groups the stored, non-revoked voc records into pain candidates. */
export async function groupPainCandidates(studyId: string): Promise<PainCandidate[]> {
  const rows = await sql<{ id: string; raw: { voc: VocRecord } }[]>`
    SELECT id, raw FROM articles
    WHERE raw->'voc' IS NOT NULL AND raw->'voc'->>'revokedBy' IS NULL
      AND raw->'voc'->'studyIds' ? ${studyId}`;
  const groups = new Map<string, PainCandidate>();
  for (const row of rows) {
    const record = row.raw.voc;
    const key = painKeyOf(record);
    if (!key) continue;
    const thread = record.thread!;
    const resolution = resolutionStatusOf(thread);
    const group = groups.get(key) ?? {
      key, product: key.split("|")[0]!, scenario: key.split("|")[1]!, issueCategory: key.split("|")[2]!,
      articleIds: [], resolvedCandidate: 0, unresolved: 0, undetermined: 0,
    };
    group.articleIds.push(row.id);
    if (resolution === "solved-candidate") group.resolvedCandidate += 1;
    else if (resolution === "unsolved") group.unresolved += 1;
    else group.undetermined += 1;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => b.articleIds.length - a.articleIds.length);
}

/* --------------------------------------------------- the gated L2/L3 model lane */

/** The third lane's paid valve — off unless the operator opens it with a funded window. */
export function vocModelLaneOpen(): boolean {
  return config.vocModelEnabled === true;
}

/**
 * Processes one record's L2 (faithful Chinese understanding). Refuses — without any network call —
 * while the lane is closed (¥0 authorisation), while the record lacks its model-send licence, or
 * while the record is revoked. When open, one request per record produces the structured answer,
 * validated before storage: every cited evidence id must exist in the thread, and numbers/models
 * must come from the material.
 */
export async function processL2(articleId: string): Promise<{ status: string; reason?: string }> {
  if (!vocModelLaneOpen()) return { status: "refused", reason: "voc model lane closed (¥0 authorisation; open requires a funded window)" };
  const [row] = await sql<{ raw: { voc: VocRecord }; revision: number }[]>`SELECT raw, revision FROM articles WHERE id = ${articleId}`;
  const record = row?.raw?.voc;
  if (!record) return { status: "refused", reason: "not a voc record" };
  if (record.revokedBy) return { status: "refused", reason: "record revoked; no further processing" };
  const batches = await loadBatches();
  const uses = effectiveUses(record, new Map(batches.map((b) => [b.id, b])));
  if (!uses.has("modelSend")) return { status: "refused", reason: "no active batch licenses model processing for this record" };
  // The funded path is intentionally not wired here: it lands with the lane's own budget window.
  return { status: "not-wired", reason: "lane open but no budget window exists yet; wiring lands with the funding authorisation" };
}

/* --------------------------------------------------------- review & revocation */

export type ReviewAction = "confirm" | "reject" | "insufficient" | "archive";

/**
 * Records a human decision. The decision stores the evidence revision it was made on; a later
 * material change re-marks the record REVIEW_REQUIRED (the old decision stays visible as history).
 */
export async function recordReview(input: { articleId: string; action: ReviewAction; note?: string; decidedBy: string; recordedBy: string }): Promise<{ ok: boolean; reason?: string }> {
  const allowed: ReviewAction[] = ["confirm", "reject", "insufficient", "archive"];
  if (!allowed.includes(input.action)) return { ok: false, reason: "unknown action" };
  const [row] = await sql<{ revision: number; raw: { voc: VocRecord } }[]>`SELECT revision, raw FROM articles WHERE id = ${input.articleId} FOR UPDATE`;
  if (!row?.raw?.voc) return { ok: false, reason: "not a voc record" };
  const review = {
    status: input.action === "confirm" ? "confirmed" : input.action,
    note: input.note,
    evidenceRevision: row.revision,
    decidedAt: new Date().toISOString(),
    decidedBy: input.decidedBy,
    recordedBy: input.recordedBy,
  };
  // Atomic on the revision the decider saw: if the material changed meanwhile, mark for review instead.
  const updated = await sql<{ id: string }[]>`
    UPDATE articles SET raw = jsonb_set(raw, '{voc,review}', ${sql.json(review)}::jsonb), updated_at = now()
    WHERE id = ${input.articleId} AND revision = ${row.revision} RETURNING id`;
  if (!updated.length) {
    await sql`UPDATE articles SET raw = jsonb_set(raw, '{voc,review}', ${sql.json({ status: "pending", note: "REVIEW_REQUIRED: material changed during review" })}::jsonb) WHERE id = ${input.articleId}`;
    return { ok: false, reason: "material changed during review; re-marked REVIEW_REQUIRED" };
  }
  return { ok: true };
}

/**
 * Revokes a batch and propagates atomically: records whose ONLY licensing batch was the revoked one
 * are stamped revokedBy (every reading layer filters on it); records shared with other batches keep
 * their remaining permissions. A late background write holding old content cannot resurrect a
 * revoked record: writes are conditional on revokedBy being null.
 */
export async function revokeBatch(batchId: string, reason: string): Promise<{ revoked: number; keptByOtherBatches: number }> {
  return sql.begin(async (tx) => {
    await tx`UPDATE settings SET value = jsonb_set(value, '{revokedAt}', to_jsonb(now()::text)), updated_at = now()
             WHERE key = ${`voc.batch.${batchId}`}`;
    await tx`UPDATE settings SET value = jsonb_set(value, '{revokeReason}', ${JSON.stringify(reason)}::jsonb), updated_at = now()
             WHERE key = ${`voc.batch.${batchId}`}`;
    // Records whose batch list contains the batch but no other ACTIVE batch → revoked.
    const revoked = await tx<{ id: string }[]>`
      UPDATE articles SET raw = jsonb_set(raw, '{voc,revokedBy}', ${JSON.stringify(batchId)}::jsonb), updated_at = now()
      WHERE raw->'voc'->'batches' ? ${batchId}
        AND raw->'voc'->>'revokedBy' IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(raw->'voc'->'batches') AS b(id)
          JOIN settings s ON s.key = 'voc.batch.' || b.id
          WHERE b.id <> ${batchId} AND s.value->>'revokedAt' IS NULL)
      RETURNING id`;
    const kept = await tx<{ n: number }[]>`
      SELECT count(*)::int AS n FROM articles
      WHERE raw->'voc'->'batches' ? ${batchId} AND raw->'voc'->>'revokedBy' IS NULL`;
    return { revoked: revoked.length, keptByOtherBatches: kept[0]?.n ?? 0 };
  });
}

/**
 * The atomic guard for every background voc write: a write carrying pre-revocation content is
 * applied only if the record is still unrevoked AND still holds the writing batch's licence.
 */
export async function guardedVocWrite(articleId: string, writingBatchId: string, patch: Record<string, unknown>): Promise<{ ok: boolean; reason?: string }> {
  const result = await sql<{ id: string }[]>`
    UPDATE articles SET raw = jsonb_set(raw, '{voc,patched}', ${JSON.stringify(patch)}::jsonb), updated_at = now()
    WHERE id = ${articleId}
      AND raw->'voc'->>'revokedBy' IS NULL
      AND raw->'voc'->'batches' ? ${writingBatchId}
      AND EXISTS (SELECT 1 FROM settings s WHERE s.key = ${`voc.batch.${writingBatchId}`} AND s.value->>'revokedAt' IS NULL)
    RETURNING id`;
  return result.length ? { ok: true } : { ok: false, reason: "revoked or unlicensed; write refused" };
}

/** Pain themes as stories (lane=voc) with support/counter evidence facts — the read layer's spine. */
export async function ensurePainStory(input: { key: string; product: string; scenario: string; issueCategory: string; articleId: string; evidenceRevision: number; resolution: string }): Promise<number> {
  if (!input.key.trim()) throw new Error("refusing a pain story without a key");
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`voc-story:${input.key}`}))`;
    const [existing] = await tx<{ id: number }[]>`SELECT id FROM stories WHERE frame->>'painKey' = ${input.key} AND merged_into IS NULL LIMIT 1`;
    let storyId: number;
    if (existing) storyId = existing.id;
    else {
      const [created] = await tx<{ id: number }[]>`
        INSERT INTO stories (public_id, title, action, frame, first_report_at, latest_at, origin)
        VALUES (gen_random_uuid(), ${`${input.product} · ${input.issueCategory}`}, ${input.resolution}, ${tx.json({ painKey: input.key, lane: "voc", product: input.product, scenario: input.scenario })}, now(), now(), 'manual')
        RETURNING id`;
      storyId = created!.id;
    }
    const factTitle = `${input.product} ${input.issueCategory}（${input.scenario}）`;
    const [fact] = await tx<{ id: number }[]>`
      INSERT INTO facts (public_id, story_id, title, subject, action, object, conditions, occurred_at, manual)
      VALUES (${sha256(`${storyId}:${input.articleId}:${input.evidenceRevision}`).slice(0, 32)}, ${storyId}, ${factTitle}, ${input.product}, ${input.issueCategory}, ${input.scenario}, ${input.resolution}, now(), false)
      ON CONFLICT (public_id) DO NOTHING RETURNING id`;
    let factId = fact?.id;
    if (!factId) {
      const [found] = await tx<{ id: number }[]>`SELECT id FROM facts WHERE public_id = ${sha256(`${storyId}:${input.articleId}:${input.evidenceRevision}`).slice(0, 32)}`;
      factId = found!.id;
    }
    await tx`INSERT INTO fact_articles (fact_id, article_id, role) VALUES (${factId}, ${input.articleId}, 'report') ON CONFLICT DO NOTHING`;
    return storyId;
  });
}
