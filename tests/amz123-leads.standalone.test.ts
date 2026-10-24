import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  AMZ123_GATE_VERSION,
  AMZ123_SECTIONS,
  AMZ123_SOURCE_ID,
  amz123ApprovedUrl,
  amz123EventIdentity,
  amz123LeadCandidate,
  amz123LeadGate,
  amz123TitleSimilarity,
  extractEffectiveDate,
  matchOfficialEvidence,
  parseAmz123Article,
  parseListing,
  parseRobots,
  parseSitemap,
  robotsAllows,
  type Amz123Article,
  type Amz123Event,
  type Amz123GateResult,
  type Amz123Verification,
} from "@aihot/backend/sources/amz123";
import { isApprovedRadarLeadSource, RADAR_LEAD_SOURCE_ID } from "@aihot/backend/sources/radar-policy-source";
import { identityKeyForUrl } from "@aihot/backend/lib/url";

// The site's own robots.txt as read on 2026-10-23. It matters that it carries two `User-agent: *`
// groups: the first lists what is forbidden, the second what is allowed, and both apply.
const ROBOTS = `User-agent:AhrefsBot
Disallow:/

User-agent:DataForSeoBot
Disallow:/

User-agent:GPTBot
Disallow:/

User-agent:*
Disallow:/admin
Disallow:/search
Disallow:/search.htm
Disallow:/api
Disallow:/uc-assert
Disallow:/ugc_nuxt
Disallow:/user-login
Disallow:/user-*
Disallow:/thread-*
Disallow:/tag-*
Disallow:/cgi-bin
Disallow:/toolbox
Disallow:.jpg$
Disallow:.css$
Disallow:.js$
Disallow:/tools-harbor/search

User-agent:*
Allow:/t
Allow:/b

Sitemap:https://www.amz123.com/sitemap_index.xml`;

const pack = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8")) as {
  sources: Array<{ id: string; kind: string; config: Record<string, any>; interval_minutes: number; participation_mode: string; tags: string[]; enabled: boolean }>;
};
const declared = pack.sources.find((source) => source.id === AMZ123_SOURCE_ID)!;

test("only the declared lead source passes the lead allowlist, on its exact configuration", () => {
  assert.ok(declared, "amz123-policy-leads is declared in industry/sources.json");
  assert.equal(isApprovedRadarLeadSource(declared as never), true);
  assert.equal(isApprovedRadarLeadSource({ ...declared, id: "some-other-source" } as never), false);
  assert.equal(isApprovedRadarLeadSource({ ...declared, kind: "rss" } as never), false);
  assert.equal(isApprovedRadarLeadSource({ ...declared, config: { ...declared.config, adapter: "browser_help" } } as never), false);
  assert.equal(isApprovedRadarLeadSource({ ...declared, config: { ...declared.config, url: "https://www.amz123.com/kx" } } as never), false);
  // Widening the columns the source may read must be refused, not silently collected.
  assert.equal(isApprovedRadarLeadSource({ ...declared, config: { ...declared.config, allowUrlPrefixes: [...declared.config.allowUrlPrefixes, "https://www.amz123.com/b/"] } } as never), false);
  assert.equal(isApprovedRadarLeadSource({ ...declared, config: { ...declared.config, allowUrlPrefixes: ["https://www.amz123.com/t/"] } } as never), false);
  assert.equal(isApprovedRadarLeadSource({ ...declared, config: { ...declared.config, extra: 1 } } as never), false);
});

test("the declared lead source is a third-party lead source, not a policy source", () => {
  assert.equal(RADAR_LEAD_SOURCE_ID, AMZ123_SOURCE_ID);
  assert.equal(declared.participation_mode, "isolated");
  assert.equal(declared.interval_minutes, 360, "one round every six hours");
  assert.equal(declared.enabled, true);
  // The three official families are the statistics; a lead must never be counted as one of them.
  for (const family of ["platform_policy", "ads_policy", "external_regulation"]) {
    assert.equal(declared.tags.includes(family), false, `${family} must not be a tag of the lead source`);
  }
  // A lead is never a first-party source either.
  assert.equal(declared.tags.includes("亚马逊官方"), false);
});

