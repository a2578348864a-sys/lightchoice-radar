// Can the main worker run the translation chain without waking the community feeds?
//
// The main worker registers the generic collection queues only when COLLECT_ENABLED=true
// (apps/worker/src/main.ts); the two dedicated collectors use private queues of their own. This test
// starts the real main worker as a child process on an isolated database copy and checks what it
// actually consumes: a queued sources.fetch job must stay untouched, the community source must not be
// fetched, the translate schedule appears only while its dedicated switch is on, and no model call
// happens while it is off. No production database, no paid call, no collection.
import { tag } from "./setup.ts";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { closeDb, sql } from "@aihot/backend/db";
import { getBoss, QUEUES, stopBoss } from "@aihot/backend/jobs/queue";
import { startTranslationRound, translationBudgetState } from "@aihot/backend/editorial/translate-budget";
import { translateTextPending } from "@aihot/backend/editorial/translate-text";

const T = tag();
const COMMUNITY = `iso-community-${T}`;
const OFFICIAL = `iso-official-${T}`;
const dataDir = mkdtempSync(path.join(tmpdir(), "radar-worker-iso-"));

let hits = 0;
const provider = http.createServer((req, res) => {
  req.on("data", () => {});
  req.on("end", () => {
    hits += 1;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "stub",
      choices: [{ message: { content: JSON.stringify({ t: "这是一段用于运行隔离测试的中文译文，保留 2026 年与 95% 等原文数值。" }) }, finish_reason: "stop" }],
      usage: { prompt_tokens: 60, completion_tokens: 12, total_tokens: 72 },
    }));
  });
});

interface WorkerHandle { stop: () => Promise<void> }
const workers: WorkerHandle[] = [];

/** Starts the real main worker with the given environment and waits for its "worker started" line. */
async function startWorker(env: Record<string, string>): Promise<WorkerHandle> {
  // The test process runs with the switch on; the child must get exactly what each test asks for.
  const childEnv: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: process.env.DATABASE_URL!, AIHOT_DATA_DIR: dataDir, COLLECT_ENABLED: "false", LOG_LEVEL: "error" };
  delete childEnv.RADAR_TRANSLATE_ENABLED;
  Object.assign(childEnv, env);
  const child = spawn(process.execPath, [path.resolve("apps/worker/src/main.ts")], {
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
    cwd: process.cwd(),
  });
  let logs = "";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`worker did not start: ${logs.slice(-500)}`)), 30_000);
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`worker exited (${code}): ${logs.slice(-500)}`)); });
    const watch = (chunk: Buffer) => {
      logs += String(chunk);
      if (logs.includes("worker started")) { clearTimeout(timer); resolve(); }
    };
    child.stdout!.on("data", watch);
    child.stderr!.on("data", watch);
  });
  // The worker is a separate service: do not let its pipes keep this test process alive.
  child.stdout!.destroy();
  child.stderr!.destroy();
  child.unref();
  const handle: WorkerHandle = {
    stop: async () => {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* already gone */ } resolve(); }, 8000);
        child.once("exit", () => { clearTimeout(timer); resolve(); });
      });
    },
  };
  workers.push(handle);
  return handle;
}

