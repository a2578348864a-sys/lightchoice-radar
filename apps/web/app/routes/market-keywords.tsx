import { Form, Link, useLoaderData, useSearchParams } from "react-router";
import { marketGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "搜索需求" };

interface KeywordsResponse {
  latest: { sourceId: string; producer: string; periodStart: string; periodEnd: string; secondaryDisplay: boolean; sourceUpdatedAt: string | null; observedAt: string } | null;
  rows: Array<{ keyword: string; thisWeek: number; lastWeek: number | null; positionsMoved: number | null; direction: string; noteZh: string }>;
  total: number;
  noteZh: string;
}

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const qs = new URLSearchParams();
  if (url.searchParams.get("direction")) qs.set("direction", url.searchParams.get("direction")!);
  if (url.searchParams.get("q")) qs.set("q", url.searchParams.get("q")!);
  const data = await marketGet<KeywordsResponse>(request, `/api/market/keywords${qs.size ? `?${qs}` : ""}`).catch(() => null);
  return { data };
}

export function meta() {
  return pageMeta({ title: "搜索需求", description: "Amazon 美国站关键词排名与需求变化研究。", noindex: true, path: "/market/keywords" });
}

const dirZh: Record<string, string> = { up: "↑ 上升", down: "↓ 下降", flat: "→ 持平", unknown: "— 上周缺" };

export default function MarketKeywords() {
  const { data } = useLoaderData<typeof loader>();
  const [params] = useSearchParams();
  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/market", label: "市场信号" }} title="搜索需求" />
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 className="text-[22px] font-semibold leading-[1.3] text-ink">搜索需求（模块 01/07/10）</h1>
        <p className="mt-1 text-[12.5px] text-ink-3">关键词排名与两周变化。排名前进<strong>不等于</strong>搜索量或需求增长百分比。</p>
      </header>

      <Form method="get" className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px]">
        <input name="q" defaultValue={params.get("q") ?? ""} placeholder="搜索关键词…" className="min-w-40 flex-1 rounded border border-line bg-paper px-2 py-1 text-[12px] text-ink placeholder:text-ink-2" aria-label="关键词搜索" />
        <select name="direction" defaultValue={params.get("direction") ?? ""} className="rounded border border-line bg-paper px-2 py-1 text-[12px] text-ink" aria-label="方向筛选">
          <option value="">全部方向</option>
          <option value="up">仅上升</option>
          <option value="down">仅下降</option>
        </select>
        <button type="submit" className="rounded bg-accent px-3 py-1 font-medium text-paper">筛选</button>
      </Form>

      {!data?.latest ? (
        <p className="mt-4 rounded bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2">{data ? data.noteZh : "服务不可用或需要管理员会话。关键词数据需先经获准导入（来源页）。"}</p>
      ) : (
        <>
          <section className="mt-3 text-[12px] text-ink-3" aria-label="数据来源说明">
            <p>来源：{data.latest.producer}（二手展示）；数据周期 {data.latest.periodStart} ~ {data.latest.periodEnd}；来源更新 {data.latest.sourceUpdatedAt?.slice(0, 10) ?? "未标注"}；本系统取得 {data.latest.observedAt.slice(0, 10)}。</p>
            <p className="mt-0.5 text-ink-4">{data.noteZh}。共 {data.total} 条{data.rows.length < data.total ? `（展示前 ${data.rows.length} 条）` : ""}。</p>
          </section>
          <div className="card mt-2 overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-ink-4">
                  <th className="px-3 py-2">搜索词</th>
                  <th className="px-2 py-2">本周排名</th>
                  <th className="px-2 py-2">上周排名</th>
                  <th className="px-2 py-2">位移</th>
                  <th className="px-3 py-2">方向</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.keyword} className="border-b border-line/60 last:border-0">
                    <td className="px-3 py-1.5 font-medium text-ink">{r.keyword}</td>
                    <td className="px-2 py-1.5 text-ink-2">{r.thisWeek}</td>
                    <td className="px-2 py-1.5 text-ink-2">{r.lastWeek ?? "缺失"}</td>
                    <td className="px-2 py-1.5 text-ink-2">{r.positionsMoved ?? "—"}</td>
                    <td className="px-3 py-1.5">
                      <span className={r.direction === "up" ? "text-ok" : r.direction === "down" ? "text-warn" : "text-ink-4"}>{dirZh[r.direction]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11.5px] text-ink-4">缺失=MISSING（不内插）；「涨跌幅度」为绝对位移，方向由两周排名推导。多周趋势与季节性判断见总览页模块 07 状态。</p>
          <nav className="mt-3 flex flex-wrap gap-1.5 text-[12px]">
            <Link to="/market/opportunities" className="pill">从上升词生成机会候选 →</Link>
          </nav>
        </>
      )}
    </div>
  );
}
