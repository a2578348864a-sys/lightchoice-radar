// Chinese title and source-summary translations: the parts a reader sees in a list, and the only
// machine translation this deployment is allowed to buy. The body translator (translate.ts) stays the
// only path for full bodies and is untouched here; it needs a source whose full text may be shown.
//
// Two rules decide what may be sent: the purpose has to be a translation purpose and the dedicated
// switch has to be on (config.translationPurposeAllowed), and the item has to be an official
// first-party policy or regulator record. Nothing is invented: a title whose numbers, dates or
// document numbers did not survive the round trip is not stored at all, and a summary is only
// translated when the source itself supplied one. Every write is bound to the article revision it was
// made from, so a revised original hides the older translation instead of showing it as current.
import { z } from "zod";
import { sql } from "../db.ts";
import { config } from "../config.ts";
import { isChineseText } from "../lib/text.ts";
import { chatJson } from "../providers/llm.ts";
import { completeReceipt, failureKind } from "../providers/receipts.ts";
import { modelFor } from "./models.ts";
import { promptText, promptVersion } from "./prompts.ts";
import { claimTranslationRun, releaseTranslationRun, reserveDaySlot } from "./translate-budget.ts";

export const ITEM_TRANSLATE_PROMPT_VERSION = promptVersion("translate-item");

const SYSTEM = promptText("translate-item");
/** Longer inputs are not sent: a title is a sentence, a source summary is a paragraph. */
const MAX_TITLE_CHARS = 400;
const MAX_EXCERPT_CHARS = 2000;

const Output = z.object({ t: z.string().min(1) });

/** The stored translations use one row per language key: `zh` for the title, `zh-excerpt` for the summary. */
const TITLE_LANG = "zh";
const EXCERPT_LANG = "zh-excerpt";

/**
 * The first lane's official/regulatory sources: the only ones the scheduled path may translate. Read at
 * call time so a test (or an operator) can narrow it, and so a new lane cannot be pulled in by accident.
 */
const DEFAULT_TRANSLATABLE_SOURCES = [
  "amazon-us-announcements", "amazon-us-fee-updates", "rss-cpsc-recalls", "us-federal-register-cpsc", "us-federal-register-ftc",
];
function translatableSources(): string[] {
  const configured = (process.env.RADAR_TRANSLATE_SOURCES ?? "").split(",").map((v) => v.trim()).filter(Boolean);
  return configured.length ? configured : DEFAULT_TRANSLATABLE_SOURCES;
}

export type TextPart = "title" | "excerpt";

export interface TextTranslationResult {
  articleId: string;
  revision: number | null;
  status: "translated" | "partial" | "skipped" | "failed";
  parts: TextPart[];
  reason?: string;
}

interface ItemRow {
  title: string;
  summary: string | null;
  excerpt: string | null;
  language: string | null;
  revision: number;
  visibility: string;
  tier: string;
  participation_mode: string;
  has_title_zh: boolean;
  has_excerpt_zh: boolean;
}

/**
 * Numbers, money, percentages and document identifiers the translation must keep verbatim. Semantic
 * checks (negation, exceptions, agency names) are not automated — the page says the text is a machine
 * translation that nobody has proofread, instead of claiming it was checked.
 */
export function preservedTokens(source: string): string[] {
  const patterns = [
    /\d+(?:[.,]\d+)*\s?%/g,                       // percentages
    /[$€£¥]\s?\d[\d.,]*/g,                        // money
    /\b\d{4}-\d{1,2}-\d{1,2}\b/g,                 // ISO dates
    /\b\d+\s*(?:CFR|U\.S\.C\.)\s*[\d.()a-z-]+/gi, // regulation citations
    /\b[A-Z]{1,3}\d{2,}[A-Z0-9-]*\b/g,            // model numbers, ASINs, form ids
    /\b\d+(?:[.,]\d+)*\b/g,                       // every other number
  ];
  const seen = new Set<string>();
  for (const re of patterns) for (const m of source.match(re) ?? []) {
    const token = m.replace(/\s+/g, " ").trim();
    if (token) seen.add(token);
  }
  return [...seen];
}

