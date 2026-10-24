/** Explainable, local-only policy hints for LightChoice Radar. A match is a lead, never a verified conclusion. */
export const RADAR_RULE_VERSION = "radar-policy-v1";

export const RADAR_RULES = [
  {
    id: "platform-policy",
    tag: "亚马逊平台政策线索",
    label: "Amazon 平台政策",
    expression: /\b(?:amazon\s+(?:seller\s+)?polic(?:y|ies)|seller\s+polic(?:y|ies)|policy\s+(?:update|change|revision)|seller\s+agreement|updated\s+terms|policy\s+enforcement|policy\s+violation|listing\s+(?:removal|suppression)|restricted\s+selling)\b|平台政策|卖家政策|政策更新|政策变更|卖家协议|条款更新|政策违规|商品下架|销售限制/giu,
  },
  {
    id: "seller-program-rules",
    tag: "亚马逊卖家项目规则线索",
    label: "卖家项目资格与运营规则",
    // The last alternative is a participation-mode switch ("an opt-in approach rather than an
    // opt-out approach"): both sides have to appear in the same sentence, so marketing copy that
    // only says "opt in" does not produce the tag.
    expression: /\b(?:remov(?:e|ed|ing)\s+(?:the\s+)?requirement|requirement\s+of\s+maintaining|only\s+(?:occur|apply|available)\s+when|no\s+longer\s+(?:need|have)\s+to\s+(?:manage|maintain)|fewer\s+than\s+\d+\s+orders?\s+per\s+(?:quarter|month)|(?:seller|selling\s+partner)\s+(?:eligibility|requirements?)|policy\s+(?:change|update|requirement)|(?:required|must)\s+to\s+(?:maintain|meet|submit)|opt(?:-|\s)?in\b[^.]{0,160}\bopt(?:-|\s)?out|opt(?:-|\s)?out\b[^.]{0,160}\bopt(?:-|\s)?in)\b/giu,
  },
  {
    id: "fees-logistics",
    tag: "费用与物流线索",
    label: "销售费用与物流费率",
    expression: /\b(?:selling\s+fees?|referral\s+fees?|fulfillment\s+fees?|FBA\s+fees?|(?:referral\s+(?:and|&)\s+)?fulfillment\s+by\s+amazon\s+fees?|storage\s+fees?|inbound\s+placement\s+fees?|low[- ]inventory[- ]level\s+fees?|fuel\s+(?:and|&)\s+logistics\s+surcharge|fee\s+schedule|fee\s+(?:increase|decrease|change)|fees?\s+(?:will\s+)?(?:increase|decrease|change))\b|销售费用|推荐费|配送费|仓储费|入库配置费|物流附加费|费用调整|费用上调|费用下调/giu,
  },
  {
    id: "fba-inbound",
    tag: "FBA 入库与分仓线索",
    label: "FBA 入库与分仓",
    expression: /\b(?:FBA\s+inbound|Amazon\s+inbound|inbound\s+placement|inventory\s+placement|placement\s+service|split\s+shipments?|shipment\s+splits?|FBA\b.{0,80}\b(?:inbound|placement|receiving|rebalancing|capacity)|Fulfillment\s+by\s+Amazon\b.{0,80}\b(?:inbound|placement|receiving|rebalancing|capacity))\b|FBA入库|入库配置|分仓|拆分货件|入库货件|库存调拨/giu,
  },
  {
    id: "category-compliance",
    tag: "类目合规线索",
    label: "类目与商品合规",
    expression: /\b(?:category\s+approval|restricted\s+products?|prohibited\s+products?|product\s+compliance|compliance\s+requirements?|certification\s+requirements?|safety\s+certification|testing\s+requirements?|dangerous\s+goods|hazmat|CPSIA|FCC|FDA|UL\s+certification)\b|类目审核|受限商品|禁售商品|商品合规|合规要求|认证要求|安全认证|检测要求|危险品|危险货物/giu,
  },
  {
    id: "account-health",
    tag: "亚马逊账号健康与申诉线索",
    label: "账号健康与销售权限",
    expression: /\b(?:Account\s+Health(?:\s+Assurance)?|Listing\s+Protection|seller\s+account\s+(?:suspension|deactivation|restriction)|account\s+(?:suspension|deactivation)|listing\s+(?:stays|remains)\s+(?:live|active)|challenge\s+(?:an?\s+)?(?:error|decision)|appeal(?:s|ed)?\s+(?:an?\s+)?(?:account|listing|violation))\b|账号健康|账户健康|账号停用|账户停用|销售权限|商品保护|申诉/giu,
  },
  {
    id: "us-regulatory-recall",
    tag: "美国监管与产品召回线索",
    label: "美国监管与产品安全/召回",
    expression: /\b(?:CPSC|Consumer\s+Product\s+Safety\s+Commission|product\s+recall|recalls?|recalled|safety\s+recall|safety\s+alert|hazard\s+warning)\b|美国消费品安全委员会|消费品安全|产品召回|召回|安全警报|危险提示/giu,
  },
  {
    id: "ads-policy",
    tag: "亚马逊广告政策线索",
    label: "Amazon 广告政策与投放限制",
    // Clause-shaped advertising rules only: a prohibition, an obligation on advertisers, or an
    // enforcement consequence. A product name or a navigation label alone never matches.
    expression: /\b(?:prohibited globally|(?:advertis\w+|ads?)\b[^.]{0,80}\b(?:are|is)\s+prohibited|(?:advertis\w+|ads?)\b[^.]{0,60}\bare required to\b|(?:advertis\w+|ads?)\b[^.]{0,40}\bmust not\b|failure to comply[^.]{0,80}\b(?:paused|removed|restricted|suspended|terminated)\b|reserves? the right to (?:reject|remove|require modifications to)[^.]{0,40}\bads?\b|suspend or terminate[^.]{0,30}\bad accounts?\b|requirements for all ads)\b/giu,
  },
  {
    id: "effective-date",
    tag: null,
    label: "生效日期原文线索",
    expression: /\b(?:(?:effective(?:\s+date)?(?:\s+on)?|takes?\s+effect(?:\s+on)?|goes?\s+into\s+effect(?:\s+on)?|starting(?:\s+on)?|beginning(?:\s+on)?)\s*(?:[:=]\s*)?(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?[,]?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4}))\b/giu,
  },
] as const;

