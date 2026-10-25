import { Link, useLoaderData } from "react-router";
import { vocGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { Badge } from "../components/ui/Badge";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "消费者原声" };

interface VocOverview {
  studies: Array<{ id: string; name: string; status: string; terms: { category: string }; materials: number; pendingReview: number; painThemes: number }>;
  totals: { materials: number; revoked: number; chineseL1: number; chineseL2: number; modelLane: string };
}

export async function loader({ request }: { request: Request }) {
  const overview = await vocGet<VocOverview>(request, "/api/voc/overview").catch(() => null);
  return { overview };
}

export function meta() {
  return pageMeta({ title: "消费者原声", description: "以商品研究为中心的消费者原声私有研究工作台。", noindex: true, path: "/voc" });
}

export default function VocIndex() {
  const { overview } = useLoaderData<typeof loader>();
  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/", label: "情报" }} title="消费者原声" />
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 className="text-[24px] font-semibold leading-[1.3] text-ink">消费者原声</h1>
        <p className="mt-1.5 text-[13px] leading-relaxed text-ink-3">
          以商品与品类研究为中心的私有研究工作台：原始材料、讨论上下文、中文理解、痛点归并与人工审核。
          <strong className="font-semibold text-ink-2">研究内容默认私有</strong>，不进入公开情报池。
        </p>
      </header>

      <nav className="mt-2 flex flex-wrap gap-1.5 text-[12px]" aria-label="原声区域">
        <Link to="/voc/evidence" className="pill">反馈证据库</Link>
        <Link to="/voc/research" className="pill">痛点研究</Link>
        <Link to="/voc/system" className="pill">历史与来源</Link>
      </nav>

      {!overview ? (
        <p className="mt-4 rounded bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2">尚未定义研究任务或服务不可用。此页面为私有研究区，需要管理员会话。</p>
      ) : (
        <>
          <section className="mt-4" aria-label="研究概览">
            <h2 className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">研究概览</h2>
            <dl className="mt-1 grid grid-cols-2 gap-2 text-[12.5px] sm:grid-cols-3">
              <div className="card p-3"><dt className="text-ink-4">有效材料</dt><dd className="mt-0.5 text-[18px] font-semibold text-ink">{overview.totals.materials}</dd></div>
              <div className="card p-3"><dt className="text-ink-4">已撤销</dt><dd className="mt-0.5 text-[18px] font-semibold text-ink">{overview.totals.revoked}</dd></div>
              <div className="card p-3"><dt className="text-ink-4">痛点主题</dt><dd className="mt-0.5 text-[18px] font-semibold text-ink">{overview.studies.reduce((n, s) => n + s.painThemes, 0)}</dd></div>
            </dl>
          </section>

          <section className="mt-4" aria-label="中文处理状态">
            <h2 className="pb-1 text-[12px] font-semibold uppercase tracking-wide text-ink-3">中文处理</h2>
            <p className="mt-1 text-[12.5px] text-ink-2">
              L1 确定性分类 {overview.totals.chineseL1} 条 · L2 中文理解 {overview.totals.chineseL2} 条 ·
              模型通道 <Badge tone="neutral">{overview.totals.modelLane}</Badge>
            </p>
            <p className="mt-1 text-[11.5px] text-ink-4">第三主线当前模型费用授权为 ¥0：L2/L3 处理入口保持关闭，已有材料以 L1 规则分类与原文呈现，不伪造中文理解。</p>
          </section>

          {overview.studies.map((study) => (
            <section key={study.id} className="card mt-3 p-3" aria-label={`研究 ${study.name}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-[14px] font-semibold text-ink">{study.name}</h3>
                <span className="text-[11px] text-ink-4">{study.status}</span>
              </div>
              <p className="mt-1 text-[12px] text-ink-3">品类：{study.terms.category} · 材料 {study.materials} 条 · 待人工审核 {study.pendingReview} 条</p>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
