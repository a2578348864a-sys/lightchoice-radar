// The market lane's reading layer — everything the private workbench pages render. One public
// shape per page, honest states everywhere: a module without licensed data renders BLOCKED with
// its reason, never zeros or demo values. All private (admin session), like the VOC workbench.
import { sql } from "../db.ts";
import {
  loadMarketAlerts, loadMarketAlertRules, loadMarketOpportunities, loadMarketSources,
  loadProductSafetyEvents, sourceUses, type MarketProductRecord,
} from "./market-model.ts";
import {
  brandDistribution, chartRankChanges, keywordChanges, loadChartSnapshots, loadKeywordSnapshots,
  loadProducts, marketOverviewInputs, priceChangeRate, trendVerdict, METRIC_VERSION,
} from "./market-metrics.ts";
import { getMarketSchedulerStatus, type MarketSchedulerStatus } from "./market-scheduler.ts";

export interface ModuleState { module: string; name: string; engineering: "implemented" | "partial" | "stub"; dataState: string; noteZh: string; /** R6-CLOSE: the third, business-acceptance layer — engineering PASS never inherits here. */
  business: string }

/** The 12-module honest status board (engineering vs data vs permission, never conflated). */
export async function moduleStates(): Promise<ModuleState[]> {
  const [inputs, safetyEventsList] = await Promise.all([marketOverviewInputs(), loadProductSafetyEvents()]);
  const latestKw = inputs.keywordSnapshots > 0;
  const multiPeriodKw = inputs.keywordSnapshots >= 2;
  const multiPeriodChart = inputs.chartSnapshots.some((c) => c.chartId) && new Set(inputs.chartSnapshots.map((c) => c.chartId + c.periodKey)).size >= 2;
  const safetyEvents = safetyEventsList.length;
  return [
    {
      module: "01", name: "搜索需求雷达", engineering: "implemented",
      dataState: multiPeriodKw ? `多期连续（${inputs.keywordSnapshots} 期快照，${inputs.keywordRows} 行）` : latestKw ? "真实数据（单期快照）" : "无数据",
      noteZh: multiPeriodKw ? `已入库 ${inputs.keywordSnapshots} 期快照；支持多期排名趋势对比；排名前进≠搜索量增长；外部站点自动抓取保持阻断守护` : latestKw ? `已入库 ${inputs.keywordRows} 行关键词快照；C1 排名变化可算；排名前进≠搜索量；外部站点自动抓取保持阻断守护` : "等待获准自动来源或历史数据",
      business: multiPeriodKw ? "多期趋势可用（C1/C7 规则生效）" : latestKw ? "样本级可用（单期）；自动采集 BLOCKED" : "NOT_RUN（无获准自动来源）",
    },
    {
      module: "02", name: "类目市场雷达", engineering: "implemented",
      dataState: inputs.products.length ? `基于已观察类目标签聚合（${inputs.products.length} 个商品）` : "仅类目标签",
      noteZh: inputs.products.length ? "已打通类目聚合看板、品牌分布与价格区间；官方完整类目树层级需 SP-API 来源获准" : "无类目节点 ID/层级/版本（来源 L2 缺）——类目树 BLOCKED",
      business: inputs.products.length ? "样本类目聚合可用（PARTIAL）" : "BLOCKED（仅标签展示）",
    },
    {
      module: "03", name: "商品与新品雷达", engineering: "implemented",
      dataState: `真实样本 ${inputs.products.length} 个（人工观察级）`,
      noteZh: "ASIN 身份+四分首次观察已实现；首次上榜≠新品上架（C4）；支持商品观测历史时间线；Amazon 自动抓取保持安全阻断",
      business: inputs.products.length ? `样本级可用（${inputs.products.length} 个商品历史已通）；自动采集 BLOCKED` : "NOT_RUN（无数据）",
    },
    {
      module: "04", name: "销售热度雷达", engineering: "implemented",
      dataState: multiPeriodChart ? "多期可比（榜内位次）" : "单期快照",
      noteZh: multiPeriodChart ? "榜内排名位移/进出榜（新进入/出榜）可算（C6/C7/C8 生效）；排名≠真实销量" : "变化计算 NOT_RUN——需第二期同榜快照",
      business: multiPeriodChart ? "多期榜内位移可用（真实销量 NOT_RUN）" : "NOT_RUN（单期）",
    },
    {
      module: "05", name: "竞争格局雷达", engineering: "implemented",
      dataState: inputs.products.length ? "样本级可算" : "无数据",
      noteZh: "样本品牌分布≠全市场份额（C9 强制限定语）；价格分档统计就绪",
      business: inputs.products.length ? `样本级可用（n=${inputs.products.length}，规模局限于观测样本）` : "NOT_RUN（无数据）",
    },
    {
      module: "06", name: "价格与促销雷达", engineering: "implemented",
      dataState: multiPeriodChart ? "多期价格追踪" : "当前价快照",
      noteZh: "C2 口径可比性引擎就绪；支持单商品跨期价格波动核算，不同报价条件时阻断误导百分比",
      business: multiPeriodChart ? "多期价格波动可用（真实促销全量 NOT_RUN）" : "当前价可用；多期历史价格 NOT_RUN",
    },
    {
      module: "07", name: "趋势与季节雷达", engineering: "implemented",
      dataState: trendVerdict(inputs.keywordSnapshots).kind,
      noteZh: trendVerdict(inputs.keywordSnapshots).detail,
      business: inputs.keywordSnapshots >= 2 ? "周度趋势观察可用；季节性判断 NOT_RUN（需 ≥2 年同期，如实提示）" : "NOT_RUN（历史不足，如实提示）",
    },
    {
      module: "08", name: "外部平台雷达", engineering: "implemented",
      dataState: "支持结构化私有记录",
      noteZh: "支持录入与读取 eBay/Etsy/Walmart 商品记录与跨平台候选匹配（C11 不相加）；无获准自动爬虫",
      business: "结构化记录就绪；自动采集 BLOCKED",
    },
    {
      module: "09", name: "创新与替代品雷达", engineering: "implemented",
      dataState: safetyEvents > 0 ? `已打通 CPSC 消费品安全数据流（${safetyEvents} 起通告入库）` : "已打通 CPSC 消费品安全数据流",
      noteZh: safetyEvents > 0 ? `已接入官方 CPSC 消费品安全与召回开放数据流，自动提炼 ${safetyEvents} 起缺陷反证与结构防呆线索；众筹/专利自动接入 BLOCKED` : "已接入官方 CPSC 消费品安全与召回开放数据流，自动提炼缺陷反证与结构防呆线索；众筹/专利自动接入 BLOCKED",
      business: safetyEvents > 0 ? `CPSC 官方数据流自动运行就绪（${safetyEvents} 起安全事件）；众筹/专利自动接入 BLOCKED` : "CPSC 官方数据流自动运行就绪；众筹/专利自动接入 BLOCKED",
    },
    {
      module: "10", name: "供需缺口雷达", engineering: "implemented",
      dataState: "需求侧可算",
      noteZh: "关键词上升→研究线索链路已实现；供给/痛点证据缺失时拒绝评分（冻结规则）",
      business: "需求侧可用；缺口判断 PARTIAL（反证机制生效）",
    },
    {
      module: "11", name: "商业可行性雷达", engineering: "implemented",
      dataState: "计算器就绪",
      noteZh: "三情景+敏感性纯计算；输入必须逐项标注证据/假设；平台费率可引一线政策证据",
      business: "计算器可用（输入依赖用户假设标注）",
    },
    {
      module: "12", name: "机会发现与预警", engineering: "implemented",
      dataState: `${inputs.signals.length} 条信号待聚`,
      noteZh: "规则引擎+类型分层+去重+冷却+失效（站内）；外部推送默认关闭",
      business: "站内预警可用；多期候选已防重",
    },
  ];
}

