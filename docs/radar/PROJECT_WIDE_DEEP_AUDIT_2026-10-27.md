# LightChoice Radar 全项目系统级深度审计报告

- 审计日期：2026-10-27
- 审计基线：master `2e52b157ae8c59f01cbde4b5a04cfe896ecfed1a`（与 GitHub 远程核实一致）
- 审计性质：**只读审计**。未修改任何业务源码、数据库、服务状态；唯一写入为本报告。
- 方法：真实源码追踪 + 正式库只读 SQL + 运行进程/心跳/job_runs 实测 + 隔离测试抽查 + 两个独立探查代理的外围盘点。所有 P0/P1 结论经对抗式复核；复核中被推翻的初稿结论已在第 10 节如实说明。

---

> **2026-10-27 P1-RELIABILITY-REMEDIATION 后续处理附注（不改动上文历史结论，只补充修复轮的实证修正）**
>
> 1. **P1-1 影响面修正**：修复轮数据核查发现，VOC 材料 = 仅 `voc-coffee-se` 的 30 篇（`articles.raw->'voc'` 非空）；两个社区 RSS 源的 100 篇文章 **零 VOC 标记**，与第三主线无数据关联——上文"VOC 的两个社区材料源停摆"表述有误。真实情况：VOC 增量通道按设计为"受管手动触发"（`scripts/voc-increment.ts`，非常驻、带授权守卫，10-25 刚运行过），**从未停摆**；停摆的是 AIHOT 通用 RSS 采集（其数据只喂被 lane 过滤排除的遗留通用池，四主线不消费），**决策：不恢复采集**（无业务消费者；恢复须重启全量 Worker，违反本轮边界）。
> 2. **P1-1 的三处子项修复结果**：3 条遗留 running 已用项目自身 `closeInterruptedRuns` 受管收口（failed + 审计原因，2026-10-27）；新增 maintenance Worker（`RADAR_WORKER_SCOPE=maintenance`，角色锁 7_204_229_010）接管 `ops.retention`（03:30）与 `ops.backup`（04:10）两个 cron 并在启动时收口"无专用 Worker 认领来源"的遗留 running；`start-radar.cmd` 默认启动顺序加入 [7/7] 维护 Worker。
> 3. **备份链路修复**：`ops.backup` 原注册条件为云端对象存储凭据（本机零云永不满足 → 本机从未有过自动备份）；现已支持本地备份模式（`RADAR_BACKUP_LOCAL`，默认开，dump 落 `.data/backups/` 本地保留 3 份），并修复两个本机故障：pg_dump/pg_restore 路径（`RADAR_PG_BIN` 约定）与 Windows tar（`--force-local`、无文件时不打包）。隔离恢复验证 PASS（48 表/265 篇/30 篇 VOC 材料对账一致）。
> 4. **锁常量归一**：`instance-lock.ts` 成为唯一权威（radar-ops/radar-local/radar-translate-state 全部改为导入）。
> 5. **测试缺口**：三处已修复（恒真断言改双向断言、live 探测失败时诚实 skip 不再冒充 PASS、并发测试改为真实的版本绑定+原子守卫验证）。

---

## 1. 总体审计结论

**项目整体健康，可以长期日常使用。** 没有发现阻止正常使用的关键问题，没有发现数据损坏或私有数据外泄路径。

- **已经成熟的部分**（有运行证据支撑，建议保持冻结）：四主线的来源准入与内容隔离、发布池状态机、采集运行记录与恢复、Worker 单实例锁体系、本机免登录门、运维启停脚本、测试隔离机制。
- **只是工程框架、尚无真实业务产出的部分**：第四主线市场信号的 12 模块（Amazon 核心商业数据资格受阻，处于诚实冻结态）、`modules/` 模块系统（空壳）、AIHOT 遗留的信息站页面群（日报/周报/话题/精选等）。
- **最值得注意的一个真实业务问题**：第三主线 VOC 的两个社区材料源（Home Assistant / Wyze）的自动增量采集自 2026-10-21 起停摆（详见 P1-1）。现有 130 篇材料完好，研究功能不受影响，但"自动增量"这一承诺对这两个源已失效。

