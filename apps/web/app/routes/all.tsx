import { useEffect } from "react";
import { Link, redirect, useLoaderData, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/all";
import type { PoolResponse, PoolSourceOption } from "@aihot/contracts/site";
import { SITE, subjectAfter } from "@aihot/site";
import { beijingTime } from "@aihot/contracts/time";
import { cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { filterParams, hasFeedFilters, itemListLd, listPath, pageMeta, readFilters } from "../lib/seo";
import { ActiveFilters, CategoryTabs, FeedBar, SearchField } from "../features/feed/Filters";
import { PillTabs } from "../components/ui/Tabs";
import { DayList, Pagination } from "../features/feed/DayList";
import { EmptyState } from "../components/ui/Page";
import { IconSearch } from "../components/icons";
import { PhoneBar } from "../components/shell/PhoneBar";
import { isPhone, type Screen } from "../components/shell/screens";
import { openSearch } from "../features/search/SearchOverlay";
import { addRecentSearch } from "../lib/local-state";

export const handle: Screen = { tab: "policy", name: "平台政策" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

const ALL_TITLE = SITE.name === "LightChoice Radar" ? "平台政策情报" : subjectAfter("全部", "动态");
const RADAR_TAGS = [
  "亚马逊平台政策线索",
  "亚马逊卖家项目规则线索",
  "费用与物流线索",
  "FBA 入库与分仓线索",
  "类目合规线索",
  "亚马逊账号健康与申诉线索",
  "美国监管与产品召回线索",
] as const;

function radarTagPath(params: URLSearchParams, tag?: string) {
  const next = new URLSearchParams(params);
  next.delete("page");
  next.delete("category");
  if (tag) next.set("tag", tag);
  else next.delete("tag");
  return `/all?${next}`;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim().slice(0, 200) || null;
  const tab = url.searchParams.get("tab") === "relevance" ? "relevance" : null;
  const from = url.searchParams.get("from") || null;
  const to = url.searchParams.get("to") || null;
  const sourceId = url.searchParams.get("source")?.trim() || null;
  const dateBasis = url.searchParams.get("dateBasis") === "published" ? "published" : "collected";
  // Older deep-paging parameters (deep, anchorAt) still open a normal page.
  const page = Math.min(Math.max(Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1, 1), 50);
  const [data, sourceOptions] = await Promise.all([
    loadOr404<PoolResponse>(
      listPath("/api/site/pool", { ...filterParams(readFilters(url.searchParams)), q, tab, page: page > 1 ? page : null, from, to, source: sourceId, dateBasis, lane: "policy" }),
      // The busy page keeps the search, so it can be tried again as it was.
      { signal: request.signal, busyRedirect: `/all/search-busy${url.search}` },
    ),
    SITE.name === "LightChoice Radar" ? loadOr404<PoolSourceOption[]>("/api/site/pool/sources?lane=policy", { signal: request.signal }) : Promise.resolve([]),
  ]);
  // Past the last page of what there is: the last page, with the same search and filters.
  if (data.total > 0 && data.page > data.pageCount) throw redirect(pageHref(url.searchParams, data.pageCount));
  return cachedPage(60, { data, sourceOptions, sourceId, dateBasis, from, to });
}

export function meta({ loaderData }: Route.MetaArgs) {
  const f = loaderData?.data.filters;
  const q = f?.q;
  const page = loaderData?.data.page ?? 1;
  const path = listPath("/all", { ...(f && filterParams(f)), q, tab: q && f?.tab === "relevance" ? "relevance" : null, page: page > 1 ? page : null });
  const title = `${q ? `搜索：${q}` : ALL_TITLE}${page > 1 ? ` · 第 ${page} 页` : ""}`;
  const noindex = !!q || hasFeedFilters(f) || !!loaderData?.sourceId || !!loaderData?.from || !!loaderData?.to;
  return pageMeta({
    title,
    description: SITE.name === "LightChoice Radar"
      ? "查看公开平台政策与美国监管召回线索，核对原文、生效日期和选品影响。"
      : `${SITE.name} 收录的${subjectAfter("全部", "相关动态")}，可按频道、类别与标签筛选，支持中英文搜索。`,
    path,
    noindex,
    jsonLd: noindex ? undefined : itemListLd(path, title, loaderData?.data.items.map((i) => i.title) ?? []),
  });
}

function pageHref(params: URLSearchParams, page: number) {
  const sp = new URLSearchParams(params);
  sp.delete("deep");
  sp.delete("anchorAt");
  sp.delete("search");
  if (page <= 1) sp.delete("page");
  else sp.set("page", String(page));
  const s = sp.toString();
  return s ? `/all?${s}` : "/all";
}

export default function AllPage() {
  const { data, sourceOptions, sourceId, dateBasis, from, to } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const navigation = useNavigation();
  const f = data.filters;
  const busy = navigation.state === "loading" && navigation.location?.pathname === "/all";
  const { channel, category } = filterParams(f);
  const keep = {
    channel, category, tag: f.tag,
    ...(SITE.name === "LightChoice Radar" ? { source: sourceId, dateBasis, from, to } : {}),
  };
  const searchTabHref = (tab: "time" | "relevance") => {
    const sp = new URLSearchParams(params);
    sp.delete("page");
    if (tab === "relevance") sp.set("tab", "relevance");
    else sp.delete("tab");
    return `/all?${sp}`;
  };
  const title = f.q ? `搜索“${f.q}”` : f.tag ? `#${f.tag}` : null;
  const exportUrl = (format: "md" | "json") => listPath("/api/site/radar/export", {
    format, ...filterParams(f), q: f.q, from: from || null, to: to || null, source: sourceId, dateBasis,
  });
  const updated = beijingTime(data.freshness);
  // Searches are remembered in this browser for the phone search (listed in the privacy notice).
  useEffect(() => {
    if (f.q) addRecentSearch(f.q);
  }, [f.q]);
  // Older phone links (/all?search=1) opened the search field; they open the search now.
  useEffect(() => {
    if (params.get("search") === "1" && isPhone()) openSearch(f.q ?? "", undefined, keep);
  }, []);

  return (
    <div className="pb-6">
      {/* Phones: the feed bar, or for a search the query (tap to change it) and back to 全部. */}
      {f.q ? (
        <PhoneBar
          back={{ to: "/all", label: "全部" }}
          center={
            <button type="button" onClick={(event) => openSearch(f.q ?? "", event.currentTarget, keep)} className="flex h-11 min-w-0 max-w-full items-center gap-2 rounded-full bg-well px-3.5 text-[15px] text-ink ring-1 ring-inset ring-line-soft">
              <IconSearch size={16} className="shrink-0 text-ink-4" />
              <span className="truncate">{f.q}</span>
            </button>
          }
        />
      ) : (
        <FeedBar base="/all" category={f.category} channel={f.channel} />
      )}
      <ActiveFilters base="/all" category={f.category} channel={f.channel} tag={f.tag} />
      {SITE.name === "LightChoice Radar" && <div className="mb-3 flex flex-wrap items-center gap-1.5" aria-label="情报线索分类">
        <Link to={radarTagPath(params)} className={`chip ${!f.tag ? "ring-accent text-accent" : ""}`}>全部线索</Link>
        {RADAR_TAGS.map((tag) => <Link key={tag} to={radarTagPath(params, tag)} className={`chip ${f.tag === tag ? "ring-accent text-accent" : ""}`}>{tag}</Link>)}
      </div>}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-card border border-line bg-surface px-3 py-2.5">
        <form method="get" action="/all" className="flex flex-wrap items-end gap-2">
          {f.q && <input type="hidden" name="q" value={f.q} />}
          {f.channel !== "all" && <input type="hidden" name="channel" value={f.channel} />}
          {f.category && <input type="hidden" name="category" value={f.category} />}
          {f.tag && <input type="hidden" name="tag" value={f.tag} />}
          {SITE.name === "LightChoice Radar" && <label className="text-[11px] text-ink-4">来源
            <select aria-label="来源筛选" name="source" defaultValue={sourceId ?? ""} className="mt-0.5 block h-8 max-w-[220px] rounded-control border border-line bg-bg px-2 text-[12px] text-ink">
              <option value="">全部来源</option>
              {sourceOptions.map((source) => <option key={source.id} value={source.id}>{source.name}</option>)}
            </select>
          </label>}
          {SITE.name === "LightChoice Radar" && <label className="text-[11px] text-ink-4">日期依据
            <select aria-label="日期依据" name="dateBasis" defaultValue={dateBasis} className="mt-0.5 block h-8 rounded-control border border-line bg-bg px-2 text-[12px] text-ink">
              <option value="collected">收录日期</option>
              <option value="published">发布日期</option>
            </select>
          </label>}
          <label className="text-[11px] text-ink-4">{dateBasis === "published" && SITE.name === "LightChoice Radar" ? "发布日期起" : "收录日期起"}
            <input aria-label={dateBasis === "published" && SITE.name === "LightChoice Radar" ? "发布日期起" : "收录日期起"} type="date" name="from" defaultValue={from ?? ""} className="mt-0.5 block h-8 rounded-control border border-line bg-bg px-2 text-[12px] text-ink" />
          </label>
          <label className="text-[11px] text-ink-4">至
            <input aria-label={dateBasis === "published" && SITE.name === "LightChoice Radar" ? "发布日期止" : "收录日期止"} type="date" name="to" defaultValue={to ?? ""} className="mt-0.5 block h-8 rounded-control border border-line bg-bg px-2 text-[12px] text-ink" />
          </label>
          <button type="submit" className="h-8 rounded-control bg-ink px-3 text-[12px] font-medium text-bg hover:opacity-90">查询历史</button>
          {(from || to) && <Link to={listPath("/all", { ...filterParams(f), q: f.q, source: sourceId, dateBasis })} className="inline-flex h-8 items-center px-2 text-[12px] text-ink-3 hover:text-ink">清除日期</Link>}
        </form>
        <div className="flex flex-wrap items-center gap-2">
          <Link to="/today" className="inline-flex min-h-8 items-center rounded-full bg-well px-3 text-[12px] font-medium text-accent hover:bg-bg-sunk">今日新收录</Link>
          <Link to="/admin/radar" className="inline-flex min-h-8 items-center rounded-full bg-well px-3 text-[12px] font-medium text-ink-2 hover:bg-bg-sunk">关键词监控</Link>
          <Link to="/admin/sources" className="inline-flex min-h-8 items-center rounded-full bg-well px-3 text-[12px] font-medium text-ink-2 hover:bg-bg-sunk">信源运行状态</Link>
          <a href={exportUrl("md")} download className="inline-flex min-h-8 items-center rounded-full border border-line px-3 text-[12px] font-medium text-ink-2 hover:bg-bg-sunk">导出 Markdown</a>
          <a href={exportUrl("json")} download className="inline-flex min-h-8 items-center rounded-full border border-line px-3 text-[12px] font-medium text-ink-2 hover:bg-bg-sunk">导出 JSON</a>
        </div>
      </div>

      {/* Desktop, as on 精选: the title, then one filter row with the search field aligned on the right. */}
      <div className="hidden lg:block">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">{title ?? ALL_TITLE}</h1>
        <div className="mb-5 mt-4 flex items-center justify-between gap-4">
          {SITE.name === "LightChoice Radar"
            ? <span className="text-[12px] text-ink-4">按来源、线索标签、收录日期或发布日期筛选</span>
            : <CategoryTabs base="/all" category={f.category} channel={f.channel} layoutId="all-cat-desk" className="min-w-0" />}
          <SearchField defaultValue={f.q ?? ""} keep={keep} />
        </div>
      </div>

      {f.q && (
        <div className="mb-3 mt-1 flex flex-wrap items-center justify-between gap-2 lg:mt-0">
          <PillTabs
            size="xs"
            layoutId="all-search-sort"
            label="搜索排序"
            active={f.tab}
            items={(["time", "relevance"] as const).map((t) => ({ key: t, label: t === "time" ? "按时间（搜标题和摘要）" : "按相关度（含正文）", to: searchTabHref(t) }))}
          />
          <span className="text-[12px] text-ink-4">
            找到 <span className="num">{data.total >= 2000 ? "2000+" : data.total}</span> 条 · 更新于 <span className="num">{updated}</span>
          </span>
        </div>
      )}

      <div className={`transition-opacity duration-200 ${busy ? "opacity-50" : ""}`}>
        {data.items.length === 0 ? (
          <div className="mt-2 lg:card">
            <EmptyState
              title="没有找到相关内容"
              action={
                f.q && f.tab === "time" ? (
                  <Link to={searchTabHref("relevance")} className="text-[13px] font-medium text-accent hover:underline">
                    试试“按相关度”，连正文一起搜
                  </Link>
                ) : undefined
              }
            >
              {f.q ? "换个说法，或者去掉筛选再试。" : "这个筛选下暂时没有内容。"}
            </EmptyState>
          </div>
        ) : (
          <DayList items={data.items} todayCount={f.q ? null : data.todayCount} />
        )}
      </div>
      <Pagination page={data.page} pageCount={data.pageCount} href={(p) => pageHref(params, p)} />
      {data.page >= 50 && <p className="mt-4 text-center text-[12px] text-ink-4">最多提供 50 页，更早的内容请使用搜索或主题页。</p>}
    </div>
  );
}
