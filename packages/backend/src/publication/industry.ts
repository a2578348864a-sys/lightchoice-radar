// The second lane's public read layer: what the industry pages and the agent API may show.
//
// Everything here reads from the same facts the first lane's read layer reads — publications,
// articles, stories, story_digests — filtered to the industry sources. Restricted sources expose
// factual metadata only (title, link, date, source): the feed's own summary text is never published
// for them, matching the permission profile the sources were admitted under.
import type {
  IndustryDetail, IndustryItem, IndustryListResponse, IndustryPicksResponse, IndustrySourceStatus,
} from "@aihot/contracts/site";
import { sql } from "../db.ts";
import { INDUSTRY_SOURCES, INDUSTRY_SOURCE_IDS, INDUSTRY_THEME_LABEL, INDUSTRY_THEMES, type IndustrySourceId, type IndustryTheme } from "../sources/industry-lane.ts";
import { industryBudgetState } from "../editorial/industry-budget.ts";

const LIST_LIMIT = 60;
const INDUSTRY_IDS = `{${INDUSTRY_SOURCE_IDS.join(",")}}`;

/** The source metadata the pages show, derived from the recorded permission profiles. */
export function industrySourceMeta(): Array<{ id: IndustrySourceId; name: string; publisher: string; modelProcessing: boolean; saveExcerpt: boolean }> {
  return Object.values(INDUSTRY_SOURCES).map((s) => ({
    id: s.id, name: s.id.replace(/^industry-/, ""), publisher: s.publisher,
    modelProcessing: s.modelProcessing, saveExcerpt: s.saveExcerpt,
  }));
}

/** The zh title an article carries, if the lane has processed it. */
async function zhTitleOf(articleId: string): Promise<string | null> {
  const [row] = await sql<{ title: string | null }[]>`SELECT title FROM translations WHERE article_id = ${articleId} AND lang = 'zh-industry' ORDER BY revision DESC, created_at DESC LIMIT 1`;
  return row?.title ?? null;
}

interface IndustryItemRow {
  id: string;
  title: string;
  url: string;
  source_id: string;
  published_at: Date | null;
  discovered_at: Date;
  excerpt: string | null;
  original_title: string | null;
  kind: string | null;
  themes: string[] | null;
  story_id: number | null;
  story_public_id: string | null;
  story_title: string | null;
  story_latest: string | null;
  story_first: Date | null;
  digest_version: number | null;
  articles_same_event: number | null;
}

function mapItem(row: IndustryItemRow, zhTitle: string | null): IndustryItem {
  const sourceProfile = INDUSTRY_SOURCES[row.source_id as IndustrySourceId];
  return {
    id: row.id,
    title: row.title,
    originalTitle: row.original_title,
    url: row.url,
    sourceId: row.source_id,
    sourceName: sourceProfile?.publisher ?? row.source_id,
    publishedAt: row.published_at?.toISOString() ?? null,
    discoveredAt: row.discovered_at.toISOString(),
    excerpt: row.excerpt,
    zhTitle,
    kind: (row.kind as IndustryItem["kind"]) ?? "news",
    themes: (row.themes ?? []) as IndustryItem["themes"],
    story: row.story_public_id ? {
      id: row.story_id!, publicId: row.story_public_id, title: row.story_title ?? "",
      latest: row.story_latest, firstReportAt: row.story_first?.toISOString() ?? null,
      articleCount: row.articles_same_event ?? 1, digestVersion: row.digest_version,
    } : null,
    modelProcessing: sourceProfile?.modelProcessing ?? false,
  };
}

/** One row with everything the list and the detail share. Restricted sources' excerpts become null. */
async function queryIndustryRows(extraWhere: string, order: string, limit: number | null): Promise<IndustryItemRow[]> {
  return sql.unsafe<IndustryItemRow[]>(`
    SELECT a.id, a.title, a.url, a.source_id, a.published_at, a.discovered_at,
      CASE WHEN s.config->>'saveExcerpt' = 'false' THEN NULL ELSE left(a.excerpt, 300) END AS excerpt,
      p.original_title,
      a.raw->'industry'->>'kind' AS kind,
      (SELECT array_agg(value::text) FROM jsonb_array_elements_text(a.raw->'industry'->'themes') AS t(value)) AS themes,
      st.id AS story_id, st.public_id::text AS story_public_id, st.title AS story_title,
      st.latest AS story_latest, st.first_report_at AS story_first,
      (SELECT max(sd.version)::int FROM story_digests sd WHERE sd.story_id = st.id) AS digest_version,
      (SELECT count(*)::int FROM publications p2 WHERE p2.story_id = st.id AND p2.story_id IS NOT NULL) AS articles_same_event
    FROM articles a
    JOIN sources s ON s.id = a.source_id
    LEFT JOIN publications p ON p.article_id = a.id
    LEFT JOIN stories st ON st.id = p.story_id AND st.merged_into IS NULL
    WHERE a.source_id = ANY('{${INDUSTRY_SOURCE_IDS.join(",")}}'::text[]) AND a.raw->'industry'->>'admitted' = 'true' ${extraWhere}
    ${order}
    ${limit ? `LIMIT ${limit}` : ""}`);
}

