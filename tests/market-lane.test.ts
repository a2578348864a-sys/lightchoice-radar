// The market lane's contract tests — isolated database copy, no network, no model calls.
// Covers R1 foundations (identity/idempotence/revisions/permissions), R2 adapters (gates,
// validation, dedupe), R3 metrics (C1–C12 boundaries), R4 opportunities (score refusal, review
// binding, scenarios, alerts dedup) and cross-lane isolation.
//   node --test-global-setup=tests/databases.ts --import ./tests/databases.ts --test tests/market-lane.test.ts
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

process.env.RADAR_RUN_DIR = mkdtempSync(path.join(tmpdir(), "market-lane-"));

const { sql, closeDb } = await import("@aihot/backend/db");
const { saveMarketSource, sourceAllows, loadMarketSources } = await import("@aihot/backend/market/market-model");
const {
  applyChartSnapshot, applyKeywordSnapshot, parseAmz123KeywordCapture, parseAmazonChartCapture,
  seedMarketSources, defaultMarketSources,
} = await import("@aihot/backend/market/market-import");
const {
  brandDistribution, chartRankChanges, comparableChartPair, comparablePrice, keywordChanges,
  keywordSeries, priceChangeRate, trendsSpliceable, detectMarketSignals, trendVerdict,
} = await import("@aihot/backend/market/market-metrics");
const {
  buildOpportunityCandidates, computeScenarios, evaluateAlerts, reviewOpportunity, scoreOpportunity,
} = await import("@aihot/backend/market/market-opportunity");
const { loadMarketOverview, loadKeywordView, loadProductView } = await import("@aihot/backend/market/market-read");
const { loadMarketOpportunities, saveMarketAlertRule, loadMarketAlerts } = await import("@aihot/backend/market/market-model");

const KW_SOURCE = "test-amz123";
const CHART_SOURCE = "test-amz-chart";

before(async () => {
  await saveMarketSource({
    id: KW_SOURCE, kind: "amz123-keywords", label: "测试关键词源", producer: "Amazon ABA（测试二手展示）", marketplace: "US",
    permission: { uses: ["store", "compute", "display", "export"], basis: "test", evidence: "L3" },
    enabled: true, automation: "manual-import-only",
  });
  await saveMarketSource({
    id: CHART_SOURCE, kind: "amazon-chart-manual", label: "测试榜单源", producer: "Amazon（测试）", marketplace: "US",
    permission: { uses: ["store", "compute", "display"], basis: "test", evidence: "L3" },
    enabled: true, automation: "manual-import-only",
  });
});

after(async () => { await closeDb(); });

const kwInput = (periodStart: string, rows: Array<[string, number, number | null]>) => ({
  sourceId: KW_SOURCE, periodStart, periodEnd: periodStart, sourceUpdatedAt: periodStart, observedAt: `${periodStart}T12:00:00Z`,
  rows: rows.map(([keyword, a, b]) => ({ keyword, rankThisWeek: a, rankLastWeek: b })),
});

/* --------------------------------------------------------------- R2 adapters */

test("适配器校验：非法 ASIN / 排名越界 / 重复关键词 → 拒绝导入", () => {
  assert.throws(() => parseAmazonChartCapture({ sourceId: CHART_SOURCE, chartId: "c1", chartKind: "bestsellers", categoryLabel: "Beauty", observedAt: "2026-10-26T00:00:00Z", complete: true, rows: [{ asin: "NOT_A_VALID", chartRank: 1, price: "$1", title: "x" }] }), /非法 ASIN/);
  assert.throws(() => parseAmz123KeywordCapture(kwInput("2026-10-20", [["a", 0, 1]]), "p"), /非法行/);
  assert.throws(() => parseAmz123KeywordCapture(kwInput("2026-10-20", [["a", 1, 2], ["a", 3, 4]]), "p"), /重复词/);
});

