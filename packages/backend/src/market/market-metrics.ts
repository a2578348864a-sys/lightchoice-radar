// The 12-module metric engine and the C1–C12 comparability engine (R3). Deterministic only —
// no model calls. Every computed value carries its formula version, input basis versions and an
// honest comparability verdict; incomparable series yield NOT_COMPARABLE with a reason, never a
// fabricated growth rate. Module coverage here follows the master plan §7 contracts.
import { sql } from "../db.ts";
import {
  chartSnapshotBasisVersion, keywordSnapshotBasisVersion, loadMarketSources,
  type MarketChartSnapshot, type MarketKeywordSnapshot, type MarketProductRecord,
} from "./market-model.ts";

export const METRIC_VERSION = "market-metrics-v1";

/* ------------------------------------------------------- C1–C12 comparability */

export type Comparability = { ok: true } | { ok: false; reason: string; rules: string[] };

/**
 * C2 — price change rate only when both observations share a comparable basis: same currency-style
 * formatting, same offer-condition family (we can only verify "$x.yz" list prices here), positive
 * denominator. Anything else is NOT_COMPARABLE and blocks only the price metric (C3 principle).
 */
export function comparablePrice(before: string | null, after: string | null): Comparability {
  const parse = (p: string | null) => (p && /^\$[\d.,]+$/.test(p) ? Number(p.replace(/[$,]/g, "")) : null);
  const b = parse(before), a = parse(after);
  if (b == null || a == null) return { ok: false, reason: "报价格式不可解析或缺失（原文保留，不做数值比较）", rules: ["C2"] };
  if (b <= 0) return { ok: false, reason: "分母无效（上期价格 ≤ 0）", rules: ["C2"] };
  return { ok: true };
}

export function priceChangeRate(before: string | null, after: string | null): { value: number | null; verdict: Comparability; formulaVersion: string } {
  const verdict = comparablePrice(before, after);
  if (!verdict.ok) return { value: null, verdict, formulaVersion: METRIC_VERSION };
  const b = Number(before!.replace(/[$,]/g, "")), a = Number(after!.replace(/[$,]/g, ""));
  return { value: (a - b) / b, verdict, formulaVersion: METRIC_VERSION };
}

/**
 * C7/C8 — chart-scope gates: rank comparisons inside one chart need both snapshots complete and
 * the same Top-N coverage; a partial page degrades ONLY the affected chart conclusions.
 */
export function comparableChartPair(a: MarketChartSnapshot, b: MarketChartSnapshot): Comparability {
  if (a.chartId !== b.chartId) return { ok: false, reason: "不同榜单不可比较", rules: ["C7"] };
  if (!a.complete || !b.complete) return { ok: false, reason: "快照存在分页缺口（PARTIAL_COVERAGE）", rules: ["C8"] };
  if (a.topN !== b.topN) return { ok: false, reason: `Top-N 覆盖不同（${a.topN} vs ${b.topN}）`, rules: ["C7"] };
  return { ok: true };
}

/** C3 — BSR across categories never compares; this verdict never blocks a same-product price calc. */
export const crossCategoryBsr = { comparable: false, rule: "C3", note: "跨类目 BSR 不直接比较；同商品合法价格比较不受此限制" };

/** C5 — the four absence states, never collapsed into "missing". */
export type Absence = "MISSING" | "OBS_FAILED" | "OUT_OF_SCOPE" | "ZERO";
export function absenceOf(present: boolean | null, zeroAllowed: boolean): Absence {
  if (present === true) throw new Error("absenceOf 只用于缺失场景");
  if (present === false && zeroAllowed) return "ZERO";
  return "MISSING";
}

/** C10 — Trends normalization families never splice without a shared basis. */
export function trendsSpliceable(a: { normalization: string }, b: { normalization: string }): boolean {
  return a.normalization === b.normalization;
}

/* -------------------------------------------------------------- loaders */

