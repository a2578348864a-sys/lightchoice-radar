// A source can restate the date it last updated a document while the document itself is unchanged.
// That date is the timeline of an undated document (a policy page, an Ads help page), so it must move
// together with the stored source date and the publication projection — but it never dates a document
// that has a trusted publication date, never rewinds, and never turns into a new revision.
// Uses PostgreSQL (tests/databases.ts gives each file a copy).
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial, type MaterialInput } from "@aihot/backend/content/materials";
import { analyzeArticle } from "@aihot/backend/editorial/analyze";
import { publishArticle } from "@aihot/backend/publication/publish";

const T = tag();
const SOURCE = `source-updated-${T}`;
const UNDATED = `https://advertising.amazon.com/help/T${T}A`;
const DATED = `https://advertising.amazon.com/help/T${T}B`;
const DISCOVERED = new Date("2026-08-01T03:00:00Z");

const BODY = [
  "General requirements Learn about Amazon Ads general requirements to create compliant, effective campaigns.",
  "This section covers requirements for all ads. Advertisers are required to comply with all applicable local laws.",
  "Failure to comply may result in ads being paused, removed, or restricted.",
].join(" ");

const at = (iso: string) => new Date(`${iso}T00:00:00Z`);

function material(url: string, overrides: Partial<MaterialInput> = {}): MaterialInput {
  return {
    sourceId: SOURCE, url, title: "General requirements", bodyText: BODY, bodyStatus: "ok",
    via: "fetch", discoveredAt: DISCOVERED, sourceUpdatedAt: at("2026-06-25"), ...overrides,
  };
}

interface Row {
  id: string; revision: number; published_at: Date | null; source_updated_at: Date | null; timeline_at: Date;
}

async function rowOf(url: string): Promise<Row> {
  const [row] = await sql<Row[]>`
    SELECT id, revision, published_at, source_updated_at, timeline_at FROM articles WHERE url = ${url} AND source_id = ${SOURCE}`;
  assert.ok(row, `stored ${url}`);
  return row!;
}

async function projectionOf(id: string): Promise<{ timeline_at: Date; sort_at: Date; eligible: boolean }> {
  const [row] = await sql<{ timeline_at: Date; sort_at: Date; eligible: boolean }[]>`
    SELECT timeline_at, sort_at, eligible FROM publications WHERE article_id = ${id}`;
  assert.ok(row, "the item has a publication projection");
  return row!;
}

/** The publication exists only after a judgement, as for every other entrance. */
async function publish(id: string): Promise<void> {
  await analyzeArticle(id);
  await publishArticle(id);
}

before(async () => {
  await sql`INSERT INTO sources (id, name, kind, config, tier, participation_mode, interval_minutes, tags, site_fulltext, enabled)
            VALUES (${SOURCE}, ${"来源更新时间测试源"}, 'web_list', ${sql.json({})}, 'T1', 'editorial', 1440, ${["ads_policy"]}, false, true)`;
});

after(async () => {
  await sql`DELETE FROM articles WHERE source_id = ${SOURCE}`;
  await sql`DELETE FROM fetch_runs WHERE source_id = ${SOURCE}`;
  await sql`DELETE FROM sources WHERE id = ${SOURCE}`;
  await closeDb();
});

test("an undated document takes the source's update date, and the pool agrees", async () => {
  const created = await upsertMaterial(material(UNDATED));
  assert.equal(created.created, true);
  const row = await rowOf(UNDATED);
  assert.equal(row.published_at, null);
  assert.equal(row.source_updated_at?.toISOString(), "2026-06-25T00:00:00.000Z");
  assert.equal(row.timeline_at.toISOString(), "2026-06-25T00:00:00.000Z", "the document's own date, not the crawl day");

  await publish(row.id);
  const projection = await projectionOf(row.id);
  assert.equal(projection.timeline_at.toISOString(), "2026-06-25T00:00:00.000Z");
  assert.equal(projection.sort_at.toISOString(), "2026-06-25T00:00:00.000Z");
  assert.equal(projection.eligible, true, "an undated document with a source date stays listable");
});

