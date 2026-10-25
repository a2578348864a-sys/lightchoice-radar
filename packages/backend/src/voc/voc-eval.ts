// The acceptance-metrics path for the frozen evaluation samples (no model, no network).
//
// When an authorised real L2 run has produced results, this computes the evaluation metrics over
// the pre-fixed denominator — the frozen sample set — from what is actually stored: format
// validity, citation validity against the licensed context, polarity agreement with the
// deterministic L1, and the per-difficulty-class breakdown. With no stored L2 results it refuses
// with a count of zero instead of inventing quality numbers: real quality stays NOT_RUN until a
// real, authorised model run exists, and the frozen denominator never moves after the fact.
import { sql } from "../db.ts";
import { buildL2Context } from "./voc-l2l3.ts";

export interface VocEvalSampleRow {
  articleId: string;
  difficulty: string;
  hasL2: boolean;
  /** L2 exists but was produced from an older evidence revision — not evaluated. */
  stale: boolean;
  formatOk: boolean;
  citationValid: boolean;
  polarityMismatch: boolean;
  serious: boolean;
}

export interface VocEvalMetrics {
  evalKey: string;
  samples: number;
  withL2: number;
  stale: number;
  formatOk: number;
  citationValid: number;
  polarityMismatch: number;
  seriousCount: number;
  /** Distinct modelIds behind the evaluated results — a reviewer sees whether these came from a
      real model run or from test fixtures; no real run means no real-quality claim. */
  modelIds: string[];
  /** Results flagged partial at processing time (licensed context had gaps). */
  partial: number;
  perClass: Record<string, { total: number; withL2: number; formatOk: number }>;
  note: string;
}

const EVAL_NOTE =
  "指标只统计冻结样本上已存储且版本未过期的 L2 结果；真实研究质量结论必须在材料外发与费用窗口获准后的真实模型运行中产生。";

export async function evaluateVocEvalSet(evalKey = "grinder-v1"): Promise<{ status: "processed" | "refused"; reason?: string; metrics?: VocEvalMetrics }> {
  const [set] = await sql<{ value: { frozen?: Array<{ articleId: string; difficulty?: string }> } }[]>`
    SELECT value FROM settings WHERE key = ${`voc.eval.${evalKey}`}`;
  const frozen = set?.value?.frozen ?? [];
  if (!frozen.length) return { status: "refused", reason: `eval set voc.eval.${evalKey} missing or empty` };

  const rows: VocEvalSampleRow[] = [];
  const evaluated: Array<{ modelId?: string; partial?: boolean }> = [];
  const perClass: VocEvalMetrics["perClass"] = {};
  for (const sample of frozen) {
    const cls = sample.difficulty ?? "未分类";
    perClass[cls] ??= { total: 0, withL2: 0, formatOk: 0 };
    perClass[cls]!.total += 1;
    const [article] = await sql<{ revision: number; voc: { l2?: { inputRevision: number; quality: string; modelId?: string; partial?: boolean; result: { chineseSummary?: string; citationIds?: number[]; experienceType?: string } }; thread?: Parameters<typeof buildL2Context>[0]; contentLicense?: string; l1?: { polarity?: string } } | undefined }[]>`
      SELECT revision, raw->'voc' AS voc FROM articles WHERE id = ${sample.articleId}`;
    const voc = article?.voc;
    const l2 = voc?.l2;
    const hasL2 = !!l2 && l2.quality !== "failed";
    const stale = hasL2 && l2!.inputRevision !== article!.revision;
    const row: VocEvalSampleRow = {
      articleId: sample.articleId,
      difficulty: cls,
      hasL2,
      stale,
      formatOk: false,
      citationValid: false,
      polarityMismatch: false,
      serious: true,
    };
    if (hasL2 && !stale && l2!.result) {
      const r = l2!.result;
      // Format: the structured fields a downstream reader depends on, present and non-empty.
      row.formatOk = typeof r.chineseSummary === "string" && r.chineseSummary.trim().length >= 20
        && Array.isArray(r.citationIds) && r.citationIds.length > 0;
      // Citations must point into the licensed context that was actually sent for THIS record.
      if (voc?.thread) {
        const context = buildL2Context(voc.thread, !!voc.contentLicense);
        row.citationValid = r.citationIds?.every((id) => context.contextIds.includes(id)) ?? false;
      }
      // Polarity agreement with the deterministic layer — the same rule the ingest enforces.
      const l1Polarity = voc?.l1?.polarity;
      row.polarityMismatch = !!l1Polarity && l1Polarity !== "unknown" && l1Polarity !== "mixed"
        && !!r.experienceType && r.experienceType !== "unknown" && r.experienceType !== "mixed"
        && ((l1Polarity === "negative") !== (r.experienceType === "negative"));
      row.serious = !row.formatOk || !row.citationValid || row.polarityMismatch;
      evaluated.push({ modelId: l2!.modelId, partial: l2!.partial });
      perClass[cls]!.withL2 += 1;
      if (row.formatOk) perClass[cls]!.formatOk += 1;
    }
    rows.push(row);
  }

  const metrics: VocEvalMetrics = {
    evalKey,
    samples: frozen.length,
    withL2: rows.filter((r) => r.hasL2 && !r.stale).length,
    stale: rows.filter((r) => r.stale).length,
    formatOk: rows.filter((r) => r.hasL2 && !r.stale && r.formatOk).length,
    citationValid: rows.filter((r) => r.hasL2 && !r.stale && r.citationValid).length,
    polarityMismatch: rows.filter((r) => r.hasL2 && !r.stale && r.polarityMismatch).length,
    seriousCount: rows.filter((r) => r.hasL2 && !r.stale && r.serious).length,
    modelIds: [...new Set(evaluated.map((r) => r.modelId ?? "(unknown)"))],
    partial: evaluated.filter((r) => r.partial).length,
    perClass,
    note: EVAL_NOTE,
  };
  return { status: "processed", metrics };
}
