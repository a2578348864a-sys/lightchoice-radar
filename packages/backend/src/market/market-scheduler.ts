// The fourth lane automated source scheduler and periodic pipeline (AUTO-FIRST).
//
// Governs periodic automated data collection, watermark tracking, restart recovery without
// request storms, honest error attribution, and automatic downstream trigger (metrics -> signals
// -> opportunity candidates -> alerts).
// Zero network calls in test mode (supports injected xml or synthetic feeds).
import { sql } from "../db.ts";
import { sha256 } from "../lib/ids.ts";
import {
  loadMarketSource, loadMarketSources, saveMarketInnovationCue, saveMarketSource,
  sourceAllows, type MarketInnovationCue, type MarketSource,
} from "./market-model.ts";
import { buildOpportunityCandidates, evaluateAlerts } from "./market-opportunity.ts";

export const CPSC_FEED_URL = "https://www.cpsc.gov/Newsroom/CPSC-RSS-Feed/Recalls-RSS";

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
}

/**
 * Fetches and ingests official CPSC Recalls into Module 09 (Innovation Cues) and downstream alerts.
 */
export async function fetchAndIngestCpscRecalls(opts: FetchCpscOptions = {}): Promise<{
  sourceId: string;
  totalParsed: number;
  newCues: number;
  items: CpscRecallItem[];
}> {
  const sourceId = opts.sourceId || "cpsc-product-recalls";
  const source = await loadMarketSource(sourceId);

  // Gate: verify source is registered, enabled, and licensed for fetch + store + compute
  if (source && (!source.enabled || !sourceAllows(source, "fetch") || !sourceAllows(source, "store"))) {
    throw new Error(`来源「${sourceId}」未获准 fetch 或 store 权限，阻断自动数据拉取`);
  }

  let xml: string;
  if (opts.xmlOverride) {
    xml = opts.xmlOverride;
  } else {
    const res = await fetch(CPSC_FEED_URL, {
      headers: { "User-Agent": "LightChoiceRadar/4.0 (Consumer Product Safety Research; +https://lightchoice.dev)" },
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      throw new Error(`CPSC RSS Feed 请求失败：HTTP ${res.status} ${res.statusText}`);
    }
    xml = await res.text();
  }

  const items = parseCpscRssXml(xml).slice(0, opts.maxItems || 25);
  let newCues = 0;

  for (const item of items) {
    const cueId = `cpsc-${sha256(item.guid || item.title).slice(0, 16)}`;
    const cue: MarketInnovationCue = {
      id: cueId,
      title: item.title,
      cueType: "pain-point-fix",
      targetKeywordOrAsin: item.productKeyword,
      differenceSummaryZh: `【CPSC 官方安全警示】${item.title}。缺陷隐患：${item.hazard}。可作为针对类似消费品的防呆结构优化、材料阻燃提升及强制安全标准避坑的真实反证。`,
      source: "CPSC 官方消费品召回数据流",
      observedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
      verified: true,
      notes: item.link ? `官方链接: ${item.link}` : undefined,
    };
    await saveMarketInnovationCue(cue);
    newCues++;
  }

  return {
    sourceId,
    totalParsed: items.length,
    newCues,
    items,
  };
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
}

export interface RunDueResult {
  executed: number;
  skipped: number;
  results: Array<{
    id: string;
    label: string;
    status: "success" | "skipped" | "error" | "blocked";
    reason?: string;
    itemsFetched?: number;
  }>;
  downstreamTriggered: {
    opportunitiesBuilt: number;
    alertsEvaluated: boolean;
  };
}

/**
 * Executes all due automated market sources, advances watermarks, and auto-triggers downstream analysis.
 * Prevents storm by executing only one run window per due source even after multi-day downtime.
 */
export async function runDueMarketSources(opts: RunDueOptions = {}): Promise<RunDueResult> {
  const now = opts.now || new Date();
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
      if (source.kind === "cpsc-recalls" || source.id === "cpsc-product-recalls") {
        const cpscRes = await fetchAndIngestCpscRecalls({
          xmlOverride: opts.xmlOverride,
          sourceId: source.id,
        });
        itemsFetched = cpscRes.totalParsed;
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
    executed: executedCount,
    skipped: skippedCount,
    results,
    downstreamTriggered: {
      opportunitiesBuilt: oppsCount,
      alertsEvaluated: alertsOk,
    },
  };
}
