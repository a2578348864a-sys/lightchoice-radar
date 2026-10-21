/** Explainable, local-only hints for LightChoice Radar. A match is a lead, never a market conclusion. */
export const RADAR_RULE_VERSION = "radar-rules-v1";

export const RADAR_RULES = [
  {
    id: "product-problem",
    tag: "线索：产品问题",
    label: "产品问题线索",
    expression: /\b(?:broken|stopped working|won't work|doesn't work|not working|failed|failure|defect|defective|malfunction|overheating|leaking|disconnect(?:ed|s)?|not charging|battery drain|recall|repair|replacement)\b|故障|坏了|损坏|无法(?:使用|连接|充电)|失灵|漏水|异响|过热|断连|续航|召回|维修/giu,
  },
  {
    id: "new-product-mention",
    tag: "线索：新品提及",
    label: "新品提及",
    expression: /\b(?:new product|new model|new version|now available|pre-?order|coming soon|unveiled|introduced|announced)\b|新品|新款|新型号|现已上市|即将推出|发布了|亮相/giu,
  },
  {
    id: "alternative-need",
    tag: "线索：替代需求",
    label: "替代需求线索",
    expression: /\b(?:alternative to|replacement for|looking for a replacement|need a substitute|wish it had|would like a)\b|替代|代替|替换|取代|寻找替代|希望有|想要一款|需要一款/giu,
  },
  {
    id: "product-market-change",
    tag: "线索：行业动态",
    label: "产品相关行业动态",
    expression: /\b(?:price (?:increase|drop|cut)|price changed|discontinued|out of stock|supply shortage|tariff|product recall|compatibility update)\b|涨价|降价|调价|停产|缺货|断供|关税|产品召回|兼容性更新/giu,
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
  const labels = [...new Set(evidence.map((item) => RADAR_RULES.find((rule) => rule.id === item.ruleId)!.tag))];
  return { version: RADAR_RULE_VERSION, tags: labels, evidence };
}
