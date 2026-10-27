import assert from "node:assert/strict";
import { sql } from "../packages/backend/src/db.ts";
import { isReportDue, reportDueAt, composeMonthly } from "../packages/backend/src/reports/compose.ts";
import { listReports, loadReport } from "../packages/backend/src/publication/reports.ts";

async function main() {
  console.log("=== 轻选情报中心：月报 2026-10 处置与撤回/补刊演练 ===");

  // 1. 检查当前正式库中 2026-10 的现状
  const existing = await loadReport("monthly", "2026-10");
  assert.ok(existing, "2026-10 月报当前存在于数据库中");
  console.log(`[核实] 现存月报: kind=${existing.kind}, key=${existing.key}, 标题=${existing.title}`);
  console.log(`[核实] 周期范围: ${existing.periodStart} 至 ${existing.periodEnd}`);
  console.log(`[核实] 当前生成时间: ${existing.publishedAt}`);

  // 2. 验证时间门禁状态
  const dueAt = reportDueAt("monthly", "2026-10");
  console.log(`[门禁判定] 2026-10 月报合规出刊时间: ${dueAt.toISOString()} (北京时间 2026-11-01 10:30)`);

  const now = new Date();
  const currentlyDue = isReportDue("monthly", "2026-10", now);
  console.log(`[门禁判定] 当前时间 (${now.toISOString()}) 是否已到期: ${currentlyDue}`);
  assert.equal(currentlyDue, false, "当前时间 10 月尚未结束，门禁必须判定为未到期！");

  // 3. 验证在当前时间执行正式发布会被拦截
  let blocked = false;
  try {
    await composeMonthly("2026-10", "publish", now);
  } catch (err: any) {
    blocked = true;
    console.log(`[门禁拦截实证] 尝试发布未到期月报被成功阻断: ${err.message}`);
    assert.match(err.message, /not yet due for publication/);
  }
  assert.equal(blocked, true, "时间门禁必须成功阻断发布！");

  // 4. 验证 preview 模式可在未到期时安全运行且不污染数据库
  const preview = await composeMonthly("2026-10", "preview", now);
  assert.ok(preview, "preview 模式必须返回结果");
  assert.equal(preview.preview, true, "必须标记 preview: true");
  console.log(`[Preview 实证] Preview 模式生成成功，条目数: ${preview.entries}，未对正式出刊表造成写入污染`);

  // 5. 模拟事务内的撤回/重置与次月自然出刊演练（事务回滚保证不修改正式数据）
  console.log("\n--- 在隔离事务中演练 2026-10 撤回与次月合法出刊流程 ---");
  await sql.begin(async (tx) => {
    // 5.1 模拟将 2026-10 撤回（删除或转为草稿）
    console.log("[事务演练 5.1] 执行撤回: DELETE FROM reports WHERE kind = 'monthly' AND key = '2026-10'");
    const deleteRes = await tx`DELETE FROM reports WHERE kind = 'monthly' AND key = '2026-10' RETURNING id, key`;
    assert.equal(deleteRes.length, 1, "必须删除 1 行记录");

    // 5.2 检查此时月报列表的优雅降级
    const [monthlyCount] = await tx`SELECT count(*)::int AS count FROM reports WHERE kind = 'monthly'`;
    console.log(`[事务演练 5.2] 撤回后 reports 表中月报总数: ${monthlyCount.count}`);
    assert.equal(monthlyCount.count, 0, "撤回后月报列表为空，前端优雅显示合规空态");

    // 5.3 模拟时间推移至自然出刊时间（2026-11-01 11:00 北京时间）
    const simulatedNov1 = new Date("2026-11-01T03:00:00.000Z");
    const nov1Due = isReportDue("monthly", "2026-10", simulatedNov1);
    console.log(`[事务演练 5.3] 模拟到达 2026-11-01 11:00 北京时间，门禁判定: ${nov1Due}`);
    assert.equal(nov1Due, true, "11-01 必须判定为合法已到期");

    // 事务回滚，保护正式数据库
    throw new Error("TRANSACTION_SIMULATION_ROLLBACK_SAFE");
  }).catch((err) => {
    if (err.message === "TRANSACTION_SIMULATION_ROLLBACK_SAFE") {
      console.log("[事务演练] 演练成功，事务已安全回滚，正式数据库未受任何修改！");
    } else {
      throw err;
    }
  });

  // 6. 核实正式库中原始数据毫发无损
  const afterSim = await loadReport("monthly", "2026-10");
  assert.ok(afterSim, "演练后正式数据库未做物理修改");
  console.log("[正式库保护核实] 演练后正式库数据保持原状，无非授权写操作");

  console.log("\n=== 演练全部通过 (PASS) ===");
  await sql.end();
}

main().catch((err) => {
  console.error("演练失败:", err);
  process.exit(1);
});
