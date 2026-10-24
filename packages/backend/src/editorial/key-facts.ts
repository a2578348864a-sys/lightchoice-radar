// Scannable facts lifted verbatim out of stored material by deterministic rules — no model, no network,
// no new dependency. Shared by two callers so the same words produce the same facts everywhere:
//   • editorial/policy-explain.ts stores them with the rule explanation (a derived write);
//   • publication/detail.ts computes them on read for articles that have no explanation record yet,
//     so a reader gets the same block without re-analysing anything or writing to the database.
//
// The rules only ever quote the material. A product name comes from a recall headline, a hazard from
// the words the official text used, an amount from the numbers it printed. When the material supports
// none of them the list is empty, and the page shows no 关键信息 block rather than a filled-in one.
import type { PolicyKeyFact } from "@aihot/contracts/site";

/**
 * A recall headline names the company and the product before it says why, in either order. A company
 * name may itself carry a comma ("Papablic, of USA Recalls …"), so the brand part allows one.
 */
const RECALL_HEADLINE = /^\s*(?<brand>[^;:]{2,70}?)\s+Recall(?:s|ed)?\s+(?<item>.+?)(?:\s+Due to|\s*;|\s+Violat|$)/i;
/** "VQQQ Gas Patio Heaters Recalled Due to …": the product is named before the verb. */
const RECALL_HEADLINE_PRODUCT_FIRST = /^\s*(?<item>.+?)\s+Recall(?:s|ed)?\s+(?:Due to|;)/i;

/**
 * Hazard words as the official texts write them, in Chinese. A term that is not in this table is not
 * translated: the source's own words are kept instead of a guess.
 */
const HAZARD_TERMS: Array<[RegExp, string]> = [
  [/battery ingestion/i, "纽扣/硬币电池误吞"],
  [/strangulation/i, "勒颈"],
  [/asphyxiation/i, "窒息"],
  [/entrapment/i, "夹困"],
  [/fire (?:and|&) burn hazards?/i, "火灾与烧伤"],
  [/\bfall(?:s|ing)? (?:hazard|risk)?\b/i, "跌落"],
  [/impact hazard/i, "撞击"],
  [/laceration/i, "割伤"],
  [/chok(?:ing|e) hazard/i, "窒息"],
  [/phthalates?/i, "邻苯二甲酸盐超标"],
  [/\blead\b/i, "铅含量"],
  [/magnet(?:s|ic)?/i, "磁铁吞食风险"],
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

type Field = "title" | "excerpt" | "body";

export interface KeyFactMaterial {
  title: string;
  excerpt?: string | null;
  bodyText?: string | null;
  /** The source's own name, as stored (the agency is read from it). */
  sourceName?: string | null;
  /** The stored Chinese title, when one exists: used only to name the product in Chinese beside it. */
  chineseTitle?: string | null;
}

function firstHit(material: KeyFactMaterial, pattern: RegExp): { field: Field; matchedText: string } | null {
  const fields: Array<[Field, string]> = [
    ["title", material.title ?? ""],
    ["excerpt", material.excerpt ?? ""],
    ["body", material.bodyText ?? ""],
  ];
  for (const [field, text] of fields) {
    if (!text) continue;
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) return { field, matchedText: match[0] };
  }
  return null;
}

/**
 * A Chinese product phrase the translated title already uses, when the title's own wording makes it
 * unambiguous: "…因可转换高脚椅存在…而召回" → 可转换高脚椅. Only the words between 因 and the first
 * hazard verb are taken, and anything that reads like a hazard or a standard is refused — the English
 * name stays as the fact, and this is only a reading aid beside it.
 */
export function chineseProductHint(chineseTitle: string | null | undefined): string | null {
  if (!chineseTitle) return null;
  const match = /因(.{2,24}?)(?:存在|具有|导致|造成|引发)/.exec(chineseTitle);
  if (!match) return null;
  const hint = match[1]!.trim();
  if (!/^[\u4e00-\u9fffA-Za-z0-9 ·]+$/.test(hint)) return null;
  if (/风险|伤害|死亡|危险|违反|标准|问题/.test(hint)) return null;
  return hint;
}

function fact(label: string, value: string, evidence: string): PolicyKeyFact {
  return { label, value: value.trim(), evidence: evidence.slice(0, 160) };
}

/**
 * Facts a reader can scan, lifted verbatim from the stored material. Nothing is inferred: a product
 * name comes from the recall headline, a hazard from the words the official text used, an amount from
 * the numbers it printed. Every fact carries the field and the words it came from, so it can be
 * checked; the page shows the fact and keeps the evidence in the folded provenance block.
 */
export function keyFactsFromMaterial(material: KeyFactMaterial): PolicyKeyFact[] {
  const facts: PolicyKeyFact[] = [];
  const push = (candidate: PolicyKeyFact | null) => { if (candidate && facts.length < 5) facts.push(candidate); };

  const headline = RECALL_HEADLINE.exec(material.title ?? "") ?? RECALL_HEADLINE_PRODUCT_FIRST.exec(material.title ?? "");
  if (headline?.groups) {
    const brand = headline.groups.brand?.trim();
    const item = headline.groups.item!.trim();
    const hint = chineseProductHint(material.chineseTitle);
    push(fact("涉及商品", `${brand ? `${brand} 召回 ` : ""}${item}${hint ? `（${hint}）` : ""}`, `${headline[0].trim()}（title）`));
  }

  const hazards: string[] = [];
  let hazardEvidence = "";
  for (const [pattern, label] of HAZARD_TERMS) {
    const hit = firstHit(material, pattern);
    if (hit && !hazards.includes(label)) {
      hazards.push(label);
      hazardEvidence = hazardEvidence || `${hit.matchedText}（${hit.field}）`;
    }
    if (hazards.length >= 4) break;
  }
  if (hazards.length) push(fact("主要风险", hazards.join("、"), hazardEvidence));

  for (const [pattern, value] of MEASURE_PATTERNS) {
    const hit = firstHit(material, pattern);
    if (hit) {
      push(fact("官方做法", value, `${hit.matchedText}（${hit.field}）`));
      break;
    }
  }

  const numbers: string[] = [];
  for (const pattern of UNITS_AND_MONEY) {
    for (const text of [material.excerpt ?? "", material.bodyText ?? ""]) {
      for (const match of text.match(pattern) ?? []) if (!numbers.includes(match)) numbers.push(match);
    }
  }
  if (numbers.length) {
    push(fact("数量与金额", numbers.slice(0, 3).join("；"), `${numbers[0]}（${material.excerpt ? "excerpt" : "body"}）`));
  }

  for (const [pattern, label] of DOCUMENT_KINDS) {
    const hit = firstHit(material, pattern);
    if (hit) {
      push(fact("文件类型", label, `${hit.matchedText}（${hit.field}）`));
      break;
    }
  }

  for (const [pattern, agency] of AGENCIES) {
    if (material.sourceName && pattern.test(material.sourceName)) {
      push(fact("发布机构", agency, material.sourceName));
      break;
    }
  }

  return facts;
}
