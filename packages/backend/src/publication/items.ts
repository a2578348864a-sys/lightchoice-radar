// Public read layer, item level. Every exit (site API, v1, RSS, MCP, sitemap) reads
// items through these columns and views; which rows are public is decided by scope.ts.
import { CATEGORY_KEYS, toPublicApiCategory, type CategoryKey, type ChannelKey, type PublicApiCategoryKey } from "@aihot/contracts/taxonomy";
import type { ContentIdentity, FeedItemSummary, ItemSummary, MediaView, XPostView } from "@aihot/contracts/site";
import { POLICY } from "@aihot/site";
import { sql, type Db } from "../db.ts";
import { isChineseText } from "../lib/text.ts";
import { isEmptyOrLinkOnly } from "../content/posts.ts";
import { proxiedImage, proxiedImageSet } from "../media/imgproxy.ts";
import { sourceOwnsPost } from "../sources/account.ts";
import { displayTags, publicSourceName } from "./rules.ts";
import { foldableSelectionCondition, seatedCondition } from "./scope.ts";
import { dateOnlyPublicationDate } from "./time-precision.ts";

export interface ItemRow {
  id: string;
  title: string;
  original_title: string | null;
  summary: string | null;
  reason: string | null;
  category: string | null;
  tags: string[];
  score: number | null;
  selected: boolean;
  channel: "news" | "x";
  url: string;
  published_at: Date | null;
  /** The source's own date for the document; undated material sorts and reads by it. */
  source_updated_at: Date | null;
  publication_time: string | null;
  discovered_at: Date;
  timeline_at: Date;
  /** Holds its fact's selected seat (publish.ts settleSeats). */
  seat: boolean;
  visibility: string;
  body_mode: "full" | "summary";
  indexable: boolean;
  fact_id: number | null;
  source_name: string;
  /** Participation mode of the source now (editorial, hot_signal, isolated). */
  source_mode: string;
  x_post: Record<string, any> | null;
  /** Current source icon only when that account is this post's author. */
  author_avatar_url?: string | null;
  author: string | null;
  language: string | null;
  story_public_id: string | null;
  story_title: string | null;
  zh_text: string | null;
  /** Chinese translation of the post an X post quotes. */
  quoted_zh: string | null;
  /** Material facts behind the identity badge: what this site holds, and which version is current. */
  article_revision: number;
  has_body: boolean;
  has_excerpt: boolean;
  /** The stored translation of the current revision (null when none is current). */
  tr_current_complete: boolean | null;
  /** Any stored translation's revision, including one older than the material (stale). */
  tr_revision: number | null;
  /** The Chinese title of the current revision, when one was made (editorial/translate-text.ts). */
  tr_title: string | null;
  /** The Chinese translation of the source summary of the current revision, when one was made. */
  tr_excerpt: string | null;
  /** The current rule analysis' explanation version and summary flag, when a rule analysis exists. */
  rule_status: { inputRevision?: number | string | null; ruleSummary?: boolean | null } | null;
}

/** Columns every item listing selects. Internal judgement details never leave this layer. */
export const ITEM_COLUMNS = sql`
  p.article_id AS id, p.title, p.original_title, p.summary, p.reason, p.category, p.tags, p.score,
  p.selected, p.seat, p.channel, p.url, p.published_at, p.discovered_at, p.timeline_at, p.visibility,
  p.body_mode, p.indexable, p.fact_id, s.name AS source_name, s.participation_mode AS source_mode, a.publication_time,
  a.source_updated_at, a.x_post, a.author, a.language, a.revision AS article_revision,
  coalesce(a.body_html, '') <> '' AS has_body, coalesce(a.excerpt, '') <> '' AS has_excerpt,
  tr.complete AS tr_current_complete,
  tr.title AS tr_title,
  tre.body_text AS tr_excerpt,
  (SELECT tr0.revision FROM translations tr0 WHERE tr0.article_id = p.article_id AND tr0.lang = 'zh') AS tr_revision,
  (SELECT jsonb_build_object('inputRevision', an.output->'explanation'->>'inputRevision', 'ruleSummary', an.output->'ruleSummary')
     FROM analyses an WHERE an.article_id = p.article_id AND an.origin = 'rule' ORDER BY an.id DESC LIMIT 1) AS rule_status,
  CASE WHEN s.kind = 'x_search' AND ${sourceOwnsPost(sql`s.config`, sql`a.x_post->>'handle'`)} THEN s.icon_url END AS author_avatar_url,
  st.public_id::text AS story_public_id, st.title AS story_title,
  CASE WHEN p.channel = 'x' THEN tr.body_text END AS zh_text, qt.text_zh AS quoted_zh`;

