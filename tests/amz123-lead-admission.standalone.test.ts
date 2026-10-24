// Round 20: the AMZ123 lead admission layer and the article parser.
//
// These cases come from real pages: the two reports round 19 mis-handled and the quick news whose
// 156-character body was read as a parse failure. The official sources' own rules are untouched,
// so the shared classification is checked here as well.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  amz123LeadGate,
  parseAmz123Article,
  extractEffectiveDate,
  AMZ123_GATE_VERSION,
} from "../packages/backend/src/sources/amz123.ts";
import { amz123Subject, AMZ123_SOURCE_TAG } from "../packages/backend/src/sources/amz123-lead-gate.ts";
import { classifyRadarText, RADAR_RULE_VERSION } from "../packages/backend/src/editorial/radar-rules.ts";

/**
 * A devalue-shaped payload in the site's own form: the first entry is a marker array, the second
 * is the root object, and every other value sits in the top-level array and is referenced by
 * index. The marker is what keeps a literal number (a publication date) from being read as an
 * index.
 */
function page(article: Record<string, unknown> | null, extra: Record<string, unknown> = {}): string {
  const values: unknown[] = [];
  const articleFields: Record<string, number> = {};
  if (article) {
    for (const [key, value] of Object.entries(article)) {
      articleFields[key] = values.length + 2;
      values.push(value);
    }
  }
  const articleRef = article ? values.length + 2 : -1;
  values.push(articleFields);
  values.push(extra);
  const root = { article: articleRef, other: values.length + 1 };
  values.unshift(root);
  values.unshift(["Reactive", 1]);
  return `<html><body><script id="__NUXT_DATA__" type="application/json">${JSON.stringify(values)}</script></body></html>`;
}

const LONG_BODY = "亚马逊美国站宣布调整 FBA 配送费标准，新的费率将于 2026 年 11 月 1 日生效，卖家需要在后台确认新的配送方案。".repeat(3);

/* --------------------------------------------------- the wrongly admitted report */

const COMPANY_FINANCIAL = {
  title: "年营收近36亿元，倍思奇挂牌新三板",
  description:
    "AMZ123获悉，主营人体工学与智能家居产品的倍思奇创新科技（深圳）近日获股转公司批复，正式挂牌新三板基础层。公司以2025年营收35.99亿元、归母净利润7348.60万元的业绩登陆公开市场。从收入结构来看，亚马逊渠道收入占比达88.25%，北美市场贡献74.81%，影音与办公类目各贡献约35%的营收；安克创新持股1.79%，位列第六大股东。财务数据方面，公司2025年净利润同比增长418.16%，毛利率提升至38.14%，经营现金流由负转正，达2.36亿元。但与此同时，销售费用率高达30.22%，研发费用占比仅为1.18%。",
  tags: [],
  bodyText:
    "AMZ123获悉，主营人体工学与智能家居产品的倍思奇创新科技（ 深圳 ）近日获股转公司批复，正式挂牌新三板基础层。公司以2025年营收35.99亿元、归母净利润7348.60万元的业绩登陆公开市场。从收入结构来看，亚马逊渠道收入占比达88.25%，北美市场贡献74.81%。财务数据方面，公司2025年净利润同比增长418.16%，毛利率提升至38.14%，经营现金流由负转正。但与此同时，销售费用率高达30.22%，研发费用占比仅为1.18%。",
};

test("a company financial report is not a lead, even when it names Amazon and a fee term", () => {
  const gate = amz123LeadGate(COMPANY_FINANCIAL);
  assert.equal(gate.ok, false);
  assert.match(gate.reason, /company financial report/);
  // The shared rules did match it, on the accounting term "销售费用": the source's own layer is
  // what refuses it.
  assert.ok(classifyRadarText({ title: COMPANY_FINANCIAL.title, excerpt: COMPANY_FINANCIAL.description, bodyText: COMPANY_FINANCIAL.bodyText }).tags.length > 0);
  assert.equal(amz123Subject(COMPANY_FINANCIAL).kind, "company-financial");
});

test("a real Amazon fee policy is still a lead", () => {
  const gate = amz123LeadGate({
    title: "亚马逊美国站 FBA 配送费调整公告",
    description: "美国站 FBA 配送费标准调整，11 月 1 日生效。",
    tags: ["FBA"],
    bodyText: "美国站 FBA 配送费将调整，新的费率标准将于 2026 年 11 月 1 日生效，卖家需要在后台确认。",
  });
  assert.equal(gate.ok, true);
  assert.equal(gate.market, "US");
});

