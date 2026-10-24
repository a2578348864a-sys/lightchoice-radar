// A killed worker leaves "running" rows behind. Each dedicated worker closes the rows of its own scope
// when it starts, and only those: another source's or another job's open record is never touched, so a
// live instance's work cannot be marked failed by a restart. Uses PostgreSQL.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { closeInterruptedRuns, INTERRUPTED_RUN_ERROR } from "../apps/worker/src/interrupted-runs.ts";
import { recordCollectionRun } from "../apps/worker/src/collection-run.ts";

const T = tag();
const MINE = `recovery-mine-${T}`;
const OTHER = `recovery-other-${T}`;
const MY_JOB = `radar.test.mine.${T}`;
const OTHER_JOB = `radar.test.other.${T}`;

async function insertRun(sourceId: string, status: "running" | "ok"): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO fetch_runs (source_id, status, finished_at) VALUES (${sourceId}, ${status}, ${status === "ok" ? sql`now()` : null}) RETURNING id`;
  return row!.id;
}

async function insertJob(job: string, status: "running" | "ok"): Promise<number> {
  const [row] = await sql<{ id: number }[]>`
    INSERT INTO job_runs (job, status, finished_at) VALUES (${job}, ${status}, ${status === "ok" ? sql`now()` : null}) RETURNING id`;
  return row!.id;
}

const statusOf = async (table: "fetch_runs" | "job_runs", id: number) => {
  const [row] = await sql<{ status: string; error: string | null; finished_at: Date | null }[]>`
    SELECT status, error, finished_at FROM ${sql(table)} WHERE id = ${id}`;
  return row!;
};

before(async () => {
  for (const id of [MINE, OTHER]) {
    await sql`INSERT INTO sources (id, name, kind, config, tier, participation_mode, interval_minutes, enabled)
              VALUES (${id}, ${id}, 'rss', ${sql.json({})}, 'T1', 'editorial', 60, true)`;
  }
});

after(async () => {
  await sql`DELETE FROM fetch_runs WHERE source_id IN (${MINE}, ${OTHER})`;
  await sql`DELETE FROM sources WHERE id IN (${MINE}, ${OTHER})`;
  await sql`DELETE FROM job_runs WHERE job IN (${MY_JOB}, ${OTHER_JOB})`;
  await closeDb();
});

test("a restart closes its own interrupted records and leaves every other record alone", async () => {
  const mineRunning = await insertRun(MINE, "running");
  const otherRunning = await insertRun(OTHER, "running");
  const mineDone = await insertRun(MINE, "ok");
  const myJobRunning = await insertJob(MY_JOB, "running");
  const otherJobRunning = await insertJob(OTHER_JOB, "running");
  const myJobDone = await insertJob(MY_JOB, "ok");

  const closed = await closeInterruptedRuns({ sourceIds: [MINE], jobs: [MY_JOB] });
  assert.deepEqual(closed, { fetch: 1, job: 1 }, "exactly the scoped open records");

  const mine = await statusOf("fetch_runs", mineRunning);
  assert.equal(mine.status, "failed");
  assert.equal(mine.error, INTERRUPTED_RUN_ERROR, "the history says why the run has no result");
  assert.ok(mine.finished_at, "and when it was closed");

  assert.equal((await statusOf("fetch_runs", otherRunning)).status, "running", "another source's run is untouched");
  assert.equal((await statusOf("job_runs", otherJobRunning)).status, "running", "another job's run is untouched");
  assert.equal((await statusOf("fetch_runs", mineDone)).status, "ok", "a finished run is never rewritten");
  assert.equal((await statusOf("job_runs", myJobDone)).status, "ok");
});

test("closing interrupted records twice changes nothing the second time", async () => {
  await insertRun(MINE, "running");
  const first = await closeInterruptedRuns({ sourceIds: [MINE], jobs: [MY_JOB] });
  const second = await closeInterruptedRuns({ sourceIds: [MINE], jobs: [MY_JOB] });
  assert.equal(first.fetch, 1);
  assert.deepEqual(second, { fetch: 0, job: 0 }, "only open records are closed");
});

test("an empty scope closes nothing", async () => {
  const running = await insertRun(MINE, "running");
  assert.deepEqual(await closeInterruptedRuns({}), { fetch: 0, job: 0 });
  assert.equal((await statusOf("fetch_runs", running)).status, "running");
});

// The job history and the fetch history have to agree: a collection that returned "failed" is a failed
// job, not an ok one, or an operator reading job_runs sees a healthy schedule over a dead source.
test("a failed collection is a failed job, and a successful one is not", async () => {
  const failedJob = `radar.test.collect.failed.${T}`;
  const okJob = `radar.test.collect.ok.${T}`;
  const failed = await recordCollectionRun(failedJob, async () => ({ sourceId: MINE, status: "failed", found: 3, created: 0, revised: 0, error: "no local Chrome to render with", failureClass: "browser-unavailable" }));
  assert.equal(failed.status, "failed", "the caller still receives the result, for its backoff and logs");

  const ok = await recordCollectionRun(okJob, async () => ({ sourceId: MINE, status: "ok", found: 2, created: 2, revised: 0 }));
  assert.equal(ok.status, "ok");

  const rows = await sql<{ job: string; status: string; error: string | null }[]>`
    SELECT job, status, error FROM job_runs WHERE job IN (${failedJob}, ${okJob}) ORDER BY job`;
  const failedRow = rows.find((r) => r.job === failedJob)!;
  const okRow = rows.find((r) => r.job === okJob)!;
  assert.equal(failedRow.status, "failed");
  assert.match(String(failedRow.error), /no local Chrome/);
  assert.equal(okRow.status, "ok");
  assert.equal(okRow.error, null);
  await sql`DELETE FROM job_runs WHERE job IN (${failedJob}, ${okJob})`;
});

test("a skipped run is not reported as a failure", async () => {
  const job = `radar.test.collect.skipped.${T}`;
  const result = await recordCollectionRun(job, async () => ({ sourceId: MINE, status: "skipped", found: 0, created: 0, revised: 0 }));
  assert.equal(result.status, "skipped");
  const [row] = await sql<{ status: string }[]>`SELECT status FROM job_runs WHERE job = ${job}`;
  assert.equal(row!.status, "ok", "skipped is a decision, not a failure");
  await sql`DELETE FROM job_runs WHERE job = ${job}`;
});
