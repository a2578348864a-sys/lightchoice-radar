// The 12-module metric engine and the C1–C12 comparability engine (R3). Deterministic only —
// no model calls. Every computed value carries its formula version, input basis versions and an
// honest comparability verdict; incomparable series yield NOT_COMPARABLE with a reason, never a
// fabricated growth rate. Module coverage here follows the master plan §7 contracts.
import { sql } from "../db.ts";
import {
  chartSnapshotBasisVersion, keywordSnapshotBasisVersion,
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

/** Detects keyword demand signals (M01) and chart movement signals (M03/M04) from loaded data. */
export async function detectMarketSignals(opts: { keywordRiseThreshold?: number } = {}): Promise<MarketSignal[]> {
  const rise = opts.keywordRiseThreshold ?? 5;
  const signals: MarketSignal[] = [];
  const kwSnaps = await loadKeywordSnapshots();
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
  const charts = await loadChartSnapshots();
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
  return signals;
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
