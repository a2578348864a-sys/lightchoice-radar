// One entry point for running LightChoice Radar on a personal Windows machine.
//
// The project already has the pieces: `radar-ops.ts` starts and stops one service at a time, the
// dedicated lead worker owns an advisory lock, and `startDetached` starts a child with the project
// root as its working directory. What was missing is a single command that checks what is actually
// running and starts only what is missing, in dependency order — database, API, web, lead worker.
//
// This file adds no second source of truth: readiness is a real probe, "worker running" is the same
// advisory lock `radar-ops status` reads, and source/run facts come from the same tables. It also
// never kills by name: a port is resolved to its owning PID and that PID is killed only after the
// OS says its command line is this project's entry point.
import { execFile, execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { heartbeatAlive } from "../apps/worker/src/control.ts";
import {
  TRANSLATE_SOURCE_LABEL,
  beijingStamp,
  lastRunProcessed,
  lastRunReason,
  readTranslationState,
  translateLockHeld,
  translationHeadline,
  translationRunning,
  type TranslationState,
} from "./radar-translate-state.ts";

const DIAG = path.join(REPO_ROOT, ".data", "_diag");
const PG_BIN = process.env.RADAR_PG_BIN || "D:\\Workspace\\LightChoiceRadarRuntime\\postgresql-17.11\\pgsql\\bin";
const PG_DATA = process.env.RADAR_PG_DATA || "D:\\Workspace\\LightChoiceRadarRuntime\\pg\\data";
const PG_PORT = Number(process.env.RADAR_PG_PORT || 5544);
const WEB_PORT = 3000;
const API_PORT = 3001;
/** The dedicated lead worker's role key (same value as apps/worker/src/instance-lock.ts). */
const LEADS_LOCK = 7_204_229_003;
const LOCK_ANNOUNCEMENTS = 7_204_229_001;
const LOCK_ADS = 7_204_229_002;

const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "src", "main.ts");
const WEB_ENTRY = path.join(REPO_ROOT, "node_modules", "@react-router", "dev", "bin.cjs");
const RADAR_OPS = path.join(REPO_ROOT, "scripts", "radar-ops.ts");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ probes */

function probe(url: string, timeoutMs = 4_000): Promise<{ status: number; body: string } | null> {
  return new Promise((resolve) => {
    const request = http.get(url, { timeout: timeoutMs }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { if (body.length < 65_536) body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body }));
    });
    request.on("timeout", () => { request.destroy(); resolve(null); });
    request.on("error", () => resolve(null));
  });
}

/** The API answers this endpoint with the site meta JSON; a foreign process on 3001 will not. */
async function apiReady(): Promise<boolean> {
  const r = await probe(`http://127.0.0.1:${API_PORT}/api/site/meta`);
  if (!r || r.status !== 200) return false;
  try {
    const parsed = JSON.parse(r.body) as { changelogVersion?: unknown };
    return typeof parsed.changelogVersion === "string";
  } catch {
    return false;
  }
}

/** The web app renders its own name; a placeholder server on 3000 answers 200 without it. */
async function webReady(): Promise<boolean> {
  const r = await probe(`http://127.0.0.1:${WEB_PORT}/all`);
  return !!r && r.status === 200 && r.body.includes("LightChoice Radar");
}

/** The web dev server compiles on the first request: retry before calling it down. */
async function waitReady(check: () => Promise<boolean>, attempts = 3): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    if (await check()) return true;
    if (i < attempts - 1) await sleep(1_500);
  }
  return false;
}

function portOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (open: boolean) => { socket.destroy(); resolve(open); };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1_500, () => done(false));
  });
}

function run(command: string, args: string[], timeoutMs = 15_000): { code: number; out: string; err: string } {
  try {
    const out = execFileSync(command, args, { encoding: "utf8", timeout: timeoutMs, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out: String(out), err: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string; message?: string };
    return { code: typeof e.status === "number" ? e.status : 1, out: String(e.stdout ?? ""), err: String(e.stderr ?? e.message ?? "") };
  }
}

function runAsync(command: string, args: string[], timeoutMs = 20_000): Promise<{ code: number; out: string; err: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: "utf8", timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      const code = error ? (typeof (error as { code?: number }).code === "number" ? (error as { code: number }).code : 1) : 0;
      resolve({ code, out: String(stdout ?? ""), err: String(stderr ?? "") });
    });
  });
}

/* -------------------------------------------------------------- postgres */

