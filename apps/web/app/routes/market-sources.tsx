import { Link, useLoaderData } from "react-router";
import { useState } from "react";
import { marketPost } from "../lib/market-client";
import { marketGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { Badge } from "../components/ui/Badge";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "自动来源监控" };

interface SourceItem {
  id: string;
  label: string;
  producer: string;
  marketplace: string;
  enabled: boolean;
  automation: "authorized-periodic" | "blocked-no-license" | "pending-credentials" | "manual-import-only";
  cadenceHours?: number;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  lastError?: string | null;
  runCount?: number;
  uses: string[];
  evidence: string;
  notes?: string;
  unverifiedUses?: string[];
  revokedAt?: string;
  revokeReason?: string;
  permissionBasis: string;
}

interface SafetyEventItem {
  id: string;
  sourceId: string;
  officialUrl: string;
  recallTitle: string;
  productName: string;
  hazardType: string;
  hazardDescriptionZh: string;
  categoryCandidate: {
    rawCategory: string;
    normalizedCategoryZh: string;
    mappingBasis: string;
    confidence: string;
    browseNodeId: null;
  };
  sourcePublishedAt: string;
  observedAt: string;
  explanation: {
    officialAnnouncementZh: string;
    productScopeZh: string;
    safetyRiskZh: string;
    whyResearchWorthyZh: string;
    developmentCautionZh: string;
    amazonIdentityVerificationZh: string;
    unsupportedConclusionsZh: string[];
  };
}

interface SourcesOverview {
  sources: SourceItem[];
  counts?: {
    keywordSnapshots: number;
    keywordRows: number;
    chartSnapshots: number;
    products: number;
    signals: number;
    opportunities: number;
    alerts: number;
    safetyEvents: number;
  };
  gaps?: string[];
  scheduler?: {
    isRunning: boolean;
    pid?: number;
    startedAt?: string;
    lastHeartbeat?: string;
    sourcesDueCount: number;
    nextDueAt: string | null;
    activeSourcesCount: number;
  };
}

export async function loader({ request }: { request: Request }) {
  const [data, safetyEvents] = await Promise.all([
    marketGet<SourcesOverview>(request, "/api/market/overview").catch(() => null),
    marketGet<SafetyEventItem[]>(request, "/api/market/safety-events").catch(() => []),
  ]);
  return {
    sources: data?.sources ?? [],
    counts: data?.counts ?? null,
    gaps: data?.gaps ?? [],
    scheduler: data?.scheduler ?? null,
    safetyEvents: Array.isArray(safetyEvents) ? safetyEvents : [],
  };
}

export function meta() {
  return pageMeta({
    title: "自动来源管理与监控",
    description: "第四主线全自动市场数据来源状态、合规准入分级、运行周期与调度监控看板。",
    noindex: true,
    path: "/market/sources",
  });
}

const autoBadgeMap: Record<string, { label: string; tone: "ok" | "hot" | "amber" | "neutral" }> = {
  "authorized-periodic": { label: "已授权周期运行", tone: "ok" },
  "blocked-no-license": { label: "无授权阻断", tone: "hot" },
  "pending-credentials": { label: "资质待配置", tone: "amber" },
  "manual-import-only": { label: "仅人工历史（自动采集阻断）", tone: "neutral" },
};

