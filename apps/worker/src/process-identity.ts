// Proving that a PID is really this project's worker before anything is killed — and killing through
// the same verified handle.
//
// The heartbeat and the run record are written by the process itself, so on their own they only prove
// that *some* process with that PID once wrote them. Two gaps this module closes:
//
//  1. A worker exits, its heartbeat file is still inside the freshness window, and the PID is reused by
//     an unrelated process. So the OS is asked what the PID is *now*: the returned PID must be the one
//     asked for, the command line must be this project's worker entry, and the creation time must be the
//     one the run record was written for.
//
//  2. Even a correct answer goes stale: between "the OS says this is the worker" and "kill this PID" the
//     process can exit and the PID be reused. So the termination does not go through the PID at all:
//     the OS opens the process, its creation time is read *through that handle* and compared with the
//     answer, and only then is the process terminated through the same handle. Any mismatch — including
//     a creation time that cannot be read — refuses, and there is no PID-based fallback.
//
// When the OS cannot answer (the query command missing, a timeout, unexpected output) the answer is
// always "cannot verify" — an operator handles it by hand rather than risk the wrong kill.
import { execFile } from "node:child_process";
import type { WorkerRole } from "./control.ts";

export interface OsProcess {
  pid: number;
  commandLine: string;
  /** Instant the OS says this process was created, in whatever form it reports it. */
  creationDate: string | null;
}

/** What a role's process must look like on the command line. */
const EXPECTED_COMMAND: Record<WorkerRole, string> = {
  "ads-policy": "ads-policy.ts",
  "ads-policy-supervisor": "ads-policy-daemon.ts",
  "radar-announcements": "radar-announcements.ts",
  "amz123-leads": "radar-amz123-leads.ts",
  // The scoped first-lane worker is the main entry with RADAR_WORKER_SCOPE=content.
  "radar-translate": "apps/worker/src/main.ts",
  "radar-industry": "radar-industry.ts",
};

export function expectedCommandFragment(role: WorkerRole): string {
  return EXPECTED_COMMAND[role];
}

/**
 * Windows reports command lines with backslashes while entries may be written with forward slashes
 * (`path.join` normalizes them, a hand-typed start may not), so a fragment only matches when the
 * comparison is slash- and case-insensitive. Everything that proves "this PID is this worker" goes
 * through here — a partial name alone (e.g. `main.ts`) must never match.
 */
export function commandLineMatches(commandLine: string, fragment: string): boolean {
  const normalize = (value: string) => value.replace(/\//g, "\\").toLowerCase();
  return normalize(commandLine).includes(normalize(fragment));
}

/** How far the OS creation time may sit from the run record's start time (clock skew, spawn time). */
export const CREATION_TOLERANCE_MS = 120_000;

/** How far a heartbeat may be ahead of now before it is treated as a broken clock. */
const FUTURE_SKEW_MS = 5_000;

/** How far apart the two OS readings (query and handle) may be before the PID is suspected reused. */
const HANDLE_BINDING_TOLERANCE_MS = 2_000;

/** Runs a script through the OS shell and resolves its standard output. */
export type OsScriptRunner = (script: string, timeoutMs: number) => Promise<string>;

const defaultRunner: OsScriptRunner = (script, timeoutMs) => new Promise((resolve, reject) => {
  execFile("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, timeout: timeoutMs, maxBuffer: 64 * 1024 }, (error, stdout) => {
    if (error) return reject(error);
    resolve(stdout);
  });
});

/** An instant as the OS reports it: an ISO string, or ConvertTo-Json's /Date(ms)/ form. */
export function parseOsInstant(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const iso = Date.parse(value);
  if (Number.isFinite(iso)) return iso;
  const ticks = /^\/Date\((-?\d+)(?:[+-]\d{4})?\)\/$/.exec(value.trim());
  return ticks ? Number(ticks[1]) : null;
}

/** The query the OS answers: what this PID is right now. */
function identityScript(pid: number): string {
  return `Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" | Select-Object ProcessId,CommandLine,CreationDate | ConvertTo-Json -Compress`;
}

/**
 * Asks the OS what a PID is. Strict on purpose: the answer must name the PID that was asked about,
 * carry a command line, and carry a creation time that can be read — otherwise the whole identity check
 * is unavailable, which every caller must treat as "cannot verify" rather than as "not running".
 */
