// Caps for the one paid capability this deployment may use (DeepSeek translation).
//
// The limits are a stored fact, not a process counter: they live in `settings` under translate.budget,
// so a restart, a second process or a re-run cannot reset them. Every request is reserved inside the
// receipt transaction before the network call — requests, distinct articles, and a worst-case token
// estimate against the money bound. A request that would exceed any of them is refused before it is
// sent, rather than reported after the fact.
import { sql, type Db } from "../db.ts";
import { config } from "../config.ts";
import { BudgetExceededError } from "../providers/receipts.ts";

const BUDGET_KEY = "translate.budget";
/** One archived window per authorization round: the spend of a finished round is never erased. */
const ROUNDS_KEY = "translate.rounds";
/** One translation run at a time across processes; a crashed run's lease simply runs out. */
const LEASE_KEY = "translate.lease";
const LEASE_MINUTES = 10;

export interface RoundLimits {
  maxRequests: number;
  maxArticles: number;
  budgetCny: number;
  /** When the window stops authorizing paid calls (ISO). An expired window refuses before any check on counts. */
  expiresAt?: string;
  /** The purposes this window may pay for; absent means the deployment's usual gate applies. */
  purposes?: string[];
}

export interface TranslationBudget {
  /** Identifier of the window now running; empty for the window R45 started. */
  round: string;
  /** Requests sent in this authorization window. */
  requests: number;
  /** Distinct article ids in this window. */
  articles: string[];
  /** Money reserved for requests that have not reported usage yet (conservative: never released on failure). */
  reservedCny: number;
  spentCny: number;
  promptTokens: number;
  completionTokens: number;
  /** Beijing calendar day and the distinct articles translated on it (scheduled path). */
  dayKey: string;
  dayArticles: string[];
  startedAt: string;
  /** The caps this window was authorized with, so a later environment cannot silently widen them. */
  limits?: RoundLimits;
}

/** A finished window, kept for the record: its own caps, its own spend, its own article list. */
export interface TranslationRound extends TranslationBudget {
  closedAt: string;
}

const EMPTY: TranslationBudget = {
  round: "", requests: 0, articles: [], reservedCny: 0, spentCny: 0, promptTokens: 0, completionTokens: 0,
  dayKey: "", dayArticles: [], startedAt: new Date(0).toISOString(),
};

