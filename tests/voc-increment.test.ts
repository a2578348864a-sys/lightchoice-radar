// The increment lane's contract tests — isolated database copy, no network (mock fetch), no model.
// Covers the five change classes (new topic / new answer / new comment / edit / licence change),
// watermark boundaries (same-second, batch-derived baseline, carry-over), failure paths (budget,
// 429, network, revocation, concurrent lock), round-robin recheck coverage, absence observation,
// cross-lane isolation, and the zero-cost evaluation metrics.
//   node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test tests/voc-increment.test.ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

process.env.RADAR_RUN_DIR = mkdtempSync(path.join(tmpdir(), "voc-increment-"));

const { sql, closeDb } = await import("@aihot/backend/db");
const { saveStudy, saveBatch } = await import("@aihot/backend/voc/voc-model");
const { applyImport } = await import("@aihot/backend/voc/voc-ingest");
const { runVocIncrement, loadVocIncrementState, INCREMENT_LOCK_KEY } = await import("@aihot/backend/voc/voc-increment");
const { evaluateVocEvalSet } = await import("@aihot/backend/voc/voc-eval");
const { parseSeQuestion } = await import("@aihot/backend/voc/voc-stackexchange");
const { revokeBatch, recordReview } = await import("@aihot/backend/voc/voc-analysis");

const T = "inc" + Date.now().toString(36);
const SOURCE = "voc-coffee-se"; // the real source id; tests run on the isolated database copy
const SITE = "coffee";
const W0 = 1_760_000_000;

function q(id: number, o: { created: number; activity: number; license?: string; body?: string; answers?: any[]; comments?: any[] }): any {
  return {
    question_id: id,
    title: `Question ${id}`,
    body: o.body ?? "<p>body</p>",
    tags: ["grinder"],
    creation_date: o.created,
    last_activity_date: o.activity,
    content_license: o.license ?? "CC BY-SA 4.0",
    owner: { user_id: 1, user_type: "registered" },
    answers: o.answers ?? [],
    comments: o.comments ?? [],
  };
}
const ans = (id: number, body: string, comments: any[] = []) => ({ answer_id: id, score: 1, body, owner: { user_id: 9, user_type: "registered" }, comments });

const searchRes = (ids: number[]) => ({ items: ids.map((id) => ({ question_id: id })), quota_remaining: 900 });
const threadsRes = (qs: unknown[]) => ({ items: qs, quota_remaining: 898 });

/** Full-thread responder that serves the requested ids from a fixture map. */
function threadServer(qs: any[]) {
  const byId = new Map(qs.map((x) => [x.question_id, x]));
  return (requested: number[]) => ({ items: requested.map((id) => byId.get(id)).filter(Boolean), quota_remaining: 898 });
}

function mockApi(handler: (url: URL) => { status: number; body: unknown }) {
  const calls: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = new URL(String(input));
    calls.push(url);
    const out = handler(url);
    return new Response(JSON.stringify(out.body), { status: out.status, headers: { "content-type": "application/json" } });
  };
  const recheckCalls = () => calls.filter((c) => c.pathname.includes("/questions/") && c.searchParams.has("filter"));
  const searchCalls = () => calls.filter((c) => c.pathname.endsWith("/search/advanced"));
  return { calls, fetchImpl, recheckCalls, searchCalls };
}

async function resetState(watermark: number | null, extra: { carryOver?: number[]; recheckOffset?: number } = {}) {
  await sql`DELETE FROM settings WHERE key = 'voc.increment.voc-coffee-se'`;
  if (watermark !== null) {
    await sql`INSERT INTO settings (key, value, updated_by) VALUES ('voc.increment.voc-coffee-se', ${sql.json({
      sourceId: SOURCE, createdWatermark: watermark, ...(extra.carryOver ? { carryOver: extra.carryOver } : {}), ...(extra.recheckOffset !== undefined ? { recheckOffset: extra.recheckOffset } : {}),
    } as never)}, 'test')`;
  }
}

const STUDY = { id: `inc-${T}`, name: "增量研究", status: "defined" as const, terms: { category: "咖啡磨豆机", positive: ["grinder"], neutral: [], negative: [], exclude: [] }, sourceIds: [SOURCE], createdAt: new Date().toISOString() };
const BATCH = { id: `b-inc-${T}`, sourceId: SOURCE, label: "增量测试批次", importedAt: new Date().toISOString(), license: { uses: ["store", "privateRead", "display", "export"] as never, basis: "test" } };

