// Applying a bounded-research verification record to one AMZ123 lead.
//
// R29/R30 researched what official sources actually say about two stored leads. This script writes
// that research into the lead's existing `raw.lead.officialVerification` object — the same field the
// collector fills at ingest and the read-only API already exposes — so no new table, column or
// migration is involved. The collector never rewrites this field on stored articles (dedupe by
// identity, collect.ts only updates `detailRules`), so the record persists.
//
// Commands:
//   show    <lead-id>                    读取当前核实记录（只读）
//   preview <lead-id> <record.json>      校验记录文件并预览变更，不写库
//   apply   <lead-id> <record.json>      快照 → 校验 → 并发检查 → 写入 → 回读
//   restore <lead-id> <snapshot.json>    把快照原样写回（精确回滚）
//
// Safety rules enforced BEFORE any database write:
//   1. `verification` 必须是对象——不接受双重 JSON 编码的字符串（R30 曾因此读出全空）。
//   2. status 必须是既有四态枚举之一；matched-official 必须给出可点的官方 URL 与标题。
//   3. 每条 claim 必须有具体主张文本；supported 必须附官方原文依据；unverified 必须写明原因。
//   4. 日期字段必须是 YYYY-MM-DD；日期语义分离由展示层保证（effectiveDate 只放官方文件自己声明的日期）。
//   5. 并发保护：record.expect.verifiedAt 必须等于当前库里的 verifiedAt（从未核实为 null），
//      否则拒绝——Agent A 拿着旧记录不能静默覆盖 Agent B 的新结果。
//   6. 幂等：expect 匹配且内容与当前完全一致时，报「无变更」并以 0 退出，不重复写。
import { readFileSync } from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";

