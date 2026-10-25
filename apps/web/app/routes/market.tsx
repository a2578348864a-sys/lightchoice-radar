import { Link, useLoaderData } from "react-router";
import { marketGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { Badge } from "../components/ui/Badge";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "市场信号" };

interface Overview {
  modules: Array<{ module: string; name: string; engineering: string; dataState: string; noteZh: string; business: string }>;
  sources: Array<{ id: string; label: string; producer: string; enabled: boolean; automation: string; uses: string[]; evidence: string; notes?: string }>;
  counts: { keywordSnapshots: number; keywordRows: number; chartSnapshots: number; products: number; signals: number; opportunities: number; alerts: number };
  gaps: string[];
  budgetZh: string;
}

export async function loader({ request }: { request: Request }) {
  const overview = await marketGet<Overview>(request, "/api/market/overview").catch(() => null);
  return { overview };
}

export function meta() {
  return pageMeta({ title: "市场信号", description: "第四主线市场信号私有研究工作台：关键词需求、商品观测、竞争、价格与机会研究。", noindex: true, path: "/market" });
}

const engBadge: Record<string, string> = { implemented: "已实现", partial: "部分实现", stub: "待来源" };

export default function MarketIndex() {
  const { overview } = useLoaderData<typeof loader>();
  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/", label: "情报" }} title="市场信号" />
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">市场信号（第四主线）</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          围绕 Amazon 美国站的关键词需求、商品观测、竞争与价格变化的私有研究工作台。
          <strong className="font-semibold text-ink-2">全部研究内容默认私有</strong>；来源许可与模型预算独立受控。
        </p>
      </header>

      <nav className="mt-2 flex flex-wrap gap-1.5 text-[12px]" aria-label="市场信号区域">
        <Link to="/market/keywords" className="pill">搜索需求</Link>
        <Link to="/market/products" className="pill">商品与竞争</Link>
        <Link to="/market/opportunities" className="pill">机会研究</Link>
        <Link to="/market/alerts" className="pill">预警</Link>
        <Link to="/market/sources" className="pill">来源</Link>
      </nav>

      {!overview ? (
        <p className="mt-4 rounded bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2">
          市场信号服务不可用或未初始化。此页面为私有研究区，需要管理员会话；首次使用请在来源页执行来源初始化。
        </p>
      ) : (
        <>
          <section className="mt-4" aria-label="数据概览">
            <h2 className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">数据概览</h2>
            <dl className="mt-1 grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-4">
              <div className="card p-3"><dt className="text-ink-4">关键词快照</dt><dd className="mt-0.5 text-[18px] font-semibold text-ink">{overview.counts.keywordSnapshots}</dd></div>
              <div className="card p-3"><dt className="text-ink-4">关键词行</dt><dd className="mt-0.5 text-[18px] font-semibold text-ink">{overview.counts.keywordRows}</dd></div>
              <div className="card p-3"><dt className="text-ink-4">榜单快照</dt><dd className="mt-0.5 text-[18px] font-semibold text-ink">{overview.counts.chartSnapshots}</dd></div>
              <div className="card p-3"><dt className="text-ink-4">商品观测</dt><dd className="mt-0.5 text-[18px] font-semibold text-ink">{overview.counts.products}</dd></div>
              <div className="card p-3"><dt className="text-ink-4">市场信号</dt><dd className="mt-0.5 text-[18px] font-semibold text-ink">{overview.counts.signals}</dd></div>
              <div className="card p-3"><dt className="text-ink-4">机会候选</dt><dd className="mt-0.5 text-[18px] font-semibold text-ink">{overview.counts.opportunities}</dd></div>
              <div className="card p-3"><dt className="text-ink-4">未处理预警</dt><dd className="mt-0.5 text-[18px] font-semibold text-ink">{overview.counts.alerts}</dd></div>
              <div className="card p-3"><dt className="text-ink-4">获准来源</dt><dd className="mt-0.5 text-[18px] font-semibold text-ink">{overview.sources.filter((s) => s.enabled).length}/{overview.sources.length}</dd></div>
            </dl>
            <p className="mt-2 text-[11.5px] text-ink-4">{overview.budgetZh}</p>
          </section>

          <section className="mt-4" aria-label="12 模块状态">
            <h2 className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">12 模块能力状态（工程 ≠ 数据 ≠ 权限）</h2>
            <div className="mt-1 space-y-1.5">
              {overview.modules.map((m) => (
                <div key={m.module} className="card p-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-[13px] font-semibold text-ink">{m.module} · {m.name}</h3>
                    <span className="flex items-center gap-1.5 text-[11px]">
                      <Badge tone={m.engineering === "implemented" ? "ok" : m.engineering === "partial" ? "amber" : "neutral"}>{engBadge[m.engineering]}</Badge>
                      <span className="text-ink-4">{m.dataState}</span>
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{m.noteZh}</p>
                  <p className="mt-0.5 text-[11.5px] text-ink-4">业务验收：{m.business}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-4" aria-label="数据缺口">
            <h2 className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">当前数据缺口（如实呈现，不填零）</h2>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[12.5px] text-ink-3">
              {overview.gaps.map((g) => <li key={g}>{g}</li>)}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
