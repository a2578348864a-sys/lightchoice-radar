import { Link, useLoaderData } from "react-router";
import { marketGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "商品与竞争" };

interface ProductsResponse {
  chartMeta: Array<{ chartId: string; kind: string; categoryLabel: string | null; periodKey: string; topN: number; complete: boolean }>;
  products: Array<{ asin: string; title: string | null; brand: string | null; categoryLabel: string | null; lastPrice: string | null; chartRank: number | null; firstObservedAt: string; firstChartedAt: string | null; firstSeenNoteZh: string; evidenceUrl: string }>;
  brandShares: Array<{ brand: string; count: number; shareInSample: number }> | null;
  brandLabelZh: string | null;
  rankChanges: Array<{ asin: string; titleZh: string; detailZh: string; status: string }> | null;
  rankChangeNoteZh: string | null;
}

export async function loader({ request }: { request: Request }) {
  const data = await marketGet<ProductsResponse>(request, "/api/market/products").catch(() => null);
  return { data };
}

export function meta() {
  return pageMeta({ title: "商品与竞争", description: "Amazon 美国站商品观测、榜单变化与样本竞争结构。", noindex: true, path: "/market/products" });
}

export default function MarketProducts() {
  const { data } = useLoaderData<typeof loader>();
  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/market", label: "市场信号" }} title="商品与竞争" />
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 className="text-[22px] font-semibold leading-[1.3] text-ink">商品与竞争（模块 02/03/04/05/06）</h1>
        <p className="mt-1 text-[12.5px] text-ink-3">真实浏览器人工观察级样本。榜单名次≠销量；样本品牌分布≠全市场份额。</p>
      </header>

      {!data ? (
        <p className="mt-4 rounded bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2">服务不可用或需要管理员会话。商品观测需先导入榜单快照（来源页）。</p>
      ) : (
        <>
          {data.chartMeta.length > 0 && (
            <section className="mt-3" aria-label="榜单快照">
              <h2 className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">榜单快照</h2>
              <div className="mt-1 space-y-1 text-[12.5px]">
                {data.chartMeta.map((c) => (
                  <p key={`${c.chartId}-${c.periodKey}`} className="card p-2.5">
                    {c.chartId}（{c.kind}）· 类目 {c.categoryLabel ?? "未标注"} · 观察期 {c.periodKey} · Top {c.topN}
                    {c.complete ? " · 完整" : " · 存在覆盖缺口（C8：相关结论降级）"}
                  </p>
                ))}
              </div>
              {data.rankChangeNoteZh && <p className="mt-1.5 text-[12px] text-ink-3">排名变化：{data.rankChangeNoteZh}</p>}
              {data.rankChanges && (
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[12.5px] text-ink-3">
                  {data.rankChanges.map((r) => <li key={r.asin}><span className="font-medium text-ink-2">{r.titleZh}</span> — {r.detailZh}</li>)}
                </ul>
              )}
            </section>
          )}

          <section className="mt-4" aria-label="商品观测">
            <h2 className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">商品观测（{data.products.length}）</h2>
            <div className="mt-1 space-y-1.5">
              {data.products.map((p) => (
                <div key={p.asin} className="card p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-[13.5px] font-semibold text-ink">{p.title ?? p.asin}</h3>
                    <span className="text-[12px] text-ink-2">{p.lastPrice ?? "价格缺失"}</span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    ASIN {p.asin} · 品牌 {p.brand ?? "未识别"} · 类目 {p.categoryLabel ?? "仅标签（结构 L2 缺）"}
                    {p.chartRank != null ? ` · 当前榜内第 ${p.chartRank}` : ""}
                  </p>
                  <p className="mt-0.5 text-[11.5px] text-ink-4">{p.firstSeenNoteZh}</p>
                  <a href={p.evidenceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11.5px] text-link underline">查看 Amazon 原始页面（证据）</a>
                </div>
              ))}
              {data.products.length === 0 && <p className="text-[12.5px] text-ink-2">尚无商品观测——等待榜单快照导入。</p>}
            </div>
          </section>

          {data.brandShares && (
            <section className="mt-4" aria-label="竞争结构">
              <h2 className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">竞争结构（样本级）</h2>
              <p className="text-[11.5px] text-ink-4">{data.brandLabelZh}</p>
              <ul className="mt-1 space-y-0.5 text-[12.5px]">
                {data.brandShares.slice(0, 10).map((b) => (
                  <li key={b.brand} className="flex items-center gap-2">
                    <span className="w-40 truncate text-ink-2">{b.brand}</span>
                    <span className="h-2 rounded bg-accent/70" style={{ width: `${Math.max(4, b.shareInSample * 100)}%` }} aria-hidden />
                    <span className="text-ink-4">{b.count} 个 · 样本内 {(b.shareInSample * 100).toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <nav className="mt-4 flex flex-wrap gap-1.5 text-[12px]">
            <Link to="/market/opportunities" className="pill">进入机会研究 →</Link>
          </nav>
        </>
      )}
    </div>
  );
}
