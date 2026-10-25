// Market source adapters and the unified import pipeline (R2).
//
// Every import path — AMZ123 keyword page capture, Amazon chart manual observation, generic
// user-authorized JSON — goes through the same gates: the source must be REGISTERED, ENABLED and
// licensed for `store` (and later `compute`) per use. Unlicensed sources are refused before any
// processing; adapters never fabricate fields the input lacks; re-imports are idempotent by
// identity and produce content revisions, never duplicates (VOC applyImport semantics).
import { sql } from "../db.ts";
import { sha256, stableJson } from "../lib/ids.ts";
import { identityKeyFor } from "../content/materials.ts";
import {
  chartSnapshotBasisVersion, keywordSnapshotBasisVersion, loadMarketSource, saveMarketSource,
  sourceAllows, type MarketChartSnapshot, type MarketKeywordSnapshot, type MarketProductRecord, type MarketSource,
} from "./market-model.ts";
import {
  parseCsv, mapAndValidateKeywordRows, mapAndValidateProductRows, type RowValidationError,
} from "./csv-parser.ts";

/* ------------------------------------------------------------------ adapters */

export interface KeywordCaptureInput {
  sourceId: string;
  periodStart: string;
  periodEnd: string;
  sourceUpdatedAt: string | null;
  observedAt: string;
  rows: Array<{ keyword: string; rankThisWeek: number; rankLastWeek: number | null; rankDeltaAbsolute?: number | null }>;
}

export interface ChartCaptureInput {
  sourceId: string;
  chartId: string;
  chartKind: MarketChartSnapshot["chartKind"];
  categoryLabel: string | null;
  observedAt: string;
  complete: boolean;
  rows: Array<{ asin: string; chartRank: number | null; price: string | null; title: string | null }>;
}

/** Parses the R0-DATA AMZ123 page-capture format (100-keyword sample shape). */
export function parseAmz123KeywordCapture(input: KeywordCaptureInput, producer: string): MarketKeywordSnapshot {
  const bad = input.rows.filter((r) => !r.keyword || r.rankThisWeek < 1 || r.rankThisWeek > 250_000);
  if (bad.length) throw new Error(`关键词快照含非法行（${bad.length} 条：空词或排名越界）`);
  const dupKw = input.rows.length - new Set(input.rows.map((r) => r.keyword)).size;
  if (dupKw > 0) throw new Error(`关键词快照含重复词（${dupKw} 条）——重复行会让排名变化失真，导入前必须去重`);
  return {
    sourceId: input.sourceId, periodStart: input.periodStart, periodEnd: input.periodEnd,
    sourceUpdatedAt: input.sourceUpdatedAt, observedAt: input.observedAt, producer,
    secondaryDisplay: true, // AMZ123 is an ABA secondary display — frozen in R0-DATA
    rows: input.rows.map((r) => ({
      keyword: r.keyword, rankThisWeek: r.rankThisWeek, rankLastWeek: r.rankLastWeek,
      rankDeltaAbsolute: r.rankDeltaAbsolute ?? (r.rankLastWeek != null ? Math.abs(r.rankLastWeek - r.rankThisWeek) : null),
    })),
  };
}

/** Parses the R0-DATA manual-observation chart capture (ASIN/rank/price/title rows). */
export function parseAmazonChartCapture(input: ChartCaptureInput): MarketChartSnapshot {
  const badAsin = input.rows.filter((r) => !/^[A-Z0-9]{10}$/.test(r.asin ?? ""));
  if (badAsin.length) throw new Error(`榜单快照含非法 ASIN（${badAsin.length} 条）`);
  const periodKey = input.observedAt.slice(0, 10);
  return {
    sourceId: input.sourceId, chartId: input.chartId, chartKind: input.chartKind, marketplace: "US",
    categoryLabel: input.categoryLabel, topN: input.rows.length, complete: input.complete,
    periodKey, observedAt: input.observedAt,
    rows: input.rows.map((r) => ({ asin: r.asin, chartRank: r.chartRank, price: r.price, title: r.title })),
  };
}

/* ------------------------------------------------------------- import engine */

export interface ImportPreview {
  kind: "keywords" | "chart";
  sourceId: string;
  sourceLabel: string;
  permissionOk: boolean;
  refusalReason?: string;
  rows: number;
  identity: string;
  alreadyStored: boolean;
  newSnapshot: boolean;
}

