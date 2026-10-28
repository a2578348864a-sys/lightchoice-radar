// First-party site API (/api/site/*). Not a public API: it may evolve with the website,
// but it is served from the same public read layer as v1, RSS and MCP.
import type { CategoryKey, ChannelKey } from "./taxonomy.ts";
import { isoWeekRange, monthDay } from "./time.ts";

export interface SourceRef {
  /** The name readers see (publication/rules.ts publicSourceName), as is every source name here. */
  name: string;
}

export interface MediaView {
  kind: "image" | "video";
  url: string;
  /** Full image for an on-demand viewer; list previews stay small. */
  fullUrl?: string;
  width: number | null;
  height: number | null;
  alt: string | null;
  poster: string | null;
  srcSet?: string;
}

export interface XPostView {
  authorName: string;
  handle: string;
  avatarUrl: string | null;
  avatarSrcSet?: string;
  text: string;
  translation: string | null;
  /** translation: Chinese translation of the quoted post, when it is in another language. */
  quoted: { authorName: string; handle: string; text: string; url: string; translation: string | null } | null;
  media: MediaView[];
}

export interface StoryRef {
  publicId: string;
  title: string;
}

/**
 * Where the Chinese reading material of one item comes from and what this site may show of it.
 * Every value describes a stored fact (a field, a configuration, a version), never a quality judgement.
 */
export interface ContentIdentity {
  /**
   * The title as written: the source's own text in its own language, a Chinese copy made here, or a
   * machine translation of the current revision (machine-zh, never presented as the source's words).
   */
  titleKind: "original" | "source-zh" | "rule-zh" | "machine-zh";
  /** The summary: the source's own words, a Chinese summary organised from the body by local rules, or a machine translation. */
  summaryKind: "source" | "rule-zh" | "machine-zh" | "none";
  /** The material this site holds, before any display policy: full body, feed excerpt, or title only. */
  material: "body" | "excerpt" | "title-only";
  /** Whether the page shows the stored body (source_fulltext and body status decide, see body_mode). */
  bodyShown: boolean;
  /** A translation of the current material version; `stale` means an older revision's translation exists. */
  translation: "none" | "complete" | "partial" | "stale";
  /** The Chinese policy explanation of the current material version; `stale` means an older one exists. */
  explanation: "none" | "current" | "stale";
}

/**
 * One scannable fact about the piece, lifted out of the stored material by local rules — never
 * paraphrased, never inferred. `value` may keep the source's own words (a model number, an amount, a
 * product name); `evidence` says which stored field it came from, so a reader can check it.
 */
export interface PolicyKeyFact {
  label: string;
  value: string;
  evidence: string;
}

/**
 * A Chinese policy explanation assembled by local rules from stored fields and rule evidence
 * (backend editorial/policy-explain.ts). It is a structural reading aid, never a model translation
 * or an official statement: `notice` says so on the page.
 */
export interface PolicyExplanation {
  method: "rule";
  ruleVersion: string;
  /** The material version this explanation was built from. */
  inputRevision: number;
  generatedAt: string;
  /** Coverage: a title alone cannot support the same fields a body can. */
  complete: boolean;
  material: "body" | "excerpt" | "title-only";
  oneLiner: string;
  /** What the stored material currently states, as structure: source identity, file status, themes. */
  current: string[];
  /** A change only when the official text itself says so; null means no change claim was found. */
  change: { statement: string; evidence: string } | null;
  appliesTo: string | null;
  /** Each date labelled by what it is: a publication date is never a discovery date. */
  keyDates: Array<{ label: string; display: string; kind: "published" | "source-updated" | "discovered" | "effective-claim" }>;
  pending: string[];
  /** Exact stored-field positions the explanation leans on. */
  evidence: Array<{ label: string; field: "title" | "excerpt" | "body"; matchedText: string }>;
  /** Scannable facts lifted verbatim from the stored material; empty when the material supports none. */
  keyFacts: PolicyKeyFact[];
  /** Deterministic checks that ran before the explanation was stored (names, not verdicts). */
  checks: string[];
  notice: string;
}

