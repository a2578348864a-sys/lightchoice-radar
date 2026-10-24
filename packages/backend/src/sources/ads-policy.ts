// Amazon Ads policy pages: a small, closed set of public documents that only exist after JavaScript
// runs. The hub is a directory — it is read for links only, never stored as a policy record. Each
// sub-page is judged on its own rendered body, and only clause-level advertising rules qualify.
import { classifyRadarText } from "../editorial/radar-rules.ts";
import { renderPages, type RenderedPage } from "./browser-render.ts";
import { FetchError, type Candidate, type SourceRow } from "./types.ts";

export const ADS_POLICY_SOURCE_ID = "ads-policy-pages";
export const ADS_POLICY_ADAPTER = "browser_help";
export const ADS_POLICY_HUB_URL = "https://advertising.amazon.com/help/G29MAQ3YTK5LQ7VC";
/** The only sub-pages this source may store. Anything else the hub links to is out of scope. */
export const ADS_POLICY_PAGE_URLS = [
  "https://advertising.amazon.com/help/G4U9JBZH3664JWX2", // General requirements
  "https://advertising.amazon.com/help/GZS8A5XCFQJTS88N", // Prohibited products and services
] as const;

/** The site chrome every Ads help page repeats before and after the article. */
const CHROME_END_MARK = "Set Billing as your homepage";
const TAIL_MARKS = ["More Help Contact Us", "Was this article helpful?", "© 20"];
/** A real policy page states at least three clause-level rules; a directory page states none of its own. */
const MIN_RULE_CLAUSES = 3;
const MIN_BODY_CHARS = 400;

export function isApprovedAdsPolicySource(source: Pick<SourceRow, "id" | "kind" | "config">): boolean {
  if (source.id !== ADS_POLICY_SOURCE_ID || source.kind !== "web_list") return false;
  const c = source.config;
  if (!c || typeof c !== "object" || Array.isArray(c)) return false;
  if (c.adapter !== ADS_POLICY_ADAPTER || c.url !== ADS_POLICY_HUB_URL) return false;
  const allowed = Array.isArray(c.allowUrlPrefixes) ? [...c.allowUrlPrefixes].sort() : [];
  return allowed.length === ADS_POLICY_PAGE_URLS.length && allowed.every((url, i) => url === [...ADS_POLICY_PAGE_URLS].sort()[i]);
}

/** The article body without the repeated site chrome; the tail markers also drop the footer. */
export function readAdsPolicyBody(renderedText: string): string {
  const start = renderedText.lastIndexOf(CHROME_END_MARK);
  let body = start >= 0 ? renderedText.slice(start + CHROME_END_MARK.length) : renderedText;
  for (const mark of TAIL_MARKS) {
    const at = body.indexOf(mark);
    if (at > MIN_BODY_CHARS / 2) { body = body.slice(0, at); break; }
  }
  return body.replace(/\s+/g, " ").trim();
}

/**
 * The page's own "Updated on" date. It is the source's update time, not a publication date: an Ads
 * help page is a living document, and treating its last edit as the day it was published would put
 * an old policy back on today's list.
 */
export interface AdsPolicyUpdatedAt {
  sourceUpdatedAt: Date | null;
  /** The sentence the date came from, so a reader can check it. */
  evidence: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * "Updated on Jul 22, 2026" is the document's own update date, so it lands in `sourceUpdatedAt`.
 * When it is missing the update time stays unknown: neither the fetch time nor the crawl date is
 * substituted for it, and `publishedAt` stays null either way.
 */
export function readAdsPolicyUpdatedOn(bodyText: string): AdsPolicyUpdatedAt {
  const match = /Updated on ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})/.exec(bodyText);
  if (!match) return { sourceUpdatedAt: null, evidence: null };
  const month = MONTHS.indexOf(match[1]!);
  if (month < 0) return { sourceUpdatedAt: null, evidence: null };
  const day = Number(match[2]);
  const year = Number(match[3]);
  const sourceUpdatedAt = new Date(Date.UTC(year, month, day));
  if (Number.isNaN(sourceUpdatedAt.getTime())) return { sourceUpdatedAt: null, evidence: null };
  return { sourceUpdatedAt, evidence: match[0] };
}

/**
 * A page qualifies only when its own body states several advertising rules. Titles, navigation
 * labels and a single boilerplate sentence are not enough — the hub carries two such sentences.
 */
export function isQualifyingAdsPolicy(bodyText: string | null | undefined): boolean {
  if (!bodyText || bodyText.length < MIN_BODY_CHARS) return false;
  const clauses = classifyRadarText({ title: "", bodyText }).evidence.filter((item) => item.ruleId === "ads-policy" && item.field === "body");
  return clauses.length >= MIN_RULE_CLAUSES;
}

/** Links from the hub that are one of the approved sub-pages, in a stable order. */
export function adsPolicySubPageLinks(hub: RenderedPage): string[] {
  const found = new Set<string>();
  for (const link of hub.links) {
    const href = link.href.split("#")[0];
    if ((ADS_POLICY_PAGE_URLS as readonly string[]).includes(href)) found.add(href);
  }
  return [...found];
}

/**
 * One rendered page as a candidate, or null when its body carries no rule evidence. The page's
 * "Updated on" date is the source's update time: `publishedAt` and `publicationTime` stay null
 * because a help page states no publication date, and the update date must not stand in for one.
 */
export function adsPolicyCandidate(page: RenderedPage): Candidate | null {
  const bodyText = readAdsPolicyBody(page.text);
  if (!isQualifyingAdsPolicy(bodyText)) return null;
  const when = readAdsPolicyUpdatedOn(bodyText);
  return {
    url: page.finalUrl || page.url,
    title: page.h1 || page.title,
    language: "en",
    excerpt: bodyText.slice(0, 300),
    bodyText,
    bodyStatus: "ok",
    sourceUpdatedAt: when.sourceUpdatedAt,
    publishedAt: null,
    publicationTime: null,
  };
}

/**
 * Renders the hub for links, then each approved sub-page, and returns only the pages whose body
 * carries rule evidence. A run with nothing admissible fails visibly instead of reporting success.
 */
export async function fetchAdsPolicyPages(source: SourceRow): Promise<Candidate[]> {
  const [hub] = await renderPages([String(source.config.url)]);
  if (!hub) throw new FetchError("ads policy hub did not render");
  const links = adsPolicySubPageLinks(hub);
  if (links.length === 0) throw new FetchError("ads policy hub exposed no approved sub-pages");

  const pages = await renderPages(links);
  const out = pages.map(adsPolicyCandidate).filter((candidate): candidate is Candidate => candidate !== null);
  if (out.length === 0) throw new FetchError("no approved ads policy page carried rule evidence");
  return out;
}