const pgIsReadyExe = path.join(PG_BIN, "pg_isready.exe");
const psqlExe = path.join(PG_BIN, "psql.exe");
const pgCtlExe = path.join(PG_BIN, "pg_ctl.exe");
const postgresExe = path.join(PG_BIN, "postgres.exe");

async function pgReady(): Promise<boolean> {
  if (!existsSync(pgIsReadyExe)) return false;
  const r = await runAsync(pgIsReadyExe, ["-h", "127.0.0.1", "-p", String(PG_PORT)], 5_000);
  return r.code === 0;
}

function pgVersion(): string | null {
  if (!process.env.DATABASE_URL || !existsSync(psqlExe)) return null;
  const r = run(psqlExe, [String(process.env.DATABASE_URL), "-tAc", "select version()"], 8_000);
  if (r.code !== 0) return null;
  const m = /PostgreSQL (\d+\.\d+)/.exec(r.out);
  return m ? `PostgreSQL ${m[1]}` : r.out.trim().slice(0, 60);
}

async function startPg(): Promise<boolean> {
  if (!existsSync(postgresExe) || !existsSync(path.join(PG_DATA, "PG_VERSION"))) {
    console.log(`  ✗ 找不到 PostgreSQL：${postgresExe} 或数据目录 ${PG_DATA}`);
    console.log("    可用 RADAR_PG_BIN / RADAR_PG_DATA 环境变量指定实际位置。");
    return false;
  }
  mkdirSync(DIAG, { recursive: true });
  const logPath = path.join(DIAG, "postgres-5544.log");
  // The postmaster must own a private hidden console, held by a wrapper that lives as long as it.
  // Spawned with `detached` it gets no console at all, and on Windows every child it forks (one
  // backend per database connection) then allocates a fresh console — which Windows Terminal, as
  // the default terminal, shows as a visible black window per connection. Spawned plainly it would
  // inherit this launcher's console and die together with it. CREATE_NO_WINDOW (not exposed by
  // node's spawn; reachable via .NET's ProcessStartInfo) gives the tree a console nobody else tears
  // down. cmd carries the redirect because pg_ctl -l cannot open the non-ASCII path under .data.
  const wrapper = [
    "$psi = New-Object System.Diagnostics.ProcessStartInfo",
    "$psi.FileName = 'C:\\Windows\\System32\\cmd.exe'",
    `$psi.Arguments = '/s /c ""${postgresExe}" -D "${PG_DATA}" -p ${PG_PORT} >> "${logPath}" 2>&1"'`,
    "$psi.UseShellExecute = $false",
    "$psi.CreateNoWindow = $true",
    "$p = [System.Diagnostics.Process]::Start($psi)",
    "Write-Output ('wrapper pid=' + $p.Id)",
  ].join("; ");
  const started = await runAsync("powershell.exe", ["-NoProfile", "-Command", wrapper], 30_000);
  if (started.code !== 0) console.log(`  启动包装失败：${started.err.trim().slice(0, 160)}`);
  console.log(`  启动 PostgreSQL ${started.out.trim()}（独立隐藏控制台，日志 .data/_diag/postgres-5544.log）…`);
  for (let i = 0; i < 30; i++) {
    if (await pgReady()) return true;
    await sleep(1_000);
  }
  return false;
}

/* ---------------------------------------------------------------- workers */

