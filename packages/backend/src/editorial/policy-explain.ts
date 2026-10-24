// Chinese policy explanations assembled by local rules from stored fields and rule evidence — no model,
// no network, no new dependency. The text states structure (source identity, material scope, file status,
// dates by kind, what is still unconfirmed); it never paraphrases the article's content, never turns a
// title into an obligation and never claims a change without the official text saying so. Every number it
// prints is checked against the stored material before it is stored, and the page carries `notice`.
import type { PolicyExplanation, PolicyKeyFact } from "@aihot/contracts/site";
import { describePublicationTime } from "../sources/dates.ts";
import { collapseWhitespace, isChineseText } from "../lib/text.ts";
import { keyFactsFromMaterial } from "./key-facts.ts";

export const EXPLANATION_RULE_VERSION = "radar-explain-v1";

export const EXPLANATION_NOTICE =
  "生成方式：本地规则整理（radar-explain-v1），依据本条已取得的材料与结构化字段生成；不是模型翻译，也不是人工核实或官方结论。金额、适用范围与义务条款请以原文为准。";

type Field = "title" | "excerpt" | "body";

export interface ExplanationInput {
  revision: number;
  title: string;
  url: string;
  publishedAt: Date | null;
  publicationTime?: string | null;
  sourceUpdatedAt?: Date | null;
  discoveredAt?: Date | null;
  bodyText: string | null;
  excerpt: string | null;
  bodyStatus?: string | null;
  source: { name: string; kind: string; tags?: string[] };
  /** The public tags the rules produced for this material. */
  tags: string[];
  ruleEvidence: Array<{ ruleId: string; label: string; field: Field; matchedText: string }>;
  /** Whether a Chinese summary grounded in the body already exists for this material. */
  hasRuleSummary: boolean;
  translationZh?: string | null;
}

type Hit = { field: Field; matchedText: string };

/** A recall headline names the company and the product before it says why. */
const RECALL_HEADLINE = /^\s*(?<brand>[^,;:]{2,60}?)\s+Recall(?:s|ed)?\s+(?<item>.+?)(?:\s+Due to|\s*;|\s+Violat|$)/i;
/** "VQQQ Gas Patio Heaters Recalls Due to …": the product is named before the verb. */
const RECALL_HEADLINE_PRODUCT_FIRST = /^\s*(?<item>.+?)\s+Recall(?:s|ed)?\s+(?:Due to|;)/i;

/**
 * Hazard words as the official texts write them, in Chinese. A term that is not in this table is not
 * translated: the source's own words are kept instead of a guess.
 */
const HAZARD_TERMS: Array<[RegExp, string]> = [
  [/battery ingestion/i, "纽扣/硬币电池误吞"],
  [/strangulation/i, "勒颈"],
  [/entrapment/i, "夹困"],
  [/fire (?:and|&) burn hazards?/i, "火灾与烧伤"],
  [/\bfall(?:s|ing)? (?:hazard|risk)?\b/i, "跌落"],
  [/impact hazard/i, "撞击"],
  [/laceration/i, "割伤"],
  [/chok(?:ing|e) hazard/i, "窒息"],
  [/serious injury or death/i, "严重伤害或死亡"],
  [/violates? the mandatory (?:safety )?standard/i, "违反强制性安全标准"],
];

/** The measures the official text states, in the words it states them. */
const MEASURE_PATTERNS: Array<[RegExp, string]> = [
  [/\bproposes? to designate\b/i, "拟议认定为重大产品危害（尚未生效）"],
  [/\brecalls?\b/i, "召回（recall）"],
  [/\brefund\b/i, "提供退款（原文表述）"],
  [/\breplace(?:ment)?\b/i, "提供更换（原文表述）"],
  [/\brepair\b/i, "提供维修（原文表述）"],
];

/** What kind of Federal Register document this is, read off its own wording. */
const DOCUMENT_KINDS: Array<[RegExp, string]> = [
  [/notice of proposed rulemaking|\bNPRM\b|\bproposes? to (?:commence|designate|amend|establish)/i, "拟议规则（尚未生效）"],
  [/interpretive rule|interprets the phrase/i, "解释性规则"],
  [/\bfinal rule\b/i, "正式规则"],
  [/\bnotice\b/i, "通知"],
];

