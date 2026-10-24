# LightChoice Radar｜第十轮交付报告（2026-10-23，已按产品决定修正）

> 范围修正：**官方政策人工录入功能取消**，已从代码、配置、迁移、后台与测试中完整移除。本报告只记录保留的 P0/P1 成果与移除结果。
> 状态文件：`docs/radar/CURRENT.md`（唯一权威，已原位更新）。

## 一、结论

P0/P1 三项成果保留且验证通过：**atomic 门禁更严且未被放宽**、**来源更新时间只前进不回退并带动时间轴与发布投影**、**列表/详情日期语义三态可辨**。人工录入相关代码已 0 残留，**未执行 0091 迁移、未改正式库**；为验收临时创建的隔离库已删除，测试模板库的残留表与迁移台账行已清理。

## 二、移除内容（人工录入专属）

| 类型 | 对象 |
|---|---|
| 迁移 | `database/migrations/0091_policy_submissions.sql`（删除，从未在正式库执行） |
| 后端 | `packages/backend/src/admin/manual-policy.ts`、`packages/backend/src/content/policy-verification.ts`（删除） |
| 后台页面与路由 | `apps/web/app/routes/admin/policies.tsx`（删除）、`routes.ts` 的 `admin/policies` 注册、`admin/layout.tsx` 的「官方政策补录」导航项 |
| API | `GET/POST /api/admin/policies`、`POST /api/admin/policies/:id/decide` 及对应 import |
| 导航统计 | `admin/navigation.ts` 的 `policies` 待核验计数与 `pendingPolicies()`（文件已还原到无差异） |
| 契约 | `AdminPolicySubmission` / `AdminPolicyOverview` / `AdminPolicySubmitted`（`contracts/admin.ts` 已还原）、`SiteItemDetail.policyVerification` |
| 详情页 | 政策面板的「（人工核验）」生效日期分支与「已人工核验」核实状态（还原为原文线索表述）、`publication/detail.ts` 的人工核验查询 |
| 来源配置 | `industry/sources.json` 的 `amazon-official-manual`（external / enabled=false / tags 含 platform_policy） |
| 测试 | `tests/manual-policy.standalone.test.ts`、`tests/manual-policy-persist.test.ts`（删除）；`tests/radar-policy.standalone.test.ts` 的来源清单与人工来源断言、`tests/radar-source-compliance.standalone.test.ts` 的 `external` 豁免（均还原为原严格口径） |
| 本地诊断 | `pw-round10-manual.mjs`、`pw-round10-dev-degrade.mjs`、`probe-form.mjs`、`render-ads-pages.mjs`、`render-ads-changelog.mjs`、`pricing.html`（删除，`.data/` 不入库） |
| 数据库 | 隔离库 `lightchoice_radar_ci` 整库删除；`lightchoice_radar_test` 内 `DROP TABLE policy_submissions` + 删除 `schema_migrations` 的 0091 台账行；开发库 `lightchoice_radar` 从未执行过该迁移 |

## 三、保留成果

**P0 迁移门禁**
- `scripts/migration-safety.ts`：`ATOMIC_HEADER` = `/^--[ \t]+atomic[ \t]*\r?\n/`（原 `\s*` 可跨换行）；放行范围仍是 0090 两条语句的 token 逐条比对；1s 锁等待 / 10s 语句超时未改。
- `tests/migration-safety.standalone.test.ts`：CRLF/LF、行内多余空白、声明前空行、`--\natomic`、`--atomic`、尾随字符、文件中注释等边界；读盘校验 0090 首行。

**P1 时间轴与日期语义**
- `packages/backend/src/content/materials.ts`：`laterDate()` + `refreshSourceUpdatedAt()`；相同正文、来源更新时间变新时同步 `source_updated_at` / `timeline_at` 并重导发布投影（无 revision、无重分析）；有发布日期时两者都不动；旧值不回退。
- `packages/contracts/src/site.ts`：`ItemSummary`/`FeedItemSummary` 的 `sourceUpdatedAt`（`policyVerification` 已移除）。
- `packages/backend/src/publication/items.ts`：`ITEM_COLUMNS` 取 `a.source_updated_at` 并映射。
- `apps/web/app/features/feed/parts.tsx`、`FeedItem.tsx`：卡片日期行（`data-item-date`）「发布于 / 来源更新于 / 日期未确认」。
- `apps/web/app/routes/item.tsx`：详情页「发布于 / 来源更新于 / 收录于」与左栏「发布时间 / 来源更新时间 / 收录时间」。

**原有 Ads 能力**：`ads-policy.ts`、`browser-render.ts`、采集与持久化链路未动。

## 四、验证结果

| 项 | 结果 |
|---|---|
| `npm run typecheck`（contracts/backend/api/worker/tests/modules/web + 路由类型） | 通过 |
| `migration-safety.standalone` | 15/15 |
| `radar-policy.standalone` + `radar-source-compliance.standalone` + `ads-policy.standalone` + `radar-policy-backtest.standalone` | 32/32（合计 47/47，含 migration-safety） |
| `source-updated-timeline`（DB） | 6/6 |
| `ads-policy-persist`（DB，回归） | 4/4 |
| `publication-date-correction`（DB，回归） | 17/17 |
| 残留检查 | `grep policy_submissions\|manual-policy\|amazon-official-manual\|policyVerification` 在源码/配置/迁移中 0 命中 |
| 运行时 | 清理后重启 3101/3100：`/all?source=ads-policy-pages` 200、列表 2 条仍带 `sourceUpdatedAt`；`/admin/policies` **404** |
| 真实 Chrome（清理后） | 列表两条「来源更新于 2026-07-22 / 2026-06-25」、来源筛选不变、详情 1280「来源更新于 2026-07-22」/1600 左栏「来源更新时间」、无「收录时间」、刷新一致、公告一条「发布于 2026-05-22」、0 pageerror |

## 五、未完成与阻塞

1. 平台政策覆盖仍是第一主线的实质缺口（开发库 2 条）；人工录入已取消，不设替代方案。
2. Ads 未进入常驻调度；失败恢复演练、注销登录恢复保持未验收。
3. 既有失败（非本轮引入）：standalone 6 条（radar-core 1、sitemap-policy 2、首页创始人 1、outbound-headers 2 为 Windows libuv 退出断言）；数据库测试一批因 rule-only / 付费路径 / 「拒绝未批准非 RSS 来源」门禁失败。

未执行 Commit / Push / Merge / 部署。
