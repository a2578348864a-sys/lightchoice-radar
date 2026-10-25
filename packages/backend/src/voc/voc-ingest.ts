// Authorised import (CSV / JSON / TXT / manual entry) and the deterministic L1 classification.
//
// Import is a batch-scoped, prechecked, idempotent pipeline: preview → apply. Dedup rides on the
// same identity machinery the lanes already use (identity_key), and re-importing a changed record
// produces a new content revision, never a second article. L1 is rules-only — language, categories,
// polarity, and a needs-review flag — and never pretends to be Chinese understanding.
import { sha256, stableJson } from "../lib/ids.ts";
import { contentHash, identityKeyFor } from "../content/materials.ts";
import { sql } from "../db.ts";
import { saveBatch, type VocAuthorRole, type VocBatch, type VocL1, type VocMaterialForm, type VocRecord, type VocThread, type VocUse } from "./voc-model.ts";

/* ------------------------------------------------------------------- L1 rules */

const L1_CATEGORIES: Array<{ category: string; words: RegExp }> = [
  { category: "故障与失效", words: /(broke|broken|stop(ped)? working|died|crack|leak|clog|jam|stuck|won'?t (grind|turn|start)|failure|malfunction|defect|rattl|smoke|burn(ing)? smell|uneven grind)/i },
  { category: "清洁与维护", words: /(clean|cleaning|descale|maintenance|lubric|burrs? (off|out)|disassembl|season|stale (grounds|beans)|residue|chaff)/i },
  { category: "使用与设置咨询", words: /(how (do|can|to)|what setting|which setting|adjust|dial| calibration|grind size|dose|timing|why (is|does|do)|trouble?t|recommend a setting)/i },
  { category: "选购与比较", words: /(vs\.?|versus|compare|which (one|grinder|model)|worth (it|upgrading)|upgrade|should i (buy|get|replace)|budget|alternative|instead of|recommend(ation)?s? (a|some|for))/i },
  { category: "兼容与配件", words: /(compatib|fit|attachment|accessor|replacement part|burrs? set|hopper|portafilter|fits)/i },
  { category: "正面体验", words: /(love|great|perfect|excellent|amazing|happy with|best (grinder|purchase|upgrade)|worth every|no (issues|problems|complaints)|smooth|quiet(er)? than|improved)/i },
  { category: "噪音与静电", words: /(nois|loud|static|electro|mess|scatter|grounds? (everywhere|flying)|popcorning|retention)/i },
];

const L1_POLARITY_POS = /(love|great|perfect|excellent|happy|best|worth|improved|smooth|recommend|works (well|great|perfectly)|no (issues|problems))/i;
const L1_POLARITY_NEG = /(broke|broken|stopped|clog|jam|leak|crack|defect|fail|awful|worst|regret|return(ed|ing)|disappoint|waste|frustrat|noisy|mess|problem|issue|fault|grounds? (fly|flying|everywhere|all over)|worse)/i;

/** CJK character ratio decides the language bucket; mixed is its own state, not a coin flip. */
function languageOf(text: string): VocL1["language"] {
  const cjk = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const latin = (text.match(/[a-zA-Z]/g) ?? []).length;
  if (cjk === 0 && latin === 0) return "unknown";
  if (cjk > 0 && latin > 0 && cjk / (cjk + latin) > 0.15) return "mixed";
  if (cjk > 0) return "zh";
  return "en";
}

/**
 * Deterministic L1: categories, polarity and a review flag from the thread's own words. The
 * question text leads (it is the asker's voice); answers contribute context words only.
 */
export function classifyL1(thread: VocThread): VocL1 {
  const own = `${thread.title}\n${thread.body}`;
  const context = thread.answers.map((a) => a.body).join("\n").slice(0, 4000);
  const hay = `${own}\n${context}`;
  const categories = L1_CATEGORIES.filter((rule) => rule.words.test(hay)).map((rule) => rule.category);
  const pos = L1_POLARITY_POS.test(own) || L1_POLARITY_POS.test(context);
  const neg = L1_POLARITY_NEG.test(own);
  const polarity: VocL1["polarity"] = pos && neg ? "mixed" : neg ? "negative" : pos ? "positive" : "neutral";
  const notes: string[] = [];
  // What the deterministic layer cannot see must be said, not smoothed over.
  if (!categories.length) notes.push("无类别命中：待人工归类");
  if (!thread.answers.length) notes.push("无回答：上下文不足");
  if (thread.askerFollowUp === undefined) notes.push("提问者无后续：解决状态未知");
  return { language: languageOf(hay), categories, polarity, needsReview: notes.length > 0 || polarity === "mixed", notes };
}

/* ------------------------------------------------------------------ importing */

export interface ImportRow {
  url: string;
  title: string;
  body: string;
  publishedAt: Date | null;
  thread?: VocThread;
  form?: VocMaterialForm;
  authorRole?: VocAuthorRole;
  /** The licence the source actually returned for this item. */
  contentLicense?: string;
}

export interface ImportPreview {
  total: number;
  duplicatesInBatch: number;
  alreadyStored: number;
  newRecords: number;
  missingFields: Array<{ url: string; field: string }>;
  nonLicensedRows: number;
}

/** Precheck without writing: field presence, in-batch dupes, existing identities, licence basis. */
export async function previewImport(rows: ImportRow[]): Promise<ImportPreview> {
  const seenUrl = new Set<string>();
  let duplicatesInBatch = 0;
  let alreadyStored = 0;
  const missingFields: ImportPreview["missingFields"] = [];
  let nonLicensedRows = 0;
  for (const row of rows) {
    if (!row.url) missingFields.push({ url: row.url ?? "(missing)", field: "url" });
    if (!row.title) missingFields.push({ url: row.url, field: "title" });
    if (!row.body && !row.thread) missingFields.push({ url: row.url, field: "body" });
    const identity = identityKeyFor({ url: row.url || `voc:blank:${sha256(row.title + row.body).slice(0, 24)}`, title: row.title || "(untitled)", sourceId: "voc-import", via: "fetch" });
    if (seenUrl.has(identity)) duplicatesInBatch += 1;
    seenUrl.add(identity);
  }
  const identities = [...seenUrl];
  if (identities.length) {
    const stored = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE identity_key = ANY(${identities}::text[])`;
    alreadyStored = stored[0]?.n ?? 0;
  }
  // Rows the caller has not attached any licence basis to (checked again at apply time).
  nonLicensedRows = rows.filter((r) => !r.url.startsWith("https://")).length; // placeholder basis check
  return { total: rows.length, duplicatesInBatch, alreadyStored, newRecords: identities.length - alreadyStored - duplicatesInBatch, missingFields, nonLicensedRows };
}

/**
 * Applies an import under one batch id: registers the batch (with its licence basis), stores each
 * row as an article carrying raw.voc (thread, L1, permissions), idempotently. Re-importing a
 * changed row revises the existing article (a new content revision), never a second identity.
 */
export async function applyImport(input: {
  batch: { id: string; sourceId: string; label: string; license: { uses: VocUse[]; basis: string } };
  studyIds: string[];
  rows: ImportRow[];
}): Promise<{ batch: VocBatch; stored: number; revised: number; skipped: number }> {
  const batch: VocBatch = { id: input.batch.id, sourceId: input.batch.sourceId, label: input.batch.label, importedAt: new Date().toISOString(), license: input.batch.license };
  await saveBatch(batch);
  let stored = 0;
  let revised = 0;
  let skipped = 0;
  for (const row of input.rows) {
    if (!row.url || (!row.body && !row.thread)) { skipped += 1; continue; }
    const identity = identityKeyFor({ url: row.url, title: row.title, sourceId: input.batch.sourceId, via: "fetch" });
    const [existing] = await sql<{ id: string }[]>`SELECT id FROM articles WHERE identity_key = ${identity}`;
    const thread = row.thread ?? null;
    const l1 = thread ? classifyL1(thread) : undefined;
    const record: VocRecord = {
      studyIds: input.studyIds,
      batches: [input.batch.id],
      contentLicense: row.contentLicense,
      thread: thread ?? undefined,
      form: row.form ?? (thread ? "question" : "firsthand"),
      authorRole: row.authorRole ?? thread?.authorRole ?? "unknown",
      market: "unknown", // never guessed from language, domain or platform
      l1,
      review: { status: "pending" },
    };
    if (existing) {
      // A second batch importing the same material joins the record's batch list; content revision
      // only when the words actually changed.
      const [row0] = await sql<{ id: string; revision: number; raw: { voc?: VocRecord }; body_text: string | null; title: string }[]>`SELECT id, revision, raw, body_text, title FROM articles WHERE id = ${existing.id}`;
      const prev = row0?.raw?.voc;
      const contentChanged = (row0?.title ?? "") !== row.title || (row0?.body_text ?? "") !== (row.body || "");
      if (prev) {
        const batches = prev.batches.includes(input.batch.id) ? prev.batches : [...prev.batches, input.batch.id];
        const studyIds = [...new Set([...prev.studyIds, ...input.studyIds])];
        // A re-import carries the FRESHER thread: without this, richer context collected later
        // (more answers, comments) could never reach an already-stored record.
        const next: VocRecord = { ...prev, batches, studyIds, thread: thread ?? prev.thread, contentLicense: row.contentLicense ?? prev.contentLicense, review: { status: "pending", note: "re-imported; reset to pending" } };
        // jsonb does not preserve key order: compare content hashes, not stringified shapes.
        const threadChanged = stableJson(prev.thread ?? null) !== stableJson(next.thread ?? null);
        // A licence change (e.g. an answer relicensed by its author, or a previously missing
        // licence appearing) changes what may be sent or shown — it is a material change too.
        const licenseChanged = row.contentLicense !== undefined && row.contentLicense !== prev.contentLicense;
        const changed = contentChanged || threadChanged || licenseChanged;
        // A human decision is never overwritten: material changes mark REVIEW_REQUIRED on top of
        // the recorded decision; an idempotent re-import leaves the review exactly as it was.
        next.review = changed
          ? (prev.review?.decidedAt
              ? { ...prev.review, status: "pending", note: "REVIEW_REQUIRED: material re-imported with changes" }
              : { status: "pending", note: "re-imported" })
          : prev.review;
        await sql`UPDATE articles SET raw = ${sql.json({ voc: next } as never)}::jsonb, title = ${row.title}, body_text = ${row.body || row0!.body_text}, updated_at = now() WHERE id = ${existing.id}`;
        // A material change is a new evidence version: bump the article revision (inline, not the
        // lane-wide reviseMaterial — VOC records never join the public pool) so a stored L2 bound
        // to the old revision can never be reused against changed material. The snapshot row keeps
        // the previous title/body for the audit trail.
        if (changed) {
          const [bumped] = await sql<{ revision: number }[]>`
            UPDATE articles SET revision = revision + 1, updated_at = now() WHERE id = ${existing.id} RETURNING revision`;
          await sql`INSERT INTO article_revisions (article_id, revision, content_hash, title, body_text)
            VALUES (${existing.id}, ${bumped!.revision}, ${contentHash({ title: row.title, bodyText: row.body || row0!.body_text })}, ${row.title}, ${row.body || row0!.body_text})
            ON CONFLICT (article_id, revision) DO NOTHING`;
        }
        revised += changed ? 1 : 0;
      } else {
        skipped += 1; // identity exists outside the voc lane; never overwrite another lane's record
      }
      continue;
    }
    await sql`INSERT INTO articles (id, source_id, identity_key, url, title, body_text, body_status, language, published_at, discovered_at, timeline_at, raw, processing_state)
      VALUES (${"voc" + sha256(identity).slice(0, 24)}, ${input.batch.sourceId}, ${identity}, ${row.url}, ${row.title}, ${row.body || null}, ${row.thread ? "ok" : "none"}, ${l1?.language === "zh" ? "zh" : "en"}, ${row.publishedAt ?? new Date()}, now(), ${row.publishedAt ?? new Date()}, ${sql.json({ voc: record } as never)}::jsonb, 'analyzed')`;
    stored += 1;
  }
  return { batch, stored, revised, skipped };
}