/** What every site answer about an article carries; a card and a page each add the X post in their own form. */
export interface ItemSummary {
  id: string;
  /** Chinese when a current machine translation exists, else the source's own title. */
  title: string;
  originalTitle: string | null;
  summary: string | null;
  /** The source summary as the source wrote it, kept beside a machine translation of it. */
  originalSummary?: string | null;
  reason: string | null;
  source: SourceRef;
  links: { original: string };
  publishedAt: string | null;
  /** Exact source date when the source supplied a calendar date but no time. */
  publishedDate?: string;
  /**
   * The source's own date for the document, when it states one ("Updated on Jul 22, 2026"). It is not
   * a publication date: an undated policy page is dated by it, and a card has to say so.
   */
  sourceUpdatedAt?: string | null;
  discoveredAt: string;
  timelineAt: string;
  category: CategoryKey | null;
  tags: string[];
  score: number | null;
  selected: boolean;
  channel: "news" | "x";
  story: StoryRef | null;
  /** Present when the site records where the Chinese material comes from (LightChoice Radar). */
  identity?: ContentIdentity;
}

/** The fields rendered by a site feed card; full original text lives in the item detail. */
export interface FeedItemSummary extends Pick<ItemSummary, "id" | "title" | "summary" | "reason" | "source" | "publishedAt" | "publishedDate" | "sourceUpdatedAt" | "discoveredAt" | "timelineAt" | "category" | "tags" | "score" | "selected" | "channel" | "identity"> {
  /** The source title, shown beside a machine-translated one (dropped when it is the same string). */
  originalTitle?: string | null;
  x: (Pick<XPostView, "authorName" | "handle" | "avatarUrl" | "avatarSrcSet" | "media"> & {
    quoted: Omit<NonNullable<XPostView["quoted"]>, "url"> | null;
  }) | null;
  /**
   * A selected report whose fact is represented by another report (全部动态 and search): that report,
   * so the card can say "同一件事，精选收录的是《…》" instead of claiming a seat of its own.
   */
  sameEvent?: { id: string; title: string } | null;
}

export interface GroupInfo {
  factId: string;
  /** Other public sources reporting this same news fact, under the current filters. */
  additionalSourceCount: number;
  /** Distinct public reports of this fact. */
  reportCount: number;
  /**
   * The selected reports of this fact under the current filters. The timeline's reader-side unread
   * filter keeps a group while any of them is unread; the timeline fills it, other callers omit it.
   */
  memberIds?: string[];
}

export interface TimelineCard {
  key: string;
  anchorAt: string;
  item: FeedItemSummary;
  group: GroupInfo | null;
}

export interface HotStripEntry {
  rank: number;
  title: string;
  heat: number;
  trend: "up" | "down" | "flat" | "new" | "unknown";
  storyPublicId: string | null;
  itemId: string | null;
  participants: HotParticipant[];
  participantCount: number;
}

export interface TimelineFilters {
  channel: ChannelKey;
  category: CategoryKey | null;
  tag: string | null;
}

export interface TimelineResponse {
  filters: TimelineFilters;
  cards: TimelineCard[];
  nextCursor: string | null;
  hot: HotStripEntry[] | null;
  dayCounts: Record<string, number>;
}

export interface PoolResponse {
  filters: TimelineFilters & {
    q: string | null;
    tab: "time" | "relevance";
    sourceId?: string | null;
    dateBasis?: "collected" | "published";
  };
  items: FeedItemSummary[];
  page: number;
  pageCount: number;
  total: number;
  todayCount: number;
  freshness: string;
}

/** Only sources that currently have public, listable items are offered as a website filter. */
export interface PoolSourceOption {
  id: string;
  name: string;
}

/** A deterministic rule match points back to the exact stored source field and character offsets. */
export interface RuleEvidence {
  ruleId: string;
  label: string;
  field: "title" | "excerpt" | "body";
  start: number;
  end: number;
  matchedText: string;
  context: string;
}

export interface OutlineEntry {
  id: string;
  text: string;
  level: number;
}

