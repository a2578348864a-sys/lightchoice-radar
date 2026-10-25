import { Form, Link, useLoaderData, useSearchParams } from "react-router";
import { useState } from "react";
import { marketGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { Badge } from "../components/ui/Badge";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "搜索需求" };

interface KeywordPeriodMeta {
  periodStart: string;
  periodEnd: string;
  sourceId: string;
  rowCount: number;
}

interface KeywordsResponse {
  latest: {
    sourceId: string;
    producer: string;
    periodStart: string;
    periodEnd: string;
    secondaryDisplay: boolean;
    sourceUpdatedAt: string | null;
    observedAt: string;
  } | null;
  availablePeriods: KeywordPeriodMeta[];
  rows: Array<{
    keyword: string;
    thisWeek: number;
    lastWeek: number | null;
    positionsMoved: number | null;
    direction: string;
    noteZh: string;
  }>;
  total: number;
  noteZh: string;
}

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const qs = new URLSearchParams();
  if (url.searchParams.get("direction")) qs.set("direction", url.searchParams.get("direction")!);
  if (url.searchParams.get("q")) qs.set("q", url.searchParams.get("q")!);
  if (url.searchParams.get("periodStart")) qs.set("periodStart", url.searchParams.get("periodStart")!);
  const data = await marketGet<KeywordsResponse>(request, `/api/market/keywords${qs.size ? `?${qs}` : ""}`).catch(() => null);
  return { data };
}

export function meta() {
  return pageMeta({
    title: "搜索需求分析",
    description: "Amazon 美国站关键词多期排名、位移方向与多周趋势研究。",
    noindex: true,
    path: "/market/keywords",
  });
}

const dirZh: Record<string, string> = {
  up: "↑ 上升",
  down: "↓ 下降",
  flat: "→ 持平",
  unknown: "— 上周缺",
};

interface KeywordHistoryPoint {
  periodStart: string;
  periodEnd: string;
  rankThisWeek: number;
  rankLastWeek: number | null;
  positionsMoved: number | null;
  direction: string;
}

interface KeywordHistoryData {
  keyword: string;
  totalPeriods: number;
  points: KeywordHistoryPoint[];
  trend: string;
  trendZh: string;
  bestRank: number | null;
  worstRank: number | null;
  latestRank: number | null;
  comparable: boolean;
  reasonZh: string;
}

