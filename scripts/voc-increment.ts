// 受管一次性 VOC 增量入口（手动触发、非常驻、不进任何调度器）。
// 授权守卫在模块内：研究存在且命名来源 + 来源行 enabled + 批次未撤销 + 请求预算（默认 6 次/轮）。
// 用法：
//   node --env-file-if-exists=.env --experimental-strip-types scripts/voc-increment.ts [studyId] [--tagged grinder] [--backfill-epoch 1760000000] [--batch <id>]
// 首次运行会创建常驻增量批次 `voc-inc-<sourceId>`（用途=store/privateRead/display/export，modelSend 永不包含）；
// 该批次一旦被撤销，增量直接拒绝而不是复活它。
import { sql } from "@aihot/backend/db";
import { saveBatch, loadStudy } from "@aihot/backend/voc/voc-model";
import { runVocIncrement, loadVocIncrementState } from "@aihot/backend/voc/voc-increment";

const args = process.argv.slice(2);
const studyId = args.find((a) => !a.startsWith("--")) ?? "grinder-v1";
const taggedArg = args.indexOf("--tagged") >= 0 ? args[args.indexOf("--tagged") + 1] : undefined;
const backfillArg = args.indexOf("--backfill-epoch") >= 0 ? Number(args[args.indexOf("--backfill-epoch") + 1]) : undefined;
const batchArg = args.indexOf("--batch") >= 0 ? args[args.indexOf("--batch") + 1] : undefined;

const study = await loadStudy(studyId);
if (!study) {
  console.error(JSON.stringify({ status: "refused", reason: `study ${studyId} not found` }, null, 2));
  process.exit(1);
}
const sourceId = study.sourceIds[0];
if (!sourceId) {
  console.error(JSON.stringify({ status: "refused", reason: "study names no source" }, null, 2));
  process.exit(1);
}
const [source] = await sql<{ config: { site?: string } | string | null }[]>`SELECT config FROM sources WHERE id = ${sourceId}`;
// 部分历史行的 config 被双重编码（jsonb 里存了字符串）——两种形态都兼容。
const rawConfig = source?.config;
const config = typeof rawConfig === "string" ? (JSON.parse(rawConfig) as { site?: string }) : rawConfig;
const site = config?.site;
if (!site) {
  console.error(JSON.stringify({ status: "refused", reason: `source ${sourceId} config has no site` }, null, 2));
  process.exit(1);
}
const batchId = batchArg ?? `voc-inc-${sourceId}`;
const existing = await sql<{ value: { revokedAt?: string } | null }[]>`SELECT value FROM settings WHERE key = ${`voc.batch.${batchId}`}`;
if (!existing[0]?.value) {
  // 常驻增量批次的许可基线：与首批一致的研究用途；modelSend 永不出现在这里。
  await saveBatch({
    id: batchId,
    sourceId,
    label: `${sourceId} 有界增量（受管一次性运行）`,
    importedAt: new Date().toISOString(),
    license: {
      uses: ["store", "privateRead", "display", "export"],
      basis: "Stack Exchange 官方 API 有界增量（研究用途，手动受管触发）；逐条 content_license 持续记录；modelSend 未授权（现行 AUP 对面向生成式 AI 的自动化采集用途有限制，书面同意未取得）",
    },
  });
  console.error(`[voc-increment] 已创建常驻增量批次 ${batchId}（不含 modelSend）`);
}
const result = await runVocIncrement({
  studyId,
  sourceId,
  batchId,
  site,
  tagged: taggedArg,
  initialWatermark: backfillArg,
});
console.log(JSON.stringify(result, null, 2));
if (result.status === "processed") {
  const state = await loadVocIncrementState(sourceId);
  console.error(`[voc-increment] state: watermark=${new Date((state?.createdWatermark ?? 0) * 1000).toISOString()} recheckOffset=${state?.recheckOffset ?? 0} carryOver=${state?.carryOver?.length ?? 0}`);
}
await sql.end();
process.exit(result.status === "processed" ? 0 : 1);
