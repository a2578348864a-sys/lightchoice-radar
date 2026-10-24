/**
 * Read-only AMZ123 delivery evidence generator.
 * Run from repository root: node --env-file=.env scripts/generate-amz123-delivery-evidence.ts --expect-no-worker
 * It never starts workers, collects source pages, changes DB rows, or writes migrations.
 */
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sql, closeDb } from "@aihot/backend/db";
import {
  buildVerificationChecks,
  hasForbiddenRawPayload,
  parseJsonObject,
  parseWorkerState,
  sanitizeCursor,
  sanitizeDiagnostics,
  sanitizeLeadMetadata,
} from "./amz123-evidence-shape.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ID = "amz123-policy-leads";
const EXPECTED_PATHS = ["/t/", "/kx/"];
const EXCLUDED_PATHS = ["/b（服务商目录）", "/report（行业报告）", "/zb（每日多主题早报，本轮不纳入）", "/search", "/api", "/tag-*"];
const FAMILY_KEYS = ["platform_policy", "ads_policy", "external_regulation"] as const;
type FamilyKey = typeof FAMILY_KEYS[number];
type Counts = Record<FamilyKey, number>;

interface SourceRow {
  id: string; name: string; kind: string; tier: string; participation_mode: string; first_party: boolean;
  interval_minutes: number; enabled: boolean; health: string; fail_count: number; last_fetch_at: Date | null;
  last_ok_at: Date | null; last_error: string | null; next_fetch_at: Date | null; tags: string[]; config: unknown; cursor: unknown;
}
interface RunRow {
  id: number; status: string; found_count: number; new_count: number; started_at: Date; finished_at: Date | null;
  error: string | null; detail: unknown;
}
interface ArticleRow {
  id: string; url: string; title: string; author: string | null; published_at: Date | null; publication_time: string | null;
  source_updated_at: Date | null; excerpt: string | null; body_status: string; body_text_null: boolean; body_html_null: boolean;
  body_length: number; discovered_at: Date; revision: number; raw: unknown; revision_body_present: boolean; translation_body_present: boolean;
  revision_excerpt_snapshot_present: boolean;
}

