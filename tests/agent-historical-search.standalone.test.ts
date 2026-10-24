import assert from "node:assert/strict";
import { test } from "node:test";
import { searchAnswer, searchItems } from "@aihot/backend/publication/agent";
import { parseHistoricalSearchRange } from "@aihot/backend/publication/search-range";
import type { V1ItemsQuery, V1ItemsResult } from "@aihot/backend/publication/v1";

const emptyResult: V1ItemsResult = {
  schemaVersion: 1,
  query: { mode: "all", category: null, window: "7d", q: "amazon", by: "timeline", ordering: "timelineDesc" },
  items: [],
  page: { count: 0, hasMore: false, nextCursor: null },
};

test("historical Agent ranges are inclusive Beijing calendar days and are bounded", () => {
  assert.deepEqual(parseHistoricalSearchRange(), { range: null });
  const parsed = parseHistoricalSearchRange("2025-10-15", "2025-10-15");
  assert.ok("range" in parsed);
  if (!parsed.range) throw new Error("expected a parsed range");
  assert.equal(parsed.range.start.toISOString(), "2025-10-14T16:00:00.000Z");
  assert.equal(parsed.range.endExclusive.toISOString(), "2025-10-15T16:00:00.000Z");
  const incomplete = parseHistoricalSearchRange("2025-10-15");
  assert.ok("error" in incomplete);
  assert.equal("error" in parseHistoricalSearchRange("2025-02-29", "2025-03-01"), true);
  assert.equal("error" in parseHistoricalSearchRange("2025-10-16", "2025-10-15"), true);
  assert.ok("error" in parseHistoricalSearchRange("2024-10-14", "2025-10-15"));
  assert.ok("range" in parseHistoricalSearchRange("2024-10-15", "2025-10-15"));
});

test("a historical search uses publication dates; omitted dates preserve the rolling-window search", async () => {
  const seen: V1ItemsQuery[] = [];
  const load = async (query: V1ItemsQuery) => {
    seen.push(query);
    return emptyResult;
  };
  const parsed = parseHistoricalSearchRange("2025-10-15", "2025-10-15");
  if (!("range" in parsed) || !parsed.range) throw new Error("expected a parsed range");

  await searchItems("amazon", "7d", null, 10, load, parsed.range);
  assert.equal(seen.length, 2);
  assert.equal(seen[0]!.by, "published");
  assert.equal(seen[0]!.publishedRange?.from, "2025-10-15");
  assert.equal(seen[0]!.publishedRange?.to, "2025-10-15");

  seen.length = 0;
  await searchItems("amazon", "7d", null, 10, load);
  assert.equal(seen.length, 2);
  assert.equal(seen[0]!.by, "timeline");
  assert.equal(seen[0]!.publishedRange, undefined);
});

test("historical search answers name the requested dates and do not claim the rolling window", () => {
  const answer = searchAnswer({ res: emptyResult, expanded: true }, {
    q: "amazon", window: "7d", category: null, publishedRange: { from: "2025-10-15", to: "2025-10-15" },
  });
  assert.match(answer, /2025-10-15 至 2025-10-15/);
  assert.doesNotMatch(answer, /最近 7 天/);
  assert.match(answer, /指定发布时间范围内/);
});

test("date-only source publications are not presented as exact publication times", () => {
  const result: V1ItemsResult = {
    ...emptyResult,
    items: [{
      id: "date-only-item", title: "At Accelerate 2026, Amazon shares new AI tools", originalTitle: null,
      summary: "Official source summary", source: { name: "Amazon Selling Partners" },
      links: { aihot: "http://localhost:3000/items/date-only-item", original: "https://sellingpartners.aboutamazon.com/accelerate-2026-recap" },
      publishedAt: "2026-09-29T00:00:00.000Z", publishedDate: "2026-09-29", discoveredAt: "2026-10-21T18:48:18.727Z",
      category: null, score: null, selected: false, reason: null,
      attribution: { name: "LightChoice Radar", url: "http://localhost:3000/items/date-only-item" },
    }],
    page: { count: 1, hasMore: false, nextCursor: null },
  };
  const answer = searchAnswer({ res: result, expanded: true }, { q: "Accelerate", window: "7d", category: null, publishedRange: { from: "2026-09-29", to: "2026-09-29" } });
  assert.match(answer, /发布于 2026-09-29/);
  assert.doesNotMatch(answer, /09-29 08:00/);
});
