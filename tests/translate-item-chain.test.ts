// The translation chain on an isolated database copy, with a local provider stub:
//   a new official record → discovered by the existing content.sweep → analysed and published by the
//   existing content job path → translated by the scheduled incremental entry (translateTextPending)
//   → returned by the public read layer → hidden again when the original is revised, then translated
//   for the new revision.
// The deployment's dedicated translation gate is on for this process (RADAR_TRANSLATE_ENABLED=true);
// every other paid purpose is still refused by rule mode, which the last test checks.
import { tag, stub } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { analyzeArticle } from "@aihot/backend/editorial/analyze";
import { publishArticle } from "@aihot/backend/publication/publish";
import { config } from "@aihot/backend/config";
import { ITEM_COLUMNS, ITEM_FROM, type ItemRow } from "@aihot/backend/publication/items";
import { toItemSummary } from "@aihot/backend/publication/items";
import { loadItemDetail } from "@aihot/backend/publication/detail";
import { chatJson } from "@aihot/backend/providers/llm";
import { z } from "zod";
import { preservedTokens, rejectionReason, translateItemText, translateTextPending, storeTitleTranslation } from "@aihot/backend/editorial/translate-text";
import { reserveTranslationCall, translationBudgetState } from "@aihot/backend/editorial/translate-budget";
import { BudgetExceededError } from "@aihot/backend/providers/receipts";

const T = tag();
const SOURCE = `translate-chain-${T}`;
const TITLE = `Costway Recalls Convertible High Chairs Due to Risk of Serious Injury (${T})`;
const EXCERPT = "The convertible high chairs violate the mandatory safety standard for high chairs. About 12,300 units were sold in the United States, and the recall notice states a refund of $85 to $120 is available to consumers.";

assert.ok(config.translateEnabled, "this test must run with RADAR_TRANSLATE_ENABLED=true");

/** A Chinese rendering long enough to pass the length guard, carrying every number the source had. */
function chineseOf(source: string): string {
  const base = "该文件说明相关商品必须符合要求，并列出适用范围、例外条件与可采取的处理方式，具体以官方原文为准。";
  const body = base.repeat(Math.ceil((source.length * 0.5) / base.length) + 1).slice(0, Math.max(8, Math.ceil(source.length * 0.5)));
  const tokens = preservedTokens(source);
  return tokens.length ? `${body}（原文数值：${tokens.join("、")}）` : body;
}

let provider: Awaited<ReturnType<typeof stub>>;
let articleId = "";

before(async () => {
  provider = await stub((_hit, req) => {
    const body = JSON.parse(req.body) as { messages: Array<{ content: string }> };
    const user = JSON.parse(body.messages.at(-1)!.content) as { kind: "title" | "excerpt"; text: string };
    const answer = chineseOf(user.text);
    return {
      id: "stub-answer",
      choices: [{ message: { content: JSON.stringify({ t: answer }) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 180, completion_tokens: 60, total_tokens: 240 },
    };
  });
  // Read at call time by providers/llm.ts, so pointing them here keeps every other test untouched.
  // Both routes are set: the deployment's default model (LLM_*) and the pack's deepseek preset, which
  // tests/setup.ts routes the translate step to.
  process.env.LLM_BASE_URL = `${provider.url}/v1`;
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_MODEL = "deepseek-flash";
  process.env.DEEPSEEK_BASE_URL = `${provider.url}/v1`;
  process.env.DEEPSEEK_API_KEY = "test-key";

  // The scheduled path only accepts the first lane's official sources; this test's source stands in for one.
  process.env.RADAR_TRANSLATE_SOURCES = SOURCE;
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,next_fetch_at)
            VALUES (${SOURCE},'Translate chain','rss','T1','editorial','2100-01-01')`;
  // The incremental path starts from the moment translation is switched on: existing rows are not back-filled.
  await translateTextPending();
});

after(async () => { await provider.close(); await closeDb(); });

const readItem = async (id: string) => (await sql<ItemRow[]>`SELECT ${ITEM_COLUMNS} ${ITEM_FROM} WHERE p.article_id = ${id}`)[0]!;

test("a new official record is discovered, published, translated and served in Chinese", async () => {
  const { articleId: id } = await upsertMaterial({
    sourceId: SOURCE, url: `https://example.org/translate-chain/${T}`, title: TITLE, language: "en",
    bodyText: `${EXCERPT}\n\nAmazon said the policy is applied from 2026-01-15.`,
    bodyHtml: `<p>${EXCERPT}</p><p>Amazon said the policy is applied from 2026-01-15.</p>`,
    excerpt: EXCERPT, bodyStatus: "ok", via: "fetch", publishedAt: new Date(),
  });
  articleId = id;
  await sql`UPDATE articles SET processing_state='new', processing_queued_at=NULL, processing_retry_at=NULL,
            created_at = now() - interval '5 minutes' WHERE id = ${id}`;

  // 1. The work the analysis job performs on a newly found record: rule analysis → publication.
  //    (Discovery and queueing themselves are the unchanged path covered by radar-explain-chain.test.ts.)
  const analysis = await analyzeArticle(id);
  assert.ok(analysis, "the rule analysis ran");
  await publishArticle(id);
  const [published] = await sql<{ body_mode: string; visibility: string }[]>`
    SELECT body_mode, visibility FROM publications WHERE article_id = ${id}`;
  assert.equal(published?.visibility, "public");
  assert.equal(published?.body_mode, "summary", "the site still shows no body for this source");

  // 2. Translation by the scheduled incremental entry, one run at a time.
  const run = await translateTextPending();
  const done = run.done.find((d) => d.articleId === id);
  assert.ok(done, `the incremental run picked the item up (${run.reason ?? "no reason"})`);
  assert.equal(done!.status, "translated");
  assert.deepEqual(done!.parts.sort(), ["excerpt", "title"]);

  // 3. Stored, bound to the revision it was made from, and separated by kind.
  const rows = await sql<{ lang: string; revision: number; title: string | null; body_text: string | null; complete: boolean; origin: string }[]>`
    SELECT lang, revision, title, body_text, complete, origin FROM translations WHERE article_id = ${id} ORDER BY lang`;
  assert.equal(rows.length, 2, "a title row and a source-summary row");
  const titleRow = rows.find((r) => r.lang === "zh")!;
  const excerptRow = rows.find((r) => r.lang === "zh-excerpt")!;
  assert.match(titleRow.title!, /\p{Script=Han}/u);
  assert.equal(titleRow.revision, 1);
  assert.equal(titleRow.complete, false, "a title-only row never claims the body is translated");
  assert.match(excerptRow.body_text!, /\p{Script=Han}/u);
  assert.equal(excerptRow.complete, true);

  // 5. The public read layer serves it, with the source's own words kept beside it.
  const item = toItemSummary(await readItem(id));
  assert.equal(item.title, titleRow.title);
  assert.equal(item.originalTitle, TITLE);
  assert.equal(item.summary, excerptRow.body_text);
  assert.equal(item.originalSummary, EXCERPT);
  assert.equal(item.identity!.titleKind, "machine-zh");
  assert.equal(item.identity!.summaryKind, "machine-zh");
  assert.equal(item.identity!.translation, "partial", "body translation is not claimed");

  const detail = await loadItemDetail(id);
  assert.equal(detail.kind, "found");
  if (detail.kind !== "found") return;
  assert.equal(detail.item.title, titleRow.title);
  assert.equal(detail.item.body, null, "the site still shows no body for this source");
  assert.equal(detail.item.hasTranslation, false);

  // 6. Only two paid requests were made, both recorded with their usage.
  const receipts = await sql<{ purpose: string; status: string; usage: Record<string, unknown> | null }[]>`
    SELECT purpose, status, usage FROM receipts WHERE subject LIKE ${`article:${id}%`} ORDER BY id`;
  assert.equal(receipts.length, 2);
  assert.deepEqual(receipts.map((r) => r.purpose).sort(), ["translate_excerpt", "translate_title"]);
  assert.ok(receipts.every((r) => r.status === "completed"));
  const budget = await translationBudgetState();
  assert.equal(budget.requests, 2);
  assert.equal(budget.promptTokens, 360);
  assert.equal(budget.completionTokens, 120);
  assert.ok(budget.spentCny > 0, "spend is recorded from the provider's usage");
});

