import assert from "node:assert/strict";
import test from "node:test";
import { selectLeadSource } from "../apps/worker/src/source-selection.ts";
import { expectedCommandFragment } from "../apps/worker/src/process-identity.ts";
import { LEAD_JOB, LEAD_SCHEDULE_QUEUE } from "../apps/worker/src/lead-source-runner.ts";
import { QUEUES } from "../packages/backend/src/jobs/queue.ts";
import { RADAR_LEAD_SOURCE_ID } from "../packages/backend/src/sources/radar-policy-source.ts";

// The lead source as the dedicated worker sees it.
function leadRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RADAR_LEAD_SOURCE_ID,
    name: "AMZ123 lead",
    kind: "web_list",
    config: {
      adapter: "amz123_leads",
      url: "https://www.amz123.com/t",
      allowUrlPrefixes: ["https://www.amz123.com/t/", "https://www.amz123.com/kx/"],
      _aihot: { initialBackfillLimit: 25, initialBackfillMonths: 1 },
    },
    tier: "T2",
    participation_mode: "isolated",
    first_party: false,
    interval_minutes: 360,
    enabled: true,
    health: "ok",
    fail_count: 0,
    last_fetch_at: null,
    last_ok_at: null,
    last_error: null,
    next_fetch_at: null,
    tags: ["第三方线索", "amz123", "美国站", "政策线索"],
    cursor: null,
    ...overrides,
  } as any;
}

test("the dedicated lead worker runs the lead source and nothing else", () => {
  const selected = selectLeadSource(leadRow());
  assert.ok(selected.source);
  assert.equal(selected.source.id, RADAR_LEAD_SOURCE_ID);
  assert.equal(selected.source.intervalMinutes, 360);
  assert.equal(selected.skipped, null);
});

test("a disabled lead source is skipped with its own reason", () => {
  const selected = selectLeadSource(leadRow({ enabled: false }));
  assert.equal(selected.source, null);
  assert.equal(selected.skipped?.reason, "source disabled");
});

test("a lead source outside the allowlist is skipped, and a missing row is skipped", () => {
  const wrongAdapter = selectLeadSource(leadRow({ config: { adapter: "browser_help" } }));
  assert.equal(wrongAdapter.source, null);
  assert.equal(wrongAdapter.skipped?.reason, "config is not on the approved allowlist");

  const missing = selectLeadSource(null);
  assert.equal(missing.source, null);
  assert.equal(missing.skipped?.reason, "source row missing");
});

test("the lead worker owns a private schedule and a private fetch queue", () => {
  assert.equal(LEAD_SCHEDULE_QUEUE, "cron.radar.amz123-leads.schedule");
  assert.equal(LEAD_JOB, "radar.amz123-leads.schedule");
  assert.equal(QUEUES.fetchAmz123Leads, "sources.fetch-amz123-leads");
  // The official families keep their own queues; the lead queue is never one of them.
  assert.notEqual(QUEUES.fetchAmz123Leads, QUEUES.fetchSource);
  assert.notEqual(QUEUES.fetchAmz123Leads, QUEUES.fetchAmazonAnnouncements);
  assert.notEqual(QUEUES.fetchAmz123Leads, QUEUES.fetchRegulatory);
});

test("the lead worker role is recognised by the identity check", () => {
  assert.equal(expectedCommandFragment("amz123-leads"), "radar-amz123-leads.ts");
  assert.notEqual(expectedCommandFragment("amz123-leads"), expectedCommandFragment("radar-announcements"));
});
