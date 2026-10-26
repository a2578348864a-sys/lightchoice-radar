// Local operations for LightChoice Radar on Windows: status, start, stop.
//
// Why a script and not a service manager: this machine has no systemd/pm2, and the project must not
// install one. Every command here is explicit — nothing starts all workers by accident, nothing is
// killed by name, and `status` only reads. Two things a worker maintains itself answer "is it running":
// the PostgreSQL advisory lock (the role is busy) and a heartbeat file the live process keeps writing
// (this PID really is that worker). A PID or a run record alone is never proof: PIDs are reused, and a
// reused PID must never be killed.
//
//   node --env-file=.env scripts/radar-ops.ts status
//   node --env-file=.env scripts/radar-ops.ts start web|announcements|ads
//   node --env-file=.env scripts/radar-ops.ts stop ads|announcements [--force] [--timeout=180]
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import {
  HEARTBEAT_FRESH_MS,
  clearControlState,
  clearStopRequest,
  heartbeatAlive,
  readHeartbeat,
  readRunRecord,
  requestStop,
  stopRequested,
  type WorkerRole,
} from "../apps/worker/src/control.ts";
import { queryWindowsProcess, verifyAndTerminateByHandle, verifyWorkerIdentity } from "../apps/worker/src/process-identity.ts";
import { startDetached, startOnHiddenConsole } from "./process-start.ts";
// The industry lane's role key, read from the lane's own registry (one source of truth).
const INDUSTRY_LOCK_KEY = 7_204_229_005;
import {
  TRANSLATE_LOCK_KEY,
  TRANSLATE_SOURCES,
  TRANSLATE_SOURCE_LABEL,
  beijingStamp,
  lastRunProcessed,
  lastRunReason,
  readTranslationState,
  translationHeadline,
  translationRunning,
} from "./radar-translate-state.ts";

const RUN_DIR = path.join(REPO_ROOT, ".data", "_diag");
/** Must match the keys in apps/worker/src/instance-lock.ts. */
const LOCK_KEYS: Record<string, number> = { "ads-policy": 7_204_229_002, "radar-announcements": 7_204_229_001, "amz123-leads": 7_204_229_003, "radar-translate": TRANSLATE_LOCK_KEY, "radar-industry": INDUSTRY_LOCK_KEY, "radar-market": 7_204_229_008 };
const WEB_PORT = 3000;
const API_PORT = 3001;
const RADAR_SOURCES = ["amazon-us-announcements", "amazon-us-fee-updates", "ads-policy-pages", "rss-cpsc-recalls", "us-federal-register-cpsc", "us-federal-register-ftc", "amz123-policy-leads"];

/** What `stop` has to silence for one target: the worker, and for Ads also its supervisor. */
const TARGETS: Record<string, { worker: WorkerRole; supervisor?: WorkerRole }> = {
  ads: { worker: "ads-policy", supervisor: "ads-policy-supervisor" },
  announcements: { worker: "radar-announcements" },
  // The dedicated lead worker: one source, its own lock, its own queue.
  leads: { worker: "amz123-leads" },
  // The scoped content/translation worker: its own role, its own lock, its own stop request file.
  translate: { worker: "radar-translate" },
  industry: { worker: "radar-industry" },
  market: { worker: "radar-market" },
};

const truthy = (value: string | undefined) => /^(1|true|yes|on)$/i.test(String(value ?? "").trim());
const line = (label: string, value: unknown) => console.log(`${label.padEnd(26, " ")} ${value}`);

/** A plain HTTP probe: the web app answers 200 on /all, the API on /api/site/meta. `expect` makes sure
 *  the answer is this project's, not a placeholder server that returns 200 for any path. */
function probe(url: string, timeoutMs = 5_000, expect?: RegExp): Promise<number | null> {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { if (body.length < 65_536) body += chunk; });
      response.on("end", () => {
        const status = response.statusCode ?? null;
        resolve(expect && status === 200 && !expect.test(body) ? null : status);
      });
    });
    request.on("timeout", () => { request.destroy(); resolve(null); });
    request.on("error", () => resolve(null));
  });
}