interface KwArticle { id: string; raw: { market?: { kind: "keywords"; snapshot: MarketKeywordSnapshot; basisVersion: string } } | null }
interface ChartArticle { id: string; raw: { market?: { kind: "chart"; snapshot: MarketChartSnapshot; basisVersion: string } } | null }

export async function loadKeywordSnapshots(sourceId?: string): Promise<MarketKeywordSnapshot[]> {
  const rows = await sql<KwArticle[]>`SELECT id, raw FROM articles WHERE source_id = 'market-keywords' ORDER BY id`;
  const snaps = rows.map((r) => r.raw?.market?.kind === "keywords" ? r.raw.market.snapshot : null).filter((s): s is MarketKeywordSnapshot => !!s);
  return sourceId ? snaps.filter((s) => s.sourceId === sourceId) : snaps;
}

export async function loadChartSnapshots(chartId?: string): Promise<MarketChartSnapshot[]> {
  const rows = await sql<ChartArticle[]>`SELECT id, raw FROM articles WHERE source_id = 'market-charts' ORDER BY id`;
  const snaps = rows.map((r) => r.raw?.market?.kind === "chart" ? r.raw.market.snapshot : null).filter((s): s is MarketChartSnapshot => !!s);
  const sorted = snaps.sort((a, b) => a.periodKey.localeCompare(b.periodKey));
  return chartId ? sorted.filter((s) => s.chartId === chartId) : sorted;
}

export async function loadProducts(): Promise<MarketProductRecord[]> {
  const rows = await sql<{ raw: { market?: { product?: MarketProductRecord } } | null }[]>`SELECT raw FROM articles WHERE source_id = 'market-products' ORDER BY id`;
  return rows.map((r) => r.raw?.market?.product ?? null).filter((p): p is MarketProductRecord => !!p);
}

/* ------------------------------------------------- M01 keyword demand metrics */

export interface KeywordChange {
  keyword: string;
  thisWeek: number;
  lastWeek: number | null;
  /** C1: positive = rank improved (moved up). Only when lastWeek exists. */
  positionsMoved: number | null;
  direction: "up" | "down" | "flat" | "unknown";
  note: string;
}

/**
 * C1 — rank movement from a snapshot's own two-week columns (real data path: the AMZ123 sample).
 * NEVER converts to demand-percentage. Direction derives from the two ranks; the published
 * "delta" column is absolute-only (R0-DATA finding) and is not trusted for direction.
 */
export function keywordChanges(snap: MarketKeywordSnapshot): KeywordChange[] {
  return snap.rows.map((r) => {
    const moved = r.rankLastWeek != null ? r.rankLastWeek - r.rankThisWeek : null;
    return {
      keyword: r.keyword, thisWeek: r.rankThisWeek, lastWeek: r.rankLastWeek, positionsMoved: moved,
      direction: moved == null ? "unknown" : moved > 0 ? "up" : moved < 0 ? "down" : "flat",
      note: "排名前进≠需求增长百分比（C1 冻结）",
    };
  });
}

/** Multi-period keyword series — requires the SAME source and same weekly cadence (C7 spirit). */
export interface KeywordSeriesPoint { periodStart: string; rank: number }
export function keywordSeries(snaps: MarketKeywordSnapshot[], keyword: string): { points: KeywordSeriesPoint[]; comparable: boolean; reason?: string } {
  const sorted = [...snaps].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const points: KeywordSeriesPoint[] = [];
  for (const s of sorted) {
    const row = s.rows.find((r) => r.keyword === keyword);
    if (row) points.push({ periodStart: s.periodStart, rank: row.rankThisWeek });
  }
  const sources = new Set(sorted.map((s) => s.sourceId));
  const producers = new Set(sorted.map((s) => s.producer));
  if (sources.size > 1 || producers.size > 1) return { points, comparable: false, reason: "多来源/多生产者序列未证明同口径（C11）" };
  return { points, comparable: points.length >= 2 };
}

