// The third lane's private read layer: the six areas the /voc pages need, plus the export.
//
// Every query filters on revokedBy IS NULL and re-checks the record's effective uses against its
// batches — a record stored under a licence that no longer covers export never reaches the export.
// Nothing here calls a model or a source; pages read stored results only.
import type { VocThreadView } from "@aihot/contracts/site";
import { sql } from "../db.ts";
import { effectiveUses, loadBatches, loadStudies, type VocBatch, type VocRecord, type VocStudy } from "./voc-model.ts";
import { seAttribution } from "./voc-stackexchange.ts";
import { stripTags } from "../lib/text.ts";

export interface VocEvidenceItem {
  id: string;
  title: string;
  url: string;
  publishedAt: string | null;
  sourceId: string;
  form: string;
  authorRole: string;
  market: string;
  l1Categories: string[];
  l1Polarity: string;
  language: string;
  answerCount: number;
  resolution: string;
  batches: string[];
  licensedUses: string[];
  reviewStatus: string;
  reviewNote: string | null;
  attribution: string | null;
  excerpt: string;
  l2?: VocRecord["l2"];
  /** The question's own licence as the API returned it; null = unverified, excluded from export. */
  contentLicense: string | null;
  thread?: VocThreadView;
}

interface EvidenceRow {
  id: string;
  title: string;
  url: string;
  published_at: Date | null;
  source_id: string;
  raw: { voc: VocRecord };
  excerpt: string | null;
}

function mapEvidence(row: EvidenceRow, batchesById: Map<string, VocBatch>): VocEvidenceItem {
  const v = row.raw.voc;
  const uses = effectiveUses(v, batchesById);
  const resolution = v.thread
    ? (v.thread.askerFollowUp === undefined ? "undetermined" : /(worked|solved|fixed|it works)/i.test(v.thread.askerFollowUp) && !/(didn.?t work|still)/i.test(v.thread.askerFollowUp) ? "solved-candidate" : "unsolved-or-undetermined")
    : "undetermined";
  const threadView: VocThreadView | undefined = v.thread ? {
    questionId: v.thread.questionId,
    title: v.thread.title,
    body: v.thread.body,
    tags: v.thread.tags,
    answers: v.thread.answers.map((a) => ({ id: a.id, score: a.score, isAccepted: a.isAccepted, body: a.body, contentLicense: a.contentLicense ?? null, comments: a.comments.map((c) => ({ id: c.id, body: c.body, contentLicense: c.contentLicense ?? null })) })),
    comments: v.thread.comments.map((c) => ({ id: c.id, body: c.body, contentLicense: c.contentLicense ?? null })),
    askerFollowUp: v.thread.askerFollowUp,
    attribution: seAttribution(v.thread, "coffee.stackexchange"),
  } : undefined;
  return {
    id: row.id,
    title: row.title,
    url: row.url,
    publishedAt: row.published_at?.toISOString() ?? null,
    sourceId: row.source_id,
    form: v.form,
    thread: threadView,
    authorRole: v.authorRole,
    market: v.market,
    l1Categories: v.l1?.categories ?? [],
    l1Polarity: v.l1?.polarity ?? "unknown",
    language: v.l1?.language ?? "unknown",
    answerCount: v.thread?.answers.length ?? 0,
    resolution,
    batches: v.batches,
    licensedUses: [...uses],
    reviewStatus: v.review?.status ?? "pending",
    reviewNote: v.review?.note ?? null,
    attribution: v.thread ? seAttribution(v.thread, "coffee.stackexchange") : null,
    excerpt: (row.excerpt ?? v.thread?.body ?? "").slice(0, 400),
    l2: v.l2,
    contentLicense: v.contentLicense ?? null,
  };
}

export interface VocEvidenceQuery {
  studyId?: string | null;
  category?: string | null;
  polarity?: string | null;
  q?: string | null;
}

/** Area 2 — the evidence library: non-revoked records, filters, licence and review state per row. */
export async function loadVocEvidence(query: VocEvidenceQuery = {}, limit = 100): Promise<{ items: VocEvidenceItem[]; studies: VocStudy[]; batches: VocBatch[] }> {
  const batches = await loadBatches();
  const batchesById = new Map(batches.map((b) => [b.id, b]));
  const q = query.q?.trim().slice(0, 80);
  const rows = await sql<EvidenceRow[]>`
    SELECT id, title, url, published_at, source_id, raw, left(body_text, 400) AS excerpt FROM articles
    WHERE raw->'voc' IS NOT NULL AND raw->'voc'->>'revokedBy' IS NULL
      AND (${query.studyId ?? null}::text IS NULL OR raw->'voc'->'studyIds' ? ${query.studyId ?? ""})
      AND (${query.category ?? null}::text IS NULL OR raw->'voc'->'l1'->'categories' ? ${query.category ?? ""})
      AND (${query.polarity ?? null}::text IS NULL OR raw->'voc'->'l1'->>'polarity' = ${query.polarity ?? ""})
      AND (${q ?? null}::text IS NULL OR title ILIKE '%' || ${q ?? ""} || '%')
    ORDER BY coalesce(published_at, discovered_at) DESC LIMIT ${limit}`;
  return { items: rows.map((r) => mapEvidence(r, batchesById)), studies: await loadStudies(), batches };
}

