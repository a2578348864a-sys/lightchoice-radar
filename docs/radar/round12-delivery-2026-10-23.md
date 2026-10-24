# LightChoice Radar｜第一主线 V1.1 运行可靠性交付（2026-10-23）

> 范围：Amazon 美国站平台政策情报。人工录入保持取消；其他三条主线未实施；未部署、未 Commit。
> 状态文件：`docs/radar/CURRENT.md`（唯一权威，已原位更新）。

## 一、结论（先回答八个问题）

1. **Ads 异常退出后有真实可用的重启机制吗？** 本轮之前**没有**。`deploy.md` 假设 systemd/pm2，本机两者都没有，watchdog 的 `exit 1` 就是采集终点。本轮新增零依赖监督器（`apps/worker/src/supervisor.ts` + `ads-policy-daemon.ts`），并用真实子进程证明：失败→重启→再失败→按上限停止；配置错误/来源停用/主动关闭都不会触发重启。
2. **公告与外部监管 Worker 的崩溃恢复验证了吗？** 是。真实缺陷是它从不收口遗留 `running` 记录；本轮新增按范围收口的启动步骤，并在隔离库做了「植入遗留记录 → 启动 → 只收口自己的 4 条 → 正常采集 22 篇」的真实演练。
3. **公告漏读修复的边界有完整证据吗？** 有。抽出 `archiveWindowFloor()`，8 例覆盖窗口、首次导入、`x_search`、损坏的 `initializedAt`、门禁版本变化、损坏的 `detailGate`、去重与上限。
4. **修改了哪些文件、解决了什么问题？** 见第二节。
5. **验证到了哪一层？** 进程级（真实子进程重启/止损/停止）、数据库级（真实 `fetch_runs`/`job_runs`/`sources`、真实采集写入隔离库）、浏览器级（3000 上真实 Chrome，公告与 Ads 列表/详情/刷新）。见第四节。
6. **记录数量变了吗？** 没有：`platform_policy` 3（2 条列表可见）、`ads_policy` 2、`external_regulation` 20。
7. **仍未完成什么？** Ads 常驻未在开发库启用、监督器未装系统服务（均为边界要求）；注销登录恢复仍无法安全演练；Windows 无 SIGTERM。
8. **V1.1 达成吗？** 达成。唯一剩下的是部署动作，已写入手册留给部署方。

## 二、实际修改

| 文件 | 改动 | 解决的问题 |
|---|---|---|
| `apps/worker/src/supervisor.ts`（新） | 退出码语义（0/2/3/1）、有界指数退避、连续失败止损、信号转发与宽限期强杀、可注入日志 | 进程无人重启 |
| `apps/worker/src/ads-policy-daemon.ts`（新） | 以监督模式运行 `ads-policy.ts` | 提供「启动即常驻」的入口 |
| `apps/worker/src/interrupted-runs.ts`（新） | 按来源/任务名收口遗留 `running` 记录 | 崩溃后永久「运行中」 |
| `apps/worker/src/collection-run.ts`（新） | `recordCollectionRun`：采集失败 → job 失败 | `job_runs` 显示 ok 而 `fetch_runs` 全部失败 |
| `apps/worker/src/radar-announcements.ts` | 启动（持锁后）收口自己的遗留记录；日志带 `failureClass` | 同上，公告/监管侧 |
| `apps/worker/src/ads-policy.ts` | 接入收口与 `recordCollectionRun`；区分配置错误(2)/来源停用(3)/运行时(1)；单跑失败退出 1 | 退出码无法指导重启；任务记录不实 |
| `apps/worker/src/ads-policy-schedule.ts` | 移除重复常量（收口逻辑集中） | 维护性 |
| `apps/worker/src/instance-lock.ts` | 新增角色 `ads-policy` | 上一轮已加，本轮沿用 |
| `packages/backend/src/sources/collect.ts` | `failureClass` 七类 + 写入 `fetch_runs.detail` + 随结果返回 | 失败原因不可分类 |
| `packages/backend/src/sources/radar-policy-source.ts` | 新增 `archiveWindowFloor()` | 窗口/起始时间逻辑可测 |
| `apps/worker/package.json` | `monitor:ads-policy`、`daemon:ads-policy` | 本地启动方式 |
| `tests/worker-supervisor.standalone.test.ts`（新） | 9 例（含真实子进程） | — |
| `tests/worker-recovery.test.ts`（新） | 5 例（收口范围、幂等、job/fetch 一致性、skipped 不算失败） | — |
| `tests/policy-gate-memory.standalone.test.ts`（新） | 8 例 | — |
| `tests/collect-failure-class.standalone.test.ts`（新） | 2 例 | — |
| `tests/ads-policy.standalone.test.ts` | 去掉重复的门禁记忆用例（迁到专文件） | 去重 |
| `.env.example` | 监督器/调度开关说明 | 可操作性 |

