import { Link, useLoaderData } from "react-router";
import type { LeadListItem, LeadSourceStatus, LeadsResponse } from "@aihot/contracts/site";
import { SITE } from "@aihot/site";
import { apiGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { fullDateTime, monthDayTime, relativeTime } from "../lib/format";
import { Badge } from "../components/ui/Badge";
import { PillTabs } from "../components/ui/Tabs";
import { EmptyState } from "../components/ui/Page";
import { IconExternal, IconInfo } from "../components/icons";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "政策线索" };

export async function loader({ request }: { request: Request }) {
  const state = new URL(request.url).searchParams.get("state") ?? "active";
  const [leads, status] = await Promise.all([
    apiGet<LeadsResponse>(`/api/site/leads?state=${encodeURIComponent(state)}`, { signal: request.signal }),
    apiGet<LeadSourceStatus>("/api/site/leads/status", { signal: request.signal }),
  ]);
  return { leads, status };
}

export function meta() {
  return pageMeta({
    title: "政策线索",
    description: "第三方媒体提供的 Amazon 美国站政策候选线索：只保留标题、短摘要与核实状态，不是官方已确认的政策。",
    path: "/leads",
    noindex: true,
  });
}

const STATE_LABEL: Record<string, string> = { active: "有效候选", excluded: "已排除", all: "全部" };

const PROCESSING: Record<string, { label: string; tone: "ok" | "amber" | "neutral" | "hot" }> = {
  new: { label: "待处理", tone: "neutral" },
  processing: { label: "处理中", tone: "amber" },
  processed: { label: "已处理", tone: "ok" },
  skipped: { label: "已排除", tone: "neutral" },
  failed: { label: "处理失败", tone: "hot" },
};

/** Unmapped states read as 状态未知 instead of leaking an English enum token into the Chinese page. */
const UNKNOWN_PROCESSING = { label: "状态未知", tone: "neutral" as const };

/** The official evidence state, as the record itself states it — never a confirmation we did not get. */
const OFFICIAL: Record<string, { label: string; tone: "ok" | "amber" | "neutral" | "hot" }> = {
  "third-party-only": { label: "仅第三方报道", tone: "amber" },
  "matched-official": { label: "官方记录已匹配", tone: "ok" },
  "access-restricted": { label: "官方口径需登录", tone: "neutral" },
  "evidence-insufficient": { label: "有官方资料但不足以确认", tone: "amber" },
  unknown: { label: "核实状态未知", tone: "neutral" },
};

const UNKNOWN_OFFICIAL = { label: "核实状态未知", tone: "neutral" as const };

/** pg-boss job states behind 最近一次采集, in Chinese. */
const RUN_STATUS: Record<string, string> = {
  ok: "成功", failed: "失败", created: "排队中", retry: "等待重试", active: "执行中", completed: "完成", cancelled: "已取消", paused: "已暂停",
};
const runStatusText = (status: string) => RUN_STATUS[status] ?? "状态未知";

function statePath(state: string) {
  return state === "active" ? "/leads" : `/leads?state=${state}`;
}

/**
 * The three questions kept apart: the source row says whether this source is switched on, the
 * advisory lock says whether a worker is actually running, and the last run says what happened.
 * One green badge must never stand for all three.
 */
function RunStatus({ status }: { status: LeadSourceStatus }) {
  const { source, worker, lastRun } = status;
  const runOk = lastRun?.status === "ok";
  return (
    <section aria-label="采集运行状态" className="card mt-4 p-4 lg:mt-5 lg:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-[14px] font-semibold text-ink">采集运行状态</h2>
        <span className="text-[11.5px] text-ink-4">来源配置 · Worker · 最近一轮，是三件事</span>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-2.5 text-[12.5px] sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <dt className="w-[92px] shrink-0 text-ink-4">来源配置</dt>
          <dd className="flex flex-wrap items-center gap-1.5">
            <Badge tone={source.enabled ? "ok" : "neutral"} dot>{source.enabled ? "已启用" : "已停用"}</Badge>
            <span className="text-ink-3">每 {source.intervalMinutes} 分钟检查一次</span>
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="w-[92px] shrink-0 text-ink-4">专用 Worker</dt>
          <dd className="flex flex-wrap items-center gap-1.5">
            <Badge tone={worker.running ? "ok" : "amber"} dot>{worker.running ? "运行中" : "未运行"}</Badge>
            <span className="text-ink-4">{worker.running ? "实例锁被占用" : "没有进程持有实例锁"}</span>
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="w-[92px] shrink-0 text-ink-4">最近一次采集</dt>
          <dd className="flex flex-wrap items-center gap-1.5">
            {lastRun ? (
              <>
                <Badge tone={runOk ? "ok" : lastRun.status === "failed" ? "hot" : "neutral"}>{runStatusText(lastRun.status)}</Badge>
                <span className="text-ink-3"><span className="num">#{lastRun.id}</span> · {monthDayTime(lastRun.startedAt)} · 新增 <span className="num">{lastRun.created}</span> 条</span>
              </>
            ) : (
              <span className="text-ink-4">还没有采集记录</span>
            )}
          </dd>
        </div>
        <div className="flex items-center gap-2">
          <dt className="w-[92px] shrink-0 text-ink-4">下次计划检查</dt>
          <dd className="flex flex-wrap items-center gap-1.5">
            <span className="text-ink-3">{source.nextFetchAt ? monthDayTime(source.nextFetchAt) : "未安排"}</span>
            <span className="text-ink-4">仅计划时间</span>
          </dd>
        </div>
      </dl>
      {!worker.running && (
        <p className="mt-2.5 rounded-lg bg-amber-soft px-3 py-2 text-[12px] leading-[1.7] text-amber-ink">
          Worker 当前没有运行：上面的计划时间到了也不会自动采集。需要采集时在项目里前台运行 <code className="font-mono">cd apps/worker &amp;&amp; npm run monitor:amz123-leads</code>。
        </p>
      )}
      {source.lastError && (
        <p className="mt-2.5 text-[12px] leading-[1.7] text-hot">最近错误：{source.lastError}</p>
      )}
    </section>
  );
}

