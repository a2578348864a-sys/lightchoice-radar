import { Link, useLoaderData } from "react-router";
import { marketGet } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { PhoneBar } from "../components/shell/PhoneBar";
import { Badge } from "../components/ui/Badge";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { name: "市场来源" };

interface SourcesResponse {
  sources: Array<{ id: string; label: string; producer: string; enabled: boolean; automation: string; uses: string[]; evidence: string; notes?: string; unverifiedUses?: string[]; revokedAt?: string; revokeReason?: string; permissionBasis: string }>;
}

interface OverviewWithSources extends SourcesResponse { modules: unknown[] }

export async function loader({ request }: { request: Request }) {
  const data = await marketGet<OverviewWithSources>(request, "/api/market/overview").catch(() => null);
  return { sources: data?.sources ?? null };
}

export function meta() {
  return pageMeta({ title: "市场来源", description: "第四主线来源注册、许可与自动化状态。", noindex: true, path: "/market/sources" });
}

const autoZh: Record<string, string> = {
  "manual-import-only": "仅人工导入（自动化未授权）", "authorized-periodic": "已授权周期采集", "blocked-no-license": "无许可（阻断）", "pending-credentials": "资格未取得",
};

export default function MarketSources() {
  const { sources } = useLoaderData<typeof loader>();
  return (
    <div className="pb-10">
      <PhoneBar back={{ to: "/market", label: "市场信号" }} title="市场来源" />
      <header className="pb-2 pt-3 lg:pt-1">
        <h1 className="text-[22px] font-semibold leading-[1.3] text-ink">来源管理（R2 状态机）</h1>
        <p className="mt-1 text-[12.5px] text-ink-3">每个来源按用途（发现/存储/计算/模型外发/展示/导出）独立授权；未授权用途的适配器直接拒绝。来源启用≠正式定时采集——定时任务未获授权不创建。</p>
      </header>

      {!sources ? (
        <p className="mt-4 rounded bg-paper-2 px-3 py-2 text-[12.5px] text-ink-2">服务不可用或需要管理员会话。首次使用请通过 API <code className="text-[11.5px]">POST /api/market/sources/seed</code> 注册 R0-DATA 已核实的来源。</p>
      ) : (
        <div className="mt-3 space-y-2">
          {sources.map((s) => (
            <section key={s.id} className="card p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[13.5px] font-semibold text-ink">{s.label}</h2>
                <Badge tone={s.revokedAt ? "hot" : s.enabled ? "ok" : "neutral"}>{s.revokedAt ? "已撤销" : s.enabled ? "已启用" : "未启用"}</Badge>
              </div>
              <p className="mt-0.5 text-[12px] text-ink-3">数据生产者：{s.producer}</p>
              <p className="mt-0.5 text-[11.5px] text-ink-4">授权依据：{s.permissionBasis}</p>
              <p className="mt-0.5 text-[12px] text-ink-3">自动化状态：{autoZh[s.automation] ?? s.automation} · 证据等级 {s.evidence}</p>
              <p className="mt-1 text-[11.5px] text-ink-4">已授权用途（操作员私有研究授权）：{s.uses.length ? s.uses.join(" / ") : "无（全部关闭）"}</p>
              {s.unverifiedUses?.length ? <p className="mt-1 rounded bg-amber-soft px-2 py-1 text-[11.5px] text-amber-ink">来源网站许可未核实（PERMISSION_UNVERIFIED）：{s.unverifiedUses.join(" / ")}——私有研究授权不升级为网站授权</p> : null}
              {s.revokedAt && <p className="mt-1 rounded bg-paper-2 px-2 py-1 text-[11.5px] text-warn">已于 {s.revokedAt.slice(0, 10)} 撤销：{s.revokeReason ?? "未注明"}——相关预警已失效、依赖机会进入待复核</p>}
              {s.notes && <p className="mt-1 text-[11.5px] text-ink-4">{s.notes}</p>}
            </section>
          ))}
          <p className="text-[11.5px] text-ink-4">导入入口：关键词快照 <code>POST /api/market/import/keywords</code>；榜单人工观察 <code>POST /api/market/import/chart</code>（均需管理员会话，且来源许可含 store+compute）。</p>
        </div>
      )}

      <nav className="mt-4 flex flex-wrap gap-1.5 text-[12px]">
        <Link to="/market" className="pill">← 返回总览</Link>
      </nav>
    </div>
  );
}
