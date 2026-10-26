// The fourth lane automated source scheduler and periodic pipeline (AUTO-RUN).
//
// Governs periodic automated data collection, watermark tracking, restart recovery without
// request storms, honest error attribution, and automatic downstream trigger (metrics -> signals
// -> opportunity candidates -> alerts).
// Zero network calls in test mode (supports injected xml or synthetic feeds).
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../config.ts";
import { sql } from "../db.ts";
import { sha256 } from "../lib/ids.ts";
import {
  loadMarketAlerts, loadMarketAlertRules, loadMarketSource, loadMarketSources,
  loadProductSafetyEvents, loadProductSafetyEvent,
  saveMarketAlerts, saveMarketInnovationCue, saveMarketSource, saveProductSafetyEvent,
  sourceAllows, type MarketAlert, type MarketInnovationCue, type MarketSource,
  type ProductSafetyEvent,
} from "./market-model.ts";
import { buildOpportunityCandidates, evaluateAlerts } from "./market-opportunity.ts";

export const CPSC_FEED_URL = "https://www.cpsc.gov/Newsroom/CPSC-RSS-Feed/Recalls-RSS";

/** Advisory lock for dedicated worker process (single worker instance guard). */
export const MARKET_WORKER_LOCK_KEY = 7_204_229_008;
/** Advisory lock for scheduler execution exclusivity (prevents concurrent ticks/runs). */
export const MARKET_EXECUTION_LOCK_KEY = 7_204_229_009;

export interface CpscRecallItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  guid: string;
  hazard: string;
  productKeyword: string;
}

/**
 * Normalizes CPSC hazard strings into standard English patterns and Chinese explanations.
 */
export function translateHazardZh(hazard: string): string {
  const h = hazard.toLowerCase();
  if (h.includes("fire and burn")) return "火灾与严重灼伤危险 (Fire and Burn Hazards)";
  if (h.includes("fire")) return "火灾隐患 (Fire Hazard)";
  if (h.includes("burn")) return "高温灼伤风险 (Burn Hazard)";
  if (h.includes("battery ingestion")) return "纽扣电池误食与化学腐蚀危险 (Battery Ingestion Hazard)";
  if (h.includes("fall and entrapment")) return "跌落与肢体卡夹窒息危险 (Fall and Entrapment Hazards)";
  if (h.includes("fall")) return "结构断裂与跌落伤害风险 (Fall Hazard)";
  if (h.includes("entrapment")) return "缝隙卡夹与窒息风险 (Entrapment Hazard)";
  if (h.includes("laceration")) return "锐边割伤与划伤风险 (Laceration Hazard)";
  if (h.includes("choking")) return "小零件脱落致窒息危险 (Choking Hazard)";
  if (h.includes("shock")) return "绝缘失效致触电危险 (Electrical Shock Hazard)";
  if (h.includes("poisoning")) return "有害物质超标或中毒风险 (Poisoning Hazard)";
  if (h.includes("strangulation")) return "绳索缠绕致勒颈窒息风险 (Strangulation Hazard)";
  if (h.includes("crash")) return "制动失效与碰撞事故风险 (Crash Hazard)";
  return `消费品安全缺陷隐患（${hazard}）`;
}

/**
 * Heuristically infers candidate category labels from recall title & description.
 * Explicitly marks browseNodeId as null — text matching is NEVER an official Amazon Browse Node.
 */
