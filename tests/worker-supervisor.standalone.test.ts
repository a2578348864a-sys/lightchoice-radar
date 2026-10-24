// The supervisor is the piece that turns "the watchdog exits 1" into an actually running service.
// These tests use real child processes with controlled exit codes: a supervisor that only looks right
// on paper is what left the Ads scheduler unmanaged in the first place.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { EXIT, backoffDelayMs, classifyExit, restartDecision, supervise, supervisorPolicy } from "../apps/worker/src/supervisor.ts";

const policy = { initialDelayMs: 5, maxDelayMs: 40, maxConsecutiveFailures: 3, stopGraceMs: 2_000 };

test("an exit code says whether a restart can help", () => {
  assert.equal(classifyExit(0, null), "clean", "a planned exit");
  assert.equal(classifyExit(2, null), "config", "an unusable configuration");
  assert.equal(classifyExit(3, null), "source-disabled", "a paused source");
  assert.equal(classifyExit(1, null), "runtime", "a failure");
  assert.equal(classifyExit(null, "SIGKILL"), "runtime", "a killed child is not a planned exit");
  assert.equal(classifyExit(null, "SIGTERM"), "runtime", "nor is a signal the supervisor did not send");
  assert.equal(classifyExit(137, null), "runtime", "an unknown non-zero code is a failure");
});

test("only a runtime failure is retried, and only a bounded number of times", () => {
  assert.equal(restartDecision("clean", 0, policy).restart, false);
  assert.equal(restartDecision("config", 0, policy).restart, false);
  assert.equal(restartDecision("source-disabled", 0, policy).restart, false);
  assert.equal(restartDecision("runtime", 1, policy).restart, true);
  assert.equal(restartDecision("runtime", 3, policy).restart, false, "the last allowed failure stops the supervisor");
  assert.match(restartDecision("runtime", 3, policy).reason, /inspect the logs/);
});

test("the restart delay doubles and stops growing at the maximum", () => {
  assert.equal(backoffDelayMs(1, policy), 5);
  assert.equal(backoffDelayMs(2, policy), 10);
  assert.equal(backoffDelayMs(3, policy), 20);
  assert.equal(backoffDelayMs(4, policy), 40);
  assert.equal(backoffDelayMs(40, policy), 40, "bounded, so a broken site is not hammered");
  assert.equal(backoffDelayMs(0, policy), 5, "the first wait is the initial delay");
});

test("the restart policy is configurable within safe bounds", () => {
  const defaults = supervisorPolicy({});
  assert.equal(defaults.initialDelayMs, 30_000);
  assert.equal(defaults.maxDelayMs, 1_800_000);
  assert.equal(defaults.maxConsecutiveFailures, 6);
  assert.equal(supervisorPolicy({ RADAR_SUPERVISOR_MAX_FAILURES: "0" }).maxConsecutiveFailures, 6, "zero is not a policy");
  assert.equal(supervisorPolicy({ RADAR_SUPERVISOR_INITIAL_DELAY_SECONDS: "99999" }).initialDelayMs, 30_000);
  assert.equal(supervisorPolicy({ RADAR_SUPERVISOR_MAX_FAILURES: "2" }).maxConsecutiveFailures, 2);
});

function child(script: string, counter: string): { command: string; args: string[] } {
  return { command: process.execPath, args: ["-e", script] };
}

function tempCounter(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "radar-supervisor-"));
  return path.join(dir, "runs");
}

const runs = (file: string): number => {
  try { return readFileSync(file, "utf8").length; } catch { return 0; }
};

test("a configuration error stops the supervisor after one start", async () => {
  const counter = tempCounter();
  const events: Record<string, unknown>[] = [];
  const code = await supervise({
    ...child(`require('fs').appendFileSync(${JSON.stringify(counter)}, 'x'); process.exit(2);`, counter),
    name: "ads-policy", control: false, policy, log: (e) => events.push(e),
  });
  assert.equal(code, EXIT.config);
  assert.equal(runs(counter), 1, "the child ran exactly once");
  assert.equal(events.at(-1)?.verdict, "config");
  rmSync(path.dirname(counter), { recursive: true, force: true });
});

test("a runtime failure is restarted, and a later success ends the supervision cleanly", async () => {
  const counter = tempCounter();
  const events: Record<string, unknown>[] = [];
  const code = await supervise({
    ...child(`const fs=require('fs'); const n=fs.existsSync(${JSON.stringify(counter)})?fs.readFileSync(${JSON.stringify(counter)},'utf8').length:0; fs.appendFileSync(${JSON.stringify(counter)},'x'); process.exit(n < 2 ? 1 : 0);`, counter),
    name: "ads-policy", control: false, policy, log: (e) => events.push(e),
  });
  assert.equal(code, EXIT.clean);
  assert.equal(runs(counter), 3, "two failures then the run that succeeded");
  assert.deepEqual(events.map((e) => e.verdict), ["runtime", "runtime", "clean"]);
  rmSync(path.dirname(counter), { recursive: true, force: true });
});

test("a worker that keeps failing is left to an operator instead of restarting forever", async () => {
  const counter = tempCounter();
  const events: Record<string, unknown>[] = [];
  const code = await supervise({
    ...child(`require('fs').appendFileSync(${JSON.stringify(counter)}, 'x'); process.exit(1);`, counter),
    name: "ads-policy", control: false, policy, log: (e) => events.push(e),
  });
  assert.equal(code, EXIT.runtime);
  assert.equal(runs(counter), 3, "exactly the allowed number of attempts");
  assert.match(String(events.at(-1)?.reason), /consecutive failures/);
  rmSync(path.dirname(counter), { recursive: true, force: true });
});

test("a paused source is not restarted", async () => {
  const counter = tempCounter();
  const code = await supervise({
    ...child(`require('fs').appendFileSync(${JSON.stringify(counter)}, 'x'); process.exit(3);`, counter),
    name: "ads-policy", control: false, policy, log: () => {},
  });
  assert.equal(code, EXIT.sourceDisabled);
  assert.equal(runs(counter), 1);
  rmSync(path.dirname(counter), { recursive: true, force: true });
});

test("a stop signal ends the supervisor and the child, without a restart", async () => {
  const counter = tempCounter();
  const events: Record<string, unknown>[] = [];
  const running = supervise({
    ...child(`require('fs').appendFileSync(${JSON.stringify(counter)}, 'x'); setInterval(() => {}, 1000);`, counter),
    name: "ads-policy", control: false, policy, log: (e) => events.push(e),
  });
  // Give the child time to start, then stop the supervisor the way a console Ctrl+C would.
  for (let i = 0; i < 100 && runs(counter) === 0; i += 1) await new Promise((r) => setTimeout(r, 20));
  assert.equal(runs(counter), 1, "the child is running");
  process.emit("SIGTERM");
  const code = await running;
  assert.equal(code, EXIT.clean);
  assert.equal(runs(counter), 1, "no restart after a stop");
  rmSync(path.dirname(counter), { recursive: true, force: true });
});
