// The opportunity research engine (R4): assembles market signals into research candidates with
// explicit evidence, counter-evidence and data gaps; refuses to score when key evidence is missing
// (master plan §8.2/8.3 — a score ranks RESEARCH priority, never profit probability). Includes the
// three-scenario commercial calculator (all inputs labelled as evidence or assumption) and the
// in-station alert engine. Deterministic only — the DeepSeek explanation hook is integrated but
// gated (no calls this round; the lane budget is ¥0).
import { sql } from "../db.ts";
import {
  loadMarketAlertRules, loadMarketAlerts, loadMarketOpportunities, reviewAfterBasisChange,
  saveMarketAlerts, saveMarketOpportunity, type MarketAlert, type MarketOpportunity, type MarketReviewAction,
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
export async function buildOpportunityCandidates(opts: { minRise?: number } = {}): Promise<MarketOpportunity[]> {
  const minRise = opts.minRise ?? 10;
  const signals = await detectMarketSignals();
  const kwSignals = signals.filter((s) => s.module === "01" && s.kind === "keyword-rank-rise" && s.strength >= minRise);
  const existing = await loadMarketOpportunities();
  const byTitle = new Map(existing.map((o) => [o.title, o]));
  const created: MarketOpportunity[] = [];
  for (const sig of kwSignals) {
    const title = `需求信号：${sig.subjectZh}`;
    const prev = byTitle.get(title);
    if (prev) {
      const refreshed = { ...prev, basisVersion: sig.basisVersions.join("+"), evidence: dedupeEvidence(prev.evidence, evidenceOf(sig)), review: reviewAfterBasisChange(prev.review, sig.basisVersions.join("+")) };
      await saveMarketOpportunity(refreshed);
      continue;
    }
    const opp: MarketOpportunity = {
      id: "opp-" + sig.id.replace(/[^a-z0-9-]/gi, "").slice(0, 60), title,
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
    };
    await saveMarketOpportunity(opp);
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

/** Evaluates enabled rules against current signals; dedups by (rule, subject, window). */
export async function evaluateAlerts(): Promise<{ fired: number; deduped: number }> {
  const rules = (await loadMarketAlertRules()).filter((r) => r.enabled);
  const signals = await detectMarketSignals();
  const existing = await loadMarketAlerts();
  const seenKeys = new Set(existing.map((a) => a.dedupKey));
  const now = new Date().toISOString();
  const toSave: MarketAlert[] = [];
  let deduped = 0;
  for (const rule of rules) {
    const window = rule.rule.window ?? "latest";
    for (const sig of signals) {
      if (rule.module !== sig.module) continue;
      const match =
        (rule.rule.kind === "keyword-rank-rise" && sig.kind === "keyword-rank-rise" && sig.strength >= rule.rule.threshold) ||
        (rule.rule.kind === "product-rank-change" && sig.kind === "chart-rank-change" && sig.strength >= rule.rule.threshold);
      if (!match) continue;
      const dedupKey = `${rule.id}:${sig.id}:${window}`;
      if (seenKeys.has(dedupKey)) { deduped += 1; continue; }
      seenKeys.add(dedupKey);
      // cooldown: same rule+subject within cooldownHours of an existing alert is skipped
      const subjectPrefix = sig.id.split(":").slice(0, 3).join(":");
      const recent = existing.find((a) => a.ruleId === rule.id && a.dedupKey.startsWith(`${rule.id}:${subjectPrefix}`) && Date.now() - Date.parse(a.firedAt) < rule.cooldownHours * 3600_000);
      if (recent) { deduped += 1; continue; }
      toSave.push({
        id: "alert-" + Math.abs(hashCode(dedupKey)), ruleId: rule.id, subject: sig.subjectZh, detailZh: sig.detailZh,
        firedAt: now, evidenceRefs: sig.evidenceRefs, status: "new", dedupKey,
      });
    }
  }
  if (toSave.length) await saveMarketAlerts(toSave);
  return { fired: toSave.length, deduped };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/* ------------------------------------------------ keyword demand context util */

/** Latest keyword rows for the research page (real data path). */
export async function latestKeywordRows(): Promise<{ periodStart: string; producer: string; sourceId: string; rows: ReturnType<typeof keywordChanges> } | null> {
  const snaps = await loadKeywordSnapshots();
  if (!snaps.length) return null;
  const latest = snaps.sort((a, b) => a.periodStart.localeCompare(b.periodStart))[0]!;
  return { periodStart: latest.periodStart, producer: latest.producer, sourceId: latest.sourceId, rows: keywordChanges(latest) };
}

export const MARKET_METRIC_VERSION = METRIC_VERSION;
