import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/home";
import type { PoolResponse, IndustryListResponse, LeadsResponse } from "@aihot/contracts/site";
import { apiGet, vocGet, marketGet, cachedPage } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { Badge } from "../components/ui/Badge";
import { IntelligenceCard } from "../features/intelligence/IntelligenceCard";
import type { IntelligenceItem } from "../features/intelligence/types";
import { IconBolt, IconList, IconRadar, IconUsers, IconChart, IconDoc, IconBookmark, IconShield } from "../components/icons";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "featured", name: "情报首页" };
export { pageHeaders as headers } from "../lib/api.server";

interface VocEvidenceItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  sourceId: string;
  excerpt: string;
  authorRole: string;
  market: string;
  l1Categories: string[];
  l1Polarity: string;
  reviewStatus: string;
  answerCount: number;
}

interface VocEvidenceResponse {
  items: VocEvidenceItem[];
  studies: Array<{ id: string; name: string }>;
}

interface MarketSignalItem {
  id: string;
  module: string;
  kind: string;
  subjectZh: string;
  detailZh: string;
  strength: number;
  evidenceRefs: string[];
  at: string;
  isTest?: boolean;
  sourceName?: string;
}

interface MarketSignalsResponse {
  signals: MarketSignalItem[];
  total: number;
}

