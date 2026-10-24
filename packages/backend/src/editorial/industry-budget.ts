// The second lane's own paid-window ledger. Same shape and same guarantees as the translation
// window (editorial/translate-budget.ts) with its own keys: nothing the industry lane spends can
// touch the translation window, and vice versa. Caps, the purpose allowlist and the observation
// expiry live in `settings` under industry.budget — a restart cannot reset them and a later
// environment cannot widen a window that was authorized narrower.
import { sql, type Db } from "../db.ts";
import { config } from "../config.ts";
import { BudgetExceededError } from "../providers/receipts.ts";

const BUDGET_KEY = "industry.budget";
const ROUNDS_KEY = "industry.rounds";
const LEASE_KEY = "industry.lease";
const LEASE_MINUTES = 10;

export interface IndustryLimits {
  maxRequests: number;
  maxArticles: number;
  budgetCny: number;
  expiresAt?: string;
  purposes?: string[];
}

export interface IndustryBudget {
  round: string;
  requests: number;
  articles: string[];
  reservedCny: number;
  spentCny: number;
  promptTokens: number;
  completionTokens: number;
  dayKey: string;
  dayArticles: string[];
  startedAt: string;
  /** When formal observation began (set once at enablement); the expiry is start + 168h. */
  observationStartedAt?: string;
  limits?: IndustryLimits;
}

export interface IndustryRound extends IndustryBudget {
  closedAt: string;
}

const EMPTY: IndustryBudget = {
  round: "", requests: 0, articles: [], reservedCny: 0, spentCny: 0, promptTokens: 0, completionTokens: 0,
  dayKey: "", dayArticles: [], startedAt: new Date(0).toISOString(),
};

