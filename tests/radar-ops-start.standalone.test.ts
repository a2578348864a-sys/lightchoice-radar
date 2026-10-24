// How `radar-ops start` builds a command line. The order matters more than it looks: Node runs the
// first argument that is not a Node flag as the script, so an application argument placed before the
// entry makes Node try to run that argument as a script — which is why `start web` used to start
// nothing at all. These tests run real processes.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { nodeArgv, startDetached } from "../scripts/process-start.ts";

const waitFor = async (predicate: () => boolean, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
};

test("node flags come before the entry, application arguments after it", () => {
  const script = "/repo/apps/api/src/main.ts";
  // A worker started with the environment file.
  assert.deepEqual(nodeArgv({ entry: script, nodeArgs: ["--env-file-if-exists=.env"] }), ["--env-file-if-exists=.env", script]);
  // The web dev server: a CLI entry plus its own arguments.
  assert.deepEqual(
    nodeArgv({ entry: "/repo/node_modules/@react-router/dev/bin.cjs", appArgs: ["dev", "--port", "3000", "--host", "127.0.0.1"] }),
    ["/repo/node_modules/@react-router/dev/bin.cjs", "dev", "--port", "3000", "--host", "127.0.0.1"],
  );
  // The application arguments are never in front of the entry.
  for (const argv of [
    nodeArgv({ entry: script, nodeArgs: ["--env-file-if-exists=.env"], appArgs: ["--flag"] }),
    nodeArgv({ entry: script, appArgs: ["dev"] }),
  ]) {
    assert.equal(argv[argv.length - 1] === "dev" || argv[argv.length - 1] === "--flag", true);
    assert.equal(argv.includes(script), true);
    assert.ok(argv.indexOf(script) < argv.indexOf("--flag") || !argv.includes("--flag"));
  }
});

test("a started process really runs the entry with its application arguments", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "radar-start-"));
  const out = path.join(dir, "argv.json");
  const script = path.join(dir, "child.mjs");
  writeFileSync(script, `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(1)));
process.exit(0);`);
  const pid = startDetached({ entry: script, nodeArgs: ["--no-warnings"], appArgs: ["alpha", "beta"], logName: "child.log", env: process.env, logDir: dir });
  assert.equal(typeof pid, "number");
  assert.ok(await waitFor(() => { try { return readFileSync(out, "utf8").length > 0; } catch { return false; } }), "the child wrote its argv");
  const argv = JSON.parse(readFileSync(out, "utf8")) as string[];
  assert.deepEqual(argv, [script, "alpha", "beta"], "the entry ran and received its arguments in order");
  rmSync(dir, { recursive: true, force: true });
});