const kwIdentity = (sourceId: string, periodStart: string) => identityKeyFor({ url: `market:kw:${sourceId}:${periodStart}`, title: `关键词快照 ${sourceId} ${periodStart}`, sourceId, via: "fetch" });
const chartIdentity = (chartId: string, periodKey: string) => identityKeyFor({ url: `market:chart:${chartId}:${periodKey}`, title: `榜单快照 ${chartId} ${periodKey}`, sourceId: "market-charts", via: "fetch" });
const productIdentity = (asin: string) => identityKeyFor({ url: `https://www.amazon.com/dp/${asin}`, title: `ASIN ${asin}`, sourceId: "market-products", via: "fetch" });

async function storedRevision(identity: string): Promise<{ id: string; revision: number } | null> {
  const [row] = await sql<{ id: string; revision: number }[]>`SELECT id, revision FROM articles WHERE identity_key = ${identity}`;
  return row ?? null;
}

/** Precheck without writing: permission gate, identity, dedupe status. */
export async function previewMarketImport(input: { kind: "keywords" | "chart"; sourceId: string }): Promise<ImportPreview> {
  const source = await loadMarketSource(input.sourceId);
  const identity = input.kind === "keywords" ? "（快照身份在 apply 时按周期计算）" : "（榜单身份在 apply 时按观察日计算）";
  if (!source) return { kind: input.kind, sourceId: input.sourceId, sourceLabel: input.sourceId, permissionOk: false, refusalReason: "来源未注册", rows: 0, identity, alreadyStored: false, newSnapshot: false };
  if (!source.enabled) return { kind: input.kind, sourceId: input.sourceId, sourceLabel: source.label, permissionOk: false, refusalReason: "来源未启用（操作员未授权运行）", rows: 0, identity, alreadyStored: false, newSnapshot: false };
  if (!sourceAllows(source, "store")) return { kind: input.kind, sourceId: input.sourceId, sourceLabel: source.label, permissionOk: false, refusalReason: "来源许可不含 store 用途", rows: 0, identity, alreadyStored: false, newSnapshot: false };
  return { kind: input.kind, sourceId: input.sourceId, sourceLabel: source.label, permissionOk: true, rows: 0, identity, alreadyStored: false, newSnapshot: false };
}

export interface KeywordImportResult { stored: number; revised: number; productsTouched: number; basisVersion: string; refusal?: string }

/** Applies a keyword snapshot under its source's licence. Idempotent per (source, period). */

/** The market lane's three storage namespaces must exist as source rows (articles FK); they are
    bookkeeping only — enabled=false, never scheduled, never fetched. */
async function ensureStorageSources(): Promise<void> {
  await sql.unsafe(`INSERT INTO sources (id, name, kind, config, tier, first_party, participation_mode, interval_minutes, tags, site_fulltext, syndicate_fulltext, enabled, next_fetch_at)
    VALUES ('market-keywords', '市场关键词快照（存储命名空间）', 'json_list', '{}'::jsonb, 'T2', false, 'isolated', 1440, ARRAY['market'], false, false, false, '2100-01-01'),
           ('market-charts', '市场榜单快照（存储命名空间）', 'json_list', '{}'::jsonb, 'T2', false, 'isolated', 1440, ARRAY['market'], false, false, false, '2100-01-01'),
           ('market-products', '市场商品身份（存储命名空间）', 'json_list', '{}'::jsonb, 'T2', false, 'isolated', 1440, ARRAY['market'], false, false, false, '2100-01-01')
    ON CONFLICT (id) DO NOTHING`);
}

