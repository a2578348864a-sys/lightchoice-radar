// First-sample backfill of the Chinese policy explanation (radar-explain-v1) for a bounded whitelist
// of article ids.
//
// Why this exists: explanations are normally assembled inside the worker's analysis job
// (editorial/analyze.ts → editorial/policy-explain.ts) and stored in that judgement's `output`. The
// content worker that runs those jobs is currently stopped, and this task does not authorise starting
// it, so the already-stored articles would show no explanation until it runs again. This script writes
// exactly the same object the analysis job writes — same builder, same fields, same downgrade guard —
// into the existing analyses.output storage. No table, column, migration, publication field, eligibility
// flag, source configuration or manual verification record is touched.
//
// Usage:
//   node --env-file=.env scripts/radar-explain-backfill.ts --ids <id,id>          # dry run (reads only)
//   node --env-file=.env scripts/radar-explain-backfill.ts --ids <id,id> --apply  # write + snapshot
//
// Safety rules enforced before any write:
//   1. Only the ids passed on the command line are considered (the caller's whitelist, max 12).
//   2. The article must belong to an official/regulatory source of the first lane, and a rule analysis
//      of the article's *current* revision must exist (an explanation always names its input version).
//   3. A complete explanation of the same revision is never replaced by an incomplete one.
//   4. The write is a compare-and-swap on the exact stored output; a concurrent change aborts that id.
//   5. Every write is snapshotted under .data/_diag/ before it happens (before/after, per id).
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { buildPolicyExplanation, keepCompleteExplanation } from "@aihot/backend/editorial/policy-explain";
import { summarizeRadarPolicy } from "@aihot/backend/editorial/radar-rules";

/** The first lane's official/regulatory sources: AMZ123 leads are read-only in this task. */
const ALLOWED_SOURCES = new Set([
  "amazon-us-announcements",
  "amazon-us-fee-updates",
  "rss-cpsc-recalls",
  "us-federal-register-cpsc",
  "us-federal-register-ftc",
]);
const MAX_IDS = 12;

const args = process.argv.slice(2);
const idsArg = args[args.indexOf("--ids") + 1] ?? "";
const apply = args.includes("--apply");
const ids = [...new Set(idsArg.split(",").map((id) => id.trim()).filter(Boolean))];

if (!ids.length || ids.some((id) => !/^[a-zA-Z0-9_-]{1,80}$/.test(id))) {
  console.error("用法：radar-explain-backfill.ts --ids <id,id,…> [--apply]");
  process.exit(1);
}
if (ids.length > MAX_IDS) {
  console.error(`白名单最多 ${MAX_IDS} 个文章 ID，当前 ${ids.length} 个：拒绝执行`);
  process.exit(1);
}

type Row = {
  id: string; source_id: string; revision: number; title: string; url: string;
  published_at: Date | null; publication_time: string | null; source_updated_at: Date | null; discovered_at: Date | null;
  body_text: string | null; excerpt: string | null; body_status: string;
  source_name: string; source_kind: string; source_tags: string[];
};

const snapshotDir = path.join(REPO_ROOT, ".data", "_diag");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
let wrote = 0;
let skipped = 0;

for (const id of ids) {
  const [row] = await sql<Row[]>`
    SELECT a.id, a.source_id, a.revision, a.title, a.url, a.published_at, a.publication_time, a.source_updated_at,
      a.discovered_at, a.body_text, a.excerpt, a.body_status,
      s.name AS source_name, s.kind AS source_kind, s.tags AS source_tags
    FROM articles a JOIN sources s ON s.id = a.source_id WHERE a.id = ${id}`;
  if (!row) { console.error(`✗ ${id}：文章不存在`); skipped++; continue; }
  if (!ALLOWED_SOURCES.has(row.source_id)) { console.error(`✗ ${id}：来源 ${row.source_id} 不在本轮白名单来源内`); skipped++; continue; }

  const [analysis] = await sql<{ id: number; tags: string[]; output: Record<string, unknown> }[]>`
    SELECT id, tags, output FROM analyses
    WHERE article_id = ${id} AND origin = 'rule' AND input_revision = ${row.revision}
    ORDER BY id DESC LIMIT 1`;
  if (!analysis) { console.error(`✗ ${id}：当前版本（${row.revision}）没有规则分析记录，拒绝写入`); skipped++; continue; }

  const evidence = Array.isArray(analysis.output?.ruleEvidence)
    ? (analysis.output.ruleEvidence as Array<{ ruleId: string; label: string; field: "title" | "excerpt" | "body"; matchedText: string; context?: string; start?: number; end?: number }>)
        .map(({ ruleId, label, field, matchedText }) => ({ ruleId, label, field, matchedText }))
    : [];
  const explanation = buildPolicyExplanation({
    revision: row.revision, title: row.title, url: row.url, publishedAt: row.published_at,
    publicationTime: row.publication_time, sourceUpdatedAt: row.source_updated_at, discoveredAt: row.discovered_at,
    bodyText: row.body_text, excerpt: row.excerpt, bodyStatus: row.body_status,
    source: { name: row.source_name, kind: row.source_kind, tags: row.source_tags },
    tags: analysis.tags ?? [], ruleEvidence: evidence,
    hasRuleSummary: summarizeRadarPolicy({ bodyText: row.body_text }) !== null,
    translationZh: null,
  });
  if (!explanation) { console.error(`✗ ${id}：没有可解释的材料`); skipped++; continue; }

  const prior = (analysis.output?.explanation ?? null) as ReturnType<typeof buildPolicyExplanation>;
  const merged = keepCompleteExplanation(prior, explanation);
  const ruleSummary = summarizeRadarPolicy({ bodyText: row.body_text }) !== null;
  const unchanged = !!prior && JSON.stringify(prior) === JSON.stringify(merged)
    && (analysis.output?.ruleSummary ?? null) === ruleSummary;

  console.log(`${unchanged ? "=" : apply ? "→" : "~"} ${id}（${row.source_id}，版本 ${row.revision}）`);
  console.log(`    一句话：${explanation.oneLiner}`);
  console.log(`    覆盖：${explanation.complete ? "完整" : "部分（仅标题）"}；日期 ${explanation.keyDates.length} 条；待确认 ${explanation.pending.length} 条；检查：${explanation.checks.join("、") || "无"}`);
  if (unchanged) { console.log("    无变更，跳过"); continue; }
  if (!apply) { console.log("    （dry run，未写入）"); continue; }

  const after = { ...analysis.output, ruleSummary, explanation: merged };
  mkdirSync(snapshotDir, { recursive: true });
  const snapshot = path.join(snapshotDir, `radar-explain-backfill-${stamp}-${id}.json`);
  writeFileSync(snapshot, `${JSON.stringify({ id, analysisId: analysis.id, inputRevision: row.revision, before: analysis.output, after }, null, 2)}\n`, "utf8");

  const changed = await sql`
    UPDATE analyses SET output = ${sql.json(after)}
    WHERE id = ${analysis.id} AND output IS NOT DISTINCT FROM ${sql.json(analysis.output as never)}
    RETURNING id`;
  if (!changed.length) {
    console.error(`    ✗ 并发冲突：该分析记录在读取后被修改，已放弃（快照保留：${snapshot}）`);
    skipped++;
    continue;
  }
  wrote++;
  console.log(`    ✓ 已写入，快照：${snapshot}`);
}

console.log(`\n完成：写入 ${wrote} 条，跳过/拒绝 ${skipped} 条（共 ${ids.length} 个 ID）`);
await closeDb();
process.exit(skipped ? 1 : 0);
