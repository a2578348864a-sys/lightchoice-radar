import { Link, useLoaderData, useSearchParams } from "react-router";
import { vocGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { WorkspaceAuthGate } from "../components/shell/WorkspaceAuthGate";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/Page";
import { fullDateTime } from "../lib/format";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "反馈证据库" };

interface EvidenceItem {
  id: string; title: string; url: string; publishedAt: string | null; sourceId: string;
  form: string; authorRole: string; market: string; l1Categories: string[]; l1Polarity: string;
  language: string; answerCount: number; resolution: string; batches: string[]; licensedUses: string[];
  reviewStatus: string; reviewNote: string | null; attribution: string | null; excerpt: string;
  contentLicense: string | null;
  thread?: { questionId: number; title: string; body: string; tags: string[]; answers: Array<{ id: number; score: number; isAccepted: boolean; body: string; contentLicense: string | null; comments: Array<{ id: number; body: string; contentLicense: string | null }> }>; comments: Array<{ id: number; body: string; contentLicense: string | null }>; askerFollowUp?: string; attribution: string };
}
interface EvidenceResponse { items: EvidenceItem[]; studies: Array<{ id: string; name: string }>; batches: Array<{ id: string; label: string; revokedAt?: string }> }

export async function loader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  for (const key of ["study", "category", "polarity", "q"]) if (url.searchParams.get(key)) params.set(key, url.searchParams.get(key)!);
  const result = await vocGet<EvidenceResponse>(request, `/api/voc/evidence?${params}`);
  return { result };
}

export function meta() {
  return pageMeta({ title: "反馈证据库", description: "消费者原声证据库：原文、上下文、许可与审核状态。", noindex: true, path: "/voc/evidence" });
}

