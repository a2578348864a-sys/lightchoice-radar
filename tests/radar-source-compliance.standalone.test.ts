import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

// Compliance guard for declared sources. The hosts below were checked with the project's own HTTP
// layer on 2026-10-23 (docs/radar/source-research-2026-10-23.json):
// - sellercentral.amazon.com serves `User-agent: * / Disallow: /`, so Seller Forums and Help Hub
//   must stay manual imports, whatever a future task wants.
// - Seller Forums additionally needs a seller login, and the Ads/Help pages return JavaScript shells.
const VERIFIED_PUBLIC_HOSTS = [
  "sell.amazon.com",
  "sellingpartners.aboutamazon.com",
  "www.cpsc.gov",
  "www.federalregister.gov",
  // advertising.amazon.com: robots allows the help paths, no login for the Ads policy pages, and the
  // rendered content was verified in docs/radar/pw-experiment-2026-10-23.json.
  "advertising.amazon.com",
  // www.amz123.com: read with the project's own HTTP layer on 2026-10-23. Its robots.txt allows the
  // two columns this source reads and forbids /search, /api and /tag-*; the collector checks the
  // current robots.txt before every request (docs/radar/amz123-lead-collection-2026-10-23.json).
  "www.amz123.com",
];
const ROBOTS_BLOCKED_HOSTS = ["sellercentral.amazon.com"];

type Declared = { id: string; kind: string; config: Record<string, unknown> };

const pack = JSON.parse(readFileSync(new URL("../industry/sources.json", import.meta.url), "utf8")) as {
  sources: Declared[];
};

const targetOf = (source: Declared): string => String(source.config.feedUrl ?? source.config.url ?? "");

test("no declared source points at a host whose robots.txt forbids crawling", () => {
  for (const source of pack.sources) {
    const target = targetOf(source);
    assert.ok(target, `${source.id} declares a feedUrl or url`);
    const host = new URL(target).hostname;
    assert.equal(
      ROBOTS_BLOCKED_HOSTS.includes(host),
      false,
      `${source.id} targets ${host}, which serves Disallow: / — keep it a manual import`,
    );
  }
});

test("every declared source is https on a host verified as publicly readable", () => {
  for (const source of pack.sources) {
    const url = new URL(targetOf(source));
    assert.equal(url.protocol, "https:", `${source.id} must use https`);
    assert.ok(
      VERIFIED_PUBLIC_HOSTS.includes(url.hostname),
      `${source.id} targets ${url.hostname}; add it to the verified list only after a real read and a robots check`,
    );
  }
});
