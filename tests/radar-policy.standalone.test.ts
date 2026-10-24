import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { test } from "node:test";
import { previewSource } from "@aihot/backend/admin/sources";
import { config } from "@aihot/backend/config";
import { classifyRadarText, summarizeRadarPolicy } from "@aihot/backend/editorial/radar-rules";
import { unsupportedConfig } from "@aihot/backend/sources/config-keys";
import { identityKeyForUrl } from "@aihot/backend/lib/url";
import { AMAZON_US_ANNOUNCEMENTS_SOURCE_ID, isApprovedRadarPolicyWebList, isApprovedRadarRegulatoryFeed, isApprovedRadarRegulatorySource, isQualifyingAmazonPolicyAnnouncement, RADAR_POLICY_SOURCE_IDS, RADAR_REGULATORY_SOURCE_IDS } from "@aihot/backend/sources/radar-policy-source";
import { dateOnlyPublicationDate } from "@aihot/backend/publication/time-precision";
import { readPublicationDate } from "@aihot/backend/sources/dates";
import { fetchRss } from "@aihot/backend/sources/rss";
import { fetchDetail, fetchWebList, fromHtml } from "@aihot/backend/sources/web-list";

test("Phase 1 policy labels are explainable by exact source text", () => {
  const cases = [
    ["Amazon seller policy update changes listing requirements", "亚马逊平台政策线索"],
    ["Amazon FBA fulfillment fees will increase next quarter", "费用与物流线索"],
    ["Update to U.S. Referral and Fulfillment by Amazon fees for 2026", "费用与物流线索"],
    ["FBA inbound placement and split shipments are changing", "FBA 入库与分仓线索"],
    ["Category approval and product compliance requirements", "类目合规线索"],
    ["Listing Protection for Account Health Assurance sellers", "亚马逊账号健康与申诉线索"],
    ["removing the requirement of maintaining a 95% valid tracking rate", "亚马逊卖家项目规则线索"],
    ["CPSC recalls a consumer product due to a fire hazard", "美国监管与产品召回线索"],
  ] as const;

  for (const [title, expectedTag] of cases) {
    const result = classifyRadarText({ title });
    assert.ok(result.tags.includes(expectedTag), title);
    const hit = result.evidence.find((item) => item.label && title.slice(item.start, item.end) === item.matchedText);
    assert.ok(hit, `expected evidence offsets into exact title text: ${title}`);
  }
});

test("Accelerate policy summary requires all source-body evidence and leaves rollout timing distinct from an effective date", () => {
  const title = "At Accelerate 2026, Amazon shares new AI tools as a force multiplier for independent sellers";
  const body = [
    "Amazon is building more due process into Account Health with a program called Listing Protection.",
    "It will reach all Account Health Assurance sellers in the U.S. by year-end and worldwide in 2027.",
    "When a violation is flagged, the listing stays live while the seller resolves it, with clear steps and a way to challenge errors.",
  ].join(" ");
  const result = classifyRadarText({ title, bodyText: body });
  const summary = summarizeRadarPolicy({ bodyText: body });
  assert.ok(result.tags.includes("亚马逊账号健康与申诉线索"));
  assert.ok(result.evidence.some((hit) => hit.ruleId === "account-health" && hit.field === "body" && hit.matchedText === "Listing Protection"));
  assert.equal(result.evidence.some((hit) => hit.ruleId === "effective-date"), false);
  assert.match(summary ?? "", /违规被标记后，卖家处理期间商品刊登会继续在线/);
  assert.match(summary ?? "", /2026年底前覆盖美国所有 Account Health Assurance 卖家，2027年推广至全球/);
  assert.match(summary ?? "", /未给出明确的政策生效日期/);
  assert.equal(summarizeRadarPolicy({ bodyText: "Listing Protection Account Health year-end 2027" }), null);
  assert.equal(summarizeRadarPolicy({ bodyText: "" }), null);
});