---

## 2. 实际架构与数据流（实测梳理）

```
                        【第一主线 平台政策】
 RSS/网页 → 专用Worker(radar-announcements/fee/regulatory, 私有队列) ─┐
                        【第二主线 行业动态】                          │
 RSS → radar-industry(私有队列 sources.fetch-industry)              ├─→ ingest/collect 准入
                        【第三主线 消费者原声】                        │   (sources 表 enabled/
 社区RSS → 通用 sources.fetch【已停摆，见P1-1】                       │    admission/identity_key)
 受控导入 → /api/voc/import/apply(adminHandler+CSRF) → voc 隔离存储 ─┤        ↓
                        【第四主线 市场信号】                          │   articles/publications
 cpsc-product-recalls → radar-market Worker(60s轮询, 顾问锁)         │   (visibility/eligible/selected)
 Amazon商业源 → enabled=false 冻结，门禁在 forceAll 之前              │        ↓
                                                                    │   发布池 pool.ts(lane=policy 白名单)
 主Worker(PID 21068) = content-scope 翻译Worker(受控预算)             │        ↓
                                                                    ├── apps/api (3001, 仅回环)
 settings 表(jsonb) ←→ packages/backend 全部读写层                    │        ↓ SSR代理(vocGet/marketGet)
 fetch_runs/job_runs 运行审计 ←→ pg-boss(pgboss schema)              │   apps/web (3000, 仅回环)
                                                                    │        ↓ 浏览器(四主线 + admin)
```

职责边界实测结论：

- Web 不碰数据库（`apps/web/app/lib/api.server.ts:1-8` 注释与实现一致，SSR 仅经回环 HTTP 读 API）。
- API 无业务计算下沉前端；前端 `marketGet/vocGet` 是透明三态代理（401/503/数据）。
- Worker 无浏览器依赖（Playwright 仅在 ads-policy 子进程，默认关闭）。
- **未发现同一队列被两个进程重复消费的路径**：radar 源在入队时即路由到私有队列（`packages/backend/src/sources/collect.ts:589-599`）；通用 `sources.schedule` cron 自 10-21 后再无运行记录（全量 Worker 已安全退役，当前主 Worker 是 content-scope 翻译 Worker，见第 5 节）。
- 四主线数据相互隔离经实测确认：政策池 `lane=policy` 白名单过滤、VOC 走 `voc.*` 设置键、市场走 `market.*`，发布池 169 篇中无行业/VOC/市场数据混入（第 4 节数据验证）。

---

## 3. 关键状态机审计

### 3.1 采集状态机（fetch_runs）——VERIFIED（一处遗留例外）

合法状态：`running → ok | failed | skipped`（`0001_core.sql:47` CHECK 约束强制）。
- 崩溃恢复：每个专用 Worker 在**持有实例锁之后**收口自己 scope 的遗留 running（`apps/worker/src/interrupted-runs.ts:24-41`），不会误关存活实例的记录——设计正确。
- **发现的例外（P1-1）**：正式库现存 3 条 `rss-wyze-community` 的 running 记录已挂 6 天（started 2026-10-20T15:06/16:17/17:28）。原因：该源属于通用 `sources.fetch` scope，而全量 Worker 退役后无人收口；机制注释自述的"2026-10-20 三条遗留"正是这三条，修复后未回填。
- 禁用来源不执行、强制参数不绕过门禁：调度器第 1 步授权门禁在 `forceAll` 判定之前（`market-scheduler.ts`），且有 dryRun+forceAll 实测证据（三个禁用 CPSC 测试源全部 blocked）。
- 失败退避：`next_fetch_at = now + interval×(fail_count+2)`（上限 360 分钟），无风暴风险（CURRENT.md 运行手册与代码一致）。

