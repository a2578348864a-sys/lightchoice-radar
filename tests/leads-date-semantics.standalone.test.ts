// Round 22 fix: a third-party report's own date is not a policy effective date.
//
// The lead detail page used to print the date parsed out of the AMZ123 text under the label
// 「政策生效日期」, which reads as if the policy itself had been verified to start that day. The rule
// now has two steps, and the second does not follow from the first: matching an official page proves
// the report points at a real record, but only a date the official record itself states may be shown
// as the policy's effective date. The verifier stores no such date today, so in practice every lead
// keeps its date as `reportedEffectiveDate` or shows none.
import assert from "node:assert/strict";
import { test } from "node:test";
import { leadEffectiveDates } from "../packages/backend/src/publication/leads.ts";

test("a third-party-only lead keeps its date as the report's claim, never as a policy date", () => {
  const dates = leadEffectiveDates("third-party-only", "2026-08-19");
  assert.equal(dates.effectiveDate, null);
  assert.equal(dates.reportedEffectiveDate, "2026-08-19");
  assert.equal(dates.effectiveDateVerified, false);
});

test("an official page match alone does not promote the report's date", () => {
  const dates = leadEffectiveDates("matched-official", "2026-08-19");
  assert.equal(dates.effectiveDate, null, "a matched page proves the record exists, not the date it starts");
  assert.equal(dates.reportedEffectiveDate, "2026-08-19");
  assert.equal(dates.effectiveDateVerified, false);
});

test("a date the official record states is the one shown, and the claim is kept alongside it", () => {
  const dates = leadEffectiveDates("matched-official", "2026-08-19", "2026-09-01");
  assert.equal(dates.effectiveDate, "2026-09-01");
  assert.equal(dates.reportedEffectiveDate, "2026-08-19");
  assert.equal(dates.effectiveDateVerified, true);
});

test("access-restricted evidence does not verify the date either", () => {
  const dates = leadEffectiveDates("access-restricted", "2026-08-19");
  assert.equal(dates.effectiveDate, null);
  assert.equal(dates.effectiveDateVerified, false);
});

test("an unknown evidence state is treated as unverified", () => {
  const dates = leadEffectiveDates("unknown", "2026-08-19");
  assert.equal(dates.effectiveDate, null);
  assert.equal(dates.effectiveDateVerified, false);
});

test("no date in the report stays empty everywhere", () => {
  const dates = leadEffectiveDates("third-party-only", null);
  assert.deepEqual(dates, { effectiveDate: null, reportedEffectiveDate: null, effectiveDateVerified: false });
});

test("a matched record without a stated date verifies nothing", () => {
  const dates = leadEffectiveDates("matched-official", null);
  assert.equal(dates.effectiveDate, null);
  assert.equal(dates.effectiveDateVerified, false);
});
