// R41/R44 automatic chain for the Chinese policy explanation, on an isolated database copy:
//   a new record → discovered by the existing content.sweep → executed by the existing analysis queue
//   → explanation persisted with the judgement → returned by the public read layer → a revised original
//   invalidates the old explanation and the same chain runs again for the new version.
// Nothing here calls a model (rule mode), no page read computes an explanation, and the job must exist
// in the queue — the test never calls the analysis entry point directly.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { upsertMaterial } from "@aihot/backend/content/materials";
import { registerContentJobs, sweepUnprocessed } from "@aihot/backend/jobs/content";
import { getBoss, QUEUES, stopBoss } from "@aihot/backend/jobs/queue";
import { ITEM_COLUMNS, ITEM_FROM } from "@aihot/backend/publication/items";
import { loadItemDetail } from "@aihot/backend/publication/detail";

const T = tag();
const SOURCE = `explain-chain-${T}`;
const URL = `https://example.org/explain-chain/${T}`;

before(async () => {
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,next_fetch_at)
            VALUES (${SOURCE},'Explain chain','rss','T1','editorial','2100-01-01')`;
});
after(async () => { await stopBoss(); await closeDb(); });

/** Wakes this process's analysis workers now, instead of waiting out their polling interval. */
async function wakeAnalysis() {
  const boss = await getBoss();
  for (const worker of boss.getWipData()) if (worker.name === QUEUES.analyze) boss.notifyWorker(worker.id);
}

/** The analysis job just queued, queued a minute ago (same trick as processing-recovery). */
const queuedMinuteAgo = () => sql`UPDATE pgboss.job SET start_after = start_after - interval '1 minute' WHERE name = ${QUEUES.analyze} AND state = 'created'`;

async function waitFor(check: () => Promise<boolean>, label: string) {
  const deadline = Date.now() + 20_000;
  while (!(await check())) {
    assert.ok(Date.now() < deadline, `queue did not settle: ${label}`);
    await delay(25);
  }
}

const stateOf = async (id: string) => (await sql<{ processing_state: string }[]>`SELECT processing_state FROM articles WHERE id = ${id}`)[0]?.processing_state;
/** The analysis job fully finished — including the publication it writes after the judgement commits. */
const jobDone = async (id: string) => (await sql<{ state: string }[]>`
  SELECT state FROM pgboss.job WHERE name = ${QUEUES.analyze} AND data->>'articleId' = ${id} ORDER BY created_on DESC LIMIT 1`)[0]?.state === "completed";
const analysisOf = async (id: string) => (await sql<{ input_revision: number; output: Record<string, any> }[]>`
  SELECT input_revision, output FROM analyses WHERE article_id = ${id} AND origin = 'rule' ORDER BY id DESC LIMIT 1`)[0];

test("a new record is discovered, analysed with a Chinese explanation, and served by the read layer", async () => {
  const material = {
    sourceId: SOURCE, url: URL, title: `Explain chain ${T}`, language: "en",
    bodyText: "Amazon seller policy update: the requirement of maintaining a 95% valid tracking rate is removed.",
    bodyHtml: "<p>Amazon seller policy update: the requirement of maintaining a 95% valid tracking rate is removed.</p>",
    bodyStatus: "ok" as const, via: "fetch" as const, publishedAt: new Date(),
  };
  const { articleId: id } = await upsertMaterial(material);
  await sql`UPDATE articles SET processing_state='new', processing_queued_at=NULL, processing_retry_at=NULL,
            created_at = now() - interval '5 minutes' WHERE id = ${id}`;

  // 1. Discovery by the existing timer entry, not by calling the analysis function.
  await registerContentJobs(await getBoss());
  const found = await sweepUnprocessed();
  assert.ok(found.enqueued >= 1, "content.sweep discovers the new record");
  const [queued] = await sql<{ state: string }[]>`
    SELECT state FROM pgboss.job WHERE name = ${QUEUES.analyze} AND data->>'articleId' = ${id}`;
  assert.ok(queued, "the job sits in the existing analysis queue");

  // 2. Execution by the queue worker (job completion covers the publication written after the judgement).
  await queuedMinuteAgo();
  await wakeAnalysis();
  await waitFor(async () => (await stateOf(id)) === "analyzed" && (await jobDone(id)), "analysis + publication");

  // 3. Persistence: the explanation is stored with the judgement, bound to this material version.
  const analysis = await analysisOf(id);
  assert.ok(analysis, "a rule analysis exists");
  const explanation = analysis!.output.explanation;
  assert.equal(explanation.ruleVersion, "radar-explain-v1");
  assert.equal(explanation.inputRevision, analysis!.input_revision);
  assert.equal(explanation.method, "rule");
  assert.match(explanation.notice, /不是模型翻译/);
  assert.ok(explanation.checks.length > 0, "the deterministic checks ran before it was stored");
  assert.ok(explanation.keyDates.some((d: { kind: string }) => d.kind === "published"), "the publication date comes from the article");
  assert.equal(analysis!.output.ruleSummary, hasRuleSummary(material.bodyText), "the summary flag says how the summary was produced");

  // 4. The public read layer returns it, and the list identity marks it current.
  const detail = await loadItemDetail(id);
  if (detail.kind !== "found") {
    const [pub] = await sql<{ visibility: string | null; eligible: boolean | null }[]>`
      SELECT visibility, eligible FROM publications WHERE article_id = ${id}`;
    const [job] = await sql<{ state: string; output: unknown }[]>`
      SELECT state, output FROM pgboss.job WHERE name = ${QUEUES.analyze} AND data->>'articleId' = ${id} ORDER BY created_on DESC LIMIT 1`;
    let direct = "n/a";
    try {
      const rows = await sql<{ id: string; visibility: string; source_mode: string }[]>`
        SELECT ${ITEM_COLUMNS} ${ITEM_FROM} WHERE p.article_id = ${id}`;
      direct = JSON.stringify(rows.map((r) => ({ id: r.id, visibility: r.visibility, source_mode: r.source_mode })));
    } catch (error) {
      direct = `query error: ${String(error).slice(0, 400)}`;
    }
    assert.fail(`detail not found: publication=${JSON.stringify(pub)} job=${JSON.stringify(job)} direct=${direct}`);
  }
  assert.equal(detail.kind, "found");
  if (detail.kind === "found") {
    assert.equal(detail.item.explanation?.ruleVersion, "radar-explain-v1");
    assert.equal(detail.item.identity?.explanation, "current");
    assert.equal(detail.item.identity?.material, "body");
    assert.equal(detail.item.identity?.translation, "none");
  }

  // 5. No model and no paid request: rule mode assembles the explanation locally.
  const receipts = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM receipts WHERE subject LIKE ${`article:${id}%`}`;
  assert.equal(receipts[0]!.n, 0, "no paid request was made");

  // 6. The original is revised: the old explanation must stop passing as the current one…
  const revised = await upsertMaterial({ ...material, bodyText: `${material.bodyText} A corrected sentence.`, bodyHtml: "<p>Amazon seller policy update: the requirement of maintaining a 95% valid tracking rate is removed. A corrected sentence.</p>" });
  assert.equal(revised.revised, true);
  const stale = await loadItemDetail(id);
  assert.equal(stale.kind, "found");
  if (stale.kind === "found") {
    assert.equal(stale.item.explanation, null, "the old explanation is not returned for the new version");
    assert.equal(stale.item.identity?.explanation, "stale", "the page can say an older explanation exists");
  }

  // …and the same automatic chain runs again for the new material version.
  const rediscovered = await sweepUnprocessed();
  assert.ok(rediscovered.enqueued >= 1, "the sweep re-discovers a revised record");
  await queuedMinuteAgo();
  await wakeAnalysis();
  await waitFor(async () => {
    const current = await analysisOf(id);
    return !!current && current.input_revision === 2 && !!current.output.explanation && (await jobDone(id));
  }, "re-analysis after revision");
  const after = await loadItemDetail(id);
  assert.equal(after.kind, "found");
  if (after.kind === "found") {
    assert.equal(after.item.explanation?.inputRevision, 2, "the explanation follows the material version");
    assert.equal(after.item.identity?.explanation, "current");
  }
});

/** The stored summary is the source excerpt unless local rules organised a Chinese one from the body. */
function hasRuleSummary(bodyText: string): boolean {
  return /return-less refunds only occur when the customer has not received the product by the promised timeline/i.test(bodyText);
}