test("Amazon announcement seller-rule evidence is stored as a policy lead with a fact-bounded Chinese summary", () => {
  const body = [
    "These enhancements are based on your feedback and available now to support your business growth.",
    "We’ve updated our process to reduce return-less refunds. These changes ensure that return-less refunds only occur when the customer has not received the product by the promised timeline.",
    "They also apply when they received a damaged or defective product that is non-returnable, or the product is unsafe to return.",
    "We made it easier to qualify for the free program by removing the requirement of maintaining a 95% valid tracking rate.",
    "The program is now free if you are a low-volume seller with fewer than 30 orders per quarter.",
  ].join(" ");
  const result = classifyRadarText({ title: "Upgrades to Customer Service by Amazon", bodyText: body });
  assert.ok(result.tags.includes("亚马逊卖家项目规则线索"));
  const hit = result.evidence.find((item) => item.ruleId === "seller-program-rules" && item.field === "body");
  assert.ok(hit);
  assert.equal(body.slice(hit!.start, hit!.end), hit!.matchedText);
  assert.equal(isQualifyingAmazonPolicyAnnouncement(body), true);
  const summary = summarizeRadarPolicy({ bodyText: body });
  assert.match(summary ?? "", /不再要求维持 95% 有效追踪率/);
  assert.match(summary ?? "", /季度订单少于 30 单/);
  assert.match(summary ?? "", /未列出单独的生效日期/);
  assert.equal(isQualifyingAmazonPolicyAnnouncement("New features and updates help sellers save time with automatic pricing.".repeat(8)), false);
  assert.equal(summarizeRadarPolicy({ bodyText: "return-less refunds only occur when a customer asks." }), null);
});

test("effective dates are shown only when an explicit effective-date phrase and date occur together", () => {
  const explicit = "The revised fee schedule is effective April 1, 2027.";
  const inferredFromPublishDate = "Published April 1, 2027. The fee schedule is changing.";
  const hit = classifyRadarText({ title: explicit }).evidence.find((item) => item.ruleId === "effective-date");
  assert.equal(hit?.matchedText, "effective April 1, 2027");
  assert.equal(hit ? explicit.slice(hit.start, hit.end) : null, hit?.matchedText);
  assert.equal(classifyRadarText({ title: inferredFromPublishDate }).evidence.some((item) => item.ruleId === "effective-date"), false);
  assert.equal(classifyRadarText({ title: explicit }).tags.some((tag) => tag.includes("生效日期")), false);
});

test("a source calendar date stays date-only instead of acquiring a guessed time", () => {
  assert.equal(dateOnlyPublicationDate("2026-09-29"), "2026-09-29");
  assert.equal(dateOnlyPublicationDate("2026-02-29"), undefined);
  assert.equal(dateOnlyPublicationDate("2026-09-29T21:15:57.394"), undefined);
  const title = "At Accelerate 2026, Amazon shares new AI tools as a force multiplier for independent sellers";
  const summary = "At its annual seller conference, Amazon unveiled AI tools built to remove the ceiling on what small, independent businesses can do.";
  assert.deepEqual(classifyRadarText({ title, excerpt: summary }).tags, []);
});

