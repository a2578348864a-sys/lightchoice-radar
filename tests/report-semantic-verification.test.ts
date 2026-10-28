import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EDITION_TIMES, EDITION_WHEN } from "@aihot/site";
import { beijingAt, beijingDate, beijingTime, isoWeekRange, monthRange } from "@aihot/contracts/time";
import { reportDueAt, isReportDue, dueDaily, dueWeekly, dueMonthly } from "../packages/backend/src/reports/compose.ts";
import { reportReadableCondition } from "../packages/backend/src/publication/scope.ts";
import { sql } from "../packages/backend/src/db.ts";
import { loadReport } from "../packages/backend/src/publication/reports.ts";
import { loadItemDetail } from "../packages/backend/src/publication/detail.ts";

describe("P0-A: Monthly Report Due Time Verification", () => {
  it("EDITION_TIMES defines authoritative publication times", () => {
    assert.equal(EDITION_TIMES.daily, "08:00", "Daily edition time must be 08:00");
    assert.equal(EDITION_TIMES.weekly, "10:00", "Weekly edition time must be 10:00");
    assert.equal(EDITION_TIMES.monthly, "10:30", "Monthly edition time must be 10:30");
  });

  it("monthly report 2026-10 dueAt is precisely 2026-11-01 10:30 Beijing time", () => {
    const due = reportDueAt("monthly", "2026-10");
    // Beijing 2026-11-01 10:30:00 is UTC 2026-11-01 02:30:00.000Z
    assert.equal(due.toISOString(), "2026-11-01T02:30:00.000Z");
  });

  it("gate strictly blocks premature monthly publication at 5 required checkpoints", () => {
    // Checkpoint 1: 2026-10-27 21:22 Beijing (UTC 13:22)
    const t1 = new Date("2026-10-27T13:22:00.000Z");
    assert.equal(isReportDue("monthly", "2026-10", t1), false, "Must block at 2026-10-27 21:22");
    assert.notEqual(dueMonthly(t1), "2026-10", "dueMonthly must not include 2026-10");

    // Checkpoint 2: 2026-10-31 23:59:59 Beijing (UTC 15:59:59)
    const t2 = new Date("2026-10-31T15:59:59.000Z");
    assert.equal(isReportDue("monthly", "2026-10", t2), false, "Must block at 2026-10-31 23:59:59");
    assert.notEqual(dueMonthly(t2), "2026-10", "dueMonthly must not include 2026-10");

    // Checkpoint 3: 2026-11-01 08:00:00 Beijing (UTC 00:00:00)
    const t3 = new Date("2026-11-01T00:00:00.000Z");
    assert.equal(isReportDue("monthly", "2026-10", t3), false, "Must block at 2026-11-01 08:00");
    assert.equal(dueMonthly(t3), "2026-09", "dueMonthly at 08:00 must return 2026-09");

    // Checkpoint 4: 2026-11-01 10:29:59 Beijing (UTC 02:29:59)
    const t4 = new Date("2026-11-01T02:29:59.000Z");
    assert.equal(isReportDue("monthly", "2026-10", t4), false, "Must block at 2026-11-01 10:29:59");
    assert.equal(dueMonthly(t4), "2026-09", "dueMonthly at 10:29:59 must return 2026-09");

    // Checkpoint 5: 2026-11-01 10:30:00 Beijing (UTC 02:30:00)
    const t5 = new Date("2026-11-01T02:30:00.000Z");
    assert.equal(isReportDue("monthly", "2026-10", t5), true, "Must be due at 2026-11-01 10:30:00");
    assert.equal(dueMonthly(t5), "2026-10", "dueMonthly at 10:30:00 must return 2026-10");
  });

  it("cross-year monthly due calculation is accurate", () => {
    // 2026-12 monthly due on 2027-01-01 10:30
    const dueDec = reportDueAt("monthly", "2026-12");
    assert.equal(dueDec.toISOString(), "2027-01-01T02:30:00.000Z");

    const tBeforeNewYear = new Date("2027-01-01T02:29:00.000Z"); // 10:29 Beijing
    assert.equal(isReportDue("monthly", "2026-12", tBeforeNewYear), false);
    assert.equal(dueMonthly(tBeforeNewYear), "2026-11");

    const tAfterNewYear = new Date("2027-01-01T02:30:00.000Z"); // 10:30 Beijing
    assert.equal(isReportDue("monthly", "2026-12", tAfterNewYear), true);
    assert.equal(dueMonthly(tAfterNewYear), "2026-12");
  });
});

