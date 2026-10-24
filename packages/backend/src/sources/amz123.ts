// AMZ123 as a third-party policy *lead* source.
//
// AMZ123 is not an official Amazon channel. It is a Chinese trade-media site that reports on Amazon
// seller policies, so everything this collector produces is a lead: a report that a policy may have
// changed, with the official-evidence state it actually has.
//
// Two boundaries are enforced here in code, not by convention:
//
// - Access. Only the approved paths under the approved host are read, robots.txt is fetched and
//   enforced before every request, and a path robots forbids is never requested even when it
//   answers 200. A site that answers 200 for a forbidden path is still forbidden.
// - Data. Only metadata is stored: title, author, publication date, source update date, a short
//   public description, the site's own tags, and the official-evidence state. The article body is
//   read in memory to classify the report and to find the effective date and any cited official
//   document, and is never stored, never excerpted into the description, and never persisted in any
//   form. The site's own terms allow non-commercial quoting with attribution but do not confirm a
//   licence for storing or republishing full texts.
//
// The dates never stand in for each other: the publication date is the report's own date, the
// source update date is the site's own update stamp, the effective date is the policy's date as the
// report states it, and the discovery time is when we read it. An unknown date stays unknown.
import { sql } from "../db.ts";
import { classifyRadarText } from "../editorial/radar-rules.ts";
import { amz123Classify, amz123ReviewPolicyLead, amz123Subject } from "./amz123-lead-gate.ts";
import { sha256 } from "../lib/ids.ts";
import { requireOk, type GuardedResponse } from "../lib/http-fetch.ts";
import { fetchListing } from "./listing-fetch.ts";
import { collapseWhitespace, stripTags } from "../lib/text.ts";
import { identityKeyForUrl } from "../lib/url.ts";
import { FetchError, type Candidate, type SourceRow } from "./types.ts";

export const AMZ123_SOURCE_ID = "amz123-policy-leads";
export const AMZ123_HOST = "www.amz123.com";
export const AMZ123_ROBOTS_URL = `https://${AMZ123_HOST}/robots.txt`;
export const AMZ123_SITEMAP_INDEX = `https://${AMZ123_HOST}/sitemap_index.xml`;

/** The only columns this source may read. /b (a service directory) and /report (industry reports) are not approved. */
export const AMZ123_SECTIONS = [
  { section: "/t", prefix: "/t/", url: `https://${AMZ123_HOST}/t`, column: "跨境头条", role: "主来源" },
  { section: "/kx", prefix: "/kx/", url: `https://${AMZ123_HOST}/kx`, column: "跨境快讯", role: "补充来源" },
] as const;

/** One round reads at most this many article pages; the rest wait in the source's pending list. */
export const MAX_PAGE_FETCHES = 25;
/** How many refused identities are remembered, so a page the gate rejected is never read twice. */
export const REJECTED_MAX = 400;
/** How many candidates may wait for a later round. */
export const PENDING_MAX = 200;
/** The archive index is read at most this often: it is a 2.5 MB index and it changes rarely. */
export const SITEMAP_REFRESH_HOURS = 24;
/** An archive URL is only a candidate when the site's own lastmod is this recent. */
export const ARCHIVE_MAX_AGE_DAYS = 7;
/** How long to wait between two article reads, and how many may run at the same time. */
export const REQUEST_GAP_MS = 400;
/** A short public description: the site's own meta description, never a passage of the article. */
export const MAX_DESCRIPTION = 300;
/** Bump when the admission gate changes, so entries an older version refused are read again. */
export const AMZ123_GATE_VERSION = "amz123-lead-gate-v1";

/* ------------------------------------------------------------------ robots */

/** One robots rule. A path is allowed when the longest matching rule allows it. */
export interface RobotsRule {
  allow: boolean;
  pattern: string;
}

export interface RobotsPolicy {
  rules: RobotsRule[];
}

/**
 * The rules that apply to a general crawler. Every group whose user-agent line is `*` counts, and
 * their rules are combined: a site that writes two `User-agent: *` groups (one listing what is
 * forbidden, one listing what is allowed) means both. Within one group the longest matching rule
 * wins, and an Allow wins a tie.
 */
export function parseRobots(text: string): RobotsPolicy {
  const groups: string[][] = [];
  let current: string[] = [];
  let expectingAgent = true;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) { if (current.length) groups.push(current); current = []; expectingAgent = true; continue; }
    const at = line.indexOf(":");
    if (at < 0) continue;
    const field = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (field === "user-agent") {
      if (!expectingAgent && current.length) { groups.push(current); current = []; }
      current.push(value);
      expectingAgent = true;
      continue;
    }
    expectingAgent = false;
    if (field !== "allow" && field !== "disallow") continue;
    current.push(`${field}:${value}`);
  }
  if (current.length) groups.push(current);

  const rules: RobotsRule[] = [];
  for (const group of groups) {
    const agents = group.filter((line) => !line.includes(":")).map((line) => line.toLowerCase());
    if (!agents.includes("*")) continue;
    for (const line of group.filter((entry) => entry.includes(":"))) {
      const [field, ...rest] = line.split(":");
      const value = rest.join(":");
      // An empty Disallow means "allow everything" and is not a rule at all.
      if (field === "disallow" && value === "") continue;
      rules.push({ allow: field === "allow", pattern: value });
    }
  }
  return { rules };
}