/** Public API listings never render article bodies, X media or story metadata. */
export type ApiItemRow = Pick<ItemRow, "id" | "title" | "original_title" | "summary" | "source_name" | "url" | "published_at" | "publication_time" | "discovered_at" | "category" | "score" | "selected" | "reason">;
/** `selected` is the machine meaning: the report holds its fact's selected seat (scope.ts seatedCondition). */
export const API_ITEM_COLUMNS = sql`
  p.article_id AS id, p.title, p.original_title, p.summary, s.name AS source_name, p.url,
  p.published_at, a.publication_time, p.discovered_at, p.category, p.score, (p.selected AND p.seat) AS selected, p.reason`;
export const API_ITEM_FROM = sql`FROM publications p JOIN sources s ON s.id = p.source_id JOIN articles a ON a.id = p.article_id`;

/** A translation of an older revision is left out: the original changed after it (the worker translates it again). */
export const ITEM_FROM = sql`
  FROM publications p
  JOIN sources s ON s.id = p.source_id
  JOIN articles a ON a.id = p.article_id
  LEFT JOIN stories st ON st.id = p.story_id AND st.merged_into IS NULL
  LEFT JOIN translations tr ON tr.article_id = p.article_id AND tr.lang = 'zh' AND tr.revision >= a.revision
  LEFT JOIN translations tre ON tre.article_id = p.article_id AND tre.lang = 'zh-excerpt' AND tre.revision >= a.revision
  LEFT JOIN quote_translations qt ON p.channel = 'x' AND qt.tweet_id = substring(a.x_post->'quoted'->>'url' from '/status/([0-9]+)')`;

export function channelCondition(channel: ChannelKey | null | undefined) {
  if (!channel || channel === "all") return sql``;
  if (channel === "firstParty") return sql`AND p.source_id IN (SELECT id FROM sources WHERE tier = 'T1')`;
  return sql`AND p.channel = ${channel}`;
}

/** The website's filter: one of its own categories. */
export function categoryCondition(category: CategoryKey | null | undefined) {
  if (!category) return sql``;
  return sql`AND p.category = ${category}`;
}

/** The public API's, RSS's and MCP's filter: every category the site publishes as this one (PUBLIC_CATEGORIES). */
export function publicCategoryCondition(category: PublicApiCategoryKey | null | undefined) {
  if (!category) return sql``;
  return sql`AND p.category IN ${sql(CATEGORY_KEYS.filter((k) => toPublicApiCategory(k) === category))}`;
}

export function tagCondition(tag: string | null | undefined) {
  if (!tag) return sql``;
  return sql`AND p.tags @> ${[tag]}::text[]`;
}

function mediaView(m: Record<string, any>, mode: "card" | "thumb" | "full" = "thumb", responsive = false): MediaView | null {
  const url = proxiedImage(m.url, mode);
  if (!url) return null;
  const srcSet = responsive ? proxiedImageSet(m.poster ?? m.url, mode === "full" ? "body" : "card") : null;
  return {
    kind: m.kind === "video" ? "video" : "image",
    url,
    ...(responsive && mode !== "full" ? { fullUrl: proxiedImage(m.url, "full")! } : {}),
    ...(srcSet ? { srcSet } : {}),
    width: typeof m.width === "number" ? m.width : null,
    height: typeof m.height === "number" ? m.height : null,
    alt: m.alt ?? null,
    poster: m.poster ? proxiedImage(m.poster, mode === "card" ? "card" : "thumb") : null,
  };
}