export async function queryWindowsProcess(pid: number, timeoutMs = 8_000, runner: OsScriptRunner = defaultRunner): Promise<OsProcess | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  let stdout: string;
  try {
    stdout = await runner(identityScript(pid), timeoutMs);
  } catch {
    return null;
  }
  let parsed: { ProcessId?: unknown; CommandLine?: unknown; CreationDate?: unknown } | null = null;
  try {
    const json: unknown = JSON.parse(stdout.trim());
    // ConvertTo-Json answers with a single object for one process, and with an array for several.
    const first: unknown = Array.isArray(json) ? json[0] : json;
    parsed = first && typeof first === "object" ? (first as { ProcessId?: unknown; CommandLine?: unknown; CreationDate?: unknown }) : null;
  } catch {
    return null;
  }
  if (!parsed) return null;
  // The OS has to answer about the PID that was asked about; anything else is not an answer.
  if (parsed.ProcessId !== pid) return null;
  const commandLine = typeof parsed.CommandLine === "string" ? parsed.CommandLine : "";
  if (!commandLine) return null;
  const creationDate = typeof parsed.CreationDate === "string" ? parsed.CreationDate : null;
  // A missing or unreadable creation time makes the identity check unusable, not merely incomplete.
  if (parseOsInstant(creationDate) === null) return null;
  return { pid, commandLine, creationDate };
}

export interface IdentityInput {
  role: WorkerRole;
  record: { pid: number; startedAt: string } | null;
  beat: { pid: number; startedAt: string; at: string } | null;
  /** What the OS says about that PID now; null means the OS could not be asked. */
  os: OsProcess | null;
  now: number;
  maxAgeMs: number;
  creationToleranceMs?: number;
}

/**
 * Whether it is safe to touch this PID at all. Every unclear case refuses: the caller must then ask a
 * human. The file-level checks come first (they are cheap), and the OS answer is what makes them
 * conclusive.
 */
export function verifyWorkerIdentity(input: IdentityInput): { ok: boolean; reason: string } {
  if (!input.record) return { ok: false, reason: "没有运行记录，无法确认进程身份" };
  if (!input.beat) return { ok: false, reason: "没有心跳：进程已退出或不是本项目 Worker" };

  const startedAt = Date.parse(input.record.startedAt);
  if (!Number.isFinite(startedAt)) return { ok: false, reason: "运行记录中的启动时间无法解析" };
  if (startedAt > input.now + FUTURE_SKEW_MS) return { ok: false, reason: "运行记录中的启动时间在未来" };

  const beatAt = Date.parse(input.beat.at);
  if (!Number.isFinite(beatAt)) return { ok: false, reason: "心跳时间无法解析" };
  // A heartbeat from the future is a broken clock, not a live process: it must never count as fresh.
  if (beatAt > input.now + FUTURE_SKEW_MS) return { ok: false, reason: `心跳时间在未来（${input.beat.at}），已拒绝` };
  const age = input.now - beatAt;
  if (age > input.maxAgeMs) return { ok: false, reason: `心跳已过期 ${Math.round(age / 1000)}s，进程可能已退出` };

  if (input.beat.pid !== input.record.pid) return { ok: false, reason: `心跳中的进程 pid=${input.beat.pid} 与记录 pid=${input.record.pid} 不一致` };
  if (input.beat.startedAt !== input.record.startedAt) return { ok: false, reason: "心跳中的启动时间与记录不符" };

  if (!input.os) return { ok: false, reason: "无法从操作系统确认该 PID 的进程身份，拒绝强杀（请人工处理）" };
  if (input.os.pid !== input.record.pid) return { ok: false, reason: `操作系统返回的 pid=${input.os.pid} 与记录 pid=${input.record.pid} 不一致` };

  if (!commandLineMatches(input.os.commandLine, expectedCommandFragment(input.role))) {
    return { ok: false, reason: `该 PID 当前运行的不是本项目 Worker（命令行中没有 ${expectedCommandFragment(input.role)}），拒绝强杀` };
  }

  const creation = parseOsInstant(input.os.creationDate);
  if (creation === null) return { ok: false, reason: "操作系统没有提供该进程的创建时间，拒绝强杀" };
  const tolerance = input.creationToleranceMs ?? CREATION_TOLERANCE_MS;
  if (Math.abs(creation - startedAt) > tolerance) {
    return { ok: false, reason: `操作系统进程创建时间与运行记录相差 ${Math.round(Math.abs(creation - startedAt) / 1000)}s（PID 可能已被复用），拒绝强杀` };
  }
  return { ok: true, reason: "pid、命令行与操作系统进程创建时间均与运行记录一致" };
}

/**
 * Whether a handle-bound creation time still matches the one the identity check saw. This is the race
 * window: the OS answered about a PID, and by the time the process was opened the PID may belong to
 * somebody else, whose creation time would differ.
 */
export function handleBindingDecision(input: { cimCreationMs: number | null; handleCreationMs: number | null }): { ok: boolean; reason: string } {
  if (input.cimCreationMs === null) return { ok: false, reason: "身份查询没有给出可读取的创建时间" };
  if (input.handleCreationMs === null) return { ok: false, reason: "无法从进程句柄读取创建时间，拒绝强杀" };
  if (Math.abs(input.handleCreationMs - input.cimCreationMs) > HANDLE_BINDING_TOLERANCE_MS) {
    return { ok: false, reason: "进程句柄的创建时间与身份查询不一致（PID 可能已被复用），拒绝强杀" };
  }
  return { ok: true, reason: "进程句柄与身份查询指向同一进程" };
}

