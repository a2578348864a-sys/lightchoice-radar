import { Link, useLoaderData } from "react-router";
import type { LeadClaim, LeadDetail } from "@aihot/contracts/site";
import { SITE } from "@aihot/site";
import { loadOr404 } from "../lib/api.server";
import { pageMeta } from "../lib/seo";
import { fullDateTime, relativeTime } from "../lib/format";
import { Badge } from "../components/ui/Badge";
import { IconArrowLeft, IconExternal } from "../components/icons";
import { PhoneBar } from "../components/shell/PhoneBar";
import type { Screen } from "../components/shell/screens";
import { firstSentences } from "../features/item/reading";

export const handle: Screen = { name: "政策线索" };

export async function loader({ params, request }: { params: { id?: string }; request: Request }) {
  const lead = await loadOr404<LeadDetail>(`/api/site/leads/${encodeURIComponent(params.id ?? "")}`, { signal: request.signal });
  return { lead };
}

export function meta() {
  return pageMeta({
    title: "政策线索详情",
    description: "第三方政策候选线索的核实状态与来源说明，不是 Amazon 官方已确认的政策。",
    path: "/leads",
    noindex: true,
  });
}

const PROCESSING: Record<string, string> = {
  new: "待处理（尚未进入加工与发布链路）",
  processing: "处理中",
  processed: "已处理",
  skipped: "已排除（复核时移出候选）",
  failed: "处理失败",
};

const EVENT_STATE: Record<string, string> = {
  new: "新事件（目前没有同事件的其他报道）",
  "pending-determination": "待确定：可能与其他报道重复，尚未合并",
  merged: "已并入同一事件的其他记录",
};

const OFFICIAL: Record<string, { label: string; tone: "ok" | "amber" | "neutral" }> = {
  "third-party-only": { label: "仅第三方报道", tone: "amber" },
  "matched-official": { label: "已匹配官方记录", tone: "ok" },
  "evidence-insufficient": { label: "找到相关官方资料，但不足以确认报道的说法", tone: "amber" },
  "access-restricted": { label: "官方口径需登录，无法核实", tone: "neutral" },
  unknown: { label: "核实状态未知", tone: "neutral" },
};

/** An unmapped state reads as 状态未知 rather than an English token on a Chinese page. */
const UNKNOWN_OFFICIAL = { label: "核实状态未知", tone: "neutral" as const };

/** One claim of the report and what the bounded official research found for it. */
function ClaimRow({ claim, grouped = false }: { claim: LeadClaim; grouped?: boolean }) {
  const supported = claim.verdict === "supported";
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2">
        {/* Inside the two groups the heading already says which side a claim is on. */}
        {!grouped && (
          <span className={supported
            ? "mt-[3px] inline-flex h-[18px] shrink-0 items-center rounded-full bg-emerald-soft px-2 text-[11px] font-medium text-emerald-ink"
            : "mt-[3px] inline-flex h-[18px] shrink-0 items-center rounded-full bg-bg-sunk px-2 text-[11px] text-ink-3"}
          >
            {supported ? "官方原文支持" : "未经官方证实"}
          </span>
        )}
        <div className="min-w-0 text-[13.5px] leading-[1.75] text-ink-2">
          <p>{claim.claim}</p>
          {supported && claim.evidence && (
            <p className="mt-1 border-l-2 border-line-soft pl-2.5 text-[12.5px] leading-[1.7] text-ink-3">官方原文：{claim.evidence}</p>
          )}
          {/* A note carries the boundary of the support (agency deadline ≠ seller deadline, rulemaking
              direction ≠ in-effect amounts) or the reason an unverified claim stays unverified. Both
              belong on the page: hiding a supported claim's caveat would overstate the evidence. */}
          {claim.note && (
            <p className="mt-1 text-[12.5px] leading-[1.7] text-ink-4">{claim.note}</p>
          )}
        </div>
      </div>
    </li>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 py-2 text-[13px] leading-[1.7] sm:grid-cols-[120px_minmax(0,1fr)]">
      <dt className="text-ink-4">{label}</dt>
      <dd className="min-w-0 text-ink-2">{children}</dd>
    </div>
  );
}