/**
 * An article page (/api/site/items/:id) in one language: Chinese (the article itself or its translation)
 * unless …/original asks for the original. Only the body shown is sent, with its outline.
 */
export interface SiteItemDetail extends ItemSummary {
  /** The post with all its media; its text is the body. */
  x: Omit<XPostView, "text" | "translation"> | null;
  /** Selected, but its fact's seat is held by this report: marked 同事件, without a reason of its own. */
  sameEvent?: { id: string; title: string } | null;
  readingMode: "full" | "summary-only";
  author: string | null;
  /** Whitelisted HTML of the language shown; the other one is null. */
  body: { zh: string | null; original: string | null; zhKind: "translation" | "original" | null; complete: boolean } | null;
  outline: OutlineEntry[];
  relatedStories: StoryRef[];
  /** The topics the report belongs to. */
  topics: TopicLink[];
  indexable: boolean;
  markdownAvailable: boolean;
  group: GroupInfo | null;
  hasTranslation: boolean;
  bodyLanguage: "zh" | "original";
  /** Present in LightChoice Radar when this material was classified by local rules. */
  ruleVersion?: string;
  ruleEvidence?: RuleEvidence[];
  /** Present in LightChoice Radar: the Chinese policy explanation of this material version. */
  explanation?: PolicyExplanation | null;
  /**
   * Scannable facts lifted from this material version (editorial/key-facts.ts): stored with the rule
   * explanation when one exists, otherwise computed on read. Same rules, same evidence, no second store.
   */
  keyFacts?: PolicyKeyFact[];
  /** Exact excerpts recorded at each material revision; null means that revision predates excerpt history. */
  revisionHistory?: Array<{ revision: number; title: string; excerpt: string | null; capturedAt: string }>;
}

/** A fact's public reports under the list's filters: what "另外 N 家也报道了" opens. */
export interface GroupReport {
  id: string;
  title: string;
  source: SourceRef;
  timelineAt: string;
  originalUrl: string;
}

export interface GroupReportsResponse {
  factId: string;
  reports: GroupReport[];
}

// Hot ranking and stories

/** Home and hot-ranking faces show the same maximum number of editorial participants. */
export const HOT_FACE_LIMIT = 6;

export interface HotParticipant {
  name: string;
  kind: "editorial" | "signal";
  /** Only visible faces carry images: the source's icon or its latest collected X avatar (proxied). */
  iconUrl?: string | null;
  iconSrcSet?: string;
}


export interface HotEntryView {
  rank: number;
  story: StoryRef;
  heat: number;
  trend: "up" | "down" | "flat" | "new" | "unknown";
  trendPct: number | null;
  badges: Array<"surge" | "new" | "rising">;
  participantCount: number;
  sourceCount: number;
  sourceNames: string[];
  participants: HotParticipant[];
  /** Hourly heat over the 24 hours up to the ranking, oldest first; null where no comparable snapshot exists. */
  spark: Array<number | null>;
  /** A card excerpt of the story's AI digest, else its fact statement; full text is on the event page. */
  summary: string | null;
  /** The latest development, one line. */
  latest: string | null;
  /** A picture from the story's public reports (the representative first), for the leading cards. */
  cover: { url: string; srcSet?: string; width: number | null; height: number | null } | null;
}

export interface HotResponse {
  computedAt: string | null;
  windowHours: number;
  entries: HotEntryView[];
}

export interface HeatPoint {
  hour: string;
  heat: number;
  participants: number;
}

export interface StoryReportView {
  id: string;
  title: string;
  summary: string | null;
  source: SourceRef & { firstParty: boolean };
  publishedAt: string;
  selected: boolean;
}

export interface StoryFactView {
  factId: string;
  title: string;
  firstReportAt: string;
  reportCount: number;
  representative: StoryReportView;
}