/* ------------------------------------------------------ M01/M03 multi-period detail */

export interface KeywordHistoryPoint {
  periodStart: string;
  periodEnd: string;
  rankThisWeek: number;
  rankLastWeek: number | null;
  rankDeltaAbsolute: number | null;
  positionsMoved: number | null;
  direction: "up" | "down" | "flat" | "unknown";
  sourceId: string;
  producer: string;
}

export interface KeywordHistoryResponse {
  keyword: string;
  totalPeriods: number;
  points: KeywordHistoryPoint[];
  trend: "up" | "down" | "flat" | "volatile" | "insufficient";
  trendZh: string;
  bestRank: number | null;
  worstRank: number | null;
  latestRank: number | null;
  comparable: boolean;
  reasonZh: string;
}

export async function keywordHistoryDetail(keyword: string): Promise<KeywordHistoryResponse> {
  const snaps = await loadKeywordSnapshots();
  const sorted = [...snaps].sort((a, b) => a.periodStart.localeCompare(b.periodStart));
  const points: KeywordHistoryPoint[] = [];
  const kwLower = keyword.toLowerCase().trim();

  for (const s of sorted) {
    const row = s.rows.find((r) => r.keyword.toLowerCase().trim() === kwLower);
    if (row) {
      const moved = row.rankLastWeek != null ? row.rankLastWeek - row.rankThisWeek : null;
      points.push({
        periodStart: s.periodStart,
        periodEnd: s.periodEnd,
        rankThisWeek: row.rankThisWeek,
        rankLastWeek: row.rankLastWeek,
        rankDeltaAbsolute: row.rankDeltaAbsolute,
        positionsMoved: moved,
        direction: moved == null ? "unknown" : moved > 0 ? "up" : moved < 0 ? "down" : "flat",
        sourceId: s.sourceId,
        producer: s.producer,
      });
    }
  }

  if (points.length === 0) {
    return {
      keyword,
      totalPeriods: 0,
      points: [],
      trend: "insufficient",
      trendZh: "暂无历史观测数据",
      bestRank: null,
      worstRank: null,
      latestRank: null,
      comparable: false,
      reasonZh: "未在任何已入库快照中检索到该关键词",
    };
  }

  const ranks = points.map((p) => p.rankThisWeek);
  const bestRank = Math.min(...ranks);
  const worstRank = Math.max(...ranks);
  const latestRank = points[points.length - 1]!.rankThisWeek;

  if (points.length < 2) {
    return {
      keyword,
      totalPeriods: points.length,
      points,
      trend: "insufficient",
      trendZh: "单期观测（不足 2 期，未形成历史趋势）",
      bestRank,
      worstRank,
      latestRank,
      comparable: false,
      reasonZh: "单期快照只能反映当前名次，不能证明多期趋势（C1 规定）",
    };
  }

  const firstRank = points[0]!.rankThisWeek;
  const netMovement = firstRank - latestRank;
  let trend: "up" | "down" | "flat" | "volatile" = "flat";
  let trendZh = "排名相对平稳";

  if (netMovement >= 5) {
    trend = "up";
    trendZh = `多期累计排名前进 ${netMovement} 位（注意：排名上升≠搜索量增长百分比）`;
  } else if (netMovement <= -5) {
    trend = "down";
    trendZh = `多期累计排名后退 ${Math.abs(netMovement)} 位`;
  }

  return {
    keyword,
    totalPeriods: points.length,
    points,
    trend,
    trendZh,
    bestRank,
    worstRank,
    latestRank,
    comparable: true,
    reasonZh: `跨 ${points.length} 期同口径追踪；排名前进反映相对位移，不代表实际订单转化率`,
  };
}

export interface ProductObservationPoint {
  periodKey: string;
  chartId: string;
  chartKind: string;
  categoryLabel: string | null;
  rank: number | null;
  price: string | null;
  title: string | null;
  observedAt: string;
}

