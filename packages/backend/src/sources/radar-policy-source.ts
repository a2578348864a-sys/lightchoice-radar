import type { SourceRow } from "./types.ts";

/** Exact non-RSS sources admitted while LightChoice Radar runs in rule-only mode. */
export const RADAR_POLICY_SOURCE_ID = "amazon-us-fee-updates";
export const AMAZON_US_ANNOUNCEMENTS_SOURCE_ID = "amazon-us-announcements";
// `amazon-us-accelerate-updates` is deliberately absent: its only record is a conference recap
// (marketing), so it has no platform-policy admission, even if someone re-enables the source.
export const RADAR_POLICY_SOURCE_IDS = [RADAR_POLICY_SOURCE_ID, AMAZON_US_ANNOUNCEMENTS_SOURCE_ID] as const;

/**
 * The U.S. regulatory feeds the isolated worker may schedule and fetch. They are external_regulation,
 * never Amazon platform policy: the allowlist exists so the worker cannot be pointed at another feed,
 * and so a config edit that changes the host is refused instead of silently collecting it.
 */
export const RADAR_REGULATORY_SOURCE_IDS = ["rss-cpsc-recalls", "us-federal-register-cpsc", "us-federal-register-ftc"] as const;
export type RadarRegulatorySourceId = (typeof RADAR_REGULATORY_SOURCE_IDS)[number];

/**
 * The third-party lead source. AMZ123 is a Chinese trade-media site that reports on Amazon seller
 * policies: it is a lead source, never a policy source. Its material never becomes a policy fact
 * and never reaches a public surface (the source is isolated), so it has its own allowlist and its
 * own queue instead of joining the platform-policy sources.
 */
export const RADAR_LEAD_SOURCE_ID = "amz123-policy-leads";
export const RADAR_LEAD_SOURCE_IDS = [RADAR_LEAD_SOURCE_ID] as const;
export type RadarLeadSourceId = (typeof RADAR_LEAD_SOURCE_IDS)[number];

export function isApprovedRadarLeadSourceId(sourceId: string): sourceId is RadarLeadSourceId {
  return (RADAR_LEAD_SOURCE_IDS as readonly string[]).includes(sourceId);
}

const LEAD_CONFIG_KEYS = ["_aihot", "adapter", "allowUrlPrefixes", "url"];
const LEAD_LISTING_URL = "https://www.amz123.com/t";
const LEAD_ALLOWED_PREFIXES = ["https://www.amz123.com/t/", "https://www.amz123.com/kx/"];

/**
 * The lead source is admitted on its exact configuration: its own adapter, its own listing and its
 * own two approved columns. A config edit that points it somewhere else, or that widens the columns
 * it may read, is refused instead of collected.
 */
export function isApprovedRadarLeadSource(source: Pick<SourceRow, "id" | "kind" | "config">): boolean {
  if (!isApprovedRadarLeadSourceId(source.id) || source.kind !== "web_list") return false;
  const c = source.config;
  if (!c || typeof c !== "object" || Array.isArray(c)) return false;
  if (!hasExactKeys(c, LEAD_CONFIG_KEYS)) return false;
  if (c.adapter !== "amz123_leads" || c.url !== LEAD_LISTING_URL) return false;
  if (!Array.isArray(c.allowUrlPrefixes) || c.allowUrlPrefixes.length !== LEAD_ALLOWED_PREFIXES.length) return false;
  if (!LEAD_ALLOWED_PREFIXES.every((prefix) => c.allowUrlPrefixes.includes(prefix))) return false;
  if (!c._aihot || typeof c._aihot !== "object" || Array.isArray(c._aihot)) return false;
  return Object.keys(c._aihot).every((key) => key === "initialBackfillLimit" || key === "initialBackfillMonths");
}

const REGULATORY_FEED_HOSTS: Record<RadarRegulatorySourceId, string> = {
  "rss-cpsc-recalls": "www.cpsc.gov",
  "us-federal-register-cpsc": "www.federalregister.gov",
  "us-federal-register-ftc": "www.federalregister.gov",
};

export function isApprovedRadarRegulatorySource(sourceId: string): sourceId is RadarRegulatorySourceId {
  return (RADAR_REGULATORY_SOURCE_IDS as readonly string[]).includes(sourceId);
}