function beijingDay(at = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function normalize(value: Partial<IndustryBudget> | null | undefined): IndustryBudget {
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

function limitsOf(budget: IndustryBudget): IndustryLimits {
  return budget.limits ?? {
    maxRequests: config.industry.maxRequests,
    maxArticles: config.industry.maxArticles,
    budgetCny: config.industry.budgetCny,
  };
}

async function load(tx: Db): Promise<IndustryBudget> {
  const [row] = await tx<{ value: Partial<IndustryBudget> }[]>`SELECT value FROM settings WHERE key = ${BUDGET_KEY} FOR UPDATE`;
  const budget = normalize(row?.value);
  const today = beijingDay();
  if (budget.dayKey !== today) {
    budget.dayKey = today;
    budget.dayArticles = [];
  }
  return budget;
}

async function save(tx: Db, budget: IndustryBudget): Promise<void> {
  await tx`INSERT INTO settings (key, value, updated_by) VALUES (${BUDGET_KEY}, ${tx.json(budget as never)}, 'industry')
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

/** Yuan this token count costs at the configured DeepSeek prices. */
export function industryCostOf(promptTokens: number, completionTokens: number): number {
  return (promptTokens / 1_000_000) * config.industry.priceInPerMTokens
    + (completionTokens / 1_000_000) * config.industry.priceOutPerMTokens;
}

export interface IndustryReserveInput {
  articleId: string;
  inputChars: number;
  maxTokens: number;
  purpose?: string;
}

/** Worst-case cost of one request: the whole output ceiling plus one token per three input characters. */
export function estimateIndustryCny(input: { inputChars: number; maxTokens: number }): number {
  return industryCostOf(Math.ceil(input.inputChars / 3) + 300, input.maxTokens);
}

/**
 * Books one industry request before it is sent, or refuses it. The window expiry is checked first:
 * an expired window refuses whether or not requests or money remain, and no later environment can
 * reopen it. A purpose outside the window's allowlist is refused the same way.
 */
export async function reserveIndustryCall(tx: Db, input: IndustryReserveInput): Promise<void> {
  const budget = await load(tx);
  const limits = limitsOf(budget);
  const expiresAt = limits.expiresAt ? Date.parse(limits.expiresAt) : NaN;
  if (Number.isFinite(expiresAt) && Date.now() > expiresAt) throw new BudgetExceededError("llm", "industry-expired", 3600);
  if (limits.purposes?.length && input.purpose && !limits.purposes.includes(input.purpose)) {
    throw new BudgetExceededError("llm", "industry-purpose", 3600);
  }
  if (budget.requests + 1 > limits.maxRequests) throw new BudgetExceededError("llm", "industry-requests", 3600);
  const known = budget.articles.includes(input.articleId);
  if (!known && budget.articles.length + 1 > limits.maxArticles) throw new BudgetExceededError("llm", "industry-articles", 3600);
  const estimate = estimateIndustryCny(input);
  if (budget.spentCny + budget.reservedCny + estimate > limits.budgetCny) throw new BudgetExceededError("llm", "industry-budget", 3600);

  budget.requests += 1;
  if (!known) budget.articles.push(input.articleId);
  budget.reservedCny += estimate;
  if (budget.startedAt === EMPTY.startedAt) budget.startedAt = new Date().toISOString();
  if (!budget.round) budget.round = config.industry.round;
  if (!budget.limits) budget.limits = limits;
  await save(tx, budget);
}

/** Replaces this request's reservation with its actual usage; an unknown outcome keeps the reservation. */
export async function settleIndustryCall(usage: Record<string, unknown> | null | undefined, input: IndustryReserveInput): Promise<void> {
  const promptTokens = Number(usage?.prompt_tokens ?? NaN);
  const completionTokens = Number(usage?.completion_tokens ?? NaN);
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) return;
  const actual = industryCostOf(promptTokens, completionTokens);
  await sql.begin(async (tx) => {
    const budget = await load(tx);
    budget.reservedCny = Math.max(0, budget.reservedCny - estimateIndustryCny(input));
    budget.spentCny += actual;
    budget.promptTokens += promptTokens;
    budget.completionTokens += completionTokens;
    await save(tx, budget);
  });
}

/** Whether this article may still be processed today (scheduled path), reserving its slot when yes. */
export async function reserveIndustryDaySlot(articleId: string): Promise<boolean> {
  return sql.begin(async (tx) => {
    const budget = await load(tx);
    if (budget.dayArticles.includes(articleId)) return true;
    if (budget.dayArticles.length + 1 > config.industry.dayArticles) return false;
    budget.dayArticles.push(articleId);
    await save(tx, budget);
    return true;
  });
}

/** Takes the single-run lease; false when another run holds it. */
export async function claimIndustryRun(): Promise<boolean> {
  const until = new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString();
  const claimed = await sql<{ key: string }[]>`
    INSERT INTO settings (key, value, updated_by) VALUES (${LEASE_KEY}, ${sql.json({ until })}, 'industry')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    WHERE coalesce((settings.value->>'until')::timestamptz, 'epoch') < now()
    RETURNING key`;
  return claimed.length > 0;
}

export async function releaseIndustryRun(): Promise<void> {
  await sql`UPDATE settings SET value = ${sql.json({ until: new Date(0).toISOString() })}, updated_at = now() WHERE key = ${LEASE_KEY}`;
}

/**
 * Stamps formal observation onto the running window: expiresAt = now + 168h, written once. A window
 * that already carries an observation start is never re-stamped, so re-running enablement cannot
 * extend the clock. Construction spend stays in the same pool — nothing is reset or topped up.
 */
export async function startIndustryObservation(): Promise<{ startedAt: string; expiresAt: string } | null> {
  return sql.begin(async (tx) => {
    const budget = await load(tx);
    if (budget.observationStartedAt && budget.limits?.expiresAt) return null;
    const startedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 168 * 3600_000).toISOString();
    budget.observationStartedAt = startedAt;
    budget.limits = { ...limitsOf(budget), expiresAt };
    await save(tx, budget);
    return { startedAt, expiresAt };
  });
}

/** The caps currently in force, for status screens and the read layer's budget line. */
export async function industryBudgetState(): Promise<IndustryBudget> {
  const [row] = await sql<{ value: Partial<IndustryBudget> }[]>`SELECT value FROM settings WHERE key = ${BUDGET_KEY}`;
  return normalize(row?.value);
}

/**
 * Starts (or no-ops onto) the lane's authorization window. The spend of construction and of the
 * observation is one pool: starting the same round name twice changes nothing, and a finished window
 * is archived under industry.rounds, never erased.
 */
export async function startIndustryRound(round: string, limits?: IndustryLimits): Promise<{ archived: IndustryRound | null; current: IndustryBudget }> {
  const caps = limits ?? {
    maxRequests: config.industry.maxRequests,
    maxArticles: config.industry.maxArticles,
    budgetCny: config.industry.budgetCny,
    purposes: [...config.industry.purposes],
  };
  return sql.begin(async (tx) => {
    const [row] = await tx<{ value: Partial<IndustryBudget> }[]>`SELECT value FROM settings WHERE key = ${BUDGET_KEY} FOR UPDATE`;
    const current = normalize(row?.value);
    if (current.round === round) return { archived: null, current };
    let archived: IndustryRound | null = null;
    const spent = current.requests > 0 || current.spentCny > 0 || current.articles.length > 0;
    if (spent) {
      archived = { ...current, limits: limitsOf(current), closedAt: new Date().toISOString() };
      const [roundsRow] = await tx<{ value: IndustryRound[] | null }[]>`SELECT value FROM settings WHERE key = ${ROUNDS_KEY} FOR UPDATE`;
      const rounds = Array.isArray(roundsRow?.value) ? roundsRow.value : [];
      if (!rounds.some((r) => r.round === archived!.round)) rounds.push(archived);
      await tx`INSERT INTO settings (key, value, updated_by) VALUES (${ROUNDS_KEY}, ${tx.json(rounds as never)}, 'industry')
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    }
    const fresh: IndustryBudget = { ...EMPTY, round, limits: caps, startedAt: new Date().toISOString(), dayKey: beijingDay() };
    await save(tx, fresh);
    return { archived, current: fresh };
  });
}

export async function industryRoundsState(): Promise<IndustryBudget[]> {
  const [row] = await sql<{ value: IndustryRound[] | null }[]>`SELECT value FROM settings WHERE key = ${ROUNDS_KEY}`;
  const finished = Array.isArray(row?.value) ? row.value : [];
  const current = await industryBudgetState();
  return [...finished, current];
}
