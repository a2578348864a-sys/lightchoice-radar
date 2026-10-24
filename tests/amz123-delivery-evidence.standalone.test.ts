import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVerificationChecks,
  hasForbiddenRawPayload,
  parseWorkerState,
  sanitizeCursor,
  sanitizeDiagnostics,
  sanitizeLeadMetadata,
} from "../scripts/amz123-evidence-shape.ts";

test("lead metadata is allow-listed and body content is never serialized", () => {
  const safe = sanitizeLeadMetadata({
    amz123Lead: {
      column: "跨境头条", market: "US", source: "amz123", section: "/t", siteTags: ["美国", "Amazon"],
      radarTags: ["类目合规线索"], gateVersion: "amz123-lead-gate-v1", radarRuleIds: ["category-compliance"],
      effectiveDate: "2026-08-19", marketEvidence: "title", bodyText: "SECRET BODY SHOULD NEVER LEAK",
      event: { key: "abc", state: "new", domain: "类目合规线索", titleCore: "IOR监管趋严", secret: "drop me" },
      officialVerification: { status: "third-party-only", note: "尚未找到官方记录", bodyHtml: "SECRET" },
    },
  });
  assert.ok(safe);
  assert.equal(safe.column, "跨境头条");
  assert.equal("bodyText" in safe, false);
  assert.equal("secret" in (safe.event as Record<string, unknown>), false);
  assert.equal("bodyHtml" in (safe.officialVerification as Record<string, unknown>), false);
  assert.equal(JSON.stringify(safe).includes("SECRET"), false);
});

test("body payload detection catches nested body fields and long generic content", () => {
  assert.equal(hasForbiddenRawPayload({ collectionDetail: { bodyText: "x" } }), true);
  assert.equal(hasForbiddenRawPayload({ nested: [{ pageHtml: "x" }] }), true);
  assert.equal(hasForbiddenRawPayload({ detail: { content: "x".repeat(301) } }), true);
  assert.equal(hasForbiddenRawPayload({ amz123Lead: { description: "short description", market: "US" } }), false);
});

test("diagnostics keep only allow-listed counters and short failure notes", () => {
  const result = sanitizeDiagnostics({
    leads: 1, pageReads: 25, discovered: 105, alreadyStored: 0,
    robots: { url: "https://www.amz123.com/robots.txt", status: 200, rules: 48, allowedSections: ["/t", "/kx"], bodyText: "drop" },
    failures: [{ url: "https://www.amz123.com/kx/abc", error: "the page no longer carries the article payload", bodyText: "drop" }],
    bodyText: "SECRET", arbitrary: { secret: "drop" },
  });
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes("SECRET"), false);
  assert.equal(serialized.includes("drop"), false);
  assert.equal(result.discovered, 105);
  assert.equal("arbitrary" in result, false);
  assert.equal((result.failures as Array<Record<string, unknown>>)[0]?.error, "the page no longer carries the article payload");
});

test("worker state parser distinguishes running, stopped, and unknown", () => {
  assert.equal(parseWorkerState("公告 Worker：未运行"), "not-running");
  assert.equal(parseWorkerState("radar-announcements Worker 运行中（持有锁）"), "running");
  assert.equal(parseWorkerState("3000=200; 3001=200"), "unknown");
  assert.equal(parseWorkerState("Ads 调度进程 未运行", "ads"), "not-running");
  assert.equal(parseWorkerState("Ads/公告 Worker 均未运行", "ads"), "not-running");
});

test("verification checks fail closed for official-count changes and data-boundary violations", () => {
  const checks = buildVerificationChecks({
    source: { enabled: true, participationMode: "isolated", intervalMinutes: 360 },
    officialCounts: { platform_policy: 3, ads_policy: 2, external_regulation: 21 },
    baseline: { platform_policy: 3, ads_policy: 2, external_regulation: 20 },
    boundaries: { factArticleLinks: 0, storySignals: 0, analyses: 0, publicPublicationRows: 0, bodyLeakArticles: 0 },
    http: { webStatus: 200, apiStatus: 200 },
    announcementWorker: "not-running", expectNoWorker: true,
  });
  assert.equal(checks.find((check) => check.id === "official_family_counts_unchanged")?.status, "fail");
  assert.equal(checks.find((check) => check.id === "announcement_worker_not_running")?.status, "pass");
});