test("robots is enforced in code: both `User-agent: *` groups apply, and a bot group does not", () => {
  const policy = parseRobots(ROBOTS);
  assert.ok(policy.rules.length > 0);
  // The second group's Allow rules apply together with the first group's Disallow rules.
  assert.equal(robotsAllows(policy, "/t/0ASKU6CU"), true);
  assert.equal(robotsAllows(policy, "/kx/abc123"), true);
  assert.equal(robotsAllows(policy, "/search"), false);
  assert.equal(robotsAllows(policy, "/search.htm"), false);
  assert.equal(robotsAllows(policy, "/api"), false);
  assert.equal(robotsAllows(policy, "/tag-amazon"), false);
  assert.equal(robotsAllows(policy, "/user-login"), false);
  assert.equal(robotsAllows(policy, "/admin"), false);
  assert.equal(robotsAllows(policy, "/toolbox"), false);
  assert.equal(robotsAllows(policy, "/thread-1"), false);
  assert.equal(robotsAllows(policy, "/a.jpg"), false, "an extension rule applies too");
  // Another agent's group never applies to us.
  assert.equal(robotsAllows(policy, "/anything"), true);
});

test("only the approved host and the two approved columns may be read", () => {
  assert.equal(amz123ApprovedUrl("https://www.amz123.com/t/0ASKU6CU"), "https://www.amz123.com/t/0ASKU6CU");
  assert.equal(amz123ApprovedUrl("https://www.amz123.com/kx/abc123"), "https://www.amz123.com/kx/abc123");
  // The columns this source does not read.
  assert.equal(amz123ApprovedUrl("https://www.amz123.com/b/some-service"), null);
  assert.equal(amz123ApprovedUrl("https://www.amz123.com/report/2026"), null);
  assert.equal(amz123ApprovedUrl("https://www.amz123.com/zb/20261022"), null);
  assert.equal(amz123ApprovedUrl("https://www.amz123.com/"), null);
  assert.equal(amz123ApprovedUrl("https://www.amz123.com/t"), null);
  // Another host, another scheme, a port, credentials, a query or a fragment.
  assert.equal(amz123ApprovedUrl("http://www.amz123.com/t/abc"), null);
  assert.equal(amz123ApprovedUrl("https://amz123.com/t/abc"), null);
  assert.equal(amz123ApprovedUrl("https://www.amz123.com:8443/t/abc"), null);
  assert.equal(amz123ApprovedUrl("https://user@www.amz123.com/t/abc"), null);
  assert.equal(amz123ApprovedUrl("https://www.amz123.com/t/abc?x=1"), null);
  assert.equal(amz123ApprovedUrl("https://www.amz123.com/t/abc#top"), null);
  assert.equal(amz123ApprovedUrl("not a url"), null);
});

test("the listing yields its article links with the titles it carries", () => {
  const html = `<html><body>
    <a class="card" href="/t/zDrc37rW" target="_blank" data-title="亚马逊上线新功能，卖家可以付费“买评论”了？">图</a>
    <a class="row" href="/kx/DwNdFJiy">德国媒体巨头拟议收购 TikTok 欧洲业务，字节跳动予以否认</a>
    <a href="/b/service-directory">服务商目录</a>
    <a href="/t/otherID" data-title="美国站 IOR 监管趋严">图</a>
  </body></html>`;
  const t = parseListing(html, "/t", "跨境头条");
  assert.deepEqual(t.map((c) => c.url), ["https://www.amz123.com/t/zDrc37rW", "https://www.amz123.com/t/otherID"]);
  assert.equal(t[0]!.title, "亚马逊上线新功能，卖家可以付费“买评论”了？");
  assert.equal(t[0]!.column, "跨境头条");
  const kx = parseListing(html, "/kx", "跨境快讯");
  assert.deepEqual(kx.map((c) => c.url), ["https://www.amz123.com/kx/DwNdFJiy"]);
  assert.equal(kx[0]!.title, "德国媒体巨头拟议收购 TikTok 欧洲业务，字节跳动予以否认");
});