/** The web dev server compiles on the first request: one retry before calling it down. */
async function probeReady(url: string, expect?: RegExp): Promise<number | null> {
  const first = await probe(url, 5_000, expect);
  return first !== null ? first : probe(url, 10_000, expect);
}

/** Whether something listens on the port, whoever it is. */
function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (open: boolean) => { socket.destroy(); resolve(open); };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1_500, () => done(false));
  });
}

/** Whether a role is busy: the worker holds a session advisory lock, so a second session cannot take it. */
async function lockHeld(key: number): Promise<boolean> {
  const connection = await sql.reserve();
  try {
    const [row] = await connection<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${key}::bigint) AS locked`;
    if (row?.locked) {
      await connection`SELECT pg_advisory_unlock(${key}::bigint)`;
      return false;
    }
    return true;
  } finally {
    await connection.release();
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Only host/port/database of the connection, never the credentials. */
function databaseLabel(): string {
  try {
    const url = new URL(String(process.env.DATABASE_URL ?? ""));
    return `${url.hostname}:${url.port || "5432"}${url.pathname}`;
  } catch {
    return "（DATABASE_URL 未设置）";
  }
}

/**
 * The instant the incremental translation path starts from. Written once, on the first start, and then
 * reused on every restart: a new "now" on each start would silently skip everything collected while the
 * worker was stopped, and would re-open a window nobody authorized.
 */
async function translationBaseline(): Promise<{ at: string; created: boolean }> {
  const [row] = await sql<{ value: { at?: string } }[]>`SELECT value FROM settings WHERE key = 'translate.baseline'`;
  if (row?.value?.at) return { at: row.value.at, created: false };
  const at = new Date().toISOString();
  await sql`INSERT INTO settings (key, value, updated_by) VALUES ('translate.baseline', ${sql.json({ at })}, 'radar-ops')
            ON CONFLICT (key) DO NOTHING`;
  const [saved] = await sql<{ value: { at?: string } }[]>`SELECT value FROM settings WHERE key = 'translate.baseline'`;
  return { at: saved?.value?.at ?? at, created: true };
}


async function status(): Promise<number> {
  const web = await probeReady(`http://127.0.0.1:${WEB_PORT}/all`, /LightChoice Radar/);
  const api = await probeReady(`http://127.0.0.1:${API_PORT}/api/site/meta`, /changelogVersion/);
  const adsLock = await lockHeld(LOCK_KEYS["ads-policy"]!);
  const workerLock = await lockHeld(LOCK_KEYS["radar-announcements"]!);
  const leadLock = await lockHeld(LOCK_KEYS["amz123-leads"]!);
  const adsRecord = readRunRecord("ads-policy");
  const workerRecord = readRunRecord("radar-announcements");
  const leadRecord = readRunRecord("amz123-leads");
  const supervisorRecord = readRunRecord("ads-policy-supervisor");
  const adsAlive = heartbeatAlive("ads-policy");
  const workerAlive = heartbeatAlive("radar-announcements");
  const leadAlive = heartbeatAlive("amz123-leads");
  const supervisorAlive = heartbeatAlive("ads-policy-supervisor");
  const translation = await readTranslationState();

  const [ads] = await sql<{ enabled: boolean; health: string; fail_count: number; last_error: string | null; next_fetch_at: Date | null }[]>`
    SELECT enabled, health, fail_count, last_error, next_fetch_at FROM sources WHERE id = 'ads-policy-pages'`;
  const [lead] = await sql<{ enabled: boolean; health: string; fail_count: number; interval_minutes: number; last_error: string | null; next_fetch_at: Date | null }[]>`
    SELECT enabled, health, fail_count, interval_minutes, last_error, next_fetch_at FROM sources WHERE id = 'amz123-policy-leads'`;
  const counts = await sql<{ family: string; n: number }[]>`
    SELECT CASE WHEN 'platform_policy' = ANY(s.tags) THEN 'platform_policy'
                WHEN 'ads_policy' = ANY(s.tags) THEN 'ads_policy'
                WHEN 'external_regulation' = ANY(s.tags) THEN 'external_regulation'
                ELSE 'other' END AS family, count(*)::int AS n
    FROM articles a JOIN sources s ON s.id = a.source_id GROUP BY 1 ORDER BY 1`;
  const runs = await sql<{ source_id: string; status: string; found_count: number; new_count: number; error: string | null; failure_class: string | null; started_at: Date }[]>`
    SELECT DISTINCT ON (source_id) source_id, status, found_count, new_count, error, detail->>'failureClass' AS failure_class, started_at
    FROM fetch_runs WHERE source_id = ANY(${RADAR_SOURCES}::text[]) ORDER BY source_id, id DESC`;
  const open = await sql<{ source_id: string; id: number; started_at: Date }[]>`
    SELECT source_id, id, started_at FROM fetch_runs WHERE status = 'running' ORDER BY id`;
  const jobs = await sql<{ job: string; status: string; error: string | null; started_at: Date }[]>`
    SELECT DISTINCT ON (job) job, status, error, started_at FROM job_runs
    WHERE job IN ('radar.ads-policy.collect', 'radar.amazon-announcements.schedule', 'radar.amazon-fee-updates.schedule', 'radar.regulatory.schedule', 'radar.amz123-leads.schedule')
    ORDER BY job, id DESC`;

  console.log("LightChoice Radar · 本地运行状态\n");
  line("项目目录", REPO_ROOT);
  line("开发数据库", databaseLabel());
  line(`Web  ${WEB_PORT}`, web === null ? "未运行" : `HTTP ${web}`);
  line(`API  ${API_PORT}`, api === null ? "未运行" : `HTTP ${api}`);
  console.log("");
  line("Ads 来源", ads ? `${ads.enabled ? "已启用" : "已停用"} · health=${ads.health} · fail=${ads.fail_count}` : "来源不存在");
  line("Ads 调度开关", `${truthy(process.env.RADAR_ADS_POLICY_ENABLED) ? "已打开" : "关闭"}（RADAR_ADS_POLICY_ENABLED）`);
  line("第三方线索来源", lead
    ? `${lead.enabled ? "已启用" : "已停用"} · health=${lead.health} · fail=${lead.fail_count} · 每 ${lead.interval_minutes} 分钟一轮（6 小时）`
    : "来源不存在");
  if (lead?.last_error) line("线索来源最近错误", lead.last_error.slice(0, 80));
  line("Ads 采集进程", `${adsLock ? "采集中" : adsAlive ? "运行中" : "未运行"}${adsRecord && pidAlive(adsRecord.pid) ? ` · pid ${adsRecord.pid}` : ""}`);
  line("Ads 监督进程", supervisorAlive
    ? `运行中${supervisorRecord && pidAlive(supervisorRecord.pid) ? ` · pid ${supervisorRecord.pid}` : ""}${adsLock ? "" : "（正在退避/重启，尚未开始采集）"}`
    : supervisorRecord && pidAlive(supervisorRecord.pid) ? `进程在但无心跳 · pid ${supervisorRecord.pid}` : "未运行");
  line("公告 Worker", `${workerLock || workerAlive ? "运行中" : "未运行"}${workerRecord && pidAlive(workerRecord.pid) ? ` · pid ${workerRecord.pid}` : ""}`);
  line("线索 Worker", `${leadLock || leadAlive ? "运行中" : "未运行"}${leadRecord && pidAlive(leadRecord.pid) ? ` · pid ${leadRecord.pid}` : ""}`);
  // Automatic Chinese translation: the state is the worker's own lock/heartbeat plus stored rows —
  // never "the switch is set" alone, and never "the last job succeeded" as proof it is healthy now.
  // The session lock is the strong signal: PostgreSQL drops it the moment the process dies. A fresh
  // heartbeat still gets a say while the process that wrote it is provably the worker.
  const translateRunning = await translationRunning(translation);
  const tState = translationHeadline(translation, translateRunning);
  line("自动翻译", tState);
  line("翻译 Worker", `${translateRunning ? "运行中" : "未运行"}${translateRunning && translation.record ? ` · pid ${translation.record.pid}` : ""}`);
  line("允许来源", TRANSLATE_SOURCE_LABEL);
  line("启用基线", translation.baseline ? `${beijingStamp(new Date(translation.baseline))}（此后的新文章才处理）` : "尚未建立（首次 start translate 时写入）");
  line("当前预算", `${translation.limits.expiresAt ? `截止 ${beijingStamp(new Date(translation.limits.expiresAt))} · ` : ""}本轮 ${translation.requests}/${translation.limits.maxRequests ?? "?"} 次 · ¥${translation.spent.toFixed(4)}/${translation.limits.budgetCny ?? "?"} 元${translation.round ? `（${translation.round}）` : ""} · 累计 ${translation.cumulative.requests} 次 / ¥${translation.cumulative.spent.toFixed(4)}`);
  line("待处理文章", `${translation.pending} 篇（基线之后、无当前译文）`);
  line("最后成功翻译", translation.lastOk?.at ? beijingStamp(translation.lastOk.at) : "暂无记录");
  line("最近失败", translation.lastFail
    ? `${translation.lastFail.article_id.slice(0, 8)} · ${String(translation.lastFail.reason ?? "").slice(0, 50)}`
    : "无");
  // The last run says when it ran and how many items it actually translated; a run that ended early
  // records why (daily cap, budget, lease) instead of looking like a silent success.
  line("最近翻译任务", translation.lastRun
    ? `${beijingStamp(translation.lastRun.started_at).slice(11)} · ${translation.lastRun.status} · 处理 ${lastRunProcessed(translation)} 篇${lastRunReason(translation) ? ` · ${String(lastRunReason(translation)).slice(0, 60)}` : ""}${translation.lastRun.error ? ` · ${String(translation.lastRun.error).slice(0, 40)}` : ""}`
    : "暂无记录");
  // Whether `stop --force` can prove a PID at all: without the OS answer it refuses rather than risks.
  const osProbe = await queryWindowsProcess(process.pid);
  line("强杀身份校验（OS 级）", osProbe ? "可用" : "不可用（此时 --force 一律拒绝，需人工处理）");
  line("停止请求", `${stopRequested("ads-policy") ? "Ads 有待处理停止请求 " : ""}${stopRequested("radar-announcements") ? "公告有待处理停止请求 " : ""}${stopRequested("amz123-leads") ? "线索有待处理停止请求" : ""}`.trim() || "无");
  console.log("");
  line("记录数量", counts.map((c) => `${c.family}=${c.n}`).join(" · "));
  console.log("");
  console.log("最近一次采集");
  for (const run of runs) {
    const when = run.started_at.toISOString().replace("T", " ").slice(0, 19);
    console.log(`  ${run.source_id.padEnd(26)} ${run.status.padEnd(7)} found=${run.found_count} new=${run.new_count} ${when}${run.failure_class ? ` [${run.failure_class}]` : ""}${run.error ? ` ${String(run.error).slice(0, 60)}` : ""}`);
  }
  if (jobs.length) {
    console.log("\n最近一次任务");
    for (const job of jobs) console.log(`  ${job.job.padEnd(34)} ${job.status}${job.error ? ` · ${String(job.error).slice(0, 70)}` : ""}`);
  }
  const openRadar = open.filter((row) => RADAR_SOURCES.includes(row.source_id));
  const openOther = open.filter((row) => !RADAR_SOURCES.includes(row.source_id));
  if (openRadar.length) {
    console.log("\n本主线遗留 running 记录（下次启动对应 Worker 时自动收口）");
    for (const row of openRadar) console.log(`  fetch_runs #${row.id} ${row.source_id} ${row.started_at.toISOString().slice(0, 19)}`);
  }
  if (openOther.length) {
    console.log("\n其他来源的遗留 running 记录（属于通用 Worker，本工具不会处理）");
    for (const row of openOther) console.log(`  fetch_runs #${row.id} ${row.source_id} ${row.started_at.toISOString().slice(0, 19)}`);
  }

  console.log("\n建议");
  if (web === null) console.log("  · 3000 工作台未运行：node --env-file=.env scripts/radar-ops.ts start web");
  if (!ads?.enabled) console.log("  · Ads 采集关闭中（来源停用）；需要时按 CURRENT.md 的两步启用，不会自行启动");
  if (supervisorAlive && !adsLock) console.log("  · Ads 监督进程在退避中：它会按策略重启采集，stop ads 会同时停掉监督进程");
  if (adsLock && !truthy(process.env.RADAR_ADS_POLICY_ENABLED)) console.log("  · 有 Ads 进程在跑但开关未设置：确认它是否由旧会话遗留，必要时 stop ads");
  if (!workerLock && !workerAlive) console.log("  · 公告/监管 Worker 未运行：需要自动采集时 start announcements");
  if (openRadar.length) console.log("  · 本主线有遗留 running 记录：启动对应 Worker 会自动收口，不要手工改库");
  if (openOther.length) console.log("  · 其他来源的 running 记录不属于本主线，需要时检查通用 Worker");
  for (const job of jobs) if (job.status === "failed") console.log(`  · ${job.job} 最近一次失败：先看 sources.last_error 与 fetch_runs.detail.failureClass`);
  return 0;
}

