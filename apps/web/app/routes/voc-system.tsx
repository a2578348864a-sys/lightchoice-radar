import { Link, useLoaderData } from "react-router";
import { vocGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { WorkspaceAuthGate } from "../components/shell/WorkspaceAuthGate";
import { EmptyState } from "../components/ui/Page";
import { relativeTime } from "../lib/format";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "原声系统" };

interface HistoryResponse { events: Array<{ kind: string; at: string; detail: string }> }
interface SourcesResponse {
  sources: Array<{ id: string; name: string; enabled: boolean; health: string; fail_count: number; last_ok_at: string | null; last_error: string | null; config: Record<string, unknown> }>;
  batches: Array<{ id: string; label: string; importedAt: string; license: { uses: string[]; basis: string }; revokedAt?: string; revokeReason?: string }>;
  runs: Array<{ source_id: string; status: string; n: number }>;
}

export async function loader({ request }: { request: Request }) {
  const [historyResult, sourcesResult] = await Promise.all([
    vocGet<HistoryResponse>(request, "/api/voc/history"),
    vocGet<SourcesResponse>(request, "/api/voc/sources"),
  ]);
  return {
    history: historyResult.data,
    sources: sourcesResult.data,
    error: sourcesResult.error || historyResult.error,
  };
}

export function meta() {
  return pageMeta({ title: "原声系统", description: "消费者原声来源、批次许可、历史变化与诊断。", noindex: true, path: "/voc/system" });
}

export default function VocSystem() {
  const { history, sources, error } = useLoaderData<typeof loader>();
  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/voc", label: "消费者原声" }} title="系统" />
      <nav aria-label="面包屑导航" className="hidden lg:flex items-center gap-1.5 text-[12px] text-ink-4 pb-2">
        <Link to="/voc" className="hover:text-ink transition-colors">第三主线 · 消费者原声</Link>
        <span>/</span>
        <span className="text-ink-2 font-medium">来源 · 批次 · 历史</span>
      </nav>
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">来源 · 批次 · 历史</h1>
      </header>

      <WorkspaceAuthGate error={error} laneName="消费者原声系统管理" returnTo="/voc/system">

      <section className="mt-3" aria-label="来源状态">
        <h2 className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">来源</h2>
        {!sources || sources.sources.length === 0 ? (
          <p className="mt-1 text-[12.5px] text-ink-2">无获准来源。Stack Exchange（coffee 站）已通过预检（官方 API、免费、CC BY-SA、署名条件明确），但未获开启授权，保持停用。</p>
        ) : (
          <ul className="mt-1 space-y-2">
            {sources.sources.map((s) => (
              <li key={s.id} className="card p-3 text-[12.5px]">
                <div className="flex items-baseline justify-between gap-2"><span className="font-medium text-ink">{s.name}</span><span className="text-[11px] text-ink-4">{s.enabled ? "启用" : "停用"}</span></div>
                <p className="mt-1 text-ink-3">health={s.health} · fail={s.fail_count}{s.last_ok_at ? ` · 上次成功 ${relativeTime(s.last_ok_at)}` : ""}</p>
                {s.last_error ? <p className="mt-1 text-[11.5px] text-hot">{String(s.last_error).slice(0, 80)}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4" aria-label="批次许可">
        <h2 className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">导入批次与许可</h2>
        {!sources || sources.batches.length === 0 ? (
          <p className="mt-1 text-[12.5px] text-ink-2">尚无导入批次。</p>
        ) : (
          <ul className="mt-1 space-y-2">
            {sources.batches.map((b) => (
              <li key={b.id} className="card p-3 text-[12.5px]">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-ink">{b.label}</span>
                  {b.revokedAt ? <span className="text-[11px] text-hot">已撤销 · {b.revokeReason}</span> : <span className="text-[11px] text-ink-4">{relativeTime(b.importedAt)} 导入</span>}
                </div>
                <p className="mt-1 text-ink-3">许可用途：{b.license.uses.join("/")}</p>
                <p className="mt-0.5 text-[11.5px] text-ink-4">依据：{b.license.basis}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-4" aria-label="历史变化">
        <h2 className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">历史变化（近 30 天）</h2>
        {!history || history.events.length === 0 ? (
          <EmptyState title="暂无历史事件">材料到达、批次撤销与人工决定会记录在此。</EmptyState>
        ) : (
          <ul className="mt-1 divide-y divide-line text-[12.5px]">
            {history.events.slice(0, 50).map((e, i) => (
              <li key={i} className="flex items-baseline gap-3 py-2">
                <span className="w-20 shrink-0 text-[11px] text-ink-4">{relativeTime(e.at)}</span>
                <span className="text-ink-3">{e.kind}</span>
                <span className="min-w-0 flex-1 truncate text-ink-2">{e.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-6 text-[11px] text-ink-2">统计口径：到达=材料首次入库；撤销=批次许可失效传播；审核=人工决定变更。<Link to="/voc" className="ml-1 underline-offset-2 hover:underline">返回总览</Link></p>
      </WorkspaceAuthGate>
    </div>
  );
}
