# LightChoice Radar｜第一主线 V1 收口报告（2026-10-23）

> 范围：Amazon 美国站平台政策情报。人工录入保持取消；行业动态 / 消费者原声 / 市场信号未实施。
> 状态文件：`docs/radar/CURRENT.md`（唯一权威，已原位更新）。

## 一、结论

第一主线达到 **V1 收口条件**：公告采集链路正常、Ads 采集具备**默认关闭但可控可恢复**的独立调度、去重/修订/日期语义无回归、失败可识别可恢复、来源限制如实记录。政策覆盖从 2 条提升到 **3 条**——增量来自修好公告来源「首次导入漏读的条目永远进不来」的缺口，**不是放宽分类、也不是人工录入**。

覆盖上限已确认：Amazon 公开的卖家政策供给只有两条真实入口（公告博客、sellingpartners），本轮核验 6 个候选未发现第三个合法来源。

## 二、P0：来源核验与覆盖

**核验结论（详见 `docs/radar/source-check-round11.json`，均为本轮实测）**

| 候选 | 结论 |
|---|---|
| `sell.amazon.com/blog/announcements`（4 页 23 条） | 允许采集；第 1 页 2 条通过正文门禁；第 2–4 页为 2022-11–2025-09 的历史/营销内容 |
| `sellingpartners.aboutamazon.com/data-insights`（9 条） | 允许采集；7 条卖家故事/营销、1 条费用政策（已采集）、1 条工具宣传；不扩宽 |
| `advertising.amazon.com/help/G8X8M375UPCN4UUC` | 渲染出 7113 字符，**0 条条款级规则证据**；是变更索引而非政策，且属 ads_policy → 不纳入 |
| `sellercentral.amazon.com` | robots `Disallow: /` + 登录 → 拒绝，未请求正文 |
| `www.amazon.com/gp/help` | 买家条款/帮助，分类不符 → 拒绝 |
| `developer-docs.amazon.com/sp-api/changelog` | 接口变更日志，分类不符 → 拒绝 |

**修复的真实缺口**：`admission()` 在非首次导入时以 `initializedAt − 48h` 为下限，而公告来源的落库判定完全依赖正文。结果是「首次导入时正文没读到 / 当时被门禁拒绝」的条目此后永远进不来。修复后：

- 正文门禁来源每轮保留配置的 13 个月窗口；
- `cursor.detailGate` 记住「门禁版本 + 已被拒绝的身份」，稳态不重复读（版本变更即重开）；
- 探针库（`pg_dump` 克隆开发库）复现：修复前 `created=0`，修复后 `created=1`；二次 `created=0` 且 `detailAttempts=0`；
- 开发库真实采集 `created=1` → 新增《New features and updates to Amazon's FBA Grade and Resell program》（2026-02-03，正文 2269 字符，标签「亚马逊卖家项目规则线索」），分析 `relevance=pass`、`eligible=true`、`visibility=public`。

## 三、P1：Ads 独立调度

**实现**：`apps/worker/src/ads-policy.ts` + `ads-policy-schedule.ts`，复用 `collectSource`（与 `scripts/collect.ts ads-policy-pages` 同一条业务链路），不注册 pg-boss 队列、不进入 API/Web/公告 Worker 的启动路径。

| 能力 | 实现 |
|---|---|
| 开关 | `RADAR_ADS_POLICY_ENABLED`（默认关）+ 来源行 `enabled`，两者都满足才运行 |
| 频率 | `RADAR_ADS_POLICY_INTERVAL_MINUTES`（默认 360，允许 15–1440） |
| 超时 | `RADAR_ADS_POLICY_TIMEOUT_MINUTES`（默认 15）看门狗；到期记 error 并 `exit 1`，交外部重启 |
| 单实例 | PostgreSQL advisory lock 角色 `ads-policy`（会话级，崩溃即释放） |
| 失败 | `fetch_runs` + `job_runs` 记录；来源 `health/fail_count/last_error/next_fetch_at` 由既有 `recordFetch` 维护；退避最多 4 倍间隔，不放弃 |
| 崩溃恢复 | 启动时把上一进程遗留的 `running` 记录标为 failed（"exited before this run finished"） |
| 单跑 | `RADAR_ADS_POLICY_ONCE=1`，检查链路时不留守护进程 |

