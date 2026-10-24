// Reader-facing pieces of an article page: what this piece says, the few facts worth scanning, and a
// folded block with the provenance. The stored facts behind them (material coverage, revision binding,
// machine-translation state, rule evidence) stay in the API and the database; a reader meets them as
// short sentences, not as the backend's own vocabulary.
import type { ContentIdentity, PolicyExplanation, SiteItemDetail } from "@aihot/contracts/site";
import { beijingDate } from "@aihot/contracts/time";

/** "美国监管｜CPSC 官方产品召回 RSS" → "CPSC 官方产品召回"; a plain name is kept as it is. */
export function readerSourceName(name: string): string {
  const short = name.includes("｜") ? name.split("｜").slice(1).join("｜") : name;
  return short.replace(/\s*RSS\s*$/i, "").trim() || name;
}

/**
 * The source's author, when it is a person or an organisation. Some feeds put the whole headline in
 * the author field (CPSC does), which then repeated the title above the title; such a value is not
 * shown as an author. The stored field is untouched.
 */
export function readerAuthor(author: string | null | undefined, title: string | null | undefined): string | null {
  const value = author?.trim();
  if (!value || value.length > 60) return null;
  const headline = (title ?? "").trim();
  if (!headline) return value;
  const head = headline.slice(0, 40);
  if (value.startsWith(head) || headline.startsWith(value.slice(0, 40))) return null;
  return value;
}

/** Whether the stored text is a proposal or an issued file, from the explanation's own wording. */
export function policyStatus(explanation: PolicyExplanation | null | undefined): "proposed" | "issued" | null {
  for (const line of explanation?.current ?? []) {
    if (line.startsWith("文件状态：拟议阶段")) return "proposed";
    if (line.startsWith("文件状态：官方已发布文件")) return "issued";
  }
  return null;
}

/** The first one or two sentences, cut at a sentence end near `max` characters. */
export function firstSentences(text: string, max = 140): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const parts = clean.split(/(?<=[。！？!?])\s*/);
  let out = "";
  for (const part of parts) {
    if (out && (out + part).length > max) break;
    out += part;
    if (out.length >= max * 0.6) break;
  }
  return out.length >= 20 ? out : `${clean.slice(0, max)}…`;
}

export type QuickReadSource = "machine-zh" | "rule-zh" | "original" | "none";

export interface QuickRead {
  text: string | null;
  source: QuickReadSource;
  /** What the site actually holds, in one clause a reader can act on. */
  coverage: string;
  status: "proposed" | "issued" | null;
  /**
   * The stored summary is no longer than the quick read, so printing it again in the reading area
   * would show the same paragraph twice. The page then keeps the quick read as the content.
   */
  repeatsSummary: boolean;
}

export function materialCoverage(identity: ContentIdentity | undefined): string {
  if (!identity) return "材料情况未记录";
  if (identity.material === "body") return identity.bodyShown ? "已取得正文" : "已取得正文，但来源只允许展示摘要";
  if (identity.material === "excerpt") return "仅有来源摘要，没有完整正文";
  return "仅有标题，没有摘要或正文";
}

export function quickReadOf(item: SiteItemDetail): QuickRead {
  const status = policyStatus(item.explanation);
  const coverage = materialCoverage(item.identity);
  const summary = item.summary?.trim() ?? "";
  if (!summary) return { text: null, source: "none", coverage, status, repeatsSummary: false };
  const kind = item.identity?.summaryKind;
  const source: QuickReadSource = kind === "machine-zh" ? "machine-zh" : kind === "rule-zh" ? "rule-zh" : "original";
  const text = firstSentences(summary);
  return { text, source, coverage, status, repeatsSummary: summary.length <= text.length + 8 };
}

const QUICK_READ_LABEL: Record<QuickReadSource, string> = {
  "machine-zh": "机器翻译摘要 · 未经人工核对",
  "rule-zh": "本站依据来源内容整理的中文摘要",
  original: "来源摘要（英文原文，尚未翻译）",
  none: "",
};

/** The one line under 重点速读: what the text above actually is. */
export function quickReadNote(read: QuickRead): string {
  if (!read.text) return read.coverage;
  const label = QUICK_READ_LABEL[read.source];
  return label ? `${label}；${read.coverage}` : read.coverage;
}

/** One row of 关键信息: a label and what the stored material says. No evidence, no state codes. */
export interface KeyFact {
  label: string;
  value: string;
}

