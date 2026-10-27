import { useLoaderData, useSearchParams } from "react-router";
import type { IndustryListResponse, IndustrySourceStatus } from "@aihot/contracts/site";
import { apiGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { IntelligenceFeed } from "../features/intelligence/IntelligenceFeed";
import { IntelligenceFilters } from "../features/intelligence/IntelligenceFilters";
import type { IntelligenceItem } from "../features/intelligence/types";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "industry", name: "行业动态" };

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

const KIND_TONE: Record<string, "ok" | "amber" | "neutral" | "hot"> = {
  "official-data": "ok",
  news: "amber",
  opinion: "neutral",
  "research-promo": "neutral",
  sponsored: "neutral",
  "corporate-personnel": "neutral",
  earnings: "ok",
  irrelevant: "hot",
};

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const qs = url.searchParams;
  const params = new URLSearchParams();
  for (const key of ["theme", "source", "kind", "q", "days"]) {
    if (qs.get(key)) params.set(key, qs.get(key)!);
  }

  const [items, status] = await Promise.all([
    apiGet<IndustryListResponse>(`/api/site/industry?${params.toString()}`, { signal: request.signal }),
    apiGet<IndustrySourceStatus>("/api/site/industry/status", { signal: request.signal }),
  ]);
  return { items, status, filterObj: Object.fromEntries(params) };
}

export function meta() {
  return pageMeta({
    title: "行业动态 · 轻选情报中心",
    description: "美国消费与电商行业动态：消费需求、渠道竞争、品类趋势、供应链成本与官方经济数据，全部可追溯到原始来源。",
    noindex: true,
    path: "/industry",
  });
}

export default function IndustryIndex() {
  const { items, status } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const theme = params.get("theme");
  const source = params.get("source") ?? "";
  const q = params.get("q") ?? "";

  // Convert industry items to Unified Intelligence Items
  const feedItems: IntelligenceItem[] = items.items.map((item) => {
    const isOfficial = item.kind === "official-data";
    return {
      id: item.id,
      lane: "industry",
      laneLabel: "行业动态",
      title: item.zhTitle || item.title,
      originalTitle: item.zhTitle ? item.title : null,
      summary:
        item.zhSummary ||
        "该来源的使用条款不允许存储完整摘要；仅保留标题线索供查阅原文。",
      sourceName: item.sourceName.split("(")[0] || item.sourceName,
      sourceType: KIND_LABEL[item.kind] ?? item.kind,
      sourceTypeTone: KIND_TONE[item.kind] ?? "neutral",
      time: item.publishedAt || new Date().toISOString(),
      timeLabel: "来源发布",
      tags: item.themes,
      statusBadge: isOfficial
        ? { label: "官方数据", tone: "ok" }
        : { label: KIND_LABEL[item.kind] ?? "行业报道", tone: KIND_TONE[item.kind] ?? "neutral" },
      identityLine: item.zhTitle
        ? "DeepSeek 机器处理 · 未经人工核对"
        : "仅标题线索（遵守版权准入，点击直达原文）",
      evidenceLine:
        item.story && item.story.articleCount > 1
          ? `${item.story.articleCount} 家机构共同报道`
          : undefined,
      detailUrl: `/industry/${item.id}`,
      externalUrl: item.url,
      starrable: true,
    };
  });

  return (
    <div className="space-y-5 pb-12">
      <PhoneBar back={{ to: "/", label: "情报" }} title="行业动态" />

      {/* Header matching /all */}
      <header className="pb-1 pt-2 lg:pt-1">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink lg:text-[26px]">
          行业动态
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          美国消费与电商行业的变化信号与官方经济数据：已准入 {items.counts.admitted} 条 · 规则排除 {items.counts.rejected} 条 · 事件聚合 {items.counts.stories} 个。
          限制准入来源仅展示标题与链接（不存储其摘要文本）。
        </p>
      </header>

      {/* Unified Filters matching /all */}
      <IntelligenceFilters
        actionUrl="/industry"
        themes={items.themes}
        activeTheme={theme}
        themeParam="theme"
        sources={items.sources}
        activeSource={source}
        q={q}
        searchPlaceholder="搜索行业标题关键词…"
        exportMarkdownUrl={`/api/site/industry/export?${params.toString()}`}
        secondaryLinks={[
          { label: "每日精选", to: "/industry/daily" },
        ]}
      />

      {/* Feed with grouped timeline cards */}
      <div className="mt-6">
        <IntelligenceFeed
          items={feedItems}
          showLane={false}
          emptyTitle="暂无符合条件的行业条目"
          emptyMessage="要么该筛选范围下来源尚无新增，要么现有条目被规则正确排除。系统坚持实证原则，不凑数量。"
        />
      </div>

      <p className="mt-8 text-[11.5px] leading-relaxed text-ink-4">
        中文内容由机器处理，未经人工核对；所有数字与日期以原文为准。处理与保存权限按来源分别限定，仅标题线索不代表已完成中文情报。
      </p>
    </div>
  );
}
