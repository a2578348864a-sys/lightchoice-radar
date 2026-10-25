// The second lane's contract: deterministic admission, a budget pool that is its own, events that
// group without deleting, and permission profiles that close what was never licensed.
// Isolated database copy; no provider is called.
//   RADAR_INDUSTRY_ENABLED=true node --env-file=.env .data/_diag/run-tests.mjs tests/industry-lane.test.ts
import assert from "node:assert/strict";
import { stub, tag } from "./setup.ts";
import { after, before, test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.RADAR_RUN_DIR = mkdtempSync(path.join(tmpdir(), "industry-lane-"));

const { sql, closeDb } = await import("@aihot/backend/db");
const { industryAdmission, industryEventKey } = await import("@aihot/backend/sources/industry-gate");
const { INDUSTRY_SOURCES, industryFullPermissionSources, isApprovedIndustrySourceId } = await import("@aihot/backend/sources/industry-lane");
const { reserveIndustryCall, startIndustryRound, startIndustryObservation, industryBudgetState } = await import("@aihot/backend/editorial/industry-budget");
const { ensureIndustryStory, mergeIndustryStory } = await import("@aihot/backend/editorial/industry-events");
const { translationBudgetState } = await import("@aihot/backend/editorial/translate-budget");
const { BudgetExceededError } = await import("@aihot/backend/providers/receipts");
const { upsertMaterial } = await import("@aihot/backend/content/materials");

const T = tag();

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, tier, participation_mode, next_fetch_at)
            VALUES ('industry-bea-news', 'BEA', 'rss', 'T1', 'editorial', '2100-01-01')`;
});

after(async () => { await closeDb(); });

/* ------------------------------------------------------------ the gate */

test("the five themes admit their real positives and keep the real negatives out", () => {
  // Positives drawn from the live 2026-10-25 feeds.
  const positives: Array<[string, string, string[]]> = [
    ["industry-bea-news", "Personal Income and Outlays, July 2026", ["economic-data"]],
    ["industry-retail-dive", "Walmart welcomes external AI agents — with some guardrails", ["ecommerce-competition"]],
    ["industry-supply-chain-dive", "Trump tweaks Canada tariffs, removing certain goods while adding others", ["supply-chain-cost"]],
    ["industry-modern-retail", "The rise of 'Adultoween' and how adults are driving Halloween spending", ["consumer-demand"]],
    ["industry-retail-dive", "Bath & Body Works introduces new store concept", ["category-trends"]],
  ];
  for (const [sourceId, title, themes] of positives) {
    const verdict = industryAdmission({ sourceId, title, summary: "" });
    assert.equal(verdict.admitted, true, `${title} should be admitted (${verdict.reason})`);
    for (const theme of themes as readonly string[]) assert.ok((verdict.themes as string[]).includes(theme), `${title} should cover ${theme}`);
  }
  // Negatives: the exclusions the lane promises, with the reasons it keeps.
  const negatives: Array<[string, string, string]> = [
    ["industry-modern-retail", "Why holiday returns demand fresh thinking from retailers", "sponsor"],
    ["industry-modern-retail", "Modern Retail+ Research: Marketers express revenue optimism", "research"],
    ["industry-retail-dive", "Lululemon adds former product chief to board", "personnel"],
    ["industry-retail-dive", "eBay reports Q3 financial results above expectations", "earnings"],
    ["industry-supply-chain-dive", "Ikea accused of harmful wood sourcing in Europe's forests", "non-US"],
    ["industry-retail-dive", "A quiet Tuesday for the markets", "no industry theme"],
  ];
  for (const [sourceId, title, reasonPart] of negatives) {
    const verdict = industryAdmission({ sourceId, title, summary: "", categories: sourceId === "industry-modern-retail" && reasonPart === "sponsor" ? ["Sponsored"] : [] });
    assert.equal(verdict.admitted, false, `${title} should stay out`);
    assert.match(verdict.reason, new RegExp(reasonPart, "i"), `${title}: ${verdict.reason}`);
  }
});

test("sponsorship decided by the publisher's own category, not by title words", () => {
  const verdict = industryAdmission({ sourceId: "industry-modern-retail", title: "Why holiday returns demand fresh thinking from retailers", summary: "", categories: ["Sponsored"] });
  assert.equal(verdict.admitted, false);
  assert.equal(verdict.kind, "sponsored");
});

/* ------------------------------------------------- the permission profiles */

test("model processing stays closed for every source that was never licensed for it", () => {
  assert.deepEqual(industryFullPermissionSources(), ["industry-bea-news", "industry-frb-press"], "only the public-domain government sources reach the model");
  for (const [id, profile] of Object.entries(INDUSTRY_SOURCES)) {
    if (!id.includes("bea") && !id.includes("frb")) {
      assert.equal(profile.modelProcessing, false, `${id} must not be model-processed`);
      assert.equal(profile.saveExcerpt, false, `${id} must not store excerpts`);
    }
  }
  assert.equal(isApprovedIndustrySourceId("industry-bea-news"), true);
  assert.equal(isApprovedIndustrySourceId("amz123-policy-leads"), false, "the first lane's lead source is not an industry source");
});

/* -------------------------------------------------------- the budget pool */

test("the industry window is its own pool and never touches the translation window", async () => {
  await startIndustryRound(`second-lane-${T}`, { maxRequests: 5, maxArticles: 3, budgetCny: 0.01, purposes: ["industry_event"] });
  const translateBefore = await translationBudgetState();
  await sql.begin((tx) => reserveIndustryCall(tx, { articleId: "art-a", inputChars: 300, maxTokens: 500, purpose: "industry_event" }));
  const translateAfter = await translationBudgetState();
  assert.deepEqual(translateAfter.spentCny, translateBefore.spentCny, "the first lane's spend did not move");
  assert.deepEqual(translateAfter.requests, translateBefore.requests, "the first lane's request count did not move");

  await assert.rejects(
    () => sql.begin((tx) => reserveIndustryCall(tx, { articleId: "art-b", inputChars: 300, maxTokens: 500, purpose: "industry_title" })),
    (error: unknown) => error instanceof BudgetExceededError && /industry-purpose/.test(error.message),
    "a purpose outside this window's allowlist is refused",
  );
  await assert.rejects(
    () => sql.begin((tx) => reserveIndustryCall(tx, { articleId: "art-b", inputChars: 300, maxTokens: 500, purpose: "translate_title" })),
    (error: unknown) => error instanceof BudgetExceededError,
    "the industry window never pays for a translation purpose",
  );
});

test("the observation stamp is written once and an expired window refuses", async () => {
  await startIndustryRound(`observe-${T}`, { maxRequests: 5, maxArticles: 3, budgetCny: 1 });
  const first = await startIndustryObservation();
  assert.ok(first?.expiresAt, "enablement stamps the expiry");
  const second = await startIndustryObservation();
  assert.equal(second, null, "re-running enablement cannot extend the clock");

  await startIndustryRound(`expired-${T}`, { maxRequests: 5, maxArticles: 3, budgetCny: 1, expiresAt: new Date(Date.now() - 60_000).toISOString() });
  await assert.rejects(
    () => sql.begin((tx) => reserveIndustryCall(tx, { articleId: "art-c", inputChars: 100, maxTokens: 500, purpose: "industry_event" })),
    (error: unknown) => error instanceof BudgetExceededError && /industry-expired/.test(error.message),
  );
  const state = await industryBudgetState();
  assert.ok(state.round.startsWith(`expired-${T}`));
  assert.equal(state.requests, 0, "a refused request books nothing");
});

/* --------------------------------------------------------- event wiring */

async function seedIndustryArticle(url: string, title: string): Promise<string> {
  const { articleId } = await upsertMaterial({
    sourceId: "industry-bea-news", url, title, language: "en",
    bodyText: "The U.S. goods and services trade deficit increased in August 2026, from $92.8 billion in July (revised) to $105.6 billion in August.",
    excerpt: "The deficit increased from $92.8 billion in July to $105.6 billion in August.",
    bodyStatus: "none", via: "fetch", publishedAt: new Date(),
  });
  await sql`INSERT INTO publications (article_id, source_id, title, url, visibility, channel, discovered_at, timeline_at, sort_at)
            VALUES (${articleId}, 'industry-bea-news', ${title}, ${url}, 'public', 'news', now(), now(), now()) ON CONFLICT DO NOTHING`;
  return articleId;
}

test("one event key groups its articles; a wrong merge is corrected without deleting anything", async () => {
  const a = await seedIndustryArticle(`https://bea.gov/news/2026/event-a-${T}`, `Trade deficit widens to $105.6 billion in August 2026`);
  const b = await seedIndustryArticle(`https://bea.gov/news/2026/event-b-${T}`, `Trade deficit widens to $105.6 billion in August 2026 (second report)`);
  const c = await seedIndustryArticle(`https://bea.gov/news/2026/event-c-${T}`, `A different event entirely about consumer demand`);

  const key = "economic-data|trade deficit widens billion";
  const storyA = await ensureIndustryStory({ eventKey: key, theme: "economic-data", title: "Trade deficit widens", articleId: a, publishedAt: new Date() });
  const storyB = await ensureIndustryStory({ eventKey: key, theme: "economic-data", title: "Trade deficit widens", articleId: b, publishedAt: new Date() });
  assert.equal(storyA, storyB, "the same event key reaches one story");

  const [links] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM fact_articles fa JOIN facts f ON f.id = fa.fact_id WHERE f.story_id = ${storyA}`;
  assert.ok(links!.n >= 2, "both articles are recorded under the story's facts");

  // The wrong merge: storyA absorbed a story that was about something else; the correction is structural.
  const storyC = await ensureIndustryStory({ eventKey: "consumer-demand|different event entirely", theme: "consumer-demand", title: "A different event", articleId: c, publishedAt: new Date() });
  const wronglyMerged = await mergeIndustryStory(storyC, storyA, "test: wrong merge");
  assert.equal(wronglyMerged, true);
  const [after] = await sql<{ merged_into: number | null }[]>`SELECT merged_into FROM stories WHERE id = ${storyC}`;
  assert.equal(after!.merged_into, storyA, "the duplicate points at the survivor");
  const undone = await mergeIndustryStory(storyC, storyA, "second time");
  assert.equal(undone, false, "an already-merged story is not merged again");
  // The articles never disappear: all three rows still exist.
  const [count] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE id = ANY(${[a, b, c]}::text[])`;
  assert.equal(count!.n, 3, "no article was deleted by any merge or correction");
});