test("the archive index yields only approved columns, with the site's own lastmod", () => {
  const xml = `<urlset>
    <url><loc>https://www.amz123.com/t/aaa111</loc><lastmod>2026-10-20</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>
    <url><loc>https://www.amz123.com/b/bbb222</loc><lastmod>2026-10-20</lastmod></url>
    <url><loc>https://www.amz123.com/report/ccc333</loc><lastmod>2026-10-20</lastmod></url>
    <url><loc>https://www.amz123.com/kx/ddd444</loc><lastmod>2026-10-19</lastmod></url>
  </urlset>`;
  const entries = parseSitemap(xml);
  assert.deepEqual(entries.map((e) => e.url), ["https://www.amz123.com/t/aaa111", "https://www.amz123.com/kx/ddd444"]);
  assert.equal(entries[0]!.lastmod, "2026-10-20");
  assert.equal(entries[0]!.via, "sitemap");
});

/** A devalue-shaped payload: every value sits in the top-level array and is referenced by index. */
function nuxtPayload(): string {
  const values = [
    { title: 1, content: 2, published_at: 3, updated_at: 4, author: 5, tags: 6, description: 7, fid: 8 },
    "合成测试标题：美国站 FBA 配送费规则更新",
    `<p>${"合成正文内容。".repeat(40)}</p>`,
    1785470880,
    1785889337,
    { username: 9 },
    [10, 11],
    "站点自带的简短描述",
    "TESTID",
    "合成作者",
    { name: 12 },
    "FBA",
  ];
  return `<script id="__NUXT_DATA__" type="application/json">${JSON.stringify(values)}</script>`;
}

test("the article page yields metadata, and the body only as a transient value", () => {
  const article = parseAmz123Article(`<html><body>${nuxtPayload()}</body></html>`);
  assert.ok(article, "the payload is read");
  assert.equal(article!.title, "合成测试标题：美国站 FBA 配送费规则更新");
  assert.equal(article!.author, "合成作者");
  assert.equal(article!.publishedAt?.toISOString(), "2026-07-31T04:08:00.000Z");
  assert.equal(article!.sourceUpdatedAt?.toISOString(), "2026-08-05T00:22:17.000Z");
  assert.equal(article!.description, "站点自带的简短描述");
  assert.deepEqual(article!.tags, ["FBA"]);
  assert.ok(article!.bodyText.length > 100, "the body is read in memory for the classification");
  // A page without the payload is a parse failure, not a silent empty article.
  assert.equal(parseAmz123Article("<html><body>no payload here</body></html>"), null);
});

test("the lead gate needs a policy, Amazon and the US market", () => {
  const policy = {
    title: "亚马逊美国站 FBA 配送费调整公告",
    description: "站点自带的简短描述",
    tags: ["FBA"],
    bodyText: "美国站 FBA 配送费将调整。",
  };
  const pass = amz123LeadGate(policy);
  assert.equal(pass.ok, true);
  assert.ok(pass.radarTags.length > 0, "the project's own radar rules matched");
  assert.equal(pass.market, "US");

  // Another platform's news is not a lead for this radar, even when it is policy wording.
  const other = amz123LeadGate({ ...policy, title: "TikTok Shop 欧洲业务规则调整", description: "", tags: [], bodyText: "TikTok Shop 欧洲业务规则调整，费用调整将影响卖家。" });
  assert.equal(other.ok, false);
  assert.equal(other.reason, "not about Amazon");

  // A report whose policy wording is only in the body is not admitted on the title alone.
  const noPolicy = amz123LeadGate({ ...policy, title: "亚马逊美国站今日新品推荐", description: "", tags: [], bodyText: "亚马逊平台政策更新，详见说明。" });
  assert.equal(noPolicy.ok, false);
  assert.equal(noPolicy.reason, "no policy wording in the title, description or tags");

  // A report about another platform with no policy wording at all never reaches the Amazon gate.
  const plain = amz123LeadGate({ ...policy, title: "TikTok Shop 欧洲业务被收购", description: "", tags: [], bodyText: "字节跳动予以否认。" });
  assert.equal(plain.ok, false);
  assert.equal(plain.reason, "no radar rule matched");

  // Without the US market there is nothing to report on.
  const noMarket = amz123LeadGate({ ...policy, title: "亚马逊欧洲站 FBA 配送费调整公告", description: "", tags: [], bodyText: "欧洲站" });
  assert.equal(noMarket.ok, false);
  assert.equal(noMarket.reason, "no US market signal");
});

