// Worker process: queues and schedules for collection, processing, events, reports and ops, and the site's
// modules (site/modules/server.ts).
//
// Two shapes:
//   • full worker (default): everything the engine registers, as before.
//   • scoped first-lane worker (`RADAR_WORKER_SCOPE=content`): only the analysis queue and the
//     discovery/translation timers, refusing material older than RADAR_ANALYZE_SINCE or outside
//     RADAR_ANALYZE_SOURCES. It takes the "radar-translate" instance role, writes a heartbeat and a run
//     record, and stops on the same request file the other workers use — so `radar-ops start|stop|status
//     translate` manages it like any other Radar service.
import { assertProductionSecrets } from "@aihot/backend/config";
import { closeDb } from "@aihot/backend/db";
import { getBoss, stopBoss, workModuleQueues } from "@aihot/backend/jobs/queue";
import { installModules } from "@aihot/backend/modules";
import { SERVER_MODULES } from "@aihot/site/modules/server";
import { registerContentJobs } from "@aihot/backend/jobs/content";
import { registerSourceJobs } from "@aihot/backend/jobs/sources";
import { registerEventJobs } from "@aihot/backend/jobs/events";
import { registerNotifyJobs } from "@aihot/backend/jobs/notify";
import { registerPublicationJobs } from "@aihot/backend/jobs/publication";
import { registerSchedules } from "./schedules.ts";
import { ensureContentTargets } from "@aihot/backend/notify/deliver";
import { startHeartbeat } from "@aihot/backend/operations/heartbeat";
import { clearControlState, clearStopRequest, startHeartbeat as startRoleHeartbeat, watchStopRequest, writeRunRecord } from "./control.ts";
import { releaseSingleInstance, requireSingleInstance } from "./instance-lock.ts";

installModules(SERVER_MODULES);
assertProductionSecrets([["auth", "IMG_PROXY_SIGN_SECRET"]]);

/**
 * A bounded first-lane run: only the content analysis queue and the discovery/translation timers are
 * registered, and the analysis queue refuses material created before RADAR_ANALYZE_SINCE or coming
 * from a source outside RADAR_ANALYZE_SOURCES. Nothing else of the engine (events, notifications,
 * publication admin, hot ranking, retention, collection) is subscribed. Unset: the full worker, as before.
 */
const scope = (process.env.RADAR_WORKER_SCOPE ?? "").trim();
const scoped = scope === "content"
  ? {
    since: process.env.RADAR_ANALYZE_SINCE?.trim() || undefined,
    sources: (process.env.RADAR_ANALYZE_SOURCES ?? "").split(",").map((v) => v.trim()).filter(Boolean),
  }
  : null;

// Without both gates the "scoped" worker would be the opposite of scoped: no source filter and no
// baseline means every historical article and every lane. Refuse to start instead.
if (scoped && (!scoped.since || scoped.sources.length === 0)) {
  console.error(JSON.stringify({
    level: "error",
    msg: "refusing to start the content worker without RADAR_ANALYZE_SINCE and RADAR_ANALYZE_SOURCES",
    hasBaseline: Boolean(scoped.since),
    sources: scoped.sources.length,
  }));
  process.exit(2);
}

await ensureContentTargets();
const boss = await getBoss();

if (scoped) {
  clearStopRequest("radar-translate");
  await requireSingleInstance("radar-translate");
  writeRunRecord("radar-translate", "apps/worker/src/main.ts (RADAR_WORKER_SCOPE=content)");
  await registerContentJobs(boss, { scope: scoped });
  await registerSchedules(boss, { only: ["content.sweep", "content.translate"], scope: scoped });
} else {
  await registerContentJobs(boss);
  if (process.env.COLLECT_ENABLED === "true") await registerSourceJobs(boss);
  await registerEventJobs(boss);
  await registerNotifyJobs(boss);
  await registerPublicationJobs(boss);
  await workModuleQueues(boss);
  await registerSchedules(boss);
}

// The scoped worker is a managed role: its heartbeat is the one `radar-ops status` reads. The full
// worker keeps the engine's own heartbeat, as before.
const stopRoleHeartbeat: () => void = scoped ? startRoleHeartbeat("radar-translate") : () => {};
const stopEngineHeartbeat: () => void = scoped ? () => {} : (() => {
  const timer = startHeartbeat("worker");
  return () => clearInterval(timer);
})();
console.log(JSON.stringify({
  level: "info", msg: "worker started", pid: process.pid,
  ...(scoped ? { scope: "content", sources: scoped.sources.length, baseline: scoped.since } : {}),
}));

let stopping = false;
let unwatchStop = () => {};
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  const started = performance.now();
  console.log(JSON.stringify({ level: "info", msg: "worker stopping", ...(scoped ? { scope: "content" } : {}) }));
  unwatchStop();
  stopRoleHeartbeat();
  stopEngineHeartbeat();
  await stopBoss();
  if (scoped) await releaseSingleInstance();
  const closing = performance.now();
  await closeDb();
  if (scoped) clearControlState("radar-translate");
  console.log(JSON.stringify({ level: "info", msg: "worker stopped", elapsedMs: Math.round(performance.now() - started),
    databaseCloseMs: Math.round(performance.now() - closing) }));
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
if (scoped) unwatchStop = watchStopRequest("radar-translate", () => void shutdown());
