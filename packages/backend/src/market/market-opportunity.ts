// The opportunity research engine (R4): assembles market signals into research candidates with
// explicit evidence, counter-evidence and data gaps; refuses to score when key evidence is missing
// (master plan §8.2/8.3 — a score ranks RESEARCH priority, never profit probability). Includes the
// three-scenario commercial calculator (all inputs labelled as evidence or assumption) and the
// in-station alert engine. Deterministic only — the DeepSeek explanation hook is integrated but
// gated (no calls this round; the lane budget is ¥0).
import { sql } from "../db.ts";
import {
  loadMarketAlertRules, loadMarketAlerts, loadMarketOpportunities, reviewAfterBasisChange,
  saveMarketAlerts, saveMarketOpportunity, type MarketAlert, type MarketAlertKind, type MarketOpportunity, type MarketReviewAction,
  type MarketOpportunityEvidence,
} from "./market-model.ts";
import { detectMarketSignals, loadKeywordSnapshots, keywordChanges, METRIC_VERSION, type MarketSignal } from "./market-metrics.ts";

export const OPPORTUNITY_SCORE_VERSION = "opp-score-v1";

/* ------------------------------------------------------- candidate generation */

/**
 * Builds keyword-demand opportunities from real signals. A candidate is ALWAYS created with its
 * honest data gaps; without supply/competition/pain evidence it stays "needs-evidence" and the
 * scorer refuses a total — it can never appear as a "已验证商机".
 */
export async function buildOpportunityCandidates(opts: { minRise?: number; /** Opt-in cap for callers that want a bounded batch; default creates ALL qualifying leads (idempotent dedup — nothing is silently dropped). */ maxPerRun?: number } = {}): Promise<MarketOpportunity[]> {
  const minRise = opts.minRise ?? 10;
  const signals = await detectMarketSignals();
  const kwSignals = signals
    .filter((s) => s.module === "01" && s.kind === "keyword-rank-rise" && s.strength >= minRise)
    .sort((a, b) => b.strength - a.strength)
    .slice(0, opts.maxPerRun); // optional cap; undefined keeps every qualifying lead
  const existing = await loadMarketOpportunities();
  const byKey = new Map(existing.map((o) => [o.id, o]));
  const created: MarketOpportunity[] = [];
  for (const sig of kwSignals) {
    const kwMatch = /关键词「(.+?)」/.exec(sig.subjectZh);
    const kw = kwMatch ? kwMatch[1]! : sig.id;
    const cleanKwId = kw.toLowerCase().replace(/[^a-z0-9_-]/gi, "-").replace(/-+/g, "-").slice(0, 40) || "kw";
    // Structured stable identity (master plan §3.2 + Auto-First): marketplace:type:identifier
    const oppId = `opp:US:keyword:${cleanKwId}`;
    const legacyId = `opp-kw-${cleanKwId}`;
    const title = `研究线索（待补证）：关键词「${kw}」需求上升`;
    const prev = byKey.get(oppId) || byKey.get(legacyId) || existing.find((o) => o.title === title || o.id === "opp-" + sig.id.replace(/[^a-z0-9-]/gi, "").slice(0, 60));

    const explanation = {
      whatHappenedZh: `监测到关键词「${kw}」搜索排名较前序观测发生正向位移（+${sig.strength} 位）。`,
      changeAnalysisZh: `排名从前序状态上升至当前最新观测，展现阶段性买家主动搜索需求热度提升。`,
      supportingEvidenceZh: [sig.detailZh, "来源依据：Amazon ABA 搜索词快照序列（按周统计）"],
      counterEvidenceZh: [
        "排名上升仅代表搜索排位相对靠前，不代表全网绝对搜索量或订单增长（C1 规则）。",
        "尚未取得目标类目商品层面的真实供给分布与头部垄断程度证据（需 M03/M05）。",
      ],
      whyAttentionNeededZh: `短期位移迅速通常伴随潜在季节性或爆款发酵，值得作为利基市场研究候选跟进。`,
      whyNotInstantSilverBulletZh: `缺少真实采购成本、FBA 费率、退货率及广告竞价 CPC 数据，绝不能直接认定为可盈利商机。`,
      unverifiedInformationGapsZh: [
        "商品级在售规格与平均客单价（M03 缺）",
        "类目退货率与消费者主要缺陷痛点（VOC 缺）",
        "专利侵权或安全认证准入门槛（M12 缺）",
      ],
    };

    if (prev) {
      const refreshed: MarketOpportunity = {
        ...prev,
        basisVersion: sig.basisVersions.join("+"),
        evidence: dedupeEvidence(prev.evidence, evidenceOf(sig)),
        review: reviewAfterBasisChange(prev.review, sig.basisVersions.join("+")),
        explanation,
      };
      await saveMarketOpportunity(refreshed);
      byKey.set(prev.id, refreshed);
      continue;
    }
    const opp: MarketOpportunity = {
      id: oppId, title,
      summaryZh: `${sig.detailZh} 该信号仅证明关键词排名变化；供给、竞争与消费者痛点证据尚未取得。`,
      status: "needs-evidence", module: "10",
      evidence: [evidenceOf(sig)],
      counterEvidence: [{
        kind: "counter", origin: "system", producer: "系统核验",
        statement: "供给/竞争/痛点证据缺失：关键词排名上升不能证明供不应求（master plan §7 模块 10 冻结规则）",
        evidenceGroup: "system-gate",
      }],
      dataGaps: ["无商品级供给证据（M03 单期样本）", "无跨期价格/竞争历史（M04/M06）", "无消费者原声交叉证据（三线材料外发受限）"],
      score: null, review: { status: "pending" },
      basisVersion: sig.basisVersions.join("+"), createdAt: new Date().toISOString(),
      explanation,
    };
    await saveMarketOpportunity(opp);
    byKey.set(opp.id, opp);
    created.push(opp);
  }
  return created;
}