test("权限门禁：未注册 / 未启用 / 许可缺 store 或 compute → 拒绝且零写入", async () => {
  const snap = parseAmz123KeywordCapture(kwInput("2026-10-20", [["alpha", 10, 20]]), "p");
  const r1 = await applyKeywordSnapshot({ ...snap, sourceId: "no-such-source" });
  assert.match(r1.refusal!, /未注册/);
  await saveMarketSource({ id: "off-src", kind: "generic-import", label: "off", producer: "x", marketplace: "US", permission: { uses: ["store", "compute"], basis: "t", evidence: "L1" }, enabled: false, automation: "manual-import-only" });
  const r2 = await applyKeywordSnapshot({ ...snap, sourceId: "off-src" });
  assert.match(r2.refusal!, /未启用/);
  await saveMarketSource({ id: "no-store", kind: "generic-import", label: "ns", producer: "x", marketplace: "US", permission: { uses: ["compute"], basis: "t", evidence: "L1" }, enabled: true, automation: "manual-import-only" });
  const r3 = await applyKeywordSnapshot({ ...snap, sourceId: "no-store" });
  assert.match(r3.refusal!, /store/);
  const [n] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id = 'market-keywords'`;
  assert.equal(n!.n, 0, "refused imports write nothing");
});

/* ---------------------------------------------------------- R1 foundations */

test("关键词快照：导入→幂等复导入零重复→新周期新快照", async () => {
  const snap1 = parseAmz123KeywordCapture(kwInput("2026-10-20", [["alpha", 10, 20], ["beta", 3, 3]]), "Amazon ABA（AMZ123 二手展示）");
  const r1 = await applyKeywordSnapshot(snap1);
  assert.equal(r1.stored, 1);
  const r1b = await applyKeywordSnapshot(snap1);
  assert.equal(r1b.stored, 0);
  assert.equal(r1b.revised, 0, "byte-identical re-import is a no-op");
  const [n] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id = 'market-keywords'`;
  assert.equal(n!.n, 1);
  const r2 = await applyKeywordSnapshot(parseAmz123KeywordCapture(kwInput("2026-10-27", [["alpha", 5, 10]]), "p"));
  assert.equal(r2.stored, 1);
  const [n2] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id = 'market-keywords'`;
  assert.equal(n2!.n, 2, "a new period is a new snapshot, never an overwrite");
});

test("商品身份：榜单导入建商品卡→复导入不重建→首次上榜不覆盖→属性更新", async () => {
  const t1 = "2026-10-26T08:00:00Z", t2 = "2026-11-02T08:00:00Z";
  const mk = (observedAt: string, rows: Array<{ asin: string; chartRank: number | null; price: string | null; title: string | null }>) =>
    parseAmazonChartCapture({ sourceId: CHART_SOURCE, chartId: "amazon-us-bestsellers-beauty", chartKind: "bestsellers" as const, categoryLabel: "Beauty & Personal Care", observedAt, complete: true, rows });
  const r1 = await applyChartSnapshot(mk(t1, [
    { asin: "B074PVTPBW", chartRank: 1, price: "$11.97", title: "Mighty Patch Hero Cosmetics Original" },
    { asin: "B09V7Z4TJG", chartRank: 2, price: "$18.90", title: "medicube Toner Pads Zero" },
  ]));
  assert.equal(r1.productsCreated, 2);
  const r2 = await applyChartSnapshot(mk(t2, [
    { asin: "B074PVTPBW", chartRank: 3, price: "$12.49", title: "Mighty Patch Hero Cosmetics Original" },
    { asin: "B0NEWASIN0", chartRank: 1, price: "$9.99", title: "New Entrant Product" },
  ]));
  assert.equal(r2.productsCreated, 1);
  assert.equal(r2.productsUpdated, 1);
  const [prod] = await sql<{ raw: { market: { product: { asin: string; firstObservedAt: string; firstChartedAt: string | null; chartRanks: Record<string, { rank: number }>; lastPrice: string | null } } } }[]>`
    SELECT raw FROM articles WHERE source_id = 'market-products' AND raw->'market'->'product'->>'asin' = 'B074PVTPBW'`;
  const p = prod!.raw.market.product;
  assert.equal(p.firstObservedAt, t1, "first observed never moves");
  assert.equal(p.firstChartedAt, t1, "first charted never moves (C4)");
  assert.equal(p.chartRanks["amazon-us-bestsellers-beauty"]!.rank, 3, "current rank updated");
  assert.equal(p.lastPrice, "$12.49");
  const [count] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id = 'market-products'`;
  assert.equal(count!.n, 3);
});

