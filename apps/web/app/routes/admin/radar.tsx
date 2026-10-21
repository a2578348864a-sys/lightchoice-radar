import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import type { Route } from "./+types/radar";
import type { AdminRadarMonitor } from "@aihot/contracts/admin";
import { SITE } from "@aihot/site";
import { adminGet } from "../../lib/admin.server";
import { useAdminAction } from "../../features/admin/action";
import { AdminPage, Button, Card, Input } from "../../features/admin/ui";

export async function loader({ request }: Route.LoaderArgs) {
  return adminGet<{ monitors: AdminRadarMonitor[] }>(request, "/api/admin/radar/monitors");
}

export const meta: Route.MetaFunction = () => [{ title: `关键词监控 · ${SITE.name} 后台` }];

function monitorPath(query: string) {
  return `/all?${new URLSearchParams({ q: query })}`;
}

export default function RadarMonitorsAdmin({ loaderData }: Route.ComponentProps) {
  const { monitors } = loaderData;
  const { run, pending } = useAdminAction();
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = await run("POST", "/api/admin/radar/monitors", { name, query }, { label: "radar-monitor-create", success: "关键词监控已保存" });
    if (result) { setName(""); setQuery(""); }
  };

  return (
    <AdminPage title="关键词监控" subtitle="保存关键词后，新收录内容会持续按同一搜索规则匹配。这里只做线索监控，不自动推送市场结论。">
      <Card title="添加监控">
        <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1.4fr_auto] sm:items-end">
          <label className="block text-[12px] text-ink-3">监控名称<Input className="mt-1 w-full" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：智能门锁故障反馈" /></label>
          <label className="block text-[12px] text-ink-3">关键词或短语<Input className="mt-1 w-full" maxLength={120} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="例如：smart lock battery" /></label>
          <Button type="submit" tone="primary" busy={pending === "radar-monitor-create"} disabled={!name.trim() || !query.trim()}>保存监控</Button>
        </form>
        <p className="mt-2 text-[12px] text-ink-4">搜索逻辑与情报列表一致，多个空格分隔的词按同时命中处理；最多保存 30 条。</p>
      </Card>

      <Card className="mt-5" title={`已保存 · ${monitors.length}`}>
        {monitors.length ? <ul className="divide-y divide-line">
          {monitors.map((monitor) => (
            <li key={monitor.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <div className="font-medium text-ink">{monitor.name}</div>
                <div className="mt-0.5 break-all font-mono text-[12px] text-ink-3">{monitor.query}</div>
              </div>
              <div className="flex items-center gap-3">
                <Link className="text-[13px] font-medium text-accent hover:underline" to={monitorPath(monitor.query)}>查看匹配情报 →</Link>
                <Button size="sm" tone="danger" busy={pending === `radar-monitor-${monitor.id}`} onClick={() => void run("DELETE", `/api/admin/radar/monitors/${encodeURIComponent(monitor.id)}`, undefined, { label: `radar-monitor-${monitor.id}`, success: "监控已删除" })}>删除</Button>
              </div>
            </li>
          ))}
        </ul> : <p className="text-[13px] text-ink-4">还没有保存监控词。保存后可从这里直接打开匹配结果。</p>}
      </Card>
    </AdminPage>
  );
}
