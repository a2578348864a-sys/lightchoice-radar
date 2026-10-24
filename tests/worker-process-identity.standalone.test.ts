// The `stop --force` identity chain: what the OS answers, what a handle proves, and what is refused.
//
// The scenarios that matter are the ones where a weaker implementation would kill the wrong process:
// the OS answering about a different PID, a creation time that cannot be read, and the race where the
// verified process exits and its PID is reused before the kill lands.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { test } from "node:test";
import {
  CREATION_TOLERANCE_MS,
  commandLineMatches,
  handleBindingDecision,
  parseOsInstant,
  queryWindowsProcess,
  terminateByHandleScript,
  verifyAndTerminateByHandle,
  verifyWorkerIdentity,
  type OsProcess,
  type OsScriptRunner,
} from "../apps/worker/src/process-identity.ts";

const NOW = Date.UTC(2026, 9, 23, 7, 0, 0);
const maxAgeMs = 60_000;
const WORKER = "ads-policy" as const;
const startedAt = new Date(NOW - 300_000).toISOString();

const record = (pid: number, at = startedAt) => ({ pid, startedAt: at });
const beat = (pid: number, at = startedAt, when = new Date(NOW - 2_000).toISOString()) => ({ pid, startedAt: at, at: when });

/** A runner that answers with fixed output, so the OS can be made to answer wrongly. */
function runnerReturning(stdout: string): OsScriptRunner {
  return async () => stdout;
}

const cimJson = (fields: Record<string, unknown>) => JSON.stringify(fields);

test("the OS must answer about the PID that was asked about", async () => {
  const mine = await queryWindowsProcess(process.pid);
  assert.ok(mine, "the real OS answered for this test process");
  assert.equal(mine!.pid, process.pid);

  // An answer about a different PID is not an answer.
  const other = await queryWindowsProcess(process.pid, 8_000, runnerReturning(cimJson({ ProcessId: 999, CommandLine: "node apps/worker/src/ads-policy.ts", CreationDate: "/Date(1)/" })));
  assert.equal(other, null, "a mismatched PID is refused");
});

test("a creation time that is missing or unreadable makes the identity check unavailable", async () => {
  for (const creationDate of [undefined, null, "", "not-a-date", 12345]) {
    const answered = await queryWindowsProcess(process.pid, 8_000, runnerReturning(cimJson({ ProcessId: process.pid, CommandLine: "node apps/worker/src/ads-policy.ts", CreationDate: creationDate })));
    assert.equal(answered, null, `creationDate=${JSON.stringify(creationDate)} must not count as an answer`);
  }
  // ... and an unavailable identity check refuses the kill rather than trusting the files alone.
  const identity = verifyWorkerIdentity({ role: WORKER, record: record(4242), beat: beat(4242), os: null, now: NOW, maxAgeMs });
  assert.equal(identity.ok, false);
  assert.match(identity.reason, /无法从操作系统确认/);
});

test("the handle must be bound to the same process the identity check saw", () => {
  assert.equal(handleBindingDecision({ cimCreationMs: 1_000, handleCreationMs: 1_100 }).ok, true, "the same process read twice");
  assert.equal(handleBindingDecision({ cimCreationMs: 1_000, handleCreationMs: null }).ok, false, "no creation time from the handle");
  assert.match(handleBindingDecision({ cimCreationMs: null, handleCreationMs: 1_000 }).reason, /身份查询/);
  const reused = handleBindingDecision({ cimCreationMs: 1_000, handleCreationMs: 9_000 });
  assert.equal(reused.ok, false);
  assert.match(reused.reason, /PID 可能已被复用/);
});

test("the termination script kills through the handle, and has no bare-PID path", () => {
  const script = terminateByHandleScript({ pid: 4242, commandFragment: "ads-policy.ts", expectedEpochMs: Date.parse(startedAt), toleranceMs: CREATION_TOLERANCE_MS });
  assert.match(script, /Get-Process -Id 4242/, "the process is opened, so its handle is held");
  assert.match(script, /\$proc\.Kill\(\)/, "and terminated through it");
  assert.match(script, /\$proc\.StartTime/, "with its creation time read through the handle");
  assert.doesNotMatch(script, /Stop-Process/, "never a bare PID kill");
  // Identity is checked before anything is terminated.
  assert.ok(script.indexOf("StartTime") < script.indexOf("Kill()"), "the creation time is read before the kill");
});

