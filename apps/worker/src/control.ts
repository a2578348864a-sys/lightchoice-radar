// Local control for the dedicated Radar workers on Windows.
//
// Signals do not work here: `child.kill("SIGTERM")` is TerminateProcess on Windows, so a worker never
// gets to release its advisory lock or finish the run it is in. The supervisor therefore asks a child
// to stop over the IPC channel it was spawned with, and a worker started by hand (or a supervisor
// started outside this terminal) is stopped through a small request file that the worker polls. A
// request file is only a request: whether a role is actually running is answered by its PostgreSQL
// advisory lock, never by a PID file — a stale PID or a reused PID must not look like a live worker.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@aihot/backend/config";

export type WorkerRole = "ads-policy" | "radar-announcements" | "ads-policy-supervisor" | "amz123-leads" | "radar-translate";

// One directory per checkout (default), overridable so tests and a second checkout never share requests.
const RUN_DIR = process.env.RADAR_RUN_DIR ? path.resolve(process.env.RADAR_RUN_DIR) : path.join(REPO_ROOT, ".data", "run");

/**
 * This process's start time, computed once. The run record and the heartbeat must agree on it exactly:
 * a PID that was reused belongs to a process that started later, and that difference is what proves the
 * PID is not the one the record was written for.
 */
const PROCESS_STARTED_AT = new Date(Date.now() - process.uptime() * 1000).toISOString();
/** How often a worker looks for a stop request; a stop takes effect within about this long. */
export const STOP_POLL_MS = 1_000;

const stopPath = (role: WorkerRole) => path.join(RUN_DIR, `${role}.stop`);
const recordPath = (role: WorkerRole) => path.join(RUN_DIR, `${role}.json`);

function ensureDir(): void {
  mkdirSync(RUN_DIR, { recursive: true });
}

/** A worker asks for no stop at startup; a request left by an earlier session must not stop it at once. */
export function clearStopRequest(role: WorkerRole): void {
  rmSync(stopPath(role), { force: true });
}

/** Ask the worker holding `role` to stop after the work in hand. Returns the request time. */
export function requestStop(role: WorkerRole, reason = "requested by an operator"): Date {
  ensureDir();
  const at = new Date();
  writeFileSync(stopPath(role), JSON.stringify({ at: at.toISOString(), reason, by: process.pid }));
  return at;
}

export function stopRequested(role: WorkerRole): boolean {
  try {
    readFileSync(stopPath(role));
    return true;
  } catch {
    return false;
  }
}

/**
 * Calls `onStop` once, shortly after a request file appears. The interval is unref'd: while a worker
 * sleeps between runs its own timer keeps the process alive, and this watch must not be the reason a
 * finished process stays open.
 */
export function watchStopRequest(role: WorkerRole, onStop: () => void, everyMs = STOP_POLL_MS): () => void {
  let fired = false;
  const check = () => {
    if (fired || !stopRequested(role)) return;
    fired = true;
    onStop();
  };
  const timer = setInterval(check, everyMs);
  timer.unref?.();
  check();
  return () => clearInterval(timer);
}

/** What a running worker writes about itself: for people reading `radar-ops status`, not for identity. */
export interface RunRecord {
  role: WorkerRole;
  pid: number;
  startedAt: string;
  entry: string;
}

export function writeRunRecord(role: WorkerRole, entry: string): RunRecord {
  ensureDir();
  const record: RunRecord = { role, pid: process.pid, startedAt: PROCESS_STARTED_AT, entry };
  writeFileSync(recordPath(role), JSON.stringify(record));
  return record;
}

/** The last worker that started this role, and when. Staleness is decided by the advisory lock. */
export function readRunRecord(role: WorkerRole): RunRecord | null {
  try {
    const parsed = JSON.parse(readFileSync(recordPath(role), "utf8")) as RunRecord;
    return typeof parsed?.pid === "number" ? parsed : null;
  } catch {
    return null;
  }
}

export function clearRunRecord(role: WorkerRole): void {
  rmSync(recordPath(role), { force: true });
}

/** Removes both files a role leaves behind; called by a stopping worker and by a successful start. */
export function clearControlState(role: WorkerRole): void {
  clearStopRequest(role);
  clearRunRecord(role);
  clearHeartbeat(role);
}

// A heartbeat: what a process writes about itself while it lives.
//
// A run record says who started last, and a PID can be reused, so neither proves that a PID still
// belongs to this project's worker. The heartbeat closes that gap: only the live process keeps writing
// it, and it carries the pid *and* the start time of the process that wrote it. `stop --force` therefore
// requires a fresh heartbeat whose pid and start time both match the record — a reused PID has a later
// start time and is refused — and refuses to kill when the heartbeat is missing or stale.

const beatPath = (role: WorkerRole) => path.join(RUN_DIR, `${role}.beat`);

export interface Heartbeat {
  pid: number;
  startedAt: string;
  at: string;
}

/** Writes the heartbeat every `everyMs`; the first write happens immediately. */
export function startHeartbeat(role: WorkerRole, everyMs = 10_000): () => void {
  const beat = () => {
    try {
      writeFileSync(beatPath(role), JSON.stringify({ pid: process.pid, startedAt: PROCESS_STARTED_AT, at: new Date().toISOString() }));
    } catch {
      // A read-only run directory must not take the worker down.
    }
  };
  beat();
  const timer = setInterval(beat, everyMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

export function readHeartbeat(role: WorkerRole): Heartbeat | null {
  try {
    const parsed = JSON.parse(readFileSync(beatPath(role), "utf8")) as Heartbeat;
    return typeof parsed?.pid === "number" ? parsed : null;
  } catch {
    return null;
  }
}

export function clearHeartbeat(role: WorkerRole): void {
  rmSync(beatPath(role), { force: true });
}

/**
 * Whether a PID really is the process that wrote the record. Conservative on purpose: anything unclear
 * is refused, because the only alternative — killing an unknown PID — is worse than not stopping.
 */
export function verifyProcessIdentity(
  input: { record: RunRecord | null; beat: Heartbeat | null; now: number; maxAgeMs: number },
): { ok: boolean; reason: string } {
  if (!input.record) return { ok: false, reason: "没有运行记录，无法确认进程身份" };
  if (!input.beat) return { ok: false, reason: "没有心跳：进程已退出或不是本项目 Worker" };
  const age = input.now - Date.parse(input.beat.at);
  if (!Number.isFinite(age)) return { ok: false, reason: "心跳时间无法解析" };
  if (age > input.maxAgeMs) return { ok: false, reason: `心跳已过期 ${Math.round(age / 1000)}s，进程可能已退出` };
  if (input.beat.pid !== input.record.pid) return { ok: false, reason: `心跳中的进程 pid=${input.beat.pid} 与记录 pid=${input.record.pid} 不一致` };
  if (input.beat.startedAt !== input.record.startedAt) return { ok: false, reason: "心跳中的启动时间与记录不符（PID 可能已被其他进程复用）" };
  return { ok: true, reason: "pid 与启动时间均与运行记录一致" };
}

/** A heartbeat this fresh means the process is alive and writing. */
export const HEARTBEAT_FRESH_MS = 60_000;

export function heartbeatAlive(role: WorkerRole, now = Date.now(), maxAgeMs = HEARTBEAT_FRESH_MS): boolean {
  const beat = readHeartbeat(role);
  if (!beat) return false;
  const age = now - Date.parse(beat.at);
  return Number.isFinite(age) && age >= 0 && age <= maxAgeMs;
}
