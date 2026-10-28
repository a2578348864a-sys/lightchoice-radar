import { sql } from "@aihot/backend/db";
import { listedCondition } from "@aihot/backend/publication/scope";

async function main() {
  console.log("================== P0-A LIVE DATABASE AUDIT ==================\n");

  const reports = await sql<{
    id: number;
    kind: string;
    key: string;
    revision: number;
    content: any;
    status: string;
    generated_at: Date;
  }[]>`
    SELECT id, kind, key, revision, content, coalesce(content->>'status', 'published') AS status, generated_at
    FROM reports
    ORDER BY kind, key
  `;

  console.log(`Found ${reports.length} total reports in database.`);

  const now = new Date();
  const allItemAudits: Array<{
    reportKind: string;
    reportKey: string;
    reportId: number;
    itemId: string;
    reportTitle: string;
    articleTitle: string | null;
    sourceId: string | null;
    sourceName: string | null;
    sourceUrl: string | null;
    sourceTier: string | null;
    participationMode: string | null;
    bodyMode: string | null;
    visibility: string | null;
    eligible: boolean | null;
    selected: boolean | null;
    timelineAt: Date | null;
    visibleAfter: Date | null;
    listedCond: boolean | null;
    isWithdrawn: boolean;
    unavailabilityReason: string;
  }> = [];

  for (const rep of reports) {
    const isMonthlyAudit = rep.kind === "monthly";
    console.log(`\n--- Inspecting ${rep.kind}:${rep.key} (ID: ${rep.id}, Rev: ${rep.revision}, Status: ${rep.status}) ---`);
    const c = rep.content;
    const items: Array<{ itemId: string; title: string; role?: string }> = [];

    if (rep.kind === "daily") {
      const sections = c.sections ?? [];
      for (const s of sections) {
        for (const it of s.items ?? []) {
          if (it.itemId) items.push({ itemId: it.itemId, title: it.title });
        }
      }
      for (const f of c.flashes ?? []) {
        if (f.itemId) items.push({ itemId: f.itemId, title: f.title, role: "flash" });
      }
    } else {
      const themes = c.themes ?? [];
      for (const t of themes) {
        for (const r of t.storyRefs ?? []) {
          if (r.itemId) items.push({ itemId: r.itemId, title: r.title });
        }
      }
    }

    console.log(`Report carries ${items.length} cited items.`);

    for (const it of items) {
      const [pub] = await sql<any[]>`
        SELECT p.article_id, p.visibility, p.eligible, p.selected, p.visible_after, p.timeline_at, p.body_mode,
               (${listedCondition(now)}) AS listed_cond,
               a.title AS article_title, a.url AS article_url, a.source_id,
               s.name AS source_name, s.tier AS source_tier, s.participation_mode,
               (p.visibility = 'withdrawn') AS is_withdrawn
        FROM publications p
        LEFT JOIN articles a ON a.id = p.article_id
        LEFT JOIN sources s ON s.id = p.source_id
        WHERE p.article_id = ${it.itemId}
      `;

      let reason = "available";
      if (!pub) {
        reason = "6. 文章记录缺失 (publication missing)";
      } else if (pub.is_withdrawn) {
        reason = "5. 真正撤销或下架 (visibility = withdrawn)";
      } else if (pub.visibility !== "public") {
        reason = `5. 非公开状态 (visibility = ${pub.visibility})`;
      } else if (pub.visible_after && new Date(pub.visible_after).getTime() > now.getTime()) {
        reason = "3. 尚未达到发布时间 (visible_after > now)";
      } else if (!pub.eligible) {
        if (!pub.selected && pub.participation_mode === "editorial") {
          reason = "1&2. editorial来源未精选且eligible=false (pool ineligible)";
        } else {
          reason = "2. 未满足普通列表 eligible (eligible=false)";
        }
      }

      allItemAudits.push({
        reportKind: rep.kind,
        reportKey: rep.key,
        reportId: rep.id,
        itemId: it.itemId,
        reportTitle: it.title,
        articleTitle: pub?.article_title ?? null,
        sourceId: pub?.source_id ?? null,
        sourceName: pub?.source_name ?? null,
        sourceUrl: pub?.article_url ?? null,
        sourceTier: pub?.source_tier ?? null,
        participationMode: pub?.participation_mode ?? null,
        bodyMode: pub?.body_mode ?? null,
        visibility: pub?.visibility ?? null,
        eligible: pub?.eligible ?? null,
        selected: pub?.selected ?? null,
        timelineAt: pub?.timeline_at ?? null,
        visibleAfter: pub?.visible_after ?? null,
        listedCond: pub?.listed_cond ?? null,
        isWithdrawn: pub?.is_withdrawn ?? false,
        unavailabilityReason: reason,
      });
    }
  }

  console.log("\n================== DETAILED AUDIT RESULTS ==================");
  console.log(`Total cited entries audited across all reports: ${allItemAudits.length}`);

  // Group by report
  const byReport = new Map<string, typeof allItemAudits>();
  for (const a of allItemAudits) {
    const k = `${a.reportKind}:${a.reportKey}`;
    byReport.set(k, [...(byReport.get(k) ?? []), a]);
  }

  for (const [repKey, audits] of byReport) {
    console.log(`\n>>> Report: ${repKey} (${audits.length} items) <<<`);
    const reasonCounts: Record<string, number> = {};
    for (const a of audits) {
      reasonCounts[a.unavailabilityReason] = (reasonCounts[a.unavailabilityReason] || 0) + 1;
      console.log(`  - [${a.itemId}] eligible=${a.eligible}, selected=${a.selected}, listedCond=${a.listedCond}, source=${a.sourceName} (${a.sourceId}), mode=${a.participationMode}`);
      console.log(`    Title: "${a.reportTitle}"`);
      console.log(`    Status: ${a.unavailabilityReason}`);
    }
    console.log(`  Summary for ${repKey}:`, reasonCounts);
  }

  // Overall reason distribution
  console.log("\n================== OVERALL REASON DISTRIBUTION ==================");
  const totalDistribution: Record<string, number> = {};
  for (const a of allItemAudits) {
    totalDistribution[a.unavailabilityReason] = (totalDistribution[a.unavailabilityReason] || 0) + 1;
  }
  console.log(JSON.stringify(totalDistribution, null, 2));

  await sql.end();
}

main().catch((err) => {
  console.error("Audit error:", err);
  process.exit(1);
});