export async function loader({ request }: Route.LoaderArgs) {
  // Fetch from all lanes with resilient fallbacks: single-lane outage never breaks the home page
  const [policyRes, industryRes, vocRes, marketRes, leadsRes] = await Promise.allSettled([
    apiGet<PoolResponse>("/api/site/pool?lane=policy&page=1", { signal: request.signal }),
    apiGet<IndustryListResponse>("/api/site/industry?days=30", { signal: request.signal }),
    vocGet<VocEvidenceResponse>(request, "/api/voc/evidence"),
    marketGet<MarketSignalsResponse>(request, "/api/market/signals"),
    apiGet<LeadsResponse>("/api/site/leads?state=active", { signal: request.signal }),
  ]);

  // 1. Policy items -> IntelligenceItem[]
  const policyPool = policyRes.status === "fulfilled" ? policyRes.value : null;
  const policyItems: IntelligenceItem[] = (policyPool?.items ?? []).slice(0, 3).map((item) => ({
    id: item.id,
    lane: "policy",
    laneLabel: "平台政策",
    title: item.title,
    originalTitle: item.originalTitle,
    summary: item.summary,
    sourceName: item.source.name,
    sourceType: "官方政策与法规",
    sourceTypeTone: "ok",
    time: item.publishedAt || item.timelineAt,
    timeLabel: "发布于",
    tags: item.tags.slice(0, 3),
    statusBadge: { label: "官方核实", tone: "ok" },
    identityLine: item.identity?.titleKind === "machine-zh" ? "机器翻译 · 核对原文" : "官方公告",
    detailUrl: `/items/${item.id}`,
    score: item.score,
    starrable: true,
  }));

  // 2. Industry items -> IntelligenceItem[]
  const industryData = industryRes.status === "fulfilled" ? industryRes.value : null;
  const industryItems: IntelligenceItem[] = (industryData?.items ?? []).slice(0, 3).map((item) => {
    const isOfficial = item.kind === "official-data";
    return {
      id: item.id,
      lane: "industry",
      laneLabel: "行业动态",
      title: item.zhTitle || item.title,
      originalTitle: item.zhTitle ? item.title : null,
      summary: item.zhSummary || "该来源的使用条款不允许存储完整摘要；仅保留标题线索供查阅。",
      sourceName: item.sourceName.split("(")[0] || item.sourceName,
      sourceType: isOfficial ? "官方统计数据" : item.kind === "opinion" ? "行业观点" : "行业报道",
      sourceTypeTone: isOfficial ? "ok" : "amber",
      time: item.publishedAt || new Date().toISOString(),
      timeLabel: "发布于",
      tags: item.themes,
      statusBadge: isOfficial ? { label: "官方数据", tone: "ok" } : { label: "行业观察", tone: "neutral" },
      identityLine: item.zhTitle ? "DeepSeek 机器处理 · 未经人工核对" : "仅标题线索（遵守版权准入）",
      detailUrl: `/industry/${item.id}`,
      externalUrl: item.url,
      starrable: true,
    };
  });

  // 3. VOC items -> IntelligenceItem[]
  const vocData = vocRes.status === "fulfilled" && vocRes.value.data ? vocRes.value.data : null;
  const vocItems: IntelligenceItem[] = (vocData?.items ?? []).slice(0, 3).map((item) => ({
    id: item.id,
    lane: "voc",
    laneLabel: "消费者原声",
    title: item.title,
    summary: item.excerpt,
    sourceName: "Coffee Stack Exchange",
    sourceType: "消费者真实讨论",
    sourceTypeTone: "neutral",
    time: item.publishedAt || new Date().toISOString(),
    timeLabel: "原声发布于",
    tags: item.l1Categories.length > 0 ? item.l1Categories : ["电动咖啡豆研磨机"],
    statusBadge: {
      label: item.reviewStatus === "confirmed" ? "人工已核" : "待人工复核",
      tone: item.reviewStatus === "confirmed" ? "ok" : "amber",
    },
    identityLine: "¥0 预算硬约束 · 中文理解未开启 · 原文呈现",
    evidenceLine: `回答数 ${item.answerCount} · 极性 ${item.l1Polarity}`,
    detailUrl: `/voc/evidence`,
    externalUrl: item.url,
    starrable: true,
  }));

  // 4. Market signals -> IntelligenceItem[]
  const marketData = marketRes.status === "fulfilled" && marketRes.value.data ? marketRes.value.data : null;
  const marketItems: IntelligenceItem[] = (marketData?.signals ?? []).slice(0, 3).map((sig) => ({
    id: sig.id,
    lane: "market",
    laneLabel: "市场信号",
    title: sig.subjectZh,
    summary: sig.detailZh,
    sourceName: sig.sourceName || "市场观测流",
    sourceType: sig.module === "09" ? "安全召回反证" : sig.module === "01" ? "ABA 需求位移" : "BSR 榜单观测",
    sourceTypeTone: sig.module === "09" ? "hot" : "ok",
    time: sig.at,
    timeLabel: "观测于",
    tags: [sig.module === "09" ? "产品安全" : sig.module === "01" ? "搜索需求" : "商品竞争"],
    statusBadge: {
      label: sig.isTest ? "测试样本" : "确定性规则",
      tone: sig.isTest ? "amber" : "ok",
    },
    identityLine: "确定性规则驱动 · 零模型伪造 · 禁止推断为绝对商机",
    evidenceLine: sig.evidenceRefs[0] ? `证据：${sig.evidenceRefs[0]}` : undefined,
    detailUrl: `/market`,
    externalUrl: sig.evidenceRefs[0]?.startsWith("http") ? sig.evidenceRefs[0] : undefined,
    isTest: sig.isTest,
    starrable: true,
  }));

  // 5. Leads -> IntelligenceItem[]
  const leadsData = leadsRes.status === "fulfilled" ? leadsRes.value : null;
  const leadItems: IntelligenceItem[] = (leadsData?.items ?? []).slice(0, 3).map((lead) => ({
    id: lead.id,
    lane: "leads",
    laneLabel: "政策线索",
    title: lead.title,
    summary: lead.excerpt || "第三方媒体报道政策候选，待比对官方口径。",
    sourceName: lead.sourceName || "AMZ123",
    sourceType: "第三方报道（待核实）",
    sourceTypeTone: "amber",
    time: lead.publishedAt || lead.discoveredAt,
    timeLabel: "报道于",
    tags: lead.radarTags.length > 0 ? lead.radarTags : ["政策候选"],
    statusBadge: { label: "待核实线索", tone: "amber" },
    identityLine: "线索不等于正式政策 · 请核对官方原文",
    detailUrl: `/leads/${lead.id}`,
    externalUrl: lead.url,
    starrable: true,
  }));

  // Top Key Items for today: pick from formal policy + formal industry + formal market
  const todayKeyItems: IntelligenceItem[] = [
    ...(policyItems[0] ? [policyItems[0]] : []),
    ...(industryItems[0] ? [industryItems[0]] : []),
    ...(marketItems[0] ? [marketItems[0]] : []),
    ...(policyItems[1] ? [policyItems[1]] : []),
    ...(industryItems[1] ? [industryItems[1]] : []),
  ].slice(0, 3);

  const stats = {
    policyCount: policyPool?.total ?? 0,
    industryCount: industryData?.counts?.admitted ?? 0,
    vocCount: vocData?.items?.length ?? 0,
    marketSignalsCount: marketData?.total ?? 0,
    leadsCount: leadsData?.counts?.active ?? 0,
  };

  return cachedPage(60, {
    policyItems,
    industryItems,
    vocItems,
    marketItems,
    leadItems,
    todayKeyItems,
    stats,
  });
}