/** Area 1 — the overview: material counts, coverage, recent issues, chinese state, per study. */
export async function loadVocOverview(): Promise<{
  studies: Array<VocStudy & { materials: number; pendingReview: number; painThemes: number }>;
  totals: { materials: number; revoked: number; chineseL1: number; chineseL2: number; modelLane: string };
}> {
  const studies = await loadStudies();
  const out = [];
  for (const study of studies) {
    const [m] = await sql<{ materials: number; pending: number }[]>`
      SELECT count(*) FILTER (WHERE raw->'voc'->>'revokedBy' IS NULL)::int AS materials,
             count(*) FILTER (WHERE raw->'voc'->'review'->>'status' = 'pending')::int AS pending
      FROM articles WHERE raw->'voc'->'studyIds' ? ${study.id}`;
    const [p] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM stories WHERE frame->>'lane' = 'voc' AND merged_into IS NULL`;
    out.push({ ...study, materials: m?.materials ?? 0, pendingReview: m?.pending ?? 0, painThemes: p?.n ?? 0 });
  }
  const [t] = await sql<{ materials: number; revoked: number; l1: number; l2: number }[]>`
    SELECT count(*) FILTER (WHERE raw->'voc'->>'revokedBy' IS NULL)::int AS materials,
           count(*) FILTER (WHERE raw->'voc'->>'revokedBy' IS NOT NULL)::int AS revoked,
           count(*) FILTER (WHERE raw->'voc'->'l1' IS NOT NULL AND raw->'voc'->>'revokedBy' IS NULL)::int AS l1,
           count(*) FILTER (WHERE raw->'voc'->'l2' IS NOT NULL AND raw->'voc'->>'revokedBy' IS NULL)::int AS l2
    FROM articles WHERE raw->'voc' IS NOT NULL`;
  return {
    studies: out,
    totals: {
      materials: t?.materials ?? 0, revoked: t?.revoked ?? 0, chineseL1: t?.l1 ?? 0, chineseL2: t?.l2 ?? 0,
      modelLane: "closed (¥0 authorisation)",
    },
  };
}

/** Areas 3 & 4 — pain themes and hypotheses, from the stories/facts the grouping wrote. */
export async function loadVocPains(studyId?: string | null) {
  const stories = await sql<{ id: number; title: string; frame: Record<string, string>; first_report_at: Date; latest_at: Date; facts: number; articles: number }[]>`
    SELECT st.id, st.title, st.frame, st.first_report_at, st.latest_at,
      (SELECT count(*)::int FROM facts f WHERE f.story_id = st.id) AS facts,
      (SELECT count(DISTINCT fa.article_id)::int FROM fact_articles fa WHERE fa.fact_id IN (SELECT id FROM facts WHERE story_id = st.id)) AS articles
    FROM stories st WHERE st.frame->>'lane' = 'voc' AND st.merged_into IS NULL
    ORDER BY st.latest_at DESC LIMIT 100`;
  return { stories: stories.map((s) => ({ ...s, firstReportAt: s.first_report_at?.toISOString() ?? null, latestAt: s.latest_at?.toISOString() ?? null })), studyId };
}

/** Area 5 — history: arrivals, revisions, revocations and review changes, newest first. */
export async function loadVocHistory(days = 30) {
  const events = await sql<{ kind: string; at: Date; detail: string }[]>`
    SELECT 'arrival' AS kind, discovered_at AS at, left(title, 80) AS detail FROM articles
      WHERE raw->'voc' IS NOT NULL AND discovered_at > now() - (${days} || ' days')::interval
    UNION ALL
    SELECT 'revoked' AS kind, updated_at AS at, '批次撤销：' || coalesce(raw->'voc'->>'revokedBy','') FROM articles
      WHERE raw->'voc'->>'revokedBy' IS NOT NULL AND updated_at > now() - (${days} || ' days')::interval
    UNION ALL
    SELECT 'review:' || coalesce(raw->'voc'->'review'->>'status','pending') AS kind, updated_at AS at, left(title, 80) FROM articles
      WHERE raw->'voc'->'review'->>'decidedAt' IS NOT NULL AND updated_at > now() - (${days} || ' days')::interval
    ORDER BY at DESC LIMIT 200`;
  return events.map((e) => ({ kind: e.kind, at: e.at.toISOString(), detail: e.detail }));
}

/** Area 6 — sources & diagnostics: per-source method, licence, state, last success, failures. */
export async function loadVocSources() {
  const sources = await sql<{ id: string; name: string; enabled: boolean; health: string; fail_count: number; last_ok_at: Date | null; last_error: string | null; config: Record<string, unknown> }[]>`
    SELECT id, name, enabled, health, fail_count, last_ok_at, last_error, config FROM sources WHERE id LIKE 'voc-%' ORDER BY id`;
  const batches = await loadBatches();
  const runs = await sql<{ source_id: string; status: string; n: number }[]>`
    SELECT source_id, status, count(*)::int AS n FROM fetch_runs WHERE source_id LIKE 'voc-%' GROUP BY 1, 2`;
  return { sources, batches, runs };
}

/** The research export: licensed, non-revoked evidence with attribution — CC BY-SA honoured. */
export async function exportVocMarkdown(studyId: string): Promise<string> {
  const { items } = await loadVocEvidence({ studyId });
  const studies = await loadStudies();
  const study = studies.find((s) => s.id === studyId);
  const lines = ["# 消费者原声 · 研究导出", "", `- 研究任务：${study?.name ?? studyId}`, `- 导出时间：${new Date().toISOString()}`, `- 逐条材料按自身许可导出：正文仅含许可明确的材料并附署名与原文链接；许可缺失的材料保留关系条目、不输出受限正文。`, ""];
  let exportedThreads = 0;
  let excludedQuestionBodies = 0;
  let excludedAnswers = 0;
  let excludedComments = 0;
  let includedAnswers = 0;
  let includedComments = 0;
  for (const item of items) {
    if (!item.licensedUses.includes("export")) continue;
    exportedThreads += 1;
    const thread = item.thread;
    lines.push(`## ${item.title}`, "");
    lines.push(`- 来源：${item.sourceId} · ${item.publishedAt?.slice(0, 10) ?? "日期未知"} · 形态 ${item.form} · 角色 ${item.authorRole}`);
    lines.push(`- 原文：${item.url}`);
    lines.push(`- L1 分类：${item.l1Categories.join("、") || "未归类"} · 极性 ${item.l1Polarity} · 解决状态 ${item.resolution}`);
    lines.push(`- 人工审核：${item.reviewStatus}`);
    // The question's OWN licence decides its body. A missing licence never inherits the batch's.
    if (thread && item.contentLicense) {
      lines.push(`- 问题许可：${item.contentLicense}`);
      lines.push(`- 问题正文：${stripTags(thread.body ?? "").slice(0, 800)}`);
    } else {
      excludedQuestionBodies += 1;
      lines.push(`- 问题正文：未导出（许可待核实，不继承批次或父级）`);
    }
    if (thread) {
      for (const a of thread.answers) {
        if (a.contentLicense) {
          includedAnswers += 1;
          lines.push(`- 回答 [${a.contentLicense}](https://coffee.stackexchange.com/a/${a.id})：${stripTags(a.body ?? "").slice(0, 600)}${a.isAccepted ? "（提问者采纳）" : ""}`);
        } else {
          excludedAnswers += 1;
        }
        for (const c of a.comments) {
          if (c.contentLicense) {
            includedComments += 1;
            lines.push(`  - 回答评论 [${c.contentLicense}]：${stripTags(c.body ?? "").slice(0, 300)}`);
          } else {
            excludedComments += 1;
          }
        }
      }
      for (const c of thread.comments) {
        if (c.contentLicense) {
          includedComments += 1;
          lines.push(`- 问题评论 [${c.contentLicense}]：${stripTags(c.body ?? "").slice(0, 300)}`);
        } else {
          excludedComments += 1;
        }
      }
    }
    lines.push("");
  }
  lines.push("---", "", `导出讨论串 ${exportedThreads} 条；回答正文 ${includedAnswers} 条导出 / ${excludedAnswers} 条许可缺失未导出；评论 ${includedComments} 条导出 / ${excludedComments} 条许可缺失未导出；问题正文 ${excludedQuestionBodies} 条许可待核实未导出。候选结论未经人工确认不构成已证实需求。`);
  return lines.join("\n");
}