test("a newer source update date moves the timeline and the projection without a revision", async () => {
  const before = await rowOf(UNDATED);
  const restated = await upsertMaterial(material(UNDATED, { sourceUpdatedAt: at("2026-09-30") }));
  assert.equal(restated.created, false);
  assert.equal(restated.revised, false, "the body did not change, so there is no revision");

  const after = await rowOf(UNDATED);
  assert.equal(after.id, before.id, "one identity");
  assert.equal(after.revision, 1, "no meaningless revision");
  assert.equal(after.source_updated_at?.toISOString(), "2026-09-30T00:00:00.000Z");
  assert.equal(after.timeline_at.toISOString(), "2026-09-30T00:00:00.000Z");
  const projection = await projectionOf(after.id);
  assert.equal(projection.timeline_at.toISOString(), "2026-09-30T00:00:00.000Z", "the list copy follows");
  assert.equal(projection.sort_at.toISOString(), "2026-09-30T00:00:00.000Z");
  const revisions = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM article_revisions WHERE article_id = ${after.id}`;
  assert.equal(revisions[0]!.n, 1);
});

test("an older source update date never rewinds what is stored", async () => {
  const quiet = await upsertMaterial(material(UNDATED, { sourceUpdatedAt: at("2026-05-01") }));
  assert.equal(quiet.revised, false);
  const row = await rowOf(UNDATED);
  assert.equal(row.source_updated_at?.toISOString(), "2026-09-30T00:00:00.000Z");
  assert.equal(row.timeline_at.toISOString(), "2026-09-30T00:00:00.000Z");
  assert.equal((await projectionOf(row.id)).timeline_at.toISOString(), "2026-09-30T00:00:00.000Z");
});

test("a trusted publication date wins over a moving source update date", async () => {
  const created = await upsertMaterial(material(DATED, {
    publishedAt: new Date("2026-03-02T15:30:00Z"), publicationTime: "2026-03-02T15:30:00Z", sourceUpdatedAt: at("2026-06-25"),
  }));
  assert.equal(created.created, true);
  const first = await rowOf(DATED);
  await publish(first.id);

  const restated = await upsertMaterial(material(DATED, {
    publishedAt: new Date("2026-03-02T15:30:00Z"), publicationTime: "2026-03-02T15:30:00Z", sourceUpdatedAt: at("2026-10-12"),
  }));
  assert.equal(restated.revised, false);
  const row = await rowOf(DATED);
  assert.equal(row.published_at?.toISOString(), "2026-03-02T15:30:00.000Z", "the publication date is not overwritten");
  assert.equal(row.timeline_at.toISOString(), first.timeline_at.toISOString(), "and its timeline does not move");
  assert.equal(row.source_updated_at?.toISOString(), "2026-10-12T00:00:00.000Z", "the source date is still recorded");
  assert.equal((await projectionOf(row.id)).timeline_at.toISOString(), first.timeline_at.toISOString());
});

test("a real body change is a revision, and an undated timeline follows the newer source date", async () => {
  const edited = await upsertMaterial(material(UNDATED, { bodyText: `${BODY} Advertisers must keep substantiation on file.`, sourceUpdatedAt: at("2026-10-12") }));
  assert.equal(edited.revised, true);
  const row = await rowOf(UNDATED);
  assert.equal(row.revision, 2);
  assert.equal(row.published_at, null);
  assert.equal(row.source_updated_at?.toISOString(), "2026-10-12T00:00:00.000Z");
  assert.equal(row.timeline_at.toISOString(), "2026-10-12T00:00:00.000Z");
  assert.equal((await projectionOf(row.id)).timeline_at.toISOString(), "2026-10-12T00:00:00.000Z");
});

test("a document without any date is dated by nothing it was not given", async () => {
  const third = `https://advertising.amazon.com/help/T${T}C`;
  const created = await upsertMaterial(material(third, { sourceUpdatedAt: null }));
  assert.equal(created.created, true);
  const row = await rowOf(third);
  assert.equal(row.published_at, null);
  assert.equal(row.source_updated_at, null, "a missing source date stays missing");
  assert.equal(row.timeline_at.toISOString(), DISCOVERED.toISOString(), "the timeline is the discovery anchor only");
});
