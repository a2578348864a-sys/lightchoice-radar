// The third lane's (consumer voice) own paid-window ledger — same shape and guarantees as the
// industry lane's, with its own settings keys. Environment defaults DENY (0 caps): funding happens
// only when the operator explicitly starts a window with real caps. Nothing here can touch the
// translation or industry lanes' ledgers.
import { sql, type Db } from "../db.ts";
import { config } from "../config.ts";
import { BudgetExceededError } from "../providers/receipts.ts";

const BUDGET_KEY = "voc.budget";
const ROUNDS_KEY = "voc.rounds";
const LEASE_KEY = "voc.lease";
const LEASE_MINUTES = 10;

export interface VocLimits {
  maxRequests: number;
  maxArticles: number;
  budgetCny: number;
  expiresAt?: string;
  purposes?: string[];
}

export interface VocBudget {
  round: string;
  requests: number;
  articles: string[];
  reservedCny: number;
  spentCny: number;
  promptTokens: number;
  completionTokens: number;
  startedAt: string;
  limits?: VocLimits;
}

export interface VocRound extends VocBudget {
  closedAt: string;
}

const EMPTY: VocBudget = {
  round: "", requests: 0, articles: [], reservedCny: 0, spentCny: 0, promptTokens: 0, completionTokens: 0, startedAt: new Date(0).toISOString(),
};

function normalize(value: Partial<VocBudget> | null | undefined): VocBudget {
  return {
    ...EMPTY,
    ...value,
    articles: Array.isArray(value?.articles) ? value.articles : [],
    requests: Number(value?.requests ?? 0),
    reservedCny: Number(value?.reservedCny ?? 0),
    spentCny: Number(value?.spentCny ?? 0),
  };
}

function limitsOf(budget: VocBudget): VocLimits {
  return budget.limits ?? {
    maxRequests: config.voc.maxRequests,
    maxArticles: config.voc.maxArticles,
    budgetCny: config.voc.budgetCny,
    purposes: [...config.voc.purposes],
  };
}

async function load(tx: Db): Promise<VocBudget> {
  const [row] = await tx<{ value: Partial<VocBudget> }[]>`SELECT value FROM settings WHERE key = ${BUDGET_KEY} FOR UPDATE`;
  return normalize(row?.value);
}