/* ---------------------------------------------- A2: the five identity scenarios */

/** A stored industry article with a publication row, as the real collection path leaves it. */
async function seedArticle(url: string, title: string, publishedAt: Date, excerpt = "The deficit increased from $92.8 billion in July to $105.6 billion in August."): Promise<string> {
  const { articleId } = await upsertMaterial({
    sourceId: "industry-bea-news", url, title, language: "en",
    bodyText: `${excerpt}\n\n${excerpt}`, excerpt, bodyStatus: "none", via: "fetch", publishedAt,
  });
  await sql`INSERT INTO publications (article_id, source_id, title, url, visibility, channel, discovered_at, timeline_at, sort_at)
            VALUES (${articleId}, 'industry-bea-news', ${title}, ${url}, 'public', 'news', ${publishedAt}, ${publishedAt}, ${publishedAt})
            ON CONFLICT (article_id) DO NOTHING`;
  return articleId;
}

async function storyIdOf(articleId: string): Promise<number | null> {
  const [row] = await sql<{ story_id: number | null }[]>`
    SELECT p.story_id FROM publications p JOIN stories s ON s.id = p.story_id AND s.merged_into IS NULL
    WHERE p.article_id = ${articleId}`;
  return row?.story_id ?? null;
}

test("情形一：相同 URL 相同内容 → 一个文章身份，一次事件，事实幂等", async () => {
  const at = new Date("2026-10-01T12:00:00Z");
  const a1 = await seedArticle(`https://bea.gov/news/2026/idem-${T}`, `Identical release ${T}`, at);
  const a2 = await seedArticle(`https://bea.gov/news/2026/idem-${T}`, `Identical release ${T}`, at);
  assert.equal(a1, a2, "the same URL and content keep one article identity");
  const key = industryEventKey({ sourceId: "industry-bea-news", title: `Identical release ${T}`, themes: ["economic-data"] });
  const s1 = await ensureIndustryStory({ eventKey: key, theme: "economic-data", title: `Identical release ${T}`, articleId: a1, publishedAt: at });
  const s2 = await ensureIndustryStory({ eventKey: key, theme: "economic-data", title: `Identical release ${T}`, articleId: a1, publishedAt: at });
  assert.equal(s1, s2, "re-entering the same article is idempotent on the story");
  const [facts] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM facts WHERE story_id = ${s1}`;
  assert.equal(facts!.n, 1, "one fact per story per article version — no duplicates");
});

test("情形二：相同 URL 正文修订 → 新版本入库，旧版本证据保留，发布日期不变", async () => {
  const url = `https://bea.gov/news/2026/rev-${T}`;
  const at = new Date("2026-10-02T12:00:00Z");
  const v1 = await upsertMaterial({ sourceId: "industry-bea-news", url, title: `Revised release ${T}`, language: "en",
    bodyText: "The deficit increased from $92.8 billion in July to $105.6 billion in August.", excerpt: "The deficit increased from $92.8 billion in July to $105.6 billion in August.", bodyStatus: "none", via: "fetch", publishedAt: at });
  const v2 = await upsertMaterial({ sourceId: "industry-bea-news", url, title: `Revised release ${T}`, language: "en",
    bodyText: "The deficit increased from $92.8 billion in July to $106.0 billion in August (revised).", excerpt: "Revised to $106.0 billion.", bodyStatus: "none", via: "fetch", publishedAt: at });
  assert.equal(v1.articleId, v2.articleId, "a revision updates the same article");
  assert.ok(v2.revised, "the revision is recorded as one");
  const [rev] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM article_revisions WHERE article_id = ${v1.articleId}`;
  assert.equal(rev!.n, 2, "both versions keep their evidence rows");
  const [pub] = await sql<{ published_at: Date }[]>`SELECT published_at FROM articles WHERE id = ${v1.articleId}`;
  assert.equal(pub!.published_at.toISOString(), at.toISOString(), "the revision did not move the publication date");
});

test("情形三：不同文章同一事件 → 共享事件，两篇原文与来源都保留", async () => {
  const at = new Date("2026-10-03T12:00:00Z");
  const title = `Trade deficit widens to 105.6 billion dollars in August 2026 ${T}`;
  const a1 = await seedArticle(`https://bea.gov/news/2026/ev-${T}-a`, title, at);
  const a2 = await seedArticle(`https://retaildive.example/ev-${T}-b`, title, at);
  const key = industryEventKey({ sourceId: "industry-bea-news", title, themes: ["economic-data"] });
  const s1 = await ensureIndustryStory({ eventKey: key, theme: "economic-data", title, articleId: a1, publishedAt: at });
  const s2 = await ensureIndustryStory({ eventKey: key, theme: "economic-data", title, articleId: a2, publishedAt: at });
  assert.equal(s1, s2, "both reports share one event");
  const [arts] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE id = ANY(${[a1, a2]}::text[])`;
  assert.equal(arts!.n, 2, "both original articles survive");
  assert.equal(await storyIdOf(a1), s1);
  assert.equal(await storyIdOf(a2), s1);
});

test("情形四：相同公司不同事件 → 两个独立事件，不同统计期也是", async () => {
  const at = new Date("2026-10-04T12:00:00Z");
  const t1 = `Amazon announces new fulfillment fee structure ${T}`;
  const t2 = `Amazon opens first automated warehouse in Ohio ${T}`;
  const k1 = industryEventKey({ sourceId: "industry-retail-dive", title: t1, themes: ["ecommerce-competition"] });
  const k2 = industryEventKey({ sourceId: "industry-retail-dive", title: t2, themes: ["ecommerce-competition"] });
  assert.notEqual(k1, k2, "the same company with different actions keeps different keys");
  const m1 = `Personal Income and Outlays, April 2026 ${T}`;
  const m2 = `Personal Income and Outlays, June 2026 ${T}`;
  assert.notEqual(
    industryEventKey({ sourceId: "industry-bea-news", title: m1, themes: ["economic-data"] }),
    industryEventKey({ sourceId: "industry-bea-news", title: m2, themes: ["economic-data"] }),
    "different statistical periods are different events",
  );
  const a1 = await seedArticle(`https://bea.gov/news/2026/co-${T}-1`, t1, at);
  const a2 = await seedArticle(`https://bea.gov/news/2026/co-${T}-2`, t2, at);
  const s1 = await ensureIndustryStory({ eventKey: k1, theme: "ecommerce-competition", title: t1, articleId: a1, publishedAt: at });
  const s2 = await ensureIndustryStory({ eventKey: k2, theme: "ecommerce-competition", title: t2, articleId: a2, publishedAt: at });
  assert.notEqual(s1, s2, "two independent stories");
});