function evidenceOf(sig: MarketSignal): MarketOpportunityEvidence {
  return { kind: "demand", origin: sig.evidenceRefs[0] ?? "market", producer: "Amazon ABA（AMZ123 二手展示）", statement: sig.detailZh, evidenceGroup: "aba-via-amz123" };
}

function dedupeEvidence(list: MarketOpportunityEvidence[], add: MarketOpportunityEvidence): MarketOpportunityEvidence[] {
  return list.some((e) => e.statement === add.statement) ? list : [...list, add];
}

/* ------------------------------------------------------------------- scoring */

/**
 * v1 weights are a DESIGN HYPOTHESIS from R0, not a calibrated model. Refuses a total when key
 * evidence classes are absent — the refusal itself is the output, never a zero-filled score.
 */
export function scoreOpportunity(opp: MarketOpportunity): MarketOpportunity["score"] {
  const has = (kinds: MarketOpportunityEvidence["kind"][]) => kinds.some((k) => opp.evidence.some((e) => e.kind === k));
  const demand = opp.evidence.filter((e) => e.kind === "demand").length;
  const independentGroups = new Set(opp.evidence.map((e) => e.evidenceGroup)).size;
  const counters = opp.counterEvidence.filter((e) => e.kind === "counter").length;
  const components: Record<string, number> = {
    "需求证据强度（v1 设计假设权重 0.4）": Math.min(demand, 3) / 3 * 40,
    "证据独立性（0.2）": Math.min(independentGroups, 3) / 3 * 20,
    "供给/竞争对照（0.2）": has(["supply", "competition"]) ? 20 : 0,
    "痛点/外部交叉（0.2）": has(["pain", "external"]) ? 20 : 0,
  };
  if (!has(["supply", "competition"])) {
    return { version: OPPORTUNITY_SCORE_VERSION, total: null, components, refusedReason: "缺少供给或竞争证据——按冻结规则拒绝总分（允许保持待补证候选，不得进入已验证商机）" };
  }
  const penalty = counters > 0 ? 10 : 0;
  const total = Math.max(0, Math.round(Object.values(components).reduce((a, b) => a + b, 0) - penalty));
  return { version: OPPORTUNITY_SCORE_VERSION, total, components };
}

/* ------------------------------------------------------- scenario calculator */