export type RadarEvidence = {
  ruleId: (typeof RADAR_RULES)[number]["id"];
  label: string;
  field: "title" | "excerpt" | "body";
  start: number;
  end: number;
  matchedText: string;
  context: string;
};

/** Offsets point into the exact stored field named by `field`; strings are never rewritten for matching. */
export function classifyRadarText(input: { title: string; excerpt?: string | null; bodyText?: string | null }) {
  const fields = [
    ["title", input.title],
    ["excerpt", input.excerpt ?? ""],
    ["body", input.bodyText ?? ""],
  ] as const;
  const evidence: RadarEvidence[] = [];
  for (const rule of RADAR_RULES) {
    let ruleMatches = 0;
    for (const [field, value] of fields) {
      if (ruleMatches >= 8) break;
      const text = value.slice(0, 50_000);
      // RegExp instances have state because of `g`; reset before every field.
      rule.expression.lastIndex = 0;
      for (const match of text.matchAll(rule.expression)) {
        const start = match.index ?? 0;
        const end = start + match[0].length;
        const from = Math.max(0, start - 70);
        const to = Math.min(text.length, end + 70);
        evidence.push({ ruleId: rule.id, label: rule.label, field, start, end, matchedText: match[0], context: text.slice(from, to) });
        ruleMatches += 1;
        if (ruleMatches >= 8) break;
      }
    }
  }
  const tags = [...new Set(evidence.flatMap((item) => {
    const tag = RADAR_RULES.find((rule) => rule.id === item.ruleId)?.tag;
    return tag ? [tag] : [];
  }))];
  return { version: RADAR_RULE_VERSION, tags, evidence };
}

/**
 * Narrowly grounded Chinese summaries for known, fully evidenced policy passages. A title, teaser,
 * partial body, or a rollout phrase alone is not enough to produce a policy explanation.
 */
export function summarizeRadarPolicy(input: { bodyText?: string | null }): string | null {
  const body = input.bodyText ?? "";
  const serviceProgramEvidence = [
    /return-less refunds only occur when the customer has not received the product by the promised timeline/i,
    /damaged or defective product that is non-returnable/i,
    /product is unsafe to return/i,
    /removing the requirement of maintaining a 95% valid tracking rate/i,
    /low-volume seller with fewer than 30 orders per quarter/i,
  ].every((pattern) => pattern.test(body));
  if (serviceProgramEvidence) {
    return "Amazon 客户服务计划公告说明：无退货退款仅适用于买家未按期收到商品、收到不可退回的破损或缺陷商品，或商品退回不安全的情况；免费资格不再要求维持 95% 有效追踪率，季度订单少于 30 单的低销量卖家也可免费使用。正文称更新已可用，但未列出单独的生效日期。";
  }
  const evidenceIsComplete = [
    /more due process into Account Health with a program called Listing Protection/i,
    /will reach all Account Health Assurance sellers in the U\.S\. by year-end and worldwide in 2027/i,
    /when a violation is flagged, the listing stays live while the seller resolves it/i,
    /a way to challenge errors/i,
  ].every((pattern) => pattern.test(body));
  if (!evidenceIsComplete) return null;
  return "Amazon称将通过 Listing Protection 为 Account Health 增加程序保障。原文表示，违规被标记后，卖家处理期间商品刊登会继续在线，并可按流程对错误提出异议。Amazon称该计划将在2026年底前覆盖美国所有 Account Health Assurance 卖家，2027年推广至全球；这是推广安排，原文未给出明确的政策生效日期。";
}
