// Dedicated, source-only monitor. It registers a private schedule queue and a private fetch queue for
// each source family that is currently runnable (Amazon announcements and fee updates, U.S.
// regulation), never the shared `sources.fetch` queue. A disabled or non-compliant source is skipped
// with its own warning; when nothing is runnable the process exits instead of idling. The third-party
// lead source is the dedicated lead worker's role and is never registered here.
import { closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { ensureQueue, QUEUES, recordRun, stopBoss, work, getBoss } from "@aihot/backend/jobs/queue";
import { collectSource, loadSource, scheduleDueSources } from "@aihot/backend/sources/collect";
import {
  AMAZON_US_ANNOUNCEMENTS_SOURCE_ID,
  RADAR_POLICY_SOURCE_ID,
  RADAR_REGULATORY_SOURCE_IDS,
  isApprovedRadarPolicyWebList,
  isApprovedRadarRegulatoryFeed,
  isApprovedRadarRegulatorySource,
  type RadarRegulatorySourceId,
} from "@aihot/backend/sources/radar-policy-source";
import type { SourceRow } from "@aihot/backend/sources/types";
import { clearControlState, clearStopRequest, startHeartbeat, watchStopRequest, writeRunRecord } from "./control.ts";
import { closeInterruptedRuns } from "./interrupted-runs.ts";
import { releaseSingleInstance, requireSingleInstance } from "./instance-lock.ts";
import { selectRunnableSources } from "./source-selection.ts";

const scheduleQueue = "cron.radar.amazon-announcements.schedule";
const feeScheduleQueue = "cron.radar.amazon-fee-updates.schedule";
const regulatoryScheduleQueue = "cron.radar.regulatory.schedule";


// A logon-triggered scheduled task and a manual start must not both poll these queues: the second
// process exits here, before it registers a handler or touches the schedule row.
// A stop request from an earlier session must not stop the new one at once (Windows has no SIGTERM).
clearStopRequest("radar-announcements");
await requireSingleInstance("radar-announcements");
writeRunRecord("radar-announcements", "radar-announcements.ts");
const stopHeartbeat = startHeartbeat("radar-announcements");

if (!config.ruleOnlyMode) throw new Error("The isolated Amazon announcements monitor requires ruleOnlyMode.");

const announcementRow = await loadSource(AMAZON_US_ANNOUNCEMENTS_SOURCE_ID);
const feeRow = await loadSource(RADAR_POLICY_SOURCE_ID);
const regulatoryRows: Partial<Record<RadarRegulatorySourceId, SourceRow | null>> = {};
for (const id of RADAR_REGULATORY_SOURCE_IDS) regulatoryRows[id] = await loadSource(id);

// The lock is held, so nothing else can be running these sources: any open run record belongs to a
// process that died (a killed console, a reboot, a watchdog exit). Close them before scheduling, so the
// history does not show work "in progress" that ended days ago. The lead source is not in this list:
// closing its records is the dedicated lead worker's job, never this one's.
const interrupted = await closeInterruptedRuns({
  sourceIds: [AMAZON_US_ANNOUNCEMENTS_SOURCE_ID, RADAR_POLICY_SOURCE_ID, ...RADAR_REGULATORY_SOURCE_IDS],
  jobs: ["radar.amazon-announcements.schedule", "radar.amazon-fee-updates.schedule", "radar.regulatory.schedule"],
});
if (interrupted.fetch > 0 || interrupted.job > 0) {
  console.log(JSON.stringify({ level: "warn", msg: "closed run records an earlier process never finished", ...interrupted, pid: process.pid }));
}

const selection = selectRunnableSources({ announcements: announcementRow, regulatory: regulatoryRows });
for (const skipped of selection.skipped) {
  console.log(JSON.stringify({ level: "warn", msg: "approved source skipped", sourceId: skipped.id, reason: skipped.reason, pid: process.pid }));
}

if (selection.allUnavailable) {
  console.log(JSON.stringify({
    level: "error",
    msg: "no approved source is runnable; the monitor will not start",
    skipped: selection.skipped,
    pid: process.pid,
  }));
  await releaseSingleInstance();
  await closeDb();
  process.exit(1);
}

const boss = await getBoss();
const subscribedQueues: string[] = [];

if (selection.announcements) {
  const sourceId = selection.announcements.id;
  await ensureQueue(scheduleQueue, { policy: "singleton", retryLimit: 1, expireInSeconds: 3600 });
  await boss.schedule(scheduleQueue, "* * * * *", {}, { tz: "Asia/Shanghai", missed: "skip" });
  await boss.work(scheduleQueue, { pollingIntervalSeconds: 10, localConcurrency: 1 }, async () => {
    const result = await recordRun("radar.amazon-announcements.schedule", () => scheduleDueSources(sourceId));
    if (result.enqueued > 0) {
      console.log(JSON.stringify({ level: "info", msg: "single-source schedule enqueued", sourceId, enqueued: result.enqueued }));
    }
    return result;
  });

  await work(boss, QUEUES.fetchAmazonAnnouncements, { pollingIntervalSeconds: 2, localConcurrency: 1 }, async ({ sourceId: requestedId, force }) => {
    if (requestedId !== sourceId) throw new Error("The isolated queue rejected a non-approved source.");
    // Re-read at execution time: a source disabled after startup must stop, without becoming a failure.
    const row = await loadSource(sourceId);
    if (!row?.enabled || !isApprovedRadarPolicyWebList(row)) {
      console.log(JSON.stringify({ level: "warn", msg: "announcements source is no longer runnable; skipping this job", sourceId, pid: process.pid }));
      return { skipped: "source no longer runnable" };
    }
    const result = await collectSource(sourceId, { force });
    console.log(JSON.stringify({
      level: result.status === "failed" ? "error" : "info",
      msg: "single-source collection finished",
      sourceId,
      status: result.status,
      found: result.found,
      created: result.created,
      revised: result.revised,
      failed: result.status === "failed",
      ...(result.failureClass ? { failureClass: result.failureClass } : {}),
    }));
    if (result.status === "failed") throw new Error("Amazon announcements collection failed; inspect fetch_runs and source health.");
    return result;
  });

  subscribedQueues.push(scheduleQueue, QUEUES.fetchAmazonAnnouncements);
}

// The fee-updates source is the second approved policy web list. It has no consumer of its own — the
// general schedule would put it on the shared `sources.fetch` queue this worker never reads — so the
// family worker gives it the same private schedule/fetch pair as the announcements source.
const feeRunnable = !!feeRow?.enabled && isApprovedRadarPolicyWebList(feeRow);
if (!feeRunnable) {
  console.log(JSON.stringify({
    level: "warn",
    msg: "approved source skipped",
    sourceId: RADAR_POLICY_SOURCE_ID,
    reason: feeRow ? (feeRow.enabled ? "config is not on the approved allowlist" : "source disabled") : "source row missing",
    pid: process.pid,
  }));
} else {
  await ensureQueue(feeScheduleQueue, { policy: "singleton", retryLimit: 1, expireInSeconds: 3600 });
  await boss.schedule(feeScheduleQueue, "* * * * *", {}, { tz: "Asia/Shanghai", missed: "skip" });
  await boss.work(feeScheduleQueue, { pollingIntervalSeconds: 10, localConcurrency: 1 }, async () => {
    const result = await recordRun("radar.amazon-fee-updates.schedule", () => scheduleDueSources(RADAR_POLICY_SOURCE_ID));
    if (result.enqueued > 0) {
      console.log(JSON.stringify({ level: "info", msg: "fee-updates schedule enqueued", sourceId: RADAR_POLICY_SOURCE_ID, enqueued: result.enqueued }));
    }
    return result;
  });

  await work(boss, QUEUES.fetchAmazonFeeUpdates, { pollingIntervalSeconds: 2, localConcurrency: 1 }, async ({ sourceId: requestedId, force }) => {
    if (requestedId !== RADAR_POLICY_SOURCE_ID) throw new Error("The isolated queue rejected a non-approved source.");
    // Re-read at execution time: a source disabled after startup must stop, without becoming a failure.
    const row = await loadSource(requestedId);
    if (!row?.enabled || !isApprovedRadarPolicyWebList(row)) {
      console.log(JSON.stringify({ level: "warn", msg: "fee-updates source is no longer runnable; skipping this job", sourceId: requestedId, pid: process.pid }));
      return { skipped: "source no longer runnable" };
    }
    const result = await collectSource(requestedId, { force });
    console.log(JSON.stringify({
      level: result.status === "failed" ? "error" : "info",
      msg: "fee-updates collection finished",
      sourceId: requestedId,
      status: result.status,
      found: result.found,
      created: result.created,
      revised: result.revised,
      failed: result.status === "failed",
      ...(result.failureClass ? { failureClass: result.failureClass } : {}),
    }));
    if (result.status === "failed") throw new Error("Amazon fee-updates collection failed; inspect fetch_runs and source health.");
    return result;
  });

  subscribedQueues.push(feeScheduleQueue, QUEUES.fetchAmazonFeeUpdates);
}

if (selection.regulatory.length) {
  const runnable = selection.regulatory.map((entry) => entry.id);
  const runnableIds = new Set<string>(runnable);

  await ensureQueue(regulatoryScheduleQueue, { policy: "singleton", retryLimit: 1, expireInSeconds: 3600 });
  await boss.schedule(regulatoryScheduleQueue, "* * * * *", {}, { tz: "Asia/Shanghai", missed: "skip" });
  // One tick per minute for the regulatory family. Each runnable source is scheduled on its own, so a
  // failing source records its own failure and never blocks the others.
  await boss.work(regulatoryScheduleQueue, { pollingIntervalSeconds: 10, localConcurrency: 1 }, async () => {
    const perSource: Record<string, { enqueued?: number; error?: string }> = {};
    for (const id of runnable) {
      try {
        const result = await recordRun("radar.regulatory.schedule", async () => ({ sourceId: id, ...(await scheduleDueSources(id)) }));
        perSource[id] = { enqueued: result.enqueued };
        if (result.enqueued > 0) {
          console.log(JSON.stringify({ level: "info", msg: "regulatory schedule enqueued", sourceId: id, enqueued: result.enqueued }));
        }
      } catch (error) {
        perSource[id] = { error: String(error).slice(0, 200) };
        console.log(JSON.stringify({ level: "error", msg: "regulatory schedule failed for one source", sourceId: id, error: String(error).slice(0, 200) }));
      }
    }
    return perSource;
  });

  await work(boss, QUEUES.fetchRegulatory, { pollingIntervalSeconds: 2, localConcurrency: 1 }, async ({ sourceId: requestedId, force }) => {
    // Three gates: this worker's runnable set, the static allowlist, and the row as it is right now.
    if (!runnableIds.has(requestedId)) throw new Error("The isolated queue rejected a source this worker does not run.");
    if (!isApprovedRadarRegulatorySource(requestedId)) throw new Error("The isolated queue rejected a non-approved source.");
    const row = await loadSource(requestedId);
    if (!row?.enabled || !isApprovedRadarRegulatoryFeed(row)) {
      console.log(JSON.stringify({ level: "warn", msg: "regulatory source is no longer runnable; skipping this job", sourceId: requestedId, pid: process.pid }));
      return { skipped: "source no longer runnable" };
    }
    const result = await collectSource(requestedId, { force });
    console.log(JSON.stringify({
      level: result.status === "failed" ? "error" : "info",
      msg: "regulatory collection finished",
      sourceId: requestedId,
      status: result.status,
      found: result.found,
      created: result.created,
      revised: result.revised,
      failed: result.status === "failed",
      ...(result.failureClass ? { failureClass: result.failureClass } : {}),
    }));
    if (result.status === "failed") throw new Error("Regulatory collection failed; inspect fetch_runs and source health.");
    return result;
  });

  subscribedQueues.push(regulatoryScheduleQueue, QUEUES.fetchRegulatory);
}

let stopping = false;
/** Stopping stops the queues, releases the lock and closes the database; a stop request asks for it too. */
async function shutdown(reason: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  unwatchStop();
  stopHeartbeat();
  console.log(JSON.stringify({ level: "info", msg: "Amazon announcements monitor stopping", reason, pid: process.pid }));
  await stopBoss();
  await releaseSingleInstance();
  await closeDb();
  clearControlState("radar-announcements");
  console.log(JSON.stringify({ level: "info", msg: "Amazon announcements monitor stopped", pid: process.pid }));
  process.exit(0);
}
const unwatchStop = watchStopRequest("radar-announcements", () => void shutdown("stop request file"));

console.log(JSON.stringify({
  level: "info",
  msg: "Amazon announcements monitor started",
  pid: process.pid,
  announcements: selection.announcements,
  regulatorySources: selection.regulatory,
  skippedSources: selection.skipped,
  schedule: "every minute",
  subscribedQueues,
  ruleOnlyMode: config.ruleOnlyMode,
}));

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