function stripHtml(html: string | undefined | null): string {
  if (!html) return "";
  return html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, String.fromCharCode(34)).replace(/&#39;|&rsquo;/g, String.fromCharCode(39)).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

const RESOLUTION_LABEL: Record<string, string> = {
  "solved-candidate": "解决候选（提问者自述）",
  "unsolved-or-undetermined": "未解决或未知",
  undetermined: "未知（无后续）",
};

export default function VocEvidence() {
  const { result } = useLoaderData<typeof loader>();
  const data = result.data;
  const [params] = useSearchParams();
  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/voc", label: "消费者原声" }} title="反馈证据库" />
      <nav aria-label="面包屑导航" className="hidden lg:flex items-center gap-1.5 text-[12px] text-ink-4 pb-2">
        <Link to="/voc" className="hover:text-ink transition-colors">第三主线 · 消费者原声</Link>
        <span>/</span>
        <span className="text-ink-2 font-medium">反馈证据库</span>
      </nav>
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">反馈证据库</h1>
        <p className="mt-1.5 text-[13px] text-ink-3">原始材料与讨论上下文。每条带许可用途、独立性与审核状态；撤销材料不显示。</p>
      </header>

      <WorkspaceAuthGate error={result.error} laneName="消费者原声证据库" returnTo="/voc/evidence">

      <form method="get" action="/voc/evidence" className="mt-3 flex flex-wrap items-center gap-2 text-[12px]" aria-label="证据筛选">
        <select name="study" defaultValue={params.get("study") ?? ""} aria-label="研究任务" className="rounded border border-line bg-paper px-2 py-1 text-[12px]">
          <option value="">全部研究</option>
          {(data?.studies ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select name="polarity" defaultValue={params.get("polarity") ?? ""} aria-label="极性" className="rounded border border-line bg-paper px-2 py-1 text-[12px]">
          <option value="">全部极性</option>
          {["positive", "negative", "neutral", "mixed"].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <input type="search" name="q" defaultValue={params.get("q") ?? ""} placeholder="标题关键词…" aria-label="搜索" className="min-w-40 flex-1 rounded border border-line bg-paper px-2 py-1 text-[12px]" />
        <button type="submit" className="rounded bg-accent px-3 py-1 font-medium text-paper">筛选</button>
      </form>

      {!data || data.items.length === 0 ? (
        <EmptyState title="暂无证据材料">尚未导入或采集任何材料，或筛选范围内为空。导入需通过授权批次进行。</EmptyState>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {data.items.map((item) => (
            <li key={item.id} className="py-3.5">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
                <Badge tone={item.reviewStatus === "confirmed" ? "ok" : item.reviewStatus === "rejected" ? "neutral" : "amber"}>{item.reviewStatus}</Badge>
                {!item.contentLicense ? <Badge tone="neutral">许可待核实</Badge> : null}
                <span>{item.sourceId}</span>
                <span>·</span>
                <span>{item.publishedAt ? fullDateTime(item.publishedAt) : "日期未知"}</span>
                <span>·</span>
                <span>角色 {item.authorRole} · 市场 {item.market}</span>
              </div>
              <h2 className="mt-1 text-[15px] font-medium leading-snug text-ink">{item.title}</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-ink-2">{item.excerpt.slice(0, 200)}…</p>
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink-4">
                <span>L1：{item.l1Categories.join("、") || "未归类"} · {item.l1Polarity}</span>
                <span>回答 {item.answerCount} · {RESOLUTION_LABEL[item.resolution] ?? item.resolution}</span>
                <span>许可：{item.licensedUses.join("/") || "无"}</span>
              </div>
              {item.attribution ? <p className="mt-1 text-[11px] text-ink-4">{item.attribution}</p> : null}
              {item.thread ? (
                <details className="mt-2">
                  <summary className="cursor-pointer text-[12px] text-accent">展开讨论上下文（{item.thread.answers.length} 回答 · {item.thread.comments.length + item.thread.answers.reduce((n, a) => n + a.comments.length, 0)} 评论）</summary>
                  <div className="mt-2 space-y-3 rounded bg-paper-2 p-3 text-[12.5px] leading-relaxed text-ink-2">
                    <div>
                      <p className="text-[11px] font-semibold uppercase text-ink-4">问题（{item.thread.attribution}）</p>
                      <p className="mt-1">{stripHtml(item.thread.body).slice(0, 600)}</p>
                    </div>
                    {item.thread.askerFollowUp ? <p><span className="font-medium text-ink-3">提问者后续：</span>{stripHtml(item.thread.askerFollowUp).slice(0, 300)}</p> : null}
                    {item.thread.answers.map((a) => (
                      <div key={a.id} className="border-l-2 border-line pl-3">
                        <p className="text-[11px] text-ink-4">回答 · {a.score} 票{a.isAccepted ? " · 提问者采纳" : ""} · {a.contentLicense ?? "许可待核实"}</p>
                        <p className="mt-0.5">{stripHtml(a.body).slice(0, 500)}</p>
                        {a.comments.map((c) => <p key={c.id} className="mt-1 text-[11.5px] text-ink-3">↳ {stripHtml(c.body).slice(0, 200)}{c.contentLicense ? "" : "（许可待核实）"}</p>)}
                      </div>
                    ))}
                    <p className="text-[11px] text-ink-4">内容许可见记录字段；展示附署名与原文链接（CC BY-SA 条件）。原文链接：{item.url}</p>
                  </div>
                </details>
              ) : null}
              <a href={item.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[12px] text-accent underline-offset-2 hover:underline">查看原文</a>
            </li>
          ))}
        </ul>
        )}
      </WorkspaceAuthGate>
      <p className="mt-6 text-[11px] text-ink-2">
        记录数不等于独立消费者人数；同一讨论串作为一个整体材料保留。授权导入入口与管理操作通过 API 受管理员会话保护。
        <Link to="/voc" className="ml-1 underline-offset-2 hover:underline">返回总览</Link>
      </p>
    </div>
  );
}
