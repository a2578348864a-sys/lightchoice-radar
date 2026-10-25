// The consumer-voice Stack Exchange client and thread parser.
//
// Access policy: the official api.stackexchange.com is free and keyless (300 requests/day/IP per
// its throttle docs) and is the ONLY channel this adapter uses — the site's own HTML and RSS feeds
// sit behind a WAF that answers 403 to non-browser clients, and this project does not spoof.
// Every network call is additionally guarded: the source row must be enabled (registered with the
// operator's authorisation) AND the study must name it. Nothing here runs from page loads.
import type { VocAuthorRole, VocMaterialForm, VocThread, VocThreadAnswer } from "./voc-model.ts";

export const VOC_COFFEE_SE_SOURCE_ID = "voc-coffee-se";
const API = "https://api.stackexchange.com/2.3";

interface SeUser {
  user_id?: number;
  display_name?: string;
  reputation?: number;
  user_type?: string;
}

interface SeComment {
  comment_id: number;
  body: string;
  body_markdown?: string;
  owner?: SeUser;
  score?: number;
  content_license?: string;
}

interface SeAnswer {
  answer_id: number;
  score: number;
  is_accepted?: boolean;
  body: string;
  owner?: SeUser;
  content_license?: string;
  comments?: SeComment[];
}

interface SeQuestion {
  question_id: number;
  title: string;
  body: string;
  tags?: string[];
  creation_date: number;
  last_activity_date: number;
  owner?: SeUser;
  content_license?: string;
  answers?: SeAnswer[];
  comments?: SeComment[];
}

/** Role from what the API shows: SE gives reputation/type, never a market or a location. */
function roleOf(owner: SeUser | undefined, isAskerThread: boolean): VocAuthorRole {
  if (!owner?.user_type) return "unknown";
  // The question's owner is the person asking; answers/comments are peers unless marked moderator.
  if (owner.user_type === "moderator") return "peer";
  return isAskerThread ? "consumer" : "peer";
}

/** Stack Exchange dates arrive as epoch seconds. */
const isoOf = (epoch?: number) => (epoch ? new Date(epoch * 1000).toISOString() : new Date(0).toISOString());

/** Maps a raw API question (with `filter=withbody`) into the preserved thread structure. */
export function parseSeQuestion(q: SeQuestion): VocThread {
  // The asker's own follow-up: their comments on their question, in order.
  const askerId = q.owner?.user_id;
  const askerFollowUp = (q.comments ?? [])
    .filter((c) => c.owner?.user_id === askerId && c.owner?.user_id !== undefined)
    .map((c) => c.body)
    .join("\n") || undefined;
  const answers: VocThreadAnswer[] = (q.answers ?? []).map((a) => ({
    id: a.answer_id,
    score: a.score,
    isAccepted: !!a.is_accepted,
    authorRole: roleOf(a.owner, false),
    body: a.body,
    contentLicense: a.content_license ?? undefined,
    comments: (a.comments ?? []).map((c) => ({ id: c.comment_id, body: c.body, authorRole: roleOf(c.owner, c.owner?.user_id === askerId), contentLicense: c.content_license ?? undefined })),
  }));
  return {
    questionId: q.question_id,
    title: q.title,
    body: q.body,
    tags: q.tags ?? [],
    authorRole: roleOf(q.owner, true),
    createdAt: isoOf(q.creation_date),
    lastActivityAt: isoOf(q.last_activity_date),
    contentLicense: q.content_license ?? undefined,
    answers,
    comments: (q.comments ?? []).map((c) => ({ id: c.comment_id, body: c.body, authorRole: roleOf(c.owner, c.owner?.user_id === askerId), contentLicense: c.content_license ?? undefined })),
    askerFollowUp,
  };
}

/**
 * Whether a thread actually resolved the asker's problem. An accepted answer is only the asker's
 * pick; resolution needs the asker's own words confirming it (a follow-up comment that says so).
 * The caller never sees "accepted = solved".
 */