### 3.2 内容发布状态机——VERIFIED

合法转换：发现 → 抓取 → 解析 → 准入（`eligible`，由 `isPoolEligible` 依据 participation_mode + relevance + title/summary 判定，`publish.ts:292-296`）→ 归并（fact/story）→ 分析 → 发布（`visibility='public'` + `releasedCondition`）。关键不变量：

- 谓词单一来源：所有"是否公开/上榜/选中"判断都从 `scope.ts` 取（文件头注释声明且实测无绕过）。
- 时间闸门：`selected` 内容须 `visible_after <= now` 才 released（`scope.ts:24`）——防"抓取时间冒充新事件"。
- 撤回不回流：`visibility<>'public'` 的 0 篇仍出现在公开池（正式库实测 0）。
- 版本可追溯：`publications.revision` + `article_revisions`（0090 迁移补 excerpt），identity_key UNIQUE 防重复（正式库 0 冲突）。

### 3.3 政策状态——PARTIAL

系统实际存在的状态是"白名单来源内的发布池条目"，没有独立的"线索→待核实→已核实→失效"显式状态机。AMZ123 政策线索被显式隔离（`amz123-policy-leads` 来源不入正式政策池，正式库该源 pubs=0），**线索未被提升为确定政策**（VERIFIED）。但这依赖"来源白名单"这一层边界，政策条目本身没有核实/失效生命周期字段——政策过期依赖新公告覆盖，无主动失效机制。如实评级：现有设计够用（政策情报以官方原文为准），但不是完整政策生命周期管理。

### 3.4 VOC 材料状态机——VERIFIED

入库（受控导入，adminHandler+CSRF）→ 许可检查（每材料 license/用途字段）→ L1 分类 → L2/L3 研究归并 → 人工复核（revision 乐观锁）→ 撤销传播（撤销后导入拒绝、下游回写被拒——`voc-lane.test.ts:141-148` 强断言覆盖）。测试还证明撤销批次并集、幂等导入（stored=2 → 再导入 stored=0）。

### 3.5 市场研究状态机——VERIFIED（冻结语义完整）

来源授权（enabled + permission.uses + automation）→ 观测（快照/事件）→ 信号（确定性规则）→ 候选（评分=研究优先级，缺供给/竞争证据时**拒绝总分**，`market-opportunity.ts:121`）→ 人工复核 → 预警/失效（证据版本变化自动 retire 预警，`:319`）。撤销传播：revoke 后导入拒绝、下游机会进复核（`tests/market-lane.test.ts:241-252`）。

### 3.6 Worker 生命周期——VERIFIED

启动 → 持会话级 advisory lock（六角色键 7_204_229_001..008，抢不到 exit(0) 防风暴，`instance-lock.ts:44-56`）→ 执行 → 双心跳（scoped Worker 文件心跳 10s/次；全量 Worker settings 心跳 1 分钟）→ 停止请求文件优雅关闭。停止链路经实测（radar-ops stop 优雅停止、killVerified 身份核验后才杀进程、不按名杀、PID 复用防护）。**机器睡眠/唤醒实测**：审计期间机器从休眠唤醒，全部 Worker 心跳 9 秒内自动恢复、cron 立即补跑（job_runs 44 秒前有新记录）——恢复能力有真实证据。

---

## 4. 业务语义与证据审计

结论先行：**未发现"把低可信数据当高可信事实"的实质混用**。关键的语义边界在代码与展示两层都有显式守卫：