async function start(target: string | undefined, ports: { web: number; api: number }): Promise<number> {
  // API and Web are started one at a time: a service that is already healthy is left alone, so a
  // single dropped process can be brought back without restarting the other. `start web` keeps its
  // old meaning of "bring the workbench up" (API first when it is down), `start api` is API only.
  if (target === "api" || target === "web") {
    const apiUp = (await probeReady(`http://127.0.0.1:${ports.api}/api/site/meta`, /changelogVersion/)) !== null;
    if (apiUp) {
      console.log(`API ${ports.api} 已在运行，跳过。`);
    } else if (await portOpen(ports.api)) {
      console.log(`API ${ports.api} 端口被其他程序占用（探测不到 /api/site/meta），未启动；用 netstat -ano | findstr :${ports.api} 查看占用进程。`);
      return 1;
    } else {
      const api = startDetached({
        entry: path.join(REPO_ROOT, "apps/api/src/main.ts"),
        nodeArgs: ["--env-file-if-exists=.env"],
        logName: `api-${ports.api}.log`,
        env: { ...process.env, API_PORT: String(ports.api) },
      });
      console.log(`API pid=${api ?? "?"} 日志 .data/_diag/api-${ports.api}.log`);
    }
    if (target === "api") return 0;

    const webUp = (await probeReady(`http://127.0.0.1:${ports.web}/all`, /LightChoice Radar/)) !== null;
    if (webUp) {
      console.log(`Web ${ports.web} 已在运行，跳过。`);
      return 0;
    }
    if (await portOpen(ports.web)) {
      console.log(`Web ${ports.web} 端口被其他程序占用（探测不到 /all），未启动；用 netstat -ano | findstr :${ports.web} 查看占用进程。`);
      return 1;
    }
    // The web dev server relaunches itself with a console child, so it runs on its own hidden
    // console: a plain detached start makes every relaunch pop a visible Windows Terminal window
    // that takes the whole service down when someone closes it.
    const web = await startOnHiddenConsole({
      entry: path.join(REPO_ROOT, "node_modules/@react-router/dev/bin.cjs"),
      appArgs: ["dev", "--port", String(ports.web), "--host", "127.0.0.1"],
      logName: `web-${ports.web}.log`,
      env: { ...process.env, API_BASE_URL: `http://127.0.0.1:${ports.api}` },
      cwd: path.join(REPO_ROOT, "apps/web"),
    });
    console.log(`Web pid=${web ?? "?"}（独立隐藏控制台） 日志 .data/_diag/web-${ports.web}.log（首次编译需要几秒）`);
    return 0;
  }
  if (target === "translate") {
    // The auth check first: the scoped worker refuses to run without both gates, so starting it
    // without them would only produce a silent exit.
    if (!TRANSLATE_SOURCES.length) {
      console.log("来源白名单为空：拒绝启动自动翻译。");
      return 1;
    }
    const state = await readTranslationState();
    if (await translationRunning(state)) {
      console.log("自动翻译 Worker 已在运行（实例锁被占用或进程仍在写心跳），不重复启动。");
      return 1;
    }
    // A crashed run leaves its record and stop request behind; clear them so the fresh start is not
    // mistaken for a故障 and does not read an old stop request. No business row is touched.
    clearControlState("radar-translate");
    const baseline = await translationBaseline();
    const pid = startDetached({
      entry: path.join(REPO_ROOT, "apps/worker/src/main.ts"),
      nodeArgs: ["--env-file-if-exists=.env"],
      logName: "worker-translate.log",
      env: {
        ...process.env,
        COLLECT_ENABLED: "false",
        RADAR_TRANSLATE_ENABLED: "true",
        RADAR_WORKER_SCOPE: "content",
        RADAR_ANALYZE_SINCE: baseline.at,
        RADAR_ANALYZE_SOURCES: TRANSLATE_SOURCES.join(","),
        RADAR_TRANSLATE_SOURCES: TRANSLATE_SOURCES.join(","),
      },
    });
    console.log(`自动翻译 Worker pid=${pid ?? "?"} 日志 .data/_diag/worker-translate.log`);
    console.log(`  只处理这五个来源：${TRANSLATE_SOURCES.join("、")}`);
    console.log(`  启用基线 ${beijingStamp(baseline.at)}${baseline.created ? "（本次首次建立；此前的历史文章不自动回填）" : "（沿用上次基线；停机期间入库的新文章仍会处理）"}`);
    // Starting is allowed even when the window is used up — the worker will simply refuse to send —
    // but an operator must not read that as "translation will now happen".
    if (state.exhausted) {
      console.log(`  注意：本轮预算已用完（${state.requests}/${state.limits.maxRequests ?? "?"} 次、¥${state.spent.toFixed(4)}/${state.limits.budgetCny ?? "?"} 元），启动后不会发出新的模型请求。`);
      console.log("        需要新的付费额度时，必须由用户单独批准一个新的预算窗口，不会因重启或重跑自动获得。");
    }
    console.log("  停止：node --env-file=.env scripts/radar-ops.ts stop translate");
    return 0;
  }

  if (target === "market") {
    if (await lockHeld(LOCK_KEYS["radar-market"]!) || heartbeatAlive("radar-market")) {
      console.log("市场信号调度 Worker 已在运行，不重复启动。");
      return 1;
    }
    const pid = startDetached({
      entry: path.join(REPO_ROOT, "apps/worker/src/radar-market.ts"),
      nodeArgs: ["--env-file-if-exists=.env"],
      logName: "worker-market.log",
      env: { ...process.env, RADAR_MARKET_SCHEDULER_ENABLED: process.env.RADAR_MARKET_SCHEDULER_ENABLED ?? "true" },
    });
    console.log(`市场信号调度 Worker pid=${pid ?? "?"} 日志 .data/_diag/worker-market.log`);
    return 0;
  }

  if (target === "industry") {
    if (await lockHeld(LOCK_KEYS["radar-industry"]!) || heartbeatAlive("radar-industry")) {
      console.log("行业 Worker 已在运行，不重复启动。");
      return 1;
    }
    const pid = startDetached({
      entry: path.join(REPO_ROOT, "apps/worker/src/radar-industry.ts"),
      nodeArgs: ["--env-file-if-exists=.env"],
      logName: "worker-industry.log",
      env: { ...process.env, RADAR_INDUSTRY_ENABLED: process.env.RADAR_INDUSTRY_ENABLED ?? "true" },
    });
    console.log(`行业 Worker pid=${pid ?? "?"} 日志 .data/_diag/worker-industry.log`);
    return 0;
  }
  if (target === "announcements") {
    if (await lockHeld(LOCK_KEYS["radar-announcements"]!) || heartbeatAlive("radar-announcements")) {
      console.log("公告 Worker 已在运行（实例锁被占用或进程仍在写心跳），不重复启动。");
      return 1;
    }
    const pid = startDetached({
      entry: path.join(REPO_ROOT, "apps/worker/src/radar-announcements.ts"),
      nodeArgs: ["--env-file-if-exists=.env"],
      logName: "worker-announcements.log",
      env: process.env,
    });
    console.log(`公告 Worker pid=${pid ?? "?"} 日志 .data/_diag/worker-announcements.log`);
    return 0;
  }
  if (target === "leads") {
    // The dedicated third-party lead worker: it runs one source on its own queue and registers no
    // official queue at all, so starting it can never collect the announcements, the regulatory
    // feeds or Ads.
    if (await lockHeld(LOCK_KEYS["amz123-leads"]!) || heartbeatAlive("amz123-leads")) {
      console.log("线索 Worker 已在运行（实例锁被占用或进程仍在写心跳），不重复启动。");
      return 1;
    }
    const pid = startDetached({
      entry: path.join(REPO_ROOT, "apps/worker/src/radar-amz123-leads.ts"),
      nodeArgs: ["--env-file-if-exists=.env"],
      logName: "worker-amz123-leads.log",
      env: process.env,
    });
    console.log(`线索 Worker pid=${pid ?? "?"} 日志 .data/_diag/worker-amz123-leads.log`);
    console.log("提示：进程已脱离当前控制台运行；本工具不安装开机自启，重启电脑后需再次运行 start-radar.cmd");
    return 0;
  }
  if (target === "ads") {
    if (!truthy(process.env.RADAR_ADS_POLICY_ENABLED)) {
      console.log("Ads 调度默认关闭。启用需要两步：");
      console.log("  1) UPDATE sources SET enabled=true WHERE id='ads-policy-pages';");
      console.log("  2) RADAR_ADS_POLICY_ENABLED=1 node --env-file=.env scripts/radar-ops.ts start ads");
      return 1;
    }
    const [source] = await sql<{ enabled: boolean }[]>`SELECT enabled FROM sources WHERE id = 'ads-policy-pages'`;
    if (!source?.enabled) {
      console.log("Ads 来源仍是停用状态，拒绝启动。先执行：UPDATE sources SET enabled=true WHERE id='ads-policy-pages';");
      return 1;
    }
    // A supervisor that is alive but between attempts (backoff) still owns the role: starting another
    // would leave two supervisors, one waiting to spawn a duplicate collection.
    if (await lockHeld(LOCK_KEYS["ads-policy"]!) || heartbeatAlive("ads-policy") || heartbeatAlive("ads-policy-supervisor")) {
      console.log("已有 Ads 采集进程或监督进程在运行，不重复启动。");
      return 1;
    }
    const pid = startDetached({
      entry: path.join(REPO_ROOT, "apps/worker/src/ads-policy-daemon.ts"),
      nodeArgs: ["--env-file-if-exists=.env"],
      logName: "ads-policy-daemon.log",
      env: process.env,
    });
    console.log(`Ads 监督进程 pid=${pid ?? "?"} 日志 .data/_diag/ads-policy-daemon.log`);
    return 0;
  }
  console.log("用法：start api | start web | start announcements | start leads | start ads | start industry | start market");
  return 1;
}

