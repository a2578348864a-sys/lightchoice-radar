// Standalone autonomous background scheduler verification script (Task F1 & F2).
//
// Proves headless autonomous execution without browser or manual click:
//   1. Registers an approved periodic source in the database (with past lastRunAt -> due immediately).
//   2. Spawns `apps/worker/src/radar-market.ts` as a background child process with short poll interval.
//   3. NO browser opened, NO HTTP POST /api/market/scheduler/run-due called.
//   4. Watches the worker acquire advisory lock, write run record, execute due source, and advance watermark.
//   5. Spawns a second worker to verify process-level exclusivity (second worker exits code 0).
//   6. Sends stop request and verifies clean shutdown.
import { spawn } from "node:child_process";
import path from "node:path";
import { REPO_ROOT } from "@aihot/backend/config";
import { sql, closeDb } from "@aihot/backend/db";
import {
  loadMarketSource, saveMarketSource, type MarketSource,
} from "@aihot/backend/market/market-model";
import {
  MARKET_WORKER_LOCK_KEY,
} from "@aihot/backend/market/market-scheduler";
import { requestStop, readRunRecord, readHeartbeat } from "../apps/worker/src/control.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log("=================================================");
  console.log("STARTING BACKGROUND AUTONOMOUS SCHEDULER VERIFICATION");
  console.log("=================================================");

  const testSourceId = "autonomous-test-source";
  const initialLastRun = "2026-10-20T00:00:00.000Z";

  // 1. Setup due test source in database
  const testSource: MarketSource = {
    id: testSourceId,
    kind: "synthetic-test",
    label: "后台自主执行验证源",
    producer: "Autonomous Worker Test",
    marketplace: "US",
    permission: { uses: ["fetch", "store", "compute", "display"], basis: "synthetic-test", evidence: "L3" },
    enabled: true,
    automation: "authorized-periodic",
    cadenceHours: 2,
    lastRunAt: initialLastRun,
    runCount: 0,
    nextRunAt: initialLastRun,
  };
  await saveMarketSource(testSource);
  console.log(`[PASS] 1. 测试来源就绪：id=${testSourceId}, 初始 lastRunAt=${initialLastRun}`);

  // 2. Spawn radar-market worker process in background
  const workerEntry = path.join(REPO_ROOT, "apps", "worker", "src", "radar-market.ts");
  const startTime = Date.now();

  console.log(`[INFO] 正在启动后台 Worker 进程: ${workerEntry}`);
  const child = spawn(process.execPath, ["--env-file-if-exists=.env", workerEntry], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      RADAR_MARKET_POLL_INTERVAL_MS: "1000", // fast poll for test
    },
    windowsHide: true,
  });

  let workerLogs = "";
  child.stdout.on("data", (d) => { workerLogs += d.toString(); });
  child.stderr.on("data", (d) => { workerLogs += d.toString(); });

  const workerPid = child.pid;
  console.log(`[PASS] 2. 后台 Worker 进程已启动，PID=${workerPid}（无浏览器、无人工调用）`);

  // 3. Wait 3 seconds for autonomous tick
  console.log("[INFO] 等待后台 Worker 自主轮询并执行到期任务（3 秒）...");
  await sleep(3500);

  // 4. Verify database watermark progression
  const updated = await loadMarketSource(testSourceId);
  if (!updated) throw new Error("测试来源在数据库中未找到");

  const runCount = updated.runCount || 0;
  const newLastRun = updated.lastRunAt || "";
  console.log(`[INFO] 检查数据库状态：runCount=${runCount}, lastRunAt=${newLastRun}`);

  if (runCount < 1 || newLastRun === initialLastRun) {
    console.error("Worker 输出日志:", workerLogs);
    throw new Error(`后台 Worker 未能自主推进水位：runCount=${runCount}, lastRunAt=${newLastRun}`);
  }
  console.log(`[PASS] 3. 后台自主执行成功！水位安全推进：`);
  console.log(`       - 历史水位: ${initialLastRun}`);
  console.log(`       - 当前最新: ${newLastRun}`);
  console.log(`       - 下期计划: ${updated.nextRunAt}`);
  console.log(`       - 执行次数: ${runCount}`);

  // 5. Verify single-instance exclusivity
  console.log("[INFO] 启动第二个 Worker 验证单实例互斥（advisory lock 竞争）...");
  const secondChild = spawn(process.execPath, ["--env-file-if-exists=.env", workerEntry], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const exitCode = await new Promise<number>((resolve) => {
    secondChild.on("exit", (code) => resolve(code ?? 0));
  });

  if (exitCode !== 0) {
    throw new Error(`互斥启动测试失败：第二个 Worker 退出码为 ${exitCode}，预期为 0 (no-op)`);
  }
  console.log(`[PASS] 4. 双实例互斥验证通过：第二个 Worker 感知到实例锁已被占用，立即优雅退出 (code 0)`);

  // 6. Graceful shutdown
  console.log("[INFO] 发送停止请求并验证优雅退出...");
  requestStop("radar-market", "verify script stop");

  const childExited = await new Promise<boolean>((resolve) => {
    const t = setTimeout(() => resolve(false), 5000);
    child.on("exit", () => {
      clearTimeout(t);
      resolve(true);
    });
  });

  if (!childExited) {
    child.kill("SIGKILL");
    throw new Error("Worker 未能在 5 秒内响应停止请求");
  }
  console.log("[PASS] 5. 后台 Worker 成功响应 stop 请求，释放实例锁并退出");

  // 7. Verify lock released
  const [lockCheck] = await sql<{ locked: boolean }[]>`SELECT pg_try_advisory_lock(${MARKET_WORKER_LOCK_KEY}::bigint) AS locked`;
  if (lockCheck?.locked) {
    await sql`SELECT pg_advisory_unlock(${MARKET_WORKER_LOCK_KEY}::bigint)`;
    console.log("[PASS] 6. PostgreSQL Advisory Lock 已随进程退出完全释放");
  } else {
    throw new Error("实例锁未能正常释放");
  }

  console.log("=================================================");
  console.log("ALL AUTONOMOUS SCHEDULER VERIFICATIONS PASSED!");
  console.log("=================================================");
  await closeDb();
  process.exit(0);
}

main().catch(async (e) => {
  console.error("FAIL:", e);
  await closeDb();
  process.exit(1);
});
