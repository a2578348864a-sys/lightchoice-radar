// AMZ123's own admission layer.
//
// The shared radar rules (packages/backend/src/editorial/radar-rules.ts) are used by the official
// Amazon sources as well, so they are not changed here. Everything in this file is specific to the
// AMZ123 lead source and only decides whether a third-party report is admitted as a lead.
//
// Two problems the shared rules cannot solve on their own:
//
// 1. A company financial report passes the shared gate. "销售费用率" in a quarterly report is the
//    accounting term for selling expenses, and it happens to contain the shared rule's Chinese
//    word "销售费用" (a fee Amazon charges sellers). Together with a mention of Amazon, of North
//    America and of "费用" this made a listing announcement look like a fee policy. A fee the
//    platform charges and a cost a company reports are different subjects, and only the source's
//    own layer can tell them apart.
//
// 2. A real US Amazon policy report is refused. "Review Requests Ads" (paid review requests) is
//    Amazon's own new review-solicitation product, and the report states that the US site starts
//    its public beta in late October, that soliciting reviews off-platform is a violation, and
//    that the penalty is de-listing and closing the store. None of the shared rules' Chinese word
//    lists cover that vocabulary, so the report was refused with "no radar rule matched".
//
// Neither change is a new independent keyword. The added expressions only count together with
// Amazon, the US market and a wording of an actual rule change, so marketing copy and general
// trade news cannot use them as a shortcut.
import { classifyRadarText } from "../editorial/radar-rules.ts";

/** Amazon itself: a report about another platform is not a lead for this radar. */
const AMAZON_MENTION = /亚马逊|amazon|\bAWD\b|\bFBA\b|\bASCS\b/i;
/** The market the rule applies to. */
const US_MARKET = /美国|美区|北美|美國|美国站|US站点|United States|\bUS marketplace\b/i;

/* ------------------------------------------------------- the subject of the report */

/**
 * The report is about a company's own accounts, not about what a platform requires of sellers:
 * a listing, a financial result, a revenue breakdown, a cost ratio. These words are the subject
 * of the report itself, not a policy statement.
 */
const COMPANY_FINANCIAL_SUBJECT = /财报|财务报告|业绩快报|年报|半年报|季报|季度报告|年度报告|营收|营业收入|净利润|归母净利|毛利率|净利率|现金流|每股收益|市盈|营收占比|收入占比|收入结构|销售费用率|管理费用率|研发费用率|费用率|挂牌|新三板|IPO|上市|招股|股价|市值|估值|投融资|融资|并购|减持|增持|分红/;

/**
 * A business report about a company's operations — a hiring round, a sales record, a market
 * share — is still not a rule change for Amazon's sellers.
 */
const COMPANY_OPERATION_SUBJECT = /招聘|岗位|临时工|假日季|物流时效|签收率|客单价|复购率|动销率|断货率|退货率|库存周转/;

/**
 * The words that make the report about a platform's own charges: a named Amazon charge with a
 * change, a new rate or a date. This is what a real fee policy says, and the accounting terms
 * above never appear with these.
 */
const PLATFORM_FEE_CHANGE = /(?:FBA|配送费|仓储费|推荐费|佣金|入库配置费|物流附加费|燃油附加费|低库存水平费|退货处理费|销售费用)(?:标准|费率|规则|政策|价格|上调|下调|调整|变更|新规|将于|自|起)?[^。！？!?]{0,24}(?:上调|下调|调整|变更|更新|提高|降低|新增|取消|实行|生效|实施|执行)/;

/**
 * The report states a rule that a seller must follow or a consequence for breaking it. This is
 * the wording of a policy, as opposed to a company talking about its own numbers.
 */
const RULE_CHANGE_LANGUAGE = /新规|新政策|规则(?:更新|变更|调整)|政策(?:更新|变更|调整)|正式实施|开始实施|生效|将于|不得|禁止|违规|违反|处罚|下架|封店|停用|限制|取消|收紧|要求|标准|门槛|规则|合规/;

/**
 * The Amazon review-solicitation vocabulary the shared rules do not cover. Each of these is only
 * a policy signal together with Amazon, the US market and the rule-change wording.
 */
const REVIEW_POLICY_SUBJECT = /邀评|评论请求|购买评论|付费邀评|官方邀评|邀评广告|Review Requests Ads|索评|刷评|刷单|评价管理|评论政策|评论规则|星级|好评|差评|留评/;

/**
 * The subject of the review-policy vocabulary must be Amazon's own review mechanism, not a
 * seller's marketing copy about how to get reviews.
 */
const REVIEW_POLICY_TARGET = /(?:亚马逊|Amazon|官方|平台|美国站|卖家)(?:的)?[^。！？!?]{0,16}(?:邀评|评论请求|付费邀评|索评|评价|评论|好评)/;

/* ------------------------------------------------------------------- the gate result */

