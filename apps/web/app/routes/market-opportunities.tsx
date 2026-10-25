import { useLoaderData, useFetcher } from "react-router";
import { marketGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { Badge } from "../components/ui/Badge";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "机会研究" };

interface OpportunitiesResponse {
  opportunities: Array<{ id: string; title: string; summaryZh: string; status: string; reviewStatus: string; scoreTotal: number | null; scoreRefused?: string; evidenceCount: number; counterCount: number; gapsCount: number }>;
}

export async function loader({ request }: { request: Request }) {
  const data = await marketGet<OpportunitiesResponse>(request, "/api/market/opportunities").catch(() => null);
  return { data };
}

export function meta() {
  return pageMeta({ title: "机会研究", description: "市场信号机会候选、证据与反证、评分解释与人工研究决策。", noindex: true, path: "/market/opportunities" });
}

const reviewActions = [
  { action: "deep-dive", label: "值得深入研究" }, { action: "watch", label: "暂时观察" }, { action: "need-evidence", label: "需要补证" },
  { action: "high-risk", label: "风险较高" }, { action: "exclude", label: "人工排除" }, { action: "mark-reviewed", label: "已复核" },
] as const;

export default function MarketOpportunities() {
  const { data } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/market", label: "市场信号" }} title="机会研究" />
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 className="text-[22px] font-semibold leading-[1.3] text-ink">机会研究（模块 10/11/12）</h1>
        <p className="mt-1 text-[12.5px] text-ink-3">
          机会=研究候选，不是已验证商机。评分只表示研究优先级（v1 设计假设权重），不是盈利概率；关键证据缺失时拒绝评分。
        </p>
      </header>

      {!data ? (
        <p className="mt-4 rounded bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2">服务不可用或需要管理员会话。需先导入关键词数据并生成候选。</p>
      ) : data.opportunities.length === 0 ? (
        <p className="mt-4 rounded bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2">
          暂无机会候选。导入关键词快照后，通过 API <code className="text-[11.5px]">POST /api/market/opportunities/build</code> 从显著上升词生成候选（需管理员会话）。
        </p>
      ) : (
        <div className="mt-3 space-y-2">
          {data.opportunities.map((o) => (
            <section key={o.id} className="card p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[13.5px] font-semibold text-ink">{o.title}</h2>
                <Badge tone={o.scoreTotal != null ? "ok" : "amber"}>{o.scoreTotal != null ? `研究优先级 ${o.scoreTotal}` : "拒绝评分"}</Badge>
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">{o.summaryZh}</p>
              <p className="mt-1 text-[11.5px] text-ink-4">支持证据 {o.evidenceCount} · 反证 {o.counterCount} · 数据缺口 {o.gapsCount} · 人工状态：{o.reviewStatus}</p>
              {o.scoreRefused && <p className="mt-1 rounded bg-paper-2 px-2 py-1 text-[11.5px] text-warn">{o.scoreRefused}</p>}
              <fetcher.Form method="post" action="/api/market/opportunities/review" className="mt-2 flex flex-wrap items-center gap-1.5">
                <input type="hidden" name="id" value={o.id} />
                {reviewActions.map((a) => (
                  <button key={a.action} type="submit" name="action" value={a.action} className="pill">{a.label}</button>
                ))}
              </fetcher.Form>
            </section>
          ))}
        </div>
      )}

      <section className="mt-5" aria-label="商业情景计算器">
        <h2 className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">商业情景计算器（模块 11 · 纯计算）</h2>
        <p className="mt-1 text-[12px] text-ink-3">所有输入需自行标注来源：真实报价=证据值；估算=假设值。情景测算≠盈利预测；模型不补造未知成本。</p>
        <ScenarioCalculator />
      </section>
    </div>
  );
}

import { useState } from "react";
const FIELDS = [
  { k: "salePriceUsd", label: "售价 $", v: "19.99" }, { k: "purchaseCostUsd", label: "采购价 $", v: "4.50" },
  { k: "moqUnits", label: "MOQ", v: "500" }, { k: "shippingPerUnitUsd", label: "头程/件 $", v: "1.20" },
  { k: "tariffRate", label: "关税率 (0-1)", v: "0.175" }, { k: "referralFeeRate", label: "佣金率 (0-1)", v: "0.15" },
  { k: "fbaPerUnitUsd", label: "FBA/件 $", v: "3.80" }, { k: "adCpcUsd", label: "CPC $", v: "0.80" },
  { k: "conversionRate", label: "转化率 (0-1)", v: "0.10" }, { k: "monthlyAdBudgetUsd", label: "月广告预算 $", v: "600" },
  { k: "returnRate", label: "退货率 (0-1)", v: "0.05" }, { k: "unitsOptimistic", label: "乐观月销", v: "1200" },
  { k: "unitsBase", label: "基准月销", v: "600" }, { k: "unitsConservative", label: "保守月销", v: "250" },
] as const;

function ScenarioCalculator() {
  const [values, setValues] = useState<Record<string, string>>(Object.fromEntries(FIELDS.map((f) => [f.k, f.v])));
  const [result, setResult] = useState<{ rows: Array<{ name: string; units: number; revenue: number; unitEconomics: number; total: number }>; assumptionsNote: string; sensitivity: Array<{ factor: string; note: string }> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setError(null);
    const res = await fetch("/api/market/scenarios", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, Number(v)]))),
    });
    if (!res.ok) { setError("输入不完整（全部字段需为数值）"); setResult(null); return; }
    setResult(await res.json());
  };
  return (
    <div className="mt-2">
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {FIELDS.map((f) => (
          <label key={f.k} className="text-[11.5px] text-ink-3">
            {f.label}
            <input className="mt-0.5 w-full rounded border border-line bg-paper px-2 py-1 text-[12px] text-ink" inputMode="decimal" value={values[f.k] ?? ""} onChange={(e) => setValues({ ...values, [f.k]: e.target.value })} />
          </label>
        ))}
      </div>
      <button type="button" onClick={submit} className="mt-2 rounded bg-accent px-3 py-1 font-medium text-paper">计算三情景</button>
      {error && <p className="mt-1.5 text-[12px] text-warn">{error}</p>}
      {result && (
        <>
          <table className="card mt-2 w-full text-[12.5px]">
            <thead><tr className="border-b border-line text-left text-[11px] uppercase text-ink-4"><th className="px-3 py-1.5">情景</th><th className="px-2 py-1.5">月销量</th><th className="px-2 py-1.5">月收入</th><th className="px-2 py-1.5">单位经济</th><th className="px-3 py-1.5">月合计</th></tr></thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.name} className="border-b border-line/60 last:border-0">
                  <td className="px-3 py-1.5 font-medium text-ink">{r.name}</td>
                  <td className="px-2 py-1.5 text-ink-2">{r.units}</td>
                  <td className="px-2 py-1.5 text-ink-2">${r.revenue.toFixed(0)}</td>
                  <td className={`px-2 py-1.5 ${r.unitEconomics >= 0 ? "text-ok" : "text-warn"}`}>${r.unitEconomics.toFixed(2)}</td>
                  <td className={`px-3 py-1.5 ${r.total >= 0 ? "text-ok" : "text-warn"}`}>${r.total.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1.5 text-[11.5px] text-ink-4">{result.assumptionsNote}</p>
          <ul className="mt-1 list-disc pl-5 text-[11.5px] text-ink-4">{result.sensitivity.map((s) => <li key={s.factor}>{s.factor}：{s.note}</li>)}</ul>
        </>
      )}
    </div>
  );
}
