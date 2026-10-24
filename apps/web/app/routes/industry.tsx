import { Link, useLoaderData, useSearchParams } from "react-router";
import type { IndustryListResponse } from "@aihot/contracts/site";
import { apiGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { monthDayTime } from "../lib/format";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/Page";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "行业动态" };

const KIND_LABEL: Record<string, string> = {
  "official-data": "官方数据",
  news: "行业报道",
  opinion: "观点",
  "research-promo": "研究推广",
  sponsored: "赞助内容",
  "corporate-personnel": "企业人事",
  earnings: "财报",
  irrelevant: "无关",
};

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const qs = url.searchParams;
  const params = new URLSearchParams();
  for (const key of ["theme", "source", "kind", "q", "days"]) if (qs.get(key)) params.set(key, qs.get(key)!);
  const items = await apiGet<IndustryListResponse>(`/api/site/industry?${params.toString()}`, { signal: request.signal });
  return { items, filters: Object.fromEntries(params) };
}

export function meta() {
  return pageMeta({
    title: "行业动态",
    description: "美国消费与电商行业动态：消费需求、渠道竞争、品类趋势、供应链成本与官方经济数据，全部可追溯到原始来源。",
    noindex: true,
    path: "/industry",
  });
}

export default function IndustryIndex() {
  const { items } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const theme = params.get("theme");
  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <header className="mt-6">
        <h1 className="text-xl font-semibold text-ink">行业动态</h1>
        <p className="mt-1 text-[13px] text-ink-2">美国消费与电商行业的变化信号：{items.counts.admitted} 条准入 · {items.counts.rejected} 条被规则排除 · {items.counts.stories} 个事件 · {items.counts.zh} 条已有中文。限制准入来源仅展示标题与链接（不存储其摘要文本）。</p>
      </header>

      <nav className="mt-4 flex flex-wrap gap-1.5 text-[12px]" aria-label="主题筛选">
        <Link to="/industry" className={theme ? "pill" : "pill pill-active"}>全部</Link>
        {items.themes.map((t) => (
          <Link key={t.id} to={`/industry?theme=${t.id}`} className={theme === t.id ? "pill pill-active" : "pill"}>{t.label}</Link>
        ))}
      </nav>

      <div className="mt-3 flex flex-wrap gap-2 text-[12px] text-ink-2">
        <Link to="/industry/daily" className="pill">每日精选</Link>
        <a href="/api/site/industry/export" className="pill">导出研究线索 (Markdown)</a>
      </div>

      {items.items.length === 0 ? (
        <EmptyState title="暂无符合条件的行业条目">要么来源尚无新增，要么现有条目被规则正确排除。不凑数量。</EmptyState>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {items.items.map((item) => (
            <li key={item.id} className="py-3">
              <Link to={`/industry/${item.id}`} className="block">
                <div className="flex items-center gap-2 text-[11px] text-ink-2">
                  <Badge tone={item.kind === "official-data" ? "ok" : item.kind === "sponsored" ? "neutral" : "amber"}>{KIND_LABEL[item.kind] ?? item.kind}</Badge>
                  <span>{item.sourceName.split("(")[0]}</span>
                  <span>·</span>
                  <span>{item.publishedAt ? monthDayTime(item.publishedAt) : "日期未标注"}</span>
                  {item.story && item.story.articleCount > 1 ? <span>· {item.story.articleCount} 篇同事件</span> : null}
                </div>
                <h2 className="mt-1 text-[15px] font-medium leading-snug text-ink">{item.zhTitle ?? item.title}</h2>
                {item.zhTitle ? <p className="mt-0.5 text-[12px] text-ink-2">{item.title}</p> : null}
                {item.excerpt ? <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-2">{item.excerpt}</p> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-[11px] text-ink-2">中文内容由 DeepSeek 机器处理，未经人工核对；所有数字与日期以原文为准。处理与保存权限按来源分别限定。</p>
    </main>
  );
}