export function resolutionStatusOf(thread: VocThread): "solved-candidate" | "unsolved" | "undetermined" {
  if (!thread.askerFollowUp) return "undetermined";
  const f = thread.askerFollowUp.toLowerCase();
  const confirmed = /(worked|solved|fixed|it works|problem (is )?gone|no longer|resolved|thank(s| you)[^.]*(work|solve|fix))/.test(f);
  const refuted = /(didn'?t work|still (broken|happening|clog|noisy)|same problem|not fixed|gave up|return(ed|ing) it)/.test(f);
  if (confirmed && !refuted) return "solved-candidate";
  if (refuted && !confirmed) return "unsolved";
  return "undetermined";
}

/** Material form for a whole-thread record: a question with its discussion. */
export function formOfThread(): VocMaterialForm {
  return "question";
}

export interface SeFetchGuard {
  /** The operator-side gate: the source row must be enabled and named by an active study. */
  (sourceId: string, studyIds: string[]): Promise<{ allowed: boolean; reason: string }>;
}

export interface SeClientOptions {
  guard: SeFetchGuard;
  /** Keyless default: 300/day per IP; a registered key raises it. */
  key?: string;
  fetchImpl?: typeof fetch;
}

/**
 * One search page of question ids for a study's terms. Free text OR-tag composition mirrors how SE
 * search works; the study's exclude words are applied client-side so the query stays honest.
 */
export async function seSearchQuestionIds(
  terms: { positive: string[]; neutral: string[]; negative: string[]; exclude: string[] },
  site: string,
  opts: SeClientOptions,
  studyIds: string[],
  pages = 1,
  /** Increment mode: creation-ordered discovery from a watermark, optionally scoped to a tag.
      `taggedOnly` mirrors how the initial collection discovered questions (tag-scoped, no free
      text) — a study's full term list as `q` would AND-match everything into zero results. */
  search?: { sort?: "activity" | "creation" | "votes"; minEpoch?: number; tagged?: string; taggedOnly?: boolean },
): Promise<{ ids: number[]; quotaRemaining: number; backoff?: number }> {
  const gate = await opts.guard(VOC_COFFEE_SE_SOURCE_ID, studyIds);
  if (!gate.allowed) throw new Error(`stack-exchange access not authorised: ${gate.reason}`);
  const all = [...new Set([...terms.positive, ...terms.neutral, ...terms.negative].filter(Boolean))];
  if (!all.length && !search?.tagged) throw new Error("a study needs at least one search term");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ids: number[] = [];
  let quotaRemaining = -1;
  let backoff: number | undefined;
  for (let page = 1; page <= pages; page++) {
    const url = new URL(`${API}/search/advanced`);
    url.searchParams.set("order", "desc");
    url.searchParams.set("sort", search?.sort ?? "activity");
    if (search?.minEpoch) url.searchParams.set("min", String(search.minEpoch));
    if (search?.tagged) url.searchParams.set("tagged", search.tagged);
    url.searchParams.set("site", site);
    if (all.length && !search?.taggedOnly) url.searchParams.set("q", all.join(" "));
    url.searchParams.set("pagesize", "100");
    url.searchParams.set("page", String(page));
    if (opts.key) url.searchParams.set("key", opts.key);
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (res.status === 400) throw new Error("stack-exchange rejected the query");
    if (res.status === 429) throw new Error("stack-exchange backoff demanded; stopping");
    if (!res.ok) throw new Error(`stack-exchange HTTP ${res.status}`);
    const body = (await res.json()) as { items?: SeQuestion[]; quota_remaining?: number; backoff?: number };
    if (body.backoff) backoff = body.backoff;
    if (typeof body.quota_remaining === "number") quotaRemaining = body.quota_remaining;
    for (const item of body.items ?? []) ids.push(item.question_id);
  }
  return { ids: [...new Set(ids)], quotaRemaining, backoff };
}

/** Full threads (question + answers + comments, with bodies) for the given ids. */
export async function seFetchThreads(
  questionIds: number[],
  site: string,
  opts: SeClientOptions,
  studyIds: string[],
): Promise<{ threads: VocThread[]; quotaRemaining: number }> {
  const gate = await opts.guard(VOC_COFFEE_SE_SOURCE_ID, studyIds);
  if (!gate.allowed) throw new Error(`stack-exchange access not authorised: ${gate.reason}`);
  if (!questionIds.length) return { threads: [], quotaRemaining: -1 };
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = new URL(`${API}/questions/${questionIds.join(";")}?order=desc&sort=activity&site=${site}`);
  // withbody + answers + comments in one filter shape (the standard "everything" filter id).
  url.searchParams.set("filter", "!nNPvSNVZJSyOa"); // question body, answers with body, comments
  if (opts.key) url.searchParams.set("key", opts.key);
  const res = await fetchImpl(url, { headers: { accept: "application/json" } });
  if (res.status === 429) throw new Error("stack-exchange backoff demanded; stopping");
  if (!res.ok) throw new Error(`stack-exchange HTTP ${res.status}`);
  const body = (await res.json()) as { items?: SeQuestion[]; quota_remaining?: number };
  const threads = (body.items ?? []).map(parseSeQuestion);
  return { threads, quotaRemaining: body.quota_remaining ?? -1 };
}

/** The attribution line CC BY-SA requires on every stored, displayed or exported thread. */
export function seAttribution(thread: VocThread, site: string): string {
  return `CC BY-SA 4.0 · coffee community (${site}) · https://${site}.com/q/${thread.questionId}`;
}