before(async () => {
  await new Promise<void>((resolve) => provider.listen(0, "127.0.0.1", () => resolve()));
  const { port } = provider.address() as { port: number };
  process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.LLM_API_KEY = "test-key";
  process.env.LLM_MODEL = "deepseek-flash";
  process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.DEEPSEEK_API_KEY = "test-key";

  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,enabled,next_fetch_at)
            VALUES (${COMMUNITY},'Iso community','rss','T2','editorial',true,'2100-01-01')`;
  await sql`INSERT INTO sources (id,name,kind,tier,participation_mode,enabled,next_fetch_at)
            VALUES (${OFFICIAL},'Iso official','rss','T1','editorial',true,'2100-01-01')`;

  // The scheduled path only translates the first lane's sources: this file's fixture stands in for
  // one of them, so it has to be named in the whitelist (the same way translate-item-chain does).
  process.env.RADAR_TRANSLATE_SOURCES = OFFICIAL;

  // A collection job sitting in the queue, as a schedule would have left it.
  const boss = await getBoss();
  await boss.createQueue(QUEUES.fetchSource);
  await boss.send(QUEUES.fetchSource, { sourceId: COMMUNITY });
});

after(async () => {
  for (const w of workers) await w.stop();
  await stopBoss();
  await closeDb();
  provider.close();
});

test("the main worker processes content without registering or consuming any collection queue", async () => {
  const queued = await sql<{ state: string }[]>`
    SELECT state FROM pgboss.job WHERE name = ${QUEUES.fetchSource} ORDER BY created_on DESC LIMIT 1`;
  assert.equal(queued[0]?.state, "created", "a collection job is queued for this test");

  await startWorker({ RADAR_TRANSLATE_ENABLED: "true" });
  await new Promise((r) => setTimeout(r, 4000));

  // 1. The queued collection job is untouched: nothing registered that queue.
  const after = await sql<{ state: string }[]>`
    SELECT state FROM pgboss.job WHERE name = ${QUEUES.fetchSource} ORDER BY created_on DESC LIMIT 1`;
  assert.equal(after[0]?.state, "created", "the sources.fetch job is still queued, not consumed");

  // 2. No fetch run for the community source: nothing collected it.
  const runs = await sql<{ n: number }[]>`
    SELECT count(*)::int AS n FROM fetch_runs WHERE source_id = ${COMMUNITY}`;
  assert.equal(runs[0]!.n, 0, "the community source was not fetched");

  // 3. The translate schedule is on; the collection schedules are not registered at all.
  const names = (await sql<{ name: string }[]>`SELECT name FROM pgboss.schedule`).map((s) => s.name);
  assert.ok(names.includes("cron.content.translate"), "content.translate is scheduled");
  assert.ok(names.includes("cron.content.sweep"), "the discovery schedule still runs");
  assert.ok(!names.includes("cron.sources.schedule"), "the collection schedule is not registered");
  assert.ok(!names.includes("cron.sources.adapt-intervals") && !names.includes("cron.sources.icons"), "collection upkeep stays off");

  // 4. No extraction worker either: only the analysis queue is subscribed.
  const queues = (await sql<{ name: string }[]>`SELECT name FROM pgboss.queue`).map((q) => q.name);
  assert.ok(queues.includes("content.analyze"), "the analysis queue exists");
  assert.ok(!queues.includes("content.extract-body"), "body extraction is not registered");
});

test("with the switch off a queued translation job is not consumed and no model is called", async () => {
  for (const w of workers) await w.stop();
  // Put a translation job in the queue by hand: with the switch off nobody may take it.
  const boss = await getBoss();
  await boss.createQueue("cron.content.translate");
  await boss.send("cron.content.translate", {});

  const quiet = await startWorker({});
  await new Promise((r) => setTimeout(r, 4000));
  // With the switch off the worker retires the timer and its queue (registerSchedules drops cron
  // queues that are no longer registered), so the queued job is discarded rather than translated.
  const jobs = await sql<{ state: string }[]>`
    SELECT state FROM pgboss.job WHERE name = 'cron.content.translate' AND state = 'created'`;
  const names = (await sql<{ name: string }[]>`SELECT name FROM pgboss.schedule`).map((s) => s.name);
  assert.equal(jobs.length, 0, "no translate work is left queued for this worker");
  assert.ok(!names.includes("cron.content.translate"), "no translate schedule without the switch");
  assert.equal(hits, 0, "the provider stub was never called");
  await quiet.stop();
});

test("the incremental path translates a new official article and keeps its budget in the database", async () => {
  // The baseline an enabled run writes on its first pass; the article is discovered after it.
  await sql`INSERT INTO settings (key, value, updated_by)
            VALUES ('translate.baseline', ${sql.json({ at: new Date(Date.now() - 60_000).toISOString() })}, 'translate')
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
  await startTranslationRound(`iso-${T}`, { maxRequests: 10, maxArticles: 4, budgetCny: 1 });

  const { articleId: id } = await (await import("@aihot/backend/content/materials")).upsertMaterial({
    sourceId: OFFICIAL, url: `https://example.org/worker-iso/${T}`, title: `Gadget Co. Recalls Portable Heaters Due to Risk of Fire and Burn Hazards (${T})`,
    language: "en", excerpt: "About 2,400 units were sold. The heaters can overheat, posing a fire and burn hazard.",
    bodyText: "About 2,400 units were sold. The heaters can overheat, posing a fire and burn hazard.",
    bodyHtml: "<p>About 2,400 units were sold. The heaters can overheat, posing a fire and burn hazard.</p>",
    bodyStatus: "ok" as const, via: "fetch" as const, publishedAt: new Date(),
  });
  await sql`UPDATE articles SET processing_state='new', processing_queued_at=NULL, processing_retry_at=NULL,
            created_at = now() - interval '5 minutes' WHERE id = ${id}`;
  // The incremental path only translates published items: run the same analysis → publication the
  // content job would run (no model involved in rule mode).
  const { analyzeArticle } = await import("@aihot/backend/editorial/analyze");
  const { publishArticle } = await import("@aihot/backend/publication/publish");
  await analyzeArticle(id);
  await publishArticle(id);

  const run = await translateTextPending({ runArticles: 3 });
  const done = run.done.find((d) => d.articleId === id);
  assert.ok(done, `the incremental run picked the article up (${run.reason ?? "no reason"})`);
  assert.ok(["translated", "partial"].includes(done!.status), `translation ran (${done!.status})`);
  assert.ok(hits >= 1, `the provider stub answered (${hits} calls)`);
  const [row] = await sql<{ title: string; revision: number }[]>`
    SELECT title, revision FROM translations WHERE article_id = ${id} AND lang = 'zh'`;
  assert.match(row!.title, /\p{Script=Han}/u);

  const budget = await translationBudgetState();
  assert.equal(budget.round, `iso-${T}`);
  assert.ok(budget.requests >= 1, "the requests are counted in settings, not in the process");
  assert.ok(budget.spentCny > 0, "the spend is recorded");
});
