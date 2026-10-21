import type { AdminRadarMonitor } from "@aihot/contracts/admin";
import { audit } from "../audit.ts";
import { sql, type Db } from "../db.ts";

const SETTING_KEY = "radar.keyword-monitors";
const MAX_MONITORS = 30;

async function readMonitors(db: Db = sql): Promise<AdminRadarMonitor[]> {
  const [row] = await db<{ value: { monitors?: AdminRadarMonitor[] } }[]>`SELECT value FROM settings WHERE key = ${SETTING_KEY}`;
  const monitors = row?.value?.monitors;
  if (!Array.isArray(monitors)) return [];
  return monitors.filter((item) => item && typeof item.id === "string" && typeof item.name === "string" && typeof item.query === "string" && typeof item.createdAt === "string");
}

export function normalizeRadarMonitor(input: { name?: unknown; query?: unknown }): { name: string; query: string } {
  const name = typeof input.name === "string" ? input.name.trim().slice(0, 60) : "";
  const query = typeof input.query === "string" ? input.query.trim().replace(/\s+/g, " ").slice(0, 120) : "";
  if (!name) throw Object.assign(new Error("监控名称不能为空"), { statusCode: 400 });
  if (!query) throw Object.assign(new Error("关键词不能为空"), { statusCode: 400 });
  return { name, query };
}

export async function listRadarMonitors(): Promise<AdminRadarMonitor[]> {
  return readMonitors();
}

export async function createRadarMonitor(input: { name?: unknown; query?: unknown }, actor: string, requestId?: string): Promise<AdminRadarMonitor> {
  const normalized = normalizeRadarMonitor(input);
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${SETTING_KEY}))`;
    const before = await readMonitors(tx);
    if (before.length >= MAX_MONITORS) throw Object.assign(new Error(`最多保存 ${MAX_MONITORS} 个关键词监控`), { statusCode: 400 });
    if (before.some((monitor) => monitor.query.toLocaleLowerCase() === normalized.query.toLocaleLowerCase())) {
      throw Object.assign(new Error("这个关键词已保存"), { statusCode: 400 });
    }
    const monitor: AdminRadarMonitor = { id: crypto.randomUUID(), ...normalized, createdAt: new Date().toISOString() as AdminRadarMonitor["createdAt"] };
    const after = [monitor, ...before];
    await tx`INSERT INTO settings (key, value, updated_by) VALUES (${SETTING_KEY}, ${tx.json({ monitors: after } as never)}, ${actor})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    await audit(actor, "radar.monitor.create", `radar-monitor:${monitor.id}`, null, null, monitor, { requestId, db: tx });
    return monitor;
  });
}

export async function deleteRadarMonitor(id: string, actor: string, requestId?: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${SETTING_KEY}))`;
    const before = await readMonitors(tx);
    const removed = before.find((monitor) => monitor.id === id);
    if (!removed) return false;
    const after = before.filter((monitor) => monitor.id !== id);
    await tx`INSERT INTO settings (key, value, updated_by) VALUES (${SETTING_KEY}, ${tx.json({ monitors: after } as never)}, ${actor})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`;
    await audit(actor, "radar.monitor.delete", `radar-monitor:${id}`, null, removed, null, { requestId, db: tx });
    return true;
  });
}
