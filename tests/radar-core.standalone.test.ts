import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "@aihot/backend/config";
import { classifyRadarText } from "@aihot/backend/editorial/radar-rules";
import { isCurrentMaterialHash } from "@aihot/backend/content/materials";
import { normalizeRadarMonitor } from "@aihot/backend/admin/radar-monitors";
import { radarExportMarkdown, type RadarExport } from "@aihot/backend/publication/radar";
import { paidRequest } from "@aihot/backend/providers/receipts";

test("Radar forces rule-only mode and blocks paid callbacks before network work", async () => {
  assert.equal(config.ruleOnlyMode, true);
  let called = false;
  await assert.rejects(
    () => paidRequest({} as never, async () => { called = true; throw new Error("paid callback must not run"); }),
    /Paid provider requests are disabled in LightChoice Radar mode/,
  );
  assert.equal(called, false);
});

test("Radar rules return source-field offsets and leave unrelated text unclassified", () => {
  const title = "Buyer says the new product is not charging";
  const result = classifyRadarText({ title, excerpt: "I need an alternative to this model." });
  assert.deepEqual(result.tags, ["线索：产品问题", "线索：新品提及", "线索：替代需求"]);
  const charging = result.evidence.find((e) => e.matchedText === "not charging");
  assert.ok(charging);
  assert.equal(title.slice(charging.start, charging.end), charging.matchedText);
  assert.equal(charging.field, "title");
  assert.deepEqual(classifyRadarText({ title: "Quarterly report published" }).tags, []);
});

test("A to B to A is a new current revision; only the current hash is a duplicate", () => {
  const a = "hash-a";
  const b = "hash-b";
  assert.equal(isCurrentMaterialHash(a, a), true);
  assert.equal(isCurrentMaterialHash(a, b), false);
  assert.equal(isCurrentMaterialHash(b, a), false);
});

test("saved keyword monitors normalize whitespace and reject empty fields", () => {
  assert.deepEqual(normalizeRadarMonitor({ name: "  门锁反馈  ", query: " smart   lock  battery " }), { name: "门锁反馈", query: "smart lock battery" });
  assert.throws(() => normalizeRadarMonitor({ name: "", query: "battery" }), /监控名称不能为空/);
  assert.throws(() => normalizeRadarMonitor({ name: "电池", query: "  " }), /关键词不能为空/);
});

test("Markdown export preserves source, collection time, and rule evidence", () => {
  const text = radarExportMarkdown({
    generatedAt: "2026-10-21T00:00:00.000Z",
    filters: { q: null, from: null, to: null, channel: "all", category: null, tag: null },
    total: 1, truncated: false,
    items: [{
      id: "abc", title: "Battery stopped working", summary: "Battery failed after one week", reason: null,
      source: { name: "Forum" }, originalUrl: "https://example.test/item/1", publishedAt: null, discoveredAt: "2026-10-20T16:00:00.000Z",
      timelineAt: "2026-10-20T16:00:00.000Z", category: null, tags: ["线索：产品问题"], score: null, selected: false, channel: "news",
      x: null, ruleVersion: "radar-rules-v1", ruleEvidence: [{ ruleId: "product-problem", label: "产品问题线索", field: "title", start: 8, end: 26, matchedText: "stopped working", context: "Battery stopped working" }],
    }],
  } as RadarExport);
  assert.match(text, /https:\/\/example\.test\/item\/1/);
  assert.match(text, /收录时间/);
  assert.match(text, /产品问题线索/);
  assert.match(text, /stopped working/);
});
