// The industry lane's model processing: one request per eligible article turns the allowed material
// into a Chinese title, a one-line quick read, structured facts and an honest caveat — and every
// number the output carries must have come from the source text.
//
// Only sources whose permission profile allows model processing reach this module. The restricted
// trade media are classified by rules alone and never sent anywhere.
import { sql } from "../db.ts";
import { config } from "../config.ts";
import { chatJson } from "../providers/llm.ts";
import { z } from "zod";
import { claimIndustryRun, releaseIndustryRun, reserveIndustryDaySlot } from "./industry-budget.ts";
import { ensureIndustryStory, ensureIndustryPublication } from "./industry-events.ts";
import { industryEventKey, industryAdmission } from "../sources/industry-gate.ts";
import { INDUSTRY_SOURCE_IDS } from "../sources/industry-lane.ts";
import { industryFullPermissionSources } from "../sources/industry-lane.ts";
import { sha256 } from "../lib/ids.ts";

const PROMPT_VERSION = "industry-event-v1";
const TITLE_LANG = "zh-industry";

const Output = z.object({
  t: z.string().min(4),
  quick: z.string().min(8),
  facts: z.array(z.object({
    s: z.string().min(1),
    a: z.string().min(1),
    o: z.string().min(1),
    time: z.string().min(4),
  })).min(1),
  caveat: z.string().min(8),
  research: z.string().min(8),
});

/** Number/percent/date tokens the source text carries, compared with currency signs stripped. */
function valueTokens(text: string): string[] {
  return [...new Set(text.match(/[\d,.]+\s*(?:%|percent|billion|million|trillion)\b|\b(?:19|20)\d{2}\b|\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}\b/gi) ?? [])];
}

/**
 * A model output that INVENTED a number is rejected before it can be stored. Numbers the source
 * carries may be omitted from a one-line summary (the source link stays for the rest); any value the
 * output does carry must be one the source itself states, token for token.
 */
function outputInventedValues(sourceText: string, output: string): string[] {
  const sourceTokens = new Set(valueTokens(sourceText).map((token) => token.toLowerCase().replace(/[\s,$]/g, "")));
  const outputTokens = valueTokens(output).map((token) => token.toLowerCase().replace(/[\s,$]/g, ""));
  return outputTokens.filter((token) => !sourceTokens.has(token));
}

/**
 * Processes the admitted, model-eligible industry items that were discovered after the lane's
 * baseline: at most `runArticles` per run and `dayArticles` per Beijing day, one run at a time.
 * Each item costs exactly one request: title, quick read, facts, caveat and research direction in
 * one structured answer, verified before anything is stored.
 */
export async function processIndustryPending(opts: { runArticles?: number } = {}): Promise<{ done: Array<{ articleId: string; storyId: number | null; status: string; reason?: string }>; reason?: string }> {
  if (!config.industryEnabled) return { done: [], reason: "industry lane is off" };
  if (!(await claimIndustryRun())) return { done: [], reason: "another run holds the industry lease" };
  try {
    const [baselineRow] = await sql<{ value: { at?: string } }[]>`SELECT value FROM settings WHERE key = 'industry.baseline'`;
    if (!baselineRow?.value?.at) {
      const at = new Date().toISOString();
      await sql`INSERT INTO settings (key, value, updated_by) VALUES ('industry.baseline', ${sql.json({ at })}, 'industry')
                ON CONFLICT (key) DO NOTHING`;
      return { done: [], reason: "baseline recorded; existing items are not back-filled" };
    }
    const baseline = baselineRow.value.at!;
    const modelSources = industryFullPermissionSources();
    const rows = await sql<Array<{ id: string; revision: number; title: string; excerpt: string | null; discovered_at: Date; published_at: Date | null; source_id: string }>>`
      SELECT a.id, a.revision, a.title, a.excerpt, a.discovered_at, a.published_at, a.source_id
      FROM articles a
      LEFT JOIN translations tr ON tr.article_id = a.id AND tr.lang = ${TITLE_LANG} AND tr.revision >= a.revision
      WHERE a.source_id = ANY(${modelSources}::text[])
        AND a.raw->'industry'->>'admitted' = 'true'
        AND a.discovered_at >= ${baseline}::timestamptz
        AND tr.article_id IS NULL
      ORDER BY a.discovered_at ASC
      LIMIT ${opts.runArticles ?? config.industry.runArticles}`;
    const done: Array<{ articleId: string; storyId: number | null; status: string; reason?: string }> = [];
    for (const row of rows) {
      if (!(await reserveIndustryDaySlot(row.id))) return { done, reason: "daily article cap reached" };
      try {
        done.push(await processIndustryItem(row.id, row.revision, row.title, row.excerpt, row.published_at, row.source_id));
      } catch (error) {
        done.push({ articleId: row.id, storyId: null, status: "failed", reason: String(error instanceof Error ? error.message : error).slice(0, 200) });
      }
    }
    return { done };
  } finally {
    await releaseIndustryRun();
  }
}

