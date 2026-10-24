// What a failed run says about itself. An operator decides differently for a missing browser, a changed
// page and a site that is briefly down, so the run record and the log have to say which one it was.
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyCollectFailure, type CollectFailureClass } from "@aihot/backend/sources/collect";
import { BrowserUnavailableError } from "@aihot/backend/sources/browser-render";
import { FetchError } from "@aihot/backend/sources/types";
import { HttpStatusError } from "@aihot/backend/lib/http-fetch";

const cases: Array<[string, unknown, CollectFailureClass]> = [
  ["no local Chrome", new BrowserUnavailableError("No local chrome to render with"), "browser-unavailable"],
  ["a page without the expected structure", new FetchError("ads policy hub exposed no approved sub-pages"), "page"],
  ["an empty parse", new FetchError("listing parse returned no entries"), "page"],
  ["the source answered with an error status", new HttpStatusError(503, "https://example.test/feed"), "source-http"],
  ["a name that does not resolve", Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }), "network"],
  ["a refused connection", Object.assign(new Error("fetch failed"), { cause: { code: "ECONNREFUSED" } }), "network"],
  ["a timeout", Object.assign(new Error("fetch failed"), { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }), "network"],
  ["a plain abort", new Error("The operation timed out"), "network"],
  ["an address the fetcher refuses", new Error("Blocked private address for 127.0.0.1"), "blocked-address"],
  ["the same refusal with its code", Object.assign(new Error("lookup"), { code: "EBLOCKED" }), "blocked-address"],
  ["something else", new Error("unexpected"), "unknown"],
];

test("a failure is classified by what an operator would have to fix", () => {
  for (const [label, error, expected] of cases) {
    assert.equal(classifyCollectFailure(error), expected, label);
  }
});

test("classification never throws on a value that is not an Error", () => {
  for (const value of [undefined, null, "boom", 42, { message: "fetch failed" }]) {
    assert.equal(typeof classifyCollectFailure(value), "string");
  }
});