test("the seed sources separate Amazon updates from the CPSC regulatory recall RSS", () => {
  const pack = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8")) as { sources: Array<Record<string, any>> };
  const ids = pack.sources.map((source) => source.id);
  assert.equal(new Set(ids).size, ids.length, "source ids are unique");
  assert.deepEqual([...ids].sort(), [
    "ads-policy-pages",
    "amazon-us-accelerate-updates",
    "amazon-us-announcements",
    "amazon-us-fee-updates",
    "amz123-policy-leads",
    "rss-cpsc-recalls",
    "us-federal-register-cpsc",
    "us-federal-register-ftc",
  ]);
  // The third-party lead source is a lead, never a platform policy source and never a regulation feed.
  const lead = pack.sources.find((source) => source.id === "amz123-policy-leads")!;
  assert.equal(isApprovedRadarPolicyWebList(lead as never), false);
  assert.equal(isApprovedRadarRegulatorySource(lead.id), false);
  assert.equal((lead.tags as string[]).includes("platform_policy"), false);
  assert.equal((lead.tags as string[]).includes("external_regulation"), false);
  assert.equal(lead.participation_mode, "isolated");
  assert.equal(lead.interval_minutes, 360);
  // Ads policy is its own chain: it must never be admitted as seller policy or as U.S. regulation.
  const ads = pack.sources.find((source) => source.id === "ads-policy-pages")!;
  assert.equal(isApprovedRadarPolicyWebList(ads as never), false);
  assert.equal(isApprovedRadarRegulatorySource(ads.id), false);
  assert.equal((ads.tags as string[]).includes("platform_policy"), false);
  assert.equal((ads.tags as string[]).includes("external_regulation"), false);
  assert.ok((ads.tags as string[]).includes("ads_policy"));
  const amazon = pack.sources.find((source) => source.id === "amazon-us-fee-updates")!;
  assert.equal(amazon.kind, "web_list");
  assert.equal(amazon.config.url, "https://sellingpartners.aboutamazon.com/data-insights");
  assert.deepEqual(amazon.config._aihot, { initialBackfillLimit: 10, initialBackfillMonths: 13 });
  assert.deepEqual(amazon.config.allowUrlPrefixes, ["https://sellingpartners.aboutamazon.com/update-to-u-s-referral-and-fulfillment-by-amazon-fees-for-"]);
  assert.deepEqual(unsupportedConfig("web_list", amazon.config), []);
  assert.equal(isApprovedRadarPolicyWebList(amazon as never), true);
  assert.ok((amazon.tags as string[]).includes("platform_policy"), "fee updates are Amazon platform policy");
  assert.equal(amazon.site_fulltext, false);
  assert.equal(amazon.syndicate_fulltext, false);

  const accelerate = pack.sources.find((source) => source.id === "amazon-us-accelerate-updates")!;
  assert.equal(accelerate.kind, "web_list");
  assert.equal(accelerate.config.url, "https://sellingpartners.aboutamazon.com/");
  assert.deepEqual(accelerate.config._aihot, { initialBackfillLimit: 10, initialBackfillMonths: 13 });
  assert.deepEqual(accelerate.config.allowUrlPrefixes, ["https://sellingpartners.aboutamazon.com/accelerate-"]);
  assert.deepEqual(accelerate.config.publisherUrlPrefixes, accelerate.config.allowUrlPrefixes);
  assert.deepEqual(unsupportedConfig("web_list", accelerate.config), []);
  // Its only record is an Accelerate 2026 conference recap, so the source has no policy admission
  // (the id is off RADAR_POLICY_SOURCE_IDS), is disabled, and carries no platform_policy tag.
  assert.equal(isApprovedRadarPolicyWebList(accelerate as never), false);
  assert.deepEqual(accelerate.tags, ["亚马逊官方", "卖家活动与功能宣传"]);
  assert.equal(accelerate.enabled, false);
  assert.equal((accelerate.tags as string[]).includes("platform_policy"), false);
  assert.equal(accelerate.site_fulltext, false);
  assert.equal(accelerate.syndicate_fulltext, false);

  const announcements = pack.sources.find((source) => source.id === AMAZON_US_ANNOUNCEMENTS_SOURCE_ID)!;
  assert.equal(announcements.kind, "web_list");
  assert.equal(announcements.config.url, "https://sell.amazon.com/blog/announcements?p=1&mons_sel_locale=en_US");
  assert.equal(announcements.config.parseMode, "html");
  assert.equal(announcements.config.itemSelector, ".PagePromoC");
  assert.equal(announcements.config.linkSelector, ".PagePromo-title a.Link");
  assert.equal(announcements.config.publishedAtSelector, ".PagePromo-date");
  assert.deepEqual(announcements.config.allowUrlPrefixes, ["https://sell.amazon.com/blog/announcements/"]);
  assert.deepEqual(announcements.config.publisherUrlPrefixes, announcements.config.allowUrlPrefixes);
  assert.equal(announcements.config.detail.publishedAtRegex, String.raw`datePublished">([^<]+)</div>`);
  const publishedDate = new RegExp(announcements.config.detail.publishedAtRegex).exec('<div class="datePublished">May 22, 2026</div>')?.[1];
  assert.equal(readPublicationDate(publishedDate, announcements.config.detail.publishedAtUtcOffset).publicationTime, "2026-05-22");
  assert.equal(announcements.config.detail.publishedAtAuthoritative, false, "the verified official listing date is used; page last-modified metadata cannot override it");
  assert.deepEqual(announcements.config._aihot, { initialBackfillLimit: 15, initialBackfillMonths: 13 });
  assert.deepEqual(unsupportedConfig("web_list", announcements.config), []);
  assert.equal(isApprovedRadarPolicyWebList(announcements as never), true);
  assert.equal(announcements.enabled, true, "only discovered announcement URLs whose full body contains seller-rule evidence are stored");
  assert.equal(announcements.site_fulltext, false);
  assert.equal(announcements.syndicate_fulltext, false);

  const page = `<div class="PagePromoC"><div class="PagePromo-title"><a class="Link" href="https://sell.amazon.com/blog/announcements/upgrades-to-customer-service-by-amazon">Upgrades to Customer Service by Amazon help sellers save time and reduce refunds</a></div><div class="PagePromo-date">May 22, 2026</div></div>
    <div class="PagePromoC"><div class="PagePromo-title"><a class="Link" href="https://sell.amazon.com/blog/prime-day-tips">Prepare for Prime Day</a></div><div class="PagePromo-date">May 19, 2026</div></div>`;
  const parsed = fromHtml(page, announcements.config.url, announcements as never);
  assert.deepEqual(parsed.map((item) => ({ title: item.title, url: item.url, publicationTime: item.publicationTime })), [
    { title: "Upgrades to Customer Service by Amazon help sellers save time and reduce refunds", url: "https://sell.amazon.com/blog/announcements/upgrades-to-customer-service-by-amazon", publicationTime: "2026-05-22" },
  ]);

  const cpsc = pack.sources.find((source) => source.id === "rss-cpsc-recalls")!;
  assert.equal(cpsc.kind, "rss");
  assert.equal(cpsc.config.feedUrl, "https://www.cpsc.gov/Newsroom/CPSC-RSS-Feed/Recalls-RSS");
  assert.equal(cpsc.config.acceptLanguage, "en-US,en;q=0.9");
  assert.deepEqual(unsupportedConfig("rss", cpsc.config), []);
  assert.equal(cpsc.tier, "T1");
  assert.deepEqual(cpsc.tags, ["external_regulation", "美国监管机构", "消费品安全", "产品召回"]);
  assert.equal(cpsc.site_fulltext, false);
  assert.equal(cpsc.syndicate_fulltext, false);

  // Federal Register rulemaking is a separate regulatory identity: it must never be read as Amazon policy.
  for (const id of ["us-federal-register-cpsc", "us-federal-register-ftc"]) {
    const source = pack.sources.find((entry) => entry.id === id)!;
    assert.equal(source.kind, "rss");
    assert.match(String(source.config.feedUrl), /^https:\/\/www\.federalregister\.gov\/api\/v1\/documents\.rss\?/);
    assert.equal(source.config.acceptLanguage, "en-US,en;q=0.9");
    assert.deepEqual(unsupportedConfig("rss", source.config), []);
    assert.equal(source.tier, "T1");
    assert.ok(source.tags.includes("external_regulation"), `${id} is tagged external_regulation`);
    assert.equal(source.site_fulltext, false);
    assert.equal(source.syndicate_fulltext, false);
  }
});

