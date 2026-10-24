// Runs the Ads policy scheduler under a supervisor, so an operator gets "start it and leave it" rather
// than a process that quietly ends the first time the watchdog fires.
//
// Start it with the environment file (the child inherits the same environment):
//   node --env-file=.env apps/worker/src/ads-policy-daemon.ts
// Stop it with Ctrl+C or SIGTERM: the signal is passed to the child, which releases its instance lock.
// It starts nothing when RADAR_ADS_POLICY_ENABLED is off — the child reports "off" and exits cleanly.
import { fileURLToPath } from "node:url";
import { EXIT, supervise, supervisorPolicy } from "./supervisor.ts";

const policy = supervisorPolicy(process.env);
const script = fileURLToPath(new URL("./ads-policy.ts", import.meta.url));

console.log(JSON.stringify({
  level: "info", msg: "ads policy supervisor starting", pid: process.pid, child: script,
  initialDelayMs: policy.initialDelayMs, maxDelayMs: policy.maxDelayMs, maxConsecutiveFailures: policy.maxConsecutiveFailures,
  enabled: /^(1|true|yes|on)$/i.test(String(process.env.RADAR_ADS_POLICY_ENABLED ?? "").trim()),
}));

const code = await supervise({
  name: "ads-policy",
  command: process.execPath,
  args: [script],
  policy,
});
process.exit(code === undefined ? EXIT.runtime : code);