export default function MarketKeywords() {
  const { data } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();

  // Keyword detail drilldown state
  const [selectedKw, setSelectedKw] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyData, setHistoryData] = useState<KeywordHistoryData | null>(null);

  const openDrilldown = async (keyword: string) => {
    setSelectedKw(keyword);
    setHistoryLoading(true);
    setHistoryData(null);
    try {
      const res = await fetch(`/api/market/keywords/history?keyword=${encodeURIComponent(keyword)}`, {
        headers: { "Accept": "application/json" },
      });
      if (res.ok) {
        const json = await res.json();
        setHistoryData(json);
      }
    } catch {
      // Graceful fallback
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/market", label: "市场信号" }} title="搜索需求" />
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 className="text-[22px] font-semibold leading-[1.3] text-ink">搜索需求分析（模块 01/07/10）</h1>
        <p className="mt-1 text-[12.5px] text-ink-3">
          支持多期关键词快照对比与名次位移追踪。排名前进<strong>不等于</strong>搜索量增长百分比（C1 原则）。
        </p>
      </header>

      {/* Filter bar */}
      <Form method="get" className="mt-2.5 flex flex-wrap items-center gap-2 text-[12.5px]">
        <input
          name="q"
          defaultValue={params.get("q") ?? ""}
          placeholder="搜索关键词…"
          className="min-w-40 flex-1 rounded border border-line bg-paper px-2 py-1 text-[12px] text-ink placeholder:text-ink-2"
          aria-label="关键词搜索"
        />

        {data?.availablePeriods && data.availablePeriods.length > 0 && (
          <select
            name="periodStart"
            defaultValue={params.get("periodStart") ?? data.latest?.periodStart ?? ""}
            className="rounded border border-line bg-paper px-2 py-1 text-[12px] text-ink"
            aria-label="周期筛选"
          >
            {data.availablePeriods.map((p) => (
              <option key={p.periodStart} value={p.periodStart}>
                周期: {p.periodStart} ~ {p.periodEnd} ({p.rowCount} 词)
              </option>
            ))}
          </select>
        )}

        <select
          name="direction"
          defaultValue={params.get("direction") ?? ""}
          className="rounded border border-line bg-paper px-2 py-1 text-[12px] text-ink"
          aria-label="方向筛选"
        >
          <option value="">全部方向</option>
          <option value="up">仅上升 (↑)</option>
          <option value="down">仅下降 (↓)</option>
        </select>
        <button type="submit" className="rounded bg-accent px-3 py-1 font-medium text-paper">
          筛选
        </button>
      </Form>

      {!data?.latest ? (
        <div className="mt-4 rounded bg-paper-2 p-4 text-[12.5px] text-ink-2">
          <p className="font-semibold">{data ? data.noteZh : "服务不可用或需要管理员会话。"}</p>
          <p className="mt-1 text-[11.5px] text-ink-3">
            正式数据库尚未导入关键词快照。请前往「来源与数据导入」工作台上传 CSV 数据。
          </p>
          <Link to="/market/sources" className="pill mt-2 inline-block bg-paper text-[12px]">
            前往数据导入工作台 →
          </Link>
        </div>
      ) : (
        <>
          <section className="mt-3 flex flex-wrap items-baseline justify-between gap-2 text-[12px] text-ink-3" aria-label="数据来源说明">
            <div>
              <span>来源：{data.latest.producer} · 周期 {data.latest.periodStart} ~ {data.latest.periodEnd}</span>
              <span className="ml-2 text-ink-4">共 {data.total} 词（点击任意词可下钻多期历史）</span>
            </div>
            {data.availablePeriods.length > 1 && (
              <Badge tone="ok">已蓄积 {data.availablePeriods.length} 期历史快照</Badge>
            )}
          </section>

          {/* Table */}
          <div className="card mt-2 overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-4">
                  <th className="px-3 py-2">搜索关键词 (点击下钻历史)</th>
                  <th className="px-2 py-2">本期排名</th>
                  <th className="px-2 py-2">上期排名</th>
                  <th className="px-2 py-2">位移幅度</th>
                  <th className="px-3 py-2">方向</th>
                  <th className="px-2 py-2 text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr
                    key={r.keyword}
                    className="border-b border-line/60 last:border-0 hover:bg-paper-2 cursor-pointer"
                    onClick={() => openDrilldown(r.keyword)}
                  >
                    <td className="px-3 py-2 font-medium text-ink">
                      <span className="hover:underline">{r.keyword}</span>
                    </td>
                    <td className="px-2 py-2 font-mono text-ink-2">#{r.thisWeek}</td>
                    <td className="px-2 py-2 font-mono text-ink-3">{r.lastWeek ? `#${r.lastWeek}` : "缺失"}</td>
                    <td className="px-2 py-2 font-mono text-ink-2">
                      {r.positionsMoved != null ? `${r.positionsMoved > 0 ? "+" : ""}${r.positionsMoved}` : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={r.direction === "up" ? "text-ok font-medium" : r.direction === "down" ? "text-warn" : "text-ink-4"}>
                        {dirZh[r.direction] ?? r.direction}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <span className="text-[11px] text-accent">历史趋势 ↗</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-[11.5px] text-ink-4">
            规则依据：缺失=MISSING（严禁内插补零）；名次位移为两周排名之差（C1 冻结）。
          </p>

          <nav className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
            <Link to="/market/opportunities" className="pill">从上升词查看机会候选 →</Link>
            <Link to="/market/sources" className="pill">导入新周期数据 →</Link>
          </nav>
        </>
      )}

      {/* Multi-period Keyword History Modal / Drawer */}
      {selectedKw && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4 backdrop-blur-sm">
          <div className="card w-full max-w-xl max-h-[85vh] overflow-y-auto p-4 shadow-xl">
            <div className="flex items-start justify-between border-b border-line pb-2">
              <div>
                <h3 className="text-[15px] font-semibold text-ink">多期历史追踪：「{selectedKw}」</h3>
                <p className="mt-0.5 text-[11.5px] text-ink-4">
                  真实快照累积 · 排名数字越小代表名次越靠前
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedKw(null)}
                className="rounded p-1 text-ink-3 hover:bg-paper-2 hover:text-ink text-[14px]"
              >
                ✕
              </button>
            </div>

            {historyLoading ? (
              <p className="py-8 text-center text-[12.5px] text-ink-3">正在汇总多期快照数据…</p>
            ) : !historyData || historyData.points.length === 0 ? (
              <p className="py-6 text-center text-[12px] text-ink-3">暂无其他历史周期数据。</p>
            ) : (
              <div className="mt-3 space-y-3">
                {/* Stats Summary */}
                <div className="grid grid-cols-3 gap-2 text-center text-[12px]">
                  <div className="rounded bg-paper-2 p-2">
                    <span className="block text-[11px] text-ink-4">最新名次</span>
                    <span className="text-[15px] font-bold font-mono text-ink">
                      #{historyData.latestRank ?? "-"}
                    </span>
                  </div>
                  <div className="rounded bg-paper-2 p-2">
                    <span className="block text-[11px] text-ink-4">最佳观测名次</span>
                    <span className="text-[15px] font-bold font-mono text-ok">
                      #{historyData.bestRank ?? "-"}
                    </span>
                  </div>
                  <div className="rounded bg-paper-2 p-2">
                    <span className="block text-[11px] text-ink-4">累计观测</span>
                    <span className="text-[15px] font-bold font-mono text-ink">
                      {historyData.totalPeriods} 期
                    </span>
                  </div>
                </div>

                {/* Trend Note */}
                <div className="rounded bg-paper-2 px-3 py-2 text-[12px]">
                  <span className="font-semibold text-ink">趋势评定：</span>
                  <span className="text-ink-2 ml-1">{historyData.trendZh}</span>
                  <p className="mt-0.5 text-[11px] text-ink-4">{historyData.reasonZh}</p>
                </div>

                {/* Inverted Visual Rank Sparkline */}
                {historyData.points.length >= 2 && (
                  <div className="rounded border border-line p-3">
                    <div className="flex justify-between text-[11px] text-ink-4">
                      <span>名次走势（#1 在图表顶端）</span>
                      <span>{historyData.points.length} 个观测点</span>
                    </div>
                    {/* SVG Sparkline */}
                    <div className="mt-2 h-24 w-full">
                      <Sparkline points={historyData.points} />
                    </div>
                  </div>
                )}

                {/* Timeline Table */}
                <div className="overflow-x-auto rounded border border-line">
                  <table className="w-full text-left text-[11.5px]">
                    <thead className="bg-paper-2 text-ink-3">
                      <tr>
                        <th className="p-1.5">观测周期</th>
                        <th className="p-1.5">本期名次</th>
                        <th className="p-1.5">上期名次</th>
                        <th className="p-1.5">位移</th>
                        <th className="p-1.5">方向</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line text-ink">
                      {historyData.points.map((pt, i) => (
                        <tr key={i}>
                          <td className="p-1.5 font-mono">{pt.periodStart}</td>
                          <td className="p-1.5 font-mono font-medium">#{pt.rankThisWeek}</td>
                          <td className="p-1.5 font-mono text-ink-3">{pt.rankLastWeek ? `#${pt.rankLastWeek}` : "缺失"}</td>
                          <td className="p-1.5 font-mono">{pt.positionsMoved != null ? `${pt.positionsMoved > 0 ? "+" : ""}${pt.positionsMoved}` : "-"}</td>
                          <td className="p-1.5">
                            <span className={pt.direction === "up" ? "text-ok" : pt.direction === "down" ? "text-warn" : "text-ink-4"}>
                              {dirZh[pt.direction] ?? pt.direction}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    onClick={() => setSelectedKw(null)}
                    className="pill bg-paper px-3 py-1 text-[12px]"
                  >
                    关闭
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Pure SVG Sparkline with inverted Y-axis (#1 at top).
 */
function Sparkline({ points }: { points: KeywordHistoryPoint[] }) {
  if (points.length < 2) return null;
  const ranks = points.map((p) => p.rankThisWeek);
  const minRank = Math.min(...ranks);
  const maxRank = Math.max(...ranks);
  const range = maxRank - minRank || 1;

  const width = 400;
  const height = 80;
  const padding = 10;

  // Inverted: minRank (best) -> y = padding (top); maxRank (worst) -> y = height - padding (bottom)
  const coords = points.map((p, idx) => {
    const x = padding + (idx / (points.length - 1)) * (width - padding * 2);
    const normalized = (p.rankThisWeek - minRank) / range;
    const y = padding + normalized * (height - padding * 2);
    return { x, y, rank: p.rankThisWeek, date: p.periodStart };
  });

  const pathD = coords.reduce((acc, pt, idx) => (idx === 0 ? `M ${pt.x} ${pt.y}` : `${acc} L ${pt.x} ${pt.y}`), "");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full overflow-visible">
      {/* Guidelines */}
      <line x1={padding} y1={padding} x2={width - padding} y2={padding} stroke="currentColor" strokeOpacity={0.1} strokeDasharray="3 3" />
      <line x1={padding} y1={height - padding} x2={width - padding} y2={height - padding} stroke="currentColor" strokeOpacity={0.1} strokeDasharray="3 3" />
      {/* Trend line */}
      <path d={pathD} fill="none" stroke="currentColor" strokeWidth={2.5} className="text-accent" />
      {/* Data points */}
      {coords.map((pt, idx) => (
        <g key={idx}>
          <circle cx={pt.x} cy={pt.y} r={4} className="fill-paper stroke-accent" strokeWidth={2} />
          <text x={pt.x} y={pt.y - 6} textAnchor="middle" className="fill-ink text-[10px] font-mono">
            #{pt.rank}
          </text>
        </g>
      ))}
    </svg>
  );
}
