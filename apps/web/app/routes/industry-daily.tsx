import { Link, useLoaderData } from "react-router";
import type { IndustryPicksResponse } from "@aihot/contracts/site";
import { apiGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { fullDateTime } from "../lib/format";
import { EmptyState } from "../components/ui/Page";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "行业精选" };

export async function loader({ request }: { request: Request }) {
  const days = new URL(request.url).searchParams.get("days") ?? "14";
  const picks = await apiGet<IndustryPicksResponse>(`/api/site/industry/daily?days=${encodeURIComponent(days)}`, { signal: request.signal });
  return { picks };
}

export function meta() {
  return pageMeta({ title: "行业每日精选", description: "每天从合格行业事件中确定性挑选的当日精选，保留当时的证据版本。", noindex: true, path: "/industry/daily" });
}

export default function IndustryDaily() {
  const { picks } = useLoaderData<typeof loader>();
  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <header className="mt-6">
        <h1 className="text-xl font-semibold text-ink">行业每日精选</h1>
        <p className="mt-1 text-[13px] text-ink-2">从合格事件中确定性挑选（官方数据优先），每天至多 5 条；没有合格事件时当天为空，不凑数。归档保留当时的证据版本。</p>
      </header>
      {picks.days.length === 0 ? (
        <EmptyState title="近 14 天无精选">{picks.note ?? "尚无归档精选。"}</EmptyState>
      ) : (
        picks.days.map((day) => (
          <section key={day.day} className="mt-6" aria-label={`精选 ${day.day}`}>
            <h2 className="text-[14px] font-semibold text-ink">{day.day}</h2>
            <ul className="mt-2 space-y-2">
              {day.picks.map((p) => (
                <li key={p.storyId} className="rounded border border-line px-3 py-2">
                  <div className="flex items-center gap-2 text-[11px] text-ink-2">
                    <span>{p.reason}</span>
                    <span>·</span>
                    <span>{p.articleIds.length} 篇来源</span>
                    <span>·</span>
                    <span>证据版本 {p.digestVersion ?? 0}</span>
                    <span>·</span>
                    <span>{fullDateTime(p.generatedAt)}</span>
                  </div>
                  <Link to={`/industry?story=${p.storyPublicId}`} className="mt-1 block text-[14px] font-medium text-ink hover:text-accent">{p.title}</Link>
                  {p.quick ? <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{p.quick}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </main>
  );
}
