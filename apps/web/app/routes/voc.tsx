import { useLoaderData, useSearchParams } from "react-router";
import { vocGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { WorkspaceAuthGate } from "../components/shell/WorkspaceAuthGate";
import { IntelligenceFeed } from "../features/intelligence/IntelligenceFeed";
import { IntelligenceFilters } from "../features/intelligence/IntelligenceFilters";
import type { IntelligenceItem } from "../features/intelligence/types";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "voc", name: "消费者原声" };

interface EvidenceItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  sourceId: string;
  form: string;
  authorRole: string;
  market: string;
  l1Categories: string[];
  l1Polarity: string;
  language: string;
  answerCount: number;
  resolution: string;
  excerpt: string;
  contentLicense: string | null;
  reviewStatus: string;
  attribution: string | null;
  thread?: {
    questionId: number;
    title: string;
    body: string;
    tags: string[];
    answers: Array<{ id: number; score: number; isAccepted: boolean; body: string }>;
    comments: Array<{ id: number; body: string }>;
  };
}

interface EvidenceResponse {
  items: EvidenceItem[];
  studies: Array<{ id: string; name: string }>;
  batches: Array<{ id: string; label: string }>;
}

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  for (const key of ["study", "category", "polarity", "q"]) {
    if (url.searchParams.get(key)) params.set(key, url.searchParams.get(key)!);
  }
  const result = await vocGet<EvidenceResponse>(request, `/api/voc/evidence?${params}`);
  return { result, queryParams: Object.fromEntries(params) };
}

export function meta() {
  return pageMeta({
    title: "消费者原声 · 轻选情报中心",
    description: "以商品真实使用反馈与讨论为中心的消费者原声情报：原文、上下文、L1 确定性规则标签与人工审核。",
    noindex: true,
    path: "/voc",
  });
}

function stripHtml(html: string | undefined | null): string {
  if (!html) return "";
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const POLARITY_TONE: Record<string, "ok" | "amber" | "neutral" | "hot"> = {
  negative: "hot",
  positive: "ok",
  neutral: "neutral",
  mixed: "amber",
};

export default function VocIndex() {
  const { result } = useLoaderData<typeof loader>();
  const data = result.data;
  const [params] = useSearchParams();
  const activeCategory = params.get("category");
  const q = params.get("q") ?? "";

  // Dynamic theme tags from L1 categories
  const themes = [
    { id: "使用咨询", label: "使用咨询" },
    { id: "选购比较", label: "选购比较" },
    { id: "清洗维护", label: "清洗维护" },
    { id: "部件损坏", label: "部件损坏与故障" },
  ];

  // Convert evidence items into Unified Intelligence Items
  const feedItems: IntelligenceItem[] = (data?.items ?? []).map((item) => {
    const rawContext = item.thread?.body ? stripHtml(item.thread.body) : item.excerpt;
    return {
      id: item.id,
      lane: "voc",
      laneLabel: "消费者原声",
      title: item.title,
      summary: item.excerpt,
      contextSnippet: rawContext && rawContext !== item.excerpt ? rawContext : undefined,
      sourceName: item.sourceId === "voc-coffee-se" ? "Coffee Stack Exchange" : item.sourceId,
      sourceType: item.form === "question" ? "消费者提问" : "讨论原帖",
      sourceTypeTone: POLARITY_TONE[item.l1Polarity] ?? "neutral",
      time: item.publishedAt || new Date().toISOString(),
      timeLabel: "原声发布",
      tags: item.l1Categories.length > 0 ? item.l1Categories : ["电动咖啡豆研磨机"],
      statusBadge: {
        label:
          item.reviewStatus === "confirmed"
            ? "人工已核"
            : item.reviewStatus === "rejected"
              ? "已排除"
              : "待人工复核",
        tone:
          item.reviewStatus === "confirmed"
            ? "ok"
            : item.reviewStatus === "rejected"
              ? "neutral"
              : "amber",
      },
      identityLine: "¥0 预算硬约束 · 中文理解未开启 · 原文呈现（未调用大模型）",
      evidenceLine: `回答数 ${item.answerCount} · 极性 ${item.l1Polarity} · 许可 ${item.contentLicense || "CC BY-SA 4.0"}`,
      detailUrl: `/voc/evidence`,
      externalUrl: item.url,
      starrable: true,
    };
  });

  return (
    <div className="space-y-5 pb-12">
      <PhoneBar back={{ to: "/", label: "情报" }} title="消费者原声" />

      {/* Header matching /all, clean title without "(第三主线)" */}
      <header className="pb-1 pt-2 lg:pt-1">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink lg:text-[26px]">
          消费者原声
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          以商品与品类真实使用讨论为中心的消费者原声信息流：包含原始原话、讨论上下文、L1 确定性标签与人工审核。
          当前正式材料以 Coffee Stack Exchange 电动咖啡豆研磨机研究为主。
        </p>
      </header>

      {/* Filters matching /all */}
      <IntelligenceFilters
        actionUrl="/voc"
        themes={themes}
        activeTheme={activeCategory}
        themeParam="category"
        q={q}
        searchPlaceholder="搜索原声标题或关键词…"
        secondaryLinks={[
          { label: "反馈证据库", to: "/voc/evidence" },
          { label: "痛点研究", to: "/voc/research" },
          { label: "来源与历史", to: "/voc/system" },
        ]}
      />

      <WorkspaceAuthGate error={result.error} laneName="消费者原声工作台" returnTo="/voc">
        <div className="mt-6">
          <IntelligenceFeed
            items={feedItems}
            showLane={false}
            emptyTitle="暂无符合条件的消费者原声材料"
            emptyMessage="尚未导入或采集任何符合条件的材料，或当前筛选范围内为空。系统坚持实证原声，不生成虚假痛点。"
          />
        </div>
      </WorkspaceAuthGate>
    </div>
  );
}
