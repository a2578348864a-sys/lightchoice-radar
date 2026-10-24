import { Link, useLoaderData } from "react-router";
import type { IndustryDetail } from "@aihot/contracts/site";
import { apiGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { fullDateTime } from "../lib/format";
import { Badge } from "../components/ui/Badge";
import { IconExternal } from "../components/icons";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "行业详情" };

export async function loader({ request, params }: { request: Request; params: { id: string } }) {
  const item = await apiGet<IndustryDetail>(`/api/site/industry/${encodeURIComponent(params.id)}`, { signal: request.signal });
  return { item };
}

export function meta() {
  return pageMeta({ title: "行业详情", description: "行业动态详情：来源、事件关系与中文说明。", noindex: true, path: "/industry" });
}

export default function IndustryDetailPage() {
  const { item } = useLoaderData<typeof loader>();
  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <p className="mt-6 text-[12px] text-ink-2"><Link to="/industry" className="underline-offset-2 hover:underline">← 行业动态</Link></p>
      <header className="mt-2">
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
          <span>{item.sourceName}</span>
          <span>·</span>
          <span>{item.publishedAt ? fullDateTime(item.publishedAt) : "日期未标注"}</span>
          {item.modelProcessing ? <Badge tone="amber">机器处理 · 未经人工核对</Badge> : <Badge tone="neutral">仅元数据来源</Badge>}
        </div>
        <h1 className="mt-2 text-xl font-semibold leading-snug text-ink">{item.zhTitle ?? item.title}</h1>
        {item.zhTitle ? <p className="mt-1 text-[13px] text-ink-2">原文标题：{item.title}</p> : null}
        <a href={item.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[13px] text-accent underline-offset-2 hover:underline">
          阅读原文 <IconExternal />
        </a>
      </header>

      {item.excerpt ? (
        <section className="mt-5" aria-label="来源摘要">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-2">来源摘要</h2>
          <p className="mt-1 text-[14px] leading-relaxed text-ink">{item.excerpt}</p>
        </section>
      ) : (
        <p className="mt-5 rounded bg-paper-2 px-3 py-2 text-[12px] text-ink-2">该来源为限制准入：仅保存标题、链接与日期（出版方条款未授权保存摘要文本），分类由规则完成。</p>
      )}

      {item.story ? (
        <section className="mt-5" aria-label="事件">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-2">所属事件</h2>
          <p className="mt-1 text-[14px] text-ink">{item.story.title}</p>
          {item.story.latest ? <p className="mt-1 text-[13px] leading-relaxed text-ink-2">{item.story.latest}</p> : null}
          <p className="mt-1 text-[12px] text-ink-2">{item.story.articleCount} 篇来源 · 证据版本 {item.story.digestVersion ?? 0}（版本化保留，修订不静默覆盖）</p>
        </section>
      ) : null}

      {item.digestVersions.length > 0 ? (
        <section className="mt-5" aria-label="证据版本">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-2">行业说明（按版本）</h2>
          <ol className="mt-2 space-y-2">
            {[...item.digestVersions].reverse().map((d) => (
              <li key={d.version} className="rounded border border-line px-3 py-2 text-[13px] leading-relaxed text-ink">
                <span className="text-[11px] text-ink-2">版本 {d.version} · {fullDateTime(d.createdAt)}{d.receiptId ? ` · 回执 #${d.receiptId}` : ""}</span>
                <p className="mt-1 whitespace-pre-line">{d.digest}</p>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {item.siblings.length > 0 ? (
        <section className="mt-5" aria-label="同一事件的其他报道">
          <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-2">同一事件的其他报道（{item.siblings.length}）</h2>
          <ul className="mt-2 space-y-1 text-[13px]">
            {item.siblings.map((s) => (
              <li key={s.id}>
                <Link to={`/industry/${s.id}`} className="text-accent underline-offset-2 hover:underline">{s.zhTitle ?? s.title}</Link>
                <span className="ml-2 text-[11px] text-ink-2">{s.sourceName.split("(")[0]}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="mt-8 text-[11px] text-ink-2">本页不提供投资、选品或采购建议；行业说明区分「来源明确陈述的事实」与「系统解释」，未验证的推断不作为结论。</p>
    </main>
  );
}