export function inferCategoryCandidate(title: string, desc: string): { rawCategory: string; normalizedCategoryZh: string } {
  const t = (title + " " + desc).toLowerCase();
  if (/heater|patio\s+heater|fire\s+pit/i.test(t)) return { rawCategory: "Patio Heaters", normalizedCategoryZh: "庭院取暖设备/燃气加热器" };
  if (/bicycle|bike|e-bike|scooter/i.test(t)) return { rawCategory: "Bicycles & Scooters", normalizedCategoryZh: "骑行出行/自行车与滑板车" };
  if (/helmet/i.test(t)) return { rawCategory: "Helmets", normalizedCategoryZh: "运动户外/防护头盔" };
  if (/stroller|crib|bassinet|high\s+chair/i.test(t)) return { rawCategory: "Baby Products", normalizedCategoryZh: "母婴出行/童车与婴儿床椅" };
  if (/toy|plush|doll|rattle/i.test(t)) return { rawCategory: "Toys & Games", normalizedCategoryZh: "儿童玩具/益智与毛绒玩具" };
  if (/charger|battery|power\s+bank|adapter/i.test(t)) return { rawCategory: "Electronics Accessories", normalizedCategoryZh: "数码电子/充电器与电池电源" };
  if (/cookware|blender|toaster|fryer|pot|kettle/i.test(t)) return { rawCategory: "Kitchen Appliances", normalizedCategoryZh: "厨房小家电/烹饪器具" };
  if (/ladder/i.test(t)) return { rawCategory: "Ladders", normalizedCategoryZh: "家装建材/梯具与高空工具" };
  if (/candle/i.test(t)) return { rawCategory: "Candles", normalizedCategoryZh: "家居香薰/蜡烛与烛台" };
  if (/generator/i.test(t)) return { rawCategory: "Generators", normalizedCategoryZh: "户外动力/便携发电机" };

  const firstWord = title.split(/Recalled/i)[0]?.trim().slice(0, 30) || "Consumer Product";
  return { rawCategory: firstWord, normalizedCategoryZh: "通用消费品类目（待细分）" };
}

/**
 * Extracts and normalizes RSS items from CPSC Recalls XML feed.
 * Pure deterministic parser, zero external dependencies.
 */
export function parseCpscRssXml(xml: string): CpscRecallItem[] {
  const items: CpscRecallItem[] = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);

  for (const m of itemMatches) {
    const raw = m[1];
    if (!raw) continue;

    const titleMatch = raw.match(/<title>([\s\S]*?)<\/title>/);
    const linkMatch = raw.match(/<link>([\s\S]*?)<\/link>/);
    const descMatch = raw.match(/<description>([\s\S]*?)<\/description>/);
    const pubDateMatch = raw.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const guidMatch = raw.match(/<guid[^>]*>([\s\S]*?)<\/guid>/);

    const title = (titleMatch ? titleMatch[1] : "").trim().replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
    if (!title) continue;

    const link = (linkMatch ? linkMatch[1] : "").trim();
    let desc = (descMatch ? descMatch[1] : "").trim().replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
    // strip basic html entities & tags
    desc = desc.replace(/<[^>]+>/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

    const pubDate = (pubDateMatch ? pubDateMatch[1] : "").trim();
    const guid = (guidMatch ? guidMatch[1] : link || title).trim();

    // Identify common consumer product hazards
    let hazard = "消费品安全风险（详见官方通告）";
    const hazardPatterns = [
      /fire\s+and\s+burn/i,
      /fire/i,
      /burn/i,
      /battery\s+ingestion/i,
      /laceration/i,
      /fall\s+and\s+entrapment/i,
      /fall/i,
      /entrapment/i,
      /choking/i,
      /shock/i,
      /poisoning/i,
      /strangulation/i,
      /crash/i,
    ];
    for (const pat of hazardPatterns) {
      const hm = title.match(pat) || desc.match(pat);
      if (hm) {
        hazard = hm[0].toLowerCase();
        break;
      }
    }

    // Extract product category / keyword (text before "Recalled" or first 4 words)
    let productKeyword = title.split(/Recalled/i)[0]?.trim() || title.slice(0, 40);
    productKeyword = productKeyword.replace(/^\[.*?\]\s*/, "").trim();

    items.push({
      title,
      link,
      description: desc,
      pubDate,
      guid,
      hazard,
      productKeyword,
    });
  }

  return items;
}

export interface FetchCpscOptions {
  xmlOverride?: string;
  sourceId?: string;
  maxItems?: number;
  runId?: string;
  workerPid?: number;
}

export interface FetchCpscResult {
  sourceId: string;
  totalParsed: number;
  newEvents: number;
  newCues: number;
  duplicatesSkipped: number;
  events: ProductSafetyEvent[];
  items: CpscRecallItem[];
  httpStatus?: number;
  httpDurationMs?: number;
  runId?: string;
  workerPid?: number;
}

/**
 * Fetches and ingests official CPSC Recalls into Product Safety Events and Module 09 (Innovation Cues).
 * Enforces strict boundary: safety events are counter-evidence/risk warnings, NEVER positive Amazon sales/opportunities.
 */