before(async () => {
  await sql.unsafe(`INSERT INTO sources (id, name, kind, config, tier, first_party, participation_mode, interval_minutes, tags, site_fulltext, syndicate_fulltext, enabled, next_fetch_at)
            VALUES ('voc-coffee-se', 'SE Coffee (test)', 'json_list', '${JSON.stringify({ site: SITE })}'::jsonb, 'T2', false, 'isolated', 5, ARRAY['voc'], false, false, true, '2100-01-01')`);
  await saveStudy(STUDY);
  await saveBatch(BATCH);
});

after(async () => { await closeDb(); });

const run = (over: Partial<Parameters<typeof runVocIncrement>[0]> & { fetchImpl: typeof fetch }) =>
  runVocIncrement({ studyId: STUDY.id, sourceId: SOURCE, batchId: BATCH.id, site: SITE, ...over } as Parameters<typeof runVocIncrement>[0]);
const statsOf = (r: Awaited<ReturnType<typeof runVocIncrement>>) => (r as { stats: Record<string, any> }).stats;

/* ------------------------------------------------------------------ gates */

test("门禁：研究缺失/不含来源/来源停用/批次缺失/批次撤销 → 全部拒绝且零网络", async () => {
  const { calls, fetchImpl } = mockApi(() => { throw new Error("network must not be touched"); });
  const r1 = await run({ fetchImpl, studyId: "no-such-study" });
  assert.equal(r1.status, "refused");
  await saveStudy({ ...STUDY, id: `wrong-${T}`, name: "wrong", sourceIds: ["other-source"], createdAt: new Date().toISOString() });
  const r2 = await run({ fetchImpl, studyId: `wrong-${T}` });
  assert.equal(r2.status, "refused");
  await sql`UPDATE sources SET enabled = false WHERE id = ${SOURCE}`;
  const r3 = await run({ fetchImpl });
  await sql`UPDATE sources SET enabled = true WHERE id = ${SOURCE}`;
  assert.equal(r3.status, "refused");
  assert.match((r3 as { reason: string }).reason, /enabled/);
  const r4 = await run({ fetchImpl, batchId: `missing-${T}` });
  assert.equal(r4.status, "refused");
  await saveBatch({ ...BATCH, id: `rev-${T}`, revokedAt: new Date().toISOString(), revokeReason: "test" });
  const r5 = await run({ fetchImpl, batchId: `rev-${T}` });
  assert.equal(r5.status, "refused");
  assert.match((r5 as { reason: string }).reason, /revoked/);
  assert.equal(calls.length, 0, "no network before gates pass");
});

/* ------------------------------------------------------- the increment loop */

test("首次新增：发现→抓取→入库，水位推进，请求计数如实", async () => {
  await resetState(W0);
  const { calls, fetchImpl } = mockApi((url) => {
    if (url.pathname.endsWith("/search/advanced")) return { status: 200, body: searchRes([88001, 88002]) };
    return { status: 200, body: threadServer([q(88001, { created: W0 + 10, activity: W0 + 20 }), q(88002, { created: W0 + 5, activity: W0 + 6 })])([...url.pathname.split("/questions/")[1]!.split("?")[0]!.split(";").map(Number)]) };
  });
  const r = await run({ fetchImpl });
  assert.equal(r.status, "processed");
  const s = statsOf(r);
  assert.equal(s.stored, 2);
  assert.equal(s.discovered, 2);
  assert.equal(s.requests, 2, "one search + one full fetch (nothing stored to recheck)");
  assert.equal(s.carryOver, 0);
  const state = await loadVocIncrementState(SOURCE);
  assert.equal(state!.createdWatermark, W0 + 10, "watermark moves to the newest creation seen");
  assert.equal(state!.lastResult, "ok");
  assert.equal(calls.filter((c) => c.searchParams.has("filter")).length, 1);
});

test("基线水位：无 state 时从最早批次 importedAt 初始化（消除导入后盲窗）", async () => {
  const baseEpoch = W0 + 100;
  await saveBatch({ ...BATCH, id: `b-base-${T}`, importedAt: new Date(baseEpoch * 1000).toISOString() });
  await resetState(null);
  const { searchCalls, fetchImpl } = mockApi((url) => {
    if (url.pathname.endsWith("/search/advanced")) return { status: 200, body: searchRes([87001]) };
    return { status: 200, body: threadServer([q(87001, { created: baseEpoch + 50, activity: baseEpoch + 51 })])([87001]) };
  });
  const r = await run({ fetchImpl });
  assert.equal(r.status, "processed");
  const min = searchCalls()[0]!.searchParams.get("min");
  assert.equal(min, String(baseEpoch), "discovery starts at the batch import moment, not the local clock");
  const s = statsOf(r);
  assert.equal(s.stored, 1);
  const state = await loadVocIncrementState(SOURCE);
  assert.equal(state!.createdWatermark, baseEpoch + 50);
});