test("Radar's web-list exception rejects other sources and any broadened Amazon configuration", () => {
  const pack = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8")) as { sources: Array<Record<string, any>> };
  const amazon = pack.sources.find((source) => source.id === "amazon-us-fee-updates")!;
  const changed = (patch: Record<string, unknown>) => ({ ...amazon, config: { ...amazon.config, ...patch } });
  assert.equal(isApprovedRadarPolicyWebList({ ...amazon, id: "other-source" } as never), false);
  assert.equal(isApprovedRadarPolicyWebList({ ...amazon, kind: "rss" } as never), false);
  assert.equal(isApprovedRadarPolicyWebList(changed({ url: "https://example.com/news" }) as never), false);
  assert.equal(isApprovedRadarPolicyWebList(changed({ allowUrlPrefixes: ["https://sellingpartners.aboutamazon.com/"] }) as never), false);
  assert.equal(isApprovedRadarPolicyWebList(changed({ detail: { publishedAtSelector: "time" } }) as never), false);
  assert.equal(isApprovedRadarPolicyWebList(changed({ fetchPublicContent: true }) as never), false);
  assert.equal(isApprovedRadarPolicyWebList(changed({ _aihot: { initialBackfillLimit: 10, initialBackfillMonths: 12 } }) as never), false);
  assert.equal(isApprovedRadarPolicyWebList(changed({ _aihot: { initialBackfillLimit: 11, initialBackfillMonths: 13 } }) as never), false);
  assert.equal(isApprovedRadarPolicyWebList(changed({ _aihot: { initialBackfillLimit: 10, initialBackfillMonths: 13, unexpected: true } }) as never), false);

  // `amazon-us-accelerate-updates` has no platform-policy admission at all: its only record is a
  // conference recap. Re-enabling the source, or restoring its exact declared config, must not
  // bring the admission back.
  const accelerate = pack.sources.find((source) => source.id === "amazon-us-accelerate-updates")!;
  assert.equal((RADAR_POLICY_SOURCE_IDS as readonly string[]).includes(accelerate.id), false, "the id is off the policy allowlist");
  assert.equal(isApprovedRadarPolicyWebList(accelerate as never), false, "its declared config is not a policy source");
  assert.equal(isApprovedRadarPolicyWebList({ ...accelerate, enabled: true } as never), false, "re-enabling does not admit it");
  assert.equal(isApprovedRadarPolicyWebList({ ...accelerate, enabled: true, config: { ...accelerate.config, _aihot: { initialBackfillLimit: 10, initialBackfillMonths: 13 } } } as never), false);
  assert.equal(isApprovedRadarPolicyWebList({ ...accelerate, id: "amazon-us-accelerate-updates", kind: "rss", enabled: true } as never), false);

  const announcements = pack.sources.find((source) => source.id === AMAZON_US_ANNOUNCEMENTS_SOURCE_ID)!;
  const changedAnnouncements = (patch: Record<string, unknown>) => ({ ...announcements, config: { ...announcements.config, ...patch } });
  assert.equal(isApprovedRadarPolicyWebList({ ...announcements, id: "other-source" } as never), false);
  assert.equal(isApprovedRadarPolicyWebList(changedAnnouncements({ url: "https://sell.amazon.com/blog/announcements" }) as never), false);
  assert.equal(isApprovedRadarPolicyWebList(changedAnnouncements({ parseMode: "sitemap" }) as never), false);
  assert.equal(isApprovedRadarPolicyWebList(changedAnnouncements({ itemSelector: ".PageList-items-item" }) as never), false);
  assert.equal(isApprovedRadarPolicyWebList({ ...announcements, config: { ...announcements.config, allowUrlPrefixes: ["https://sell.amazon.com/"] } } as never), false);
  assert.equal(isApprovedRadarPolicyWebList(changedAnnouncements({ publisherUrlPrefixes: ["https://sell.amazon.com/blog/"] }) as never), false);
  assert.equal(isApprovedRadarPolicyWebList({ ...announcements, config: { ...announcements.config, detail: { ...announcements.config.detail, maxFetches: 50 } } } as never), false);
});