test("a live process is killed only when its handle matches the recorded start time", async () => {
  // A real child process, so the OS query, the handle and the kill are all real. Its command line
  // carries the worker entry, so only the creation time can refuse it.
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000);", "apps/worker/src/ads-policy.ts"], { stdio: "ignore" });
  await new Promise((resolve) => setTimeout(resolve, 500));
  const pid = child.pid!;
  const os = await queryWindowsProcess(pid);
  assert.ok(os, "the OS answered for the live child");
  assert.match(os!.commandLine, /ads-policy\.ts/, "and its command line is the worker's");
  const realCreation = parseOsInstant(os!.creationDate)!;

  // A wrong expected start time: the handle belongs to another process than the record claims.
  const refused = await verifyAndTerminateByHandle({ pid, role: WORKER, expectedCreationMs: realCreation - 10 * 60_000 });
  assert.equal(refused.ok, false, `refused (${refused.reason})`);
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.equal(child.exitCode, null, "and the child is still alive");

  // The recorded start time is the process's own: the kill goes through the verified handle.
  // The exit listener is attached before the kill: the process can be gone before the call returns.
  const exited = new Promise<boolean>((resolve) => child.once("exit", () => resolve(true)));
  const terminated = await verifyAndTerminateByHandle({ pid, role: WORKER, expectedCreationMs: realCreation });
  assert.equal(terminated.ok, true, `terminated (${terminated.reason})`);
  const gone = await Promise.race([exited, new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 10_000))]);
  assert.equal(gone, true, "the child is gone");
});

test("a process that is already gone is a successful stop, not a kill of whatever holds the PID", async () => {
  const result = await verifyAndTerminateByHandle({ pid: 2 ** 22, role: WORKER, expectedCreationMs: NOW - 60_000 });
  assert.equal(result.ok, true, "nothing to kill");
  assert.equal(result.alreadyGone, true);
});

test("when the OS cannot run the query at all, the kill is refused", async () => {
  const failing: OsScriptRunner = async () => { throw new Error("command not found"); };
  const result = await verifyAndTerminateByHandle({ pid: process.pid, role: WORKER, expectedCreationMs: NOW }, failing);
  assert.equal(result.ok, false);
  assert.match(result.reason, /拒绝强杀/);
  // The identity check refuses too, so no path kills without the OS answer.
  const identity = verifyWorkerIdentity({ role: WORKER, record: record(process.pid), beat: beat(process.pid), os: null, now: NOW, maxAgeMs });
  assert.equal(identity.ok, false);
});

test("a reused PID running another program is refused even when the files match", () => {
  const other: OsProcess = { pid: 4242, commandLine: "node apps/api/src/main.ts", creationDate: new Date(NOW - 5_000).toISOString() };
  const identity = verifyWorkerIdentity({ role: WORKER, record: record(4242), beat: beat(4242), os: other, now: NOW, maxAgeMs });
  assert.equal(identity.ok, false);
  assert.match(identity.reason, /不是本项目 Worker/);
});

test("the fragment match survives whichever slash direction Windows reports", () => {
  // Windows reports backslashes (`path.join` normalized the entry); the fragment is written with
  // forward slashes. R51 found the scoped worker's path fragment matched neither direction's other
  // side, which made status' process check and `stop --force` refuse a genuine worker.
  assert.equal(commandLineMatches("node D:\\proj\\apps\\worker\\src\\main.ts", "apps/worker/src/main.ts"), true);
  assert.equal(commandLineMatches("node apps/worker/src/main.ts", "apps\\worker\\src\\main.ts"), true);
  assert.equal(commandLineMatches("node D:\\proj\\APPS\\WORKER\\SRC\\MAIN.TS", "apps/worker/src/main.ts"), true, "Windows paths are case-insensitive");
  assert.equal(commandLineMatches("node apps/api/src/main.ts", "apps/worker/src/main.ts"), false, "still path-specific, not 'contains main.ts'");
  assert.equal(commandLineMatches("node src/main.ts", "apps/worker/src/main.ts"), false);

  const beatNow = beat(4242);
  const os = (commandLine: string): OsProcess => ({ pid: 4242, commandLine, creationDate: startedAt });
  const backslash = verifyWorkerIdentity({ role: "radar-translate", record: record(4242), beat: beatNow, os: os('"C:\\Program Files\\nodejs\\node.exe" --env-file-if-exists=.env D:\\proj\\AIHOT\\apps\\worker\\src\\main.ts'), now: NOW, maxAgeMs });
  assert.equal(backslash.ok, true, `the real Windows form is accepted (${backslash.reason})`);
  const forward = verifyWorkerIdentity({ role: "radar-translate", record: record(4242), beat: beatNow, os: os("node apps/worker/src/main.ts"), now: NOW, maxAgeMs });
  assert.equal(forward.ok, true, "a forward-slash command line is accepted too");
});

test("the termination script matches the translate entry in backslash form", () => {
  const script = terminateByHandleScript({ pid: 4242, commandFragment: "apps/worker/src/main.ts", expectedEpochMs: Date.parse(startedAt), toleranceMs: CREATION_TOLERANCE_MS });
  assert.match(script, /Replace\('\/', '\\'\)/, "the command line is normalized to backslashes before the match");
  assert.match(script, /-notlike '\*apps\\worker\\src\\main\.ts\*'/, "and the fragment itself is in backslash form");
});