const AGENCIES: Array<[RegExp, string]> = [
  [/Consumer Product Safety Commission|\bCPSC\b/i, "美国消费品安全委员会（CPSC）"],
  [/Federal Trade Commission|\bFTC\b/i, "美国联邦贸易委员会（FTC）"],
  [/Amazon|亚马逊/i, "亚马逊（Amazon）"],
];

const UNITS_AND_MONEY = [
  /(?:About|Approximately)\s+[\d,]+\s+units?/gi,
  /\$[\d,]+(?:\s*(?:to|-)\s*\$[\d,]+)?/g,
];

function fact(label: string, value: string, hit: Hit | null, raw?: string): PolicyKeyFact | null {
  const evidence = hit ? `${hit.matchedText}（${hit.field}）` : raw;
  if (!value.trim() || !evidence) return null;
  return { label, value: value.trim(), evidence: evidence.slice(0, 160) };
}

/**
 * Facts a reader can scan, lifted verbatim from the stored material. Nothing is inferred: a product
 * name comes from the recall headline, a hazard from the words the official text used, an amount from
 * the numbers it printed. When the material supports none of them the list is empty, and the page
 * shows no 关键信息 block rather than a filled-in one.
 */
export function keyFactsOf(input: ExplanationInput): PolicyKeyFact[] {
  // The shared deterministic extractor (editorial/key-facts.ts) is the single source of these facts:
  // the explanation stores what it returns, and the read layer computes the same thing on demand for
  // articles that have no explanation record, without re-analysing anything or writing to the database.
  return keyFactsFromMaterial({
    title: input.title, excerpt: input.excerpt, bodyText: input.bodyText, sourceName: input.source?.name,
  });
}

/** The first match in reading order (title, excerpt, body): an exact position in a stored field. */
function firstHit(input: ExplanationInput, patterns: RegExp[]): Hit | null {
  const fields: Array<[Field, string]> = [
    ["title", input.title ?? ""],
    ["excerpt", input.excerpt ?? ""],
    ["body", input.bodyText ?? ""],
  ];
  for (const [field, text] of fields) {
    if (!text) continue;
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      const match = pattern.exec(text);
      if (match) return { field, matchedText: match[0] };
    }
  }
  return null;
}

/** 拟议 vs 已发布：both are read off the official text itself, with the matched words kept. */
const STATUS_PROPOSED = [/\b(?:propos(?:e|es|ed|ing)\b[^.]{0,60}\b(?:rule|rulemaking|regulation)|notice of proposed rulemaking|NPRM|comment period)\b/i];
const STATUS_ISSUED = [
  /\bfinal rule\b/i,
  /\b(?:is|are|has been|have been)\s+amending\b/i,
  /\bamends?\s+(?:its|the)\s+rules?\b/i,
  /\bissu(?:e|es|ing)\s+(?:an\s+)?interpretive rule\b/i,
  /\binterpretive rule\b/i,
];

/** A change only when the official text itself says something changes; no comparison is invented. */
const CHANGE_PATTERNS = [
  /\bremov(?:e|es|ed|ing)\s+(?:the\s+)?requirement\b/i,
  /\bno longer\s+(?:need|required|have)\b/i,
  /\b(?:will|is|are|has been|have been|to be)\s+(?:chang|increas|decreas|updat|revis|amend|replac|remov)\w*\b/i,
  /\b(?:fee|price|rate|policy|requirement|standard|rule)s?\s+(?:increase|decrease|change|update|revision)s?\b/i,
  /\bamend\w*\b/i,
  /\bnew\s+(?:requirement|rule|standard|restriction)s?\b/i,
];