test("the effective date is the policy's own date and stays unknown when it is not stated", () => {
  assert.equal(extractEffectiveDate("新规将于 2026 年 8 月 1 日生效"), "2026-08-01");
  assert.equal(extractEffectiveDate("该政策自2026年11月15日起实施"), "2026-11-15");
  assert.equal(extractEffectiveDate("The change is effective on October 1, 2026."), "2026-10-01");
  assert.equal(extractEffectiveDate("The rule takes effect 2026-12-31."), "2026-12-31");
  assert.equal(extractEffectiveDate("A report with no date at all."), null);
  // An impossible date is not a date.
  assert.equal(extractEffectiveDate("生效日期 2026 年 13 月 40 日"), null);
});

test("two reports of one event merge only when the domain, the date and the wording agree", () => {
  const known = [{
    articleId: "first",
    domain: "费用与物流线索",
    effectiveDate: "2026-08-01",
    officialRef: null,
    titleCore: "配送费调整",
  }];
  const same = amz123EventIdentity({
    domain: ["费用与物流线索"],
    effectiveDate: "2026-08-01",
    officialRef: null,
    title: "亚马逊美国站配送费调整说明",
  }, known);
  assert.equal(same.state, "merged");
  assert.equal(same.of, "first");

  // A different date is a different event.
  const otherDate = amz123EventIdentity({
    domain: ["费用与物流线索"],
    effectiveDate: "2026-09-01",
    officialRef: null,
    title: "亚马逊美国站配送费调整说明",
  }, known);
  assert.equal(otherDate.state, "new");
  assert.equal(otherDate.of, null);

  // Neither a date nor a document number: the event is left open, never forced.
  const open = amz123EventIdentity({
    domain: ["费用与物流线索"],
    effectiveDate: null,
    officialRef: null,
    title: "亚马逊美国站配送费调整说明",
  }, known);
  assert.equal(open.state, "pending-determination");
  assert.equal(open.of, null);

  // A title that shares nothing with the known report does not merge either.
  const unrelated = amz123EventIdentity({
    domain: ["费用与物流线索"],
    effectiveDate: "2026-08-01",
    officialRef: null,
    title: "亚马逊美国站仓储容量配额扩容",
  }, known);
  assert.equal(unrelated.state, "new");
  assert.ok(amz123TitleSimilarity("配送费调整", "仓储容量配额扩容") < 0.45);
});