/**
 * The facts worth scanning beside the headline. The stored explanation carries facts lifted verbatim
 * from the material (editorial/policy-explain.ts keyFactsOf); an explanation written before that field
 * existed falls back to the change and effective-date it does carry. The evidence behind each fact
 * stays in the API and is listed in the folded 来源与核实说明 — the reading area shows the fact only.
 */
export function keyFactsOf(item: SiteItemDetail): KeyFact[] {
  const facts: KeyFact[] = [];
  for (const stored of item.keyFacts ?? item.explanation?.keyFacts ?? []) {
    facts.push({ label: stored.label, value: stored.value });
  }
  if (facts.length) return facts.slice(0, 5);
  const explanation = item.explanation;
  const change = explanation?.change;
  // The rule engine also records "the text contains a change, check the original" when it matched a
  // change word without a usable statement; that sentence says nothing a reader can use here.
  if (change && !change.statement.startsWith("官方文本中出现变化/修订表述")) {
    facts.push({ label: "变化", value: change.statement });
  }
  for (const date of explanation?.keyDates ?? []) {
    if (date.kind === "effective-claim") facts.push({ label: "生效时间", value: date.display });
  }
  return facts;
}

export function proposedNotice(status: "proposed" | "issued" | null): string | null {
  return status === "proposed" ? "拟议规则，尚未生效" : null;
}

/**
 * The one line a list card carries about its Chinese: the same transparency as the article page, in
 * words a reader uses, without the state names the API stores.
 */
export function readerLine(identity: ContentIdentity | undefined): string | null {
  if (!identity) return null;
  const machine = identity.titleKind === "machine-zh" || identity.summaryKind === "machine-zh";
  const ruleSummary = identity.summaryKind === "rule-zh";
  const chineseTitle = identity.titleKind === "machine-zh" || identity.titleKind === "rule-zh" || identity.titleKind === "source-zh";
  const parts: string[] = [];
  if (machine) parts.push("机器翻译");
  if (identity.summaryKind === "machine-zh") parts.push("中文摘要");
  else if (ruleSummary) parts.push("中文摘要");
  if (identity.explanation === "current") parts.push("有中文解读");
  if (identity.translation === "stale") parts.push("译文待更新");
  if (!parts.length) parts.push(chineseTitle ? "中文原文" : "英文原文 · 未翻译");
  return parts.slice(0, 3).join(" · ");
}

function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/**
 * 重点速读: the first thing after the title. It repeats the opening of the stored summary on purpose —
 * a reader should not have to scroll past provenance to learn what the piece says — and it says what
 * that text is in the same breath.
 */
export function ReaderQuickRead({ item }: { item: SiteItemDetail }) {
  const read = quickReadOf(item);
  const proposed = proposedNotice(read.status);
  return (
    <section className="mt-6" aria-label="重点速读">
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-semibold text-accent">
        <span>重点速读</span>
        {proposed && <span className="rounded-full bg-amber-soft px-2 py-[2px] text-[11px] font-medium text-amber-ink">{proposed}</span>}
      </div>
      {read.text
        ? <p className="text-[18px] leading-[1.75] text-ink xl:text-[19px] xl:leading-[1.8]">{read.text}</p>
        : <p className="text-[15px] leading-[1.75] text-ink-3">这条记录没有摘要，只有标题与官方来源，请直接查看原文。</p>}
      <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-4">{quickReadNote(read)}</p>
      {/* When the summary is this short it is not repeated below, so its original text is offered here. */}
      {read.repeatsSummary && item.originalSummary && item.originalSummary !== item.summary && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[12.5px] text-ink-4">查看来源摘要原文</summary>
          <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-3">{item.originalSummary}</p>
        </details>
      )}
    </section>
  );
}

