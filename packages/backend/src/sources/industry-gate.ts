// The industry lane's deterministic admission and classification rules.
//
// Everything here runs on titles (and, for full-permission sources, the feed's own summary). No model
// call decides admission: the rules name what an item is and whether the lane wants it, and every
// verdict keeps its reason so a misjudgement can be audited and fixed. Model assistance only happens
// later, on admitted items, inside the budgeted industry window.
//
// Judged against the 2026-10-25 real-feed sample set (78 items across the four admitted sources).
import { type IndustrySourceId, type IndustryTheme } from "./industry-lane.ts";
import { sha256 } from "../lib/ids.ts";

/** What an item is — sponsorship and paywalled research promos never become research evidence. */
export type IndustryContentKind =
  | "news" | "official-data" | "opinion" | "corporate-personnel" | "earnings"
  | "sponsored" | "research-promo" | "irrelevant";

/** Verdicts an item can receive. Rejected ones keep their reason; nothing is deleted. */
export interface IndustryAdmission {
  admitted: boolean;
  reason: string;
  themes: IndustryTheme[];
  kind: IndustryContentKind;
  /** Non-US market is the item's main subject: recorded, not guessed away. */
  market: "US" | "global" | "non-US";
}

const SPONSORED_MARKERS = /\bsponsored\b|\bpartner content\b|\bpaid post\b|品牌赞助|赞助内容/i;
const RESEARCH_PROMO = /Modern Retail\+|Modern Retail Plus|\bresearch:\s/i;

/** Personnel and governance moves: real news, but not a demand/supply signal worth an event. */
const PERSONNEL = /\b(?:CFO|CEO|COO|CTO|CMO|chief [a-z]+ officer|president of)\b|adds? (?:former )?[a-z-]+ chief|appoints?|names? (?:new )?(?:CFO|CEO|CTO)|joins (?:the )?board|board of directors|exits?\b|taps former/i;
const EARNINGS = /\b(?:Q[1-4] )?(?:earnings|quarterly results|financial results|reports? (?:Q[1-4]|full-year|annual) (?:results|revenue))\b|earnings call/i;

/** Theme lexicons — deliberately narrow: a hit must name the theme's substance, not a vibe. */
const THEME_RULES: Array<{ theme: IndustryTheme; pattern: RegExp }> = [
  { theme: "consumer-demand", pattern: /consumer spending|consumer demand|holiday (?:spending|sales|shopping)|shopper[s]?\b|retail sales|spending (?:rose|grew|fell|shift|slow)|household|purchasing|black friday|cyber monday|halloween spending|back-to-school|consumer confidence|deals? (?:shift|rise|fall)|discounts? (?:drive|deepen)|price sensitive/i },
  { theme: "ecommerce-competition", pattern: /\bAmazon\b|\beBay\b|\bEtsy\b|\bShopify\b|TikTok Shop|marketplace[s]?\b|\bWalmart\b (?:marketplace|connect| Fulfillment)|e-?commerce (?:platform|rival|sales|share|shift)|online sales|direct-to-consumer|\bDTC\b|third-party sellers?\b|seller fees|fulfillment (?:service|network)|AI (?:shopping )?agents?|agentic (?:shopping|AI)|Temu|SHEIN|Alibaba/i },
  { theme: "category-trends", pattern: /store concept|product (?:launch|line|innovation)|new (?:category|products?)|beauty (?:category|sales)|apparel (?:brand|category)|furniture|grocery (?:trend|category)|pet (?:category|sales)|Toy[s]?\b (?:category|sales)|fresh food|frozen food|refrigerated|snack (?:category|sales)|beverage (?:category|innovation)|private label|category (?:trend|shift|growth)/i },
  { theme: "supply-chain-cost", pattern: /supply chain|tariff[s]?\b|freight|transportation services index|logistics|distribution (?:center|network)|warehouse[s]?\b|\bfulfillment\b|\b3PL\b|supplier[s]?\b|\bport[s]?\b|container|cold chain|factory|manufactur(?:ing|er) (?:shift|move)|sourcing|inventory (?:build|cost|cut)|import (?:cost|duties)|customs/i },
  { theme: "economic-data", pattern: /consumer credit|survey of consumer|federal funds|discount rate|fomc|open market committee|economic projection|\bGDP\b|gross domestic product|Personal Income and Outlays|PCE\b|consumer price|inflation (?:report|data|rose|eased)|retail inventories|business inventories|advance report|monthly retail trade|e-commerce report|wholesale (?:trade|inventories)|trade deficit|international trade in goods|jobless claims|unemployment (?:rate|claims)/i },
];