async function lockHeld(key: number): Promise<boolean | null> {
  try {
    const connection = await sql.reserve();
    try {
      const [row] = await connection<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${key}::bigint) AS locked`;
      if (row?.locked) await connection`SELECT pg_advisory_unlock(${key}::bigint)`;
      return !row?.locked;
    } finally {
      connection.release();
    }
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------ port owners */

interface Owner { pid: number; commandLine: string }

async function portOwner(port: number): Promise<Owner | null> {
  const script = [
    `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1`,
    "if (-not $c) { exit 3 }",
    `$p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $c.OwningProcess) -ErrorAction SilentlyContinue`,
    "if (-not $p) { exit 4 }",
    // This project lives under a Chinese path, and a console pipe transcodes it into mojibake — which
    // made the identity check refuse a process that really is ours, so the command line could never be
    // matched and `stop` could not stop the web server. Base64 survives any console code page.
    "$b = [System.Text.Encoding]::UTF8.GetBytes($p.CommandLine)",
    'Write-Output ($p.ProcessId.ToString() + "|" + $p.Name + "|" + [Convert]::ToBase64String($b))',
  ].join("; ");
  const r = await runAsync("powershell.exe", ["-NoProfile", "-Command", script], 15_000);
  if (r.code !== 0) return null;
  const line = r.out.trim().split(/\r?\n/).pop() ?? "";
  const [pid, , encoded] = line.split("|");
  const n = Number(pid);
  const commandLine = encoded ? Buffer.from(encoded, "base64").toString("utf8") : "";
  return Number.isFinite(n) && n > 0 ? { pid: n, commandLine } : null;
}

/** The port belongs to this project when the owning command line names our entry file. */
function owns(owner: Owner | null, entry: string): boolean {
  if (!owner) return false;
  const normalized = owner.commandLine.replace(/\//g, "\\").toLowerCase();
  return normalized.includes(entry.replace(/\//g, "\\").toLowerCase());
}

/* ---------------------------------------------------------------- starts */

function nodeBin(): string {
  const preferred = "C:\\Users\\a2578\\AppData\\Local\\Programs\\nodejs\\node.exe";
  return existsSync(preferred) ? preferred : process.execPath;
}

async function startViaOps(target: "api" | "web" | "leads" | "announcements" | "translate"): Promise<void> {
  await new Promise<void>((resolve) => {
    const child = spawn(nodeBin(), ["--env-file-if-exists=.env", RADAR_OPS, "start", target], {
      cwd: REPO_ROOT, stdio: "inherit", windowsHide: true,
    });
    child.on("exit", () => resolve());
    child.on("error", () => resolve());
  });
}

/** The automatic-translation block of `status`: every line comes from the process and the stored rows. */
function translationLines(state: TranslationState, running: boolean): string[] {
  const limits = state.limits;
  const processed = lastRunProcessed(state);
  return [
    `  自动翻译        ${translationHeadline(state, running)}`,
    `  翻译 Worker     ${running ? `运行中${state.record ? ` · pid ${state.record.pid}` : ""}` : "未运行"}`,
    `  允许来源        ${TRANSLATE_SOURCE_LABEL}`,
    `  启用基线        ${state.baseline ? `${beijingStamp(state.baseline)}（此后的新文章才处理）` : "尚未建立（首次 start translate 时写入）"}`,
    `  最后成功翻译    ${state.lastOk?.at ? beijingStamp(state.lastOk.at) : "暂无记录"}`,
    `  最近失败        ${state.lastFail ? `${state.lastFail.article_id.slice(0, 8)} · ${String(state.lastFail.reason ?? "").slice(0, 50)}` : "无"}`,
    `  当前预算        ${state.limits.expiresAt ? `截止 ${beijingStamp(new Date(state.limits.expiresAt))} · ` : ""}本轮 ${state.requests}/${limits.maxRequests ?? "?"} 次 · ¥${state.spent.toFixed(4)}/${limits.budgetCny ?? "?"} 元${state.round ? `（${state.round}）` : ""} · 累计 ${state.cumulative.requests} 次 / ¥${state.cumulative.spent.toFixed(4)}`,
    `  待处理文章      ${state.pending} 篇（基线之后、无当前译文）`,
    `  最近执行        ${state.lastRun ? `${beijingStamp(state.lastRun.started_at).slice(11)} · ${state.lastRun.status} · 处理 ${processed} 篇${lastRunReason(state) ? ` · ${String(lastRunReason(state)).slice(0, 60)}` : ""}` : "暂无记录"}`,
  ];
}

/* ----------------------------------------------------------------- status */

interface SourceRow {
  id: string; enabled: boolean; health: string; fail_count: number; interval_minutes: number;
  last_error: string | null; next_fetch_at: Date | null; last_ok_at: Date | null;
}

async function readSource(id: string): Promise<SourceRow | null> {
  try {
    const [row] = await sql<SourceRow[]>`
      SELECT id, enabled, health, fail_count, interval_minutes, last_error, next_fetch_at, last_ok_at
      FROM sources WHERE id = ${id}`;
    return row ?? null;
  } catch {
    return null;
  }
}

function when(value: Date | null): string {
  if (!value) return "无";
  const d = new Date(value);
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

async function status(): Promise<number> {
  const problems: string[] = [];
  console.log("LightChoice Radar · 运行状态\n");

  const dbUp = await pgReady();
  const version = dbUp ? pgVersion() : null;
  console.log(`数据库 5544        ${dbUp ? `运行中${version ? `（${version}）` : ""}` : "未运行"}`);
  if (!dbUp) problems.push("数据库未运行：先运行 start-radar.cmd，它会按顺序拉起数据库");

  const apiOk = await waitReady(apiReady, 2);
  const webOk = await waitReady(webReady, 3);
  const apiForeign = !apiOk && await portOpen(API_PORT);
  const webForeign = !webOk && await portOpen(WEB_PORT);
  // An open port is not the same as a foreign owner: this project's own web dev server answers 503
  // while the API is down, and calling that "occupied by another program" would send an operator
  // after the wrong problem. So the owner's command line decides which sentence is true.
  const describe = async (port: number, entry: string, ok: boolean, open: boolean): Promise<string> => {
    if (ok) return "运行中";
    if (!open) return "未运行";
    const owner = await portOwner(port);
    return owns(owner, entry)
      ? "异常（本项目进程在，但探测不通过；常见原因是 API 未就绪）"
      : "异常（端口被其他程序占用）";
  };
  const apiState = await describe(API_PORT, API_ENTRY, apiOk, apiForeign);
  const webState = await describe(WEB_PORT, WEB_ENTRY, webOk, webForeign);
  console.log(`API 3001           ${apiState}`);
  console.log(`Web 3000           ${webState}`);
  const apiForeignOwner = apiState.includes("其他程序");
  const webForeignOwner = webState.includes("其他程序");
  if (!apiOk) problems.push(apiForeignOwner ? "3001 被其他程序占用：本工具不会结束它，请先确认" : "API 未就绪：运行 start-radar.cmd 只会补起缺失的 API");
  if (!webOk) problems.push(webForeignOwner ? "3000 被其他程序占用：本工具不会结束它，请先确认" : "Web 未就绪：运行 start-radar.cmd 只会补起缺失的 Web");

  const leadLock = dbUp ? await lockHeld(LEADS_LOCK) : null;
  const lead = dbUp ? await readSource("amz123-policy-leads") : null;
  const announcementsLock = dbUp ? await lockHeld(LOCK_ANNOUNCEMENTS) : null;
  const adsLock = dbUp ? await lockHeld(LOCK_ADS) : null;
  console.log(`AMZ123 Worker      ${leadLock === null ? "无法确认（数据库未运行）" : leadLock ? "运行中" : "未运行"}`);
  if (leadLock === false) problems.push("AMZ123 Worker 未运行：6 小时自动采集不会发生，start-radar.cmd 会补起它");
  console.log(`公告/监管 Worker    ${announcementsLock === null ? "无法确认（数据库未运行）" : announcementsLock ? "运行中（公告+费用+监管五来源）" : "未运行"}`);
  if (announcementsLock === false) problems.push("公告/监管 Worker 未运行：官方来源不会自动采集，start-radar.cmd 会补起它");

  if (lead) {
    console.log(`线索来源           ${lead.enabled ? "已启用" : "已停用"} · health=${lead.health} · 每 ${lead.interval_minutes} 分钟`);
    if (!lead.enabled) problems.push("线索来源已停用：采集不会执行");
    if (lead.health === "failing") problems.push(`线索来源连续失败：${lead.last_error ?? "见 sources.last_error"}`);
    if (lead.last_error) console.log(`  最近错误         ${String(lead.last_error).slice(0, 90)}`);
    console.log(`下次计划采集       ${when(lead.next_fetch_at)}（计划时间；Worker 未运行时不会执行）`);
    console.log(`上次成功采集       ${when(lead.last_ok_at)}`);
  }

  if (dbUp) {
    try {
      const runs = await sql<{ id: number; status: string; found_count: number; new_count: number; started_at: Date }[]>`
        SELECT id, status, found_count, new_count, started_at FROM fetch_runs
        WHERE source_id = 'amz123-policy-leads' ORDER BY id DESC LIMIT 5`;
      if (runs.length) {
        console.log("最近几次采集");
        for (const r of runs) {
          console.log(`  #${String(r.id).padEnd(4)} ${r.status.padEnd(7)} 新增 ${r.new_count} 条 · ${r.started_at.toISOString().replace("T", " ").slice(0, 16)}`);
        }
        if (runs[0]?.status === "failed") problems.push(`最近一次线索采集失败（#${runs[0].id}）：看 fetch_runs.detail 与 sources.last_error`);
      } else {
        console.log("最近几次采集       无记录");
      }
    } catch { /* the source table already reported the database problem */ }
  }

  if (dbUp) {
    try {
      const rows = await sql<{ id: string; status: string | null; new_count: number | null; started_at: Date | null; next_fetch_at: Date | null }[]>`
        SELECT s.id, f.status, f.new_count, f.started_at, s.next_fetch_at
        FROM sources s
        LEFT JOIN LATERAL (
          SELECT status, new_count, started_at FROM fetch_runs
          WHERE source_id = s.id ORDER BY id DESC LIMIT 1
        ) f ON true
        WHERE s.id IN ('amazon-us-announcements','amazon-us-fee-updates','rss-cpsc-recalls','us-federal-register-cpsc','us-federal-register-ftc')
        ORDER BY s.id`;
      if (rows.length) {
        console.log("官方/监管最近采集（health=ok 只代表上次结果；Worker 未运行时到点也不会执行）");
        const now = Date.now();
        let overdue = 0;
        for (const r of rows) {
          const isOverdue = !!r.next_fetch_at && r.next_fetch_at.getTime() < now;
          if (isOverdue) overdue += 1;
          console.log(`  ${r.id.padEnd(26)} ${(r.status ?? "-").padEnd(7)} 新增 ${r.new_count ?? "-"} · ${r.started_at ? when(r.started_at) : "无"} · 下次 ${when(r.next_fetch_at)}${isOverdue ? "（已逾期）" : ""}`);
        }
        if (announcementsLock === false && overdue > 0) {
          problems.push(`公告/监管 Worker 未运行且有 ${overdue} 个官方来源已过计划时间：start-radar.cmd 会补起它`);
        }
      }
    } catch { /* 数据库问题已在上方报告 */ }
  }

  console.log(`Ads                ${dbUp ? (adsLock ? "采集进程运行中" : "关闭（来源停用）") : "无法确认"}`);

  // 自动中文翻译：默认不启动。这里读的是「进程 + 数据库记录」，不是「开关是否设置」。
  if (dbUp) {
    try {
      const translation = await readTranslationState();
      const running = await translationRunning(translation);
      console.log("\n自动中文翻译（默认关闭，不调用 DeepSeek；开启：start-radar.cmd translate）");
      for (const l of translationLines(translation, running)) console.log(l);
      if (translation.record && !running) {
        problems.push("自动翻译上次未正常退出：采集不受影响，需要时运行 start-radar.cmd translate 重新启动");
      }
      if (running && translation.exhausted) {
        problems.push("自动翻译预算已用完：不会产生新译文，采集照常；需要新额度必须由用户单独批准新的预算窗口");
      }
    } catch {
      console.log("\n自动中文翻译        无法确认（读取数据库记录失败）");
    }
  } else {
    console.log("\n自动中文翻译        无法确认（数据库未运行）");
  }

  console.log("\n需要处理的问题");
  if (problems.length === 0) console.log("  无。所有服务都在运行。");
  else for (const p of problems) console.log(`  · ${p}`);

  console.log("\n详细诊断：node --env-file=.env scripts/radar-ops.ts status");
  console.log("启动/补齐：start-radar.cmd    停止：stop-radar.cmd");
  return problems.length === 0 ? 0 : 1;
}