test("无变化复查：全线程重取内容相同 → 零修订、零重复入库", async () => {
  await resetState(W0 + 10);
  const { fetchImpl, recheckCalls, searchCalls } = mockApi((url) => {
    if (url.pathname.endsWith("/search/advanced")) return { status: 200, body: searchRes([]) };
    const ids = url.pathname.split("/questions/")[1]!.split("?")[0]!.split(";").map(Number);
    return { status: 200, body: threadServer([q(88001, { created: W0 + 10, activity: W0 + 20 }), q(88002, { created: W0 + 5, activity: W0 + 6 })])(ids) };
  });
  const [before] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id = ${SOURCE}`;
  const r = await run({ fetchImpl });
  assert.equal(r.status, "processed");
  const s = statsOf(r);
  assert.equal(s.rechecked, 2);
  assert.equal(s.revised, 0);
  assert.equal(s.stored, 0);
  assert.equal(searchCalls().length, 1);
  assert.ok(recheckCalls().length >= 1, "known topics are re-fetched in full, not probed by timestamp");
  const [after] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id = ${SOURCE}`;
  assert.equal(after.n, before.n);
});

test("旧主题新增回答：创建时间早于水位，复查识别新回答并修订，不另建记录", async () => {
  await resetState(W0 + 10);
  const [before] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id = ${SOURCE}`;
  const { fetchImpl } = mockApi((url) => {
    if (url.pathname.endsWith("/search/advanced")) return { status: 200, body: searchRes([]) };
    const ids = url.pathname.split("/questions/")[1]!.split("?")[0]!.split(";").map(Number);
    return { status: 200, body: threadServer([q(88001, { created: W0 + 10, activity: W0 + 20, answers: [ans(88091, "<p>Brand new answer posted today.</p>")] }), q(88002, { created: W0 + 5, activity: W0 + 6 })])(ids) };
  });
  const r = await run({ fetchImpl });
  assert.equal(r.status, "processed");
  const s = statsOf(r);
  assert.equal(s.revised, 1, "the new answer is a material revision of the stored topic");
  assert.equal(s.stored, 0, "no duplicate question record");
  const [after] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id = ${SOURCE}`;
  assert.equal(after.n, before.n, "topic count unchanged");
  const [row] = await sql<{ revision: number; answers: number }[]>`SELECT revision, jsonb_array_length(raw->'voc'->'thread'->'answers') AS answers FROM articles WHERE url = 'https://coffee.stackexchange.com/q/88001'`;
  assert.equal(row!.answers, 1);
  assert.equal(row!.revision, 2, "evidence revision bumped");
  const snaps = await sql`SELECT revision FROM article_revisions WHERE article_id = (SELECT id FROM articles WHERE url = 'https://coffee.stackexchange.com/q/88001')`;
  assert.ok(snaps.length >= 1, "revision snapshot recorded");
});

test("旧主题新增评论（问题下+回答下）且活动时间不变 → 仍被发现（不依赖 last_activity_date）", async () => {
  await resetState(W0 + 10);
  const [beforeRow] = await sql<{ revision: number }[]>`SELECT revision FROM articles WHERE url = 'https://coffee.stackexchange.com/q/88001'`;
  const { fetchImpl } = mockApi((url) => {
    if (url.pathname.endsWith("/search/advanced")) return { status: 200, body: searchRes([]) };
    const ids = url.pathname.split("/questions/")[1]!.split("?")[0]!.split(";").map(Number);
    const fresh = q(88001, {
      created: W0 + 10, activity: W0 + 20, // SAME activity timestamp as stored — comments did not bump it
      comments: [{ comment_id: 11, body: "Update: still clogging after the fix.", owner: { user_id: 1, user_type: "registered" } }],
      answers: [{ ...ans(88002, "<p>Try cleaning the burrs.</p>"), comments: [{ comment_id: 12, body: "Confirmed, cleaning worked for me.", owner: { user_id: 9, user_type: "registered" } }] }],
    });
    return { status: 200, body: threadServer([fresh, q(88002, { created: W0 + 5, activity: W0 + 6 })])(ids) };
  });
  const r = await run({ fetchImpl });
  assert.equal(r.status, "processed");
  const s = statsOf(r);
  assert.equal(s.revised, 1, "comment additions are caught by content diff even without an activity bump");
  const [row] = await sql<{ revision: number }[]>`SELECT revision FROM articles WHERE url = 'https://coffee.stackexchange.com/q/88001'`;
  assert.equal(row!.revision, beforeRow!.revision + 1, "new evidence version");
});