describe("P0-B: Report Readable Condition & Release Time Safety", () => {
  it("blocks unselected editorial items if visible_after is in the future", async () => {
    const futureTime = new Date(Date.now() + 86400000 * 30); // 30 days ahead
    const pastTime = new Date(Date.now() - 86400000); // 1 day ago

    // Mock query with SQL expression
    const [futureRow] = await sql<{ ok: boolean }[]>`
      SELECT (
        SELECT (${reportReadableCondition(new Date())})
        FROM (SELECT 'public' AS visibility, false AS eligible, false AS selected,
                     ${futureTime}::timestamptz AS visible_after, ${pastTime}::timestamptz AS timeline_at) p
        CROSS JOIN (SELECT 'editorial' AS participation_mode, 'industry-retail-dive' AS id) s
      ) AS ok`;
    assert.equal(futureRow.ok, false, "Unselected editorial with future visible_after must be BLOCKED");
  });

  it("blocks unselected editorial items if timeline_at is in the future", async () => {
    const futureTime = new Date(Date.now() + 86400000 * 30); // 30 days ahead
    const [futureTimeline] = await sql<{ ok: boolean }[]>`
      SELECT (
        SELECT (${reportReadableCondition(new Date())})
        FROM (SELECT 'public' AS visibility, false AS eligible, false AS selected,
                     null::timestamptz AS visible_after, ${futureTime}::timestamptz AS timeline_at) p
        CROSS JOIN (SELECT 'editorial' AS participation_mode, 'industry-retail-dive' AS id) s
      ) AS ok`;
    assert.equal(futureTimeline.ok, false, "Unselected editorial with future timeline_at must be BLOCKED");
  });

  it("permits unselected editorial items when visible_after and timeline_at have arrived", async () => {
    const pastTime = new Date(Date.now() - 86400000); // 1 day ago
    const [pastRow] = await sql<{ ok: boolean }[]>`
      SELECT (
        SELECT (${reportReadableCondition(new Date())})
        FROM (SELECT 'public' AS visibility, false AS eligible, false AS selected,
                     ${pastTime}::timestamptz AS visible_after, ${pastTime}::timestamptz AS timeline_at) p
        CROSS JOIN (SELECT 'editorial' AS participation_mode, 'industry-retail-dive' AS id) s
      ) AS ok`;
    assert.equal(pastRow.ok, true, "Unselected editorial with past visible_after must be PERMITTED");
  });

  it("blocks community RSS from editorial report eligibility", async () => {
    const pastTime = new Date(Date.now() - 86400000);
    const [commRow] = await sql<{ ok: boolean }[]>`
      SELECT (
        SELECT (${reportReadableCondition(new Date())})
        FROM (SELECT 'public' AS visibility, false AS eligible, false AS selected,
                     null::timestamptz AS visible_after, ${pastTime}::timestamptz AS timeline_at) p
        CROSS JOIN (SELECT 'editorial' AS participation_mode, 'rss-wyze-community' AS id) s
      ) AS ok`;
    assert.equal(commRow.ok, false, "Community RSS must be BLOCKED from report readability");
  });

  it("blocks withdrawn items regardless of editorial status", async () => {
    const pastTime = new Date(Date.now() - 86400000);
    const [withdrawnRow] = await sql<{ ok: boolean }[]>`
      SELECT (
        SELECT (${reportReadableCondition(new Date())})
        FROM (SELECT 'withdrawn' AS visibility, false AS eligible, false AS selected,
                     null::timestamptz AS visible_after, ${pastTime}::timestamptz AS timeline_at) p
        CROSS JOIN (SELECT 'editorial' AS participation_mode, 'industry-retail-dive' AS id) s
      ) AS ok`;
    assert.equal(withdrawnRow.ok, false, "Withdrawn item must be BLOCKED");
  });
});

describe("P0-C: Source Display Permissions & Full Text Safety", () => {
  it("confirms site_fulltext is false on all 3 industry editorial sources", async () => {
    const rows = await sql<{ id: string; site_fulltext: boolean; syndicate_fulltext: boolean }[]>`
      SELECT id, site_fulltext, syndicate_fulltext
      FROM sources
      WHERE id IN ('industry-modern-retail', 'industry-retail-dive', 'industry-supply-chain-dive')
    `;
    assert.equal(rows.length, 3, "All 3 sources must exist");
    for (const r of rows) {
      assert.equal(r.site_fulltext, false, `Source ${r.id} must have site_fulltext = false`);
      assert.equal(r.syndicate_fulltext, false, `Source ${r.id} must have syndicate_fulltext = false`);
    }
  });

  it("ensures item detail API sends null body for site_fulltext=false articles", async () => {
    const detail = await loadItemDetail("dduy4mntkwutf7xu6nkkh5uww");
    assert.equal(detail.kind, "found");
    if (detail.kind === "found") {
      assert.equal(detail.item.body, null, "item.body must be null for non-fulltext source");
      assert.ok(detail.item.links.original.startsWith("http"), "Original link must exist");
    }
  });
});

describe("P1-D: Report Readability Regressions Protected", () => {
  it("daily 2026-10-24 has 5 events, 3 sources, zero line-throughs", async () => {
    const daily = await loadReport("daily", "2026-10-24");
    assert.ok(daily);
    assert.equal(daily.metrics.totalEvents, 5);
    assert.equal(daily.metrics.sourcesCount, 3);
    const items = daily.sections.flatMap((s) => s.items);
    for (const it of items) {
      assert.equal(it.available, true);
      assert.ok(it.sourceUrl.startsWith("http"));
      assert.ok(it.sourceName.length > 0);
    }
  });

  it("weekly 2026-W43 has 14 events, 3 sources, zero line-throughs", async () => {
    const weekly = await loadReport("weekly", "2026-W43");
    assert.ok(weekly);
    assert.equal(weekly.metrics.totalStories, 14);
    const items = weekly.sections.flatMap((s) => s.items);
    for (const it of items) {
      assert.equal(it.available, true);
      assert.ok(it.sourceUrl.startsWith("http"));
      assert.ok(it.sourceName.length > 0);
    }
  });

  it("withdrawn monthly 2026-10 remains 404/null to readers", async () => {
    const monthly = await loadReport("monthly", "2026-10");
    assert.equal(monthly, null, "Withdrawn 2026-10 monthly must return null to reader");
  });
});
