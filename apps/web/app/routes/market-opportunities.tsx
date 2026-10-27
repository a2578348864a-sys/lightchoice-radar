import { Link, useLoaderData } from "react-router";
import { useState } from "react";
import { marketGet } from "../lib/api.server";
import { marketPost } from "../lib/market-client";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { WorkspaceAuthGate } from "../components/shell/WorkspaceAuthGate";
import { Badge } from "../components/ui/Badge";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "机会研究" };

interface OpportunityItem {
  id: string;
  title: string;
  summaryZh: string;
  status: string;
  reviewStatus: string;
  reviewNote?: string;
  qualified: boolean;
  scoreTotal: number | null;
  scoreRefused?: string;
  evidenceCount: number;
  counterCount: number;
  gapsCount: number;
}

interface OpportunitiesResponse {
  opportunities: OpportunityItem[];
}

export async function loader({ request }: { request: Request }) {
  const result = await marketGet<OpportunitiesResponse>(request, "/api/market/opportunities");
  return { result };
}

export function meta() {
  return pageMeta({
    title: "市场机会研究",
    description: "市场机会候选流转、证据与反证对照、三情景商业可行性测算与人工决策。",
    noindex: true,
    path: "/market/opportunities",
  });
}

const reviewActions = [
  { action: "deep-dive", label: "深入研究" },
  { action: "watch", label: "暂时观察" },
  { action: "need-evidence", label: "需要补证" },
  { action: "high-risk", label: "高风险" },
  { action: "exclude", label: "排除" },
  { action: "mark-reviewed", label: "已复核" },
] as const;

export default function MarketOpportunities() {
  const { result } = useLoaderData<typeof loader>();
  const data = result.data;
  const [filterTab, setFilterTab] = useState<string>("all");
  const [isBuilding, setIsBuilding] = useState(false);
  const [buildResult, setBuildResult] = useState<string | null>(null);
  const [oppList, setOppList] = useState<OpportunityItem[]>(data?.opportunities ?? []);

  // One-click generate candidates from signals
  const handleBuild = async () => {
    setIsBuilding(true);
    setBuildResult(null);
    try {
      const res = await marketPost<{ created: unknown[] }>("/api/market/opportunities/build", { minRise: 5 });
      if (res.status === 200) {
        setBuildResult(`✅ 成功从当前排名上升关键词中生成/刷新了 ${res.body?.created?.length ?? 0} 个机会候选！`);
        // Refresh list
        const refreshed = await fetch("/api/market/opportunities").then((r) => r.json());
        if (refreshed?.opportunities) setOppList(refreshed.opportunities);
      } else {
        setBuildResult("❌ 生成失败，请确认后端 API 正常运行并已通过鉴权。");
      }
    } catch {
      setBuildResult("网络或服务异常。");
    } finally {
      setIsBuilding(false);
    }
  };

  const filteredOpps = oppList.filter((o) => {
    if (filterTab === "all") return true;
    if (filterTab === "needs-evidence") return o.status === "needs-evidence";
    if (filterTab === "qualified") return o.qualified;
    if (filterTab === "reviewed") return o.reviewStatus === "reviewed" || o.reviewStatus === "deep-dive";
    return o.reviewStatus === filterTab;
  });

  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/market", label: "市场信号" }} title="机会研究" />
      <nav aria-label="面包屑导航" className="hidden lg:flex items-center gap-1.5 text-[12px] text-ink-4 pb-2">
        <Link to="/market" className="hover:text-ink transition-colors">市场信号</Link>
        <span>/</span>
        <span className="text-ink-2 font-medium">市场机会研究</span>
      </nav>
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 className="text-[22px] font-semibold leading-[1.3] text-ink">机会研究（模块 10/11/12）</h1>
        <p className="mt-1 text-[12.5px] text-ink-3">
          机会=研究候选，<strong>不是已验证商机</strong>。评分仅代表当前研究优先级（v1 设计假设权重）；关键证据缺失时拒绝评分。
        </p>
      </header>

      <WorkspaceAuthGate error={result.error} laneName="市场机会研究" returnTo="/market/opportunities">

      {/* Action bar */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
        <div className="flex flex-wrap gap-1 text-[12px]">
          <button
            type="button"
            onClick={() => setFilterTab("all")}
            className={`pill ${filterTab === "all" ? "bg-accent text-paper font-semibold" : ""}`}
          >
            全部 ({oppList.length})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab("needs-evidence")}
            className={`pill ${filterTab === "needs-evidence" ? "bg-accent text-paper font-semibold" : ""}`}
          >
            待补证 ({oppList.filter((o) => o.status === "needs-evidence").length})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab("qualified")}
            className={`pill ${filterTab === "qualified" ? "bg-accent text-paper font-semibold" : ""}`}
          >
            已评分合格 ({oppList.filter((o) => o.qualified).length})
          </button>
          <button
            type="button"
            onClick={() => setFilterTab("reviewed")}
            className={`pill ${filterTab === "reviewed" ? "bg-accent text-paper font-semibold" : ""}`}
          >
            已人工决策 ({oppList.filter((o) => o.reviewStatus !== "pending").length})
          </button>
        </div>

        <button
          type="button"
          onClick={handleBuild}
          disabled={isBuilding}
          className="rounded bg-accent/90 px-3 py-1 text-[12px] font-medium text-paper hover:bg-accent disabled:opacity-50"
        >
          {isBuilding ? "正在扫描信号…" : "⚡ 从上升词生成研究候选"}
        </button>
      </div>

      {buildResult && (
        <p className="mt-2 rounded bg-paper-2 p-2 text-[12px] text-ink-2">{buildResult}</p>
      )}

      {/* Opportunities List */}
      {!data ? (
        <p className="mt-4 rounded bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2">
          服务不可用或需要管理员会话。系统将在后台自动轮询观测并提炼候选。
        </p>
      ) : filteredOpps.length === 0 ? (
        <div className="mt-4 rounded bg-paper-2 p-4 text-center text-[12.5px] text-ink-3">
          <p>当前筛选条件下暂无机会候选。</p>
          <p className="mt-1 text-[11.5px] text-ink-4">
            新观测到达时系统将自动生成线索；亦可点击上方「⚡ 从上升词生成研究候选」即刻重新扫描。
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-2.5">
          {filteredOpps.map((o) => (
            <OpportunityCard
              key={o.id}
              opp={o}
              onReviewUpdated={(id, action, note) => {
                setOppList((prev) =>
                  prev.map((item) =>
                    item.id === id ? { ...item, reviewStatus: action, reviewNote: note } : item
                  )
                );
              }}
            />
          ))}
        </div>
      )}

      {/* Commercial Feasibility Calculator */}
      <section className="mt-6 border-t border-line pt-4" aria-label="商业情景计算器">
        <h2 className="text-[14px] font-semibold text-ink">三情景商业可行性计算器（模块 11 · 纯数学模型）</h2>
        <p className="mt-0.5 text-[12px] text-ink-3">
          所有输入均标注口径（真实报价=证据值；预估=假设值）。计算器进行纯前端数学运算，零 API 调用，不捏造未知成本。
        </p>
        <ScenarioCalculator />
      </section>
      </WorkspaceAuthGate>
    </div>
  );
}