/** 关键信息: only the fields the material supports; nothing is invented to fill the rows. */
export function ReaderKeyFacts({ item }: { item: SiteItemDetail }) {
  const facts = keyFactsOf(item);
  if (!facts.length) return null;
  return (
    <section className="mt-7 border-t border-line-soft pt-4" aria-label="关键信息">
      <h2 className="text-[12px] font-semibold text-ink-3">关键信息</h2>
      <dl className="mt-2 divide-y divide-line-soft">
        {facts.map((fact) => (
          <div key={fact.label + fact.value} className="grid gap-1 py-2.5 sm:grid-cols-[92px_minmax(0,1fr)] sm:gap-3">
            <dt className="text-[12.5px] text-ink-4">{fact.label}</dt>
            <dd className="min-w-0 text-[14px] leading-[1.75] text-ink-2">
              {fact.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * 来源与核实说明: everything a careful reader may still want, folded away by default — the original
 * title, where and when the piece came from, what the Chinese here actually is, and the revision
 * history. Database identifiers, rule ids and pipeline states stay out of the page entirely.
 */
export function ReaderSourceNotes({ item }: { item: SiteItemDetail }) {
  const identity = item.identity;
  const host = hostOf(item.links.original);
  const revisions = item.revisionHistory ?? [];
  const machine = identity?.titleKind === "machine-zh" || identity?.summaryKind === "machine-zh";
  const translation = identity?.translation;
  const dates: Array<[string, string]> = [];
  if (item.publishedAt) dates.push(["官方发布日期", item.publishedDate ?? new Date(item.publishedAt).toISOString().slice(0, 10)]);
  if (item.sourceUpdatedAt) dates.push(["来源页面更新", beijingDate(item.sourceUpdatedAt)]);
  dates.push(["本地收录", beijingDate(item.discoveredAt)]);

  return (
    <details className="mt-9 border-t border-line pt-4">
      <summary className="flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-ink-3">
        来源与核实说明
        <span className="font-normal text-ink-4">原文标题 · 日期口径 · 译文与材料覆盖 · 关键信息依据</span>
      </summary>
      <dl className="mt-3 grid gap-2 text-[12.5px] leading-relaxed sm:grid-cols-[92px_minmax(0,1fr)] sm:gap-3">
        {item.originalTitle && item.originalTitle !== item.title && (
          <>
            <dt className="text-ink-4">原文标题</dt>
            <dd className="text-ink-2">{item.originalTitle}</dd>
          </>
        )}
        <dt className="text-ink-4">来源</dt>
        <dd className="text-ink-2">
          {readerSourceName(item.source.name)}
          {host && <span className="text-ink-4"> · {host}</span>}
          <a href={item.links.original} target="_blank" rel="noopener noreferrer" className="ml-2 text-accent hover:underline">查看原文</a>
        </dd>
        {/* Where each scannable fact came from, for anyone who wants to check it: the field and the
            words matched there. Not in the reading area — a reader meets the fact, not the audit. */}
        {(item.keyFacts ?? item.explanation?.keyFacts ?? []).length > 0 && (
          <>
            <dt className="text-ink-4">关键信息依据</dt>
            <dd className="text-ink-2">
              <ul className="space-y-1">
                {(item.keyFacts ?? item.explanation?.keyFacts ?? []).map((stored) => (
                  <li key={stored.label + stored.value}>
                    <span className="text-ink-3">{stored.label}</span>
                    <span className="text-ink-4"> · {stored.evidence}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        <dt className="text-ink-4">日期</dt>
        <dd className="text-ink-2">
          {dates.map(([label, value]) => (
            <span key={label} className="mr-3 inline-block whitespace-nowrap">
              {label} <span className="text-ink-3">{value}</span>
            </span>
          ))}
          <span className="mt-0.5 block text-[11.5px] text-ink-4">发布日期与本地收录时间不是一回事；没有官方日期时会写明。</span>
        </dd>
        <dt className="text-ink-4">中文内容</dt>
        <dd className="text-ink-2">
          {machine ? "标题与摘要为机器翻译（DeepSeek），未经人工核对。" : "标题与摘要为来源语言原文，尚未翻译。"}
          {translation === "stale" && <span className="text-amber-ink">原文已更新，现有译文对应旧版本，未作为当前结果展示。</span>}
          {translation === "complete" && "正文有完整中文译文。"}
          {translation === "partial" && "正文没有中文译文。"}
          <span className="mt-0.5 block text-[11.5px] text-ink-4">中文解释由本站规则从已取得的材料整理，不是官方译文或官方结论。</span>
        </dd>
        <dt className="text-ink-4">材料覆盖</dt>
        <dd className="text-ink-2">{materialCoverage(identity)}</dd>
        {revisions.length > 1 && (
          <>
            <dt className="text-ink-4">内容修订</dt>
            <dd className="text-ink-2">
              <ol className="space-y-1.5">
                {revisions.slice(1, 6).map((revision) => (
                  <li key={revision.revision}>
                    <span className="text-ink-4">{revision.capturedAt.slice(0, 10)} </span>
                    <span>{revision.title}</span>
                  </li>
                ))}
              </ol>
              <span className="mt-0.5 block text-[11.5px] text-ink-4">来源内容更新过；当前页面只展示与最新版本对应的中文内容。</span>
            </dd>
          </>
        )}
      </dl>
      <p className="mt-2 text-[11.5px] leading-relaxed text-ink-4">
        以上为来源公开信息的中文转述与机器翻译，不构成业务建议；适用范围、金额与生效条件请以官方原文为准。
      </p>
    </details>
  );
}

