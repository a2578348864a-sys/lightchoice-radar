// What a reader may claim about the automatic translation, and where the scheduled run's money stops.
//
// The four states a status screen must tell apart — not enabled, running, fault, budget used up — come
// from the worker's own marks plus the stored rows, and a run record alone is a fault rather than a
// running process. The run's money side is checked end to end: the baseline is written once and never
// moves backwards, a finished item is not paid for again, and a window whose caps are used up refuses
// the call before it is sent. Isolated database copy, local provider stub, no real paid request.
//
// Run it with the deployment's translation gate on, as its sibling does:
//   RADAR_TRANSLATE_ENABLED=true node --env-file=.env .data/_diag/run-tests.mjs tests/translate-run-state.test.ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

// The state reader answers from a run directory of this test's own, never from the developer machine's
// worker files — so it is pointed there before anything that reads it is loaded.
process.env.RADAR_RUN_DIR = mkdtempSync(path.join(tmpdir(), "radar-translate-state-"));

const { closeDb, sql } = await import("@aihot/backend/db");
const { config } = await import("@aihot/backend/config");
const { upsertMaterial } = await import("@aihot/backend/content/materials");
const { analyzeArticle } = await import("@aihot/backend/editorial/analyze");
const { publishArticle } = await import("@aihot/backend/publication/publish");
const { translationBudgetState } = await import("@aihot/backend/editorial/translate-budget");
const { translateItemText, translateTextPending, preservedTokens } = await import("@aihot/backend/editorial/translate-text");
const control = await import("../apps/worker/src/control.ts");
const { stub, tag } = await import("./setup.ts");
const {
  TRANSLATE_SOURCES, beijingStamp, lastRunProcessed, lastRunReason,
  readTranslationState, translationHeadline, translationRunning,
} = await import("../scripts/radar-translate-state.ts");

assert.ok(config.translateEnabled, "this test must run with RADAR_TRANSLATE_ENABLED=true");

const T = tag();
const SOURCE = `translate-state-${T}`;
const TITLE = `CPSC Announces Recall of Countertop Mixers Due to Laceration Hazard (${T})`;
const EXCERPT = "The recalled countertop mixers have a blade that can break during use. About 4,200 units were sold in the United States from March 2025 through July 2025 for $59.";

/** A Chinese rendering long enough to pass the length guard, carrying every token the source had. */
function chineseOf(source: string): string {
  const base = "该文件说明相关商品必须符合要求，并列出适用范围、例外条件与可采取的处理方式，具体以官方原文为准。";
  const body = base.repeat(Math.ceil((source.length * 0.5) / base.length) + 1).slice(0, Math.max(8, Math.ceil(source.length * 0.5)));
  const tokens = preservedTokens(source);
  return tokens.length ? `${body}（原文数值：${tokens.join("、")}）` : body;
}

let provider: Awaited<ReturnType<typeof stub>>;
let records = 0;

/**
 * A published official record, ready for the scheduled path to see it. Each record's text is unique:
 * two records with identical words share a receipt logical key, and a reused answer is not a new paid
 * request — which is correct, but would hide the budget gate this file has to exercise.
 */
async function publishRecord(publishedAt: Date): Promise<string> {
  records += 1;
  const title = `${TITLE} #${records}`;
  const excerpt = `${EXCERPT} (record ${records})`;
  const { articleId } = await upsertMaterial({
    sourceId: SOURCE, url: `https://example.org/translate-state/${T}/${records}`, title, language: "en",
    bodyText: `${excerpt}\n\n${excerpt}`, bodyHtml: `<p>${excerpt}</p>`, excerpt,
    bodyStatus: "ok", via: "fetch", publishedAt,
  });
  await analyzeArticle(articleId);
  await publishArticle(articleId);
  return articleId;
}

/** The caps of a window that has nothing left: what R49's closed window looks like. */
const USED_UP = {
  round: "used-up", requests: 0, articles: [], reservedCny: 0, spentCny: 0, promptTokens: 0, completionTokens: 0,
  dayKey: "2026-10-24", dayArticles: [], startedAt: "2026-10-24T00:00:00.000Z",
  limits: { maxRequests: 0, maxArticles: 0, budgetCny: 0 },
};