/** How specific a pattern is: the characters that must match, ignoring the wildcard and the anchor. */
function ruleLength(pattern: string): number {
  return pattern.replace(/\*/g, "").replace(/\$$/, "").length;
}

/**
 * Whether a pattern matches a path. `*` is any run of characters and a trailing `$` anchors the
 * end. A pattern that starts with "/" is a path prefix; any other pattern (".jpg$") matches
 * anywhere in the path, which is how a file-extension rule is meant to work.
 */
function patternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = body.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
  const prefix = body.startsWith("/") ? "^" : "";
  return new RegExp(`${prefix}${source}${anchored ? "$" : ""}`).test(path);
}

/** Whether robots allows a path. No matching rule means allowed. */
export function robotsAllows(policy: RobotsPolicy, path: string): boolean {
  const matched = policy.rules.filter((rule) => patternMatches(rule.pattern, path));
  if (!matched.length) return true;
  const longest = Math.max(...matched.map((rule) => ruleLength(rule.pattern)));
  // A tie between an Allow and a Disallow is resolved in favour of the Allow.
  if (matched.some((rule) => ruleLength(rule.pattern) === longest && rule.allow)) return true;
  return matched.find((rule) => ruleLength(rule.pattern) === longest)!.allow;
}

/* -------------------------------------------------------------- the paths */

/**
 * The only URLs this source may read: https, the approved host, an approved column, and nothing
 * else. A URL that fails this is never requested, whatever it would answer.
 */
export function amz123ApprovedUrl(raw: string): string | null {
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol !== "https:") return null;
  if (url.hostname !== AMZ123_HOST || url.port || url.username || url.password) return null;
  if (url.search || url.hash) return null;
  if (!AMZ123_SECTIONS.some((section) => url.pathname.startsWith(section.prefix) && url.pathname.length > section.prefix.length)) return null;
  return url.toString();
}

/* ------------------------------------------------------------- discovery */

export interface Amz123Candidate {
  url: string;
  /** The listing's own title, when the listing shows one. */
  title: string | null;
  section: string;
  column: string;
  /** How the candidate was found: a listing page or the site's sitemap. */
  via: "listing" | "sitemap";
  /** The site's own lastmod, when the sitemap gave one. */
  lastmod: string | null;
}

/**
 * The article links of a listing page, with the title the page gives them. The headline column
 * shows its titles in a data attribute and the news list in the link text; both are read here, and
 * a link without a title is still a link (its own page carries the title).
 */
export function parseListing(html: string, section: string, column: string): Amz123Candidate[] {
  const out = new Map<string, Amz123Candidate>();
  const tag = /<a\b([^>]*href="\/(?:t|kx)\/[A-Za-z0-9]+"[^>]*)>([\s\S]{0,400}?)<\/a>/g;
  for (const match of html.matchAll(tag)) {
    const attrs = match[1] ?? "";
    const href = /href="(\/(?:t|kx)\/[A-Za-z0-9]+)"/.exec(attrs)?.[1];
    if (!href || !href.startsWith(`${section}/`)) continue;
    const url = amz123ApprovedUrl(`https://${AMZ123_HOST}${href}`);
    if (!url) continue;
    const attribute = /data-title="([^"]*)"/.exec(attrs)?.[1] ?? /data-sdk-resource-id="([^"]*)"/.exec(attrs)?.[1] ?? "";
    const text = collapseWhitespace(stripTags(match[2] ?? ""));
    const title = collapseWhitespace(attribute) || (text.length >= 4 ? text : "");
    if (out.has(url)) continue;
    out.set(url, { url, title: title || null, section, column, via: "listing", lastmod: null });
  }
  return [...out.values()];
}

/** The archive's article URLs with the site's own lastmod. Only approved columns are kept. */
export function parseSitemap(xml: string): Amz123Candidate[] {
  const out: Amz123Candidate[] = [];
  for (const block of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const body = block[1] ?? "";
    const loc = /<loc>([^<]+)<\/loc>/.exec(body)?.[1];
    if (!loc) continue;
    const url = amz123ApprovedUrl(loc);
    if (!url) continue;
    const lastmod = /<lastmod>([^<]*)<\/lastmod>/.exec(body)?.[1]?.trim() || null;
    const section = `/${new URL(url).pathname.split("/")[1] ?? ""}`;
    const known = AMZ123_SECTIONS.find((entry) => entry.section === section);
    out.push({ url, title: null, section, column: known?.column ?? section, via: "sitemap", lastmod });
  }
  return out;
}

/* -------------------------------------------------- the article's own page */