export interface StoryDetail {
  publicId: string;
  title: string;
  status: "active" | "watching" | "settled";
  reportCount: number;
  sourceCount: number;
  firstReportAt: string | null;
  latestAt: string | null;
  digest: string | null;
  digestUpdatedAt: string | null;
  /** The story's own factual summary, when it has one. */
  summary: string | null;
  /** Without a digest or summary: the summary of the report the story started from. */
  excerpt: { text: string; sourceName: string } | null;
  latest: string | null;
  /** The current public report supplying latest; never inferred from an independently generated digest. */
  latestReport: { id: string } | null;
  whyHot: {
    participants48h: number;
    newParticipants6h: number;
    recentReports24h: number;
    observationComplete: boolean;
    rank: number | null;
  };
  developments: StoryFactView[];
  officialReports: StoryReportView[];
  timeline: StoryReportView[];
  heat: HeatPoint[];
  related: Array<StoryRef & { relation: "storyline" | "related" }>;
  /** The topics its reports belong to, most reports first. */
  topics: TopicLink[];
}

// Reports (daily / weekly / monthly)

export type ReportKind = "daily" | "weekly" | "monthly";

/** What each kind of report is called. */
export const REPORT_NAMES: Record<ReportKind, string> = { daily: "日报", weekly: "周报", monthly: "月报" };

/** An issue's date as Chinese readers write and search it: "10月17日", "10月12日—18日" (or "9月28日—10月4日"), "2026年10月". */
export function reportDateLabel(kind: ReportKind, key: string): string {
  if (kind === "daily") return monthDay(key);
  if (kind === "monthly") return `${key.slice(0, 4)}年${Number(key.slice(5, 7))}月`;
  const { start, end } = isoWeekRange(key)!;
  return `${monthDay(start)}—${start.slice(5, 7) === end.slice(5, 7) ? `${Number(end.slice(8, 10))}日` : monthDay(end)}`;
}

export interface ReportCitation {
  itemId: string | null;
  title: string;
  summary: string | null;
  sourceName: string;
  sourceUrl: string;
  sourceIconUrl: string | null;
  sourceIconSrcSet?: string;
  firstParty: boolean;
  /** When the cited report was published, if it is still in the database. */
  publishedAt: string | null;
  /** False once the item was withdrawn; the citation then shows as removed. */
  available: boolean;
  /** When unavailable, explains why (e.g. withdrawn by source, unreleased, ineligible). */
  unavailableReason?: string;
  /** A daily entry: other sources that reported the event by the issue's cutoff. */
  otherSources?: number;
  /** A daily entry's other developments of the event, or reports of the launch merged into it (titles only). */
  related?: ReportCitation[];
  /** A daily entry whose event an earlier daily covered: that issue's date. */
  followUp?: string;
}

export interface ReportDetail {
  kind: ReportKind;
  key: string;
  /** The issue's place among the existing issues of its kind, oldest first ("第 N 期"). */
  issueNumber: number;
  title: string;
  generatedAt: string;
  lead: { title: string; leadParagraph: string } | null;
  /** The still-public item the front page leads with (its headline links there). */
  leadItemId: string | null;
  overview: string | null;
  highlights: ReportCitation[];
  /** As edited: daily categories, weekly and monthly themes. */
  sections: Array<{ label: string; summary: string | null; items: ReportCitation[] }>;
  flashes: ReportCitation[];
  /**
   * The front page's picture: from the lead item (a daily's lead, a weekly or monthly's first highlight),
   * else from another public report of that event. Captioned with the story when it is not the lead's own.
   */
  cover: { url: string; srcSet?: string; width: number | null; height: number | null; caption: string | null } | null;
  metrics: Record<string, number>;
  readingMinutes: number;
  prev: string | null;
  next: string | null;
}

export interface ReportIndexEntry {
  key: string;
  issueNumber: number;
  title: string | null;
  count: number;
}

export interface ReportIndexResponse {
  kind: ReportKind;
  items: ReportIndexEntry[];
}

/** The latest report page: its archive selector and the report in one request. */
export interface ReportLatestPage {
  index: ReportNavigationEntry[];
  report: ReportDetail | null;
}

/** A report's archive selector, or one month of the daily archive. */
export interface ReportNavigationResponse {
  items: ReportNavigationEntry[];
}

/** Site-wide facts for the web shell: the changelog red-dot anchor. */
export interface SiteMeta {
  changelogVersion: string;
}

