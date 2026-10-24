// Scheduling rules for the Ads policy collector, kept pure so they can be checked without a browser.
//
// The Ads pages need JavaScript, so they cannot run inside the always-on worker: a browser there would
// be loaded by a process that also serves collection and scheduling for other sources. The dedicated
// process reads these rules instead, and stays off unless the deployment turns it on.

/** Default cadence: the pages change a few times a year, so four daily reads are already generous. */
const DEFAULT_INTERVAL_MINUTES = 360;
const MIN_INTERVAL_MINUTES = 15;
const MAX_INTERVAL_MINUTES = 1_440;
/** A run that outlives this is treated as hung: the process logs it and exits so a supervisor restarts. */
const DEFAULT_TIMEOUT_MINUTES = 15;
const MAX_TIMEOUT_MINUTES = 60;

export interface AdsPolicySchedule {
  enabled: boolean;
  intervalMs: number;
  timeoutMs: number;
  /** One run, then exit: how an operator checks the path without leaving a daemon behind. */
  once: boolean;
}

const intIn = (value: string | undefined, fallback: number, min: number, max: number): number => {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return Math.trunc(parsed);
};

/** `RADAR_ADS_POLICY_ENABLED` is the only switch; the cadence and the watchdog have safe defaults. */
export function adsPolicySchedule(env: Record<string, string | undefined>): AdsPolicySchedule {
  return {
    enabled: /^(1|true|yes|on)$/i.test(String(env.RADAR_ADS_POLICY_ENABLED ?? "").trim()),
    intervalMs: intIn(env.RADAR_ADS_POLICY_INTERVAL_MINUTES, DEFAULT_INTERVAL_MINUTES, MIN_INTERVAL_MINUTES, MAX_INTERVAL_MINUTES) * 60_000,
    timeoutMs: intIn(env.RADAR_ADS_POLICY_TIMEOUT_MINUTES, DEFAULT_TIMEOUT_MINUTES, 1, MAX_TIMEOUT_MINUTES) * 60_000,
    once: /^(1|true|yes|on)$/i.test(String(env.RADAR_ADS_POLICY_ONCE ?? "").trim()),
  };
}

/**
 * Waiting time before the next attempt: the plain cadence after a success, doubling after each
 * consecutive failure up to four cadences. A run that keeps failing therefore costs four reads a day
 * at most, and never stops retrying — a site being down is not a reason to abandon the source.
 */
export function nextRunDelayMs(consecutiveFailures: number, intervalMs: number): number {
  const doublings = Math.min(Math.max(consecutiveFailures, 0), 2);
  return intervalMs * 2 ** doublings;
}

/**
 * Runs `onTimeout` when a run outlives its watchdog. The returned function cancels it: a finished run
 * must not exit the process later. The timer is unref'd so it never keeps a finished process alive.
 */
export function startWatchdog(ms: number, onTimeout: () => void): () => void {
  const handle = setTimeout(onTimeout, ms);
  handle.unref?.();
  return () => clearTimeout(handle);
}
