import { Link, useLoaderData } from "react-router";
import { useState } from "react";
import { marketGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { Badge } from "../components/ui/Badge";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "商品与竞争" };

interface ProductsResponse {
  chartMeta: Array<{
    chartId: string;
    kind: string;
    categoryLabel: string | null;
    periodKey: string;
    topN: number;
    complete: boolean;
  }>;
  products: Array<{
    asin: string;
    title: string | null;
    brand: string | null;
    categoryLabel: string | null;
    lastPrice: string | null;
    chartRank: number | null;
    firstObservedAt: string;
    firstChartedAt: string | null;
    firstSeenNoteZh: string;
    evidenceUrl: string;
  }>;
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
  return pageMeta({
    title: "商品与竞争研究",
    description: "Amazon 美国站商品多期观测、榜单变化、价格追踪与样本竞争结构。",
    noindex: true,
    path: "/market/products",
  });
}

interface ProductHistoryData {
  asin: string;
  product: {
    title: string | null;
    brand: string | null;
    categoryLabel: string | null;
    firstObservedAt: string;
    firstChartedAt: string | null;
  } | null;
  totalObservations: number;
  observations: Array<{
    periodKey: string;
    chartId: string;
    rank: number | null;
    price: string | null;
    title: string | null;
  }>;
  priceHistory: Array<{ periodKey: string; price: string; parsedAmount: number | null }>;
  priceComparability: { ok: boolean; reason?: string };
  priceChangeRate: number | null;
  rankMovement: { firstRank: number | null; latestRank: number | null; positionsMoved: number | null; direction: string };
  scopeStatus: string;
  summaryZh: string;
}

