// Run records a crashed process left open.
//
// `fetch_runs` and `job_runs` are written when work starts and finished when it ends, so a process that
// is killed — a watchdog exit, a closed console, a reboot — leaves rows that say "running" forever.
// Nothing else closes them: the history then cannot tell a stuck run from one that never happened, and
// an operator reads a permanent "in progress" for work that ended days ago (three such rows existed in
// the development database from 2026-10-20/21 before this module). Each dedicated worker closes the
// rows of *its own* scope at startup, after it holds its instance lock, so it can never close a record a
// live instance still owns.
import { sql } from "@aihot/backend/db";

/** The error a closed row carries, so the history says why the run has no result. */
export const INTERRUPTED_RUN_ERROR = "the worker exited before this run finished";

export interface InterruptedScope {
  /** Only these sources' fetch runs are closed. */
  sourceIds?: readonly string[];
  /** Only these job names' runs are closed. */
  jobs?: readonly string[];
  reason?: string;
}

/** Marks the scoped open run records as failed; returns how many of each were closed. */
export async function closeInterruptedRuns(scope: InterruptedScope): Promise<{ fetch: number; job: number }> {
  const reason = scope.reason ?? INTERRUPTED_RUN_ERROR;
  let fetch = 0;
  let job = 0;
  if (scope.sourceIds?.length) {
    const rows = await sql<{ id: number }[]>`
      UPDATE fetch_runs SET status = 'failed', finished_at = now(), error = ${reason}
      WHERE source_id = ANY(${scope.sourceIds as string[]}::text[]) AND status = 'running' RETURNING id`;
    fetch = rows.length;
  }
  if (scope.jobs?.length) {
    const rows = await sql<{ id: number }[]>`
      UPDATE job_runs SET status = 'failed', finished_at = now(), error = ${reason}
      WHERE job = ANY(${scope.jobs as string[]}::text[]) AND status = 'running' RETURNING id`;
    job = rows.length;
  }
  return { fetch, job };
}