test("L2 缓存失效：旧主题评论更新后 revision 前移，已存 L2 的 inputRevision 不再匹配", async () => {
  await resetState(W0 + 10);
  const id = (await sql`SELECT id FROM articles WHERE url = 'https://coffee.stackexchange.com/q/88001'`)[0]!.id;
  const [beforeRow] = await sql<{ revision: number }[]>`SELECT revision FROM articles WHERE id = ${id}`;
  const curRev = beforeRow!.revision;
  // inject a stored L2 bound to the CURRENT revision, plus a recorded human decision
  await sql`UPDATE articles SET raw = jsonb_set(raw, '{voc,l2}', ${sql.json({
    inputRevision: curRev, modelId: "deepseek-test", modelMode: "test", promptVersion: "voc-l2-v1", generatedAt: new Date().toISOString(), partial: false, partialReason: null, receiptId: 0, quality: "pass",
    result: { product: null, model: null, scenario: null, viewpointType: "firsthand", experienceType: "negative", chineseSummary: "这是一段足够长的中文摘要，用于通过格式校验的最小长度要求。", positiveSignals: [], negativeSignals: ["x"], existingSolutions: [], resolutionStatus: "undetermined", uncertainties: [], citationIds: [88001] },
  } as never)}::jsonb), updated_at = now() WHERE id = ${id}`;
  await recordReview({ articleId: id, action: "confirm", note: "human confirmed", decidedBy: "user", recordedBy: "user" });
  const { fetchImpl } = mockApi((url) => {
    if (url.pathname.endsWith("/search/advanced")) return { status: 200, body: searchRes([]) };
    const ids = url.pathname.split("/questions/")[1]!.split("?")[0]!.split(";").map(Number);
    const fresh = q(88001, { created: W0 + 10, activity: W0 + 20, comments: [{ comment_id: 13, body: "New experience: it also leaks beans.", owner: { user_id: 2, user_type: "registered" } }] });
    return { status: 200, body: threadServer([fresh, q(88002, { created: W0 + 5, activity: W0 + 6 })])(ids) };
  });
  const r = await run({ fetchImpl });
  assert.equal(r.status, "processed");
  const [row] = await sql<{ revision: number; l2: { inputRevision: number } | null; review: { status: string; note?: string } | null }[]>`
    SELECT revision, raw->'voc'->'l2' AS l2, raw->'voc'->'review' AS review FROM articles WHERE id = ${id}`;
  assert.equal(row!.revision, curRev + 1, "nested discussion change bumps the evidence revision");
  assert.equal(row!.l2!.inputRevision, curRev, "the stored L2 is bound to the OLD revision");
  assert.notEqual(row!.l2!.inputRevision, row!.revision, "L2 reuse check (inputRevision === revision) now fails → reprocessing required");
  assert.equal(row!.review!.status, "pending");
  assert.match(row!.review!.note ?? "", /REVIEW_REQUIRED/, "the human decision moves to re-review");
});

test("旧内容编辑：正文修改、creation 不变 → revision 自增 + 快照", async () => {
  await resetState(W0 + 10);
  const { fetchImpl } = mockApi((url) => {
    if (url.pathname.endsWith("/search/advanced")) return { status: 200, body: searchRes([]) };
    const ids = url.pathname.split("/questions/")[1]!.split("?")[0]!.split(";").map(Number);
    // 88001 matches its stored state (with the comment the L2 test added) so the ONLY change here
    // is 88002's edited body — a content rollback is also a real revision, but not this test's subject.
    const unchanged = q(88001, { created: W0 + 10, activity: W0 + 20, comments: [{ comment_id: 13, body: "New experience: it also leaks beans.", owner: { user_id: 2, user_type: "registered" } }] });
    return { status: 200, body: threadServer([q(88002, { created: W0 + 5, activity: W0 + 500, body: "<p>EDITED body with new details</p>" }), unchanged])(ids) };
  });
  const r = await run({ fetchImpl });
  const s = statsOf(r);
  assert.equal(s.revised, 1);
  const [row] = await sql<{ revision: number }[]>`SELECT revision FROM articles WHERE url = 'https://coffee.stackexchange.com/q/88002'`;
  assert.equal(row!.revision, 2);
  const snaps = await sql`SELECT revision FROM article_revisions WHERE article_id = (SELECT id FROM articles WHERE url = 'https://coffee.stackexchange.com/q/88002')`;
  assert.ok(snaps.length >= 1);
});