export interface Amz123SubjectResult {
  /** What the report is about. */
  kind: "amazon-policy" | "company-financial" | "company-operation" | "other";
  reason: string;
}

/**
 * What the report is about, read from its own wording. The company's own accounts and its own
 * operations are a different subject from a rule the platform imposes on sellers.
 */
export function amz123Subject(input: { title: string; description: string; tags: string[]; bodyText: string }): Amz123SubjectResult {
  const head = `${input.title} ${input.description} ${input.tags.join(" ")}`;
  // A policy statement about a platform's charges is a policy subject even when the report also
  // quotes the company's numbers, so this is checked first.
  if (PLATFORM_FEE_CHANGE.test(head) || PLATFORM_FEE_CHANGE.test(input.bodyText)) {
    return { kind: "amazon-policy", reason: "" };
  }
  // Amazon's own review mechanism, in the wording of a rule change for sellers. Every part must
  // hold: Amazon's review mechanism, the US market, and a rule the sellers must follow.
  if (amz123ReviewPolicyLead({
    ...input,
    hasAmazon: AMAZON_MENTION.test(head) || AMAZON_MENTION.test(input.bodyText),
    hasUsMarket: US_MARKET.test(head) || US_MARKET.test(input.bodyText),
  })) {
    return { kind: "amazon-policy", reason: "" };
  }
  if (COMPANY_FINANCIAL_SUBJECT.test(head)) return { kind: "company-financial", reason: "a company financial report, not a platform policy" };
  if (COMPANY_FINANCIAL_SUBJECT.test(input.bodyText)) return { kind: "company-financial", reason: "a company financial report, not a platform policy" };
  if (COMPANY_OPERATION_SUBJECT.test(head) || COMPANY_OPERATION_SUBJECT.test(input.bodyText)) {
    return { kind: "company-operation", reason: "a company business report, not a platform policy" };
  }
  return { kind: "other", reason: "" };
}

/**
 * Whether the report is about Amazon's own review mechanism, in the wording of a rule change.
 *
 * Every part must hold: Amazon's review mechanism, the US market and a rule change. A marketing
 * article that merely says "邀评" or a report about another platform's review system never
 * passes.
 */
export function amz123ReviewPolicyLead(input: { title: string; description: string; tags: string[]; bodyText: string; hasAmazon: boolean; hasUsMarket: boolean }): boolean {
  if (!input.hasAmazon || !input.hasUsMarket) return false;
  const head = `${input.title} ${input.description} ${input.tags.join(" ")}`;
  const hasSubject = REVIEW_POLICY_SUBJECT.test(head) || REVIEW_POLICY_SUBJECT.test(input.bodyText);
  if (!hasSubject) return false;
  const hasTarget = REVIEW_POLICY_TARGET.test(input.bodyText) || REVIEW_POLICY_TARGET.test(head);
  if (!hasTarget) return false;
  const hasRule = RULE_CHANGE_LANGUAGE.test(input.bodyText) || RULE_CHANGE_LANGUAGE.test(head);
  return hasRule;
}

/**
 * The tags the source's own layer adds to a report the shared rules did not recognise. They are
 * the source's own labels, kept apart from the shared rule ids so the official sources are
 * untouched.
 */
export const AMZ123_SOURCE_TAG = "第三方线索｜Amazon 平台规则线索";

/**
 * The shared rules' evidence for a report, plus the source's own rule when the shared rules found
 * nothing but the report is clearly about a platform rule.
 *
 * The source's own rule is only granted when the report is about Amazon, applies to the US
 * market, and states a rule change: a single added word is never enough.
 */
export function amz123Classify(input: { title: string; description: string; tags: string[]; bodyText: string }): {
  ruleIds: string[];
  radarTags: string[];
  sourceRuleIds: string[];
  /** The source's own labels, kept apart from the shared rules' tags. */
  sourceTags: string[];
} {
  const classified = classifyRadarText({ title: input.title, excerpt: input.description, bodyText: input.bodyText });
  const ruleIds = [...new Set(classified.evidence.map((item) => item.ruleId))];
  const radarTags = [...classified.tags];
  const sourceRuleIds: string[] = [];
  const head = `${input.title} ${input.description} ${input.tags.join(" ")}`;
  const hasAmazon = AMAZON_MENTION.test(head) || AMAZON_MENTION.test(input.bodyText);
  const hasUsMarket = US_MARKET.test(head) || US_MARKET.test(input.bodyText);
  const subject = amz123Subject(input);
  const sourceTags: string[] = [];
  if (!radarTags.length && subject.kind === "amazon-policy" && hasAmazon && hasUsMarket) {
    sourceRuleIds.push("amz123-platform-rule");
    sourceTags.push(AMZ123_SOURCE_TAG);
  }
  return { ruleIds, radarTags, sourceRuleIds, sourceTags };
}