test("a revised original hides the old translation and the new revision is translated again", async () => {
  await sql`UPDATE articles SET revision = revision + 1 WHERE id = ${articleId}`;
  const stale = toItemSummary(await readItem(articleId));
  assert.equal(stale.title, TITLE, "the source title is shown again");
  assert.equal(stale.identity!.titleKind, "original");
  assert.equal(stale.identity!.translation, "stale", "the stored translation is reported as an older version");

  const again = await translateItemText(articleId);
  assert.equal(again.revision, 2);
  assert.equal(again.status, "translated");
  const updated = await sql<{ revision: number; title: string }[]>`
    SELECT revision, title FROM translations WHERE article_id = ${articleId} AND lang = 'zh'`;
  assert.equal(updated[0]!.revision, 2);
  const current = toItemSummary(await readItem(articleId));
  assert.equal(current.title, updated[0]!.title);
  assert.equal(current.identity!.titleKind, "machine-zh");
});

test("an older revision answer never overwrites a newer translation", async () => {
  const [before] = await sql<{ title: string }[]>`SELECT title FROM translations WHERE article_id = ${articleId} AND lang = 'zh'`;
  const changed = await storeTitleTranslation(articleId, 1, "旧版本标题（不应覆盖）", (await sql<{ id: number }[]>`SELECT id FROM receipts ORDER BY id DESC LIMIT 1`)[0]!.id);
  assert.equal(changed, false, "the row of revision 2 is kept");
  const [after] = await sql<{ title: string }[]>`SELECT title FROM translations WHERE article_id = ${articleId} AND lang = 'zh'`;
  assert.equal(after!.title, before!.title);
});

test("a translation that lost the source's numbers is rejected before storage", () => {
  assert.match(rejectionReason("Recall of 12,300 units, refund $85", "该产品被召回。", "excerpt")!, /numbers or identifiers lost/);
  assert.equal(rejectionReason("Recall of 12,300 units", chineseOf("Recall of 12,300 units"), "excerpt"), null);
  assert.equal(rejectionReason("Costway recalls high chairs", "Costway 召回高脚椅", "title"), null);
});

test("the money and request caps refuse a call before it is sent", async () => {
  const before = await translationBudgetState();
  await assert.rejects(
    () => sql.begin((tx) => reserveTranslationCall(tx, { articleId: "over-budget", inputChars: 10_000, maxTokens: 900_000 })),
    (error: unknown) => error instanceof BudgetExceededError,
  );
  const after = await translationBudgetState();
  assert.equal(after.requests, before.requests, "a refused reservation books nothing");
});

test("every other paid purpose is still refused by rule mode", async () => {
  const before = provider.hits();
  await assert.rejects(
    () => chatJson({
      model: "default", purpose: "score_article", subject: `article:${articleId}@1`,
      promptVersion: "test", system: "", user: "{}", schema: z.object({ ok: z.boolean() }),
    }),
    /Paid provider requests are disabled in LightChoice Radar mode/,
  );
  assert.equal(provider.hits(), before, "no request reached the provider for the refused purpose");
  assert.equal(before, 2, "the two translation requests of the first revision are the only paid calls");
});