export interface ScenarioInput {
  /** All money inputs in USD unless noted; each labelled by the caller as evidence or assumption. */
  salePriceUsd: number; purchaseCostUsd: number; moqUnits: number;
  shippingPerUnitUsd: number; tariffRate: number; // e.g. 0.175
  referralFeeRate: number; fbaPerUnitUsd: number;
  adCpcUsd: number; conversionRate: number; // ad model: sales = clicks × cvr
  monthlyAdBudgetUsd: number; returnRate: number; // e.g. 0.05
  unitsOptimistic: number; unitsBase: number; unitsConservative: number;
}
export interface ScenarioRow { name: "乐观" | "基准" | "保守"; units: number; revenue: number; unitEconomics: number; total: number }
export interface ScenarioResult {
  rows: ScenarioRow[];
  formulaVersion: string;
  assumptionsNote: string;
  sensitivity: Array<{ factor: string; note: string }>;
}

/**
 * M11 — three-scenario unit economics. Pure arithmetic over caller-labelled inputs; a scenario
 * projection is NOT a profit forecast, and the result always says so. No AI-filled unknowns.
 */
export function computeScenarios(input: ScenarioInput): ScenarioResult {
  const perUnit = (units: number): ScenarioRow => {
    const tariffPerUnit = input.purchaseCostUsd * input.tariffRate;
    const clicksNeeded = input.conversionRate > 0 ? units / input.conversionRate : 0;
    const adPerUnit = units > 0 ? Math.min(input.monthlyAdBudgetUsd / units, clicksNeeded > 0 ? input.monthlyAdBudgetUsd / units : input.monthlyAdBudgetUsd / units) : 0;
    const landed = input.purchaseCostUsd + tariffPerUnit + input.shippingPerUnitUsd;
    const platform = input.salePriceUsd * input.referralFeeRate + input.fbaPerUnitUsd;
    const returns = (landed + platform) * input.returnRate;
    const unitEconomics = input.salePriceUsd - landed - platform - adPerUnit - returns;
    return { name: units === input.unitsOptimistic ? "乐观" : units === input.unitsBase ? "基准" : "保守", units, revenue: units * input.salePriceUsd, unitEconomics, total: unitEconomics * units };
  };
  const adCapNote = input.monthlyAdBudgetUsd > 0
    ? `广告按月预算 $${input.monthlyAdBudgetUsd} 分摊到各情景销量（简化线性模型，非 CPC 竞价真实约束）`
    : "未设广告预算（广告=0）";
  return {
    rows: [perUnit(input.unitsOptimistic), perUnit(input.unitsBase), perUnit(input.unitsConservative)],
    formulaVersion: "scenario-v1",
    assumptionsNote: "情景测算≠盈利预测：所有输入为用户标注的证据值或假设值；采购价/MOQ/关税等为假设时结果仅代表演算；模型不补造未知成本（master plan §7 模块 11 冻结）。",
    sensitivity: [
      { factor: "采购价 ±10%", note: `单位经济性约变动 $${(input.purchaseCostUsd * 1.1 - input.purchaseCostUsd).toFixed(2)}–$${(input.purchaseCostUsd * 0.9 - input.purchaseCostUsd).toFixed(2)}（不含连锁）` },
      { factor: "转化率减半", note: `达成同销量所需点击翻倍（当前 CVR ${input.conversionRate}）` },
      { factor: "退货率 +5pp", note: `单位成本增加约 $${(((input.purchaseCostUsd * (1 + input.tariffRate) + input.shippingPerUnitUsd) + (input.salePriceUsd * input.referralFeeRate + input.fbaPerUnitUsd)) * 0.05).toFixed(2)}` },
    ],
  };
}

/* ------------------------------------------------------------- human review */

const REVIEW_ACTIONS: Record<MarketReviewAction, string> = {
  "deep-dive": "值得深入研究", watch: "暂时观察", "need-evidence": "需要补证", "high-risk": "风险较高",
  exclude: "人工排除", "mark-reviewed": "已复核",
};