/** Why an answer cannot be stored, or null when it may be. */
export function rejectionReason(source: string, target: string, kind: TextPart): string | null {
  const text = target.trim();
  if (!text) return "empty translation";
  if (!/\p{Script=Han}/u.test(text)) return "translation is not Chinese";
  const missing = preservedTokens(source).filter((token) => !text.includes(token));
  if (missing.length) return `numbers or identifiers lost: ${missing.slice(0, 5).join(", ")}`;
  // A Chinese rendering of an English sentence is normally shorter; a much shorter one lost text, a
  // much longer one added some.
  const ratio = text.length / Math.max(1, source.length);
  if (ratio < 0.15 || ratio > 2.5) return `length out of range (${ratio.toFixed(2)})`;
  if (kind === "title" && text.length > 300) return "title translation too long";
  return null;
}

async function loadItem(articleId: string): Promise<ItemRow | null> {
  const [row] = await sql<ItemRow[]>`
    SELECT p.title, p.summary, a.excerpt, a.language, a.revision, p.visibility, s.tier, s.participation_mode,
      EXISTS (SELECT 1 FROM translations t WHERE t.article_id = p.article_id AND t.lang = ${TITLE_LANG}
              AND t.revision >= a.revision AND coalesce(t.title, '') <> '') AS has_title_zh,
      EXISTS (SELECT 1 FROM translations t WHERE t.article_id = p.article_id AND t.lang = ${EXCERPT_LANG}
              AND t.revision >= a.revision AND coalesce(t.body_text, '') <> '') AS has_excerpt_zh
    FROM publications p JOIN articles a ON a.id = p.article_id JOIN sources s ON s.id = p.source_id
    WHERE p.article_id = ${articleId} AND s.enabled`;
  return row ?? null;
}

/** Official first-party policy and regulator records only; community posts and third-party leads never pass. */
export function isTranslatableSource(row: Pick<ItemRow, "tier" | "participation_mode">): boolean {
  return row.tier === "T1" && row.participation_mode === "editorial";
}

async function translatePart(articleId: string, revision: number, kind: TextPart, source: string): Promise<{ text: string; receiptId: number }> {
  const model = await modelFor("translate");
  const res = await chatJson({
    model,
    purpose: kind === "title" ? "translate_title" : "translate_excerpt",
    subject: `article:${articleId}@${revision}:${kind}`,
    articleId,
    promptVersion: ITEM_TRANSLATE_PROMPT_VERSION,
    system: SYSTEM,
    user: JSON.stringify({ kind, text: source }),
    schema: Output,
    temperature: 0.1,
    maxTokens: kind === "title" ? 500 : 1200,
    timeoutMs: 90_000,
  });
  const text = res.data.t.trim();
  const reason = rejectionReason(source, text, kind);
  if (reason) throw new Error(`translation rejected: ${reason}`);
  return { text, receiptId: res.receiptId };
}

/**
 * Stores a title translation. A row of a later revision is never replaced by an older one, and only
 * the title is written here — a body translation (translate.ts) keeps its body and completeness.
 */
export async function storeTitleTranslation(articleId: string, revision: number, title: string, receiptId: number): Promise<boolean> {
  return sql.begin(async (tx) => {
    const changed = await tx`
      INSERT INTO translations (article_id, lang, revision, title, complete, origin)
      VALUES (${articleId}, ${TITLE_LANG}, ${revision}, ${title}, false, 'model')
      ON CONFLICT (article_id, lang) DO UPDATE SET revision = EXCLUDED.revision, title = EXCLUDED.title, created_at = now()
      WHERE translations.origin <> 'source' AND translations.revision <= EXCLUDED.revision
        -- An unchanged title still moves to the newer revision: a row left on the old one would be
        -- hidden as stale even though the text is right.
        AND (translations.revision < EXCLUDED.revision OR translations.title IS DISTINCT FROM EXCLUDED.title)
      RETURNING article_id`;
    await completeReceipt(tx, receiptId);
    return changed.length > 0;
  });
}

