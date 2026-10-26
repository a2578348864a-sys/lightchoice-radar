import { Link, useLoaderData } from "react-router";
import { marketGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { Badge } from "../components/ui/Badge";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "市场信号" };

interface Overview {
  modules: Array<{
    module: string;
    name: string;
    engineering: string;
    dataState: string;
    noteZh: string;
    business: string;
  }>;
  sources: Array<{
    id: string;
    label: string;
    producer: string;
    enabled: boolean;
    automation: string;
    uses: string[];
    evidence: string;
    notes?: string;
  }>;
  counts: {
    keywordSnapshots: number;
    keywordRows: number;
    chartSnapshots: number;
    products: number;
    signals: number;
    opportunities: number;
    alerts: number;
  };
  gaps: string[];
  budgetZh: string;
}

interface CategoryCard {
  categoryLabel: string;
  productCount: number;
  sampleAsins: string[];
  topBrands: Array<{ brand: string; count: number }>;
  priceRange: { min: string | null; max: string | null; avg: string | null };
  associatedKeywords: string[];
  notesZh: string;
}

interface CategoriesResponse {
  categories: CategoryCard[];
  totalCategories: number;
  noteZh: string;
}

export async function loader({ request }: { request: Request }) {
  const [overview, categoriesData] = await Promise.all([
    marketGet<Overview>(request, "/api/market/overview").catch(() => null),
    marketGet<CategoriesResponse>(request, "/api/market/categories").catch(() => null),
  ]);
  return { overview, categoriesData };
}

export function meta() {
  return pageMeta({
    title: "市场信号总览",
    description: "第四主线市场信号私有研究工作台：关键词需求、商品观测、竞争格局、价格与多期历史分析。",
    noindex: true,
    path: "/market",
  });
}

const engBadge: Record<string, string> = {
  implemented: "已实现",
  partial: "部分实现",
  stub: "待来源",
};