function datePartShanghai(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (key: string) => parts.find((part) => part.type === key)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function iso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function cleanError(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const clean = value.replace(/\s+/g, " ").trim();
  if (clean.length > 220 || /<!doctype\s+html|<html\b|<body\b/i.test(clean)) return "[omitted: long or HTML diagnostic]";
  return clean;
}

function asObject(value: unknown): Record<string, unknown> {
  return parseJsonObject(value) ?? {};
}

function countValue(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function parseArgs(argv: string[]) {
  let output = path.join(ROOT, "docs", "radar", `amz123-lead-collection-${datePartShanghai()}.json`);
  let force = false;
  let expectNoWorker = false;
  let baseline: Counts = { platform_policy: 3, ads_policy: 2, external_regulation: 20 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--force") force = true;
    else if (arg === "--expect-no-worker") expectNoWorker = true;
    else if (arg === "--out" && argv[i + 1]) output = path.resolve(ROOT, argv[++i]!);
    else if (arg.startsWith("--out=")) output = path.resolve(ROOT, arg.slice("--out=".length));
    else if (arg === "--baseline" && argv[i + 1]) baseline = parseBaseline(argv[++i]!);
    else if (arg.startsWith("--baseline=")) baseline = parseBaseline(arg.slice("--baseline=".length));
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage: node --env-file=.env scripts/generate-amz123-delivery-evidence.ts [--out PATH] [--force] [--baseline 3,2,20] [--expect-no-worker]");
      process.exit(0);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return { output, force, expectNoWorker, baseline };
}

function parseBaseline(value: string): Counts {
  const values = value.split(",").map((part) => Number(part.trim()));
  if (values.length !== 3 || values.some((n) => !Number.isSafeInteger(n) || n < 0)) {
    throw new Error("--baseline must be three non-negative integers in platform_policy,ads_policy,external_regulation order");
  }
  return { platform_policy: values[0]!, ads_policy: values[1]!, external_regulation: values[2]! };
}

async function readSnapshot(baseline: Counts) {
  return sql.begin(async (tx) => {
    await tx`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`;
    const sources = await tx<SourceRow[]>`
      SELECT id, name, kind, tier, participation_mode, first_party, interval_minutes, enabled, health, fail_count,
             last_fetch_at, last_ok_at, last_error, next_fetch_at, tags, config, cursor
      FROM sources WHERE id = ${SOURCE_ID}`;
    const source = sources[0];
    if (!source) throw new Error(`Source ${SOURCE_ID} is not registered in the current database`);

    const runs = await tx<RunRow[]>`
      SELECT id, status, found_count, new_count, started_at, finished_at, error, detail
      FROM fetch_runs WHERE source_id = ${SOURCE_ID} ORDER BY id DESC LIMIT 20`;

    // Deliberately do not SELECT body_text/body_html. Only null flags and lengths are read.
    const articles = await tx<ArticleRow[]>`
      SELECT a.id, a.url, a.title, a.author, a.published_at, a.publication_time, a.source_updated_at,
             a.excerpt, a.body_status, (a.body_text IS NULL) AS body_text_null,
             (a.body_html IS NULL) AS body_html_null,
             char_length(coalesce(a.body_text, '')) + char_length(coalesce(a.body_html, '')) AS body_length,
             a.discovered_at, a.revision, a.raw,
             EXISTS (SELECT 1 FROM article_revisions r WHERE r.article_id = a.id AND r.body_text IS NOT NULL
                     AND (a.excerpt IS NULL OR r.body_text <> a.excerpt)) AS revision_body_present,
             EXISTS (SELECT 1 FROM translations t WHERE t.article_id = a.id AND (t.body_text IS NOT NULL OR t.body_html IS NOT NULL)) AS translation_body_present,
             EXISTS (SELECT 1 FROM article_revisions r WHERE r.article_id = a.id AND r.body_text IS NOT NULL
                     AND a.excerpt IS NOT NULL AND r.body_text = a.excerpt) AS revision_excerpt_snapshot_present
      FROM articles a WHERE a.source_id = ${SOURCE_ID}
      ORDER BY a.discovered_at DESC, a.id LIMIT 500`;

    const countsRows = await tx<Array<{
      fact_article_links: number; story_signals: number; analyses: number; publication_rows: number;
      public_publication_rows: number; withdrawn_publication_rows: number; article_body_rows: number;
      article_revision_body_rows: number; article_revision_excerpt_snapshot_rows: number;
      article_revision_overlong_body_rows: number; translation_body_rows: number; overlong_excerpt_rows: number;
    }>>`
      SELECT
        (SELECT count(*)::int FROM fact_articles fa JOIN articles a ON a.id = fa.article_id WHERE a.source_id = ${SOURCE_ID}) AS fact_article_links,
        (SELECT count(*)::int FROM story_signals ss JOIN articles a ON a.id = ss.article_id WHERE a.source_id = ${SOURCE_ID}) AS story_signals,
        (SELECT count(*)::int FROM analyses an JOIN articles a ON a.id = an.article_id WHERE a.source_id = ${SOURCE_ID}) AS analyses,
        (SELECT count(*)::int FROM publications p JOIN articles a ON a.id = p.article_id WHERE a.source_id = ${SOURCE_ID}) AS publication_rows,
        (SELECT count(*)::int FROM publications p JOIN articles a ON a.id = p.article_id WHERE a.source_id = ${SOURCE_ID} AND p.visibility <> 'withdrawn') AS public_publication_rows,
        (SELECT count(*)::int FROM publications p JOIN articles a ON a.id = p.article_id WHERE a.source_id = ${SOURCE_ID} AND p.visibility = 'withdrawn') AS withdrawn_publication_rows,
        (SELECT count(*)::int FROM articles a WHERE a.source_id = ${SOURCE_ID} AND (a.body_text IS NOT NULL OR a.body_html IS NOT NULL)) AS article_body_rows,
        (SELECT count(*)::int FROM article_revisions r JOIN articles a ON a.id = r.article_id WHERE a.source_id = ${SOURCE_ID} AND r.body_text IS NOT NULL AND (a.excerpt IS NULL OR r.body_text <> a.excerpt)) AS article_revision_body_rows,
        (SELECT count(*)::int FROM article_revisions r JOIN articles a ON a.id = r.article_id WHERE a.source_id = ${SOURCE_ID} AND r.body_text IS NOT NULL AND a.excerpt IS NOT NULL AND r.body_text = a.excerpt) AS article_revision_excerpt_snapshot_rows,
        (SELECT count(*)::int FROM article_revisions r JOIN articles a ON a.id = r.article_id WHERE a.source_id = ${SOURCE_ID} AND r.body_text IS NOT NULL AND char_length(r.body_text) > 300) AS article_revision_overlong_body_rows,
        (SELECT count(*)::int FROM translations t JOIN articles a ON a.id = t.article_id WHERE a.source_id = ${SOURCE_ID} AND (t.body_text IS NOT NULL OR t.body_html IS NOT NULL)) AS translation_body_rows,
        (SELECT count(*)::int FROM articles a WHERE a.source_id = ${SOURCE_ID} AND char_length(coalesce(a.excerpt, '')) > 300) AS overlong_excerpt_rows`;

    const familyRows = await tx<Array<{ platform_policy: number; ads_policy: number; external_regulation: number; other: number }>>`
      SELECT
        (count(DISTINCT a.id) FILTER (WHERE 'platform_policy' = ANY(s.tags)))::int AS platform_policy,
        (count(DISTINCT a.id) FILTER (WHERE 'ads_policy' = ANY(s.tags)))::int AS ads_policy,
        (count(DISTINCT a.id) FILTER (WHERE 'external_regulation' = ANY(s.tags)))::int AS external_regulation,
        (count(DISTINCT a.id) FILTER (WHERE NOT (s.tags && ARRAY['platform_policy','ads_policy','external_regulation']::text[])))::int AS other
      FROM articles a JOIN sources s ON s.id = a.source_id`;

    const jobRuns = await tx<Array<{ job: string; status: string; started_at: Date; finished_at: Date | null; error: string | null }>>`
      SELECT job, status, started_at, finished_at, error FROM job_runs
      WHERE job ILIKE '%amz123%' OR job ILIKE '%amazon-announcements%'
      ORDER BY started_at DESC LIMIT 20`;

    return { source, runs: runs.reverse(), articles, counts: countsRows[0]!, families: familyRows[0]!, jobRuns, baseline };
  });
}

async function probe(url: string) {
  try {
    // The site answers 302 on its root and sends the visitor to the list page. The check here is
    // whether the service answers, so the redirect is followed; the first status stays in the
    // evidence so the redirect itself remains visible.
    const first = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(5000) });
    let status = first.status;
    let finalUrl: string | null = null;
    if (first.status >= 300 && first.status < 400) {
      const followed = await fetch(url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(5000) });
      status = followed.status;
      finalUrl = followed.url;
    }
    return { url, status, firstStatus: first.status, finalUrl, ok: status >= 200 && status < 300 };
  } catch (error) {
    return { url, status: null as number | null, ok: false, error: cleanError(error instanceof Error ? error.message : String(error)) };
  }
}