/* ------------------------------------------------------------- R3 metrics C1–C12 */

test("C1/C2：排名方向正确；价格不可比口径拒绝并只阻断价格指标", () => {
  const snaps = parseAmz123KeywordCapture(kwInput("2026-10-20", [["up-word", 5, 20], ["down-word", 20, 5], ["new-word", 7, null]]), "p");
  const changes = keywordChanges(snaps);
  const up = changes.find((c) => c.keyword === "up-word")!;
  assert.equal(up.positionsMoved, 15);
  assert.equal(up.direction, "up");
  const down = changes.find((c) => c.keyword === "down-word")!;
  assert.equal(down.direction, "down");
  const fresh = changes.find((c) => c.keyword === "new-word")!;
  assert.equal(fresh.direction, "unknown", "MISSING last week — direction unknown, never guessed");
  const bad = priceChangeRate("$11.97", "USD 12.49");
  assert.equal(bad.value, null);
  assert.equal((bad.verdict as { ok: false }).ok, false, "unparseable price → NOT_COMPARABLE");
  const good = priceChangeRate("$11.97", "$12.49");
  assert.ok(Math.abs(good.value! - (12.49 - 11.97) / 11.97) < 1e-9);
});

test("C7/C8：榜单比较需同榜同覆盖；退出观测范围记 OUT_OF_SCOPE 不填 N+1", async () => {
  const mkSnap = (periodKey: string, topN: number, complete: boolean, rows: Array<[string, number | null]>) => ({
    sourceId: CHART_SOURCE, chartId: "chart-x", chartKind: "bestsellers" as const, marketplace: "US" as const,
    categoryLabel: null, topN, complete, periodKey, observedAt: `${periodKey}T00:00:00Z`,
    rows: rows.map(([asin, chartRank]) => ({ asin, chartRank, price: "$1", title: `t-${asin}` })),
  });
  const a = mkSnap("2026-10-20", 3, true, [["A000000001", 1], ["B000000002", 2], ["C000000003", 3]]);
  const b = mkSnap("2026-10-27", 3, true, [["A000000001", 2], ["D000000004", 1], ["E000000005", 3]]);
  const { comparable, changes } = chartRankChanges(a, b);
  assert.equal(comparable.ok, true);
  const left = changes.find((c) => c.status === "left-scope")!;
  assert.equal(left.asin, "B000000002");
  assert.equal(left.absence, "OUT_OF_SCOPE");
  assert.equal(left.currRank, 0, "unknown rank is never filled with N+1");
  const partial = mkSnap("2026-11-03", 3, false, [["A000000001", 1]]);
  const v = comparableChartPair(a, partial);
  assert.equal((v as { ok: false }).ok, false, "partial coverage degrades the chart comparison only");
  const price = priceChangeRate("$10.00", "$11.00");
  assert.ok(price.value != null, "…but a comparable price metric still computes (C3 principle)");
});