export interface MarketOverviewResponse {
  modules: ModuleState[];
  sources: Array<{
    id: string; label: string; producer: string; enabled: boolean; automation: string;
    uses: string[]; evidence: string; notes?: string; unverifiedUses?: string[];
    revokedAt?: string; revokeReason?: string; permissionBasis: string;
    cadenceHours?: number; lastRunAt?: string | null; nextRunAt?: string | null;
    lastError?: string | null; runCount?: number;
  }>;
  counts: {
    keywordSnapshots: number; keywordRows: number; chartSnapshots: number;
    products: number; signals: number; opportunities: number; alerts: number;
    safetyEvents: number;
  };
  gaps: string[];
  budgetZh: string;
  scheduler: MarketSchedulerStatus;
}

export async function loadMarketOverview(): Promise<MarketOverviewResponse> {
  const [modules, sources, opps, alerts, inputs, safetyEventsList, scheduler] = await Promise.all([
    moduleStates(), loadMarketSources(), loadMarketOpportunities(), loadMarketAlerts(),
    marketOverviewInputs(), loadProductSafetyEvents(), getMarketSchedulerStatus(),
  ]);
  return {
    modules,
    sources: sources.map((s) => ({
      id: s.id, label: s.label, producer: s.producer, enabled: s.enabled, automation: s.automation,
      uses: [...sourceUses(s)], evidence: s.permission.evidence, notes: s.notes,
      unverifiedUses: s.unverifiedUses, revokedAt: s.revokedAt, revokeReason: s.revokeReason,
      permissionBasis: s.permission.basis, cadenceHours: s.cadenceHours, lastRunAt: s.lastRunAt,
      nextRunAt: s.nextRunAt, lastError: s.lastError, runCount: s.runCount,
    })),
    counts: {
      keywordSnapshots: inputs.keywordSnapshots, keywordRows: inputs.keywordRows,
      chartSnapshots: inputs.chartSnapshots.length, products: inputs.products.length,
      signals: inputs.signals.length, opportunities: opps.length, alerts: alerts.filter((a) => a.status === "new").length,
      safetyEvents: safetyEventsList.length,
    },
    gaps: inputs.gaps,
    budgetZh: "第四主线模型预算 ¥0（未建窗口）；本轮全部计算为确定性规则，零模型调用",
    scheduler,
  };
}