/**
 * Whether a worker role is running, judged the way `radar-ops start|stop` judges it: the role's
 * session advisory lock, or a heartbeat a live process is still writing. `null` when the database
 * cannot answer. Using one definition in both places is what keeps "already running" from being
 * reported as a failed start.
 */
async function workerRunning(lockKey: number, role: "amz123-leads" | "radar-announcements"): Promise<boolean | null> {
  const held = await lockHeld(lockKey);
  if (held === null) return null;
  if (held) return true;
  return heartbeatAlive(role);
}

/* ------------------------------------------------------------------ start */

/**
 * The one way to turn the authorised automatic Chinese translation on. It does not take the five safety
 * gates apart to rebuild them here: `radar-ops start translate` sets `COLLECT_ENABLED=false`,
 * `RADAR_WORKER_SCOPE=content`, the five-source whitelist and the stored baseline, and the worker
 * itself refuses to run without the baseline and the whitelist. What is added here is what a normal
 * user needs before pressing it: the database must be up, the current budget is stated plainly, and
 * "already running" is a success, not an error.
 */
async function startTranslate(): Promise<number> {
  console.log("LightChoice Radar · 启动自动中文翻译（受控）\n");
  if (!(await pgReady())) {
    console.log("  ✗ 数据库未运行：先运行 start-radar.cmd 把数据库拉起来，再启动自动翻译。");
    return 1;
  }
  const state = await readTranslationState();
  if (await translationRunning(state)) {
    console.log("  自动翻译 Worker 已在运行（实例锁被占用或进程仍在写心跳），不重复启动。");
    for (const l of translationLines(state, true)) console.log(l);
    return 0;
  }
  console.log(`  允许来源：${TRANSLATE_SOURCE_LABEL}`);
  console.log(`  启用基线：${state.baseline ? `${beijingStamp(state.baseline)}（沿用；停机期间入库的新文章仍会处理）` : "尚未建立（本次建立；此前的历史文章不自动回填）"}`);
  if (state.exhausted) {
    console.log(`  预算：本轮已用完（${state.requests}/${state.limits.maxRequests ?? "?"} 次、¥${state.spent.toFixed(4)}/${state.limits.budgetCny ?? "?"} 元）`);
    console.log("        启动后不会发出新的模型请求；需要新的付费额度必须由用户单独批准新的预算窗口。");
  } else {
    console.log(`  预算：本轮 ${state.requests}/${state.limits.maxRequests ?? "?"} 次 · ¥${state.spent.toFixed(4)}/${state.limits.budgetCny ?? "?"} 元（跨重启保持，不因重跑重置）`);
  }
  console.log("");
  await startViaOps("translate");
  const ready = await waitUntil(async () => (await translateLockHeld()) === true, 25_000);
  if (!ready) {
    console.log("  ✗ 25 秒内没有拿到实例锁，看 .data/_diag/worker-translate.log");
    return 1;
  }
  console.log("  已启动：只做第一主线的内容分析与标题/摘要翻译，不采集、不碰两个采集 Worker。");
  console.log("  停止翻译（不影响采集）：stop-radar.cmd translate");
  return 0;
}

