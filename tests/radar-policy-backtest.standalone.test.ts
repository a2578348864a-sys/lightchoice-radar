import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { classifyRadarText } from "@aihot/backend/editorial/radar-rules";
import {
  isApprovedRadarPolicyWebList,
  isQualifyingAmazonPolicyAnnouncement,
} from "@aihot/backend/sources/radar-policy-source";

type Sample = {
  id: string;
  sourceId: string;
  title: string;
  url: string;
  publishedAt: string;
  effectiveDate: string | null;
  effectiveDateEvidence: string;
  scope: string;
  humanClass: "政策变化" | "项目规则" | "功能上线" | "营销内容";
  humanDecision: "accept" | "reject";
  fullBody: { sha256: string; chars: number };
  engine: { gate: boolean; tags: string[]; evidenceCount: number; summary: string | null; gateOnExcerpt: boolean };
  admissionPath: string;
  verdict: "pass" | "fail" | "unconfirmed";
  problem: string | null;
  gateText: string;
};

type CachedBody = { id: string; url: string; fetchedAt: string; sha256: string; chars: number; body: string };

const fixture = JSON.parse(readFileSync(new URL("../docs/radar/amazon-policy-backtest.json", import.meta.url), "utf8")) as {
  samples: Sample[];
  summary: { total: number; pass: number; fail: number; unconfirmed: number; falseNegatives: string[]; falsePositives: string[] };
  coverage: {
    announcementIndexItems: number;
    gateAdmittedInIndex: number;
    storedPolicyLeads: number;
    storedFromAnnouncementIndex: number;
  };
};

// The verbatim official text, kept next to the fixture so the classifier runs on the real article,
// not on a recorded verdict. A hash makes an edited or hand-written body fail immediately.
const bodies = JSON.parse(readFileSync(new URL("../docs/radar/amazon-policy-backtest-bodies.json", import.meta.url), "utf8")) as CachedBody[];
const bodyById = new Map(bodies.map((b) => [b.id, b]));

const sources = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8")) as {
  sources: Array<{
    id: string;
    kind: "external" | "json_list" | "mp_account" | "rss" | "web_list" | "x_search";
    config: Record<string, unknown>;
  }>;
};

const OFFICIAL = ["https://sell.amazon.com/blog/announcements/", "https://sellingpartners.aboutamazon.com/"];
const PADDING = " Sellers can learn more in Seller Central.";
/** The gate rejects bodies shorter than 200 characters before reading them, so pad adversarial text. */
const pad = (text: string) => (text.length >= 220 ? text : text + PADDING.repeat(Math.ceil((220 - text.length) / PADDING.length)));

test("the stored bodies are the official text the fixture was measured on", () => {
  assert.equal(bodies.length, fixture.samples.length);
  for (const s of fixture.samples) {
    const cached = bodyById.get(s.id);
    assert.ok(cached, `${s.id} has a cached body`);
    assert.equal(cached.url, s.url, `${s.id} body belongs to the same official URL`);
    assert.match(cached.fetchedAt, /^\d{4}-\d{2}-\d{2}T/, `${s.id} records when it was fetched`);
    assert.equal(createHash("sha256").update(cached.body, "utf8").digest("hex"), s.fullBody.sha256, `${s.id} body is unchanged`);
    assert.equal(cached.body.length, s.fullBody.chars, `${s.id} body length matches`);
    assert.ok(cached.body.length >= 800, `${s.id} body is a whole article, not a snippet`);
  }
});

test("the current classifier is re-run on every full official body", () => {
  for (const s of fixture.samples) {
    const body = bodyById.get(s.id)!.body;
    const gate = isQualifyingAmazonPolicyAnnouncement(body);
    const cls = classifyRadarText({ title: s.title, bodyText: body });
    assert.equal(gate, s.engine.gate, `${s.id} gate on the full body`);
    assert.deepEqual(cls.tags, s.engine.tags, `${s.id} tags on the full body`);
    assert.equal(cls.evidence.length, s.engine.evidenceCount, `${s.id} evidence count on the full body`);
  }
});

test("every verdict follows the human decision and the engine decision", () => {
  for (const s of fixture.samples) {
    const expectedAccept = s.humanDecision === "accept";
    // S01 is a different source: it is admitted by the source allowlist, not by the announcement gate.
    const engineAccept = s.sourceId === "amazon-us-fee-updates"
      ? isApprovedRadarPolicyWebList(sources.sources.find((x) => x.id === s.sourceId)!)
      : s.engine.gate;
    assert.equal(s.verdict === "pass", expectedAccept === engineAccept, `${s.id} verdict must match both decisions`);
    if (s.verdict !== "pass") assert.ok(s.problem && s.problem.length > 20, `${s.id} failure must record the concrete problem`);
  }
});