export function xView(row: Pick<ItemRow, "x_post" | "zh_text"> & Partial<Pick<ItemRow, "quoted_zh" | "author_avatar_url">>, compact = false, responsive = compact): XPostView | null {
  const x = row.x_post;
  if (!x) return null;
  const quoted = x.quoted && typeof x.quoted === "object"
    ? {
      authorName: String(x.quoted.authorName ?? ""), handle: String(x.quoted.handle ?? ""), text: String(x.quoted.text ?? ""), url: String(x.quoted.url ?? ""),
      translation: !isEmptyOrLinkOnly(String(x.quoted.text ?? "")) && row.quoted_zh && row.quoted_zh.trim() !== String(x.quoted.text ?? "").trim() ? row.quoted_zh : null,
    }
    : null;
  const media = ((x.media ?? []) as Array<Record<string, any>>)
    .map((raw) => ({ raw, view: mediaView(raw, compact || !responsive ? "thumb" : "full", responsive) }))
    .filter((entry): entry is { raw: Record<string, any>; view: MediaView } => entry.view !== null);
  const avatarUrl = row.author_avatar_url ?? x.avatarUrl;
  const avatarSrcSet = responsive ? proxiedImageSet(avatarUrl, "avatar") : null;
  return {
    authorName: String(x.authorName ?? x.handle ?? ""),
    handle: String(x.handle ?? ""),
    avatarUrl: proxiedImage(avatarUrl, "avatar"),
    ...(avatarSrcSet ? { avatarSrcSet } : {}),
    text: String(x.text ?? ""),
    translation: !isEmptyOrLinkOnly(String(x.text ?? "")) && row.zh_text && row.zh_text.trim() !== String(x.text ?? "").trim() ? row.zh_text : null,
    quoted,
    // A multi-image list grid is 112 CSS px wide; one image can be 240 px. Keep 3x pixels for both.
    // Detail retains full media for the lightbox; srcSet bounds the displayed image.
    media: media.map(({ raw, view }) => compact && media.length > 1 ? mediaView(raw, "card", responsive)! : view),
  };
}

/**
 * Whether pages show an X post's own text and media. A site that counts them as full text shows them
 * only where the source allows full text, as it does an article's body.
 */
export function showsPost(row: { channel: string; body_mode: string }): boolean {
  return row.channel === "x" && (!POLICY.xPostIsFullText || row.body_mode === "full");
}

/**
 * The Chinese title of the current revision, when the source wrote its own title in another language.
 * A stored row of an older revision never reaches here: the join in ITEM_FROM already dropped it.
 */
export function machineTitle(row: Pick<ItemRow, "title" | "tr_title" | "language">): string | null {
  const zh = row.tr_title?.trim();
  if (!zh || zh === row.title.trim()) return null;
  return isChineseText(row.title, row.language) ? null : zh;
}

/**
 * The Chinese translation of the summary the source itself supplied. A summary organised here is
 * already Chinese and is never re-translated, and a revision with no current translation falls back
 * to the source's own words.
 */
export function machineSummary(row: Pick<ItemRow, "summary" | "tr_excerpt" | "language">): string | null {
  const zh = row.tr_excerpt?.trim();
  const source = row.summary?.trim() ?? "";
  if (!zh || !source || zh === source) return null;
  return isChineseText(source, row.language) ? null : zh;
}

/**
 * Where this item's Chinese material comes from, from stored facts only: the title as written, whether
 * the summary was organised by local rules, what material the site holds, whether the body is shown,
 * and whether the translation and the explanation belong to the current material version.
 */
export function identityOf(row: ItemRow): ContentIdentity {
  const sameAsOriginal = !row.original_title || row.title === row.original_title;
  const titleKind: ContentIdentity["titleKind"] = machineTitle(row)
    ? "machine-zh"
    : isChineseText(row.title)
      ? sameAsOriginal ? "source-zh" : "rule-zh"
      : "original";
  const summaryKind: ContentIdentity["summaryKind"] = machineSummary(row)
    ? "machine-zh"
    : !row.summary ? "none" : row.rule_status?.ruleSummary ? "rule-zh" : "source";
  const material: ContentIdentity["material"] = row.has_body ? "body" : row.has_excerpt ? "excerpt" : "title-only";
  const translation: ContentIdentity["translation"] = row.tr_revision === null || row.tr_revision === undefined
    ? "none"
    : row.tr_revision >= row.article_revision ? (row.tr_current_complete ? "complete" : "partial") : "stale";
  const explainedRevision = row.rule_status?.inputRevision;
  const explanation: ContentIdentity["explanation"] = explainedRevision === null || explainedRevision === undefined
    ? "none"
    : Number(explainedRevision) === row.article_revision ? "current" : "stale";
  return {
    titleKind, summaryKind, material,
    bodyShown: row.body_mode === "full" && row.has_body,
    translation, explanation,
  };
}

