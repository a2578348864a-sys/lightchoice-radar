// The second lane's contract: deterministic admission, a budget pool that is its own, events that
// group without deleting, and permission profiles that close what was never licensed.
// Isolated database copy; no provider is called.
//   RADAR_INDUSTRY_ENABLED=true node --env-file=.env .data/_diag/run-tests.mjs tests/industry-lane.test.ts
import assert from "node:assert/strict";
import { tag } from "./setup.ts";
import { after, before, test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.RADAR_RUN_DIR = mkdtempSync(path.join(tmpdir(), "industry-lane-"));

const { sql, closeDb } = await import("@aihot/backend/db");
const { industryAdmission } = await import("@aihot/backend/sources/industry-gate");
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
  assert.deepEqual(industryFullPermissionSources(), ["industry-bea-news"], "only the public-domain government source reaches the model");
  for (const [id, profile] of Object.entries(INDUSTRY_SOURCES)) {
    if (id !== "industry-bea-news") {
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
