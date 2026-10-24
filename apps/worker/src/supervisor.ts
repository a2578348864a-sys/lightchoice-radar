// A minimal process supervisor for the dedicated Radar workers.
//
// Why this exists: `ads-policy.ts` treats an over-long run as a hang, logs it and exits 1, expecting
// "a supervisor" to start it again. Nothing in this repository did that — deploy.md assumes systemd or
// pm2, and this machine has neither — so a watchdog exit was simply the end of collection. This module
// is that missing piece: no dependency, no service installation, testable with a child process.
//
// The contract with the child is its exit code, so the supervisor never guesses:
//   0  the child finished on purpose (an operator switch is off, or another instance holds the role)
//   2  the configuration is unusable           → restarting cannot help
//   3  the source is paused by an operator     → restarting cannot help
//   1  a runtime failure (watchdog, crash)     → restart with a bounded exponential backoff
// A run that keeps failing is retried a bounded number of times and then left to an operator, so a
// broken site or a missing browser cannot turn into a restart storm.
import { spawn, type ChildProcess } from "node:child_process";
import { clearHeartbeat, clearRunRecord, clearStopRequest, startHeartbeat, writeRunRecord, watchStopRequest, type WorkerRole } from "./control.ts";

export const EXIT = { clean: 0, runtime: 1, config: 2, sourceDisabled: 3 } as const;

export type ExitVerdict = "clean" | "config" | "source-disabled" | "runtime";

export interface SupervisorPolicy {
  /** First restart delay; each further failure doubles it. */
  initialDelayMs: number;
  maxDelayMs: number;
  /** After this many consecutive runtime failures the supervisor stops and asks for a human. */
  maxConsecutiveFailures: number;
  /** How long a stopping child gets before it is killed. */
  stopGraceMs: number;
}

const intIn = (value: string | undefined, fallback: number, min: number, max: number): number => {
  const parsed = Number(String(value ?? "").trim());
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return Math.trunc(parsed);
};

/**
 * `RADAR_SUPERVISOR_INITIAL_DELAY_SECONDS` (default 30), `RADAR_SUPERVISOR_MAX_DELAY_SECONDS`
 * (default 1800) and `RADAR_SUPERVISOR_MAX_FAILURES` (default 6) tune the restart policy.
 */
export function supervisorPolicy(env: Record<string, string | undefined>): SupervisorPolicy {
  return {
    initialDelayMs: intIn(env.RADAR_SUPERVISOR_INITIAL_DELAY_SECONDS, 30, 1, 3600) * 1_000,
    maxDelayMs: intIn(env.RADAR_SUPERVISOR_MAX_DELAY_SECONDS, 1_800, 1, 86_400) * 1_000,
    maxConsecutiveFailures: intIn(env.RADAR_SUPERVISOR_MAX_FAILURES, 6, 1, 100),
    // A stop lets the run in hand finish; an Ads run takes about a minute, so the default is generous.
    stopGraceMs: intIn(env.RADAR_SUPERVISOR_STOP_GRACE_SECONDS, 120, 1, 600) * 1_000,
  };
}

/** What the child's ending means for the supervisor. A signal is never a planned exit. */
export function classifyExit(code: number | null, signal: string | null): ExitVerdict {
  if (signal) return "runtime";
  if (code === EXIT.clean) return "clean";
  if (code === EXIT.config) return "config";
  if (code === EXIT.sourceDisabled) return "source-disabled";
  return "runtime";
}

/** Delay before the next start: doubles per consecutive failure, capped at the policy's maximum. */
export function backoffDelayMs(consecutiveFailures: number, policy: SupervisorPolicy): number {
  const doublings = Math.min(Math.max(consecutiveFailures, 1) - 1, 20);
  return Math.min(policy.initialDelayMs * 2 ** doublings, policy.maxDelayMs);
}

/** Whether another start is worth it, and why not when it is not. */
export function restartDecision(
  verdict: ExitVerdict, consecutiveFailures: number, policy: SupervisorPolicy,
): { restart: boolean; reason: string } {
  if (verdict === "clean") return { restart: false, reason: "the worker exited on purpose" };
  if (verdict === "config") return { restart: false, reason: "the configuration is unusable; fix it and start again" };
  if (verdict === "source-disabled") return { restart: false, reason: "the source is paused; enable it before starting again" };
  if (consecutiveFailures >= policy.maxConsecutiveFailures) {
    return { restart: false, reason: `stopped after ${consecutiveFailures} consecutive failures; inspect the logs, then start again` };
  }
  return { restart: true, reason: `runtime failure ${consecutiveFailures}` };
}