export interface ProductHistoryResponse {
  asin: string;
  product: MarketProductRecord | null;
  totalObservations: number;
  observations: ProductObservationPoint[];
  priceHistory: Array<{ periodKey: string; price: string; parsedAmount: number | null }>;
  priceComparability: Comparability;
  priceChangeRate: number | null;
  rankMovement: { firstRank: number | null; latestRank: number | null; positionsMoved: number | null; direction: string };
  scopeStatus: "present" | "new-entrant" | "left-scope" | "unobserved";
  summaryZh: string;
}

export async function productHistoryDetail(asin: string): Promise<ProductHistoryResponse> {
  const cleanAsin = asin.toUpperCase().trim();
  const products = await loadProducts();
  const product = products.find((p) => p.asin.toUpperCase() === cleanAsin) ?? null;
  const chartSnaps = await loadChartSnapshots();
  const observations: ProductObservationPoint[] = [];

  for (const snap of chartSnaps) {
    const row = snap.rows.find((r) => r.asin.toUpperCase() === cleanAsin);
    if (row) {
      observations.push({
        periodKey: snap.periodKey,
        chartId: snap.chartId,
        chartKind: snap.chartKind,
        categoryLabel: snap.categoryLabel,
        rank: row.chartRank,
        price: row.price,
        title: row.title,
        observedAt: snap.observedAt,
      });
    }
  }

  const pricePoints = observations
    .filter((o) => o.price != null)
    .map((o) => {
      const match = /\$?([\d.,]+)/.exec(o.price ?? "");
      return {
        periodKey: o.periodKey,
        price: o.price!,
        parsedAmount: match ? Number(match[1]!.replace(/,/g, "")) : null,
      };
    });

  let priceChange: number | null = null;
  let priceComp: Comparability = { ok: false, reason: "无价格观测记录", rules: ["C2"] };

  if (pricePoints.length >= 2) {
    const firstP = pricePoints[0]!;
    const latestP = pricePoints[pricePoints.length - 1]!;
    priceComp = comparablePrice(firstP.price, latestP.price);
    if (priceComp.ok) {
      const rate = priceChangeRate(firstP.price, latestP.price);
      priceChange = rate.value;
    }
  } else if (pricePoints.length === 1) {
    priceComp = { ok: false, reason: "仅有单期报价，无法计算价格涨跌率", rules: ["C2"] };
  }

  const rankedObs = observations.filter((o) => o.rank != null);
  let rankMovement = { firstRank: null as number | null, latestRank: null as number | null, positionsMoved: null as number | null, direction: "unknown" };
  if (rankedObs.length >= 2) {
    const firstR = rankedObs[0]!.rank!;
    const latestR = rankedObs[rankedObs.length - 1]!.rank!;
    const moved = firstR - latestR;
    rankMovement = {
      firstRank: firstR,
      latestRank: latestR,
      positionsMoved: moved,
      direction: moved > 0 ? "up" : moved < 0 ? "down" : "flat",
    };
  } else if (rankedObs.length === 1) {
    rankMovement = {
      firstRank: rankedObs[0]!.rank,
      latestRank: rankedObs[0]!.rank,
      positionsMoved: null,
      direction: "single-obs",
    };
  }

  let scopeStatus: ProductHistoryResponse["scopeStatus"] = "unobserved";
  if (observations.length > 0) {
    const latestChart = chartSnaps[chartSnaps.length - 1];
    if (latestChart && latestChart.rows.some((r) => r.asin.toUpperCase() === cleanAsin)) {
      scopeStatus = "present";
    } else {
      scopeStatus = "left-scope";
    }
  }

  const summaryZh = observations.length === 0
    ? "尚未在任何榜单快照中观测到该 ASIN"
    : `已在 ${observations.length} 个快照中观测；${rankMovement.direction === "up" ? `榜单位次上升 ${rankMovement.positionsMoved} 位；` : ""}${pricePoints.length > 0 ? `最新观测价格 ${pricePoints[pricePoints.length - 1]?.price}；` : ""}单次观察不代表历史销量`;

  return {
    asin: cleanAsin,
    product,
    totalObservations: observations.length,
    observations,
    priceHistory: pricePoints,
    priceComparability: priceComp,
    priceChangeRate: priceChange,
    rankMovement,
    scopeStatus,
    summaryZh,
  };
}

