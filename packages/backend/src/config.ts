// Runtime configuration. Secrets are loaded per group (models, collectors, integrations, auth)
// from dotenv files, and only by the backend processes that need them.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { DEPLOYMENT, SITE } from "@aihot/site";

export const REPO_ROOT = path.resolve(import.meta.dirname, "../../..");

const env = process.env;

function str(name: string, fallback?: string): string {
  const value = env[name];
  if (value !== undefined && value !== "") return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required environment variable ${name}`);
}

function int(name: string, fallback: number): number {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} must be an integer`);
  return parsed;
}

/** On only when set to true, like every switch read straight from the environment. */
function bool(name: string, fallback: boolean): boolean {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  return value === "true";
}

function num(name: string, fallback: number): number {
  const value = env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Environment variable ${name} must be a number`);
  return parsed;
}

/**
 * The receipt purposes the translation gate may open. Nothing else: a purpose outside this list stays
 * blocked by rule mode even when translation is on.
 */
export const TRANSLATION_PURPOSES = ["translate_title", "translate_excerpt", "translate_body", "translate_quoted"] as const;
export type TranslationPurpose = (typeof TRANSLATION_PURPOSES)[number];

export const isProduction = env.NODE_ENV === "production";
// Radar is a no-model product: paid-provider calls stay blocked even if an inherited AIHOT .env
// enables model features. Other AIHOT sites keep the existing opt-in switch behavior.
const ruleOnlyMode = SITE.name === "LightChoice Radar" || bool("RULE_ONLY_MODE", false);

/** AIHOT_CREDENTIALS_DIR, else the site's own default (relative to the repository). */
const credentialsDir = env.AIHOT_CREDENTIALS_DIR || DEPLOYMENT.credentialsDir;

export const config = {
  databaseUrl: str("DATABASE_URL", "postgres://127.0.0.1:5432/aihot"),
  apiPort: int("API_PORT", 3001),
  // Every generated absolute link uses this address, whatever Host a request arrives with.
  siteUrl: str("SITE_URL", SITE.defaultUrl).replace(/\/+$/, ""),
  // Free Radar feeds use direct HTTPS. A proxy configured for another environment is ignored here.
  egressProxyUrl: ruleOnlyMode ? null : env.EGRESS_PROXY_URL || null,
  allowPrivateNetworkFetch: bool("ALLOW_PRIVATE_NETWORK_FETCH", false),
  /** Whole host names of self-hosted feed services on private addresses; only listing fetches use them. */
  privateFeedHosts: (env.PRIVATE_FEED_HOSTS || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean),
  feishuContentPushEnabled: bool("FEISHU_CONTENT_PUSH_ENABLED", false),
  indexNowSubmitEnabled: bool("INDEXNOW_SUBMIT_ENABLED", false),
  /** IndexNow key (32 hex characters); without one nothing is submitted and no key file is served. */
  indexNowKey: /^[0-9a-f]{32}$/.test(env.INDEXNOW_KEY ?? "") ? env.INDEXNOW_KEY! : null,
  /** Optional directory of per-group dotenv files (models.env, collectors.env, …); normally everything is in .env. */
  credentialsDir: credentialsDir ? path.resolve(REPO_ROOT, credentialsDir) : null,
  dataDir: str("AIHOT_DATA_DIR", path.join(REPO_ROOT, ".data")),
  // Name of this deployment in alerts ("production" sends them without a prefix).
  environmentName: str("AIHOT_ENVIRONMENT", isProduction ? "production" : "development"),
  // External-action valve: off unless the environment turns it on, like COLLECT_ENABLED (read by the
  // worker).
  modelCallsEnabled: bool("MODEL_CALLS_ENABLED", false),
  /**
   * The one paid capability this deployment may use: DeepSeek translation. Off unless explicitly turned
   * on, and it opens only TRANSLATION_PURPOSES — every other paid request keeps meeting the rule-mode
   * refusal, and MODEL_CALLS_ENABLED stays false (editorial/translate-budget.ts holds the caps).
   */
  translateEnabled: bool("RADAR_TRANSLATE_ENABLED", false),
  translate: {
    /**
     * Identifier of the paid window now running (e.g. "r47"). Every window keeps its own caps and its
     * own spend in settings (editorial/translate-budget.ts); starting a new one archives the previous
     * window instead of erasing it, so a restart or a re-run never resets or hides what was spent.
     */
    round: env.RADAR_TRANSLATE_ROUND?.trim() || "",
    /** Hard caps for the whole authorization window; kept in settings, so restarts do not reset them. */
    maxRequests: int("RADAR_TRANSLATE_MAX_REQUESTS", 20),
    maxArticles: int("RADAR_TRANSLATE_MAX_ARTICLES", 8),
    /** Caps of the scheduled incremental path: per run and per Beijing calendar day. */
    runArticles: int("RADAR_TRANSLATE_RUN_ARTICLES", 3),
    dayArticles: int("RADAR_TRANSLATE_DAY_ARTICLES", 12),
    /** Money bound in yuan, checked against a worst-case token estimate before every request is sent. */
    budgetCny: num("RADAR_TRANSLATE_BUDGET_CNY", 3),
    priceInPerMTokens: num("RADAR_TRANSLATE_PRICE_IN", 2),
    priceOutPerMTokens: num("RADAR_TRANSLATE_PRICE_OUT", 8),
  },
  /** Keep original RSS copy visible without model scoring, rewriting or event grouping. */
  ruleOnlyMode,
  devAdmin: env.DEV_AUTH_ROLE === "admin" ? { displayName: env.DEV_AUTH_DISPLAY_NAME || "Dev Admin" } : null,
  /** The admin password (at least 12 characters). Feishu sign-in below is optional. */
  adminPassword: env.ADMIN_PASSWORD || null,
  adminUnionIds: (env.ADMIN_FEISHU_UNION_IDS || "").split(",").map((v) => v.trim()).filter(Boolean),
  adminEmails: (env.ADMIN_EMAILS || "").split(",").map((v) => v.trim().toLowerCase()).filter(Boolean),
};

export type CredentialGroup = "models" | "collectors" | "integrations" | "auth";

/**
 * Whether one receipt purpose is allowed to reach a paid provider in this deployment. Translation is the
 * only exception to the rule-mode refusal, and only for the translation purposes, and only while the
 * dedicated switch is on: switching it off stops new translation requests without touching anything else.
 */
export function translationPurposeAllowed(purpose: string): boolean {
  return config.translateEnabled && (TRANSLATION_PURPOSES as readonly string[]).includes(purpose);
}

const groupCache = new Map<CredentialGroup, Record<string, string>>();

/** The file a group is kept in, under AIHOT_CREDENTIALS_DIR: the site's name for it, else <group>.env. */
function groupFile(group: CredentialGroup): string {
  return DEPLOYMENT.credentialFiles[group] ?? `${group}.env`;
}

/**
 * Loads one credential group from an optional dotenv file (AIHOT_CREDENTIALS_DIR/<group>.env). Values
 * in the environment always win; a normal deployment only uses environment variables (.env).
 */
export function credentials(group: CredentialGroup): Record<string, string> {
  const cached = groupCache.get(group);
  if (cached) return cached;
  const file = config.credentialsDir ? path.join(config.credentialsDir, groupFile(group)) : null;
  const parsed: Record<string, string> = file && existsSync(file) ? (parseEnv(readFileSync(file, "utf8")) as Record<string, string>) : {};
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) merged[key] = env[key] ?? value;
  groupCache.set(group, merged);
  return merged;
}

export function credential(group: CredentialGroup, name: string): string | null {
  const value = env[name] ?? credentials(group)[name];
  return value && value.trim() !== "" ? value : null;
}

const PLACEHOLDER = /^(changeme|placeholder|dummy|test|xxx+|your[-_ ].*|<.*>)$/i;

/** Production refuses to start with missing or placeholder critical secrets, or dev-login bypasses. */
export function assertProductionSecrets(names: ReadonlyArray<readonly [CredentialGroup, string]>): void {
  if (!isProduction) return;
  const problems: string[] = [];
  for (const [group, name] of names) {
    const value = credential(group, name);
    if (!value || PLACEHOLDER.test(value) || value.length < 8) problems.push(name);
  }
  for (const key of Object.keys(env)) if (key.startsWith("DEV_AUTH_")) problems.push(`${key} (dev login bypass)`);
  if (config.allowPrivateNetworkFetch) problems.push("ALLOW_PRIVATE_NETWORK_FETCH");
  if (problems.length > 0) throw new Error(`Refusing to start in production: ${problems.join(", ")}`);
}
