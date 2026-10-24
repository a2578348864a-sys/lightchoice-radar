// Dedicated, opt-in scheduler for the Amazon Ads policy pages — the only source whose text exists
// after JavaScript runs. Kept out of the always-on worker on purpose: nothing on the API, web or
// announcement paths should ever load a browser. The process stays off unless the deployment sets
// RADAR_ADS_POLICY_ENABLED=1 *and* the source row is enabled; it then runs the same collection path
// the controlled script uses (`collectSource`), under one instance lock, with a watchdog and a
// backoff, and never touches pg-boss.
import { closeDb } from "@aihot/backend/db";
import { collectSource, loadSource } from "@aihot/backend/sources/collect";
import { ADS_POLICY_SOURCE_ID, isApprovedAdsPolicySource } from "@aihot/backend/sources/ads-policy";
import { adsPolicySchedule, nextRunDelayMs, startWatchdog, type AdsPolicySchedule } from "./ads-policy-schedule.ts";
import { recordCollectionRun } from "./collection-run.ts";
import { clearControlState, clearStopRequest, startHeartbeat, stopRequested as stopRequestedFile, watchStopRequest, writeRunRecord } from "./control.ts";
import { closeInterruptedRuns } from "./interrupted-runs.ts";
import { EXIT } from "./supervisor.ts";
import { releaseSingleInstance, requireSingleInstance } from "./instance-lock.ts";

const JOB = "radar.ads-policy.collect";
const log = (level: "info" | "warn" | "error", msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, msg, pid: process.pid, ...extra }));

const schedule = adsPolicySchedule(process.env);

if (!schedule.enabled) {
  log("info", "the Ads policy scheduler is off; set RADAR_ADS_POLICY_ENABLED=1 to run it", {
    intervalMinutes: Math.round(schedule.intervalMs / 60_000),
  });
  await closeDb();
  process.exit(0);
}

// Stopping on Windows: the supervisor asks over IPC; a process started by hand is asked through the
// request file. A supervised child leaves the file alone — its supervisor already cleared it before
// spawning — so a request written during startup is not lost.
if (!process.channel) clearStopRequest("ads-policy");

await requireSingleInstance("ads-policy");

const source = await loadSource(ADS_POLICY_SOURCE_ID);
// A missing source or an edited configuration cannot be fixed by restarting; a paused source is the
// operator's decision. Both leave distinct exit codes so the supervisor stops instead of looping.
if (!source || !isApprovedAdsPolicySource(source)) {
  log("error", "the Ads policy source is missing or its configuration is no longer approved", {
    sourceId: ADS_POLICY_SOURCE_ID, present: !!source, approvedConfig: source ? isApprovedAdsPolicySource(source) : false,
  });
  await releaseSingleInstance();
  await closeDb();
  process.exit(EXIT.config);
}
if (!source.enabled) {
  log("error", "the Ads policy source is paused; enable it before running the scheduler", { sourceId: ADS_POLICY_SOURCE_ID });
  await releaseSingleInstance();
  await closeDb();
  process.exit(EXIT.sourceDisabled);
}

// A run that was open when a previous process died will never finish. Closing those records here is
// what makes a crash visible in the run history instead of leaving a permanent "running" row.
const closedRuns = await closeInterruptedRuns({ sourceIds: [ADS_POLICY_SOURCE_ID], jobs: [JOB] });
if (closedRuns.fetch > 0 || closedRuns.job > 0) log("warn", "closed run records an earlier process never finished", closedRuns);

writeRunRecord("ads-policy", "ads-policy.ts");
// While this process lives it writes a heartbeat: `radar-ops stop --force` uses it to prove a PID is
// really this worker before killing anything.
const stopHeartbeat = startHeartbeat("ads-policy");
/**
 * A stop request ends the schedule, not the run in hand: the collection in flight finishes (the watchdog
 * still bounds it), then the process releases its lock and exits. Stopping mid-run would leave a run
 * record open and could drop the page being read.
 */
