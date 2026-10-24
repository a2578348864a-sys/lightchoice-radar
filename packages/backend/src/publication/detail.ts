// Item detail and Markdown export, both behind the same visibility and licence rules.
import type { OutlineEntry, PolicyExplanation, PolicyKeyFact, RuleEvidence, SiteItemDetail, StoryRef } from "@aihot/contracts/site";
import { ITEM_COPY, SITE } from "@aihot/site";
import { bodyToMarkdown } from "../content/markdown.ts";
import { sql } from "../db.ts";
import { stripTagMarkup } from "../lib/text.ts";
import { proxyBodyImages } from "../media/imgproxy.ts";
import { textToHtml } from "../content/sanitize.ts";
import { exportTranslation, isChineseBody, ITEM_COLUMNS, ITEM_FROM, seatHolders, showsPost, toItemSummary, xView, type ItemRow } from "./items.ts";
import { keyFactsFromMaterial } from "../editorial/key-facts.ts";
import { evidenceCondition, listedCondition } from "./scope.ts";
import { itemUrl, siteUrl } from "./links.ts";
import { hasItemPage, publicSourceName } from "./rules.ts";
import { topicLinks, topicMembership } from "./topics.ts";

interface DetailRow extends ItemRow {
  material_revision: number;
  body_html: string | null;
  body_text: string | null;
  body_status: string;
  tr_html: string | null;
  tr_complete: boolean | null;
  topics: string[];
}

export type DetailResult =
  | { kind: "found"; item: SiteItemDetail; row: DetailRow }
  | { kind: "not_found" };

/** Adds stable ids to h2–h4 and returns the outline. */
function withOutline(html: string): { html: string; outline: OutlineEntry[] } {
  const outline: OutlineEntry[] = [];
  let n = 0;
  const out = html.replace(/<h([2-4])(?: id="sec-\d+")?>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
    n += 1;
    const id = `sec-${n}`;
    const text = stripTagMarkup(inner, "").trim();
    if (text) outline.push({ id, text: text.slice(0, 80), level: Number(level) });
    return `<h${level} id="${id}">${inner}</h${level}>`;
  });
  return { html: out, outline };
}

async function loadRow(id: string): Promise<DetailRow | null> {
  const [row] = await sql<DetailRow[]>`
    SELECT ${ITEM_COLUMNS}, a.body_html, a.body_text, a.body_status, tr.body_html AS tr_html, tr.complete AS tr_complete,
      a.revision AS material_revision, ${topicMembership()} AS topics
    ${ITEM_FROM}
    WHERE p.article_id = ${id}`;
  return row ?? null;
}

async function loadRadarHistory(id: string, revision: number): Promise<Pick<SiteItemDetail, "ruleVersion" | "ruleEvidence" | "revisionHistory" | "explanation">> {
  if (SITE.name !== "LightChoice Radar") return {};
  const [analysis] = await sql<{ output: { ruleVersion?: string; ruleEvidence?: RuleEvidence[]; explanation?: PolicyExplanation | null } }[]>`
    SELECT an.output FROM analyses an JOIN articles a ON a.id = an.article_id AND a.revision = an.input_revision
    WHERE an.article_id = ${id} AND an.origin = 'rule' ORDER BY an.id DESC LIMIT 1`;
  let revisions: Array<{ revision: number; title: string; excerpt: string | null; created_at: Date }> = [];
  try {
    revisions = await sql<Array<{ revision: number; title: string; excerpt: string | null; created_at: Date }>>`
      SELECT r.revision, r.title, coalesce(r.excerpt, left(r.body_text, 800)) AS excerpt, r.created_at
      FROM article_revisions r WHERE r.article_id = ${id} AND r.revision <= ${revision}
      ORDER BY r.revision DESC LIMIT 20`;
  } catch (error) {
    // Before the additive migration, use the stored body snapshot. For the current version only,
    // its matching content hash proves the live article excerpt belongs to this exact revision.
    if ((error as { code?: string }).code !== "42703") throw error;
    revisions = await sql<Array<{ revision: number; title: string; excerpt: string | null; created_at: Date }>>`
      SELECT r.revision, r.title,
        CASE WHEN r.revision = a.revision AND r.content_hash = a.content_hash
          THEN a.excerpt ELSE left(r.body_text, 800) END AS excerpt,
        r.created_at
      FROM article_revisions r LEFT JOIN articles a ON a.id = r.article_id
      WHERE r.article_id = ${id} AND r.revision <= ${revision}
      ORDER BY r.revision DESC LIMIT 20`;
  }
  const evidence = analysis?.output?.ruleEvidence;
  return {
    ...(analysis?.output?.ruleVersion ? { ruleVersion: analysis.output.ruleVersion } : {}),
    ...(Array.isArray(evidence) ? { ruleEvidence: evidence } : {}),
    // Only an explanation of this exact material version is returned; an older one stays invisible
    // (identity.explanation reports it as stale instead of showing it as current).
    explanation: analysis?.output?.explanation ?? null,
    revisionHistory: revisions.map((row) => ({ revision: row.revision, title: row.title, excerpt: row.excerpt, capturedAt: row.created_at.toISOString() })),
  };
}