test("the official state is what the record actually says, not a confirmation", () => {
  const official = [{
    id: "o1",
    title: "Accuracy of Importer of Record Data Submitted to CBP",
    url: "https://www.federalregister.gov/documents/2026/08/19/2026-16911/accuracy-of-importer-of-record-data-submitted-to-cbp",
    publishedAt: new Date("2026-08-19T00:00:00Z"),
    family: "external_regulation",
  }];
  // The report cites the document itself.
  const cited = matchOfficialEvidence({
    title: "美国 IOR 进口商备案新规",
    officialRefs: ["2026-16911"],
    officialUrls: [],
    domain: ["亚马逊平台政策线索"],
  }, official);
  assert.equal(cited.status, "matched-official");
  assert.equal(cited.officialUrl, official[0]!.url);
  assert.match(cited.note, /不等于/, "a match is never stated as a confirmation");

  // The report points at the seller back office: no public channel can confirm it.
  const walled = matchOfficialEvidence({
    title: "亚马逊美国站入仓新要求",
    officialRefs: [],
    officialUrls: ["https://sellercentral.amazon.com/help/hub/reference/G1881"],
    domain: ["亚马逊平台政策线索"],
  }, official);
  assert.equal(walled.status, "access-restricted");
  assert.equal(walled.officialUrl, null);

  // Nothing official to point at.
  const none = matchOfficialEvidence({
    title: "亚马逊美国站某项小调整",
    officialRefs: [],
    officialUrls: [],
    domain: ["费用与物流线索"],
  }, official);
  assert.equal(none.status, "third-party-only");
});

test("a stored lead carries metadata only: no body, no body excerpt, no body fragment", () => {
  const article: Amz123Article = {
    title: "亚马逊美国站 FBA 配送费调整公告",
    author: "合成作者",
    publishedAt: new Date("2026-08-01T00:00:00Z"),
    sourceUpdatedAt: new Date("2026-08-02T00:00:00Z"),
    description: "站点自带的简短描述",
    tags: ["FBA"],
    bodyText: "这段正文只在内存里用于分类，绝不落库。".repeat(20),
    officialRefs: [],
    officialUrls: [],
  };
  const gate: Amz123GateResult = {
    ok: true, reason: "", ruleIds: ["fees-logistics"], radarTags: ["费用与物流线索"],
    sourceRuleIds: [], sourceTags: [], market: "US", marketEvidence: "title",
  };
  const event: Amz123Event = {
    key: "abc123", state: "new", of: null, domain: "费用与物流线索", effectiveDate: "2026-08-01", officialRef: null, titleCore: "配送费调整",
  };
  const verification: Amz123Verification = {
    status: "third-party-only", officialUrl: null, officialTitle: null, officialPublishedAt: null, note: "仅第三方报道",
  };
  const candidate = amz123LeadCandidate({
    url: "https://www.amz123.com/t/test001",
    title: article.title,
    section: "/t",
    column: "跨境头条",
    via: "listing",
    article,
    gate,
    effectiveDate: "2026-08-01",
    officialRef: null,
    event,
    verification,
  });

  assert.equal("bodyText" in candidate, false, "the body is never part of the stored material");
  assert.equal("bodyHtml" in candidate, false);
  assert.equal(candidate.bodyStatus, "none");
  assert.equal(candidate.excerpt, "站点自带的简短描述");
  assert.equal(candidate.publicationTime, "2026-08-01T00:00:00.000Z");
  assert.equal(candidate.sourceUpdatedAt?.toISOString(), "2026-08-02T00:00:00.000Z");
  // Nothing in the stored shape carries a long text: the body never leaks into the metadata.
  const longest = JSON.stringify(candidate).split(/[",]/).reduce((max, part) => Math.max(max, part.length), 0);
  assert.ok(longest < 400, `the longest stored fragment is ${longest} characters`);
  assert.equal((candidate.raw as any).lead.gateVersion, AMZ123_GATE_VERSION);
});

test("the same URL has one identity, so a repeat discovery cannot create a second record", () => {
  const first = identityKeyForUrl("https://www.amz123.com/t/0ASKU6CU");
  const again = identityKeyForUrl("https://www.amz123.com/t/0ASKU6CU");
  const other = identityKeyForUrl("https://www.amz123.com/t/5Z6bFgNc");
  assert.equal(first, again);
  assert.notEqual(first, other);
});

test("the approved columns are the two this round reads", () => {
  assert.deepEqual(AMZ123_SECTIONS.map((s) => s.section), ["/t", "/kx"]);
  assert.deepEqual(AMZ123_SECTIONS.map((s) => s.role), ["主来源", "补充来源"]);
});