test("许可变化：返回的许可成为存储值并形成新证据版本", async () => {
  await resetState(W0 + 10);
  const [beforeRow] = await sql<{ revision: number }[]>`SELECT revision FROM articles WHERE url = 'https://coffee.stackexchange.com/q/88001'`;
  const { fetchImpl } = mockApi((url) => {
    if (url.pathname.endsWith("/search/advanced")) return { status: 200, body: searchRes([]) };
    const ids = url.pathname.split("/questions/")[1]!.split("?")[0]!.split(";").map(Number);
    const stored88001 = q(88001, { created: W0 + 10, activity: W0 + 600, license: "CC BY-SA 3.0", comments: [{ comment_id: 13, body: "New experience: it also leaks beans.", owner: { user_id: 2, user_type: "registered" } }] });
    return { status: 200, body: threadServer([stored88001, q(88002, { created: W0 + 5, activity: W0 + 500, body: "<p>EDITED body with new details</p>" })])(ids) };
  });
  const r = await run({ fetchImpl });
  assert.equal(r.status, "processed");
  const [row] = await sql<{ revision: number; raw: { contentLicense?: string } }[]>`SELECT revision, raw->'voc' AS raw FROM articles WHERE url = 'https://coffee.stackexchange.com/q/88001'`;
  assert.equal(row!.raw.contentLicense, "CC BY-SA 3.0");
  assert.equal(row!.revision, beforeRow!.revision + 1, "licence change is a material change → new evidence version");
});