/** Waits until nothing of this role is running: no live heartbeat, no lock. */
async function waitForExit(roles: WorkerRole[], lockKeys: number[], timeoutMs: number): Promise<{ gone: boolean; stillRunning: string[] }> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const running: string[] = [];
    for (const role of roles) if (heartbeatAlive(role)) running.push(role);
    for (const key of lockKeys) if (await lockHeld(key)) running.push("采集实例锁");
    if (running.length === 0) return { gone: true, stillRunning: [] };
    if (Date.now() >= deadline) return { gone: false, stillRunning: running };
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
}

/**
 * Kills one role only after the OS confirms this PID is that role's live process — and terminates it
 * through that same verified handle, never through a bare PID. If the OS cannot confirm or cannot
 * terminate, this refuses and the operator handles it by hand.
 */
async function forceStopRole(role: WorkerRole, maxAgeMs: number): Promise<boolean> {
  const record = readRunRecord(role);
  if (!record) return true;
  const identity = verifyWorkerIdentity({ role, record, beat: readHeartbeat(role), os: await queryWindowsProcess(record.pid), now: Date.now(), maxAgeMs });
  if (!identity.ok) {
    console.log(`  拒绝强杀 ${role}：${identity.reason}。`);
    return false;
  }
  const startedAt = Date.parse(record.startedAt);
  if (!Number.isFinite(startedAt)) {
    console.log(`  拒绝强杀 ${role}：运行记录中的启动时间无法解析。`);
    return false;
  }
  const terminated = await verifyAndTerminateByHandle({ pid: record.pid, role, expectedCreationMs: startedAt });
  if (!terminated.ok) {
    console.log(`  拒绝强杀 ${role}：${terminated.reason}。`);
    return false;
  }
  console.log(`  身份已确认并经同一进程句柄终止（${role} pid=${record.pid}）。`);
  return true;
}