async function save(tx: Db, budget: VocBudget): Promise<void> {
  await tx`INSERT INTO settings (key, value, updated_by) VALUES (${BUDGET_KEY}, ${tx.json(budget as never)}, 'voc')
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}

export function vocCostOf(promptTokens: number, completionTokens: number): number {
  return (promptTokens / 1_000_000) * config.voc.priceInPerMTokens
    + (completionTokens / 1_000_000) * config.voc.priceOutPerMTokens;
}

export interface VocReserveInput {
  articleId: string;
  inputChars: number;
  maxTokens: number;
  purpose?: string;
}

/** Worst-case cost: the whole output ceiling plus one token per three input characters. */
export function estimateVocCny(input: { inputChars: number; maxTokens: number }): number {
  return vocCostOf(Math.ceil(input.inputChars / 3) + 300, input.maxTokens);
}

/**
 * Books one VOC request before it is sent, or refuses it. With no window, an expired window, a
 * purpose outside the window's allowlist, or exhausted caps, the call refuses before any network
 * activity. The environment defaults deny (0 caps): an unfunded lane refuses here.
 */
export async function reserveVocCall(tx: Db, input: VocReserveInput): Promise<void> {
  const budget = await load(tx);
  const limits = limitsOf(budget);
  const expiresAt = limits.expiresAt ? Date.parse(limits.expiresAt) : NaN;
  if (Number.isFinite(expiresAt) && Date.now() > expiresAt) throw new BudgetExceededError("llm", "voc-expired", 3600);
  if (limits.purposes?.length && input.purpose && !limits.purposes.includes(input.purpose)) {
    throw new BudgetExceededError("llm", "voc-purpose", 3600);
  }
  if (budget.requests + 1 > limits.maxRequests) throw new BudgetExceededError("llm", "voc-requests", 3600);
  const known = budget.articles.includes(input.articleId);
  if (!known && budget.articles.length + 1 > limits.maxArticles) throw new BudgetExceededError("llm", "voc-articles", 3600);
  const estimate = estimateVocCny(input);
  if (budget.spentCny + budget.reservedCny + estimate > limits.budgetCny) throw new BudgetExceededError("llm", "voc-budget", 3600);

  budget.requests += 1;
  if (!known) budget.articles.push(input.articleId);
  budget.reservedCny += estimate;
  if (budget.startedAt === EMPTY.startedAt) budget.startedAt = new Date().toISOString();
  if (!budget.round) budget.round = config.voc.round;
  if (!budget.limits) budget.limits = limits;
  await save(tx, budget);
}

/** Settles with actual usage; an unknown outcome keeps its reservation (the conservative side). */
export async function settleVocCall(usage: Record<string, unknown> | null | undefined, input: VocReserveInput): Promise<void> {
  const promptTokens = Number(usage?.prompt_tokens ?? NaN);
  const completionTokens = Number(usage?.completion_tokens ?? NaN);
  if (!Number.isFinite(promptTokens) || !Number.isFinite(completionTokens)) return;
  const actual = vocCostOf(promptTokens, completionTokens);
  await sql.begin(async (tx) => {
    const budget = await load(tx);
    budget.reservedCny = Math.max(0, budget.reservedCny - estimateVocCny(input));
    budget.spentCny += actual;
    budget.promptTokens += promptTokens;
    budget.completionTokens += completionTokens;
    await save(tx, budget);
  });
}

/** Takes the single-run lease; false when another run holds it. */
export async function claimVocRun(): Promise<boolean> {
  const until = new Date(Date.now() + LEASE_MINUTES * 60_000).toISOString();
  const claimed = await sql<{ key: string }[]>`
    INSERT INTO settings (key, value, updated_by) VALUES (${LEASE_KEY}, ${sql.json({ until })}, 'voc')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    WHERE coalesce((settings.value->>'until')::timestamptz, 'epoch') < now()
    RETURNING key`;
  return claimed.length > 0;
}

export async function releaseVocRun(): Promise<void> {
  await sql`UPDATE settings SET value = ${sql.json({ until: new Date(0).toISOString() })}, updated_at = now() WHERE key = ${LEASE_KEY}`;
}

/**
 * Starts (or no-ops onto) the lane's authorization window. With the environment defaults denied,
 * an operator must start a window with REAL caps before any paid call can pass the gate.
 */
export async function startVocRound(round: string, limits?: VocLimits): Promise<{ archived: VocRound | null; current: VocBudget }> {
  const caps = limits ?? {
    maxRequests: config.voc.maxRequests,
    maxArticles: config.voc.maxArticles,
    budgetCny: config.voc.budgetCny,
    purposes: [...config.voc.purposes],
  };
  return sql.begin(async (tx) => {
    const [row] = await tx<{ value: Partial<VocBudget> }[]>`SELECT value FROM settings WHERE key = ${BUDGET_KEY} FOR UPDATE`;
    const current = normalize(row?.value);
    if (current.round === round) return { archived: null, current };
    let archived: VocRound | null = null;
    const spent = current.requests > 0 || current.spentCny > 0 || current.articles.length > 0;
    if (spent) {
      archived = { ...current, limits: limitsOf(current), closedAt: new Date().toISOString() };
      const [roundsRow] = await tx<{ value: VocRound[] | null }[]>`SELECT value FROM settings WHERE key = ${ROUNDS_KEY} FOR UPDATE`;
      const rounds = Array.isArray(roundsRow?.value) ? roundsRow.value : [];
      if (!rounds.some((r) => r.round === archived!.round)) rounds.push(archived);
      await tx`INSERT INTO settings (key, value, updated_by) VALUES (${ROUNDS_KEY}, ${tx.json(rounds as never)}, 'voc')
               ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    }
    const fresh: VocBudget = { ...EMPTY, round, limits: caps, startedAt: new Date().toISOString() };
    await save(tx, fresh);
    return { archived, current: fresh };
  });
}

/** The caps currently in force, for status screens and gates. */
export async function vocBudgetState(): Promise<VocBudget> {
  const [row] = await sql<{ value: Partial<VocBudget> }[]>`SELECT value FROM settings WHERE key = ${BUDGET_KEY}`;
  return normalize(row?.value);
}