/** One entry of the site's changelog (site/changelog.json), newest first. */
export interface ChangelogRelease {
  date: string;
  time: string;
  kind: "更新" | "优化" | "公告" | "下线";
  title: string;
  body: string[];
  /** A notice readers must act on: drawn in the warning red so it cannot be skimmed past. */
  urgent?: true;
  /** A major release's long form, drawn by the site's own drawing when it ships one; its shape is the site's. */
  feature?: unknown;
}

export interface ChangelogResponse {
  latestVersion: string;
  releases: ChangelogRelease[];
}

/**
 * The about page's contact codes (uploaded in the admin or shipped with the site; null when there is
 * none) and the maker's avatar through the image proxy.
 */
export interface SiteContact {
  wechatQr: string | null;
  feishuQr: string | null;
  makerAvatar: string | null;
}

/** Figures and samples for the about page (site-only; not part of v1). */
export interface SiteStats {
  /** Sources collected from now. */
  sources: number;
  /** Enabled sources by kind: x_search, rss, web_list, mp_account, json_list. */
  sourceKinds: Record<string, number>;
  /** Everything collected and not withdrawn, heat-only sources included. */
  items: number;
  selected: number;
  dailies: number;
  /** The last 24 hours: items found (heat-only sources included), and items that made 精选 (by their place on the timeline). */
  day: { collected: number; selected: number };
  /** Enabled sources in a daily shuffle, for the about page's river: one line per source. */
  sampleSources: Array<{ name: string; kind: string; heatOnly: boolean }>;
  /** The latest 精选, newest first. */
  latest: Array<{ id: string; title: string; source: string }>;
}

export interface StoryFollowup {
  factId: string;
  representative: { id: string; title: string; source: { name: string }; timelineAt: string };
}
export interface StoryFollowupsResponse { items: StoryFollowup[]; more: boolean }

/**
 * A starred item as the site can show it now (/api/site/items/availability, keyed by id). Stars keep the
 * source name of the day they were saved; a public item also brings the name shown today.
 */
export interface ItemAvailability {
  status: "public" | "summary-only" | "unavailable";
  sourceName?: string;
}

/** An issue in the archive and the calendar, numbered in its whole series; closed daily months omit their titles. */
export interface ReportNavigationEntry { key: string; issueNumber: number; title?: string | null; count?: number }

// Topics

export type TopicGroupKey = "company" | "field" | "genre";

export interface TopicGroup {
  key: TopicGroupKey;
  name: string;
  blurb: string;
}

export interface TopicLink {
  slug: string;
  name: string;
}

/** A mark drawn beside a name: its logo, or a monogram when there is none. */
export interface Brand {
  /** Site-relative logo path, or null when only a monogram is available. */
  src: string | null;
  monogram: string;
  /** Raster marks get a light backing plate in dark mode. */
  raster: boolean;
}

export interface TopicSummary extends TopicLink {
  group: TopicGroupKey;
  definition: string;
  /** Companies: their logo mark where the site has one, else their initial. */
  brand: Brand | null;
  /** Selected reports, one per fact (as v1 and RSS count the selected set). */
  total: number;
  /** Of those, in the last 30 days. */
  recent: number;
  /** Enough content to be listed and indexed. */
  indexable: boolean;
  /** The newest selected report. */
  latest: { title: string; at: string } | null;
}

export interface TopicsResponse {
  groups: TopicGroup[];
  topics: TopicSummary[];
}

/** Phone search only needs links, not the topic pages or full hot ranking. */
export interface SearchSuggestions {
  topics: Array<TopicLink & { group: TopicGroupKey }>;
  hot: Array<{ rank: number; title: string; to: string }>;
}

export interface TopicPage {
  topic: TopicSummary & { groupName: string; /** Every listed report, selected or not. */ poolTotal: number };
  /** The site's modules' parts of the page, under their names; each module's web part draws its own. */
  modules: Record<string, unknown>;
  items: FeedItemSummary[];
  page: number;
  pageCount: number;
  pageSize: number;
}

