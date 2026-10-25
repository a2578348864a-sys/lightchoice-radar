import { Link, useLoaderData, useSearchParams } from "react-router";
import type { IndustryListResponse, IndustrySourceStatus } from "@aihot/contracts/site";
import { apiGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { monthDayTime, relativeTime } from "../lib/format";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/Page";
import type { Screen } from "../components/shell/screens";
import { PhoneBar } from "../components/shell/PhoneBar";

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

const DAY_OPTIONS = [
  { value: "7", label: "近 7 天" },
  { value: "14", label: "近 14 天" },
  { value: "30", label: "近 30 天" },
  { value: "60", label: "近 60 天" },
  { value: "90", label: "近 90 天" },
];

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const qs = url.searchParams;
  const params = new URLSearchParams();
  for (const key of ["theme", "source", "kind", "q", "days"]) if (qs.get(key)) params.set(key, qs.get(key)!);
  // The status block on the page: run state and content gaps, read like every other page state —
  // facts only (sources, last run, budget window), never a claim the worker is running when it isn't.
  const [items, status] = await Promise.all([
    apiGet<IndustryListResponse>(`/api/site/industry?${params.toString()}`, { signal: request.signal }),
    apiGet<IndustrySourceStatus>("/api/site/industry/status", { signal: request.signal }),
  ]);
  return { items, status, filters: Object.fromEntries(params) };
}

export function meta() {
  return pageMeta({
    title: "行业动态",
    description: "美国消费与电商行业动态：消费需求、渠道竞争、品类趋势、供应链成本与官方经济数据，全部可追溯到原始来源。",
    noindex: true,
    path: "/industry",
  });
}

/** Theme pills keep the other filters; the form below carries them forward too. */
function themeHref(params: URLSearchParams, themeId: string | null): string {
  const next = new URLSearchParams(params);
  if (themeId) next.set("theme", themeId);
  else next.delete("theme");
  const qs = next.toString();
  return qs ? `/industry?${qs}` : "/industry";
}