export async function applyKeywordSnapshot(snap: MarketKeywordSnapshot): Promise<KeywordImportResult> {
  await ensureStorageSources();
  const source = await loadMarketSource(snap.sourceId);
  if (source?.revokedAt) {
    return { stored: 0, revised: 0, productsTouched: 0, basisVersion: "", refusal: `来源已于 ${source.revokedAt.slice(0, 10)} 被撤销（${source.revokeReason ?? "未注明"}）——已撤销来源的新导入被拒绝` };
  }
  if (!source?.enabled || !sourceAllows(source, "store")) {
    return { stored: 0, revised: 0, productsTouched: 0, basisVersion: "", refusal: source ? "来源许可不含 store 用途或未启用" : "来源未注册" };
  }
  if (!sourceAllows(source, "compute")) {
    return { stored: 0, revised: 0, productsTouched: 0, basisVersion: "", refusal: "来源许可不含 compute 用途——快照存储与计算是两个独立许可" };
  }
  const identity = kwIdentity(snap.sourceId, snap.periodStart);
  const payload = { kind: "keywords" as const, snapshot: snap, basisVersion: keywordSnapshotBasisVersion(snap) };
  const [existing] = await sql<{ id: string }[]>`SELECT id FROM articles WHERE identity_key = ${identity}`;
  if (existing) {
    const [row] = await sql<{ raw: { market?: { snapshot?: unknown } } | null }[]>`SELECT raw FROM articles WHERE id = ${existing.id}`;
    const changed = stableJson((row?.raw?.market as { snapshot?: unknown })?.snapshot ?? null) !== stableJson(snap);
    await sql`UPDATE articles SET raw = ${sql.json({ market: payload } as never)}::jsonb, updated_at = now() WHERE id = ${existing.id}`;
    return { stored: 0, revised: changed ? 1 : 0, productsTouched: 0, basisVersion: payload.basisVersion };
  }
  await sql`INSERT INTO articles (id, source_id, identity_key, url, title, body_text, body_status, language, published_at, discovered_at, timeline_at, raw, processing_state)
    VALUES (${"mkt" + sha256(identity).slice(0, 24)}, ${"market-keywords"}, ${identity}, ${`market://keywords/${snap.sourceId}/${snap.periodStart}`},
            ${`关键词快照 ${snap.producer} ${snap.periodStart}`}, NULL, 'none', 'zh', ${snap.observedAt}::timestamptz, now(), ${snap.observedAt}::timestamptz,
            ${sql.json({ market: payload } as never)}::jsonb, 'analyzed')`;
  return { stored: 1, revised: 0, productsTouched: 0, basisVersion: payload.basisVersion };
}

export interface ChartImportResult { snapshotStored: number; productsCreated: number; productsUpdated: number; basisVersion: string; refusal?: string }

/**
 * Applies a chart snapshot: stores the snapshot article AND upserts every observed product's
 * identity record (four-way first-seen semantics). Product identity is ASIN-keyed; title changes
 * are attribute observations, never a new product.
 */
export async function applyChartSnapshot(snap: MarketChartSnapshot): Promise<ChartImportResult> {
  await ensureStorageSources();
  const source = await loadMarketSource(snap.sourceId);
  if (source?.revokedAt) {
    return { snapshotStored: 0, productsCreated: 0, productsUpdated: 0, basisVersion: "", refusal: `来源已于 ${source.revokedAt.slice(0, 10)} 被撤销——已撤销来源的新导入被拒绝` };
  }
  if (!source?.enabled || !sourceAllows(source, "store") || !sourceAllows(source, "compute")) {
    return { snapshotStored: 0, productsCreated: 0, productsUpdated: 0, basisVersion: "", refusal: "来源许可不足（store/compute）或未启用" };
  }
  const basisVersion = chartSnapshotBasisVersion(snap);
  const identity = chartIdentity(snap.chartId, snap.periodKey);
  const payload = { kind: "chart" as const, snapshot: snap, basisVersion };
  const [existingSnap] = await sql<{ id: string }[]>`SELECT id FROM articles WHERE identity_key = ${identity}`;
  if (existingSnap) {
    await sql`UPDATE articles SET raw = ${sql.json({ market: payload } as never)}::jsonb, updated_at = now() WHERE id = ${existingSnap.id}`;
  } else {
    await sql`INSERT INTO articles (id, source_id, identity_key, url, title, body_text, body_status, language, published_at, discovered_at, timeline_at, raw, processing_state)
      VALUES (${"mkt" + sha256(identity).slice(0, 24)}, ${"market-charts"}, ${identity}, ${`market://chart/${snap.chartId}/${snap.periodKey}`},
              ${`榜单快照 ${snap.chartId} ${snap.periodKey}`}, NULL, 'none', 'zh', ${snap.observedAt}::timestamptz, now(), ${snap.observedAt}::timestamptz,
              ${sql.json({ market: payload } as never)}::jsonb, 'analyzed')`;
  }
  let created = 0, updated = 0;
  for (const row of snap.rows) {
    const pid = productIdentity(row.asin);
    const [existing] = await sql<{ id: string; raw: { market?: { product?: MarketProductRecord } } | null }[]>`SELECT id, raw FROM articles WHERE identity_key = ${pid}`;
    if (!existing) {
      const product: MarketProductRecord = {
        marketplace: "US", asin: row.asin, parentAsin: null, brand: brandOf(row.title), model: null,
        title: row.title, firstObservedAt: snap.observedAt,
        firstChartedAt: row.chartRank != null ? snap.observedAt : null,
        pageLaunchClaim: null, evidenceBackedLaunch: null,
        chartRanks: row.chartRank != null ? { [snap.chartId]: { rank: row.chartRank, periodKey: snap.periodKey } } : {},
        lastPrice: row.price, categoryLabel: snap.categoryLabel,
      };
      await sql`INSERT INTO articles (id, source_id, identity_key, url, title, body_text, body_status, language, published_at, discovered_at, timeline_at, raw, processing_state)
        VALUES (${"mkt" + sha256(pid).slice(0, 24)}, ${"market-products"}, ${pid}, ${`https://www.amazon.com/dp/${row.asin}`},
                ${row.title ?? `ASIN ${row.asin}`}, NULL, 'none', 'en', ${snap.observedAt}::timestamptz, now(), ${snap.observedAt}::timestamptz,
                ${sql.json({ market: { product } } as never)}::jsonb, 'analyzed')`;
      created += 1;
    } else {
      const prev = existing.raw?.market?.product;
      if (prev) {
        const product: MarketProductRecord = {
          ...prev,
          title: row.title ?? prev.title,
          brand: brandOf(row.title) ?? prev.brand,
          // first-seen stamps are NEVER overwritten once set (master plan C4)
          firstChartedAt: prev.firstChartedAt ?? (row.chartRank != null ? snap.observedAt : null),
          chartRanks: row.chartRank != null ? { ...prev.chartRanks, [snap.chartId]: { rank: row.chartRank, periodKey: snap.periodKey } } : prev.chartRanks,
          lastPrice: row.price ?? prev.lastPrice,
          categoryLabel: snap.categoryLabel ?? prev.categoryLabel,
        };
        await sql`UPDATE articles SET raw = ${sql.json({ market: { product } } as never)}::jsonb, title = ${product.title ?? existing.id}, updated_at = now() WHERE id = ${existing.id}`;
        updated += 1;
      }
    }
  }
  return { snapshotStored: existingSnap ? 0 : 1, productsCreated: created, productsUpdated: updated, basisVersion };
}

/** Rule-based brand guess from a product title's leading brand-like token — marked as derived, never official. */
function brandOf(title: string | null): string | null {
  if (!title) return null;
  const m = /^([A-Za-z][A-Za-z0-9&.'-]*(?:\s+[A-Za-z][A-Za-z0-9&.'-]*)?)\s/.exec(title.trim());
  return m ? m[1]! : null;
}

/* -------------------------------------------------------- generic CSV import */

export interface CsvImportInput {
  kind: "keywords" | "chart";
  csvText: string;
  sourceId: string;
  producer?: string;
  mapping: Record<string, number>;
  periodStart?: string;
  periodEnd?: string;
  sourceUpdatedAt?: string | null;
  observedAt?: string;
  chartId?: string;
  chartKind?: MarketChartSnapshot["chartKind"];
  categoryLabel?: string | null;
  complete?: boolean;
}

export interface CsvImportResult {
  ok: boolean;
  totalParsedRows: number;
  validRowsCount: number;
  duplicateCount: number;
  errorRows: RowValidationError[];
  stored: number;
  revised: number;
  basisVersion?: string;
  refusal?: string;
}

export async function applyCsvImport(input: CsvImportInput): Promise<CsvImportResult> {
  const parsed = parseCsv(input.csvText);
  if (parsed.rows.length === 0) {
    return {
      ok: false,
      totalParsedRows: 0,
      validRowsCount: 0,
      duplicateCount: 0,
      errorRows: [{ line: 1, field: "file", value: "", error: "文件无有效数据行" }],
      stored: 0,
      revised: 0,
      refusal: "CSV 文件解析后没有数据行",
    };
  }

  const now = new Date().toISOString();

  if (input.kind === "keywords") {
    const { validRows, errorRows, duplicateCount } = mapAndValidateKeywordRows(parsed.rows, input.mapping);
    if (validRows.length === 0) {
      return {
        ok: false,
        totalParsedRows: parsed.rows.length,
        validRowsCount: 0,
        duplicateCount,
        errorRows,
        stored: 0,
        revised: 0,
        refusal: "没有通过校验的有效关键词行",
      };
    }
    const observedAt = input.observedAt || (input.periodEnd ? `${input.periodEnd}T12:00:00Z` : now);
    const snap: MarketKeywordSnapshot = {
      sourceId: input.sourceId,
      periodStart: input.periodStart || now.slice(0, 10),
      periodEnd: input.periodEnd || now.slice(0, 10),
      sourceUpdatedAt: input.sourceUpdatedAt ?? null,
      observedAt,
      producer: input.producer || "人工 CSV 导入",
      secondaryDisplay: true,
      rows: validRows,
    };
    const res = await applyKeywordSnapshot(snap);
    return {
      ok: !res.refusal,
      totalParsedRows: parsed.rows.length,
      validRowsCount: validRows.length,
      duplicateCount,
      errorRows,
      stored: res.stored,
      revised: res.revised,
      basisVersion: res.basisVersion,
      refusal: res.refusal,
    };
  } else {
    const { validRows, errorRows, duplicateCount } = mapAndValidateProductRows(parsed.rows, input.mapping);
    if (validRows.length === 0) {
      return {
        ok: false,
        totalParsedRows: parsed.rows.length,
        validRowsCount: 0,
        duplicateCount,
        errorRows,
        stored: 0,
        revised: 0,
        refusal: "没有通过校验的有效商品行",
      };
    }
    const snap: MarketChartSnapshot = {
      sourceId: input.sourceId,
      chartId: input.chartId || `chart-${input.sourceId}`,
      chartKind: input.chartKind || "bestsellers",
      marketplace: "US",
      categoryLabel: input.categoryLabel ?? null,
      topN: validRows.length,
      complete: input.complete ?? true,
      periodKey: (input.observedAt || now).slice(0, 10),
      observedAt: input.observedAt || now,
      rows: validRows.map((r) => ({
        asin: r.asin,
        chartRank: r.chartRank,
        price: r.price,
        title: r.title,
      })),
    };
    const res = await applyChartSnapshot(snap);
    return {
      ok: !res.refusal,
      totalParsedRows: parsed.rows.length,
      validRowsCount: validRows.length,
      duplicateCount,
      errorRows,
      stored: res.snapshotStored,
      revised: res.productsUpdated,
      basisVersion: res.basisVersion,
      refusal: res.refusal,
    };
  }
}

/* ------------------------------------------------------------- source seeding */

/** The two R0-DATA real sources, registered with their honest current permission state. */
export function defaultMarketSources(): MarketSource[] {
  return [
    {
      id: "amz123-us-keywords", kind: "amz123-keywords", label: "AMZ123 美国站热搜词（ABA 二手展示）",
      producer: "Amazon ABA（经 AMZ123 页面二次展示）", marketplace: "US",
      permission: {
        uses: ["store", "compute", "display"],
        basis: "操作员授权（operator grant）：对自己以人工等价方式合法读取的公开页面样本，授予本项目私有研究用途（存储/计算/站内展示）。这不等同于 AMZ123 或 Amazon 授予数据使用权。",
        evidence: "L3",
      },
      unverifiedUses: ["fetch", "modelSend", "export"],
      enabled: true, automation: "manual-import-only",
      notes: "周更；「涨跌幅度」为两周排名绝对位移（R0-DATA 100/100 验证），方向须由两周排名推导；无搜索量列。",
    },
    {
      id: "amazon-chart-manual", kind: "amazon-chart-manual", label: "Amazon 官方榜单·受管人工观察",
      producer: "Amazon（官方 Best Sellers 页面，真实浏览器人工等价观察）", marketplace: "US",
      permission: {
        uses: ["store", "compute", "display"],
        basis: "操作员授权（operator grant）：对自己以真实浏览器人工观察取得的公开页面事实，授予私有研究用途。Amazon 未授予任何自动化采集或再分发许可。",
        evidence: "L3",
      },
      unverifiedUses: ["fetch", "modelSend", "export"],
      enabled: true, automation: "manual-import-only",
      notes: "榜单名次≠销量；榜单自身周期未在页面声明（periodKey=观察日）；无父子/变体信息。",
    },
    {
      id: "sp-api", kind: "api-pending", label: "Amazon SP-API（Catalog Items）",
      producer: "Amazon 官方 API", marketplace: "US",
      permission: { uses: [], basis: "R0-FINAL：无开发者应用与卖家授权（L2 负面）——所有用途关闭", evidence: "L1" },
      enabled: false, automation: "pending-credentials",
      notes: "资格缺口：注册开发者应用+卖家授权（Product Listing 角色）。",
    },
    {
      id: "external-platforms", kind: "external-pending", label: "eBay/Etsy/Walmart 外部平台",
      producer: "各平台官方接口（未接入）", marketplace: "other",
      permission: { uses: [], basis: "R0：三平台 L2 均未核验", evidence: "L1" },
      enabled: false, automation: "blocked-no-license",
    },
  ];
}

export async function seedMarketSources(): Promise<void> {
  for (const s of defaultMarketSources()) {
    const [row] = await sql`SELECT 1 FROM settings WHERE key = ${`market.source.${s.id}`}`;
    if (!row) await saveMarketSource(s);
  }
}