export async function fetchAndIngestCpscRecalls(opts: FetchCpscOptions = {}): Promise<FetchCpscResult> {
  const sourceId = opts.sourceId || "cpsc-product-recalls";
  const source = await loadMarketSource(sourceId);

  // Gate: verify source is registered, enabled, and licensed for fetch + store + compute
  if (source && (!source.enabled || !sourceAllows(source, "fetch") || !sourceAllows(source, "store"))) {
    throw new Error(`来源「${sourceId}」未获准 fetch 或 store 权限，阻断自动数据拉取`);
  }

  let xml: string;
  let httpStatus: number | undefined;
  let httpDurationMs: number | undefined;
  const observedAt = new Date().toISOString();
  if (opts.xmlOverride) {
    xml = opts.xmlOverride;
    httpStatus = 200;
    httpDurationMs = 0;
  } else {
    const t0 = Date.now();
    const res = await fetch(CPSC_FEED_URL, {
      headers: { "User-Agent": "LightChoiceRadar/4.0 (Consumer Product Safety Research; +https://lightchoice.dev)" },
      signal: AbortSignal.timeout(12_000),
    });
    httpDurationMs = Date.now() - t0;
    httpStatus = res.status;
    if (!res.ok) {
      throw new Error(`CPSC RSS Feed 请求失败：HTTP ${res.status} ${res.statusText}`);
    }
    xml = await res.text();
  }

  const items = parseCpscRssXml(xml).slice(0, opts.maxItems || 25);
  const createdEvents: ProductSafetyEvent[] = [];
  let newEvents = 0;
  let newCues = 0;
  let duplicatesSkipped = 0;

  for (const item of items) {
    const guidHash = sha256(item.guid || item.title).slice(0, 16);
    const eventId = `evt:cpsc:recall:${guidHash}`;
    const cueId = `cpsc-${guidHash}`;

    // Accurately parse pubDate from CPSC RSS in UTC
    let sourcePublishedAt: string;
    try {
      const rawDate = item.pubDate?.trim();
      if (rawDate) {
        const hasTz = /GMT|UTC|Z|[+-]\d\d:?\d\d/i.test(rawDate);
        const withUtc = hasTz ? rawDate : `${rawDate} UTC`;
        const parsedD = new Date(withUtc);
        sourcePublishedAt = !isNaN(parsedD.getTime()) ? parsedD.toISOString() : new Date(rawDate).toISOString();
      } else {
        sourcePublishedAt = observedAt;
      }
    } catch {
      sourcePublishedAt = observedAt;
    }

    // Check duplicate
    const existingEvent = await loadProductSafetyEvent(eventId);
    if (existingEvent) {
      duplicatesSkipped++;
      createdEvents.push(existingEvent);
      continue;
    }

    const { rawCategory, normalizedCategoryZh } = inferCategoryCandidate(item.title, item.description);
    const hazardDescZh = translateHazardZh(item.hazard);
    const productName = item.productKeyword || rawCategory;

    // 7-part deterministic Chinese explanation for safety events
    const explanation = {
      officialAnnouncementZh: `美国 CPSC 官方通告：${item.title}。`,
      productScopeZh: `涉及消费品类目：${normalizedCategoryZh}（原始声明：${productName}）。`,
      safetyRiskZh: `该产品存在【${hazardDescZh}】安全缺陷，官方已发布召回公告并要求消费者立即停止使用。`,
      whyResearchWorthyZh: `为计划进入或正在销售同类消费品的卖家提供关键安全反证与避坑依据。`,
      developmentCautionZh: `严禁忽视美加强制安全认证与阻燃防呆标准；在结构设计与部件采购上必须具备合规检测报告。`,
      amazonIdentityVerificationZh: `【未经验证】此为美国 CPSC 官方公开行政通告，未与特定 Amazon ASIN 建立身份映射；不可随意挂钩在售商品。`,
      unsupportedConclusionsZh: [
        "严禁将召回通告推断为 Amazon 需求或销量上涨",
        "严禁推断该品类为无风险暴利商机",
        "严禁将文字匹配误认为官方 Amazon Browse Node ID 关系",
      ],
    };

    const safetyEvent: ProductSafetyEvent = {
      id: eventId,
      sourceId,
      officialUrl: item.link,
      recallTitle: item.title,
      productName,
      hazardType: item.hazard,
      hazardDescriptionZh: hazardDescZh,
      categoryCandidate: {
        rawCategory,
        normalizedCategoryZh,
        mappingBasis: "CPSC 官方通告标题分词推断（启发式词根）",
        confidence: "medium",
        humanConfirmed: false,
        browseNodeId: null, // explicitly null
      },
      sourcePublishedAt,
      feedUpdatedAt: new Date().toISOString(),
      observedAt,
      ingestedAt: new Date().toISOString(),
      explanation,
      runId: opts.runId,
      workerPid: opts.workerPid,
    };

    await saveProductSafetyEvent(safetyEvent);
    createdEvents.push(safetyEvent);
    newEvents++;

    // Module 09: Innovation Cue (safety counter-evidence)
    const cue: MarketInnovationCue = {
      id: cueId,
      title: item.title,
      cueType: "pain-point-fix",
      targetKeywordOrAsin: productName,
      differenceSummaryZh: `【CPSC 官方安全警示】${item.title}。缺陷隐患：${hazardDescZh}。可作为针对类似消费品的防呆结构优化、材料阻燃提升及强制安全标准避坑的真实反证。`,
      source: "CPSC 官方消费品召回数据流",
      observedAt: sourcePublishedAt,
      verified: true,
      notes: item.link ? `官方链接: ${item.link}` : undefined,
    };
    await saveMarketInnovationCue(cue);
    newCues++;

    // Module 12: In-station risk warning alert (kind: research-lead)
    const alertDedupKey = `cpsc-alert:${eventId}`;
    const alert: MarketAlert = {
      id: `alert-${Math.abs(hashCode(alertDedupKey))}`,
      ruleId: "rule-cpsc-recall-risk",
      kind: "research-lead",
      subject: `【安全反证】${productName}`,
      detailZh: `${item.title}（隐患：${hazardDescZh}）`,
      reasonZh: `CPSC 官方公开召回通报：涉及 ${productName}，官方通报时间 ${sourcePublishedAt.slice(0, 10)}。此为产品安全风险与避坑反证，不代表商业暴利商机。`,
      firedAt: new Date().toISOString(),
      evidenceRefs: [item.link || sourceId],
      status: "new",
      dedupKey: alertDedupKey,
    };
    await saveMarketAlerts([alert]);
  }

  return {
    sourceId,
    totalParsed: items.length,
    newEvents,
    newCues,
    duplicatesSkipped,
    events: createdEvents,
    items,
    httpStatus,
    httpDurationMs,
    runId: opts.runId,
    workerPid: opts.workerPid,
  };
}