export default function MarketProducts() {
  const { data } = useLoaderData<typeof loader>();

  // ASIN drilldown state
  const [selectedAsin, setSelectedAsin] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyData, setHistoryData] = useState<ProductHistoryData | null>(null);

  const openProductDrilldown = async (asin: string) => {
    setSelectedAsin(asin);
    setHistoryLoading(true);
    setHistoryData(null);
    try {
      const res = await fetch(`/api/market/products/history?asin=${encodeURIComponent(asin)}`, {
        headers: { "Accept": "application/json" },
      });
      if (res.ok) {
        const json = await res.json();
        setHistoryData(json);
      }
    } catch {
      // Graceful fallback
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/market", label: "市场信号" }} title="商品与竞争" />
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 className="text-[22px] font-semibold leading-[1.3] text-ink">商品与竞争研究（模块 02/03/04/05/06）</h1>
        <p className="mt-1 text-[12.5px] text-ink-3">
          基于多期榜单观察与价格追踪。榜单名次<strong>不等于</strong>真实销量；样本品牌分布<strong>不等于</strong>全市场份额。
        </p>
      </header>

      {!data ? (
        <div className="mt-4 rounded bg-paper-2 p-4 text-[12.5px] text-ink-2">
          <p className="font-semibold">服务不可用或需要管理员会话。</p>
          <p className="mt-1 text-[11.5px] text-ink-3">
            商品观测需先导入榜单快照（来源页）。支持人工观察 CSV 或 JSON 导入。
          </p>
          <Link to="/market/sources" className="pill mt-2 inline-block bg-paper text-[12px]">
            前往数据导入工作台 →
          </Link>
        </div>
      ) : (
        <>
          {/* Chart Snapshots Overview */}
          {data.chartMeta.length > 0 && (
            <section className="mt-3" aria-label="榜单快照">
              <div className="flex items-baseline justify-between">
                <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">
                  榜单观测快照（共 {data.chartMeta.length} 期）
                </h2>
                <span className="text-[11px] text-ink-4">同榜同覆盖才具备可比性（C7/C8）</span>
              </div>
              <div className="mt-1.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2 text-[12px]">
                {data.chartMeta.map((c) => (
                  <div key={`${c.chartId}-${c.periodKey}`} className="card p-2.5">
                    <div className="flex justify-between items-start">
                      <span className="font-semibold text-ink">{c.chartId}</span>
                      <Badge tone={c.complete ? "ok" : "amber"}>
                        {c.complete ? "完整 Top N" : "部分覆盖"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[11.5px] text-ink-3">
                      类目：{c.categoryLabel ?? "未标注"} · 周期：{c.periodKey} · 样本数：Top {c.topN}
                    </p>
                  </div>
                ))}
              </div>

              {/* Rank movement callout */}
              {data.rankChangeNoteZh && (
                <div className="mt-2 rounded bg-paper-2 p-2.5 text-[12px]">
                  <span className="font-semibold text-ink">榜单多期位移判定：</span>
                  <span className="text-ink-2 ml-1">{data.rankChangeNoteZh}</span>
                  {data.rankChanges && data.rankChanges.length > 0 && (
                    <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[11.5px] text-ink-3">
                      {data.rankChanges.map((r) => (
                        <li key={r.asin}>
                          <span
                            onClick={() => openProductDrilldown(r.asin)}
                            className="font-medium text-ink cursor-pointer hover:underline"
                          >
                            {r.titleZh}
                          </span>{" "}
                          — {r.detailZh}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Products Table */}
          <section className="mt-4" aria-label="商品观测">
            <div className="flex items-baseline justify-between pb-1">
              <h2 className="text-[13px] font-semibold text-ink">
                已入库商品清单（共 {data.products.length} 个 ASIN，点击下钻多期历史）
              </h2>
              <span className="text-[11.5px] text-ink-4">首次上榜≠新品发布（C4 冻结）</span>
            </div>

            <div className="mt-1 space-y-2">
              {data.products.map((p) => (
                <div
                  key={p.asin}
                  onClick={() => openProductDrilldown(p.asin)}
                  className="card p-3 hover:border-line-hover cursor-pointer transition-colors"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-[13.5px] font-semibold text-ink hover:underline">
                      {p.title ?? p.asin}
                    </h3>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[13px] font-semibold text-ink">
                        {p.lastPrice ?? "价格缺失"}
                      </span>
                      {p.chartRank != null && (
                        <Badge tone="ok">榜内 #{p.chartRank}</Badge>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-ink-3">
                    <span>ASIN: <strong className="font-mono text-ink">{p.asin}</strong></span>
                    <span>品牌: {p.brand ?? "未识别"}</span>
                    <span>类目: {p.categoryLabel ?? "未分类"}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-ink-4">
                    {p.firstSeenNoteZh}
                  </p>
                </div>
              ))}
              {data.products.length === 0 && (
                <div className="rounded bg-paper-2 p-4 text-center text-[12.5px] text-ink-3">
                  暂无商品观测记录。请前往「来源与数据导入」工作台上传商品或榜单数据。
                </div>
              )}
            </div>
          </section>

          {/* Brand Distribution */}
          {data.brandShares && data.brandShares.length > 0 && (
            <section className="mt-4 card p-3.5" aria-label="竞争结构">
              <h2 className="text-[13px] font-semibold text-ink">样本竞争结构与品牌分布</h2>
              <p className="mt-0.5 text-[11.5px] text-ink-4">{data.brandLabelZh}</p>
              <div className="mt-2.5 space-y-1.5 text-[12px]">
                {data.brandShares.slice(0, 8).map((b) => (
                  <div key={b.brand} className="flex items-center gap-2">
                    <span className="w-36 truncate text-ink-2 font-medium">{b.brand}</span>
                    <div className="flex-1 bg-paper-2 rounded h-2 overflow-hidden">
                      <div
                        className="h-full bg-accent"
                        style={{ width: `${Math.max(5, b.shareInSample * 100)}%` }}
                      />
                    </div>
                    <span className="w-20 text-right text-[11px] font-mono text-ink-3">
                      {b.count} 个 ({(b.shareInSample * 100).toFixed(0)}%)
                    </span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <nav className="mt-4 flex flex-wrap gap-1.5 text-[12px]">
            <Link to="/market/opportunities" className="pill">进入机会研究 →</Link>
            <Link to="/market/sources" className="pill">导入新榜单快照 →</Link>
          </nav>
        </>
      )}

      {/* ASIN History Modal */}
      {selectedAsin && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-lg max-h-[85vh] overflow-y-auto p-4 shadow-xl">
            <div className="flex items-start justify-between border-b border-line pb-2">
              <div>
                <h3 className="text-[15px] font-semibold text-ink">ASIN 观测历史：{selectedAsin}</h3>
                <p className="mt-0.5 text-[11.5px] text-ink-4">
                  真实快照跟踪 · 单次观察不代表历史销量
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedAsin(null)}
                className="rounded p-1 text-ink-3 hover:bg-paper-2 hover:text-ink text-[14px]"
              >
                ✕
              </button>
            </div>

            {historyLoading ? (
              <p className="py-8 text-center text-[12.5px] text-ink-3">正在读取多期观测记录…</p>
            ) : !historyData ? (
              <p className="py-6 text-center text-[12px] text-ink-3">未检索到该商品的观测数据。</p>
            ) : (
              <div className="mt-3 space-y-3 text-[12px]">
                {/* Meta Header */}
                <div className="rounded bg-paper-2 p-2.5">
                  <p className="font-semibold text-ink">{historyData.product?.title ?? selectedAsin}</p>
                  <p className="mt-1 text-[11.5px] text-ink-3">
                    品牌：{historyData.product?.brand ?? "未识别"} · 类目：{historyData.product?.categoryLabel ?? "未分类"}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-4">{historyData.summaryZh}</p>
                </div>

                {/* Price Comparability */}
                <div className="rounded border border-line p-2.5">
                  <span className="font-semibold text-ink">价格可比性判定（C2 口径）：</span>
                  <p className="mt-0.5 text-[11.5px] text-ink-3">
                    {historyData.priceComparability.ok
                      ? `口径一致；价格变动率：${historyData.priceChangeRate != null ? `${(historyData.priceChangeRate * 100).toFixed(1)}%` : "持平"}`
                      : `不可直接计算涨跌率（${historyData.priceComparability.reason}）`}
                  </p>
                </div>

                {/* Observations Table */}
                <div className="overflow-x-auto rounded border border-line">
                  <table className="w-full text-left text-[11.5px]">
                    <thead className="bg-paper-2 text-ink-3">
                      <tr>
                        <th className="p-1.5">观测日</th>
                        <th className="p-1.5">所属榜单</th>
                        <th className="p-1.5">榜内排名</th>
                        <th className="p-1.5">报价</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line text-ink">
                      {historyData.observations.map((obs, i) => (
                        <tr key={i}>
                          <td className="p-1.5 font-mono">{obs.periodKey}</td>
                          <td className="p-1.5">{obs.chartId}</td>
                          <td className="p-1.5 font-mono">
                            {obs.rank ? `#${obs.rank}` : "未入榜 (OUT_OF_SCOPE)"}
                          </td>
                          <td className="p-1.5 font-mono">{obs.price ?? "缺失"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between pt-1">
                  <a
                    href={`https://www.amazon.com/dp/${selectedAsin}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11.5px] text-link underline"
                  >
                    在 Amazon 打开商品页面 ↗
                  </a>
                  <button
                    type="button"
                    onClick={() => setSelectedAsin(null)}
                    className="pill bg-paper px-3 py-1 text-[12px]"
                  >
                    关闭
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