async function stop(target: string | undefined, force: boolean, timeoutSeconds: number): Promise<number> {
  const entry = target ? TARGETS[target] : undefined;
  if (!entry) {
    console.log("用法：stop ads | stop announcements | stop leads [--force] [--timeout=180]");
    return 1;
  }
  const roles: WorkerRole[] = [entry.worker, ...(entry.supervisor ? [entry.supervisor] : [])];
  const lockKeys = [LOCK_KEYS[entry.worker]!];
  // Running means either of the two: the worker holds the lock, or a process of this role is alive.
  const busy = (await lockHeld(lockKeys[0]!)) || roles.some((role) => heartbeatAlive(role));
  if (!busy) {
    console.log(`${target} 未在运行（实例锁空闲、无心跳）；清理残留的停止请求。`);
    clearStopRequest(entry.worker);
    return 0;
  }
  const record = readRunRecord(entry.worker);
  console.log(`请求停止 ${target}${record ? `（记录 pid=${record.pid}）` : ""}；等待最多 ${timeoutSeconds}s …`);
  requestStop(entry.worker, `stop requested by radar-ops (pid ${process.pid})`);

  const waited = await waitForExit(roles, lockKeys, timeoutSeconds * 1000);
  if (waited.gone) {
    clearStopRequest(entry.worker);
    console.log(`${target} 已停止：采集进程与监督进程均已退出，实例锁已释放。`);
    return 0;
  }
  console.log(`${target} 在 ${timeoutSeconds}s 内没有完全停止（仍有：${waited.stillRunning.join("、")}）。`);
  console.log("  它可能正在完成一次采集；稍后可再执行一次 stop。");
  if (force) {
    console.log("  --force：先停监督进程（避免它重启采集），再停采集进程；每一步都要通过「心跳 + 操作系统」身份校验。");
    let ok = true;
    if (entry.supervisor) ok = (await forceStopRole(entry.supervisor, HEARTBEAT_FRESH_MS)) && ok;
    ok = (await forceStopRole(entry.worker, HEARTBEAT_FRESH_MS)) && ok;
    const after = await waitForExit(roles, lockKeys, 10_000);
    if (after.gone && ok) {
      clearStopRequest(entry.worker);
      console.log(`${target} 已强制停止。`);
      return 0;
    }
    return 1;
  }
  for (const role of roles) {
    const r = readRunRecord(role);
    if (r && pidAlive(r.pid)) console.log(`  ${role} 记录中的进程 pid=${r.pid} 仍存活；确认它确实属于本项目后可执行：taskkill /PID ${r.pid} /F`);
  }
  return 1;
}