test("C9/C10：样本份额带限定；Trends 归一化不同不拼接", () => {
  const dist = brandDistribution({
    sourceId: "s", chartId: "c", chartKind: "bestsellers", marketplace: "US", categoryLabel: null, topN: 2, complete: true,
    periodKey: "2026-10-20", observedAt: "2026-10-20T00:00:00Z",
    rows: [{ asin: "A000000001", chartRank: 1, price: null, title: "Acme One Thing" }, { asin: "B000000002", chartRank: 2, price: null, title: "Acme Two Thing" }],
  });
  assert.match(dist.label, /≠全市场份额/);
  assert.equal(dist.shares[0]!.brand, "Acme");
  assert.equal(trendsSpliceable({ normalization: "US-7day" }, { normalization: "US-7day" }), true);
  assert.equal(trendsSpliceable({ normalization: "US-7day" }, { normalization: "US-30day" }), false);
});

test("M07：历史不足不生成季节结论；两期以上为趋势观察", () => {
  assert.equal(trendVerdict(1).kind, "insufficient-history");
  assert.equal(trendVerdict(5).kind, "weekly-obs");
  assert.equal(trendVerdict(120).kind, "seasonal-candidate");
});

test("信号层：两期榜单后产生进出榜与位次信号；单期不产生 D 类信号", async () => {
  const signals = await detectMarketSignals();
  assert.ok(signals.some((s) => s.kind === "chart-new-entrant"), "new entrant detected across the two chart periods");
  assert.ok(signals.every((s) => s.module === "01" || s.module === "04"));
});

/* ------------------------------------------------------------- R4 opportunities */

test("机会：关键词上升生成候选；缺供给证据拒绝评分；补供给证据后可评分", async () => {
  await applyKeywordSnapshot(parseAmz123KeywordCapture(kwInput("2026-11-03", [["rising-star", 2, 40]]), "p"));
  const created = await buildOpportunityCandidates({ minRise: 10 });
  assert.ok(created.length >= 1 || (await loadMarketOpportunities()).some((o) => o.title.includes("rising-star")));
  const opps = await loadMarketOpportunities();
  const target = opps.find((o) => o.title.includes("rising-star"))!;
  assert.equal(target.status, "needs-evidence");
  const refused = scoreOpportunity(target);
  assert.equal(refused!.total, null);
  assert.match(refused!.refusedReason!, /拒绝总分/);
  // add supply+competition evidence → score becomes possible, counter evidence applies a penalty
  const enriched = { ...target, evidence: [...target.evidence, { kind: "supply" as const, origin: "manual", producer: "人工观察", statement: "榜单样本中同类商品 3 个", evidenceGroup: "chart-sample" }, { kind: "competition" as const, origin: "manual", producer: "人工观察", statement: "头部品牌集中度样本级中等", evidenceGroup: "chart-sample" }] };
  const scored = scoreOpportunity(enriched);
  assert.ok(scored!.total != null && scored!.total > 0);
});

test("人工决定：绑定证据版本，可复核状态流转", async () => {
  const opps = await loadMarketOpportunities();
  const target = opps.find((o) => o.review.status === "pending")!;
  const r = await reviewOpportunity(target.id, "deep-dive", "值得研究", "tester");
  assert.equal(r.ok, true);
  const after = (await loadMarketOpportunities()).find((o) => o.id === target.id)!;
  assert.equal(after.review.status, "deep-dive");
  assert.equal(after.review.decidedBy, "tester");
  assert.equal(after.review.basisVersion, target.basisVersion, "decision bound to the evidence version");
});

test("商业情景：三情景纯计算+假设声明；缺输入由 API 层拒绝（此处测计算正确性）", () => {
  const r = computeScenarios({
    salePriceUsd: 20, purchaseCostUsd: 5, moqUnits: 500, shippingPerUnitUsd: 1, tariffRate: 0.175,
    referralFeeRate: 0.15, fbaPerUnitUsd: 4, adCpcUsd: 0.8, conversionRate: 0.1, monthlyAdBudgetUsd: 600,
    returnRate: 0.05, unitsOptimistic: 1200, unitsBase: 600, unitsConservative: 250,
  });
  assert.equal(r.rows.length, 3);
  assert.match(r.assumptionsNote, /≠盈利预测/);
  const base = r.rows.find((x) => x.name === "基准")!;
  assert.ok(Math.abs(base.revenue - 600 * 20) < 1e-6);
  assert.ok(r.sensitivity.length >= 3);
});