/**
 * The termination script: it opens the process, reads the creation time through that handle, compares it
 * with the identity answer and with the recorded start time, and only then terminates through the same
 * handle. There is deliberately no `Stop-Process -Id` path: a PID that is not bound to a verified
 * handle is never killed.
 */
export function terminateByHandleScript(input: { pid: number; commandFragment: string; expectedEpochMs: number; toleranceMs: number }): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "function Done($obj) { $obj | ConvertTo-Json -Compress | Write-Output; exit 0 }",
    "try {",
    `  $cim = Get-CimInstance Win32_Process -Filter "ProcessId = ${input.pid}" | Select-Object ProcessId,CommandLine,CreationDate`,
    "  if ($null -eq $cim) { Done @{ ok = $true; alreadyGone = $true; reason = 'not-running' } }",
    `  if ($cim.ProcessId -ne ${input.pid}) { Done @{ ok = $false; reason = 'pid-mismatch' } }`,
    // The command line is normalized to backslashes before the fragment match: on Windows the real
    // command line has backslashes, and a fragment written with forward slashes must still match.
    `  if (([string]$cim.CommandLine).Replace('/', '\\') -notlike '*${input.commandFragment.replace(/\//g, "\\")}*') { Done @{ ok = $false; reason = 'command-mismatch' } }`,
    "  $cimCreated = $cim.CreationDate",
    "  if ($null -eq $cimCreated) { Done @{ ok = $false; reason = 'no-creation-time' } }",
    `  $proc = Get-Process -Id ${input.pid}`,
    "  if ($null -eq $proc) { Done @{ ok = $false; reason = 'handle-open-failed' } }",
    "  $handleCreated = $proc.StartTime.ToUniversalTime()",
    "  if ([math]::Abs(($handleCreated - $cimCreated.ToUniversalTime()).TotalMilliseconds) -gt 2000) { Done @{ ok = $false; reason = 'handle-creation-mismatch' } }",
    // The recorded start time arrives as epoch milliseconds: a [datetime] cast of an ISO string with a
    // Z is read as local time on this shell, which would compare two different clocks.
    `  $expected = [DateTimeOffset]::FromUnixTimeMilliseconds(${input.expectedEpochMs}).UtcDateTime`,
    `  if ([math]::Abs(($handleCreated - $expected).TotalMilliseconds) -gt ${input.toleranceMs}) { Done @{ ok = $false; reason = 'creation-mismatch' } }`,
    "  $proc.Kill()",
    "  $proc.WaitForExit(10000) | Out-Null",
    "  Done @{ ok = $true; reason = 'terminated' }",
    "} catch {",
    "  Done @{ ok = $false; reason = $_.Exception.Message }",
    "}",
  ].join("\n");
}

export interface TerminateResult {
  ok: boolean;
  reason: string;
  /** The process was already gone: nothing to kill, which is a successful stop. */
  alreadyGone?: boolean;
}

/**
 * Verifies the identity and terminates through the same OS handle. Any step that cannot be completed
 * refuses, and the caller must not fall back to killing the PID: an unbound PID is exactly the process
 * this module exists to protect.
 */
export async function verifyAndTerminateByHandle(
  input: { pid: number; role: WorkerRole; expectedCreationMs: number; toleranceMs?: number },
  runner: OsScriptRunner = defaultRunner,
  timeoutMs = 15_000,
): Promise<TerminateResult> {
  if (!Number.isSafeInteger(input.pid) || input.pid <= 0) return { ok: false, reason: "无效的 PID" };
  if (!Number.isFinite(input.expectedCreationMs)) return { ok: false, reason: "运行记录中的启动时间无法解析" };
  const script = terminateByHandleScript({
    pid: input.pid,
    commandFragment: expectedCommandFragment(input.role),
    expectedEpochMs: input.expectedCreationMs,
    toleranceMs: input.toleranceMs ?? CREATION_TOLERANCE_MS,
  });
  let stdout: string;
  try {
    stdout = await runner(script, timeoutMs);
  } catch {
    return { ok: false, reason: "无法通过操作系统终止进程（命令缺失或超时），拒绝强杀" };
  }
  try {
    const parsed = JSON.parse(stdout.trim().split("\n").filter(Boolean).pop() ?? "") as { ok?: boolean; reason?: string; alreadyGone?: boolean } | null;
    if (!parsed || typeof parsed.ok !== "boolean") return { ok: false, reason: "操作系统返回了无法解析的结果，拒绝强杀" };
    if (parsed.ok && parsed.alreadyGone) return { ok: true, reason: "进程已不存在", alreadyGone: true };
    return { ok: parsed.ok, reason: parsed.reason ?? (parsed.ok ? "已终止" : "拒绝强杀") };
  } catch {
    return { ok: false, reason: "操作系统返回了无法解析的结果，拒绝强杀" };
  }
}