/**
 * Third-party policy leads: candidates a third-party site reported, not a policy Amazon confirmed.
 * The list and detail carry metadata only — never an article body — and stay outside the public pool,
 * the search index and the fact tables.
 */
export interface LeadListItem {
  id: string;
  title: string;
  /** The report's own page on the third-party site. */
  url: string;
  author: string | null;
  sourceId: string;
  sourceName: string;
  /** The report's publication date. */
  publishedAt: string | null;
  /** When the third-party site last changed the report, when it says so. */
  sourceUpdatedAt: string | null;
  /** When this project first saw the report. */
  discoveredAt: string;
  /** The site's own short description, capped. Never a passage of the body. */
  excerpt: string | null;
  /** The pipeline state of the stored record (new / processing / processed / skipped). */
  processingState: string;
  /** True when a reviewer excluded the report; such rows never mix with the candidates. */
  excluded: boolean;
  exclusionReason: string | null;
  /** The official evidence state: third-party-only unless an official record actually matched. */
  officialStatus: string;
  officialNote: string | null;
  officialUrl: string | null;
  /** Which agency publishes the matched official record (CBP / 联邦公报 …) — never "Amazon". */
  officialSource: string | null;
  /** A precise label for `effectiveDate`, e.g. "CBP Form 5106 信息核查加强执法开始日期". */
  effectiveDateLabel: string | null;
  /** Per-claim verification written by bounded official research (R30); null when never verified. */
  officialClaims: LeadClaim[] | null;
  /** When that verification record was written. Never a policy date. */
  officialVerifiedAt: string | null;
  /**
   * A policy effective date: only a date the official record itself states, and only when official
   * evidence matched. A matched official page that states no date leaves this null.
   */
  effectiveDate: string | null;
  /** The date the third-party report itself states. Never presented as a verified policy date. */
  reportedEffectiveDate: string | null;
  /** True when `effectiveDate` is a date the official record states, not the report's claim. */
  effectiveDateVerified: boolean;
  /** The lead tags the admission gate attached (第三方线索｜…). */
  leadTags: string[];
  /** The lead source's own rule ids, never the shared radar rule ids. */
  ruleIds: string[];
  /** The subject the shared radar rules gave the report (类目合规线索 …); empty when none matched. */
  radarTags: string[];
  /** The shared radar rule ids, kept apart from the lead source's own rules. */
  radarRuleIds: string[];
  section: string | null;
  column: string | null;
  /** The dedupe state of the event the lead describes (new / pending-determination / merged). */
  eventState: string | null;
}

/** One third-party claim and what bounded official research found for it. */
export interface LeadClaim {
  /** The claim in the report's own terms. */
  claim: string;
  /** supported: an official record's own text states it. unverified: no public official text found. */
  verdict: "supported" | "unverified";
  /** The official wording that backs a supported claim, with its document. */
  evidence: string | null;
  /** Why an unverified claim stays unverified (no public source yet / login-only channel). */
  note: string | null;
}

export interface LeadDetail extends LeadListItem {
  /** The third-party site's own tags on the report. */
  siteTags: string[];
  market: string | null;
  marketEvidence: string | null;
  gateVersion: string | null;
  discoveredVia: string | null;
  eventKey: string | null;
  officialTitle: string | null;
  officialPublishedAt: string | null;
  reviewedAt: string | null;
}

export interface LeadCounts {
  /** Stored leads that are still candidates (not excluded). */
  active: number;
  /** Reports a reviewer excluded from the candidates. */
  excluded: number;
  all: number;
}

export interface LeadsResponse {
  items: LeadListItem[];
  counts: LeadCounts;
  filters: { state: LeadState; verification: string | null; processing: string | null };
  source: { id: string; name: string; enabled: boolean; intervalMinutes: number };
  /** Why these records are candidates and not confirmed policy: shown as-is on the page. */
  limitations: string[];
}

export type LeadState = "active" | "excluded" | "all";