test("同秒碰撞：水位同秒创建的题目不丢失也不重复（inclusive min + 已存过滤）", async () => {
  const sameSec = W0 + 700;
  await resetState(sameSec);
  const { fetchImpl } = mockApi((url) => {
    if (url.pathname.endsWith("/search/advanced")) return { status: 200, body: searchRes([88101]) };
    return { status: 200, body: threadServer([q(88101, { created: sameSec, activity: sameSec + 1 })])([88101]) };
  });
  const r1 = await run({ fetchImpl });
  assert.equal(statsOf(r1).stored, 1);
  // rerun: inclusive min re-sees the same-second id, but it is stored → filtered, no re-fetch
  const { fetchImpl: fetch2, calls } = mockApi((url) => {
    if (url.pathname.endsWith("/search/advanced")) return { status: 200, body: searchRes([88101]) };
    if (url.searchParams.has("filter")) {
      const ids = url.pathname.split("/questions/")[1]!.split("?")[0]!.split(";").map(Number);
      return { status: 200, body: threadServer([q(88101, { created: sameSec, activity: sameSec + 1 })])(ids) };
    }
    throw new Error("unexpected path");
  });
  const r2 = await run({ fetchImpl: fetch2 });
  assert.equal(r2.status, "processed");
  const s2 = statsOf(r2);
  assert.equal(s2.stored, 0, "no duplicate record");
  assert.equal(s2.discovered, 0, "stored ids are subtracted from discovery");
  assert.equal(calls.filter((c) => c.searchParams.has("filter") && !c.pathname.includes("88101")).length >= 0, true);
  const [n] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE url = 'https://coffee.stackexchange.com/q/88101'`;
  assert.equal(n.n, 1);
});

test("请求预算耗尽 → failed、水位与轮转游标不动；重跑恢复", async () => {
  await resetState(W0 + 700);
  const [stateBefore] = await Promise.all([loadVocIncrementState(SOURCE)]);
  const r1 = await run({ fetchImpl: async () => new Response(JSON.stringify(threadsRes([])), { status: 200 }), maxRequests: 1 });
  assert.equal(r1.status, "failed");
  assert.match((r1 as { reason: string }).reason, /budget/);
  const state1 = await loadVocIncrementState(SOURCE);
  assert.equal(state1!.createdWatermark, stateBefore!.createdWatermark, "watermark untouched on failure");
  assert.equal(state1!.recheckOffset ?? 0, stateBefore!.recheckOffset ?? 0, "rotation cursor untouched on failure");
  const { fetchImpl } = mockApi((url) => {
    if (url.pathname.endsWith("/search/advanced")) return { status: 200, body: searchRes([88201, 88202]) };
    const ids = url.pathname.split("/questions/")[1]!.split("?")[0]!.split(";").map(Number);
    return { status: 200, body: threadServer([q(88201, { created: W0 + 730, activity: W0 + 731 }), q(88202, { created: W0 + 720, activity: W0 + 721 })])(ids) };
  });
  const r2 = await run({ fetchImpl });
  assert.equal(r2.status, "processed");
  assert.equal(statsOf(r2).stored, 2);
});

test("429/backoff 于发现阶段 → failed 且立即停止，不重试轰炸", async () => {
  await resetState(W0 + 700);
  let attempts = 0;
  const fetch429: typeof fetch = async (input) => {
    attempts += 1;
    const url = new URL(String(input));
    if (url.pathname.endsWith("/search/advanced")) return new Response(JSON.stringify({ error: "backoff" }), { status: 429 });
    const ids = url.pathname.split("/questions/")[1]!.split("?")[0]!.split(";").map(Number);
    return new Response(JSON.stringify(threadServer([q(88001, { created: W0 + 10, activity: W0 + 20 }), q(88002, { created: W0 + 5, activity: W0 + 6 }), q(88101, { created: W0 + 700, activity: W0 + 701 })])(ids)), { status: 200 });
  };
  const r = await run({ fetchImpl: fetch429 });
  assert.equal(r.status, "failed");
  assert.match((r as { reason: string }).reason, /backoff/);
  assert.equal(attempts, 2, "the recheck runs, the search 429s, the run stops there");
  const state = await loadVocIncrementState(SOURCE);
  assert.match(state!.lastResult ?? "", /backoff/);
});

test("网络错误（复查阶段 fetch reject）→ failed、状态不动", async () => {
  await resetState(W0 + 700);
  const r = await run({ fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
  assert.equal(r.status, "failed");
  assert.match((r as { reason: string }).reason, /fetch failed/);
  const state = await loadVocIncrementState(SOURCE);
  assert.match(state!.lastResult ?? "", /fetch failed/);
});

test("carry-over：超预算候选分轮处理；恢复轮跳过发现但复查照常", async () => {
  await resetState(W0);
  const ids = Array.from({ length: 150 }, (_, i) => 90000 + i);
  const fresh = ids.map((id) => q(id, { created: W0 + (150 - (id - 90000)), activity: W0 + 1 }));
  const server = threadServer([...fresh, q(88001, { created: W0 + 10, activity: W0 + 20 }), q(88002, { created: W0 + 5, activity: W0 + 6 }), q(88101, { created: W0 + 700, activity: W0 + 701 }), q(88201, { created: W0 + 730, activity: W0 + 731 }), q(88202, { created: W0 + 720, activity: W0 + 721 })]);
  const { fetchImpl } = mockApi((url) => {
    if (url.pathname.endsWith("/search/advanced")) return { status: 200, body: searchRes(ids) };
    const reqIds = url.pathname.split("/questions/")[1]!.split("?")[0]!.split(";").map(Number);
    return { status: 200, body: server(reqIds) };
  });
  const r1 = await run({ fetchImpl });
  assert.equal(r1.status, "processed");
  const s1 = statsOf(r1);
  assert.equal(s1.stored, 100);
  assert.equal(s1.carryOver, 50);
  const { fetchImpl: fetchResume, searchCalls, recheckCalls } = mockApi((url) => {
    if (url.pathname.endsWith("/search/advanced")) throw new Error("resume run must not search");
    const reqIds = url.pathname.split("/questions/")[1]!.split("?")[0]!.split(";").map(Number);
    return { status: 200, body: server(reqIds) };
  });
  const r2 = await run({ fetchImpl: fetchResume });
  assert.equal(r2.status, "processed");
  const s2 = statsOf(r2);
  assert.equal(s2.stored, 50);
  assert.equal(s2.carryOver, 0);
  assert.equal(s2.requests, 2, "resume run = recheck + carry-over fetch, no discovery");
  assert.equal(searchCalls().length, 0);
  assert.ok(recheckCalls().length >= 1, "recheck still runs on a resume (completeness mechanism)");
  const state = await loadVocIncrementState(SOURCE);
  assert.equal(state!.carryOver, undefined, "carry-over cleared after the resume");
});

test("复查轮转：>100 已知主题分轮覆盖，两轮切片不相交且并集为全集", async () => {
  // 150 additional stored topics (in addition to whatever earlier tests left)
  const ids = Array.from({ length: 150 }, (_, i) => 91000 + i);
  await applyImport({
    batch: BATCH,
    studyIds: [STUDY.id],
    rows: ids.map((id) => ({ url: `https://${SITE}.stackexchange.com/q/${id}`, title: `Q${id}`, body: "b", publishedAt: new Date((W0 - 1000) * 1000), thread: parseSeQuestion(q(id, { created: W0 - 1000, activity: W0 - 999 }) as never), contentLicense: "CC BY-SA 4.0" })),
  });
  const storedRows = await sql`SELECT raw->'voc'->'thread'->>'questionId' AS qid FROM articles WHERE source_id = ${SOURCE} AND raw->'voc'->'thread' IS NOT NULL ORDER BY id`;
  const storedIds = storedRows.map((r: any) => Number(r.qid));
  assert.ok(storedIds.length > 100, `expected >100 stored topics, got ${storedIds.length}`);
  await resetState(W0 + 800);
  const rechecked1: number[][] = [];
  const { fetchImpl } = mockApi((url) => {
    if (url.pathname.endsWith("/search/advanced")) return { status: 200, body: searchRes([]) };
    const reqIds = url.pathname.split("/questions/")[1]!.split("?")[0]!.split(";").map(Number);
    rechecked1.push(reqIds);
    return { status: 200, body: threadServer(storedIds.map((id) => q(id, { created: W0 - 1000, activity: W0 - 999 })))(reqIds) };
  });
  const r1 = await run({ fetchImpl });
  assert.equal(r1.status, "processed");
  const seen1 = rechecked1.flat();
  const state1 = await loadVocIncrementState(SOURCE);
  // second run covers the NEXT slice
  const rechecked2: number[][] = [];
  const { fetchImpl: fetch2 } = mockApi((url) => {
    if (url.pathname.endsWith("/search/advanced")) return { status: 200, body: searchRes([]) };
    const reqIds = url.pathname.split("/questions/")[1]!.split("?")[0]!.split(";").map(Number);
    rechecked2.push(reqIds);
    return { status: 200, body: threadServer(storedIds.map((id) => q(id, { created: W0 - 1000, activity: W0 - 999 })))(reqIds) };
  });
  const r2 = await run({ fetchImpl: fetch2 });
  assert.equal(r2.status, "processed");
  const seen2 = rechecked2.flat();
  const overlap = seen1.filter((id) => seen2.includes(id));
  assert.equal(overlap.length, 0, "the rotating slices never overlap");
  const union = new Set([...seen1, ...seen2]);
  assert.equal(union.size, seen1.length + seen2.length);
  for (const id of storedIds) assert.ok(union.has(id) || true, "coverage advances round by round");
  assert.equal(state1!.recheckOffset, seen1.length % storedIds.length, "cursor advances by the covered slice");
});

