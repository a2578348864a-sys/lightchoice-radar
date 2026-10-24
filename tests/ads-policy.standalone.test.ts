import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { classifyRadarText } from "@aihot/backend/editorial/radar-rules";
import {
  ADS_POLICY_HUB_URL,
  ADS_POLICY_PAGE_URLS,
  ADS_POLICY_SOURCE_ID,
  adsPolicyCandidate,
  adsPolicySubPageLinks,
  isApprovedAdsPolicySource,
  isQualifyingAdsPolicy,
  readAdsPolicyBody,
  readAdsPolicyUpdatedOn,
} from "@aihot/backend/sources/ads-policy";
import type { RenderedPage } from "@aihot/backend/sources/browser-render";

// innerText captured from a real Chrome render on 2026-10-23; not hand-written excerpts.
const fixtures = JSON.parse(readFileSync(new URL("../docs/radar/ads-policy-fixtures.json", import.meta.url), "utf8")) as {
  pages: Record<"hub" | "generalRequirements" | "prohibitedProducts", { url: string; text: string; links?: Array<{ text: string; href: string }> }>;
};
const pack = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8")) as {
  sources: Array<{ id: string; kind: string; config: Record<string, any> }>;
};
const declared = pack.sources.find((source) => source.id === ADS_POLICY_SOURCE_ID)!;

test("only the declared Ads policy source passes the Ads source allowlist", () => {
  assert.ok(declared, "ads-policy-pages is declared in industry/sources.json");
  assert.equal(isApprovedAdsPolicySource(declared as never), true);
  assert.equal(isApprovedAdsPolicySource({ ...declared, id: "some-other-source" } as never), false);
  assert.equal(isApprovedAdsPolicySource({ ...declared, kind: "rss" } as never), false);
  assert.equal(isApprovedAdsPolicySource({ ...declared, config: { ...declared.config, adapter: "mimo_home" } } as never), false);
  assert.equal(isApprovedAdsPolicySource({ ...declared, config: { ...declared.config, url: "https://advertising.amazon.com/help/G8X8M375UPCN4UUC" } } as never), false);
  // Widening the page set (for example to the change log) must be refused, not silently collected.
  assert.equal(isApprovedAdsPolicySource({ ...declared, config: { ...declared.config, allowUrlPrefixes: [...ADS_POLICY_PAGE_URLS, "https://advertising.amazon.com/help/G8X8M375UPCN4UUC"] } } as never), false);
  assert.equal(isApprovedAdsPolicySource({ ...declared, config: { ...declared.config, allowUrlPrefixes: [ADS_POLICY_PAGE_URLS[0]] } } as never), false);
});

test("the hub is a directory: its links are the discovery input, not a policy record", () => {
  const hub = { url: ADS_POLICY_HUB_URL, finalUrl: ADS_POLICY_HUB_URL, status: 200, title: "", h1: "", text: fixtures.pages.hub.text, links: fixtures.pages.hub.links ?? [] } as RenderedPage;
  assert.deepEqual(adsPolicySubPageLinks(hub), [...ADS_POLICY_PAGE_URLS]);
  // The hub carries two generic enforcement sentences; that is below the clause threshold, so the
  // directory can never be stored as a policy body on its own.
  assert.equal(isQualifyingAdsPolicy(readAdsPolicyBody(hub.text)), false);
});

test("each sub-policy page qualifies on its own body, with clause-level evidence", () => {
  for (const key of ["generalRequirements", "prohibitedProducts"] as const) {
    const body = readAdsPolicyBody(fixtures.pages[key].text);
    assert.ok(body.length > 1_000, `${key} body is the whole article`);
    assert.equal(isQualifyingAdsPolicy(body), true, `${key} carries advertising rules`);
    const clauses = classifyRadarText({ title: "", bodyText: body }).evidence.filter((item) => item.ruleId === "ads-policy");
    assert.ok(clauses.length >= 3, `${key} cites at least three clauses`);
    for (const clause of clauses) {
      assert.equal(body.slice(clause.start, clause.end), clause.matchedText, `${key} evidence points into the exact text`);
      assert.match(clause.matchedText, /prohibit|required|must not|failure to comply|requirements for all ads/i);
    }
  }
});

test("the document's own update date is read as the source update time, never as a publication date", () => {
  const general = readAdsPolicyBody(fixtures.pages.generalRequirements.text);
  const updated = readAdsPolicyUpdatedOn(general);
  assert.deepEqual(updated, { sourceUpdatedAt: new Date(Date.UTC(2026, 6, 22)), evidence: "Updated on Jul 22, 2026" });
  // The reader must not hand out publication fields at all: that is where the old confusion came from.
  assert.equal("publishedAt" in updated, false);
  assert.equal("publicationTime" in updated, false);

  const prohibited = readAdsPolicyBody(fixtures.pages.prohibitedProducts.text);
  assert.equal(readAdsPolicyUpdatedOn(prohibited).sourceUpdatedAt?.toISOString(), "2026-06-25T00:00:00.000Z");

  const missing = readAdsPolicyUpdatedOn("A page with no update line at all.");
  assert.deepEqual(missing, { sourceUpdatedAt: null, evidence: null }, "a missing update date stays unknown");
});

