// The boundary rules that keep the announcement index's body gate correct over time: what a run may
// re-admit, when a remembered rejection expires, and what a damaged cursor does. These are the failure
// modes that would otherwise either lose a real policy forever or re-read the same pages every run.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AMAZON_POLICY_GATE_VERSION,
  AMAZON_US_ANNOUNCEMENTS_SOURCE_ID,
  archiveWindowFloor,
  keepsArchiveWindowOnEveryRun,
  nextPolicyGateMemory,
  policyGateRejections,
} from "@aihot/backend/sources/radar-policy-source";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 23, 6, 0, 0);
const STALE = 48 * 60 * 60 * 1000;
const base = { kind: "web_list", firstImport: false, months: 13, initializedAt: new Date(NOW - 30 * DAY).toISOString(), now: NOW, staleMs: STALE };

test("only the body-gated announcement index keeps its archive window on every run", () => {
  assert.equal(keepsArchiveWindowOnEveryRun(AMAZON_US_ANNOUNCEMENTS_SOURCE_ID), true);
  assert.equal(keepsArchiveWindowOnEveryRun("amazon-us-fee-updates"), false);
  assert.equal(keepsArchiveWindowOnEveryRun("rss-cpsc-recalls"), false);
});

test("the announcement index admits its whole configured window on every run", () => {
  const later = archiveWindowFloor({ ...base, sourceId: AMAZON_US_ANNOUNCEMENTS_SOURCE_ID });
  assert.equal(later, NOW - 13 * 30 * DAY, "a policy listed inside the window is always re-admitted");
  const first = archiveWindowFloor({ ...base, sourceId: AMAZON_US_ANNOUNCEMENTS_SOURCE_ID, firstImport: true });
  assert.equal(first, later, "the first import and later runs share the window");
});

test("a source without the gate admits history only on its first import", () => {
  const later = archiveWindowFloor({ ...base, sourceId: "amazon-us-fee-updates" });
  assert.equal(later, NOW - 30 * DAY - STALE, "later runs stop at the source's own start, less the stale window");
  const first = archiveWindowFloor({ ...base, sourceId: "amazon-us-fee-updates", firstImport: true });
  assert.equal(first, NOW - 13 * 30 * DAY);
  assert.equal(archiveWindowFloor({ ...base, sourceId: "x-account", kind: "x_search" }), null, "an X search is bounded by its watermark");
});

test("a corrupt start time falls back to the bounded window instead of admitting everything", () => {
  for (const initializedAt of [null, "", "not-a-date", "NaN"]) {
    const floor = archiveWindowFloor({ ...base, sourceId: "amazon-us-fee-updates", initializedAt });
    assert.equal(floor, NOW - 13 * 30 * DAY, String(initializedAt));
    assert.ok(Number.isFinite(floor!), "never NaN, which every comparison would treat as 'admit'");
  }
  // A months value that cannot be used falls back to a year, not to an unbounded window.
  assert.equal(archiveWindowFloor({ ...base, sourceId: AMAZON_US_ANNOUNCEMENTS_SOURCE_ID, months: Number.NaN }), NOW - 12 * 30 * DAY);
  assert.equal(archiveWindowFloor({ ...base, sourceId: AMAZON_US_ANNOUNCEMENTS_SOURCE_ID, months: 0 }), NOW - 12 * 30 * DAY);
});

test("the window is what bounds history, so widening it is the only way to reach older entries", () => {
  const twelveMonthsOld = NOW - 12 * 30 * DAY;
  const wide = archiveWindowFloor({ ...base, sourceId: AMAZON_US_ANNOUNCEMENTS_SOURCE_ID, months: 13 });
  const narrow = archiveWindowFloor({ ...base, sourceId: AMAZON_US_ANNOUNCEMENTS_SOURCE_ID, months: 1 });
  assert.ok(twelveMonthsOld > wide!, "inside a 13-month window");
  assert.ok(twelveMonthsOld < narrow!, "outside a 1-month window");
});

test("a rejection is remembered only under the gate version that made it", () => {
  const v = AMAZON_POLICY_GATE_VERSION;
  assert.deepEqual([...policyGateRejections({ version: v, rejected: ["url:a", "url:b"] })], ["url:a", "url:b"]);
  assert.deepEqual([...policyGateRejections({ version: `${v}-older`, rejected: ["url:a"] })], [], "a new gate reads them again");
  assert.deepEqual([...policyGateRejections({ version: "amazon-policy-gate-v0", rejected: ["url:a"] })], [], "so does an upgrade");
  assert.deepEqual([...policyGateRejections({ version: v, rejected: [1 as never, "url:a", null as never] })], ["url:a"], "only identities");
});

test("a damaged gate cursor never disables the gate's memory or the source", () => {
  const v = AMAZON_POLICY_GATE_VERSION;
  for (const memory of [undefined, null, "broken", 42 as never, { version: v } as never, { version: v, rejected: "url:a" as never }]) {
    assert.deepEqual([...policyGateRejections(memory as never)], [], JSON.stringify(memory));
  }
  // A damaged memory must not throw while writing the next one.
  const repaired = nextPolicyGateMemory("broken" as never, ["url:a"]);
  assert.equal(repaired.version, v);
  assert.deepEqual(repaired.rejected, ["url:a"]);
});

test("the memory is deduplicated, keeps this run's rejections first, and stays bounded", () => {
  const v = AMAZON_POLICY_GATE_VERSION;
  const merged = nextPolicyGateMemory({ version: v, rejected: ["url:a"] }, ["url:b", "url:b"]);
  assert.deepEqual(merged.rejected, ["url:b", "url:a"]);

  const bounded = nextPolicyGateMemory({ version: v, rejected: Array.from({ length: 400 }, (_, i) => `url:${i}`) }, ["url:new"]);
  assert.equal(bounded.rejected.length, 300);
  assert.equal(bounded.rejected[0], "url:new");

  assert.deepEqual(
    nextPolicyGateMemory({ version: `${v}-older`, rejected: ["url:old"] }, ["url:new"]).rejected,
    ["url:new"],
    "a gate change starts a fresh memory instead of carrying stale rejections",
  );
});