**隔离库演练（`lightchoice_radar_ci`，65 迁移 + seed，仅该库启用 Ads 来源；演练后整库删除）**

1. 首跑：`found=2 created=2`（81s），`job_runs` ok；
2. 二次：`created=0 revised=0`（56s），**同正文不重复创建**；
3. 第二实例：立即退出码 0 + `another instance already holds this worker role`；
4. `taskkill /F` 中途强杀：`fetch_runs 3` / `job_runs 3` 留在 running；重启后锁重新获取、两条记录被标 failed、新运行 ok；
5. 浏览器不可用（`RADAR_BROWSER_CHANNEL=chrome-does-not-exist`）：`fetch_runs` failed、`health=degraded`、`fail_count=1`、`next_fetch_at` 前进、文章数不变；恢复默认 channel 后 `health=ok`、`fail_count=0`；
6. 开关关闭 → 退出码 0（无操作）；来源停用 → 退出码 1 + 明确日志。

**默认状态**：开发库 `ads-policy-pages.enabled=false`，调度进程未启动 —— 没有为验证调度向开发库写入任何 Ads 数据。

## 四、P1：失败与登录恢复

- **失败路径**（Ads 实测）：浏览器缺失 → 失败可见（`fetch_runs.error`、`health=degraded`、`last_error`、`next_fetch_at`），**没有任何错误页/登录页入库**；恢复后自动回到 `ok`。
- **崩溃路径**（Ads 实测）：强杀后锁释放、遗留运行记录被下一次启动收口为 failed，任务继续。
- **登录**：Ads 页面公开，不存在登录态（每次新开浏览器、不带凭据）。单元测试保证登录墙 / 账号门户 / 404 页永远不能成为政策记录；Seller Central 这类登录页由 robots 拒绝且不在任何白名单内。**本主线不需要登录恢复，也没有引入登录依赖。**
- 公告/监管专用 Worker 的崩溃恢复沿用第五轮结论，本轮未重复演练（如实保留为未验收项）。

## 五、记录数量（开发库实测）

| 类别 | 条数 | 说明 |
|---|---|---|
| `platform_policy` | **3** | 2026-05-22、2026-02-03（列表可见）+ 2025-10-15 费用更新（`eligible=false`，既有池窗口规则） |
| `ads_policy` | **2** | 仍 `published_at=null`，`source_updated_at` 2026-07-22 / 2026-06-25 |
| `external_regulation` | **20** | CPSC 召回 15 + 联邦公报 5 |

## 六、验证

| 项 | 结果 |
|---|---|
| `npm run typecheck` | 通过 |
| `migration-safety` / `ads-policy` / `ads-policy-schedule` / `radar-policy` / `radar-source-compliance` / `radar-policy-backtest` / `radar-worker-sources` | **62/62** |
| `ads-policy-persist` / `source-updated-timeline` / `publication-date-correction`（DB） | **27/27** |
| 隔离库真实采集 + 调度演练 | 见第三节（首跑 2 条、二次 0 条、强杀恢复、失败恢复） |
| 真实 Chrome（开发库 3100） | 公告列表 2 条「发布于 2026-05-22 / 2026-02-03」；标签筛选 2 条；详情标题/来源/原文链接正确、生效日期「未确认」；刷新不变；Ads 列表仍 2 条「来源更新于 2026-07-22 / 06-25」；0 pageerror |

## 七、边界与遗留

- 未执行任何数据库迁移（`schema_migrations` 仍停在 0090）；两个隔离库（probe / ci）已删除，未污染共享模板或开发库。
- 未 Commit / Push / Merge / 部署；未启动或停止 `radar-announcements`。
- Ads 自动采集默认关闭，需两步启用（见 `CURRENT.md` NEXT 第 1 条）。
- 未验收：注销登录恢复、公告/监管 Worker 崩溃恢复（需真实会话与环境）。
- 既有失败与本轮无关：standalone 6 条（radar-core、sitemap-policy ×2、首页创始人、outbound-headers ×2）、部分数据库测试因 rule-only/付费路径不可用。