export default function MarketIndex() {
  const { overview, categoriesData } = useLoaderData<typeof loader>();

  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/", label: "情报" }} title="市场信号" />
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">市场信号（第四主线）</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          围绕 Amazon 美国站的关键词需求、商品观测、竞争与价格变化的个人私有研究工作台。
          <strong className="font-semibold text-ink-2"> 全部研究内容默认本地私有</strong>；零云端依赖，零付费 API 调用。
        </p>
      </header>

      <nav className="mt-2.5 flex flex-wrap gap-1.5 text-[12px]" aria-label="市场信号区域">
        <Link to="/market/keywords" className="pill">搜索需求分析</Link>
        <Link to="/market/products" className="pill">商品与竞争观测</Link>
        <Link to="/market/opportunities" className="pill">商业机会与测算</Link>
        <Link to="/market/alerts" className="pill">预警工作台</Link>
        <Link to="/market/sources" className="pill font-medium text-accent">自动来源监控 ↗</Link>
      </nav>

      {!overview ? (
        <div className="mt-4 rounded bg-paper-2 p-4 text-[12.5px] text-ink-2">
          <p className="font-semibold">市场信号服务不可用或未初始化。</p>
          <p className="mt-1 text-[11.5px] text-ink-3">
            此页面为私有研究区，需要管理员会话；可在自动来源页查看后台自动调度与准入状态。
          </p>
          <Link to="/market/sources" className="pill mt-2 inline-block bg-paper text-[12px]">
            查看自动来源监控 →
          </Link>
        </div>
      ) : (
        <>
          {/* Data Counters */}
          <section className="mt-4" aria-label="数据概览">
            <div className="flex items-baseline justify-between pb-1">
              <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">本地数据蓄积概览</h2>
              <span className="text-[11px] text-ink-4">
                {overview.counts.keywordSnapshots >= 2 ? "✅ 已建立多期观测基线" : "单期初始基线"}
              </span>
            </div>
            <dl className="mt-1 grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-4">
              <div className="card p-3">
                <dt className="text-ink-4">关键词快照</dt>
                <dd className="mt-0.5 text-[18px] font-semibold text-ink">{overview.counts.keywordSnapshots} 期</dd>
                <span className="text-[10.5px] text-ink-3">{overview.counts.keywordRows} 行关键词</span>
              </div>
              <div className="card p-3">
                <dt className="text-ink-4">榜单快照</dt>
                <dd className="mt-0.5 text-[18px] font-semibold text-ink">{overview.counts.chartSnapshots} 期</dd>
                <span className="text-[10.5px] text-ink-3">{overview.counts.products} 个观察商品</span>
              </div>
              <div className="card p-3">
                <dt className="text-ink-4">市场变化信号</dt>
                <dd className="mt-0.5 text-[18px] font-semibold text-ink">{overview.counts.signals} 条</dd>
                <span className="text-[10.5px] text-ink-3">确定性规则匹配</span>
              </div>
              <div className="card p-3">
                <dt className="text-ink-4">研究候选与预警</dt>
                <dd className="mt-0.5 text-[18px] font-semibold text-ink">{overview.counts.opportunities} 个</dd>
                <span className="text-[10.5px] text-ink-3">{overview.counts.alerts} 条站内预警</span>
              </div>
            </dl>
            <p className="mt-2 text-[11.5px] text-ink-4">{overview.budgetZh}</p>
          </section>

          {/* Module 02 Category Aggregation Section */}
          {categoriesData && categoriesData.categories.length > 0 && (
            <section className="mt-4" aria-label="类目市场雷达">
              <div className="flex items-baseline justify-between pb-1">
                <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">
                  类目市场雷达（模块 02 · 样本类目聚合）
                </h2>
                <span className="text-[11px] text-ink-4">{categoriesData.noteZh}</span>
              </div>
              <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2 text-[12px]">
                {categoriesData.categories.map((c) => (
                  <div key={c.categoryLabel} className="card p-3">
                    <div className="flex justify-between items-baseline">
                      <h3 className="font-semibold text-ink text-[13px]">{c.categoryLabel}</h3>
                      <Badge tone="ok">{c.productCount} 个商品</Badge>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink-3">
                      {c.priceRange.min && (
                        <span>价格区间: <strong className="font-mono text-ink">{c.priceRange.min} ~ {c.priceRange.max}</strong> (均价 {c.priceRange.avg})</span>
                      )}
                      {c.topBrands.length > 0 && (
                        <span>主要品牌: {c.topBrands.map((b) => `${b.brand}(${b.count})`).join(", ")}</span>
                      )}
                    </div>
                    {c.associatedKeywords.length > 0 && (
                      <div className="mt-1.5 flex flex-wrap gap-1 text-[11px]">
                        <span className="text-ink-4">关联词:</span>
                        {c.associatedKeywords.map((kw) => (
                          <Link
                            key={kw}
                            to={`/market/keywords?q=${encodeURIComponent(kw)}`}
                            className="pill py-0 px-1.5 text-[10.5px]"
                          >
                            {kw}
                          </Link>
                        ))}
                      </div>
                    )}
                    <p className="mt-1 text-[10.5px] text-ink-4">{c.notesZh}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 12-Module Capability Matrix */}
          <section className="mt-4" aria-label="12 模块状态">
            <h2 className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
              12 模块能力状态矩阵（工程能力 ≠ 数据就绪度 ≠ 业务验收）
            </h2>
            <div className="mt-1 space-y-1.5">
              {overview.modules.map((m) => (
                <div key={m.module} className="card p-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-[13px] font-semibold text-ink">
                      {m.module} · {m.name}
                    </h3>
                    <span className="flex items-center gap-1.5 text-[11px]">
                      <Badge tone={m.engineering === "implemented" ? "ok" : m.engineering === "partial" ? "amber" : "neutral"}>
                        {engBadge[m.engineering] ?? m.engineering}
                      </Badge>
                      <span className="text-ink-4 font-mono">{m.dataState}</span>
                    </span>
                  </div>
                  <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{m.noteZh}</p>
                  <p className="mt-0.5 text-[11.5px] text-ink-4">业务验收状态：{m.business}</p>
                </div>
              ))}
            </div>
          </section>

          {/* Gaps List */}
          <section className="mt-4" aria-label="数据缺口">
            <h2 className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">
              当前数据缺口与合规限制（诚实陈述）
            </h2>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[12px] text-ink-3">
              {overview.gaps.map((g, idx) => (
                <li key={idx}>{g}</li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