/** An approved id is not enough: the source must still be an RSS feed on its own official host. */
export function isApprovedRadarRegulatoryFeed(source: Pick<SourceRow, "id" | "kind" | "config"> | null | undefined): boolean {
  if (!source || !isApprovedRadarRegulatorySource(source.id) || source.kind !== "rss") return false;
  try {
    return new URL(String(source.config?.feedUrl ?? "")).hostname === REGULATORY_FEED_HOSTS[source.id];
  } catch {
    return false;
  }
}

const LISTING_URL = "https://sellingpartners.aboutamazon.com/data-insights";
const ARTICLE_PREFIX = "https://sellingpartners.aboutamazon.com/update-to-u-s-referral-and-fulfillment-by-amazon-fees-for-";
const CONFIG_KEYS = [
  "_aihot", "acceptLanguage", "allowUrlPrefixes", "itemSelector", "linkSelector", "parseMode",
  "publishedAtSelector", "publishedAtUtcOffset", "publisherRequiresDiscovery", "publisherRole",
  "publisherUrlPrefixes", "titleSelector", "url",
];
const SORTED_CONFIG_KEYS = [...CONFIG_KEYS].sort();

const ANNOUNCEMENTS_LISTING_URL = "https://sell.amazon.com/blog/announcements?p=1&mons_sel_locale=en_US";
const ANNOUNCEMENTS_ARTICLE_PREFIX = "https://sell.amazon.com/blog/announcements/";
const ANNOUNCEMENTS_DATE_REGEX = String.raw`datePublished">([^<]+)</div>`;
const ANNOUNCEMENTS_CONFIG_KEYS = [
  "_aihot", "acceptLanguage", "allowUrlPrefixes", "detail", "itemSelector", "linkSelector", "parseMode",
  "publishedAtSelector", "publishedAtUtcOffset", "publisherRequiresDiscovery", "publisherRole",
  "publisherUrlPrefixes", "titleSelector", "url",
];
const SORTED_ANNOUNCEMENTS_CONFIG_KEYS = [...ANNOUNCEMENTS_CONFIG_KEYS].sort();
const ANNOUNCEMENTS_DETAIL_KEYS = ["maxFetches", "publishedAtRegex", "publishedAtUtcOffset", "publishedAtAuthoritative", "titleSelector", "summarySelector"];
const SORTED_ANNOUNCEMENTS_DETAIL_KEYS = [...ANNOUNCEMENTS_DETAIL_KEYS].sort();

function hasExactKeys(value: unknown, expected: string[]): value is Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, i) => key === sortedExpected[i]);
}

function samePrefix(value: unknown, expected: string): boolean {
  return Array.isArray(value) && value.length === 1 && value[0] === expected;
}

/**
 * Keep this allowlist deliberately exact: the annual U.S. referral/FBA fee article family and one
 * exact Amazon U.S. announcements list. It does not relax Radar's general web-list gate, and a source
 * that is not on `RADAR_POLICY_SOURCE_IDS` has no policy admission at all.
 */