export interface CategoryCard {
  categoryLabel: string;
  productCount: number;
  sampleAsins: string[];
  topBrands: Array<{ brand: string; count: number }>;
  priceRange: { min: string | null; max: string | null; avg: string | null };
  associatedKeywords: string[];
  chartIds: string[];
  notesZh: string;
}

export async function categoryMarketSummary(): Promise<{ categories: CategoryCard[]; totalCategories: number; noteZh: string }> {
  const products = await loadProducts();
  const kwSnaps = await loadKeywordSnapshots();
  const allKeywords = kwSnaps.flatMap((s) => s.rows.map((r) => r.keyword));
  const uniqueKeywords = [...new Set(allKeywords)];

  const byCat = new Map<string, MarketProductRecord[]>();
  for (const p of products) {
    const cat = p.categoryLabel?.trim() || "未明确类目（未提供类目字段）";
    const list = byCat.get(cat) ?? [];
    list.push(p);
    byCat.set(cat, list);
  }

  const categories: CategoryCard[] = [];
  for (const [cat, prods] of byCat) {
    const brandMap = new Map<string, number>();
    const prices: number[] = [];
    const chartIds = new Set<string>();

    for (const p of prods) {
      if (p.brand) brandMap.set(p.brand, (brandMap.get(p.brand) ?? 0) + 1);
      if (p.lastPrice) {
        const m = /\$?([\d.,]+)/.exec(p.lastPrice);
        if (m) prices.push(Number(m[1]!.replace(/,/g, "")));
      }
      Object.keys(p.chartRanks).forEach((c) => chartIds.add(c));
    }

    const topBrands = [...brandMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([brand, count]) => ({ brand, count }));

    let minPrice: string | null = null;
    let maxPrice: string | null = null;
    let avgPrice: string | null = null;
    if (prices.length > 0) {
      minPrice = `$${Math.min(...prices).toFixed(2)}`;
      maxPrice = `$${Math.max(...prices).toFixed(2)}`;
      avgPrice = `$${(prices.reduce((a, b) => a + b, 0) / prices.length).toFixed(2)}`;
    }

    const catTokens = cat.toLowerCase().split(/[\s,&>/]+/);
    const matchedKws = uniqueKeywords.filter((kw) => {
      const kwLower = kw.toLowerCase();
      return catTokens.some((tok) => tok.length > 3 && kwLower.includes(tok));
    }).slice(0, 10);

    categories.push({
      categoryLabel: cat,
      productCount: prods.length,
      sampleAsins: prods.map((p) => p.asin).slice(0, 8),
      topBrands,
      priceRange: { min: minPrice, max: maxPrice, avg: avgPrice },
      associatedKeywords: matchedKws,
      chartIds: [...chartIds],
      notesZh: `样本级类目（${prods.length} 个商品）；官方完整类目树层级与 ID 需 SP-API 来源获准（当前为 PARTIAL）`,
    });
  }

  return {
    categories,
    totalCategories: categories.length,
    noteZh: "类目雷达（M02）依据已观察商品 categoryLabel 标签聚合；跨类目 BSR 不直接比较（C3）",
  };
}

/* ------------------------------------------------------ M03/M04 product & chart */

export interface ChartRankChange {
  asin: string;
  title: string | null;
  prevRank: number | null;
  currRank: number;
  positionsMoved: number | null;
  status: "present" | "new-entrant" | "left-scope";
  absence?: Absence;
}