async function start(target?: string): Promise<number> {
  if (target === "translate") return startTranslate();
  if (target) {
    console.log("用法：start | start translate");
    return 1;
  }
  console.log("LightChoice Radar · 启动（只补起缺失的服务）\n");
  let ok = true;

  // 1. Database: the only service every other step depends on.
  if (await pgReady()) {
    console.log(`[1/5] 数据库 5544      已运行，跳过`);
  } else if (await portOpen(PG_PORT)) {
    console.log(`[1/5] 数据库 5544      端口被占用但连不上，未启动任何服务`);
    const owner = await portOwner(PG_PORT);
    if (owner) console.log(`      占用进程 PID ${owner.pid}：${owner.commandLine.slice(0, 120)}`);
    console.log("      请先确认该进程是什么，本工具不会结束它。");
    return 1;
  } else {
    console.log(`[1/5] 数据库 5544      未运行，启动中…`);
    if (!(await startPg())) {
      console.log("      ✗ 数据库没有在 30 秒内就绪；后续服务不启动。");
      console.log("        看 .data/_diag/postgres-5544.log，常见原因：数据目录被占用、端口被占用、数据目录损坏。");
      return 1;
    }
    console.log("      就绪");
  }

  // 2. API.
  const apiUp = await waitReady(apiReady, 2);
  if (apiUp) {
    console.log(`[2/5] API 3001         已运行，跳过`);
  } else if (await portOpen(API_PORT)) {
    const owner = await portOwner(API_PORT);
    console.log(`[2/5] API 3001         端口被其他程序占用（PID ${owner?.pid ?? "?"}），未启动`);
    if (owner) console.log(`      ${owner.commandLine.slice(0, 120)}`);
    ok = false;
  } else {
    console.log(`[2/5] API 3001         未运行，启动中…`);
    await startViaOps("api");
    const ready = await waitUntil(apiReady, 30_000);
    console.log(ready ? "      就绪" : "      ✗ 30 秒内没有就绪，看 .data/_diag/api-3001.log");
    ok = ok && ready;
  }

  // 3. Web.
  const webUp = await waitReady(webReady, 2);
  if (webUp) {
    console.log(`[3/5] Web 3000          已运行，跳过`);
  } else if (await portOpen(WEB_PORT)) {
    const owner = await portOwner(WEB_PORT);
    console.log(`[3/5] Web 3000          端口被其他程序占用（PID ${owner?.pid ?? "?"}），未启动`);
    if (owner) console.log(`      ${owner.commandLine.slice(0, 120)}`);
    ok = false;
  } else {
    console.log(`[3/5] Web 3000          未运行，启动中（首次编译需要几秒）…`);
    await startViaOps("web");
    const ready = await waitUntil(webReady, 90_000);
    console.log(ready ? "      就绪" : "      ✗ 90 秒内没有就绪，看 .data/_diag/web-3000.log");
    ok = ok && ready;
  }

  // 4. The dedicated lead worker.
  // "Running" must be judged exactly the way `radar-ops start` judges it — the lock OR a heartbeat the
  // live process is still writing. Checking only the lock here made a start report a failure while the
  // delegated command was correctly saying "already running, not starting a second one".
  const leadRunning = await workerRunning(LEADS_LOCK, "amz123-leads");
  if (leadRunning) {
    console.log(`[4/5] AMZ123 Worker    已运行（实例锁被占用或进程仍在写心跳），跳过`);
  } else if (leadRunning === null) {
    console.log(`[4/5] AMZ123 Worker    无法确认（数据库不可用），未启动`);
    ok = false;
  } else {
    console.log(`[4/5] AMZ123 Worker    未运行，启动中…`);
    await startViaOps("leads");
    const ready = await waitUntil(async () => (await workerRunning(LEADS_LOCK, "amz123-leads")) === true, 25_000);
    console.log(ready ? "      就绪（只消费 AMZ123 两条私有队列）" : "      ✗ 25 秒内没有拿到实例锁，看 .data/_diag/worker-amz123-leads.log");
    ok = ok && ready;
  }

  // 5. The announcements/regulatory family worker: Amazon announcements, fee updates, CPSC and the
  // two Federal Register feeds — six private queues of its own, never the lead queues.
  const annRunning = await workerRunning(LOCK_ANNOUNCEMENTS, "radar-announcements");
  if (annRunning) {
    console.log(`[5/5] 公告/监管 Worker 已运行（实例锁被占用或进程仍在写心跳），跳过`);
  } else if (annRunning === null) {
    console.log(`[5/5] 公告/监管 Worker 无法确认（数据库不可用），未启动`);
    ok = false;
  } else {
    console.log(`[5/5] 公告/监管 Worker 未运行，启动中…`);
    await startViaOps("announcements");
    const ready = await waitUntil(async () => (await workerRunning(LOCK_ANNOUNCEMENTS, "radar-announcements")) === true, 25_000);
    console.log(ready ? "      就绪（只消费公告/费用/监管六条专属队列）" : "      ✗ 25 秒内没有拿到实例锁，看 .data/_diag/worker-announcements.log");
    ok = ok && ready;
  }

  console.log(ok ? "\n完成。打开 http://127.0.0.1:3000/all 与 http://127.0.0.1:3000/leads" : "\n有服务没有就绪，见上面的提示。");
  console.log("自动中文翻译默认未启动（不调用 DeepSeek）。获得授权后：start-radar.cmd translate；查看状态：status-radar.cmd。");
  return ok ? 0 : 1;
}

