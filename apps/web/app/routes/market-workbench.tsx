import { Link, useLoaderData } from "react-router";
import { marketGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { WorkspaceAuthGate } from "../components/shell/WorkspaceAuthGate";
import { Badge } from "../components/ui/Badge";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "market", name: "市场工程矩阵" };

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
    safetyEvents?: number;
  };
  gaps: string[];
  budgetZh: string;
  scheduler?: {
    isRunning: boolean;
    pid?: number;
    nextDueAt: string | null;
  };
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
  const [overviewResult, categoriesResult] = await Promise.all([
    marketGet<Overview>(request, "/api/market/overview"),
    marketGet<CategoriesResponse>(request, "/api/market/categories"),
  ]);
  return { overviewResult, categoriesResult };
}

export function meta() {
  return pageMeta({
    title: "市场研究工作台 · 12 模块工程能力矩阵",
    description: "第四主线市场信号工程状态、数据支撑与业务可用性三层状态矩阵。",
    noindex: true,
    path: "/market/workbench",
  });
}

const engBadge: Record<string, string> = {
  implemented: "已实现",
  partial: "部分实现",
  stub: "待来源",
};

export default function MarketWorkbenchPage() {
  const { overviewResult, categoriesResult } = useLoaderData<typeof loader>();
  const overview = overviewResult.data;
  const categoriesData = categoriesResult.data;

  return (
    <div className="space-y-6 pb-12">
      <PhoneBar back={{ to: "/market", label: "市场信号" }} title="12 模块工程矩阵" />

      <nav aria-label="面包屑导航" className="hidden lg:flex items-center gap-1.5 text-[12px] text-ink-4">
        <Link to="/market" className="hover:text-ink transition-colors">市场信号</Link>
        <span>/</span>
        <span className="text-ink-2 font-medium">12 模块工程矩阵与研究状态</span>
      </nav>

      <header className="pb-1 pt-2 lg:pt-0">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink lg:text-[26px]">
          12 模块工程能力与研究矩阵
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          后台工程能力、数据支撑与业务可用性三层独立审视。坚持诚实原则：代码实现 ≠ 拥有合法数据 ≠ 业务真正可用。
        </p>
      </header>

      <nav className="flex flex-wrap gap-1.5 text-[12px]" aria-label="市场导航">
        <Link to="/market" className="pill">← 返回市场情报流</Link>
        <Link to="/market/keywords" className="pill">搜索需求分析</Link>
        <Link to="/market/products" className="pill">商品与竞争观测</Link>
        <Link to="/market/opportunities" className="pill">商业机会与测算</Link>
        <Link to="/market/alerts" className="pill">预警工作台</Link>
        <Link to="/market/sources" className="pill font-medium text-accent">自动来源监控 ↗</Link>
      </nav>

      <WorkspaceAuthGate error={overviewResult.error} laneName="市场信号工程工作台" returnTo="/market/workbench">
        {!overview ? (
          <div className="rounded-sheet border border-line bg-surface p-6 text-center text-[13px] text-ink-3">
            暂无市场工程状态数据。
          </div>
        ) : (
          <>
            {/* Counters */}
            <section aria-label="数据概览" className="space-y-2">
              <h2 className="text-[13px] font-semibold text-ink-3">本地数据蓄积概览</h2>
              <dl className="grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-5">
                <div className="card p-3">
                  <dt className="text-ink-4">关键词快照</dt>
                  <dd className="mt-0.5 text-[18px] font-semibold text-ink">{overview.counts.keywordSnapshots} 期</dd>
                  <span className="text-[10.5px] text-ink-3">{overview.counts.keywordRows} 行关键词</span>
                </div>
                <div className="card p-3">
                  <dt className="text-ink-4">榜单与商品</dt>
                  <dd className="mt-0.5 text-[18px] font-semibold text-ink">{overview.counts.chartSnapshots} 期</dd>
                  <span className="text-[10.5px] text-ink-3">{overview.counts.products} 个观察商品</span>
                </div>
                <div className="card p-3">
                  <dt className="text-ink-4">变化信号</dt>
                  <dd className="mt-0.5 text-[18px] font-semibold text-ink">{overview.counts.signals} 条</dd>
                  <span className="text-[10.5px] text-ink-3">确定性规则计算</span>
                </div>
                <div className="card p-3">
                  <dt className="text-ink-4">研究候选</dt>
                  <dd className="mt-0.5 text-[18px] font-semibold text-ink">{overview.counts.opportunities} 个</dd>
                  <span className="text-[10.5px] text-ink-3">缺供给证据拒绝评分</span>
                </div>
                <div className="card p-3">
                  <dt className="text-ink-4">CPSC 安全反证</dt>
                  <dd className="mt-0.5 text-[18px] font-semibold text-ok">{overview.counts.safetyEvents ?? 0} 起</dd>
                  <span className="text-[10.5px] text-ink-3">官方缺陷反证入库</span>
                </div>
              </dl>
            </section>

            {/* 12-Module Matrix */}
            <section aria-label="12 模块矩阵" className="space-y-3">
              <h2 className="text-[13px] font-semibold text-ink-3">12 模块能力与业务可用状态矩阵</h2>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {overview.modules.map((m) => (
                  <div key={m.module} className="card flex flex-col justify-between p-3.5">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[11px] font-bold text-accent">M{m.module}</span>
                        <div className="flex items-center gap-1">
                          <Badge tone={m.engineering === "implemented" ? "ok" : m.engineering === "partial" ? "amber" : "neutral"}>
                            {engBadge[m.engineering] ?? m.engineering}
                          </Badge>
                        </div>
                      </div>
                      <h3 className="mt-1 text-[14px] font-semibold text-ink">{m.name}</h3>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">
                        <strong className="text-ink-2">数据状态：</strong>{m.dataState}
                      </p>
                      <p className="mt-1 text-[11.5px] leading-relaxed text-ink-4">
                        <strong className="text-ink-3">业务说明：</strong>{m.noteZh}
                      </p>
                    </div>
                    <div className="mt-2.5 border-t border-line-soft pt-1.5 text-[11px] text-ink-4">
                      业务可用层：<span className="font-medium text-ink-3">{m.business}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Categories */}
            {categoriesData && categoriesData.categories.length > 0 && (
              <section aria-label="类目聚合" className="space-y-3">
                <h2 className="text-[13px] font-semibold text-ink-3">已观测样本类目聚合（M02）</h2>
                <div className="grid gap-3 sm:grid-cols-2">
                  {categoriesData.categories.map((c) => (
                    <div key={c.categoryLabel} className="card p-3.5">
                      <div className="flex items-center justify-between">
                        <h3 className="text-[14px] font-semibold text-ink">{c.categoryLabel}</h3>
                        <Badge tone="ok">{c.productCount} 个样本商品</Badge>
                      </div>
                      <p className="mt-1 text-[12px] text-ink-3">
                        价格区间：${c.priceRange.min ?? "—"} ~ ${c.priceRange.max ?? "—"}（均价 ${c.priceRange.avg ?? "—"}）
                      </p>
                      {c.topBrands.length > 0 && (
                        <div className="mt-2 text-[11.5px] text-ink-4">
                          样本品牌：{c.topBrands.map((b) => `${b.brand}(${b.count})`).join("、")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </WorkspaceAuthGate>
    </div>
  );
}