export async function reviewOpportunity(id: string, action: MarketReviewAction, note: string | undefined, decidedBy: string): Promise<{ ok: boolean; reason?: string }> {
  const opp = await loadMarketOpportunityById(id);
  if (!opp) return { ok: false, reason: "机会不存在" };
  const status: MarketOpportunity["review"]["status"] =
    action === "exclude" ? "excluded" : action === "mark-reviewed" ? "reviewed" : action === "deep-dive" ? "deep-dive" : action === "watch" ? "watch" : action === "high-risk" ? "high-risk" : "need-evidence";
  const review = { status, note: note ?? REVIEW_ACTIONS[action], basisVersion: opp.basisVersion, decidedAt: new Date().toISOString(), decidedBy };
  await saveMarketOpportunity({ ...opp, review });
  return { ok: true };
}

async function loadMarketOpportunityById(id: string) {
  const [row] = await sql<{ value: MarketOpportunity }[]>`SELECT value FROM settings WHERE key = ${`market.opp.${id}`}`;
  return row?.value ?? null;
}

/** Recomputes scores and refreshes review states after upstream evidence revisions. */
export async function refreshOpportunities(): Promise<{ refreshed: number; rescored: number }> {
  const opps = await loadMarketOpportunities();
  let refreshed = 0, rescored = 0;
  for (const opp of opps) {
    const score = scoreOpportunity(opp);
    if (!score) continue;
    const changed = score.total !== opp.score?.total || score.refusedReason !== opp.score?.refusedReason;
    if (changed) rescored += 1;
    await saveMarketOpportunity({ ...opp, score, review: reviewAfterBasisChange(opp.review, opp.basisVersion) });
    refreshed += 1;
  }
  return { refreshed, rescored };
}

/* ------------------------------------------------------------------- alerts */

/**
 * The alert engine (R6-CLOSE task 3 rewrite). Three business layers stay separate:
 *   signals (facts) -> opportunity candidates (research leads, may refuse scoring) -> alerts.
 * Rules of kind keyword/product/price fire "market-change" alerts — plain observed changes with
 * the rule, threshold and evidence spelled out; NEVER displayed as opportunities. Only the
 * "qualified-opportunity" rule kind fires for candidates whose score is NOT refused (supply or
 * competition evidence exists) — a refused-score candidate can never raise one.
 */
export async function evaluateAlerts(): Promise<{ fired: number; deduped: number; byKind: Record<string, number> }> {
  const rules = (await loadMarketAlertRules()).filter((r) => r.enabled);
  const existing = await loadMarketAlerts();
  const seenKeys = new Set(existing.map((a) => a.dedupKey));
  const now = new Date().toISOString();
  const toSave: MarketAlert[] = [];
  let deduped = 0;

  const tryFire = (rule: { id: string; cooldownHours: number }, kind: MarketAlertKind, subject: string, detailZh: string, reasonZh: string, dedupKey: string, evidenceRefs: string[]) => {
    if (seenKeys.has(dedupKey)) { deduped += 1; return; }
    const recent = existing.find((a) => a.ruleId === rule.id && a.subject === subject && a.status !== "retired" && Date.now() - Date.parse(a.firedAt) < rule.cooldownHours * 3600_000);
    if (recent) { deduped += 1; return; }
    seenKeys.add(dedupKey);
    toSave.push({
      id: "alert-" + Math.abs(hashCode(dedupKey)), ruleId: rule.id, kind, subject, detailZh, reasonZh,
      firedAt: now, evidenceRefs, status: "new", dedupKey,
    });
  };

  for (const rule of rules) {
    if (rule.rule.kind === "qualified-opportunity") {
      const opps = await loadMarketOpportunities();
      for (const opp of opps) {
        if (opp.score?.total == null) continue; // refused scoring -> never a qualified-opportunity alert
        if (opp.score.total < rule.rule.threshold) continue;
        tryFire(rule, "qualified-opportunity", opp.title, opp.summaryZh,
          `规则「${rule.name}」：已评分候选研究优先级 ${opp.score.total} ≥ ${rule.rule.threshold}（评分版本 ${opp.score.version}；证据版本 ${opp.basisVersion}）。评分=研究优先级，非成功概率。`,
          `${rule.id}:${opp.id}:${opp.basisVersion}`, opp.evidence.map((e) => e.origin));
      }
      continue;
    }
    const signals = await detectMarketSignals();
    for (const sig of signals) {
      if (rule.module !== sig.module) continue;
      const match =
        (rule.rule.kind === "keyword-rank-rise" && sig.kind === "keyword-rank-rise" && sig.strength >= rule.rule.threshold) ||
        (rule.rule.kind === "keyword-rank-drop" && sig.kind === "keyword-rank-drop" && sig.strength >= rule.rule.threshold) ||
        (rule.rule.kind === "product-rank-change" && sig.kind === "chart-rank-change" && sig.strength >= rule.rule.threshold);
      if (!match) continue;
      tryFire(rule, "market-change", sig.subjectZh, sig.detailZh,
        `规则「${rule.name}」命中：模块 ${rule.module}，阈值 ${rule.rule.threshold}，本次强度 ${sig.strength}；公式 ${sig.formulaVersion}；证据 ${sig.evidenceRefs.join(", ")}。这是普通市场变化通知，不是已验证商机。`,
        `${rule.id}:${sig.id}`, sig.evidenceRefs);
    }
  }
  if (toSave.length) await saveMarketAlerts(toSave);
  const byKind: Record<string, number> = {};
  for (const a of toSave) byKind[a.kind] = (byKind[a.kind] ?? 0) + 1;
  return { fired: toSave.length, deduped, byKind };
}

