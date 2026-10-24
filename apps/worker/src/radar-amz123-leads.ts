// The dedicated third-party lead worker.
//
// It runs exactly one source — the AMZ123 third-party policy lead source — on its own schedule and
// its own private queue. It registers no official queue at all, so starting it can never collect the
// Amazon announcements, the regulatory feeds or Ads: the isolation is structural, not a flag.
//
// The family worker (radar-announcements.ts) registers the same handlers for the same source through
// the same module, so there is one implementation of the AMZ123 cadence and collection. This entry
// point exists because the family worker also owns the official sources, and the lead source must be
// able to run without them.
import { closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { getBoss, stopBoss } from "@aihot/backend/jobs/queue";
import { loadSource } from "@aihot/backend/sources/collect";
import { RADAR_LEAD_SOURCE_ID } from "@aihot/backend/sources/radar-policy-source";
import { clearControlState, clearStopRequest, startHeartbeat, watchStopRequest, writeRunRecord } from "./control.ts";
import { closeInterruptedRuns } from "./interrupted-runs.ts";
import { releaseSingleInstance, requireSingleInstance } from "./instance-lock.ts";
import { registerLeadSource } from "./lead-source-runner.ts";
import { selectLeadSource } from "./source-selection.ts";

const ROLE = "amz123-leads";

// A logon-triggered task and a manual start must not both poll these queues: the second process exits
// here, before it registers a handler or touches the schedule row.
// A stop request from an earlier session must not stop the new one at once (Windows has no SIGTERM).
clearStopRequest(ROLE);
await requireSingleInstance(ROLE);
writeRunRecord(ROLE, "radar-amz123-leads.ts");
const stopHeartbeat = startHeartbeat(ROLE);

if (!config.ruleOnlyMode) throw new Error("The isolated AMZ123 lead monitor requires ruleOnlyMode.");

const selection = selectLeadSource(await loadSource(RADAR_LEAD_SOURCE_ID));
if (selection.skipped) {
  console.log(JSON.stringify({ level: "warn", msg: "approved source skipped", sourceId: selection.skipped.id, reason: selection.skipped.reason, pid: process.pid }));
}

if (!selection.source) {
  console.log(JSON.stringify({
    level: "error",
    msg: "the lead source is not runnable; the monitor will not start",
    skipped: selection.skipped,
    pid: process.pid,
  }));
  await releaseSingleInstance();
  await closeDb();
  process.exit(1);
}

// The lock is held, so no other instance of this worker is running: any open run record belongs to a
// process that died (a killed console, a reboot, a watchdog exit). Close it before scheduling.
const interrupted = await closeInterruptedRuns({
  sourceIds: [RADAR_LEAD_SOURCE_ID],
  jobs: ["radar.amz123-leads.schedule"],
});
if (interrupted.fetch > 0 || interrupted.job > 0) {
  console.log(JSON.stringify({ level: "warn", msg: "closed run records an earlier process never finished", ...interrupted, pid: process.pid }));
}

const boss = await getBoss();
const subscribedQueues = await registerLeadSource(boss, selection.source.id);

let stopping = false;
/** Stopping stops the queues, releases the lock and closes the database; a stop request asks for it too. */
async function shutdown(reason: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  unwatchStop();
  stopHeartbeat();
  console.log(JSON.stringify({ level: "info", msg: "AMZ123 lead monitor stopping", reason, pid: process.pid }));
  // The queue drain is graceful: a round that is running finishes before the process leaves.
  await stopBoss();
  await releaseSingleInstance();
  await closeDb();
  clearControlState(ROLE);
  console.log(JSON.stringify({ level: "info", msg: "AMZ123 lead monitor stopped", pid: process.pid }));
  process.exit(0);
}
const unwatchStop = watchStopRequest(ROLE, () => void shutdown("stop request file"));

console.log(JSON.stringify({
  level: "info",
  msg: "AMZ123 lead monitor started",
  pid: process.pid,
  source: selection.source,
  schedule: "checks every minute; the source's own interval_minutes decides when a round is due",
  subscribedQueues,
  // Nothing else is registered here, and this list is what the isolation check reads.
  officialQueues: [],
  ruleOnlyMode: config.ruleOnlyMode,
}));

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