/** Rank changes between two chart snapshots; C6 forbids filling unknown ranks with N+1. */
export function chartRankChanges(prev: MarketChartSnapshot, curr: MarketChartSnapshot): { comparable: Comparability; changes: ChartRankChange[]; basisVersions: string[] } {
  const verdict = comparableChartPair(prev, curr);
  const prevMap = new Map(prev.rows.map((r) => [r.asin, r]));
  const currMap = new Map(curr.rows.map((r) => [r.asin, r]));
  const changes: ChartRankChange[] = [];
  for (const r of curr.rows) {
    const before = prevMap.get(r.asin);
    if (!before) {
      changes.push({ asin: r.asin, title: r.title, prevRank: null, currRank: r.chartRank ?? 0, positionsMoved: null, status: "new-entrant" });
    } else if (before.chartRank != null && r.chartRank != null) {
      changes.push({ asin: r.asin, title: r.title, prevRank: before.chartRank, currRank: r.chartRank, positionsMoved: before.chartRank - r.chartRank, status: "present" });
    } else {
      changes.push({ asin: r.asin, title: r.title, prevRank: before.chartRank, currRank: r.chartRank ?? 0, positionsMoved: null, status: "present", absence: "MISSING" });
    }
  }
  // Products in prev but not curr: OUT_OF_SCOPE (unknown rank beyond N) — recorded, never rank N+1.
  if (verdict.ok) {
    for (const r of prev.rows) {
      if (!currMap.has(r.asin)) changes.push({ asin: r.asin, title: r.title, prevRank: r.chartRank, currRank: 0, positionsMoved: null, status: "left-scope", absence: "OUT_OF_SCOPE" });
    }
  }
  return { comparable: verdict, changes, basisVersions: [chartSnapshotBasisVersion(prev), chartSnapshotBasisVersion(curr)] };
}

