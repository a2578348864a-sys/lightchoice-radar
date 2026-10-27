import { useLoaderData, useSearchParams } from "react-router";
import { marketGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { WorkspaceAuthGate } from "../components/shell/WorkspaceAuthGate";
import { IntelligenceFeed } from "../features/intelligence/IntelligenceFeed";
import { IntelligenceFilters } from "../features/intelligence/IntelligenceFilters";
import type { IntelligenceItem } from "../features/intelligence/types";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "market", name: "市场信号" };

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
  extra?: {
    productName?: string;
    officialUrl?: string;
    hazardType?: string;
    hazardDescriptionZh?: string;
    explanation?: {
      safetyRiskZh?: string;
      whyResearchWorthyZh?: string;
      developmentCautionZh?: string;
    };
  };
}

interface MarketSignalsResponse {
  signals: MarketSignalItem[];
  total: number;
}

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const moduleParam = url.searchParams.get("module") || "";
  const includeTest = url.searchParams.get("test") === "all";

  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (moduleParam) qs.set("module", moduleParam);
  if (includeTest) qs.set("includeTest", "true");

  const signalsResult = await marketGet<MarketSignalsResponse>(
    request,
    `/api/market/signals?${qs.toString()}`
  );
  return { signalsResult, currentModule: moduleParam, includeTest, q };
}

export function meta() {
  return pageMeta({
    title: "市场信号 · 轻选情报中心",
    description: "Amazon 美国站关键词需求、榜单变化、价格与产品安全召回的确定性规则情报流。全部内容本地私有，零模型伪造。",
    noindex: true,
    path: "/market",
  });
}

export default function MarketIndex() {
  const { signalsResult, currentModule, q } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  const signals = signalsResult.data?.signals ?? [];

  // Theme filters based on real supported market modules
  const themes = [
    { id: "01", label: "搜索需求 (ABA)" },
    { id: "04", label: "销售热度与榜单 (BSR)" },
    { id: "09", label: "产品安全与召回 (CPSC)" },
  ];

  // Map to Unified Intelligence Items
  const feedItems: IntelligenceItem[] = signals.map((sig) => {
    const isSafety = sig.module === "09";
    const isKw = sig.module === "01";
    return {
      id: sig.id,
      lane: "market",
      laneLabel: "市场信号",
      title: sig.subjectZh,
      summary: sig.detailZh,
      contextSnippet: sig.extra?.explanation?.developmentCautionZh
        ? `【研发避坑提示】${sig.extra.explanation.developmentCautionZh}；${sig.extra.explanation.whyResearchWorthyZh ?? ""}`
        : undefined,
      sourceName:
        sig.sourceName ||
        (isKw ? "AMZ123 ABA 热搜" : isSafety ? "CPSC 官方通告" : "Amazon BSR 观察"),
      sourceType: isSafety
        ? "官方召回反证"
        : isKw
          ? "搜索需求位移"
          : "榜单排位变动",
      sourceTypeTone: isSafety ? "hot" : "ok",
      time: sig.at || new Date().toISOString(),
      timeLabel: "观测于",
      tags: [
        isKw ? "搜索需求" : isSafety ? "产品安全" : "销售热度",
        sig.kind,
      ],
      statusBadge: {
        label: sig.isTest ? "测试/验证样本" : "已确认观测事实",
        tone: sig.isTest ? "amber" : "ok",
      },
      identityLine: "确定性规则 C1/C4/C6 驱动 · 零模型伪造 · 未经全量统计禁推断为绝对商机",
      evidenceLine: sig.evidenceRefs[0] ? `证据来源：${sig.evidenceRefs[0]}` : undefined,
      limitations: isSafety
        ? "严禁推断为爆品商机，仅作为品类缺陷反证与避坑线索"
        : "排名前进≠需求增长百分比，首次上榜≠新品上架",
      detailUrl: isKw
        ? "/market/keywords"
        : sig.module === "04"
          ? "/market/products"
          : undefined,
      externalUrl:
        sig.extra?.officialUrl ||
        (sig.evidenceRefs[0]?.startsWith("http") ? sig.evidenceRefs[0] : undefined),
      isTest: sig.isTest,
      starrable: true,
    };
  });

  return (
    <div className="space-y-5 pb-12">
      <PhoneBar back={{ to: "/", label: "情报" }} title="市场信号" />

      {/* Header matching /all, clean title without "(第四主线)" */}
      <header className="pb-1 pt-2 lg:pt-1">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink lg:text-[26px]">
          市场信号
        </h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          围绕 Amazon 美国站搜索需求、榜单商品变动与官方产品安全召回的确定性情报流。
          <strong className="font-semibold text-ink-2"> 本地私有运行</strong>；零云端依赖，零付费 API 调用，保持事实与推断的严格隔离。
        </p>
      </header>

      {/* Unified Filters */}
      <IntelligenceFilters
        actionUrl="/market"
        themes={themes}
        activeTheme={currentModule}
        themeParam="module"
        q={q}
        searchPlaceholder="搜索关键词或信号描述…"
        secondaryLinks={[
          { label: "12 模块工程矩阵", to: "/market/workbench" },
          { label: "搜索需求分析", to: "/market/keywords" },
          { label: "商品与竞争观测", to: "/market/products" },
          { label: "商业机会与测算", to: "/market/opportunities" },
          { label: "预警工作台", to: "/market/alerts" },
          { label: "自动来源监控 ↗", to: "/market/sources" },
        ]}
      />

      <WorkspaceAuthGate error={signalsResult.error} laneName="市场信号工作台" returnTo="/market">
        <div className="mt-6">
          <IntelligenceFeed
            items={feedItems}
            showLane={false}
            emptyTitle="暂无符合条件的市场信号"
            emptyMessage="当前筛选下暂无新的观测信号。系统坚持实证原则：无真实观测时不伪造虚假市场新闻。"
          />
        </div>
      </WorkspaceAuthGate>

      <p className="mt-8 text-[11.5px] leading-relaxed text-ink-4">
        市场信号由确定性度量规则（C1 排名位移、C3 榜内可比、C4 首次观测、Cpsc 缺陷反证）计算；未经许可或缺乏多期基线时不作外推。后台工程能力详情请查看「12 模块工程矩阵」。
      </p>
    </div>
  );
}