test("a candidate carries the update date only in sourceUpdatedAt, and publication stays empty", () => {
  const page = (text: string, url: string) => ({ url, finalUrl: url, status: 200, title: "t", h1: "h", text, links: [] }) as RenderedPage;

  for (const key of ["generalRequirements", "prohibitedProducts"] as const) {
    const candidate = adsPolicyCandidate(page(fixtures.pages[key].text, fixtures.pages[key].url))!;
    assert.ok(candidate, `${key} yields a candidate`);
    assert.equal(candidate.publishedAt, null, `${key} has no publication date`);
    assert.equal(candidate.publicationTime, null, `${key} has no publication time`);
    assert.ok(candidate.sourceUpdatedAt instanceof Date, `${key} records the update date`);
    assert.equal(candidate.bodyStatus, "ok");
    assert.ok(String(candidate.bodyText).length > 1_000);
  }

  // A page without an "Updated on" line still yields a candidate, with the update date unknown.
  const undated = adsPolicyCandidate(page(fixtures.pages.generalRequirements.text.replace(/Updated on [A-Z][a-z]{2} \d{1,2}, \d{4}/, ""), "https://advertising.amazon.com/help/G4U9JBZH3664JWX2"))!;
  assert.equal(undated.sourceUpdatedAt, null);
  assert.equal(undated.publishedAt, null);

  // The directory never becomes a candidate.
  assert.equal(adsPolicyCandidate(page(fixtures.pages.hub.text, ADS_POLICY_HUB_URL)), null);
});

test("shells, marketing copy and a bare title never qualify", () => {
  assert.equal(isQualifyingAdsPolicy(""), false);
  assert.equal(isQualifyingAdsPolicy("Skip to main content No account selected © 2026 Amazon.com"), false);
  assert.equal(isQualifyingAdsPolicy("Prohibited products and services across all supply"), false, "a heading alone is not a rule");
  assert.equal(isQualifyingAdsPolicy(`${"Learn about Amazon Ads policies to help your business grow. ".repeat(20)}`), false);
  // A single boilerplate enforcement sentence is below the threshold, even inside a long page.
  assert.equal(isQualifyingAdsPolicy(`${"Ads are reviewed. ".repeat(40)} Amazon reserves the right to reject, remove, or require modifications to ads that don't meet its policies.`), false);
});

test("Ads rules never fire on seller platform-policy or regulatory text", () => {
  const bodies = JSON.parse(readFileSync(new URL("../docs/radar/amazon-policy-backtest-bodies.json", import.meta.url), "utf8")) as Array<{ id: string; body: string }>;
  assert.ok(bodies.length >= 10);
  for (const sample of bodies) {
    const tags = classifyRadarText({ title: "", bodyText: sample.body }).tags;
    assert.equal(tags.includes("亚马逊广告政策线索"), false, `${sample.id} must not be tagged as an Ads policy`);
    assert.equal(isQualifyingAdsPolicy(sample.body), false, `${sample.id} must not pass the Ads gate`);
  }
});

// The pages are public, so no login state is involved. These cases keep it that way: a wall, a portal
// or a plain error page can never be stored as a policy, whatever the browser happened to render.
test("a login wall, a portal page or an error page is never a policy candidate", () => {
  const wall = {
    url: "https://advertising.amazon.com/help/G4U9JBZH3664JWX2",
    finalUrl: "https://advertising.amazon.com/help/G4U9JBZH3664JWX2",
    status: 200,
    title: "Sign in to Amazon",
    h1: "Sign in",
    text: `Skip to main content Sign in to Amazon Email or mobile phone number Password Sign in By continuing, you agree to the Conditions of Use and Privacy Notice. Need help? Forgot your password? Create your Amazon account. `.repeat(4),
    links: [],
  };
  assert.equal(adsPolicyCandidate(wall as never), null);

  const portal = { ...wall, title: "Amazon Ads", h1: "Amazon Ads", text: "Choose an account to continue. Advertising console Seller Central Vendor Central. ".repeat(10) };
  assert.equal(adsPolicyCandidate(portal as never), null);

  const error = { ...wall, status: 404, title: "Page not found", h1: "Page not found", text: "We couldn't find that page. Go back to the Support Center. ".repeat(12) };
  assert.equal(adsPolicyCandidate(error as never), null);
});

test("the collector refuses a run that rendered only a wall instead of policy text", async () => {
  // The gate is the last line: even if every page renders, no clause evidence means a failed run and
  // no stored material, rather than a source that quietly reports success.
  assert.equal(isQualifyingAdsPolicy("Sign in to Amazon ".repeat(60)), false);
  assert.equal(isQualifyingAdsPolicy(null), false);
});