const LEAD_SOURCE_ID = "amz123-policy-leads";
const SNAPSHOT_DIR = path.join(REPO_ROOT, ".data", "_diag");
const STATUSES = ["matched-official", "evidence-insufficient", "third-party-only", "access-restricted"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const [command = "", leadId = "", file = ""] = process.argv.slice(2);
if (!/^[a-zA-Z0-9_-]{1,80}$/.test(leadId)) {
  console.error("用法：show <lead-id> | preview <lead-id> <record.json> | apply <lead-id> <record.json> | restore <lead-id> <snapshot.json>");
  process.exit(1);
}

function fail(message: string): never {
  console.error(`✗ 拒绝写入：${message}`);
  process.exit(1);
}

/** Structural validation. Anything questionable is refused here, never "fixed" silently. */
function validateRecord(record: unknown): asserts record is {
  verification: {
    status: string; note: string;
    officialUrl?: string | null; officialTitle?: string | null;
    officialPublishedAt?: string | null; effectiveDate?: string | null;
    officialSource?: string | null; effectiveDateLabel?: string | null;
    verifiedAt: string; verifiedBy?: string | null;
    claims?: Array<{ claim: string; verdict: string; evidence?: string | null; note?: string | null }>;
  };
  expect?: { verifiedAt: string | null };
} {
  if (typeof record !== "object" || record === null || Array.isArray(record)) fail("记录文件顶层必须是对象");
  const v = (record as { verification?: unknown }).verification;
  if (typeof v === "string") fail("verification 是字符串——这是 R30 出过的双重 JSON 编码错误。请传对象：{ \"verification\": { … } }");
  if (typeof v !== "object" || v === null || Array.isArray(v)) fail("缺少 verification 对象");
  const ver = v as Record<string, unknown>;
  const status = String(ver.status ?? "");
  if (!STATUSES.includes(status)) fail(`status 必须是四个既有枚举之一（${STATUSES.join(" / ")}），收到：${status || "(空)"}`);
  if (typeof ver.note !== "string" || ver.note.trim().length < 10) fail("note 必须是非空说明（至少 10 个字符）");
  for (const key of ["officialPublishedAt", "effectiveDate"] as const) {
    const value = ver[key];
    if (value !== undefined && value !== null && (typeof value !== "string" || !DATE_RE.test(value))) {
      fail(`${key} 必须是 YYYY-MM-DD 或 null（收到：${String(value)}）`);
    }
  }
  for (const key of ["officialUrl"] as const) {
    const value = ver[key];
    if (value !== undefined && value !== null && (typeof value !== "string" || !/^https:\/\//.test(value))) {
      fail(`${key} 必须是 https:// 链接或 null（收到：${String(value)}）`);
    }
  }
  if (status === "matched-official") {
    if (!ver.officialUrl || !ver.officialTitle) fail("matched-official 必须给出官方 officialUrl 与 officialTitle");
    const claims = ver.claims;
    if (!Array.isArray(claims) || claims.length === 0) fail("matched-official 必须携带至少一条 claim，逐条说明官方支持范围");
  }
  const claims = Array.isArray(ver.claims) ? ver.claims : [];
  for (const [index, entry] of claims.entries()) {
    const label = `claims[${index}]`;
    if (typeof entry !== "object" || entry === null) fail(`${label} 必须是对象`);
    const claim = entry as Record<string, unknown>;
    if (typeof claim.claim !== "string" || claim.claim.trim().length < 8) fail(`${label}.claim 必须是具体的政策主张（至少 8 个字符）`);
    if (claim.verdict !== "supported" && claim.verdict !== "unverified") fail(`${label}.verdict 只能是 supported / unverified`);
    if (claim.verdict === "supported") {
      const evidence = claim.evidence;
      if (typeof evidence !== "string" || evidence.trim().length < 10) {
        fail(`${label} 标记为 supported 但缺少可定位的官方原文依据（evidence）——仅凭 URL 存在或标题相似不算证据`);
      }
    } else if (typeof claim.note !== "string" || claim.note.trim().length < 4) {
      fail(`${label} 标记为 unverified 但没有写明未证实原因（note）`);
    }
  }
  const verifiedAt = ver.verifiedAt;
  if (typeof verifiedAt !== "string" || Number.isNaN(Date.parse(verifiedAt))) fail("verifiedAt 必须是合法时间戳（核实记录时间，不是政策日期）");
}

async function currentVerification(id: string): Promise<Record<string, unknown> | null> {
  const [row] = await sql<{ verification: unknown }[]>`
    SELECT raw->'lead'->'officialVerification' AS verification
    FROM articles WHERE id = ${id} AND source_id = ${LEAD_SOURCE_ID}`;
  if (!row) {
    console.error(`找不到该线索：${id}（或它不属于 ${LEAD_SOURCE_ID}）`);
    await closeDb();
    process.exit(1);
  }
  // 兼容 R30 的双重编码遗留：字符串值按解析后的对象处理（只读路径在此规范化）。
  const value = row.verification;
  if (typeof value === "string") {
    try { return JSON.parse(value) as Record<string, unknown>; } catch { return null; }
  }
  return (value ?? null) as Record<string, unknown> | null;
}

/**
 * Atomic compare-and-set: the write lands only while the stored verification still equals
 * `expected` (jsonb IS NOT DISTINCT FROM). This is the concurrency gate of last resort — even if a
 * stale in-memory read passed the application-level checks, the database itself refuses to let the
 * write through when another session changed the record in between. Returns the rows updated (0 =
 * another writer won).
 */
async function writeVerification(id: string, verification: unknown, expected: unknown): Promise<number> {
  const result = await sql`
    UPDATE articles
    SET raw = jsonb_set(raw, '{lead,officialVerification}', ${verification}::jsonb, false)
    WHERE id = ${id} AND source_id = ${LEAD_SOURCE_ID}
      AND (raw->'lead'->'officialVerification') IS NOT DISTINCT FROM ${expected}::jsonb`;
  return result.count ?? 0;
}

/** jsonb does not preserve key order: compare semantically with recursively sorted keys. */
function stable(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((entry) => stable(entry)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stable(obj[key])}`).join(",")}}`;
}

function sameContent(a: Record<string, unknown> | null, b: Record<string, unknown> | null): boolean {
  return stable(a) === stable(b);
}

const current = await currentVerification(leadId);

if (command === "show") {
  console.log(JSON.stringify(current, null, 1));
} else if (command === "preview" || command === "apply") {
  const record = JSON.parse(readFileSync(file, "utf8")) as unknown;
  validateRecord(record);
  const incoming = record.verification;
  const expectVerifiedAt = record.expect ? (record.expect.verifiedAt ?? null) : undefined;
  const currentVerifiedAt = current ? String(current.verifiedAt ?? null) : null;
  if (command === "apply") {
    if (expectVerifiedAt === undefined) {
      fail("记录缺少 expect.verifiedAt（并发保护）。先执行 show 读取当前核实时间，把它写进 record.expect.verifiedAt 后再 apply。");
    }
    if (expectVerifiedAt !== currentVerifiedAt) {
      fail(`并发保护触发：记录期望的核实时间(${String(expectVerifiedAt)})与当前库中(${String(currentVerifiedAt)})不一致。当前记录可能已被其他会话更新——请先 show 读取最新状态再合并。`);
    }
    if (sameContent(current, incoming as Record<string, unknown>)) {
      console.log("幂等：核实记录与当前完全一致，无变更（exit 0）。");
      await closeDb();
      process.exit(0);
    }
  }
  const incomingClaims = Array.isArray(incoming.claims) ? incoming.claims : [];
  const currentClaims = Array.isArray(current?.claims) ? (current!.claims as unknown[]) : [];
  console.log(`校验通过。变更预览：status ${String(current?.status ?? "(无)")} → ${incoming.status}；claims ${currentClaims.length} → ${incomingClaims.length}；verifiedAt ${String(current?.verifiedAt ?? "(无)")} → ${incoming.verifiedAt}`);
  if (command === "preview") {
    console.log("preview 模式：未写库。确认无误后用 apply 执行。");
  } else {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const snapshotPath = path.join(SNAPSHOT_DIR, `lead-verification-${leadId}-${stamp}.json`);
    const { writeFileSync } = await import("node:fs");
    // The snapshot binds three things: the lead, the record this apply replaced, and the record it
    // wrote. A later restore may only run while the stored state is still the applied one.
    writeFileSync(snapshotPath, JSON.stringify({
      id: leadId,
      verification: current,
      applied: incoming,
      appliedAt: new Date().toISOString(),
      appliedVerifiedAt: incoming.verifiedAt,
    }, null, 1), "utf8");
    console.log(`已快照旧核实记录与应用后状态 → ${snapshotPath}`);
    const updated = await writeVerification(leadId, incoming, current);
    if (updated === 0) {
      console.error("✗ 原子并发保护触发：数据库中的核实记录在写入前一刻已被其他会话改变（compare-and-set 未命中）。请 show 重新读取最新状态，合并后再试（快照未删除）。");
      await closeDb();
      process.exit(1);
    }
    const stored = await currentVerification(leadId);
    if (!sameContent(stored, incoming as Record<string, unknown>)) {
      console.error("✗ 回读与预期不一致——请用 psql 复核（快照未删除，可 restore）。");
      await closeDb();
      process.exit(1);
    }
    console.log(`已写入。核实状态 = ${String(stored?.status)}；主张条目 = ${Array.isArray(stored?.claims) ? (stored!.claims as unknown[]).length : 0}`);
  }
} else if (command === "restore") {
  let snapshot: { id?: string; verification?: unknown; applied?: unknown; appliedVerifiedAt?: string };
  try {
    snapshot = JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    fail(`快照文件不是合法 JSON：${String(error).slice(0, 120)}`);
  }
  if (!snapshot || typeof snapshot !== "object" || snapshot.id !== leadId) {
    fail(`快照缺失、损坏或属于其他线索（snapshot.id=${String((snapshot as { id?: unknown })?.id)}，目标=${leadId}），拒绝恢复。`);
  }
  if (snapshot.applied === undefined) {
    // 旧版快照只有「回滚目标」，没有「应用后状态」，无法判断期间是否已有其他更新——
    // 按安全边界拒绝自动恢复，转人工对比，不为兼容旧快照削弱并发门禁。
    console.error("✗ 拒绝自动恢复：这是旧版快照（缺少 applied 字段），无法判断快照之后是否已有其他会话更新过核实记录。");
    console.error("  请先执行 show 查看当前记录，与快照内容人工对比；如确认要回到旧版本，把快照中的 verification 保存为记录文件（补 expect.verifiedAt 后用 apply 恢复）。");
    await closeDb();
    process.exit(1);
  }
  const rolledBack = (snapshot.verification ?? null) as Record<string, unknown> | null;
  const appliedState = snapshot.applied as Record<string, unknown>;
  // 顺序即语义：先识别「已经回滚过」（G），再识别「期间有其他更新」（D）。
  if (sameContent(current, rolledBack)) {
    console.log("无需重复回滚：当前核实记录已与快照内容一致（此前已恢复或本就相同），未做任何写入。");
  } else if (!sameContent(current, appliedState)) {
    console.error("✗ 拒绝恢复：当前核实记录已不是这份快照应用后的状态——期间已有其他更新（例如更新的官方证据）。");
    console.error("  旧快照不能覆盖更新的核实结论。请先执行 show 对比当前记录与快照差异；如确认要回到旧版本，把快照中的 verification 保存为记录文件（补 expect.verifiedAt）后用 apply 执行。");
    await closeDb();
    process.exit(1);
  } else {
    const updated = await writeVerification(leadId, rolledBack, appliedState);
    if (updated === 0) {
      console.error("✗ 原子并发保护触发：状态在校验与写入之间又被其他会话改变。请 show 重新读取后再决策。");
      await closeDb();
      process.exit(1);
    }
    console.log(`已恢复快照 ${file}（仅改动 raw.lead.officialVerification 一个字段；其他字段与其他线索未动）`);
  }
} else {
  console.error("用法：show <lead-id> | preview <lead-id> <record.json> | apply <lead-id> <record.json> | restore <lead-id> <snapshot.json>");
}

await closeDb();