/** The Beijing date of an instant, as YYYY-MM-DD (a day boundary is local, not UTC). */
function beijingDay(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function normalize(value: Partial<TranslationBudget> | null | undefined): TranslationBudget {
  return {
    ...EMPTY,
    ...value,
    articles: Array.isArray(value?.articles) ? value.articles : [],
    dayArticles: Array.isArray(value?.dayArticles) ? value.dayArticles : [],
    requests: Number(value?.requests ?? 0),
    reservedCny: Number(value?.reservedCny ?? 0),
    spentCny: Number(value?.spentCny ?? 0),
  };
}

/** The caps of the running window: the ones it was authorized with, else the environment's. */
function limitsOf(budget: TranslationBudget): RoundLimits {
  return budget.limits ?? {
    maxRequests: config.translate.maxRequests,
    maxArticles: config.translate.maxArticles,
    budgetCny: config.translate.budgetCny,
  };
}

async function load(tx: Db): Promise<TranslationBudget> {
  const [row] = await tx<{ value: Partial<TranslationBudget> }[]>`SELECT value FROM settings WHERE key = ${BUDGET_KEY} FOR UPDATE`;
  const budget = normalize(row?.value);
  const today = beijingDay();
  if (budget.dayKey !== today) {
    budget.dayKey = today;
    budget.dayArticles = [];
  }
  return budget;
}

async function save(tx: Db, budget: TranslationBudget): Promise<void> {
  await tx`INSERT INTO settings (key, value, updated_by) VALUES (${BUDGET_KEY}, ${tx.json(budget as never)}, 'translate')
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

/** Yuan this token count costs at the configured prices. */
export function costOf(promptTokens: number, completionTokens: number): number {
  return (promptTokens / 1_000_000) * config.translate.priceInPerMTokens
    + (completionTokens / 1_000_000) * config.translate.priceOutPerMTokens;
}

export interface ReserveInput {
  articleId: string;
  /** Characters sent to the model (the user message); counted conservatively as one token per 3. */
  inputChars: number;
  /** The request's output ceiling. */
  maxTokens: number;
  /** The purpose this call would bill (e.g. translate_title), checked against the window's allowlist. */
  purpose?: string;
}

/**
 * Worst-case cost of one request: the whole output ceiling plus a deliberately pessimistic input
 * estimate (one token per three characters). Used both when booking and when settling, so the
 * reservation is released exactly.
 */
export function estimateCny(input: { inputChars: number; maxTokens: number }): number {
  return costOf(Math.ceil(input.inputChars / 3) + 300, input.maxTokens);
}

/**
 * Books one request before it is sent, or refuses it. Throws BudgetExceededError (nothing is sent, no
 * receipt is written) when a window cap or the money bound would be crossed.
 */
export async function reserveTranslationCall(tx: Db, input: ReserveInput): Promise<void> {
  const budget = await load(tx);
  const limits = limitsOf(budget);
  // The window's own expiry comes first: a later environment cannot re-open it by widening counts,
  // and an expired window refuses whether or not it has requests or money left.
  const expiresAt = limits.expiresAt ? Date.parse(limits.expiresAt) : NaN;
  if (Number.isFinite(expiresAt) && Date.now() > expiresAt) throw new BudgetExceededError("llm", "translate-expired", 3600);
  // A window authorized for specific purposes pays for those only; any other purpose is refused
  // before it could reach a receipt row.
  if (limits.purposes?.length && input.purpose && !limits.purposes.includes(input.purpose)) {
    throw new BudgetExceededError("llm", "translate-purpose", 3600);
  }
  if (budget.requests + 1 > limits.maxRequests) throw new BudgetExceededError("llm", "translate-requests", 3600);
  const known = budget.articles.includes(input.articleId);
  if (!known && budget.articles.length + 1 > limits.maxArticles) throw new BudgetExceededError("llm", "translate-articles", 3600);
  if (!input.articleId && budget.articles.length + 1 > limits.maxArticles) throw new BudgetExceededError("llm", "translate-articles", 3600);
  const estimate = estimateCny(input);
  if (budget.spentCny + budget.reservedCny + estimate > limits.budgetCny) throw new BudgetExceededError("llm", "translate-budget", 3600);

  budget.requests += 1;
  if (!known) budget.articles.push(input.articleId);
  budget.reservedCny += estimate;
  if (budget.startedAt === EMPTY.startedAt) budget.startedAt = new Date().toISOString();
  if (!budget.round) budget.round = config.translate.round;
  if (!budget.limits) budget.limits = limits;
  await save(tx, budget);
}

/**
 * Replaces this request's reservation with its actual usage. Never releases money on a failed request:
 * the provider may have billed it, so an unknown outcome keeps its reservation (the conservative side).
 */
export async function settleTranslationCall(usage: Record<string, unknown> | null | undefined, input: ReserveInput): Promise<void> {
  const promptTokens = Number(usage?.prompt_tokens ?? NaN);
  const completionTokens = Number(usage?.completion_tokens ?? NaN);
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) return;
  const actual = costOf(promptTokens, completionTokens);
  await sql.begin(async (tx) => {
    const budget = await load(tx);
    // Exactly the reservation this request booked; a failed earlier request keeps its own.
    budget.reservedCny = Math.max(0, budget.reservedCny - estimateCny(input));
    budget.spentCny += actual;
    budget.promptTokens += promptTokens;
    budget.completionTokens += completionTokens;
    await save(tx, budget);
  });
}

/** Fails a call as "budget" without sending it (used by the run-level day cap). */
export function translationDayCapReached(): Error {
  return new BudgetExceededError("llm", "translate-day", 3600);
}

/** Whether this article may still be translated today (scheduled path), reserving its slot when yes. */
export async function reserveDaySlot(articleId: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    const budget = await load(tx);
    if (budget.dayArticles.includes(articleId)) return true;
    if (budget.dayArticles.length + 1 > config.translate.dayArticles) return false;
    budget.dayArticles.push(articleId);
    await save(tx, budget);
    return true;
  });
}

/** Takes the single-run lease; false when another run holds it. */
export async function claimTranslationRun(): Promise<boolean> {
  const until = new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString();
  const claimed = await sql<{ key: string }[]>`
    INSERT INTO settings (key, value, updated_by) VALUES (${LEASE_KEY}, ${sql.json({ until })}, 'translate')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    WHERE coalesce((settings.value->>'until')::timestamptz, 'epoch') < now()
    RETURNING key`;
  return claimed.length > 0;
}

export async function releaseTranslationRun(): Promise<void> {
  await sql`UPDATE settings SET value = ${sql.json({ until: new Date(0).toISOString() })}, updated_at = now() WHERE key = ${LEASE_KEY}`;
}

/** What the caps currently hold, for reports and the admin's operations view. */
export async function translationBudgetState(): Promise<TranslationBudget> {
  const [row] = await sql<{ value: Partial<TranslationBudget> }[]>`SELECT value FROM settings WHERE key = ${BUDGET_KEY}`;
  return normalize(row?.value);
}

/**
 * Starts a new authorization window. The running window is archived whole — its caps, its spend, its
 * tokens, its article list, the time it ran — under translate.rounds, and a fresh window with the
 * caps the environment now names starts counting from zero. Nothing is erased: receipts keep their
 * rows, the archived window keeps its numbers, and a later environment cannot widen a finished
 * window retroactively. Running it twice with the same round name is a no-op.
 */
export async function startTranslationRound(round: string, limits?: RoundLimits): Promise<{ archived: TranslationRound | null; current: TranslationBudget }> {
  const caps = limits ?? { maxRequests: config.translate.maxRequests, maxArticles: config.translate.maxArticles, budgetCny: config.translate.budgetCny };
  return sql.begin(async (tx) => {
    const [row] = await tx<{ value: Partial<TranslationBudget> }[]>`SELECT value FROM settings WHERE key = ${BUDGET_KEY} FOR UPDATE`;
    const current = normalize(row?.value);
    if (current.round === round) return { archived: null, current };
    let archived: TranslationRound | null = null;
    const spent = current.requests > 0 || current.spentCny > 0 || current.articles.length > 0;
    if (spent) {
      // A window started before rounds existed (R45) is archived with the caps it was authorized with.
      const capsOfThatWindow = current.limits ?? { maxRequests: 20, maxArticles: 8, budgetCny: 3 };
      archived = { ...current, limits: capsOfThatWindow, closedAt: new Date().toISOString() };
      const [roundsRow] = await tx<{ value: TranslationRound[] | null }[]>`SELECT value FROM settings WHERE key = ${ROUNDS_KEY} FOR UPDATE`;
      const rounds = Array.isArray(roundsRow?.value) ? roundsRow.value : [];
      if (!rounds.some((r) => (r.round || "r45") === (archived!.round || "r45"))) rounds.push(archived);
      await tx`INSERT INTO settings (key, value, updated_by) VALUES (${ROUNDS_KEY}, ${tx.json(rounds as never)}, 'translate')
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    }
    const fresh: TranslationBudget = { ...EMPTY, round, limits: caps, startedAt: new Date().toISOString(), dayKey: beijingDay() };
    await save(tx, fresh);
    return { archived, current: fresh };
  });
}

