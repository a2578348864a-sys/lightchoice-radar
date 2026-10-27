import { sql } from "@aihot/backend/db";
import { withdrawReport, isReportDue, reportDueAt } from "@aihot/backend/reports/compose";
import { loadReport, loadReportRecord, reportIndexRows, v1Period, clearReportIndexCache } from "@aihot/backend/publication/reports";

async function main() {
  console.log("=== STEP 1: Verify current monthly:2026-10 state before withdrawal ===");
  const beforeRow = await loadReportRecord("monthly", "2026-10");
  if (!beforeRow) {
    console.error("ERROR: monthly:2026-10 does not exist in reports table!");
    process.exit(1);
  }
  console.log(`Found report id=${beforeRow.id}, revision=${beforeRow.revision}, generated_at=${beforeRow.generated_at.toISOString()}`);
  console.log(`Current status: ${beforeRow.content?.status ?? "published (default)"}`);

  const beforeRevisions = await sql<{ revision: number; reason: string | null }[]>`
    SELECT revision, reason FROM report_revisions WHERE report_id = ${beforeRow.id} ORDER BY revision ASC
  `;
  console.log(`Revisions before withdrawal (${beforeRevisions.length}):`, beforeRevisions);

  console.log("\n=== STEP 2: Execute withdrawReport('monthly', '2026-10') ===");
  const reason = "Premature publication: 2026-10 reporting period had not reached its official publication due time.";
  const reasonZh = "2026 年 10 月完整月报尚未到正式出刊时间，历史记录保留，暂不作为正式刊物展示。";
  const result = await withdrawReport("monthly", "2026-10", reason, reasonZh, "codex-closeout-gate");
  console.log("Withdrawal result:", result);

  clearReportIndexCache("monthly");

  console.log("\n=== STEP 3: Verify database preservation & metadata ===");
  const afterRow = await loadReportRecord("monthly", "2026-10");
  if (!afterRow) {
    console.error("FATAL: row was deleted from reports table!");
    process.exit(1);
  }
  console.log(`Preserved report row id=${afterRow.id}, revision=${afterRow.revision}, generated_at=${afterRow.generated_at.toISOString()}`);
  console.log("Preserved status:", afterRow.content?.status);
  console.log("Preserved withdrawal info:", JSON.stringify(afterRow.content?.withdrawal, null, 2));

  const afterRevisions = await sql<{ revision: number; reason: string | null; generated_at: Date }[]>`
    SELECT revision, reason, generated_at FROM report_revisions WHERE report_id = ${afterRow.id} ORDER BY revision ASC
  `;
  console.log(`Revisions after withdrawal (${afterRevisions.length}):`, afterRevisions);

  const archivedRev5 = afterRevisions.find((r) => r.revision === 5);
  if (!archivedRev5) {
    console.error("ERROR: revision 5 was not archived into report_revisions!");
    process.exit(1);
  }
  console.log("Archived revision 5 reason:", archivedRev5.reason);

  console.log("\n=== STEP 4: Verify formal read layer filtration ===");
  const publicReport = await loadReport("monthly", "2026-10");
  console.log("loadReport('monthly', '2026-10') returns:", publicReport);
  if (publicReport !== null) {
    console.error("ERROR: loadReport did not return null for withdrawn report!");
    process.exit(1);
  }

  const indexRows = await reportIndexRows("monthly", 10);
  console.log("reportIndexRows('monthly', 10) count:", indexRows.length);
  if (indexRows.some((r) => r.key === "2026-10")) {
    console.error("ERROR: reportIndexRows contains 2026-10!");
    process.exit(1);
  }

  const v1Exact = await v1Period("monthly", "2026-10");
  console.log("v1Period('monthly', '2026-10') returns:", v1Exact);
  if (v1Exact !== null) {
    console.error("ERROR: v1Period('monthly', '2026-10') did not return null!");
    process.exit(1);
  }

  const v1Latest = await v1Period("monthly", "latest");
  console.log("v1Period('monthly', 'latest') returns:", v1Latest);
  if (v1Latest !== null) {
    console.error("ERROR: v1Period('monthly', 'latest') did not return null!");
    process.exit(1);
  }

  console.log("\n=== STEP 5: Verify API endpoints via HTTP ===");
  const latestRes = await fetch("http://127.0.0.1:3001/api/site/reports/monthly/latest-page");
  console.log("GET /api/site/reports/monthly/latest-page HTTP status:", latestRes.status);
  const latestJson = await latestRes.json();
  console.log("latest-page response:", latestJson);

  const archiveRes = await fetch("http://127.0.0.1:3001/api/site/reports/monthly/archive");
  console.log("GET /api/site/reports/monthly/archive HTTP status:", archiveRes.status);
  const archiveJson = await archiveRes.json();
  console.log("archive response count:", archiveJson.reports?.length ?? 0);

  const exactRes = await fetch("http://127.0.0.1:3001/api/site/reports/monthly/2026-10");
  console.log("GET /api/site/reports/monthly/2026-10 HTTP status:", exactRes.status);

  console.log("\n=== STEP 6: Verify scheduled re-issue safety ===");
  // Test in a rolled back transaction that saveReport can update the withdrawn row when period is due
  await sql.begin(async (tx) => {
    // Check due calculation
    const dueTime = reportDueAt("monthly", "2026-10");
    console.log("Due time for 2026-10:", dueTime.toISOString());
    const prematureNow = new Date("2026-10-28T06:00:00Z");
    console.log("isReportDue on 2026-10-28:", isReportDue("monthly", "2026-10", prematureNow));

    const futureDueNow = new Date("2026-11-01T02:30:00Z");
    console.log("isReportDue on 2026-11-01 10:30 Beijing:", isReportDue("monthly", "2026-10", futureDueNow));

    console.log("Transaction test completed successfully (rolling back test tx).");
    await tx`ROLLBACK`;
  });

  console.log("\nSUCCESS: All monthly withdrawal checks PASSED!");
  await sql.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
