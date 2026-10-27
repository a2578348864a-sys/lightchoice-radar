// Worker process: queues and schedules for collection, processing, events, reports and ops, and the site's
// modules (site/modules/server.ts).
//
// Three shapes:
//   • full worker (default): everything the engine registers, as before.
//   • scoped first-lane worker (`RADAR_WORKER_SCOPE=content`): only the analysis queue and the
//     discovery/translation timers, refusing material older than RADAR_ANALYZE_SINCE or outside
//     RADAR_ANALYZE_SOURCES. It takes the "radar-translate" instance role, writes a heartbeat and a run
//     record, and stops on the same request file the other workers use — so `radar-ops start|stop|status
//     translate` manages it like any other Radar service.
//   • maintenance worker (`RADAR_WORKER_SCOPE=maintenance`): no queues at all, only the ops.retention
//     and ops.backup timers plus the startup sweep of interrupted runs that belong to sources no
//     dedicated worker claims. Takes the "radar-maintenance" role, managed as `radar-ops start|stop|status
//     maintenance`.
import { assertProductionSecrets } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
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
import { closeInterruptedRuns } from "./interrupted-runs.ts";
import { ADS_POLICY_SOURCE_ID } from "@aihot/backend/sources/ads-policy";
import { AMAZON_US_ANNOUNCEMENTS_SOURCE_ID, RADAR_LEAD_SOURCE_ID, RADAR_POLICY_SOURCE_ID, RADAR_REGULATORY_SOURCE_IDS } from "@aihot/backend/sources/radar-policy-source";
import { INDUSTRY_SOURCE_IDS } from "@aihot/backend/sources/industry-lane";
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
const maintenance = scope === "maintenance";

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

if (!maintenance) await ensureContentTargets();
const boss = await getBoss();

if (maintenance) {
  // The maintenance worker owns no collection queues. At startup — under its instance lock, so it can
  // never race a live dedicated worker's own sweep — it closes interrupted run records of sources no
  // dedicated worker claims (the general sources.fetch scope the full worker used to own), then takes
  // the retention and backup timers.
  clearStopRequest("radar-maintenance");
  await requireSingleInstance("radar-maintenance");
  writeRunRecord("radar-maintenance", "apps/worker/src/main.ts (RADAR_WORKER_SCOPE=maintenance)");
  const claimedByDedicatedWorkers = new Set<string>([
    AMAZON_US_ANNOUNCEMENTS_SOURCE_ID, RADAR_POLICY_SOURCE_ID, ...RADAR_REGULATORY_SOURCE_IDS,
    RADAR_LEAD_SOURCE_ID, ...INDUSTRY_SOURCE_IDS, ADS_POLICY_SOURCE_ID,
  ]);
  const generalSourceIds = (await sql<{ id: string }[]>`SELECT id FROM sources WHERE enabled`)
    .map((row) => row.id).filter((id) => !claimedByDedicatedWorkers.has(id));
  const interrupted = await closeInterruptedRuns({
    sourceIds: generalSourceIds,
    reason: "the general collection scope has no running worker; the maintenance worker closed this stale record at startup",
  });
  if (interrupted.fetch || interrupted.job) {
    console.log(JSON.stringify({ level: "info", msg: "closed interrupted runs of unclaimed sources", ...interrupted }));
  }
  await registerSchedules(boss, { only: ["ops.retention", "ops.backup", "reports.compose"] });
} else if (scoped) {
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

// The scoped and maintenance workers are managed roles: their heartbeat is the one `radar-ops status`
// reads. The full worker keeps the engine's own heartbeat, as before.
const role = maintenance ? "radar-maintenance" : scoped ? "radar-translate" : null;
const stopRoleHeartbeat: () => void = role ? startRoleHeartbeat(role) : () => {};
const stopEngineHeartbeat: () => void = role ? () => {} : (() => {
  const timer = startHeartbeat("worker");
  return () => clearInterval(timer);
})();
console.log(JSON.stringify({
  level: "info", msg: "worker started", pid: process.pid,
  ...(maintenance ? { scope: "maintenance" } : scoped ? { scope: "content", sources: scoped.sources.length, baseline: scoped.since } : {}),
}));

let stopping = false;
let unwatchStop = () => {};
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  const started = performance.now();
  console.log(JSON.stringify({ level: "info", msg: "worker stopping", ...(role ? { role } : {}) }));
  unwatchStop();
  stopRoleHeartbeat();
  stopEngineHeartbeat();
  await stopBoss();
  if (role) await releaseSingleInstance();
  const closing = performance.now();
  await closeDb();
  if (role) clearControlState(role);
  console.log(JSON.stringify({ level: "info", msg: "worker stopped", elapsedMs: Math.round(performance.now() - started),
    databaseCloseMs: Math.round(performance.now() - closing) }));
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
if (role) unwatchStop = watchStopRequest(role, () => void shutdown());
