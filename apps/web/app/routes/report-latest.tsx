import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/report-latest";
import { REPORT_NAMES, type ReportLatestPage } from "@aihot/contracts/site";
import { REPORTS, subjectAfter, withSubject } from "@aihot/site";
import { cachedPage, loadOr404 } from "../lib/api.server";
import { pageReuse } from "../lib/page-reuse";
import { pageMeta, reportLd } from "../lib/seo";
import { beijingDate } from "@aihot/contracts/time";
import { ReportLayout } from "../features/report/ReportLayout";
import { ReportPaper, reportOutline } from "../features/report/ReportPaper";
import { feedLink, kindFromPath } from "../features/report/format";
import type { Screen } from "../components/shell/screens";

export const handle: Screen = { tab: "daily", name: "日报" };
export { pageHeaders as headers } from "../lib/api.server";
export const { clientLoader, shouldRevalidate } = pageReuse<typeof loader>();

export async function loader({ request }: Route.LoaderArgs) {
  const kind = kindFromPath(new URL(request.url).pathname);
  const { index, report } = await loadOr404<ReportLatestPage>(`/api/site/reports/${kind}/latest-page`, { signal: request.signal });
  return cachedPage(600, { kind, report, index, today: beijingDate(Date.now()) });
}

export function meta({ loaderData, location }: Route.MetaArgs) {
  const kind = loaderData?.kind ?? "daily";
  const description = `${REPORTS.descriptions[kind]}。`;
  const report = loaderData?.report;
  return [...pageMeta({
    title: withSubject(REPORT_NAMES[kind]),
    description,
    path: location.pathname,
    image: `/og/pages/${kind}.png`,
    jsonLd: report ? reportLd(report, location.pathname, report.lead?.leadParagraph ?? description) : undefined,
  }), feedLink(kind)];
}

export default function ReportLatestPage() {
  const { kind, report, index, today } = useLoaderData<typeof loader>();
  const editionTimeDesc =
    kind === "daily"
      ? "每天 08:00（覆盖过去 24 小时政策与行业）"
      : kind === "weekly"
        ? "每周一 10:00（周度要闻汇编）"
        : "每月 1 日 10:30（月度大盘总览）";

  return (
    <ReportLayout kind={kind} index={index} current={report?.key ?? null} today={today} outline={report ? reportOutline(report) : []}>
      {report ? (
        <ReportPaper report={report} index={index} />
      ) : (
        <div className="mx-auto max-w-xl py-12 text-center">
          <div className="rounded-card border border-line bg-surface p-8 shadow-sm">
            <h2 className="text-[18px] font-semibold text-ink">
              {subjectAfter("暂无已发布的", REPORT_NAMES[kind])}
            </h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-ink-3">
              出刊设定：<strong className="font-semibold text-ink-2">{editionTimeDesc}</strong>。
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-ink-4">
              已接入受管维护定时调度（出刊时间到达后自动结算，零费用不调用付费大模型）；
              当期有合规数据生成成刊后会在此呈现，历史合订本请查阅往期归档。
            </p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Link to="/daily/archive" className="chip">
                查阅往期归档
              </Link>
              <Link to="/" className="chip">
                返回情报首页
              </Link>
            </div>
          </div>
        </div>
      )}
    </ReportLayout>
  );
}
