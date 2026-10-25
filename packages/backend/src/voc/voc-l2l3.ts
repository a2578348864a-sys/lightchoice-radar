// The third lane's L2 (Chinese understanding) and L3 (pain/hypothesis research) processing.
//
// The gates, in order, before ANY network call:
//   1. Lane valve (config.vocModelEnabled — ¥0 authorisation state).
//   2. Per-material modelSend: the record's effective batch uses must include "modelSend".
//   3. Budget window: reserveVocCall refuses on absent/expired/exhausted window.
// Only after all three does a request reach the provider. Every result is bound to the evidence
// revision it was produced from; a revision change invalidates reuse. Context sent to the model
// includes only materials whose own licence is known — unknown-licence material is withheld and
// the result is marked partial.
import { sql } from "../db.ts";
import { config } from "../config.ts";
import { chatJson } from "../providers/llm.ts";
import { z } from "zod";
import { sha256 } from "../lib/ids.ts";
import { stripTags } from "../lib/text.ts";
import { claimVocRun, releaseVocRun, reserveVocCall, settleVocCall, vocBudgetState } from "./voc-budget.ts";
import { effectiveUses, loadBatches, type VocL2Stored, type VocRecord, type VocThread } from "./voc-model.ts";
import { resolutionStatusOf } from "./voc-stackexchange.ts";

export const VOC_L2_PROMPT_VERSION = "voc-l2-v1";
export const VOC_L3_PROMPT_VERSION = "voc-l3-v2"; // v2: sampleLimits states provenance from each record's actual source, not a hardcoded lane.
export const VOC_TITLE_LANG = "zh-voc";

const L2Output = z.object({
  product: z.string().nullable(),
  model: z.string().nullable(),
  scenario: z.string().nullable(),
  viewpointType: z.enum(["firsthand", "question", "hearsay", "agency", "unknown"]),
  experienceType: z.enum(["positive", "negative", "neutral", "mixed", "unknown"]),
  chineseSummary: z.string().min(20),
  positiveSignals: z.array(z.string()),
  negativeSignals: z.array(z.string()),
  existingSolutions: z.array(z.string()),
  resolutionStatus: z.enum(["solved-candidate", "unsolved", "undetermined"]),
  uncertainties: z.array(z.string()),
  citationIds: z.array(z.number()),
});

const L3Output = z.object({
  hypotheses: z.array(z.object({
    statement: z.string().min(10),
    basis: z.enum(["原文直接支持", "根据原文合理推断", "证据不足的待验证假设"]),
    supportingArticleIds: z.array(z.string()),
    existingSolutions: z.array(z.string()),
    solutionsVerified: z.enum(["已证实", "有建议但效果未获确认", "未见解决方法"]),
    counterEvidence: z.string().nullable(),
    worthResearch: z.boolean(),
    reason: z.string(),
  })).max(5),
  sampleLimits: z.string().min(10),
});

/** Evidence ids actually placed into the model context — the only ids a citation may reference. */
export interface VocContext {
  system: string;
  user: string;
  contextIds: number[];
  inputChars: number;
  partial: boolean;
  partialReason: string | null;
}

const SYSTEM = `你是跨境电商行业的研究助理，负责把英文消费者讨论准确解释为中文。规则：只使用给定材料中的信息；保留材料中的数字、型号与否定表述；区分提问咨询、第一手使用经历与转述；接受答案不等于问题已解决；不得编造材料中没有的痛点或数据；涉及判断需引用材料编号（如 [Q 71001]、[A 71002]）。用中文回答，产品名与型号可保留英文。`;