| 概念边界 | 守卫证据 | 判定 |
|---|---|---|
| 政策线索 ≠ 确定政策 | `amz123-policy-leads` 隔离存储，正式池 pubs=0（正式库实测） | VERIFIED |
| 更新日期 ≠ 发布日期 | `published_at`（可信）与 `published_at_claim`（声称）分离，"声称未来>1h 拒绝"（`0001_core.sql:67-70`）；`source_updated_at` 独立字段 | VERIFIED |
| 排名位移 ≠ 搜索量增长 | `market-metrics.ts:223`："排名上升≠搜索量增长百分比"写进前端可见文案 | VERIFIED |
| 榜单排名 ≠ 实际销量 | `market-read.ts:47`："排名≠真实销量"；来源看板标注"榜单名次≠销量" | VERIFIED |
| 召回通告 ≠ 商业需求 | `market-scheduler.ts:258-260` 七段式解释含"严禁将召回通告推断为 Amazon 需求或销量上涨" | VERIFIED |
| 机会候选 ≠ 已验证商机 | `market-opportunity.ts:121` 缺证据拒总分；`:250`"评分=研究优先级，非成功概率" | VERIFIED |
| 社区讨论数 ≠ 独立消费者数 | VOC 每材料带 `authorRole`（提问/一手/转述），L2/L3 系统提示词强制"区分提问咨询、第一手使用经历与转述；接受答案不等于问题已解决"（`voc-l2l3.ts:64`） | VERIFIED |
| AI 解释 ≠ 来源事实 | VOC 模型通道关闭（`voc-read.ts:138` "closed ¥0 authorisation"）；翻译文本标注"机器翻译·未经人工核对"；`MODEL_CALLS_ENABLED=false` | VERIFIED |
| 手工假设 ≠ 真实成本 | 计算器页声明"所有输入均标注口径（真实报价=证据值；预估=假设值）……纯前端数学运算，零 API 调用"（`market-opportunities.tsx:190`） | VERIFIED |

时间字段实测含义（articles 表）：`published_at`=可信来源发布时间（未知或不可信时为 NULL）；`published_at_claim`=来源声称值；`discovered_at`=抓取发现时间；`source_updated_at`=来源侧更新；`timeline_at`=排序值（默认发现时间，回填历史时用来源时间并打 `backfill=true` 标记）；`visible_after`=发布闸门。**旧内容修改不会被提升为新事件**（timeline 语义 + backfill 显式标记），证据引用经 `fact_articles` 绑定，无"证据指向错误版本"的代码路径。

---

## 5. 分层审计摘要

### 数据库（只读实测）

- 约束规模：30 FK + 9 UNIQUE + 325 CHECK；`fetch_runs.status`、`body_status` 等枚举有 CHECK 强制。
- 引用完整性：publications→articles/sources 悬空 0；identity_key 重复 0；撤回后仍公开 0。
- 运行记录：job_runs 覆盖全部队列执行（15 条队列 + 全部 cron），job 与 fetch 运行审计完备。
- 唯一脏数据：3 条 6 天前的遗留 running（P1-1）。未发现测试数据混入正式库（测试库由 `_test/_ci` 硬门禁隔离，`tests/setup.ts:13-15`）。
- 迁移：67 个，0090 后全部增量（0091 CREATE TABLE、0092 UNIQUE INDEX），无危险 drop/rename。

### API 与契约

- 14 个路由文件；radar 新增路由（voc/market/site/industry）全部经 `adminHandler`（会话或本地个人模式门），写操作强制 CSRF。
- 三态错误映射（`api.server.ts`）+ 前端对应渲染（`WorkspaceAuthGate.tsx:45-59`：503 显示"后端服务暂不可达"而非空数据）——"失败伪装成无数据"缺陷不存在（VERIFIED）。
- 废弃接口清理已验证（import/csv、chart、preview 404）。
- 类型同步风险：`contracts` 包类型为手工声明，与后端响应无编译期绑定——类型漂移靠测试兜底，属可接受债务（P2）。

### 前端

- 全量路由盘点完成（agent 报告）：四主线 12 页 + 主线附属 + AIHOT 遗留页面群 + admin 15 文件。四主线页面经多轮真实 Chrome 验收（28/28、27/27、8/8），本轮 8/8 复核通过。
- 遗留页面（hot/daily/weekly/topics/starred/agent 等）仍在导航中展示（`nav.ts:14-51`），有历史数据支撑、无安全风险，但与"四主线情报中心"定位混杂（P2，见第 9 节保留建议）。

