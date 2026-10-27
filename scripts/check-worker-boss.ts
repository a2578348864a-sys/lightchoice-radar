import { sql } from "../packages/backend/src/db.ts";

async function main() {
  try {
    const schedules = await sql`SELECT name, cron, timezone, data FROM pgboss.schedule`;
    console.log("pgboss.schedule:", JSON.stringify(schedules, null, 2));

    const jobs = await sql`
      SELECT id, name, state, created_on, started_on, completed_on, output
      FROM pgboss.job
      WHERE name LIKE '%report%' OR name LIKE '%schedule%' OR name LIKE '%cron%'
      ORDER BY created_on DESC
      LIMIT 20
    `;
    console.log("pgboss.job (report/schedule):", JSON.stringify(jobs, null, 2));

    const recentJobs = await sql`
      SELECT id, name, state, created_on, started_on, completed_on
      FROM pgboss.job
      ORDER BY created_on DESC
      LIMIT 10
    `;
    console.log("pgboss.job (latest 10):", JSON.stringify(recentJobs, null, 2));
    const cols = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'job_runs'
    `;
    console.log("job_runs columns:", cols.map((c: any) => c.column_name));

    const reportRuns = await sql`
      SELECT *
      FROM job_runs
      WHERE job LIKE '%report%'
      ORDER BY id DESC
      LIMIT 10
    `;
    console.log("job_runs (report):", JSON.stringify(reportRuns, null, 2));
  } catch (err) {
    console.error("Error querying boss tables:", err);
  } finally {
    await sql.end();
  }
}

main();