const CATEGORY_RULES: Array<{ tag: string; label: string; appliesTo: string }> = [
  {
    tag: "external_regulation",
    label: "美国监管信息（美国政府机构发布）",
    appliesTo: "美国政府监管机构发布的记录，面向美国市场的相关商品与企业；具体适用对象、商品范围与生效条件以原文为准。",
  },
  {
    tag: "platform_policy",
    label: "Amazon 平台政策（亚马逊官方发布）",
    appliesTo: "亚马逊官方面向卖家的公告或费用说明；具体适用对象、卖家范围与实施条件以原文为准。",
  },
  {
    tag: "第三方线索",
    label: "第三方政策线索（非官方文件）",
    appliesTo: "第三方平台的报道主张，不是官方文件；适用范围与真实性以官方核实记录为准。",
  },
];

function categoryOf(input: ExplanationInput) {
  const tags = input.source.tags ?? [];
  return CATEGORY_RULES.find((rule) => tags.includes(rule.tag)) ?? null;
}

function materialOf(input: ExplanationInput): PolicyExplanation["material"] {
  if ((input.bodyText ?? "").trim()) return "body";
  if ((input.excerpt ?? "").trim()) return "excerpt";
  return "title-only";
}

const MATERIAL_TEXT: Record<PolicyExplanation["material"], string> = {
  body: "已取得完整正文",
  excerpt: "仅取得来源摘要，未取得完整正文",
  "title-only": "仅取得标题，未取得来源摘要与正文",
};

const SHANGHAI = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit",
});

const dayOf = (at: Date) => SHANGHAI.format(at).replaceAll("/", "-");

/** Numbers in Chinese sentences must already exist in the stored material: nothing may be invented. */
function numbersIn(text: string): string[] {
  return [...text.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0]);
}

/**
 * The explanation for one material version. Deterministic: the same stored fields always produce the
 * same result, so a re-run is idempotent and a changed material produces a changed explanation.
 * Returns null only when there is no material at all (not even a title).
 */