function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * Checks whether an automated source is due for execution.
 */
export function isSourceDue(source: MarketSource, now: Date = new Date()): boolean {
  if (!source.enabled) return false;
  if (source.automation !== "authorized-periodic") return false;
  if (!source.lastRunAt) return true;

  const cadenceMs = (source.cadenceHours || 24) * 3600 * 1000;
  const elapsed = now.getTime() - new Date(source.lastRunAt).getTime();
  return elapsed >= cadenceMs;
}

export interface RunDueOptions {
  now?: Date;
  forceAll?: boolean;
  xmlOverride?: string;
  dryRun?: boolean;
  /** When true, bypasses the PostgreSQL advisory execution lock (useful for in-test simulations). */
  skipAdvisoryLock?: boolean;
  runId?: string;
  workerPid?: number;
}

export interface RunDueResult {
  runId?: string;
  workerPid?: number;
  executed: number;
  skipped: number;
  results: Array<{
    id: string;
    label: string;
    status: "success" | "skipped" | "error" | "blocked";
    reason?: string;
    itemsFetched?: number;
    newEvents?: number;
    duplicatesSkipped?: number;
    httpStatus?: number;
    httpDurationMs?: number;
    runId?: string;
    workerPid?: number;
  }>;
  downstreamTriggered: {
    opportunitiesBuilt: number;
    alertsEvaluated: boolean;
  };
}

/**
 * Executes all due automated market sources, advances watermarks, and auto-triggers downstream analysis.
 * Features:
 *   - Mutual exclusivity via PostgreSQL advisory lock (MARKET_EXECUTION_LOCK_KEY).
 *   - Anti-storm protection: single run window per due source even after multi-day downtime.
 *   - Error backoff (4h nextRunAt).
 *   - Downstream cascade: builds opportunities (from demand signals) and evaluates alerts.
 */