/** Builds the minimal licensed context for one thread. Unknown-licence material is withheld. */
export function buildL2Context(thread: VocThread, questionLicensed: boolean): VocContext {
  const parts: string[] = [];
  const ids: number[] = [];
  let partial = false;
  let partialReason: string | null = null;
  if (questionLicensed) {
    parts.push(`[Q ${thread.questionId}] ${thread.title}\n${stripTags(thread.body).slice(0, 1500)}`);
    ids.push(thread.questionId);
  } else {
    partial = true;
    partialReason = "问题正文许可未知，未纳入模型上下文";
  }
  const answers = [...thread.answers].sort((a, b) => (b.isAccepted ? 1 : 0) - (a.isAccepted ? 1 : 0) || b.score - a.score).slice(0, 4);
  for (const a of answers) {
    if (a.contentLicense) {
      parts.push(`[A ${a.id}]（${a.isAccepted ? "提问者采纳" : "回答"}，${a.score} 票）\n${stripTags(a.body).slice(0, 800)}`);
      ids.push(a.id);
    } else {
      partial = true;
      partialReason = partialReason ?? "部分回答许可未知，未纳入模型上下文";
    }
  }
  const comments = [...thread.comments, ...thread.answers.flatMap((a) => a.comments)].slice(0, 6);
  for (const c of comments) {
    if (c.contentLicense) {
      parts.push(`[C ${c.id}] ${stripTags(c.body).slice(0, 250)}`);
      ids.push(c.id);
    }
  }
  if (thread.askerFollowUp) parts.push(`[提问者后续] ${stripTags(thread.askerFollowUp).slice(0, 300)}`);
  const user = `以下是编号标注的消费者讨论材料（json）：\n${parts.join("\n\n")}\n\n请返回 JSON：{"product": 品类或null, "model": 具体型号或null, "scenario": 使用场景或null, "viewpointType": "firsthand|question|hearsay|agency|unknown", "experienceType": "positive|negative|neutral|mixed|unknown", "chineseSummary": 2-4句中文解释（发生了什么/涉及什么产品与场景/为什么值得注意）, "positiveSignals": [], "negativeSignals": [], "existingSolutions": 已有解决方法[], "resolutionStatus": "solved-candidate|unsolved|undetermined", "uncertainties": 尚不能确定的信息[], "citationIds": 支撑判断的材料编号[]}`;
  const userText = `${user}\n${parts.join("\n\n")}`;
  return { system: SYSTEM, user: userText, contextIds: ids, inputChars: SYSTEM.length + userText.length, partial, partialReason };
}

/** Numbers the output mentions must exist in the source text (no invented statistics). */
function inventedNumbers(sourceText: string, output: string): string[] {
  const tokens = (text: string) => new Set((text.match(/\d+(?:\.\d+)?(?:%|ml|mm|g|oz|lb|磅|年|个月|个月|天|日)/gi) ?? []).map((t) => t.toLowerCase()));
  const src = tokens(sourceText);
  return [...tokens(output)].filter((t) => !src.has(t));
}