test("a logistics company's financial result is not a lead", () => {
  const input = {
    title: "德迅Q3净利润增长53% 上调全年EBIT指引",
    description: "德迅发布2026年第三季度财报，集团净营业额同比增长22%，EBIT增长53%。",
    tags: [],
    bodyText: "德迅发布2026年第三季度财报，集团净营业额同比增长22%至74亿瑞士法郎，EBIT增长53%，净利润增长53%。",
  };
  const gate = amz123LeadGate(input);
  // It is refused. The gate names the first reason it can prove, and the shared rules find no
  // policy wording in a quarterly result; the subject layer still reads it as a financial report.
  assert.equal(gate.ok, false);
  assert.equal(amz123Subject(input).kind, "company-financial");
});

test("a company operations report is not a lead", () => {
  const input = {
    title: "亚马逊美国假日季拟新增30万临时岗位，招聘规模创新高",
    description: "亚马逊计划在美国全国范围内招聘超过30万名季节性员工。",
    tags: ["Amazon", "美国"],
    bodyText: "亚马逊计划在美国全国范围内招聘超过30万名季节性员工，岗位涵盖核心运营网络中的季节性、兼职和全职工作。",
  };
  const gate = amz123LeadGate(input);
  assert.equal(gate.ok, false);
  assert.equal(amz123Subject(input).kind, "company-operation");
});

/* ------------------------------------------------------- the missed policy report */

const REVIEW_POLICY = {
  title: "亚马逊上线新功能，卖家可以付费“买评论”了？",
  description:
    "长期以来，操纵评论都是亚马逊红线。站外索评、包裹卡片、私信催评，全部属于违规操作，轻则 Listing 掉权重，重则下架封店。新品起评难、老品稳评难，一直是跨境卖家的核心痛点。前段时间亚马逊大会公布重磅新功能：Review Requests Ads 付费邀评广告，带来一条官方合规邀评新渠道。美国站将于10月下旬公测，属于付费广告邀评。",
  tags: ["测评", "Amazon"],
  bodyText:
    "长期以来，操纵评论都是亚马逊红线。站外索评、包裹卡片、私信催评，全部属于违规操作，轻则 Listing 掉权重，重则下架封店。前段时间亚马逊大会公布重磅新功能：Review Requests Ads 付费邀评广告，带来一条官方合规邀评新渠道。官方付费邀评是什么？简单说，卖家投放广告，亚马逊主动向近期下单买家推送官方邀评卡片。美国站将于10月下旬公测，属于付费广告邀评。",
};

test("a real US Amazon review-policy report is a lead", () => {
  const gate = amz123LeadGate(REVIEW_POLICY);
  assert.equal(gate.ok, true);
  assert.equal(gate.market, "US");
  // The shared rules did not recognise it; the source's own rule did.
  assert.equal(classifyRadarText({ title: REVIEW_POLICY.title, excerpt: REVIEW_POLICY.description, bodyText: REVIEW_POLICY.bodyText }).tags.length, 0);
  assert.deepEqual(gate.sourceRuleIds, ["amz123-platform-rule"]);
  assert.ok(gate.sourceTags.includes(AMZ123_SOURCE_TAG));
});

test("the added review words are not a shortcut on their own", () => {
  // A marketing article that merely mentions 邀评 cannot use it to enter.
  const marketing = amz123LeadGate({
    title: "如何做好邀评，提升店铺转化率的五个技巧",
    description: "分享几个邀评的小技巧。",
    tags: [],
    bodyText: "邀评是提升转化的关键，本文分享五个邀评技巧，帮助卖家更好地与买家沟通。",
  });
  assert.equal(marketing.ok, false);

  // The same words at another platform are not a lead either.
  const other = amz123LeadGate({
    title: "Etsy 禁止卖家刷评，平台将下架违规商品",
    description: "Etsy 宣布禁止卖家刷评，违规商品将被下架。",
    tags: [],
    bodyText: "Etsy 宣布禁止卖家刷评，违规商品将被下架封店。",
  });
  assert.equal(other.ok, false);
  assert.equal(other.sourceRuleIds.length, 0, "another platform's review rule is not this radar's lead");

  // Amazon's review vocabulary without the US market is not a lead for this radar. The shared
  // rules find nothing here, and the source's own rule needs the US market, so the report is
  // refused either way — what matters is that it is not admitted.
  const noMarket = amz123LeadGate({
    title: "亚马逊欧洲站上线付费邀评功能",
    description: "亚马逊欧洲站将上线付费邀评广告。",
    tags: ["Amazon"],
    bodyText: "亚马逊欧洲站将上线付费邀评广告，违规索评将下架封店。",
  });
  assert.equal(noMarket.ok, false);
  assert.equal(noMarket.sourceRuleIds.length, 0);
});

