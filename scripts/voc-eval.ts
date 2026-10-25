// 冻结评估样本的验收指标计算（零模型、零网络、零费用）。
// 分母=冻结样本集（评估前固定），指标只统计已存储且证据版本未过期的 L2 结果。
// 用法：node --env-file-if-exists=.env --experimental-strip-types scripts/voc-eval.ts [evalKey]
import { sql } from "@aihot/backend/db";
import { evaluateVocEvalSet } from "@aihot/backend/voc/voc-eval";

const evalKey = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "grinder-v1";
const result = await evaluateVocEvalSet(evalKey);
console.log(JSON.stringify(result, null, 2));
await sql.end();
process.exit(result.status === "processed" ? 0 : 1);
