import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { AMAZON_US_ANNOUNCEMENTS_SOURCE_ID, RADAR_REGULATORY_SOURCE_IDS, type RadarRegulatorySourceId } from "@aihot/backend/sources/radar-policy-source";
import type { SourceRow } from "@aihot/backend/sources/types";
import { selectRunnableSources } from "../apps/worker/src/source-selection.ts";

// The real declared configs, so the test proves the sources that ship in industry/sources.json are
// the ones the worker accepts — not a hand-made approximation.
const pack = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8")) as {
  sources: Array<{ id: string; kind: SourceRow["kind"]; config: Record<string, any> }>;
};

function row(id: string, overrides: Partial<SourceRow> = {}): SourceRow {
  const declared = pack.sources.find((source) => source.id === id);
  assert.ok(declared, `${id} is declared in industry/sources.json`);
  return {
    id,
    name: id,
    kind: declared!.kind,
    config: declared!.config,
    tier: "T1",
    participation_mode: "editorial",
    first_party: false,
    interval_minutes: 60,
    enabled: true,
    cursor: null,
    fail_count: 0,
    ...overrides,
  };
}

const regulatoryRows = (
  enabled: Partial<Record<RadarRegulatorySourceId, boolean>> = {},
): Partial<Record<RadarRegulatorySourceId, SourceRow>> =>
  Object.fromEntries(RADAR_REGULATORY_SOURCE_IDS.map((id) => [id, row(id, { enabled: enabled[id] ?? true })]));

test("all four approved sources run when they are enabled and on their official configs", () => {
  const selection = selectRunnableSources({ announcements: row(AMAZON_US_ANNOUNCEMENTS_SOURCE_ID), regulatory: regulatoryRows() });
  assert.deepEqual(selection.announcements, { id: AMAZON_US_ANNOUNCEMENTS_SOURCE_ID, intervalMinutes: 60 });
  assert.deepEqual(selection.regulatory.map((entry) => entry.id), [...RADAR_REGULATORY_SOURCE_IDS]);
  assert.deepEqual(selection.skipped, []);
  assert.equal(selection.allUnavailable, false);
});

test("a disabled announcements source is skipped while the regulatory sources keep running", () => {
  const selection = selectRunnableSources({ announcements: row(AMAZON_US_ANNOUNCEMENTS_SOURCE_ID, { enabled: false }), regulatory: regulatoryRows() });
  assert.equal(selection.announcements, null);
  assert.deepEqual(selection.regulatory.map((entry) => entry.id), [...RADAR_REGULATORY_SOURCE_IDS]);
  assert.deepEqual(selection.skipped, [{ id: AMAZON_US_ANNOUNCEMENTS_SOURCE_ID, reason: "source disabled" }]);
  assert.equal(selection.allUnavailable, false);
});

test("one disabled regulatory source does not stop the other two", () => {
  const selection = selectRunnableSources({
    announcements: row(AMAZON_US_ANNOUNCEMENTS_SOURCE_ID),
    regulatory: regulatoryRows({ "us-federal-register-ftc": false }),
  });
  assert.deepEqual(selection.regulatory.map((entry) => entry.id), ["rss-cpsc-recalls", "us-federal-register-cpsc"]);
  assert.deepEqual(selection.skipped, [{ id: "us-federal-register-ftc", reason: "source disabled" }]);
  assert.ok(selection.announcements);
  assert.equal(selection.allUnavailable, false);
});

test("a source whose config is off the allowlist is skipped, even while enabled", () => {
  const wrongAnnouncements = row(AMAZON_US_ANNOUNCEMENTS_SOURCE_ID, { config: { ...row(AMAZON_US_ANNOUNCEMENTS_SOURCE_ID).config, url: "https://sell.amazon.com/blog/" } });
  const wrongFeed = row("us-federal-register-cpsc", { config: { feedUrl: "https://example.com/documents.rss" } });
  const selection = selectRunnableSources({
    announcements: wrongAnnouncements,
    regulatory: { ...regulatoryRows(), "us-federal-register-cpsc": wrongFeed },
  });
  assert.equal(selection.announcements, null);
  assert.deepEqual(selection.regulatory.map((entry) => entry.id), ["rss-cpsc-recalls", "us-federal-register-ftc"]);
  assert.deepEqual(selection.skipped.map((entry) => entry.id).sort(), [AMAZON_US_ANNOUNCEMENTS_SOURCE_ID, "us-federal-register-cpsc"].sort());
  assert.ok(selection.skipped.every((entry) => entry.reason === "config is not on the approved allowlist"));
  assert.equal(selection.allUnavailable, false);
});

test("a missing source row is skipped rather than crashing the worker", () => {
  const selection = selectRunnableSources({
    announcements: null,
    regulatory: { "rss-cpsc-recalls": row("rss-cpsc-recalls"), "us-federal-register-cpsc": null, "us-federal-register-ftc": row("us-federal-register-ftc") },
  });
  assert.deepEqual(selection.regulatory.map((entry) => entry.id), ["rss-cpsc-recalls", "us-federal-register-ftc"]);
  assert.deepEqual(selection.skipped, [
    { id: AMAZON_US_ANNOUNCEMENTS_SOURCE_ID, reason: "source row missing" },
    { id: "us-federal-register-cpsc", reason: "source row missing" },
  ]);
});

test("nothing runnable is reported so the worker can exit instead of idling", () => {
  const selection = selectRunnableSources({
    announcements: row(AMAZON_US_ANNOUNCEMENTS_SOURCE_ID, { enabled: false }),
    regulatory: regulatoryRows({ "rss-cpsc-recalls": false, "us-federal-register-cpsc": false, "us-federal-register-ftc": false }),
  });
  assert.equal(selection.allUnavailable, true);
  assert.equal(selection.announcements, null);
  assert.deepEqual(selection.regulatory, []);
  assert.equal(selection.skipped.length, 4);
});

test("the accelerated recap source can never be selected, even when re-enabled", () => {
  // It is not one of the four approved sources, so the selector has no slot for it at all.
  const selection = selectRunnableSources({
    announcements: row("amazon-us-accelerate-updates", { enabled: true }),
    regulatory: regulatoryRows({ "rss-cpsc-recalls": false, "us-federal-register-cpsc": false, "us-federal-register-ftc": false }),
  });
  assert.equal(selection.announcements, null);
  assert.deepEqual(selection.regulatory, []);
  assert.equal(selection.allUnavailable, true);
  assert.deepEqual(selection.skipped.map((entry) => entry.id).sort(), [
    AMAZON_US_ANNOUNCEMENTS_SOURCE_ID,
    "rss-cpsc-recalls",
    "us-federal-register-cpsc",
    "us-federal-register-ftc",
  ].sort());
});
