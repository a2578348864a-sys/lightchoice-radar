// The paid-window rollover: a finished window is archived with its own caps and spend, the next one
// starts from zero, and nothing that was spent is erased or widened afterwards. Runs on an isolated
// database copy; no provider is called.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import {
  reserveTranslationCall, startTranslationRound, translationBudgetState, translationSpendSummary, type RoundLimits,
} from "@aihot/backend/editorial/translate-budget";
import { BudgetExceededError } from "@aihot/backend/providers/receipts";

const ROUND = `round-${tag()}`;

after(async () => { await closeDb(); });

/** A window that ran before this test, as R45 left it: real requests, real spend, no round name. */
async function seedLegacyWindow() {
  await sql`INSERT INTO settings (key, value, updated_by) VALUES ('translate.budget', ${sql.json({
    requests: 14, articles: ["legacy-a", "legacy-b"], reservedCny: 0, spentCny: 0.019346,
    promptTokens: 7457, completionTokens: 554, dayKey: "2026-10-24", dayArticles: [], startedAt: "2026-10-24T06:30:22.833Z",
  })}, 'translate') ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  await sql`DELETE FROM settings WHERE key = 'translate.rounds'`;
}

test("a finished window is archived whole and the next one starts from zero", async () => {
  await seedLegacyWindow();
  const { archived, current } = await startTranslationRound(ROUND, { maxRequests: 40, maxArticles: 20, budgetCny: 1 });
  assert.ok(archived, "the previous window was archived");
  assert.equal(archived!.requests, 14);
  assert.deepEqual(archived!.articles, ["legacy-a", "legacy-b"]);
  assert.ok(Math.abs(archived!.spentCny - 0.019346) < 1e-9, "the archived spend is exactly what was spent");
  assert.equal(archived!.promptTokens, 7457);
  // The archived window keeps the caps it was authorized with (R45: 20 requests / 8 articles / ¥3).
  assert.deepEqual(archived!.limits, { maxRequests: 20, maxArticles: 8, budgetCny: 3 });

  assert.equal(current.round, ROUND);
  assert.equal(current.requests, 0, "the new window counts from zero");
  assert.deepEqual(current.articles, []);
  assert.equal(current.spentCny, 0);
  assert.deepEqual(current.limits, { maxRequests: 40, maxArticles: 20, budgetCny: 1 });

  // The running window and the archive are both readable, and the totals add up.
  const summary = await translationSpendSummary();
  assert.equal(summary.totalRequests, 14, "requests of the finished window still count");
  assert.equal(summary.totalArticles, 2);
  assert.ok(summary.totalSpentCny > 0.019 && summary.totalSpentCny < 0.0194);
  assert.equal(summary.totalPromptTokens, 7457);
});

test("starting the same round twice archives nothing twice", async () => {
  const { archived } = await startTranslationRound(ROUND);
  assert.equal(archived, null, "the running window is already this round");
  const rounds = await translationSpendSummary();
  const named = rounds.rounds.filter((r) => r.round === ROUND);
  assert.equal(named.length, 1, "one entry for this round");
});

test("the new window's caps are the ones it was authorized with", async () => {
  const caps: RoundLimits = { maxRequests: 2, maxArticles: 1, budgetCny: 0.01 };
  const { current } = await startTranslationRound(`${ROUND}-caps`, caps);
  assert.deepEqual(current.limits, caps);

  await sql.begin((tx) => reserveTranslationCall(tx, { articleId: "cap-a", inputChars: 100, maxTokens: 500 }));
  await assert.rejects(
    () => sql.begin((tx) => reserveTranslationCall(tx, { articleId: "cap-b", inputChars: 100, maxTokens: 500 })),
    (error: unknown) => error instanceof BudgetExceededError,
    "a second article exceeds this window's article cap",
  );
  const after = await translationBudgetState();
  assert.equal(after.round, `${ROUND}-caps`);
  assert.equal(after.requests, 1);
  assert.deepEqual(after.articles, ["cap-a"]);
});

test("an expired window refuses before any count is checked", async () => {
  const caps: RoundLimits = { maxRequests: 40, maxArticles: 20, budgetCny: 1, expiresAt: new Date(Date.now() - 60_000).toISOString() };
  await startTranslationRound(`${ROUND}-expired`, caps);
  await assert.rejects(
    () => sql.begin((tx) => reserveTranslationCall(tx, { articleId: "exp-a", inputChars: 100, maxTokens: 500 })),
    (error: unknown) => error instanceof BudgetExceededError && /translate-expired/.test(error.message),
    "an expired window refuses even with requests and money left",
  );
  const after = await translationBudgetState();
  assert.equal(after.requests, 0, "the refusal booked nothing");
});

test("a live window honours its expiry and its purpose allowlist", async () => {
  const caps: RoundLimits = {
    maxRequests: 40, maxArticles: 20, budgetCny: 1,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(), purposes: ["translate_title"],
  };
  const { current } = await startTranslationRound(`${ROUND}-ttl`, caps);
  assert.equal(current.limits?.expiresAt, caps.expiresAt, "the expiry persists with the window");
  assert.deepEqual(current.limits?.purposes, ["translate_title"]);
  // Inside the window and on an allowed purpose: the reservation goes through.
  await sql.begin((tx) => reserveTranslationCall(tx, { articleId: "ttl-a", inputChars: 100, maxTokens: 500, purpose: "translate_title" }));
  // A purpose outside the allowlist is refused before it could reach a receipt.
  await assert.rejects(
    () => sql.begin((tx) => reserveTranslationCall(tx, { articleId: "ttl-b", inputChars: 100, maxTokens: 500, purpose: "translate_body" })),
    (error: unknown) => error instanceof BudgetExceededError && /translate-purpose/.test(error.message),
  );
  // A legacy call without a purpose still counts against the caps.
  await sql.begin((tx) => reserveTranslationCall(tx, { articleId: "ttl-b", inputChars: 100, maxTokens: 500 }));
  const state = await translationBudgetState();
  assert.equal(state.requests, 2);
  assert.deepEqual(state.articles, ["ttl-a", "ttl-b"]);
});