/** Processes one record's L2. Returns the gate verdict when refused, the stored result when done. */
export async function processVocL2(articleId: string): Promise<{ status: "refused" | "reused" | "processed" | "failed"; reason?: string; l2?: VocL2Stored }> {
  // Gate 1: lane valve (¥0 authorisation state).
  if (!config.vocModelEnabled) return { status: "refused", reason: "voc 模型通道关闭（第三主线模型费用授权为 ¥0；需独立预算窗口）" };
  const [row] = await sql<{ id: string; revision: number; raw: { voc: VocRecord }; title: string }[]>`SELECT id, revision, raw, title FROM articles WHERE id = ${articleId}`;
  const record = row?.raw?.voc;
  if (!record?.thread) return { status: "refused", reason: "not a voc thread record" };
  if (record.revokedBy) return { status: "refused", reason: "record revoked" };
  // Gate 2: per-material modelSend — the record's effective batch uses must license it.
  const batches = await loadBatches();
  const uses = effectiveUses(record, new Map(batches.map((b) => [b.id, b])));
  if (!uses.has("modelSend")) return { status: "refused", reason: "当前批次未授权 modelSend：CC BY-SA 材料的模型外发许可尚未核实（缺一不可门禁之二）" };
  // Reuse: same evidence revision + model + mode + prompt version → stored result without a call.
  const modelId = config.voc.round ? `${config.voc.round}:${"deepseek-flash"}` : "deepseek-flash";
  const modelMode = "thinking-disabled";
  if (record.l2 && record.l2.inputRevision === row!.revision && record.l2.modelId === modelId && record.l2.modelMode === modelMode && record.l2.promptVersion === VOC_L2_PROMPT_VERSION && record.l2.quality !== "failed") {
    return { status: "reused", l2: record.l2 };
  }
  // Context: only known-licence material is sent.
  const context = buildL2Context(record.thread, !!record.contentLicense);
  // Gate 3: budget window (reserve inside the receipt transaction happens in chatJson).
  const budget = await vocBudgetState();
  const limits = budget.limits;
  if (!budget.round || !limits || limits.maxRequests <= 0) return { status: "refused", reason: "voc 预算窗口未建立或上限为 0（¥0 授权）" };
  try {
    const res = await chatJson({
      model: "default",
      purpose: "voc_l2",
      subject: `article:${articleId}@${row!.revision}:voc-l2`,
      promptVersion: VOC_L2_PROMPT_VERSION,
      system: context.system,
      user: context.user,
      schema: L2Output,
      temperature: 0.1,
      maxTokens: 1500,
      timeoutMs: 90_000,
      articleId,
      extraBody: { thinking: { type: "disabled" } },
    });
    // Validation beyond JSON: citations must exist in the sent context; no invented numbers.
    const badCitations = res.data.citationIds.filter((id) => !context.contextIds.includes(id));
    if (badCitations.length) throw new Error(`citation ids not in licensed context: ${badCitations.join(", ")}`);
    if (!res.data.citationIds.length) throw new Error("no citations provided");
    const sourceText = context.user;
    const invented = inventedNumbers(sourceText, JSON.stringify(res.data));
    if (invented.length) throw new Error(`output invents numbers absent from source: ${invented.join(", ")}`);
    const polarityMismatch = record.l1 && record.l1.polarity !== "unknown" && record.l1.polarity !== "mixed"
      && res.data.experienceType !== "unknown" && res.data.experienceType !== "mixed"
      && ((record.l1.polarity === "negative") !== (res.data.experienceType === "negative"));
    const l2: VocL2Stored = {
      inputRevision: row!.revision,
      modelId,
      modelMode,
      promptVersion: VOC_L2_PROMPT_VERSION,
      generatedAt: new Date().toISOString(),
      partial: context.partial,
      partialReason: context.partialReason,
      result: res.data,
      quality: polarityMismatch || context.partial ? "partial" : "pass",
      receiptId: res.receiptId,
    };
    await sql`UPDATE articles SET raw = jsonb_set(raw, '{voc,l2}', ${sql.json(l2 as never)}::jsonb), updated_at = now() WHERE id = ${articleId}`;
    return { status: "processed", l2 };
  } catch (error) {
    const message = String(error instanceof Error ? error.message : error).slice(0, 200);
    await sql`UPDATE articles SET raw = jsonb_set(raw, '{voc,l2Error}', ${sql.json({ at: new Date().toISOString(), message })}::jsonb), updated_at = now() WHERE id = ${articleId}`;
    return { status: "failed", reason: message };
  }
}

/**
 * L3 for one pain group: derives improvement hypotheses from the group's stored L2 results.
 * Refuses when the lane is closed or the group has no L2 results to build on.
 */