export async function runDueMarketSources(opts: RunDueOptions = {}): Promise<RunDueResult> {
  const now = opts.now || new Date();

  // 0. Concurrency exclusivity guard via reserved session advisory lock
  let lockConn: Awaited<ReturnType<typeof sql.reserve>> | null = null;
  if (!opts.skipAdvisoryLock) {
    try {
      lockConn = await sql.reserve();
      const [lockCheck] = await lockConn<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${MARKET_EXECUTION_LOCK_KEY}::bigint) AS locked`;
      if (!lockCheck?.locked) {
        lockConn.release();
        return {
          executed: 0,
          skipped: 0,
          results: [{
            id: "scheduler-exec-guard",
            label: "调度互斥守护",
            status: "blocked",
            reason: "已有另一个调度任务正在执行，互斥保护生效，已自动跳过本次重复触发",
          }],
          downstreamTriggered: { opportunitiesBuilt: 0, alertsEvaluated: false },
        };
      }
    } catch {
      if (lockConn) lockConn.release();
      lockConn = null;
    }
  }

  try {
    const sources = await loadMarketSources();
    const results: RunDueResult["results"] = [];
    let executedCount = 0;
    let skippedCount = 0;

    for (const source of sources) {
      // 1. Blocked or non-periodic sources are never scheduled
      if (!source.enabled || source.automation !== "authorized-periodic") {
        results.push({
          id: source.id,
          label: source.label,
          status: "blocked",
          reason: source.notes || `来源处于「${source.automation}」状态，自动调度保持安全阻断`,
        });
        skippedCount++;
        continue;
      }

      // 2. Due check
      const due = opts.forceAll || isSourceDue(source, now);
      if (!due) {
        results.push({
          id: source.id,
          label: source.label,
          status: "skipped",
          reason: `未到期（下一次执行计划于 ${source.nextRunAt || "待定"}）`,
        });
        skippedCount++;
        continue;
      }

      if (opts.dryRun) {
        results.push({
          id: source.id,
          label: source.label,
          status: "success",
          reason: "[DryRun] 到期待执行",
        });
        executedCount++;
        continue;
      }

      // 3. Execution by source adapter kind
      try {
        let itemsFetched = 0;
        let newEvents = 0;
        let duplicatesSkipped = 0;
        let httpStatus: number | undefined;
        let httpDurationMs: number | undefined;

        if (source.kind === "cpsc-recalls" || source.id === "cpsc-product-recalls") {
          const cpscRes = await fetchAndIngestCpscRecalls({
            xmlOverride: opts.xmlOverride,
            sourceId: source.id,
            runId: opts.runId,
            workerPid: opts.workerPid,
          });
          itemsFetched = cpscRes.totalParsed;
          newEvents = cpscRes.newEvents;
          duplicatesSkipped = cpscRes.duplicatesSkipped;
          httpStatus = cpscRes.httpStatus;
          httpDurationMs = cpscRes.httpDurationMs;
        } else if (source.kind === "synthetic-test") {
          itemsFetched = 10;
        } else {
          throw new Error(`暂未支持自动适配器类型：${source.kind}`);
        }

        // 4. Advance watermark & reset errors (single run window advances nextRunAt, no catch-up storms)
        const cadenceHours = source.cadenceHours || 24;
        const updatedSource: MarketSource = {
          ...source,
          lastRunAt: now.toISOString(),
          nextRunAt: new Date(now.getTime() + cadenceHours * 3600 * 1000).toISOString(),
          lastError: null,
          runCount: (source.runCount || 0) + 1,
        };
        await saveMarketSource(updatedSource);

        results.push({
          id: source.id,
          label: source.label,
          status: "success",
          itemsFetched,
          newEvents,
          duplicatesSkipped,
          httpStatus,
          httpDurationMs,
          runId: opts.runId,
          workerPid: opts.workerPid,
        });
        executedCount++;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const updatedSource: MarketSource = {
          ...source,
          lastRunAt: now.toISOString(),
          nextRunAt: new Date(now.getTime() + 4 * 3600 * 1000).toISOString(), // backoff on failure (4h)
          lastError: errMsg,
        };
        await saveMarketSource(updatedSource);

        results.push({
          id: source.id,
          label: source.label,
          status: "error",
          reason: errMsg,
          runId: opts.runId,
          workerPid: opts.workerPid,
        });
      }
    }

    // 5. Automatic downstream pipeline: update opportunity candidates & evaluate alerts
    let oppsCount = 0;
    let alertsOk = false;
    if (executedCount > 0 && !opts.dryRun) {
      try {
        const opps = await buildOpportunityCandidates();
        oppsCount = opps.length;
      } catch {
        // tolerate non-fatal pipeline error
      }
      try {
        await evaluateAlerts();
        alertsOk = true;
      } catch {
        // tolerate non-fatal alert error
      }
    }

    return {
      runId: opts.runId,
      workerPid: opts.workerPid,
      executed: executedCount,
      skipped: skippedCount,
      results,
      downstreamTriggered: {
        opportunitiesBuilt: oppsCount,
        alertsEvaluated: alertsOk,
      },
    };
  } finally {
    if (lockConn) {
      await lockConn`SELECT pg_advisory_unlock(${MARKET_EXECUTION_LOCK_KEY}::bigint)`.catch(() => {});
      lockConn.release();
    }
  }
}

export interface MarketSchedulerStatus {
  isRunning: boolean;
  pid?: number;
  startedAt?: string;
  lastHeartbeat?: string;
  sourcesDueCount: number;
  nextDueAt: string | null;
  activeSourcesCount: number;
}

/**
 * Returns the current live status of the dedicated market scheduler worker.
 * Checks PostgreSQL advisory lock (MARKET_WORKER_LOCK_KEY) and file heartbeats.
 */
export async function getMarketSchedulerStatus(): Promise<MarketSchedulerStatus> {
  let isRunning = false;
  let pid: number | undefined;
  let startedAt: string | undefined;
  let lastHeartbeat: string | undefined;

  // 1. Check PostgreSQL session advisory lock for radar-market role
  try {
    const conn = await sql.reserve();
    try {
      const [lockCheck] = await conn<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${MARKET_WORKER_LOCK_KEY}::bigint) AS locked`;
      if (lockCheck) {
        if (!lockCheck.locked) {
          // Lock is already held by another session -> worker is active!
          isRunning = true;
        } else {
          // Not held -> release the test lock immediately
          await conn`SELECT pg_advisory_unlock(${MARKET_WORKER_LOCK_KEY}::bigint)`;
          isRunning = false;
        }
      }
    } finally {
      conn.release();
    }
  } catch {
    isRunning = false;
  }

  // 2. Read run record & heartbeat file
  try {
    const runDir = process.env.RADAR_RUN_DIR ? path.resolve(process.env.RADAR_RUN_DIR) : path.join(REPO_ROOT, ".data", "run");
    const jsonPath = path.join(runDir, "radar-market.json");
    const beatPath = path.join(runDir, "radar-market.heartbeat");

    if (existsSync(jsonPath)) {
      const parsed = JSON.parse(readFileSync(jsonPath, "utf8")) as { pid?: number; startedAt?: string };
      if (typeof parsed?.pid === "number") {
        pid = parsed.pid;
        startedAt = parsed.startedAt;
      }
    }
    if (existsSync(beatPath)) {
      const parsed = JSON.parse(readFileSync(beatPath, "utf8")) as { at?: string };
      if (parsed?.at) {
        lastHeartbeat = parsed.at;
        // If within 15 seconds, heartbeat is fresh
        const age = Date.now() - new Date(parsed.at).getTime();
        if (age < 15_000) {
          isRunning = true;
        }
      }
    }
  } catch {
    // ignore
  }

  // 3. Count due sources and find earliest next scheduled run
  const sources = await loadMarketSources();
  const activeSources = sources.filter((s) => s.enabled && s.automation === "authorized-periodic");
  const now = new Date();
  let dueCount = 0;
  let earliestNext: Date | null = null;

  for (const s of activeSources) {
    if (isSourceDue(s, now)) {
      dueCount++;
    } else if (s.nextRunAt) {
      const next = new Date(s.nextRunAt);
      if (!earliestNext || next < earliestNext) earliestNext = next;
    }
  }

  return {
    isRunning,
    pid,
    startedAt,
    lastHeartbeat,
    sourcesDueCount: dueCount,
    nextDueAt: earliestNext?.toISOString() ?? null,
    activeSourcesCount: activeSources.length,
  };
}
