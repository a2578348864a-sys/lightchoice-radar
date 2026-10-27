import { Link, useLoaderData, useSearchParams } from "react-router";
import type { LeadListItem, LeadSourceStatus, LeadsResponse } from "@aihot/contracts/site";
import { SITE } from "@aihot/site";
import { apiGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { IntelligenceFeed } from "../features/intelligence/IntelligenceFeed";
import { IntelligenceFilters } from "../features/intelligence/IntelligenceFilters";
import type { IntelligenceItem } from "../features/intelligence/types";
import { IconInfo } from "../components/icons";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "政策线索" };

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "active";
  const q = url.searchParams.get("q") ?? "";

  const [leads, status] = await Promise.all([
    apiGet<LeadsResponse>(`/api/site/leads?state=${encodeURIComponent(state)}`, { signal: request.signal }),
    apiGet<LeadSourceStatus>("/api/site/leads/status", { signal: request.signal }),
  ]);
  return { leads, status, currentState: state, q };
}

export function meta() {
  return pageMeta({
    title: "政策线索 · 轻选情报中心",
    description: "第三方媒体提供的 Amazon 美国站政策候选线索：只保留标题、短摘要与核实状态，严格隔离于正式政策池外。",
    path: "/leads",
    noindex: true,
  });
}

const OFFICIAL_LABEL: Record<string, { label: string; tone: "ok" | "amber" | "neutral" | "hot" }> = {
  "third-party-only": { label: "仅第三方报道", tone: "amber" },
  "matched-official": { label: "官方记录已匹配", tone: "ok" },
  "access-restricted": { label: "官方口径需登录", tone: "neutral" },
  "evidence-insufficient": { label: "官方资料不足以确认", tone: "amber" },
  unknown: { label: "核实状态未知", tone: "neutral" },
};

const PROCESSING_LABEL: Record<string, { label: string; tone: "ok" | "amber" | "neutral" | "hot" }> = {
  new: { label: "待核实", tone: "amber" },
  processing: { label: "核对中", tone: "amber" },
  processed: { label: "已核对", tone: "ok" },
  skipped: { label: "已排除", tone: "neutral" },
  failed: { label: "核对失败", tone: "hot" },
};

export default function LeadsPage() {
  const { leads, status, currentState, q } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();

  const themes = [
    { id: "active", label: `有效候选 (${leads.counts.active})` },
    { id: "excluded", label: `已排除 (${leads.counts.excluded})` },
    { id: "all", label: `全部报道 (${leads.counts.all})` },
  ];

  // Filter items by search query if present
  let filteredItems = leads.items;
  if (q.trim()) {
    const term = q.trim().toLowerCase();
    filteredItems = filteredItems.filter(
      (item) =>
        item.title.toLowerCase().includes(term) ||
        (item.excerpt && item.excerpt.toLowerCase().includes(term))
    );
  }

  // Convert leads to Unified Intelligence Items
  const feedItems: IntelligenceItem[] = filteredItems.map((lead: LeadListItem) => {
    const official = OFFICIAL_LABEL[lead.officialStatus] ?? { label: "待核实", tone: "amber" };
    const processing = PROCESSING_LABEL[lead.processingState] ?? { label: "处理中", tone: "neutral" };

    return {
      id: lead.id,
      lane: "leads",
      laneLabel: "政策线索",
      title: lead.title,
      summary: lead.excerpt || "第三方媒体报道的政策线索，待与官方公告比对验证。",
      sourceName: lead.sourceName || "AMZ123 政策速递",
      sourceType: official.label,
      sourceTypeTone: official.tone,
      time: lead.publishedAt || lead.discoveredAt,
      timeLabel: "报道发布",
      tags: lead.radarTags.length > 0 ? lead.radarTags : lead.leadTags,
      statusBadge: {
        label: lead.excluded ? "已排除候选" : processing.label,
        tone: lead.excluded ? "neutral" : processing.tone,
      },
      identityLine: "第三方媒体报道 · 未经官方公告证实 · 不进入正式政策池",
      evidenceLine: lead.excluded && lead.exclusionReason ? `排除依据：${lead.exclusionReason}` : `核实进度：${official.label}`,
      limitations: "线索不等于正式政策，点击标题查看核实比对细节或前往原文",
      detailUrl: `/leads/${lead.id}`,
      externalUrl: lead.url,
      starrable: true,
    };
  });

  return (
    <div className="space-y-5 pb-12">
      <PhoneBar back={{ to: "/", label: "情报" }} title="政策线索" />

      {/* Header */}
      <header className="pb-1 pt-2 lg:pt-1">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="text-[24px] font-semibold leading-[1.3] text-ink lg:text-[26px]">
            政策线索
          </h1>
          <span className="rounded-full bg-amber-soft px-2.5 py-0.5 text-[11.5px] font-semibold text-amber-ink">
            线索 ≠ 政策事实
          </span>
        </div>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          第三方行业媒体报道的 Amazon 美国站政策变动候选线索。在此仅做线索留痕与官方交叉比对，
          不保存正文，不进入正式政策池。
        </p>
      </header>

      {/* Filters matching /all */}
      <IntelligenceFilters
        actionUrl="/leads"
        themes={themes}
        activeTheme={currentState}
        themeParam="state"
        q={q}
        searchPlaceholder="搜索线索标题或摘要…"
        secondaryLinks={[
          { label: "来源监控看板", to: "/admin/sources" },
        ]}
      />

      {/* Compact Source Check Note */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-control bg-well/60 px-3 py-2 text-[12px] text-ink-3 border border-line-soft">
        <div className="flex items-center gap-2">
          <span className="size-2 rounded-full bg-ok" />
          <span>线索源状态：{status.source.enabled ? "已启用自动化监控" : "已停用"}</span>
          <span className="text-ink-4">（每 {status.source.intervalMinutes ?? 360} 分钟轮询一次第三方流）</span>
        </div>
        <span className="text-ink-4 text-[11.5px]">
          上次检查：{status.lastRun ? `新增 ${status.lastRun.created} 条` : "已同步"}
        </span>
      </div>

      {/* Feed of Leads */}
      <div className="mt-6">
        <IntelligenceFeed
          items={feedItems}
          showLane={false}
          emptyTitle={currentState === "excluded" ? "暂无被排除的政策报道" : "当前暂无符合条件的政策线索"}
          emptyMessage="线索源定期检查；有新的第三方政策报道且符合抓取条件时会出现在这里。"
        />
      </div>

      {/* Methodology disclosure */}
      <details className="group mt-8 text-[12px] text-ink-4">
        <summary className="flex cursor-pointer items-center gap-1.5 py-1 transition-colors hover:text-ink-2">
          <IconInfo size={15} />
          <span>线索采集口径与事实隔离说明</span>
        </summary>
        <ul className="mt-2 max-w-[760px] list-disc space-y-1.5 pl-5 leading-[1.75] text-ink-3">
          {leads.limitations.map((line) => (
            <li key={line}>{line}</li>
          ))}
          <li>政策线索属于独立阅读视图，不进入第一主线正式政策池，不影响正式政策统计。</li>
          <li>{SITE.name} 不转载、不存储第三方正文；原文版权与最终解释权归 AMZ123 及原作者所有。</li>
        </ul>
      </details>
    </div>
  );
}