/* ------------------------------------------------------------- keyword page */

export interface KeywordPeriodMeta {
  periodStart: string;
  periodEnd: string;
  sourceId: string;
  rowCount: number;
}

export interface KeywordsResponse {
  latest: { sourceId: string; producer: string; periodStart: string; periodEnd: string; secondaryDisplay: boolean; sourceUpdatedAt: string | null; observedAt: string } | null;
  availablePeriods: KeywordPeriodMeta[];
  rows: Array<{ keyword: string; thisWeek: number; lastWeek: number | null; positionsMoved: number | null; direction: string; noteZh: string }>;
  total: number;
  noteZh: string;
}

export async function loadKeywordView(filter?: { direction?: string; q?: string; limit?: number; periodStart?: string }): Promise<KeywordsResponse> {
  const snaps = await loadKeywordSnapshots();
  if (!snaps.length) return { latest: null, availablePeriods: [], rows: [], total: 0, noteZh: "暂无获准关键词数据——等待导入或来源授权" };
  const sorted = [...snaps].sort((a, b) => b.periodStart.localeCompare(a.periodStart));
  const availablePeriods: KeywordPeriodMeta[] = sorted.map((s) => ({
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    sourceId: s.sourceId,
    rowCount: s.rows.length,
  }));
  const activeSnap = filter?.periodStart
    ? sorted.find((s) => s.periodStart === filter.periodStart) || sorted[0]!
    : sorted[0]!;
  let rows = keywordChanges(activeSnap);
  if (filter?.q) rows = rows.filter((r) => r.keyword.toLowerCase().includes(filter.q!.toLowerCase()));
  if (filter?.direction === "up") rows = rows.filter((r) => r.direction === "up");
  if (filter?.direction === "down") rows = rows.filter((r) => r.direction === "down");
  const total = rows.length;
  const limit = Math.min(filter?.limit ?? 100, 200);
  return {
    latest: {
      sourceId: activeSnap.sourceId, producer: activeSnap.producer, periodStart: activeSnap.periodStart, periodEnd: activeSnap.periodEnd,
      secondaryDisplay: activeSnap.secondaryDisplay, sourceUpdatedAt: activeSnap.sourceUpdatedAt, observedAt: activeSnap.observedAt,
    },
    availablePeriods,
    rows: rows.slice(0, limit).map((r) => ({ ...r, noteZh: r.direction === "unknown" ? "上周排名缺失——方向未知（MISSING，不猜）" : "排名前进≠需求增长百分比（C1）" })),
    total,
    noteZh: `ABA 二手展示（${activeSnap.producer}）；当前查看周期：${activeSnap.periodStart} 至 ${activeSnap.periodEnd}；「涨跌幅度」为绝对位移，方向由两周排名推导`,
  };
}