export function buildPolicyExplanation(input: ExplanationInput): PolicyExplanation | null {
  const title = collapseWhitespace(input.title);
  if (!title) return null;
  const category = categoryOf(input);
  const material = materialOf(input);
  const language = isChineseText(`${title} ${input.excerpt ?? ""}`) ? "中文" : "英文原文";
  // 拟议 wins over 已发布 when both appear: a proposal quoting an existing rule stays a proposal.
  const proposedHit = firstHit(input, STATUS_PROPOSED);
  const issuedHit = firstHit(input, STATUS_ISSUED);
  const status: "proposed" | "issued" | null = proposedHit ? "proposed" : issuedHit ? "issued" : null;
  const changeHit = firstHit(input, CHANGE_PATTERNS);
  const effectiveHit = input.ruleEvidence.find((hit) => hit.ruleId === "effective-date") ?? null;
  // Translation state is deliberately not written into the explanation: it changes after this text is
  // stored, and the page's identity panel reads the current state from the stored translations. A
  // sentence recorded here ("尚无中文译文") would keep claiming something that is no longer true.

  const current: string[] = [
    `来源身份：${category ? `${category.label}；` : ""}来源名称「${input.source.name}」。`,
    `内容语言：${language}。`,
    `材料范围：${MATERIAL_TEXT[material]}。`,
    status === "proposed"
      ? "文件状态：拟议阶段（原文出现拟议/征求意见表述），尚未实施。"
      : status === "issued"
        ? `文件状态：官方已发布文件（原文命中：${issuedHit!.matchedText}）。`
        : "文件状态：在已取得的材料中未发现拟议或已发布文件的表述，需核对原文。",
    `主题（本地规则命中）：${input.tags.length ? input.tags.join("、") : "未命中主题标签"}。`,
  ];
  if (input.hasRuleSummary) current.push("已有依据正文明确表述整理的中文政策摘要（见页面「政策摘要」）。");

  const oneLiner = [
    `本条为${category ? category.label.split("（")[0] : "公开"}来源「${input.source.name}」的${status === "proposed" ? "拟议文件线索" : status === "issued" ? "已发布官方文件记录" : "公开记录"}（${language}），${MATERIAL_TEXT[material]}。`,
  ].join("");

  const keyDates: PolicyExplanation["keyDates"] = [];
  if (input.publishedAt) {
    keyDates.push({
      label: "官方发布日期（来源提供）",
      display: describePublicationTime(input.publishedAt, input.publicationTime ?? null),
      kind: "published",
    });
  }
  if (input.sourceUpdatedAt) keyDates.push({ label: "来源页面更新日期", display: dayOf(input.sourceUpdatedAt), kind: "source-updated" });
  if (input.discoveredAt) keyDates.push({ label: "本地收录日期（不是发布日期）", display: dayOf(input.discoveredAt), kind: "discovered" });
  if (effectiveHit) keyDates.push({ label: "生效日期表述（原文线索，未核实）", display: effectiveHit.matchedText, kind: "effective-claim" });

  const pending: string[] = [];
  if (material === "title-only") {
    pending.push("仅取得标题：无法据此整理政策要点、适用对象或生效时间，需打开原文核对。");
  } else if (material === "excerpt") {
    pending.push("未取得完整正文：本说明只依据来源摘要整理，具体义务、条件与例外需核对原文。");
  }
  if (!effectiveHit) pending.push("已取得的材料中未出现可确认的生效日期表述。");
  if (!changeHit) pending.push("未发现官方文本明确的变化表述，也没有可比较的历史证据：不作变化判断，只描述当前要求。");
  if (status === "proposed") pending.push("文件处于拟议阶段，尚未实施；最终要求与时间可能变化。");
  if (!input.publishedAt) pending.push("来源未提供发布日期：页面显示的日期是本地收录时间，不能当作发布日期。");

  const evidence = input.ruleEvidence
    .filter((hit) => hit.matchedText && (hit.field === "title" ? input.title : hit.field === "excerpt" ? input.excerpt : input.bodyText)?.includes(hit.matchedText))
    .slice(0, 12)
    .map((hit) => ({ label: hit.label, field: hit.field, matchedText: hit.matchedText }));

  const generated = [oneLiner, ...current, category?.appliesTo ?? "", ...pending].join("\n");
  const materialText = `${input.title}\n${input.excerpt ?? ""}\n${input.bodyText ?? ""}\n${input.source.name}`;
  const checks: string[] = [];
  if (evidence.length === input.ruleEvidence.filter((hit) => hit.matchedText).length) checks.push("证据摘录逐字来自原文字段");
  if (keyDates.every((date) => date.kind === "effective-claim" || !!input.publishedAt || !!input.sourceUpdatedAt || !!input.discoveredAt)) {
    checks.push("日期取自文章字段，未用抓取时间替代发布日期");
  }
  const inventedNumbers = numbersIn(generated).filter((n) => !materialText.includes(n));
  if (inventedNumbers.length === 0) checks.push("中文说明不含材料中不存在的数字");

  return {
    method: "rule",
    ruleVersion: EXPLANATION_RULE_VERSION,
    inputRevision: input.revision,
    generatedAt: new Date().toISOString(),
    complete: material !== "title-only",
    material,
    oneLiner,
    current: inventedNumbers.length === 0 ? current : current.filter((line) => numbersIn(line).every((n) => materialText.includes(n))),
    change: changeHit
      ? {
        statement: status === "proposed"
          ? "官方文本出现变化/修订表述，但该文件处于拟议阶段，尚未实施；具体内容需核对原文。"
          : "官方文本中出现变化/修订表述，具体变化内容需核对原文。",
        evidence: `${changeHit.matchedText}（${changeHit.field}）`,
      }
      : null,
    appliesTo: category?.appliesTo ?? null,
    keyDates,
    pending,
    evidence,
    keyFacts: keyFactsOf(input),
    checks,
    notice: EXPLANATION_NOTICE,
  };
}

/**
 * A later run at the same material version must not shadow a complete explanation with an incomplete
 * one (the same rule a translation store follows): the complete result stands until a complete one
 * replaces it.
 */
export function keepCompleteExplanation(
  prior: PolicyExplanation | null | undefined,
  next: PolicyExplanation | null,
): PolicyExplanation | null {
  if (!next) return prior ?? null;
  if (prior && prior.complete && prior.inputRevision === next.inputRevision && !next.complete) return prior;
  return next;
}
