# LightChoice Radar｜V1.2 Windows 本地运行闭环交付（2026-10-23）

> 范围：Amazon 美国站平台政策情报。人工录入保持取消；其他三条主线未实施；未部署、未 Commit。
> 状态文件：`docs/radar/CURRENT.md`（唯一权威，已原位更新）。

## 一、结论（回答十个问题）

1. **Windows 正常停止已实现并真实验证。** 之前监督器用 `child.kill("SIGTERM")`，在 Windows 上等于 TerminateProcess，子进程的收尾从未执行。现在监督器用 IPC 通知子进程，手工启动的进程用请求文件；**真实演练**：采集中途停止 40.6s（当前采集正常完成 `created=2` 后才退出），退避睡眠中停止 1.3s，锁释放、无重启。
2. **启动/停止/状态已有可操作入口**：`scripts/radar-ops.ts` 的 `status` / `start web|announcements|ads` / `stop ads|announcements`。
3. **避免重复进程与误杀**：身份以 PostgreSQL advisory lock 判定（不用 PID 文件）；无宽泛 `taskkill`；`--force` 只终止运行记录中的单个 PID 且需显式传入。重复启动实测被拒绝。
4. **Ads 仍默认关闭**：来源 `enabled=false`、`RADAR_ADS_POLICY_ENABLED` 未设、没有 Ads 进程常驻；`start ads` 走双门禁。
5. **公告 Worker 的失败恢复与任务状态有回归证据**：收口与 `recordCollectionRun` 未改，`worker-recovery` 5/5 复跑通过；本次只新增停止通道，并实测「未运行时 stop 是 no-op」。
6. **3000 验收结果**：公告列表 2 条（发布于 2026-05-22 / 02-03）、标签筛选 2 条；Ads 列表 2 条（来源更新于 2026-07-22 / 06-25）、Ads 详情显示来源更新时间且无「收录时间」；公告详情标题/来源正确、生效日期「未确认」；刷新一致；0 pageerror。
7. **修改的文件**：见第二节。
8. **仍需用户显式授权**：启用 Ads 来源与常驻调度、安装系统服务/开机自启、执行数据库迁移。
9. **记录数量**：`platform_policy` 3（2 条列表可见）、`ads_policy` 2、`external_regulation` 20 —— 未变。
10. **未解决的运行限制**：后台 detached 进程的存活受 Windows 控制台/作业对象影响（本 Agent 环境里父进程退出即被回收）；公告 Worker 的「停止时正在采集」未演练（该 Worker 未运行，且不允许擅自启动）。

## 二、修改

| 文件 | 改动 | 解决的问题 |
|---|---|---|
| `apps/worker/src/control.ts`（新） | 停止请求文件、运行记录、`watchStopRequest`；`RADAR_RUN_DIR` 可覆盖 | Windows 无信号可用 |
| `apps/worker/src/supervisor.ts` | 子进程以 IPC 启动；停止改为「先请求、宽限期后强杀」；监督器自身写运行记录；控制文件可关闭（测试用） | 停止只是杀进程 |
| `apps/worker/src/ads-policy.ts` | 停止只结束排期、当前采集跑完再退出；IPC 与请求文件两个入口；启动清陈旧请求；清理控制文件 | 停止丢运行记录/丢正文 |
| `apps/worker/src/radar-announcements.ts` | 同一停止通道（停队列、释放锁、关库、清理控制文件）；启动先清陈旧请求 | Windows 下公告 Worker 无法优雅停 |
| `scripts/radar-ops.ts`（新） | status（只读）/ start / stop；锁探测判活；重复启动拒绝；`--force` 单 PID | 没有可操作的本地入口 |
| `tests/worker-control.standalone.test.ts`（新） | 5 例：请求文件、watcher 只触发一次、运行记录、IPC 停止（子进程自己收尾）、请求文件停止监督进程 | — |
| `tests/worker-supervisor.standalone.test.ts` | 适配 `control:false`（测试不写真实控制文件） | — |

## 三、验证分层

**单元/进程级**
- `worker-control` 5/5：真实子进程收到 IPC `stop` 后执行自己的收尾并写 `start:stop`（不是被终止）；请求文件同样生效；陈旧请求在下次启动被清除。
- `worker-supervisor` 9/9 复跑通过（退出码契约、退避、止损、信号停止）。

**真实进程 + 隔离库（ci4，演练后删除）**
- 采集中途 `stop ads`：日志 `stop requested; the run in hand finishes first (inRun:true)` → `the Ads policy collection finished … ok found=2 created=2 ms=55613` → `stopping … inRun:false`；实例锁释放，耗时 40.6s。
- 退避睡眠中 `stop ads`：1.3s 完成（`inRun:false`）。
- 重复 `start ads`：拒绝（「已有 Ads 调度进程在运行」）。
- 停止后数据：`fetch_runs`/`job_runs` 均 ok（此前被强杀的运行在下次启动被标 failed），`health=ok`、`fail_count=0`，2 篇 Ads 记录 `published_at=null`。

**3000 浏览器（真实 Chrome）**：见第一节第 6 条，`.data/_diag/pw-round11.mjs`（BASE=3000）。

**类型与回归**：`npm run typecheck` 通过；生命周期相关 standalone 59/59；数据库定向 15/15。

## 四、ops 工具的边界

- `status` 只读：HTTP 探测 3000/3001，查询 sources/articles/fetch_runs/job_runs 与 advisory lock；不写库、不重启。
- `start` 三个目标互相独立；`start ads` 需 `RADAR_ADS_POLICY_ENABLED` 与来源 `enabled` 同时为真，否则打印确切的两步操作。
- `stop` 默认等待 180s；仍未释放锁时打印运行记录里的 PID 与手工命令；`--force` 只终止该 PID。
- 不安装服务、不设开机自启、不改 .env。

## 五、遗留

- 后台 detached 存活：本 Agent 环境里父进程退出后子进程被作业对象回收（实测），普通终端一般可存活；长时间运行建议前台 `npm run daemon:ads-policy`。已写入 BLOCKERS。
- 公告 Worker 的「停止时正在采集」未演练。
- 开发库仍 126 篇、三类数量不变；未执行迁移；ci4/ci5 已删除。
- 既有失败与本轮无关：standalone 6 条（radar-core、sitemap-policy ×2、首页创始人、outbound-headers ×2）；部分数据库测试因 rule-only/付费路径不可用。