/** Every window ever run, finished ones first, with the running one last (it has no closedAt yet). */
export async function translationRoundsState(): Promise<TranslationBudget[]> {
  const [row] = await sql<{ value: TranslationRound[] | null }[]>`SELECT value FROM settings WHERE key = ${ROUNDS_KEY}`;
  const finished = Array.isArray(row?.value) ? row.value : [];
  const current = await translationBudgetState();
  return [...finished, current];
}

/** Everything the money side has to report: per window and in total, from stored state only. */
export async function translationSpendSummary(): Promise<{ rounds: TranslationBudget[]; totalRequests: number; totalArticles: number; totalSpentCny: number; totalPromptTokens: number; totalCompletionTokens: number }> {
  const rounds = await translationRoundsState();
  const totalRequests = rounds.reduce((sum, r) => sum + r.requests, 0);
  const totalArticles = new Set(rounds.flatMap((r) => r.articles)).size;
  const totalSpentCny = rounds.reduce((sum, r) => sum + r.spentCny, 0);
  const totalPromptTokens = rounds.reduce((sum, r) => sum + r.promptTokens, 0);
  const totalCompletionTokens = rounds.reduce((sum, r) => sum + r.completionTokens, 0);
  return { rounds, totalRequests, totalArticles, totalSpentCny, totalPromptTokens, totalCompletionTokens };
}
