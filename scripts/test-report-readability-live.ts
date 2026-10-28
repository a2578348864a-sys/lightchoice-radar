import assert from "node:assert/strict";
import { loadReport } from "../packages/backend/src/publication/reports.ts";
import { sql } from "../packages/backend/src/db.ts";

async function runTests() {
  console.log("=== Testing Report Readability & Eligibility ===");

  // 1. Test Daily 2026-10-21
  console.log("Testing loadReport('daily', '2026-10-21')...");
  const daily = await loadReport("daily", "2026-10-21");
  assert.ok(daily, "daily 2026-10-21 should exist");
  assert.equal(daily.kind, "daily");
  assert.equal(daily.key, "2026-10-21");

  const dailyItems = daily.sections.flatMap((s) => s.items);
  assert.ok(dailyItems.length > 0, "daily should have items");
  console.log(`Daily 2026-10-21 items count: ${dailyItems.length}`);
  
  for (const item of dailyItems) {
    assert.equal(item.available, true, `Item ${item.itemId} should be available`);
    assert.ok(item.title.length > 0, "Item should have title");
    assert.ok(item.sourceName.length > 0, "Item should have sourceName");
    assert.ok(item.sourceUrl.startsWith("http"), `Item ${item.itemId} should have http(s) sourceUrl, got ${item.sourceUrl}`);
  }

  assert.ok(daily.metrics.sourcesCount > 0, `Daily sourcesCount should be > 0, got ${daily.metrics.sourcesCount}`);
  console.log(`Daily 2026-10-21 sourcesCount: ${daily.metrics.sourcesCount} (PASSED)`);

  // 2. Test Weekly 2026-W43
  console.log("Testing loadReport('weekly', '2026-W43')...");
  const weekly = await loadReport("weekly", "2026-W43");
  assert.ok(weekly, "weekly 2026-W43 should exist");
  assert.equal(weekly.kind, "weekly");
  assert.equal(weekly.key, "2026-W43");

  const weeklyItems = weekly.sections.flatMap((s) => s.items);
  assert.ok(weeklyItems.length > 0, "weekly should have items");
  console.log(`Weekly 2026-W43 items count: ${weeklyItems.length}`);

  for (const item of weeklyItems) {
    assert.equal(item.available, true, `Item ${item.itemId} should be available`);
    assert.ok(item.title.length > 0, "Item should have title");
    assert.ok(item.sourceName.length > 0, "Item should have sourceName");
    assert.ok(item.sourceUrl.startsWith("http"), `Item ${item.itemId} should have http(s) sourceUrl, got ${item.sourceUrl}`);
  }

  assert.ok(weekly.metrics.totalStories > 0, `Weekly totalStories should be > 0, got ${weekly.metrics.totalStories}`);
  const weeklySources = new Set(weeklyItems.map((i) => i.sourceName)).size;
  assert.ok(weeklySources > 0, `Weekly should have distinct sources, got ${weeklySources}`);
  console.log(`Weekly 2026-W43 totalStories: ${weekly.metrics.totalStories}, distinct sources: ${weeklySources} (PASSED)`);

  // 3. Test Withdrawn Monthly 2026-10 is NOT public in normal loadReport
  console.log("Testing withdrawn 2026-10 monthly report...");
  const withdrawnMonthly = await loadReport("monthly", "2026-10");
  assert.equal(withdrawnMonthly, null, "Withdrawn monthly 2026-10 should return null (404) to public readers");
  console.log("Withdrawn monthly 2026-10 returns null to reader as expected (PASSED)");

  // 4. Test all existing daily reports have available items and sourcesCount > 0
  const dailyRows = await sql<{ key: string }[]>`
    SELECT key FROM reports WHERE kind = 'daily' ORDER BY key
  `;
  for (const row of dailyRows) {
    const rep = await loadReport("daily", row.key);
    assert.ok(rep, `Report daily ${row.key} should load`);
    const items = rep.sections.flatMap((s) => s.items);
    for (const item of items) {
      assert.equal(item.available, true, `Daily ${row.key} item ${item.itemId} must be available`);
      assert.ok(item.sourceName.length > 0, `Daily ${row.key} item ${item.itemId} must have sourceName`);
      assert.ok(item.sourceUrl.length > 0, `Daily ${row.key} item ${item.itemId} must have sourceUrl`);
    }
    if (items.length > 0) {
      assert.ok(rep.metrics.sourcesCount > 0, `Daily ${row.key} with ${items.length} items must have sourcesCount > 0, got ${rep.metrics.sourcesCount}`);
      console.log(`Daily ${row.key}: ${items.length} events, ${rep.metrics.sourcesCount} sources (PASSED)`);
    } else {
      assert.equal(rep.metrics.sourcesCount, 0, `Quiet daily ${row.key} should have sourcesCount = 0`);
      console.log(`Daily ${row.key}: Quiet day, 0 events, 0 sources (PASSED)`);
    }
  }

  console.log("=== ALL REPORT READABILITY TESTS PASSED ===");
  process.exit(0);
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