async function waitUntil(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(1_000);
  }
  return false;
}

/* ------------------------------------------------------------------- stop */

async function killVerified(port: number, entry: string, label: string): Promise<boolean> {
  const owner = await portOwner(port);
  if (!owner) {
    console.log(`  ${label}：没有进程在监听 ${port}，跳过`);
    return true;
  }
  if (!owns(owner, entry)) {
    console.log(`  ${label}：端口 ${port} 的进程 PID ${owner.pid} 不是本项目（命令行不匹配），拒绝结束`);
    console.log(`    ${owner.commandLine.slice(0, 140)}`);
    return false;
  }
  // Windows console processes have no window: ask politely first, then terminate the same verified PID.
  await runAsync("taskkill.exe", ["/PID", String(owner.pid), "/T"], 10_000);
  if (await waitUntil(async () => !(await portOpen(port)), 3_000)) {
    console.log(`  ${label}：已停止（PID ${owner.pid}）`);
    return true;
  }
  const forced = await runAsync("taskkill.exe", ["/PID", String(owner.pid), "/T", "/F"], 10_000);
  const gone = await waitUntil(async () => !(await portOpen(port)), 5_000);
  console.log(gone ? `  ${label}：已停止（PID ${owner.pid}，身份已核验后强制结束）` : `  ${label}：停止失败 ${forced.err.slice(0, 80)}`);
  return gone;
}