export default function MarketSources() {
  const { sources, counts, gaps, scheduler, safetyEvents } = useLoaderData<typeof loader>();
  const [running, setRunning] = useState(false);
  const [runReport, setRunReport] = useState<{
    executed: number;
    skipped: number;
    results: Array<{ id: string; label: string; status: string; reason?: string }>;
  } | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const activePeriodic = sources.filter((s) => s.enabled && s.automation === "authorized-periodic");
  const blockedSources = sources.filter((s) => s.automation === "blocked-no-license");
  const pendingCreds = sources.filter((s) => s.automation === "pending-credentials");

  async function handleTriggerRun(forceAll = false) {
    setRunning(true);
    setRunReport(null);
    try {
      const res = await marketPost<any>("/api/market/scheduler/run-due", { forceAll });
      if (res.body) {
        setRunReport(res.body);
      }
    } catch (e: any) {
      alert("触发自动调度失败: " + (e?.message || e));
    } finally {
      setRunning(false);
    }
  }

  async function handleRevoke(sourceId: string) {
    if (!confirm(`确认撤销来源「${sourceId}」吗？撤销后将立即停止调度，下游派生信号将进入复核。`)) return;
    setRevokingId(sourceId);
    try {
      await marketPost("/api/market/sources/revoke", { id: sourceId, reason: "操作员在来源看板手动停用" });
      window.location.reload();
    } catch (e: any) {
      alert("撤销失败: " + (e?.message || e));
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/market", label: "市场信号" }} title="自动来源监控" />

      <header className="pb-2 pt-3 lg:pt-1">
        <h1 className="text-[22px] font-semibold leading-[1.3] text-ink">自动来源管理与调度看板</h1>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-3">
          第四主线采用 <strong className="text-ink">全自动无人值守情报管道</strong>：系统自动轮询获准来源、清洗沉淀多期历史并自动计算变化与预警。
          用户只需在看板查阅情报与决策，<strong className="text-accent">无需手工下载、整理或上传任何表格文件</strong>。
        </p>
      </header>

      {/* Top Action Bar & Health Overview */}
      <section className="mt-3 card p-3.5" aria-label="调度执行与操作">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[13px] font-semibold text-ink">全自动调度状态</h2>
              {scheduler?.isRunning ? (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-ok/10 text-ok border border-ok/30">
                  ● 后台调度器在线 {scheduler.pid ? `(PID ${scheduler.pid})` : ""}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber/10 text-amber border border-amber/30">
                  ○ 后台调度器未运行
                </span>
              )}
            </div>
            <p className="mt-1 text-[11.5px] text-ink-4">
              {scheduler?.isRunning
                ? "后台守护进程（radar-market）正在自主按周期轮询获准来源，无需保持浏览器打开，无需手动点击。"
                : "当前未检测到后台独立调度进程，任务仅在手动诊断时触发；可在本机运行 start market 启动后台自主守护。"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleTriggerRun(true)}
              disabled={running}
              className="btn btn-primary text-[12px] py-1.5 px-3 flex items-center gap-1.5"
            >
              {running ? "正在执行自动抓取与分析..." : "⚡ 立即触发到期自动采集与分析"}
            </button>
          </div>
        </div>

        {runReport && (
          <div className="mt-3 rounded bg-paper-2 border border-border p-3 text-[12px]">
            <div className="flex items-center justify-between font-semibold text-ink">
              <span>自动调度执行完成</span>
              <span className="font-mono text-[11px] text-ink-3">
                执行: {runReport.executed} / 跳过或阻断: {runReport.skipped}
              </span>
            </div>
            <ul className="mt-2 space-y-1 text-[11.5px]">
              {runReport.results.map((r) => (
                <li key={r.id} className="flex items-baseline justify-between border-b border-border/50 pb-1">
                  <span>
                    <strong className="text-ink">{r.label}</strong>:{" "}
                    <span className={r.status === "success" ? "text-ok" : r.status === "error" ? "text-hot" : "text-ink-4"}>
                      {r.status === "success" ? "✅ 采集与分析成功" : r.status === "error" ? "❌ 执行异常" : "⏸️ 安全阻断/跳过"}
                    </span>
                  </span>
                  {r.reason && <span className="text-[10.5px] text-ink-4 max-w-[260px] truncate">{r.reason}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 text-center">
          <div className="rounded bg-paper-2 p-2">
            <span className="block text-[11px] text-ink-3">注册来源总数</span>
            <span className="text-[16px] font-bold text-ink">{sources.length}</span>
            <span className="block text-[10.5px] text-ink-4">全生命周期纳管</span>
          </div>
          <div className="rounded bg-paper-2 p-2">
            <span className="block text-[11px] text-ok">已获准自动运行</span>
            <span className="text-[16px] font-bold text-ok">{activePeriodic.length}</span>
            <span className="block text-[10.5px] text-ink-4">官方开放 / 零费用</span>
          </div>
          <div className="rounded bg-paper-2 p-2">
            <span className="block text-[11px] text-hot">策略阻断守护</span>
            <span className="text-[16px] font-bold text-hot">{blockedSources.length}</span>
            <span className="block text-[10.5px] text-ink-4">反爬 / 未获授权</span>
          </div>
          <div className="rounded bg-paper-2 p-2">
            <span className="block text-[11px] text-amber">资质待办</span>
            <span className="text-[16px] font-bold text-amber">{pendingCreds.length}</span>
            <span className="block text-[10.5px] text-ink-4">需开发者账号</span>
          </div>
        </div>
      </section>

      {/* Local Data Recency & Accumulation Counters */}
      {counts && (
        <section className="card mt-3 p-3.5" aria-label="数据质量概览">
          <div className="flex items-baseline justify-between pb-1">
            <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">本地数据库历史观测蓄积</h2>
            <span className="text-[11px] text-ink-4">
              {counts.keywordSnapshots >= 2 ? "✅ 已建立多周期时序追踪" : "初始单期观测基线"}
            </span>
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4 text-center">
            <div className="rounded bg-paper-2 p-2">
              <span className="block text-[11px] text-ink-3">关键词多期快照</span>
              <span className="text-[16px] font-bold text-ink">{counts.keywordSnapshots} 期</span>
              <span className="block text-[10.5px] text-ink-4">{counts.keywordRows} 行关键词观测</span>
            </div>
            <div className="rounded bg-paper-2 p-2">
              <span className="block text-[11px] text-ink-3">商品观测与榜单</span>
              <span className="text-[16px] font-bold text-ink">{counts.chartSnapshots} 期</span>
              <span className="block text-[10.5px] text-ink-4">{counts.products} 个 ASIN 档案</span>
            </div>
            <div className="rounded bg-paper-2 p-2">
              <span className="block text-[11px] text-ink-3">自动市场变化信号</span>
              <span className="text-[16px] font-bold text-ink">{counts.signals} 条</span>
              <span className="block text-[10.5px] text-ink-4">确定性规则匹配</span>
            </div>
            <div className="rounded bg-paper-2 p-2">
              <span className="block text-[11px] text-ok">CPSC 安全风险事件</span>
              <span className="text-[16px] font-bold text-ok">{counts.safetyEvents ?? safetyEvents.length} 起</span>
              <span className="block text-[10.5px] text-ink-4">官方召回反证线索</span>
            </div>
          </div>
        </section>
      )}

      {/* CPSC Product Safety Events List */}
      {safetyEvents.length > 0 && (
        <section className="card mt-4 p-3.5" aria-label="产品安全风险事件">
          <div className="flex flex-wrap items-baseline justify-between gap-1 pb-1">
            <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink">
              CPSC 官方公开产品安全召回通报（模块 09 · 创新与安全反证）
            </h2>
            <span className="text-[11px] text-ok font-medium">已入库 {safetyEvents.length} 起官方通报</span>
          </div>
          <div className="mt-1 text-[11.5px] text-ink-4 rounded bg-paper-2 p-2.5">
            <strong>【反证与避坑边界说明】</strong> 此通告由美国 CPSC 官方公开数据流自动获取并清洗。
            <strong>CPSC 召回的产品不等于特定 Amazon ASIN</strong>；目前未与在售商品建立直接身份映射，仅作为品类缺陷反证、强制标准参考与防呆结构优化线索，
            <span className="text-hot font-medium">严禁推断为需求暴利商机</span>。
          </div>

          <div className="mt-3 space-y-2.5">
            {safetyEvents.slice(0, 10).map((evt) => (
              <div key={evt.id} className="rounded border border-border p-3 text-[12px] bg-paper">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 rounded text-[10.5px] font-medium bg-hot/10 text-hot border border-hot/20">
                      {evt.hazardType}
                    </span>
                    <a
                      href={evt.officialUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-semibold text-ink hover:underline"
                    >
                      {evt.recallTitle}
                    </a>
                  </div>
                  <span className="text-[11px] font-mono text-ink-4">
                    官方通报: {evt.sourcePublishedAt.slice(0, 10)}
                  </span>
                </div>

                <div className="mt-2 grid grid-cols-1 gap-1 text-[11.5px] text-ink-3 sm:grid-cols-2">
                  <div>
                    <span className="text-ink-4">涉及品类推断：</span>
                    <span className="text-ink font-medium">{evt.categoryCandidate.normalizedCategoryZh}</span>
                    <span className="text-[10px] text-ink-4">（非官方 Browse Node ID）</span>
                  </div>
                  <div>
                    <span className="text-ink-4">安全缺陷分析：</span>
                    <span className="text-ink-2">{evt.hazardDescriptionZh}</span>
                  </div>
                </div>

                <div className="mt-2 text-[11px] text-ink-3 rounded bg-paper-2 p-2 leading-relaxed space-y-1">
                  <p><strong>避坑与研发提醒：</strong>{evt.explanation.developmentCautionZh}</p>
                  <p className="text-ink-4"><strong>身份核实：</strong>{evt.explanation.amazonIdentityVerificationZh}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Source Matrix Cards */}
      <section className="mt-4" aria-label="来源台账">
        <div className="flex items-baseline justify-between pb-1">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">
            已纳管来源台账与准入状态（L1~L5 分级守护）
          </h2>
          <span className="text-[11px] text-ink-4">零未经授权的隐蔽爬虫 · 零伪装自动化</span>
        </div>

        <div className="mt-2 space-y-2">
          {sources.map((s) => {
            const autoInfo = autoBadgeMap[s.automation] || { label: s.automation, tone: "neutral" };
            return (
              <div key={s.id} className="card p-3 text-[12px]">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-ink text-[13px]">{s.label}</h3>
                    <Badge tone={autoInfo.tone}>{autoInfo.label}</Badge>
                    <span className="font-mono text-[10.5px] text-ink-4">证据等级: {s.evidence}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-ink-3 font-mono">市场: {s.marketplace}</span>
                    {s.enabled && s.automation === "authorized-periodic" && (
                      <button
                        onClick={() => handleRevoke(s.id)}
                        disabled={revokingId === s.id}
                        className="text-[11px] text-hot hover:underline"
                      >
                        {revokingId === s.id ? "正在撤权..." : "停用/撤销"}
                      </button>
                    )}
                  </div>
                </div>

                <div className="mt-2 grid grid-cols-1 gap-1 text-[11.5px] text-ink-3 sm:grid-cols-2">
                  <div>
                    <span className="text-ink-4">数据生产者：</span>
                    <span className="text-ink-2">{s.producer}</span>
                  </div>
                  <div>
                    <span className="text-ink-4">调度周期：</span>
                    <span className="text-ink-2 font-mono">
                      {s.cadenceHours ? `每 ${s.cadenceHours} 小时` : "未启用周期调度"}
                    </span>
                  </div>
                  <div>
                    <span className="text-ink-4">已获准用途：</span>
                    <span className="text-ink-2 font-mono">
                      {s.uses.length ? s.uses.join(", ") : "无（全部用途拒绝）"}
                    </span>
                  </div>
                  <div>
                    <span className="text-ink-4">未获准用途：</span>
                    <span className="text-hot font-mono">
                      {s.unverifiedUses?.length ? s.unverifiedUses.join(", ") : "无（无未授权用途）"}
                    </span>
                  </div>
                  {s.lastRunAt && (
                    <div>
                      <span className="text-ink-4">最近执行时间：</span>
                      <span className="text-ink-2 font-mono">{s.lastRunAt.slice(0, 19).replace("T", " ")}</span>
                      {s.runCount ? <span className="text-ink-4">（已跑 {s.runCount} 次）</span> : null}
                    </div>
                  )}
                  {s.nextRunAt && (
                    <div>
                      <span className="text-ink-4">下一次计划时间：</span>
                      <span className="text-ink-2 font-mono">{s.nextRunAt.slice(0, 19).replace("T", " ")}</span>
                    </div>
                  )}
                </div>

                <div className="mt-2 rounded bg-paper-2 p-2 text-[11px] text-ink-3 leading-relaxed">
                  <p><strong className="text-ink-2">许可与授权依据：</strong>{s.permissionBasis}</p>
                  {s.notes && <p className="mt-1 text-ink-4"><strong className="text-ink-2">备注说明：</strong>{s.notes}</p>}
                  {s.lastError && (
                    <p className="mt-1 text-hot font-mono"><strong className="text-hot">最近执行错误：</strong>{s.lastError}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Honest Gaps and Governance Constraints */}
      <section className="mt-4 card p-3.5 text-[12px]" aria-label="数据缺口与合规守则">
        <h2 className="font-semibold text-ink">全自动市场情报守则与边界说明</h2>
        <ul className="mt-2 list-disc pl-5 space-y-1 text-ink-3 text-[11.5px]">
          <li><strong>零伪造自动化</strong>：对于未开放公开数据接口或声明反爬的站点（如 Amazon 榜单、AMZ123），系统坚持安全阻断，不使用无头浏览器伪装请求。</li>
          <li><strong>真实官方开放数据优先</strong>：CPSC 官方公开产品召回数据流属于美国联邦政府公共领域开放数据，完全合法免费，已实现全自动日度采集与安全反证提炼。</li>
          <li><strong>费用铁律</strong>：全流程外部采购与 API 费用严格为 ¥0，不向任何收费中间件或未授权爬虫服务外发账单。</li>
          <li><strong>电脑开机即恢复</strong>：电脑关机时任务休眠；再次开机启动时系统自动感知到期任务并补跑单次窗口，绝不发起积压请求风暴。</li>
        </ul>
      </section>
    </div>
  );
}
