import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/today";
import type { PoolResponse } from "@aihot/contracts/site";
import { beijingDate } from "@aihot/contracts/time";
import { cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { listPath, pageMeta } from "../lib/seo";
import { DayList, Pagination } from "../features/feed/DayList";
import { EmptyState } from "../components/ui/Page";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "featured", name: "今日新增" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

function pageHref(page: number) {
  return page <= 1 ? "/today" : `/today?page=${page}`;
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const page = Math.min(Math.max(Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1, 1), 50);
  const data = await loadOr404<PoolResponse>(
    listPath("/api/site/pool", { discoveredToday: "1", page: page > 1 ? page : null }),
    { signal: request.signal },
  );
  if (data.total > 0 && data.page > data.pageCount) throw redirect(pageHref(data.pageCount));
  return cachedPage(60, { data, today: beijingDate(Date.now()) });
}

export function meta({ loaderData }: Route.MetaArgs) {
  const page = loaderData?.data.page ?? 1;
  const path = listPath("/today", { page: page > 1 ? page : null });
  const title = `今日新收录${page > 1 ? ` · 第 ${page} 页` : ""}`;
  return pageMeta({
    title,
    description: "按系统收录时间排列的今日跨境市场信息；摘要沿用信源内容，每条都可查看原文出处。",
    path,
    noindex: true,
  });
}

export default function TodayPage() {
  const { data, today } = useLoaderData<typeof loader>();

  return (
    <div className="pb-6">
      <header className="mb-4">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">今日新收录</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-4">按系统收录时间排列，摘要沿用信源内容；点开条目可查看原文出处。</p>
      </header>
      {data.items.length === 0 ? (
        <div className="lg:card">
          <EmptyState title="今天还没有新收录的情报">采集到新内容后会显示在这里。</EmptyState>
        </div>
      ) : (
        <DayList items={data.items} todayCount={data.total} at="discoveredAt" />
      )}
      <Pagination page={data.page} pageCount={data.pageCount} href={pageHref} />
      {data.total >= 2000 && data.page === data.pageCount && <p className="mt-4 text-center text-[12px] text-ink-4">当前列表最多显示 2000 条。</p>}
      <div className="mt-5 text-center text-[13px]">
        <Link to="/all" className="font-medium text-accent hover:underline">查看全部动态</Link>
      </div>
    </div>
  );
}
