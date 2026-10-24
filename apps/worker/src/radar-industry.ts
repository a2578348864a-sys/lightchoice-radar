// The second lane's dedicated monitor: US consumer & e-commerce industry dynamics.
//
// It owns one private schedule queue and one private fetch queue for the four approved industry
// sources, never the shared `sources.fetch`. After each collection round it runs the lane's two
// processing steps in order — the deterministic admission/classification gate, then (only for
// sources whose permission profile allows it, and only inside the lane's own budget window) the
// Chinese event processing — and keeps the day's picks archived. Every step is the lane's own; the
// first lane's queues, budgets and facts are never touched.
import { closeDb } from "@aihot/backend/db";
import { config } from "@aihot/backend/config";
import { ensureQueue, getBoss, recordRun, stopBoss, work } from "@aihot/backend/jobs/queue";
import { collectSource, loadSource, scheduleDueSources } from "@aihot/backend/sources/collect";
import { INDUSTRY_SOURCE_IDS, INDUSTRY_SCHEDULE_QUEUE, isApprovedIndustrySourceId, type IndustrySourceId } from "@aihot/backend/sources/industry-lane";
import { classifyIndustryPending, processIndustryPending } from "@aihot/backend/editorial/industry-text";
import { generateIndustryPicks } from "@aihot/backend/publication/industry";
import { clearControlState, clearStopRequest, startHeartbeat, watchStopRequest, writeRunRecord } from "./control.ts";
import { closeInterruptedRuns } from "./interrupted-runs.ts";
import { releaseSingleInstance, requireSingleInstance } from "./instance-lock.ts";

const FETCH_QUEUE = "sources.fetch-industry";

clearStopRequest("radar-industry");
await requireSingleInstance("radar-industry");
writeRunRecord("radar-industry", "radar-industry.ts");
const stopHeartbeat = startHeartbeat("radar-industry");

if (!config.ruleOnlyMode) throw new Error("The industry monitor requires ruleOnlyMode.");

const interrupted = await closeInterruptedRuns({
  sourceIds: [...INDUSTRY_SOURCE_IDS],
  jobs: ["cron.radar.industry.schedule", "sources.fetch-industry"],
});
if (interrupted.fetch > 0 || interrupted.job > 0) {
  console.log(JSON.stringify({ level: "warn", msg: "closed run records an earlier process never finished", ...interrupted, pid: process.pid }));
}

const boss = await getBoss();

await ensureQueue(INDUSTRY_SCHEDULE_QUEUE, { policy: "singleton", retryLimit: 1, expireInSeconds: 3600 });
await boss.schedule(INDUSTRY_SCHEDULE_QUEUE, "* * * * *", {}, { tz: "Asia/Shanghai", missed: "skip" });
await work(boss, INDUSTRY_SCHEDULE_QUEUE as never, { pollingIntervalSeconds: 10, localConcurrency: 1 }, async () => {
  let enqueued = 0;
  for (const sourceId of INDUSTRY_SOURCE_IDS) {
    const result = await recordRun("radar.industry.schedule", () => scheduleDueSources(sourceId));
    enqueued += result.enqueued;
  }
  if (enqueued > 0) console.log(JSON.stringify({ level: "info", msg: "industry schedule enqueued", enqueued, pid: process.pid }));
  return { enqueued };
});

await ensureQueue(FETCH_QUEUE, { policy: "short", retryLimit: 0, expireInSeconds: 900 });
await work(boss, FETCH_QUEUE as never, { pollingIntervalSeconds: 2, localConcurrency: 1 }, async ({ sourceId, force }: { sourceId: string; force?: boolean }) => {
  if (!isApprovedIndustrySourceId(sourceId)) throw new Error("The isolated industry queue rejected a non-approved source.");
  const row = await loadSource(sourceId);
  if (!row?.enabled) {
    console.log(JSON.stringify({ level: "warn", msg: "industry source no longer runnable; skipping", sourceId, pid: process.pid }));
    return { skipped: "source no longer runnable" };
  }
  const result = await collectSource(sourceId, { force });
  console.log(JSON.stringify({
    level: result.status === "failed" ? "error" : "info",
    msg: "industry collection finished",
    sourceId, status: result.status, found: result.found, created: result.created, revised: result.revised,
    ...(result.failureClass ? { failureClass: result.failureClass } : {}),
  }));
  if (result.status === "failed") throw new Error(`industry collection failed for ${sourceId}; inspect fetch_runs`);
  // The lane's two processing steps run after its own collection: the deterministic gate first (free),
  // then the budgeted Chinese processing, which silently does nothing when its window is exhausted.
  const classified = await classifyIndustryPending(100);
  let processed: Awaited<ReturnType<typeof processIndustryPending>> = { done: [] };
  if (classified.admitted > 0) {
    processed = await processIndustryPending({ runArticles: config.industry.runArticles });
  }
  if (result.created > 0 || processed.done.length > 0) {
    try { await generateIndustryPicks(); } catch (error) {
      console.log(JSON.stringify({ level: "warn", msg: "daily picks generation failed; collection unaffected", error: String(error).slice(0, 120) }));
    }
  }
  return { ...result, classified, processed: processed.done.length };
});

const unwatch = watchStopRequest("radar-industry", () => {
  console.log(JSON.stringify({ level: "info", msg: "industry worker stopping on request", pid: process.pid }));
  void (async () => {
    stopHeartbeat();
    await stopBoss();
    await clearControlState("radar-industry");
    await closeDb();
    process.exit(0);
  })();
});

console.log(JSON.stringify({ level: "info", msg: "industry worker started", pid: process.pid, sources: INDUSTRY_SOURCE_IDS.length }));

// The process stays alive on pg-boss's own timers; the stop watcher above ends it.
