import type { FeedItemSummary, PoolResponse, RuleEvidence } from "@aihot/contracts/site";
import { sql } from "../db.ts";
import { loadPool, type PoolQuery } from "./pool.ts";

export interface RadarExportItem extends FeedItemSummary {
  originalUrl: string;
  ruleVersion: string | null;
  ruleEvidence: RuleEvidence[];
}

export interface RadarExport {
  generatedAt: string;
  filters: { q: string | null; from: string | null; to: string | null; dateBasis: "collected" | "published"; sourceId: string | null; channel: string; category: string | null; tag: string | null };
  total: number;
  truncated: boolean;
  items: RadarExportItem[];
}

/** Export follows the same public visibility, search, date and tag filters as the list. */
export async function loadRadarExport(query: PoolQuery): Promise<RadarExport> {
  const first = await loadPool({ ...query, page: 1 });
  const items = [...first.items];
  for (let page = 2; page <= first.pageCount; page += 1) {
    const next: PoolResponse = await loadPool({ ...query, page });
    items.push(...next.items);
  }
  const evidenceRows = items.length
    ? await sql<Array<{ article_id: string; version: string | null; evidence: RuleEvidence[] | null }>>`
      SELECT DISTINCT ON (an.article_id) an.article_id,
        an.output->>'ruleVersion' AS version, an.output->'ruleEvidence' AS evidence
      FROM analyses an JOIN articles a ON a.id = an.article_id AND a.revision = an.input_revision
      WHERE an.article_id = ANY(${items.map((item) => item.id)}::text[]) AND an.origin = 'rule'
      ORDER BY an.article_id, an.id DESC`
    : [];
  const evidence = new Map(evidenceRows.map((row) => [row.article_id, { version: row.version, evidence: row.evidence ?? [] }]));
  const urlRows = items.length
    ? await sql<Array<{ article_id: string; url: string }>>`
      SELECT p.article_id, p.url FROM publications p WHERE p.article_id = ANY(${items.map((item) => item.id)}::text[])`
    : [];
  const originalUrls = new Map(urlRows.map((row) => [row.article_id, row.url]));
  return {
    generatedAt: new Date().toISOString(),
    filters: {
      q: query.q?.trim() || null, from: query.discoveredFrom ?? null, to: query.discoveredTo ?? null,
      dateBasis: query.dateBasis ?? "collected", sourceId: query.sourceId ?? null,
      channel: query.channel, category: query.category, tag: query.tag,
    },
    total: first.total,
    truncated: first.total > items.length,
    items: items.map((item) => {
      const classified = evidence.get(item.id);
      return { ...item, originalUrl: originalUrls.get(item.id) ?? "", ruleVersion: classified?.version ?? null, ruleEvidence: classified?.evidence ?? [] };
    }),
  };
}

const md = (value: string) => value.replace(/([\\`*_{}\[\]()#+.!|>])/g, "\\$1");

export function radarExportMarkdown(data: RadarExport): string {
  const dateLabel = data.filters.dateBasis === "published" ? "发布日期" : "收录日期";
  const range = data.filters.from || data.filters.to
    ? `${data.filters.from ?? "最早"} 至 ${data.filters.to ?? "最近"}（北京时间${dateLabel}）`
    : "全部可见历史";
  const lines = [
    "# LightChoice Radar 情报导出",
    "",
    `- 导出时间：${data.generatedAt}`,
    `- ${dateLabel}：${range}`,
    `- 搜索词：${data.filters.q ?? "无"}`,
    `- 频道：${data.filters.channel}`,
    `- 分类：${data.filters.category ?? "无"}`,
    `- 标签：${data.filters.tag ?? "无"}`,
    `- 当前导出：${data.items.length} 条 / 匹配总数 ${data.total}${data.truncated ? "（已达到 2000 条上限，结果未完整导出）" : ""}`,
    "",
  ];
  for (const [index, item] of data.items.entries()) {
    lines.push(
      `## ${index + 1}. ${md(item.title)}`,
      "",
      `- 来源：[${md(item.source.name)}](${item.originalUrl})`,
      `- 收录时间：${item.discoveredAt}`,
      `- 发布时间：${item.publishedAt ?? "来源未提供"}`,
      `- 规则标签：${item.tags.length ? item.tags.map((tag) => `\`${tag}\``).join("、") : "未命中"}`,
      "",
    );
    for (const hit of item.ruleEvidence) lines.push(`- ${hit.label}（${hit.field} 命中“${hit.matchedText}”）：${hit.context}`);
    if (item.ruleEvidence.length) lines.push("");
  }
  return `${lines.join("\n")}\n`;
}