/** Stores a source-summary translation, keyed and versioned separately from the title and the body. */
export async function storeExcerptTranslation(articleId: string, revision: number, text: string, receiptId: number): Promise<boolean> {
  return sql.begin(async (tx) => {
    const changed = await tx`
      INSERT INTO translations (article_id, lang, revision, body_text, complete, origin)
      VALUES (${articleId}, ${EXCERPT_LANG}, ${revision}, ${text}, true, 'model')
      ON CONFLICT (article_id, lang) DO UPDATE SET revision = EXCLUDED.revision, body_text = EXCLUDED.body_text, complete = true, origin = 'model', created_at = now()
      WHERE translations.origin <> 'source' AND translations.revision <= EXCLUDED.revision
        AND (translations.revision < EXCLUDED.revision OR translations.body_text IS DISTINCT FROM EXCLUDED.body_text)
      RETURNING article_id`;
    await completeReceipt(tx, receiptId);
    return changed.length > 0;
  });
}

/** Records the outcome where translation attempts are already recorded (translate_attempts, 3 tries). */
async function recordAttempt(articleId: string, revision: number | null, outcome: "translated" | "partial" | "skipped" | "failed", reason: string | null) {
  await sql`
    INSERT INTO translation_attempts (article_id, revision, attempts, outcome, reason)
    SELECT ${articleId}, coalesce(${revision}::int, a.revision), 1, ${outcome}, ${reason} FROM articles a WHERE a.id = ${articleId}
    ON CONFLICT (article_id) DO UPDATE SET
      attempts = CASE WHEN translation_attempts.revision = EXCLUDED.revision THEN translation_attempts.attempts + 1 ELSE 1 END,
      revision = EXCLUDED.revision, outcome = EXCLUDED.outcome, reason = EXCLUDED.reason, updated_at = now()`;
}

/**
 * Translates the title, and the source summary when the source supplied one, of one official item.
 * Skips what is already current, what is Chinese, and what is not an official policy record.
 */
export async function translateItemText(articleId: string, opts: { parts?: TextPart[] } = {}): Promise<TextTranslationResult> {
  const row = await loadItem(articleId);
  if (!row) return { articleId, revision: null, status: "skipped", parts: [], reason: "not published" };
  const result = (status: TextTranslationResult["status"], parts: TextPart[], reason?: string): TextTranslationResult =>
    ({ articleId, revision: row.revision, status, parts, ...(reason ? { reason } : {}) });
  if (row.visibility !== "public") return result("skipped", [], "not public");
  if (!isTranslatableSource(row)) return result("skipped", [], "not an official policy source");
  if (!config.translateEnabled) return result("skipped", [], "translation is off (RADAR_TRANSLATE_ENABLED=false)");

  const parts = opts.parts ?? ["title", "excerpt"];
  const done: TextPart[] = [];
  const failures: string[] = [];
  let title = row.title?.trim() ?? "";

  if (parts.includes("title") && !row.has_title_zh && title && !isChineseText(title, row.language)) {
    if (title.length > MAX_TITLE_CHARS) failures.push("title too long");
    else {
      try {
        const answer = await translatePart(articleId, row.revision, "title", title);
        await storeTitleTranslation(articleId, row.revision, answer.text, answer.receiptId);
        done.push("title");
        title = answer.text;
      } catch (error) {
        if (isRunEnding(error)) throw error;
        failures.push(`title: ${message(error)}`);
      }
    }
  }

  if (parts.includes("excerpt") && !row.has_excerpt_zh) {
    const summary = row.summary?.trim() ?? "";
    // Only a summary the source itself supplied is translated; text organised here is never re-translated.
    if (!summary) failures.push("excerpt: no source summary");
    else if (summary === row.title.trim()) failures.push("excerpt: same as title");
    else if (isChineseText(summary, row.language)) failures.push("excerpt: already Chinese");
    else if (summary.length > MAX_EXCERPT_CHARS) failures.push("excerpt: too long");
    else {
      try {
        const answer = await translatePart(articleId, row.revision, "excerpt", summary);
        await storeExcerptTranslation(articleId, row.revision, answer.text, answer.receiptId);
        done.push("excerpt");
      } catch (error) {
        if (isRunEnding(error)) throw error;
        failures.push(`excerpt: ${message(error)}`);
      }
    }
  }

  const status: TextTranslationResult["status"] = done.length === 0
    ? (failures.length ? "failed" : "skipped")
    : failures.length ? "partial" : "translated";
  const reason = failures.length ? failures.join("; ").slice(0, 300) : undefined;
  await recordAttempt(articleId, row.revision, status === "translated" ? "translated" : status === "partial" ? "partial" : status, reason ?? null);
  return result(status, done, reason);
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 160);