const [command = "status", target, ...rest] = process.argv.slice(2);
const portOf = (flag: string, fallback: number) => {
  const arg = process.argv.find((value) => value.startsWith(`${flag}=`));
  const parsed = Number(arg?.split("=")[1]);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 65536 ? Math.trunc(parsed) : fallback;
};
const ports = { web: portOf("--port", WEB_PORT), api: portOf("--api-port", API_PORT) };
const force = rest.includes("--force") || process.argv.includes("--force");
const timeoutArg = [...rest, ...process.argv.slice(2)].find((arg) => arg.startsWith("--timeout="));
const timeoutSeconds = Math.max(5, Number(timeoutArg?.split("=")[1] ?? 180) || 180);

try {
  const code = command === "start" ? await start(target, ports)
    : command === "stop" ? await stop(target, force, timeoutSeconds)
    : command === "status" ? await status()
    : (console.log("用法：status | start web|api|announcements|leads|translate|ads | stop ads|announcements|leads|translate"), 1);
  await closeDb();
  process.exit(code);
} catch (error) {
  console.error(`运行失败：${String(error).slice(0, 300)}`);
  console.error("检查 DATABASE_URL 是否指向本机开发库，以及 PostgreSQL 是否在运行。");
  await closeDb().catch(() => {});
  process.exit(1);
}
