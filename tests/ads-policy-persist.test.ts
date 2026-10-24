// Ads policy records reuse the article pipeline: same identity, same content hash, same revisions.
// What is specific to Ads is the date mapping — the page's "Updated on" date is the source update
// time, and publication stays unknown. Uses PostgreSQL (tests/databases.ts gives each file a copy).
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { adsPolicyCandidate } from "@aihot/backend/sources/ads-policy";
import { identityKeyFor } from "@aihot/backend/content/materials";
import type { RenderedPage } from "@aihot/backend/sources/browser-render";

const T = tag();
const SOURCE = `ads-policy-${T}`;
const GENERAL_URL = "https://advertising.amazon.com/help/G4U9JBZH3664JWX2";

const BODY_V1 = [
  "General requirements Learn about Amazon Ads general requirements to create compliant, effective campaigns.",
  "Updated on Jul 22, 2026 This section covers requirements for all ads.",
  "Advertisers are required to: Comply with all applicable local laws and regulations.",
  "Failure to comply may result in ads being paused, removed, or restricted.",
  "Advertisers must not use unauthorized content that uses Amazon's Choice or altered Amazon logos.",
].join(" ");

const BODY_V2 = `${BODY_V1} Advertisers are required to keep substantiation for claims on file for two years.`;

function page(body: string): RenderedPage {
  return {
    url: GENERAL_URL,
    finalUrl: GENERAL_URL,
    status: 200,
    title: "General requirements | Amazon Ads Support Center",
    h1: "General requirements",
    // The renderer wraps the article in the site chrome; the candidate builder strips it.
    text: `Skip to main content Support Center No account selected Set Billing as your homepage ${body} More Help Contact Us © 2026 Amazon.com, Inc.`,
    links: [],
  };
}

const candidateFor = (body: string) => ({ ...adsPolicyCandidate(page(body))!, sourceId: SOURCE, via: "fetch" as const });

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, config, tier, participation_mode, interval_minutes, tags, site_fulltext, enabled)
            VALUES (${SOURCE}, ${"Ads 政策测试源"}, 'web_list', ${sql.json({})}, 'T1', 'editorial', 1440, ${["ads_policy"]}, false, true)`;
});

after(async () => {
  await sql`DELETE FROM articles WHERE source_id = ${SOURCE}`;
  await sql`DELETE FROM fetch_runs WHERE source_id = ${SOURCE}`;
  await sql`DELETE FROM sources WHERE id = ${SOURCE}`;
  await closeDb();
});

test("the first Ads candidate is stored with the update date and no publication date", async () => {
  const candidate = candidateFor(BODY_V1);
  const first = await upsertMaterial(candidate);
  assert.equal(first.created, true);

  const [row] = await sql<{ published_at: Date | null; publication_time: string | null; source_updated_at: Date | null; body_status: string; revision: number; content_hash: string }[]>`
    SELECT published_at, publication_time, source_updated_at, body_status, revision, content_hash
    FROM articles WHERE id = ${first.articleId}`;
  assert.equal(row!.published_at, null, "a help page states no publication date");
  assert.equal(row!.publication_time, null);
  assert.equal(row!.source_updated_at?.toISOString(), "2026-07-22T00:00:00.000Z", "Updated on lands in source_updated_at");
  assert.equal(row!.body_status, "ok");
  assert.equal(row!.revision, 1);
});

test("the same body collected again creates neither a record nor a revision", async () => {
  const before = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id = ${SOURCE}`;
  const again = await upsertMaterial(candidateFor(BODY_V1));
  const after = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM articles WHERE source_id = ${SOURCE}`;
  assert.equal(again.created, false);
  assert.equal(again.revised, false);
  assert.equal(after[0]!.n, before[0]!.n);

  const [row] = await sql<{ revision: number }[]>`SELECT revision FROM articles WHERE identity_key = ${identityKeyFor(candidateFor(BODY_V1))}`;
  assert.equal(row!.revision, 1, "an unchanged body is not a revision");
});

test("a real edit to the policy body becomes revision 2, not a second article", async () => {
  const edited = await upsertMaterial(candidateFor(BODY_V2));
  assert.equal(edited.created, false);
  assert.equal(edited.revised, true);

  const rows = await sql<{ revision: number; body_text: string; content_hash: string }[]>`
    SELECT revision, body_text, content_hash FROM articles WHERE source_id = ${SOURCE}`;
  assert.equal(rows.length, 1, "one identity, not two articles");
  assert.equal(rows[0]!.revision, 2);
  assert.match(rows[0]!.body_text, /two years/);

  const revisions = await sql<{ revision: number; excerpt: string | null }[]>`
    SELECT revision, excerpt FROM article_revisions WHERE article_id = (SELECT id FROM articles WHERE source_id = ${SOURCE}) ORDER BY revision`;
  assert.deepEqual(revisions.map((r) => r.revision), [1, 2]);
});

test("a page without an Updated on line keeps both dates unknown", async () => {
  const undatedBody = BODY_V1.replace(/Updated on [A-Z][a-z]{2} \d{1,2}, \d{4}/, "");
  const candidate = adsPolicyCandidate(page(undatedBody))!;
  assert.equal(candidate.sourceUpdatedAt, null);
  assert.equal(candidate.publishedAt, null);
  assert.equal(candidate.publicationTime, null);
});