/* ------------------------------------------------------------- product page */

export interface ProductsResponse {
  chartMeta: Array<{ chartId: string; kind: string; categoryLabel: string | null; periodKey: string; topN: number; complete: boolean }>;
  products: Array<{
    asin: string; title: string | null; brand: string | null; categoryLabel: string | null;
    lastPrice: string | null; chartRank: number | null; firstObservedAt: string; firstChartedAt: string | null;
    firstSeenNoteZh: string; evidenceUrl: string;
  }>;
  brandShares: Array<{ brand: string; count: number; shareInSample: number }> | null;
  brandLabelZh: string | null;
  rankChanges: Array<{ asin: string; titleZh: string; detailZh: string; status: string }> | null;
  rankChangeNoteZh: string | null;
}

export async function loadProductView(): Promise<ProductsResponse> {
  const snaps = await loadChartSnapshots();
  const products = await loadProducts();
  const chartMeta = snaps.map((s) => ({ chartId: s.chartId, kind: s.chartKind, categoryLabel: s.categoryLabel, periodKey: s.periodKey, topN: s.topN, complete: s.complete }));
  const latestByChart = new Map<string, (typeof snaps)[number]>();
  for (const s of snaps) latestByChart.set(s.chartId, s);
  const productRows = products.map((p: MarketProductRecord) => {
    const current = Object.entries(p.chartRanks).sort((a, b) => b[1].periodKey.localeCompare(a[1].periodKey))[0];
    return {
      asin: p.asin, title: p.title, brand: p.brand, categoryLabel: p.categoryLabel, lastPrice: p.lastPrice,
      chartRank: current?.[1].rank ?? null,
      firstObservedAt: p.firstObservedAt, firstChartedAt: p.firstChartedAt,
      firstSeenNoteZh: p.firstChartedAt
        ? `首次观察 ${p.firstObservedAt.slice(0, 10)}；首次上榜 ${p.firstChartedAt.slice(0, 10)}——首次上榜≠新品上架（C4）`
        : `首次观察 ${p.firstObservedAt.slice(0, 10)}（尚未观测到上榜）`,
      evidenceUrl: `https://www.amazon.com/dp/${p.asin}`,
    };
  });
  let brandShares: ProductsResponse["brandShares"] = null;
  let brandLabelZh: string | null = null;
  let rankChanges: ProductsResponse["rankChanges"] = null;
  let rankChangeNoteZh: string | null = null;
  const latestChart = [...latestByChart.values()].sort((a, b) => a.periodKey.localeCompare(b.periodKey)).at(-1) ?? null;
  if (latestChart) {
    const dist = brandDistribution(latestChart);
    brandShares = dist.shares;
    brandLabelZh = dist.label;
    const same = snaps.filter((s) => s.chartId === latestChart.chartId).sort((a, b) => a.periodKey.localeCompare(b.periodKey));
    if (same.length >= 2) {
      const { comparable, changes } = chartRankChanges(same[same.length - 2]!, same[same.length - 1]!);
      rankChanges = changes.map((c) => ({
        asin: c.asin, titleZh: c.title ?? c.asin,
        detailZh: c.status === "left-scope" ? `上期第 ${c.prevRank} 名 → 本期未入观测范围（OUT_OF_SCOPE，未知排名不填 ${latestChart.topN + 1}）`
          : c.status === "new-entrant" ? `本期新进入（第 ${c.currRank} 名）`
          : `第 ${c.prevRank} → 第 ${c.currRank} 名${c.positionsMoved != null ? `（${c.positionsMoved > 0 ? "升" : "降"} ${Math.abs(c.positionsMoved)}）` : ""}`,
        status: c.status,
      }));
      rankChangeNoteZh = comparable.ok ? "榜内比较（同榜同覆盖）" : `不可比较：${comparable.reason}——仅展示原始观测`;
    } else {
      rankChangeNoteZh = "单期快照——排名变化 NOT_RUN（需第二期同榜观测）";
    }
  }
  return { chartMeta, products: productRows, brandShares, brandLabelZh, rankChanges, rankChangeNoteZh };
}