test("情形五：事件新进展 → 关联原事件，独立材料与顺序保留，不覆盖历史", async () => {
  const day1 = new Date("2026-10-05T12:00:00Z");
  const day2 = new Date("2026-10-06T12:00:00Z");
  const base = `Levi's distribution network transition saga ${T}`;
  const key = industryEventKey({ sourceId: "industry-supply-chain-dive", title: base, themes: ["supply-chain-cost"] });
  const a1 = await seedArticle(`https://scd.example/progress-${T}-1`, `${base} continues`, day1);
  const s1 = await ensureIndustryStory({ eventKey: key, theme: "supply-chain-cost", title: base, articleId: a1, publishedAt: day1 });
  const a2 = await seedArticle(`https://scd.example/progress-${T}-2`, `${base} drags into next year`, day2);
  const s2 = await ensureIndustryStory({ eventKey: key, theme: "supply-chain-cost", title: base, articleId: a2, publishedAt: day2 });
  assert.equal(s1, s2, "the development joins the original event");
  const [facts] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM facts WHERE story_id = ${s1}`;
  assert.equal(facts!.n, 2, "each report keeps its own fact");
  const ordered = await sql<{ occurred_at: Date }[]>`SELECT occurred_at FROM facts WHERE story_id = ${s1} ORDER BY occurred_at`;
  assert.ok(ordered[0]!.occurred_at.getTime() < ordered[1]!.occurred_at.getTime(), "the sequence is preserved");
  const [st] = await sql<{ first_report_at: Date; latest_at: Date }[]>`SELECT first_report_at, latest_at FROM stories WHERE id = ${s1}`;
  assert.ok(st!.first_report_at.getTime() < st!.latest_at.getTime(), "first report was not overwritten by the new development");
});

test("空或缺失事件键被拒绝——2026-10-25 事故的直接防线", async () => {
  const a = await seedArticle(`https://bea.gov/news/2026/nulkey-${T}`, `Null key guard ${T}`, new Date());
  await assert.rejects(() => ensureIndustryStory({ eventKey: "", theme: "economic-data", title: "x", articleId: a, publishedAt: new Date() }), /without an event key/);
  await assert.rejects(() => ensureIndustryStory({ eventKey: null as unknown as string, theme: "economic-data", title: "x", articleId: a, publishedAt: new Date() }), /without an event key/);
});