before(async () => {
  provider = await stub((_hit, req) => {
    const body = JSON.parse(req.body) as { messages: Array<{ content: string }> };
    const user = JSON.parse(body.messages.at(-1)!.content) as { kind: "title" | "excerpt"; text: string };
    return {
      id: "stub-answer",
      choices: [{ message: { content: JSON.stringify({ t: chineseOf(user.text) }) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 180, completion_tokens: 60, total_tokens: 240 },
    };
  });
  process.env.LLM_BASE_URL = `${provider.url}/v1`;
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_MODEL = "deepseek-flash";
  process.env.DEEPSEEK_BASE_URL = `${provider.url}/v1`;
  process.env.DEEPSEEK_API_KEY = "test-key";
  process.env.RADAR_TRANSLATE_SOURCES = SOURCE;
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,next_fetch_at)
            VALUES (${SOURCE},'Translate state','rss','T1','editorial','2100-01-01')`;
  // A clean window for this file: no baseline, no lease, no budget left by another test.
  await sql`DELETE FROM settings WHERE key IN ('translate.baseline','translate.budget','translate.lease','translate.rounds')`;
});

after(async () => { await provider.close(); control.clearControlState("radar-translate"); await closeDb(); });

/* ------------------------------------------------------------- the source set */

test("the translatable sources are exactly the first lane's official set", () => {
  assert.deepEqual([...TRANSLATE_SOURCES].sort(), [
    "amazon-us-announcements", "amazon-us-fee-updates", "rss-cpsc-recalls", "us-federal-register-cpsc", "us-federal-register-ftc",
  ]);
  assert.equal(TRANSLATE_SOURCES.length, 5, "no lead, ads, community or retired source can join by accident");
});

/* ----------------------------------------------------------------- the states */

test("with no run record and no lock the translation reads as not enabled", async () => {
  const state = await readTranslationState();
  assert.equal(state.record, null);
  assert.equal(await translationRunning(state), false);
  assert.equal(translationHeadline(state, false), "未启用（未运行）");
});

test("a run record without a live process reads as a fault, never as running", async () => {
  control.writeRunRecord("radar-translate", "apps/worker/src/main.ts (RADAR_WORKER_SCOPE=content)");
  const state = await readTranslationState();
  assert.equal(state.record?.role, "radar-translate");
  // No lock, no heartbeat, and the recorded pid is this test's own — not the worker's entry point.
  assert.equal(await translationRunning(state), false, "a stale record is not evidence of a running worker");
  assert.equal(translationHeadline(state, false), "故障（上次未正常退出）");
  control.clearControlState("radar-translate");
});

test("a held role lock reads as running even before any heartbeat exists", async () => {
  const connection = await sql.reserve();
  try {
    const [row] = await connection<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(7204229004::bigint) AS locked`;
    assert.equal(row.locked, true, "the test session took the role's lock");
    const state = await readTranslationState();
    assert.equal(state.lock, true);
    assert.equal(await translationRunning(state), true);
    assert.equal(translationHeadline(state, true), "运行中");
  } finally {
    await connection`SELECT pg_advisory_unlock(7204229004::bigint)`.catch(() => {});
    connection.release();
  }
});

test("a window whose caps are used up reads as budget used up, whether or not the worker runs", async () => {
  await sql`INSERT INTO settings (key, value, updated_by) VALUES ('translate.budget', ${sql.json(USED_UP)}, 'translate')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  const idle = await readTranslationState();
  assert.equal(idle.exhausted, true);
  assert.equal(translationHeadline(idle, false), "预算已用完（未运行）");
  assert.equal(translationHeadline(idle, true), "运行中（预算已用完，不再发新请求）");
  // The caps are the ones the window was authorized with, not a later environment's.
  const budget = await translationBudgetState();
  assert.equal(budget.limits?.maxRequests, 0);
});

test("the last run reports when it ran, how many items it translated and why it stopped", async () => {
  await sql`INSERT INTO job_runs (job, status, finished_at, detail)
            VALUES ('content.translate', 'ok', now(), ${sql.json({ done: [{ articleId: "a" }, { articleId: "b" }], reason: "daily article cap reached" })})`;
  const state = await readTranslationState();
  assert.equal(lastRunProcessed(state), 2, "a reader sees the count the run actually finished");
  assert.equal(lastRunReason(state), "daily article cap reached");
  // A Beijing stamp is UTC+8, so an operator reads the local hour, not the stored one.
  assert.equal(beijingStamp(new Date("2026-10-24T12:00:00.000Z")), "2026-10-24 20:00:00");
});

/* ------------------------------------------------------- baseline and money */

test("the first run records the baseline and does not back-fill what existed before it", async () => {
  await sql`DELETE FROM settings WHERE key = 'translate.budget'`;
  const older = await publishRecord(new Date(Date.now() - 6 * 3600_000));
  const hitsBefore = provider.hits();
  const run = await translateTextPending();
  assert.equal(run.done.length, 0, "an item that predates the baseline is left alone");
  assert.match(String(run.reason), /baseline/i);
  assert.equal(provider.hits(), hitsBefore, "no request was sent for the pre-baseline item");

  const [baseline] = await sql<{ value: { at?: string } }[]>`SELECT value FROM settings WHERE key = 'translate.baseline'`;
  assert.ok(baseline?.value?.at, "the baseline is stored, so a restart reuses it");
  const [attempts] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM translation_attempts WHERE article_id = ${older}`;
  assert.equal(attempts!.n, 0, "nothing was even recorded as an attempt");
});

test("a new official record is translated once, and a restart does not pay for it again", async () => {
  const id = await publishRecord(new Date());
  const first = await translateTextPending();
  const done = first.done.find((d) => d.articleId === id);
  assert.ok(done, `the incremental run picked the item up (${first.reason ?? "no reason"})`);
  assert.equal(done!.status, "translated");
  assert.equal(provider.hits(), 2, "a title and a source summary");

  // A restart: same baseline, same item, no new request.
  const second = await translateTextPending();
  assert.equal(second.done.length, 0, "an already translated item is not sent again");
  assert.equal(provider.hits(), 2, "no additional paid request");
  const [rows] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM translations WHERE article_id = ${id}`;
  assert.equal(rows!.n, 2, "one title row and one source-summary row");
});

test("a window with no requests left refuses the call before it is sent", async () => {
  const fresh = await publishRecord(new Date());
  await sql`INSERT INTO settings (key, value, updated_by) VALUES ('translate.budget', ${sql.json(USED_UP)}, 'translate')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  const before = provider.hits();
  const run = await translateTextPending();
  assert.equal(run.done.length, 0, "nothing was translated");
  assert.match(String(run.reason), /budget/i);
  assert.equal(provider.hits(), before, "the provider was never reached");

  // And through the single-item entry, which is what a run calls: the refusal is not a translation.
  await assert.rejects(() => translateItemText(fresh), /budget/i);
  assert.equal(provider.hits(), before, "still no request reached the provider");
  const [receipts] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM receipts WHERE subject LIKE ${`article:${fresh}%`}`;
  assert.equal(receipts!.n, 0, "a refused reservation writes no receipt");
});
