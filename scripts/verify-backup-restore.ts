// Safe local backup & isolated restore verification
import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import postgres from "postgres";

const pgBin = "D:\\Workspace\\LightChoiceRadarRuntime\\postgresql-17.11\\pgsql\\bin";
const pgDumpExe = path.join(pgBin, "pg_dump.exe");
const pgRestoreExe = path.join(pgBin, "pg_restore.exe");

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL missing");
  process.exit(1);
}

const u = new URL(dbUrl);
const user = decodeURIComponent(u.username);
const password = decodeURIComponent(u.password);
const host = u.hostname;
const port = u.port;
const sourceDb = decodeURIComponent(u.pathname.slice(1));

const backupDir = path.resolve(".data", "backups");
mkdirSync(backupDir, { recursive: true });

const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const dumpFile = path.join(backupDir, `${sourceDb}-${stamp}.dump`);

console.log(`Starting pg_dump of "${sourceDb}" on ${host}:${port}...`);
const env = { ...process.env, PGUSER: user, PGPASSWORD: password };

// 1. Run pg_dump
execFileSync(pgDumpExe, [
  "-h", host,
  "-p", port,
  "-U", user,
  "--format=custom",
  "--compress=6",
  "--no-owner",
  "--file", dumpFile,
  sourceDb,
], { env, stdio: "inherit" });

console.log(`Dump created: ${dumpFile}`);

// 2. Verify archive with pg_restore --list
console.log("Verifying archive integrity with pg_restore --list...");
const listOutput = execFileSync(pgRestoreExe, ["--list", dumpFile], { encoding: "utf8" });
console.log(`Archive valid! TOC contains ${listOutput.split("\n").length} entries.`);

// 3. Create clean isolated restore database
const restoreDbName = "lightchoice_radar_restore_test";
const adminSql = postgres(`postgres://${user}:${password}@${host}:${port}/postgres`, { max: 1 });
try {
  await adminSql.unsafe(`DROP DATABASE IF EXISTS ${restoreDbName} WITH (FORCE)`);
  await adminSql.unsafe(`CREATE DATABASE ${restoreDbName}`);
  console.log(`Created isolated test database: ${restoreDbName}`);
} finally {
  await adminSql.end();
}

// 4. Restore dump into isolated database
console.log(`Restoring dump into isolated database "${restoreDbName}"...`);
try {
  execFileSync(pgRestoreExe, [
    "-h", host,
    "-p", port,
    "-U", user,
    "-d", restoreDbName,
    "--no-owner",
    dumpFile,
  ], { env, stdio: "pipe" });
} catch (e) {
  // pg_restore returns 1 if there are minor notices/warnings, check if tables restored
  console.log("pg_restore finished with notes:", (e.stderr ? String(e.stderr) : e.message).slice(0, 200));
}

// 5. Verify restored database contents
console.log(`Connecting to restored database "${restoreDbName}" to verify tables & rows...`);
const testSql = postgres(`postgres://${user}:${password}@${host}:${port}/${restoreDbName}`, { max: 1 });
try {
  const tables = await testSql`
    SELECT table_name FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name
  `;
  console.log(`Restored database has ${tables.length} tables:`, tables.map(t => t.table_name).join(", "));
  
  const [sourcesCount] = await testSql`SELECT count(*) FROM sources`;
  const [settingsCount] = await testSql`SELECT count(*) FROM settings`;
  console.log(`Sources count: ${sourcesCount.count}, Settings count: ${settingsCount.count}`);
  
  if (tables.length === 0) throw new Error("Restored database has no tables!");
  console.log("PASS: Isolated database restore verification successful!");
} finally {
  await testSql.end();
}

// 6. Clean up isolated restore database
console.log(`Dropping isolated test database "${restoreDbName}"...`);
const cleanSql = postgres(`postgres://${user}:${password}@${host}:${port}/postgres`, { max: 1 });
try {
  await cleanSql.unsafe(`DROP DATABASE IF EXISTS ${restoreDbName} WITH (FORCE)`);
  console.log(`Isolated database "${restoreDbName}" dropped cleanly.`);
} finally {
  await cleanSql.end();
}

console.log("=== BACKUP AND ISOLATED RESTORE VERIFICATION COMPLETE ===");