function OpportunityCard({
  opp,
  onReviewUpdated,
}: {
  opp: OpportunityItem;
  onReviewUpdated: (id: string, action: string, note?: string) => void;
}) {
  const [customNote, setCustomNote] = useState("");
  const [showNoteInput, setShowNoteInput] = useState(false);
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);

  const handleAction = async (action: string) => {
    setSubmittingAction(action);
    const { status } = await marketPost("/api/market/opportunities/review", {
      id: opp.id,
      action,
      note: customNote || undefined,
    });
    setSubmittingAction(null);
    if (status === 200) {
      onReviewUpdated(opp.id, action, customNote || undefined);
      setShowNoteInput(false);
    }
  };

  return (
    <section className="card p-3.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[13.5px] font-semibold text-ink">{opp.title}</h2>
        <div className="flex items-center gap-1.5">
          <Badge tone={opp.qualified ? "ok" : "amber"}>
            {opp.qualified ? `已评分·优先级 ${opp.scoreTotal}` : "待补证·评分拒绝"}
          </Badge>
          <Badge tone={opp.reviewStatus === "pending" ? "neutral" : "ok"}>
            决策: {opp.reviewStatus}
          </Badge>
        </div>
      </div>

      <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{opp.summaryZh}</p>

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-ink-4">
        <span>支持证据: <strong className="text-ink">{opp.evidenceCount}</strong> 条</span>
        <span>反证/约束: <strong className="text-ink">{opp.counterCount}</strong> 条</span>
        <span>数据缺口: <strong className="text-ink">{opp.gapsCount}</strong> 项</span>
      </div>

      {opp.reviewNote && (
        <p className="mt-1 rounded bg-paper-2 px-2.5 py-1 text-[11.5px] text-amber-ink">
          📝 历史决策备注：{opp.reviewNote}
        </p>
      )}

      {opp.scoreRefused && (
        <p className="mt-1 rounded bg-paper-2 px-2.5 py-1 text-[11.5px] text-warn">
          ⚠️ 评分拒绝原因：{opp.scoreRefused}
        </p>
      )}

      {/* Decision Actions */}
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5 pt-1 border-t border-line/60">
        <span className="text-[11.5px] text-ink-4 mr-1">人工决策标记:</span>
        {reviewActions.map((a) => (
          <button
            key={a.action}
            type="button"
            disabled={submittingAction != null}
            onClick={() => handleAction(a.action)}
            className={`pill text-[11.5px] ${
              opp.reviewStatus === a.action ? "bg-accent text-paper font-semibold" : ""
            }`}
          >
            {a.label}
            {opp.reviewStatus === a.action ? " ✓" : ""}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowNoteInput(!showNoteInput)}
          className="pill text-[11px] text-ink-4"
        >
          {showNoteInput ? "取消附言" : "+ 添加备注"}
        </button>
      </div>

      {showNoteInput && (
        <div className="mt-2 flex gap-1.5">
          <input
            type="text"
            value={customNote}
            onChange={(e) => setCustomNote(e.target.value)}
            placeholder="输入决策理由或补证说明…"
            className="flex-1 rounded border border-line bg-paper px-2 py-1 text-[11.5px] text-ink"
          />
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------ Scenario Calculator */

const FIELDS = [
  { k: "salePriceUsd", label: "零售售价 $", v: "19.99" },
  { k: "purchaseCostUsd", label: "采购成本 $", v: "4.50" },
  { k: "moqUnits", label: "起订量 MOQ", v: "500" },
  { k: "shippingPerUnitUsd", label: "头程物流/件 $", v: "1.20" },
  { k: "tariffRate", label: "关税率 (0~1)", v: "0.175" },
  { k: "referralFeeRate", label: "平台佣金率 (0~1)", v: "0.15" },
  { k: "fbaPerUnitUsd", label: "FBA配送/件 $", v: "3.80" },
  { k: "adCpcUsd", label: "广告 CPC $", v: "0.80" },
  { k: "conversionRate", label: "广告转化率 (0~1)", v: "0.10" },
  { k: "monthlyAdBudgetUsd", label: "月广告预算 $", v: "600" },
  { k: "returnRate", label: "退货损耗率 (0~1)", v: "0.05" },
  { k: "unitsOptimistic", label: "乐观月销 (件)", v: "1200" },
  { k: "unitsBase", label: "基准月销 (件)", v: "600" },
  { k: "unitsConservative", label: "保守月销 (件)", v: "250" },
] as const;

function ScenarioCalculator() {
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(FIELDS.map((f) => [f.k, f.v]))
  );
  const [result, setResult] = useState<{
    rows: Array<{
      name: string;
      units: number;
      revenue: number;
      unitEconomics: number;
      total: number;
    }>;
    assumptionsNote: string;
    sensitivity: Array<{ factor: string; note: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);

  const submit = async () => {
    setError(null);
    setCalculating(true);
    const { status, body } = await marketPost<{
      rows?: Array<{ name: string; units: number; revenue: number; unitEconomics: number; total: number }>;
      assumptionsNote?: string;
      sensitivity?: Array<{ factor: string; note: string }>;
      error?: string;
    }>(
      "/api/market/scenarios",
      Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]))
    );
    setCalculating(false);
    if (status !== 200 || !body?.rows) {
      setError(body?.error ?? `计算失败（${status}）`);
      setResult(null);
      return;
    }
    setResult(body as never);
  };

  return (
    <div className="card mt-2 p-3.5">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-[12px]">
        {FIELDS.map((f) => (
          <div key={f.k}>
            <label className="block text-[11px] text-ink-3">{f.label}</label>
            <input
              type="text"
              value={values[f.k]}
              onChange={(e) => setValues({ ...values, [f.k]: e.target.value })}
              className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1 font-mono text-[11.5px] text-ink"
            />
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={calculating}
          className="rounded bg-accent px-4 py-1.5 text-[12.5px] font-medium text-paper disabled:opacity-50"
        >
          {calculating ? "计算中…" : "计算三情景利润与敏感性"}
        </button>
        <span className="text-[11.5px] text-ink-4">纯前端确定性模型 · 零网络开销</span>
      </div>

      {error && <p className="mt-2 text-[12px] text-warn">{error}</p>}

      {result && (
        <div className="mt-3 space-y-3">
          <div className="overflow-x-auto rounded border border-line">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-paper-2 text-ink-3 text-[11px]">
                <tr>
                  <th className="p-2">情景</th>
                  <th className="p-2">月销量</th>
                  <th className="p-2">总销售额</th>
                  <th className="p-2">单件利润 (Unit Margin)</th>
                  <th className="p-2">月净收益 (Net Profit)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-ink">
                {result.rows.map((r) => (
                  <tr key={r.name} className="hover:bg-paper-2">
                    <td className="p-2 font-semibold">{r.name}</td>
                    <td className="p-2 font-mono">{r.units} 件</td>
                    <td className="p-2 font-mono">${r.revenue.toFixed(2)}</td>
                    <td className="p-2 font-mono font-medium text-ok">${r.unitEconomics.toFixed(2)}</td>
                    <td className="p-2 font-mono font-bold text-ink">${r.total.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.sensitivity && result.sensitivity.length > 0 && (
            <div className="rounded bg-paper-2 p-2.5 text-[11.5px] text-ink-3">
              <span className="font-semibold text-ink">敏感性分析：</span>
              <ul className="mt-1 list-disc pl-4 space-y-0.5">
                {result.sensitivity.map((s, idx) => (
                  <li key={idx}>
                    <strong>{s.factor}</strong>：{s.note}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] text-ink-4">{result.assumptionsNote}</p>
        </div>
      )}
    </div>
  );
}
