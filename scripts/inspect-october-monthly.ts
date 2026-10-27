import { sql } from "../packages/backend/src/db.ts";

async function main() {
  const cols = await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'reports'
    ORDER BY ordinal_position
  `;
  console.log("reports table columns:", cols);

  const [row] = await sql`
    SELECT id, kind, key, window_start, window_end, generated_at, revision, model, origin,
           content->>'title' AS title, content->'metrics' AS metrics
    FROM reports
    WHERE kind = 'monthly' AND key = '2026-10'
  `;
  console.log("monthly:2026-10 summary:", row);

  // Check revisions
  const revisions = await sql`
    SELECT *
    FROM report_revisions
    WHERE report_id = ${row?.id ?? 0}
  `;
  console.log("revisions for 2026-10:", JSON.stringify(revisions, null, 2));

  // Check report_revisions schema
  const revCols = await sql`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'report_revisions'
    ORDER BY ordinal_position
  `;
  console.log("report_revisions table schema:", JSON.stringify(revCols, null, 2));

  // Check unique constraints and indexes on reports
  const indexes = await sql`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE tablename = 'reports'
  `;
  console.log("reports indexes:", JSON.stringify(indexes, null, 2));

  await sql.end();
}

main().catch(console.error);
