// The Ads policy scheduler is off by default and only reads its two switches. These are the rules an
// operator relies on when turning it on: bounds on the cadence, a watchdog, a bounded backoff, and the
// one-run mode used to check the path without leaving a daemon behind.
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { adsPolicySchedule, nextRunDelayMs, startWatchdog } from "../apps/worker/src/ads-policy-schedule.ts";

const MINUTE = 60_000;

test("the scheduler stays off unless the deployment turns it on", () => {
  for (const env of [{}, { RADAR_ADS_POLICY_ENABLED: "" }, { RADAR_ADS_POLICY_ENABLED: "0" }, { RADAR_ADS_POLICY_ENABLED: "false" }]) {
    assert.equal(adsPolicySchedule(env).enabled, false, JSON.stringify(env));
  }
  for (const value of ["1", "true", "TRUE", "yes", "on"]) {
    assert.equal(adsPolicySchedule({ RADAR_ADS_POLICY_ENABLED: value }).enabled, true, value);
  }
});

test("the cadence and the watchdog fall back to safe values outside their bounds", () => {
  const defaults = adsPolicySchedule({ RADAR_ADS_POLICY_ENABLED: "1" });
  assert.equal(defaults.intervalMs, 360 * MINUTE, "a few reads a day by default");
  assert.equal(defaults.timeoutMs, 15 * MINUTE);
  assert.equal(defaults.once, false);

  assert.equal(adsPolicySchedule({ RADAR_ADS_POLICY_INTERVAL_MINUTES: "5" }).intervalMs, 360 * MINUTE, "below the floor");
  assert.equal(adsPolicySchedule({ RADAR_ADS_POLICY_INTERVAL_MINUTES: "99999" }).intervalMs, 360 * MINUTE, "above the cap");
  assert.equal(adsPolicySchedule({ RADAR_ADS_POLICY_INTERVAL_MINUTES: "60" }).intervalMs, 60 * MINUTE);
  assert.equal(adsPolicySchedule({ RADAR_ADS_POLICY_INTERVAL_MINUTES: "abc" }).intervalMs, 360 * MINUTE);

  assert.equal(adsPolicySchedule({ RADAR_ADS_POLICY_TIMEOUT_MINUTES: "0" }).timeoutMs, 15 * MINUTE);
  assert.equal(adsPolicySchedule({ RADAR_ADS_POLICY_TIMEOUT_MINUTES: "120" }).timeoutMs, 15 * MINUTE);
  assert.equal(adsPolicySchedule({ RADAR_ADS_POLICY_TIMEOUT_MINUTES: "30" }).timeoutMs, 30 * MINUTE);
  assert.equal(adsPolicySchedule({ RADAR_ADS_POLICY_ONCE: "yes" }).once, true);
});

test("a failing run backs off to four cadences and then keeps retrying at that pace", () => {
  assert.equal(nextRunDelayMs(0, 60 * MINUTE), 60 * MINUTE, "a success waits the cadence");
  assert.equal(nextRunDelayMs(1, 60 * MINUTE), 120 * MINUTE);
  assert.equal(nextRunDelayMs(2, 60 * MINUTE), 240 * MINUTE);
  assert.equal(nextRunDelayMs(9, 60 * MINUTE), 240 * MINUTE, "the backoff is bounded");
  assert.equal(nextRunDelayMs(-1, 60 * MINUTE), 60 * MINUTE, "a negative count is not a state");
});

test("the watchdog fires once after its deadline and a finished run cancels it", () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  let fired = 0;
  const cancel = startWatchdog(15 * MINUTE, () => { fired += 1; });
  mock.timers.tick(15 * MINUTE - 1);
  assert.equal(fired, 0, "nothing before the deadline");
  mock.timers.tick(1);
  assert.equal(fired, 1);

  const cancelled = startWatchdog(MINUTE, () => { fired += 1; });
  cancelled();
  mock.timers.tick(5 * MINUTE);
  assert.equal(fired, 1, "a finished run does not exit the process later");
  mock.timers.reset();
});
