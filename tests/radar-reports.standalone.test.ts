import assert from "node:assert/strict";
import { test } from "node:test";
import { composeDaily, composeWeekly, composeMonthly } from "@aihot/backend/reports/compose";
import { loadReport } from "@aihot/backend/publication/reports";
import { sql } from "@aihot/backend/db";

test("Radar report engine: composes daily, weekly, and monthly reports without model dependency", async () => {
  // Test daily composition for 2026-10-27
  const dailyRes = await composeDaily("2026-10-27", "test");
  assert.equal(dailyRes.key, "2026-10-27");
  assert.ok(dailyRes.entries >= 0);

  const dailyReport = await loadReport("daily", "2026-10-27");
  assert.ok(dailyReport);
  assert.equal(dailyReport.kind, "daily");
  assert.equal(dailyReport.key, "2026-10-27");
  assert.ok(dailyReport.title.includes("2026-10-27"));

  // Test quiet daily composition for a day with no publications
  const quietRes = await composeDaily("2026-10-20", "test");
  assert.equal(quietRes.key, "2026-10-20");
  assert.equal(quietRes.entries, 0);

  const quietReport = await loadReport("daily", "2026-10-20");
  assert.ok(quietReport);
  assert.equal(quietReport.kind, "daily");
  assert.equal(quietReport.key, "2026-10-20");

  // Test weekly composition for 2026-W43
  const weeklyRes = await composeWeekly("2026-W43", "test");
  assert.ok(weeklyRes);
  assert.equal(weeklyRes.key, "2026-W43");

  const weeklyReport = await loadReport("weekly", "2026-W43");
  assert.ok(weeklyReport);
  assert.equal(weeklyReport.kind, "weekly");
  assert.equal(weeklyReport.key, "2026-W43");
  assert.ok(weeklyReport.sections.length > 0);

  // Test monthly composition for 2026-10
  const monthlyRes = await composeMonthly("2026-10", "test");
  assert.ok(monthlyRes);
  assert.equal(monthlyRes.key, "2026-10");

  const monthlyReport = await loadReport("monthly", "2026-10");
  assert.ok(monthlyReport);
  assert.equal(monthlyReport.kind, "monthly");
  assert.equal(monthlyReport.key, "2026-10");

  await sql.end();
});