/** The Nuxt payload's devalue form: an array of values, each referring to the others by index. */
function unflatten(values: unknown): unknown {
  if (!Array.isArray(values) || values.length === 0) return values;
  const seen = new Map<number, unknown>();
  const hydrate = (index: number): unknown => {
    if (index < 0) return undefined;
    if (seen.has(index)) return seen.get(index);
    const value = values[index];
    if (!value || typeof value !== "object") { seen.set(index, value); return value; }
    if (Array.isArray(value)) {
      const arr: unknown[] = [];
      seen.set(index, arr);
      for (const item of value) arr.push(typeof item === "number" ? hydrate(item) : item);
      return arr;
    }
    const obj: Record<string, unknown> = {};
    seen.set(index, obj);
    for (const [key, item] of Object.entries(value)) obj[key] = typeof item === "number" ? hydrate(item) : item;
    return obj;
  };
  return hydrate(0);
}

/** The page's own payload. Null when the page no longer carries it (a redesign, not a silent loss). */
export function extractNuxtPayload(html: string): unknown {
  const match = /<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!match) return null;
  try {
    const raw = (match[1] ?? "").trim();
    return unflatten(JSON.parse(raw.replace(/^devalue\(/, "").replace(/\)$/, "")));
  } catch {
    return null;
  }
}

/**
 * Whether a payload object is an article: it carries a title, a body and a publication date, and
 * the body is real text rather than an empty shell.
 *
 * The test is on the fields themselves, not on the body's length: a genuine quick news item is
 * short (a measured one carries 156 characters of text), while a shell page carries a title and a
 * date but no body at all. A body that holds only markup, whitespace or a placeholder is not an
 * article either.
 */
function isArticleObject(record: Record<string, any>): boolean {
  if (typeof record.title !== "string" || !record.title.trim()) return false;
  if (typeof record.content !== "string") return false;
  if (!record.published_at) return false;
  const body = stripTags(record.content).trim();
  // Real text: a shell, a placeholder or a body of markup only is not an article.
  if (body.length < 40) return false;
  return true;
}

/** Every object in the payload that looks like an article: a title, a date and a body. */
function articleObjects(node: unknown, out: Record<string, any>[] = [], seen = new Set<object>()): Record<string, any>[] {
  if (!node || typeof node !== "object" || seen.has(node as object)) return out;
  seen.add(node as object);
  const record = node as Record<string, any>;
  if (isArticleObject(record)) {
    out.push(record);
  }
  for (const value of Array.isArray(node) ? node : Object.values(record)) articleObjects(value, out, seen);
  return out;
}

export interface Amz123Article {
  title: string;
  author: string | null;
  publishedAt: Date | null;
  sourceUpdatedAt: Date | null;
  /** The site's own short description. Never a passage of the article. */
  description: string | null;
  tags: string[];
  /** Read in memory only. The caller classifies with it and never stores it. */
  bodyText: string;
  /** Official documents the report itself cites, by number or by address. */
  officialRefs: string[];
  officialUrls: string[];
}

const FR_DOCUMENT_NUMBER = /\b(20\d{2}-\d{5})\b/g;
const OFFICIAL_HOSTS = ["sell.amazon.com", "sellingpartners.aboutamazon.com", "advertising.amazon.com", "sellercentral.amazon.com", "brandservices.amazon.com", "federalregister.gov", "www.federalregister.gov", "www.cpsc.gov", "cpsc.gov"];