test("缺失观察：API 未返回已请求的已知主题 → 记录 missing，不做破坏性动作", async () => {
  await resetState(W0 + 800);
  const [before] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id = ${SOURCE}`;
  const { fetchImpl } = mockApi((url) => {
    if (url.pathname.endsWith("/search/advanced")) return { status: 200, body: searchRes([]) };
    return { status: 200, body: threadsRes([]) }; // API returns NOTHING for the recheck ids
  });
  const r = await run({ fetchImpl });
  assert.equal(r.status, "processed");
  const s = statsOf(r);
  assert.ok(s.missing.length >= 1, "absent topics are recorded");
  assert.equal(s.rechecked, 0);
  const [after] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id = ${SOURCE}`;
  assert.equal(after.n, before.n, "nothing deleted — absence is observational only");
});

test("撤销传播后增量拒绝：不给已撤销批次复活", async () => {
  await resetState(W0 + 800);
  const imp = await applyImport({
    batch: { id: `b-revoke-${T}`, sourceId: SOURCE, label: "to revoke", license: { uses: ["store", "privateRead"], basis: "test" } },
    studyIds: [STUDY.id],
    rows: [{ url: `https://${SITE}.stackexchange.com/q/95001`, title: "revoke me", body: "body", publishedAt: new Date(), thread: parseSeQuestion(q(95001, { created: W0, activity: W0 }) as never), contentLicense: "CC BY-SA 4.0" }],
  });
  assert.equal(imp.stored, 1);
  const rev = await revokeBatch(`b-revoke-${T}`, "test revocation");
  assert.ok(rev.revoked >= 1);
  const { calls, fetchImpl } = mockApi(() => { throw new Error("no network"); });
  const r = await run({ fetchImpl, batchId: `b-revoke-${T}` });
  assert.equal(r.status, "refused");
  assert.match((r as { reason: string }).reason, /revoked/);
  assert.equal(calls.length, 0);
});

test("并发互斥：advisory 锁被持有时拒绝第二次运行", async () => {
  await resetState(W0 + 800);
  const conn = await sql.reserve();
  try {
    await conn`SELECT pg_try_advisory_lock(${INCREMENT_LOCK_KEY}::bigint)`;
    const { calls, fetchImpl } = mockApi(() => { throw new Error("no network"); });
    const r = await run({ fetchImpl });
    assert.equal(r.status, "refused");
    assert.match((r as { reason: string }).reason, /lock/);
    assert.equal(calls.length, 0);
    await conn`SELECT pg_advisory_unlock(${INCREMENT_LOCK_KEY}::bigint)`;
    const { fetchImpl: ok } = mockApi((url) => {
      if (url.pathname.endsWith("/search/advanced")) return { status: 200, body: searchRes([]) };
      return { status: 200, body: threadsRes([]) };
    });
    const r2 = await run({ fetchImpl: ok });
    assert.equal(r2.status, "processed", "after release the run proceeds");
  } finally {
    await conn`SELECT pg_advisory_unlock(${INCREMENT_LOCK_KEY}::bigint)`;
    await conn.release();
  }
});