test("the admin preview cannot fetch an unapproved web source in Radar mode", async () => {
  await assert.rejects(
    previewSource({ id: "unapproved-web-source", kind: "web_list", config: { url: "http://127.0.0.1:1/list", parseMode: "html" } } as never),
    /LightChoice Radar blocks unapproved non-RSS sources/,
  );
});

test("the configured selectors keep only Amazon fee-update links and preserve the listing date across repeat reads", async () => {
  const pack = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8")) as { sources: Array<Record<string, any>> };
  const configured = pack.sources.find((source) => source.id === "amazon-us-fee-updates")!;
  const policyUrl = "https://sellingpartners.aboutamazon.com/update-to-u-s-referral-and-fulfillment-by-amazon-fees-for-2026";
  const html = `<!doctype html><html><body>
    <div class="PageList-items-item"><h2 class="PagePromo-title"><a class="Link" href="${policyUrl}">Update to U.S. Referral and Fulfillment by Amazon fees for 2026</a></h2><time class="PagePromo-date" datetime="2025-10-15">Oct 15, 2025</time></div>
    <div class="PageList-items-item"><h2 class="PagePromo-title"><a class="Link" href="https://sellingpartners.aboutamazon.com/seller-stories/example">Seller story unrelated to policy</a></h2><time class="PagePromo-date">Oct 15, 2025</time></div>
    <div class="PageList-items-item"><h2 class="PagePromo-title"><a class="Link" href="${policyUrl}">Duplicate card</a></h2><time class="PagePromo-date">Oct 15, 2025</time></div>
  </body></html>`;
  const previous = config.allowPrivateNetworkFetch;
  config.allowPrivateNetworkFetch = true;
  const server = http.createServer((_request, response) => response.writeHead(200, { "content-type": "text/html" }).end(html));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  const source = {
    ...configured,
    config: { ...configured.config, url: `http://127.0.0.1:${port}/listing` },
  } as never;
  try {
    const first = await fetchWebList(source);
    const second = await fetchWebList(source);
    assert.equal(first.length, 1);
    assert.equal(first[0]!.title, "Update to U.S. Referral and Fulfillment by Amazon fees for 2026");
    assert.equal(first[0]!.url, policyUrl);
    assert.equal(first[0]!.publishedAt?.toISOString().slice(0, 10), "2025-10-15");
    assert.equal(identityKeyForUrl(first[0]!.url), identityKeyForUrl(second[0]!.url));
  } finally {
    config.allowPrivateNetworkFetch = previous;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("the annual Amazon seller update list keeps only its recap and reads the official publication date", async () => {
  const pack = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8")) as { sources: Array<Record<string, any>> };
  const configured = pack.sources.find((source) => source.id === "amazon-us-accelerate-updates")!;
  const title = "At Accelerate 2026, Amazon shares new AI tools as a force multiplier for independent sellers";
  const summary = "At its annual seller conference, Amazon unveiled AI tools built to remove the ceiling on what small, independent businesses can do.";
  const articlePath = "/accelerate-2026-recap";
  const listingHtml = `<!doctype html><html><body><div class="PageList-items-item"><h2 class="PagePromo-title"><a class="Link" href="${articlePath}">${title}</a></h2></div>
    <div class="PageList-items-item"><h2 class="PagePromo-title"><a class="Link" href="https://sellingpartners.aboutamazon.com/seller-story-unrelated">Seller story unrelated to policy</a></h2></div></body></html>`;
  const articleHtml = `<!doctype html><html><head><meta property="og:description" content="${summary}"><script type="application/ld+json">{"@type":"Article","datePublished":"2026-09-29T21:15:57.394"}</script></head><body><h1>${title}</h1></body></html>`;
  const previous = config.allowPrivateNetworkFetch;
  config.allowPrivateNetworkFetch = true;
  const server = http.createServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html" }).end(request.url === "/listing" ? listingHtml : articleHtml);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  const origin = `http://127.0.0.1:${port}`;
  const source = {
    ...configured,
    config: {
      ...configured.config,
      url: `${origin}/listing`,
      allowUrlPrefixes: [`${origin}/accelerate-`],
      publisherUrlPrefixes: [`${origin}/accelerate-`],
    },
  } as never;
  try {
    const candidates = await fetchWebList(source);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0]!.title, title);
    assert.equal(candidates[0]!.url, `${origin}${articlePath}`);
    assert.equal(candidates[0]!.publishedAt, null);
    const detail = await fetchDetail(candidates[0]!.url, source, { date: true, title: true, summary: true });
    assert.equal(detail.title, title);
    assert.equal(detail.summary, summary);
    assert.equal(detail.publishedAt?.toISOString(), "2026-09-29T00:00:00.000Z");
    assert.equal(detail.publicationTime, "2026-09-29");
  } finally {
    config.allowPrivateNetworkFetch = previous;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("detail article reads use one bounded retry for a transient connection reset", async () => {
  const previous = config.allowPrivateNetworkFetch;
  config.allowPrivateNetworkFetch = true;
  let attempts = 0;
  const articleText = "Amazon updated the seller program requirements. Sellers who maintain valid tracking can use the service. This article describes the rule change and the conditions in detail. ".repeat(3);
  const html = `<!doctype html><html><head><meta property="og:description" content="Seller program update"></head><body><div class="datePublished">May 22, 2026</div><article><h1>Seller program requirements updated</h1><p>${articleText}</p></article></body></html>`;
  const server = http.createServer((request, response) => {
    attempts += 1;
    if (attempts === 1) { request.socket.destroy(); return; }
    response.writeHead(200, { "content-type": "text/html" }).end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  const pack = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8")) as { sources: Array<Record<string, any>> };
  const configured = pack.sources.find((source) => source.id === AMAZON_US_ANNOUNCEMENTS_SOURCE_ID)!;
  const source = { ...configured, config: { ...configured.config, url: `http://127.0.0.1:${port}/listing` } } as never;
  try {
    const result = await fetchDetail(`http://127.0.0.1:${port}/article`, source, { date: true, title: true, summary: true, body: true });
    assert.equal(attempts, 2);
    assert.equal(result.title, "Seller program requirements updated");
    assert.equal(result.publicationTime, "2026-05-22");
    assert.ok((result.body?.text.length ?? 0) > 200);
  } finally {
    config.allowPrivateNetworkFetch = previous;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("web-list HTTP failures and empty parses remain explicit errors", async () => {
  const previous = config.allowPrivateNetworkFetch;
  config.allowPrivateNetworkFetch = true;
  const server = http.createServer((request, response) => {
    if (request.url === "/error") response.writeHead(503, { "content-type": "text/plain" }).end("temporarily unavailable");
    else response.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><html><body><p>no cards</p></body></html>");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  const pack = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8")) as { sources: Array<Record<string, any>> };
  const configured = pack.sources.find((source) => source.id === "amazon-us-fee-updates")!;
  const sourceAt = (path: string) => ({ ...configured, config: { ...configured.config, url: `http://127.0.0.1:${port}${path}` } }) as never;
  try {
    await assert.rejects(fetchWebList(sourceAt("/error")), /HTTP 503/);
    await assert.rejects(fetchWebList(sourceAt("/empty")), /no items matched \(html\)/);
  } finally {
    config.allowPrivateNetworkFetch = previous;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("an RSS HTTP error stays a collection error instead of an empty success", async () => {
  const previous = config.allowPrivateNetworkFetch;
  config.allowPrivateNetworkFetch = true;
  const server = http.createServer((_request, response) => {
    response.writeHead(503, { "content-type": "text/plain" }).end("temporarily unavailable");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  try {
    await assert.rejects(
      fetchRss({ id: "test-failing-feed", kind: "rss", config: { feedUrl: `http://127.0.0.1:${port}/feed.xml` } } as never, { force: true }),
      (error: unknown) => error instanceof Error && error.message === "HTTP 503",
    );
  } finally {
    config.allowPrivateNetworkFetch = previous;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("only the three approved regulatory feeds are schedulable, and only on their own host", () => {
  assert.deepEqual([...RADAR_REGULATORY_SOURCE_IDS], ["rss-cpsc-recalls", "us-federal-register-cpsc", "us-federal-register-ftc"]);
  const pack = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8")) as { sources: Array<Record<string, any>> };
  for (const id of RADAR_REGULATORY_SOURCE_IDS) {
    const declared = pack.sources.find((source) => source.id === id)!;
    assert.equal(isApprovedRadarRegulatorySource(id), true);
    assert.equal(isApprovedRadarRegulatoryFeed(declared as never), true, `${id} points at its own official host`);
    assert.ok((declared.tags as string[]).includes("external_regulation"), `${id} is external_regulation, not platform policy`);
    assert.equal((declared.tags as string[]).includes("platform_policy"), false);
  }
  // An approved id with a different host, a different kind, or an unapproved id is refused.
  assert.equal(isApprovedRadarRegulatoryFeed({ id: "rss-cpsc-recalls", kind: "rss", config: { feedUrl: "https://example.com/rss" } } as never), false);
  assert.equal(isApprovedRadarRegulatoryFeed({ id: "rss-cpsc-recalls", kind: "web_list", config: { feedUrl: "https://www.cpsc.gov/Newsroom/CPSC-RSS-Feed/Recalls-RSS" } } as never), false);
  assert.equal(isApprovedRadarRegulatoryFeed({ id: "rss-home-assistant-community", kind: "rss", config: { feedUrl: "https://www.cpsc.gov/Newsroom/CPSC-RSS-Feed/Recalls-RSS" } } as never), false);
  assert.equal(isApprovedRadarRegulatorySource("amazon-us-announcements"), false);
  assert.equal(isApprovedRadarRegulatorySource("rss-wyze-community"), false);
});