/**
 * The body a page reads in `language` when it has it, else in the other: Chinese is the article's own text
 * or a translation (shown even before it is complete), the original only the article's own. `page` turns
 * the HTML shown into what is sent, with its outline.
 */
function readingBody(
  language: "zh" | "original",
  zh: { html: string; kind: "translation" | "original" } | null,
  original: string | null,
  complete: boolean,
  page: (html: string) => { html: string; outline: OutlineEntry[] },
): Pick<SiteItemDetail, "body" | "outline" | "hasTranslation" | "bodyLanguage"> {
  const bodyLanguage = language === "original" && original ? "original" : zh?.html ? "zh" : "original";
  const shown = bodyLanguage === "zh" ? zh!.html : original;
  const sent = shown ? page(shown) : { html: shown, outline: [] };
  return {
    body: { zh: bodyLanguage === "zh" ? sent.html : null, original: bodyLanguage === "original" ? sent.html : null, zhKind: zh?.kind ?? null, complete },
    outline: sent.outline,
    hasTranslation: zh?.kind === "translation" && !!zh.html && !!original,
    bodyLanguage,
  };
}

/**
 * Public detail (rules.hasItemPage) in one language, Chinese unless the original is asked for: items the
 * lists leave out (low relevance, merged duplicates, no Chinese summary yet) keep a noindex page;
 * withdrawn and hot_signal items are a 404.
 */
export async function loadItemDetail(id: string, language: "zh" | "original" = "zh", now = new Date()): Promise<DetailResult> {
  const row = await loadRow(id);
  if (!row || !hasItemPage({ visibility: row.visibility, sourceMode: row.source_mode })) return { kind: "not_found" };

  const summary = toItemSummary(row);
  const radarHistory = await loadRadarHistory(id, row.material_revision);
  // 关键信息：同一套确定性规则（editorial/key-facts.ts）在读取时计算——纯字符串、零模型、零写入、
  // 零第二事实库。它读的是当前版本的原文、摘要、正文与中文译名，因此原文或译文一变，下一次读取就
  // 跟着变，不会沿用过期派生结果；材料不支持时不产生字段，页面就不渲染这个区块。随规则解释存库的
  // keyFacts 保留为分析记录（与审计轨迹在一起），页面展示的始终是当前版本的计算结果。
  const keyFacts: PolicyKeyFact[] = keyFactsFromMaterial({
    title: row.title, excerpt: row.summary, bodyText: row.body_text,
    sourceName: row.source_name, chineseTitle: row.tr_title,
  });
  if (row.visibility === "summary-only") {
    const item: SiteItemDetail = {
      ...summary,
      selected: false,
      score: null,
      category: null,
      story: null,
      reason: null,
      tags: [],
      x: null,
      readingMode: "summary-only",
      author: null,
      body: null,
      outline: [],
      relatedStories: [],
      topics: [],
      indexable: false,
      markdownAvailable: false,
      group: null,
      hasTranslation: false,
      bodyLanguage: "original",
      keyFacts,
    };
    return { kind: "found", item, row };
  }

  const related = await sql<StoryRef[]>`
    SELECT DISTINCT st.public_id::text AS "publicId", st.title
    FROM fact_articles fa JOIN facts f ON f.id = fa.fact_id JOIN stories st ON st.id = f.story_id
    WHERE fa.article_id = ${id} AND fa.role <> 'mention' AND st.merged_into IS NULL
    ORDER BY "publicId" LIMIT 6`;

  let x: SiteItemDetail["x"] = null;
  let reading: Pick<SiteItemDetail, "body" | "outline" | "hasTranslation" | "bodyLanguage"> = { body: null, outline: [], hasTranslation: false, bodyLanguage: "original" };
  if (showsPost(row)) {
    const post = xView(row, false, true);
    const text = String(row.x_post?.text ?? row.body_text ?? "");
    // A post's text is sent as written: its headings make the outline, without anchors.
    if (post?.translation || text.trim()) reading = readingBody(language, post?.translation ? { html: textToHtml(post.translation), kind: "translation" } : null, text.trim() ? textToHtml(text) : null, true,
      (html) => ({ html, outline: withOutline(html).outline }));
    if (post) {
      const { text: _text, translation: _translation, ...shown } = post;
      x = shown;
    }
  } else if (row.body_mode === "full" && row.body_html) {
    const chinese = isChineseBody(row);
    const zh = chinese ? { html: row.body_html, kind: "original" as const } : row.tr_html ? { html: row.tr_html, kind: "translation" as const } : null;
    reading = readingBody(language, zh, chinese ? null : row.body_html, chinese ? true : row.tr_complete ?? false, (html) => withOutline(proxyBodyImages(html)));
  }

  let group: SiteItemDetail["group"] = null;
  if (row.fact_id) {
    const [g] = await sql<{ public_id: string; reports: number; sources: number }[]>`
      SELECT f.public_id, count(p.article_id) AS reports, count(DISTINCT p.source_id) AS sources
      FROM facts f JOIN fact_articles fa ON fa.fact_id = f.id JOIN publications p ON p.article_id = fa.article_id
      WHERE f.id = ${row.fact_id} AND ${evidenceCondition()} AND ${listedCondition(now)}
      GROUP BY f.public_id`;
    if (g) {
      group = {
        factId: g.public_id,
        reportCount: Number(g.reports),
        additionalSourceCount: Math.max(0, Number(g.sources) - 1),
      };
    }
  }

  // The reason goes with the seat; a report yielding it points to the one holding it.
  const sameEvent = (await seatHolders([row], now)).get(row.id) ?? null;
  const item: SiteItemDetail = {
    ...summary,
    x,
    ...(sameEvent ? { reason: null, sameEvent } : {}),
    readingMode: "full",
    author: row.author,
    body: reading.body,
    outline: reading.outline,
    relatedStories: related,
    topics: topicLinks(row.topics),
    indexable: row.indexable,
    markdownAvailable: markdownAvailable(row),
    group,
    hasTranslation: reading.hasTranslation,
    bodyLanguage: reading.bodyLanguage,
    keyFacts,
    ...radarHistory,
  };
  return { kind: "found", item, row };
}