function radarOpsStatus() {
  const result = spawnSync(process.execPath, ["--env-file-if-exists=.env", "scripts/radar-ops.ts", "status"], {
    cwd: ROOT, encoding: "utf8", timeout: 20_000, windowsHide: true, env: process.env,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const relevantLines = stdout.split(/\r?\n/).filter((line) => /3000|3001|AMZ123|线索|公告\s*Worker|radar-announcements|Ads|platform_policy|ads_policy|external_regulation|fetch-amz123|schedule/i.test(line)).slice(0, 80);
  return {
    command: "node --env-file-if-exists=.env scripts/radar-ops.ts status",
    exitCode: typeof result.status === "number" ? result.status : null,
    error: result.error ? cleanError(result.error.message) : null,
    stderr: cleanError(stderr),
    relevantLines,
    announcementWorker: parseWorkerState(stdout, "announcements"),
    adsWorker: parseWorkerState(stdout, "ads"),
  };
}

function mapSource(source: SourceRow) {
  const cursor = asObject(source.cursor);
  const config = asObject(source.config);
  // The source stores the approved prefixes as full URLs, not as bare paths.
  const allowedPaths = Array.isArray(config.allowUrlPrefixes)
    ? config.allowUrlPrefixes.filter((value): value is string =>
        typeof value === "string" && (value.startsWith("/") || value.startsWith("https://")))
    : [];
  return {
    id: source.id, name: source.name, kind: source.kind, tier: source.tier,
    participation_mode: source.participation_mode, first_party: source.first_party,
    interval_minutes: source.interval_minutes, enabled: source.enabled, tags: source.tags,
    health: source.health, fail_count: source.fail_count,
    last_fetch_at: iso(source.last_fetch_at), last_ok_at: iso(source.last_ok_at),
    next_fetch_at: iso(source.next_fetch_at), last_error: cleanError(source.last_error),
    cursor: sanitizeCursor(cursor), configuredAllowedPaths: allowedPaths,
  };
}

function mapRun(run: RunRow) {
  return {
    id: run.id, status: run.status, found: run.found_count, new: run.new_count,
    error: cleanError(run.error), started_at: iso(run.started_at), finished_at: iso(run.finished_at),
    diagnostics: sanitizeDiagnostics(run.detail),
  };
}

function mapArticle(article: ArticleRow) {
  const excerpt = article.excerpt ?? null;
  const excerptLength = excerpt === null ? 0 : Array.from(excerpt).length;
  const rawBodyPayload = hasForbiddenRawPayload(article.raw);
  const violations = [
    !article.body_text_null || !article.body_html_null ? "article-body-present" : null,
    article.revision_body_present ? "revision-body-present" : null,
    article.translation_body_present ? "translation-body-present" : null,
    rawBodyPayload ? "raw-body-field-present" : null,
    excerptLength > 300 ? "excerpt-over-300-chars" : null,
  ].filter((value): value is string => value !== null);
  return {
    id: article.id, url: article.url, title: article.title, author: article.author,
    publishedAt: iso(article.published_at), sourceUpdatedAt: iso(article.source_updated_at),
    publicationTime: article.publication_time,
    description: excerptLength <= 300 ? excerpt : null,
    descriptionLength: excerptLength,
    bodyStatus: article.body_status,
    bodyTextNull: article.body_text_null, bodyHtmlNull: article.body_html_null,
    bodyLength: article.body_length, discoveredAt: iso(article.discovered_at), revision: article.revision,
    lead: sanitizeLeadMetadata(article.raw),
    // A revision row whose body_text is exactly the article's excerpt is a metadata snapshot, not
    // a stored article body: the writer falls back to the excerpt when the excerpt column is absent.
    // It is reported as a fact, and it is not counted as a body leak.
    revisionExcerptSnapshot: article.revision_excerpt_snapshot_present,
    boundaryViolations: violations,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const output = path.resolve(args.output);
  if (existsSync(output) && !args.force) throw new Error(`Output already exists; refusing to overwrite: ${path.relative(ROOT, output)} (pass --force to replace)`);

  const snapshot = await readSnapshot(args.baseline);
  const [web, api] = await Promise.all([
    probe("http://127.0.0.1:3000/"),
    probe("http://127.0.0.1:3001/api/site/meta"),
  ]);
  const status = radarOpsStatus();
  const families: Counts = {
    platform_policy: countValue(snapshot.families.platform_policy),
    ads_policy: countValue(snapshot.families.ads_policy),
    external_regulation: countValue(snapshot.families.external_regulation),
  };
  const counts = snapshot.counts;
  const mappedArticles = snapshot.articles.map(mapArticle);
  const bodyLeakArticles = mappedArticles.filter((article) => (article.boundaryViolations as string[]).length > 0).length;
  const bodyLeakCounts = {
    articleBodyRows: countValue(counts.article_body_rows),
    articleRevisionBodyRows: countValue(counts.article_revision_body_rows),
    articleRevisionExcerptSnapshotRows: countValue(counts.article_revision_excerpt_snapshot_rows),
    articleRevisionOverlongBodyRows: countValue(counts.article_revision_overlong_body_rows),
    translationBodyRows: countValue(counts.translation_body_rows),
    rawBodyFieldArticles: mappedArticles.filter((article) => (article.boundaryViolations as string[]).includes("raw-body-field-present")).length,
    overlongExcerptRows: countValue(counts.overlong_excerpt_rows),
  };
  const boundaries = {
    leadsInFactArticles: countValue(counts.fact_article_links),
    leadsInStorySignals: countValue(counts.story_signals),
    leadAnalyses: countValue(counts.analyses),
    leadPublicationRows: countValue(counts.publication_rows),
    leadPublicPublicationRows: countValue(counts.public_publication_rows),
    leadWithdrawnPublicationRows: countValue(counts.withdrawn_publication_rows),
    leadsWithBodyOrOverlongExcerpt: bodyLeakArticles,
    bodyLeakCounts,
    note: "This source is isolated; evidence output contains only allow-listed metadata. The generator never serializes article body fields or the raw JSON object. A revision row whose body_text equals the article excerpt is a short metadata snapshot written by the collector's fallback when the article_revisions.excerpt column is absent; it is listed separately and is not counted as a stored article body.",
  };
  const checks = buildVerificationChecks({
    source: { enabled: snapshot.source.enabled, participationMode: snapshot.source.participation_mode, intervalMinutes: snapshot.source.interval_minutes },
    officialCounts: families, baseline: args.baseline,
    boundaries: {
      factArticleLinks: boundaries.leadsInFactArticles, storySignals: boundaries.leadsInStorySignals,
      analyses: boundaries.leadAnalyses, publicPublicationRows: boundaries.leadPublicPublicationRows,
      bodyLeakArticles: boundaries.leadsWithBodyOrOverlongExcerpt,
    },
    http: { webStatus: web.status, apiStatus: api.status },
    announcementWorker: status.announcementWorker, expectNoWorker: args.expectNoWorker,
  });

  const sourceConfig = asObject(snapshot.source.config);
  const latestDiagnostics = snapshot.runs.length ? sanitizeDiagnostics(snapshot.runs[snapshot.runs.length - 1]!.detail) : {};
  const report = {
    evidenceVersion: 1,
    generatedAt: new Date().toISOString(),
    timezone: "Asia/Shanghai",
    mode: "read-only-live-snapshot",
    source: mapSource(snapshot.source),
    schedule: {
      intervalMinutes: snapshot.source.interval_minutes,
      nextFetchAt: iso(snapshot.source.next_fetch_at),
      mechanism: "Existing sources.interval_minutes + private AMZ123 queue; generator does not start or schedule a worker.",
      announcementWorker: status.announcementWorker,
      jobRuns: snapshot.jobRuns.map((row) => ({ job: row.job, status: row.status, startedAt: iso(row.started_at), finishedAt: iso(row.finished_at), error: cleanError(row.error) })),
    },
    runs: snapshot.runs.map(mapRun),
    leads: mappedArticles,
    policyStatistics: {
      note: "Counts are computed from sources.tags and distinct articles in the live database.",
      families: [
        { family: "ads_policy", n: countValue(snapshot.families.ads_policy) },
        { family: "external_regulation", n: countValue(snapshot.families.external_regulation) },
        { family: "other", n: countValue(snapshot.families.other) },
        { family: "platform_policy", n: countValue(snapshot.families.platform_policy) },
      ],
      officialBefore: args.baseline,
      officialCountsUnchanged: FAMILY_KEYS.every((key) => args.baseline[key] === families[key]),
    },
    boundaries,
    permissions: {
      robotsUrl: "https://www.amz123.com/robots.txt",
      approvedPaths: Array.isArray(sourceConfig.allowUrlPrefixes) ? sourceConfig.allowUrlPrefixes : null,
      expectedPathsForThisIntegration: EXPECTED_PATHS,
      excludedPaths: EXCLUDED_PATHS,
      robotsFromLatestRun: asObject(latestDiagnostics).robots ?? null,
      enforcedInCode: "packages/backend/src/sources/amz123.ts (robots gate is checked before every request)",
      bodyStorage: "not selected into the evidence output; only null flags and lengths are queried",
    },
    runtime: {
      http: { web3000: web, api3001: api },
      radarOpsStatus: status,
      note: "Runtime status is observational only. This script does not start, stop, or restart workers.",
    },
    checks,
  };

  await mkdir(path.dirname(output), { recursive: true });
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (args.force) await writeFile(output, serialized, "utf8");
  else await writeFile(output, serialized, { encoding: "utf8", flag: "wx" });

  const failed = checks.filter((check) => check.status === "fail");
  const unverified = checks.filter((check) => check.status === "unverified");
  console.log(JSON.stringify({
    output: path.relative(ROOT, output),
    sourceId: SOURCE_ID,
    leadCount: mappedArticles.length,
    officialCounts: families,
    boundaries: {
      factArticleLinks: boundaries.leadsInFactArticles,
      storySignals: boundaries.leadsInStorySignals,
      analyses: boundaries.leadAnalyses,
      publicPublicationRows: boundaries.leadPublicPublicationRows,
      bodyLeakArticles: boundaries.leadsWithBodyOrOverlongExcerpt,
    },
    web: web.status, api: api.status, announcementWorker: status.announcementWorker,
    checksPassed: checks.filter((check) => check.status === "pass").length,
    checksFailed: failed.length, checksUnverified: unverified.length,
  }, null, 2));

  if (failed.length || unverified.length) process.exitCode = 2;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try { await main(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