export default function IndustryIndex() {
  const { items, status } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const theme = params.get("theme");
  const source = params.get("source") ?? "";
  const q = params.get("q") ?? "";
  const days = params.get("days") ?? "30";
  const unhealthy = status.sources.filter((s) => s.health !== "ok").length;
  const pendingZh = Math.max(0, items.counts.admitted - items.counts.zh);
  const expiresAt = status.budget.limits?.expiresAt ?? null;
  return (
    <div className="pb-10">
      {/* 与政策线索列表同一布局约定：root 容器管宽度（手机 ≤640px 带安全留白，桌面 --page-max-wide），页面只管节奏 */}
      <PhoneBar back={{ to: "/", label: "情报" }} title="行业动态" />
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 className="text-xl font-semibold text-ink">行业动态</h1>
        <p className="mt-1 text-[13px] text-ink-2">美国消费与电商行业的变化信号：{items.counts.admitted} 条准入 · {items.counts.rejected} 条被规则排除 · {items.counts.stories} 个事件 · {items.counts.zh} 条已有中文。限制准入来源仅展示标题与链接（不存储其摘要文本）。</p>
        {/* 任务 I 第 15 项：运行状态与内容缺项提示 —— 只报事实（来源健康/最近一轮/预算窗口），不假装 Worker 在跑 */}
        <p className="mt-1 text-[12px] text-ink-2">
          运行：{status.sources.filter((s) => s.enabled).length}/{status.sources.length} 个来源启用{unhealthy > 0 ? `（${unhealthy} 个健康异常）` : ""}
          {" · "}最近一轮{status.lastRun ? (status.lastRun.status === "ok" ? "正常" : "失败") : "尚无记录"}
          {expiresAt ? ` · 付费处理窗口${relativeTime(expiresAt)}到期` : " · 付费处理窗口未启用"}
          {" · "}{pendingZh > 0 ? `${pendingZh} 条待中文（限制准入来源不生成中文）` : "中文覆盖无缺项"}
        </p>
      </header>

      <nav className="mt-4 flex flex-wrap gap-1.5 text-[12px]" aria-label="主题筛选">
        <Link to={themeHref(params, null)} className={theme ? "pill" : "pill pill-active"}>全部主题</Link>
        {items.themes.map((t) => (
          <Link key={t.id} to={themeHref(params, t.id)} className={theme === t.id ? "pill pill-active" : "pill"}>{t.label}</Link>
        ))}
      </nav>

      {/* 来源 / 日期 / 关键词：一个无 JS 也可用的 GET 表单，提交后同一页读取 */}
      <form method="get" action="/industry" className="mt-3 flex flex-wrap items-center gap-2 text-[12px]" aria-label="来源、日期与关键词筛选">
        {theme ? <input type="hidden" name="theme" value={theme} /> : null}
        <select name="source" defaultValue={source} aria-label="来源筛选" className="rounded border border-line bg-paper px-2 py-1 text-[12px] text-ink">
          <option value="">全部来源</option>
          {items.sources.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <select name="days" defaultValue={days} aria-label="日期范围" className="rounded border border-line bg-paper px-2 py-1 text-[12px] text-ink">
          {DAY_OPTIONS.map((d) => (
            <option key={d.value} value={d.value}>{d.label}</option>
          ))}
        </select>
        <input type="search" name="q" defaultValue={q} placeholder="标题关键词…" aria-label="关键词搜索" className="min-w-40 flex-1 rounded border border-line bg-paper px-2 py-1 text-[12px] text-ink placeholder:text-ink-2" />
        <button type="submit" className="rounded bg-accent px-3 py-1 font-medium text-paper">筛选</button>
        {source || q || params.get("days") ? (
          <Link to={theme ? `/industry?theme=${theme}` : "/industry"} className="text-ink-2 underline-offset-2 hover:underline">重置</Link>
        ) : null}
      </form>

      <div className="mt-3 flex flex-wrap gap-2 text-[12px] text-ink-2">
        <Link to="/industry/daily" className="pill">每日精选</Link>
        <a href={`/api/site/industry/export?${params.toString()}`} className="pill">导出研究线索 (Markdown)</a>
      </div>

      {items.items.length === 0 ? (
        <EmptyState title="暂无符合条件的行业条目">要么该筛选范围下来源尚无新增，要么现有条目被规则正确排除。不凑数量。</EmptyState>
      ) : (
        (() => {
          // 中文优先排序由后端保证：完整中文情报在前，仅标题线索在后。两组各给一行小节说明，缺口不隐藏。
          const zhItems = items.items.filter((x) => x.zhTitle);
          const leadItems = items.items.filter((x) => !x.zhTitle);
          return (
            <div className="mt-4">
              {zhItems.length > 0 ? (
                <>
                  <h2 className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">完整中文情报（{zhItems.length}）</h2>
                  <ul className="divide-y divide-line">
                    {zhItems.map((item) => (
                      <li key={item.id} className="py-3.5">
                        <Link to={`/industry/${item.id}`} className="block">
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
                            <Badge tone={item.kind === "official-data" ? "ok" : "amber"}>{KIND_LABEL[item.kind] ?? item.kind}</Badge>
                            <span>{item.sourceName.split("(")[0]}</span>
                            <span>·</span>
                            <span>{item.publishedAt ? monthDayTime(item.publishedAt) : "日期未标注"}（来源发布）</span>
                            {item.story && item.story.articleCount > 1 ? <span>· {item.story.articleCount} 篇同事件</span> : null}
                          </div>
                          <h3 className="mt-1.5 text-[16px] font-semibold leading-snug text-ink">{item.zhTitle}</h3>
                          {item.zhSummary ? <p className="mt-1.5 text-[13.5px] leading-[1.75] text-ink-2">{item.zhSummary}</p> : null}
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-4">
                            <span>机器处理 · 未经人工核对</span>
                            <span>原文：{item.title.slice(0, 64)}{item.title.length > 64 ? "…" : ""}</span>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
              {leadItems.length > 0 ? (
                <>
                  <h2 className="mt-5 pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">仅标题线索（{leadItems.length}）</h2>
                  <ul className="divide-y divide-line">
                    {leadItems.map((item) => (
                      <li key={item.id} className="py-3">
                        <Link to={`/industry/${item.id}`} className="block">
                          <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
                            <Badge tone="neutral">{KIND_LABEL[item.kind] ?? item.kind}</Badge>
                            <span>{item.sourceName.split("(")[0]}</span>
                            <span>·</span>
                            <span>{item.publishedAt ? monthDayTime(item.publishedAt) : "日期未标注"}</span>
                          </div>
                          <h3 className="mt-1 text-[14px] font-medium leading-snug text-ink-2">{item.title}</h3>
                          <p className="mt-1 text-[11.5px] text-ink-4">该来源的使用条款不允许保存摘要或机器翻译，仅保留标题线索；点击查看原文。</p>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </>
              ) : null}
            </div>
          );
        })()
      )}
      <p className="mt-6 text-[11px] text-ink-2">中文内容由 DeepSeek 机器处理，未经人工核对；所有数字与日期以原文为准。处理与保存权限按来源分别限定，仅标题线索不代表已完成中文情报。</p>
    </div>
  );
}