/* -------------------------------------------------------- opportunity page */

export async function loadOpportunityView(): Promise<{
  opportunities: Array<{ id: string; title: string; summaryZh: string; status: string; reviewStatus: string; reviewNote?: string; qualified: boolean; scoreTotal: number | null; scoreRefused?: string; evidenceCount: number; counterCount: number; gapsCount: number }>;
}> {
  const opps = await loadMarketOpportunities();
  return {
    opportunities: opps.map((o) => ({
      id: o.id, title: o.title, summaryZh: o.summaryZh, status: o.status, reviewStatus: o.review.status, reviewNote: o.review.note,
      qualified: o.score?.total != null,
      scoreTotal: o.score?.total ?? null, scoreRefused: o.score?.refusedReason,
      evidenceCount: o.evidence.length, counterCount: o.counterEvidence.length, gapsCount: o.dataGaps.length,
    })),
  };
}

/* ------------------------------------------------------------- alerts page */

export async function loadAlertsView(): Promise<{ rules: Array<{ id: string; name: string; module: string; kind: string; threshold: number; cooldownHours: number; enabled: boolean }>; alerts: Array<{ id: string; ruleId: string; kind: string; kindZh: string; subject: string; detailZh: string; reasonZh: string; firedAt: string; status: string }> }> {
  const [rules, alerts] = await Promise.all([loadMarketAlertRules(), loadMarketAlerts()]);
  const kindZh: Record<string, string> = { "market-change": "普通市场变化", "research-lead": "待补证研究线索", "qualified-opportunity": "达到条件的重要机会变化", "source-failure": "来源失败/延迟", "revision-revocation": "事实修订/撤销" };
  return {
    rules: rules.map((r) => ({ id: r.id, name: r.name, module: r.module, kind: r.rule.kind, threshold: r.rule.threshold, cooldownHours: r.cooldownHours, enabled: r.enabled })),
    alerts: alerts.sort((a, b) => b.firedAt.localeCompare(a.firedAt)).map((a) => ({ id: a.id, ruleId: a.ruleId, kind: a.kind, kindZh: kindZh[a.kind] ?? a.kind, subject: a.subject, detailZh: a.detailZh, reasonZh: a.reasonZh ?? "", firedAt: a.firedAt, status: a.status })),
  };
}

/** Cross-module util used by the overview: latest price-change verdicts (mostly NOT_COMPARABLE now — honest). */
export async function priceVerdicts(): Promise<Array<{ asin: string; verdictZh: string }>> {
  const products = await loadProducts();
  const snaps = await loadChartSnapshots();
  return products.slice(0, 20).map((p) => {
    const chart = snaps.find((s) => s.rows.some((r) => r.asin === p.asin));
    const row = chart?.rows.find((r) => r.asin === p.asin);
    const verdict = priceChangeRate(p.lastPrice, row?.price ?? p.lastPrice);
    return { asin: p.asin, verdictZh: verdict.value == null ? `NOT_COMPARABLE：${(verdict.verdict as { reason: string }).reason}` : `同口径可比，变化率 ${(verdict.value * 100).toFixed(1)}%（${METRIC_VERSION}）` };
  });
}
