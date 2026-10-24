// The existing full-body translator, verified in isolation and with a local provider stub.
//
// Why isolated: all six first-lane sources keep site_fulltext=false, so no production page may show a
// body or its translation. Opening that setting on the development database to "prove" body translation
// would change what readers see. This test runs on its own database copy, turns the setting on there
// only, and then checks that the display boundary is still the source setting — turning it back off
// hides the body again while the stored translation stays version-bound.
import { tag, stub } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { analyzeArticle } from "@aihot/backend/editorial/analyze";
import { publishArticle } from "@aihot/backend/publication/publish";
import { translateArticle } from "@aihot/backend/editorial/translate";
import { loadItemDetail } from "@aihot/backend/publication/detail";
import { preservedTokens } from "@aihot/backend/editorial/translate-text";

const T = tag();
const SOURCE = `body-translate-${T}`;
const PARAGRAPHS = [
  "Amazon requires sellers to keep a valid tracking rate above 95% for seller-fulfilled orders.",
  "The rule applies from 2026-03-01 and does not apply to orders shipped through FBA.",
];

let provider: Awaited<ReturnType<typeof stub>>;
let articleId = "";

before(async () => {
  provider = await stub((_hit, req) => {
    const body = JSON.parse(req.body) as { messages: Array<{ content: string }> };
    const user = JSON.parse(body.messages.at(-1)!.content) as { segments: string[] };
    const translated = user.segments.map((segment) => {
      const tokens = preservedTokens(segment);
      const text = `该条要求卖家维持有效追踪率（原文数值：${tokens.join("、") || "无"}）。`;
      return text;
    });
    return {
      id: "stub-body",
      choices: [{ message: { content: JSON.stringify({ t: translated }) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380 },
    };
  });
  process.env.LLM_BASE_URL = `${provider.url}/v1`;
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_MODEL = "deepseek-flash";
  process.env.DEEPSEEK_BASE_URL = `${provider.url}/v1`;
  process.env.DEEPSEEK_API_KEY = "test-key";
  // The copy's own source allows full text; the development database is untouched.
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,site_fulltext,next_fetch_at)
            VALUES (${SOURCE},'Body translate','rss','T1','editorial',true,'2100-01-01')`;
});

after(async () => { await provider.close(); await closeDb(); });

test("a source that may show full text gets a complete, version-bound body translation", async () => {
  const { articleId: id } = await upsertMaterial({
    sourceId: SOURCE, url: `https://example.org/body/${T}`, title: `Tracking rate rule ${T}`, language: "en",
    bodyText: PARAGRAPHS.join("\n\n"), bodyHtml: PARAGRAPHS.map((p) => `<p>${p}</p>`).join(""),
    bodyStatus: "ok", via: "fetch", publishedAt: new Date(),
  });
  articleId = id;
  await analyzeArticle(id);
  await publishArticle(id);
  await sql`UPDATE publications SET selected = true WHERE article_id = ${id}`;

  const [pub] = await sql<{ body_mode: string; visibility: string }[]>`SELECT body_mode, visibility FROM publications WHERE article_id = ${id}`;
  assert.equal(pub!.body_mode, "full");
  assert.equal(pub!.visibility, "public");

  const result = await translateArticle(id);
  assert.equal(result.status, "translated", `body translation ran (${result.reason ?? ""})`);

  const [row] = await sql<{ revision: number; complete: boolean; body_text: string; body_html: string }[]>`
    SELECT revision, complete, body_text, body_html FROM translations WHERE article_id = ${id} AND lang = 'zh'`;
  assert.ok(row, "a translation row exists");
  assert.equal(row!.complete, true);
  assert.equal(row!.revision, 1);
  assert.match(row!.body_text, /有效追踪率/);
  assert.ok(row!.body_text.includes("95%"), "the percentage survived");
  assert.ok(row!.body_text.includes("2026-03-01"), "the date survived");

  const shown = await loadItemDetail(id);
  assert.equal(shown.kind, "found");
  if (shown.kind !== "found") return;
  assert.equal(shown.item.bodyLanguage, "zh", "the page reads the Chinese body while the source allows it");
  assert.equal(shown.item.hasTranslation, true);
  assert.match(shown.item.body!.zh!, /有效追踪率/);

  // The display boundary is the source setting, not the stored translation.
  await sql`UPDATE sources SET site_fulltext = false WHERE id = ${SOURCE}`;
  await publishArticle(id);
  const hidden = await loadItemDetail(id);
  if (hidden.kind !== "found") return assert.fail("the item page still exists");
  assert.equal(hidden.item.body, null, "no body is shown once the source no longer allows full text");
  const [kept] = await sql<{ complete: boolean }[]>`SELECT complete FROM translations WHERE article_id = ${id} AND lang = 'zh'`;
  assert.equal(kept!.complete, true, "the stored translation is kept, just not shown");
});

test("the provider was called once per batch and its answer is the only body written", async () => {
  assert.ok(provider.hits() >= 1 && provider.hits() <= 3, `bounded number of requests (${provider.hits()})`);
  const [receipt] = await sql<{ purpose: string; status: string }[]>`SELECT purpose, status FROM receipts WHERE subject LIKE ${`article:${articleId}%`} ORDER BY id LIMIT 1`;
  assert.equal(receipt?.purpose, "translate_body");
  assert.equal(receipt?.status, "completed");
});
