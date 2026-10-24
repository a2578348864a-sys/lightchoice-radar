// Process-level single-instance guard for dedicated workers.
//
// pg-boss already makes *job delivery* exclusive (SKIP LOCKED, queue policy, singletonKey), so two
// OS processes cannot run the same job twice. What it does not do is keep a second process from
// running at all: both would poll the same private queues every few seconds and both would rewrite
// the same `pgboss.schedule` row. A session-level PostgreSQL advisory lock gives one process per
// role without a new table, a new dependency or a file lock that a crash would leave behind — the
// lock disappears with the session.
import { sql } from "@aihot/backend/db";

/** One key per worker role; stable across restarts, distinct from any other advisory lock. */
const LOCK_KEYS = {
  "radar-announcements": 7_204_229_001,
  "ads-policy": 7_204_229_002,
  // The dedicated lead worker is a role of its own: it may run beside the family worker, and it must
  // not stop the family worker from running the same lead source.
  "amz123-leads": 7_204_229_003,
  // The first-lane content/translation worker (scoped main worker): one process, no second consumer.
  "radar-translate": 7_204_229_004,
} as const;

export type WorkerRole = keyof typeof LOCK_KEYS;

let held: { role: WorkerRole; connection: Awaited<ReturnType<typeof sql.reserve>> } | null = null;

/**
 * Takes the role's advisory lock, or exits quietly when another process already holds it.
 * Exiting with code 0 keeps a logon-triggered scheduled task from entering its restart loop:
 * the duplicate start is not a failure, it is a no-op.
 */
export async function requireSingleInstance(role: WorkerRole): Promise<void> {
  const connection = await sql.reserve();
  const [row] = await connection<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(${LOCK_KEYS[role]}::bigint) AS locked`;
  if (!row?.locked) {
    await connection.release();
    console.log(JSON.stringify({
      level: "warn",
      msg: "another instance already holds this worker role; exiting without doing any work",
      role,
      pid: process.pid,
    }));
    await sql.end({ timeout: 5 });
    process.exit(0);
  }
  held = { role, connection };
  console.log(JSON.stringify({ level: "info", msg: "worker instance lock acquired", role, pid: process.pid }));
}

/** Releases the advisory lock explicitly; the session would also release it on exit. */
export async function releaseSingleInstance(): Promise<void> {
  if (!held) return;
  const { role, connection } = held;
  held = null;
  await connection`SELECT pg_advisory_unlock(${LOCK_KEYS[role]}::bigint)`.catch(() => {});
  await connection.release();
}