/** Non-US market as the main subject: kept out unless the item also names a US-side effect. */
const NON_US_MARKET = /\bEurope(?:an)?\b|\bUK\b|Britain|Canada(?:a)?n?\b tariffs?\b.*(?:removing|adding)|\bChina(?:'s)?\b (?:consumers?|market)\b|\bIndia\b|\bBrazil\b|\bJapan(?:ese)?\b (?:market|consumers?)|\bAustralia\b/i;
const US_MARKET = /\bUS\b|\bU\.S\.\.?|\bAmerica\b|American\b|United States|Trump|White House|Congress|Fed(?:eral Reserve)?\b|\bCPSC\b|\bFTC\b|Washington/i;

/** Sources whose whole output is a US government agency: the market gate passes by identity. */
const OFFICIAL_SOURCES: readonly string[] = ["industry-bea-news", "industry-frb-press", "industry-bts-news"];

/** The kind an item carries before any theme judgment: sponsor copy never becomes evidence. */
function kindOf(title: string, summary: string): IndustryContentKind {
  if (SPONSORED_MARKERS.test(title) || SPONSORED_MARKERS.test(summary)) return "sponsored";
  if (RESEARCH_PROMO.test(title)) return "research-promo";
  return "news";
}

/**
 * Whether an industry item is admitted, and what it is. Deterministic on purpose: the same title
 * always gets the same verdict, every verdict keeps its reason, and nothing is deleted — a rejected
 * item keeps its row and its reason for later review.
 */
export function industryAdmission(input: {
  sourceId: string;
  title: string;
  summary?: string | null;
  /** The feed's own section tags; a publisher's "Sponsored" label decides before any rule does. */
  categories?: string[];
}): IndustryAdmission {
  const title = input.title ?? "";
  const summary = input.summary ?? "";
  const categories = input.categories ?? [];
  const hay = `${title} ${summary}`;
  const official = OFFICIAL_SOURCES.includes(input.sourceId);

  const categorySponsored = categories.some((c) => /^(sponsored|partner (?:content|post)|paid (?:content|post))$/i.test(c.trim()));
  const categoryResearch = categories.some((c) => /research\+|modern retail\+/i.test(c));
  let kind = kindOf(title, summary);
  if (kind === "news" && categorySponsored) kind = "sponsored";
  if (kind === "news" && categoryResearch) kind = "research-promo";
  if (kind === "news" && PERSONNEL.test(title)) kind = "corporate-personnel";
  if (kind === "news" && EARNINGS.test(title)) kind = "earnings";
  if (official) kind = "official-data";

  const themes = THEME_RULES.filter((rule) => rule.pattern.test(hay)).map((rule) => rule.theme);

  const market: IndustryAdmission["market"] = official
    ? "US"
    : NON_US_MARKET.test(hay) && !US_MARKET.test(hay)
      ? "non-US"
      : US_MARKET.test(hay)
        ? "US"
        : "global";

  // Personnel and governance moves and pure earnings reports are real news but not industry-change
  // signals for this lane's purpose: they stay stored with their kind, out of the research pool.
  if (kind === "corporate-personnel") return { admitted: false, reason: "corporate personnel move, not an industry-change signal", themes, kind, market };
  if (kind === "earnings") return { admitted: false, reason: "single-company earnings report, not an industry signal", themes, kind, market };
  if (kind === "sponsored") return { admitted: false, reason: "sponsor content, never an independent signal", themes, kind, market };
  if (kind === "research-promo") return { admitted: false, reason: "paywalled research promotion, not report content", themes, kind, market };
  if (!themes.length) return { admitted: false, reason: "no industry theme matched", themes, kind, market };
  if (market === "non-US") return { admitted: false, reason: "non-US market is the main subject", themes, kind, market };
  return { admitted: true, reason: "", themes, kind, market };
}

/** The deterministic event fingerprint of an admitted item: theme + subject noun phrase + kind. */
export function industryEventKey(input: { sourceId: string; title: string; themes: IndustryTheme[] }): string {
  const nouns = input.title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word));
  // A title made only of stopwords would give every such article the same bare "theme|" key and
  // wrongly merge them; its title hash keeps the key unique until real wording exists.
  const core = nouns.length ? nouns.slice(0, 6).join(" ") : `title:${sha256(input.title).slice(0, 12)}`;
  return `${input.themes[0] ?? "none"}|${core}`;
}

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "from", "into", "over", "after", "amid", "how", "why", "what",
  "its", "his", "her", "their", "this", "these", "those", "new", "are", "was", "were", "has", "have",
  "will", "would", "could", "says", "said", "amid", "ahead", "behind", "among", "more", "than", "out",
]);