export interface IndustryQuery {
  theme?: string | null;
  source?: string | null;
  kind?: string | null;
  q?: string | null;
  days?: number;
}

/** The filters the caller named, turned into a safe WHERE fragment (values are allowlisted or escaped). */
function filterSql(query: IndustryQuery): { where: string } {
  const theme = INDUSTRY_THEMES.includes(query.theme as IndustryTheme) ? (query.theme as IndustryTheme) : null;
  const source = isApprovedIndustrySourceId(query.source) ? query.source : null;
  const kind = query.kind?.trim() ? query.kind.trim().replace(/'/g, "''") : null;
  const q = query.q?.trim() ? query.q.trim().slice(0, 80).replace(/'/g, "''").replace(/%/g, "\\%").replace(/_/g, "\\_") : null;
  const days = Math.min(Math.max(Number(query.days) || 30, 1), 90);
  const where = `
      AND a.discovered_at > now() - interval '${days} days'
      ${theme ? `AND jsonb_exists(a.raw->'industry'->'themes', '${theme}')` : ""}
      ${source ? `AND a.source_id = '${source}'` : ""}
      ${kind ? `AND a.raw->'industry'->>'kind' = '${kind}'` : ""}
      ${q ? `AND a.title ILIKE '%${q}%'` : ""}`;
  return { where };
}

/**
 * The lane's list: admitted items only (the gate verdict lives in raw.industry), newest first, with
 * the filters the pages expose. Rejected rows stay in articles — they are just not shown here.
 */
export async function loadIndustryItems(query: IndustryQuery = {}): Promise<IndustryListResponse> {
  const { where } = filterSql(query);
  const rows = await queryIndustryRows(where, `ORDER BY coalesce(a.published_at, a.discovered_at) DESC`, LIST_LIMIT);
  const zhMap = new Map<string, string>();
  if (rows.length) {
    const zhRows = await sql<Array<{ article_id: string; title: string }>>`
      SELECT DISTINCT ON (article_id) article_id, title FROM translations
      WHERE lang = 'zh-industry' AND article_id = ANY(${rows.map((r) => r.id)}::text[])
      ORDER BY article_id, revision DESC, created_at DESC`;
    for (const r of zhRows) zhMap.set(r.article_id, r.title);
  }
  const [counts] = await sql<{ admitted: number; rejected: number }[]>`
    SELECT count(*) FILTER (WHERE raw->'industry'->>'admitted' = 'true')::int AS admitted,
           count(*) FILTER (WHERE raw->'industry'->>'admitted' = 'false')::int AS rejected
    FROM articles WHERE source_id = ANY(${INDUSTRY_SOURCE_IDS}::text[])`;
  const [stories] = await sql<{ n: number }[]>`
    SELECT count(DISTINCT p.story_id)::int AS n FROM publications p
    JOIN articles a ON a.id = p.article_id
    WHERE a.source_id = ANY(${INDUSTRY_SOURCE_IDS}::text[]) AND p.story_id IS NOT NULL`;
  const [zh] = await sql<{ n: number }[]>`
    SELECT count(DISTINCT t.article_id)::int AS n FROM translations t
    JOIN articles a ON a.id = t.article_id
    WHERE t.lang = 'zh-industry' AND a.source_id = ANY(${INDUSTRY_SOURCE_IDS}::text[])`;
  return {
    items: rows.map((r) => mapItem(r, zhMap.get(r.id) ?? null)),
    counts: { admitted: counts?.admitted ?? 0, rejected: counts?.rejected ?? 0, stories: stories?.n ?? 0, zh: zh?.n ?? 0 },
    themes: INDUSTRY_THEMES.map((t) => ({ id: t, label: INDUSTRY_THEME_LABEL[t] })),
    sources: industrySourceMeta(),
    filters: { theme: query.theme ?? null, source: query.source ?? null, kind: query.kind ?? null, q: query.q ?? null, days: Math.min(Math.max(Number(query.days) || 30, 1), 90) },
  };
}

function isApprovedIndustrySourceId(id: string | null | undefined): id is IndustrySourceId {
  return !!id && (INDUSTRY_SOURCE_IDS as readonly string[]).includes(id);
}

/** One item with the story's multi-source view and the digest versions it has been through. */
export async function loadIndustryDetail(id: string): Promise<IndustryDetail | null> {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return null;
  const safeId = id.replace(/'/g, "''");
  const [row] = await queryIndustryRows(`AND a.id = '${safeId}'`, "", 1);
  if (!row) return null;
  const siblings = row.story_id
    ? await queryIndustryRows(`AND a.id <> '${safeId}' AND p.story_id = ${Number(row.story_id)}`, `ORDER BY coalesce(a.published_at, a.discovered_at) DESC`, 20)
    : [];
  const digests = row.story_id
    ? await sql<Array<{ version: number; digest: string; latest: string | null; receipt_id: number | null; article_ids: string[]; created_at: Date }>>`
        SELECT version, digest, latest, receipt_id, article_ids, created_at FROM story_digests
        WHERE story_id = ${row.story_id} ORDER BY version DESC`
    : [];
  const zhTitle = await zhTitleOf(row.id);
  const siblingItems = await Promise.all(siblings.map(async (s) => mapItem(s, await zhTitleOf(s.id))));
  return {
    ...mapItem(row, zhTitle),
    siblings: siblingItems,
    digestVersions: digests.map((d) => ({ version: d.version, digest: d.digest, latest: d.latest, receiptId: d.receipt_id, articleIds: d.article_ids, createdAt: d.created_at.toISOString() })),
  };
}

/**
 * The day's picks, deterministic: admitted stories whose latest material is from the day, ranked
 * official data first (a release is a fact, not a story), then by recency. A day with nothing
 * qualified stays empty — nothing is added to look busy.
 */
export async function generateIndustryPicks(day = beijingDay()): Promise<number> {
  const safeDay = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : beijingDay();
  const rows = await sql<Array<{ story_id: number; event_key: string; theme: string; title: string; latest: string | null; digest_version: number | null; article_ids: string[] | null; kind: string | null }>>`
    SELECT st.id AS story_id, st.frame->>'eventKey' AS event_key,
           coalesce(st.frame->>'theme', 'consumer-demand') AS theme, st.title, st.latest,
           (SELECT max(sd.version)::int FROM story_digests sd WHERE sd.story_id = st.id) AS digest_version,
           (SELECT array_agg(DISTINCT p2.article_id) FROM publications p2 WHERE p2.story_id = st.id) AS article_ids,
           (SELECT a2.raw->'industry'->>'kind' FROM publications p3 JOIN articles a2 ON a2.id = p3.article_id WHERE p3.story_id = st.id LIMIT 1) AS kind
    FROM stories st
    WHERE st.merged_into IS NULL AND st.frame->>'lane' = 'industry'
      AND coalesce(st.latest_at, st.created_at) >= (${safeDay}::date)::timestamptz - interval '8 hours'
      AND coalesce(st.latest_at, st.created_at) < (${safeDay}::date + 1)::timestamptz + interval '8 hours'
    ORDER BY ((SELECT a2.raw->'industry'->>'kind' FROM publications p3 JOIN articles a2 ON a2.id = p3.article_id WHERE p3.story_id = st.id LIMIT 1) = 'official-data') DESC,
             coalesce(st.latest_at, st.created_at) DESC
    LIMIT 5`;
  const { saveIndustryPicks } = await import("../editorial/industry-events.ts");
  return saveIndustryPicks(safeDay, rows.map((r) => ({
    day: safeDay, storyId: r.story_id, eventKey: r.event_key ?? "", theme: r.theme, title: r.title,
    quick: r.latest, reason: r.kind === "official-data" ? "官方数据发布" : "行业信号",
    articleIds: r.article_ids ?? [], digestVersion: r.digest_version,
  })));
}

function beijingDay(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Archived picks for the回看 view: what was known then, with the version it was built from. */
export async function loadIndustryPicks(days = 14): Promise<IndustryPicksResponse> {
  const bounded = Math.min(Math.max(Number(days) || 14, 1), 60);
  const rows = await sql<Array<{ day: string; story_id: number; title: string; quick: string | null; reason: string; theme: string; article_ids: string[]; digest_version: number | null; created_at: Date; public_id: string }>>`
    SELECT p.day::text AS day, p.story_id, p.title, p.quick, p.reason, p.theme, p.article_ids, p.digest_version, p.created_at,
           st.public_id::text
    FROM industry_daily_picks p
    JOIN stories st ON st.id = p.story_id
    WHERE p.day > current_date - ${bounded}::int
    ORDER BY p.day DESC, p.id ASC`;
  const byDay = new Map<string, IndustryPicksResponse["days"][number]["picks"]>();
  for (const r of rows) {
    const list = byDay.get(r.day) ?? [];
    list.push({ storyId: r.story_id, storyPublicId: r.public_id, title: r.title, quick: r.quick, reason: r.reason, theme: r.theme as IndustryTheme, articleIds: r.article_ids, digestVersion: r.digest_version, generatedAt: r.created_at.toISOString() });
    byDay.set(r.day, list);
  }
  return {
    days: [...byDay.entries()].map(([day, picks]) => ({ day, picks })),
    note: rows.length ? undefined : "近期待选事件为空：要么来源无新增，要么尚无合格事件（不凑数）。",
    generatedFor: bounded,
  };
}

/** The lane's own run/budget status: the state a reader of the status screen needs, from facts only. */
export async function loadIndustryStatus(): Promise<IndustrySourceStatus> {
  const sources = await sql<Array<{ id: string; enabled: boolean; health: string; interval_minutes: number; last_error: string | null; next_fetch_at: Date | null; last_ok_at: Date | null }>>`
    SELECT id, enabled, health, interval_minutes, last_error, next_fetch_at, last_ok_at
    FROM sources WHERE id = ANY(${INDUSTRY_SOURCE_IDS}::text[]) ORDER BY id`;
  const [lastRun] = await sql<{ id: number; status: string; started_at: Date; found_count: number; new_count: number }[]>`
    SELECT id, status, started_at, found_count, new_count FROM fetch_runs
    WHERE source_id = ANY(${INDUSTRY_SOURCE_IDS}::text[]) ORDER BY id DESC LIMIT 1`;
  const budget = await industryBudgetState();
  return {
    sources: sources.map((s) => ({ id: s.id, enabled: s.enabled, health: s.health, intervalMinutes: s.interval_minutes, lastError: s.last_error, nextFetchAt: s.next_fetch_at?.toISOString() ?? null, lastOkAt: s.last_ok_at?.toISOString() ?? null })),
    lastRun: lastRun ? { id: lastRun.id, status: lastRun.status, startedAt: lastRun.started_at.toISOString(), found: lastRun.found_count, created: lastRun.new_count } : null,
    budget: {
      round: budget.round, requests: budget.requests, spentCny: budget.spentCny,
      limits: budget.limits ?? null, observationStartedAt: budget.observationStartedAt ?? null,
    },
  };
}

/** The research export: theme, event, facts, sources, versions, caveats — nothing invented. */
export async function exportIndustryMarkdown(query: IndustryQuery = {}): Promise<string> {
  const list = await loadIndustryItems({ ...query, days: query.days ?? 30 });
  const lines: string[] = ["# 美国消费与电商行业动态 · 研究线索导出", "", `- 导出时间：${new Date().toISOString()}`, `- 范围：最近 ${list.filters.days ?? 30} 天${list.filters.theme ? ` · 主题 ${list.filters.theme}` : ""}${list.filters.source ? ` · 来源 ${list.filters.source}` : ""}`, ""];
  for (const item of list.items) {
    lines.push(`## ${item.zhTitle ?? item.title}`, "");
    lines.push(`- 来源：${item.sourceName} · ${item.publishedAt?.slice(0, 10) ?? "日期未标注"} · 类型 ${item.kind}`);
    lines.push(`- 原文：${item.url}`);
    if (item.themes.length) lines.push(`- 主题：${item.themes.join(", ")}`);
    if (item.story) lines.push(`- 事件：${item.story.title}（${item.story.articleCount} 篇来源）`);
    if (item.zhTitle) lines.push(`- 中文标题：${item.zhTitle}（机器处理 · 未经人工核对）`);
    lines.push("");
  }
  lines.push("---", "", "导出只含来源已允许保存的信息；限制准入来源仅元数据。所有数字以原文为准。");
  return lines.join("\n");
}