function LeadCard({ lead }: { lead: LeadListItem }) {
  const official = OFFICIAL[lead.officialStatus] ?? UNKNOWN_OFFICIAL;
  const processing = PROCESSING[lead.processingState] ?? UNKNOWN_PROCESSING;
  return (
    <article className="card p-4 lg:p-5">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={official.tone}>{official.label}</Badge>
        <Badge tone={processing.tone}>{processing.label}</Badge>
        {lead.column && <span className="text-[11.5px] text-ink-4">{lead.column}</span>}
        {lead.radarTags.length > 0 && <span className="text-[11.5px] text-ink-3">{lead.radarTags.join(" · ")}</span>}
        {lead.leadTags.map((tag) => (
          <span key={tag} className="text-[11.5px] text-ink-4">{tag}</span>
        ))}
      </div>
      <h3 className="mt-2 text-[16.5px] font-[650] leading-[1.5] text-ink">
        <Link to={`/leads/${lead.id}`} className="transition-colors hover:text-accent">{lead.title}</Link>
      </h3>
      {lead.excerpt && <p className="mt-1.5 line-clamp-2 text-[13px] leading-[1.7] text-ink-3">{lead.excerpt}</p>}
      {lead.excluded && lead.exclusionReason && (
        <p className="mt-2 rounded-lg bg-bg-sunk px-3 py-1.5 text-[12px] leading-[1.65] text-ink-3">
          排除原因：{lead.exclusionReason}
        </p>
      )}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-ink-4">
        <span>来源 {lead.sourceName}</span>
        <span>报道 {lead.publishedAt ? fullDateTime(lead.publishedAt) : "未标注"}</span>
        {lead.sourceUpdatedAt && <span>来源更新 {fullDateTime(lead.sourceUpdatedAt)}</span>}
        <time dateTime={lead.discoveredAt} suppressHydrationWarning>发现 {relativeTime(lead.discoveredAt)}</time>
        <a href={lead.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
          原文 <IconExternal size={12} />
        </a>
      </div>
    </article>
  );
}

export default function LeadsPage() {
  const { leads, status } = useLoaderData<typeof loader>();
  const tabs = [
    { key: "active", label: STATE_LABEL.active!, count: leads.counts.active, to: statePath("active") },
    { key: "excluded", label: STATE_LABEL.excluded!, count: leads.counts.excluded, to: statePath("excluded") },
    { key: "all", label: STATE_LABEL.all!, count: leads.counts.all, to: statePath("all") },
  ];
  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/", label: "情报" }} title="政策线索" />
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 data-page-title="" className="text-[24px] font-semibold leading-[1.3] text-ink">政策线索</h1>
        <p className="mt-1.5 max-w-[720px] text-[13px] leading-relaxed text-ink-3">
          第三方媒体 AMZ123 报道的 Amazon 美国站政策候选线索。它们<strong className="font-semibold text-ink-2">不是</strong> Amazon 官方已确认的政策：
          这里只保存标题、短摘要与核实状态，不保存正文；点标题看核实说明，点「原文」到 AMZ123 阅读全文。
        </p>
      </header>

      <RunStatus status={status} />

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
        <PillTabs
          size="sm"
          layoutId="leads-state"
          label="线索状态"
          active={leads.filters.state}
          items={tabs}
        />
        <span className="text-[11.5px] text-ink-4">默认只看有效候选，已排除的报道单独归档</span>
      </div>

      {leads.items.length === 0 ? (
        <div className="card mt-3 rounded-sheet">
          <EmptyState title={leads.filters.state === "excluded" ? "还没有被排除的报道" : "还没有候选线索"}>
            {leads.filters.state === "excluded"
              ? "复核时排除的报道会出现在这里，保留历史记录但不与候选混在一起。"
              : "线索源每 6 小时检查一次；有新的第三方政策报道时会出现在这里。"}
          </EmptyState>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {leads.items.map((lead) => <LeadCard key={lead.id} lead={lead} />)}
        </div>
      )}

      <details className="disclosure group/method mt-8 text-[12px] text-ink-4">
        <summary className="flex cursor-pointer items-center gap-1.5 py-1 transition-colors hover:text-ink-2">
          <IconInfo size={15} />
          这些线索是怎么来的、为什么不能当成官方政策？
        </summary>
        <ul className="mt-2 max-w-[760px] list-disc space-y-1.5 pl-5 leading-[1.75] text-ink-3">
          {leads.limitations.map((line) => <li key={line}>{line}</li>)}
          <li>线索页是独立的只读视图：它不进入公开情报池、搜索与正式详情路由，也不改变正式政策统计（平台政策 / 广告政策 / 监管）。</li>
          <li>{SITE.name} 不转载、不存储第三方正文；原文的版权与解释权归 AMZ123 及原作者。</li>
        </ul>
      </details>
    </div>
  );
}
