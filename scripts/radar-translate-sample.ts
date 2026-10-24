// Bounded, explicit sample of the Chinese title / source-summary translation (editorial/translate-text.ts).
//
// Why this exists: the scheduled path (content.translate → translateTextPending) only translates items
// discovered after translation was switched on, and it must stay off for continuous paid work until the
// operator decides otherwise. A first sample therefore names its article ids on the command line, and
// this script translates exactly those — no backlog scan, no wildcard, no source-wide sweep.
//
// Usage:
//   RADAR_TRANSLATE_ENABLED=true node --env-file=.env scripts/radar-translate-sample.ts --ids <id,id>
//   RADAR_TRANSLATE_ENABLED=true node --env-file=.env scripts/radar-translate-sample.ts --ids <id,id> --apply
//
// A new authorization window (a round) is started only when --round is given, and it archives the
// previous window with its own caps and spend instead of erasing anything:
//   … --round r47 --max-requests 40 --max-articles 20 --budget 1 --apply
//
// Guards:
//   1. At most --max-articles ids (default 8), and each must be an official T1 editorial item.
//   2. The caps live in settings (editorial/translate-budget.ts) and are checked before every request;
//      they are not printed as "estimate" and then bypassed.
//   3. Dry run reads only. Nothing is written without --apply.
//   4. The API key is never printed; only whether the model is configured and reachable.
import { config } from "@aihot/backend/config";
import { closeDb, sql } from "@aihot/backend/db";
import { translateItemText } from "@aihot/backend/editorial/translate-text";
import { startTranslationRound, translationSpendSummary, costOf } from "@aihot/backend/editorial/translate-budget";
import { modelFor } from "@aihot/backend/editorial/models";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const idsArg = flag("--ids") ?? "";
const apply = args.includes("--apply");
const round = flag("--round");
const maxRequests = Number(flag("--max-requests") ?? config.translate.maxRequests);
const maxArticles = Number(flag("--max-articles") ?? config.translate.maxArticles);
const budgetCny = Number(flag("--budget") ?? config.translate.budgetCny);
// Optional window constraints: a hard expiry (hours from now) and a purpose allowlist. Both persist
// in the window's caps, so a restart or a later environment can neither lift them nor re-open it.
const ttlHours = Number(flag("--ttl-hours"));
const purposes = (flag("--purposes") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
const windowLimits = {
  maxRequests, maxArticles, budgetCny,
  ...(Number.isFinite(ttlHours) && ttlHours > 0 ? { expiresAt: new Date(Date.now() + ttlHours * 3600_000).toISOString() } : {}),
  ...(purposes.length ? { purposes } : {}),
};
const ids = [...new Set(idsArg.split(",").map((id) => id.trim()).filter(Boolean))];

if (!ids.length || ids.some((id) => !/^[a-zA-Z0-9_-]{1,80}$/.test(id))) {
  console.error("用法：radar-translate-sample.ts --ids <id,id,…> [--round <名> --max-requests N --max-articles N --budget 元] [--apply]");
  process.exit(1);
}
if (ids.length > maxArticles) {
  console.error(`白名单最多 ${maxArticles} 个文章 ID，当前 ${ids.length} 个：拒绝执行`);
  process.exit(1);
}
if (!config.translateEnabled) {
  console.error("翻译专用开关未打开（RADAR_TRANSLATE_ENABLED=true）：拒绝执行，不发任何请求");
  process.exit(1);
}

const model = await modelFor("translate");
const hasKey = Boolean(process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY);

if (round) {
  // Archives the running window (R45's) and starts this one with the caps named here.
  const { archived, current } = await startTranslationRound(round, windowLimits);
  if (archived) console.log(`已归档上一轮 ${archived.round || "r45"}：请求 ${archived.requests}、文章 ${archived.articles.length}、费用 ${archived.spentCny.toFixed(4)} 元（记录保留在 settings.translate.rounds）`);
  console.log(`本轮 ${current.round} 上限：请求 ${maxRequests} 次、文章 ${maxArticles} 篇、金额 ${budgetCny} 元${current.limits?.expiresAt ? `、截止 ${current.limits.expiresAt}` : ""}${current.limits?.purposes?.length ? `、用途仅 ${current.limits.purposes.join(" / ")}` : ""}`);
}

console.log(`模型=${model} 已配置密钥=${hasKey ? "是" : "否"} 地址=${process.env.LLM_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? "(未设置)"}`);

const rows = await sql<{ article_id: string; source_id: string; title: string; summary: string | null; language: string | null; revision: number; tier: string; participation_mode: string }[]>`
  SELECT p.article_id, p.source_id, p.title, p.summary, a.language, a.revision, s.tier, s.participation_mode
  FROM publications p JOIN articles a ON a.id = p.article_id JOIN sources s ON s.id = p.source_id
  WHERE p.article_id IN ${sql(ids)} ORDER BY p.discovered_at`;

const byId = new Map(rows.map((r) => [r.article_id, r]));
for (const id of ids) {
  const row = byId.get(id);
  if (!row) console.log(`${id}  ✗ 不是已发布的条目`);
  else if (row.tier !== "T1" || row.participation_mode !== "editorial") console.log(`${id}  ✗ 非官方政策来源（${row.source_id}）`);
  else console.log(`${id}  ${row.source_id}  rev${row.revision}  标题 ${row.title.length} 字 / 摘要 ${(row.summary ?? "").length} 字`);
}

const spend = await translationSpendSummary();
console.log(`累计（含已归档轮次）：请求 ${spend.totalRequests} 次、文章 ${spend.totalArticles} 个、输入 ${spend.totalPromptTokens} tokens、输出 ${spend.totalCompletionTokens} tokens、费用 ${spend.totalSpentCny.toFixed(4)} 元`);

if (!apply) {
  // Worst case for this list: one title plus one summary request per item, at their output ceilings.
  const estimate = ids.length * (costOf(500, 500) + costOf(1500, 1200));
  console.log(`预估最高费用（未发送任何请求）：约 ${estimate.toFixed(4)} 元；加 --apply 才真正调用`);
} else {
  const results = [];
  for (const id of ids) {
    try {
      results.push(await translateItemText(id));
    } catch (error) {
      results.push({ articleId: id, status: "failed", revision: null, parts: [], reason: (error as Error).message.slice(0, 200) });
    }
  }
  for (const r of results) {
    const parts = r.parts.length ? `（${r.parts.join("+")}）` : "";
    console.log(`${r.articleId}  ${r.status}${parts}${r.reason ? `  ${r.reason}` : ""}`);
  }
  const after = await translationSpendSummary();
  console.log(`累计（含已归档轮次）：请求 ${after.totalRequests} 次、文章 ${after.totalArticles} 个、输入 ${after.totalPromptTokens} tokens、输出 ${after.totalCompletionTokens} tokens、费用 ${after.totalSpentCny.toFixed(4)} 元`);
  for (const r of after.rounds) console.log(`  轮次 ${r.round || "r45"}：请求 ${r.requests}/${r.limits?.maxRequests ?? "?"}、文章 ${r.articles.length}/${r.limits?.maxArticles ?? "?"}、费用 ${r.spentCny.toFixed(4)}/${r.limits?.budgetCny ?? "?"} 元${r.closedAt ? "（已归档）" : "（进行中）"}`);
  const ok = results.filter((r) => r.status === "translated" || r.status === "partial").length;
  console.log(`成功 ${ok}/${results.length}`);
}

await closeDb();