/**
 * Stops the automatic translation and nothing else. The paid work goes first: a request in flight is
 * allowed to finish, and only when the role's advisory lock is free is anything else touched.
 */
async function stopTranslate(): Promise<boolean> {
  const held = await translateLockHeld();
  if (held === null) {
    console.log("  自动翻译 Worker：无法确认（数据库不可用），跳过");
    return true;
  }
  if (held === false) {
    console.log("  自动翻译 Worker：未在运行（实例锁空闲），跳过");
    return true;
  }
  console.log("  自动翻译 Worker：发送停止请求（正在进行的翻译会先收尾）…");
  const r = await runAsync(nodeBin(), ["--env-file-if-exists=.env", RADAR_OPS, "stop", "translate", "--timeout=120"], 150_000);
  process.stdout.write(r.out);
  const gone = await waitUntil(async () => (await translateLockHeld()) === false, 5_000);
  if (!gone) {
    console.log("  自动翻译 Worker 仍在运行，可稍后重试；不要用 taskkill /IM node.exe。");
    return false;
  }
  return true;
}

async function stop(target?: string): Promise<number> {
  // An unknown argument must not fall through to "stop everything": a typo would take the whole
  // service down. Only the empty string (all) and the two named targets are accepted.
  if (target !== undefined && target !== "" && target !== "translate" && target !== "all") {
    console.log(`无法识别的参数「${target}」。`);
    console.log("用法：stop | stop translate | stop all");
    return 1;
  }
  console.log("LightChoice Radar · 停止\n");
  let ok = true;

  // 只停翻译：不影响两个采集 Worker、数据库、API 与网页。
  if (target === "translate") {
    console.log("[1/1] 自动翻译 Worker（只停翻译，采集继续）");
    ok = (await stopTranslate()) && ok;
    console.log(ok ? "\n完成。采集服务未受影响。" : "\n自动翻译没有完全停止，见上面的提示。");
    return ok ? 0 : 1;
  }

  console.log("[1/5] 自动翻译 Worker（付费的排在最前，先停）");
  ok = (await stopTranslate()) && ok;

  const annHeld = await lockHeld(LOCK_ANNOUNCEMENTS);
  if (annHeld === true) {
    console.log("[2/5] 公告/监管 Worker 发送停止请求（当前采集会先收尾）…");
    const r = await runAsync(nodeBin(), ["--env-file-if-exists=.env", RADAR_OPS, "stop", "announcements", "--timeout=120"], 150_000);
    process.stdout.write(r.out);
    if (r.code !== 0) { ok = false; console.log("      没有完全停止，可稍后重试。"); }
  } else if (annHeld === null) {
    console.log("[2/5] 公告/监管 Worker 无法确认（数据库未运行），跳过");
  } else {
    console.log("[2/5] 公告/监管 Worker 未运行，跳过");
  }

  const held = await lockHeld(LEADS_LOCK);
  if (held === true) {
    console.log("[3/5] AMZ123 Worker    发送停止请求（当前采集会先收尾）…");
    const r = await runAsync(nodeBin(), ["--env-file-if-exists=.env", RADAR_OPS, "stop", "leads", "--timeout=120"], 150_000);
    process.stdout.write(r.out);
    if (r.code !== 0) { ok = false; console.log("      没有完全停止，可稍后重试；不要用 taskkill /IM node.exe。"); }
  } else if (held === null) {
    console.log("[3/5] AMZ123 Worker    无法确认（数据库未运行），跳过");
  } else {
    console.log("[3/5] AMZ123 Worker    未运行，跳过");
  }

  console.log("[4/5] Web / API");
  ok = (await killVerified(WEB_PORT, WEB_ENTRY, "Web 3000")) && ok;
  ok = (await killVerified(API_PORT, API_ENTRY, "API 3001")) && ok;

  if (target === "all") {
    console.log("[5/5] 数据库 5544      按 fast 模式关闭…");
    if (!(await pgReady())) console.log("      未运行，跳过");
    else {
      const r = await runAsync(pgCtlExe, ["stop", "-D", PG_DATA, "-m", "fast", "-w"], 60_000);
      const stopped = await waitUntil(async () => !(await pgReady()), 20_000);
      console.log(stopped ? "      已停止" : `      停止失败：${r.err.slice(0, 120)}`);
      ok = ok && stopped;
    }
  } else {
    console.log("[5/5] 数据库 5544      保留运行（要一起关：stop-radar.cmd all）");
  }

  console.log(ok ? "\n完成。" : "\n有项目没有停干净，见上面的提示。");
  return ok ? 0 : 1;
}

/* -------------------------------------------------------------------- CLI */

const [command = "status", ...rest] = process.argv.slice(2);
try {
  const code = command === "start" ? await start(rest[0])
    : command === "stop" ? await stop(rest[0])
    : command === "status" ? await status()
    : (console.log("用法：start | start translate | status | stop [translate] [all]"), 1);
  await closeDb().catch(() => {});
  process.exit(code);
} catch (error) {
  console.error(`运行失败：${String(error).slice(0, 300)}`);
  console.error("检查 DATABASE_URL、PostgreSQL 是否在运行，以及 .data/_diag 下的日志。");
  await closeDb().catch(() => {});
  process.exit(1);
}