/** Retires alerts whose evidence refs touch the given source id (revocation propagation). */
export async function retireAlertsForSource(sourceId: string, reason: string): Promise<number> {
  const alerts = await loadMarketAlerts();
  let n = 0;
  for (const a of alerts) {
    if (a.status === "retired") continue;
    if (a.evidenceRefs.some((r) => r.includes(`/${sourceId}/`) || r.includes(sourceId))) {
      await saveMarketAlerts([{ ...a, status: "retired", reasonZh: `已失效：${reason}` }]);
      n += 1;
    }
  }
  return n;
}

/** Full revocation propagation: source off -> alerts retired, dependent opportunities re-review. */
export async function propagateSourceRevocation(sourceId: string, reason: string): Promise<{ alertsRetired: number; opportunitiesFlagged: number }> {
  const alertsRetired = await retireAlertsForSource(sourceId, reason);
  const opps = await loadMarketOpportunities();
  let opportunitiesFlagged = 0;
  for (const opp of opps) {
    if (!opp.evidence.some((e) => e.origin.includes(sourceId))) continue;
    await saveMarketOpportunity({
      ...opp,
      review: { ...opp.review, status: "need-evidence", note: `REVIEW_REQUIRED: 证据来源 ${sourceId} 已撤销（${reason}）` },
    });
    opportunitiesFlagged += 1;
  }
  return { alertsRetired, opportunitiesFlagged };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/** Retires qualified-opportunity alerts whose opportunity now refuses scoring (revision propagation). */
export async function retireUnqualifiedAlerts(): Promise<number> {
  const [alerts, opps] = await Promise.all([loadMarketAlerts(), loadMarketOpportunities()]);
  const qualifiedIds = new Set(opps.filter((o) => o.score?.total != null).map((o) => o.id));
  let n = 0;
  for (const a of alerts) {
    if (a.kind !== "qualified-opportunity" || a.status === "retired") continue;
    const oppId = a.dedupKey.split(":")[1];
    if (oppId && !qualifiedIds.has(oppId)) {
      await saveMarketAlerts([{ ...a, status: "retired", reasonZh: "已失效：候选评分被拒绝（证据版本变化），不再符合高价值条件" }]);
      n += 1;
    }
  }
  return n;
}

/** Latest keyword rows for the research page (real data path). */
export async function latestKeywordRows(): Promise<{ periodStart: string; producer: string; sourceId: string; rows: ReturnType<typeof keywordChanges> } | null> {
  const snaps = await loadKeywordSnapshots();
  if (!snaps.length) return null;
  const latest = snaps.sort((a, b) => a.periodStart.localeCompare(b.periodStart))[0]!;
  return { periodStart: latest.periodStart, producer: latest.producer, sourceId: latest.sourceId, rows: keywordChanges(latest) };
}

export const MARKET_METRIC_VERSION = METRIC_VERSION;