export function meta() {
  return pageMeta({
    title: "轻选情报中心 · 真正的跨境情报首页",
    description: "Amazon 美国站政策法规、行业动态、消费者原声与市场信号，基于第一手证据与确定性规则组织的一体化情报流。",
    path: "/",
  });
}

export default function HomePage() {
  const {
    policyItems,
    industryItems,
    vocItems,
    marketItems,
    leadItems,
    todayKeyItems,
    stats,
  } = useLoaderData<typeof loader>();

  return (
    <div className="space-y-8 pb-12">
      <PhoneBar title="轻选情报中心" />

      {/* Header */}
      <header className="pt-2 lg:pt-1">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h1 className="text-[26px] font-bold tracking-tight text-ink lg:text-[28px]">
              轻选情报中心
            </h1>
            <p className="mt-1.5 text-[14px] leading-relaxed text-ink-3">
              Amazon 美国站平台政策、行业动态、消费者原声与市场信号四主线聚合情报。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/all"
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12px] font-medium text-ink hover:bg-bg-sunk transition-colors"
            >
              <IconList size={14} className="text-accent" />
              政策情报 ({stats.policyCount})
            </Link>
            <Link
              to="/industry"
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12px] font-medium text-ink hover:bg-bg-sunk transition-colors"
            >
              <IconRadar size={14} className="text-accent" />
              行业动态 ({stats.industryCount})
            </Link>
            <Link
              to="/voc"
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12px] font-medium text-ink hover:bg-bg-sunk transition-colors"
            >
              <IconUsers size={14} className="text-accent" />
              消费者原声 ({stats.vocCount})
            </Link>
            <Link
              to="/market"
              className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-line bg-surface px-3 text-[12px] font-medium text-ink hover:bg-bg-sunk transition-colors"
            >
              <IconChart size={14} className="text-accent" />
              市场信号 ({stats.marketSignalsCount})
            </Link>
          </div>
        </div>
      </header>

      {/* Part 1: 今日重点 */}
      <section aria-labelledby="today-focus-heading" className="space-y-3.5">
        <div className="flex items-center justify-between border-b border-line pb-2">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-accent-soft text-accent">
              <IconBolt size={14} />
            </span>
            <h2 id="today-focus-heading" className="text-[17px] font-semibold text-ink">
              今日重点情报
            </h2>
          </div>
          <span className="hidden text-[12px] text-ink-4 sm:inline">按实证级别与时间推选</span>
        </div>

        {todayKeyItems.length === 0 ? (
          <div className="rounded-card border border-line bg-surface p-6 text-center text-[13px] text-ink-3">
            当前暂无符合条件的今日重点情报。
          </div>
        ) : (
          <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
            {todayKeyItems.map((item) => (
              <IntelligenceCard key={`focus-${item.id}`} item={item} showLane={true} />
            ))}
          </div>
        )}
      </section>

      {/* Part 2: 四条主线最新情报 */}
      <section aria-labelledby="lanes-heading" className="space-y-6">
        <div className="flex items-center justify-between border-b border-line pb-2">
          <h2 id="lanes-heading" className="text-[17px] font-semibold text-ink">
            四主线最新情报流
          </h2>
          <span className="hidden text-[12px] text-ink-4 sm:inline">统一视觉 · 统一契约 · 分立事实</span>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Lane 1: 平台政策 */}
          <div className="min-w-0 space-y-3 rounded-sheet border border-line bg-surface/50 p-3.5 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge tone="ok">01</Badge>
                <h3 className="text-[15px] font-semibold text-ink">平台政策情报</h3>
              </div>
              <Link to="/all" className="text-[12px] font-medium text-accent hover:underline">
                查看全部 ({stats.policyCount}) →
              </Link>
            </div>
            {policyItems.length === 0 ? (
              <p className="py-4 text-center text-[12.5px] text-ink-4">当前暂无符合条件的新情报</p>
            ) : (
              <div className="space-y-2.5">
                {policyItems.map((item) => (
                  <IntelligenceCard key={`lane1-${item.id}`} item={item} showLane={false} />
                ))}
              </div>
            )}
          </div>

          {/* Lane 2: 行业动态 */}
          <div className="min-w-0 space-y-3 rounded-sheet border border-line bg-surface/50 p-3.5 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge tone="ok">02</Badge>
                <h3 className="text-[15px] font-semibold text-ink">行业动态</h3>
              </div>
              <Link to="/industry" className="text-[12px] font-medium text-accent hover:underline">
                查看全部 ({stats.industryCount}) →
              </Link>
            </div>
            {industryItems.length === 0 ? (
              <p className="py-4 text-center text-[12.5px] text-ink-4">当前暂无符合条件的新情报</p>
            ) : (
              <div className="space-y-2.5">
                {industryItems.map((item) => (
                  <IntelligenceCard key={`lane2-${item.id}`} item={item} showLane={false} />
                ))}
              </div>
            )}
          </div>

          {/* Lane 3: 消费者原声 */}
          <div className="min-w-0 space-y-3 rounded-sheet border border-line bg-surface/50 p-3.5 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge tone="ok">03</Badge>
                <h3 className="text-[15px] font-semibold text-ink">消费者原声</h3>
              </div>
              <Link to="/voc" className="text-[12px] font-medium text-accent hover:underline">
                查看全部 ({stats.vocCount}) →
              </Link>
            </div>
            {vocItems.length === 0 ? (
              <p className="py-4 text-center text-[12.5px] text-ink-4">当前暂无符合条件的新情报</p>
            ) : (
              <div className="space-y-2.5">
                {vocItems.map((item) => (
                  <IntelligenceCard key={`lane3-${item.id}`} item={item} showLane={false} />
                ))}
              </div>
            )}
          </div>

          {/* Lane 4: 市场信号 */}
          <div className="min-w-0 space-y-3 rounded-sheet border border-line bg-surface/50 p-3.5 sm:p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Badge tone="ok">04</Badge>
                <h3 className="text-[15px] font-semibold text-ink">市场信号</h3>
              </div>
              <Link to="/market" className="text-[12px] font-medium text-accent hover:underline">
                查看全部 ({stats.marketSignalsCount}) →
              </Link>
            </div>
            {marketItems.length === 0 ? (
              <p className="py-4 text-center text-[12.5px] text-ink-4">当前暂无符合条件的新情报</p>
            ) : (
              <div className="space-y-2.5">
                {marketItems.map((item) => (
                  <IntelligenceCard key={`lane4-${item.id}`} item={item} showLane={false} />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Part 3: 待核实政策线索 */}
      <section aria-labelledby="leads-heading" className="min-w-0 space-y-3 rounded-sheet border border-amber/30 bg-amber-soft/20 p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-amber/20 pb-2">
          <div className="flex items-center gap-2">
            <span className="flex size-5 items-center justify-center rounded-full bg-amber text-paper text-[11px] font-bold">
              !
            </span>
            <h2 id="leads-heading" className="text-[16px] font-semibold text-ink">
              待核实政策线索
            </h2>
            <Badge tone="amber">线索 ≠ 政策事实</Badge>
          </div>
          <Link to="/leads" className="text-[12px] font-medium text-accent hover:underline">
            进入线索池 ({stats.leadsCount} 条待核实) →
          </Link>
        </div>

        <p className="text-[12.5px] leading-relaxed text-ink-3">
          第三方媒体（AMZ123 等）最新报道的卖家政策变动传闻或经验贴。在未匹配到 Amazon 官方卖家公告或联邦法规前，
          <strong className="font-semibold text-ink-2"> 严格隔离于正式政策池外</strong>，防止误导选品决策。
        </p>

        {leadItems.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {leadItems.map((item) => (
              <IntelligenceCard key={`lead-${item.id}`} item={item} showLane={false} />
            ))}
          </div>
        )}
      </section>

      {/* Part 4: 研究与报告阅读入口 */}
      <section aria-labelledby="reports-heading" className="space-y-3">
        <div className="flex items-center justify-between border-b border-line pb-2">
          <h2 id="reports-heading" className="text-[17px] font-semibold text-ink">
            情报报告与研究归档
          </h2>
          <span className="hidden text-[12px] text-ink-4 sm:inline">出刊时间：日报 08:00 · 周报周一 10:00 · 月报每月 1 日 10:30</span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Link
            to="/daily"
            className="flex flex-col rounded-card border border-line bg-surface p-4 transition-colors hover:border-accent hover:bg-bg-sunk"
          >
            <IconDoc size={20} className="text-accent mb-2" />
            <span className="font-semibold text-ink text-[14px]">情报日报</span>
            <span className="text-[11.5px] text-ink-4 mt-0.5">每日要闻归纳</span>
          </Link>
          <Link
            to="/weekly"
            className="flex flex-col rounded-card border border-line bg-surface p-4 transition-colors hover:border-accent hover:bg-bg-sunk"
          >
            <IconDoc size={20} className="text-accent mb-2" />
            <span className="font-semibold text-ink text-[14px]">情报周报</span>
            <span className="text-[11.5px] text-ink-4 mt-0.5">周度趋势复盘</span>
          </Link>
          <Link
            to="/monthly"
            className="flex flex-col rounded-card border border-line bg-surface p-4 transition-colors hover:border-accent hover:bg-bg-sunk"
          >
            <IconDoc size={20} className="text-accent mb-2" />
            <span className="font-semibold text-ink text-[14px]">情报月报</span>
            <span className="text-[11.5px] text-ink-4 mt-0.5">月度大盘研判</span>
          </Link>
          <Link
            to="/leads"
            className="flex flex-col rounded-card border border-line bg-surface p-4 transition-colors hover:border-accent hover:bg-bg-sunk"
          >
            <IconShield size={20} className="text-accent mb-2" />
            <span className="font-semibold text-ink text-[14px]">政策线索</span>
            <span className="text-[11.5px] text-ink-4 mt-0.5">第三方线索核查</span>
          </Link>
          <Link
            to="/starred"
            className="flex flex-col rounded-card border border-line bg-surface p-4 transition-colors hover:border-accent hover:bg-bg-sunk"
          >
            <IconBookmark size={20} className="text-accent mb-2" />
            <span className="font-semibold text-ink text-[14px]">我的收藏</span>
            <span className="text-[11.5px] text-ink-4 mt-0.5">本地私有书签</span>
          </Link>
        </div>
      </section>

      {/* Part 5: 来源监控与系统状态 */}
      <footer className="rounded-card border border-line bg-surface p-4 text-[12.5px] text-ink-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-ok" />
            <span className="font-medium text-ink">轻选情报中心 · 本地个人运行模式</span>
            <span className="text-ink-4">| 零云端依赖 · ¥0 成本 · 本机免登录</span>
          </div>
          <div className="flex items-center gap-3 text-[12px]">
            <Link to="/admin/sources" className="text-accent hover:underline">
              信源监控看板 →
            </Link>
            <Link to="/market/sources" className="text-accent hover:underline">
              自动调度监控 →
            </Link>
            <Link to="/agent" className="text-accent hover:underline">
              自动化工具接入 →
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