let stopReason: string | null = null;
let finishing = false;
let inRun = false;
let timer: NodeJS.Timeout | null = null;
let wake: (() => void) | null = null;
const sleep = (ms: number) => new Promise<void>((resolve) => {
  wake = resolve;
  timer = setTimeout(() => { wake = null; resolve(); }, ms);
});
const interruptSleep = () => { if (timer) clearTimeout(timer); timer = null; wake?.(); wake = null; };

const finish = async (reason: string, code: number = EXIT.clean) => {
  if (finishing) return;
  finishing = true;
  interruptSleep();
  unwatchStop();
  stopHeartbeat();
  log("info", "the Ads policy scheduler is stopping", { reason, inRun });
  await releaseSingleInstance().catch(() => {});
  await closeDb().catch(() => {});
  clearControlState("ads-policy");
  process.exit(code);
};

const requestStop = (reason: string) => {
  if (stopReason || finishing) return;
  stopReason = reason;
  log("info", "stop requested; the run in hand finishes first", { reason, inRun });
  if (!inRun) void finish(reason);
};
process.on("SIGTERM", () => requestStop("SIGTERM"));
process.on("SIGINT", () => requestStop("SIGINT"));
// The supervisor's request (Windows has no usable SIGTERM for a child).
process.on("message", (message) => {
  if ((message as { type?: string } | null)?.type === "stop") requestStop("stop request from the supervisor");
});
const unwatchStop = watchStopRequest("ads-policy", () => requestStop("stop request file"));

/** An exit while a browser page hangs would otherwise keep the lock and the run record forever. */
function watchdog(ms: number): () => void {
  return startWatchdog(ms, () => {
    log("error", "a run exceeded its watchdog; exiting so a supervisor can restart it", { timeoutMinutes: Math.round(ms / 60_000) });
    void releaseSingleInstance().catch(() => {});
    process.exit(1);
  });
}

let failures = 0;
for (;;) {
  // A stop request between runs must not be overtaken by a new collection.
  if (stopReason || stopRequestedFile("ads-policy")) {
    await finish(stopReason ?? "stop request file");
    break;
  }
  inRun = true;
  const started = Date.now();
  const clearWatchdog = watchdog(schedule.timeoutMs);
  try {
    const result = await recordCollectionRun(JOB, () => collectSource(ADS_POLICY_SOURCE_ID, { force: true }));
    clearWatchdog();
    if (result.status === "failed") {
      failures += 1;
      log("error", "the Ads policy collection failed; the source keeps the failure and its health", {
        error: result.error, failureClass: result.failureClass ?? "unknown", found: result.found, created: result.created, failures,
      });
    } else {
      failures = 0;
      log("info", "the Ads policy collection finished", {
        status: result.status, found: result.found, created: result.created, revised: result.revised,
        ms: Date.now() - started,
      });
    }
  } catch (error) {
    clearWatchdog();
    failures += 1;
    log("error", "the Ads policy collection could not run", { error: String(error).slice(0, 300), failures });
  } finally {
    inRun = false;
  }

  // The stop was requested while this run was in flight: finish here, before sleeping or scheduling.
  if (stopReason) {
    await finish(stopReason, failures > 0 ? EXIT.runtime : EXIT.clean);
    break;
  }
  if (schedule.once) break;
  const delay = nextRunDelayMs(failures, schedule.intervalMs);
  log("info", "the Ads policy scheduler waits before the next run", { minutes: Math.round(delay / 60_000), failures });
  await sleep(delay);
  if (stopReason) {
    await finish(stopReason);
    break;
  }
}

// A single failed run is a failure for whoever started this process (the supervisor, or an operator
// checking the path), not a success with an error in the log.
await finish("finished a single run", schedule.once && failures > 0 ? EXIT.runtime : EXIT.clean);

export type { AdsPolicySchedule };