export function isApprovedRadarPolicyWebList(source: Pick<SourceRow, "id" | "kind" | "config">): boolean {
  if (!(RADAR_POLICY_SOURCE_IDS as readonly string[]).includes(source.id) || source.kind !== "web_list") return false;
  const c = source.config;
  if (!c || typeof c !== "object" || Array.isArray(c)) return false;
  if (source.id === AMAZON_US_ANNOUNCEMENTS_SOURCE_ID) {
    return hasExactKeys(c, SORTED_ANNOUNCEMENTS_CONFIG_KEYS)
      && c.url === ANNOUNCEMENTS_LISTING_URL
      && c.parseMode === "html"
      && c.itemSelector === ".PagePromoC"
      && c.linkSelector === ".PagePromo-title a.Link"
      && c.titleSelector === ".PagePromo-title"
      && c.publishedAtSelector === ".PagePromo-date"
      && c.publishedAtUtcOffset === "+00:00"
      && c.acceptLanguage === "en-US,en;q=0.9"
      && samePrefix(c.allowUrlPrefixes, ANNOUNCEMENTS_ARTICLE_PREFIX)
      && c.publisherRole === "organization"
      && samePrefix(c.publisherUrlPrefixes, ANNOUNCEMENTS_ARTICLE_PREFIX)
      && c.publisherRequiresDiscovery === true
      && hasExactKeys(c.detail, SORTED_ANNOUNCEMENTS_DETAIL_KEYS)
      && c.detail.maxFetches === 15
      && c.detail.publishedAtRegex === ANNOUNCEMENTS_DATE_REGEX
      && c.detail.publishedAtUtcOffset === "+00:00"
      && c.detail.publishedAtAuthoritative === false
      && c.detail.titleSelector === "h1"
      && c.detail.summarySelector === 'meta[property="og:description"]'
      && hasExactKeys(c._aihot, ["initialBackfillLimit", "initialBackfillMonths"])
      && c._aihot.initialBackfillLimit === 15
      && c._aihot.initialBackfillMonths === 13;
  }
  if (!hasExactKeys(c, SORTED_CONFIG_KEYS)) return false;
  return c.url === LISTING_URL
    && c.parseMode === "html"
    && c.itemSelector === ".PageList-items-item"
    && c.linkSelector === ".PagePromo-title a.Link"
    && c.titleSelector === ".PagePromo-title"
    && c.publishedAtSelector === ".PagePromo-date"
    && c.publishedAtUtcOffset === "+00:00"
    && c.acceptLanguage === "en-US,en;q=0.9"
    && samePrefix(c.allowUrlPrefixes, ARTICLE_PREFIX)
    && c.publisherRole === "organization"
    && samePrefix(c.publisherUrlPrefixes, ARTICLE_PREFIX)
    && c.publisherRequiresDiscovery === true
    && c._aihot && typeof c._aihot === "object" && !Array.isArray(c._aihot)
    && (Object.keys(c._aihot).length === 1 || Object.keys(c._aihot).length === 2)
    && c._aihot.initialBackfillLimit === 10
    && (Object.keys(c._aihot).length === 1 || c._aihot.initialBackfillMonths === 13);
}

/** The rule phrasing the index's policy posts have used so far (obligations, removed requirements, thresholds). */
const SELLER_RULE_EVIDENCE = /\b(?:remov(?:e|ed|ing)\s+(?:the\s+)?requirement|requirement\s+of\s+maintaining|only\s+(?:occur|apply|available)\s+when|no\s+longer\s+(?:need|have)\s+to\s+(?:manage|maintain)|fewer\s+than\s+\d+\s+orders?\s+per\s+(?:quarter|month)|(?:seller|selling\s+partner)\s+(?:eligibility|requirements?)|policy\s+(?:change|update|requirement)|(?:required|must)\s+to\s+(?:maintain|meet|submit))\b/i;

/** Words that tie an opt-in/opt-out switch to program participation rather than to a preference toggle. */
const OPT_IN = /\bopt(?:-|\s)?in\b/i;
const OPT_OUT = /\bopt(?:-|\s)?out\b/i;
const PARTICIPATION_WORDS = /\b(?:program|enroll\w*|inclusion|participat\w*)\b/i;

/** A date only counts when the sentence states it as the effective date of a policy, not as a launch day. */
const EFFECTIVE_DATE = /\b(?:effective|takes?\s+effect|goes?\s+into\s+effect)\s*(?:on|:)?\s*(?:(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})/i;

/** What the effective date has to be about. A bare date next to "changes" does not identify a policy. */
const POLICY_SUBJECT = /\b(?:capacity\s+(?:limits?|management)|restock\s+limits?|storage\s+limits?|inventory\s+(?:capacity|limits?)|fee\s+schedule|referral\s+fees?|fulfillment\s+fees?|FBA\s+fees?|polic(?:y|ies)|requirements?|eligibility|inbound\s+placement|placement\s+(?:service|fees?)|listing\s+(?:requirements?|protection))\b/i;

/**
 * A participation-mode switch: one sentence has to name both sides of the switch and the program it
 * applies to ("an opt-in approach rather than an opt-out approach" for the program's enrollment).
 * A number, a limit, or the word "opt-in" on its own is not evidence — sellers could already choose
 * something before the change, and marketing copy also says "opt in".
 */
function hasParticipationModeSwitch(bodyText: string): boolean {
  for (const sentence of bodyText.split(/(?<=[.!?])\s+/)) {
    if (OPT_IN.test(sentence) && OPT_OUT.test(sentence) && PARTICIPATION_WORDS.test(sentence)) return true;
  }
  return false;
}

