// The third-party lead source's schedule and fetch handlers, in one place.
//
// The lead source has its own schedule queue and its own fetch queue, so a lead never shares a job
// with an official source and never turns into a policy record. Two entry points register these
// handlers — the source-family worker and the dedicated lead worker — so there is one implementation
// of the AMZ123 cadence and one implementation of its collection, and the two can never drift apart.
import { ensureQueue, getBoss, QUEUES, recordRun, work } from "@aihot/backend/jobs/queue";
import { collectSource, loadSource, scheduleDueSources } from "@aihot/backend/sources/collect";
import { RADAR_LEAD_SOURCE_ID, isApprovedRadarLeadSource } from "@aihot/backend/sources/radar-policy-source";

/** The private schedule queue: it ticks every minute and decides, from next_fetch_at, whether a round is due. */
export const LEAD_SCHEDULE_QUEUE = "cron.radar.amz123-leads.schedule";
/** The run record this schedule leaves, so an operator sees the latest result. */
export const LEAD_JOB = "radar.amz123-leads.schedule";

type Boss = Awaited<ReturnType<typeof getBoss>>;

/**
 * Registers the lead source's schedule and fetch handlers and returns the queues it subscribed to.
 *
 * The cadence is not a fixed interval of its own: the tick runs every minute and the source's own
 * `interval_minutes` (360) decides when a round is due, so the same source behaves the same way
 * whether this worker or the family worker runs it.
 */
export async function registerLeadSource(boss: Boss, sourceId: typeof RADAR_LEAD_SOURCE_ID): Promise<string[]> {
  await ensureQueue(LEAD_SCHEDULE_QUEUE, { policy: "singleton", retryLimit: 1, expireInSeconds: 3600 });
  await boss.schedule(LEAD_SCHEDULE_QUEUE, "* * * * *", {}, { tz: "Asia/Shanghai", missed: "skip" });
  await boss.work(LEAD_SCHEDULE_QUEUE, { pollingIntervalSeconds: 10, localConcurrency: 1 }, async () => {
    const result = await recordRun(LEAD_JOB, () => scheduleDueSources(sourceId));
    if (result.enqueued > 0) {
      console.log(JSON.stringify({ level: "info", msg: "lead schedule enqueued", sourceId, enqueued: result.enqueued }));
    }
    return result;
  });

  await work(boss, QUEUES.fetchAmz123Leads, { pollingIntervalSeconds: 2, localConcurrency: 1 }, async ({ sourceId: requestedId, force }) => {
    if (requestedId !== sourceId) throw new Error("The isolated queue rejected a non-approved source.");
    // Re-read at execution time: a source disabled after startup must stop, without becoming a failure.
    const row = await loadSource(sourceId);
    if (!row?.enabled || !isApprovedRadarLeadSource(row)) {
      console.log(JSON.stringify({ level: "warn", msg: "lead source is no longer runnable; skipping this job", sourceId, pid: process.pid }));
      return { skipped: "source no longer runnable" };
    }
    const result = await collectSource(sourceId, { force });
    console.log(JSON.stringify({
      level: result.status === "failed" ? "error" : "info",
      msg: "third-party lead collection finished",
      sourceId,
      status: result.status,
      found: result.found,
      created: result.created,
      revised: result.revised,
      failed: result.status === "failed",
      ...(result.failureClass ? { failureClass: result.failureClass } : {}),
    }));
    if (result.status === "failed") throw new Error("Third-party lead collection failed; inspect fetch_runs and source health.");
    return result;
  });

  return [LEAD_SCHEDULE_QUEUE, QUEUES.fetchAmz123Leads];
}