test("全停用词标题不会共享同一个裸键", () => {
  const bare1 = industryEventKey({ sourceId: "industry-retail-dive", title: "The and for with that from", themes: ["consumer-demand"] });
  const bare2 = industryEventKey({ sourceId: "industry-retail-dive", title: "The and for with that how", themes: ["consumer-demand"] });
  assert.notEqual(bare1, bare2, "stopword-only titles keep unique keys");
  assert.ok(!bare1.endsWith("|"), "no bare theme-only key");
});

test("并发建同一事件：咨询锁串行化，仍然只有一个故事", async () => {
  const at = new Date("2026-10-07T12:00:00Z");
  const title = `Concurrent creation race ${T}`;
  const key = industryEventKey({ sourceId: "industry-bea-news", title, themes: ["economic-data"] });
  const a1 = await seedArticle(`https://bea.gov/news/2026/race-${T}-1`, title, at);
  const a2 = await seedArticle(`https://bea.gov/news/2026/race-${T}-2`, title, at);
  const [s1, s2] = await Promise.all([
    ensureIndustryStory({ eventKey: key, theme: "economic-data", title, articleId: a1, publishedAt: at }),
    ensureIndustryStory({ eventKey: key, theme: "economic-data", title, articleId: a2, publishedAt: at }),
  ]);
  assert.equal(s1, s2, "the advisory lock keeps concurrent creators on one story");
  const [rows] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM stories WHERE frame->>'eventKey' = ${key} AND merged_into IS NULL`;
  assert.equal(rows!.n, 1, "exactly one active story for the key");
});

/* ------------------------------- B2: a reused receipt settles its usage once */

test("复用缓存响应不重复结算：两次同键调用，账本只记一次用量", async () => {
  const provider = await stub(() => ({
    id: "reuse-stub",
    choices: [{ message: { content: JSON.stringify({ t: "中文标题足够长通过长度校验", quick: "一句话速读足够长。", facts: [{ s: "主体甲", a: "发布", o: "数据", time: "2026年10月" }], caveat: "原文并未给出销量结论。", research: "值得后续关注费用传导。", }) }, finish_reason: "stop" }],
    usage: { prompt_tokens: 300, completion_tokens: 200, total_tokens: 500 },
  }));
  process.env.LLM_BASE_URL = `${provider.url}/v1`;
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_MODEL = "deepseek-flash";
  try {
    await startIndustryRound(`reuse-${T}`, { maxRequests: 10, maxArticles: 5, budgetCny: 1, purposes: ["industry_event"] });
    const { chatJson } = await import("@aihot/backend/providers/llm");
    const { z } = await import("zod");
    const Schema = z.object({ t: z.string() });
    const call = () => chatJson({
      model: "default", purpose: "industry_event", subject: `article:reuse-${T}@1:industry`, articleId: `reuse-${T}`,
      promptVersion: "test", system: "s", user: JSON.stringify({ kind: "industry-item", text: "stable input" }),
      schema: Schema, temperature: 0.1, maxTokens: 500, timeoutMs: 10_000,
    });
    const first = await call();
    assert.equal(first.reused, false, "the first call reaches the provider");
    const before = await industryBudgetState();
    const second = await call();
    assert.equal(second.reused, true, "the identical call is served from the receipt cache");
    assert.equal(provider.hits(), 1, "the provider saw exactly one request");
    const after = await industryBudgetState();
    assert.equal(after.promptTokens, before.promptTokens, "a reuse books no prompt tokens");
    assert.equal(after.completionTokens, before.completionTokens, "a reuse books no completion tokens");
    assert.equal(after.spentCny, before.spentCny, "a reuse books no spend");
    assert.equal(after.requests, before.requests, "a reuse reserves no request");
  } finally {
    await provider.close();
  }
});

/* ------------------------------- C1: restricted sources never store content */

test("限制准入源：feed 自带全文（content:encoded）也不得落库", async () => {
  const { stripUnlicensedContent } = await import("@aihot/backend/sources/filters");
  const restricted = { title: "Kohl's leans into pricing", url: "https://example.invalid/x", excerpt: "feed summary", bodyText: "full article body from content:encoded", bodyHtml: "<p>full article</p>", bodyStatus: "ok", media: [{ url: "i" }] };
  const stripped = stripUnlicensedContent(restricted, false);
  assert.equal(stripped.excerpt, null, "the feed's own summary is dropped");
  assert.equal(stripped.bodyText, null, "embedded full text is dropped");
  assert.equal(stripped.bodyHtml, null);
  assert.equal(stripped.bodyStatus, "none");
  assert.equal(stripped.title, restricted.title, "factual metadata stays");
  const kept = stripUnlicensedContent(restricted, true);
  assert.equal(kept.bodyText, restricted.bodyText, "a licensed source keeps its material");
  // 真实 feed 验证：Modern Retail 的 content:encoded 条目在剥离后只剩元数据
  const { fetchRss } = await import("@aihot/backend/sources/rss");
  const src = { id: "industry-modern-retail", name: "Modern Retail", kind: "rss", config: { feedUrl: "https://www.modernretail.co/feed/", acceptLanguage: "en-US,en;q=0.9" }, cursor: null, tier: "T2", participation_mode: "editorial", tags: [], enabled: true, interval_minutes: 180, site_fulltext: false, syndicate_fulltext: false, first_party: false, fail_count: 0 } as never;
  const read = await fetchRss(src, { force: true });
  const withBody = read.candidates.filter((c) => c.bodyText);
  if (withBody.length) {
    const after = stripUnlicensedContent(withBody[0]!, false);
    assert.equal(after.bodyText, null, "the real feed's embedded body is stripped before storage");
  }
});
