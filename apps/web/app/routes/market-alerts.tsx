import { Link, useLoaderData } from "react-router";
import { marketGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { Badge } from "../components/ui/Badge";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "市场预警" };

interface AlertsResponse {
  rules: Array<{ id: string; name: string; module: string; kind: string; threshold: number; cooldownHours: number; enabled: boolean }>;
  alerts: Array<{ id: string; ruleId: string; subject: string; detailZh: string; firedAt: string; status: string }>;
}

export async function loader({ request }: { request: Request }) {
  const data = await marketGet<AlertsResponse>(request, "/api/market/alerts").catch(() => null);
  return { data };
}

export function meta() {
  return pageMeta({ title: "市场预警", description: "市场信号站内预警：规则、去重、冷却与失效。", noindex: true, path: "/market/alerts" });
}

const kindZh: Record<string, string> = { "keyword-rank-rise": "关键词排名上升 ≥", "keyword-rank-drop": "关键词排名下降 ≥", "product-rank-change": "商品榜单位次变化 ≥", "price-change": "价格变化 ≥" };

export default function MarketAlerts() {
  const { data } = useLoaderData<typeof loader>();
  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/market", label: "市场信号" }} title="市场预警" />
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 className="text-[22px] font-semibold leading-[1.3] text-ink">预警工作台（模块 12）</h1>
        <p className="mt-1 text-[12.5px] text-ink-3">仅站内预警：按规则评估信号，带去重与冷却；证据修订后关联预警失效。<strong>不发送任何外部通知</strong>（飞书/邮件等渠道默认关闭，未授权不开启）。</p>
      </header>

      {!data ? (
        <p className="mt-4 rounded bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2">服务不可用或需要管理员会话。</p>
      ) : (
        <>
          <section className="mt-3" aria-label="预警规则">
            <h2 className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">规则（{data.rules.length}）</h2>
            {data.rules.length === 0 ? (
              <p className="mt-1 text-[12.5px] text-ink-2">暂无规则。可通过 API <code className="text-[11.5px]">POST /api/market/alerts/rules</code> 创建（如：模块 01，关键词排名上升 ≥ 10 位）。</p>
            ) : (
              <ul className="mt-1 space-y-1 text-[12.5px]">
                {data.rules.map((r) => (
                  <li key={r.id} className="card flex flex-wrap items-baseline justify-between gap-2 p-2.5">
                    <span><span className="font-medium text-ink">{r.name}</span> · 模块 {r.module} · {kindZh[r.kind] ?? r.kind}{r.threshold} · 冷却 {r.cooldownHours}h</span>
                    <Badge tone={r.enabled ? "ok" : "neutral"}>{r.enabled ? "启用" : "停用"}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-4" aria-label="已触发预警">
            <h2 className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">已触发（{data.alerts.length}）</h2>
            {data.alerts.length === 0 ? (
              <p className="mt-1 text-[12.5px] text-ink-2">暂无预警。导入数据并创建规则后，通过 API <code className="text-[11.5px]">POST /api/market/alerts/evaluate</code> 评估。</p>
            ) : (
              <ul className="mt-1 space-y-1 text-[12.5px]">
                {data.alerts.map((a) => (
                  <li key={a.id} className="card p-2.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-medium text-ink">{a.subject}</span>
                      <span className="text-[11px] text-ink-4">{a.firedAt.slice(0, 16).replace("T", " ")} · {a.status}</span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-ink-3">{a.detailZh}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <nav className="mt-4 flex flex-wrap gap-1.5 text-[12px]">
            <Link to="/market/opportunities" className="pill">查看机会研究 →</Link>
          </nav>
        </>
      )}
    </div>
  );
}