### Worker 与长期运行

- 队列 15 条 + 14 个 cron，pg-boss 单例键防重复入队；专用 Worker 六角色锁 + 双心跳。
- **长期运行风险点**：①磁盘/日志增长由 `ops.retention`（每日 03:30）与 `ops.backup`（04:10）cron 管理，但二者属于全量 Worker scope——**当前没有全量 Worker 在跑，保留与备份任务自 10-21 起未执行**（与 P1-1 同根）。②PG 硬编码路径有 env 覆盖口。③三处锁常量手抄（P1-2）。

### 安全

- 免登录门双校验（socket 对端 + Host）有 9/9 隔离测试与正式实例实测（伪造 Host 401、无 CSRF 403、LAN 拒连）。
- `/api/ingest/items`：constant-time Bearer 令牌 + 占位符拒绝 + 可选限速（`ingest.ts:12-22`）——不是无鉴权写路径；当前无调用方（兼容保留）。
- CORS：未配置任何 CORS 头（无通配符开放）。
- 日志：fastify redact authorization/cookie（`app.ts:38-40`）。
- `.env` 未跟踪；`.data/`、截图、备份均在 Git 忽略中（推送前扫描已复核）。

---

## 6. 本机免登录的真实安全边界（如实说明）

`RADAR_LOCAL_PERSONAL_MODE` 的边界是**网络位置信任**，不是身份认证：

1. **它信任的**：TCP 连接来自 127.0.0.1/::1 且 Host 头是本机回环名。浏览器同源路径 + CSRF 令牌 + DNS 重绑定防御（伪造 Host 401）+ trustProxy 下不信任何转发头——**恶意网页无法跨站读写私有数据**（有测试与实测证据）。
2. **它不防的（必须如实告知）**：**本机上运行的任何其他程序**都可以直接连 `127.0.0.1:3001` 读到 VOC 与市场全部数据（GET 无需凭据）。这是该模式的设计定义，不是漏洞——单用户个人电脑的常规威胁模型（本机恶意软件）本来就已超出应用层防御能力。若电脑上有不可信软件运行，应关闭该开关（`.env` 删除一行即回到会话保护，测试已证明关闭即恢复）。
3. 防护保留完整：写操作 CSRF、来源许可门禁、调度互斥锁、危险按钮二次确认全部实测有效。
4. 生产环境代码强制关闭该模式（`config.ts` localPersonal 定义）——云端部署不会意外免登录。

---

## 7. P0/P1/P2 问题清单

### P0（必须优先处理）

**无。** 未发现数据损坏、私有数据外泄、未授权采集、错误事实进入正式情报或状态失控的现存问题。

### P1（值得近期处理）

**P1-1 通用 RSS 采集链停摆 + 遗留 running 记录**
- 模块：apps/worker（全量 scope 退役）/ packages/backend/src/sources
- 证据：`sources.schedule` cron 最后运行 2026-10-21 14:43（job_runs 实查）；`rss-home-assistant-community` 最新文章 2026-10-21 14:14、`rss-wyze-community` 2026-10-21 10:44、next_fetch_at 停在 10-21（正式库实查）；3 条 wyze running 挂 6 天。
- 触发条件：radar-local 启动体系只拉起 4 个专用 Worker + content-scope 翻译 Worker，没有任何进程负责通用 RSS 源。
- 实际影响：第三主线 VOC 的两个社区材料源不再自动增量（受控导入通道正常）；运维页会永远显示"采集进行中"的假状态；`ops.retention`/`ops.backup`（同属全量 scope）自 10-21 未执行——日志与备份停止增长/生成。
- 是否复现：是（只读实查）。
- 建议最小修复（三选一，按成本递增）：a) 一次性 SQL 收口 3 条遗留 running 并跑一次 retention；b) 让 content-scope 主 Worker 启动时顺带收口通用 scope 的遗留 running；c) 为社区 RSS 建专用小 Worker（同 radar-industry 模式）。注意这两个源属于"VOC 材料"语义，修复方案应与 VOC 材料策略一起决定。
- 修复风险：低；不影响冻结基线。
- 备注：需先确认这两个社区源在 Radar 中是否仍要自动增量（业务决定），再决定修到什么程度。