/** C9 — sample brand distribution, always labelled as sample-scope. */
export interface BrandShare { brand: string; count: number; shareInSample: number }
export function brandDistribution(snap: MarketChartSnapshot): { shares: BrandShare[]; label: string } {
  const counts = new Map<string, number>();
  for (const r of snap.rows) {
    const b = /^([A-Za-z][A-Za-z0-9&.'-]*)\s/.exec(r.title ?? "")?.[1] ?? "（未能识别品牌）";
    counts.set(b, (counts.get(b) ?? 0) + 1);
  }
  const total = snap.rows.length || 1;
  const shares = [...counts.entries()].map(([brand, count]) => ({ brand, count, shareInSample: count / total }))
    .sort((a, b) => b.count - a.count);
  return { shares, label: `样本品牌分布（n=${snap.rows.length}，榜单=${snap.chartId}）≠全市场份额（C9）` };
}

/* ------------------------------------------------------------- M07 trends gate */

export interface TrendVerdict { kind: "weekly-obs" | "insufficient-history" | "seasonal-candidate"; detail: string }
export function trendVerdict(periods: number): TrendVerdict {
  if (periods >= 104) return { kind: "seasonal-candidate", detail: `历史 ${periods} 期（≥2 年），可做季节性候选分析` };
  if (periods >= 2) return { kind: "weekly-obs", detail: `历史 ${periods} 期，可做趋势观察；季节性判断需 ≥2 年同期（不足）` };
  return { kind: "insufficient-history", detail: `历史 ${periods} 期（不足 2 期），不生成趋势结论` };
}

/* ------------------------------------------------------------- signal layer */

export interface MarketSignal {
  id: string;
  module: string; // 01..12
  kind: string;
  subjectZh: string;
  detailZh: string;
  strength: number;
  evidenceRefs: string[];
  basisVersions: string[];
  formulaVersion: string;
  at: string;
}

/**
 * Formal admission gate for market signals.
 * Disqualifies:
 * 1. Future dates (sig.at > now, or date in evidenceRefs > today)
 * 2. Test/synthetic sources in basisVersions or evidenceRefs (e.g. test-amz-chart, test-amz123)
 * 3. Synthetic/test products or titles (e.g. New Entrant Product, Historical Test Product)
 * 4. Evidence refs containing test or mock
 */
export function isFormalMarketSignal(sig: MarketSignal, now: Date = new Date()): boolean {
  if (!sig || !sig.id) return false;

  const nowIso = now.toISOString();
  const todayStr = nowIso.slice(0, 10);

  // Future date check
  if (sig.at && sig.at > nowIso) return false;

  // Evidence refs check
  for (const ref of sig.evidenceRefs || []) {
    const dateMatch = /\b\d{4}-\d{2}-\d{2}\b/.exec(ref);
    if (dateMatch && dateMatch[0] > todayStr) {
      return false;
    }
    const rLower = ref.toLowerCase();
    if (rLower.includes("test") || rLower.includes("synth") || rLower.includes("mock")) {
      return false;
    }
  }

  // Basis versions check
  for (const basis of sig.basisVersions || []) {
    const bLower = basis.toLowerCase();
    if (bLower.includes("test-") || bLower.includes("synth") || bLower.startsWith("test")) {
      return false;
    }
  }

  // Title / subject check
  const subLower = (sig.subjectZh || "").toLowerCase();
  const detLower = (sig.detailZh || "").toLowerCase();
  if (
    subLower.includes("test product") ||
    subLower.includes("new entrant product") ||
    subLower.includes("historical test") ||
    subLower.includes("apex thermal flask") ||
    subLower.includes("测试") ||
    detLower.includes("test product")
  ) {
    return false;
  }

  return true;
}

/** Detects keyword demand signals (M01) and chart movement signals (M03/M04) from loaded data. */
export async function detectMarketSignals(opts: { keywordRiseThreshold?: number; includeTest?: boolean } = {}): Promise<MarketSignal[]> {
  const rise = opts.keywordRiseThreshold ?? 5;
  const includeTest = opts.includeTest === true;
  const signals: MarketSignal[] = [];
  const sources = await loadMarketSources();
  const revoked = new Set(sources.filter((x) => x.revokedAt).map((x) => x.id));
  const formalSourceIds = new Set(
    sources
      .filter((x) => x.enabled && !x.revokedAt && x.kind !== "synthetic-test" && !x.id.startsWith("test-"))
      .map((x) => x.id)
  );

  const nowIso = new Date().toISOString();
  const todayStr = nowIso.slice(0, 10);

  let kwSnaps = (await loadKeywordSnapshots()).filter((x) => !revoked.has(x.sourceId));
  if (!includeTest) {
    kwSnaps = kwSnaps.filter(
      (x) =>
        formalSourceIds.has(x.sourceId) &&
        !x.sourceId.startsWith("test-") &&
        x.periodStart <= todayStr &&
        x.observedAt <= nowIso
    );
  }

  for (const snap of kwSnaps) {
    const basis = [keywordSnapshotBasisVersion(snap)];
    for (const c of keywordChanges(snap)) {
      if (c.positionsMoved != null && c.positionsMoved >= rise) {
        signals.push({
          id: `kw-rise:${snap.sourceId}:${snap.periodStart}:${c.keyword}`, module: "01", kind: "keyword-rank-rise",
          subjectZh: `关键词「${c.keyword}」排名上升 ${c.positionsMoved} 位`,
          detailZh: `本周第 ${c.thisWeek} 名（上周第 ${c.lastWeek} 名）；来源 ${snap.producer}，周期 ${snap.periodStart} 起。排名前进≠需求增长百分比。`,
          strength: c.positionsMoved, evidenceRefs: [`market://keywords/${snap.sourceId}/${snap.periodStart}`], basisVersions: basis, formulaVersion: METRIC_VERSION, at: snap.observedAt,
        });
      }
    }
  }

  let charts = (await loadChartSnapshots()).filter((x) => !revoked.has(x.sourceId));
  if (!includeTest) {
    charts = charts.filter(
      (x) =>
        formalSourceIds.has(x.sourceId) &&
        !x.sourceId.startsWith("test-") &&
        x.periodKey <= todayStr &&
        x.observedAt <= nowIso
    );
  }

  const byChart = new Map<string, MarketChartSnapshot[]>();
  for (const c of charts) {
    const list = byChart.get(c.chartId) ?? [];
    list.push(c);
    byChart.set(c.chartId, list);
  }
  for (const [chartId, list] of byChart) {
    if (list.length < 2) continue; // single period → no D-capability claims (honest)
    const [prev, curr] = [list[list.length - 2]!, list[list.length - 1]!];
    const { comparable, changes, basisVersions } = chartRankChanges(prev, curr);
    for (const ch of changes) {
      if (ch.status === "new-entrant") {
        signals.push({
          id: `chart-new:${chartId}:${curr.periodKey}:${ch.asin}`, module: "04", kind: "chart-new-entrant",
          subjectZh: `新进入榜单：${ch.title ?? ch.asin}`,
          detailZh: `${chartId} ${curr.periodKey} 期新进入观测范围（榜内第 ${ch.currRank} 名）。首次上榜≠新品上架（C4）；${comparable.ok ? "" : "注意：" + comparable.reason}`,
          strength: 1, evidenceRefs: [`market://chart/${chartId}/${curr.periodKey}`], basisVersions, formulaVersion: METRIC_VERSION, at: curr.observedAt,
        });
      } else if (ch.positionsMoved != null && Math.abs(ch.positionsMoved) >= 3) {
        signals.push({
          id: `chart-move:${chartId}:${curr.periodKey}:${ch.asin}`, module: "04", kind: "chart-rank-change",
          subjectZh: `榜单位次变化：${ch.title ?? ch.asin}`,
          detailZh: `${prev.periodKey} 第 ${ch.prevRank} 名 → ${curr.periodKey} 第 ${ch.currRank} 名（${ch.positionsMoved > 0 ? "上升" : "下降"} ${Math.abs(ch.positionsMoved)} 位）。榜内比较；跨类目 BSR 不可比（C3）。`,
          strength: Math.abs(ch.positionsMoved), evidenceRefs: [`market://chart/${chartId}/${curr.periodKey}`], basisVersions, formulaVersion: METRIC_VERSION, at: curr.observedAt,
        });
      }
    }
  }
  return includeTest ? signals : signals.filter((s) => isFormalMarketSignal(s));
}

/** Current-state module dashboard inputs (M03 cards + M06 current prices + comparability marks). */
export async function marketOverviewInputs(): Promise<{
  keywordSnapshots: number; keywordRows: number; chartSnapshots: MarketChartSnapshot[];
  products: MarketProductRecord[]; signals: MarketSignal[]; gaps: string[];
}> {
  const kwSnaps = await loadKeywordSnapshots();
  const chartSnaps = await loadChartSnapshots();
  const products = await loadProducts();
  const signals = await detectMarketSignals();
  const gaps: string[] = [];
  if (!chartSnaps.some((s) => s.complete && s.topN >= 20)) gaps.push("M04 销售热度：尚无完整 Top-N 多期快照（单期人工样本）→ 变化计算 NOT_RUN");
  if (products.length < 50) gaps.push(`M03/M05/M06：商品样本 ${products.length} 个（人工观察级），未达统计观察规模`);
  gaps.push("M02 类目结构：无类目节点 ID/层级/版本（L2 缺）→ 类目树 BLOCKED");
  gaps.push("M07 趋势：单期历史 → 季节性 NOT_RUN");
  gaps.push("M08 外部平台：无获准来源 → BLOCKED");
  gaps.push("M09 创新/众筹/专利：无获准来源 → BLOCKED");
  return { keywordSnapshots: kwSnaps.length, keywordRows: kwSnaps.reduce((n, s) => n + s.rows.length, 0), chartSnapshots: chartSnaps, products, signals, gaps };
}