/* ---------------------------------------------------------------- the parser */

test("a short quick news with real fields is parsed", () => {
  const html = page({
    title: "DHL集团与重庆保税港区签署战略合作协议，助力渝企渝车出海",
    content: "DHL集团与重庆保税港区签署战略合作协议，双方将在跨境物流、仓储与供应链金融等领域展开合作，助力渝企渝车出海。",
    published_at: 1792723742,
    updated_at: 1792741397,
    author: "AMZ123",
    tags: ["物流"],
  });
  const article = parseAmz123Article(html);
  assert.ok(article, "the short article is read");
  assert.equal(article!.title, "DHL集团与重庆保税港区签署战略合作协议，助力渝企渝车出海");
  assert.ok(article!.bodyText.length > 40, "the body is read");
  // It parses, but it is not about Amazon, so the gate still refuses it.
  assert.equal(amz123LeadGate({ title: article!.title, description: article!.description ?? "", tags: article!.tags, bodyText: article!.bodyText }).ok, false);
});

test("a page without an article is still refused", () => {
  // No payload at all.
  assert.equal(parseAmz123Article("<html><body>no payload here</body></html>"), null);
  // A payload with no article object.
  assert.equal(parseAmz123Article(page(null, { cdn_config: { x: 1 } })), null);
  // An article object with an empty body: a shell, not an article.
  assert.equal(parseAmz123Article(page({ title: "空壳页", content: "", published_at: 1792723742 })), null);
  // A body of markup only.
  assert.equal(parseAmz123Article(page({ title: "空壳页", content: "<p></p><div></div>", published_at: 1792723742 })), null);
  // A login wall: the page's own title, a date, and a body that only asks to sign in.
  assert.equal(parseAmz123Article(page({
    title: "请登录后继续访问",
    content: "登录后即可查看完整内容，请使用您的账号登录以继续访问本文内容。",
    published_at: 1792723742,
  })), null);
  // An error page: a status message, not an article.
  assert.equal(parseAmz123Article(page({
    title: "404 页面不存在",
    content: "抱歉，您访问的页面不存在或已被删除，请返回首页继续浏览其他内容。",
    published_at: 1792723742,
  })), null);
});

test("an object missing a key field is refused", () => {
  // No publication date.
  assert.equal(parseAmz123Article(page({ title: "缺日期", content: LONG_BODY })), null);
  // No body.
  assert.equal(parseAmz123Article(page({ title: "缺正文", published_at: 1792723742 })), null);
  // No title.
  assert.equal(parseAmz123Article(page({ content: LONG_BODY, published_at: 1792723742 })), null);
});

test("a normal article parses exactly as before", () => {
  const html = page({
    title: "合成测试标题：美国站 FBA 配送费规则更新",
    content: LONG_BODY,
    published_at: 1785470880,
    updated_at: 1785889337,
    author: { username: "合成作者" },
    description: "站点自带的简短描述",
    tags: ["FBA"],
  });
  const article = parseAmz123Article(html);
  assert.ok(article);
  assert.equal(article!.title, "合成测试标题：美国站 FBA 配送费规则更新");
  assert.equal(article!.author, "合成作者");
  assert.equal(article!.description, "站点自带的简短描述");
  assert.deepEqual(article!.tags, ["FBA"]);
  assert.equal(article!.publishedAt?.toISOString(), "2026-07-31T04:08:00.000Z");
  assert.equal(article!.sourceUpdatedAt?.toISOString(), "2026-08-05T00:22:17.000Z");
  assert.equal(article!.bodyText.length, LONG_BODY.length);
});

/* ------------------------------------------ the official sources are untouched */

test("the shared radar rules are unchanged, so the official sources keep their verdicts", () => {
  // The official sources classify with the shared rules; this round added no word to them.
  assert.equal(RADAR_RULE_VERSION, "radar-policy-v1");
  const official = "Amazon announces updated FBA fulfillment fees effective January 15, 2026. Sellers must review the new fee schedule.";
  const classified = classifyRadarText({ title: "", bodyText: official });
  assert.ok(classified.tags.includes("费用与物流线索"), "the official fee text still matches the shared rule");
  // A marketing title with no policy wording still matches nothing.
  assert.equal(classifyRadarText({ title: "亚马逊美国站今日新品推荐", excerpt: "", bodyText: "选品技巧分享。" }).tags.length, 0);
});

test("the gate version records the source's own layer", () => {
  assert.equal(AMZ123_GATE_VERSION, "amz123-lead-gate-v1");
});

test("the effective date is unchanged", () => {
  assert.equal(extractEffectiveDate("新规将于 2026 年 8 月 1 日生效"), "2026-08-01");
});