export default function LeadDetailPage() {
  const { lead } = useLoaderData<typeof loader>();
  const official = OFFICIAL[lead.officialStatus] ?? UNKNOWN_OFFICIAL;
  const claims = lead.officialClaims ?? [];
  const supported = claims.filter((claim) => claim.verdict === "supported");
  const unverified = claims.filter((claim) => claim.verdict !== "supported");
  // Only the states a reader has to know about: a lead that was set aside, or one that could not be processed.
  const showProcessing = lead.excluded || lead.processingState === "failed";

  return (
    <div className="pb-12">
      <PhoneBar back={{ to: "/leads", label: "政策线索" }} title="线索详情" />
      <div className="mx-auto max-w-[var(--page-max-reading)]">
        <Link to="/leads" className="mt-2 hidden items-center gap-1.5 text-[12.5px] text-ink-4 transition-colors hover:text-ink-2 lg:inline-flex">
          <IconArrowLeft size={14} /> 返回政策线索
        </Link>

        <article className="pb-6 pt-3 lg:pt-4">
          <header>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge tone={official.tone}>{official.label}</Badge>
              {lead.excluded && <Badge tone="neutral">已排除</Badge>}
              {lead.column && <span className="text-[11.5px] text-ink-4">{lead.column}</span>}
            </div>
            <h1 data-page-title="" className="mt-2 text-[24px] font-bold leading-[1.4] tracking-[-0.01em] text-ink lg:text-[28px]">{lead.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-ink-4">
              <span>来源 AMZ123（第三方媒体）</span>
              <span>· 报道 {lead.publishedAt ? fullDateTime(lead.publishedAt) : "未标注日期"}</span>
              {lead.sourceUpdatedAt && <span>· 来源更新 {fullDateTime(lead.sourceUpdatedAt)}</span>}
            </div>
            <a href={lead.url} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 text-[12.5px] text-ink-4 transition-colors hover:text-accent">
              到 AMZ123 阅读原文 <IconExternal size={12} />
            </a>
          </header>

          <p className="mt-5 text-[12.5px] leading-[1.75] text-amber-ink">
            这是一条<strong className="font-semibold">第三方候选线索</strong>，不是 Amazon 官方已确认的政策；下面的「官方核实」只说明我们是否在已收录的官方来源里找到了对应记录。
          </p>

          {lead.excerpt && (
            <section className="mt-6" aria-label="重点速读">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-[12px] font-semibold text-accent">
                <span>重点速读</span>
              </div>
              <p className="text-[18px] leading-[1.75] text-ink xl:text-[19px] xl:leading-[1.8]">{firstSentences(lead.excerpt, 150)}</p>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-4">AMZ123 自己的短描述，不是正文，也不代表我们核实过。</p>
            </section>
          )}

          <section className="mt-7 border-t border-line-soft pt-4" aria-label="官方核实结果">
            <h2 className="text-[12px] font-semibold text-ink-3">官方核实</h2>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[13px] font-medium text-ink-2">{official.label}</span>
              {lead.officialSource && <span className="text-[12.5px] text-ink-3">证据机构：{lead.officialSource}</span>}
            </div>
            {lead.officialNote && <p className="mt-2 text-[14px] leading-[1.75] text-ink-2">{lead.officialNote}</p>}
            <dl className="mt-2 text-[12.5px] leading-relaxed">
              {lead.officialTitle && (
                <div className="grid gap-1 py-1.5 sm:grid-cols-[88px_minmax(0,1fr)]">
                  <dt className="text-ink-4">官方文件</dt>
                  <dd className="text-ink-2">{lead.officialTitle}{lead.officialPublishedAt && <span className="text-ink-4"> · {lead.officialPublishedAt}</span>}</dd>
                </div>
              )}
              {lead.officialUrl && (
                <div className="grid gap-1 py-1.5 sm:grid-cols-[88px_minmax(0,1fr)]">
                  <dt className="text-ink-4">官方链接</dt>
                  <dd className="min-w-0">
                    <a href={lead.officialUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all text-accent hover:underline">
                      {lead.officialUrl} <IconExternal size={12} />
                    </a>
                  </dd>
                </div>
              )}
            </dl>

            {supported.length > 0 && (
              <div className="mt-4">
                <h3 className="text-[12.5px] font-semibold text-ink">已证实的说法（{supported.length}）</h3>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-4">官方文件原文写明了这些内容；引用时仍以原文为准。</p>
                <ul className="mt-2 divide-y divide-line-soft">
                  {supported.map((claim, index) => <ClaimRow key={`s${index}`} claim={claim} grouped />)}
                </ul>
              </div>
            )}
            {unverified.length > 0 && (
              <div className="mt-5">
                <h3 className="text-[12.5px] font-semibold text-ink">尚未证实的说法（{unverified.length}）</h3>
                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-4">公开渠道暂时找不到对应的官方表述，不代表报道造假；这些说法只能作为线索。</p>
                <ul className="mt-2 divide-y divide-line-soft">
                  {unverified.map((claim, index) => <ClaimRow key={`u${index}`} claim={claim} grouped />)}
                </ul>
              </div>
            )}
          </section>

          <details className="mt-8 border-t border-line pt-4">
            <summary className="flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold text-ink-3">
              来源与核实说明
              <span className="font-normal text-ink-4">日期口径 · 处理状态 · 核实限制</span>
            </summary>
            <dl className="mt-3 divide-y divide-line-soft">
              <Row label="作者">{lead.author ?? "未标注"}</Row>
              <Row label="报道日期">{lead.publishedAt ? fullDateTime(lead.publishedAt) : "未标注"}</Row>
              <Row label="来源更新">{lead.sourceUpdatedAt ? fullDateTime(lead.sourceUpdatedAt) : "站点未提供"}</Row>
              <Row label="本地收录">{fullDateTime(lead.discoveredAt)}</Row>
              {lead.effectiveDateVerified && lead.effectiveDate && <Row label={lead.effectiveDateLabel ?? "政策生效日期"}>{lead.effectiveDate}</Row>}
              {!lead.effectiveDateVerified && lead.reportedEffectiveDate && (
                <Row label="报道所称生效日期">
                  {lead.reportedEffectiveDate}
                  <span className="ml-2 text-[11.5px] text-ink-4">第三方表述，未经官方原文核实</span>
                </Row>
              )}
              {lead.section && <Row label="栏目">{lead.section}{lead.column ? ` · ${lead.column}` : ""}</Row>}
              <Row label="市场">{lead.market === "US" ? "美国站（报道自身表述）" : lead.market ? `${lead.market}（报道自身表述）` : "未标注"}</Row>
              {lead.officialVerifiedAt && <Row label="核实时间">{fullDateTime(lead.officialVerifiedAt)}（核实记录时间，不是政策日期）</Row>}
              {showProcessing && <Row label="处理状态">{PROCESSING[lead.processingState] ?? "状态未知"}</Row>}
              {lead.excluded && lead.exclusionReason && <Row label="排除原因">{lead.exclusionReason}</Row>}
              {lead.reviewedAt && <Row label="复核时间">{fullDateTime(lead.reviewedAt)}</Row>}
            </dl>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-[12px] leading-[1.8] text-ink-3">
              <li>只保存标题、短摘要、发布日期与核实状态，<strong className="font-semibold text-ink-2">不保存也不展示正文</strong>。</li>
              <li>官方核实优先比对项目已收录的官方来源；必要时对公开官方原文做有界只读核实，结果按主张逐条标注。</li>
              <li>核实记录是对「官方原文写了什么」的证据整理，不构成业务建议；是否调整经营行为请自行判断。</li>
              <li>{SITE.name} 不转载第三方全文；原文版权归 AMZ123 及原作者。</li>
            </ul>
          </details>
        </article>
      </div>
    </div>
  );
}