**P1-2 锁常量三处手抄**
- 证据：`scripts/radar-ops.ts:47`（一行六角色）、`scripts/radar-local.ts:39-42,660`（分散常量）、`packages/backend/src/operations/instance-lock.ts`（权威定义）。
- 影响：新增/修改角色锁时漏改副本会导致启停脚本与 Worker 用不同锁键——锁失效或误判。当前数值核对一致，暂无实际错误。
- 建议最小修复：radar-local/radar-ops 改为 import instance-lock.ts 的常量表。修复风险：极低。

**P1-3 测试有效性缺口（三处，agent 盘点 + 本人抽查核实）**
- `tests/voc-lane.test.ts:82`：`assert.ok(l1.needsReview || true)` 恒真断言，形同虚设。
- `tests/market-lane.test.ts:775-810`：CPSC live 探测在 catch 中把网络错误（fetch failed/ECONNRESET）也算通过——断网时该测试永不失败，"真实连通"从未被证明（本机 SSRF 守卫本就拦截 cpsc.gov，该测试长期只能输出 BLOCKED_BY_NETWORK）。
- `tests/voc-lane.test.ts:158-171`："并发变化"测试实际未触发 REVIEW_REQUIRED 竞争路径（staleRevision 模拟是空操作），测试名与覆盖不符。
- 影响：三类都是"测试给出虚假信心"；核心业务断言总体仍是强断言（market-lane 38 测 205 断言、失败路径覆盖广），故评 P1 而非 P0。
- 建议最小修复：删恒真断言并补真实 needsReview 断言；live 探测改为"仅当能成功 fetch 时才校验内容，否则显式 skip 并打印原因"；并发测试要么真造竞争（两个 revision）要么改名。

### P2（以后再处理）

- **P2-1 本机其他进程可读私有数据**：免登录模式的定义使然（见第 6 节）。处置：文档已有说明即可；不建议为此加认证。
- **P2-2 AIHOT 遗留 UI 面**：hot/daily/weekly/monthly/topics/starred/agent 等页面仍在主导航；modules/ 为空壳注册表（`site/modules/index.ts:6` 三处空数组）。无风险，但扩大维护与理解成本。建议：下轮迭代把主导航收敛到四主线 + 必要工具页（属界面决策，需单独授权）。
- **P2-3 `/api/ingest/items` 与若干一次性脚本无调用方**：agent.ts 公开 API、feeds.xml 系列、mcp.ts 的外部调用方无法确认。保留成本低（只读或带令牌），暂不动。
- **P2-4 心跳双体系并存**：settings `heartbeat.worker` 停在 10-24（旧全量实例所写，无人清理），scoped 心跳走文件。会误导按 settings 判活的诊断。修复可并入 P1-1 的收口。
- **P2-5 旧端口心跳残留**：`heartbeat.api:3011/3012/3101` 历史记录（10-22/25）无清理路径。同上。
- **P2-6 contracts 类型为手工声明**：与响应无编译期绑定，靠测试兜底。

---

## 8. 修复建议与执行顺序（最小必要）

1. **先做业务决定（用户）**：社区 RSS 两个源是否还需要自动增量？（P1-1 的前置）
2. **P1-1**：收口 3 条遗留 running + 恢复/接管 retention·backup（或确认接受手动化）。
3. **P1-2**：锁常量归一 import（半小时级，低风险）。
4. **P1-3**：三个测试缺口的小修（不动核心断言）。
5. P2 项按需，不设期限。