test("unknown worker status is not represented as stopped", () => {
  const checks = buildVerificationChecks({
    source: { enabled: true, participationMode: "isolated", intervalMinutes: 360 },
    officialCounts: { platform_policy: 3, ads_policy: 2, external_regulation: 20 },
    baseline: { platform_policy: 3, ads_policy: 2, external_regulation: 20 },
    boundaries: { factArticleLinks: 0, storySignals: 0, analyses: 0, publicPublicationRows: 0, bodyLeakArticles: 0 },
    http: { webStatus: 200, apiStatus: 200 },
    announcementWorker: "unknown", expectNoWorker: true,
  });
  assert.equal(checks.find((check) => check.id === "announcement_worker_not_running")?.status, "unverified");
});

// --- Compatibility with the live eighteenth-round collector and the live database shape ---

test("diagnostics are read from the live detail.amz123 container", () => {
  const result = sanitizeDiagnostics({
    amz123: {
      leads: 0, pageReads: 25, discovered: 76, alreadyStored: 1,
      robots: { url: "https://www.amz123.com/robots.txt", status: 200, rules: 48, allowedSections: ["/t", "/kx"] },
      sitemap: { urls: 0, known: 4000, fetched: false },
      listings: [{ section: "/t", status: 200, links: 4, withTitle: 4 }],
      failures: [{ url: "https://www.amz123.com/kx/A2CzjiIM", error: "the page no longer carries the article payload" }],
      rejectedReasons: { "parse-failed": 1, "not about Amazon": 3, "no radar rule matched": 21 },
    },
  });
  assert.equal(result.discovered, 76);
  assert.equal(result.pageReads, 25);
  assert.equal((result.robots as Record<string, unknown>).rules, 48);
  assert.equal((result.sitemap as Record<string, unknown>).known, 4000);
  assert.equal((result.sitemap as Record<string, unknown>).fetched, false);
  assert.equal((result.listings as Array<Record<string, unknown>>)[0]?.section, "/t");
  // The collector's rejection labels contain spaces; they must survive into the evidence.
  assert.equal((result.rejectedReasons as Record<string, number>)["parse-failed"], 1);
  assert.equal((result.rejectedReasons as Record<string, number>)["not about Amazon"], 3);
  assert.equal((result.rejectedReasons as Record<string, number>)["no radar rule matched"], 21);
});

test("cursor is read from the live source cursor keys", () => {
  const cursor = sanitizeCursor({
    gateVersion: "amz123-lead-gate-v1",
    sitemapAt: "2026-10-23T06:23:13.406Z",
    initializedAt: "2026-10-23T06:23:30.553Z",
    lastOkAt: "2026-10-23T06:49:53.516Z",
    rejected: new Array(47).fill("identity"),
    pending: new Array(57).fill("candidate"),
    sitemapUrls: 0,
  });
  assert.ok(cursor);
  assert.equal(cursor.gateVersion, "amz123-lead-gate-v1");
  assert.equal(cursor.sitemapLastReadAt, "2026-10-23T06:23:13.406Z");
  assert.equal(cursor.initializedAt, "2026-10-23T06:23:30.553Z");
  assert.equal(cursor.rejectedIdentities, 47);
  assert.equal(cursor.pendingCandidates, 57);
  assert.equal(cursor.sitemapApprovedUrls, 0);
});

test("the stored lead metadata carries no body payload", () => {
  const raw = {
    lead: {
      column: "跨境头条", market: "US", source: "amz123", section: "/t",
      siteTags: ["美国", "Amazon", "跨境卖家"], radarTags: ["类目合规线索"],
      gateVersion: "amz123-lead-gate-v1", officialRef: null,
      radarRuleIds: ["category-compliance"], discoveredVia: "listing",
      effectiveDate: "2026-08-19", marketEvidence: "title",
      event: { of: null, key: "bb24ca2f176fb90a77c2b4b5", state: "new", domain: "类目合规线索", titleCore: "ior监管趋严 提醒卖家自查进口主体", officialRef: null, effectiveDate: "2026-08-19" },
      officialVerification: { note: "本项目已收录的官方来源中没有对应记录，保持仅第三方报道状态。", status: "third-party-only", officialUrl: null, officialTitle: null, officialPublishedAt: null },
    },
  };
  assert.equal(hasForbiddenRawPayload(raw), false);
  const safe = sanitizeLeadMetadata(raw);
  assert.ok(safe);
  assert.equal(safe.effectiveDate, "2026-08-19");
  assert.equal((safe.officialVerification as Record<string, unknown>).status, "third-party-only");
  assert.equal((safe.event as Record<string, unknown>).state, "new");
});