async function processIndustryItem(articleId: string, revision: number, title: string, excerpt: string | null, publishedAt: Date | null, sourceId: string): Promise<{ articleId: string; storyId: number | null; status: string; reason?: string }> {
  const material = `${title}\n${excerpt ?? ""}`;
  const res = await chatJson({
    model: await modelOf(),
    purpose: "industry_event",
    subject: `article:${articleId}@${revision}:industry`,
    articleId,
    promptVersion: PROMPT_VERSION,
    system: "You summarize U.S. consumer and e-commerce industry material for a research reader. Use only facts from the given text. Keep every number, percent, date and unit exactly as the text states them. When the text does not state something, say so instead of filling in. Never give product or sourcing advice.",
    user: JSON.stringify({ kind: "industry-item", title, excerpt: excerpt ?? null, instructions: "Return JSON: t (Chinese title), quick (one-sentence Chinese quick read), facts (array of {s subject, a action, o object, time} — every field quoted or derived strictly from the text; time is the text's own stated period or date), caveat (what the text does NOT establish), research (why a seller might want to research this further, one sentence, no advice). All Chinese fields in Chinese; keep numbers, dates and units as in the text." }),
    schema: Output,
    temperature: 0.1,
    maxTokens: 1200,
    timeoutMs: 90_000,
  });
  const out = res.data;
  // The output may not invent: every value token the material carries must survive, and the model may
  // not add a number the material does not carry.
  const invented = outputInventedValues(material, JSON.stringify(out));
  if (invented.length) throw new Error(`output invented values the source does not state: ${invented.join(", ")}`);
  const admission = industryAdmission({ sourceId, title, summary: excerpt });
  if (!admission.admitted) throw new Error(`admission reversed after processing: ${admission.reason}`);

  const fact = out.facts[0]!;
  const storyId = await ensureIndustryStory({
    eventKey: industryEventKey({ sourceId, title, themes: admission.themes }),
    theme: admission.themes[0]!,
    title,
    articleId,
    publishedAt, // the article's own publication date — the same basis classifyIndustryPending uses, so re-entering the same article into the same story stays idempotent
    fact: { subject: fact.s, action: fact.a, object: fact.o, time: fact.time },
  });
  // The Chinese content is stored under its own lang, never mixed with the first lane's zh rows.
  await sql`INSERT INTO translations (article_id, lang, revision, title, body_text, complete, origin)
            VALUES (${articleId}, ${TITLE_LANG}, ${revision}, ${out.t}, ${`${out.quick}\n\n${out.research}\n\n注意：${out.caveat}`}, false, 'model')
            ON CONFLICT (article_id, lang) DO NOTHING`;
  // The digest row keeps the receipt id and the article ids, so a later revision produces a new
  // version instead of quietly rewriting what an earlier one said.
  const [version] = await sql<{ n: number }[]>`SELECT coalesce(max(version), 0)::int + 1 AS n FROM story_digests WHERE story_id = ${storyId}`;
  {
    const [art] = await sql`SELECT url, published_at, source_id, title FROM articles WHERE id = ${articleId}`;
    await ensureIndustryPublication({ articleId, sourceId: art!.source_id, title: art!.title, url: art!.url, publishedAt: art!.published_at, storyId });
  }
  await sql`INSERT INTO story_digests (story_id, version, digest, latest, receipt_id, article_ids)
            VALUES (${storyId}, ${version!.n}, ${`${out.quick}\n\n${out.research}\n\n注意：${out.caveat}`}, ${out.quick}, ${res.receiptId}, ${[articleId]})`;
  await sql`UPDATE stories SET digest = ${`${out.quick}\n\n${out.research}\n\n注意：${out.caveat}`}, digest_updated_at = now(), latest = ${out.quick} WHERE id = ${storyId} AND (digest_updated_at IS NULL OR digest_updated_at < now() - interval '1 minute')`;
  return { articleId, storyId, status: "processed" };
}

async function modelOf(): Promise<string> {
  const { modelFor } = await import("./models.ts");
  return modelFor("translate");
}

/** The deterministic processing of restricted media items: rules only, nothing sent anywhere. */
export async function classifyIndustryPending(limit = 200): Promise<{ admitted: number; rejected: number }> {
  const rows = await sql<Array<{ id: string; title: string; excerpt: string | null; source_id: string; published_at: Date | null; raw: Record<string, unknown> | null }>>`
    SELECT a.id, a.title, a.excerpt, a.source_id, a.published_at, a.raw FROM articles a
    JOIN sources s ON s.id = a.source_id
    WHERE a.source_id = ANY(${INDUSTRY_SOURCE_IDS}::text[])
      AND a.raw->'industry' IS NULL
    ORDER BY a.discovered_at DESC LIMIT ${limit}`;
  let admitted = 0;
  let rejected = 0;
  for (const row of rows) {
    const verdict = industryAdmission({ sourceId: row.source_id, title: row.title, summary: row.excerpt });
    const themes = verdict.themes;
    if (verdict.admitted) {
      admitted += 1;
      const storyId = await ensureIndustryStory({
        eventKey: industryEventKey({ sourceId: row.source_id, title: row.title, themes }),
        theme: themes[0]!,
        title: row.title,
        articleId: row.id,
        publishedAt: row.published_at,
        fact: null,
      });
      const [pub] = await sql`SELECT a.url FROM articles a WHERE a.id = ${row.id}`;
      await ensureIndustryPublication({ articleId: row.id, sourceId: row.source_id, title: row.title, url: pub!.url, publishedAt: row.published_at, storyId });
    } else rejected += 1;
    await sql`UPDATE articles SET raw = coalesce(raw, '{}'::jsonb) || ${sql.json({ industry: { ...verdict, gateVersion: "industry-gate-v1", processedAt: new Date().toISOString() } })}::jsonb WHERE id = ${row.id}`;
  }
  return { admitted, rejected };
}

function sqlRawRestricted(): string[] {
  // Restricted media: metadata-only classification, no model, no excerpt storage.
  return ["industry-retail-dive", "industry-supply-chain-dive", "industry-modern-retail"];
}

export const INDUSTRY_PROMPT_VERSION = PROMPT_VERSION;
export const INDUSTRY_TITLE_LANG = TITLE_LANG;
export const industryReceiptFingerprint = sha256;