/** The shared public article; its X post is added as each answer shows it. */
export function toItemSummary(row: ItemRow): ItemSummary {
  const publishedDate = dateOnlyPublicationDate(row.publication_time);
  const titleZh = machineTitle(row);
  const summaryZh = machineSummary(row);
  return {
    id: row.id,
    // Chinese first, the source's own title kept beside it: a reader can always see what was written.
    title: titleZh ?? row.title,
    originalTitle: titleZh ? row.title : row.original_title,
    summary: summaryZh ?? row.summary,
    ...(summaryZh ? { originalSummary: row.summary } : {}),
    reason: row.selected ? row.reason : null,
    source: { name: publicSourceName(row.source_name) },
    links: { original: row.url },
    publishedAt: row.published_at?.toISOString() ?? null,
    ...(publishedDate ? { publishedDate } : {}),
    sourceUpdatedAt: row.source_updated_at?.toISOString() ?? null,
    discoveredAt: row.discovered_at.toISOString(),
    timelineAt: row.timeline_at.toISOString(),
    category: (row.category as CategoryKey | null) ?? null,
    tags: displayTags(row.tags),
    score: row.score === null ? null : Math.round(Number(row.score)),
    selected: row.selected,
    channel: row.channel,
    story: row.story_public_id ? { publicId: row.story_public_id, title: row.story_title ?? "" } : null,
    identity: identityOf(row),
  };
}

/** Project the shared public article into the exact fields a site card renders. */
export function toFeedItemSummary(row: ItemRow): FeedItemSummary {
  const item = toItemSummary(row);
  const x = showsPost(row) ? xView(row, true) : null;
  return {
    id: item.id, title: item.title, originalTitle: item.originalTitle, summary: item.summary ?? (x?.text || null), reason: item.reason,
    source: item.source, publishedAt: item.publishedAt, discoveredAt: item.discoveredAt, timelineAt: item.timelineAt,
    ...(item.publishedDate ? { publishedDate: item.publishedDate } : {}),
    sourceUpdatedAt: item.sourceUpdatedAt ?? null,
    category: item.category, tags: item.tags, score: item.score, selected: item.selected, channel: item.channel,
    identity: item.identity,
    x: x ? {
      authorName: x.authorName, handle: x.handle, avatarUrl: x.avatarUrl,
      ...(x.avatarSrcSet ? { avatarSrcSet: x.avatarSrcSet } : {}), media: x.media,
      quoted: x.quoted ? { authorName: x.quoted.authorName, handle: x.quoted.handle, text: x.quoted.text, translation: x.quoted.translation } : null,
    } : null,
  };
}

/**
 * Every exit uses the same language decision as writing and translation.
 */
export function isChineseBody(a: { language?: string | null; body_text?: string | null }): boolean {
  return isChineseText(a.body_text ?? "", a.language);
}

/** The complete Chinese translation an export (Markdown, full RSS) carries; a page also shows a partial one. */
export function exportTranslation(a: { language?: string | null; body_text?: string | null; tr_html?: string | null; tr_complete?: boolean | null }): string | null {
  return !isChineseBody(a) && a.tr_html && a.tr_complete ? a.tr_html : null;
}

/**
 * For listed rows that are selected but yield their fact's seat: the report holding it, by row id.
 * (The home timeline folds these into reading groups; flat lists say which report stands for them.)
 */
export async function seatHolders(rows: ItemRow[], now: Date, db: Db = sql): Promise<Map<string, { id: string; title: string }>> {
  const yielding = rows.filter((r) => r.selected && !r.seat && r.fact_id !== null);
  if (!yielding.length) return new Map();
  const holders = await db<{ fact_id: number; id: string; title: string }[]>`
    SELECT p.fact_id, p.article_id AS id, p.title FROM publications p
    WHERE p.fact_id IN ${db([...new Set(yielding.map((r) => r.fact_id!))])} AND ${seatedCondition(now)} AND ${foldableSelectionCondition()}`;
  const byFact = new Map(holders.map((h) => [Number(h.fact_id), { id: h.id, title: h.title }]));
  return new Map(yielding.flatMap((r) => (byFact.has(Number(r.fact_id)) ? [[r.id, byFact.get(Number(r.fact_id))!] as const] : [])));
}