export interface SupervisorOptions {
  /** The role this supervisor runs; also the role whose stop request it honours. */
  name: WorkerRole;
  command: string;
  args: string[];
  policy: SupervisorPolicy;
  /** A child that stops gracefully keeps its lock; give it time before killing it. */
  stopGraceMs?: number;
  /** The request file and run record this supervisor keeps for humans; off in tests. */
  control?: boolean;
  log?: (event: Record<string, unknown>) => void;
}

const defaultLog = (event: Record<string, unknown>) => console.log(JSON.stringify(event));

/**
 * Runs the child until it ends on purpose, fails too often, or the supervisor is stopped. Resolves with
 * the exit code the supervisor itself should use, so a caller (and a test) can await it.
 */
export async function supervise(options: SupervisorOptions): Promise<number> {
  const log = options.log ?? defaultLog;
  const policy = options.policy;
  const graceMs = options.stopGraceMs ?? policy.stopGraceMs;
  const supervisorRole: WorkerRole = "ads-policy-supervisor";
  let child: ChildProcess | null = null;
  let stopping = false;
  let failures = 0;
  let sleepTimer: NodeJS.Timeout | null = null;
  let wake: (() => void) | null = null;

  const wait = (ms: number) => new Promise<void>((resolve) => {
    wake = resolve;
    sleepTimer = setTimeout(resolve, ms);
  });

  // Windows has no SIGTERM: a signal to a child is TerminateProcess, so the child never releases its
  // lock or finishes its run. Ask it over the IPC channel it was started with; only kill after the
  // grace period if it does not leave.
  const askChildToStop = () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    try {
      if (child.connected) child.send({ type: "stop" }, () => {});
      else child.kill("SIGTERM");
    } catch {
      // already gone
    }
  };
  const killChild = () => {
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  };

  const beginStop = (reason: string) => {
    if (stopping) return;
    stopping = true;
    log({ level: "info", msg: "supervisor stopping", name: options.name, reason, childPid: child?.pid ?? null });
    if (sleepTimer) clearTimeout(sleepTimer);
    wake?.();
    askChildToStop();
    // The child finishes the run in hand and exits; anything still alive after the grace period is
    // killed, and the next start closes its interrupted run records.
    const killTimer = setTimeout(() => {
      log({ level: "warn", msg: "the worker did not stop in time; killing it", name: options.name, graceMs });
      killChild();
    }, graceMs);
    killTimer.unref?.();
  };
  const onSignal = (signal: NodeJS.Signals) => beginStop(signal);
  const sigterm = () => onSignal("SIGTERM");
  const sigint = () => onSignal("SIGINT");
  process.on("SIGTERM", sigterm);
  process.on("SIGINT", sigint);
  const control = options.control !== false;
  let stopSupervisorHeartbeat: (() => void) | null = null;
  if (control) {
    clearStopRequest(options.name);
    writeRunRecord(supervisorRole, "ads-policy-daemon");
    stopSupervisorHeartbeat = startHeartbeat(supervisorRole);
  }
  const unwatch = control
    ? watchStopRequest(options.name, () => beginStop("stop request file"))
    : () => {};

  try {
    for (;;) {
      if (stopping) return EXIT.clean;
      const started = Date.now();
      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
        child = spawn(options.command, options.args, { stdio: ["inherit", "inherit", "inherit", "ipc"], env: process.env });
        child.once("error", (error) => {
          log({ level: "error", msg: "the worker could not be started", name: options.name, error: String(error).slice(0, 300) });
          resolve({ code: EXIT.runtime, signal: null });
        });
        child.once("exit", (code, signal) => resolve({ code, signal }));
      });
      child = null;
      if (stopping) return EXIT.clean;

      const verdict = classifyExit(exit.code, exit.signal);
      if (verdict === "runtime") failures += 1;
      else failures = 0;
      const decision = restartDecision(verdict, failures, policy);
      log({
        level: decision.restart ? "warn" : "info",
        msg: decision.restart ? "the worker ended; it will be started again" : "the supervisor will not restart the worker",
        name: options.name, verdict, code: exit.code, signal: exit.signal, failures, reason: decision.reason,
        ranMs: Date.now() - started, ...(decision.restart ? { retryInMs: backoffDelayMs(failures, policy) } : {}),
      });
      if (!decision.restart) {
        if (verdict === "clean") return EXIT.clean;
        if (verdict === "config") return EXIT.config;
        if (verdict === "source-disabled") return EXIT.sourceDisabled;
        return EXIT.runtime;
      }
      await wait(backoffDelayMs(failures, policy));
      if (stopping) return EXIT.clean;
    }
  } finally {
    unwatch();
    process.off("SIGTERM", sigterm);
    process.off("SIGINT", sigint);
    if (sleepTimer) clearTimeout(sleepTimer);
    stopSupervisorHeartbeat?.();
    if (control) {
      clearStopRequest(options.name);
      clearRunRecord(supervisorRole);
      clearHeartbeat(supervisorRole);
    }
  }
}