export async function processVocL3(painKey: string): Promise<{ status: "refused" | "processed" | "failed"; reason?: string; hypotheses?: unknown }> {
  if (!config.vocModelEnabled) return { status: "refused", reason: "voc 模型通道关闭（¥0）" };
  const rows = await sql<{ id: string; sourceId: string; title: string; revision: number; raw: { voc: VocRecord } }[]>`
    SELECT id, source_id AS "sourceId", title, revision, raw FROM articles
    WHERE raw->'voc' IS NOT NULL AND raw->'voc'->>'revokedBy' IS NULL
      AND raw->'voc'->'l2' IS NOT NULL
      AND id = ANY((SELECT array_agg(p.article_id) FROM publications p JOIN stories s ON s.id = p.story_id WHERE s.frame->>'painKey' = ${painKey})::text[])`;
  if (!rows.length) return { status: "refused", reason: "pain group has no L2 results; run L2 first" };
  const batches = await loadBatches();
  const batchMap = new Map(batches.map((b) => [b.id, b]));
  const licensed = rows.filter((r) => effectiveUses(r.raw.voc, batchMap).has("modelSend"));
  if (!licensed.length) return { status: "refused", reason: "no record in this group licenses modelSend" };
  const summaries = licensed.map((r) => `- [${r.id}]（来源 ${r.sourceId}）${r.title}\n  中文理解：${r.raw.voc.l2!.result.chineseSummary.slice(0, 200)}\n  已有解决：${r.raw.voc.l2!.result.existingSolutions.join("；") || "无"}\n  状态：${r.raw.voc.l2!.result.resolutionStatus}`);
  const user = `以下是同一痛点主题下各材料的中文理解结果（json）：\n${summaries.join("\n")}\n\n请返回 JSON：{"hypotheses": [{"statement": 改进假设, "basis": "原文直接支持|根据原文合理推断|证据不足的待验证假设", "supportingArticleIds": 材料id[], "existingSolutions": 已有解决方法[], "solutionsVerified": "已证实|有建议但效果未获确认|未见解决方法", "counterEvidence": 反面证据或null, "worthResearch": bool, "reason": 判断依据}], "sampleLimits": 样本局限说明（必须按上面列出的各材料实际来源说明样本出处、样本量小不能推算市场规模、样本来源地与人群未知）}`;
  try {
    const res = await chatJson({
      model: "default",
      purpose: "voc_l3",
      subject: `pain:${sha256(painKey).slice(0, 16)}:voc-l3`,
      promptVersion: VOC_L3_PROMPT_VERSION,
      system: SYSTEM,
      user,
      schema: L3Output,
      temperature: 0.2,
      maxTokens: 1500,
      timeoutMs: 90_000,
      extraBody: { thinking: { type: "disabled" } },
    });
    // Citations must reference real article ids in this group.
    const groupIds = new Set(rows.map((r) => r.id));
    for (const h of res.data.hypotheses) {
      const bad = h.supportingArticleIds.filter((id) => !groupIds.has(id));
      if (bad.length) throw new Error(`hypothesis cites articles outside the group: ${bad.join(", ")}`);
    }
    const storyId = (await sql<{ id: number }[]>`SELECT id FROM stories WHERE frame->>'painKey' = ${painKey} AND merged_into IS NULL LIMIT 1`)[0]?.id;
    if (storyId) {
      const inputHash = sha256(rows.map((r) => `${r.id}@${r.revision}`).sort().join("|"));
      await sql`UPDATE stories SET frame = jsonb_set(frame, '{l3}', ${sql.json({ painKey, modelId: "deepseek-flash", modelMode: "thinking-disabled", promptVersion: VOC_L3_PROMPT_VERSION, inputHash, generatedAt: new Date().toISOString(), humanReviewStatus: "pending", ...res.data } as never)}::jsonb), updated_at = now() WHERE id = ${storyId}`;
    }
    return { status: "processed", hypotheses: res.data.hypotheses };
  } catch (error) {
    return { status: "failed", reason: String(error instanceof Error ? error.message : error).slice(0, 200) };
  }
}

/** Batch entry: processes pending L2 records within the budget window (one lease). */
export async function processVocPending(opts: { runRecords?: number } = {}): Promise<{ done: Array<{ articleId: string; status: string; reason?: string }>; reason?: string }> {
  if (!config.vocModelEnabled) return { done: [], reason: "voc 模型通道关闭（¥0）" };
  if (!(await claimVocRun())) return { done: [], reason: "another run holds the voc lease" };
  try {
    const rows = await sql<{ id: string }[]>`
      SELECT a.id FROM articles a
      WHERE a.source_id LIKE 'voc-%' AND a.raw->'voc'->>'revokedBy' IS NULL
        AND a.raw->'voc'->'thread' IS NOT NULL
        AND a.raw->'voc'->'l2' IS NULL
      ORDER BY a.discovered_at DESC LIMIT ${opts.runRecords ?? 10}`;
    const done: Array<{ articleId: string; status: string; reason?: string }> = [];
    for (const r of rows) {
      const result = await processVocL2(r.id);
      done.push({ articleId: r.id, status: result.status, reason: result.reason });
      if (result.status === "refused") break; // gate refusal ends the run (no point retrying the same gate)
    }
    return { done };
  } finally {
    await releaseVocRun();
  }
}