/** Switched off, out of budget, provider down, or a request in flight: the run stops instead of trying the next item. */
function isRunEnding(error: unknown): boolean {
  return ["off", "budget", "busy", "outage"].includes(failureKind(error));
}

/**
 * The scheduled incremental path: official items discovered after the moment translation was switched
 * on, at most `runArticles` per run and `dayArticles` per Beijing day, one run at a time. A backlog is
 * never scanned — an item that existed before the baseline stays untranslated unless it is revised.
 */
export async function translateTextPending(opts: { runArticles?: number } = {}): Promise<{ done: TextTranslationResult[]; reason?: string }> {
  if (!config.translateEnabled) return { done: [], reason: "translation is off" };
  if (!(await claimTranslationRun())) return { done: [], reason: "another run holds the lease" };
  try {
    const [baseline] = await sql<{ value: { at?: string } }[]>`SELECT value FROM settings WHERE key = 'translate.baseline'`;
    if (!baseline?.value?.at) {
      await sql`INSERT INTO settings (key, value, updated_by) VALUES ('translate.baseline', ${sql.json({ at: new Date().toISOString() })}, 'translate')
                ON CONFLICT (key) DO NOTHING`;
      return { done: [], reason: "baseline recorded; existing items are not back-filled" };
    }
    const rows = await sql<{ article_id: string }[]>`
      SELECT p.article_id FROM publications p
      JOIN articles a ON a.id = p.article_id
      JOIN sources s ON s.id = p.source_id
      LEFT JOIN translations tr ON tr.article_id = p.article_id AND tr.lang = ${TITLE_LANG} AND tr.revision >= a.revision
      WHERE s.tier = 'T1' AND s.participation_mode = 'editorial' AND s.enabled
        AND s.id = ANY(${translatableSources()}::text[])
        AND p.visibility = 'public'
        AND p.discovered_at >= ${baseline.value.at}::timestamptz
        AND tr.article_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM translation_attempts t WHERE t.article_id = p.article_id AND t.revision = a.revision
                        AND (t.outcome IN ('translated', 'partial') OR t.attempts >= 3))
      ORDER BY p.discovered_at ASC
      LIMIT ${opts.runArticles ?? config.translate.runArticles}`;
    const done: TextTranslationResult[] = [];
    for (const r of rows) {
      if (!(await reserveDaySlot(r.article_id))) return { done, reason: "daily article cap reached" };
      try {
        done.push(await translateItemText(r.article_id));
      } catch (error) {
        if (isRunEnding(error)) return { done, reason: message(error) };
        done.push({ articleId: r.article_id, revision: null, status: "failed", parts: [], reason: message(error) });
      }
    }
    return { done };
  } finally {
    await releaseTranslationRun();
  }
}
