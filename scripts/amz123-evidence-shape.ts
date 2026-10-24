/** Pure, allow-list-only shaping helpers for AMZ123 delivery evidence. */
export type EvidenceStatus = "pass" | "fail" | "unverified" | "not_requested";
export type JsonRecord = Record<string, unknown>;

const LEAD_FIELDS = [
  "column", "market", "source", "section", "siteTags", "radarTags", "gateVersion",
  "officialRef", "radarRuleIds", "discoveredVia", "effectiveDate", "marketEvidence",
] as const;
const EVENT_FIELDS = ["of", "key", "state", "domain", "titleCore", "officialRef", "effectiveDate"] as const;
const OFFICIAL_FIELDS = ["note", "status", "officialUrl", "officialTitle", "officialPublishedAt"] as const;
const BODY_KEYS = new Set([
  "body", "bodytext", "bodyhtml", "rawbody", "rawtext", "rawhtml", "articlebody", "articletext",
  "articlehtml", "fulltext", "contenttext", "contenthtml", "pagehtml", "pagetext",
]);

export function asRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

export function parseJsonObject(value: unknown): JsonRecord | null {
  if (typeof value === "string") {
    try { return asRecord(JSON.parse(value)); } catch { return null; }
  }
  return asRecord(value);
}

function safeText(value: unknown, max = 500): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length > max || /<!doctype\s+html|<html\b|<body\b/i.test(clean)) return null;
  return clean;
}

function stringArray(value: unknown, maxItems = 50): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.slice(0, maxItems).flatMap((item) => {
    const text = safeText(item, 200);
    return text ? [text] : [];
  });
}

function hasLeadSignature(record: JsonRecord): boolean {
  return !!(
    record.event || record.officialVerification || record.radarRuleIds || record.gateVersion ||
    record.marketEvidence || record.discoveredVia
  );
}

