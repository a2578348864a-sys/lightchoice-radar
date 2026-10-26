import { Link, useLoaderData } from "react-router";
import { vocGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { WorkspaceAuthGate } from "../components/shell/WorkspaceAuthGate";
import { EmptyState } from "../components/ui/Page";
import { relativeTime } from "../lib/format";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "痛点研究" };

interface PainsResponse {
  stories: Array<{ id: number; title: string; frame: Record<string, string>; facts: number; articles: number; latestAt: string | null }>;
}

export async function loader({ request }: { request: Request }) {
  const result = await vocGet<PainsResponse>(request, "/api/voc/pains");
  return { result };
}

export function meta() {
  return pageMeta({ title: "痛点研究", description: "消费者原声痛点主题、证据与需求假设。", noindex: true, path: "/voc/research" });
}

export default function VocResearch() {
  const { result } = useLoaderData<typeof loader>();
  const data = result.data;
  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/voc", label: "消费者原声" }} title="痛点研究" />
      <nav aria-label="面包屑导航" className="hidden lg:flex items-center gap-1.5 text-[12px] text-ink-4 pb-2">
        <Link to="/voc" className="hover:text-ink transition-colors">第三主线 · 消费者原声</Link>
        <span>/</span>
        <span className="text-ink-2 font-medium">痛点研究</span>
      </nav>
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">痛点研究 · 需求机会</h1>
        <p className="mt-1.5 text-[13px] text-ink-3">
          痛点主题按「产品 × 场景 × 问题类别」确定性归并；每条关联证据保留原文与解决状态。
          <strong className="font-semibold text-ink-2">需求假设均为候选</strong>，未经人工确认不构成已证实市场机会。
        </p>
      </header>

      <WorkspaceAuthGate error={result.error} laneName="消费者原声痛点研究" returnTo="/voc/research">

      {!data || data.stories.length === 0 ? (
        <EmptyState title="暂无痛点主题">证据材料入库并执行归并后，痛点主题会出现在这里。</EmptyState>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {data.stories.map((story) => (
            <li key={story.id} className="py-3.5">
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
                <span>{story.frame.product ?? "未知型号"}</span>
                <span>·</span>
                <span>{story.frame.scenario ?? "通用"}</span>
                <span>·</span>
                <span>最近进展 {story.latestAt ? relativeTime(story.latestAt) : "—"}</span>
              </div>
              <h2 className="mt-1 text-[15px] font-medium leading-snug text-ink">{story.title}</h2>
              <p className="mt-1 text-[12px] text-ink-4">证据 {story.facts} 条 · 关联材料 {story.articles} 篇</p>
            </li>
          ))}
        </ul>
      )}

      <section className="mt-5 rounded bg-paper-2 px-3 py-2.5" aria-label="需求假设状态">
        <h2 className="text-[12px] font-semibold uppercase tracking-wide text-ink-3">需求假设（L3）</h2>
        <p className="mt-1 text-[12px] text-ink-2">第三主线模型通道当前关闭（¥0 授权）：L3 需求假设生成入口保持关闭。痛点主题的确定性归并可先于 L3 运行；候选假设出现前，本区如实为空。</p>
      </section>

      <p className="mt-4 text-[11px] text-ink-2">「未找到反证」不等于证明反证不存在；解决状态以提问者自述为准。<Link to="/voc/evidence" className="ml-1 underline-offset-2 hover:underline">查看证据库</Link></p>
      </WorkspaceAuthGate>
    </div>
  );
}
