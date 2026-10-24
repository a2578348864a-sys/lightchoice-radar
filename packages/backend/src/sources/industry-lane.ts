// The second lane's registry: what the industry lane is, which sources may feed it, and what each
// source is allowed to be used for.
//
// The lane covers US consumer & e-commerce industry dynamics across five fixed themes. It is not a
// general news reader: an item earns a place only when it states something a seller could research
// further — a demand shift, a channel or competitive move, a category signal, a supply-chain or cost
// change, or an official economic release. Corporate personnel moves, sponsor copy and non-US market
// news are recognised and kept out of the research pool.
//
// Permissions are per source and per use. A publisher offering a public RSS feed has not thereby
// licensed saving excerpts, model processing or on-site display; each of the four uses is judged on
// its own evidence and a use without evidence stays closed ("full" vs "metadata-only" below).
export const INDUSTRY_SOURCE_IDS = [
  "industry-bea-news",
  "industry-retail-dive",
  "industry-supply-chain-dive",
  "industry-modern-retail",
] as const;

export type IndustrySourceId = (typeof INDUSTRY_SOURCE_IDS)[number];

/** The five fixed themes of the second lane. Order is the display order. */
export const INDUSTRY_THEMES = [
  "consumer-demand",
  "ecommerce-competition",
  "category-trends",
  "supply-chain-cost",
  "economic-data",
] as const;

export type IndustryTheme = (typeof INDUSTRY_THEMES)[number];

export const INDUSTRY_THEME_LABEL: Record<IndustryTheme, string> = {
  "consumer-demand": "消费需求变化",
  "ecommerce-competition": "电商渠道与竞争",
  "category-trends": "品类趋势与创新",
  "supply-chain-cost": "供应链与成本",
  "economic-data": "美国经济数据",
};

/** What a source may be used for, judged per use on recorded evidence. */
export interface IndustrySourceProfile {
  id: IndustrySourceId;
  publisher: string;
  /** Verified basis: the URL the permission judgment rests on, and the date it was checked. */
  basisUrl: string;
  verifiedAt: string;
  /** Discovery: the publisher's own public feed, robots-allowed. Every admitted source has this. */
  discovery: true;
  /** Saving the feed's own summary text. "full" = public-domain source; "metadata-only" = not evidenced. */
  saveExcerpt: boolean;
  /** Sending material to DeepSeek. Public-domain government work only, on current evidence. */
  modelProcessing: boolean;
  /** Displaying source-provided text on site pages (beyond title + link + attribution). */
  displayContent: boolean;
}

/**
 * The permission profiles. BEA is a U.S. government work (17 U.S.C. § 105): discovery, metadata,
 * summaries, model processing and display are all public-domain uses of its own releases. The three
 * trade media keep all rights reserved with no RSS licence evidenced (Informa TechTarget terms of use
 * verified 2026-10-25: content may not be reproduced without written permission; no RSS clause): they
 * are admitted for discovery and factual metadata only — title, link, date, source — never excerpt
 * storage, never model processing, never content display.
 */
export const INDUSTRY_SOURCES: Record<IndustrySourceId, IndustrySourceProfile> = {
  "industry-bea-news": {
    id: "industry-bea-news",
    publisher: "U.S. Bureau of Economic Analysis",
    basisUrl: "https://www.bea.gov (U.S. government work, public domain)",
    verifiedAt: "2026-10-25",
    discovery: true, saveExcerpt: true, modelProcessing: true, displayContent: true,
  },
  "industry-retail-dive": {
    id: "industry-retail-dive",
    publisher: "Retail Dive (Industry Dive / Informa TechTarget)",
    basisUrl: "https://www.informatechtarget.com/terms-of-use/",
    verifiedAt: "2026-10-25",
    discovery: true, saveExcerpt: false, modelProcessing: false, displayContent: false,
  },
  "industry-supply-chain-dive": {
    id: "industry-supply-chain-dive",
    publisher: "Supply Chain Dive (Industry Dive / Informa TechTarget)",
    basisUrl: "https://www.informatechtarget.com/terms-of-use/",
    verifiedAt: "2026-10-25",
    discovery: true, saveExcerpt: false, modelProcessing: false, displayContent: false,
  },
  "industry-modern-retail": {
    id: "industry-modern-retail",
    publisher: "Modern Retail (Breaking Media)",
    basisUrl: "https://www.modernretail.co/terms-conditions/ (no RSS licence clause evidenced)",
    verifiedAt: "2026-10-25",
    discovery: true, saveExcerpt: false, modelProcessing: false, displayContent: false,
  },
};

export function isApprovedIndustrySourceId(id: string): id is IndustrySourceId {
  return (INDUSTRY_SOURCE_IDS as readonly string[]).includes(id);
}

/** A re-checked source row is the lane's only when the id and the enabled flag both hold. */
export function isApprovedIndustrySource(row: { id: string; enabled?: boolean } | null | undefined): boolean {
  return !!row?.enabled && isApprovedIndustrySourceId(row.id);
}

/** Sources whose summaries may be stored, model-processed and displayed (public-domain basis only). */
export function industryFullPermissionSources(): string[] {
  return Object.values(INDUSTRY_SOURCES).filter((s) => s.modelProcessing && s.saveExcerpt).map((s) => s.id);
}

/** The instance-lock role key of the industry worker (distinct from every other role). */
export const INDUSTRY_LOCK_KEY = 7_204_229_005;
/** The private schedule queue the industry worker owns (never the shared cron.sources.schedule). */
export const INDUSTRY_SCHEDULE_QUEUE = "cron.radar.industry.schedule";