/**
 * Same predicate for the export button and the export route: a public page with something to export
 * (a summary, the post where pages show it, or a full-text body).
 */
export function markdownAvailable(row: {
  visibility: string; source_mode: string; summary: string | null; body_mode: string; body_html?: string | null; channel: string; x_post: Record<string, any> | null;
}): boolean {
  if (row.visibility !== "public" || !hasItemPage({ visibility: row.visibility, sourceMode: row.source_mode })) return false;
  return !!row.summary || (showsPost(row) && (!!row.x_post?.text || !!row.x_post?.media?.length || !!row.x_post?.quoted?.text)) || (row.body_mode === "full" && !!row.body_html);
}

export async function exportMarkdown(id: string): Promise<{ filename: string; body: string } | null> {
  const row = await loadRow(id);
  if (!row || !markdownAvailable(row)) return null;
  const lines: string[] = [];
  lines.push(`# ${row.title}`, "");
  if (row.original_title) lines.push(`> 原标题：${row.original_title}`, "");
  lines.push(`- 来源：${publicSourceName(row.source_name)}`);
  // Without a reliable date from the original, the time it was collected says so.
  lines.push(row.published_at ? `- 发布时间：${row.published_at.toISOString()}` : `- 收录时间：${row.discovered_at.toISOString()}`);
  lines.push(`- ${SITE.name}：${itemUrl(row.id)}`);
  lines.push(`- 原文：${row.url}`, "");
  if (row.summary) lines.push("## 摘要", "", row.summary, "");
  if (row.selected && row.seat && row.reason) lines.push(`## ${ITEM_COPY.reasonLabel}`, "", row.reason, "");
  if (showsPost(row) && row.x_post) {
    const post = xView(row);
    if (post?.text) lines.push("## 正文", "", post.text, "");
    if (post?.translation) lines.push("## 中文译文", "", post.translation, "");
    for (const media of post?.media ?? []) {
      const url = media.url.startsWith("/") ? siteUrl(media.url) : media.url;
      lines.push(media.kind === "image" ? `![${media.alt ?? ""}](${url})` : `[视频](${url})`, "");
    }
    const q = post?.quoted;
    if (q?.text) lines.push(`## 引用 @${q.handle ?? ""}`, "", ...String(q.text).split("\n").map((l) => `> ${l}`), "", ...(q.url ? [q.url, ""] : []));
    if (q?.text && q.translation) lines.push("### 引用中文译文", "", ...q.translation.split("\n").map((l) => `> ${l}`), "");
  } else if (row.body_mode === "full" && row.body_html) {
    const translation = exportTranslation(row);
    if (translation) lines.push("## 正文 · 中文译文", "", bodyToMarkdown(translation, row.url), "");
    lines.push(isChineseBody(row) ? "## 正文" : "## 正文 · 原文", "", bodyToMarkdown(row.body_html, row.url), "");
  }
  return { filename: `${SITE.mcpPrefix}-${row.id}.md`, body: lines.join("\n").replace(/\n{3,}/g, "\n\n") };
}
