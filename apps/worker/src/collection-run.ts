// A collection run as the job history sees it.
//
// `recordRun` marks a job "ok" unless the function throws, but `collectSource` reports a failure by
// returning `status: "failed"` — it records the failure on fetch_runs and on the source's health and
// resolves normally. Recording that as an ok job made the two histories disagree: an operator reading
// job_runs saw a healthy schedule while every fetch was failing. This wrapper turns a failed result
// into the throw `recordRun` expects, and hands the result back to the caller so the scheduler can keep
// its backoff and logging.
import { recordRun } from "@aihot/backend/jobs/queue";
import type { CollectResult } from "@aihot/backend/sources/collect";

export class CollectResultError extends Error {
  readonly result: CollectResult;
  constructor(result: CollectResult) {
    super(result.error ?? `collection failed (${result.failureClass ?? "unknown"})`);
    this.name = "CollectResultError";
    this.result = result;
  }

  /** `recordRun` stores `String(error)`: the run history should read as the failure, not as a class name. */
  toString(): string {
    return this.message;
  }
}

/** Records one collection under `job`; the job row fails exactly when the collection failed. */
export async function recordCollectionRun(job: string, run: () => Promise<CollectResult>): Promise<CollectResult> {
  try {
    return await recordRun(job, async () => {
      const result = await run();
      if (result.status === "failed") throw new CollectResultError(result);
      return result;
    });
  } catch (error) {
    if (error instanceof CollectResultError) return error.result;
    throw error;
  }
}
