import { Link, useLoaderData } from "react-router";
import { useState } from "react";
import { marketGet } from "../lib/api.server";
import { marketPost } from "../lib/market-client";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { WorkspaceAuthGate } from "../components/shell/WorkspaceAuthGate";
import { Badge } from "../components/ui/Badge";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "市场预警" };

interface AlertItem {
  id: string;
  ruleId: string;
  kind: string;
  kindZh: string;
  subject: string;
  detailZh: string;
  reasonZh: string;
  firedAt: string;
  status: string;
}

interface AlertsResponse {
  rules: Array<{ id: string; name: string; module: string; kind: string; threshold: number; cooldownHours: number; enabled: boolean }>;
  alerts: AlertItem[];
}

export async function loader({ request }: { request: Request }) {
  const result = await marketGet<AlertsResponse>(request, "/api/market/alerts");
  return { result };
}

export function meta() {
  return pageMeta({
    title: "市场预警工作台",
    description: "市场信号站内预警：规则评估、去重、冷却与失效管理。",
    noindex: true,
    path: "/market/alerts",
  });
}

const kindZh: Record<string, string> = {
  "keyword-rank-rise": "关键词排名上升 ≥",
  "keyword-rank-drop": "关键词排名下降 ≥",
  "product-rank-change": "商品榜单位次变化 ≥",
  "price-change": "价格变化 ≥",
  "qualified-opportunity": "已评分候选优先级 ≥",
};

export default function MarketAlerts() {
  const { result } = useLoaderData<typeof loader>();
  const data = result.data;
  const [alertsList, setAlertsList] = useState<AlertItem[]>(data?.alerts ?? []);
  const [evaluating, setEvaluating] = useState(false);
  const [evalResult, setEvalResult] = useState<string | null>(null);

  const handleEvaluate = async () => {
    setEvaluating(true);
    setEvalResult(null);
    try {
      const res = await marketPost<{ created?: number; evaluated?: number }>("/api/market/alerts/evaluate", {});
      if (res.status === 200) {
        setEvalResult(`✅ 评估完成！触发新预警 ${res.body?.created ?? 0} 条。`);
        const refreshed = await fetch("/api/market/alerts").then((r) => r.json());
        if (refreshed?.alerts) setAlertsList(refreshed.alerts);
      } else {
        setEvalResult("❌ 评估请求被拒绝，请确认会话状态。");
      }
    } catch {
      setEvalResult("网络或服务异常。");
    } finally {
      setEvaluating(false);
    }
  };

  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/market", label: "市场信号" }} title="市场预警" />
      <nav aria-label="面包屑导航" className="hidden lg:flex items-center gap-1.5 text-[12px] text-ink-4 pb-2">
        <Link to="/market" className="hover:text-ink transition-colors">市场信号</Link>
        <span>/</span>
        <span className="text-ink-2 font-medium">市场预警工作台</span>
      </nav>
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 className="text-[22px] font-semibold leading-[1.3] text-ink">预警工作台（模块 12）</h1>
        <p className="mt-1 text-[12.5px] text-ink-3">
          仅限站内预警：按规则评估信号，带去重与冷却；证据修订后关联预警自动失效。<strong>不发送任何外部推送</strong>（飞书/邮件默认关闭）。
        </p>
      </header>

      <WorkspaceAuthGate error={result.error} laneName="市场预警工作台" returnTo="/market/alerts">

      {!data ? (
        <p className="mt-4 rounded bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2">服务不可用或需要管理员会话。</p>
      ) : (
        <>
          {/* Rules Section */}
          <section className="mt-3" aria-label="预警规则">
            <div className="flex items-baseline justify-between pb-1">
              <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">
                站内规则定义（共 {data.rules.length} 条）
              </h2>
              <button
                type="button"
                onClick={handleEvaluate}
                disabled={evaluating}
                className="rounded bg-accent/90 px-3 py-1 text-[11.5px] font-medium text-paper hover:bg-accent disabled:opacity-50"
              >
                {evaluating ? "正在评估…" : "⚡ 立即触发规则评估"}
              </button>
            </div>

            {evalResult && (
              <p className="mt-1.5 rounded bg-paper-2 p-2 text-[11.5px] text-ink-2">{evalResult}</p>
            )}

            {data.rules.length === 0 ? (
              <p className="mt-1 text-[12.5px] text-ink-2">
                暂无预警规则。已内置默认预警规则；首次运行请在来源页完成初始化。
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1 text-[12px]">
                {data.rules.map((r) => (
                  <li key={r.id} className="card flex flex-wrap items-baseline justify-between gap-2 p-2.5">
                    <span>
                      <span className="font-semibold text-ink">{r.name}</span> · 模块 {r.module} · {kindZh[r.kind] ?? r.kind}{r.threshold} · 冷却 {r.cooldownHours}h
                    </span>
                    <Badge tone={r.enabled ? "ok" : "neutral"}>{r.enabled ? "启用中" : "已停用"}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Triggered Alerts Section */}
          <section className="mt-4" aria-label="已触发预警">
            <h2 className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
              已触发站内预警（共 {alertsList.length} 条）
            </h2>
            {alertsList.length === 0 ? (
              <div className="mt-1 rounded bg-paper-2 p-4 text-center text-[12.5px] text-ink-3">
                暂无触发的预警记录。新观测到达时系统将自动评估；亦可点击上方「⚡ 立即触发规则评估」就地刷新。
              </div>
            ) : (
              <ul className="mt-1 space-y-1.5 text-[12.5px]">
                {alertsList.map((a) => (
                  <li key={a.id} className={`card p-2.5 ${a.status === "retired" ? "opacity-60" : ""}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-semibold text-ink">{a.subject}</span>
                      <span className="flex items-center gap-1.5 text-[11px] text-ink-4">
                        <Badge tone={a.kind === "qualified-opportunity" ? "ok" : a.kind === "market-change" ? "neutral" : "amber"}>
                          {a.kindZh}
                        </Badge>
                        <span>{a.firedAt.slice(0, 16).replace("T", " ")}</span>
                        <span className="font-mono">[{a.status === "retired" ? "已失效" : a.status === "acknowledged" ? "已读" : "新触发"}]</span>
                      </span>
                    </div>
                    <p className="mt-1 text-[12px] text-ink-3">{a.detailZh}</p>
                    {a.reasonZh && (
                      <p className="mt-1 rounded bg-paper-2 px-2 py-1 text-[11px] text-ink-4">
                        规则依据：{a.reasonZh}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <nav className="mt-4 flex flex-wrap gap-1.5 text-[12px]">
            <Link to="/market/opportunities" className="pill">查看机会研究 →</Link>
            <Link to="/market/sources" className="pill">查看自动来源监控 →</Link>
          </nav>
        </>
      )}
      </WorkspaceAuthGate>
    </div>
  );
}