/** What the source row says, whether a worker holds the role, and what the last round did. */
export interface LeadSourceStatus {
  source: {
    id: string;
    name: string;
    enabled: boolean;
    health: string;
    failCount: number;
    intervalMinutes: number;
    lastError: string | null;
    nextFetchAt: string | null;
    lastOkAt: string | null;
  };
  /** The dedicated worker holds its advisory lock right now. */
  worker: { running: boolean; signal: "advisory-lock" };
  lastRun: { id: number; status: string; found: number; created: number; startedAt: string; error: string | null } | null;
  /** next_fetch_at is a plan, not a promise: nothing runs while the worker is down. */
  nextFetchIsPlanOnly: boolean;
}

/* ------------------------------------------------------------- */
/* The second lane: US consumer & e-commerce industry dynamics.   */
/* ------------------------------------------------------------- */

export type IndustryThemeId =
  | "consumer-demand"
  | "ecommerce-competition"
  | "category-trends"
  | "supply-chain-cost"
  | "economic-data";

export type IndustryKind =
  | "news" | "official-data" | "opinion" | "corporate-personnel" | "earnings"
  | "sponsored" | "research-promo" | "irrelevant";

export interface IndustryStoryRef {
  id: number;
  publicId: string;
  title: string;
  latest: string | null;
  firstReportAt: string | null;
  articleCount: number;
  digestVersion: number | null;
}

/** One admitted industry item. Restricted sources expose factual metadata only. */
export interface IndustryItem {
  id: string;
  title: string;
  originalTitle: string | null;
  url: string;
  sourceId: string;
  sourceName: string;
  publishedAt: string | null;
  discoveredAt: string;
  excerpt: string | null;
  zhTitle: string | null;
  /** The processed Chinese summary (quick read + research direction), when the lane produced one. */
  zhSummary: string | null;
  kind: IndustryKind;
  themes: IndustryThemeId[];
  story: IndustryStoryRef | null;
  modelProcessing: boolean;
}

export interface IndustryListResponse {
  items: IndustryItem[];
  counts: { admitted: number; rejected: number; stories: number; zh: number };
  themes: Array<{ id: IndustryThemeId; label: string }>;
  sources: Array<{ id: string; name: string; publisher: string; modelProcessing: boolean; saveExcerpt: boolean }>;
  filters: { theme: string | null; source: string | null; kind: string | null; q: string | null; days: number };
}

export interface IndustryDigestVersion {
  version: number;
  digest: string;
  latest: string | null;
  receiptId: number | null;
  articleIds: string[];
  createdAt: string;
}

export interface IndustryDetail extends IndustryItem {
  siblings: IndustryItem[];
  digestVersions: IndustryDigestVersion[];
}

export interface IndustryPick {
  storyId: number;
  storyPublicId: string;
  title: string;
  quick: string | null;
  reason: string;
  theme: IndustryThemeId;
  articleIds: string[];
  digestVersion: number | null;
  generatedAt: string;
}

export interface IndustryPicksResponse {
  days: Array<{ day: string; picks: IndustryPick[] }>;
  note?: string;
  generatedFor: number;
}

export interface IndustrySourceStatus {
  sources: Array<{ id: string; enabled: boolean; health: string; intervalMinutes: number; lastError: string | null; nextFetchAt: string | null; lastOkAt: string | null }>;
  lastRun: { id: number; status: string; startedAt: string; found: number; created: number } | null;
  budget: {
    round: string;
    requests: number;
    spentCny: number;
    limits: { maxRequests?: number; maxArticles?: number; budgetCny?: number; expiresAt?: string; purposes?: string[] } | null;
    observationStartedAt: string | null;
  };
}

/* The third lane's evidence thread, as the evidence page renders it. */
export interface VocThreadView {
  questionId: number;
  title: string;
  body: string;
  tags: string[];
  answers: Array<{ id: number; score: number; isAccepted: boolean; body: string; contentLicense: string | null; comments: Array<{ id: number; body: string; contentLicense: string | null }> }>;
  comments: Array<{ id: number; body: string; contentLicense: string | null }>;
  askerFollowUp?: string;
  attribution: string;
}

export interface VocEvidenceItemEx extends IndustryItem {
  thread?: VocThreadView;
  licensedUses: string[];
  reviewStatus: string;
}