test("预警：规则命中→触发一次→重复评估去重不重复触发", async () => {
  await saveMarketAlertRule({ id: "r-rise", name: "关键词上升≥10", module: "01", rule: { kind: "keyword-rank-rise", threshold: 10 }, cooldownHours: 24, enabled: true });
  const first = await evaluateAlerts();
  assert.ok(first.fired >= 1, "rising keyword fires the rule");
  const alerts1 = await loadMarketAlerts();
  const second = await evaluateAlerts();
  assert.equal(second.fired, 0, "dedup: the same signal in the same window does not re-fire");
  assert.equal((await loadMarketAlerts()).length, alerts1.length);
});

/* ------------------------------------------------------------- reading layer */

test("读取层：总览含 12 模块状态与缺口；关键词视图带来源与口径说明；商品视图含证据链", async () => {
  const ov = await loadMarketOverview();
  assert.equal(ov.modules.length, 12);
  assert.ok(ov.modules.every((m) => m.dataState && m.noteZh));
  assert.ok(ov.gaps.length >= 3, "honest gaps listed");
  assert.match(ov.budgetZh, /¥0/);
  const kw = await loadKeywordView({});
  assert.ok(kw.latest);
  assert.match(kw.noteZh, /二手展示/);
  assert.equal(kw.latest!.sourceId, KW_SOURCE);
  const up = await loadKeywordView({ direction: "up" });
  assert.ok(up.rows.every((r) => r.direction === "up"));
  const pv = await loadProductView();
  assert.ok(pv.products.some((p) => p.evidenceUrl.includes("amazon.com/dp/")));
  assert.ok(pv.brandShares && pv.brandShares.length > 0);
});

test("来源隔离：市场表操作不触碰前三条主线的记录", async () => {
  const [before] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id NOT IN ('market-keywords','market-charts','market-products')`;
  await applyKeywordSnapshot(parseAmz123KeywordCapture(kwInput("2026-11-10", [["isolation-check", 8, 1]]), "p"));
  const [after] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id NOT IN ('market-keywords','market-charts','market-products')`;
  assert.equal(after.n, before.n);
});

test("种子来源：R0-DATA 真实来源四条就位且 SP-API 全用途关闭", async () => {
  await seedMarketSources();
  const sources = await loadMarketSources();
  const spapi = sources.find((s) => s.id === "sp-api")!;
  assert.equal(spapi.enabled, false);
  assert.equal(sourceAllows(spapi, "store"), false, "SP-API without credentials licenses nothing");
  const amz = sources.find((s) => s.id === "amz123-us-keywords")!;
  assert.equal(sourceAllows(amz, "store"), true);
  assert.equal(sourceAllows(amz, "fetch"), false, "periodic fetch is NOT licensed — manual import only");
  assert.equal(defaultMarketSources().length, 4);
});

/* -------------------------------------------------- cross-period series (D gate) */

test("多期序列：同来源同词可成序列；跨来源序列标记不可比", () => {
  const s1 = parseAmz123KeywordCapture(kwInput("2026-10-13", [["alpha", 12, 30]]), "p");
  const s2 = parseAmz123KeywordCapture(kwInput("2026-10-20", [["alpha", 10, 12]]), "p");
  const same = keywordSeries([s1, s2], "alpha");
  assert.equal(same.comparable, true);
  assert.equal(same.points.length, 2);
  const other = { ...s2, sourceId: "another-source" };
  const mixed = keywordSeries([s1, other], "alpha");
  assert.equal(mixed.comparable, false, "different sources are not assumed comparable (C11)");
});