test("the fee source is admitted by its allowlist, not by the announcement gate", () => {
  const fee = fixture.samples.find((s) => s.id === "S01")!;
  const source = sources.sources.find((x) => x.id === fee.sourceId);
  assert.ok(source, "the fee source is declared in industry/sources.json");
  assert.equal(isApprovedRadarPolicyWebList(source!), true);
  assert.equal(fee.engine.gate, false, "the announcements gate is not this source's path");
  assert.equal(fee.verdict, "pass");
});

test("the gate admits S02–S04 on their full bodies and still rejects S05–S10", () => {
  const admitted = fixture.samples.filter((s) => s.sourceId === "amazon-us-announcements" && s.engine.gate);
  assert.deepEqual(admitted.map((s) => s.id), ["S02", "S03", "S04"]);
  for (const s of fixture.samples.filter((x) => x.humanDecision === "reject")) {
    assert.equal(isQualifyingAmazonPolicyAnnouncement(bodyById.get(s.id)!.body), false, `${s.id} (${s.humanClass}) must stay rejected`);
  }
});

test("the participation-mode change in S03 carries a usable tag", () => {
  const s03 = fixture.samples.find((s) => s.id === "S03")!;
  assert.deepEqual(s03.engine.tags, ["亚马逊卖家项目规则线索"]);
  const evidence = classifyRadarText({ title: s03.title, bodyText: bodyById.get("S03")!.body })
    .evidence.find((e) => e.ruleId === "seller-program-rules");
  assert.ok(evidence, "the opt-in/opt-out sentence is cited as seller-program evidence");
  assert.match(evidence!.matchedText, /opt(?:-|\s)?in[\s\S]*opt(?:-|\s)?out/i);
  // A single "opt in" without the other side of the switch is not a program rule.
  assert.deepEqual(classifyRadarText({ title: "Try the new pricing tool", bodyText: pad("You can opt in at any time.") }).tags, []);
});

test("a date, a quantity or the word opt-in alone never admits a post", () => {
  const rejected = [
    "These updates are effective March 1, 2026.",
    "Sellers can now include up to 2,000 ASINs in the program.",
    "Sellers can opt in to the new pricing tool and opt out at any time.",
    "This fee change takes effect March 1, 2026.",
    "Registration opens September 16, 2025 and closes September 18, 2025.",
  ];
  for (const text of rejected) {
    assert.equal(isQualifyingAmazonPolicyAnnouncement(pad(text)), false, text);
  }
  const admitted = [
    "The revised fee schedule is effective April 1, 2027.",
    "The new FBA capacity limits take effect March 1, 2026.",
  ];
  for (const text of admitted) {
    assert.equal(isQualifyingAmazonPolicyAnnouncement(pad(text)), true, text);
  }
});

test("the excerpt regression stays consistent with the full-body result", () => {
  for (const s of fixture.samples) {
    assert.equal(isQualifyingAmazonPolicyAnnouncement(s.gateText), s.engine.gateOnExcerpt, `${s.id} excerpt gate`);
    assert.equal(s.engine.gateOnExcerpt, s.engine.gate, `${s.id} excerpt agrees with the full body`);
  }
});

test("provenance, sample limit and reported statistics stay consistent", () => {
  assert.ok(fixture.samples.length <= 10, "samples must stay at or below ten");
  assert.equal(new Set(fixture.samples.map((s) => s.id)).size, fixture.samples.length, "ids are unique");
  for (const s of fixture.samples) {
    assert.ok(OFFICIAL.some((prefix) => s.url.startsWith(prefix)), `${s.id} must link to an official Amazon page`);
    assert.match(s.publishedAt, /^\d{4}-\d{2}-\d{2}$/, `${s.id} publishedAt is a date`);
    assert.ok(s.title.length > 10, `${s.id} keeps the original title`);
    assert.ok(s.scope.length > 5, `${s.id} records the policy scope`);
    if (s.effectiveDate) assert.ok(s.effectiveDateEvidence.length > 10, `${s.id} effective date needs its source sentence`);
  }
  assert.equal(fixture.summary.total, fixture.samples.length);
  assert.equal(fixture.summary.pass, fixture.samples.filter((s) => s.verdict === "pass").length);
  assert.equal(fixture.summary.fail, fixture.samples.filter((s) => s.verdict === "fail").length);
  assert.deepEqual(fixture.summary.falsePositives, []);
  // A perfect backtest does not fill the production table: the two historical posts are not backfilled.
  assert.ok(fixture.coverage.storedFromAnnouncementIndex < fixture.coverage.gateAdmittedInIndex);
  assert.notEqual(fixture.coverage.announcementIndexItems, fixture.summary.total, "index size is not the sample count");
});