function findLeadRecord(value: unknown, depth = 0): JsonRecord | null {
  if (depth > 7) return null;
  const record = parseJsonObject(value);
  if (!record) return null;
  if (hasLeadSignature(record)) return record;

  const entries = Object.entries(record);
  const preferred = entries.filter(([key]) => /amz123|lead|policySignal/i.test(key));
  for (const [, child] of [...preferred, ...entries.filter((entry) => !preferred.includes(entry))]) {
    const found = findLeadRecord(child, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Extracts only explicitly approved lead metadata. Never serializes the original raw object. */
export function sanitizeLeadMetadata(raw: unknown): JsonRecord | null {
  const record = findLeadRecord(raw);
  if (!record) return null;
  const result: JsonRecord = {};

  for (const key of LEAD_FIELDS) {
    const value = record[key];
    if (key === "siteTags" || key === "radarTags" || key === "radarRuleIds") {
      const items = stringArray(value);
      if (items) result[key] = items;
    } else {
      const text = safeText(value, key === "officialRef" ? 1000 : 300);
      if (text) result[key] = text;
    }
  }

  const event = asRecord(record.event);
  if (event) {
    const safeEvent: JsonRecord = {};
    for (const key of EVENT_FIELDS) {
      const value = event[key];
      if (value === null) safeEvent[key] = null;
      else {
        const text = safeText(value, key === "key" ? 120 : 300);
        if (text) safeEvent[key] = text;
      }
    }
    if (Object.keys(safeEvent).length) result.event = safeEvent;
  }

  const verification = asRecord(record.officialVerification);
  if (verification) {
    const safeVerification: JsonRecord = {};
    for (const key of OFFICIAL_FIELDS) {
      const text = safeText(verification[key], key === "note" ? 500 : 1000);
      if (text) safeVerification[key] = text;
    }
    if (Object.keys(safeVerification).length) result.officialVerification = safeVerification;
  }

  return Object.keys(result).length ? result : null;
}

/** Detect likely body material in raw metadata without returning any of its values. */
export function hasForbiddenRawPayload(value: unknown, depth = 0): boolean {
  if (depth > 12 || value === null || value === undefined) return false;
  const record = asRecord(value);
  if (record) {
    for (const [key, child] of Object.entries(record)) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (BODY_KEYS.has(normalized) && child !== null && child !== undefined && child !== "") return true;
      if (["html", "text", "content"].includes(normalized) && typeof child === "string" && child.trim().length > 300) return true;
      if (hasForbiddenRawPayload(child, depth + 1)) return true;
    }
    return false;
  }
  if (Array.isArray(value)) return value.some((child) => hasForbiddenRawPayload(child, depth + 1));
  return false;
}

function safeError(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  if (clean.length > 220 || /<!doctype\s+html|<html\b|<body\b/i.test(clean)) return "[omitted: long or HTML diagnostic]";
  return clean;
}

function safeNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

function pickNumbers(value: unknown): JsonRecord | null {
  const record = asRecord(value);
  if (!record) return null;
  const output: JsonRecord = {};
  for (const [key, raw] of Object.entries(record)) {
    const n = safeNumber(raw);
    // The rejection reasons are a fixed label set from the collector, and some labels contain a
    // space ("not about Amazon"). Spaces stay allowed; nothing else does.
    if (n !== null && /^[a-zA-Z0-9 _-]{1,80}$/.test(key)) output[key] = n;
  }
  return Object.keys(output).length ? output : null;
}

/** Keep only known diagnostic fields; never copy arbitrary fetch_runs.detail into evidence. */
export function sanitizeDiagnostics(value: unknown): JsonRecord {
  const outer = parseJsonObject(value) ?? {};
  // The live collector stores a round's diagnostics under detail.amz123; the patch's original
  // snapshot put them under detail.diagnostics. Read both, then fall back to the object itself.
  const amz123 = asRecord(outer.amz123);
  const record = asRecord(outer.diagnostics) ?? asRecord(amz123?.diagnostics) ?? amz123 ?? outer;
  const output: JsonRecord = {};
  for (const key of ["leads", "pageReads", "discovered", "alreadyStored", "found", "created", "revised"]) {
    const n = safeNumber(record[key]);
    if (n !== null) output[key] = n;
  }

  const robots = asRecord(record.robots);
  if (robots) {
    const safeRobots: JsonRecord = {};
    for (const key of ["url", "status", "rules"]) {
      const value = robots[key];
      const n = safeNumber(value);
      const text = safeText(value, 1000);
      if (n !== null) safeRobots[key] = n;
      else if (text) safeRobots[key] = text;
    }
    const allowed = stringArray(robots.allowedSections);
    if (allowed) safeRobots.allowedSections = allowed;
    if (Object.keys(safeRobots).length) output.robots = safeRobots;
  }

  const sitemap = asRecord(record.sitemap);
  if (sitemap) {
    const safeSitemap: JsonRecord = {};
    for (const key of ["urls", "known"]) {
      const n = safeNumber(sitemap[key]);
      if (n !== null) safeSitemap[key] = n;
    }
    if (typeof sitemap.fetched === "boolean") safeSitemap.fetched = sitemap.fetched;
    if (Object.keys(safeSitemap).length) output.sitemap = safeSitemap;
  }

  if (Array.isArray(record.listings)) {
    output.listings = record.listings.slice(0, 20).flatMap((item) => {
      const row = asRecord(item);
      if (!row) return [];
      const safe: JsonRecord = {};
      for (const key of ["links", "status", "withTitle"]) {
        const n = safeNumber(row[key]);
        if (n !== null) safe[key] = n;
      }
      const section = safeText(row.section, 100);
      if (section) safe.section = section;
      return Object.keys(safe).length ? [safe] : [];
    });
  }

  if (Array.isArray(record.failures)) {
    output.failures = record.failures.slice(0, 50).flatMap((item) => {
      const row = asRecord(item);
      if (!row) return [];
      const safe: JsonRecord = {};
      const url = safeText(row.url, 1000);
      const error = safeError(row.error);
      if (url) safe.url = url;
      if (error) safe.error = error;
      return Object.keys(safe).length ? [safe] : [];
    });
  }

  const rejected = pickNumbers(record.rejectedReasons);
  if (rejected) output.rejectedReasons = rejected;
  return output;
}

export function sanitizeCursor(value: unknown): JsonRecord | null {
  const cursor = asRecord(value);
  if (!cursor) return null;
  const output: JsonRecord = {};
  // The live source stores the cursor under these names. The patch's original names are kept as
  // the output keys, so the evidence reads the same whichever snapshot produced it.
  const texts: Array<[string, string]> = [
    ["gateVersion", "gateVersion"],
    ["sitemapLastReadAt", "sitemapAt"],
    ["initializedAt", "initializedAt"],
    ["lastOkAt", "lastOkAt"],
  ];
  for (const [outKey, sourceKey] of texts) {
    const text = safeText(cursor[sourceKey], 100);
    if (text) output[outKey] = text;
  }
  const counts: Array<[string, string]> = [
    ["rejectedIdentities", "rejected"],
    ["pendingCandidates", "pending"],
    ["sitemapApprovedUrls", "sitemapUrls"],
  ];
  for (const [outKey, sourceKey] of counts) {
    const raw = cursor[sourceKey];
    const n = Array.isArray(raw) ? raw.length : safeNumber(raw);
    if (typeof n === "number" && Number.isFinite(n)) output[outKey] = n;
  }
  return Object.keys(output).length ? output : null;
}

export function parseWorkerState(statusText: string, kind: "announcements" | "ads" = "announcements"): "running" | "not-running" | "unknown" {
  const relevant = statusText.split(/\r?\n/).filter((line) => kind === "announcements"
    ? /公告\s*Worker|radar-announcements|announcement worker/i.test(line)
    : /Ads.*(?:Worker|调度|采集进程)|ads-policy(?:-daemon)?\.ts/i.test(line));
  if (relevant.length === 0) return "unknown";
  if (relevant.some((line) => /未运行|未启动|not\s+running|stopped|已停止|未持有锁/i.test(line))) return "not-running";
  if (relevant.some((line) => /运行中|running|持有.*锁|锁.*持有/i.test(line))) return "running";
  return "unknown";
}

export function buildVerificationChecks(input: {
  source: { enabled: boolean; participationMode: string; intervalMinutes: number };
  officialCounts: { platform_policy: number; ads_policy: number; external_regulation: number };
  baseline: { platform_policy: number; ads_policy: number; external_regulation: number };
  boundaries: { factArticleLinks: number; storySignals: number; analyses: number; publicPublicationRows: number; bodyLeakArticles: number };
  http: { webStatus: number | null; apiStatus: number | null };
  announcementWorker: "running" | "not-running" | "unknown";
  expectNoWorker: boolean;
}): Array<{ id: string; status: EvidenceStatus; detail: string }> {
  const equalCounts = (Object.keys(input.baseline) as Array<keyof typeof input.baseline>)
    .every((key) => input.baseline[key] === input.officialCounts[key]);
  const check = (id: string, ok: boolean, detail: string): { id: string; status: EvidenceStatus; detail: string } => ({ id, status: ok ? "pass" : "fail", detail });
  return [
    check("source_enabled_and_isolated", input.source.enabled && input.source.participationMode === "isolated", `enabled=${input.source.enabled}; participationMode=${input.source.participationMode}`),
    check("interval_is_360_minutes", input.source.intervalMinutes === 360, `intervalMinutes=${input.source.intervalMinutes}`),
    check("official_family_counts_unchanged", equalCounts, `expected=${JSON.stringify(input.baseline)}; actual=${JSON.stringify(input.officialCounts)}`),
    check("no_fact_article_links", input.boundaries.factArticleLinks === 0, `count=${input.boundaries.factArticleLinks}`),
    check("no_story_signals", input.boundaries.storySignals === 0, `count=${input.boundaries.storySignals}`),
    check("no_analyses", input.boundaries.analyses === 0, `count=${input.boundaries.analyses}`),
    check("no_public_publication_rows", input.boundaries.publicPublicationRows === 0, `count=${input.boundaries.publicPublicationRows}`),
    check("no_body_or_overlong_excerpt_leak", input.boundaries.bodyLeakArticles === 0, `articlesWithStoredBody=${input.boundaries.bodyLeakArticles} (a revision row that only repeats the short excerpt is a metadata snapshot, not a stored body)`),
    check("web_3000_http_200", input.http.webStatus === 200, `status=${input.http.webStatus ?? "unavailable"}`),
    check("api_3001_http_200", input.http.apiStatus === 200, `status=${input.http.apiStatus ?? "unavailable"}`),
    {
      id: "announcement_worker_not_running",
      status: !input.expectNoWorker ? "not_requested" : input.announcementWorker === "not-running" ? "pass" : input.announcementWorker === "running" ? "fail" : "unverified",
      detail: `state=${input.announcementWorker}; asserted=${input.expectNoWorker}`,
    },
  ];
}