## 三、关键实现说明

- **退出码契约**：`0` 正常结束（开关关闭、另一实例持锁）、`2` 配置不可用、`3` 来源停用、`1`/信号 运行时故障。监督器只对 `1` 重启。
- **退避**：进程内 1→2→4 倍采集间隔；监督器 30s→60s→…→30min（`RADAR_SUPERVISOR_MAX_FAILURES` 默认 6 次后停止），避免重启风暴。
- **收口范围**：`closeInterruptedRuns({sourceIds, jobs})`，只在取得 advisory lock 之后调用，天然不会误伤其他实例或其他来源。
- **任务一致性**：`recordCollectionRun` 把「返回 failed」转成 job 失败，同时把结果交回调度器用于退避与日志；`skipped`（停用/未批准）不算失败。

## 四、验证（分层）

**进程级（真实子进程，非模拟）**
- `tests/worker-supervisor.standalone.test.ts` 9/9：配置错误只启动 1 次；失败→成功共 3 次；持续失败 3 次后止损；来源停用不重启；SIGTERM 停止且不重启。
- 真实 `ads-policy.ts` 子进程：开关关闭 → 1 次启动、exit 0；来源停用 → exit 3 不重启；浏览器缺失（`RADAR_BROWSER_CHANNEL=chrome-not-installed`）→ 失败→重启→再失败→`stopped after 2 consecutive failures`、daemon exit 1。

**数据库级（隔离库 `lightchoice_radar_ci3`，演练后删除）**
- 植入 2 条 `fetch_runs` + 3 条 `job_runs`（含 1 条不属于本 Worker 的 job）→ 启动公告 Worker：日志 `closed run records … fetch:2 job:2`，本 Worker 的 4 条转 failed，`some.other.job` 保持 running；随后真实采集 22 篇（公告 2、CPSC 15、FR 3/2）。
- 失败分类与健康数学：`ENOTFOUND`→`network`、`127.0.0.1`→`blocked-address`、缺浏览器→`browser-unavailable`；`fail_count` 1/2/3、`health=degraded`、`next_fetch_at` = now + interval×(fail_count+2)（60 分钟源第三次失败后 +240 分钟）。
- `job_runs` 一致性修复前后对比：修复前 2 条 ok（错误），修复后 failed 且错误文本可读。
- `tests/worker-recovery.test.ts` 5/5、`ads-policy-persist` 4/4、`source-updated-timeline` 6/6、`publication-date-correction` 17/17。

**浏览器级（3000 唯一正式环境，真实 Chrome）**
- 公告列表 2 条「发布于 2026-05-22 / 2026-02-03」，新政策与标签可见；标签筛选 2 条。
- 详情：标题、来源、原文链接正确，生效日期「未确认」；刷新后不变。
- Ads 列表 2 条「来源更新于 2026-07-22 / 06-25」；Ads 详情显示「来源更新于」、不出现「收录时间」、原文链接存在。
- 0 pageerror。

**类型检查**：`npm run typecheck` 通过；本轮相关 standalone 累计 **70/70**，数据库 **32/32**。

## 五、边界与遗留

- 未执行迁移；开发库只做只读检查与既有采集链路（未写入测试数据）；未启用 Ads 来源、未启动 Ads 常驻；未启停其他 Worker；未 Commit/Push/部署。
- 隔离库 `lightchoice_radar_ci3` 已删除；`lightchoice_radar_probe`（上轮）也在上轮清理。
- 未验收：注销登录恢复；Windows 下的优雅停止（无 SIGTERM，靠退出 + 下次启动收口）。
- 开发库仍有 3 条 2026-10-20/21 的历史 `running` 记录，属于 `rss-wyze-community`（非本 Worker 范围），本轮按边界未清理。
- 既有失败与本轮无关：standalone 6 条（radar-core、sitemap-policy ×2、首页创始人、outbound-headers ×2）、部分数据库测试因 rule-only/付费路径不可用。