不建议：重构导航（等界面决策）、清理 AIHOT 遗留页面（有历史数据与 SEO 价值）、删除 modules/ 空壳（成本高于收益）、给本机模式加认证（违背免登录目标）。

---

## 9. 不建议修改的部分（防止后续 Agent 推翻已验证成果）

1. **发布池谓词单一来源**（`scope.ts`）与 `RADAR_POLICY_SOURCES` 白名单——已验证零漏杀、零混入，是四主线数据隔离的根基。
2. **articles 时间字段体系**（claim/trusted 分离 + backfill 标记）——语义审计确认无日期混淆，改动会破坏历史数据语义。
3. **Worker 锁+心跳+运行记录三重身份与 interrupted-runs 收口机制**——设计正确，只需补 P1-1 的 scope 缺口。
4. **本机免登录门**（socket + Host 双校验，生产强制关闭）——9/9 测试 + 多轮实测，不要"加固"成复杂认证。
5. **市场第四主线的诚实冻结**（门禁在 forceAll 之前、候选拒总分、语义守卫文案）——这是产品可信度的核心，不要为"看起来完整"放松。
6. **测试隔离体系**（`_test/_ci` 硬门禁 + per-file 模板拷贝）——199 个测试文件从未污染正式库。
7. **运维脚本的身份核验杀进程与优雅停止**——Windows 下实测可靠，不要简化成按名杀进程。

---

## 10. 审计覆盖率与未验证项

**完成检查（有证据）**：
- 目录：apps/api（14 路由文件全量清单+关键路由精读）、apps/web（全路由盘点+关键 loader/组件精读）、apps/worker（全部入口+队列注册+锁心跳）、packages/backend（publication/market/voc/sources/operations 核心文件）、packages/contracts（结构）、site（导出与使用面）、database/migrations（全部 67 个的类别与 0001/0089-0092 精读）、tests（全量清单+3 个核心文件抽查）、scripts（36 个全量盘点）。
- 核心调用链：来源入队→私有队列→collectSource→准入→发布→pool/lane 过滤→SSR→页面；VOC 导入→许可→分类→撤销传播；市场授权→调度→候选→预警→撤销传播；免登录判定矩阵；Worker 启动→持锁→心跳→停止。
- 运行证据：正式库 8 项只读完整性检查；6 个进程实测；心跳/beat 文件实测（含睡眠唤醒恢复）；job_runs 全量分布。
- 来源：静态源码 + 运行证据混合标注于各节。

**对抗式复核中被推翻的初稿结论（如实记录）**：
- 初稿曾记录"全部 Worker 心跳停摆 8 小时、疑似僵死"——复核发现是审计者时区误读（beat 存 UTC，mtime 为本地 +0800，实际 9 秒前）。**该结论撤销**；反而获得了睡眠唤醒自动恢复的真实证据。
- 初稿曾怀疑 `/api/ingest/items` 是无鉴权写入接口——复核证实有 constant-time 令牌校验。降级为 P2-3。
- 初稿曾把"4 个 CPSC 测试来源"当既定事实——复核证实其中 1 个（cpsc-product-recalls）是正式来源（收口轮已纠偏，本轮数据再次确认）。

**未验证/受限项（不得当作已验证）**：
- 未重新联网验证任何来源的当前可达性与内容质量（任务书明确不要求）。
- 未逐行审读 428 个文件中的全部第三方依赖与 AIHOT 历史页面实现细节（按优先级抽查）。
- mcp.ts / agent.ts / feeds.xml 的**外部**调用方无法从本机确认（UNVERIFIED，非 FAILED）。
- 备份恢复的实际可用性（`ops.backup` 自 10-21 停跑，现有备份文件的恢复演练属上轮 verify-backup-restore 的历史证据，本轮未重做）。
- Windows 服务化/开机自启仍不存在（已知设计限制，长期无人值守需部署方托管）。
