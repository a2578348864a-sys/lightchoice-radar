// The fourth lane's dedicated automated scheduler worker (AUTO-RUN).
//
// Governs autonomous periodic execution for approved market sources (e.g. CPSC public recalls),
// watermark progression, bounded recovery, and downstream deterministic signal derivation.
// Runs headless in the background without requiring a browser or manual user clicks.
// Protected by a session-level PostgreSQL advisory lock (role "radar-market", key 7_204_229_008).
import { closeDb } from "@aihot/backend/db";
import { runDueMarketSources } from "@aihot/backend/market/market-scheduler";
import { clearControlState, clearStopRequest, startHeartbeat, stopRequested, watchStopRequest, writeRunRecord } from "./control.ts";
import { releaseSingleInstance, requireSingleInstance } from "./instance-lock.ts";

clearStopRequest("radar-market");
await requireSingleInstance("radar-market");
writeRunRecord("radar-market", "radar-market.ts");
const stopHeartbeat = startHeartbeat("radar-market");

const pollIntervalMs = Number(process.env.RADAR_MARKET_POLL_INTERVAL_MS || 60_000);
let isTickRunning = false;
let stopping = false;

async function tick(): Promise<void> {
  if (isTickRunning || stopping || stopRequested("radar-market")) return;
  isTickRunning = true;
  const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const res = await runDueMarketSources({
      runId,
      workerPid: process.pid,
    });
    if (res.executed > 0) {
      console.log(JSON.stringify({
        level: "info",
        msg: "market scheduler cycle finished",
        runId,
        executed: res.executed,
        skipped: res.skipped,
        results: res.results,
        downstream: res.downstreamTriggered,
        pid: process.pid,
      }));
    }
  } catch (err: unknown) {
    console.error(JSON.stringify({
      level: "error",
      msg: "market scheduler cycle error",
      error: err instanceof Error ? err.message : String(err),
      pid: process.pid,
    }));
  } finally {
    isTickRunning = false;
  }
}

// Initial tick on startup
void tick();

// Periodic timer
const timer = setInterval(() => {
  void tick();
}, pollIntervalMs);

const shutdown = async (): Promise<void> => {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  console.log(JSON.stringify({ level: "info", msg: "market scheduler worker stopping", pid: process.pid }));
  stopHeartbeat();
  await releaseSingleInstance();
  await clearControlState("radar-market");
  await closeDb();
  process.exit(0);
};

process.on("exit", (code) => {
  console.log(JSON.stringify({ level: "info", msg: "PROCESS EXIT CALLED", code, pid: process.pid }));
});

process.on("unhandledRejection", (err) => {
  console.error(JSON.stringify({ level: "error", msg: "unhandled rejection in market worker", error: String(err), pid: process.pid }));
});
process.on("uncaughtException", (err) => {
  console.error(JSON.stringify({ level: "error", msg: "uncaught exception in market worker", error: String(err), pid: process.pid }));
});

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
watchStopRequest("radar-market", () => void shutdown());

console.log(JSON.stringify({
  level: "info",
  msg: "market scheduler worker started",
  pollIntervalMs,
  pid: process.pid,
}));
