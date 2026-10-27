import assert from "node:assert/strict";
import { test } from "node:test";
import {
  reportDueAt,
  isReportDue,
  dueDaily,
  dueWeekly,
  dueMonthly,
  composeDaily,
  composeWeekly,
  composeMonthly,
} from "@aihot/backend/reports/compose";

test("reportDueAt & isReportDue: accurately calculate publication eligibility times", () => {
  // 1. Daily 2026-10-28: due at 2026-10-28 08:00 Beijing (2026-10-28T00:00:00.000Z)
  const dailyDue = reportDueAt("daily", "2026-10-28");
  assert.equal(dailyDue.toISOString(), "2026-10-28T00:00:00.000Z");

  const beforeDaily = new Date("2026-10-27T23:59:59.000Z"); // 07:59:59 Beijing
  const atDaily = new Date("2026-10-28T00:00:00.000Z");     // 08:00:00 Beijing
  assert.equal(isReportDue("daily", "2026-10-28", beforeDaily), false);
  assert.equal(isReportDue("daily", "2026-10-28", atDaily), true);

  // 2. Weekly 2026-W43 (2026-10-19 to 2026-10-25): due on Monday 2026-10-26 10:00 Beijing (2026-10-26T02:00:00.000Z)
  const weeklyDue = reportDueAt("weekly", "2026-W43");
  assert.equal(weeklyDue.toISOString(), "2026-10-26T02:00:00.000Z");

  const beforeWeekly = new Date("2026-10-26T01:59:59.000Z"); // Monday 09:59:59 Beijing
  const atWeekly = new Date("2026-10-26T02:00:00.000Z");     // Monday 10:00:00 Beijing
  assert.equal(isReportDue("weekly", "2026-W43", beforeWeekly), false);
  assert.equal(isReportDue("weekly", "2026-W43", atWeekly), true);

  // 3. Monthly 2026-10 (2026-10-01 to 2026-10-31): due on next month 1st 2026-11-01 10:30 Beijing (2026-11-01T02:30:00.000Z)
  const monthlyDue = reportDueAt("monthly", "2026-10");
  assert.equal(monthlyDue.toISOString(), "2026-11-01T02:30:00.000Z");

  const beforeMonthly = new Date("2026-10-28T00:00:00.000Z");  // 2026-10-28 is premature!
  const monthEnd = new Date("2026-10-31T15:59:59.000Z");       // 2026-10-31 23:59:59 Beijing is premature!
  const atMonthly = new Date("2026-11-01T02:30:00.000Z");      // 2026-11-01 10:30:00 Beijing
  assert.equal(isReportDue("monthly", "2026-10", beforeMonthly), false);
  assert.equal(isReportDue("monthly", "2026-10", monthEnd), false);
  assert.equal(isReportDue("monthly", "2026-10", atMonthly), true);
});

test("dueDaily, dueWeekly, dueMonthly: return correct periods based on Beijing edition times", () => {
  // On 2026-10-28 05:00 Beijing (before daily 08:00)
  const earlyOct28 = new Date("2026-10-27T21:00:00.000Z");
  assert.equal(dueDaily(earlyOct28), "2026-10-27");
  assert.equal(dueWeekly(earlyOct28), "2026-W43");
  // October 2026 has NOT ended yet; dueMonthly must return 2026-09
  assert.equal(dueMonthly(earlyOct28), "2026-09");

  // On 2026-10-28 09:00 Beijing (after daily 08:00)
  const afterDailyOct28 = new Date("2026-10-28T01:00:00.000Z");
  assert.equal(dueDaily(afterDailyOct28), "2026-10-28");
  assert.equal(dueWeekly(afterDailyOct28), "2026-W43");
  assert.equal(dueMonthly(afterDailyOct28), "2026-09");

  // On 2026-11-01 11:00 Beijing (after monthly 10:30)
  const afterMonthlyNov1 = new Date("2026-11-01T03:00:00.000Z");
  assert.equal(dueMonthly(afterMonthlyNov1), "2026-10");
});

test("Server-side anti-premature gate: rejects premature publication attempts with clear errors", async () => {
  const currentNow = new Date("2026-10-28T00:00:00.000Z"); // 2026-10-28 08:00 Beijing

  // 1. Premature Daily (2026-10-29 is in the future)
  await assert.rejects(
    composeDaily("2026-10-29", "publish", currentNow),
    /daily 2026-10-29 is not yet due for publication/
  );

  // 2. Premature Weekly (2026-W44 ends on 2026-11-01, due 2026-11-02 10:00 Beijing)
  await assert.rejects(
    composeWeekly("2026-W44", "publish", currentNow),
    /weekly 2026-W44 is not yet due for publication/
  );

  // 3. Premature Monthly (2026-10 ends on 2026-10-31, due 2026-11-01 10:30 Beijing)
  await assert.rejects(
    composeMonthly("2026-10", "publish", currentNow),
    /monthly 2026-10 is not yet due for publication/
  );
});