function unixDate(value: unknown): Date | null {
  const seconds = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * The article's metadata, read from the page's own payload. The body is returned for the caller to
 * classify with and is never part of what gets stored.
 */
export function parseAmz123Article(html: string): Amz123Article | null {
  const payload = extractNuxtPayload(html);
  if (!payload) return null;
  const articles = articleObjects(payload);
  if (!articles.length) return null;
  const article = articles[0]!;
  const bodyText = collapseWhitespace(stripTags(String(article.content ?? "")));
  const descriptionRaw = typeof article.description === "string" ? collapseWhitespace(article.description) : "";
  const tagNames = Array.isArray(article.tags)
    ? article.tags.map((tag: unknown) => (typeof tag === "string" ? tag : String((tag as { name?: unknown })?.name ?? ""))).filter((name: string) => !!name)
    : [];
  const links = [...bodyText.matchAll(/https?:\/\/[^\s"'<>）)】]+/g)].map((m) => m[0]);
  const officialUrls = [...new Set(links.filter((link) => {
    try { return OFFICIAL_HOSTS.includes(new URL(link).hostname); } catch { return false; }
  }))];
  const officialRefs = [...new Set([...bodyText.matchAll(FR_DOCUMENT_NUMBER)].map((m) => m[1]!))].slice(0, 5);
  return {
    title: collapseWhitespace(String(article.title ?? "")),
    author: typeof article.author?.username === "string" ? collapseWhitespace(article.author.username) : null,
    publishedAt: unixDate(article.published_at),
    sourceUpdatedAt: unixDate(article.updated_at),
    description: descriptionRaw ? descriptionRaw.slice(0, MAX_DESCRIPTION) : null,
    tags: [...new Set(tagNames)].slice(0, 12),
    bodyText,
    officialRefs,
    officialUrls,
  };
}

/* --------------------------------------------------------- the lead gate */

/** Amazon itself: a report about another platform is not a lead for this radar. */
const AMAZON_MENTION = /亚马逊|amazon|\bAWD\b|\bFBA\b|\bASCS\b/i;
/** The market the rule applies to. */
const US_MARKET = /美国|美区|北美|美國|美国站|US站点|United States|\bUS marketplace\b/i;
const POLICY_WORD = /政策|规则|新规|合规|调整|变更|更新|收费|费用|生效|实施|要求|限制|禁止|下架|禁售|召回|申诉|账号|费率|佣金|配送费|仓储费|入库|标签|审核|处罚|整改|polic(?:y|ies)|rule|fee|compliance|requirement|update|change|effective|suspend|restrict|prohibit/i;

export interface Amz123GateResult {
  ok: boolean;
  reason: string;
  ruleIds: string[];
  radarTags: string[];
  /** The source's own rule ids, kept apart from the shared radar rule ids. */
  sourceRuleIds: string[];
  /** The source's own labels, kept apart from the shared rules' tags. */
  sourceTags: string[];
  market: "US" | null;
  marketEvidence: "title" | "body" | null;
}

/**
 * Whether a report is a lead for this radar: it states a policy change, it is about Amazon, and it
 * applies to the US site. The rules are the project's own radar rules; the Amazon and market gates
 * are the source's own scope, like the announcement source's body gate.
 */
export function amz123LeadGate(input: { title: string; description: string; tags: string[]; bodyText: string }): Amz123GateResult {
  const head = `${input.title} ${input.description} ${input.tags.join(" ")}`;
  const classified = amz123Classify({ title: input.title, description: input.description, tags: input.tags, bodyText: input.bodyText });
  const ruleIds = classified.ruleIds;
  const radarTags = classified.radarTags;
  const sourceRuleIds = classified.sourceRuleIds;
  const sourceTags = classified.sourceTags;
  const empty = { ok: false, reason: "", ruleIds, radarTags, sourceRuleIds, sourceTags, market: null, marketEvidence: null };

  // The shared rules' tags and the source's own rule are both ways to recognise a policy report.
  // A report the shared rules did not recognise can still be admitted when the source's own layer
  // recognised a platform rule for the US market.
  if (!radarTags.length && !sourceRuleIds.length) return { ...empty, reason: "no radar rule matched" };
  if (!POLICY_WORD.test(head) && !sourceRuleIds.length) return { ...empty, reason: "no policy wording in the title, description or tags" };
  if (!AMAZON_MENTION.test(head)) return { ...empty, reason: "not about Amazon" };
  const marketInHead = US_MARKET.test(head);
  const marketInBody = US_MARKET.test(input.bodyText);
  const hasUsMarket = marketInHead || marketInBody;
  if (!hasUsMarket) return { ...empty, reason: "no US market signal" };

  // The report's own subject, read by the source's own layer: a company financial report or a
  // company business report is never a policy the platform imposes on its sellers. It is checked
  // after the Amazon gate, so a quarterly report that names Amazon cannot be admitted because of
  // an accounting term that happens to look like an Amazon fee.
  const subject = amz123Subject(input);
  if (subject.kind === "company-financial") return { ...empty, reason: subject.reason };
  if (subject.kind === "company-operation") return { ...empty, reason: subject.reason };
  return {
    ok: true,
    reason: "",
    ruleIds,
    radarTags,
    sourceRuleIds,
    sourceTags,
    market: "US",
    marketEvidence: marketInHead ? "title" : "body",
  };
}

/* ------------------------------------------------ the effective date */

/**
 * The date the report says the policy takes effect. It is the policy's date, never the report's
 * publication date, and it stays unknown when the report does not state one.
 */
export function extractEffectiveDate(text: string): string | null {
  const chinese = /(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?[^。！？!?]{0,24}?(生效|实施|执行|开始)/.exec(text);
  if (chinese) return isoDate(chinese[1]!, chinese[2]!, chinese[3]!);
  const chineseFirst = /(?:生效|实施|执行|开始)[^。！？!?]{0,16}?(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日?/.exec(text);
  if (chineseFirst) return isoDate(chineseFirst[1]!, chineseFirst[2]!, chineseFirst[3]!);
  const english = /\b(?:effective|takes?\s+effect|goes?\s+into\s+effect|starting|beginning)\s*(?:on|:)?\s*(?:(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})|(\d{4})-(\d{2})-(\d{2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))/i.exec(text);
  if (english) {
    if (english[1]) {
      const months = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
      const month = months.indexOf(english[1].toLowerCase()) + 1;
      return isoDate(english[3]!, String(month), english[2]!);
    }
    if (english[4]) return isoDate(english[4]!, english[5]!, english[6]!);
    if (english[7]) return isoDate(english[8]!, english[7]!, english[9]!);
  }
  return null;
}

function isoDate(year: string, month: string, day: string): string | null {
  const y = Number(year); const m = Number(month); const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isFinite(date.getTime()) && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d) {
    return date.toISOString().slice(0, 10);
  }
  return null;
}

/* ------------------------------------------------------- the event itself */

/** The report's own words reduced to what an event is about: no digits, no punctuation, no platform noise. */
export function amz123TitleCore(title: string): string {
  return collapseWhitespace(title
    .replace(/亚马逊|amazon/gi, "")
    .replace(/美国|美区|北美|美國/gi, "")
    .replace(/\d+/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")).toLowerCase();
}

/** Chinese-friendly character bigrams: two reports of one event share most of theirs. */
export function amz123TitleSimilarity(a: string, b: string): number {
  const grams = (text: string) => {
    const set = new Set<string>();
    const clean = text.replace(/[^\p{L}\p{N}]/gu, "");
    for (let i = 0; i < clean.length - 1; i++) set.add(clean.slice(i, i + 2));
    return set;
  };
  const A = grams(a); const B = grams(b);
  if (!A.size || !B.size) return 0;
  let shared = 0;
  for (const gram of A) if (B.has(gram)) shared++;
  return shared / (A.size + B.size - shared);
}

export interface Amz123Event {
  /** The report's own claim about the event, as a fingerprint. */
  key: string;
  state: "new" | "merged" | "pending-determination";
  /** The first report of the event, when this report belongs to one. */
  of: string | null;
  domain: string;
  effectiveDate: string | null;
  officialRef: string | null;
  titleCore: string;
}

export interface Amz123KnownEvent {
  articleId: string;
  domain: string;
  effectiveDate: string | null;
  officialRef: string | null;
  titleCore: string;
}

/** Two reports belong to one event only when the domain, the date or the document and the wording agree. */
export function amz123EventIdentity(input: {
  domain: string[];
  effectiveDate: string | null;
  officialRef: string | null;
  title: string;
}, known: Amz123KnownEvent[]): Amz123Event {
  const domain = [...new Set(input.domain)].sort().join("+");
  const titleCore = amz123TitleCore(input.title);
  const key = sha256(`${domain}|${input.effectiveDate ?? "unknown"}|${input.officialRef ?? "unknown"}|${titleCore}`).slice(0, 24);
  const myTags = domain.split("+").filter(Boolean);
  const sameDomain = (event: Amz123KnownEvent) => event.domain.split("+").some((tag) => myTags.includes(tag));
  const sameWhen = (event: Amz123KnownEvent) =>
    (!!input.effectiveDate && !!event.effectiveDate && input.effectiveDate === event.effectiveDate)
    || (!!input.officialRef && !!event.officialRef && input.officialRef === event.officialRef);
  const match = known.find((event) => sameDomain(event) && sameWhen(event) && amz123TitleSimilarity(titleCore, event.titleCore) >= 0.45);
  if (match) return { key, state: "merged", of: match.articleId, domain, effectiveDate: input.effectiveDate, officialRef: input.officialRef, titleCore };
  // Without a date or a document number there is nothing to merge on: the report is kept, and its
  // event is left open rather than forced into a guess.
  if (!input.effectiveDate && !input.officialRef) {
    return { key, state: "pending-determination", of: null, domain, effectiveDate: null, officialRef: null, titleCore };
  }
  return { key, state: "new", of: null, domain, effectiveDate: input.effectiveDate, officialRef: input.officialRef, titleCore };
}

/* ------------------------------------------------------- official evidence */

export interface Amz123OfficialArticle {
  id: string;
  title: string;
  url: string;
  publishedAt: Date | null;
  family: string;
}

export interface Amz123Verification {
  status: "matched-official" | "evidence-insufficient" | "third-party-only" | "access-restricted";
  officialUrl: string | null;
  officialTitle: string | null;
  officialPublishedAt: string | null;
  note: string;
}

/** The official material this project already holds: the Amazon announcements, the fee notice, the US regulation feeds. */
export async function loadOfficialArticles(limit = 400): Promise<Amz123OfficialArticle[]> {
  const rows = await sql<Array<{ id: string; title: string; url: string; published_at: Date | null; family: string }>>`
    SELECT a.id, a.title, a.url, a.published_at,
      CASE WHEN 'platform_policy' = ANY(s.tags) THEN 'platform_policy'
           WHEN 'ads_policy' = ANY(s.tags) THEN 'ads_policy'
           WHEN 'external_regulation' = ANY(s.tags) THEN 'external_regulation'
           ELSE 'other' END AS family
    FROM articles a JOIN sources s ON s.id = a.source_id
    WHERE 'platform_policy' = ANY(s.tags) OR 'ads_policy' = ANY(s.tags) OR 'external_regulation' = ANY(s.tags)
    ORDER BY a.published_at DESC NULLS LAST LIMIT ${limit}`;
  return rows.map((row) => ({ id: row.id, title: row.title, url: row.url, publishedAt: row.published_at, family: row.family }));
}

/**
 * What the official record actually says about the report. A match is not a confirmation: the note
 * says what was matched, and a report whose own official source cannot be read keeps the state
 * that says so.
 */
export function matchOfficialEvidence(input: {
  title: string;
  officialRefs: string[];
  officialUrls: string[];
  domain: string[];
}, official: Amz123OfficialArticle[]): Amz123Verification {
  const none = { officialUrl: null, officialTitle: null, officialPublishedAt: null };
  // The report cites the official document itself: that reference is the evidence.
  for (const ref of input.officialRefs) {
    const byNumber = official.find((article) => article.url.includes(ref));
    if (byNumber) {
      return {
        status: "matched-official",
        officialUrl: byNumber.url,
        officialTitle: byNumber.title,
        officialPublishedAt: byNumber.publishedAt?.toISOString() ?? null,
        note: `报道直接引用了官方文件编号 ${ref}，已关联到本项目已收录的官方记录；引用存在不等于报道的每项主张都已证实。`,
      };
    }
  }
  for (const url of input.officialUrls) {
    const byUrl = official.find((article) => article.url === url);
    if (byUrl) {
      return {
        status: "matched-official",
        officialUrl: byUrl.url,
        officialTitle: byUrl.title,
        officialPublishedAt: byUrl.publishedAt?.toISOString() ?? null,
        note: "报道给出了官方地址，已关联到本项目已收录的官方记录；链接存在不等于报道的每项主张都已证实。",
      };
    }
  }
  // The report points at the seller back office, which no public channel can confirm.
  if (input.officialUrls.some((url) => url.includes("sellercentral.amazon.com"))) {
    return {
      status: "access-restricted",
      ...none,
      note: "报道引用的官方口径位于需登录且 robots 禁止自动访问的后台，本轮无法公开核实，保持未核实。",
    };
  }
  // A strong title match is the next best thing, and is still only a link.
  const similar = official
    .map((article) => ({ article, score: amz123TitleSimilarity(amz123TitleCore(input.title), amz123TitleCore(article.title)) }))
    .filter((entry) => entry.score >= 0.45)
    .sort((a, b) => b.score - a.score);
  if (similar.length) {
    const best = similar[0]!.article;
    return {
      status: "matched-official",
      officialUrl: best.url,
      officialTitle: best.title,
      officialPublishedAt: best.publishedAt?.toISOString() ?? null,
      note: "按标题与本项目已收录的官方记录匹配；标题相近不等于主张已被证实。",
    };
  }
  return {
    status: "third-party-only",
    ...none,
    note: "本项目已收录的官方来源中没有对应记录，保持仅第三方报道状态。",
  };
}

/* ------------------------------------------------------- the lead candidate */

/**
 * The stored shape of one lead. It carries metadata and the verification state, and nothing else:
 * no body, no body excerpt, no body fragment. The description is the site's own short meta
 * description, cut to its own length.
 */
export function amz123LeadCandidate(input: {
  url: string;
  title: string;
  section: string;
  column: string;
  via: string;
  article: Amz123Article;
  gate: Amz123GateResult;
  effectiveDate: string | null;
  officialRef: string | null;
  event: Amz123Event;
  verification: Amz123Verification;
}): Candidate {
  return {
    url: input.url,
    title: input.title,
    identityKey: identityKeyForUrl(input.url) ?? undefined,
    author: input.article.author,
    publishedAt: input.article.publishedAt,
    publicationTime: input.article.publishedAt?.toISOString() ?? null,
    sourceUpdatedAt: input.article.sourceUpdatedAt,
    excerpt: input.article.description,
    bodyStatus: "none",
    raw: {
      lead: {
        source: "amz123",
        section: input.section,
        column: input.column,
        discoveredVia: input.via,
        siteTags: input.article.tags,
        radarRuleIds: input.gate.ruleIds,
        radarTags: input.gate.radarTags,
        sourceRuleIds: input.gate.sourceRuleIds,
        sourceTags: input.gate.sourceTags,
        market: input.gate.market,
        marketEvidence: input.gate.marketEvidence,
        effectiveDate: input.effectiveDate,
        officialRef: input.officialRef,
        officialVerification: input.verification,
        event: input.event,
        gateVersion: AMZ123_GATE_VERSION,
      },
    },
  };
}

/* ------------------------------------------------------------ the collector */

export interface Amz123Round {
  candidates: Candidate[];
  /** The state the source keeps for the next round. */
  cursor: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
}

interface CursorState {
  gateVersion?: string;
  rejected?: string[];
  pending?: Array<{ url: string; title: string | null; section: string; column: string }>;
  sitemapAt?: string | null;
  sitemapUrls?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function readText(url: string, accept: string, maxBytes: number): Promise<GuardedResponse> {
  return requireOk(await fetchListing(url, { headers: { accept }, timeoutMs: 30_000, maxBytes }), url);
}

/** The approved columns the current policy still allows. */
export function allowedSections(policy: RobotsPolicy): string[] {
  return AMZ123_SECTIONS.filter((section) => robotsAllows(policy, section.prefix)).map((section) => section.section);
}

/**
 * One round: read robots, read the two listings, read the archive index when it is due, and read the
 * pages of the candidates that are new. A page that fails is reported and the round continues; a
 * site that stops allowing the approved paths stops the source.
 */
export async function fetchAmz123Leads(source: SourceRow, options: { onlyUrl?: string } = {}): Promise<Amz123Round> {
  if (source.id !== AMZ123_SOURCE_ID) throw new FetchError("not the approved AMZ123 lead source");
  // A controlled single-URL retry: read exactly one approved article page through the same robots,
  // parse and gate, without reading the listings or the archive index. It exists so a URL an older
  // gate version refused can be read again under the current gate; it never widens discovery.
  const onlyUrl = options.onlyUrl === undefined ? null : amz123ApprovedUrl(options.onlyUrl);
  if (options.onlyUrl !== undefined && !onlyUrl) throw new FetchError("the requested URL is not an approved AMZ123 article URL");

  const robotsResponse = await readText(AMZ123_ROBOTS_URL, "text/plain,*/*;q=0.5", 256 * 1024);
  const policy = parseRobots(robotsResponse.text());
  const sections = allowedSections(policy);
  if (!sections.length) {
    throw new FetchError("robots.txt no longer allows this source's approved paths; the source stops until it is reviewed");
  }

  const cursor = (source.cursor ?? {}) as CursorState;
  const diagnostics: Record<string, unknown> = {
    robots: { url: AMZ123_ROBOTS_URL, status: robotsResponse.status, rules: policy.rules.length, allowedSections: sections },
  };

  const candidates = new Map<string, Amz123Candidate>();
  const listingReports: Array<Record<string, unknown>> = [];
  if (onlyUrl) {
    const listing = AMZ123_SECTIONS.find((entry) => new URL(onlyUrl).pathname.startsWith(entry.prefix));
    if (!listing) throw new FetchError("the requested URL is outside the approved sections");
    if (!robotsAllows(policy, new URL(onlyUrl).pathname)) throw new FetchError("robots.txt does not allow the requested URL");
    candidates.set(onlyUrl, { url: onlyUrl, title: null, section: listing.section, column: listing.column, via: "listing", lastmod: null });
    listingReports.push({ section: listing.section, status: "single-url-retry", links: 1, withTitle: 0 });
    diagnostics.onlyUrl = onlyUrl;
  } else {
    for (const listing of AMZ123_SECTIONS) {
      if (!sections.includes(listing.section)) {
        listingReports.push({ section: listing.section, status: "robots-disallowed", links: 0, withTitle: 0 });
        continue;
      }
      const response = await readText(listing.url, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", 8 * 1024 * 1024);
      const found = parseListing(response.text(), listing.section, listing.column);
      for (const candidate of found) candidates.set(candidate.url, candidate);
      listingReports.push({ section: listing.section, status: response.status, links: found.length, withTitle: found.filter((c) => c.title).length });
      if (!found.length) {
        throw new FetchError(`the ${listing.section} listing no longer lists any article; the site changed and the source stops`);
      }
    }
  }
  diagnostics.listings = listingReports;

  // The archive index: read when it is due, and its recent URLs join the candidates.
  const sitemapDue = !onlyUrl && (!cursor.sitemapAt || Date.now() - Date.parse(String(cursor.sitemapAt)) >= SITEMAP_REFRESH_HOURS * 3600_000);
  // The count is the last one read, not the count of this round: the index is not read every round.
  let sitemapUrls = cursor.sitemapUrls ?? 0;
  let sitemapAt = cursor.sitemapAt ?? null;
  if (sitemapDue) {
    const index = await readText(AMZ123_SITEMAP_INDEX, "application/xml,text/xml;q=0.9,*/*;q=0.8", 1024 * 1024);
    const children = [...index.text().matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]!);
    const floor = Date.now() - ARCHIVE_MAX_AGE_DAYS * 86_400_000;
    for (const child of children) {
      if (!child.startsWith(`https://${AMZ123_HOST}/sitemap_index`)) continue;
      const childResponse = await readText(child, "application/xml,text/xml;q=0.9,*/*;q=0.8", 8 * 1024 * 1024);
      const entries = parseSitemap(childResponse.text());
      sitemapUrls += entries.length;
      for (const entry of entries) {
        const stamp = entry.lastmod ? Date.parse(entry.lastmod) : NaN;
        if (Number.isFinite(stamp) && stamp >= floor && !candidates.has(entry.url)) candidates.set(entry.url, entry);
      }
    }
    sitemapAt = new Date().toISOString();
  }
  diagnostics.sitemap = { fetched: sitemapDue, urls: sitemapUrls, known: cursor.sitemapUrls ?? 0 };

  // What is already known: the stored leads, the identities an older gate refused, and the
  // candidates that are still waiting for a later round.
  const rejected = new Set(cursor.rejected ?? []);
  // A single-URL retry reads only the requested page: the waiting candidates stay untouched.
  const pending = onlyUrl ? [] : (cursor.pending ?? []).slice(0, PENDING_MAX);
  const discovered = candidates.size;

  const queue: Amz123Candidate[] = [];
  for (const candidate of candidates.values()) {
    const key = identityKeyForUrl(candidate.url);
    if (!key || rejected.has(key)) continue;
    queue.push(candidate);
  }
  for (const item of pending) {
    const url = amz123ApprovedUrl(item.url);
    if (!url) continue;
    if (!queue.some((candidate) => candidate.url === url)) {
      queue.push({ url, title: item.title, section: item.section, column: item.column, via: "listing", lastmod: null });
    }
  }

  // The leads this source already holds: a URL that is stored is never read again.
  const keys = queue.map((candidate) => identityKeyForUrl(candidate.url)).filter((key): key is string => !!key);
  const stored = await loadStoredIdentities(keys);
  const fresh = queue.filter((candidate) => !stored.has(identityKeyForUrl(candidate.url)!));

  const official = await loadOfficialArticles();
  const knownEvents = await loadKnownEvents();

  const leads: Candidate[] = [];
  const failures: Array<{ url: string; error: string }> = [];
  const reasons: Record<string, number> = {};
  const refused: string[] = [];
  const nextPending: Array<{ url: string; title: string | null; section: string; column: string }> = [];
  let reads = 0;

  for (const candidate of fresh) {
    if (reads >= MAX_PAGE_FETCHES) {
      nextPending.push({ url: candidate.url, title: candidate.title, section: candidate.section, column: candidate.column });
      continue;
    }
    if (!robotsAllows(policy, new URL(candidate.url).pathname)) {
      reasons["robots-disallowed"] = (reasons["robots-disallowed"] ?? 0) + 1;
      continue;
    }
    reads++;
    if (reads > 1) await sleep(REQUEST_GAP_MS);
    let article: Amz123Article | null = null;
    try {
      const response = await readText(candidate.url, "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8", 4 * 1024 * 1024);
      article = parseAmz123Article(response.text());
    } catch (error) {
      failures.push({ url: candidate.url, error: String(error instanceof Error ? error.message : error).slice(0, 200) });
      continue;
    }
    if (!article) {
      failures.push({ url: candidate.url, error: "the page no longer carries the article payload" });
      reasons["parse-failed"] = (reasons["parse-failed"] ?? 0) + 1;
      continue;
    }
    const gate = amz123LeadGate({
      title: article.title || candidate.title || "",
      description: article.description ?? "",
      tags: article.tags,
      bodyText: article.bodyText,
    });
    if (!gate.ok) {
      reasons[gate.reason] = (reasons[gate.reason] ?? 0) + 1;
      const key = identityKeyForUrl(candidate.url);
      if (key) refused.push(key);
      continue;
    }
    const effectiveDate = extractEffectiveDate(`${article.title} ${article.description ?? ""} ${article.bodyText.slice(0, 4000)}`);
    const officialRef = article.officialRefs[0] ?? null;
    const event = amz123EventIdentity({
      domain: gate.radarTags,
      effectiveDate,
      officialRef,
      title: article.title,
    }, knownEvents);
    const verification = matchOfficialEvidence({
      title: article.title,
      officialRefs: article.officialRefs,
      officialUrls: article.officialUrls,
      domain: gate.radarTags,
    }, official);
    leads.push(amz123LeadCandidate({
      url: candidate.url,
      title: article.title || candidate.title || candidate.url,
      section: candidate.section,
      column: candidate.column,
      via: candidate.via,
      article,
      gate,
      effectiveDate,
      officialRef,
      event,
      verification,
    }));
  }

  diagnostics.discovered = discovered;
  diagnostics.alreadyStored = stored.size;
  diagnostics.pageReads = reads;
  diagnostics.leads = leads.length;
  diagnostics.failures = failures;
  diagnostics.rejectedReasons = reasons;
  diagnostics.pending = nextPending.length;

  return {
    candidates: leads,
    cursor: {
      ...cursor,
      gateVersion: AMZ123_GATE_VERSION,
      rejected: [...new Set([...(cursor.rejected ?? []), ...refused])].slice(-REJECTED_MAX),
      pending: onlyUrl ? (cursor.pending ?? []) : nextPending.slice(0, PENDING_MAX),
      sitemapAt,
      sitemapUrls,
    },
    diagnostics,
  };
}

/** The identities this source already holds, so a URL that is stored is never read again. */
async function loadStoredIdentities(keys: string[]): Promise<Set<string>> {
  if (!keys.length) return new Set();
  const rows = await sql<{ identity_key: string }[]>`SELECT identity_key FROM articles WHERE identity_key = ANY(${keys}::text[])`;
  return new Set(rows.map((row) => row.identity_key));
}

/** The events the source already knows, so a second report of one event is recognised as such. */
async function loadKnownEvents(): Promise<Amz123KnownEvent[]> {
  const rows = await sql<Array<{ id: string; domain: string | null; effective_date: string | null; official_ref: string | null; title_core: string | null }>>`
    SELECT id, raw->'lead'->'event'->>'domain' AS domain, raw->'lead'->'event'->>'effectiveDate' AS effective_date,
      raw->'lead'->'event'->>'officialRef' AS official_ref, raw->'lead'->'event'->>'titleCore' AS title_core
    FROM articles WHERE source_id = ${AMZ123_SOURCE_ID} AND raw->'lead' IS NOT NULL
    ORDER BY discovered_at DESC LIMIT 500`;
  return rows.map((row) => ({
    articleId: row.id,
    domain: row.domain ?? "",
    effectiveDate: row.effective_date ?? null,
    officialRef: row.official_ref ?? null,
    titleCore: row.title_core ?? "",
  }));
}
