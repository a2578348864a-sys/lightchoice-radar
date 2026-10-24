// Starting a detached Node process for the local operators' tool.
//
// The argument order is the whole point of this module: `node --env-file=.env script.ts app args`
// puts Node's own flags before the entry and the application's arguments after it. Putting an
// application argument before the entry makes Node try to run that argument as a script, which is how
// `start web` used to silently produce nothing.
import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@aihot/backend/config";

export interface StartOptions {
  /** The script or CLI Node should run. */
  entry: string;
  /** Node flags that belong before the entry (`--env-file-if-exists=.env`). */
  nodeArgs?: string[];
  /** Application arguments that belong after the entry (`dev --port 3000`). */
  appArgs?: string[];
  logName: string;
  env: NodeJS.ProcessEnv;
  cwd?: string;
  /** Where the log file goes; the project's own diagnostics directory by default. */
  logDir?: string;
}

const DEFAULT_LOG_DIR = path.join(REPO_ROOT, ".data", "_diag");

/** The exact argv handed to Node. */
export function nodeArgv(options: Pick<StartOptions, "entry" | "nodeArgs" | "appArgs">): string[] {
  return [...(options.nodeArgs ?? []), options.entry, ...(options.appArgs ?? [])];
}

/**
 * Starts the process detached and returns its pid; its output goes to `logDir/logName`.
 *
 * The working directory defaults to the project root, not the caller's: the entry points are
 * absolute, but `--env-file-if-exists=.env` is a relative path, so a child started from another
 * directory silently ran without the project's environment file.
 */
export function startDetached(options: StartOptions): number | null {
  const logDir = options.logDir ?? DEFAULT_LOG_DIR;
  mkdirSync(logDir, { recursive: true });
  const out = openSync(path.join(logDir, options.logName), "a");
  const child = spawn(process.execPath, nodeArgv(options), {
    cwd: options.cwd ?? REPO_ROOT,
    detached: true,
    windowsHide: true,
    stdio: ["ignore", out, out],
    env: options.env,
  });
  child.unref();
  closeSync(out);
  return child.pid ?? null;
}

/**
 * Starts a Node entry on its own hidden Windows console instead of with no console at all.
 *
 * `startDetached` gives the child no console — right for plain Node services. An entry that spawns
 * console children of its own (@react-router dev relaunches itself without windowsHide) makes each
 * child allocate a fresh console, which Windows Terminal shows as a visible window that takes the
 * whole service down when someone closes it. The cmd wrapper here holds a private hidden console
 * (CREATE_NO_WINDOW — the same mechanism postgres uses in radar-local.ts) that the whole tree
 * inherits: no window is ever created, and closing windows cannot reach the process. Environment
 * variables that differ from this process's own are passed through explicitly.
 */
export async function startOnHiddenConsole(options: StartOptions): Promise<number | null> {
  const logDir = options.logDir ?? DEFAULT_LOG_DIR;
  mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, options.logName);
  const argv = nodeArgv(options).map((part) => `"${part}"`).join(" ");
  const envDelta = Object.entries(options.env ?? {})
    .filter(([key, value]) => process.env[key] !== value)
    .map(([key, value]) => `$psi.EnvironmentVariables['${key}'] = '${String(value ?? "").replace(/'/g, "''")}'`);
  const script = [
    "$psi = New-Object System.Diagnostics.ProcessStartInfo",
    "$psi.FileName = 'C:\\Windows\\System32\\cmd.exe'",
    `$psi.Arguments = '/s /c ""${process.execPath}" ${argv} >> "${logPath}" 2>&1"'`,
    "$psi.UseShellExecute = $false",
    "$psi.CreateNoWindow = $true",
    `$psi.WorkingDirectory = '${options.cwd ?? REPO_ROOT}'`,
    ...envDelta,
    "$p = [System.Diagnostics.Process]::Start($psi)",
    "Write-Output ('wrapper pid=' + $p.Id)",
  ].join("; ");
  // Resolve on PowerShell's exit event, never on stdio "close": the detached wrapper cmd lives as
  // long as the service and inherits PowerShell's pipe handles, so waiting for the pipes to close
  // would wait for the service itself to end.
  const started = await new Promise<{ ok: boolean; stdout: string; detail: string }>((resolve) => {
    const ps = spawn("powershell.exe", ["-NoProfile", "-Command", script], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      ps.kill();
      resolve({ ok: false, stdout, detail: "powershell 30 秒内没有退出" });
    }, 30_000);
    ps.stdout.on("data", (chunk) => { stdout += String(chunk); });
    ps.stderr.on("data", (chunk) => { stderr += String(chunk); });
    ps.on("error", (error) => { clearTimeout(timer); resolve({ ok: false, stdout, detail: String(error).slice(0, 160) }); });
    ps.on("exit", (code) => { clearTimeout(timer); resolve({ ok: code === 0, stdout, detail: stderr.trim().slice(0, 160) }); });
  });
  if (!started.ok) {
    console.log(`  隐藏控制台包装失败：${started.detail || "powershell 退出码非 0"}`);
    return null;
  }
  const match = /wrapper pid=(\d+)/.exec(started.stdout);
  return match ? Number(match[1]) : null;
}
