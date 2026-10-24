// Stopping a worker on Windows. Signals do not reach a child process there, so the supervisor asks over
// IPC and a worker started by hand is asked through a request file. These tests use a real child
// process: the point of the mechanism is what an operator actually observes, not the shape of the code.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// The request files live under the checkout by default; this file must not touch a live worker's state.
process.env.RADAR_RUN_DIR = mkdtempSync(path.join(tmpdir(), "radar-run-"));
const control = await import("../apps/worker/src/control.ts");
const { supervise } = await import("../apps/worker/src/supervisor.ts");

const policy = { initialDelayMs: 5, maxDelayMs: 20, maxConsecutiveFailures: 2, stopGraceMs: 2_000 };

const waitFor = async (predicate: () => boolean, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
};

test("a stop request is a file, and the next start clears it", () => {
  assert.equal(control.stopRequested("ads-policy"), false);
  control.requestStop("ads-policy", "test");
  assert.equal(control.stopRequested("ads-policy"), true);
  control.clearStopRequest("ads-policy");
  assert.equal(control.stopRequested("ads-policy"), false, "a stale request must not stop the next start");
});

test("a worker watches for the request instead of being killed", async () => {
  let stopped = 0;
  const unwatch = control.watchStopRequest("ads-policy", () => { stopped += 1; }, 20);
  control.requestStop("ads-policy", "test");
  assert.ok(await waitFor(() => stopped === 1, 1_000), "the watcher fires");
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(stopped, 1, "and only once");
  control.clearStopRequest("ads-policy");
  unwatch();
});

test("the run record says who is running, and is removed when the role stops", () => {
  const record = control.writeRunRecord("radar-announcements", "test");
  assert.equal(record.pid, process.pid);
  assert.equal(control.readRunRecord("radar-announcements")?.entry, "test");
  control.clearRunRecord("radar-announcements");
  assert.equal(control.readRunRecord("radar-announcements"), null);
});

test("a stop signal asks the child over IPC, and a child that leaves cleanly is not restarted", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "radar-ipc-"));
  const counter = path.join(dir, "events");
  const script = `
    const fs = require('fs');
    fs.appendFileSync(${JSON.stringify(counter)}, 'start');
    process.on('message', (message) => {
      if (message && message.type === 'stop') { fs.appendFileSync(${JSON.stringify(counter)}, ':stop'); process.exit(0); }
    });
    setInterval(() => {}, 1000);
  `;
  const events: Record<string, unknown>[] = [];
  const running = supervise({
    name: "ads-policy", control: false, command: process.execPath, args: ["-e", script], policy, log: (e) => events.push(e),
  });
  assert.ok(await waitFor(() => { try { return readFileSync(counter, "utf8").includes("start"); } catch { return false; } }, 3_000), "the child started");
  process.emit("SIGTERM");
  const code = await running;
  await waitFor(() => false, 200);
  assert.equal(code, 0, "a clean stop is a clean exit");
  assert.equal(readFileSync(counter, "utf8"), "start:stop", "the child ran its own stop path, it was not terminated");
  rmSync(dir, { recursive: true, force: true });
});

test("a stop request file also stops a supervised worker", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "radar-flag-"));
  const counter = path.join(dir, "events");
  const script = `
    const fs = require('fs');
    fs.appendFileSync(${JSON.stringify(counter)}, 'start');
    process.on('message', (message) => {
      if (message && message.type === 'stop') { fs.appendFileSync(${JSON.stringify(counter)}, ':stop'); process.exit(0); }
    });
    setInterval(() => {}, 1000);
  `;
  const running = supervise({
    name: "radar-announcements", control: true, command: process.execPath, args: ["-e", script], policy, log: () => {},
  });
  assert.ok(await waitFor(() => { try { return readFileSync(counter, "utf8").includes("start"); } catch { return false; } }, 3_000));
  control.requestStop("radar-announcements", "test");
  const code = await running;
  assert.equal(code, 0);
  assert.equal(readFileSync(counter, "utf8"), "start:stop");
  assert.equal(control.stopRequested("radar-announcements"), false, "the supervisor clears the request it honoured");
  rmSync(dir, { recursive: true, force: true });
});

// `stop --force` may only kill a process it can prove is this project's worker. The proof is the
// heartbeat the live process writes: pid and start time must both match the run record. Anything else
// — a missing or stale heartbeat, a different pid, a reused pid — is refused.
test("a force kill is refused unless the heartbeat proves the process identity", () => {
  const now = Date.now();
  const record = { role: "ads-policy" as const, pid: 4242, startedAt: new Date(now - 60_000).toISOString(), entry: "ads-policy.ts" };
  const beat = { pid: 4242, startedAt: record.startedAt, at: new Date(now - 2_000).toISOString() };
  const maxAgeMs = 60_000;

  assert.equal(control.verifyProcessIdentity({ record, beat, now, maxAgeMs }).ok, true, "a live, matching heartbeat proves it");
  assert.match(control.verifyProcessIdentity({ record, beat: null, now, maxAgeMs }).reason, /没有心跳/);
  assert.match(control.verifyProcessIdentity({ record: null, beat, now, maxAgeMs }).reason, /没有运行记录/);
  assert.match(control.verifyProcessIdentity({ record, beat: { ...beat, at: new Date(now - 10 * 60_000).toISOString() }, now, maxAgeMs }).reason, /心跳已过期/);
  assert.match(control.verifyProcessIdentity({ record, beat: { ...beat, pid: 9999 }, now, maxAgeMs }).reason, /pid=9999/);
  assert.match(control.verifyProcessIdentity({ record, beat: { ...beat, startedAt: new Date(now - 30_000).toISOString() }, now, maxAgeMs }).reason, /PID 可能已被其他进程复用/);
});

test("a live worker's own heartbeat proves its identity, and stops when it does", async () => {
  const stopBeat = control.startHeartbeat("radar-announcements", 50);
  const record = control.writeRunRecord("radar-announcements", "test");
  const identity = control.verifyProcessIdentity({
    record, beat: control.readHeartbeat("radar-announcements"), now: Date.now(), maxAgeMs: control.HEARTBEAT_FRESH_MS,
  });
  assert.equal(identity.ok, true, `the process proves itself: ${identity.reason}`);
  stopBeat();
  await new Promise((resolve) => setTimeout(resolve, 60));
  control.clearHeartbeat("radar-announcements");
  const after = control.verifyProcessIdentity({ record, beat: control.readHeartbeat("radar-announcements"), now: Date.now(), maxAgeMs: control.HEARTBEAT_FRESH_MS });
  assert.equal(after.ok, false, "once the heartbeat stops, the PID is no longer provably this worker");
  control.clearRunRecord("radar-announcements");
});