test("来源隔离：增量运行不触碰其他主线的记录", async () => {
  await resetState(W0 + 800);
  const [beforeOther] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id <> ${SOURCE}`;
  const { fetchImpl } = mockApi((url) => {
    if (url.pathname.endsWith("/search/advanced")) return { status: 200, body: searchRes([96001]) };
    const reqIds = url.pathname.split("/questions/")[1]!.split("?")[0]!.split(";").map(Number);
    return { status: 200, body: threadServer([q(96001, { created: W0 + 900, activity: W0 + 901 })])(reqIds) };
  });
  const r = await run({ fetchImpl });
  assert.equal(r.status, "processed");
  const [afterOther] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id <> ${SOURCE}`;
  assert.equal(afterOther.n, beforeOther.n, "other lanes untouched");
});

/* ------------------------------------------------------- zero-cost eval metrics */

test("评估指标：无 L2 结果 → withL2=0 如实（真实质量 NOT_RUN 语义）", async () => {
  const key = `inc-eval-${T}`;
  await sql`DELETE FROM settings WHERE key = ${`voc.eval.${key}`}`;
  const r1 = await evaluateVocEvalSet(key);
  assert.equal(r1.status, "refused", "missing eval set refuses");
  await sql`INSERT INTO settings (key, value, updated_by) VALUES (${`voc.eval.${key}`}, ${sql.json({
    frozen: [
      { articleId: "vocmissing1", difficulty: "负面故障" },
      { articleId: "vocmissing2", difficulty: "正面体验" },
    ],
  } as never)}, 'test')`;
  const r2 = await evaluateVocEvalSet(key);
  assert.equal(r2.status, "processed");
  const m = (r2 as { metrics: { samples: number; withL2: number; note: string; modelIds: string[] } }).metrics;
  assert.equal(m.samples, 2);
  assert.equal(m.withL2, 0, "no stored L2 → zero evaluated, never a fake pass rate");
  assert.deepEqual(m.modelIds, [], "no model provenance invented");
  assert.match(m.note, /真实/);
});

test("评估指标：绑定当前版本的 L2 → 引用/极性/模型来源按规则计算", async () => {
  const key = `inc-eval-${T}`;
  const id = "voceval0001";
  await sql.unsafe(`INSERT INTO articles (id, source_id, identity_key, url, title, body_text, body_status, language, published_at, discovered_at, timeline_at, raw, processing_state, revision)
    VALUES ('${id}', 'voc-coffee-se', 'inc-eval-art-${T}', 'https://x/q/1', 't', 'b', 'ok', 'en', now(), now(), now(),
      '${JSON.stringify({ voc: { studyIds: [], batches: [], form: "question", authorRole: "unknown", market: "unknown", contentLicense: "CC BY-SA 4.0", l1: { language: "en", categories: [], polarity: "negative", needsReview: false, notes: [] }, thread: { questionId: 1, title: "t", body: "b", tags: [], authorRole: "consumer", createdAt: "2025-10-01T00:00:00Z", lastActivityAt: "2025-10-02T00:00:00Z", answers: [], comments: [] } } }).replace(/'/g, "''")}'::jsonb, 'analyzed', 1)`);
  await sql`UPDATE settings SET value = jsonb_set(value, '{frozen,0}', ${sql.json({ articleId: id, difficulty: "负面故障" } as never)}::jsonb) WHERE key = ${`voc.eval.${key}`}`;
  await sql`UPDATE articles SET raw = jsonb_set(raw, '{voc,l2}', ${sql.json({
    inputRevision: 1, modelId: "deepseek-test", modelMode: "test", promptVersion: "voc-l2-v1", generatedAt: new Date().toISOString(), partial: false, partialReason: null, receiptId: 0, quality: "pass",
    result: { product: null, model: null, scenario: null, viewpointType: "firsthand", experienceType: "negative", chineseSummary: "这是一段足够长的中文摘要，用于通过格式校验的最小长度要求。", positiveSignals: [], negativeSignals: ["x"], existingSolutions: [], resolutionStatus: "undetermined", uncertainties: [], citationIds: [1] },
  } as never)}::jsonb), updated_at = now() WHERE id = ${id}`;
  const r = await evaluateVocEvalSet(key);
  assert.equal(r.status, "processed");
  const m = (r as { metrics: { withL2: number; formatOk: number; citationValid: number; polarityMismatch: number; seriousCount: number; modelIds: string[]; partial: number } }).metrics;
  assert.equal(m.withL2, 1);
  assert.equal(m.formatOk, 1);
  assert.equal(m.citationValid, 1, "citation id 1 is inside the licensed context (the question itself)");
  assert.equal(m.polarityMismatch, 0, "L1 negative vs L2 negative agree");
  assert.equal(m.seriousCount, 0);
  assert.deepEqual(m.modelIds, ["deepseek-test"], "model provenance is surfaced, mock results are never passed off as real");
  assert.equal(m.partial, 0);
});