/** True only when an explicit effective date sits next to a policy subject, so dates alone never admit a post. */
function hasEffectiveDateForPolicy(bodyText: string): boolean {
  for (const match of bodyText.matchAll(new RegExp(EFFECTIVE_DATE.source, "gi"))) {
    const at = match.index ?? 0;
    const window = bodyText.slice(Math.max(0, at - 160), Math.min(bodyText.length, at + match[0].length + 60));
    if (POLICY_SUBJECT.test(window)) return true;
  }
  return false;
}

/** A mixed announcements index is admitted only when the full article body proves a seller rule change. */
export function isQualifyingAmazonPolicyAnnouncement(bodyText: string | null | undefined): boolean {
  if (!bodyText || bodyText.length < 200) return false;
  return SELLER_RULE_EVIDENCE.test(bodyText)
    || hasParticipationModeSwitch(bodyText)
    || hasEffectiveDateForPolicy(bodyText);
}

/**
 * Version of the body gate above. This source is an index of mixed announcements, so its store
 * decision depends on the full article body; nothing else in the listing admits or rejects an entry.
 * Bump the version whenever those rules change: entries an older version rejected are then read
 * again, so a real policy is not lost because the gate once said no.
 */
export const AMAZON_POLICY_GATE_VERSION = "amazon-policy-gate-v2";

/** How many rejected identities a source remembers; enough for the whole 13-month announcement index. */
const MAX_GATE_MEMORY = 300;

export interface PolicyGateMemory {
  version: string;
  /** Identities whose full body the gate version above read and rejected. */
  rejected: string[];
}

/** Identities already rejected under the version in force; a different version re-reads them all. */
export function policyGateRejections(memory: PolicyGateMemory | undefined | null): Set<string> {
  if (!memory || memory.version !== AMAZON_POLICY_GATE_VERSION || !Array.isArray(memory.rejected)) return new Set();
  return new Set(memory.rejected.filter((id): id is string => typeof id === "string").slice(0, MAX_GATE_MEMORY));
}

/** The memory after a run: this run's rejections first, then earlier ones, bounded. */
export function nextPolicyGateMemory(previous: PolicyGateMemory | undefined | null, rejectedNow: string[]): PolicyGateMemory {
  const earlier = [...policyGateRejections(previous)];
  const rejected = [...new Set([...rejectedNow, ...earlier])].slice(0, MAX_GATE_MEMORY);
  return { version: AMAZON_POLICY_GATE_VERSION, rejected };
}

/**
 * A body-gated index keeps a fixed archive window on every run instead of only on the first import.
 * The gate decides from the article body, so an entry whose page was never read — a failed read, or a
 * run that spent its detail budget first — must be re-admitted while it is still listed inside the
 * window; otherwise that policy is unreachable forever. Rejected entries are remembered by
 * `PolicyGateMemory`, so a steady state does not re-read them.
 */
export function keepsArchiveWindowOnEveryRun(sourceId: string): boolean {
  // The lead source keeps its window on every run too: its gate is the listing and the radar rules,
  // not the article date, so a lead published a few days ago is still a lead when it is first read.
  return sourceId === AMAZON_US_ANNOUNCEMENTS_SOURCE_ID || isApprovedRadarLeadSourceId(sourceId);
}

/**
 * The oldest listing date a run may admit, as an instant, or null when the listing sets no floor.
 *
 * - First import: the configured archive window (`months`), so a new source starts with history.
 * - Body-gated index: the same window on every run (see `keepsArchiveWindowOnEveryRun`).
 * - Anything else: since the source was added, less the stale-on-discovery window, so a long listing's
 *   archive comes in through the first import only.
 * - A corrupt `initializedAt` falls back to the bounded archive window: admitting a little history is
 *   safer than silently rejecting every entry of a source forever.
 */
export function archiveWindowFloor(input: {
  sourceId: string; kind: string; firstImport: boolean; months: number; initializedAt: string | null; now: number; staleMs: number;
}): number | null {
  const months = Number.isFinite(input.months) && input.months > 0 ? input.months : 12;
  const windowFloor = input.now - months * 30 * 24 * 60 * 60 * 1000;
  if (input.firstImport || keepsArchiveWindowOnEveryRun(input.sourceId)) return windowFloor;
  if (input.kind === "x_search") return null;
  const initialized = Date.parse(String(input.initializedAt ?? ""));
  return Number.isFinite(initialized) ? initialized - input.staleMs : windowFloor;
}
