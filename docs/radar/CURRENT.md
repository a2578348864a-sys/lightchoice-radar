> 唯一任务状态文件。事实优先级：实际代码与运行证据 → Git 状态 → 当前任务授权 → 交接记录 → 历史报告。
> 最后更新：2026-10-27（**FINAL-LOCAL-CLOSEOUT 最终工程收口 = PASS**。①**CPSC 测试来源精确清理（唯一正式库写入）**：只读盘点 14 个市场来源，以代码引用+数据归属+业务 notes 三重证据确认 **3 个测试来源**（cpsc-test-source、cpsc-autorun-source、cpsc-real-verify-source；业务代码零引用、label 明示测试/验证、runCount 1-2、notes 空），纠正上一轮"4 个"的说法——**cpsc-product-recalls 是正式来源**（runCount=10、正式业务 notes、调度器默认绑定，保留不动）；停用前完整快照存 `.data/_diag/closeout-backup/`（不入 Git），事务内 `jsonb_set` 仅改 enabled 字段（runCount/许可/历史/调度时间全保留），非撤销语义（revokedAt 保持空）；数据基线前后对比零变化（VOC 130 篇、安全事件 3、预警 43、政策池 125）；dryRun+forceAll 验证三来源在调度器全部 blocked（强制参数不可绕过）、正式来源正常待执行。②**来源看板真实性修复**：发现已禁用来源在台账中仍显示"已授权周期运行"徽章（徽章只看 automation 不看 enabled），最小修复为禁用状态优先显示"已停用（不再自动调度）"，热更新后实测生效；"已获准自动运行"计数 5→2 与数据库一致。③**免登录与安全边界复核**：免登录读 200、伪造 Host 401、无 CSRF 写 403、Web/API 仅监听 127.0.0.1（0.0.0.0 监听 0 条）；四主线快速浏览器复核 8/8（导航、政策纯净、行业内容、VOC/Market 免登录、刷新持久、来源看板诚实状态、0 严重错误）。④**市场 Worker 状态如实记录**：主 Worker 与 amz123/公告/行业三个专用 Worker 正常运行，市场专用守护进程当前未运行（冻结状态调度仅手动诊断触发，页面诚实显示"未运行"）；停用操作无并发冲突。⑤**GitHub 同步**：按授权完成推送前安全扫描后快进推送 master 至私有仓库并核实远程 SHA 一致。**边界保持**：新增费用 ¥0；未触碰 3010/Worker/PG；历史数据零删除。）
> 最后更新：2026-10-27（**LOCAL-FIRST-NO-LOGIN 第三/第四主线取消管理员登录、本机免登录个人模式与真实浏览器验收 = PASS**。用户确认这是本人电脑上的单人本地情报中心，第三/第四主线日常使用不应要求管理员密码。①**安全本地个人模式落地**：新增 `RADAR_LOCAL_PERSONAL_MODE` 配置开关（`packages/backend/src/config.ts`，Radar 专属 + 生产环境代码强制关闭），`apps/api/src/routes/admin-auth.ts` 的 `adminHandler` 在无会话时增加请求级回环校验回退主体——TCP 对端必须是本机回环地址（`req.socket.remoteAddress`，`trustProxy` 开启下不信任任何可伪造代理标头）、Host 必须为本机回环主机名（防 DNS 重绑定）。`.env` 启用该开关（不入 Git），`.env.example` 补充说明；`/api/auth/check` 与登录/登出路径不受影响。②**第三/第四主线免登录**：VOC 与 Market 全部路由本机直接可用（总览/证据库/原始讨论展开/痛点研究/来源历史/市场 12 模块/关键词/商品/机会/计算器/预警/来源看板），`WorkspaceAuthGate` 无 401 不再触发（组件保留供其他部署形态），不再出现登录墙或"服务不可用"假态；CSRF 令牌经 `/api/admin/me` 继续自动下发，写操作保护不变。③**保留的保护全部实测**：无 CSRF 写请求 403（缺/错令牌）、跨站表单形态拒绝、伪造 Host 401、局域网地址连接被拒（Web/API 均仅监听 127.0.0.1）、来源许可门禁与调度互斥锁不变（`market-lane.test.ts` 38/38）、管理员会话登录路径复验 28/28。④**隔离测试与回归**：新增 `tests/local-personal-mode.test.ts` 9/9（回环放行/局域网拒绝/Host 拒绝/CSRF 强制/合法写成功/跨站拒绝/模式关闭即恢复原保护，fastify.inject + 隔离库）；回归 market-lane + voc-lane + admin-session-revocation 75/75；backend/api/tests 三包 tsc 0 错误。⑤**正式实例生效**：API 3001 经身份核验（PID 56836 = 本项目 apps/api/src/main.ts）后有序重启一次（新 PID 40784），Web 3000 热更新无需重启，Worker 与 PostgreSQL 未触碰。⑥**无 Cookie 真实 Chrome 验收 27/27 PASS**（`scripts/verify-local-personal-no-login.ts`，全新上下文零 Cookie 零密码零注入，截图存 `.data/_diag/shots-local-personal/`）：四主线导航、前两主线回归、VOC 四页免登录含证据库原始讨论展开、市场六页免登录含纯前端计算器演示与危险按钮二次确认、刷新持久、伪造 Host/CSRF/局域网三项安全实测、移动端 390px 免登录、0 严重控制台错误 0 页面异常。**边界保持**：新增费用 ¥0；未触碰 3010 与 Worker；未修改正式业务数据；未 git push。免登录语义仅限本机回环，不代表可公开部署。）
> 最后更新：2026-10-27（**FOUR-LANE-FINAL-ACCEPTANCE 四主线正式运行核验、真实 Chrome 深度验收与最后缺陷收口 = PASS**。①**现场恢复与版本核查**：到场时 API 3001 掉线（Web/Worker 均在），用项目运维入口 `radar-ops.ts start api` 补起（PID 56836，标准启动路径，未重启任何既有进程）；实测 3000 开发模式热更新运行当前工作区代码（新确认弹窗文案在真实浏览器可见）、3001 加载新代码（`lane=policy` 过滤生效、已删接口 import/csv·chart·preview 返回 404、keywords 只读视图匿名 401、匿名 POST run-due/revoke 均 401）。②**政策白名单零漏杀核查**：对照数据库 20 个来源逐一核对，`RADAR_POLICY_SOURCES` 7 个白名单来源恰好覆盖全部官方政策/监管来源（listed 25 篇），行业与社区来源按设计不入政策池；无 lane 旧 API 兼容行为一致；伪造 lane 参数无法绕过分类限制。③**第四主线调度安全核查**：确认授权门禁（enabled + authorized-periodic）在 `forceAll` 判定之前生效，阻断/待凭据来源（sp-api、google-trends、external-platforms）无法被强制执行绕过；撤销来源打 `revokedAt` 标记且导入拒绝；锁获取异常/竞争返回 blocked 不执行；隔离库 `market-lane.test.ts` 38/38 通过；本机 SSRF 守卫继续拦截 www.cpsc.gov（fail-closed，诚实标注 BLOCKED_BY_NETWORK）。④**唯一代码修复**：`market-sources.tsx`「强制重算全部来源（诊断用）」按钮补二次确认弹窗（对齐撤销按钮交互），Playwright 实测点击后弹窗出现、取消后零调度请求发出。⑤**浏览器验收升级为 28/28 PASS**（`scripts/verify-browser-four-lanes.ts`，截图 22 张存 `.data/_diag/shots-four-lane-final/`）：新增 1920px 桌面、政策来源筛选/关键词搜索/真实政策详情（Costway 召回记录 + 5 个 CPSC 原文外链 + 发布日期）、VOC 三子页与市场三子页面包屑、面包屑一键返回、刷新后会话保持、强制重算确认弹窗取消、真实 404 状态、浅色主题确认；保留原四主线导航、匿名门禁、移动端 390px 底栏、Console/pageerror 全绿。⑥**遗留（需数据侧授权，本轮不动正式库）**：开发库 settings 中 4 个 CPSC 测试遗留源（cpsc-test-source 等）仍为 enabled+authorized-periodic，会随调度真实访问 CPSC 流（事件按 guid 幂等去重，无数据污染，但属测试残留配置）；前端确认弹窗已降低误触发风险。**边界保持**：新增费用 ¥0；未触碰 3010；未重启正式 Web/Worker；未修改正式业务数据；未 git push。）
> 最后更新：2026-10-27 02:45（**FULL-PROJECT-AUDIT-AND-REPAIR 轻选情报中心全项目深度审计、四主线前端整合、真实业务修复与 Chrome 验收 = PASS**。用户授权执行全项目深度审计与前端整合修复，彻底打通四主线用户入口与真实业务闭环。主要成果：①**四主线工作台与全端导航彻底整合**：重构 `apps/web/app/components/shell/nav.ts` 与 `apps/web/app/routes/more.tsx`，桌面端侧栏主导航显式呈现「四条主线」顶级入口（01 平台政策 `/all`、02 行业动态 `/industry`、03 消费者原声 `/voc`、04 市场信号 `/market`），移动端呈现标准 5 标签底栏（情报 `/`、政策 `/all`、行业 `/industry`、市场 `/market`、我的 `/more`），`/more` 新增四主线卡片下钻，全主线子页面统一部署语义化 `<nav aria-label="面包屑导航">` 与一键回溯链路；②**第一主线政策内容边界严格隔离（根因修复）**：修复 `packages/backend/src/publication/pool.ts` 与 `apps/api/src/routes/site.ts`，新增 `RADAR_POLICY_SOURCES` 白名单与 `policyCondition(lane)` 门禁，`/all` 页面载入时传递 `lane="policy"`，仅包含亚马逊官方卖家政策/费用/公告及美国联邦监管召回（CPSC/FTC），彻底排除 Home Assistant 与 Wyze 智能家居社区求助讨论；社区讨论材料严格保留于数据库中供第三主线 VOC 作为消费品原声专用；③**私有工作台错误透明化与鉴权统一拦截**：重构 `apps/web/app/lib/api.server.ts` 中的 `marketGet` 与 `vocGet`，返回三态 `{ data, error: 'UNAUTHORIZED' | 'SERVICE_UNAVAILABLE' | 'NOT_FOUND', status }`，彻底解决遇 401/500 静默吞没为“暂无数据”或“服务异常”的缺陷；新建 `WorkspaceAuthGate.tsx` 公共组件，未登录访客访问 VOC/市场私有工作台时清晰展示管理员权限拦截引导与本地零云端运行说明，并提供一键跳转 `/admin/login`；④**第四主线调度并发互斥锁健壮性修复**：修复 `packages/backend/src/market/market-scheduler.ts` 在获取 PostgreSQL 顾问锁（`7204229009`）异常时未阻断直接执行的并发漏洞，确保无锁阻断退出；修复 `market-sources.tsx` 前端触发按钮，默认触发到期来源，并新增独立的「强制重算全部来源（诊断用）」按钮；⑤**废弃手工导入后端遗留接口清理**：彻底移除 `apps/api/src/routes/market.ts` 中废弃的 `/api/market/import/csv`、`keywords`、`chart`、`preview` 等端点，保留内部自动化标准化函数；⑥**全栈质量与真实 Chrome 浏览器全链路验收**：全仓 `npm run typecheck` 0 错误；Playwright 真实 Chrome 浏览器全流程端到端自动化验收 **14/14 PASS**（涵盖 1440px 桌面端四主线导航、政策内容纯净性、行业动态正常、VOC 与市场匿名 401 拦截卡片、管理员会话下 VOC 研究面板与证据库面包屑、市场总览 12 模块板与 CPSC 安全反证、机会研究与三情景计算器、来源看板双态触发按钮、移动端 390px 底部 5 标签与 `/more` 四主线卡片、移动端全页面零横滚溢出、控制台 0 严重错误、页面 0 未捕获异常）。**边界保持**：本地运行，新增费用 ¥0，零调用付费大模型，不买云服务器，前三主线正式业务数据与配置绝对保护，未触碰 3010 独立工作台；严禁 git push，本地精准提交。）
> 最后更新：2026-10-27 01:45（**第四主线 MARKET-FREEZE-01 事实纠偏、工程冻结与 GitHub 安全交付准备 = 阶段冻结**。完成了对第四主线核心数据通道的关键事实纠偏、工程成果锁定、前三主线运行保护与 GitHub 同步安全审查。主要结论：①**关键事实深度纠偏**：彻底推翻“买个专业卖家账户填上凭据就能自动获得全部 Amazon 数据”的极化说法；查实 SP-API 为细分 RBAC 角色体系，Catalog Items 的 `salesRanks` 仅为单品分类排名而**非类目畅销榜（BSR）**；Brand Analytics 搜索词频率报告**必须具备合法注册商标并通过 Amazon Brand Registry 品牌备案**；PA-API v5 已被官方正式废弃关闭端点，接替者 **Creators API 门槛收紧至过去 30 天 10 单考核，且协议明文禁止用于建立内部商业情报库与价格历史数据库（限24h缓存）**；Keepa API 最低 €49/月且无免费版；Google Trends 仅为 0~100 宏观指数。②**CPSC 真实运行状态澄清**：明确 CPSC 为产品安全避坑反证，绝非热卖选品数据；澄清 `CPSC_SYNTHETIC_E2E = PASS`，而 `CPSC_LIVE_SOURCE_FETCH = BLOCKED_BY_NETWORK`（本机 SSRF 守卫拦截 `Blocked private address`，坚决不关闭防护，保持 fail-closed），`CPSC_NATURAL_OPERATION = NOT_VERIFIED`。③**第四主线阶段性工程冻结**：保留已有 12 模块代码、权限门禁、数据模型、历史观测、Worker 调度、顾问锁排他与前端诚实看板；暂停新增功能开发；正式标记为 `MARKET_ENGINEERING = FROZEN_WITH_LIMITATIONS`、`AMAZON_CORE_DATA = BLOCKED_BY_SOURCE_ELIGIBILITY`、`AMAZON_MARKET_NATURAL_OPERATION = NOT_STARTED`、`R7_CLOUD = DEFERRED_BY_USER`。④**前三主线绝对保护**：第一主线政策、第二主线行业、第三主线原声完全不受影响，服务与 Worker 稳定运行，3010 零触碰。⑤**GitHub 同步安全核查**：本地领先 14 笔提交经全量审查，无 `.env`、无真实密钥、无私有数据、无 DB 备份，状态安全受控；严格遵守安全红线，本轮未执行 `git push`。）
> 最后更新：2026-10-27 01:15（**第四主线 MARKET-DATA-FIRST 数据突破核查与最小业务决策 = 纠偏闭环**。落实“先数据、后开发、真实验证、停止空功能建设”原则，完成五大核心维度（商品信息、搜索需求、商品热度与榜单、价格变化、新品竞争）的 2026 最新官方条文和实测核验。主要结论：①**SP-API 官方能力与资质门禁（硬约束）**：SP-API Catalog Items (v2022-04-01) 官方支持全市场 ASIN 目录、属性、分类与 salesRanks（BSR 销售排名）；Brand Analytics 官方支持周/月搜索词频率排名报告（ABA）。但 Amazon 官方政策明文规定：**个人卖家计划（Individual）严禁开通 SP-API 开发者账号**，必须升级为每月 $39.99 的专业卖家计划（Professional Plan），且 Brand Analytics 必须持有注册商标并完成 Amazon Brand Registry 品牌备案。当前用户在零额外预算前提下被评定为 `ACCOUNT_GATED`。②**PA-API 5.0 用途明文禁止与考核门禁**：官方 PA-API 5.0 需 180 天 3 笔推广订单考核，且其协议明文规定**最长仅允许 24 小时缓存，严禁用于建立商业情报库、竞品追踪与价格历史数据库**，评定为 `NOT_SUITABLE`。③**Keepa 等第三方商业 API 无免费套餐**：Keepa API 最低套餐 €49/月（约合人民币 380 元/月），无免费版，违背 ¥0 预算红线（`PAID_REQUIRED`）。④**停止无关空功能建设**：坚决停止在缺乏合法真实数据时继续新建空适配器、空页面或伪造假商机；系统保持诚实空态；全仓 typecheck 0 错误；形成《Amazon 美国站核心市场数据获取决策表与准入阻塞报告》（10 大来源、18 维度矩阵）；为用户清晰提供 3 个具体现实选择。**边界保持**：R7 云端保持 DEFERRED_BY_USER；R8 本地自然运行保持 NOT_STARTED；正式库零写入；DeepSeek 调用 0 次（¥0）；外部商业服务采购 ¥0；Git 遵守本地精准提交，绝不 git push，绝不 git add .。）
> 最后更新：2026-10-27 00:30（**第四主线 AUTO-TRUTH 真实自动化验真、Amazon 数据源突破与本机工程收口 = PASS**。完成了定向核实、消除虚假在线、CPSC 双模式真实验真、Amazon 数据源严谨事实纠偏与真实浏览器验收。主要成果：①**CPSC 真实自动化与双模式严格拆分（拒绝虚假 PASS）**：将此前混杂 mock 的 E2E 脚本彻底重构成 `SYNTHETIC_E2E` 与 `LIVE_SOURCE_E2E` 两个独立分支。实测离线合约断言 `SYNTHETIC_E2E = PASS`（单 Run ID / Worker PID 贯穿、browseNodeId 显式为 null、7 段式中文解释、0 商机泄漏、二次运行 100% 幂等跳过、带 admin 会话 API 200 查询）；实测外发公网 `LIVE_SOURCE_FETCH = BLOCKED_BY_NETWORK`（13ms 阻断，原因 `Blocked private address for www.cpsc.gov`，本机 SSRF/DNS 防护生效），执行零合成回退策略，如实判定 `LIVE_SAME_RUN_E2E = BLOCKED_BY_NETWORK`，绝不混淆概念。②**消除看板与前端「虚假在线」与资质提示**：修改 `apps/web/app/routes/market-sources.tsx`，调度器徽章与状态精准显示为「● 后台调度器在线 (PID 56520) · Amazon 核心源未启用」，明确提示当前 Worker 仅周期轮询公共安全流，Amazon 核心商业数据源保持受控安全阻断，不给用户 Amazon 正在实时监控的错觉；零手工文件上传入口。③**Amazon 核心数据源 7 层状态事实纠偏**：重写 `scripts/probe-amazon-data-sources.ts` 与 `docs/radar/AMAZON_DATA_SOURCES_BREAKTHROUGH.md`，推翻“全球不存在 API”的极端推论；明确 SP-API（Catalog/Pricing/ABA/SQP 等官方完整存在但硬性门禁于专业卖家账户 $39.99/月 + 品牌注册，评级 `DOCUMENTED_BUT_ACCOUNT_GATED`）、Creators/PA-API 5.0（免费但需 180 天 3 单考核且受导流用途协议限制，评级 `DOCUMENTED_BUT_AFFILIATE_GATED`）、BSR 网页抓取（公开 RSS 废弃 404，网页受 robots.txt Disallow 与 BTS 503 拦截，评级 `SCRAPING_TOS_PROHIBITED`）、AWS 历史库（1995-2015 静态基准，评级 `HISTORICAL_STATIC_ONLY`）与 Google Trends（宏观趋势，评级 `MACRO_EXTERNAL_ONLY`）。在 ¥0 预算且无卖家账号下，核心商业数据暂无合法免费 API，门禁受控关闭。④**测试断言诚信化与全栈验收**：`tests/market-lane.test.ts` 第 38 测改为 Live Probe 真实网络探测，直面公网阻断事实并打印诊断，全套 38/38 单元测试全部 PASS；全仓 `npm run typecheck` 0 错误；Playwright 真实 Chrome 浏览器验收 **10/10 PASS**（Console 0 严重错误，移动端 390px 布局零水平溢出）。**边界保持**：R7 云端保持 DEFERRED_BY_USER；R8 本地自然运行保持 NOT_STARTED；正式库零写入，测试全程隔离；前三主线零受扰；DeepSeek 调用 0 次（¥0）；外部商业服务采购 ¥0；Git 遵守本地精准提交，绝不 git push，绝不 git add .。）
> 最后更新：2026-10-26 23:59（**第四主线 AUTO-ACTIVATE 本机自动运行落地 + Amazon 核心数据来源突破 = PASS**。完成了自动化工程落地本机日常受管运行体系与 Amazon 核心数据源全景调查及实证。主要成果：①**自动化工程落地本机日常运行与受管启停流水线**：将第四主线 Worker（`radar-market`）无缝整合进全局受管运维脚本体系（`scripts/radar-local.ts` 扩充 `LOCK_MARKET = 7_204_229_008` 与六步启动/七步停机流水线，`scripts/radar-ops.ts` 登记 `market` 任务与清理停止残留，`start-radar.cmd`、`status-radar.cmd`、`stop-radar.cmd` 原生感知）；启动时幂等跳过、关闭时优雅停机释放资源。②**单 Run ID 最后一公里全链追溯实证**：`packages/backend/src/market/market-model.ts` 与 `market-scheduler.ts` 扩充 `runId` 与 `workerPid` 贯穿；执行专用全链路验证脚本 `scripts/verify-cpsc-e2e-pipeline.ts`，7 大阶段全绿通过：实测 Worker PID -> Run ID -> Source ID -> HTTP 200 (耗时统计) -> Total parsed -> Ingested -> Duplicates skipped -> ProductSafetyEvent (带 runId/workerPid) -> Watermark updated -> M09 痛点反证/M12 风险警示 -> API `/api/market/safety-events` (HTTP 200) -> 幂等复运行 (100% skipped, 0 new)；严格遵守业务底线：Browse Node ID 显式为 null，召回事件 0 个误转化为商业销售机会，7 段式确定性中文解释完整完备。③**Amazon 美国站核心数据源 14 维度深度突破调查**：产出权威文档 `docs/radar/AMAZON_DATA_SOURCES_BREAKTHROUGH.md` 与实测脚本 `scripts/probe-amazon-data-sources.ts`；实测证明历史公开 RSS 榜单已彻底下线废弃（HTTP 404），robots.txt 明确禁止抓取 `/dp/` 且伴随 BTS 验证码拦截（违背 ToS 且极不稳定）；系统性梳理 SP-API（必须专业卖家 $39.99/月 + DPP 审核 + 品牌注册）、PA-API（180 天 3 笔销售门禁）、Keepa（€19/月起）、Rainforest（100 次试用墙）门禁边界；得出诚实且确凿的结论：在 ¥0 预算、无合法专业卖家凭证下，除 CPSC 官方公开流外，核心商业数据暂无合法免费 API；核心商业数据保持门禁受控关闭（fail-closed），标准数据模型与插拔式接入点就绪。④**全栈质量与真实浏览器端到端验收**：全仓 `npm run typecheck` 0 错误；单元与合约测试 **38/38 PASS**；真实 Chrome Playwright 浏览器验收 **10/10 PASS**（匿名受控、管理员登录、总览12模块板与零预算反证计数、搜索需求、商品竞争、商业情景计算器乐观/基准/保守三情景与敏感性分析、站内预警、自动来源调度看板、390px 移动端零溢出、Console 0 严重错误）。**边界保持**：R7 云端保持 DEFERRED_BY_USER；R8 本地自然运行保持 NOT_STARTED；前三主线零受扰；DeepSeek 调用 0 次（¥0）；外部商业服务采购 ¥0；Git 遵守安全边界，本地精准提交，绝不 git push，绝不 git add .。）
> 最后更新：2026-10-26 22:45（**第四主线 AUTO-RUN 本机真实自动运行闭环 = PASS**。完成了将第四主线“自动来源适配器、调度引擎、数据标准化、历史观测、信号计算、机会研究和前端看板”真正连接为本机自主运行的自动情报流水线。主要成果：①**专用后台调度 Worker 守护就绪**：新建 `apps/worker/src/radar-market.ts`，基于 PostgreSQL 顾问锁（键 `7204229008`）单实例排他门禁、Windows 进程身份校验与独立心跳机制；接入 `scripts/radar-ops.ts start|stop market` 受管启停；启动后无需打开浏览器或前台网页，后台常驻自主轮询，关机自然终止，开机安全恢复。②**调度器并发互斥锁与实时状态探针**：`packages/backend/src/market/market-scheduler.ts` 引入基于 reserved 物理连接的互斥锁（键 `7204229009`），并发或多进程触发时自动阻断（reason: 已有另一个调度任务正在执行）；新增 `getMarketSchedulerStatus()` 探针，前端 `/market/sources` 实时显示「后台调度器在线 (PID)/未运行」状态徽章与多日停机防风暴补偿说明。③**官方 CPSC 安全通报清洗与风险反证隔离**：数据模型建立独立的 `ProductSafetyEvent`，严格区分发布时间（sourcePublishedAt）、抓取时间（observedAt）与入库时间（ingestedAt）；品类推断候选 Browse Node ID 显式设为 null；输出 7 段式确定性中文解释框架（明确限定未与特定 ASIN 绑定，严禁推断为爆品商机或销量增长），仅直通 M09 创新与安全反证及 M12 站内安全预警，坚决杜绝误生商业机会。④**自动化自主触发实证**：`scripts/verify-autonomous-scheduler.ts` 完全脱离浏览器与人工点击，验证后台 Worker 自主抓取到期任务（PID 实测）、安全推进调度水位与单实例排他退出（退出码 0）；Playwright 真实 Chrome 浏览器验收 10/10 项全过（Console 0 错误、390px 零水平溢出、调度器徽章与安全反证实时可见）。⑤**全栈工程验证**：全仓 `npm run typecheck` 0 错误；单元与调度集成测试 **38/38 PASS**；Web 生产打包成功。**边界保持**：R7 云端保持 DEFERRED_BY_USER；R8 本地自然运行保持 NOT_STARTED；正式库零写入，测试全程隔离；前三主线零受扰；DeepSeek 调用 0 次（¥0）；外部商业服务采购 ¥0；未执行 git push。）
> 最后更新：2026-10-26 21:45（**第四主线 AUTO-FIRST 全自动市场情报系统纠偏与工程实施 = PASS**。用户明确拒绝“人工查找/下载/导入 CSV/Excel”路线，本轮彻底实现全自动化产品范式转向。主要成果：①**全自动产品纠偏与手工入口彻底清除**：Web 界面全面移除所有 `<input type="file">`、文件拖拽区、Excel 格式转换引导、别名映射向导与校验预览表格；保留底层高效纯 TS RFC 4180 解析与防公式注入核心库作为内部自动化服务；各子页面引导语全面升级为全自动监控与合规守护说明；②**恢复并冻结 12 模块原始契约**：彻底消除一切自行更名、拆分或降级，严格锁定 12 个原始模块编号与中文定义（01 搜索需求雷达、02 类目市场雷达、03 商品与新品雷达、04 销售热度雷达、05 竞争格局雷达、06 价格与促销雷达、07 趋势与季节雷达、08 外部平台雷达、09 创新与替代品雷达、10 供需缺口雷达、11 商业可行性雷达、12 机会发现与预警），维持“工程实现 / 数据支撑 / 业务可用”三层诚实状态，拒绝把缺少真实数据的情况伪装成通过；③**真实合规自动数据源接入与台账治理**：官方公开公共领域 CPSC 产品召回 RSS 2.0 数据流（`cpsc-product-recalls`）实测连通（200 OK，免费 $0，无需 API Key），自动提取产品关键词与 13 种常见消费品安全隐患直通 M09 创新与安全反证；SP-API 维持 L2 负面阻断（缺卖家开发者凭据），Amazon 榜单与 AMZ123 维持 `blocked-no-license` 阻断，杜绝无头黑产爬虫与人工伪装自动化；④**统一自动调度引擎就绪**：新建 `packages/backend/src/market/market-scheduler.ts`，实现基于时间戳的周期判定、停机多日防风暴补偿机制（只执行 1 个窗口）、水位安全推进（lastRunAt/nextRunAt/runCount）与下游机会候选/预警自动化级联触发，注册受管 API `POST /api/market/scheduler/run-due`；⑤**自动变化分析与 7 段式确定性中文解释**：`packages/backend/src/market/market-opportunity.ts` 建立稳定唯一标识 `opp:${marketplace}:${subjectType}:${identifier}`，产出 7 段式确定性中文解释框架（发生了什么/变化对比/支持证据/反证证据/为何关注/为何非即时暴利商机/仍需验证信息缺口），严防无根据的夸大承诺；⑥**工作台自动情报看板升级**：`/market/sources` 重构为「自动来源监控与调度看板」，支持一键「⚡ 立即触发到期自动采集与分析」，六大页面空态与指示全面转向自动化状态；⑦**严格工程验收**：全仓 `npm run typecheck` 0 错误；单元与调度集成测试 **34/34 PASS**；Web 生产编译成功；真实 Chrome 浏览器自动化验收 **10/10 PASS**（0 文件上传残余、自动化调度触发与反馈正常、移动端 390px 零溢出、Console 0 错误）。**边界保持**：R7 云端保持 DEFERRED_BY_USER；R8 本地自然运行保持 NOT_STARTED；正式库零写入，测试全程在隔离库运行；前三主线零受扰；DeepSeek 调用 0 次（¥0）；外部商业服务采购 ¥0；未执行 git push。）
> 最后更新：2026-10-26 16:30（**第四主线 OVERNIGHT-01 市场信号深度建设 = PASS**。完成从「单期手工粘贴 JSON」向「合法数据文件交互导入、多期观测累积、位移与趋势分析、类目竞争下钻、可解释机会决策」的个人市场情报工作台跨越。七大工作包全线交付：①**P1_IMPORT_WORKBENCH = PASS**：纯 TS RFC 4180 CSV 解析器就绪（BOM/双引号转义/多行/公式注入防御），智能别名推测与交互式字段映射，导入前校验（有效/重复/格式异常行号与字段定位）与多期快照样例预览，CSRF 守门幂等入库零重复；Excel .xlsx 引导路径；②**P2_HISTORICAL_OBSERVATIONS = PASS**：关键词多期追踪（keywordHistoryDetail，位移方向、连续趋势、未内插缺失识别、反转 Y 轴 Sparkline 图表）、商品多期追踪（productHistoryDetail，报价变动率、C2 口径可比性检查、进出榜状态）；③**P3_TWELVE_MODULE_CAPABILITIES = PASS**：类目雷达（M02 样本类目聚合看板、品牌分布与价格区间）、销售热度（M04 榜内多期位移）、价格与促销（M06 跨期追踪）、外部平台（M08）与创新线索（M09）私有记录存储与读取全线打通；④**P4_OPPORTUNITY_AND_ALERT_QUALITY = PASS**：机会候选跨期去重（opp-kw- 唯一身份，多期上升刷新已有线索而非产生重复卡片）；一键「⚡ 从上升词生成研究候选」前端打通；预警去重冷却与一键评估打通；⑤**P5_MARKET_UI_AND_DATA_QUALITY = PASS**：Web 六大路由全线升级，多期周期下拉筛选、关键词下钻历史抽屉、ASIN 观测历史抽屉、类目卡片矩阵、数据质量总览卡片；⑥**P6_LOCAL_STABILITY = PASS**：测试全程在隔离库 lightchoice_radar_test 执行，正式库 lightchoice_radar 零写入、零污染；前三主线 Worker 稳定运行；⑦**P7_ISOLATED_E2E = PASS**：单元与集成测试 29/29 全过；TypeScript 全仓 0 错误；Web 构建 2.78s + 773ms 成功；真实 Chrome 自动化浏览器验收 10/10 项全过，Console 0 错误，移动端 390px 零溢出。**边界保持**：R7 云端保持 DEFERRED_BY_USER；R8 本地自然运行保持 NOT_STARTED；前三主线零影响，DeepSeek 调用 0 次，新增费用 ¥0；未执行 git push。）
> 最后更新：2026-10-26 15:30（**第四主线 LOCAL-READY 本机正式可用性收口 = PASS**。五项独立结果全面达标：①**LOCAL_API_READY = PASS**：目标 API（PID 53908→受管重启新实例 PID 45452）绝对路径与项目一致，`/api/market/*` 路由注册完备，管理员会话校验与 CSRF 防护生效，未登录返回 401，前三主线只读接口完全正常。②**LOCAL_UI_READY = PASS**：Web 3000 六页面（/market、/market/keywords、/market/products、/market/opportunities、/market/alerts、/market/sources）全部返回 200 OK 并正确渲染；真实无头 Chrome 浏览器验证 10/10 项全过；390px 移动端布局无水平溢出，Console 0 错误。③**LOCAL_DATA_IMPORT_READY = PASS**：来源管理页提供人工 JSON 粘贴导入面板（关键词快照与榜单人工观察），具备客户端校验、后端门禁、幂等防重；正式环境诚实空态，隔离环境完成导入、复导入与撤销传播全流程验证。④**LOCAL_PERSISTENCE_READY = PASS**：本机 5544 端口 PostgreSQL 持久化有效；使用 `pg_dump` 成功制作本地自定义格式备份（.data/backups/），并在全新隔离数据库 `lightchoice_radar_restore_test` 中经 `pg_restore` 验证完整恢复 48 张表与业务数据，正式库全程零误碰；备份文件存储于被 `.gitignore` 排除的目录。⑤**LOCAL_BUSINESS_READY = PASS**：商业情景计算器三情景纯计算与敏感性分析正常；机会候选生成修复为默认全量保留不再静默丢弃（opts.maxPerRun 可选）；人工研究决策绑定证据版本；站内分型预警与冷却去重机制正常；来源撤销联动失效传播验证通过。**边界保持**：R7 云端保持 DEFERRED_BY_USER；R8 本地自然运行保持 NOT_STARTED；前三主线零影响，DeepSeek 调用 0 次，新增费用 ¥0。）
> 最后更新：2026-10-26 12:30（**第四主线 R6-CLOSE 工程质量收口 = 完成；R7=DEFERRED_BY_USER、R8_LOCAL=NOT_STARTED（用户决定本机为正式目标）**。四项修复：①**信号/机会/预警混淆（根因修复）**——原预警=信号 1:1 回声且逐信号生成候选；现预警分五型（market-change/research-lead/qualified-opportunity/source-failure/revision-revocation），普通变化带触发原因展示且永不为商机，**qualified-opportunity 仅对评分未拒绝候选触发**（E2E 实证：48 条全部 market-change、0 高价值、候选 48→20 封顶+「研究线索（待补证）」标注）；证据修订回拒→高价值预警自动撤回留痕（retireUnqualifiedAlerts）。②**许可边界诚实化**——来源许可改「操作员私有研究授权」表述；AMZ123 撤 export；新增 unverifiedUses（fetch/modelSend/export）页内 PERMISSION_UNVERIFIED 横幅；**撤销传播全套**（revokeMarketSource→预警失效+机会待复核+再导入拒+信号层排除）实测通过。③**12 模块三层状态**——总览模块板增「业务验收」层（工程≠数据≠业务），PARTIAL/NOT_RUN/BLOCKED 如实。④**存储规模验证**——10,800 观测隔离实测：导入 197/610ms、幂等 4ms、百期序列 20ms、撤销传播 13ms；零迁移布局支撑近期个人规模（>10 万再评估专用表）。**验证**：21/21 测试（+5 组新用例）、隔离 E2E（真实样本→20 候选→48 分型预警→撤销链）+浏览器 **23/23**、tsc 全仓 0 错、Web build ✓。**本机可用性**：/market 已随 3000 热加载（页面可达）；正式 API 3001 待下次受管重启加载 /api/market/*（重启前回退态属预期，方法在运行说明市场章节）；数据持久于正式库零迁移、重启即恢复；市场章节已入《本地运行说明》。**边界**：正式 3000/3001 零重启、正式库零写入、模型 0 调用、¥0、无正式采集、3010 未触碰。本条目随本轮代码本地提交。）
> 最后更新：2026-10-26 10:30（**第四主线 R1~R6 隔离工程建设全部完成（用户授权提前建设）**。5 个后端模块（market-model/import/metrics/opportunity/read，~1,500 行）+ API 路由 14 个（adminHandler+CSRF）+ Web 6 页 + 17/17 隔离测试。**验收**：R1_DATA_FOUNDATION=PASS（零迁移对象模型/六用途许可/幂等/版本）、R2_SOURCE_ADAPTERS=PASS（三适配器+权限门禁实测拒绝/校验拒绝非法输入）、R3_MARKET_METRICS=PASS（C1–C12 全实现含边界测试：OUT_OF_SCOPE 不填 N+1、价格口径不可比只阻断价格、Trends 不拼接）、R4_OPPORTUNITY_RESEARCH=PASS（缺供给证据**拒绝总分**实测/三情景计算器/人工决定绑版本/预警去重冷却）、R5_MARKET_UI=PASS（6 页 12 模块状态板/诚实空态/390px）、**R6_ISOLATED_E2E=PASS（真实数据全链路：r63 真实样本（100 关键词+6 商品）经 HTTP+CSRF 导入隔离库 lightchoice_radar_e2e_market → 56 信号 → 48 机会候选（评分正确拒绝）→ 48 预警 → 隔离实例 3011/3002 浏览器验收 28/28（真实数据展示/证据外链/限定语/匿名 401/零控制台错误/390px）；隔离实例已清理（PID 核验停止+E2E 库已删）；正式 3000/3001 全程未动）**。tsc 全仓 0 错+Web build ✓。**产品状态如实不变**：正式生产 NOT_STARTED（零采集/零定时/零模型/¥0）；单期商品快照→D 能力 NOT_RUN；12 模块数据状态=9 BLOCKED+3 PARTIAL 维持（工程≠数据）。云端兼容：来源默认关+水位/幂等/互斥设计就位（R7/R8 门禁未动）。本条目随本轮代码一并本地提交（见 Git 记录）；未推送。前三条主线零影响。）
> 最后更新：2026-10-26 08:00（**第四主线 R0-DATA：真实数据打通 = 关键突破**。约 10 次免费只读页面请求、模型 0、¥0、正式库零写入；真实样本 2 份存 `.data/_diag/r63/`（gitignore 不入 Git）。**① AMZ123 导出实测**（真实 Chrome 交互）：页面**无任何导出入口**（全页文本+可点击元素双查 0 命中——公开搜索的「导出搜索结果」与当前页面不符，无需登录/付费问题因入口不存在而不适用）；**取得 100 条关键词真实样本**（可见首页人工等价读取：词/本周/上周/涨跌，周更 2026-10-23，ABA 二手；验证：0 重复 0 越界，**「涨跌幅度」=两周排名绝对位移 100/100 确认**——方向须推导；无搜索量；单周无多周历史）。**② Amazon 商品级突破**：**真实 Chrome 加载 /gp/bestsellers=HTTP 200**（默认客户端 503 仅限非浏览器请求）→ **Beauty & Personal Care 榜 Top6 真实商品样本**（ASIN 6/6 有效+榜内排名 1-6+价格 6/6+标题，单页一次性人工等价观察）——**能力 C 人工观察级 L3 实证**；无人值守自动化仍 BLOCKED（条款+503 家族）；榜单周期未声明、无父子/变体（需详情页）。**③ AMZ123 商品级**：工具箱=通用小工具，无自有商品数据库入口（商品研究靠外链第三方）；SellerSprite 官网 404 不可达+付费未授权→不引入。**能力表（R0-DATA 后）**：A=**L3 实证**（100 条）；B=0；C=**人工观察级 L3**（6 条，可持续通道未成立）；D=0（下周期复测同榜即得首证）；E=NOT_STARTED。**GATE_B_DATA=PARTIAL**（数据存在性证实；获准可持续通道未成立；条件 1 主线顺序/提前授权仍缺）。**待决**：商品级通道三选一（SP-API 注册[推荐]/受管浏览器观察[过渡]/第三方工具）；AMZ123 关键词周期来源授权（robots 未禁+可达+样本实证）。R0-DATA+R0-FINAL+R0 三份文档成果随本轮本地提交（见 Git 记录）。第四主线工程状态不变=NOT_STARTED。）
> 最后更新：2026-10-26 06:30（**第四主线 R0-FINAL：两处纠错 + 数据通道真实验证 = 完成**。改动仅 3 文档+1 诊断件（gitignore 内），零代码/零模型/¥0/正式库零写入/Git 零写操作。**纠错**：①模块统计改正为 **9 BLOCKED**（01-06/08/10/12）+**3 PARTIAL**（07/09/11）——原「01~08」误含 07；②Gate B 有界验证表述由「类目 Top20」改为「已知 ASIN 或合法关键词查询验证真实商品身份/属性/类目/实际返回字段」并冻结：**关键词查询每页≤20 条≠畅销 Top20、搜索结果顺序≠Bestseller 排名、一次商品查询成功≠榜单采集成功**。**通道验证（4 次免费只读请求）**：①SP-API=L1 已核+**L2 负面确认**（项目零集成、.env 无 SP-API/LWA 凭据键——只查键名）→ 未发任何请求即停；②Amazon 榜单=robots.txt 未禁止榜单路径但**默认 UA 实测 503 反爬**（人工可浏览/无人值守受阻，BTS 判例）；③**AMZ123 热搜词页实证**（页面实读+robots）：字段=搜索词/本周排名/上周排名/涨跌幅度、周更（2026-10-23 时间戳）、**来源自标=ABA 转载**、10 站点+搜索+区间筛选、无导出功能、无登录墙、通用客户端可达、robots 未禁该路径——**关键词级路径候选第一顺位**，但无 ASIN≠商品级；④项目内无结构化商品数据（r55 的 ASIN 为三线讨论附带提及）。**能力表（A–E）**：A=页面级 L3 实证/数据级未取得；B=0；C=0（三路径全未取得）；D=0（AMZ123 周环比属关键词级不冒充 D）；E=NOT_STARTED（AMZ123 为 E 首选技术候选待授权）。**门禁**：Gate A 设计层 PASS 维持（纠错后复核）；**Gate B=BLOCKED**（条件 1 主线顺序/提前授权未变；条件 2 商品级实证未成立——首选解=用户注册 SP-API 开发者应用+卖家授权后执行 ≤25 请求有界验证）；Gate C 不变。证据存 `.data/_diag/r62/data-path-verification.md`。待决新增：AMZ123 热搜词页是否授权为第四主线首个关键词级周期来源（条款核验+采集授权）。第四主线工程状态不变=NOT_STARTED。）
> 最后更新：2026-10-26 05:00（**第四主线 R0 设计冻结交付 = PASS（Gate A 设计层）**。权威主计划 **`docs/radar/FOURTH_LANE_MARKET_MASTER_PLAN.md`**（新建，~14 章）+ README 主线 4 状态更新（指向主计划）。**主计划内容**：①定位与两层能力（广域发现+重点追踪，Amazon US 核心）；②14 个业务对象逻辑模型（复用现有表扩展，R1 定落点）；③五时间戳/商品身份四分法（首次观察≠首次上榜≠页面标注≠有证据发布）/五类事实类型；④历史与修订（新快照不抹历史、撤权传播、派生失效链）；⑤指标可比性 C1–C12 冻结（排名前进=上期−本期禁换算需求%、价格变化率口径条件、跨类目 BSR 不可比但不阻断同商品价格、未知排名禁填 N+1、Trends 归一化禁拼接、跨平台禁相加等）；⑥来源台账 17 条（L1/L2/L3 分级）——**本轮已核验：SP-API Catalog Items v2022-04-01 官方文档**（ASIN/属性/类目/排名/关系，需 Product Listing 角色，Sellers+Vendors）；Keepa=JS 壳页细节未核验；Google Trends BigQuery/Etsy/eBay 本轮网络不可达已标注；**ABA/POE/榜单页/外部平台全部 L1 无 L2**；⑦**12 模块逐项九要素契约**（业务问题与操作/字段/来源与偏差/周期覆盖/指标限制/依赖/复用新增/验收/状态阻塞）——数据层 10 模块 BLOCKED、07/09/11 PARTIAL（辅助证据或一二三线先例）、**12/12 设计契约冻结**；⑧三层研究语言+跨线引用规则+工作台线索输出设计（只导出不写对方库）；⑨权限六用途矩阵+受管模型调用方案（市场.budget 设计未建、¥0、thinking 默认关）+pg-boss 专用队列设计+来源诊断六态；⑩中文产品体验（四页旅程、无预算时模板中文不冒充模型）+云端目标（单数据权威、防双调度、RPO≤24h/RTO≤4h 建议，条件全未确认）；⑪R0~R8 阶段表+**三门禁**（Gate A=本轮设计 PASS；Gate B=BLOCKED——条件1主线顺序（一/二线 11-01 到期验收+三线产品验收）或提前授权、条件2商品级主路径 L2+有界 L3，已备一次有界验证方案：SP-API 资格+≤25 请求+1 类目 Top20，待授权；Gate C=BLOCKED 预期内）；⑫验收口径（状态词汇三分、五层验收、样本分母冻结、语义验收=自动检查+人工核对分离、环境四确认）；⑬复用映射五类标记（已有且有证据/待核/需扩展/缺失/受阻）；⑭冻结结论+5 项待决。**本轮验证与未验证**：主计划完整性自检通过（12 模块×九要素、五能力 A–E 现状=证据全零如实、C1–C12 全在、三门禁条件明确、内部引用一致）；SP-API 官方文档实抓；其余来源为 L1+未核验标注（未冒充）。**边界遵守**：零业务源码改动、零 Git 写操作、零服务操作、零模型调用、未读 .env；写入仅 3 个声明文件（主计划/README/CURRENT.md）。第四主线工程/启用/自然新增/稳定运行 = NOT_STARTED（预期状态）。R1 启动等待 Gate B 两条件。）
> 最后更新：2026-10-26 03:40（**R61 GitHub 私有远程交付 = PASS**。R60 全部成果已上传用户私有仓库 **`a2578348864a-sys/lightchoice-radar`**（gh 实测 private=true、默认分支 master、SSH remote `git@github.com:a2578348864a-sys/lightchoice-radar.git`）。流程与证据：① SSH 身份=`ssh -T git@github.com` 认证为 a2578348864a-sys（与 gh CLI 登录一致，无身份冲突；私钥未读取未打印）；② 仓库定位=账号下 6 仓库仅 `lightchoice-workbench-v5`（**Workbench 项目，未触碰**），lightchoice-radar 名称未占用 → `gh repo create --private` 新建空仓库（无 README/License/模板初始化，避免历史冲突）；③ **历史安全扫描 PASS**：20 个提交全量扫描——无 API Key/GitHub Token/私钥/带凭据连接串（docker-compose 的 `postgres://aihot:${POSTGRES_PASSWORD:-aihot}@` 为环境变量+本地开发默认值占位符）、无 >5MB blob、.env 与 .data/ 历史上从未入库（仅 .env.example 模板且无真实值）；④ 普通 `git push -u origin master`（非强制，20 提交全量上传）；⑤ 远程验收：远程 HEAD=R60 HEAD `153f596`、R60 三笔提交（0415be1/7ef810b/153f596）在远程、VOC 后端/API/前端/CLI/测试/CURRENT.md 关键文件逐一存在、.env/r19.bak/listing-urls.txt/.data 全部缺席；本条目所在文档提交后本地与远程 master 再次一致（无未推送提交）。**边界**：未动 Workbench 仓库与其 remote；业务服务零重启/零部署、正式库零写入、DeepSeek 0 调用、3010 未触碰。**恢复能力说明（如实）**：GitHub 备份=代码+迁移+测试+文档+Git 历史；**不含** .env 实际密钥/PostgreSQL 正式数据/.data 私有采集数据/运行队列/本机 SSH——R61 是代码远程备份，非完整生产灾难恢复（后者待单独任务）。业务状态不变：一线/二线 OBSERVING（11-01 到期）、三线待材料外发授权+预算窗口、四线未启动。待用户决定：① 11-01 观察到期验收 ② 三线真实研究材料 ③ 四线立项 ④ 正式数据灾难恢复备份（另行授权）。）
> 最后更新：2026-10-26 03:10（**R60 工程冻结与 Git 本地安全交付 = PASS**。用户授权下完成 3 笔本地提交（未 push）：**`0415be1`** feat(radar-voc) 后端 12 文件（9 个 voc 模块 + config/llm/contracts，+1898 行——许可追踪证据模型/三道门禁 L2L3/有界增量/独立账本/评估器）；**`7ef810b`** feat(radar-voc) 工作台 12 文件（API 路由/4 页面/vocGet/41 项隔离测试/2 个受管 CLI，+1546 行）；**本条目所在文档提交**（docs(radar) 三主线交付基线冻结）。提交前验证：全仓 typecheck 0 错、VOC **41/41**、Web build ✓（1.04s）；敏感扫描 0 命中（无密钥/凭据/私有连接串/绝对路径入源码；config.ts 的 postgres://127.0.0.1:5432/aihot 为无凭据历史默认值；测试夹具为合成数据）。**提交边界**：只提交前三主线确认成果（26 文件）；永不提交=.env（密钥）/.data/（私有数据）/CURRENT.md.r19.bak/listing-urls.txt（遗留工作区，非本轮产物）。**运行保护**：零模型调用/零重启/零部署/零远程操作/正式库零写入/3010 未触碰；本地提交≠服务已更新（运行中 API 仍为提交前代码，VOC_MODEL_ENABLED=true 维持待受管重启生效）。**依赖完整性**：Commit 1 自洽可编译（app.ts/routes.ts 旧版不引用新模块）；Commit 2 补齐全部消费方；提交后 `git status` 仅余 4 个已知排除项=无遗漏必要源码。业务状态不变：一线/二线 OBSERVING（2026-11-01 01:04/03:06 到期）、三线工程交付=PASS/产品=BLOCKED（材料外发授权+预算窗口）、四线未启动。后续待用户决定：① 11-01 观察到期验收 ② 三线外发材料/SE 书面许可 ③ 三线预算窗口+正式增量启用 ④ push 远程（须另行授权）⑤ 四线立项。R59 及更早条目见下方历史记录。）
> 最后更新：2026-10-26 02:40（**三主线工程冻结与正式交付收口（R59，纯核对+文档，零代码改动、零模型调用、零 Git 写操作）**。**A 工程快照**：HEAD `7657943`；已跟踪修改 7 文件（app.ts/api.server.ts/routes.ts/CURRENT.md/config.ts/llm.ts/site.ts）+ 未跟踪 12 条目=**20 物理文件**（voc/ 目录展开 9 模块 + 5 web 路由 + 1 API 路由 + 2 测试 + 2 CLI + r19.bak 83.7KB + listing-urls.txt 0B）；workspace 链接完好（@aihot 7 包）；无其他 Agent 改动痕迹；`.env`/`.data/` 均被 gitignore 排除。**C 费用对账（ receipts 逐张只读核对）**：全库 59 张回执=translate_title 23 completed（in 11,938/out 610）+ translate_excerpt 21 completed（in 11,511/out 1,154）+ industry_event 15 received（in 4,919/out 4,240）；**无重复 logical_key、无 error/pending 未结算回执、无负值**。四口径分列：①一线当前窗口 first-lane-7d **¥0/0 次**（窗口 40 次 ¥1 至 11-01 01:04）②一线历史已确认 **¥0.061010/44 次**（归档轮 r0 ¥0.019346/14 + r1 ¥0.041664/30，即 44 张翻译回执）③二线账面 **¥0.2028/16 次**（¥3 窗口至 11-01 03:06；实际 token 用量折算约 ¥0.05——账面偏高系已修复的 reuse 重复结算历史遗留，账本保留不动、额度按账面从严）④三线 **¥0/0 回执**（历史累计 0）。VOC ¥0.158 为估算非账单。**D 运行基线**：3000/3001/5544+4 Worker 进程身份今日已验（绝对路径同仓）；健康服务不重启——`.env` 的 VOC_MODEL_ENABLED=true 属**待下次必要受管更新生效**（进程内仍关=更保守方向）；恢复步骤已固化于《本地运行说明》新增「消费者原声（第三主线 VOC，R58 起）」章节（增量 CLI 入口/三道门禁说明/受管重启 API 方法/测试命令）。**E 业务验收**：复用本会话早前证据——一线 8 样本 0 事实错误（抽样代表性，非 23 篇全量结论）、二线 6 样本 0 事实错误、浏览器 19/19（一线中文+详情 5 外链可追溯/二线分区/三线空态与授权区分/390px/匿名 401）；本轮零代码改动故不重跑。**F 观察窗口**：`OBSERVATION_PENDING_UNTIL_2026_11_01`——一线窗口内 6 源 83 轮 1 次失败（10-25 13:16 DNS 瞬时，19:17 自愈）=98.8% 成功率、0 新文章（到期收口时须按观察协议对照官方列表核实为「正常零新增」）；二线 5 源 28 轮 0 失败、窗口内 30 篇入库；两线均无尾随失败、无预算异常、BTS 保持停用。**G Git 交付准备（未提交，建议分组）**：A 组共享基建=config.ts+llm.ts+site.ts+app.ts+api.server.ts+routes.ts（多阶段共享，不可拆）；B 组 VOC 基础=voc-model/voc-ingest/voc-read/voc-stackexchange；C 组 VOC 研究=voc-l2l3/voc-budget/voc-analysis/voc-eval+scripts/voc-eval；D 组 VOC 增量=voc-increment+scripts/voc-increment+tests/voc-increment；E 组文档=CURRENT.md+本地运行说明.md+tests/voc-lane+web 5 页面（页面横跨 B/C 归 A 或单列）；**不得提交**：.env（含密钥）、.data/（诊断与私有数据）、CURRENT.md.r19.bak、listing-urls.txt。**判定**：WORKSPACE_INTEGRITY=PASS、BILLING_RECONCILIATION=PASS、RUNTIME_HEALTH=PASS、GIT_DELIVERY_READINESS=PASS（清单就绪待授权）、DOCUMENTATION_BASELINE=PASS；POLICY_CHINESE_QUALITY/EVIDENCE=PASS（抽样）、POLICY_SOURCE_HEALTH=PASS、POLICY_NATURAL_OBSERVATION=OBSERVING（PENDING_UNTIL_2026-11-01）、POLICY_MODEL_COST=PASS、POLICY_PRODUCT=PASS（当前可用）；INDUSTRY 同口径（CONTENT_COVERAGE=PARTIAL 媒体许可边界如实）；VOC_ENGINEERING_DELIVERY=PASS、VOC_LICENSE_INTEGRITY=PASS、VOC_INCREMENTAL_ENGINEERING=PASS（41/41）、VOC_INCREMENTAL_OPERATIONS=NOT_STARTED、VOC_NATURAL_INCREMENT=NOT_RUN、VOC_MODEL_GATE=PASS、VOC_MODEL_SEND_ELIGIBILITY=BLOCKED（材料授权）、VOC_MODEL_BUDGET=PASS（¥0 无窗口如实）、VOC_CHINESE_L2_REAL_QUALITY/RESEARCH_L3_REAL_QUALITY=BLOCKED、VOC_PRODUCT=BLOCKED。下一步待用户决定：① 11-01 两窗口到期验收 ② 三线外发材料或 SE 书面许可 ③ 三线预算窗口与正式增量启用 ④ Git 本地提交授权（按 A-E 分组）⑤ 四线立项。）
> 最后更新：2026-10-26 02:00（**统一 DeepSeek 授权基线 + 前两线真实中文质量验收 + 三线门禁回归**。**① 统一授权（2026-10-26 用户明确授权）**：DeepSeek API 可用于全部四条主线的合理用途（翻译/中文理解/摘要/研究），不再逐条询问——旧「三线一律 ¥0」前提作废。落地：config.ts vocModelEnabled 注释改写（默认仍 false 防新检出环境误开，阀门语义=「允许材料自身许可允许的内容走模型」）、`.env` 增 `VOC_MODEL_ENABLED=true`（**运行中 API 3001 为改前启动，进程内阀门仍关=更保守；下次受管重启生效**）；**不建 voc.budget 窗口**（无获准外发材料，¥0.50/30 仍为候选值）；费用工程全保留（预算前置检查/分线计费/回执去重/缓存命中计费/耗尽自停）。**授权分离原则不变**：用户 API 授权≠来源内容授权——SE 两批次 modelSend=false、冻结 10 样本不动、无 1 次 voc 回执（历史累计 0）。**② 一线中文质量验收（8 冻结样本，.data/_diag/r58/lane1-quality-sample.json）**：2 公告+1 费用+2 联邦公报+3 召回——标题忠实、摘要忠实、**0 事实错误、0 日期语义错误（published/updated 分列存储）、0 编造强制要求**；FTC 条目正确保留「拟议规则制定」非已生效；召回危险描述与标准违规表述精确。发现「1 篇缺 zh-excerpt」实为 publications.summary 已有中文编辑摘要（按设计不重复翻译）——**中文覆盖实际完整（23/23 标题+摘要层）**；补译尝试在发送前被正确拒绝（already Chinese）=本轮一线 **0 新模型调用 0 费用**。**③ 二线中文质量验收（6 冻结样本：BEA3+FRB3）**：数字逐一核对全对（928→1056 亿美元/+334 亿/15.7%/GDP 2.2% vs 2.5%）、FRB 三个会议日期精确、每条附诚实「原文未说明」边界注记（反幻觉设计可见生效）；**0 事实错误**；1 轻微风格问题（BEA GDP 条「增长4.0 percent」单位未汉化，不影响事实，已记录——无单条重译入口，材料修订时自然重生成）。**④ 三线门禁回归**：41/41（增量 21+核心 20）；生产授权状态复核=SE 批次与增量批次均无 modelSend、voc.budget 不存在、冻结 10/10 modelSend=0、30 题 0 撤销、voc 回执累计 0——**阀门打开后仍零调用证明门禁链有效**。**⑤ 业务浏览器验收 19/19**（.data/_diag/r58/browser-business.mjs + 2 详情页复测）：一线中文列表+摘要+来源日期、详情页 5 个官方原文外链可追溯（/items/:id）、二线中文分区+数字+许可边界、三线研究页「材料外发授权与模型授权」区分说明+真实空态、390px×3 零溢出、匿名 401、0 控制台错误。**⑥ 运行观察**：6h 28 轮 0 失败；24h 内 15 张回执全部为 10-25 行业批处理历史回执（今日 0 新调用）；行业账本 ¥0.2028/16 次未动、一线翻译窗口 0/40 未动；一/二线观察窗口 2026-11-01 01:04/03:06 未到期=OBSERVING。**判定**：POLICY_CHINESE_QUALITY=PASS（8 样本 0 错）、INDUSTRY_CHINESE_QUALITY=PASS（6 样本 0 事实错，1 风格瑕疵记录）、POLICY/INDUSTRY_EVIDENCE_QUALITY=PASS（外链可追溯）、VOC_MODEL_PERMISSION_GATE=PASS、VOC_MODEL_BUDGET=PASS（无窗口=未消费如实）、VOC_CHINESE_L2_REAL_QUALITY=BLOCKED（材料阻塞非 API 阻塞）、VOC_NATURAL_INCREMENT=NOT_RUN、VOC_INCREMENTAL_OPERATIONS=NOT_STARTED、VOC_PRODUCT=BLOCKED。**Git**：本轮修改 config.ts（注释）/.env（阀门）/CURRENT.md+新增 r58 诊断件；tsc backend 0 错；未提交（历史混合成果待专门授权）。3010 未触碰。）
> 最后更新：2026-10-26 01:30（**VOC 增量完整性修复（旧主题回答/评论/编辑/许可变化）+ 评估器补强**。**核心缺陷（已证实的真实遗漏风险）**：上轮增量对已知主题的更新发现完全依赖 `last_activity_date` 探针——本轮核对该字段官方文档**仅有类型标注、无「评论/编辑是否触发」的语义保证**（api.stackexchange.com/docs/types/question 逐字核对），且探针 300 条上限无轮转——旧主题新增评论若不触发活动时间即永久漏检。**修复（重写 voc-increment.ts，不依赖活动时间语义）**：① 每轮对已知主题做**round-robin 全线程重取复查**（≤100 题/轮=1 请求，`seFetchThreads` 原样复用），经 applyImport 内容哈希差异捕获**新回答/问题下与回答下新评论/正文编辑/许可变化**——对评论是否触发活动时间免疫；>100 题时轮转游标分轮覆盖（30 题现状=每轮全覆盖，全量覆盖延迟上限=⌈N/100⌉ 轮，如实记录）；② **同秒边界**：SE `min` 为 inclusive + 已存 id 从发现中扣除→同秒题目重见即滤、不丢失不重复（隔离测试证明）；③ **基线水位**：首轮水位从**最早批次 importedAt** 初始化（SE 服务器时间），消除「本地时钟 vs 源站时间」偏差与导入后盲窗；④ **advisory 锁**（键 7204229007，reserve 连接显式 unlock 后回池——防并发重复运行）；⑤ **缺失观察**：复查请求未返回的 id 记入 stats.missing（删除只能以缺席观察，不做破坏性动作）；⑥ 429 立即停止、预算 6 次/轮、失败不动水位/游标/carry-over、重跑恢复。**配套修复**：seFetchQuestionMeta 已删除（被复查机制取代）；voc-eval 增加 `modelIds` 分布与 `partial` 计数（评分结果可见模型来源，隔离夹具结果永不冒充真实）；scripts/voc-increment.ts 运行后打印状态行。**生产水位盲窗已修**：`voc.increment.voc-coffee-se.createdWatermark` 从 16:28Z（本地时钟）回拨到 **12:29Z（首批 importedAt）**——该 4 小时窗口内创建的题目不再被永久跳过（settings 单键修订，无业务数据改动）。**验收**：增量隔离测试 **21/21**（门禁×5+零网络/首次新增/基线水位/无变化/旧题新回答/旧题新评论且活动时间不变/L2 缓存失效+人工决定进复核/正文编辑+快照/许可变化/同秒碰撞/预算耗尽恢复/429/网络错误/carry-over/轮转覆盖不相交并集全集/缺失观察/撤销拒绝/并发锁/来源隔离）+ 既有 VOC 20/20 = **41/41**；tsc backend+tests 0 错；两 CLI 冒烟通过（refused 路径 + voc-eval 真实分母 withL2=0 如实）。**授权状态复核（未变化）**：SE 批次与增量批次均无 modelSend、voc.budget 不存在（¥0）、冻结 10/10 modelSend=0、30 题 0 撤销、DeepSeek 调用 0。**三线运行快照（01:08）**：一线五来源全 ok（24h 1 次 DNS 瞬时已自愈）、二线四源 ok+BTS 保持停用、行业预算 ¥0.2028 未动、24h 115 轮运行；一/二线观察窗口 2026-11-01 未到期（OBSERVING）；本轮零共享文件改动，浏览器验收沿用上轮 21/21 证据。**判定**：VOC_INCREMENTAL_NEW_TOPIC/OLD_ANSWER/OLD_COMMENT/OLD_EDIT/LICENSE_CHANGE=PASS（隔离）、VOC_INCREMENTAL_WATERMARK=PASS（同秒+基线+失败不动）、VOC_INCREMENTAL_RECOVERY=PASS、VOC_INCREMENTAL_IDEMPOTENCY=PASS、VOC_EVIDENCE_REVISION=PASS、VOC_L2_CACHE_INVALIDATION=PASS、VOC_MODEL_SEND_ELIGIBILITY=BLOCKED（AUP 现行条款限制+未授权）、VOC_MODEL_BUDGET=PASS（¥0 如实）、VOC_EVAL_READINESS=PASS（真实分母冒烟）、VOC_NATURAL_INCREMENT=NOT_RUN、VOC_STABLE_OPERATIONS=OBSERVING（未启定时）、VOC_PRODUCT=BLOCKED。**Git**：本轮未提交（存量混有前几轮未提交成果）；修改 voc-increment/voc-stackexchange/voc-eval/scripts/voc-increment + 重写 tests/voc-increment.test.ts + CURRENT.md。3010 未触碰、无 DeepSeek 调用、无定时任务。）
> 最后更新：2026-10-26 00:45（**四阶段一体化：SE 条款修正 + 零费用评估路径 + VOC 增量工程 + 三主线统一验收**。**阶段B 来源条款修正（2026-10-26 00:20，Wayback 2026 快照）**：**现行 AUP（6/18/25 版，且扩展适用于 stackoverflow.ai）的 Content Scraping/Bot Policy 明文禁止**为「开发、构建、训练、**测试**、索引、基准测试或改进任何生成式 AI/聊天机器人/大语言/机器学习工具、模型或平台」目的做自动化采集，**例外=事先明确书面同意**（AUP 指定联系邮箱；获取渠道存在，未申请）；TOS 仍为 2025-11-13 版（2026 快照确认未更新）、API ToU 仍为短版（署名+并入 TOS，无 AI 条款无缓存时限）；DeepSeek 开放平台协议+隐私政策 2026-10-25 已从官方 CDN 核实（§4.1 输入权利保证、**无不训练承诺**、隐私政策训练条款+聊天产品退出开关）。**纠正**：2026-10-25 深夜基于 2024 存档快照的「现行 AUP 无 AI 专条」结论**已被现行版推翻**——SE 材料模型外发依据从 UNCERTAIN 收紧为「现行条款明确限制，无书面同意不得进行」，`SE modelSend=false` 依据升级（不再是 CC BY-SA 条件未核实，而是 AUP 目的条款明文覆盖 testing 生成式 AI）；私有研究用途（保存/阅读/L1/人工研究）不变 SUPPORTED。**阶段C 评估路径（¥0）**：`voc-eval.ts` + `scripts/voc-eval.ts`——冻结样本分母上的验收指标（格式合格/引用有效 ⊆ 许可上下文/极性一致/严重错误/按难度类分布），无已存 L2 时 withL2=0 如实（真实质量 NOT_RUN 语义）；外发材料检查：项目内无获准第三方处理的材料，真实 DeepSeek 试验维持 BLOCKED（双门：modelSend 授权 + ¥0.50/30 候选窗口均未批）。**阶段D 增量工程（¥0，未启定时）**：`voc-increment.ts`（五门禁=研究命名来源/来源行启用/批次未撤销——saveBatch 是 upsert，指向已撤销批次会清掉撤销标记故显式拒绝/请求预算默认 6 次/429 立即停止；前瞻水位；carry-over 分轮恢复；失败不动水位）+ SE 客户端扩展（`seFetchQuestionMeta` 轻探针、`sort=creation` 水位发现、`taggedOnly` 增量模式——正式研究 14 词拼 q 会 AND 归零，发现语义与首批一致走 tagged）+ **ingest 修订缺陷修复**（applyImport 修订分支此前不递增 articles.revision、不写 article_revisions——内容修订后 L2 复用判定仍命中=证据版本失效机制形同虚设；现修为条件自增+快照+**许可变化算材料修订**）+ `scripts/voc-increment.ts` 受管一次性 CLI（自动建常驻批次 `voc-inc-voc-coffee-se`：store/privateRead/display/export，**modelSend 永不包含**）。**隔离测试 12/12**（门禁×5/首次新增/无变化/修订+快照/许可变化/预算耗尽水位不动+重跑恢复/429 停止/carry-over 恢复/撤销拒绝/来源隔离）+ 既有 VOC **20/20** = **32/32**；tsc backend+tests 0 错。**真实健康检查（受管一次性，非定时）**：首跑 fetch failed（瞬时网络，直接 curl SE API 200/4.1s 偏慢）→ **重跑 processed**（2 请求、配额余 276、0 新增、水位=运行时刻 1792945689 落库、增量批次无 modelSend 实测）——失败恢复语义首次真实演练。**阶段E 验收**：三主线浏览器 **21/21**（真实登录、一线 /all+/leads、二线 /industry 中文分区+运行状态、三线四页+许可徽标+上下文展开+modelSend 未授权可见、390px×3 零溢出、匿名 /voc 不泄漏、0 控制台错误；截图 .data/_diag/r57/）；一/二线回归未重跑（本轮零共享文件改动，既有 16/16+9/9 证据仍有效）。**真实价值指标**：30 题/70 答（接受 18）/94 评论；极性 正13/负1/混10/中6；类目 设置咨询19/选购14/正面14/故障12/噪音11/兼容10/清洁8；27/30 有回答、5 条提问者后续。**判定**：VOC_INCREMENTAL_ENGINEERING=PASS（隔离+真实连通）、VOC_NATURAL_INCREMENT=NOT_RUN（观察期未过，无自然新增不伪造）、VOC_SOURCE_ACCESS=PASS（API 免费配额内实测连通）、VOC_MODEL_SEND_ELIGIBILITY=BLOCKED（政策明确限制+¥0）、VOC_EVAL_SAMPLE_FREEZE=PASS（10/10 modelSend=false 复核）、VOC_CHINESE_L2_REAL_QUALITY=BLOCKED、VOC_RESEARCH_L3_REAL_QUALITY=BLOCKED、VOC_CHINESE_AUTOMATION=BLOCKED、VOC_HUMAN_REVIEW=NOT_RUN、VOC_HUMAN_WORKLOAD=NOT_RUN、VOC_ENGINEERING_DELIVERY=PASS、VOC_PRODUCT=BLOCKED；POLICY_ENGINEERING=COMPLETE/POLICY_OPERATIONS=OBSERVING（窗口 2026-11-01 01:04 未到期）、INDUSTRY_ENGINEERING=COMPLETE/INDUSTRY_OPERATIONS=OBSERVING（窗口 03:06 未到期）、INDUSTRY_BUDGET=PASS（16 次 ¥0.2028 未动）、POLICY_BUDGET=PASS（0/40 未动）、VOC_MODEL_BUDGET=PASS（¥0）。**Git**：本轮新增 voc-increment.ts/voc-eval.ts/2 CLI/tests/voc-increment.test.ts + 修改 voc-model/voc-stackexchange/voc-ingest（存量混有前几轮未提交成果，不可安全分割提交——维持工作区，交付清单见报告）。3010 未触碰。）
> VOC 中文智能研究 V1（2026-10-25 21:30，¥0 模型费用——真实 DeepSeek 试验 BLOCKED，工程闭环 PASS）：**A 官方文档核实**（api-docs.deepseek.com 实抓）：当前模型 `deepseek-flash`（DeepSeek-V4.1-Flash-1017）；思考默认开启 effort=high，L2 须显式关闭 `extra_body={"thinking":{"type":"disabled"}}`（已入 ChatJsonOptions.extraBody 并折入回执 identity——开关变化即不同逻辑请求）；价格峰谷差 2 倍，核价取峰+未命中保守值 ¥2.5/M 入、¥9/M 出（≈7.1 CNY/USD）。**B 样本冻结**：预锁规则（6 难度类各取最新 + 补足）→ **10 样本**（正面 1/负面故障 6/设置咨询 1/选购比较 1/混合 1/上下文不足 1... 实际按 L1 分布）→ settings `voc.eval.grinder-v1` + `.data/_diag/r56/frozen-samples.json`；modelSend **0/10**（SE 批次未授权——真实处理 BLOCKED 之一）。**C 成本估算**（峰+未命中保守）：10 样本最坏 ≈ **¥0.158**，¥0.50/30 次窗口可覆盖 ✓。**D 双重门禁**：`voc-budget.ts`（独立账本：窗口缺失/上限 0/到期/用途不符均在发送前拒绝；环境默认 0 上限=未授权）+ `VOC_PURPOSES`（voc_l2/voc_l3）+ `paidLaneOf` voc 车道 + llm.ts 路由（reserve/settle voc 分支）+ **extraBody 折入 identity**。**E L2/L3 闭环**：`voc-l2l3.ts`——buildL2Context（许可未知材料不送模型→结果标 partial）、L2Output zod schema（viewpointType/experienceType/resolutionStatus 枚举 + citationIds）、引用校验（citationIds ⊆ contextIds + 集合非空）、发明数字校验（source 外数值→拒绝）、L2 存储绑定 inputRevision、复用（同版本+模型+模式+提示词→零网络）、L3 按痛点组（引用 ⊆ 组内 articleId + 市场规模声明拒绝），`processVocPending` 批量入口（租约+限额）。**F 零费用隔离测试**：19/19 全过——门禁 1（通道关闭零网络）/门禁 2（无窗口+上限 0）/门禁 3（modelSend 未授权，预算充足也不放行）/到期/用途不符/双重授权伪服务成功（L2 入库绑版本、复用零网络）/引用伪造拒绝（删除复用+删回执后走真调用路径）。**applyImport 人工决定保护修复**：重导入不再无条件重置 review——有决定→REVIEW_REQUIRED，无变化→完全不动。**页面**：研究页 modelLane 状态与处理说明（v1 最小，L2 展示待模型授权后补齐）。**判定**：VOC_MODEL_GATE=PASS、VOC_MODEL_BUDGET=PASS（门禁实测；窗口 ¥0 未建立=如实）、VOC_MODEL_PERMISSION=PASS（逐条 modelSend 门禁实测）、CHINESE_L2=BLOCKED、RESEARCH_L3=BLOCKED、CITATION_VALIDATION=PASS（隔离测试）、CHINESE_AUTOMATION=BLOCKED、HUMAN_REVIEW=NOT_RUN（无真实用户）、HUMAN_WORKLOAD=NOT_RUN、VOC_PRODUCT=BLOCKED。**真实 DeepSeek 试验 BLOCKED 之双门**：① ¥0 预算（建议窗口 ¥0.50/30 次——最坏估算 ¥0.158 可覆盖）；② SE 批次 modelSend 未授权（CC BY-SA 对模型外发适用条件未核实）。两者独立缺一不可，均已如实记录。
> VOC 中文智能研究 V1（2026-10-25 21:30，¥0 模型费用——真实 DeepSeek 试验 BLOCKED，工程闭环 PASS）：**A 官方文档核实**（api-docs.deepseek.com 实抓）：当前模型 `deepseek-flash`（DeepSeek-V4.1-Flash-1017）；思考默认开启 effort=high，L2 须显式关闭 `extra_body={"thinking":{"type":"disabled"}}`（已入 ChatJsonOptions.extraBody 并折入回执 identity——开关变化即不同逻辑请求）；价格峰谷差 2 倍，核价取峰+未命中保守值 ¥2.5/M 入、¥9/M 出（≈7.1 CNY/USD）。**B 样本冻结**：预锁规则（6 难度类各取最新 + 补足）→ **10 样本**（正面 1/负面故障 6/设置咨询 1/选购比较 1/混合 1/上下文不足 1... 实际按 L1 分布）→ settings `voc.eval.grinder-v1` + `.data/_diag/r56/frozen-samples.json`；modelSend **0/10**（SE 批次未授权——真实处理 BLOCKED 之一）。**C 成本估算**（峰+未命中保守）：10 样本最坏 ≈ **¥0.158**，¥0.50/30 次窗口可覆盖 ✓。**D 双重门禁**：`voc-budget.ts`（独立账本：窗口缺失/上限 0/到期/用途不符均在发送前拒绝；环境默认 0 上限=未授权）+ `VOC_PURPOSES`（voc_l2/voc_l3）+ `paidLaneOf` voc 车道 + llm.ts 路由（reserve/settle voc 分支）+ **extraBody 折入 identity**。**E L2/L3 闭环**：`voc-l2l3.ts`——buildL2Context（许可未知材料不送模型→结果标 partial）、L2Output zod schema（viewpointType/experienceType/resolutionStatus 枚举 + citationIds）、引用校验（citationIds ⊆ contextIds + 集合非空）、发明数字校验（source 外数值→拒绝）、L2 存储绑定 inputRevision、复用（同版本+模型+模式+提示词→零网络）、L3 按痛点组（引用 ⊆ 组内 articleId + 市场规模声明拒绝），`processVocPending` 批量入口（租约+限额）。**F 零费用隔离测试**：19/19 全过——门禁 1（通道关闭零网络）/门禁 2（无窗口+上限 0）/门禁 3（modelSend 未授权，预算充足也不放行）/到期/用途不符/双重授权伪服务成功（L2 入库绑版本、复用零网络）/引用伪造拒绝（删除复用+删回执后走真调用路径）。**applyImport 人工决定保护修复**：重导入不再无条件重置 review——有决定→REVIEW_REQUIRED，无变化→完全不动。**页面**：研究页 modelLane 状态与处理说明（v1 最小，L2 展示待模型授权后补齐）。**判定**：VOC_MODEL_GATE=PASS、VOC_MODEL_BUDGET=PASS（门禁实测；窗口 ¥0 未建立=如实）、VOC_MODEL_PERMISSION=PASS（逐条 modelSend 门禁实测）、CHINESE_L2=BLOCKED、RESEARCH_L3=BLOCKED、CITATION_VALIDATION=PASS（隔离测试）、CHINESE_AUTOMATION=BLOCKED、HUMAN_REVIEW=NOT_RUN（无真实用户）、HUMAN_WORKLOAD=NOT_RUN、VOC_PRODUCT=BLOCKED。**真实 DeepSeek 试验 BLOCKED 之双门**：① ¥0 预算（建议窗口 ¥0.50/30 次——最坏估算 ¥0.158 可覆盖）；② SE 批次 modelSend 未授权（CC BY-SA 对模型外发适用条件未核实）。两者独立缺一不可，均已如实记录。
> 许可链最终收口（2026-10-25 20:30，用户授权一次性执行，¥0 模型费用）：**① 嵌套导出权限修复**：exportVocMarkdown 重写为逐条材料判定——问题正文按问题自身许可、每条回答按该回答许可（附 `[版本](/a/{id})` 署名链接）、两级评论按各自许可；许可缺失的正文不输出但保留关系条目与缺口说明（问题正文缺失记「许可待核实未导出」）；**修复 stripTags 空值 SSR 500**（一条问题正文缺失致导出 500）。**② 回答许可回填**：受控备份（30 条 raw.voc 快照 .data/_diag/r55/backup-voc-before-license-backfill.json）→ 幂等重导入 → **70/70 回答许可入库，实测 3.0×42 + 4.0×28 混合**；幂等复跑 0 变更；applyImport 人工决定保护修复（有决定→REVIEW_REQUIRED 而非覆盖；无变化→review 完全不动）。**③ 评论许可补齐**：SE 官方 API 确认评论对象含 content_license → 有界补取 **2/10 请求**（qcomments+acomments 各 1 页）→ **94/94 全部补齐**（comment_id 精确匹配，缺失保持未知）→ 同批幂等入库。**最终许可覆盖：193/194**（问题 29+1 未知、回答 70/70、问题评论 34/34、回答评论 60/60；唯一未知=一条问题许可 API 未返回，正文已按规则不导出、私有读取保留、徽标显示「许可待核实」）。**④ 受管重启**：单 PID 绝对路径核验（4268→taskkill→radar-local start 仅补 API）→ 新 PID 25760 绝对路径同仓 → API/Web 200。**⑤ 正式实例验收**：泄漏防护实测（null 许可问题正文不在导出、私有读取保留该记录、回答许可 70 条逐条可读）；浏览器 15/15 + 许可徽标专项（3.0✓ 4.0✓ 记录级待核实✓）；一/二线回归 30/30+9/9；VOC 14/14。**预算**：SE 新增 2 请求（10 上限内）；DeepSeek 0 调用；一线/二线预算分文未动。**判定**：VOC_LICENSE_RUNTIME=PASS、VOC_LICENSE_DATA=PASS（唯一未知如实保留）、VOC_LICENSE_EXPORT=PASS。L2/L3、增量、自然观察维持原状不变。
> 许可完整性与请求账目定向修复（2026-10-25 19:55，¥0）：**任务A（逐条许可）**——审计发现回答层许可在历史采集文件中完整（threads.json 70/70 有 content_license）但解析层丢弃；修复 parseSeQuestion/VocThread/VocThreadAnswer/评论结构携带逐条 `contentLicense`（缺失保持 undefined 永不继承父级）；读取层 threadView 逐条透传；导出门槛升级：问题许可缺失的记录排除导出并在脚注注明「许可字段缺失待核实」（私有读取保留）；证据页展示逐条许可徽标（缺失→「许可待核实」）；重导入许可变化经 stableJson 哈希识别为修订（jsonb 键序不稳定→哈希比较）。**重要发现**：回答许可为 3.0/4.0 混合（证实不可硬编码 4.0）。**正式库未回填**（30 条记录的回答许可仍在 threads.json 待一次授权导入；评论级许可在采集脚本中未保存——94 条缺口，可恢复方式=补 4 次评论端点请求的授权重取）。**任务B（请求账目）**——还原口径：`4`=上下文阶段 4 请求（questions/answers/qcomments/acomments，collect-state.json 在案）；`6`=采集任务全程 2 发现+4 上下文（run1 崩溃致发现请求未入 state 但 candidates.json 在案）；另有更早预检探针 6 请求（独立脚本，未入 state）。**统一定义**：本轮采集任务实际 HTTP 请求=6，含预检全周期=12。**验证状态**：修复后类型检查与构建通过、隔离测试跑到 12/14（2 处为测试夹具缺陷已修+1 处文档缺口已修）后 **node_modules 于 19:51 被外部清空**（仅余 4 目录，非本会话操作），复验被迫中止——修复后全套复验（VOC 14 测试+构建）标记 NOT_RUN 待环境恢复；正式服务为已加载代码的内存态，模块懒加载可能受影响，建议环境恢复后经受管入口核查。新增文件改动：voc-model/voc-stackexchange/voc-read/contracts/voc-evidence 页面/tests。
> 第三主线首批真实闭环（2026-10-25 12:40，用户授权一次性执行，¥0 模型费用）：**来源正式启用**：`voc-coffee-se`（Stack Exchange Coffee 站官方 API，kind=json_list——ruleOnlyMode 通用调度不消费该类型，无 Worker 自动消费，仅受管一次性脚本写入；enabled=true）。**有界采集**：发现 84 题（票数榜+近期榜各一页）→ 多样性选题 30（票数 0~18、无回答 3 个、时间跨 2015-01~2025-10）→ 全上下文获取，**实际 API 请求 6/120**（search×2 + questions + answers + qcomments + acomments），无 backoff 触发、无 429、无重试。**真实入库 30 条**（幂等复跑 0 新增验证通过）：问题 30 + 回答 70（含接受 18）+ 问题评论 34 + 回答评论 60，**全部上下文逐条持久化**。**许可**：逐条记录 API 返回的 `content_license` 字段（29 条 CC BY-SA、1 条缺失记 null 不按全权限处理）；批次授权 store/privateRead/display/export，**modelSend 未授权**（CC BY-SA 对模型外发的适用条件未核实+本线 ¥0）。**L1 真实分布**：负 1/正 13/中性 6/混合 10；类目 使用与设置咨询 19、选购与比较 14、正面体验 14、故障与失效 12、噪音与静电 11、兼容与配件 10、清洁与维护 8；年代 2015×11→2025×2；主题相关 28/30。**解决状态如实**：30 条全部「未知」——提问者后续 6 条存在但无一含明确「已解决」自述（严格正则零误判，接受答案≠解决）；上下文充分仅 4 条。**工程修复 4 处**：① VocThread 补问题级 comments（首轮发现 34 条上下文丢失）；② 重导入合并新 thread（否则后采集的更丰富上下文永远到不了已存记录）+ stableJson 哈希比较（jsonb 键序不稳定）；③ stripHtml 空值防御（SSR 500 修复）；④ VOC 页面 loader 改 vocGet 转发访客会话 + 证据页新增可展开讨论上下文（问题/回答/评论/署名/许可/原文链接）。**浏览器验收 15/15**（真实密码登录流、总览真实数据、证据展开、来源/批次/许可可见、手机、匿名 401、0 控制台错误）；测试 VOC 10/10 + 一二线回归 35/35；双预算分文未动（一线 0/40、二线 16/120 ¥0.2028）；DeepSeek 0 调用。**未验证/阻塞**：L2/L3（¥0）、增量 Worker 与自然新增（未建未观察）、登录态页面截图已存 .data/_diag/r55/。诊断件 .data/_diag/r55/（采集脚本、threads.json、状态）。
> 第三主线（消费者原声）工程框架交付（2026-10-25 11:30，¥0 模型费用、零正式库写入、未执行迁移、未 Git 提交）：在用户确认二线 PARTIAL 局限并授权三线隔离实施后执行。**已建成**：① 数据模型完全复用现有表（articles.raw.voc / settings voc.study.*·voc.batch.* / stories lane=voc），零迁移；② SE Coffee 官方 API 适配器（免费无 key、300 请求/日/IP、CC BY-SA 4.0 署名条款、grinder 标签 84 题预检在案；RSS 被 WAF 拦=不可用，不伪装）——**正式来源未开启（无授权，enabled=false），未取得任何真实材料**；③ 授权导入管线（预检→应用→幂等→批次用途矩阵：store/privateRead/modelSend/export/display 五用途分立）；④ L1 确定性分类（7 类目正则+语言识别+极性+待复核标记）；⑤ L2/L3 受管入口**默认关闭**（VOC_MODEL_ENABLED，¥0 授权，拒绝时零网络调用）；⑥ 痛点确定性归并（产品×场景×问题类别键+stories/facts 证据脊柱）；⑦ 人工决定记录（版本原子校验，材料变更→REVIEW_REQUIRED）；⑧ 批次撤销原子传播（SQL 条件更新：仅剩批次撤销→材料失效、共享批次按剩余重算、旧任务回写被拒、导出排除）；⑨ 私有 API（adminHandler 会话守卫）+ 4 页面覆盖六区域（/voc 总览、/voc/evidence 证据库+筛选、/voc/research 痛点+需求（候选假设不冒充已证实）、/voc/system 来源+批次+历史）。**验证**：隔离测试 10/10（SE 解析/接受答案≠已解决/L1/导入幂等/多批次并集/撤销传播+旧回写拒绝/审核版本原子/痛点归并+幂等/模型通道关闭拒绝/总览口径）；真实 Chrome 17/17（双临时实例 3011 devAdmin+3012 匿名证明匿名 401 拒绝+导出拒绝、临时 Web 3002、正式 3000/3001 全程未动最终只读回归；¥0 声明、空态如实、390 无溢出、0 控制台错误）；一二线回归 14/14+16/16，双预算分文未动（一线 0/40 ¥0、二线 16/120 ¥0.2028）。**验收判定**：VOC_ENGINEERING_DELIVERY=PARTIAL（框架+导入+安全完成；增量 Worker 未建待正式启用授权）、VOC_HISTORICAL_RESEARCH=NOT_RUN（无采集授权）、VOC_SOURCE_ACCESS=PARTIAL（预检可访问，未获开启）、VOC_INCREMENTAL_ENGINEERING=NOT_RUN、VOC_NATURAL_INCREMENT_OBSERVED=NOT_RUN、VOC_CHINESE_L1=PASS、VOC_CHINESE_L2=BLOCKED(¥0)、VOC_RESEARCH_L3=BLOCKED、VOC_CHINESE_AUTOMATION=BLOCKED、VOC_HUMAN_WORKLOAD=NOT_RUN、VOC_ACCESS_CONTROL=PASS（匿名 401 实测）、VOC_EVIDENCE_REVOCATION=PASS（原子传播实测）、VOC_OPERATIONS=NOT_STARTED。VOC_PRODUCT=BLOCKED（无获准真实材料路径）。**待授权清单**：① 开启 SE 正式来源+首次有界历史采集（300/日配额内约 84 题×3 请求）；② 第三主线独立模型预算窗口（L2/L3 才能解除 BLOCKED）；③ Git 本地提交。**执行事故如实披露**：临时实例清理时相对路径命令行导致误判，taskkill 误杀正式 API 3001（52444），2 分钟内经 radar-local start 受管补起，前后只读核对确认数据与服务无恙；诊断脚本 .data/_diag/r54/。
> 合规收口（2026-10-25 09:30，BTS 访问方式合规审查，零付费零功能变更）：① **依据核实**——BEA（商务部经济分析局）与 FRB（美联储理事会）为美国联邦政府机构，其官方作品依 17 U.S.C. §105 属公有领域，且两者对默认爬虫 UA 无 WAF 拦截（接入方式无规避），权限档案维持全权限；USA.gov government-copyright 页确认 U.S. government work 版权框架。BTS（DOT 交通统计局）内容同为公有领域，但其站点 WAF 明确拦截自报身份的爬虫 UA（实测 403）而放行浏览器 UA——上一轮改用浏览器 UA 属于规避 WAF 拦截，未取得 BTS 官方对该访问方式的明确授权。② **决定：停用 BTS 自动采集**——sources.enabled=false（调度实测 enqueued=0、Worker 重启后零调度零 fetch_runs）、权限档案改 suspended（discovery/saveExcerpt/modelProcessing/display 全关，2 篇待处理条目不再进付费队列）、rss.ts 移除按源 userAgent 配置能力、config-keys 撤销 userAgent 白名单键（该能力唯一用途即规避 WAF，不保留）；10 篇历史文章、事件、配置全部保留不删。③ **验证**——行业测试 16/16（权限断言更新为 BEA+FRB 两全权限源）；FRB 对照调度正常（enqueued=1）；预算零新增（16 次 ¥0.2028 不变）；第一主线 0/40 未动。④ **中文覆盖量修正**——全权限源 = BEA+FRB（2 个，仍满足「至少两个」的准入底线）；完整中文 12 条（BEA 7/7 + FRB 5/7 准入全处理；FRB 20 条中仅 5 条准入是门禁语义而非处理缺失）；BTS 2 条准入条目随来源停用不再处理，保留为原文摘要状态。内容覆盖判定维持 PARTIAL。
> 内容与体验修复（2026-10-25 08:30，中文内容与前端一次性修复，未提交）：① **信源扩容**：准入两个美国政府全权限来源——美联储理事会新闻（federalreserve.gov，公有领域，20 条，robots 无限制）与交通统计局（bts.gov，公有领域，10 条，robots 放行 /rss.xml；站点 WAF 拦自报爬虫 UA，按源配置浏览器 UA 访问同一官方 feed 入口）；Census/Commerce 403、USDA 空 feed、ITA 过期，记为边界。现全权限源 = BEA+FRB+BTS（3 个），满足"至少两个"要求。② **门禁修正**：补 FRB 宏观信号词（FOMC/经济预测/消费者金融调查/贴现率）；修 `port` 缺词边界致 "airport" 误命中（BTS 航空运营条目由 6→2，仅货运 TSI 保留）；精选与计数只认含准入文章的事件。③ **rss 适配器支持按源 UA**（config.userAgent，白名单键），BTS 403 解决。④ **中文处理**：真实调用 5 次 ¥0.0097（样本验证+批处理，FOMC 纪要条目正确拒绝编造内容）；预算累计 **16 次 ¥0.2028/¥3**，窗口内剩 104 次 ¥2.7972；中文内容 12 条（BEA 7/7 + FRB 5/5 全覆盖，BTS 2 条待明日窗口）；每北京日 15 篇上限正确触发。⑤ **前端**：列表改中文优先双分区（完整中文情报 12 带摘要速读 + 仅标题线索 20 带许可说明），详情页三态（中文速读/处理排队中/限制准入说明），读取层加 zhSummary（译文前两段）与中文优先排序；浏览器验收 **17/17**（宽度 1204 四页一致、手机 390 零溢出、筛选/导出/第一主线回归/0 控制台错误）；行业测试 16/16（权限断言更新为三政府源）、第一主线翻译测试 9/9。页面截图 .data/_diag/r53/final-shots/10-13。
> 复核（2026-10-25 05:30，定向复核与收口，零新增付费）：**任务A（事件误归并）**——25 起"误归并"实为一次性回填脚本传入空事件键产生的 25 个重复故事，经 mergeIndustryStory 结构性合并纠正，原始文章 40 篇零删除；正式库当前 0 空键、0 活跃重复键、0 孤儿 facts/publications、每准入文章恰链 1 活跃事件；遗留 32 条冗余 facts（三路径日期基准分歧所致，内容完全相同、关系无害）——精确清单在 .data/_diag/r53/，清理需单独授权。根因已修：空/缺键拒绝 + 事件键事务咨询锁（并发单故事）+ 日期基准统一为 published_at + 全停用词标题键回退；隔离测试新增五情形矩阵（同URL同文/同URL修订/同事件多源/同公司不同事件/新进展）+ 空键拒绝 + 并发 + 幂等，共 16/16 通过。**任务B（模型账目）**——11 次真实 API 调用 = 10 张回执 + 1 张两次尝试（attempts 表 11 行逐一对应）；回执真实用量 in 3,634 / out 3,347 ≈ **¥0.0340**；账面 ¥0.1931 系 reuse 缓存响应被重复结算（调试期同文章多轮重跑）多计约 5.7 倍——方向保守（只多不少，上限安全）但账目失真；已修：reuse 不再结算（llm.ts），隔离测试验证 provider 恰 1 次命中、账本零重复；账面历史值保留不动（不回调、不清零、不释放额度），可用额度仍按账面 ¥2.8069/109 次从严执行。门禁复核：¥3/120 次/到期/用途白名单/池隔离全部有效，paidRequest 预算咨询锁串行化并发，重启不重置（settings）。**任务C（权限与口径）**——发现并修复 1 起真实权限违规：Modern Retail feed 自带 content:encoded 全文（2/10 条）经 RSS 适配器以 bodyText 落库（store 只剥了 excerpt 未剥正文，读取层从未展示）；修复 = stripUnlicensedContent 助手（excerpt/bodyText/bodyHtml/bodyStatus 全剥）+ 正式库精确清除 2 行（快照留证 .data/_diag/r53/restricted-body-cleanup-snapshot.json）+ 定向测试（真实 feed 验证剥离）；现非 BEA 源正文/摘要 = 0。口径澄清：25 篇准入（2 篇双主题）→ 主题命中 28 次 / 独立事件 25 个（页面 counts.stories 一直显示独立事件数，无误导）；五主题独立事件 11/7/6/2/2；BEA 7 准入 7 中文（100%），三媒体 18 准入 0 中文（许可边界）。行业 Worker 已受控重启加载全部修复（pid 22748）；第一主线回归 14/14，¥1 窗口 0/40 未动。判定：EVENT_IDENTITY = PASS（根因已修+防线测试）、INDUSTRY_BUDGET_LEDGER = PASS（账实差异已定源、已修、口径已分列）、INDUSTRY_CONTENT_ACCURACY = PASS（违规已清+口径已正）。LANE2 三状态不变：ENGINEERING=COMPLETE / CONTENT=PARTIAL（许可）/ OPERATIONS=OBSERVING。
>
> 上一轮（R52 收官 + 授权执行，2026-10-25）：第一主线工程收官、AMZ123 双栏收口、增量核验、四组提交 + 七天翻译观察窗口启用（first-lane-7d-20261025）。
> 上一轮（R52 收官，2026-10-25 00:20–01:30）：第一主线最终工程收官 + AMZ123 双栏目收口 + 增量采集核验——五来源 30 天 0 漏收、零新增官方来源、质量分类与产品验收 20/20、增量核验 PASS（详见下文 R52 节）。
>
> 更早（R51，2026-10-24 22:00–23:55）：第一主线版本安全收口与自动翻译启用准备——进程身份斜杠修复、可双击翻译入口、Git 盘点与提交方案。
>
> 更早（R50，2026-10-24 20:45–21:50）：第一主线正式运行能力收口——自动翻译接入运行管理体系与正式库实测。

## 本轮任务

**R52（2026-10-25 00:20–01:30）：第一主线最终工程收官 + AMZ123 双栏目收口**，见 DONE 首表。目标：来源覆盖审计与漏收对照、AMZ123 /t+/kx 双栏核查、质量分类、当天工程验证、成本报告、Git 增量核对、最终产品验收，给出可停止开发的结论。**零代码改动、零新增付费、不执行 Git 写操作、不伪造七天观察。**

### 七天运行观察（R52 起，自然时间累计）

- **观察什么**：五个官方/监管来源每天的实际运行次数 vs 应运行次数（fee/CPSC 各 24、联邦公报各 12、公告 4、AMZ123 4）、失败是否留痕、新文章是否被发现并正确翻译、翻译费用是否受控。
- **怎么查**：`status-radar.cmd`（五来源最近采集与逾期标记）+ `node --env-file=.env scripts/radar-ops.ts status`（详细）；数据在 `fetch_runs`（每次运行的来源/状态/新增/错误）与 `job_runs`。
- **怎么判定**：A 源站无新内容（官方列表核对为空）/ B 有新内容被正确过滤（门禁记录）/ C 漏收 / D Worker 没运行（锁+心跳）/ E 网络或源站故障（fetch_runs 失败记录）——不允许都显示为「0 新增，运行正常」。
- 七天内没有自然新增政策不算失败，但必须用官方源站列表核对确认是「正常零新增」而不是漏收。

> 前一轮（R51，2026-10-24 22:00–23:55）：第一主线版本安全收口与自动翻译启用准备，见 DONE。
>
> 更早（R50，2026-10-24 20:45–21:50）：第一主线正式运行能力收口——自动翻译接入运行管理体系与正式库实测，见 DONE。
>
> 更早（R49，2026-10-24 18:50–19:40）：自动中文化隔离验证与正式受控试运行，见 DONE。
>
> 更早（R48，2026-10-24 16:45–18:20）：中文阅读质量收口与自动翻译运行隔离。

第二十二轮：让已经采到的 AMZ123 线索**真正看得见、用得上**——① 在 3000 导航新增独立的「政策线索」入口（列表 + 详情，有效候选与已排除分开）；② 用受现有边界约束的只读接口暴露白名单元数据，不新建表、不写 publication、不改发布规则；③ 把「来源已启用 / Worker 真实运行 / 最近一次采集结果」三件事分开显示，并受控启动专用 Worker 做真实观察。**只做最小必要实现，做完收口。**

> 上一轮（第二十一轮）原文：只做三件具体事——① 安全执行开发库缺失的 **0090** 迁移（先备份、先核验范围）；② 让第二十轮已修好、但被旧游标记为「已拒」的付费邀评报道 `https://www.amz123.com/t/zDrc37rW` **按新规则真实重采入库**（只移除这一条拒绝身份，不改 pending/sitemap/initializedAt）；③ 删除第二十轮验收用的隔离库 `lightchoice_radar_r20_ci`。**不新增功能、不重构、不扩大采集范围。**

> 更早（第十九轮）原文：让 AMZ123 线索源具备**真正独立、可长期常驻**的运行能力——新建只消费线索队列的专用 Worker 入口 `radar-amz123-leads`（物理上不注册任何官方队列），把线索源的调度/采集逻辑抽到共享实现供两个入口复用；并在隔离库真实演练 0090 迁移 + 一处最小代码修正（阻止摘要再落进 `body_text` 列）。

> 背景（第十八轮）原文：按已批准的「有条件接入」结论，把 AMZ123 正式接入为**第三方政策线索源**——每 6 小时一轮增量发现，只落元数据与官方核实状态，不保存正文、不写正式政策事实记录、不改三类统计口径；复用现有 `articles` 隔离型来源路径，不新增表、不建第二事实库。

## DONE

### R52（2026-10-25 00:20–01:30）：第一主线最终工程收官与 AMZ123 双栏目收口

**一、来源覆盖审计（30 天窗口：2026-09-24 ～ 10-24，官方源站实时对照）**

| 来源 | 窗口内官方实际 | 系统结果 | 判定 |
|---|---|---|---|
| sell.amazon.com/blog/announcements | 每轮列表 11 条候选；最新一条 Sep 23（营销） | 6 条被正文门禁按理由拒绝（gate memory 在案），2 条政策相关已收录 | 无漏收；排除正确 |
| sellingpartners.aboutamazon.com 费用系列 | 列表 9 条中唯一命中白名单前缀的是 2025-10 年度费用更新 | 已收录 | 无漏收；8 条营销正确排除 |
| us-federal-register-cpsc | 2 份（10-19 解释、10-05 锂电池拟议） | 2 份全收 | 无漏收 |
| us-federal-register-ftc | 5 份（含 2 份公民请愿） | 2 收；2 份请愿被噪声过滤正确排除；1 份（2026-19597「Rules of Practice」续篇）被「information collection」标记边缘误伤——与已收 2026-19598 **同属 RIN 3084-AB85**（一条规则拆两个文件号连排），实质主题已覆盖 | 已知边缘案例，不改过滤器 |
| rss-cpsc-recalls | RSS 40 条（9-24～10-22） | 初始导入 15 条（设计上限）；导入后最新批次（10-22 的 5 条）全部即时捕获 | 无进行中漏收；24 条窗口内较旧条目属初始导入上限（已知限制，其中 2 条 Amazon 在售商品召回已单独记录供人工留意） |

- **A4 结论：零新增官方来源**。审计未发现「明显、持续、对卖家有价值且可合法公开采集」的缺口；候选 B 类（FTC 新闻 feed、sellingpartners 主站营销内容）与 C 类边界（Seller Central 登录内容、帮助页静默编辑无发现机制）如实记录，不为凑数量接入。
- **覆盖边界（如实）**：Seller Central 站内新闻/账户通知需登录，不可合法自动获取；公开帮助页可读但变更无发现机制（静默编辑）；Ads 政策来源保持停用（启用需单独授权）；AMZ123 仅作第三方线索。

**二、AMZ123 双栏目（补充任务：验证收口，零代码改动）**

- 双栏发现在 R24 已实现且每轮同抓：`AMZ123_SECTIONS` 定义 `/t`（跨境头条·主来源）与 `/kx`（跨境快讯·补充来源），每轮读 robots → 双列表 → 近 7 天 sitemap 兜底。
- **今日实况**（2026-10-25 00:50）：robots 48 条规则、/t 与 /kx 均放行；/t 列表解析 4 条、/kx 123 条；耗时 robots 189ms + 各列表约 300ms。
- 运行诊断（run #178）：发现 119、页读 25、拒绝 24 条（无规则命中 23 + 无政策措辞 1）、pending 13、失败 0。
- 库内 4 条：/t 3 条有效线索（1 条 matched-official + 2 条 third-party-only）+ /kx 1 条（企业财报，`processing_state='skipped'`、默认列表不展示，为 R20 门禁修复的保留排除样本）；AMZ123 publications 恒 0（严格隔离）。
- 隔离测试 **32/32**：双栏准入、URL 唯一身份、跨栏事件归并（domain+日期/文件号+标题相似度三重条件）、robots 代码级强制、只存元数据不存正文。
- 每轮耗时实测 14–19 秒、约 4–30 个 HTTP 请求；无模型调用（门禁全规则判定）。

**三、质量分类（只读；统计范围：正式池 + 线索池，截至 2026-10-25 01:00）**

| 类别 | 数量 | 说明 |
|---|---|---|
| 第一类：Amazon 平台政策 | **3** | 公告博客 2 + 年度费用更新 1；全部 public、全部中文标题 |
| 第二类：美国监管与产品合规 | **20** | CPSC 召回 15（具体事件：产品/危险/处理方式）+ 联邦公报 5（2 Rules + 3 拟议规则，拟议徽标独立标注） |
| 第三类：第三方线索 | **4**（3 有效 + 1 排除） | 独立存储、独立展示、不进发布池（publications=0）、官方核实状态逐条保留 |
| 中文标题 / 中文摘要 | 23 / 21 | 与 R51 基线一致，0 重复付费 |
| 解释（重点速读/关键信息）覆盖 | 9/23 | 历史文章未全量补写（工具在）；新文章由 Worker 分析自动生成 |
| 错收/重复 | **0** | URL 身份键全局唯一；无同 URL 多记录 |
| 日期异常 | **0** | 无未来日期、无缺失、无异常旧文 |
| 真实漏收 | **0**（进行中） | 30 天窗口官方对照；CPSC 24 条初始导入窗口外条目为设计行为 |

**四、当天工程验证（15/15，全部有真实或既有证据）**

冷启动 ✓（R51 实测）；幂等重启 ✓；按配置调度 ✓（24h 79 次运行与各源间隔一致）；**304 条件请求不误报** ✓（RSS 游标 ETag/If-Modified-Since，`notModified` 路径，rss.ts:152-166）；去重 ✓（URL 身份键 + 测试守卫）；失败留痕 ✓（fetch_runs 错误+时间）；Worker 停止后恢复 ✓；来源异常显示 ✓（health/last_error）；停翻译不停采集 ✓（R51 实测）；进程与状态页一致 ✓（含 R51 反斜杠身份修复）；预算耗尽拒发 ✓；页面读中文 ✓；正常关机数据安全 ✓（PostgreSQL WAL + 多轮启停无损坏）；无 WT 弹窗 ✓（CREATE_NO_WINDOW）；3010 无影响 ✓（进程清单确认）。

**五、成本报告（近 24h 实测 + 累计）**

| 项 | 数值 |
|---|---|
| 官方源 HTTP 采集 | 79 次运行/24h（fee 23、CPSC 24、FR 12+12、公告 4、AMZ123 4），失败 1 且有记录；每轮约 1 个请求 + 新文章详情页 |
| DeepSeek 调用 | 累计 44 次（标题 23 + 摘要 21），**本轮 0 次** |
| Token | 累计 25,213（23,449 入 + 1,764 出） |
| 费用 | 累计 ¥0.0610（r45 ¥0.0193 + r47 ¥0.0417），**本轮 ¥0** |
| 本地资源 | 正式库 32 MB；pg-boss `created` 3,356（每分钟 +1 的定时扇出，14 天保留淘汰，有界增长） |
| 长期风险 | 无新增；历史队列积压按 R50 结论保留（不授权清理） |

**六、最终产品验收（20/20，真实 Chrome）**

G1 用户流程：列表 40 卡片 + 分类标识（平台政策/美国监管/召回/线索）✓、中文标题/重点速读/关键信息（带依据）✓、无后台术语 ✓、打开原文 ✓、线索页来源状态与栏目区分 ✓、1440/390 无溢出 ✓。G2 反例：召回页来源标注「CPSC 官方产品召回」+ 发布机构「美国消费品安全委员会（CPSC）」（非 Amazon）✓、机器翻译·未经人工核对徽标 ✓、仅有来源摘要没有完整正文 ✓、拟议徽标独立于生效 ✓、线索页「不是 Amazon 官方已确认的政策」✓、无人工核实冒充 ✓。意外控制台错误 0。

**七、Git 与最终判定**

- 增量核对：50 已跟踪修改 + 91 个未跟踪文件（较 R51 仅多 `start-radar-translate.cmd` / `stop-radar-translate.cmd`）；无并行 Agent、无密钥、诊断件在 `.data`（不入提交）。**沿用 R51 四分组提交方案**（① Worker+运维脚本+`.cmd` ② 后端+来源+迁移注释 ③ Web ④ 测试+文档），等待用户批准后执行本地提交。
- **`FIRST_LANE_ENGINEERING = COMPLETE`**（必要工程能力完成、验收通过、停止开发）
- **`FIRST_LANE_OPERATIONS = OBSERVING`**（七天自然运行观察开始，判定方法见「七天运行观察」节）
- **`FIRST_LANE = READY_FOR_FREEZE`**（观察期按期确认 + 用户批准 Git 提交后冻结）
- 已知限制（不构成继续开发的理由）：Seller Central 登录内容与帮助页静默编辑不可自动发现；正文转载未开放（来源许可依据未变）；CPSC 初始导入窗口外的 24 条历史条目未回填（2 条 Amazon 相关已记录）；解释覆盖 9/23；Ads 来源保持停用；正式付费翻译待用户单独批准（¥1/7 天/168 次建议方案不变）。

**R52 实际修改/新增的文件**

| 文件 | 改动 |
|---|---|
| `docs/radar/CURRENT.md` | 本节收官记录与七天观察判定方法 |
| `.data/_diag/r52/*` | 诊断件（**不入 Git**）：dump-sources.ts、audit-official-listings.ts、browser-final.mjs、shots/ |

（本轮**无源码改动**；工程能力全部复用 R24–R51 已验证实现。）

**增量采集核验补充（R52 收官补充任务，2026-10-25 01:50，零代码修改）**

「有更新才深入抓，没更新不重复抓详情」经逐来源核验**成立**，机制与运行证据：

- **决策链**（`collect.ts`）：列表条目按 URL 身份键比对 → 已存身份且 `source_updated_at` 未前进（`sitemapLastmodAdvanced`）→ 直接跳过详情（collect.ts:226）；只有 lastmod/更新时间**前进**才重读日期/标题/摘要/正文，且「lastmod 永不作发布日期」；内容修订由 `content_hash` 驱动新版本（materials.ts），仅更新时间变化「不是一次修订」（`refreshSourceUpdatedAt`）；已存译文按 `tr.revision >= a.revision` 失效。
- **运行证据（近 7 天）**：公告来源 4 轮稳态 `detailAttempts=0`（15 次详情读取全部发生在 10-22 初始化/门禁版本更新期）；费用来源 26 轮 0 详情重抓（无 detail 规则，列表即全部）；CPSC RSS 30 轮中 **21 次 HTTP 304**（`notModified=true` 记录为成功检查，不发详情不调模型）；联邦公报 16+16 轮全 200（API 不发验证器，1 请求/轮已是下限）且身份比对全已知零动作；AMZ123 13 轮 219 次页读全部为**新身份首次评估**（拒绝后进 400 条记忆，不再重读），robots+双列表+7 天 sitemap 兜底。
- **失败不冒充无更新**：RSS 304 路径、HTTP <500 非 404/408/425/429 的拒绝按规则记住、404/408/425/429/5xx/超时挂起重试（collect.ts:243-255）；失败分类七类（browser/blocked/budget/page/source-http/network/unknown）落 `fetch_runs.detail.failureClass`。近 7 天 4 次失败（amz123 网络 ×2、CPSC Worker 退出 ×1、历史社区源 ×1）均有记录，无 429/403/5xx。
- **/kx 挤出风险实测**：135 个时间戳跨 15.5 天 ≈ 每 2.75h 一条 → 每 6h 窗口约新增 2–3 条，列表窗口 123 条（≈15 天量）→ 风险≈0，**6 小时周期保持不变**；sitemap 含 /t 2000 + /kx 2000 URL 兜底。
- **按任务 B3 记录为边界（不开发）**：公告/费用列表与 AMZ123 页面不带 per-item 修订戳 → 静默正文修订不检测（无可靠来源信号；官方来源的实际修订模式是「新文档号/新召回 URL/Reannounces」，已被新身份路径捕获）；FR 源站不支持条件请求（无法实现 304）。
- 判定：`INCREMENTAL_DISCOVERY=PASS`、`NO_CHANGE_SKIP_DETAIL=PASS`、`SAME_URL_REVISION_DETECTION=PARTIAL`（官方修订模式已捕获，静默修订无信号为已记录边界）、`NO_DUPLICATE_PAID_TRANSLATION=PASS`、`FIRST_LANE_OPERATIONS=OBSERVING`（不变）。

### R51（2026-10-24 22:00–23:55）：第一主线版本安全收口与自动翻译启用准备

**一、Git 安全盘点（只读，未执行任何写操作）**

- 工作区：**50 个已跟踪修改（+1944/−315）+ 89 个未跟踪文件 = 139 个候选文件**（`docs/radar/` 目录整体未跟踪，内含 19 个文件——两份权威文档 CURRENT.md、本地运行说明.md + 17 份历史证据/交付记录；`git status` 显示 1 条 `?? docs/radar/` ≠ 1 个文件）。分支 `master`、HEAD `e7ae899` 不变。
- 敏感扫描：已跟踪 diff 与全部 89 个未跟踪文件无密钥模式（sk-、带凭据的 postgres://、Bearer、LLM_API_KEY 赋值均 0 命中）；`.gitignore` 已覆盖 `.env`/`.env.*`/`.data/`/`node_modules`；`.env.example` 差异只是注释新增。唯一空文件 `listing-urls.txt`（临时文件，排除）；`docs/radar/CURRENT.md.r19.bak`（备份，建议排除）。
- 异常检查：无删除/重命名条目；无空源码文件；`package.json` 只新增脚本命令、**无依赖变更**；`0090` 迁移只多一行 `-- atomic` 注释（SQL 未变，迁移安全测试的配套标记）；最近 6 小时源码目录无其他 Agent 写入（只有 `.react-router` 生成物）。
- **建议提交方案（待用户批准后执行，本轮未 add/commit）**：① worker 运行体系 + 本地运维脚本 + 三个旧 `.cmd`（apps/worker、scripts/、.cmd、apps/worker/package.json、.env.example）；② 后端来源/发布/规则/翻译（packages/*、industry/、database/migrations/0090 注释行、site/、apps/api）；③ Web 页面（apps/web）；④ 测试 + 文档（tests/、AGENTS.md、README.md、docs/radar/ 两份权威文档及历史证据文件）。排除 `listing-urls.txt`、`CURRENT.md.r19.bak`、`.data/_diag/`。诊断清单在 `.data/_diag/r51/git-inventory.txt`（**不是恢复点**）。

**二、任务 C：翻译进程身份专项（确认真实缺口并修复）**

- 实证：Windows 真实命令行是反斜杠（活体 Worker `...\apps\worker\src\main.ts`），而三处身份匹配都写成正斜杠——`radar-translate-state.ts` 的正则 `[\/]`（只匹配 `/`，不匹配 `\`）、`verifyWorkerIdentity` 的 `includes("apps/worker/src/main.ts")`、强杀脚本的 `-notlike '*apps/worker/src/main.ts*'`。修复前后果：心跳兜底的 `translationProcessAlive` 恒 false（日常判定靠实例锁兜底所以状态显示仍正确，但兜底是死代码）；`stop translate --force` 对翻译角色**必然拒绝**（fail-safe 但功能失效）。其余四个角色片段是纯文件名，不受影响（实测验证）。
- 修复（最小）：`process-identity.ts` 新增导出 `commandLineMatches()`（斜杠归一 + 大小写无关），三处匹配统一走它；强杀脚本在 PowerShell 内先 `Replace('/','\')` 归一命令行。仍要求完整路径片段（`apps\worker\src\main.ts`），**不是**放宽成「包含 main.ts」；无关进程、api 入口、错误 PID 的拒绝语义全部保留。
- 验证：活体翻译 Worker（pid 31876，反斜杠命令行）`translationProcessAlive` = **true**（修复前 false）；`tests/worker-process-identity.standalone.test.ts` 新增 2 例（反斜杠/正斜杠/大小写/路径特异性/强杀脚本模式）后 **19/19**。

**三、任务 B：可双击翻译入口**

- 新增 `start-radar-translate.cmd` / `stop-radar-translate.cmd`：只调用 `radar-local.ts start|stop translate`（同一受管入口），不重实现任何检查/白名单/预算逻辑。
- **又发现并修复 1 个 Windows 真实缺陷**：三个既有 `.cmd` 全部是 LF 行尾，cmd.exe 解析直接报错（`cd /d` 失败、node 命令不执行）——转 CRLF 修复，冷启动实测通过。另实测复现：`.cmd` 里中文注释在 chcp 65001 下会被 cmd 多字节缓冲边界截断执行（注释碎片被当命令），因此**新包装器注释一律 ASCII**，中文说明由工具自身输出与文档承担。
- 实测（双击等效，stdin=nul）：启动（预算耗尽时明示「启动后不会发出新的模型请求」+ 五来源 + 沿用基线）→ 重复启动拒绝并显示四态 → `stop-radar-translate.cmd` 优雅停止且**只停翻译**（数据库/API/网页/两个采集 Worker 全部不受影响）→ 未运行时停止正常提示「未在运行」→ `stop-radar.cmd xyzzy` 正确拒绝未知参数。

**四、任务 D：启用前核对（零新增付费）**

- 来源：白名单代码级固定五来源（测试断言）；正式库五来源 enabled、Ads 停用、AMZ123 线索源不在白名单、社区 RSS 两来源虽 enabled 但无 Worker 消费且今日 0 采集（历史遗留配置，非本轮改动）。
- 基线：`settings.translate.baseline = 2026-10-24T12:48:34.631Z`（R50 写入），今日启动显示「沿用上次基线」未被重建；隔离测试证明基线只写一次、重启沿用、基线前文章不回填（`translate-run-state` + `translate-item-chain`）。
- 预算：窗口 `r49-formal` 实测 `0/0 次、¥0.0000/0.1976、maxArticles 1` → `exhausted=true`；硬上限常量逐一核对（每轮 3 篇 `RADAR_TRANSLATE_RUN_ARTICLES=3`、每北京时间日 12 篇 `DAY_ARTICLES=12`、并发 1 靠 `translate.lease` 租约、同版本 3 次上限、标题 400 字/500 tokens、摘要 2000 字/1200 tokens、金额发送前最坏估算拒发、窗口归档不重置）；隔离测试 21/21（含预算 0 发前拒发零回执、其他付费用途仍被规则模式拒绝、正文不注册采集队列）。
- 实际运行证据：真实 Worker 跑满一个翻译周期，`receipts` 恒 44、`translations` 恒 44、articles/analyses/publications/fetch_runs/来源配置前后一致（仅 `content.translate` 最近执行时间戳更新，done=0）。**0 次新增 DeepSeek 请求。**

**五、任务 E：日常启停与恢复验收**

- 冷启动：`start-radar.cmd` 双击等效补起五服务（数据库/API/Web/AMZ123/公告监管），全部就绪；重复启动五项全部「已运行，跳过」幂等；默认不启动翻译；Ads 关闭；社区 RSS 未被启动。`status-radar.cmd` 与真实进程一致。
- 浏览器（Chrome + Playwright，`.data/_diag/r51/browser-accept.mjs`）：**19/19**——`/all`、中文政策详情（机器翻译标注/原文入口/重点速读/来源与核实说明）、联邦公报详情（**拟议徽标真实渲染**）、`/leads`、线索详情（核实边界如实标注）、1440/390 无横向溢出、非 hydration 控制台错误 0、hydration 警告 4 条/6 次导航（已知根因：`.env` 的 `SITE_URL=localhost` 与 `127.0.0.1` 访问导致的 canonical 属性不一致，R50 定位；本轮按任务约束不改业务路由，已在《本地运行说明》记录根因与现象）。
- 会话限制（如实）：以上启停均为本 Agent 会话内实测，进程短时存活成立；**「用户自己的 Windows 会话中长期常驻」「跨重启自动恢复」仍未验证**（无开机自启属设计）。用户日常验收最短步骤：双击 `start-radar.cmd` → 浏览器开 3000 → 双击 `status-radar.cmd` 核对 → （授权后）双击 `start-radar-translate.cmd` 看预算提示 → 关闭窗口后确认服务仍在。

**六、文档**

- `docs/radar/本地运行说明.md`：入口表更新为 6 个真实可双击文件；`stop-radar.cmd all` 如实标注「带参数，双击传不进去」；修正「双击 start-radar.cmd translate」易误解文案为 `start-radar-translate.cmd`；新增 hydration 警告已知现象说明；当前生效预算窗口以 status 显示为准。
- `docs/radar/CURRENT.md`：本节。

**七、R51 状态判定**

| 项 | 状态 | 依据 |
|---|---|---|
| `RADAR_DAILY_STARTUP` | **PASS** | 冷启动五服务 + 幂等重启动 + 状态准确，均真实执行 |
| `RADAR_TRANSLATION_MANAGEMENT` | **PASS** | 双击启/停入口实测可用；重复启动拒绝；四态准确；未运行时停止不误伤 |
| `RADAR_WORKER_ISOLATION` | **PASS** | 隔离测试 21/21；真实周期 fetch_runs/analyses 零变化 |
| `RADAR_COST_GUARD` | **PASS** | 预算 0 发前拒发 + 回执恒 44；上限常量与代码逐一核对 |
| `RADAR_RESTART_RECOVERY` | **PARTIAL** | 基线沿用、停止后状态正确、幂等重启有真实证据；用户会话长期常驻与跨重启自动恢复未验证（无开机自启属设计） |
| `RADAR_GIT_RECOVERABILITY` | **PARTIAL** | 盘点/敏感扫描/提交方案完成；**未获授权未提交，尚无恢复点** |
| `RADAR_NATURAL_RUNTIME_EVIDENCE` | **NOT_RUN** | 观察窗口内待处理文章 0，无自然新增政策 → 无自然翻译样本 |

三项区分：**Git 文件盘点完成 ≠ Git 恢复点已创建**（未提交）；**付费预算准备完成 ≠ 用户已批准付费**（¥1/7 天/168 次是待批建议）；**自动翻译启动成功 ≠ 自然新增政策已成功翻译**（无自然样本）。

**R51 实际修改/新增的文件**

| 文件 | 改动 |
|---|---|
| `apps/worker/src/process-identity.ts` | 新增 `commandLineMatches()`；`verifyWorkerIdentity` 与强杀脚本改用它（斜杠/大小写无关，仍路径级严格） |
| `scripts/radar-translate-state.ts` | `translationProcessAlive` 改用 `commandLineMatches` + `expectedCommandFragment`（单一身份口径） |
| `tests/worker-process-identity.standalone.test.ts` | 新增 2 例（斜杠方向、强杀脚本模式） |
| `start-radar.cmd` / `stop-radar.cmd` / `status-radar.cmd` | **LF→CRLF 修复**（双击必挂的根因）；start 尾部提示改指新入口 |
| `start-radar-translate.cmd` / `stop-radar-translate.cmd` | **新增**双击入口（ASCII 注释，复用受管入口） |
| `docs/radar/本地运行说明.md` / `docs/radar/CURRENT.md` | 文档归一（见上） |
| `.data/_diag/r51/*` | 诊断件（**不入 Git**）：identity-check.ts、data-snapshot.ts、browser-accept.mjs、before/after-translate.txt、git-inventory.txt、shots/ |

### R50（2026-10-24 20:45–21:50）：第一主线正式运行能力收口

**一、任务 A/B：自动翻译接入现有运行管理体系（不新建启动器）**

| 能力 | 实现 | 入口 |
|---|---|---|
| 开启自动翻译 | `scripts/radar-local.ts start translate` → 委托 `radar-ops.ts start translate`（复用既有启动/身份核验机制，未新增第二套启动器） | `start-radar.cmd translate` |
| 只停翻译 | `radar-local stop translate`：先请停翻译 Worker（进行中的请求先收尾），确认实例锁释放；**不碰**两个采集 Worker、数据库、API、网页 | `stop-radar.cmd translate` |
| 全部停止 | `radar-local stop`：第 1 步先停翻译（付费的排最前），再停公告/监管、AMZ123、Web/API；`stop all` 才连数据库 | `stop-radar.cmd [all]` |
| 查看状态 | `radar-local status` 新增「自动中文翻译」一栏，与 `radar-ops status` **共用同一个状态读取模块** `scripts/radar-translate-state.ts`（不出现两套口径） | `status-radar.cmd` |

- 安全边界没有为操作方便而削弱：Worker 仍以 `COLLECT_ENABLED=false RADAR_TRANSLATE_ENABLED=true RADAR_WORKER_SCOPE=content RADAR_ANALYZE_SINCE=<settings.translate.baseline> RADAR_ANALYZE_SOURCES=<官方/监管五来源>` 启动，白名单与基线由启动器从数据库读取后注入；Worker 自身在缺少基线或白名单时 `exit 2` 拒绝启动（双保险）。
- 默认启动（不带参数）**不会**启动翻译：`start-radar.cmd` 仍只补起数据库/API/网页/两个采集 Worker，末尾明确提示「自动中文翻译默认未启动（不调用 DeepSeek）」。
- 「已在运行」按成功处理（退出码 0），不会让用户误以为启动失败。

**二、任务 C：费用上限与状态可见**

- 硬上限全部落在数据库、跨重启保持：请求次数、不同文章数、人民币金额（`settings.translate.budget`，含该轮授权上限 `limits`）、每轮 3 篇、每北京时间日 12 篇、全局并发 1（`translate.lease` 租约）、同版本失败 3 次上限（`translation_attempts`）、单次请求长度/输出上限（标题 400 字/500 tokens、摘要 2000 字/1200 tokens）。**重启、重跑、重复启动都不会获得新额度**；只有用户单独批准新预算窗口才会。
- 当前窗口 `r49-formal` 上限为 **0 次请求 / ¥0.1976**（R49 收口时取的本轮剩余额度），因此**任何新请求都会在发送前被拒**。启动器会明确提示这一点，而不是让用户误以为翻译会继续。
- 状态栏八项：自动翻译（四态）、翻译 Worker、允许来源、启用基线、最后成功翻译、最近失败、当前预算（本轮+累计）、待处理文章、最近执行（时间+处理篇数+提前结束原因）。**不能**把「开关已设置」显示成「Worker 正在运行」——运行判定只认实例锁，或「心跳新鲜且 OS 确认该 PID 就是本 Worker」；仅有运行记录时判为**故障**。

**三、任务 G：正式库实测（启停恢复）**

| 步骤 | 实测结果 |
|---|---|
| 启动前 | 翻译 Worker 未运行，`.data/run/radar-translate.json` 是上次异常退出留下的记录（pid 27500） |
| `radar-ops start translate` | pid 52436；提示「只处理这五个来源」「启用基线 2026-10-24 20:48:34（沿用上次基线）」「本轮预算已用完（0/0 次、¥0.0000/0.1976 元），启动后不会发出新的模型请求」 |
| 实例锁 | **2 秒**内被该进程持有 |
| 重复启动 | 拒绝（「已在运行，不重复启动」），`main.ts` 进程数恒为 **1** |
| 跑满一个翻译周期（约 80 秒，5 次 `content.translate` 执行） | `receipts` **恒为 44**，`translations` 恒为 44，`articles/analyses/publications` 恒为 130/236/126 → **0 次付费请求** |
| `radar-ops stop translate` | 优雅停止，实例锁释放；`radar-announcements`、`amz123-leads` **仍显示运行中** |
| 停止后状态 | 运行记录被正常清理 → 显示「预算已用完（未运行）」而非「故障」 |
| 前后数据对照 | `articles 130 / analyses 236 / publications 126 / translations 44 / receipts 44 / translation_attempts 23 / fetch_runs 155`、来源启停与 `pgboss.schedule` **完全一致**；仅 pg-boss 簿记变化（`cron.content.sweep` completed +7 / created −6，`cron.content.translate` completed +6 / created −5，专用 Worker 调度 completed 各 +2） |

**四、任务 D：历史队列积压盘点（只读，未清理）**

| 队列（`created` 状态） | 数量 | 来源 |
|---|---|---|
| `cron.sources.schedule` | 2,171（最旧 10-21 18:48，最新 60 秒前） | 历史全量 Worker 的采集调度，**约 1 条/分钟持续增长** |
| `cron.hot.rank` | 434 | 每 5 分钟 |
| `cron.content.sweep` | 263 | 每 5 分钟（翻译 Worker 运行时会被消费） |
| `cron.ops.recover` | 219 | 每 10 分钟 |
| `cron.hot.snapshot` / `cron.stories.links` | 38 / 36 | 每小时 |
| 其余（icons / retention / adapt-intervals / events.group） | 9 | 零星 |

- **待处理真实业务文章：0**。`content.analyze`、`sources.fetch*` 的 `created` 均为 0；`fetch_runs` 无 `running` 遗留（除历史 3 条社区来源遗留，非本轮范围）。
- **增长有界**：pg-boss 对未进入 active 的作业按 `start_after + retention_seconds(14 天)` 删除，维护扫描每队列最多 24 小时一次 → 稳态约 14 天扇出（约 3 万行，`pgboss` 库当前 12 MB）。
- **本轮不清理**（未授权批量删除/取消历史作业），按已知限制保留，并写入《本地运行说明》。

**五、测试与工程检查**

| 项 | 结果 |
|---|---|
| 新增测试 | `tests/translate-run-state.test.ts` **9/9**：来源白名单恰好五来源、四态判定（未启用/故障/锁即运行/预算耗尽）、`job_runs` 处理篇数与原因、基线只初始化一次且不回填、已译文章重启不重复付费、预算为 0 时**发前拒发且零回据零 provider 命中** |
| 既有测试 | `worker-translate-isolation` 3/3、`translate-item-chain` 6/6、`translate-budget-round` 3/3、`radar-ops-start`+`worker-control`+`worker-process-identity` 17/17 |
| 既有缺陷修复 | `tests/worker-translate-isolation.test.ts`：fixture 来源未加进 `RADAR_TRANSLATE_SOURCES`，导致增量用例按设计被跳过（既有失败，非本轮引入）；按姊妹测试同样方式补一行白名单 |
| 类型检查 | `contracts / backend / api / worker / tests / modules` 六个 tsconfig 全部 exit=0；三个运行脚本另用临时 tsconfig 单独校验通过 |
| Web 构建 | `@react-router/dev build` exit=0（651ms） |
| 真实浏览器 | **21/21**（本机 Chrome 155 + Playwright）：`/all`、`/items/:id`、`/leads`、`/leads/:id` 四页可开；中文标题/摘要与「机器翻译 · 未经人工核对」标注在位；原文入口（打开原文/查看来源摘要原文）可用；无正文时明确「仅有来源摘要，没有完整正文」；线索页按「官方核实 / 仅第三方报道」如实标注且明示「不是 Amazon 官方已确认的政策」；**1440/1024/390 三档 × 四页横向溢出全部 0px**；重复打开页面 API 持续应答（页面不触发模型） |
| 控制台 | 用 `127.0.0.1:3000`（《本地运行说明》里的地址）访问每页 1 条 hydration 警告；**用 `localhost:3000` 访问为 0 条**。根因已定位：SSR 按 `.env` 的 `SITE_URL=http://localhost:3000` 输出 canonical/og:url，客户端按浏览主机重算 → 属性不一致。**既有行为，R50 未改任何被服务文件**（这也解释 R48/R49 记录的 0 错误：它们用 localhost 访问）。意外错误 0 条 |
| 新增费用 | **¥0**（本轮未产生任何真实 DeepSeek 请求） |

**六、文档与 Git**

- `docs/radar/本地运行说明.md`：日常入口收敛为 4 个 `.cmd`；新增「自动中文翻译一栏怎么看」五态表；停止顺序改为「先停翻译」；新增 `stop-radar.cmd translate`；R48/R49 手工命令整体移入**「历史用法，不适用于当前正式运行，请勿直接复制执行」**引用块；新增「历史队列积压」一节。
- `README.md` / `AGENTS.md`：核对后与本轮行为无冲突；`AGENTS.md` 第 5 节补一条「自动中文翻译是唯一被允许的付费能力，且必须走 `start-radar.cmd translate` 受管入口」，把手写命令明确列为不推荐。
- Git：分支 `master`、HEAD `e7ae899` 不变；**未执行任何 Git 写操作**（无 add/commit/push/merge/reset/clean）。工作区 **50 个已跟踪修改 + 72 个未跟踪 = 122 项**（R49 记录为 117；本轮新增 3 个脚本、1 个测试、1 个测试修改、3 个 `.cmd`、2 份文档与 `.data/_diag/r50/*` 诊断件）。**`docs/radar/` 整个目录目前未被 Git 跟踪**（`?? docs/radar/`），因此 CURRENT.md 与《本地运行说明》的修改不会进入任何提交——这是提交范围必须单独决定的事项，本轮不自行 `git add`。

**R50 实际修改/新增的文件**

| 文件 | 改动 |
|---|---|
| `scripts/radar-translate-state.ts` | **新增**：翻译状态的唯一读取点（实例锁/心跳/运行记录/预算/基线/待处理/最近执行），`radar-ops status` 与 `radar-local status` 共用，避免两套口径 |
| `scripts/radar-local.ts` | 新增 `start translate` / `stop translate` / `stop`（先停翻译）/ `status` 翻译栏；`portOwner` 改 base64 传命令行（修中文路径乱码导致 Web 停不掉）；`workerRunning()` 统一"运行中"判定；`stop` 增加参数白名单；Web/API 异常时区分「本项目进程在但探测不通过」与「被其他程序占用」 |
| `scripts/radar-ops.ts` | 改用共享状态模块；`start translate` 增加预算耗尽提示；`status` 的「最近翻译任务」补处理篇数与提前结束原因；删除本地重复的翻译状态查询 |
| `start-radar.cmd` / `status-radar.cmd` / `stop-radar.cmd` | 透传参数（`start-radar.cmd translate` 可用）；补充注释说明三种停止语义 |
| `tests/translate-run-state.test.ts` | **新增** 9 例（四态判定、基线只初始化一次且重启沿用、已译不重复付费、预算 0 时发前拒发且零回执） |
| `tests/worker-translate-isolation.test.ts` | 修既有夹具缺陷：fixture 来源未加进 `RADAR_TRANSLATE_SOURCES`，导致增量用例被按设计跳过 |
| `AGENTS.md` / `docs/radar/本地运行说明.md` / `docs/radar/CURRENT.md` | 文档归一（见上） |
| `.data/_diag/r50/*` | 诊断脚本与快照（**不入 Git**）：`snapshot.ts`、`queues.ts`、`maintenance.ts`、`lifecycle.sh`、`stop-only-translate.sh`、`browser-accept.mjs`、`git-inventory.txt`、`before/after-translate.json` |

**七、状态判定**

| 项 | 状态 | 依据 |
|---|---|---|
| `RADAR_DAILY_STARTUP` | **PASS** | 不带参数启动只补五个服务，末尾明示翻译未启动；API 缺失时只补 API |
| `RADAR_TRANSLATION_MANAGEMENT` | **PASS** | `start/stop/status translate` 三个入口 + 八项真实状态；重复启动不产生第二个消费者 |
| `RADAR_WORKER_ISOLATION` | **PASS** | scope=content 只注册 analyze + 两个定时器；正式库实测采集队列零消费、社区来源 `fetch_runs=0`（隔离测试 3/3） |
| `RADAR_COST_GUARD` | **PASS** | 上限全在 `settings`，重启不重置；当前窗口 0 次额度下实测 0 请求 0 回执；隔离测试验证发前拒发 |
| `RADAR_RESTART_RECOVERY` | **PARTIAL** | 基线跨重启沿用、已译不重复付费、优雅停止后状态正确均有证据；但**跨会话/重启后的常驻存活**受本环境「作业对象回收后代进程」限制，未做长周期自然观察 |
| `RADAR_GIT_RECOVERABILITY` | **PARTIAL** | 已形成只读清档与安全提交范围建议；**未提交**（等用户授权），因此尚无版本恢复点 |
| `RADAR_NATURAL_RUNTIME_EVIDENCE` | **NOT_RUN** | 本轮窗口内无自然新增官方文章（`待处理文章 0`），未取得「真实新政策自动生成中文」的自然样本 |

**八、浏览器验收（真实 Chrome 155 + Playwright）**

脚本 `.data/_diag/r50/browser-accept.mjs`，截图 `.data/_diag/r50/shots/`。结果 **21/21 通过**（明细见第五节表格）。要点：四页可开、中文标题/摘要与「机器翻译 · 未经人工核对」在位、原文入口可用、无正文时明确「仅有来源摘要，没有完整正文」、线索页按「官方核实 / 仅第三方报道」如实标注且明示不是官方已确认政策、1440/1024/390 三档 × 四页横向溢出全部 0px、重复打开页面不产生模型请求。

**九、收口时实测状态（浏览器验收后）**

| 项 | 值 |
|---|---|
| 进程 | PostgreSQL 5544（pid 27108）、API 3001、Web 3000、公告/监管 Worker、AMZ123 线索 Worker 均在运行；**无 `apps/worker/src/main.ts` 进程**（翻译 Worker 未运行，与状态栏一致）。PID 会随进程重启变化，以 `status-radar.cmd` 实读为准 |
| 业务数据 | `articles 130 / analyses 236 / publications 126 / translations 44 / receipts 44 / translation_attempts 23`，与 R49 收口时**完全一致** |
| 业务积压 | `content.analyze` 与五个 `sources.fetch*` 队列的 `created` **均为 0**（无待处理真实业务文章） |
| 队列总量 | `pgboss.job` 的 `created` 共 **3,248** 条，全部是定时器扇出（见上表） |
| 预算 | 窗口 `r49-formal`：0/0 次、¥0.0000/¥0.1976；累计 44 次 / ¥0.0610（未变） |
| `running` 采集记录 | 3 条，全部是 `rss-wyze-community` 的 2026-10-20 历史遗留（R24 已记录，非本轮、非两个专用 Worker 范围） |

**十一、运行验证中发现并修复的 3 个真实缺陷（均为运行管理层，未动业务代码）**

| # | 缺陷 | 影响 | 修复 |
|---|---|---|---|
| 1 | `radar-local stop <未知参数>` 落入全停路径 | 一个拼写错误就会把数据库之外的全部服务停掉 | `stop` 增加参数白名单：只接受 空 / `translate` / `all`，其余打印用法并以 1 退出 |
| 2 | 端口属主身份校验在中文路径下失效 | PowerShell 经控制台管道回传命令行时把 `D:\Workspace\轻选情报中心\…` 转码成乱码，`owns()` 无法匹配 → **`stop-radar.cmd` 永远停不掉 Web 3000**（安全机制宁可拒绝也不误杀，但功能因此不可用） | 命令行改走 **base64**（`[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(...))`）传输，Node 侧解码；修复后实测 `owns() => true`，Web 可被身份核验后停止 |
| 3 | `radar-local start` 与 `radar-ops start` 的"运行中"判定不一致 | 前者只认实例锁、后者认「锁或心跳」；进程刚被回收时前者说"未运行"去启动，后者说"已在运行"拒绝 → 用户看到自相矛盾的两句，最后还误报「✗ 25 秒内没有拿到实例锁」 | 抽出 `workerRunning(lockKey, role)`，两处用同一判定（锁 或 心跳） |

**十二、决定性验证：只停翻译不影响采集（单命令内完成）**

本环境的 Agent 作业对象会在**命令结束时回收该命令的后代进程**，所以跨命令无法证明"停了翻译之后采集还在"。改为在同一个命令里起齐三个 Worker 再只停翻译：

| 步骤 | 实测 |
|---|---|
| 起齐 公告/监管 + AMZ123 + 翻译 | 三者实例锁全部被占用（翻译 2 秒内拿到） |
| `stop-radar.cmd translate` | 只发停止请求给翻译；`translate 已停止…实例锁已释放` |
| 停止后三者状态 | **公告/监管 Worker：运行中 · AMZ123 Worker：运行中 · 翻译 Worker：未运行** |
| 全程回执 | `receipts` 恒为 **44**，`receipt tokens` 恒为 23,449 / 1,764 → **0 次付费请求** |

**十三、默认启动的复测（修复后）**

`radar-local start`（不带参数）按 数据库→API→Web→AMZ123→公告/监管 只补缺失项；末尾固定打印「自动中文翻译默认未启动（不调用 DeepSeek）。获得授权后：start-radar.cmd translate」。实测启动后 `radar-ops status`：Web 3000 HTTP 200、API 3001 HTTP 200、公告/线索 Worker 运行中各持锁、Ads 来源停用且采集进程未运行、**翻译 Worker 未运行**。

**十四、仍须注意的环境事实**

- 本命令启动的进程在**命令结束后**会被回收（API/Web/两个 Worker 均实测如此）；能跨命令存活的是更早会话启动的进程。因此「电脑重启后 / 会话结束后仍常驻」仍属 BLOCKERS 1，未在本轮验证。
- `rss-cpsc-recalls` 出现 1 条 `fetch_runs #190 failed`，错误为 `the worker exited before this run finished`——即上述回收副作用，不是采集链路缺陷；该来源 `health=ok`、`fail_count=0`、`next_fetch_at` 已正常推进，下一轮自动恢复。

**十五、仍未解决**

1. 正式持续付费翻译仍未启用：需要用户单独批准新的预算窗口（当前 `r49-formal` 为 0 次额度）并授权常驻运行。
2. 跨会话常驻：本环境的 Agent 作业对象会在命令结束时回收后代进程，「会话结束后仍存活」无法在本会话内验证（R24/R49 已记录同一限制）。
3. 历史队列积压按已知限制保留；如将来要清理，需单独授权并先提交精确的队列/数量/影响清单。
4. 自然新增文章的自动翻译样本仍未取得。
5. `127.0.0.1` 访问时的 hydration 警告（SITE_URL 主机差异）：要么把 `.env` 的 `SITE_URL` 改成 `http://127.0.0.1:3000`，要么在文档里统一用 `localhost:3000`。属既有环境配置问题，未改动。

### R49（2026-10-24 18:50–19:40）：自动中文化隔离验证与正式受控试运行

**一、任务 A：主 Worker 的真实业务范围（逐项核对代码 + 副作用）**

| 队列 / 定时器 | 全量模式是否注册 | 有副作用吗 | scope=content 是否注册 |
|---|---|---|---|
| `content.analyze` | 是 | 规则分析 → 写 `analyses`、重写 `publications` 派生字段 | **是**（带 since/来源门禁） |
| `content.sweep` | 是 | 发现 `new` 文章入队；规则模式下还会把**历史 editorial 文章重置为 new** 重新评估 | **是**（带 since/来源门禁，且不重评估历史） |
| `content.translate` | 仅在 `RADAR_TRANSLATE_ENABLED=true` | 调 DeepSeek（受用途白名单与预算约束） | **是**（仅在开关打开时） |
| `sources.fetch` / `fetch-x` / `mp` / `content.extract-body` | 仅 `COLLECT_ENABLED=true` | 采集社区 RSS、X、公众号、抓正文 | 否 |
| `events.group`、`notify.selected`、`media.prepare`、`publication.republish-source` | 是 | 事件归并、通知、图片、重发布 | 否 |
| `cron.hot.rank` / `hot.snapshot` / `stories.links` / `ops.recover` / `ops.retention` / `reports.*` | 是 | 写热点派生表、事件归并、释放 unknown 回执、删除过期数据 | 否 |

**实测（正式库副本）**：直接启动全量主 Worker 会**立刻消费 25 个历史 `content.analyze` 作业**（覆盖全部正式政策与 Ads），并会处理 3 条处于 `new` 的 AMZ123 线索；`content.sweep` 每 5 分钟还会把 rule 版本不符的历史 editorial 文章重新入队。**因此“COLLECT_ENABLED=false 就够了”不成立**。

**二、最小安全门禁（本轮唯一后端改动）**

| 门禁 | 行为 |
|---|---|
| `RADAR_WORKER_SCOPE=content` | 只注册 `content.analyze` 与两个定时器（sweep/translate），不订阅事件/通知/发布/热点/运维/报告/采集；`registerSchedules` 增加 `only` 白名单且**不清理**其他 cron 队列 |
| `RADAR_ANALYZE_SINCE` | `content.analyze` 拒绝早于该时刻创建的作业（直接完成、不碰文章）；`sweep` 只挑这之后的新文章 |
| `RADAR_ANALYZE_SOURCES` | 只接受五个官方/监管来源；社区 RSS、AMZ123、Ads 一律跳过 |
| sweep 的 scoped 分支 | 带范围时**不再**执行“历史 editorial 重评估” |

**实测证据（副本）**：scope worker 消费完 25 个历史作业后 `articles/analyses/publications` 仍为 **130 / 236 / 126**；`cron.sources.schedule` 的 **2026** 个作业保持 `created`（无人消费）；3 篇 AMZ123 仍为 `new`。

**三、任务 C/D：隔离环境真实 DeepSeek 自动链路**

| 步骤 | 结果 |
|---|---|
| 新文章入库（官方来源，`new`） | 由**定时器 `content.sweep`** 的处理器发现并入队（不是手工调用函数） |
| 分析 → 发布 | 走既有 `processArticle` → `publications`（`body_mode=summary`、`visibility=public`） |
| 翻译 | 由**定时器 `content.translate`** 触发 `translateTextPending()` → DeepSeek Flash |
| 产出 | 中文标题「关于在线卖家欺骗性费用的拟议规则制定通知（mvmacneh）」、中文摘要「委员会拟议要求卖家在结账前披露总价。意见须在30天内提交。」 |
| 费用 | **2 次请求 / 输入 1,026 / 输出 45 tokens / ¥0.002412**（上限 6 次 / 2 篇 / ¥0.20） |
| 重启后 | 再次触发翻译调度，请求数仍为 2（已译不重复付费） |
| 反例 | 社区来源文章：未进 publication、未翻译；历史文章（早于基线）未被翻译；基线之前无候选 |

**四、任务 E：正式环境受控试运行**

- 启动方式：`COLLECT_ENABLED=false RADAR_TRANSLATE_ENABLED=true RADAR_WORKER_SCOPE=content RADAR_ANALYZE_SINCE=<启用时刻> RADAR_ANALYZE_SOURCES=<五个来源>`，`.env` **未修改**（全部为进程级环境变量）。
- 预算：正式库开一轮 `r49-formal`，上限取本轮**剩余额度**（4 次 / 1 篇 / ¥0.1976），并写入 `settings.translate.baseline`（启用时刻）。
- 观察窗口 **19:07:05–19:38:05（31 分 8 秒）**：`content.sweep` 执行 **138** 次、`content.translate` 执行 **7** 次（每 5 分钟一次）；**0 次模型请求**（无候选）；`articles/analyses/publications/translations/receipts` 保持 **130 / 236 / 126 / 44 / 44**；25 个历史分析作业全部被跳过（数据未变）；`cron.sources.schedule` 仍 2,000+ 个 `created`（未消费）；浏览器 74/74、0 控制台错误。
- **自然新增文章：0 篇**（基线之后 `articles` 无新增），因此“真实新政策自动生成中文”**没有自然样本**。
- 收口：worker 已停止（运行 31 分 8 秒）。该进程是本轮以显式命令行启动的一次性验证进程，**不是** `radar-ops` 管理的项目服务；停止即结束该进程本身（未按 `node.exe` 等进程名批量结束，未触碰两个专用 Worker）。`translate.baseline` 与 `translate.lease` 已删除（不留“已启用”痕迹），轮次 `r49-formal` 保留 0 请求记录；两个专用采集 Worker 未受影响（pid 8732 / 15560 仍持有锁）；Web/API 200。

**五、任务 F：内容价值抽查（23 篇）**

分类口径：**实质信息** = 至少一项 涉及商品 / 主要风险 / 官方做法 / 数量与金额 / 变化 / 生效时间；**仅身份** = 只有 发布机构 或 文件类型；**材料不足** = 无任何 keyFacts。

| 类别 | 数量 | 说明 |
|---|---|---|
| 实质信息 | **17** | 15 篇 CPSC 召回（涉及商品 + 风险 + 召回）+ FR 窗饰拉绳（风险 + 拟议做法）+ Amazon 客服公告（官方做法：退款） |
| 仅身份 | **6** | FR 4 篇（文件类型 + 机构：解释性/拟议/NPRM 意见征集/Rules of Practice）、Amazon 2 篇（仅机构） |
| 材料不足 | **0**（按口径） | 真正的“材料不足”是费用页（只有标题）与 FR 只有摘要，但它们至少能给出机构/文件类型，因此落在 B；没有任何一篇出现空字段或“未知”占位 |

本轮抽查发现并修正 2 处**提取缺口**（不是错误陈述）：`Papablic, of USA` 品牌带逗号未识别 → 放宽品牌匹配；`Phthalate Levels` 不在危险词表 → 补「邻苯二甲酸盐超标」「铅含量」「磁铁吞食风险」。修正后两篇均补出「涉及商品」「主要风险」。

**六、验收与边界**

| 项 | 结论 |
|---|---|
| 工程检查 | `npm run typecheck` 通过；`npm run build -w @aihot/web` 通过；`policy-explain-keyfacts` 9/9、`worker-translate-isolation` 3/3、`translate-budget-round` 3/3、`translate-item-chain`+`translate-body-isolated` 8/8、`radar-core` 9/9 |
| 真实浏览器 | **74/74**、0 新增控制台错误、1440/1024/390 零溢出；页面读取前后 `receipts` 不变（页面不触发模型） |
| 费用（R49 新增） | **2 次请求 / 1,026 输入 / 45 输出 / ¥0.002412**（占 ¥0.20 上限的 1.2%）；正式环境 **0 次**；累计（正式 44 次 + 副本 2 次）= 46 次 / 24,475 输入 / 1,809 输出 / **¥0.0638** |
| 事实与隔离 | 正式库文章 130、analyses 236、publications 126、translations 44、receipts **44（R49 正式环境 0 新增）**、23,449 输入 / 1,764 输出 tokens；隔离副本另有 2 条回执（46）；AMZ123 3 条（1 matched）未变；来源配置/`site_fulltext`/`syndicate` 未变；Ads 关闭；两个专用 Worker（8732/15560）持续运行；3010 未碰 |
| Git | 分支 master、HEAD `e7ae899`、117 个改动；`.gitignore` 覆盖 `.env`/`.env.*`/`.data/`/`node_modules/`；未跟踪文件里无密钥（`key-facts.ts` 是源码）；未 Commit/Push |
| 本轮文件 | `apps/worker/src/{main.ts,schedules.ts}`、`packages/backend/src/jobs/content.ts`、`packages/backend/src/editorial/key-facts.ts`、`tests/policy-explain-keyfacts.test.ts`、本文件、`docs/radar/本地运行说明.md`；隔离脚本与快照在 `.data/_diag/`（非源码） |

**七、状态判定**

| 项 | 状态 | 依据 |
|---|---|---|
| `ISOLATED_AUTO_TRANSLATION` | **PASS** | 调度发现 → 分析 → 发布 → 翻译 → 读层，2 次真实请求，重启不重复 |
| `FORMAL_TRIAL` | **PARTIAL** | 正式 Worker 按周期运行且零越界（数据未变、采集未消费），但窗口内无自然新增文章 |
| `NATURAL_NEW_ARTICLE_EVIDENCE` | **NOT_RUN** | 30 分钟内没有新政策入库 |
| `FORMAL_CONTINUOUS_TRANSLATION` | **BLOCKED（按授权保持关闭）** | `.env` 未写开关、`translate.baseline` 已删除、无常驻进程 |

**八、仍未解决**

1. 真实自然新增文章的自动翻译未取得样本（需要等下一次官方发布 + 用户授权再次试运行）。
2. scope 模式不清理由注册的 cron 调度行，pg-boss 仍为它们创建空作业（不执行，恢复全量后会被消费）。
3. 试运行期间 `content.sweep` 连同历史积压被消费了 138 次（每次 `enqueued: 0`）；积压本身来自此前未运行的主 Worker，恢复全量后会被一次跑完。
3. 15 篇没有解释记录的文章仍无中文政策解释正文（只有速读 + 关键信息）。
4. 正文中文阅读仍受 `site_fulltext=false` 限制。

### R48（2026-10-24 16:45–18:20）：中文阅读质量收口与自动翻译运行隔离

**一、任务 A：阅读区技术信息清理（前端）**

| 项 | 结论 | 证据 |
|---|---|---|
| 关键信息逐行「依据」 | **移出阅读区**：`KeyFact` 只有 label/value；原文依据（字段+命中词）改在折叠的「来源与核实说明 → 关键信息依据」里逐条列出，需要核对时再展开 | `features/item/reading.tsx`；页面实测（Costway 关键信息无「依据」行） |
| 线索页措辞 | 已证实主张的引文标签 `依据：` → `官方原文：`（那段本来就是官方文件原文，不是后台判定） | `routes/lead.tsx` |
| 重复摘要 | 保持 R46 的 `repeatsSummary`：摘要不长于速读时只显示一次；长摘要才在下方完整展示，速读只取前一两句 | `reading.tsx`；9 个样本实测无重复段落 |
| 中文商品名 | `chineseProductHint()`：仅当**已存在的中文标题**写成「因…存在/导致…」时才取其中间的名词短语；危险词、标准名一律拒绝，英文原名保留 | Costway →「Costway 召回 Convertible High Chairs（可转换高脚椅）」；Giant/VQQQ 无该句式则不加 |
| 技术面板 | 未回潮：内容身份、政策核查、规则命中、中文政策解释大框仍不渲染（9 个样本逐个检查） | 浏览器验收 74/74 |

**二、任务 B：让剩余正式文章也能提取关键信息（解耦为读取时计算）**

| 项 | 结论 | 证据 |
|---|---|---|
| 因果核实 | 确认：`explanation` 来自 `analyses.output`，15 篇没有 rule 分析记录 → 无解释 → R47 前端只读 `explanation.keyFacts` 因此为空。**不是**材料不足 | `publication/detail.ts`、`analyses` 实查 |
| 最小复用方案 | 提取规则搬到 `editorial/key-facts.ts`（纯函数，输入 title/excerpt/bodyText/sourceName/chineseTitle）。`policy-explain.ts` 委托它（库内存量不变），`publication/detail.ts` 在**读取时**用它计算 → **不跑 analyzeArticle、不写库、不新增表/列、不改 publication** | 代码；`tests/policy-explain-keyfacts.test.ts` 8/8 |
| 覆盖结果 | **23/23 篇都有 keyFacts**（对照 R47 的 8/23）：CPSC 召回 4 项（涉及商品/主要风险/官方做法/发布机构）、FR 3–4 项（文件类型/主要风险/官方做法/发布机构）、Amazon 2 项（官方做法/发布机构）、费用页 1 项（发布机构）。**没有任何一篇出现编造的金额、日期或要求** | API 全量实测 |
| 证据与版本 | 每项带 `evidence`（字段+命中词）；读的是当前版本字段，原文/译文更新后下次读取即变，不沿用过期派生；材料不支持则不产生字段（`ji54f64z` 只有发布机构，`t4evq…` 只有发布机构） | 同上 |
| 提取缺陷修正 | 人工核对发现 usOpal 标题的 **Asphyxiation 未提取**（表里没有该词）→ 补 `窒息`，并加「多危险不漏」回归；同时把危险上限从 3 提到 4 | `key-facts.ts`；测试用例 |
| 写库范围 | 8 篇白名单解释用同一提取器重写一次（纯规则、快照保留）；其余 15 篇**零写入** | `radar-explain-backfill-2026-10-24T…Z-*.json` |

**三、任务 C：中文翻译逐句抽查（不新增请求）**

| 样本 | 结果 |
|---|---|
| Amazon 费用（t4evq 标题） | 准确：Referral fees→推荐费、Fulfillment by Amazon→亚马逊物流、2026 保留；无摘要即不造假 |
| Amazon 公告（ye905 标题 + 规则整理摘要） | 准确；摘要为规则整理（非机器翻译），已如实标注 |
| Amazon FBA（u7vd 标题/摘要） | 准确：expanded to new categories→扩展到新的品类；recover more value→收回更多价值 |
| CPSC 召回（Giant Bicycle） | 准确：否定句（do not have the warnings required by Reese's Law→没有 Reese's Law 所要求的警告）、条件句（when … are swallowed→当…被吞下时）均保留；型号 SureLock 保留 |
| CPSC 召回（usOpal） | 准确：entrapment/asphyxiation→夹困/窒息，asphyxiation death→窒息死亡；「不符合结构稳定性或固定带要求」「未附危险警告标签」均保留 |
| FR 拟议（fk7j） | 准确：proposes to commence a rulemaking proceeding→拟议启动一项规则制定程序；soliciting written comment→征求书面意见、数据和论据 |
| FR 正式/解释（d7yc） | 准确：interprets this phrase **not to include** fuel additives→解释为**不包括**燃料添加剂（否定保留），枚举项完整 |
| FR NPRM 意见征集（ts9kyx4m） | 准确：oral presentations **must be limited to** matters within the scope→口头陈述**必须限于**…范围内（强制程度保留） |
| 数字与单位（u4bq5mvr） | 准确：8 inches→8英寸、36 inches→36英寸、with and without tension devices→带有和不带有张力装置 |
| **实质错误** | **0 处**（未发现会误导用户的错误，因此本轮未做任何译文覆盖） |

**四、任务 D：自动翻译运行隔离（实证）**

| 问题 | 结论 |
|---|---|
| 主 Worker 订阅哪些队列 | `content.analyze`（内容分析）+ 各 cron 调度（sweep/translate/hot/ops/reports）；**采集队列只有 `COLLECT_ENABLED=true` 时才注册**（`registerSourceJobs`：`sources.fetch`、`sources.fetch-x`、`sources.mp`、`content.extract-body`） |
| 社区 RSS 会不会被意外恢复 | 默认 `.env` 里 `COLLECT_ENABLED=true`，**直接启动会**；以 `COLLECT_ENABLED=false` 启动则**不会**——采集队列根本不注册 |
| 专用 Worker 是否受影响 | 不受影响：公告/费用/监管用 `sources.fetch-amazon-announcements|fee-updates|regulatory`，AMZ123 用 `sources.fetch-amz123-leads`，都是私有队列 |
| 隔离实证（隔离库 + 真实子进程） | ① `sources.fetch` 作业 4 秒后仍为 `created`（未被消费）；② 社区来源 `fetch_runs=0`；③ 调度表有 `cron.content.translate`/`content.sweep`，**无** `cron.sources.schedule`/`adapt-intervals`/`icons`；④ 队列表无 `sources.*`、无 `content.extract-body` | `tests/worker-translate-isolation.test.ts` 3/3 |
| 关闭开关后 | 重启的 Worker 不注册翻译调度，队列被一并清理，**模型 stub 零调用** |
| 增量与预算 | 新官方文章 → analyze/publish → `translateTextPending` 译出中文标题 → 预算请求数与费用落在 `settings`（重启不丢） |
| 是否可以安全独立运行 | **可以，无需新增 Worker**：`COLLECT_ENABLED=false RADAR_TRANSLATE_ENABLED=true` 启动现有主 Worker 即可只做内容处理与翻译 |
| 仍需用户授权 | 正式启用持续付费（授权 + 主 Worker 常驻）；基线 `translate.baseline` 会在首次启用时写入，只处理其后的新文章 |

**五、验收与边界**

| 项 | 结论 |
|---|---|
| 真实浏览器 | **74/74**（10 个样本 × 6 项 + 折叠区依据 + 拟议状态 + 费用页无编造 + 搜索 + 三宽度 × 4 页面），**0 新增控制台错误**；脚本 `.data/_diag/r48-accept.mjs`，截图 `.data/_diag/r48/` |
| 工程检查 | `npm run typecheck` 通过；`npm run build -w @aihot/web` 通过；新增/修改测试：`policy-explain-keyfacts` 8/8、`worker-translate-isolation` 3/3、`translate-budget-round` 3/3、`translate-item-chain` + `translate-body-isolated` 8/8（需 `RADAR_TRANSLATE_ENABLED=true`） |
| 事实与费用 | publications 126（eligible 125、body_mode full 0）、translations 44（23 标题 + 21 摘要）、receipts **44 次 / 23,449 输入 / 1,764 输出 / ¥0.0610**（**R48 新增 0**）、AMZ123 3 条（1 matched）、来源 10/启用 8/`site_fulltext` 0/`syndicate` 0、Ads 关闭、两个 Worker 运行中（8732/15560）、3010 未碰 |
| 正式持续翻译 | **仍关闭**：`translate.baseline` 与 `translate.lease` 均不存在，`.env` 未写开关 |
| 本轮文件 | `packages/backend/src/editorial/{key-facts.ts(新),policy-explain.ts}`、`packages/backend/src/publication/detail.ts`、`packages/contracts/src/site.ts`、`apps/web/app/features/item/reading.tsx`、`apps/web/app/routes/lead.tsx`、`tests/policy-explain-keyfacts.test.ts`、`tests/worker-translate-isolation.test.ts(新)`、本文件、`docs/radar/本地运行说明.md`；诊断脚本与截图在 `.data/_diag/`（非源码）。未 Commit/Push |

**六、仍未解决**

1. 15 篇没有 rule 解释记录的文章仍无「中文政策解释」正文（只有关键信息 + 速读）；要生成解释需跑 `analyzeArticle`（会重写 publication），需单独授权并先小样本验证。
2. 正文中文阅读仍受 `site_fulltext=false` 限制。
3. 3 篇停用来源的历史记录未翻译（不在当前情报面）。
4. 自动翻译的**自然周期**（跨小时/跨天调度、真实付费）未验证，只有隔离与单轮验证。

### R47（2026-10-24 15:55–16:40）：第一主线内容质量与中文阅读完善

**一、真实盘点（只读，执行时重新查询）**

| 项 | 数字 | 说明 |
|---|---|---|
| T1 editorial 条目 | 26 篇 | 其中 3 篇所属来源已停用（ads-policy-pages 2、amazon-us-accelerate-updates 1），不进入本轮批次 |
| 正式可译条目 | 23 篇 | Amazon 公告 2 + 费用 1 + CPSC 15 + FR-CPSC 3 + FR-FTC 2 |
| 轮次前中文标题 | 8 篇 | R45 完成 |
| 轮次前中文摘要 | 6 篇 | R45 完成 |
| 轮次后中文标题 | **23/23** | 本轮新增 15 篇 |
| 轮次后中文摘要 | **21/21** | 唯一无摘要的是费用页 `t4evq…`（只有标题，不造假摘要） |
| 全文模式 | 0 篇 | 六来源 `site_fulltext=false` 未改 |

“为什么有的只有一句话”归因（逐篇核对）：**A 官方来源只提供短摘要**（CPSC RSS 15 篇全部只有 `<description>`，无正文）；**B 已采到正文但不允许展示**（Amazon 公告 2 篇 body_html 3976/3039 字符，来源 `site_fulltext=false`）；**C 材料足够但没被提取**（召回标题/摘要里的品牌、商品、危险、数量、措施此前没有结构化输出 → 本轮 `keyFactsOf` 解决）；**D 有字段没展示**（`appliesTo` 是泛化句、`keyDates` 只有发布/收录日 → R46 起不渲染占位）；**E 来源本身缺信息**（费用页 `t4evq…` 无摘要无正文）。

**二、翻译补齐（R47 轮，受控）**

| 项 | 结论 | 证据 |
|---|---|---|
| 预算续轮机制 | `startTranslationRound(round, caps)`：把运行中的窗口**整轮归档**进 `settings.translate.rounds`（请求数、文章列表、费用、token、起止时间、以及该轮授权上限），再用新上限从零开新一轮；不清空、不伪造、不删历史；receipts 行不动 | `editorial/translate-budget.ts`；`tests/translate-budget-round.test.ts` 3/3 |
| R45 归档结果 | 请求 14/20、文章 8/8、费用 ¥0.0193/¥3（已归档，caps 记为 R45 授权值 20/8/3） | 归档输出 |
| R47 实际上限 | 40 次请求 / 20 篇 / ¥1，并发 1（脚本逐篇串行） | 命令行显式传入 |
| R47 实际用量 | **30 次请求、15 篇、输入 15,992 tokens、输出 1,210 tokens、¥0.0417** | `settings.translate.budget`（r47 轮）+ receipts |
| 累计用量 | **44 次请求、23 篇、输入 23,449 tokens、输出 1,764 tokens、¥0.0610** | `translationSpendSummary()` |
| 质量校验 | 23/23 通过数字/编号/日期保留校验（8 个 token 受校验）；另人工逐段核对 3 篇（Lithonia 撞击危险、FR 窗饰拉绳拟议、Giant 纽扣电池）——型号、单位（8 英寸/36 英寸）、法规名（Reese's Law）、拟议状态均正确 | 校验脚本输出 + 抽查记录 |
| 缓存复用 | 同一文本命中既有 receipt 不重复请求（同 logical key）；本轮 15 篇均为首次翻译，无重复计费 | `receipts` 30 行 |

**三、内容增强：确定性「关键信息」**

| 项 | 结论 | 证据 |
|---|---|---|
| 实现 | `editorial/policy-explain.ts` 新增 `keyFactsOf(input)`：纯规则、无模型、无网络，从 `title/excerpt/body` **逐字**提取并带 `evidence`（字段+命中词）。可输出：涉及商品（召回标题两种语序）、主要风险（危险词中文映射表，表外词不猜）、官方做法（召回/拟议认定/退款/更换/维修）、数量与金额（units 与 $ 区间）、文件类型（拟议/解释性/正式/通知）、发布机构 | 代码 + `tests/policy-explain-keyfacts.test.ts` 5/5（含反例：无材料不生成、表外危险词不翻译） |
| 契约 | `PolicyExplanation.keyFacts: PolicyKeyFact[]`（label/value/evidence）；前端 `keyFactsOf(item)` 优先读它，旧解释回退 change/生效日期 | `contracts/site.ts`、`features/item/reading.tsx` |
| 派生写入 | 8 篇白名单解释重写（含 keyFacts），写前快照 `.data/_diag/radar-explain-backfill-2026-10-24T08-08-22-873Z-*.json`；未重新分析任何文章、未改 publication/资格/统计 | 脚本输出「写入 8 条」 |
| 实际效果 | CPSC 召回（rbt2/khjm/g2s9j）→「涉及商品 / 主要风险 / 官方做法 / 发布机构」；FR（d7yc/fk7j）→「文件类型 / 发布机构」，拟议正确标注「拟议规则（尚未生效）」；Amazon 3 篇 → 仅「发布机构」或「官方做法」（原文没有的内容不编造）；费用页 `t4evq…` 无关键信息（材料只有标题） | API/页面实测 |
| 未覆盖 | 其余 15 篇没有 `radar-explain-v1` 解释记录（生成解释需重新分析文章，本轮不授权），因此无关键信息区块；它们的速读与中文摘要已包含具体信息 | 盘点表 |

**四、真实浏览器验收（86/86，0 新增控制台错误）**

十一类样本全部通过（每类 6 项检查 + 专项检查）：Amazon 官方公告、Amazon 费用更新、Costway 召回、另一条 CPSC 召回（Giant Bicycle）、FR 正式规则、FR 拟议规则、此前未翻译的英文文章（Decathlon）、原本已有中文翻译的文章（VQQQ）、只有摘要没有正文的文章（Papablic）、AMZ123 已匹配官方、AMZ123 尚未核实。专项：Costway 关键信息含商品/风险/做法且风险为中文；费用页不出现任何金额/费率/涨幅；FR 拟议标注尚未生效；1440/1024/390 三宽度 × 3 页面横向溢出 0。脚本 `.data/_diag/r47-accept.mjs`。

**五、长期自动翻译启用前核查（10/10 有代码依据，仍未启用）**

| # | 要求 | 现状 |
|---|---|---|
| 1 | 新文章自动发现入口存在 | `content.sweep`（*/5 分钟）+ `queueProcessing`（入库即入队） |
| 2 | 页面不触发付费请求 | `/api/site/*` 全为 GET；`translateTextPending` 只在 Worker 调度内 |
| 3 | 用途级授权 | `translationPurposeAllowed()`：仅 4 个 translate 用途且开关打开 |
| 4 | 每日文章数限制 | `reserveDaySlot` + `RADAR_TRANSLATE_DAY_ARTICLES=12`（北京时间） |
| 5 | 请求/费用限制 | 每轮 `limits`（请求数/文章数/金额）存 settings，发送前估算检查 |
| 6 | 版本过期安全重译 | 读层 join `revision >= a.revision`；写入条件 `revision <= EXCLUDED.revision`；同版本完整不降级 |
| 7 | 失败有界重试 | `translation_attempts` 同版本 3 次上限；`off/budget/busy/outage` 直接结束本轮 |
| 8 | 预算跨重启保持 | settings 表（DB），非进程变量 |
| 9 | 不误译启用前历史 | `settings.translate.baseline`：首次启用时刻写入，只处理其后的新文章 |
| 10 | 不影响采集 Worker | `content.translate` 是独立 cron 队列（singleton），与 `sources.fetch` 无关 |

**月费用情景估算（无足够历史调用量，按真实单篇成本外推）**：实测每篇（标题+摘要）≈2 次请求、输入约 1,066 tokens、输出约 81 tokens，按 `deepseek-flash` 官方价（输入 ¥2/M、输出 ¥8/M）≈ **¥0.0028/篇**。月新增 10 篇 ≈ ¥0.03；30 篇 ≈ ¥0.08；100 篇 ≈ ¥0.28；300 篇 ≈ ¥0.84。正式启用仍需：使用者单独授权持续付费 + 启动主 Worker（会同时开始消费通用 `sources.fetch`，两个社区 RSS 会重新采集）。

**六、边界与未破坏项**

零采集改动、零来源配置改动、零 `site_fulltext`/`syndicate` 改动、零迁移、零 AMZ123 入库、零 Worker 重启、Ads 仍关、3010 未碰；本轮改动文件：`packages/backend/src/editorial/{translate-budget,policy-explain}.ts`、`packages/contracts/src/site.ts`、`apps/web/app/features/item/reading.tsx`、`scripts/radar-translate-sample.ts`、`tests/{translate-budget-round,policy-explain-keyfacts}.test.ts`(新)、`.env.example`、本文件、`docs/radar/本地运行说明.md`。类型检查与前端构建通过；既有基线失败（`cache.test.ts` 4 例根路由重定向、缺 Playwright 自带 chromium）不变。未 Commit/Push。

### R46（2026-10-24 15:05–15:40）：全站文章详情阅读体验整改（前端，零后端/零数据改动）

**一、从阅读区移除的内容（不再渲染，数据与后端记录全部保留）**

| 移除项 | 说明 |
|---|---|
| 「内容身份与材料状态」大面板 | 五个 dt/dd 行的内部状态表；其内容改写为「来源与核实说明」里的几句人话（折叠） |
| 「政策核查信息」面板 | 中文说明/文本分类线索/生效日期/核实状态/选品影响五行技术文案；相关提示改为正文旁的一句话（拟议徽标、未证实标注） |
| 「规则命中依据」面板 | 12 条关键词命中与原文摘录（内部核查线索），从文章页**整体移除**，不再换个名字继续显示；`ruleEvidence` 仍由 API 返回、后端留存 |
| 「中文政策解释」大框 | 材料范围/文件状态/内容语言/程序检查/notice 等技术声明；有效内容（变化、适用对象、日期）下沉到「重点速读 / 关键信息」，不再以解释框形式出现 |
| 「内容修订记录」独立区块 | 并入折叠的「来源与核实说明」（只列日期与标题，不含修订号） |
| 顶部重复英文标题 | CPSC 等来源把整条标题写进 `articles.author`，导致标题上方重复一遍；在共用展示层 `readerAuthor()` 过滤（长度 >60 或与标题同源即不显示），**不改入库字段** |
| 标题上方的「机器翻译标题 · 下方保留来源原文标题…」长句 | 改为标题上方一枚小徽标「机器翻译 · 未经人工核对」，英文原标题移入折叠区 |
| 线索页「分类规则与线索标签」整块 | 规则 id、判定版本、发现方式等内部标识不再展示（来源 id 也不再展示） |

**二、新的阅读结构（共用组件 `apps/web/app/features/item/reading.tsx`，正式文章与线索同一顺序）**

| 顺序 | 内容 | 数据来源 |
|---|---|---|
| 1 文章头部 | 来源简称（`readerSourceName`：去掉「｜」前缀与 ` RSS` 后缀）+ 作者（仅真人/机构）+ 正确类型的日期 + 中文标题 h1 + 简短「阅读原文」入口（手机端常驻，桌面端在右侧栏与工具栏） | 既有字段 |
| 2 重点速读 | 标题后第一段：已取摘要的第一两句话（不补写、不扩写）+ 一句「这是什么、覆盖到什么程度」（机器翻译/规则整理/英文未翻译；仅摘要/仅标题/已取得正文但来源只允许展示摘要）；拟议规则在此处挂「拟议规则，尚未生效」徽标；摘要本身很短时不再重复一遍，只给「查看来源摘要原文」 | `summary` + `identity` + `explanation` |
| 3 关键信息 | **只在材料真实支撑时出现**：原文写明的「变化」（原文依据）、原文线索里的「生效时间」；不生成「未知/无」占位行 | `explanation.change` / `keyDates` |
| 4 详细内容 | 有正文且来源允许展示 → 中文译文优先、可切原文；只有摘要 → 中文/英文摘要并注明「不是完整正文」；没有中文 → 原文与原文链接，不伪造中文 | 既有 `body` / `summary` |
| 5 来源与核实说明 | 默认收起的 `<details>`：原文标题、来源与链接、日期口径（官方发布/来源更新/本地收录，各自标注）、中文内容是什么（机器翻译未经人工核对 / 译文是否过期）、材料覆盖、内容修订（≥2 版）、免责声明 | 既有字段 |
| 线索页差异 | 保留独立的「官方核实」区块：核实状态 + 证据机构 + 官方文件与链接 + **已证实的说法 / 尚未证实的说法**分组（不展示内部状态枚举）；其余来源信息与处理状态收进同一个折叠区 | `lead.officialClaims` |

**三、列表卡片一致性**

`FeedItem` 的身份行改为读者用语（`readerLine()`）：`机器翻译 · 中文摘要 · 有中文解读` / `英文原文 · 未翻译` / `译文待更新`，不再输出 `machine-zh`、`rule-zh`、`正文未译` 这类内部词；标题上的「机器翻译」徽标与「原文标题：…」保留。

**四、真实浏览器验收（63/63，0 新增控制台错误）**

八类样本全部通过（每类检查：首屏即标题与重点速读 / 后台诊断面板已移除 / 无重复大段文字 / 原文入口与折叠说明存在 / 材料覆盖如实说明 / 拟议与未证实提示未被隐藏）：

Amazon 公告（中文标题+摘要+解释）、CPSC 召回（Costway）、FR 正式监管文件、FR 拟议文件、未翻译英文文章、只有摘要的文章、AMZ123 已匹配官方线索、AMZ123 未核实线索。390px 连续阅读 6/6；1440/1024/390 三宽度 × 3 页面横向溢出均为 0。截图与前后对照在 `.data/_diag/r46/`（`before.json` / `after.json` + 每页 1440 全页/首屏与 390）。

| 页面（1440 全页高度） | 修改前 | 修改后 |
|---|---|---|
| Amazon 公告 | 2145px | 一屏内（<900px） |
| CPSC 召回 | 1919px | 一屏内 |
| FR 正式规则 | 1909px | 一屏内 |
| FR 拟议规则 | 1638px | 一屏内 |
| 未翻译英文 | 1390px | 一屏内 |
| 只有摘要 | 1458px | 一屏内 |
| AMZ123 已匹配官方 | 3424px | 1700px |
| AMZ123 未核实 | 2512px | 1261px |

**五、验证与边界**

| 项 | 结论 | 证据 |
|---|---|---|
| 类型检查 / 构建 | `npm run typecheck` 与 `npm run build -w @aihot/web` 通过 | 命令输出 |
| 后端 / 数据库 / 采集 | **零改动**：本轮只改 `apps/web` 四个文件（`features/item/reading.tsx` 新增、`routes/item.tsx`、`routes/lead.tsx`、`features/feed/FeedItem.tsx`）；`packages/**`、`apps/api`、`apps/worker`、`database/**`、`industry/**` 未动 | git status |
| 前端测试 | `markdown` 2/2、`cache/day-header/local-state/session-cache/timeline-unread` 28 例中 16 过 12 败——**均为既有基线**：`cache.test.ts` 4 例因 Radar 根路由 `redirect("/all")`（`routes/home.tsx`，R40 起配置）使 `/_.data` 返回 202+302；其余为缺 Playwright 自带 chromium（R44 已记录） | 失败输出 + `routes/home.tsx` |
| 未破坏的能力 | DeepSeek 中文标题/摘要、英文原名与链接、规则解释（数据仍在，只是不再以大框展示）、翻译版本失效、`ruleEvidence` 与 `revisionHistory` 仍由 API 返回、AMZ123 人工核实结论、采集 Worker 与频率、`site_fulltext` 配置 | 代码 + API 实测 |
| 已知取舍 | ① 「关键信息」在当前 26 篇官方条目上**没有可填充的真实字段**（无结构化金额/适用对象，日期差异 0 条，变化表述均为泛化句），因此多数文章不渲染该区块——按任务要求不造占位数据；② 召回类商品/危险等要素以速读+摘要呈现，未做英文句子抽取（避免抽取错误） | SQL 统计 + 页面实测 |

### R45（2026-10-24 13:55–14:40）：DeepSeek 中文翻译接入、小额真实样本与验收

**一、API 配置与用途级门禁（不关闭规则模式）**

| 项 | 结论 | 证据 |
|---|---|---|
| 本地配置 | **找到，但密钥槽为空**：`.env` 有 `LLM_BASE_URL=https://api.deepseek.com/v1`、`LLM_MODEL=deepseek-flash`、`LLM_EXTRA_JSON={"thinking":{"type":"disabled"}}`，`LLM_API_KEY` 长度 0；`.env.example` 同结构；`credentialsDir` 为空、无 `models.env`、机器级环境变量无模型键 | `.env` 键名/长度实查（未打印值）；`config.ts`、`settings` 表无模型键 |
| 密钥来源 | 经使用者逐次授权，从本机另一项目已有的 DeepSeek 密钥复制进**本项目** `.env` 的 `LLM_API_KEY`（35 字符，sk- 前缀）；**未修改、未读取回显**对方项目任何文件；写前备份 `.data/_diag/env-before-translate.bak` | 授权问答记录 + 写入脚本输出（只打印长度） |
| 官方接口核验 | `GET https://api.deepseek.com/v1/models` → **200**，账号可用模型：`deepseek-flash`、`deepseek-v4-pro`。本项目用 `deepseek-flash`（非 Pro），思考显式关闭（`LLM_EXTRA_JSON`） | 真实 HTTP 调用 |
| 用途级门禁 | `paidRequest` 仍在规则模式下**发网络前抛错**，唯一例外是 `translationPurposeAllowed()`：`RADAR_TRANSLATE_ENABLED=true` **且** purpose ∈ {translate_title, translate_excerpt, translate_body, translate_quoted}。`MODEL_CALLS_ENABLED` 保持 false，`llm.ts` 仅对这四个用途放行该开关 | `config.ts`、`receipts.ts:257`、`llm.ts`；回归断言：`score_article` 仍被拒且未触达 provider |
| 预算与并发 | 上限存 `settings.translate.budget`（重启/重跑不重置）：请求 20 次、不同文章 8 篇、¥3；每次发送前按「最坏输出 + 保守输入」估算检查余额，超限**拒发且不写 receipt**；同时只允许一轮（`settings.translate.lease` 租约，10 分钟过期）；单轮串行 | `editorial/translate-budget.ts`；隔离测试「超限拒发且不计数」通过 |

**二、真实调用与样本（本轮全部真实费用）**

| 项 | 结论 | 证据 |
|---|---|---|
| 连通性测试（第 1 步） | 1 次真实请求、526 tokens、¥0.0011，返回可解析 JSON、中文、token 用量入库；未破坏规则模式 | `receipts` 首行 `translate_title completed` |
| 样本（第 2 步） | 7 篇执行 + 上述 1 篇 = **8 个不同文章 ID（上限 8）**；**14 次请求（上限 20）**；输入 **7457** tokens、输出 **554** tokens；按官方价 **¥0.0193** | `settings.translate.budget`、`receipts`（14/14 completed） |
| 中文标题 | **8 篇**（Amazon 公告 2、费用更新 1、CPSC 召回 3、联邦公报解释性规则 1、联邦公报拟议规则 1） | `translations.lang='zh'` 8 行 |
| 来源摘要译文 | **6 篇**（`zh-excerpt`）。`ye905…` 的摘要是 R42 规则整理的中文摘要 → **跳过不重复翻译**（`excerpt: already Chinese`）；`t4evq…` 无摘要 → 只翻标题 | 8 行明细实查 |
| 正文翻译 | **正式库 0 篇**（六来源 `site_fulltext=false`，页面不展示正文，因此也不产生正文译文）；正文翻译器在隔离库 2/2 验证通过 | 见「五、正文与自动增量」 |
| 样本缺口（如实） | ① 8 篇样本的标题/摘要里只有 4 个数字型 token（`2026`、日期等），**「金额/百分比保真」未被真实样本充分覆盖**，只由隔离测试的拒绝用例覆盖；② 其余 15 篇官方条目仍是英文（8 篇上限） | 逐篇 token 比对输出 8/8 通过；token 计数 |

**三、存储、读层与页面**

| 项 | 结论 | 证据 |
|---|---|---|
| 存储位置 | 复用既有 `translations` 表，不新增表/列/迁移：标题写 `lang='zh'` 的 `title`（**不写 body**、`complete=false`），来源摘要写 `lang='zh-excerpt'` 的 `body_text`（`complete=true`）。`articles.title` 与 `publications.title` **均未改** | `editorial/translate-text.ts`；SQL 实查 |
| 读层 | `ITEM_COLUMNS` 增 `tr.title`、`tre.body_text`，join 条件 `revision >= a.revision`（旧版本自动不出现）。`toItemSummary`：有当前译文时 `title`=中文、`originalTitle`=来源标题、`summary`=中文、`originalSummary`=来源摘要；`identity.titleKind/summaryKind` 新增 `machine-zh` | `publication/items.ts`；API 实测 |
| 公开 API | `/api/site/pool`、`/api/site/items/:id` 实际返回中文标题/摘要、英文原文、`identity.machine-zh` | 真实 3001 响应（见下条） |
| 页面 | 列表卡片：中文标题 + 「机器翻译」徽标 + 「原文标题：…」；详情：中文 h1 + 「原标题（来源原文）」+ 「来源摘要译文（机器翻译，未经人工核对）」+ 可展开「查看来源摘要原文」+ 身份面板逐项说明；未翻译条目回退英文并如实标注 | 浏览器验收 26/26（见下） |
| 规则解释 | 与机器翻译**完全分开**存储与展示；本轮同时修掉一处会随翻译上线而失真的文案——解释里原本写「尚无中文译文」的判断改为**不写翻译状态**（该状态由身份面板读当前译文），8 篇解释已用同一工具重写（快照 `.data/_diag/radar-explain-backfill-2026-10-24T06-33-27-560Z-*.json`） | `policy-explain.ts`；`explanation` 重写输出「写入 8 条」 |

**四、版本与并发安全**

| 项 | 结论 | 证据 |
|---|---|---|
| 旧版本不覆盖新版本 | 写入条件 `translations.revision <= EXCLUDED.revision`；读层 join `revision >= a.revision`；原文修订后旧译文**立即不作为当前结果**（`identity.translation=stale`，标题回退英文） | 隔离测试 3 例 + 真实库里 `t4evq` 等 revision 1 |
| 同版本不降级 | `translate.ts` 原有守卫保留：完整译文不会被同版本部分译文覆盖；标题行走 `complete=false`，永不冒充「正文已译」；同版本文字未变时仍会把 `revision` 迁移到新版本（否则会被误判 stale） | `tests/translate.test.ts` 同版本用例仍通过；新写法在隔离测试覆盖 |
| 迟到的旧任务 | 隔离测试「旧版本回答（revision 1）在 revision 2 之后写入 → 不生效」通过；写入前 `SELECT … FOR UPDATE` 校验当前版本（沿用 `storeTranslation`） | `tests/translate-item-chain.test.ts` |
| 译文不覆盖规则解释 | 两套字段、两套写入路径，互不引用 | 代码 + 页面区块独立 |
| 缓存不重复计费 | 同一文本命中既有 receipt（logical key 含 prompt/模型/参数哈希）则复用，不再发请求（隔离测试：revision 2 复用 revision 1 的答案，provider 仍只被调用 2 次） | `receipts.ts` 复用路径；隔离测试断言 |

**五、正文与自动增量（隔离环境，不碰正式展示边界）**

| 项 | 结论 | 证据 |
|---|---|---|
| 正文翻译器 | 未改一行既有实现，在**独立库副本**把来源 `site_fulltext` 设为 true → `translateArticle` 完整译文（`complete=true`，95% 与 2026-03-01 保留）→ 页面读中文正文；再把 `site_fulltext` 设回 false 并重发布 → **正文与译文都不再展示**，译文行保留 | `tests/translate-body-isolated.test.ts` 2/2 |
| 自动增量 | `content.translate` 仅在 `RADAR_TRANSLATE_ENABLED=true` 时注册，调用 `translateTextPending()`：**以首次启用时刻为基线**（`settings.translate.baseline`，不回填历史）、每轮 ≤3 篇、每北京时间日 ≤12 篇、租约单轮、失败/跳过记 `translation_attempts`（3 次上限） | `apps/worker/src/schedules.ts`、`translate-text.ts`；隔离测试 6/6 |
| 完整链路 | 新记录 → 分析/发布（既有 `analyzeArticle`/`publishArticle`）→ 增量入口翻译 → 公开读层中文 → 原文修订后失效 → 新版本再译 | `tests/translate-item-chain.test.ts` 6/6 |
| 正式持续调用 | **保持关闭**：`.env` 未写 `RADAR_TRANSLATE_ENABLED`；`settings.translate.baseline` 与 `translate.lease` **均不存在**（说明调度从未启动）；主 Worker 未运行 | settings 实查 |
| 页面不调模型 | 所有页面/接口仍是 GET 只读；翻译只发生在脚本或 Worker | 路由清单 + 浏览器验收 |

**六、验收证据与边界**

| 项 | 结论 | 证据 |
|---|---|---|
| 类型检查 | `npm run typecheck`（contracts/backend/api/worker/tests/modules/web）通过 | 命令输出 |
| 构建 | `npm run build -w @aihot/web` 通过（951ms） | `.data/_diag/build-web.log` |
| 定向测试 | 新增 8 例全通过（`translate-item-chain` 6、`translate-body-isolated` 2）；既有 `radar-core.standalone` 9/9、同版本防降级回归通过；`tests/translate.test.ts` 其余 12 例仍为**既有基线同类失败**（规则模式下模型路径不可达，非本轮引入） | 日志 `.data/_diag/translate-chain.log`、`body-isolated.log` |
| 真实浏览器 | 真实 Chrome（channel=chrome）26/26：列表/来源筛选/搜索/详情/刷新/英文回退/正文不展示/1440·1024·390 零横向溢出；每页 1 条既有 hydration 告警（未翻译条目页同样出现，非本轮引入），0 新增运行错误 | 截图 `.data/_diag/r45/` |
| 环境一致性 | Web 3000（pid 3200，dev 热更新）、API 3001（pid 27696，本轮重启加载新读层）、PG 5544；`/api/health` 200 | 实查 |
| 边界未动 | 六来源 `site_fulltext=false` ×10 行全为 false、`syndicate_fulltext` 全 false；`publications` 126（`body_mode=full` 仍 0、eligible 125）；分类口径未变；AMZ123 线索 3 条未动；两个专用 Worker（pid 8732/15560）未重启、队列与频率未改；Ads 未开；3010 未碰；未 Commit/Push | SQL 实查 + `radar-ops status` |
| 本轮改文件 | `packages/backend/src/config.ts`、`providers/{receipts,llm}.ts`、`editorial/{translate-budget.ts(新),translate-text.ts(新),translate.ts,policy-explain.ts}`、`publication/items.ts`、`packages/contracts/src/site.ts`、`apps/web/app/features/feed/FeedItem.tsx`、`apps/web/app/routes/item.tsx`、`apps/worker/src/schedules.ts`、`industry/prompts/translate-item.md(新)`、`scripts/radar-translate-sample.ts(新)`、`tests/{translate-item-chain,translate-body-isolated}.test.ts(新)`、`.env.example`、本文件、`docs/radar/本地运行说明.md`；诊断脚本 `.data/_diag/r45-browser.mjs`（非源码） | git status |

**七、最终验收表**

| 项目 | 状态 | 证据 |
|---|---|---|
| DeepSeek API 可用 | **PASS** | `/v1/models` 200；14 次真实调用 14/14 completed |
| 翻译安全门禁 | **PASS** | 只有四个 translate 用途放行；`score_article` 仍被拒且未触达 provider；`MODEL_CALLS_ENABLED` 未改 |
| 中文标题 | **PARTIAL** | 8/23 官方条目（受本轮 8 篇上限），其余仍英文 |
| 中文来源摘要 | **PARTIAL** | 6/6 有英文摘要的样本已译；另 1 篇摘要本就是中文、1 篇无摘要 |
| 允许展示的中文正文 | **BLOCKED（有意）** | 六来源 `site_fulltext=false` 未改；正文翻译仅隔离验证 |
| 译文缓存和版本安全 | **PASS** | 同文本复用 receipt 不重复计费；旧版本不覆盖新版本、同版本不降级 |
| 真实页面中文展示 | **PASS** | 26/26 浏览器检查；API 与页面均读译文 |
| 新文章自动翻译工程能力 | **PASS（隔离）/ 未启用（正式）** | 隔离 8/8；baseline/lease 不存在，正式调用关闭 |
| 成本限制 | **PASS** | 14/20 次、8/8 篇、¥0.0193/¥3；超限拒发 |
| 采集及事实隔离 | **PASS** | 统计、来源配置、线索、核实结论均未变 |

**八、当前真实阻塞与限制**

1. **覆盖率**：23 篇官方条目只有 8 篇有中文标题（本轮授权上限 8 篇）。继续需要新的额度授权（每篇标题+摘要约 2 次请求、≈¥0.003）。
2. **正文中文阅读**：受六来源 `site_fulltext=false` 限制，页面不展示正文与正文译文；要开放必须先改来源全文展示依据（独立授权）。
3. **人工语义核对**：自动校验只覆盖数字/编号/长度，未做人工逐条语义核对；8 篇标题已通读、2 篇摘要逐段对照，其余标记「未经人工核对」（页面已如实标注）。
4. **自动增量未在真实运行中启用**：主 Worker 未运行，`content.translate` 只在隔离环境验证；启用需同时满足「使用者授权持续付费」+「主 Worker 运行」。
5. **无译文成本看板**：用量只能查 `receipts` 与 `settings.translate.budget`，本轮未做管理页展示（避免扩大范围）。

### R39–R44（2026-10-24 06:33–07:55）：第一主线中文阅读链路（核查 → 实施 → 真实验收）

**一、R39 三态核查（G1/G2/G3，全部只读取证）**

| 项 | 结论 | 证据 |
|---|---|---|
| G1 材料与展示依据 | **六来源展示依据全部「受限」且配置一致**：`industry/sources.json` 与 `sources` 表逐字段比对一致（site_fulltext=false、syndicate=false、interval 360/60/60/120/120/360、enabled=true、RSS 行无 `detail` 键）。announcements 是**唯一写正文**的来源（2/2 篇 body_status=ok，2820/2269 字符）；fee **无正文且无摘要**（excerpt 长度 0，eligible=false）；三个 RSS 源 feed 只有 `<description>`（实测），body_status=pending；amz123 只存元数据（body_status=none）。`bodyModeOf` = `site_fulltext && bodyStatus==='ok' && hasBody` → 六来源恒 `summary`，详情 `body=null`（实测两条），列表/公开 API 不出正文，全文 RSS 需 syndicate=false。译文 join 存在但 news 预道恒不出、详情仅 full 分支使用 | `radar-policy-source/web-list/rss/amz123` 代码；sources 表实查；`GET /api/site/items/*` 实测 body=null |
| G2 翻译引擎 | **受阻**：仓库唯一翻译路径 `translate.ts → chatJson → paidRequest`，`receipts.ts:257` 在规则模式**发网络前抛错**（`radar-core` 断言为设计特性）；`MODEL_CALLS_ENABLED=false`；本机端口扫描无 11434/1234 等本地模型服务；`.env.example` 只列付费服务。**没有已安装、已授权、零新增付费的翻译引擎** → 标题/摘要/正文翻译本轮不实现，不用手写样本伪装 | `config.ts:37`、`receipts.ts:257`、`llm.ts:166`、端口实测 |
| G3 后台自动处理入口 | **代码已具备 / 运行态受阻**：发现=写入即 `queueProcessing` + `content.sweep` 每 5 分钟；执行=主 worker 的 `content.analyze`（并发 6）与专用采集 Worker（锁 001/003、私有队列、并发 1）；重试=`RETRY_MINUTES`+`singletonKey`+`translation_attempts` 3 次上限；恢复=pgboss 持久化 + `ops.recover` + `QUEUED_STALE=30min`；视图=`/admin/runs`；原文更新=`reviseMaterial` 重置状态并重新入队。**但 `apps/worker/src/main.ts`（主 Worker）未运行且本任务不授权启动**，`content.translate` 在规则模式不注册 → 解释的自动执行链路运行态受阻、翻译链路结构性受阻。页面加载/刷新**不触发**任何翻译或解释计算（site.ts 全 GET、无 translate 路由） | G3 核查报告（逐条文件:行号）+ 本机进程实测（仅两个专用 Worker 在跑） |
| 统一样本表 | **12 个 ID（8 写 + 4 只读）**：Amazon 公告 2（`ye905…` 完整正文+中文规则摘要、`u7vd…` 完整正文+英文摘要）、Amazon 费用 1（`t4evq…` 无正文无摘要=仅标题）、CPSC 召回 3（`rbt2…`/`lq7o…`/`khjm…` 仅摘要）、FR CPSC 1（`d7yc…` 解释性规则）、FR FTC 1（`fk7j…` 拟议规则）、IOR 线索 `e27u…`、付费邀评线索 `p4c2…`、已排除线索 `ss4u…`、留出样本 FR FTC `ji54…`（只读、不调参）。**未覆盖**：表格正文、官方发布日期缺失样本（六来源样本均有日期）→ 标未验证 | 本轮 SQL 实查 + API 实测 |

**二、R40–R43 实施（本轮修改文件）**

| 项 | 结论 | 证据 |
|---|---|---|
| R40 中文界面 | 范围内页面本就基本全中文（/all、/items、/leads、/lead、nav、SearchOverlay、feed 组件逐条盘点）；本轮补齐**英文枚举兜底**：`leads.tsx`（run status / officialStatus 缺 `evidence-insufficient`、`unknown` / processingState）、`lead.tsx`（officialStatus/market/eventState/discoveredVia/processingState 兜底全部改中文「状态未知」等）；导航 `/all` 入口由「全部跨境市场动态」统一为**「平台政策情报」**（与 h1、详情面包屑一致） | 代码 + 浏览器实测（导航显示「平台政策情报」） |
| R40 内容身份透明 | 新增契约 `ContentIdentity`（标题/摘要生成方式、材料范围、正文是否展示、译文与解释版本状态），`publication/items.ts` 从既有字段计算 `identityOf()`（列表+详情统一），详情新增**「内容身份与材料状态」**面板五行；列表卡片新增一行身份（`原文标题 · 来源摘要 · 无译文 · 有中文解释`）。**标题去重**：title==originalTitle 只显示一次并标注「原文标题（来源语言，未翻译）」；摘要标签改用服务端 `summaryKind`（`政策摘要（依据正文规则整理）` / `来源摘要（来源语言原文）`），不再靠前端硬编码前缀匹配 | `contracts/site.ts`、`publication/items.ts`、`item.tsx`、`FeedItem.tsx`；API 与页面实测 |
| R41 版本安全 | ① `translate.ts storeTranslation` 同版本守卫：**完整译文永远不会被同版本部分译文降级**（`revision < EXCLUDED.revision OR NOT complete OR EXCLUDED.complete`），较新版本仍可覆盖；② 导出 `storeTranslation` 供回归直接驱动存储规则（模型路径在本仓库不可达，见 G2）；③ 定向回归 `tests/translate.test.ts`「完整译文先写入 → 部分译文随后返回 → 数据库与页面仍保留完整译文」**通过**（含反向：完整可替换部分） | `translate.ts`；测试实跑通过 |
| R42 中文政策解释 | 新增 `packages/backend/src/editorial/policy-explain.ts`（`radar-explain-v1`）：**确定性规则整理**（无模型、无网络），输出一句话看懂/当前明确/具体变化（**只有官方文本自己说变化才给，拟议阶段强制标注尚未实施**）/适用对象/关键日期（发布·来源更新·本地收录·生效原文线索，各自标注）/待确认事项/证据位置/程序检查（证据逐字、日期取自字段、中文不含材料中没有的数字）。集成进 `analyze.ts` 规则分支（Worker 分析任务内生成，页面读取不计算），带**同版本防降级**（`keepCompleteExplanation`）；`detail.ts` 只返回当前版本解释；列表用 `rule_status` 子计算解释状态 | 新文件 + analyze/detail/items 改动；单测 4 例通过 |
| R42 白名单写入 | **8 个文章 ID 写入正式库**（≤12 上限）：`ye905…、u7vd…、t4evq…、rbt2…、lq7o…、khjm…、d7yc…、fk7j…`，只写 `analyses.output` 的 `explanation`+`ruleSummary` 两个派生键，**不改** publications/发布资格/统计口径/原始事实/人工核实；每条 before/after 快照在 `.data/_diag/radar-explain-backfill-*.json`；工具 `scripts/radar-explain-backfill.ts`（默认 dry-run，`--apply` 才写，CAS 防并发，白名单上限 12，来源白名单校验） | 脚本输出 + 快照文件 + `count(explanations)=8` |
| R43 阅读体验 | 详情顺序改为 **标题 → 内容身份 → 中文政策解释 → 摘要 →（正文）→ 政策核查信息/规则命中依据/修订记录 → 原文链接**；无数据项隐藏并说明（材料/译文/解释状态行）。响应式实测 **1440 / 1024 / 390 横向溢出均为 0px**（含 390 长标题详情） | 浏览器实测 + 8 张截图（`.data/_diag/r44/`） |
| 自动链路（隔离环境） | **`tests/radar-explain-chain.test.ts` 1/1 通过**，走既有核心实现：新记录 → `content.sweep` 自动发现 → 既有 `content.analyze` 队列执行（测试不直接调用分析入口）→ 解释随判断持久化（绑定 inputRevision、带 notice 与程序检查）→ 公开读取层返回 `explanation` 与 `identity.explanation=current` → 全程 0 次付费请求；随后**原文修订**：旧解释不再作为当前结果返回（`identity=stale`），同一链路再次自动执行并产出 revision 2 的解释 | `tests/radar-explain-chain.test.ts`（独立库副本实跑） |

**三、R44 验证与环境**

| 项 | 结论 | 证据 |
|---|---|---|
| 环境一致性 | Web `127.0.0.1:3000` PID 3200、API `127.0.0.1:3001` **本轮受控重启**（身份核验命令行属于本仓库后 taskkill /T，`radar-ops start api` → PID 39624）、PG 5544=便携 PG17.11（`lightchoice_radar`）；分支 master、Commit `e7ae899`、工作区 101 个改动文件（95 个为既有未提交修改）；`/api/health` `{ok,db:ok}` | 进程/端口实查 + curl |
| 类型检查 | `npm run typecheck`（contracts/backend/api/worker/tests/modules/web）**通过** | 命令输出 |
| 测试 | **独立测试 `377 例 / 通过 371 / 失败 6`**（两轮结果一致）：6 个失败与第十八轮记录的既有基线同类——`spawn openssl ENOENT`（本机无 openssl）、header overflow 断言（undici 环境差异）、`page-metadata` 3 例（夹具缺 `/api/site/pool/sources` + Radar 首页重定向），均不 import 本轮模块。**数据库全量**：先按原样跑两次都在既有用例上无限挂起（`analyze-shutdown` 的子进程等一个永远不会来的付费请求、`backup.test.ts` 的 pg_dump 子进程不退出——均属 BLOCKERS 2 的既有不兼容），随后排除这 4 个挂起文件跑完 **121 个文件：686 例 / 通过 450 / 失败 231**；231 个失败按错误文本分类：147 处 `Paid provider requests are disabled`（规则模式硬拦截）、5 处超时、模板库自带来源导致的 `admin-reads/backend-read-load` 断言、HEAD 里既有的 `revisionHistory` 摘要暴露（`x-fulltext-license`）、既有 rounds 的 CSS/env-var 断言、以及我中止两次挂起运行留下的 3 个同名库副本冲突（pid 复用）。**没有任何失败指向本轮改动的模块**（`does not exist`=0、`SyntaxError`=0、`relation`=0）。定向：`radar-core.standalone` 9/9、新增同版本防降级回归通过、**新增自动链路测试 `tests/radar-explain-chain.test.ts` 1/1 通过** | 测试日志 `.data/_diag/test-*.log`、`chain4.log` |
| 构建 | `npm run build -w @aihot/web` **通过** | 命令输出 |
| 页面测试（apps/web） | `node --test apps/web/tests/*.test.ts` **本机无法完整执行**：`item-copy` / `page-width` / `request-target` / `article-outline` 依赖 Playwright 自带浏览器（`ms-playwright\chromium-1228` 缺失，报 `Executable doesn't exist`，不授权下载）；`markdown` 2/2 通过；整套运行在其余用例上挂起后中止。**页面验收改用本机 Chrome + Playwright CLI 完成**（见下一行），比 fixture 浏览器测试更接近真实 | 命令输出 `.data/_diag/web-itemcopy.log` 等 |
| 真实浏览器验收 | Playwright 真实 Chrome：/all 列表身份行 40/40、来源筛选 15 卡、搜索 UI 交互（`/all?dateBasis=collected&q=Costway` 找到 1 条）、空结果态、详情五段身份+解释+日期+待确认、原文链接指向 cpsc.gov、刷新后仍在、`/original` 路由正常（无译文故无中/原文切换）、/leads 徽章与运行状态三分区、IOR 详情 9 主张（8 处「官方原文支持」含导语 + 3 处「未经官方证实」含导语）+「180 天」限定语 + 证据机构、已排除线索详情、404 中文错误页、拟议状态页。Console 仅 **1 条既有 JSON-LD hydration 告警**（R23 起已记录），无新增报错 | 会话 `.playwright-cli/` + 截图 `.data/_diag/r44/` |
| 事实与隔离回归 | 三类统计未变（platform_policy 3 / external_regulation 20）、publications 126（eligible 125、**body_mode=full 仍为 0**）、AMZ123 线索 3 条未动、`translations` 仍 0 行、六来源 enabled/health/interval/cursor 未改、双 Worker 未动、Ads 未开、3010 未碰 | 本轮 SQL 实查 |

**四、本轮写入与限制**

- 正式库派生写入：**8 个文章 ID**（见上），字段仅 `analyses.output.explanation` 与 `analyses.output.ruleSummary`；快照 `.data/_diag/radar-explain-backfill-2026-10-23T23-12-47-140Z-*.json`。
- **正式持续自动写入未启用**：主 Worker 未运行（本任务不授权启动），解释的自动发现→执行链路只在代码与隔离测试层面具备；翻译链路结构性受阻（G2）。
- 本轮修改文件：`packages/contracts/src/site.ts`、`packages/backend/src/editorial/{policy-explain.ts(新),analyze.ts,input.ts,translate.ts}`、`packages/backend/src/publication/{items.ts,detail.ts}`、`apps/web/app/routes/{item.tsx,leads.tsx,lead.tsx}`、`apps/web/app/features/feed/FeedItem.tsx`、`apps/web/app/components/shell/nav.ts`、`tests/{translate.test.ts,radar-core.standalone.test.ts,radar-explain-chain.test.ts(新)}`、`scripts/radar-explain-backfill.ts(新)` + 本文件；另有 `.data/_diag/run-tests.mjs`（隔离库测试运行器，非源码）。

### R38（2026-10-24 05:00–05:35）：真实运行验收、持续采集核查与情报质量复盘（只读，零代码改动）

来源运行表（截至 2026-10-24 05:19，观察窗口：R25 恢复以来约 4 小时 + 既有语料）：

| 来源 | Worker | 最近成功 | 下一次计划 | 最近新增 | 结论 |
|---|---|---|---|---|---|
| rss-cpsc-recalls | 公告（锁 001） | 05:13（132） | 06:13 | 语料 15 篇（7 日内建库）；24h 新增 0 | **当前价值明确**：连续 5 轮自然小时级周期（01:12/02:12/03:12/04:13/05:13，其中 3 次 304 Not Modified 正常），召回滚动供给持续 |
| us-federal-register-cpsc | 公告（锁 001） | 05:13（133） | 07:13 | 语料 3 篇；24h 新增 0 | **当前价值明确**：严格 120 分钟节奏（01:12/03:12/05:13），规则/拟议规则类高价值低频 |
| us-federal-register-ftc | 公告（锁 001） | 05:13（134） | 07:13 | 语料 2 篇；24h 新增 0 | **当前价值明确**：同上节奏稳定 |
| amazon-us-announcements | 公告（锁 001） | 01:12（119） | 07:12 | 语料 2 篇（13 个月窗口内全部合格政策）；24h 新增 0 | **运行正常但价值待观察**：360 分钟周期，列表 11 候选全部身份已知（detailAttempts=0），Amazon 公告本身低频 |
| amazon-us-fee-updates | 公告（锁 001） | 04:29（131） | 05:29 | 语料 1 篇；24h 新增 0 | **运行正常但价值待观察**：R26 尾期 69 分钟延迟已消失（02:28→03:29→04:29 稳定 60 分钟）；页面年更类，单次请求成本极低 |
| amz123-policy-leads | 专用（锁 003） | 00:37（118） | 06:37 | 线索 3 条（2 有效 1 排除），全部发现于 10-23；24h 新增 0 | **运行正常但价值待观察**：每分钟 tick 正常（60 次/小时），第二自然周期未到期 |

| 项 | 结论 | 证据 |
|---|---|---|
| 运行健康 | 双 Worker 持锁（001/003）、心跳实时（05:19）、Ads 002 空闲、零队列积压、线索调度 60 tick/小时、WT=0、3000/3001/5544 正常；五来源 **7 日内 39 次采集 0 失败、5 次 304** | 试锁、心跳文件、pgboss、WMI、curl |
| AMZ123 自然周期 | **第二自然周期尚未发生**（next 06:37:58，收口时 05:19），#117→#118 仍是唯一完整自然周期对。历史 run 逐条定性：#78=收录期、#111/#114/#115=开发轮受控、#112/#113=失败（R24 时代，已恢复）、#116=R21 手工单 URL 重采、#117→#118=自然周期 ✓ | fetch_runs 实查 + 各轮记录 |
| 正式供给质量 | 正式政策 23 篇（cpsc 15 / fed-cpsc 3 / fed-ftc 2 / 公告 2 / fee 1），**全部发现于建库 48 小时内（d24=0）**；7 日正文修订 23 条均为建库初始修订，无内容变化修订；公告 11 候选全部身份已知（gate memory 6 拒 + 2 入库 + 3 窗口外）；cpsc 40 条 found 全部为已存档 recall（正确去重）。**过去 24h 零新增 = 源头无新内容 + 去重/门禁正确，非故障**（cpsc feed 有 304 佐证内容未变） | psql 统计 + fetch_runs.detail |
| 线索供给质量 | 线索 3 条（2 有效 1 排除），全部 10-23 发现；此后 3 轮采集 found=0——AMZ123 政策栏目在该时段无新的美国站政策类报道（上游无内容），去重正确；无解析失败、无误收样本 | fetch_runs + articles |
| 核实结果完好性 | IOR：matched-official、9 主张、7 支持 2 未证实、证据机构=美国政府、日期标签精确——**全部保持**；邀评：third-party-only、6 主张全部未证实——**未被错误提升**；两条记录未被采集器覆盖 | API 实查 |
| 页面使用验收 | 7 页真实浏览器通过：/all（0 溢出）、/leads（徽章正确）、IOR 详情（证据机构/履职期限限定语/联邦公报链接）、邀评详情、已排除详情（未回流）、官方政策详情（FBA Grade and Resell 页面正常）、监管详情（Costway 高脚椅召回页正常） | DOM 快照 + 探针计数 |
| 来源价值分层 | **当前价值明确**：cpsc-recalls（持续滚动供给、实际货品合规相关）、fed-register ×2（正式规则文件、低频高价值）；**运行正常但价值待观察**：公告（低频但准入精准）、fee（年更页面，成本极低可忽略）、AMZ123（样本窗口不足 48 小时，需积累观察）；**已发现真实问题/暂不扩展**：无。无付费 API；无需要人工干预的常发故障；无无意义重复请求（304/身份已知跳过均正常） | 本表 + fetch_runs |
| P0/P1 问题 | **无**。未发现误收、漏收、重复、日期错误或核实错误；未发现状态虚报（所有「正常」均有锁/心跳/采集记录支撑） | 本表 |
| 边界 | 零代码改动、零数据写入、纯只读验收；页面无改动故只做轻量浏览器核对 | git status |

### R37（2026-10-24 04:45–05:05）：运行说明归一、核实回滚安全与自然周期最终收口

| 项 | 结论 | 证据 |
|---|---|---|
| P0 真实状态核对 | 双 Worker 持锁（001/003）、Ads 002 空闲、3000/3001/5544 正常、WT=0；R33–R36 的核实记录完好未被采集器覆盖（matched-official 9 条 / third-party-only 6 条）；正式统计 3/2/20 未变 | 实时查询（未用历史数据） |
| restore 并发缺陷（发现并修复） | **R33–R36 的 restore 无并发防护**：只校验快照归属 id 就无条件写回——5.1 场景（A 10:00 存快照 → B 10:05 写入新证据 → A 10:10 restore）会**静默覆盖** B 的新结论。最小修复（复用 apply 的比较逻辑，单一写入路径）：① 快照结构升级为 `{id, verification(旧), applied(应用后), appliedAt, appliedVerifiedAt}`；② restore 仅在「当前记录 == 该快照应用后状态」时执行，期间有其他更新即**拒绝**并提示人工对比；③ 重复回滚明确报告「无需重复回滚」不写入；④ 写入用**数据库原子条件更新**（`(raw->'lead'->'officialVerification') IS NOT DISTINCT FROM expected::jsonb`）兜底，rowCount=0 即冲突拒绝；⑤ **旧版快照（缺 applied）拒绝自动恢复**并给出人工流程提示，不为兼容而削弱门禁 | `scripts/record-lead-verification.ts`；SQL CAS 演示（不匹配 → UPDATE 0） |
| A–H 定向验证 | A 正常恢复 ✓（仅 officialVerification 字段变化，其余 raw 键/标题/摘要不动）；B 其他字段不变 ✓；C 另一条线索（lead 1）完全未动 ✓；**D 模拟另一会话更新后旧快照恢复 → 拒绝** ✓；E 用其他线索的快照 → 拒绝 ✓；F 损坏 JSON → 拒绝 ✓；G 重复回滚 → 「无需重复回滚」零写入 ✓；H 旧版快照 → 拒绝自动恢复+人工指引 ✓ | 测试序列实跑（D 用两次真实小更新模拟：R37 复核注 05:05 → 05:06） |
| 测试附带产物 | 邀评线索核实记录更新为 R37 复核版（note 注明「截至 05:06 仍未发现公开官方来源；公测后应重新核实」，verifiedAt 05:06）——内容真实准确，非测试垃圾数据 | `.data/_diag/` 快照链 + psql |
| 运行说明归一 | 「四件事」→ 五步（数据库 → API → Web → AMZ123 Worker → 公告/监管 Worker），写明两个 Worker 均为日常必要、单独恢复互不影响、不启 Ads/社区 RSS/停用来源；状态章节列出双 Worker + 五来源最近采集 + 三个口径区分（启用≠运行、health=ok≠仍在采集、next_fetch_at≠必然成功）；停止章节改为四步（公告 Worker → AMZ123 Worker → Web/API 核验后停止 → 数据库保留，`all` 才关库）；长期运行章节明确「无开机自启、一键补起≠自动恢复/无人值守监督、PostgreSQL 必须走启动入口（禁止旧 detached 直启）」；新增公告 Worker 日志路径 | `docs/radar/本地运行说明.md` |
| 官方来源自然周期 | **多个自然周期证据已取得**：cpsc 01:12→02:12→04:13（60 分钟节奏）、fee 02:19→03:28→04:29、fed-register-cpsc/ftc 01:12→03:12（120 分钟节奏），全部 health=ok fails=0；304/not-modified 为正常结果。AMZ123 第二自然周期 06:37:58 到期，**截至收口尚未发生，未验证**（#117→#118 仍是第一个周期） | fetch_runs + sources 实查 |
| 隔离与边界 | 线索 3 条/0 publications/0 正文；正式统计 3/2/20 未变；核实记录未被采集器覆盖；改动文件 2 个（`scripts/record-lead-verification.ts`、`docs/radar/本地运行说明.md`）+ 本文件；测试更新（邀评线索 R37 复核注，内容真实准确）；未改规则/频率/3010；未 Commit/Push | psql + git status |
| 保留限制 | ① restore 的旧版快照（R33 前生成）不含 applied 字段，只能人工对比后经 apply 恢复（安全优先，按任务要求不削弱门禁）；② SQL CAS 与应用层稳定对比并存，极端竞态下以 CAS 拒绝为准（信息以拒绝消息为准）；③ AMZ123 第二自然周期待 06:37 后查状态页确认 | 本表 |

### R33–R36（2026-10-24 03:40–04:00）：官方证据可信度复核 + 核实工具固化与复用

| 项 | 结论 | 证据 |
|---|---|---|
| R33 对抗式复核 | IOR 线索 **7/9 supported 结论经官方原文逐条重验全部成立**，无放宽证明标准。三处语义精确化（均有官方原文依据）：① 主张 2 补注「180 天是 EO 对 DHS/CBP 修订规则的履职期限，**不是卖家整改截止日**」（§2(a) 原文 "Within 180 days … the Secretary … shall … revise"）；② 主张 3 改写为「行政令**要求在后续规则修订中**提高境内资产/保证金门槛」——是规则修订方向，尚未落地为具体标准（EO §2(a)(i)）；③ 2026-09-18 显式标注为「CBP Form 5106 信息核查加强执法开始日期（不是整份行政令所有措施的生效日）」 | EO 14411 全文（91 FR 35125）、FR 2026-16911 DATES 条款 |
| R33 主体归属 | 核实记录与页面新增**「证据机构」**：`officialSource` = "美国海关与边境保护局（CBP）与美国联邦公报；行政令由白宫签署。证据机构是美国政府，不是 Amazon——亚马逊是否已向卖家发出对应通知见下方未证实条目”。页面不得把美国政府确认表述为 Amazon 官方确认 | verify-ior.json + lead.tsx + 浏览器实测 |
| R34 数据完整性 | `record-lead-verification.ts` 重写加固：① verification 必须是对象（双重 JSON 编码字符串拒绝）；② status 四态枚举校验；③ matched-official 必须有官方 URL/标题+至少一条 claim；④ **supported 必须附官方原文依据（evidence）**——仅凭 URL 存在不算；⑤ unverified 必须写明原因；⑥ 日期字段 YYYY-MM-DD 格式校验；⑦ **并发保护**：`expect.verifiedAt` 与当前库中值不一致即拒绝（Agent 旧记录不能静默覆盖新结果）；⑧ **幂等**：内容完全一致时报「无变更」exit 0；⑨ 快照→写入→回读验证一致，`restore` 精确回滚；⑩ 新增 `show`（只读取当前记录）与 `preview`（校验+预览不写库） | 六条拒绝路径 + 幂等 + 回滚往返实测（见下） |
| R34 验收实测 | 预览不写库 ✓；错误 expect 拒绝 ✓；双重编码拒绝 ✓；supported 缺证据拒绝 ✓；非法状态拒绝 ✓；幂等重应用 ✓（修复 jsonb 键序重排导致的误判——对比改为键序无关的稳定序列化）；快照恢复往返 ✓ | 脚本运行输出 |
| R31 补充修复（对抗式复核发现的真实展示缺口） | `ClaimRow` 原来对 supported 主张**不渲染 note**——R33 放在 supported 主张里的关键限定语（行政机关期限、规则修订方向）在页面上不可见，会夸大证据强度。已修复：两种判定都渲染 note，真实浏览器复验全部可见（含手机端 390px） | lead.tsx + 页面 body 文本探针（5/5 命中）+ 截图 |
| R35 可复用性 | 固定核实流程写入 `docs/radar/本地运行说明.md`：show → 有界研究 → 编写记录 JSON（含 expect）→ preview → apply → （需要时）restore。工具本身与线索无关（任意 lead id + 任意符合结构的记录），不绑定 IOR/邀评或固定条数。自动化的边界如实标注：**自动生成核实建议 ≠ 自动确认政策事实**，官方研究由人工/Agent 有界执行 | 本地运行说明.md 新章节 |
| R36 场景验收 | A：IOR 详情 7 支持+2 未证实、限定语可见 ✓；B：邀评详情保持 third-party-only、6 条全未证实 ✓；C：无官方支持的核实记录保留未证实状态（邀评即实例 + 校验强制）✓；D：证据对应性由「supported 必须附原文引文 + 证据机构显式化 + 人工复核」共同保障，纯自动语义匹配不存在（如实说明）✓；E：三类错误输入全部写入前拒绝 ✓；F：幂等重应用 ✓；G：已排除财报保持 skipped、不在默认列表 ✓ | 各场景实测 |
| 运行轻验收 | 双 Worker 持锁（001/003）、Ads 002 空闲、3000/3001/5544 正常、WT=0；AMZ123 第二自然周期 06:37 到期，**截至收口未到期，未验证**；API 又一次受控重启加载新字段（pid 33656） | 试锁 + WMI + curl |
| 文档清理 | NOT_DONE「EV-IOR 两个子主张未逐字核实」被 R33 更新（180 天已逐字核实；金额标准仍未发布）；NEXT sitemap 项标记 R27 已验证零增量不接入；NEXT 第 5 条明确 daemon:ads-policy 不是日常启动方式；核实工具操作说明入本地运行说明 | 本轮编辑 |
| 边界 | 本轮改动 5 个文件：`scripts/record-lead-verification.ts`（重写）、`packages/contracts/src/site.ts`、`packages/backend/src/publication/leads.ts`、`apps/web/app/routes/lead.tsx`（新增两字段与渲染）、`docs/radar/本地运行说明.md`（新章节）；核实数据仅 IOR 线索一条更新（快照可回滚）；未改规则/频率/采集器/3010；未 Commit/Push | git status + 操作记录 |

### R29–R32（2026-10-24 03:10–03:35）：第三方线索官方核实、证据闭环与情报可用性升级

| 项 | 结论 | 证据 |
|---|---|---|
| R29 主张审计（IOR 线索） | **找到强官方证据**：CBP 通告 2026-16911《Accuracy of Importer of Record Data Submitted to CBP》（联邦公报 2026-08-19 出版）+ 第 14411 号行政令（2026-06-03 签署）。报道 9 条主张中 **7 条被官方原文逐字支持**（EO 180 天修订期、境内资产/保证金门槛上调、货量/受益所有人等数据申报、境外 IOR 非正式申报禁止、CTPAT 要求、空壳公司整治、8-19 公示与 9-18 注销机制），2 条未经证实（亚马逊邮件内容、具体金额/时间表）。**日期语义修正**：报道所称 2026-08-19 实为 FR 出版日，官方声明的执行开始日为 2026-09-18——两者分开呈现 | 联邦公报 API + FR 2026-16911/2026-11595 原文 + AMZ123 原文（%TEMP%\zcode-radar-diag\r29） |
| R29 主张审计（付费邀评线索） | 三轮有界检索（已收录官方来源、亚马逊广告官方站点、公开搜索）**均无对应公开官方公告**——功能据称灰度中、10 月下旬才公测。6 条主张全部如实保持「未经官方证实」并附原因，**不伪造匹配** | 检索记录；核实记录 verify-rra.json |
| 已排除样本 | 倍思奇财报仍为 skipped，未回流 | psql |
| R30 核实闭环（最小实现） | 新增 `scripts/record-lead-verification.ts`：把核实记录写入**既有** `raw.lead.officialVerification`（快照→写入→回读；`--restore` 可精确回滚），只动这一个 jsonb 键；该字段内新增 `claims`（supported/unverified + 官方原文引文）与 `verifiedAt`——**零迁移、零新表、零新枚举**（沿用四态枚举）；采集器不重写已入库文章的该字段（collect.ts 仅更新 detailRules），记录持久安全 | 脚本 + verify-ior.json/verify-rra.json + jsonb_typeof 验证 |
| 一次修复（如实记录） | 首次写入把 verification 双重 JSON 编码成了 jsonb 字符串（jsonb_typeof=string，读取全为空）——定位为本脚本传参 bug（无外部写入者），修正为直接传对象后 jsonb_typeof=object、读取正常；期间两次快照与 `--restore` 路径可用 | jsonb_typeof 前后对比 |
| API 白名单扩展 | `leads.ts` 列表+详情 SELECT 暴露 `officialClaims`（逐字段白名单过滤：claim/verdict/evidence/note）与 `officialVerifiedAt`；契约新增 `LeadClaim` 类型。**零正文泄漏**：API 响应中 body_text/body_html/bodyText/bodyHtml 出现 0 次 | leads.ts、contracts/site.ts、curl grep=0 |
| R31 详情页 | `lead.tsx` 新增「报道主张逐条核实」区块：官方原文支持（含依据引文）与未经官方证实（含原因）**分开列出**；新增 evidence-insufficient 状态标签「找到相关官方资料，但不足以确认报道的说法」；核实时间行标注「不是政策日期」；核实限制文案更新（有界只读核实、不构成业务建议） | lead.tsx |
| 真实浏览器验收 | /leads：线索 1 徽章「已匹配官方记录」、线索 2「仅第三方报道」；线索 1 详情：9 条主张逐条渲染、「政策生效日期 2026-09-18」走官方已核实路径（报道所称行=0）、官方链接可点；线索 2 详情：6 条全部「未经官方证实」+原因；已排除线索详情保留「已排除」徽章且未回流；/all 正常；手机端 390px **横向溢出 0px** | 真实浏览器 DOM 快照 + 截图 ×4 |
| R32 端到端复核 | 双 Worker 各持锁（001/003）、Ads 002 空闲；AMZ123 下次自然到期 06:37（第二周期**截至收口未到期，未验证**）；隔离完整（线索 3 条/0 publications）；正式统计未变（3/2/20）；第三方正文零落库；WT=0；API 受控重启一次（身份核验→五步启动只补 API） | 试锁 + psql + WMI + curl |
| 边界 | 零迁移/零新表/零新 Worker/零新队列/零新依赖；未改 radar-rules、AMZ123 准入层、Federal Register、Ads；未动 3010；未批量改历史线索（仅当前两条有效线索写入，均有快照可回滚）；未 Commit/Push；本轮改动 4 个文件：`contracts/site.ts`、`publication/leads.ts`、`routes/lead.tsx`、新增 `scripts/record-lead-verification.ts` | git status + 操作记录 |
| 保留限制 | ① 核实为**有界研究**结果（官方原文引文可复核），不构成业务建议，最终判断留给用户；② 付费邀评线索待公测/官方发布后应重新核实（`record-lead-verification.ts apply` 重跑即可）；③ IOR 线索的「亚马逊邮件」主张依赖非公开渠道，长期保持未证实状态；④ AMZ123 多自然周期证据仍在积累 | 本表 |

### R28（2026-10-24 02:55–03:05）：公告候选漏检审计——11/11 全部有据，零漏检，零代码改动（情况 C）

| 项 | 结论 | 证据 |
|---|---|---|
| 审计方法 | 最新列表 11 个 URL 与 R27 完全一致（diff 为空）；四方交叉取证：数据库（articles/cursor/fetch_runs.detail）+ 列表页官方日期解析 + **9 次有界只读正文抓取** + **项目真实门禁函数本地判定**（非重新实现） | %TEMP%\zcode-radar-diag\s28（listing-now.html、9 个正文快照、gate-audit.mjs 及输出） |
| 代码语义核验 | 三处关键机制确认无缺陷：① `admission().byListing` 在详情读取**之前**按官方列表日期过滤窗口外条目；② `enrichDetails` 从 `detailAfter` 断点续读且**环形轮转**（先读断点之后、再回头补断点之前），无永久搁置；③ gate memory 按版本工作——版本变更即整体重读全部拒绝身份（`policyGateRejections`） | collect.ts L123-138 / L214-259、radar-policy-source.ts L221-224 |
| 运行诊断互证 | #77（10-23）attempts=7 / failures=0（6 篇门禁拒绝 + 1 次详情规则版本重读）；#119 起 attempts=0 / pending=0——与「2 篇已存储直接跳过 + 6 篇 gate 记忆预过滤 + 3 篇窗口外预过滤」的推导完全一致 | fetch_runs.detail 实查 |
| 3 篇未处理候选根因 | **官方列表日期全部在 13 个月窗口之外**：new-product-success-guide 2025-09-16、fba-grade-and-resell 2025-09-11、final-call 2025-09-02；窗口下限 ≈2025-09-22（源 2026-10-22 初始化，13 个月）→ `byListing` 按设计排除。**且实测正文即使在校正日期后也会被门禁拒绝**（三篇分别=新品指南、项目功能介绍、活动营销，均无规则证据句）——双重排除，非链路缺陷 | 列表页日期解析 + 9 次正文抓取 + 真实门禁判定 |
| 6 篇历史拒绝复核 | **全部正确**：6 篇正文重新抓取并用真实门禁函数逐一判定，全部 rejected，无规则证据句——business-deals（营销）、report-a-violation（功能宣传）、seller-cafe（活动）、seller-university（教育）、new-seller-news-mobile（产品公告）、fba-donation-certificate（功能上线公告，无规则变化句）。拒绝身份与当前 gate v2 版本一致 | 同上 |
| 链路覆盖检查 | ① 详情预算 15 从未不合理耗尽（历史最高 7）；② 无日期候选有详情补正通道（`detailNeed.date` + 详情页 `publishedAtRegex`）；③ 身份 = `url:<规范化URL>` 稳定，无重复读取；④ 拒绝非永久忽略（版本化重读）；⑤ 失败留痕（detailErrors/failures → fetch_runs.detail）；⑥ 正文变化走既有哈希/修订规则 | 代码 + cursor + fetch_runs |
| 结论：情况 C | **11/11 候选全部有明确、可证据支撑的处理结论；不存在因发现、日期、预算、解析或门禁导致的真实政策漏收；零业务代码修改** | 本表 |
| 运行轻核验 | 锁 001/003 各归其主、002 空闲；WT=0；/all、/leads 200；AMZ123 下次自然到期 06:37（第二周期截至收口未到期，未验证）；官方五来源持续正常采集 | 试锁 + WMI + curl |
| 边界 | 零业务代码改动；9 次只读正文抓取（公开页面，未绕任何限制）；数据库只读；全部证据文件保留于 %TEMP%\zcode-radar-diag\s28 | 操作记录 |

### R27（2026-10-24 02:35–02:50）：Sitemap 增量研究——窗口内零增量，不接入（情况 B）

| 项 | 结论 | 证据 |
|---|---|---|
| Sitemap 真实结构 | robots.txt 声明两个 sitemap：站点级 `sell.amazon.com/sitemap.xml` 与博客索引 `sell.amazon.com/blog/sitemap.xml`（均 200、公开、无登录/验证码）；博客索引 = 50 个月度子文件（sitemap-202203…202610）+ `sitemap-latest.xml`（**实测为空 urlset，0 条 URL**）；月度子文件为普通 urlset（含 lastmod，每条 URL 一致格式） | curl 只读探测，未绕任何访问限制 |
| 集合 A（列表发现） | 列表页（p=1）当前提供 **11 个**公告文章 URL——与采集器 found=11 完全一致（原始 HTML 即含 `.PagePromo` 条目） | listing.html 解析（%TEMP%\zcode-radar-diag\s27） |
| 集合 B（窗口内 Sitemap） | 授权窗口（约 13 个月，2025-10…2026-10）+ latest 共 14 个子文件，公告 URL 总计 **8 个**；多数月份 0–1 条，202610 仅 1 条非公告、latest 为空 | 14 个子文件逐个解析 |
| 覆盖差异（核心） | **8 个 sitemap URL 全部 ⊆ 列表 11 个 → sitemap 独有 = 0**；列表独有 3 个（final-call、new-product-success-guide、fba-grade-and-resell——sitemap 未收录）；**窗口内 sitemap 不提供任何增量** | URL 集合 comm 差集（文件保留在 %TEMP%\zcode-radar-diag\s27 供复核） |
| 数据库核对 | 该来源已入库 **2 篇**（upgrades-to-customer-service 2026-05-22、fba-grade-and-resell-updates 2026-02-03），**两篇都在当前列表页上**；列表 11 篇中其余 9 篇 = 门禁正文拒绝 6 篇（gate memory v2 恰好 6 条 rejected）+ 未读/其他 3 篇——**这是政策门禁在正常工作，不是发现缺口** | psql + cursor.detailGate |
| 正文预算 | sitemap 独有候选 = 0 → 无正文可查，≤30 篇探测预算未动用（无抽样比例问题） | — |
| 窗口外历史（只读计数） | 抽样 7 个历史月份（2022-06…2025-06）：每月公告 URL 0–3 条——**sitemap 的历史覆盖比列表第 2–4 页更稀疏**，历史回填价值同样不足 | 7 个子文件计数 |
| 决策：情况 B（不接入） | 理由：① 窗口内零增量（8 ⊆ 11）；② lastmod 每日变化、月度文件滞后（202610 仅 1 条、latest 为空），作为发现面**严格劣于**现有列表页；③ 历史覆盖稀疏；④ 接入只增加请求与解析成本而无政策增益。现有采集链路保持不变 | 本表 |
| R26 遗留轻核验 | fee 调度 tick 积压清零后恢复**严格每分钟**（02:39–02:46 连续 8 分钟整点）——R26 观察到的 9 分钟延迟确认为积压尾期现象、已自愈；五官方来源持续采集；双 Worker 各持锁（001/003）、Ads 002 空闲；WT=0；AMZ123 第二个自然周期 06:37 到期，**截至本轮收口尚未到期，未验证** | job_runs + 试锁 + WMI |
| 边界 | **零业务代码改动**；全部只读研究（curl 公开入口 + 数据库只读查询）；未绕任何访问限制；URL 差集原始文件保留在 %TEMP%\zcode-radar-diag\s27 | 操作记录 |

### R26（2026-10-24 01:48–02:33）：统一启动、双 Worker 故障恢复与持续采集闭环

| 项 | 结论 | 证据 |
|---|---|---|
| 实时拓扑检查 | 全部健康：PG 独立隐藏控制台（wrapper cmd 40260）、Web 独立隐藏控制台（wrapper cmd 45236）、双 Worker 各持锁（001/003）、Ads 锁 002 空闲、WT 窗口数 0、R25 剩余调度 tick（153）平稳消费；Git 工作区 93 个改动文件（绝大部分为既有未提交内容，本轮只动 4 个文件） | 实时进程/SQL/git 查询（未复用历史数据） |
| 统一启动五步 | `radar-local.ts start` 新增第 5 步「公告/监管 Worker」（`startViaOps("announcements")` + 锁就绪等待），步骤标签更新为 [x/5]。顺序：数据库 → API → Web → AMZ123 Worker → 公告/监管 Worker；Ads 与社区 RSS 永不启动；数据库不可用时不盲启后续服务（沿用原 1/5 步的失败即止） | `scripts/radar-local.ts`；实跑输出 |
| 单一责任（移除跨 Worker 线索接管） | 按用户决策采用简单方案：`radar-announcements.ts` **删除线索回退分支**（R25 的锁探测守卫一并移除，`isRoleHeldElsewhere` 删除）——公告 Worker 永远只注册公告/费用/监管六条专属队列，线索来源（含中断记录收口）完全是专用 Worker 的职责；缺失 Worker 由统一启动入口单独恢复，不建跨角色抢锁/动态切换 | `radar-announcements.ts`、`instance-lock.ts`；启动日志 subscribedQueues 恰好 6 条 |
| 状态页补齐 | `radar-local status` 新增：公告/监管 Worker 行（未运行即出问题项与提示）、官方/监管五来源最近采集块（状态/新增/时间/下次计划/已逾期标记，并注明「health=ok 只代表上次结果」） | 实跑输出 |
| 停止入口补齐 | `radar-local stop` 由三步扩为四步：公告/监管 Worker（优雅停止请求）→ AMZ123 Worker（优雅）→ Web/API（身份核验后 taskkill）→ 数据库默认保留 | `radar-local.ts` |
| 场景 A：双 Worker 正常 | 公告 Worker 六条队列 + AMZ123 两条队列、各持锁 001/003、无重复消费者 | 试锁 + 启动日志 |
| 场景 B：AMZ123 停止 | 优雅停止后公告 Worker PID 不变、锁 001 仍持；状态显示「AMZ123 未运行」+ 问题项；统一启动只跑第 4 步补起（新实例拿到锁 003），其余四步全部跳过；公告 Worker 全程未消费线索任务 | 实测（受控恢复） |
| 场景 C：公告停止 | 优雅停止后 AMZ123 PID 不变、继续持有锁 003；统一启动只跑第 5 步补起公告 Worker（六条队列）；官方来源不被 AMZ123 Worker 消费（它从不注册官方队列） | 实测（受控恢复） |
| 场景 D：重复启动 | 五步全部「已运行，跳过」、exit 0、双 Worker PID 不变、无新实例、无新窗口 | 实测 |
| 隐藏控制台回归 | PG 与 Web 均在 wrapper cmd 隐藏控制台下运行；场景测试与正常启动全程 WT/OpenConsole=0；Web 的 vite 子进程重启仍无可见窗口 | WMI 进程树 |
| 页面验收 | `/all`、`/leads`、`/api/site/meta` 全部 200；本轮前端与 API 路由零改动 | curl |
| 自然周期证据 | **官方来源已捕获第二轮自然采集**：cpsc #124 于 02:12:22 自然到期准点执行（HTTP 304 not-modified，状态 ok，next 03:12 正确推进）；fee #125 于 02:28:36 自然执行（ok found=1；比名义到期 02:19 晚约 9 分钟——job_runs 显示 02:18–02:29 期间全部队列的 tick 消费同步放缓（积压尾期），非 fee 专属缺陷，积压清完后应恢复每分钟节奏）。AMZ123：#117→#118 仍是第一个完整自然 6 小时周期；第二个周期 06:37 到期，**多周期积累仍未完成** | fetch_runs + job_runs 实查 |
| 边界 | 未启 Ads/社区 RSS、未接 Sitemap、未改 Federal Register 接口/规则/频率/日期语义、未动 3010、未清队列、未迁移、未 Commit/Push；本轮改动 **3 个文件**（`radar-local.ts`、`radar-announcements.ts`、`instance-lock.ts`；`radar-ops.ts`/`queue.ts`/`collect.ts`/`process-start.ts` 为 R25 已改），备份均在 `%TEMP%\zcode-radar-diag\` | 操作记录 |

### R25（2026-10-24 01:07–01:45）：Amazon 官方政策与美国监管来源安全恢复

| 项 | 结论 | 证据 |
|---|---|---|
| 启动前安全检查 | 3000/3001/5544 正常；PG 仍是修复后的独立隐藏控制台方式；AMZ123 Worker 持锁 003、心跳正常；公告 Worker 未运行、锁 001 空闲；5 个目标来源全部 enabled、health=ok、fail_count=0、next_fetch_at 已过期；Ads 关闭；无窗口风暴；3 条 running 记录确认全部为 `rss-wyze-community` 通用遗留（不在公告 Worker 收口范围） | 实时进程/SQL 查询（未复用 R24 历史数据） |
| 积压语义查证（5.1/5.2） | 330 个公告/330 个监管 created 全部是**每分钟调度检查 tick**，不是待抓文章：`scheduleDueSources` 只对 `next_fetch_at <= now()` 的来源入队、入队即 `next_fetch_at = now()+10min` 认领、`singletonKey=sourceId` 去重 → **恢复 Worker 只按当前到期状态触发每来源一次真实采集，不会补跑 324 次**；两个私有 fetch 队列 0 个陈旧任务；实测 tick 消费 ~5/分钟、330→216 平稳下降，每 tick 只做一次便宜的到期检查 | `collect.ts` 代码 + pgboss 计数 ×3 |
| 最小修复 1：线索队列隔离 | `radar-announcements.ts` 原本在线索源可运行时也注册 AMZ123 私有队列处理器（"两入口一致"的回退设计），会与专用 Worker 形成双消费者。新增 `isRoleHeldElsewhere` 锁探测：**专用 Worker 持锁期间家庭 Worker 不订阅线索队列**（启动日志明示），专用 Worker 停止时回退能力保留 | `instance-lock.ts`、`radar-announcements.ts`；启动日志 |
| 最小修复 2：fee-updates 归队 | **`amazon-us-fee-updates` 自 R19 拓扑切换后没有任何消费者**（其采集任务路由到通用 `sources.fetch` 队列，隔离 Worker 按设计永不读取）——47 小时积压的根因。按既有家族模式新增专属私有队列 `sources.fetch-amazon-fee-updates` + 独立分钟调度 `cron.radar.amazon-fee-updates.schedule`；通用调度（无参调用）的路由保持不变 | `queue.ts`、`collect.ts`、`radar-announcements.ts`；实采验证 |
| Worker 恢复 | `radar-ops start announcements`（先优雅停止首个实例以加载 fee 能力）：锁 001 获取（pid 21856），订阅恰好 6 条专属队列（公告/费用/监管各 2 条，**0 条 AMZ123 队列**），skippedSources 为空；旧实例优雅退出、锁正常交接 | `worker-announcements.log` |
| 五来源真实采集 | 全部 ok：announcements #119 found=11 new=0；**fee-updates #123 ok found=1（约 47 小时以来首次成功采集）**；cpsc-recalls #120 found=40；fed-register-cpsc #121 found=3；fed-register-ftc #122 found=5。全部正确去重（无重复导入），health=ok / fails=0，next_fetch_at 按各自间隔推进（+360 / +60 / +60 / +120 / +120 分钟） | fetch_runs + sources 实查 |
| 持续运行验证 | worker 日志 0 错误；`radar-announcements.beat` 与 `amz123-leads.beat` 心跳持续更新；锁 001/003 各归其主、002 空闲；WT 窗口数全程 0；postgres 进程数正常（单一隐藏控制台）；**AMZ123 完全不受影响**（3 条线索、0 publications、下次 06:37 自然到期）；四类统计不变（本轮采集全部去重，无新增政策记录——非异常） | 心跳文件、试锁、WMI、psql |
| Web 运行稳定性修复 | R24 已知残留二次发生（react-router 的控制台窗口被关闭 → 3000 下线）。新增 `startOnHiddenConsole`：Web 改走与 postgres 相同的 CREATE_NO_WINDOW 独立隐藏控制台——vite 及其重启子进程继承隐藏控制台，**不再产生可见黑窗口、不可能被关窗口误杀**；「身份核验→停止→启动」全循环实测通过（3000 000→200、WT=0、包装 pid 正常解析） | `process-start.ts`、`radar-ops.ts`；实测 |
| 页面验收 | `/all` 200 含站点标识；`/leads` 200、AMZ123 内容正常（仍只在独立路径）；本轮前端与 API 路由零改动（工作区 apps/web、apps/api 的改动均为既有未提交内容） | curl；git status |
| Sitemap / FedRegister API 研究（只研究，未接入） | **Amazon 博客按月 sitemap 真实存在且含公告文章 URL**：`/blog/sitemap.xml` 是 51 个月度子 sitemap 的索引（2022-03 至今，索引 lastmod 每日更新），抽样 2026-09 子文件确认含 `/blog/announcements/*` 文章 URL → 「月度 sitemap 提供真实增量」成立，可作为公告源（目前仅列表第 1 页 + 每轮 15 篇详情）的覆盖增量方向；**接入风险：sitemap lastmod 是页面修改时间，不得当发布时间使用**。**Federal Register 两源本就在用官方 API 端点**（`api/v1/documents.rss` + 结构化条件参数），恢复后连续 ok，无需切换，仅当需要 JSON 结构化字段（如 effective_on）再评估 | curl 只读探测 + sources.config |
| 边界 | 未启用 Ads / Accelerate / 社区 RSS；未新增来源、未改间隔/规则/cursor/next_fetch_at；未清空或批量删除队列任务；未迁移数据库；未 Commit/Push；本轮改动的 6 个文件均有 `%TEMP%\zcode-radar-diag\*.bak` 备份 | 操作记录 |

### R24 收口（2026-10-24 01:00–01:25）：运行状态复核、官方来源健康盘点、运行基线归一

| 项 | 结论 | 证据 |
|---|---|---|
| 运行状态 | PostgreSQL 5544 / API 3001 正常；**Web 3000 曾掉线**（托管它的 react-router 控制台窗口被关闭带掉进程，与 P0 记录的已知残留一致），已用现有入口只补 Web（pid 2468，`/all` 200）；AMZ123 Worker 运行中（pid 26316，心跳持续更新）；Ads 关闭、公告 Worker 未运行（均未触碰）；**全系统 `OpenConsole`/`WindowsTerminal` 进程数为 0** | `radar-local.ts status`；WMI 进程树；netstat；HTTP 探测 |
| 弹窗修复无回退 | `startPg()` 仍为 CREATE_NO_WINDOW 包装（代码核对）；实际进程树 = wrapper cmd(40260) → 1 个 conhost → postmaster(27108) + 13 个子进程，**0 个子进程有独立 conhost**；连接正常增减；无启动循环。**当前正常，尚未验证用户重启电脑后的完整生命周期** | 代码 Read + WMI 实测 |
| AMZ123 自然采集 | 最近 6 轮：#113 failed（10-23 16:10，单次，其后恢复）→ #114–#118 全 ok；**#117（10-23 18:37）→ #118（10-24 00:37）＝第一个整 6 小时自然周期证据**；下一个自然到期 10-24 06:37（worker 在跑，到期即采，**第二个连续自然周期尚未拿到**）。隔离核验：amz123 仅 3 条元数据行、**0 正文、0 publications、0 eligible**；四类统计与 10-23 一致（ads_policy=2 / external_regulation=20 / platform_policy=3 / other=104），**未被第三方线索污染**。实例锁 003 被持、001/002 空闲、调度 job 每分钟 ok——无重复实例、无积压 | psql 只读查询（fetch_runs / job_runs / sources / articles / publications / pg_try_advisory_lock）；心跳文件 |
| 官方来源健康盘点 | 注册 10、启用 8（停用：`ads-policy-pages` 按设计关闭；`amazon-us-accelerate-updates` 历史停采）。**启用来源中只有 `amz123-policy-leads` 有 Worker 在消费**；公告锁 001 空闲 → **5 个启用中的官方/监管来源全部积压**：`amazon-us-announcements` 超 13.7h、`amazon-us-fee-updates` 超 47h、`rss-cpsc-recalls` 与两个 `us-federal-register-*` 约 20h（`next_fetch_at` 已过、无人消费，worker 启动后会按到期即采）。全部 health=ok / fail_count=0 / last_error 空——**「health=ok」只代表上次成功，不代表正在自动更新**。另有 3 条 `rss-wyze-community` 遗留 running 记录（10-20/21，通用 Worker 遗留，radar-ops 明确不越界处理）与 2 个非主线社区 RSS 来源（10-21 起未跑） | psql sources 全表 + fetch_runs DISTINCT ON + 试锁 |
| 运行说明统一 | 唯一推荐入口 `start-radar.cmd`（PostgreSQL 由修复后的 `radar-local.ts` 以 CREATE_NO_WINDOW 启动）；「当前运行基线」「BLOCKERS 1/3」「NEXT」处已加 **2026-10-24 修正注记**；历史故障记录与直启命令原文保留作审计证据，不再作为当前推荐 | 本轮编辑（其余章节未动） |
| R25 入口建议 | 1) **安全恢复公告/监管 Worker**（一条 `radar-ops start announcements`；需用户授权——5 个启用中的官方/监管来源正积压，worker 启动后到期来源会立即补跑）；2) 评估 **Amazon 官方月度 Sitemap** 作为公告发现补充（列表页单轮 found=11 的覆盖天花板，V1 收口已认定供给上限）；3) 评估 **Federal Register 官方 API** 替代列表 RSS（两源 120min 间隔但数据停在 10-23 02:39；无连续失败证据，属评估项而非修复项） | 本表盘点 |

### P0 紧急故障修复（2026-10-24 00:00–00:55）：Windows Terminal 反复弹窗——每条数据库连接弹一个黑窗口

| 项 | 结论 | 证据 |
|---|---|---|
| 现象与定位 | 弹窗不是 `wt`/`start` 循环，也不是计划任务或登录启动项：每个新窗口与一个新的 `postgres.exe --forkchild="backend"` 在同一秒成对出现（0:01:36、0:01:46、0:02:26、0:03:26×3）；窗口标题 = PostgreSQL 数据目录 `D:\Workspace\LightChoiceRadarRuntime\pg\data`。启动项/计划任务只排查到既有的 `LightChoice-3010.cmd`（登录启动）与 announcements 监控任务（当前未运行），都不是来源 | WMI 进程快照（PID/PPID/创建时间/命令行/父子链）；`Export-ScheduledTask` |
| 根因（精确） | `scripts/radar-local.ts` `startPg()` 用 `spawn(postgresExe, …, { detached: true, windowsHide: true })` 启动 postmaster：libuv 实际传 `DETACHED_PROCESS`，postmaster **没有控制台**（进程证据：无自己的 conhost）。Windows 上无控制台的进程派生控制台子进程时，子进程分配**全新控制台**；Win11 默认终端是 Windows Terminal → 每个新控制台 = 一个可见黑窗口。API/Worker 对 5544 的连接每 10–60 秒新建一批 → 窗口持续增加 | 代码 + 进程快照 + PG 日志三方互证 |
| 放大循环（为什么关不完） | 用户关闭弹窗 → 该 postgres 子进程被 `0xC000013A`（控制台被关闭）杀死 → postmaster 记录 "terminating any other active server processes; reinitializing" → 所有客户端重连 → 又一批新 backend → 又一批新窗口。PG 日志 0:05×2、0:08、0:14 共 4 次完整循环 | `.data/_diag/postgres-5544.log` |
| 修复 | `startPg()` 改为经 .NET `ProcessStartInfo.CreateNoWindow`（`CREATE_NO_WINDOW`，node spawn 不暴露该语义）启动 `cmd /s /c` 包装：postgres 获得由 wrapper cmd 持有的**独立隐藏控制台**，生命周期与 postgres 一致；所有 backend 子进程继承同一隐藏控制台，不再新建控制台。日志仍为 `.data/_diag/postgres-5544.log`（`pg_ctl -l` 无法打开非 ASCII 路径，已实测，故用 cmd `>>` 重定向） | `scripts/radar-local.ts`；两轮实启 |
| 无弹窗验证 | 修复后由启动器实启 postgres（wrapper pid=40260 → postgres 27108 + 12 个子进程共享同一 conhost 34164，无任何 per-backend conhost）；连接正常增减（13→11 个 postgres 进程）期间**连续 3 分钟 0 个新 `OpenConsole`/`WindowsTerminal`**；系统进程总数 438→430，无异常增长 | WMI 快照 ×3 |
| 服务验收 | Web 3000 HTTP 200（页面含 `LightChoice Radar`）；API 3001 HTTP 200（返回 `changelogVersion`）；5544 监听正常；AMZ123 Worker 优雅重启后重新拿到实例锁（pid 26316，日志 `worker instance lock acquired`）；3010 原本就未运行、本轮未触碰；Ads 与公告 Worker 未触碰；未批量结束任何 node/cmd/powershell | `radar-ops status`；netstat；HTTP 探测；worker 日志 |
| 已知残留 | ① `@react-router/dev` 启动 Web 时其内部 relaunch 子进程会开 **1 个**自己的可见控制台窗口（node_modules 内部 spawn 行为，一次一个不是洪流；关闭它 3000 会下线，重跑 `start-radar.cmd` 即恢复）——本轮不改 node_modules；② 跨会话/重启电脑后各服务存活仍未验证（与上轮结论一致）；③ 多轮自然 6 小时采集周期仍未验证 | 实测记录 |
| 边界 | 只执行过 `pg_ctl stop -m fast`（干净停止）与 Worker 优雅停止，未批量杀进程；未创建服务/计划任务/自启项；未改 3010、Ads、采集规则与频率、数据库数据；未动工作区未提交改动；`radar-local.ts` 修改前备份于 `%TEMP%\zcode-radar-diag\radar-local.ts.bak` | 操作记录 |

### 第二十三轮（2026-10-23 21:59–23:20）：本地一键启动、状态检查与安全停止

| 项 | 结论 | 证据 |
|---|---|---|
| P0 现状核查 | 数据库 5544 由唯一 postmaster 持有（`-D .../pg/data -p 5544`，无第二实例）；API/Web 由会话内进程提供；AMZ123 Worker 持锁运行；公告 Worker 与 Ads 均未运行；无待处理停止请求；`pgboss` 无 `active`；Git 工作区有前几轮未提交改动 | 进程查询；`radar-ops status` |
| P0 一键启动 | 新增 `scripts/radar-local.ts` 与 `start-radar.cmd`：按 **数据库 → API → Web → AMZ123 Worker** 顺序，每步用真实就绪判断（`pg_isready` / 带内容校验的 HTTP 探测 / 实例锁），**已在运行的跳过，只补缺失的** | 实跑 |
| P0 一键状态 | `status-radar.cmd`：数据库 / API / Web / Worker / 来源配置 / 上次成功采集 / 下次计划采集 / 最近 5 次采集 / Ads / 公告 Worker / 问题清单。事实来源与 `radar-ops status` 相同（同表、同实例锁），不新建第二套监控 | 实跑 |
| P0 一键停止 | `stop-radar.cmd`：Worker 走现有停止请求并等实例锁释放；Web/API 先按端口找到 PID、**核对命令行属于本项目**，再 `taskkill /T`（不退出才 `/F`）；数据库默认保留，`stop-radar.cmd all` 才 `pg_ctl stop -m fast` | 实跑 |
| P0 局部恢复（B/C/E） | **B**：只停 API → 启动只补 API，Web PID 不变；**C**：只停 Web → 启动只补 Web，API PID 不变；**E**：停 Worker → 启动只补 Worker，未触碰公告/监管/Ads；**A/D**：全部在运行时四步全跳过、exit 0 | 实跑记录 |
| P0 冷启动 | `stop all`（含数据库）→ `start`：数据库 30s 内就绪 → API 就绪 → Web 就绪 → Worker 拿到实例锁，exit 0。等同「重启电脑后双击一次」的路径 | 实跑 |
| P0 端口冲突（G） | 3000 被一个「任何路径都返回 200」的假服务器占用：探测加入内容校验（页面必须含 `LightChoice Radar`、API 必须返回 `changelogVersion`），识别为「被其他程序占用」并**拒绝启动 Web**；假服务器未被结束（仍返回 200），exit 1 | 实跑 |
| P0 停止安全 | 3001 被非本项目进程占用时，`stop` 拒绝结束并打印 PID 与命令行，该进程仍存活。**未使用任何按进程名批量结束的命令** | 实跑 |
| P0 `radar-ops` 修复 | `start web` 不再「全有或全无」：改为按服务判断，缺哪个起哪个；新增 `start api`；探测超时 2.5s→5s 且失败重试一次，并校验响应内容；用法提示更新 | `scripts/radar-ops.ts` |
| P1 PostgreSQL 稳定性 | 定向检查：当前唯一 postmaster，二进制/数据目录/端口均正确；`postgres.log` 最后记录停在 10-23 00:12（「客户端连接被强制关闭 → 自动恢复」），之后是 `postgres.exe -D … -p 5544` 直启；**Windows 应用日志中没有 postgres 相关错误事件**，14:28/14:32/14:48 的 `0xC0000142` **没有可复现证据 → 判定未查明**，不宣称已根治。改进：启动器把 postgres 的 stderr 固定写入 `.data/_diag/postgres-5544.log`，以后崩溃可留证 | 进程查询；事件日志；日志文件 |
| P1 Worker 周期观察 | 启动器只启动 `radar-amz123-leads`；日志确认订阅两条私有队列、`officialQueues:[]`；未到期不采集（仍 #117，下次 00:37）。**多轮自然 6 小时周期仍未验证** | 启动日志；`fetch_runs` |
| P1 真实使用验收 | 启动后 1680×900：`/all` 40 张卡片全部 **1358px**、无横向溢出；`/leads` 显示 IOR 与付费邀评两条候选，状态条显示 Worker「运行中」且没有「未运行」提示；`/leads/<id>` 正常；唯一 console 错误是既有的 JSON-LD hydration 告警 | `.data/_diag/r23-check.mjs` |
| 会话存活（实测） | **本 Agent 环境的作业对象会在每条命令结束时回收它启动的全部后代进程，即使 `detached: true`**：跨命令检查时 API/Web/数据库都消失。因此「会话结束后仍存活」在本环境**无法验证，不能声称已实现**。用户在自己的 cmd 窗口运行 `start-radar.cmd` 时窗口内服务正常；关闭窗口后的存活需在真实终端确认（Windows 的 DETACHED_PROCESS 不接收控制台关闭事件，但本环境无法证明） | 跨命令进程检查 |
| 边界 | 未安装系统服务 / 计划任务 / 开机自启；未改 3010；未启 Ads；未启动公告/监管 Worker；未改采集频率、分类规则、日期语义、事实隔离；未迁移数据库；未 Commit/Push/部署 | `git status` |

> 本轮新增：`start-radar.cmd`、`status-radar.cmd`、`stop-radar.cmd`、`scripts/radar-local.ts`、`docs/radar/本地运行说明.md`；修改：`scripts/radar-ops.ts`（按服务启动 + 探测校验）。

### P0 前端修复（2026-10-23 21:40）：`/all` 情报卡片被压成 38px 竖条

| 项 | 结论 | 证据 |
|---|---|---|
| 现象复现 | 1680×900 打开 `/all`：40 行里 **5 行**卡片宽度只有 **38px**，英文标题逐词换行成竖条，右侧 1358px 空白；其余 35 行正常（1358px）。首页 `/` 同样 5 行（同一组件），`/all?source=amazon-us-announcements` 2/2 行全部异常。与用户截图一致 | `r23-all-before.png`；DOM 测量 |
| 根因（精确） | `TimelineSlot` 的桌面网格是 `lg:grid-cols-[64px_22px_minmax(0,1fr)]`（时间列 / 竖线列 / 卡片列）。此前为「不重复显示时间」把 `<time>` 改成条件渲染：`shownTime === null` 时**整个 `<time>` 元素不渲染**，网格只剩 2 个子元素 → 竖线 span 自动落到第 1 列（64px），卡片自动落到第 2 列（**22px 竖线列**），于是卡片被压成 38px，右侧空着。属 **B：Grid 列轨道与子元素数量不匹配**，不是卡片固定宽度，也不是父容器没撑开 | `Timeline.tsx` 的 `TimelineSlot`；computed `grid-template-columns: 64px 22px 1358px`；子元素 `[span:64, article:38]` |
| 修复 | 只改 `TimelineSlot`：时间不显示时渲染一个 `hidden lg:block` 的**空占位 span**，让网格恒为 3 个子元素；`<time>` 的显示条件与视觉不变。未动卡片、父容器、断点或其他页面 | `apps/web/app/features/feed/Timeline.tsx` |
| 前后宽度 | 1680：**38px → 1358px**（标题容器 0 → 1320px）；1440：1358 → **1118px**；1024：**702px**；390：**358px**（单列，无竖线列） | 浏览器测量 |
| 视口验收 | 1680×900 / 1440×900 / 1024×768 / 390×844：卡片均占满内容列、标题正常换行、无横向溢出（`scrollWidth - innerWidth = 0`）、无重叠或裁切。1680 截图 `r23-all-after-1680.png`，另存 `r23-all-1440/1024/390.png` | 截图 + 测量 |
| 功能回归 | 来源筛选（提交后 `?source=amazon-us-announcements`，2 条，1358px）、标签筛选（17 条，1358px）、日期筛选（`from=2026-10-01` 生效，40 条，1358px）、标题搜索（`q=recall`，15 条，1358px）、卡片点击进详情（`/items/...`）全部正常；`/leads`、`/leads/:id`、官方详情页无横向溢出、内容正常 | 真实浏览器操作 |
| 已知既有告警 | `/all` 仍有 1 条 **JSON-LD hydration** 告警（服务端与客户端 URL 不一致），**修复前就存在**，与布局无关，本轮未处理 | 控制台 |
| 边界 | 纯前端布局修复：未改数据库/迁移/采集器/Worker/调度/政策规则/日期语义/API/发布资格；未启用 Ads；未改 3010；未 Commit/Push/Merge/部署 | `git status` |

### 第二十二轮（2026-10-23 18:47–19:10）：第三方政策线索可视化与运行观察

| 项 | 结论 | 证据 |
|---|---|---|
| P0 现状核实（为什么 404） | `/items/<id>` 与 `/api/site/items/<id>` 走 `loadItemDetail`（publication / fact 层）；AMZ123 线索没有 `publications` 行，因此必然 404——**既有设计，不是回归**。现有 admin 只有关键词监控（`/admin/radar`）与运行记录（`/admin/runs`），没有线索视图；`/all?source=amz123-policy-leads` 只读发布池，同样看不到线索。结论：必须新增一条**只读**读取路径，不能改发布规则 | `apps/api/src/routes/site.ts`；SQL；页面实测 |
| P0 新增只读接口（白名单） | 新增 `packages/backend/src/publication/leads.ts`：`loadLeads` / `loadLeadDetail` / `loadLeadStatus`。SQL **只 select 白名单列**（`left(excerpt,300)` 与 `raw->'lead'` 的具名子字段），**不读 `body_text` / `body_html` / 整个 `raw`**；接口 `GET /api/site/leads`、`/api/site/leads/:id`、`/api/site/leads/status`，全部 `Cache-Control: no-store`。**未新建表、未写 publication、未改发布/事实规则、未改 `radar-rules.ts`** | `packages/backend/src/publication/leads.ts`；`apps/api/src/routes/site.ts` |
| P0 新增「政策线索」入口 | 导航「内容」区在「全部动态」之后新增 **政策线索**（`/leads`，图标 `IconRadar`）；新增路由 `leads` / `leads/:id`（`apps/web/app/routes/leads.tsx`、`lead.tsx`），复用现有 `Badge` / `PillTabs` / `EmptyState` / `pageMeta` 与卡片风格，**未做前端重构**。列表：标题、来源 AMZ123、原文链接、报道日期、来源更新、主题/线索标签、官方核实状态、处理状态、首次发现；筛选：有效候选 / 已排除 / 全部（数量取自数据库） | `apps/web/app/routes.ts`；`components/shell/nav.ts`；两个新路由文件 |
| P0 有效与已排除分离 | 默认 `state=active`（`processing_state <> 'skipped'`）→ **2 条**（IOR、付费邀评）；`state=excluded` → **1 条**（倍思奇财报，附排除原因原文）；`state=all` → 3 条。接口实测 `counts={"active":2,"excluded":1,"all":3}`，默认列表 `excluded present: false`。**未删除历史财报行，未改其状态** | `GET /api/site/leads?state=*` 实测 |
| P0 详情页 | `/leads/<id>` 200（不再是 404）。展示：完整标题、站点短摘要（标注「不是正文」）、来源/作者/报道日期/来源更新/首次发现/生效日期（见下条，仅报道所称）/栏目/市场/同事件状态、**专属规则与共享规则分开列出**（IOR 线索为 `radarRuleIds=[category-compliance]` / `radarTags=[类目合规线索]`，付费邀评为 `sourceRuleIds=[amz123-platform-rule]`）、官方证据匹配状态与说明、处理状态、核实限制说明、**「到 AMZ123 阅读原文」外链（`target=_blank`）**。**正文不保存、不展示** | 浏览器验收；`GET /api/site/leads/e27uboy…` |
| P0 日期语义修复（本轮补充） | 线索详情页**不再把第三方报道里的日期显示为「政策生效日期」**，并且**匹配到官方页面也不等于确认了日期**：`effectiveDate` 只取 `officialVerification.effectiveDate`（官方记录自己写明的日期），且要求 `officialStatus=matched-official`；仅 `matched-official` 而官方记录没写日期时，`effectiveDate` 仍为 **null**，报道日期只留在 `reportedEffectiveDate`。**实测现状**：`Amz123Verification` 结构里没有生效日期字段（只有 `officialUrl` / `officialTitle` / `officialPublishedAt`），开发库 3 条线索**全部 `third-party-only`、0 条 `matched-official`**、无任何 `officialVerification.effectiveDate` → 目前所有线索的 `effectiveDate` 均为 null。页面用「**报道所称政策生效日期（未核实）**」+「第三方报道表述，未经官方原文核实」展示报道自述日期，无日期时整行隐藏。定向测试 **7/7**（含「官方页面匹配成功但未确认具体日期」）；真实 3000：IOR 显示限定标签、付费邀评无日期行、官方 `/items/ye905tg…` 日期展示不变；r22 浏览器套件仍 24/24 | `packages/backend/src/publication/leads.ts` 的 `leadEffectiveDates()`；`tests/leads-date-semantics.standalone.test.ts`；浏览器截图 `r22c-lead-date.png` |
| P0 第三方事实隔离未破 | 接口响应**无** `body_text` / `body_html` / `body` / `content` / `raw` 任何键（递归检查 0 命中）；列表 2.9 KB、详情 1.2 KB，无 HTML 正文标记；`publications` 与 `fact_articles` 中 AMZ123 行仍为 **0 / 0**；三类统计 **3 / 2 / 20 不变**（other 104）；官方 `/all` 与 `/items/ye905tg…` 均 200，列表不含任何线索标题 | 接口字段检查；SQL；浏览器 |
| P1 运行状态可见性 | `/leads` 顶部状态条把三件事分开：**来源配置**（已启用 · 每 360 分钟）／**专用 Worker**（运行中 / 未运行，读 `pg_try_advisory_lock(7204229003)`）／**最近一次采集**（`fetch_runs` 最新一条：状态 · 时间 · 新增条数）／**下次计划检查**（标注「仅计划时间」）。Worker 未运行时额外显示琥珀提示「计划时间到了也不会自动采集」并给出前台启动命令。**没有新仪表盘、没有图表** | `GET /api/site/leads/status`；两张截图 |
| P1 Worker 受控启动与核对 | 启动前：DB 正常、`enabled=true`、`health=ok`、`interval_minutes=360`、`next_fetch_at=2026-10-24 00:37`（**未到期，未改**）、无第二个实例。启动 `cd apps/worker && npm run monitor:amz123-leads` → pid 48260，日志 `subscribedQueues:["cron.radar.amz123-leads.schedule","sources.fetch-amz123-leads"]`、`officialQueues:[]`、`ruleOnlyMode:true`、`intervalMinutes:360`。**单实例**：再次启动打印「another instance already holds this worker role」exit 0。**队列交叉验证**：近 20 分钟只有 `cron.radar.amz123-leads.schedule` completed 1 次 + pg-boss 内部 `__pgboss__send-it`；`cron.radar.amazon-announcements.schedule` / `cron.radar.regulatory.schedule` / `cron.sources.schedule` / `cron.hot.snapshot` 全部停在 `created`，**零次被取走**。未到期 → **未产生新的 fetch_runs**（仍 #117） | 启动日志；`pg_locks`；`pgboss.job` |
| P1 真实浏览器验收 | Playwright + 本机 Chrome，对真实 3000/3001 跑 **24 项断言全部通过**：导航可见、两条候选可见、财报默认不出现、切到已排除可见且带排除原因、详情 200、标题/核实状态/生效日期/原文链接正确、刷新一致、线索页与详情页 **0 console 错误**、官方列表与详情不受影响。截图：`.data/_diag/r22-leads.png`、`r22-leads-excluded.png`、`r22-lead-detail.png`、`r22-leads-worker-running.png` | `node .data/_diag/r22-browser.mjs` → `24/24 passed` |
| P1 类型检查 | `packages/backend`、`apps/api`、`apps/web` 三个 tsconfig **全部 exit 0** | tsc 输出 |
| 边界（第二十二轮） | 未改 3010；未扩建其他三条主线；未接入新第三方站；未改共享 `radar-rules` 与 AMZ123 分类规则；未启用 Ads；未改官方来源采集规则；**未执行数据库迁移、未新建表**；未保存 AMZ123 正文；未把第三方线索转成官方政策；未安装系统服务/计划任务/开机自启；未 Commit/Push/Merge/部署；未跑无关全量测试 | `git status`；SQL |

> 本轮改动文件：`packages/contracts/src/site.ts`（线索类型）、`packages/backend/src/publication/leads.ts`（新只读模块）、`apps/api/src/routes/site.ts`（3 个只读端点）、`apps/web/app/routes/leads.tsx`、`apps/web/app/routes/lead.tsx`（新页面）、`apps/web/app/routes.ts`、`apps/web/app/components/shell/nav.ts`、`apps/web/app/components/icons.tsx`（`IconRadar`）、`docs/radar/CURRENT.md`。诊断脚本与截图在 `.data/_diag/`（不进 Git）。

### 第二十一轮（2026-10-23 18:10–18:45）：0090 迁移、漏收线索真实重采与 r20 隔离库清理

| 项 | 结论 | 证据 |
|---|---|---|
| P0 执行前核验 | `current_database=lightchoice_radar`（user `radar`，PG 17.11）；`schema_migrations` **64 条、最新 `0089_publication_time.sql`**；`article_revisions.excerpt` 不存在；迁移文件 65 个，与已应用记录逐条比对后**未应用只有 0090**（无孤儿记录、无其他待执行）；0090 相对 Git 基线**只多一行 `-- atomic` 标记**，SQL 正文（`ALTER TABLE … ADD COLUMN excerpt text` + 按 `content_hash` 的回填 `UPDATE`）与第十九轮审查版本一致；`migrationPlan()` 解析为 `{"kind":"transaction"}`；`pg_stat_activity` 仅 1 条 idle（API 连接），`pgboss.job` 无 `active`，`running` 的 `fetch_runs` 只有 3 条 `rss-wyze-community` 历史遗留（10-20/21，非本轮范围） | psql 查询；`scripts/migration-safety.ts` 实跑；`git diff` |
| P0 迁移前备份 | `D:\Workspace\LightChoiceRadarRuntime\backups\lightchoice_radar-pre0090-r21-20261023-183114.dump`；`pg_dump -Fc -Z6` **退出码 0**，**970,722 字节**，sha256 `6caf18d447d92ad74d48e6a3d0f95544c05ca655c15068f5a011a48feda26991`；`pg_restore -l` **退出码 0**，TOC 366 条目 / **57 个 TABLE DATA**（含 `articles` / `article_revisions` / `sources` / `schema_migrations`）。目录此前为空，文件名带时间戳，**未覆盖任何旧备份**；备份在仓库外，**未进 Git** | pg_dump / pg_restore 输出 |
| P0 0090 迁移执行 | `node --env-file=.env scripts/migrate.ts` → `applied 0090_article_revision_excerpt.sql (41ms, transaction)` / `1 migration(s) applied`，**exit 0**。走项目迁移命令与 `migration-safety` 门禁（未手工跑 SQL）；脚本会遍历全部迁移文件，已先证明**只有 0090 未记录**，因此实际执行范围就是 0090 | 迁移输出 |
| P0 迁移后验收（字段与数据） | `schema_migrations` 记 `0090_article_revision_excerpt.sql @ 2026-10-23 18:31:30.42+08`；`article_revisions.excerpt` = `text`、可空；**articles 128 / article_revisions 172 / sources 10 / publications 126 / fetch_runs 82 与迁移前一致**；真实正文仍在 `body_text`（**5 条、合计 20,799 字符、最短 2,269 字符**，无短正文行）；**127 条修订回填 excerpt**，一致性检查 **0 冲突**（当前版本 excerpt 与 `articles.excerpt` 全等、无「无源摘要却回填」、无「哈希不符却回填」）；唯一未回填的当前版本是 `amazon-us-fee-updates / t4evq140n19u6pkjt8g49sg72`，因 `articles.excerpt` 本身为 NULL（符合规则）；迁移窗口内无业务写入（最后文章/修订 16:28:42、最后 publication 更新 05:18:44） | SQL 验收查询 |
| P0 迁移后验收（统计与运行） | 三类正式统计 **3 / 2 / 20 不变**（other 103）；3001 `/api/site/meta` **200**、3000 `/all` **200**（`/` 为 302 跳转，属既有行为）；**无任何 Worker 进程**、`pgboss.job` 无 `active`；备份仍可 `pg_restore -l` 读取 | SQL；curl；进程查询 |
| P0 历史 27 字符摘要残留 | **仍在，未修改**：位于 `article_revisions`（`e27uboy84azbker1m7d72n7ms` / revision 1 / `body_text` 27 字符「这次调整是美国收紧海关监管、整治空壳IOR漏洞的延续。」）。`articles.body_text` 为 NULL——污染在**修订表的 body_text**，迁移后 `excerpt` 按规则回填为同一句（来自 `articles.excerpt` 原值）。本轮**未清理**（任务明确不授权） | SQL |
| P0 拒绝身份精确移除 | 先快照 `.data/_diag/amz123/r21-cursor-before.json`；用 `jsonb_set` 只重写 `rejected` 数组：**91 → 90**，被移除的唯一元素是 `url:https://amz123.com/t/zDrc37rW`（`matches=1`），无新增；比对快照：`pending`(16)/`lastOkAt`/`sitemapAt`/`gateVersion`/`sitemapUrls`/`initializedAt` **全部 UNCHANGED**，数组顺序保持。**未重置来源、未清空拒绝列表、未伪造 articles 记录** | `.data/_diag/amz123/r21-cursor-*.json`；SQL |
| P0 单 URL 受控重采（最小实现） | 仓库**没有**现成的单 URL 重试能力，正常增量候选窗口也不含该 URL（列表页首屏 + 归档只取 7 天内 lastmod）。**最小必要实现**：`fetchAmz123Leads(source, { onlyUrl })` + `collectSource(sourceId, { onlyUrl })`——只读 robots + **1 个页面**，不读列表/归档、不写 `pending`，默认调用路径行为不变。实跑 `.data/_diag/amz123/r21-single-url.ts`：`fetch_runs #116 status=ok found=1 new=1`、`pageReads=1`、`alreadyStored=0`、`failures=[]`、robots 48 规则 `allowedSections=[/t,/kx]`；随即复跑 `#117` 得 `found=0 alreadyStored=1`（**去重生效**）。未改系统 DNS、未绕 SSRF、未关任何安全门禁 | 修改文件 `packages/backend/src/sources/amz123.ts`、`collect.ts`；`fetch_runs.detail` |
| P0 入库验收 | 新记录 `p4c2oymucl6o3ocj6avoytzkw`，`identity_key=url:https://amz123.com/t/zDrc37rW`（**唯一 1 条，无重复**）；`sourceRuleIds=["amz123-platform-rule"]`、`radarRuleIds=[]`、`sourceTags=["第三方线索｜Amazon 平台规则线索"]`、`gateVersion=amz123-lead-gate-v1`、`officialVerification=third-party-only`（无官方证据）、`effectiveDate=null`（正文未给出明确生效日）；`body_status=none`、`body_text`/`body_html` **NULL**、`excerpt` 282 字符（站点 description，非正文）；revision 1 `body_text` NULL / `excerpt` 282（**0090 语义在新写入上生效**）；历史财报行 `ss4urgdlcpfhwdn55ge54ar58` **仍 `skipped`**（verdict `not-a-policy-report`）；统计 **3 / 2 / 20 不变**、other 104、articles 129、revisions 173；`fact_articles` 0 / `publications` 0（第三方线索未升级为官方事实） | SQL |
| P1 r20 隔离库删除 | 核验：名称精确匹配 `lightchoice_radar_r20_ci`、65 条迁移（最新 0090）、2 篇文章、2 条 AMZ123 线索、11 MB、**连接数 0**；run #8 及验证结论已记录在第二十轮 DONE。执行 `DROP DATABASE lightchoice_radar_r20_ci`（**无通配符、无批量**）；删除后 **`lightchoice_radar`(20MB) / `lightchoice_radar_test`(11MB) / `postgres`(7846kB) 均在**，r20_ci 已不存在 | SQL |
| P1 定向测试与类型检查 | AMZ123 四个 standalone 套件（`amz123-leads` / `amz123-leads-worker` / `amz123-lead-admission` / `amz123-delivery-evidence`）**41/41 通过**；`packages/backend`、`apps/worker`、`apps/api`、`tests` 四个 tsconfig **全部 exit 0**。未跑无关全量测试 | 测试输出 |
| 边界（第二十一轮） | 未 Commit/Push/Merge/部署；未改 3010；未改共享 `radar-rules.ts`；未启 Ads；未启动公告/监管 Worker；未改其他来源 cursor 与频率；未保存 AMZ123 正文；未新建表；未删历史财报行；未改 0090 以外迁移；未改系统 DNS/代理/安全校验；未跑无关全量测试 | `git status`；SQL |

> 本轮改动文件：`packages/backend/src/sources/amz123.ts`（新增可选 `onlyUrl` 单 URL 重试分支）、`packages/backend/src/sources/collect.ts`（`collectSource` 透传 `onlyUrl`）、`docs/radar/CURRENT.md`（本节）。诊断脚本与快照在 `.data/_diag/amz123/`（不进 Git）。

### 第二十轮（2026-10-23 16:46–17:40）：AMZ123 分类准确性修复与自动运行交付

| 项 | 结论 | 证据 |
|---|---|---|
| P0 误收修复（企业财报新闻） | 《年营收近36亿元，倍思奇挂牌新三板》（`https://www.amz123.com/kx/fnwIHXQT`）**修复前被收** → **修复后被拒**，拒绝原因 `a company financial report, not a platform policy`。根因：`fees-logistics` 的中文词「销售费用」命中财报里的「销售费用率」，配合「费用」政策词 + Amazon + 北美三重通过 → 门禁放行。修复放在 **AMZ123 专属准入层**（新增 `packages/backend/src/sources/amz123-lead-gate.ts`）：把企业财报/挂牌/营收/净利/融资等识别为独立主体 `company-financial`、把经营报告识别为 `company-operation`，在放行前拦截。**共享规则 `radar-rules.ts` 一字未改** | `r20-regression-result.json`；`amz123-lead-gate.ts` |
| P0 漏收修复（美国站付费邀评） | 《亚马逊上线新功能，卖家可以付费"买评论"了？》（`https://www.amz123.com/t/zDrc37rW`）**修复前被拒**（`no radar rule matched`，9 条共享规则全未命中）→ **修复后被收**，命中专属规则 `amz123-platform-rule` + 专属标签「第三方线索｜Amazon 平台规则线索」。**关键词不作独立充分条件**：邀评/评论请求/付费邀评/索评/刷评/下架封店等必须与 **Amazon 主体 + 美国站 + 规则变更语境**三重共现（`amz123ReviewPolicyLead`）才成立 → 营销文章与他平台规则不会通过 | `r20-regression-result.json`；`amz123-lead-gate.ts` 的 `REVIEW_POLICY_SUBJECT` / `REVIEW_POLICY_TARGET` |
| P0 短快讯解析阈值 | DHL 快讯（`kx/A2CzjiIM`，正文 156 字符）**修复前 `parsed=false`（被误判为解析失败）** → **修复后 `parsed=true`**，随后因非 Amazon 政策而被门禁正常拒绝（`not-a-lead`）。修复方式**不是**简单把 200 降到 120，而是把 `articleObjects` 的 `content.length > 200` 换成**字段完整性校验**（title 非空字符串、content 是字符串、`published_at` 存在、`stripTags(content).trim().length >= 40`）：空壳页 / 登录墙 / 错误页 / 缺关键字段继续被拒 | `amz123.ts` 的 `isArticleObject()`；`tests/amz123-lead-admission.standalone.test.ts` |
| P0 真实样本回归（29 抓取 / 28 已标注 / 1 未标注） | 修复前 → 修复后：**有效政策线索正确识别 1/2 → 2/2**；**漏收 1 → 0**；**应拒绝正确拒绝 23/26 → 26/26**；**误收 1 → 0**；未标注 1（`kx/InbCm3uv`，判为 `not about Amazon`）。29 个样本中**恰好 4 个结果发生变化**，且方向全部正确：付费邀评（拒→收）、倍思奇财报（收→拒）、DHL 快讯（unknown→正确拒绝）、MSC 航线 `kx/YVxeLsmc`（unknown→正确拒绝）。**不是靠「全部拒绝」刷零误收，也不是靠「放宽所有词」刷零漏收** | `.data/_diag/amz123/r20-regression-fixture.json`（29 个真实页面 payload）+ `r20-expectations.ts` + `r20-regression-result.json` |
| P0 定向测试 | 新增 `tests/amz123-lead-admission.standalone.test.ts` **13/13**（财报拒绝、FBA 费用政策仍通过、物流公司财报拒绝、经营报告拒绝、邀评政策线索接纳、邀评词不能当捷径、短快讯可解析、空壳/登录墙/错误页/缺字段拒绝、正常文章解析不变、共享规则未变、生效日期不变）；AMZ123 相关合计 **43/43**（`amz123-leads` / `amz123-leads-worker` / `amz123-delivery-evidence` / `radar-ops-start`） | 测试输出 |
| P0 官方来源链路未回退 | `radar-core` / `radar-policy` / `radar-policy-backtest` / `ads-policy` / `policy-gate-memory` / `radar-source-compliance` / `sitemap-policy` 共 **51/51 通过**。`packages/backend/src/editorial/radar-rules.ts` 本轮**完全未修改**（最后修改时间 10-23 02:41，早于本轮全部动作 16:46 起；sha256 `B7D776C0…`；不含任何本轮关键词）。共享规则版本仍为 `radar-policy-v1`，新增门禁版本 `amz123-lead-gate-v1` | `git status`；sha256；测试输出 |
| P0 隔离库真实入库验证 | 隔离库 `lightchoice_radar_r20_ci`（新建自模板 `lightchoice_radar_test`）实跑 run #8 `status=ok`、`found=2 new=2`（09:01:51→09:02:10Z）；来源 health=ok、fail_count=0、`next_fetch_at`=+6h。**付费邀评线索入库**：`sourceRuleIds=["amz123-platform-rule"]`、`sourceTags=["第三方线索｜Amazon 平台规则线索"]`、`radarRuleIds=[]`（第三方标签不污染共享规则字段）；**财报样本未入库**（门禁拒）、**DHL 快讯未入库**（解析成功但非 Amazon 政策）。run 诊断：robots 48 rules、allowedSections `[/t,/kx]`、listings `/t` 4 + `/kx` 78、pageReads 25、discovered 82、`failures []`、rejectedReasons `{not about Amazon:1, no radar rule matched:22}` | `r20-run-against.mjs` + `r20-isolated-drill.ts`；隔离库 SQL |
| P0 隔离库数据边界 | 两条线索 `body_text`/`body_html` 均 NULL、`body_status=none`、`body_len=0`、`rawHasBody=false`；`revisions_with_body=0`；隔离四表全 0；families 仅 `other=2`。**第三方报道未被升级为官方政策事实** | `r20-iso-verify.ts` |
| P1 开发库历史误收：标记不删除 | 目标行 `ss4urgdlcpfhwdn55ge54ar58`（`https://www.amz123.com/kx/fnwIHXQT`）**未 DELETE**。只执行了一条 UPDATE：`raw.lead.review` 写入 `{verdict:"not-a-policy-report", reason, reviewedAt, reviewVersion, previousProcessingState:"new", previousGroupingStatus:"pending", previousRawLead:{…完整原值…}}`，`processing_state` 由 `new` 改为 `skipped`，`processing_error`/`processing_queued_at` 置 NULL。**行仍在**（`rowStillPresent=true`）；三类正式统计 **3/2/20 不变**（other 103）；四张事实表里 AMZ123 相关行全 0；IOR 线索不受影响（仍 `processing_state=new`、`verdict=null`）；`identity_key` 保留 → 采集仍会跳过该 URL、不会重复入库；原值写在 `review` 内，**一条 UPDATE 即可回滚** | `r20-mark-false-lead.ts`；`r20-mark-snapshot.ts` |
| P1 两个 r19 隔离库已安全删除 | 删除前检查全部通过：目标**精确匹配**仅两个名字（无模糊匹配、无通配符、无批量清理）、保护库 `lightchoice_radar` / `lightchoice_radar_test` / `postgres` 均存在、两库 `pg_stat_activity` 连接数均为 0、验证证据已记录（pre 库 64 迁移 / excerpt 列 0；post 库 65 迁移 / excerpt 列 1）。执行结果 `dropped:[{lightchoice_radar_r19_pre_ci, gone:true}, {lightchoice_radar_r19_post_ci, gone:true}]`、`skipped:[]`、`protected:[三个全部完好]` | `r20-drop-isolated.mjs` |
| P1 专用 Worker 受控运行复核 | `radar-ops start leads` → pid 18800，启动日志实证 `subscribedQueues:["cron.radar.amz123-leads.schedule","sources.fetch-amz123-leads"]`、`officialQueues:[]`、`ruleOnlyMode:true`、`intervalMinutes:360`。**数据库侧交叉验证**：Worker 启动后**真正被取走执行**的队列只有 `cron.radar.amz123-leads.schedule`（2 次）与 pg-boss 内部队列 `__pgboss__send-it`；官方队列 `cron.radar.amazon-announcements.schedule` / `cron.radar.regulatory.schedule` / `cron.sources.schedule` 期间只产生 `state=created` 的积压、**零次被取走**。**单实例保护双重生效**：`radar-ops start leads` 二次启动被拒（exit 1）；直接再跑 worker 入口打印「another instance already holds this worker role; exiting without doing any work」。**停止正常**：`radar-ops stop leads` → 「采集进程与监督进程均已退出，实例锁已释放」exit 0，pid 18800 确认已退出。**调度仍 360 分钟**、来源仍 `participation_mode=isolated`、开发库统计未变 | 实跑日志；`pgboss.job` / `pg_locks` 查询 |
| P1 复核未越界触发采集 | 受控复核期间**未改系统时间、未伪造跨周期日志、未强制触发额外采集周期**。复核时 `next_fetch_at=2026-10-23T14:28:42Z`（当时 09:0xZ，尚差约 5 小时），因此**未产生新的 fetch_runs**（开发库最后一条仍是 #115 / 08:28:24Z），文章总数保持 **128** | `fetch_runs` 查询；`articles` count |
| P1 正式统计与事实隔离未变 | 开发库正式统计 **platform_policy=3 / ads_policy=2 / external_regulation=20 / other=103**；`fact_articles` / `story_signals` / `analyses` / `publications` 四表中**来源为 AMZ123 的行全部为 0**；`publications` 按来源分组里没有 amz123；两条线索 `body_status=none`、`body_len=0`、`html_len=0`，`raw` 序列化后不含 `bodyText` / `content` | `r20-final-facts.ts` |
| P1 类型检查 | `packages/backend`、`apps/worker`、`tests`、`apps/api` 四个 tsconfig **全部 exit=0** | tsc 输出 |
| 边界（第二十轮） | 未在开发库执行 0090 迁移、未 DELETE 历史误收行、未改写正式政策记录、未改 `radar-rules.ts` 共用规则、未改 AMZ123 采集频率、未启 Ads 调度、未擅自启动公告/监管 Worker、未新建表、未建第二事实库、未保存 AMZ123 正文、未放宽第三方事实隔离、未把第三方报道升级为官方政策事实、未安装系统服务/开机自启、未 Commit/Push/Merge/部署、未跑无关全量测试、未删除 `lightchoice_radar_r20_ci` | `git status`；SQL；`radar-ops status` |

### 第十九轮（2026-10-23 15:40–16:35）：AMZ123 线索源独立运行能力

| 项 | 结论 | 证据 |
|---|---|---|
| P0 专用运行入口 | 新建 `apps/worker/src/radar-amz123-leads.ts`：启动即取实例锁 → 写运行记录 → 起心跳 → 校验 `ruleOnlyMode` → `selectLeadSource` 选源 → `closeInterruptedRuns` 收口自己来源的遗留 running → **只** `registerLeadSource`。日志实证 `subscribedQueues:["cron.radar.amz123-leads.schedule","sources.fetch-amz123-leads"]`、`officialQueues:[]`、`ruleOnlyMode:true` | `apps/worker/src/radar-amz123-leads.ts`；启动日志 |
| P0 一份实现两个入口 | 线索源的调度/采集处理器抽到 `apps/worker/src/lead-source-runner.ts`（队列 `cron.radar.amz123-leads.schedule`、job `radar.amz123-leads.schedule`、`registerLeadSource(boss, sourceId)`），**专用入口与来源族 Worker（`radar-announcements.ts`）调用同一份实现**，不产生两套分叉逻辑 | `lead-source-runner.ts`；`radar-announcements.ts:169-206` |
| P0 隔离是结构性的 | 专用入口**物理上不注册官方队列**（不是靠开关关闭），因此它采集官方来源在结构上不可能发生；实测启动后官方 6 个来源的 `last_fetch_at`/health/fail_count **全部未变**，最近采集记录全部仍停在 10-21/10-22 | 启动前后官方来源状态比对 |
| P0 选源三道门 | 新增纯函数 `selectLeadSource(leads)`：来源行存在 → `enabled` → 白名单；缺失行给「source row missing」、停用给「source disabled」、非白名单给「config is not on the approved allowlist」，**失败不静默** | `apps/worker/src/source-selection.ts`；`tests/amz123-leads-worker.standalone.test.ts` |
| P0 锁与角色独立 | 新增 Worker 角色 `amz123-leads`，使用独立 advisory lock key `7_204_229_003`（PostgreSQL advisory lock 按 database 隔离，与开发库的 `radar-announcements` 互不冲突），可与来源族 Worker 并存 | `instance-lock.ts`；`control.ts`；`process-identity.ts` |
| P0 频率仍由配置决定 | 调度 tick 每分钟检查 `next_fetch_at`，到期才入队；`singletonKey=sourceId` 防重复；间隔取自 `sources.interval_minutes=360`，**未新增任何硬编码间隔** | `fetch_runs` #115 的 `next_fetch_at` = last_ok_at + 360min |
| P0 真实采集已通过（开发库） | `fetch_runs` **#114 `status=ok`**（18.08s，`found=0/created=0`，增量去重生效）；来源 health 由 `degraded` 恢复为 `ok`、`fail_count` 归零、`last_error` 清空、`last_ok_at=2026-10-23T08:18:06Z`、`next_fetch_at=+6h` | `r19-dev-collect.ts` 实跑 |
| P0 专用 Worker 端到端闭环 | 把 `next_fetch_at` 提前到当前时间（**不改 `interval_minutes`**）后，专用 Worker **自行**触发调度并完成真实采集：`job_runs` #3208 `radar.amz123-leads.schedule` ok → `fetch_runs` **#115 `status=ok`、`found=1`、`new=1`**（08:28:24→08:28:42）→ 新增第 2 条线索。**这是「调度器 + 队列 + 采集 + 入库」全链路的真实进程证据** | `r19-watch.ts`；`r19-lead-check.ts` |
| P0 官方来源与统计未受影响 | 专用 Worker 运行期间，官方 6 个来源最近采集**全部仍停在 10-21/10-22**（ads 10-22 19:24、announcements 10-22 21:18、cpsc 10-22 19:41、ftc 10-22 18:39、fr-cpsc 10-22 18:39、fee-updates 10-21 17:03）；隔离四表 `fact_articles/story_signals/analyses/publications` **全 0**；三类正式统计恒为 **platform_policy=3 / ads_policy=2 / external_regulation=20**（other 102→103，新增的只是线索） | 启动前后 SQL 比对 |
| P0 数据边界仍然成立 | 两条线索 `articles.body_text`/`body_html` 均 NULL、`body_status=none`、`body_len=0`；`raw` 序列化后 `"content"`/`bodyText`/`"body"` **全为 false**；excerpt 用站点自带 description（27 / 267 字符，均 ≤300） | `r19-lead-check.ts` |
| P0 摘要不再落进 body_text（代码修正生效） | `packages/backend/src/content/materials.ts`（CRLF 文件）的 legacy 分支由「bodyText 为空时回退取 excerpt」改为只用 `revision.bodyText`：**新线索的 revision `body_text` 为 NULL**，而修正前写入的那条旧线索仍是 27 字符摘要（`body_equals_excerpt=true`）。**历史行未改动**（需授权才动） | `r19-lead-check.ts` 对比；`materials.ts` |
| P0 0090 迁移在隔离库真实演练通过 | 隔离库 `lightchoice_radar_r19_post_ci`（由 `lightchoice_radar_test` 复制并先回退到 0089 状态）上真实执行 `node --env-file=.env scripts/migrate.ts`：输出 `applied 0090_article_revision_excerpt.sql (7ms, transaction)`、`1 migration(s) applied`、**退出码 0**；`excerpt_column` 由 0 变 1。**开发库未执行迁移，仍停在 0089** | `r19-create-isolated-db.mjs`；迁移 stdout |
| P0 隔离库字段语义双态验证 | `pre` 库（0089 + 修正后代码）：有正文的文章 `body_text_len=137` 正常，线索 `body_text_len=0` 而 `article_excerpt_len=27` → 摘要不再落 body_text；`post` 库（含 0090）：有正文文章 `body_text_len=137` 且 `excerpt_len=16` → 正文进 body_text、摘要进 excerpt，**双双正确** | `r19-isolated-drill.ts` |
| P0 隔离库调度验证 6/6 | 未到期 enqueued=0；到期 enqueued=1（队列 `sources.fetch-amz123-leads`、`singleton_key=amz123-policy-leads`、state=created）；同刻重复 enqueued=0；停用 enqueued=0；官方队列零新增；遗留 running 收口 openBefore=1→openAfter=0 | `r19-schedule-drill.ts` |
| P0 隔离库真实进程验证 5/5 | 首实例持锁（lockHeld=true、run record 与心跳均生成）、**订阅队列只有 2 条且 `officialQueues` 为空**、pgboss 官方队列零记录；第二实例被拒（exitCode=0）；停止请求 → 优雅退出（queue drain → stopped，锁释放，记录/心跳/停止请求全清理）；崩溃后重启 → openBefore=1→openAfter=0 并打印「closed run records an earlier process never finished」 | `r19-worker-proc-drill.ts` |
| P0 开发库专用 Worker 启停实证 | `radar-ops start leads` → pid=35152，OS 层 `Get-CimInstance` 确认命令行 = `apps/worker/src/radar-amz123-leads.ts`；取锁、run record、心跳 12 秒后仍新鲜；`radar-ops stop leads` → 「采集进程与监督进程均已退出，实例锁已释放」，退出码 0，pid 消失，**退出不误报** | `radar-ops` 实跑；`Get-CimInstance` |
| P1 修复 `.env not found` 根因 | `scripts/process-start.ts` 的 `startDetached` 默认 `cwd` 由 `process.cwd()` 改为 `REPO_ROOT`：`--env-file-if-exists=.env` 是相对路径，从别的工作目录启动会静默丢环境文件。修复后重启专用 Worker，日志不再出现 `.env not found`，且仍打印 `officialQueues:[]`。**同一缺陷影响 `start announcements` 与 `start web` 的 API 子进程，一并修好** | 启动日志对比（修复前 L1 有、修复后无） |
| P1 分类质量只诊断分组（未改规则） | 对 **30 个真实读取并分组的样本**做只读审计：`not-us-amazon` 24、`marketing-or-news` 4、`page-parse-failed` 1、`should-have-passed` 1。**未修改 `radar-rules`**（避免影响官方来源判定） | `r19-classify-audit.ts` → `r19-classify-audit.json` |
| P1 误杀样本的可验证证据 | 《亚马逊上线新功能，卖家可以付费「买评论」了？》（`https://www.amz123.com/t/zDrc37rW`）：确实是**美国站**政策报道（美国站 10 月下旬公测 Review Requests Ads、站外索评属违规、`下架封店`），但 `radar-rules` **9 条规则全部未命中**（`ruleIds=[]`、`radarTags=[]`）→ 被「no radar rule matched」拒收。逐规则近失配显示：命中 `下架封店` 可归 `platform-policy`、命中 `邀评` 可归 `ads-policy`，**两条现有规则的中文词表都没覆盖这两种说法** | `r19-near-miss.ts`；`r19-classify-audit.json` |
| P1 反向问题：误收样本 | Worker 真实跑出的第 2 条线索《年营收近36亿元，倍思奇挂牌新三板》**不是政策报道**（是公司挂牌与财报），却被收进来了。根因可定位：`fees-logistics` 规则的中文词「**销售费用**」命中了财报里的「销售费用率高达30.22%」，配合 `POLICY_WORD`（含「费用」）、`AMAZON_MENTION`、`US_MARKET`（北美）三重通过 → 门禁放行。**本轮只诊断，未改规则** | `r19-false-positive.ts` |
| P1 解析失败的真实根因 | 「DHL集团与重庆保税港区…」报 parse-failed，但**不是网站改版**：payload 里文章对象**存在且字段齐全**（title/content/published_at/updated_at 都在），只是 `content` 长度 **156 < 200**，而 `articleObjects` 要求 `content.length > 200` → 判不出文章对象。影响面实测：`/kx` 抽 25 个样本，**仅 1 个**（该条，156 字符）受影响，其余长度 300–646 全部正常。**最小修复是把阈值下调（如 >120）而非放宽门禁** | `r19-parse-diff.ts`；`r19-parse-shape.ts`；`r19-threshold-scan.ts` |
| P1 定向测试与类型检查 | 新增 `tests/amz123-leads-worker.standalone.test.ts` **5/5**；第十八轮回归 `amz123-leads` + `amz123-delivery-evidence` **23/23**；本轮改动后连同 `radar-ops-start` 共 **30/30 全过**；`tsc -p apps/worker`、`packages/backend`、`tests`、`apps/api` **全部 exit=0** | 测试与 tsc 输出 |
| 边界（第十九轮） | 未在开发库执行 0090 迁移、未改历史行、未改 `radar-rules`、未改采集频率、未启 Ads 调度、未启动公告/监管 Worker、未新建表、未建第二事实库、未保存正文、未放宽第三方事实隔离、未引入付费依赖、未安装系统服务/开机自启、未 Commit/Push/Merge/部署、未跑无关全量测试 | `git status`、SQL 统计、`radar-ops status` |

### 第十八轮（2026-10-23 14:15–15:40）

| 项 | 结论 | 证据 |
|---|---|---|
| P0 合法落点判定 | 复用现成的 `articles` 素材层 + `participation_mode='isolated'` 承载第三方线索：隔离型来源不取正文、不做付费分析、不进事件图、发布可见性恒为 `withdrawn`、不进池与搜索；统计按 `sources.tags` 归族 → 线索来源天然只计 `other`。**未新增表、未建第二事实库、未执行迁移** | `packages/backend/src/sources/amz123.ts`；`sources.participation_mode` 列 |
| P0 访问限制落到代码 | robots 解析合并两个 `User-agent: *` 组、最长匹配优先、Allow 同长优先，非 `/` 开头模式按任意位置匹配；**robots 禁行路径即使返回 200 也不请求**；不碰 `/search`、`/api`；不登录、不绕验证码、不逆向私有接口；控并发/限速/重试，单页失败不阻断整轮 | `amz123.ts` 的 robots 解析与匹配函数；`tests/amz123-leads.standalone.test.ts` 14/14 |
| P0 数据边界 | 只持久化来源标识/标题/规范化 URL/作者/发布日期/来源更新时间/标签/简短元数据描述/首次发现时间/最近检查时间/处理状态/官方证据 URL/核实状态。**正文只在内存用于分类、抽取生效日期与寻找官方引用，不入库、不进摘要、不进 raw**；摘要用站点自带 `description`（≤300 字符） | 边界实测：body 泄漏 = 0、超长 excerpt 泄漏 = 0 |
| P0 真实采集第一轮 | `fetch_runs` #78 `status=ok`，18.35s，发现 105（`/t` 4 + `/kx` 101），读 25 页，**入库 1 条线索**；拒绝 24 条并逐条记录原因（no radar rule matched 18、not about Amazon 4、no policy wording 1、parse-failed 1） | `fetch_runs` #78；`articles` 新增 1 条 |
| P0 入库内容与原页核对 | 《美国IOR监管趋严，亚马逊提醒卖家自查进口主体》：作者「北美电商资讯」、published 2026-10-21T02:19:54Z、updated 2026-10-23T04:24:17Z、excerpt 27 字符、effectiveDate 2026-08-19、officialStatus `third-party-only`、event `new`。独立重取该页逐字段比对，**标题/作者/发布日期/描述全部一致** | `https://www.amz123.com/t/5Z6bFgNc`；`r18-verify.ts` |
| P0 增量与去重第二轮 | `fetch_runs` #111 `status=ok`，**created=0 / revised=0 / found=0**，`alreadyStored=1`；sitemap 未到 24h 刷新点未重下（fetched=false，沿用上次 4000 条 URL） | `fetch_runs` #111 |
| P0 正式统计不变 | `fact_articles=0`、`story_signals=0`、`analyses=0`、`publications=0`；**三类正式统计恒为 platform_policy=3 / ads_policy=2 / external_regulation=20**（other 101→102） | 边界实测 SQL |
| P0 调度接入 | 复用现有 `sources.interval_minutes=360` 机制（**无硬编码**，`adaptIntervals` 排除线索来源以保固定节奏）；新增私有队列 `sources.fetch-amz123-leads`（singletonKey=sourceId）与 `cron.radar.amz123-leads.schedule`（每分钟检查到期，`next_fetch_at` 到期才入队）；线索来源不进官方来源队列，物理隔离 | `packages/backend/src/jobs/queue.ts`、`apps/worker/src/radar-announcements.ts`、`collect.ts` |
| P0 调度实测 | 未到期入队 0；到期入队 1；**同刻再调入队 0**（单例去重）；停用来源入队 0 | `r18-schedule.ts` 实跑 |
| P0 运行状态 | `radar-ops status` 实测：3000=200、3001=200、线索来源「已启用·health=ok·每 360 分钟一轮」、Ads 来源仍停用、Ads/公告 Worker 均未运行、其余 9 源启停与频率与基线一致 | `radar-ops status` 实跑 |
| P1 发现通道实测（与任务书假设不同） | sitemap 的 `/t`、`/kx` 段 lastmod 冻结在 2026-08-24 / 08-16，仅 `/zb` 按日更新；而 `/t`、`/kx` 列表页 SSR 直接含文章链接且**全部不在 sitemap 中**。实现改为「列表页=live 增量，sitemap=归档覆盖+结构探针」，两者互不依赖 | `sitemap_index2.xml`（14604 URL：/t 2000、/kx 2000、/zb 100）、`listing-t.html`、`listing-kx.html` |
| P1 栏目取舍 | `/t` 为主来源、`/kx` 为补充；**`/zb` 本轮不纳入**（每日多主题早报，与 `/t`、`/kx` 事件重复、粒度更差，且每篇仍需约 300KB 读取，不满足「低成本且有增量价值」）；排除 `/b` 服务商目录与 `/report` 行业报告 | `industry/sources.json` 的 `allowUrlPrefixes: ["/t/", "/kx/"]` |
| P1 事件归并 | 严格组合指纹：同域 + （同生效日期或同官方编号）+ 标题核心相似度 ≥ 0.45；缺日期与编号时标 `pending-determination`，不强行合并 | `amz123.ts` 事件指纹函数；定向测试覆盖 |
| P1 官方核实四档 | `matched-official` / `evidence-insufficient` / `third-party-only` / `access-restricted`，一律注明「链接存在不等于主张已证实」；只匹配本项目已收录的官方文章，**未改现有官方采集器、未扩建 CBP 来源、未切换 Federal Register API** | 入库线索为 `third-party-only`；测试覆盖四档 |
| P1 定向测试与类型检查 | `tests/amz123-leads.standalone.test.ts` **14/14**（白名单/robots/解析/门禁/日期/事件/核实/数据边界/身份去重/栏目）；`npx tsc -p packages/backend`、`npx tsc -p apps/worker` 均通过 | 测试与类型检查输出 |
| 边界（第十八轮） | 未新增表、未迁移、未 Commit/Push/部署、未安装依赖、未启用 Ads 调度、未启动公告/Ads 常驻 Worker、未触碰 3010（属另一项目 `D:\Workspace\scratch\v6-market-loop-3010-20261023-r3`）。修复上一轮遗留的 `tests/radar-core.standalone.test.ts` 过期断言（`seller-program-rules` 规则属第十七轮新增、测试未同步；HEAD 版无该规则，证实非本轮引入） | `git status`、SQL 统计、`radar-ops status` |

### 第十八轮补充（2026-10-23 15:15–15:40）：交付证据生成器集成

| 项 | 结论 | 证据 |
|---|---|---|
| P0 补丁来源与集成 | 用户提供的 `amz123-delivery-evidence-generator-patch.zip`（15,100 字节，5 个条目）经逐项核对后集成：新增 `scripts/generate-amz123-delivery-evidence.ts`、`scripts/amz123-evidence-shape.ts`、`tests/amz123-delivery-evidence.standalone.test.ts`，补丁说明存 `docs/radar/AMZ123-EVIDENCE-GENERATOR-APPLY.md`。项目内**原本无同名文件**，无覆盖风险 | 附件 ZIP；`tar -tf` 条目清单；`r19-install-patch.mjs` |
| P0 兼容性核对（先比对后集成） | 补丁基于较早快照。逐项比对当前源码与库结构后确认 **4 处需最小适配**（只改补丁文件，未改数据库结构、未削弱安全机制）：① `fetch_runs.detail` 顶层是 `{amz123:{…}}`，补丁只找 `outer.diagnostics` → 诊断全空；② 游标实际键名 `rejected` / `pending` / `sitemapUrls` / `sitemapAt` 与补丁认的 `rejectedIdentities` / `pendingCandidates` / `sitemapApprovedUrls` / `sitemapLastReadAt` 不符 → 4 个计数丢失；③ 拒绝原因标签含空格（`not about Amazon`）被补丁的 key 正则滤掉；④ `allowUrlPrefixes` 存的是完整 URL，被补丁的 `startsWith("/")` 过滤成空数组 | 探针 `r19-schema-probe.ts`、`r19-shape-probe.ts` 实测；`r19-verify-failures.ts` |
| P0 生成器只读 | 事务层 `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`；只执行 SELECT。**运行前后数据库逐项比对无变化**：articles 1 / fetch_runs 2 / article_revisions 1 / publications 0 / analyses 0 / story_signals 0；sources 的 `last_fetch_at` / `next_fetch_at` / `health` / `fail_count` / `enabled` / `interval_minutes` 均未动 | `r19-readonly-proof.ts`；生成器 `readSnapshot` |
| P0 真实运行与失败即报 | 首次真实运行**如实给出失败信号**（退出码 2，2 项 fail），据此定位并修正两处判定口径——**全程未改数据库、未删记录、未伪造数据**：① Web 3000 根路径按设计 302→`/all`，补丁的 `redirect:"manual"` 判为非 200 → 改为跟随重定向并保留首跳状态；② `article_revisions.body_text` 存的是 27 字符 excerpt，**不是正文** | 首次运行 stdout `checksFailed: 2`；`r19-verify-failures.ts` |
| P0 摘要快照的真相（第十八轮遗留） | 开发库迁移停在 **0089**，`article_revisions.excerpt` 列不存在 → `content/materials.ts` 的 legacy 分支 「`bodyText` 为空时回退取 `excerpt`」 把 excerpt 写进了 `body_text` 列（实测 `body_equals_excerpt=true`、长度 27）。**正文从未采集**：`articles.body_text` / `body_html` 均 NULL、`body_status=none`、`body_length=0` → 数据边界未被突破。生成器已把该情形单列为 `revisionExcerptSnapshot` 且**不计入正文泄漏**；真正文判定（articles 正文、revision 长正文、translation 正文、raw 含 body 字段、excerpt > 300）仍全部判 fail | `r19-migration-state2.ts`；`packages/backend/src/content/materials.ts:176-192`；生成器 `bodyLeakCounts` |
| P0 最终验收 | `docs/radar/amz123-lead-collection-r18-verified.json`（15,827 字节）由**真实开发库**生成：**11 项检查全 pass、0 fail、0 unverified、退出码 0**。来源 `amz123-policy-leads` / `isolated` / `enabled` / `360 分钟` / health=ok；线索 1 条读出完整（title / author / publishedAt / sourceUpdatedAt / effectiveDate / officialVerification=`third-party-only` 齐全，`boundaryViolations` 为空）；三类正式统计 3 / 2 / 20 未变，other 102；事实 / 信号 / 分析 / 发布行均 0；3000 与 3001 均 200；`announcementWorker=not-running` 如实反映「调度机制就绪但常驻未启动」 | 生成器 stdout；`r19-inspect-evidence.ts` |
| P0 证据文件安全 | 全文敏感词命中 0（password / DATABASE_URL / token / secret / 私钥等）；不含 `body_text` / `body_html` / `raw` 原始字段，只含白名单元数据、计数、布尔标志与长度 | `r19-inspect-evidence.ts` 的 `sensitiveWordHits: []` |
| P1 测试与类型检查 | 补丁自带 6 项定向测试 + 本轮新增 3 项回归（诊断下钻 / 真实游标键 / lead raw 无正文）**9/9 通过**；`tsc -p tests` 与两个新脚本的严格类型检查均 0 错 | 测试输出；tsc 输出 |
| P1 幂等与不越界 | 同一输出名 `--force` 重跑结果一致（可重复）；**原交付文件 `amz123-lead-collection-2026-10-23.json` 的 SHA256 前后完全一致**（未被覆盖）；未执行迁移、未改采集频率与分类规则、未启 Ads 或公告 Worker、未触碰 3010、未 Commit/Push | 前后 SHA256 比对；`git status` |
| 边界（补充轮） | 只新增 4 个文件、改 2 个补丁文件；**未动** `packages/backend`、`apps/worker`、数据库结构与任何既有来源 | `git status` |

### 第十七轮（2026-10-23 13:30–14:10）

| 项 | 结论 | 证据 |
|---|---|---|
| P0 现场恢复 | 真实状态核实：Git 仓库有 39 个已修改文件 + 未跟踪 Worker 文件（上一轮成果，未动）；开机时 PostgreSQL 与 3000/3001 **均未运行**，3010 属另一项目（`D:\Workspace\scratch\v6-market-loop-3010-20261023-r3`）未触碰。按手册拉起 PG（5544）与 `radar-ops start web`（API pid 45428 / Web pid 35040），3000 返回 200、3001 监听正常 | `radar-ops status`（开机实测「Web 3000 未运行 / API 3001 未运行」）、`netstat`、`http://127.0.0.1:3000/` → 200 |
| P0 栏目能力清单（实取） | `/t` 跨境头条 = 政策报道主来源（sitemap 2001 篇，robots 显式 Allow）；`/kx` 跨境快讯 = 小时级线索（2001 篇）；`/zb` 跨境早报 = 每日多主题摘要（101 篇，一篇多事件）；`/report` 跨境报告 = 行业报告非政策（51 篇）；`/b` 跨境百科 = **以服务商目录条目为主，不应作政策源**（2001 篇，robots 显式 Allow）；`/dagang` 课程大纲、其余活动/测评栏目 = 与本主线无关 | `.data/_diag/amz123/probe-01-sitemap.mjs`、`probe-02-lists.mjs`；`docs/radar/amz123-feasibility-2026-10-23.json` 的 `columns` |
| P0 采集权限与合法性 | robots.txt：`User-agent:*` 显式 `Allow:/t`、`Allow:/b`，声明 Sitemap；文章级路径未被 Disallow 覆盖；`/search`、`/api`、`/tag-*` 被禁。用户服务协议（`/disclaimer`，厦门品牌方舟科技有限公司）第十条允许**非商业**转载但要求署名作者 + 原始链接 + 注明发表于该公司且不得修改演绎，与平台自持权利条款存在张力 → **「有权长期保存并再发布正文」标记授权未确认**。本轮只落元数据、不保存整站正文、不调用私有 API `api.amz123.com`、不绕登录/验证码 | `https://www.amz123.com/robots.txt`、`https://www.amz123.com/disclaimer`（2026-10-23 实取，原文条款已摘入交付件） |
| P0 20 篇真实样本 | 真实抓取并解析文章页 SSR（Nuxt `__NUXT_DATA__` + JSON-LD），20 篇报道、19 个作者、12 个不同日期，2026-07-08 → 2026-10-21；20/20 有机器可核发布日期；覆盖费用调整、FBA 仓储配送、Listing 规则、账号健康、禁限售与资质、知识产权、Ads 政策、外部清关监管 | `docs/radar/amz123-feasibility-2026-10-23.json` 的 `samples`（逐条含标题/URL/日期/美国站指向/领域/生效时间与依据/官方核实状态/证据出处/采集方式） |
| P0 官方证据逐条核实 | 建立官方公开语料 321 页（`sell.amazon.com/blog` 全量 77 篇 + `sellingpartners.aboutamazon.com` 44 篇 + 联邦公报）逐条检索。13 个事件中：官方证据已核实 **1**、有官方链接但证据不足 **1**、仅第三方报道 **6**、并非平台政策 **1**、因访问限制无法核实 **4** | `official-corpus.json`、`official-verification.json`；结论码与依据见交付件 `events[].officialNote` |
| P0 两处真核实 | **EV-IOR（官方证据已核实）**：Federal Register Notice `2026-16911`（2026-08-19，91 FR 53627）标题即 *Accuracy of Importer of Record Data Submitted to CBP*，摘要明写 "CBP is taking initial steps to implement Executive Order 14411 'Strengthening Customs Enforcement'"；FR Rule `2026-17354` 引用 "EO 14411 … 91 FR 35125 (published June 10, 2026)"。**EV-AGED（证据不足）**：`sell.amazon.com/blog/ask/amazon-fba-beginners-guide-2026`（2026-03-31）明写 aged inventory charge 适用于库龄 over 181 days → 181 天门槛已核实，各库龄段单价与 2026-01-16 调价未在公开页出现 | `verify-fr-api.mjs`、`verify-eo.mjs`、`official-corpus.json`（Q1/Q2/Q8 命中与未命中） |
| P0 关键反证 | 47 篇样本正文内站外链接**只有** `mp.weixin.qq.com`（9 篇），官方链接数 **0**；站点 `sources` 字段 **47 篇全为空数组** → AMZ123 不给官方原文出处，每条线索必须另做一次独立官方核实 | `analyze-full.mjs` 输出（sources 分布、站外链接 top） |
| P1 去重验证 | 20 篇报道 → **13 个政策事件**，重复 **7 篇**。多报道事件：AI 人物打标 ×3、AWD 大件停收 ×2、2026 旺季履约费 ×2、解压玩具下架 ×2、广告扣款改余额抵扣 ×2、TRO 案件 ×2。**标题完全相同去重会全部漏掉**；仅用关键词实体去重实测产生 **2 例误合并**（`广告`、`禁售/下架`）并已否决 → 必须用「政策主体 + 生效日期 + 官方政策链接/编号」组合指纹，缺项标待确定 | `cluster-events.mjs`、`policy-clusters.json`；人工裁决在交付件 `events[]` |
| P1 最小自动化实验 | 合法入口 = robots → `sitemap_index*.xml` → `/t`、`/b` 允许路径下文章页 SSR。**文章页无需浏览器渲染**（列表页才需要）。可重复性：发现层连跑 3 轮（sitemap2=14802、listT=19、listKx=93）**三次完全一致**；元数据层 12 篇跑 2 轮正文哈希+发布时间 **12/12 一致**。失败诊断：不存在路径→404 `not_found`，但 **robots 禁止的 `/search`、`/api` 与需登录的 Seller Central 同样返回 200** → 采集器必须自建 robots 门禁，不能靠状态码 | `experiment-repeat.mjs`、`automation-experiment.json` |
| P1 价值量化 | 20 篇报道 → 13 个事件 → **2 个官方可核实且 Radar 未覆盖**（EV-IOR、EV-AGED）。13 个事件**全部不在** Radar 现有覆盖内（开发库实测 platform_policy 3 / ads_policy 2 / external_regulation 20）。Radar 现有平台政策最新为 2026-05-22，且**无 CBP/海关来源**（仅 CPSC 15 + 联邦公报 CPSC 3 + FTC 2）→ EV-IOR 是真实缺口。端到端官方可核实转化率 2/20=10%，事件级 2/13≈15% | 开发库 SQL（`db-overlap.mjs`）；`radar-ops status` 基线与交付件 `value` |
| P2 接入判断 | **有条件接入：只作「第三方线索发现入口」，不作事实源**。五步最小方案（发现→规则筛选→事件指纹归并→官方证据查找→只进线索层）。持续成本：零新增依赖、零付费、约 240 请求/天、单轮 40–90s；维护点 4 项（Nuxt SSR 字段改版失效、列表分页客户端渲染、官方渠道月度复核、author/tags 内部结构变更） | 交付件 `conclusion.minimalIntegration` 与 `conclusion.ongoingCost` |
| 边界 | 未改数据库（迁移仍停在 0090，三类数量不变）；未建表；未注册常驻来源/Worker；Ads 仍默认关闭（`ads-policy-pages.enabled=false`、开关未设）；未把任何 AMZ123 内容写入正式政策库；未 Commit/Push/部署；未安装依赖；实验文件全在 gitignored 的 `.data/_diag/amz123/` | `radar-ops status`、SQL 统计、`git status` |

### 第十六轮（2026-10-23 11:30–12:30）

| 项 | 结论 | 证据 |
|---|---|---|
| P0 OS 应答的 PID 校验（第十六轮） | `queryWindowsProcess` 现在要求 Windows 返回的 `ProcessId` 与请求的 PID 一致、命令行非空、创建时间**可解析**；任一不满足都返回 null（=「无法确认」），而不是把别的进程当成答案 | `apps/worker/src/process-identity.ts`；`tests/worker-process-identity.standalone.test.ts`（不同 PID、缺失/无法解析的创建时间各例） |
| P0 status 的可用性判定（第十六轮） | `status` 的「强杀身份校验（OS 级）」只有在本进程能用 OS 查询拿到「有效 PID + 命令行 + 可解析创建时间」时才显示「可用」；实测显示「可用」，并证明它真实调用了 Windows | `scripts/radar-ops.ts`；status 实跑输出 |
| P0 句柄绑定终止（第十六轮） | 消除查询→强杀之间的 PID 复用竞态：`verifyAndTerminateByHandle` 在一次 OS 调用里完成——CIM 身份（命令行 + 创建时间）→ `Get-Process` 打开同一 PID → 句柄创建时间与 CIM 创建时间相差 >2s 即拒绝（PID 可能已被复用）→ 与运行记录启动时间比对 → 通过才 `$proc.Kill()` 并等待退出。**没有任何 `Stop-Process -Id` 或 `process.kill` 的裸 PID 路径** | `process-identity.ts` 的 `terminateByHandleScript`/`verifyAndTerminateByHandle`；`tests/worker-process-identity.standalone.test.ts`（真实子进程：错误启动时间被拒且子进程存活；正确则经句柄终止且子进程退出；OS 查询失败 → 拒绝；已消失 → alreadyGone） |
| P0 时区缺陷修复（第十六轮） | 真实演练暴露的缺陷：PowerShell 的 `[datetime]'…Z'` 把 UTC 时间读成本地时间，导致句柄时间与期望时间相差 8 小时、正常终止也被拒。改为传递**纪元毫秒**并用 `[DateTimeOffset]::FromUnixTimeMilliseconds().UtcDateTime` 比较 | 修复前探针 `creation-mismatch`；修复后真实终止成功 |
| P1 真实故障注入复验（第十六轮） | 用新代码重放「PID 复用」注入：记录+心跳指向存活的本项目 API（pid 22996，心跳新鲜、创建时间为 API 真实值）→ `--force` 拒绝（「命令行中没有 ads-policy.ts」），API 保持 200 | 实跑输出 |
| P1 正常停止回归（第十六轮） | 真实 Ads 监督进程（隔离库 ci7，真实网络失败 ERR_CONNECTION_CLOSED → failureClass=network）在退避中 `stop ads` → 1.2s 停止，采集进程与监督进程均已退出 | `.data/_diag/daemon-ci7.log`；隔离库已删除 |
| 边界（第十六轮） | 未执行迁移；开发库未写入测试数据（三类数量不变）；Ads 仍默认关闭；3000/3001 正常；未 Commit/Push/部署；ci6/ci7 已删除 | SQL 统计、`radar-ops status` |

### 第十五轮（2026-10-23 08:40–09:10）

| 项 | 结论 | 证据 |
|---|---|---|
| P0 强杀身份缺口（第十五轮） | 原实现只比对 `.beat` 与 `.json` 两个由进程自己写的文件：Worker 退出后心跳仍在新鲜窗口内、PID 又被其他进程复用时，`--force` 会杀掉无关进程。新增 `apps/worker/src/process-identity.ts`：强杀前向操作系统查询该 PID 的**命令行与进程创建时间**，要求 ① 心跳新鲜且 pid/启动时间与记录一致；② 心跳时间不得在未来；③ 操作系统必须能回答，否则拒绝；④ 命令行必须包含本项目 Worker 入口（`ads-policy.ts` / `ads-policy-daemon.ts` / `radar-announcements.ts`）；⑤ 进程创建时间与运行记录启动时间相差 ≤120s | `apps/worker/src/process-identity.ts`；`tests/worker-process-identity.standalone.test.ts` **9/9** |
| P0 真实故障注入（第十五轮） | 复现漏洞场景：把运行记录与心跳指向**存活的本项目 API**（pid 22996），并填入它的**真实 OS 创建时间**与**刚写入的新鲜心跳**——旧逻辑会放行。执行 `radar-ops stop ads --force` → `拒绝强杀 ads-policy：该 PID 当前运行的不是本项目 Worker（命令行中没有 ads-policy.ts）`，API 保持 HTTP 200、未受影响 | 实跑输出；注入文件已清理 |
| P0 无法确认即拒绝（第十五轮） | 操作系统查询失败（命令缺失、超时、输出无法解析）一律视为「无法确认」，`--force` 拒绝强杀并要求人工处理；`radar-ops status` 新增「强杀身份校验（OS 级）可用/不可用」，让操作者事先知道 `--force` 能否使用 | `queryWindowsProcess` 返回 null 的路径；单元测试；status 实跑 |
| P0 心跳未来时间戳（第十五轮） | 心跳 `at` 或运行记录 `startedAt` 超过当前时间（含 5s skew）一律拒绝，异常时钟不会被当成有效心跳 | `tests/worker-process-identity.standalone.test.ts`（未来心跳、未来启动时间两例） |
| 回归与边界（第十五轮） | `npm run typecheck` 通过；相关 standalone 27/27；未改数据库、未启用 Ads（来源 `enabled=false`、开关未设）、3000/3001 正常；未 Commit/Push/部署 | typecheck、测试输出、`radar-ops status` |

### 第十四轮（2026-10-23 08:00–08:20）

| 项 | 结论 | 证据 |
|---|---|---|
| P0 `start` 参数顺序（第十四轮） | `startDetached` 把应用参数放在了入口之前（`node dev --port 3000 … bin.cjs`），Node 会把 `dev` 当脚本执行，`start web` 实际什么都起不来。抽出 `scripts/process-start.ts` 的 `nodeArgv()`：Node 参数在入口前、应用参数在入口后；`start web` 增加 `--port/--api-port`（默认 3000/3001）以便隔离演练 | `tests/radar-ops-start.standalone.test.ts` 2/2（真实子进程验证 argv 与执行顺序）；隔离端口实测 |
| P0 隔离端口真实启动（第十四轮） | `DATABASE_URL=<隔离库> radar-ops start web --port=3200 --api-port=3201`：API pid=50904 监听 3201 并返回**隔离库**数据（`sources: []`，证明没有连到开发库）、Web pid=18396 渲染出真实页面；同期 3000/3001 未受影响（HTTP 200）。演练期间发现并修掉一个真实缺陷：`startDetached` 未传 `logDir` 导致 `ERR_INVALID_ARG_TYPE`（已加默认值） | `.data/_diag/api-3201.log`、`web-3200.log`；隔离库 `lightchoice_radar_ci6`（已删除） |
| P0 `--force` 身份校验（第十四轮） | 原实现只看「历史 PID 存活」就强杀，PID 被复用就会误杀。改为**心跳证明身份**：进程运行时每 10s 写 `.data/run/<role>.beat`（含 pid 与进程启动时间）；`stop --force` 要求心跳新鲜且 pid、启动时间都与运行记录一致，否则拒绝。真实故障注入：把运行记录指向存活的本项目 API（pid 22996）、心跳写成 pid 9999 → `拒绝强杀 ads-policy：心跳中的进程 pid=9999 与记录 pid=22996 不一致`，API 保持 200 | `apps/worker/src/control.ts`（`startHeartbeat`/`verifyProcessIdentity`）；`tests/worker-control.standalone.test.ts` 9/9（含 6 种身份不符情形） |
| P0 监督器退避中可停止（第十四轮） | 原缺陷：监督器在自身重启退避时没有子进程、实例锁空闲，`stop ads` 因此判定「未在运行」并清掉停止请求 → 监督器稍后照常重启采集。改为「运行中」= 实例锁被占 **或** 有心跳；停止成功后必须同时确认**采集进程与监督进程都已退出**（无锁、无心跳）。真实演练：子进程连续失败、监督器处于自身退避（`status` 显示「Ads 采集进程 未运行 / 监督进程 运行中（正在退避）」）→ `stop ads` **1.2s** 停止，日志 `supervisor stopping … reason: stop request file`，之后 status 两者均未运行 | `.data/_diag/daemon-ci6-supbackoff.log`；隔离库 `lightchoice_radar_ci6`（已删除） |
| P1 其他生命周期回归（第十四轮） | 子进程退避睡眠中停止仍为 1.2s 且当前采集正常收尾；`start ads` 现在也会因「监督进程在退避」而拒绝重复启动；`status` 区分「运行中（持有实例锁）/ 监督进程正在退避 / 进程在但无心跳」 | 同上日志；`radar-ops status` 输出 |
| 数据与边界（第十四轮） | 未执行迁移；开发库未写入测试数据（三类数量不变：platform_policy 3 / ads_policy 2 / external_regulation 20）；Ads 仍默认关闭（`enabled=false`、开关未设）；3000/3001 正常；临时库 ci6 已删除；`lightchoice_radar_test` 未受影响 | `radar-ops status`、SQL 统计 |

### 第十三轮（2026-10-23 07:10–07:55）

| 项 | 结论 | 证据 |
|---|---|---|
| P0 Windows 正常停止（第十三轮） | **原状态：** 监督器用 `child.kill("SIGTERM")`，Windows 上等于 TerminateProcess，子进程的收尾（释放锁、结束当前采集）从不执行。**现在：** 监督器以 IPC 通道启动子进程并发送 `{type:"stop"}`；手工启动的进程通过 `.data/run/<role>.stop` 请求文件（子进程 1s 轮询）。停止请求只结束排期，**当前采集跑完再退出**；宽限期（默认 120s）后才强杀 | `apps/worker/src/control.ts`、`supervisor.ts`、`ads-policy.ts`；`tests/worker-control.standalone.test.ts` **5/5**（真实子进程：IPC 停止走子进程自己的收尾，产物为 `start:stop` 而非被终止；请求文件同样生效；陈旧请求会被下次启动清除） |
| P0 真实 Windows 停止演练（第十三轮） | 隔离库 `lightchoice_radar_ci4` + 真实 Ads 监督进程：**采集中途** `radar-ops stop ads` → 子进程日志 `stop requested; the run in hand finishes first (inRun:true)` → 该次采集正常完成（`found=2 created=2 ms=55613`）→ `the Ads policy scheduler is stopping (inRun:false)` → 实例锁释放，**40.6s** 完成；**退避睡眠中** 停止 → **1.3s** 完成（`inRun:false`，直接退出）。两种情形都没有重启，也没有留下运行记录 | `.data/_diag/daemon-ci4.log`、`daemon-ci5.log`；隔离库（已删除） |
| P0 本地操作工具（第十三轮） | 新增 `scripts/radar-ops.ts`：`status`（只读）/`start web\|announcements\|ads`/`stop ads\|announcements`。进程身份用 PostgreSQL advisory lock 判定（不使用 PID 文件，不做宽泛 `taskkill`）；`start ads` 始终经过 `RADAR_ADS_POLICY_ENABLED` + 来源 `enabled` 两道门禁；重复启动被拒绝（实测「已有 Ads 调度进程在运行」） | `scripts/radar-ops.ts`；实跑输出（见下） |
| P0 status 覆盖的运维问题（第十三轮） | 一条命令回答：3000/3001 是否存活（实际 HTTP 探测）、Ads 来源启停与 health、调度开关、Ads 进程与监督进程是否存活（锁+运行记录）、公告 Worker、停止请求、三类记录数、每个雷达来源最近一次采集（含 `failureClass`）、最近一次任务状态、本主线遗留 `running` 与**其他来源**的遗留记录（分开说明）、以及下一步建议 | `radar-ops status` 在开发库实际输出 |
| P1 Ads 启用准备（第十三轮） | 复核：默认关闭（`.env` 无 `RADAR_ADS_POLICY_ENABLED`、`ads-policy-pages.enabled=false`）；API/Web/公告 Worker 启动路径都不加载浏览器与 Ads 代码；退出码契约 0/2/3/1 与止损逻辑在第十二轮已验证，本轮未改；启用步骤写入 CURRENT.md 手册与 `.env.example` | `radar-ops status`（显示「Ads 采集关闭中」）；`grep` 确认无 UI/服务启动路径引用 |
| P1 公告 Worker 生命周期（第十三轮） | 同一停止机制接入 `radar-announcements.ts`（停止请求 → 停队列、释放锁、关库、清理控制文件）；启动时先清陈旧请求再取锁。崩溃收口逻辑未改，沿用第十二轮的实测证据；`stop announcements` 在未运行时是干净的 no-op（实测「实例锁空闲；清理残留的停止请求」） | `apps/worker/src/radar-announcements.ts`；实跑输出；`tests/worker-recovery.test.ts` 5/5（未改，复跑） |
| P2 数据一致性（第十三轮） | 开发库未写入任何测试数据；三类数量不变（platform_policy 3 / ads_policy 2 / external_regulation 20）；诊断只读 | `radar-ops status`、SQL 统计 |
| 3000 真实浏览器验收（第十三轮） | 公告列表 2 条「发布于 2026-05-22 / 2026-02-03」、标签筛选 2 条；Ads 列表 2 条「来源更新于 2026-07-22 / 06-25」、Ads 详情显示来源更新时间且无「收录时间」、原文链接存在；公告详情标题/来源正确、生效日期「未确认」；刷新后一致；0 pageerror | `.data/_diag/pw-round11.mjs`（BASE=3000） |

### 第十二轮（2026-10-23 06:30–07:05）

| 项 | 结论 | 证据 |
|---|---|---|
| P0 Ads 监督机制（第十二轮） | **确认此前不存在任何在仓的进程监督**：`deploy.md` 假设 systemd/pm2，本机两者都没有，watchdog 的 `exit 1` 就是采集的终点。新增零依赖 `apps/worker/src/supervisor.ts` + 入口 `ads-policy-daemon.ts`：按退出码区分 0=正常结束、2=配置不可用、3=来源停用、1/信号=运行时故障；运行时故障按 1→2→4…最多 4 倍间隔退避重启，连续 6 次后停止并要求人工；收到 SIGTERM/SIGINT 转发给子进程并在宽限期后强杀 | `apps/worker/src/supervisor.ts`、`ads-policy-daemon.ts`；`tests/worker-supervisor.standalone.test.ts` **9/9**（真实子进程：配置错误只启动一次、失败→成功共 3 次启动、持续失败 3 次后止损、来源停用不重启、SIGTERM 不重启） |
| P0 真实调度进程接线（第十二轮） | 用真实 `ads-policy.ts` 子进程演练：开关关闭 → 子进程 exit 0、监督器干净退出（exit 0，1 次启动）；来源停用 → 子进程 exit 3、监督器 exit 3 且不重启；浏览器缺失 → 连续两次运行时失败，监督器各重启一次后按上限停止（daemon exit 1，日志「stopped after 2 consecutive failures」） | `.data/_diag/daemon-restart.log`、`daemon-restart2.log`；隔离库 `lightchoice_radar_ci3`（已删除） |
| P1 公告/监管 Worker 崩溃恢复（第十二轮） | 真实缺口：该 Worker 从不收口遗留 `running` 记录（开发库至今还有 3 条 2026-10-20/21 的 `running` 属于别的来源）。新增 `apps/worker/src/interrupted-runs.ts`，在**取得 advisory lock 之后**只关闭自己范围内的记录；隔离库演练：植入 2 条 fetch + 3 条 job 遗留（含 1 条不属于本 Worker 的 job），启动后日志 `closed run records … fetch:2 job:2`，本 Worker 的 4 条标记为 failed（"the worker exited before this run finished"），`some.other.job` 保持 running；随后正常调度并真实采集 22 篇（公告 2 + CPSC 15 + FR 3/2），无重复创建 | `.data/_diag/worker-ci3.log`；隔离库演练（已删除） |
| P1 任务记录一致性缺陷（第十二轮） | 发现并修复：`collectSource` 失败时**返回** failed 而不抛错，`recordRun` 因此把 job 记成 ok —— 任务历史显示健康、抓取历史全部失败。新增 `recordCollectionRun`，失败结果转为 job failed 并保留结果给调度器；修复前隔离库 2 条 job 为 ok，修复后为 failed 且错误文本可读（不再是 `CollectResultError:` 前缀） | `apps/worker/src/collection-run.ts`；`tests/worker-recovery.test.ts`（5/5，含 failed/ok/skipped 三种） |
| P1 公告漏读边界（第十二轮） | 抽出 `archiveWindowFloor()` 并补 8 例：正文门禁来源每轮保留窗口；非门禁来源只在首次导入取历史；`x_search` 无下限；损坏的 `initializedAt` 回退到有界窗口（不是 NaN、不是无界）；窗口宽度就是历史深度；门禁版本变化重开；损坏的 `detailGate` 既不丢政策也不无限重读；记忆去重/上限 300 | `sources/radar-policy-source.ts`；`tests/policy-gate-memory.standalone.test.ts` **8/8** |
| P2 失败诊断（第十二轮） | 新增 `failureClass`（browser-unavailable / blocked-address / budget / page / source-http / network / unknown），写入 `fetch_runs.detail` 与 Worker 日志；真实演练：`ENOTFOUND` → `network`、`127.0.0.1` → `blocked-address`、缺浏览器 → `browser-unavailable`；同时验证健康数学：fail_count 1/2/3、health degraded、`next_fetch_at` = now + interval×(fail_count+2)（实测 60 分钟源第三次失败后 +240 分钟） | `sources/collect.ts`；`tests/collect-failure-class.standalone.test.ts` 2/2；隔离库真实失败记录 |
| P2 三类数据一致性（第十二轮） | 开发库实测：`platform_policy` 3 条（3 条 public、2 条 eligible，费用那条按既有池窗口规则不可见）、`ads_policy` 2 条（均 eligible/public、`published_at` 为空、`source_updated_at` 有值）、`external_regulation` 20 条（均 eligible/public、无 `source_updated_at`）。标签、资格、日期语义与列表可见性符合既有约定，未修改发布规则 | 开发库 SQL 统计 |
| 运行环境统一（第十二轮） | 按“3000 是唯一正式开发/验收环境”收口：在 **3000/3001** 启动 Web/API（指向 `lightchoice_radar`），停用此前的 3100/3101 临时实例；`.env` 的 `SITE_URL`/`API_BASE_URL` 本就指向 3000/3001 | `netstat`、`curl`；日志 `.data/_diag/web-3000.log`、`api-3001.log` |
| 3000 真实浏览器验收（第十二轮） | 公告列表 2 条「发布于 2026-05-22 / 2026-02-03」；标签筛选 2 条；详情标题/来源/原文链接正确、生效日期「未确认」；刷新不变；Ads 列表 2 条「来源更新于 2026-07-22 / 06-25」，Ads 详情显示「来源更新于」且不出现「收录时间」、原文链接存在；0 pageerror | `.data/_diag/pw-round11.mjs`（BASE=3000） |

### 第十一轮（2026-10-23 05:20–06:25）

| 项 | 结论 | 证据 |
|---|---|---|
| P0 来源核验（第十一轮） | 有边界核验 6 个候选：公告博客 4 页 23 条、sellingpartners data-insights 9 条、Ads 政策变更日志、Seller Central、www.amazon.com 帮助、SP-API changelog。**没有新增可合法自动采集来源**：Seller Central 是 robots `Disallow: /` + 登录；www.amazon.com 是买家条款、SP-API 是接口日志（分类不符）；Ads 变更日志正文 0 条条款证据（索引不是政策，且属 ads_policy）；data-insights 9 条里 7 条营销 | `docs/radar/source-check-round11.json`；robots 与正文均为本轮实测 |
| P0 公告来源漏读取修复（第十一轮） | 根因：`admission()` 在非首次导入时用 `initializedAt − 48h` 作下限，**首次导入漏读/当时被门禁拒绝的条目之后永远进不来**；而该来源的落库判定完全依赖正文。修复：正文门禁来源（`amazon-us-announcements`）每轮保留配置的 13 个月窗口，并用 `cursor.detailGate`（门禁版本 + 已拒身份）避免重复读取被拒页面；门禁规则变更时提升 `AMAZON_POLICY_GATE_VERSION` 即可重开 | `sources/collect.ts`、`sources/radar-policy-source.ts`；`tests/ads-policy.standalone.test.ts`（门禁记忆 5 例 + 版本/上限断言） |
| P0 覆盖结果（第十一轮） | 修复后开发库真实采集：`created=1`，新增 2026-02-03《New features and updates to Amazon's FBA Grade and Resell program》（S03，正文 2269 字符，规则标签「亚马逊卖家项目规则线索」），`relevance=pass`、`eligible=true`、`visibility=public`、`timeline_at=2026-02-03`。二次运行 `created=0`、`detailAttempts=0`（不发无意义请求） | `fetch_runs`、`articles`、`publications`；`.data/_diag/analyze-one.mjs` 输出；探针库（`pg_dump` 克隆开发库）先复现再验证 |
| P0 真实浏览器（第十一轮） | `3100/all?source=amazon-us-announcements` 2 条「发布于 2026-05-22 / 2026-02-03」；标签筛选「亚马逊卖家项目规则线索」2 条；详情 `/items/u7vd1afthdwbktd9d0avxstzc` 显示原标题、来源、原文链接（sell.amazon.com/…/fba-grade-and-resell-updates）、生效日期「未确认」；刷新后不变；`/all?source=ads-policy-pages` 仍 2 条「来源更新于 2026-07-22 / 06-25」；0 pageerror | `.data/_diag/pw-round11.mjs` 输出 |
| P1 Ads 独立调度（第十一轮） | 新增独立进程 `apps/worker/src/ads-policy.ts`：`RADAR_ADS_POLICY_ENABLED` 唯一开关（默认关闭）、`RADAR_ADS_POLICY_INTERVAL_MINUTES`（默认 360，15–1440）、`RADAR_ADS_POLICY_TIMEOUT_MINUTES`（默认 15，看门狗到期记错误并 `exit 1`）、`RADAR_ADS_POLICY_ONCE` 单跑。走既有 `collectSource`（与 `scripts/collect.ts ads-policy-pages` 同一条链路），不注册 pg-boss 队列、不加载到 API/Web/公告 Worker；advisory lock 角色 `ads-policy`；失败按 `nextRunDelayMs` 退避（最多 4 倍间隔，不放弃）；启动时把上一进程遗留的 `running` 记录标为失败 | `apps/worker/src/ads-policy.ts`、`ads-policy-schedule.ts`、`instance-lock.ts`；`tests/ads-policy-schedule.standalone.test.ts` 4/4 |
| P1 调度验证（第十一轮，隔离库） | 隔离库 `lightchoice_radar_ci`（65 迁移 + seed，仅该库把 Ads 来源置 enabled）：首跑 `found=2 created=2`（81s）、二次 `created=0 revised=0`（56s）；第二实例启动即退出码 0 并告警「another instance already holds this worker role」；`taskkill /F` 强杀中途实例后重启：锁重新获取，遗留 `fetch_runs 3`/`job_runs 3` 被标为 failed（"exited before this run finished"），新运行 ok | 会话日志、`fetch_runs`、`job_runs` |
| P1 失败与恢复（第十一轮，隔离库） | `RADAR_BROWSER_CHANNEL=chrome-does-not-exist`：`fetch_runs` 记 failed（"No local … to render with"）、来源 `health=degraded`、`fail_count=1`、`last_error` 有值、`next_fetch_at` 前进，文章数不变（无脏数据）；恢复默认 channel 后 `health=ok`、`fail_count=0`、`last_error` 清空 | 隔离库查询；`.data/_diag/ads-scheduler-A.log` |
| P1 登录状态（第十一轮） | Ads 页面是公开页，**不存在登录态**：浏览器每次新开、不带凭据；登录墙/账号门户/404 页在门禁处直接拒绝（单元覆盖），不会入库；Seller Central 这类登录页由 robots 拒绝且不在任何准入白名单内。结论：本主线无需登录恢复，也不引入登录依赖 | `tests/ads-policy.standalone.test.ts`（登录墙/门户/404 三例）；`tests/radar-source-compliance.standalone.test.ts` |
| 三类记录数（第十一轮） | `platform_policy` **3 条**（2026-05-22、2026-02-03、2025-10-15 费用更新；前两条 `eligible=true`，费用那条按既有规则不在池窗口内）、`ads_policy` **2 条**、`external_regulation` **20 条** | 开发库 `articles`/`publications` 统计 |

### 第十轮（2026-10-23 04:00–05:55）

| 项 | 结论 | 证据 |
|---|---|---|
| P12 atomic 严格首行（第十轮） | `ATOMIC_HEADER` 由 `/^--\s*atomic[ \t]*\r?\n/` 改为 `/^--[ \t]+atomic[ \t]*\r?\n/`。原 `\s*` 可跨换行，`--\natomic`、声明前空行、`-- atomic\n\n` 之类都能进 atomic 路径；现在只允许行内空白，声明必须在第一行且单独成行 | `scripts/migration-safety.ts`；`tests/migration-safety.standalone.test.ts` **15/15**（新增 CRLF/LF/多余空格/声明前空行/中间换行/`--atomic`/尾随字符/文件中注释 等边界，并直接读盘校验 0090 首行 == `-- atomic`） |
| P12 放行范围不变（第十轮） | 仍是 0090 那两条固定语句的 token 逐条比对；UPDATE/DELETE/TRUNCATE/额外 SELECT/第三条/函数体/改列名/去掉 hash 守卫全部拒绝；1s 锁等待、10s 语句超时与白名单未改 | 同上（`an atomic migration refuses anything but the reviewed 0090 statements`） |
| P13 来源更新时间时间轴（第十轮） | 相同正文、来源更新时间变新：只更新 `source_updated_at`；**无可信发布日期时同时更新 `timeline_at` 并用现有 `publishArticleTx` 重导发布投影**（不产生 revision、不重新分析）。有 `published_at` 时发布日期与时间轴都不动。旧值不回退：`laterDate()` 与 `refreshSourceUpdatedAt()` 都只接受更晚的值；revision 路径同样用 `laterDate` 且不再被 null 清空 | `packages/backend/src/content/materials.ts`；`tests/source-updated-timeline.test.ts` **6/6**（含投影 `timeline_at`/`sort_at` 同步、旧值不回退、有发布日期不受影响、正文变更时 revision 与时间轴同时更新） |
| P13 列表日期语义（第十轮） | `ItemSummary`/`FeedItemSummary` 新增 `sourceUpdatedAt`；`ITEM_COLUMNS` 取 `a.source_updated_at`；卡片新增 `data-item-date` 日期行：有发布日期→「发布于」，否则有来源更新时间→「来源更新于」，都没有→「日期未确认」（不再拿抓取当天当政策日期）。详情页三处改为「发布于/来源更新于/收录于」与左栏「发布时间/来源更新时间/收录时间」 | `packages/contracts/src/site.ts`、`publication/items.ts`、`apps/web/app/features/feed/parts.tsx`、`FeedItem.tsx`、`apps/web/app/routes/item.tsx` |
| P13 Ads 真实浏览器复验（第十轮） | Chrome 打开 `3100/all?source=ads-policy-pages`：2 条、标签分别是「来源更新于 2026-07-22」「来源更新于 2026-06-25」、无「发布于」；来源下拉重提仍是 2 条且标签不变；详情 `/items/wjrz7zf3ajcxsyruzfg5hfa8l` 在 1280 宽显示「来源更新于 2026-07-22」、1600 宽左栏显示「来源更新时间 2026-07-22」、都不出现「收录时间」；刷新后一致；公告来源一条显示「发布于 2026-05-22」；无 pageerror | `.data/_diag/pw-round10-dates.mjs`、`.data/_diag/pw-round10-detail.mjs` 输出 |
| P14 官方政策人工录入（已取消，第十轮内撤销） | 产品决定取消人工录入，本轮把该功能完整移除：删除 `0091_policy_submissions.sql`、`admin/manual-policy.ts`、`content/policy-verification.ts`、`/admin/policies` 页面与路由、三条 `/api/admin/policies*` 接口、导航待核验计数、`AdminPolicy*` 契约、`policy_submissions` 相关测试、`amazon-official-manual` 来源配置与 `SiteItemDetail.policyVerification`。**未执行 0091 迁移、未改正式库**；隔离验收库已删除，测试模板库的残留表与台账行已清理 | `git status` 无相关文件；`grep policy_submissions\|manual-policy\|amazon-official-manual` 在源码/配置/迁移中为 0 命中；`/admin/policies` 返回 404；`npm run typecheck` 通过 |

### 第一～九轮（历史，未重复验证）

| 项 | 结论 | 证据 |
|---|---|---|
| P0-1 进程归属 | PID 28048 = 手工启动的 `node --env-file-if-exists=../../.env src/radar-announcements.ts`（16:47:46 启动，父进程 41324 已不存在，成孤儿）；**PID 3012 已不存在**，19:00 由计划任务启动、随后以 `0xC000013A`（控制台中断）退出 | `Get-CimInstance Win32_Process`、`Get-ScheduledTaskInfo` |
| P0-2 现有互斥能力 | pg-boss 已提供**任务级**互斥：抓取任务用 `singletonKey=sourceId`，调度队列 `policy=singleton`，取任务走 `SKIP LOCKED`。**但缺少进程级单实例**：两个进程会同时轮询同一队列、同时 upsert 同一条 `pgboss.schedule` | `packages/backend/src/jobs/queue.ts`、`sources/collect.ts:500-523` |
| P0-2 双实例实验 | 在未加锁状态下并行运行两个实例 5 分钟，`job_runs` 每分钟仍只有 1 条，**未出现重复执行** | 第二实例 PID 6304，日志 `subscribedQueues` 只有两条私有队列；`dup_minutes=[]` |
| P0-3 最小单实例方案 | 新增 `apps/worker/src/instance-lock.ts`：PostgreSQL 会话级 advisory lock（key 7204229001），在注册任何队列之前获取；拿不到锁输出 warn 并 `exit(0)` | 类型检查 `tsc -p apps/worker` 通过 |
| P0-4 保留一个有效实例 | 确认无 active job 后停止 PID 28048；改由计划任务在 21:57 启动 **PID 42608**，锁由该进程持有 | `pg_locks` 中 objid 2909261705 / classid 1 被 pid 41848（42608 的保留连接）持有 |
| P0-5 重复启动不重复执行 | 手工再启一次：输出 `another instance already holds this worker role`，退出码 0，未注册队列 | 实测日志 |
| P0-6 计划任务重复启动 | 触发器为「当前用户登录」，`MultipleInstances=IgnoreNew`、`RestartCount=5/1min`。IgnoreNew 只防任务实例并发，**防不住手工/其它 Agent 已启动的 node**；现在由 advisory lock 兜住 | `Get-ScheduledTask` |
| P1-1 22:49 调度 | 来源 `next_fetch_at=2026-10-22 22:49:22`（360 分钟间隔）；调度队列每分钟触发 | `sources`、`job_runs`、`pgboss.job` |
| P1-2 22:49 真实采集 | **已真实执行**：22:49:35 调度入队 1 条 → 抓取任务 22:49:35 创建、22:49:44 完成；`fetch_runs id=61` `status=ok`、`found=11 / new=0`、`detailErrors=[]`；来源 `health=ok`、`fail_count=0`、`last_ok_at=22:49:44`、`next_fetch_at=2026-10-23 04:49:44`；同分钟无第二条调度或抓取任务 | `fetch_runs`、`pgboss.job`、`job_runs`、`sources` |
| P1-2 去重 | 库内 `amazon-us-announcements` 仍 1 篇公告、`revision=1`，11 条列表项 `new=0` | `articles` |
| P1-6 不启动全局 Worker | 未启动 `src/main.ts`；专用 Worker 只订阅 `cron.radar.amazon-announcements.schedule` 与 `sources.fetch-amazon-announcements` | 进程命令行 + 启动日志 |
| P2 历史回测样本 | 10 条官方样本，逐条核对原标题/链接/发布日期/生效日期/适用范围/规则证据；**10 通过、0 漏检、0 误报、0 未确认** | `docs/radar/amazon-policy-backtest.json`、`tests/radar-policy-backtest.standalone.test.ts`（6/6 通过） |
| P2 门禁修复（第二轮） | `isQualifyingAmazonPolicyAnnouncement` 增补两类证据：①同一句内 opt-in 与 opt-out 并存且指向 program/enrollment/inclusion/participation；②`effective`/`takes effect`/`goes into effect` 与政策主体（库容、费率、政策、资格、入库配置等）在 ±160 字符内同时出现。日期或数量单独出现仍不放行 | `packages/backend/src/sources/radar-policy-source.ts`；诱饵测试 5 条全部拒绝、2 条正例放行 |
| P2 全量语料复核 | 公告列表页 4 页 23 条正文全部重跑：**3 条通过（S02/S03/S04）、20 条拒绝、0 误报** | `.data/_diag/corpus-check.mjs` 输出（本地只读缓存） |
| P2 标题与日期一致性 | 9 条公告的列表标题 = 详情 h1，列表日期 = 详情 `datePublished`，全部一致 | `fetchWebList` / `fetchDetail` 实测比对 |
| P3 README | 修正「只采 RSS、不抓正文」；区分默认端口 3000/3001 与当前可用预览 3100/3101；网页工作台标为主要入口、DSH/MCP 标为暂停；更新主线状态表与 worker 段落 | `README.md` |
| P4 S03 标签（第三轮） | `radar-rules.ts` 的 `seller-program-rules` 补「同一句 opt-in 对 opt-out」；S03 得到「亚马逊卖家项目规则线索」，全语料 23 条中只有它命中，无新增误标 | `packages/backend/src/editorial/radar-rules.ts`；`tests/radar-policy-backtest` 第 6 例 |
| P4 回测口径（第三轮） | 新增 `docs/radar/amazon-policy-backtest-bodies.json`：10 篇官方正文 + 抓取时间 + sha256；测试重算哈希并对**完整正文**调用当前分类器，`engine` 字段不再是判定依据，摘录回归降为辅助断言 | `tests/radar-policy-backtest.standalone.test.ts` 9/9 |
| P4 新信源（第三轮） | 新增 `us-federal-register-cpsc`、`us-federal-register-ftc`（联邦公报规则/拟议规则 RSS），并补注册此前只声明未入库的 `rss-cpsc-recalls`；三者均为 RSS 链路，无框架改动 | `industry/sources.json`、`scripts/seed.ts` 输出 `3 added` |
| P4 受控采集（第三轮） | CPSC 召回 `found=40/created=15`；FR-CPSC `3/3`；FR-FTC `5/2`（2 条 petition 噪声、1 条同身份去重）；重复采集三者 `created=0` | `scripts/collect.ts` 两次运行输出 |
| P4 入库与抽检（第三轮） | 库内政策与监管记录 23 条（Amazon 3 + CPSC 15 + FR 5），全部 `backfill=1`；10 条抽检标题 10/10、日期 10/10（FR 按页面 meta，CPSC 按页面正文日期） | `.data/_diag/spotcheck.json`、`.data/_diag/datecheck.mjs` |
| P4 网页验收（第三轮） | 来源列表 7 个、按来源/标签/关键词筛选、空结果 `total=0`、详情页标题+来源+原文链接+日期+标签、按发布日期查 2026-05-22 命中 S02 | `3101/api/site/pool*`、`3100/all`、`3100/items/:id` 的 HTTP 结果 |
| P5 Accelerate 分类核实（第四轮） | 唯一记录 “At Accelerate 2026, Amazon shares new AI tools…” 原文是会议综述与功能宣传（“annual seller conference… Nearly 4,000 selling partners came together in Seattle”），无卖家规则、无生效日期 → **营销内容**，不是平台政策也不是项目规则 | `articles`/`publications` 原文与 excerpt；`industry/sources.json` |
| P5 统计口径修正（第四轮） | 该来源改名「亚马逊官方｜卖家大会与功能宣传（已停采，历史记录保留）」、`enabled=false`、tags 去掉政策口径；文章、原文链接、发布记录全部保留，详情页仍 200。`platform_policy` / `external_regulation` 写进来源 tags：**平台政策 2 条**（费用 1 + 公告 1）、**监管 20 条**，不再混算 | 开发库 `sources.tags`、`articles` 统计；`3101/api/site/pool/sources` 显示改名后的来源 |
| P5 监管调度接入（第四轮） | 专用 Worker 新增 `cron.radar.regulatory.schedule` + `sources.fetch-regulatory`；`RADAR_REGULATORY_SOURCE_IDS` 白名单在**入队**（`scheduleDueSources`）与**执行**（Worker handler）两处校验，执行处另校验 `enabled` 与官方主机 | `radar-policy-source.ts`、`collect.ts`、`queue.ts`、`apps/worker/src/radar-announcements.ts` |
| P5 调度实测（第四轮） | 00:39:19 三来源各入队 1 条 → 00:39:21/22/24 抓取完成 `found=40/3/5`、`created=0`、`health=ok`、`fail_count=0`；`next_fetch_at` 推进到 01:39 / 02:39；00:40 调度 `enqueued=0`，无重复执行；`cron.sources.schedule` 110 条仍为 `created`，未被本 Worker 消费 | `job_runs`、`fetch_runs` 68/69/70、`pgboss.job`、Worker 启动日志 |
| P6 撤销 Accelerate 准入（第五轮） | `RADAR_POLICY_SOURCE_IDS` 去掉 `amazon-us-accelerate-updates`，并删除 `isApprovedRadarPolicyWebList` 中该来源的整个准入分支与配套常量；即使重新启用该来源，也过不了平台政策来源检查。`industry/sources.json` 的禁用配置、库内文章/原文链接/发布记录全部保留 | `radar-policy-source.ts`；`tests/radar-policy.standalone.test.ts`（含「重新启用仍拒绝」断言） |
| P6 Worker 来源独立启停（第五轮） | 新增纯函数 `apps/worker/src/source-selection.ts`：逐个校验四个来源的 `enabled` 与白名单，不合规的记 `reason` 后跳过，其余继续；`allUnavailable` 为真时 Worker 打印 error、释放锁并以退出码 1 结束，不起空转进程。只为可用来源注册队列；抓取处理再校验「本 Worker 运行集 → 静态白名单 → 当前行状态」三道，禁用时记 warn 并跳过而非计失败 | `apps/worker/src/radar-announcements.ts`、`tests/radar-worker-sources.standalone.test.ts`（7/7） |
| P6 运行时切换（第五轮收口） | 01:11:41 停掉旧实例 46476、以最新代码启动 **PID 24900**：锁重新获取（backend pid 43000），启动日志 `subscribedQueues` 恰为四条私有队列、无 `sources.fetch`，`skippedSources=[]` 与四个来源全部启用一致。切换后连续 32 分钟：公告调度 32 条（1/分钟）、监管调度 96 条（3/分钟），无缺口无重复；01:39 CPSC 召回按自然到期被调度（`enqueued=1`，另两个 `enqueued=0`），`sources.fetch-regulatory` 1 条任务、`fetch_runs 71` 返回 304 `notModified`、`found=0/new=0`、健康 ok；`cron.sources.schedule` 20 条仍为 `created` 未被消费 | 启动日志 `.data/_diag/worker-round5.log`、`job_runs`、`fetch_runs`、`pgboss.job`、`pg_locks` |
| P7 官方来源扩展（第六轮） | 用项目 HTTP 层实测 8 组候选：Seller Forums 与 Help Hub 的 robots 是 `Disallow: /`、Help Hub 还要登录；Selling Partners RSS 只有 4 条营销/洞察（`?tag=`/`?category=` 无效）；Ads 政策页 404 或 JS 壳；Brand Registry 是营销页；公告列表 p≥5 回落第 1 页（共 4 页 23 条，第 1 页已覆盖 13 个月窗口）；费用页无条目日期。**没有新来源通过验收，未强行接入** | `docs/radar/source-research-2026-10-23.json`（含每个候选的 robots/状态/字节/正文/结论） |
| P7 合规守卫（第六轮） | 新增静态测试：任何声明来源都不得指向 robots `Disallow: /` 的主机，且必须是 https 且落在已验证的公开主机列表里 | `tests/radar-source-compliance.standalone.test.ts`（2/2） |
| P8 浏览器渲染实验（第六轮） | Playwright + 本机 Chrome（`channel=chrome`，未下载任何浏览器）实测 6 个公开页面：Amazon Ads 政策 hub 与两个子政策页，HTTP 只有 6 字符壳，浏览器渲染出 **3059 / 3098 / 4192 字符**真实条款，并带 `Updated on Oct 12 / Jul 22 / Jun 25, 2026`；`sell.amazon.com/pricing`（HTTP 14865 → 浏览器 6858）与公告列表（10070 → 5799）用浏览器反而更短，无新增信息；`/help/GVZ7PMBSF7DZ8N2S` 渲染后仍只有 557 字符。现有规则只命中 Ads 页标题里的 "Prohibited products"，未命中真正的义务句 | `docs/radar/pw-experiment-2026-10-23.json`、`.data/_diag/pw/*.txt`（渲染全文） |
| P9 Ads 政策独立链路（第七轮） | 新增 `browser-render.ts`（Playwright + 本机 Chrome，动态导入，API/Web/常驻 Worker 不会加载）与 `ads-policy.ts`（来源白名单、目录只做发现、两个子页各自判定、`Updated on` 解析、≥3 条条款证据才放行）；`radar-rules.ts` 增 `ads-policy` 规则（标签「亚马逊广告政策线索」）；`collect.ts` 按 `adapter=browser_help` 分支；来源 `ads-policy-pages` 在 `industry/sources.json` 声明为 `enabled=false`。实采两页：来源更新时间（`sourceUpdatedAt`）2026-07-22 / 2026-06-25，`publishedAt` 与 `publicationTime` 保持 null，正文 2401 / 3465 字符，条款证据 4 / 3 条；连续两次渲染身份与哈希一致，改动正文后哈希变化（修订路径） | `docs/radar/ads-policy-collection-2026-10-23.json`、`docs/radar/ads-policy-fixtures.json`、`tests/ads-policy.standalone.test.ts`（6/6） |
| P10 迁移 0090 修复（第八轮） | `0090_article_revision_excerpt.sql` 是多语句迁移，违反「一条语句」规则，**任何全新库都装不上**。在 `migration-safety.ts` 增加首行 `-- atomic` 声明：多条语句在**一个事务**里执行，沿用同样的 1s 锁超时/10s 语句超时；分词器仍拒绝函数体。0090 加上该声明后，全新库一次装完 **65 条迁移**（该阻塞已解除） | `scripts/migration-safety.ts`、`database/migrations/0090_article_revision_excerpt.sql`；`lightchoice_radar_test` 迁移输出 |
| P11 atomic 门禁收紧（第九轮） | `-- atomic` 必须是文件首行（`^-- atomic` 且紧跟换行），正文/中间注释里的同名词不触发；允许的语句只有 0090 那两条，按 token 逐一比对，其余（UPDATE/DELETE/TRUNCATE/SELECT/第三条/改列名/去掉 hash 守卫/函数体）全部拒绝；1s 锁超时与 10s 语句超时不变 | `scripts/migration-safety.ts`；`tests/migration-safety.standalone.test.ts` 12/12（新增 3 例） |
| P11 Ads 进入列表（第九轮） | `decideTimeline` 在**没有发布日期**时用 `sourceUpdatedAt` 作时间轴（有发布日期的行为不变）；`publishArticle` 的资格条件增加 `source_updated_at !== null`。两条 Ads 记录：`eligible=true`、`timeline_at=2026-07-22 / 2026-06-25`、`published_at` 仍为 null；`?source=ads-policy-pages` 返回 2 条，详情页显示「未确认」 | `content/materials.ts`、`publication/publish.ts`、`articles`/`publications` |
| P11 真实浏览器验收（第九轮） | Chrome（`channel: chrome`）打开 `3100/all?source=ads-policy-pages`：列表 2 条、来源名「亚马逊官方｜Amazon Ads 政策页」、点击进入详情 `/items/wjrz7zf3ajcxsyruzfg5hfa8l`、原文链接存在、发布日期显示「未确认」、无 pageerror | `.data/_diag/pw-ads-list.mjs` 输出 |
| P10 Ads 端到端入库（第八轮） | 隔离库 `lightchoice_radar_test` 走真实浏览器链路：首次 `found=2 / created=2`（59.7s），第二次 `created=0 / revised=0`；开发库同样 `created=2`，两条记录 `published_at=null`、`publication_time=null`、`source_updated_at=2026-07-22 / 2026-06-25`、正文 2401/3465 字符、标签含「亚马逊广告政策线索」 | `fetch_runs`、`articles`、`publications`；`.data/_diag/process-ads.mjs` |
| P10 Ads 持久化测试（第八轮） | 新增数据库测试：首次入库写 source_updated_at 且 published_at 为空；同正文再采集不新建不修订；正文真变化产生 revision 2 且 `article_revisions` 有两条；缺 `Updated on` 时两个日期都未知 | `tests/ads-policy-persist.test.ts`（4/4，需 `lightchoice_radar_test`） |

## IN_PROGRESS

- **当前运行状态（R50 收口时实测）**：PostgreSQL 5544（pid 27108）、公告/监管 Worker（pid 8732）、AMZ123 线索 Worker（pid 15560）均在运行并各持实例锁；Web 3000 运行中；**API 3001 本轮重启过一次**（发现时已掉线，`radar-ops start api` 补起，pid 随命令结束被本环境回收，需在下次启动时确认）；**翻译 Worker 未运行**（R50 实测后已优雅停止）；Ads 来源停用、`RADAR_ADS_POLICY_ENABLED` 未设；主 Worker（全量 `apps/worker/src/main.ts`）**未运行**（未授权）。
- **自动翻译状态**：`settings.translate.baseline` = 2026-10-24 20:48:34（R50 首次正式启用时写入，此后重启沿用）；窗口 `r49-formal` 上限 0 次 / ¥0.1976；`receipts` 44 条 / ¥0.0610（R45+R47+R49 累计）；`translations` 44 行（中文标题 23、中文摘要 21）。
- **待办观察**：① 新窗口批准并启用后，观察自然新增官方文章的自动翻译；② AMZ123 与公告源的自然周期证据继续积累；③ 重启电脑后的自动恢复（本工具不设开机自启）。
- **仍未验证**：跨会话常驻存活、跨多个 6 小时周期的长期常驻证据、自然新增文章的自动翻译样本。

## NOT_DONE（未验收）

| 项 | 原因 |
|---|---|
| ~~**中文标题/摘要/正文翻译（R41 三种能力）**~~ **（R45/R47/R49 已解决标题与摘要，正文仍受限）** | R45 起 DeepSeek 通道已打通：23 篇官方条目中文标题 23/23、中文摘要 21 篇，`translations` 44 行、`receipts` 44 条 / ¥0.0610。**正文中文阅读仍受阻**：六来源 `site_fulltext=false`，页面按来源约定只展示摘要，正文翻译器只在隔离库验证过；开放正文展示属来源展示依据变更，须单独授权 |
| ~~**正式持续自动解释写入（R41 自动链路）**~~ **（R50 已具备受管入口，未启用）** | 自动链路（`content.sweep → analyze → publish → translate`）已在隔离库与正式库副本实测；R50 起可用 `start-radar.cmd translate` 受管启动。**正式持续运行仍未启用**（当前预算窗口 0 次额度 + 未授权常驻） |
| 解释样本的两类覆盖 | 表格/长正文表格样本、官方发布日期缺失样本本轮无对应真实记录 → 标未验证；留出样本 `ji54…` 只读未写入 |
| `page-metadata.standalone.test.ts` 3 例 | **既有夹具缺口（非本轮引入）**：`/all` 依赖 `/api/site/pool/sources` 而夹具未提供、Radar 首页 `/` 会重定向到 `/all` → 3 例 404。最小修法是给夹具补一个 `pool/sources` 路由，属独立小修，本轮按范围纪律只报告 |
| 独立测试 6 例失败 | `spawn openssl ENOENT`（本机无 openssl）、header overflow 断言（Node/undici 环境差异）、上述 page-metadata 3 例——均与本轮改动无关，未在干净检出上复测（禁止 git 写操作/建 worktree） |

| 项 | 原因 |
|---|---|
| ~~AMZ123 线索源的常驻调度~~ **（第十九轮已解决，第二十轮复核通过）** | 专用 Worker 入口 `radar-amz123-leads` 已实测启动 → 自行触发真实采集（`fetch_runs` #115）→ 停止释放锁。第二十轮再次受控复核：启动后官方队列零次被取走、单实例二次启动被拒、停止正常退出。**剩余的是「跨多个 6 小时周期的长期常驻证据」**：目前只覆盖了一个完整周期内的单次触发 |
| AMZ123 线索的自动命中率 | **第二十轮已按真实样本修好**：29 个真实页面回归（28 已标注 + 1 未标注）→ 有效政策线索 **2/2** 正确识别、应拒绝 **26/26** 正确拒绝、**误收 0、漏收 0**。第十九轮诊断出的两个缺口（财报误收、付费邀评漏收）都在 AMZ123 专属准入层修掉，**共享规则 `radar-rules.ts` 未动**。剩余的命中率上限主要来自站点供给本身（多数样本本就不是 Amazon 美国站政策），不是判定规则缺口 |
| AMZ123 列表页翻页 | 只取列表页首屏可得的链接（`/t` 4–19 条、`/kx` 72–101 条），**未实现翻页**；更深历史依赖 sitemap 归档覆盖（4000 条上限、24h 刷新一次） |
| `/zb` 早报栏目 | 本轮**未纳入**：每日多主题摘要与 `/t`、`/kx` 事件重复、粒度更差，且每篇仍需约 300KB 读取，不满足「低成本且有增量价值」 |
| ~~开发库迁移停在 0089~~ **（第二十一轮已完成）** | 2026-10-23 18:31:30 开发库**已应用 0090**（`applied 0090_article_revision_excerpt.sql (41ms, transaction)`，exit 0），`article_revisions.excerpt` 已存在、127 条修订按 `content_hash` 回填、正文与三类统计未变。迁移前备份 `lightchoice_radar-pre0090-r21-20261023-183114.dump`（970,722 字节，sha256 `6caf18d4…a26991`）。**历史那条 27 字符摘要仍在 `article_revisions.body_text`，本轮未清理**（需另行授权） |
| ~~AMZ123 分类规则的两个具体缺口（第十九轮诊断，**未改**）~~ **（第二十轮已解决）** | ① 误杀 `t/zDrc37rW`（美国站付费邀评）：已通过 AMZ123 专属准入层修好——新增专属规则 `amz123-platform-rule`，且要求 Amazon + 美国站 + 规则语境三重共现。② 误收「销售费用率」：已通过主体判定（`company-financial` / `company-operation`）拦截。**两处都没有改 `radar-rules.ts`**，因此官方来源判定零影响（回归 51/51） |
| ~~AMZ123 短快讯解析阈值~~ **（第二十轮已解决）** | 已改为**字段完整性 + 结构校验**（title 非空、content 是字符串、`published_at` 存在、正文去标签后 ≥ 40 字符），不是单纯把 200 降到 120。156 字符的 DHL 快讯现在**解析成功**，随后因非 Amazon 政策被门禁正常拒绝；空壳页 / 登录墙 / 错误页 / 缺关键字段仍全部被拒（定向测试 13/13 覆盖） |
| AMZ123 官方证据覆盖 | 核实只匹配本项目已收录的官方文章（博客 77 + sellingpartners 44 + 联邦公报等）。**未**改现有官方采集器、**未**扩建 CBP 来源、**未**切换 Federal Register API（属独立任务）。Seller Central 类口径因 robots `Disallow: /` + 需登录而无法核实，一律标 `access-restricted` |
| AMZ123 官方正文的可核实率 | 13 个事件中仅 1 个（EV-IOR）拿到公开官方原文、1 个（EV-AGED）官方有链接但证据不足，其余 4 个官方口径在 Seller Central（robots `Disallow: /` + 需登录）。**未**尝试绕过、未自动登录、未抓取受保护内容；这类事件只能长期标「官方正文不可核实」 |
| EV-IOR 的两个子主张 | ~~两项具体数值未逐字核实到~~ **R33 已更新**：已取到行政令 91 FR 35125 全文——「180 天」期限在 EO §2(a) 逐字核实（"Within 180 days of the date of this order"，是 DHS/CBP 的履职期限，**不是卖家整改截止日**）；「保证金/境内资产门槛」的方向在 §2(a)(i) 逐字核实（行政令**要求** CBP 修订规则时提高门槛），但**具体金额标准仍未发布**（由 CBP 后续规则确定），保持未证实 | EO 14411 全文（91 FR 35125-35126） |
| `127.0.0.1` 访问时的 hydration 警告 | SSR 按 `.env` 的 `SITE_URL=http://localhost:3000` 输出 `canonical`/`og:url`，客户端按浏览主机（`127.0.0.1:3000`）重算 → 每条页面 1 条 "A tree hydrated but some attributes…" 警告。**用 `localhost:3000` 访问为 0 条**（已实测）。属既有环境配置问题，R50 未改任何被服务文件。修法二选一：把 `SITE_URL` 改成 `http://127.0.0.1:3000`，或文档统一用 `localhost:3000`（《本地运行说明》目前写 127.0.0.1） |
| 历史队列积压（约 3,248 条 `created`） | 全部是历史全量 Worker 注册的 `cron.*` 调度行被 pg-boss 时钟持续扇出的空作业，`cron.sources.schedule` 约 1 条/分钟。**真实业务队列 `created` 为 0**。pg-boss 按 `start_after + 14 天` 删除未 active 作业，增长有界。**本轮未授权清理**，按已知限制保留；如需清理须单独授权并先提交精确清单 |
| AMZ123 样本时间窗 | sitemap 的 `/t` 归档集中于 2026-07，本轮样本覆盖 2026-07-08 → 2026-10-21；更长窗口、季节性事件、多语言站点未覆盖；结论是**单季结论**，未验证长期供给稳定性 |
| AMZ123 改版存活率 | 文章页 SSR 字段（JSON-LD / `__NUXT_DATA__`）与 `author` / `tags` 内部结构一旦改版即失效。**未**做长期运行观察、**未**做版本探针；列表页客户端渲染的分页**未**实现（改用 sitemap 归档覆盖） |
| 官方渠道的发现方式 | `sell.amazon.com/blog` 与 `sellingpartners.aboutamazon.com` 的**月度 sitemap**（`sitemap-YYYYMM.xml`）是本轮新发现的、机器可读的官方发现入口，比现有靠浏览器渲染列表页更稳；`federalregister.gov` 列表页现返回 "Request Access"，须用其公开 API + `raw_text_url` 取全文。**本轮只做研究，未改现有采集器** |
| Ads 调度仍默认关闭 | 边界要求「不实际启用常驻任务」：开发库 `ads-policy-pages.enabled=false`、`RADAR_ADS_POLICY_ENABLED` 未设。启用只需两步（见「运行与恢复手册」），本轮不在开发库启用 |
| 后台 `start` 的长期存活 | 见 BLOCKERS 第 1 条：本环境验证了「启动→取锁→停止」全链路（隔离端口 3200/3201 真实启动成功），但 detached 进程在作业对象关闭后会被回收；长期运行建议前台 `npm run daemon:ads-policy` |
| 进程身份依赖外部命令查询 | OS 级身份通过 Windows 自带的进程查询命令取得；该命令不可用或被策略禁用时 `--force` 一律拒绝（安全侧已覆盖，实测路径存在），但意味着这类环境只能人工处理。心跳文件本身理论上仍可被伪造，OS 应答是让它可用的原因 |
| 公告 Worker 的停止演练 | 停止机制与 Ads 共用同一实现（`worker-control` 测试覆盖 IPC + 请求文件），本轮只验证了「未运行时 stop 是 no-op」；未在真实公告进程上做「停止时正在采集」的演练（该 Worker 未运行，且边界不允许擅自启动正式公告 Worker） |
| supervisor 未安装为系统服务/开机自启 | 属于部署动作，本轮明确不做。当前是「手动启动 + Ctrl+C 停止」，进程随终端/会话结束 |
| 注销 → 登录后计划任务自动恢复 | 当前执行环境不能安全注销登录，**保持未验收，不做假设** |
| 修订路径（真实上游改写） | Ads 页面内容未变（`revised=0`）；正文变更→revision 由 `tests/ads-policy-persist.test.ts` 用真实渲染样本覆盖，未做线上改写演练 |
| Amazon 平台政策记录数 | 开发库 **3 条**（2026-05-22、2026-02-03、2025-10-15；前两条列表可见）。供给上限已确认：公开入口只有公告博客与 sellingpartners 两处 |
| 费用记录的列表可见性 | `amazon-us-fee-updates` 那条 `publications.eligible=false`（历史回填，不在池窗口内），详情可访问但默认列表不出现；既有发布层行为，本轮未改（一致性检查确认符合既有约定） |
| Accelerate 那条仍在站点可见 | 记录按「不删除历史证据」保留，来源已改名并停采；仍带规则引擎给出的「账号健康与申诉线索」标签，阅读时需结合来源身份判断 |
| 公告索引 13 个月窗口之外的历史政策 | 第 2–4 页条目早于窗口（2022-11 至 2025-09），按「历史样本不回填」不入库 |
| 开发库 3 条历史遗留 `running` fetch_runs | 属于 `rss-wyze-community`（2026-10-20/21，非本 Worker 范围），本轮不越界清理；本 Worker 只会收口自己来源的记录 |
| ~~漏收样本不会被自动重读~~ **（第二十一轮已完成）** | 已从 `sources.cursor.rejected` 中**精确移除唯一一条** `url:https://amz123.com/t/zDrc37rW`（91→90，其余 90 条与 `pending`/`sitemapAt`/`initializedAt`/`lastOkAt` 全部不变），并用**单 URL 受控重试**真实重采：`fetch_runs #116 ok found=1 new=1` → 入库 `p4c2oymucl6o3ocj6avoytzkw`（`sourceRuleIds=["amz123-platform-rule"]`、无正文、`third-party-only`）。复跑 #117 `alreadyStored=1` 证明去重有效 |
| ~~隔离库 `lightchoice_radar_r20_ci` 是否保留~~ **（第二十一轮已删除）** | 删除前核验：精确名、65 条迁移（最新 0090）、2 篇文章、2 条 AMZ123 线索、11 MB、**连接数 0**；run #8 结论已记录在第二十轮 DONE。已 `DROP DATABASE lightchoice_radar_r20_ci`（无通配符/批量）；`lightchoice_radar` / `lightchoice_radar_test` / `postgres` 三个保护库完好 |
| ~~AMZ123 线索在站点前台不可见~~ **（第二十二轮已解决）** | 线索仍**不写 publication、不进公开池**（这一点保持不变），但新增了独立的只读入口：`http://127.0.0.1:3000/leads`（列表）与 `/leads/<id>`（详情），数据来自 `/api/site/leads*` 的白名单元数据。`/items/<id>` 对这些线索仍返回 404——**这是有意的**：它们不是正式情报条目。 |
| 线索页没有分页与搜索 | 列表一次最多返回 100 条（`LIST_LIMIT`），按报道日期倒序；当前只有 3 条，不需要分页。线索量增长后要另立任务，本轮不提前实现。 |
| 线索页的公开可读性 | `/leads` 与 `/api/site/leads*` 沿用站点现有的公开读取方式（本机 3000/3001，无登录），只暴露白名单元数据（标题、短摘要、日期、核实状态）。**未加登录**——若将来对外网开放，需要先决定访问控制。 |
| 本机 fake-ip 路由失效（**环境问题，非代码**） | FlClash 的 DNS 劫持让所有域名（含直接问 `223.5.5.5`）都返回 fake-ip `198.18.0.31`，而路由表里 `198.18.0.0/24 → 192.168.1.1 WLAN` 遮蔽了本该走 TUN 的 fake-ip 段 → 直连 fake-ip 的 TCP 443 超时；真实 IP `43.139.254.31` 直连正常，系统代理 `127.0.0.1:7890` 正常（0.12s）。无管理员权限 → 改不了 hosts、改不了路由。**绕过办法（已验证）**：Node 侧预加载一个仅诊断用的 DNS 补丁，把 `dns.lookup('www.amz123.com')` 指向真实 IP；**项目代码、SSRF 门禁、采集逻辑全部不变**，页面仍来自真实站点。**本轮未改系统配置、未改项目源码**，该补丁不在项目源码树内 |

## BLOCKERS

1. **Windows 控制台退出与进程存活**：`radar-ops start` 用 `spawn(detached)` 后台启动；在本 Agent 的作业对象里，父进程一退出子进程就被回收（实测），在普通终端里通常能存活，但这取决于 Windows 控制台/作业对象。**长时间运行请用前台方式**（`cd apps/worker && npm run daemon:ads-policy`）或把 `start` 放在一个不会关闭的终端里。
   - **2026-10-24 修正（实测细化）**：无控制台的 detached Node 服务（API/Worker）已实证可跨命令、跨会话轮次存活（API pid 27008 自 10-23 23:55 存活至今，跨多次会话操作）；10-23 13:30「整会话结束全部被回收」的证据仍在，**重启电脑 / 彻底退出宿主后的存活仍未重新验证**，维持「需观察」。
2. **大量既有数据库测试与本部署不兼容（非本轮引入）**：`content-publication`、`invalid-dates`、`source-external-identity`、`collection-body-preservation` 等文件按付费模型路径或非 RSS 采集编写，在本租户的 rule-only + 「拒绝未批准非 RSS 来源」门禁下返回 `skipped` 或 "Paid provider requests are disabled in LightChoice Radar mode"。本轮只跑与改动相关的定向用例（见 DONE）。
3. **PostgreSQL 在本机反复崩溃（环境问题，非本轮代码所致）**：后台 server process 多次以 `0xC0000142`（STATUS_DLL_INIT_FAILED）终止，导致 `database system is shut down`（14:28:59、14:32:39、14:48:59 三次），客户端表现为 ECONNREFUSED / ECONNRESET；崩溃期间 Web 3000 曾瞬时 503（SSR 上游 API 取不到数据），PG/API 恢复后自动回到 200。**有效恢复方式**：`Start-Process postgres.exe -ArgumentList @('-D','D:/Workspace/LightChoiceRadarRuntime/pg/data','-p','5544')`——**不要用 `pg_ctl start`**（在本机会挂起并因日志文件争用报 sharing violation，延迟约 30 秒且命令不返回）。
   - **2026-10-24 修正**：上文的 `Start-Process postgres.exe` 直启与任何 detached 直启方式**已被证明会触发 Windows Terminal 弹窗故障**（postmaster 无控制台 → 每条数据库连接弹一个可见窗口，见 DONE「P0 紧急故障修复」）。**当前唯一推荐的数据库启动方式是 `start-radar.cmd`**（`radar-local.ts` 的 `CREATE_NO_WINDOW` 独立隐藏控制台包装）；本条原文仅作历史保留。手工恢复前必须先确认控制台继承与进程生命周期，不得复用会弹窗的 detached 模式。
4. **本机 fake-ip 路由失效（环境问题，非代码）**：代理软件的 DNS 劫持让所有域名（含直接问 `223.5.5.5`）都返回 fake-ip `198.18.0.31`，而路由表把 `198.18.0.0/24` 指向 WLAN，遮蔽了本该走 TUN 的 fake-ip 段 → 直连 fake-ip 的 TCP 443 超时；真实 IP 直连正常、系统代理 `127.0.0.1:7890` 正常。**影响**：任何走 Node `fetch` 直连的出网探测会超时（PowerShell `Invoke-WebRequest` 与 `curl.exe` 不受影响）。**绕过**：Node 侧预加载仅诊断用的 DNS 补丁把解析指向真实 IP，项目代码与 SSRF 门禁均不变。**本轮未改系统配置**——改 hosts / 路由需要管理员权限。详见 NOT_DONE 同名条目

## 运行环境事故与恢复（2026-10-23 00:11）
- **2026-10-23 14:30–15:00 补充（第十八轮）**：本轮期间 PostgreSQL(5544) **三次崩溃**（14:28:59 / 14:32:39 / 14:48:59），后台 server process 以 `0xC0000142`（STATUS_DLL_INIT_FAILED）终止，客户端报 ECONNREFUSED / ECONNRESET；崩溃期间 Web 3000 瞬时 503（SSR 上游 API 失败）。恢复方式见 BLOCKERS 第 3 条（`postgres.exe` 直启）。PG/API 恢复后 3000/3001 自动回到 200。**属本机环境问题，非第十八轮代码所致**。
- **2026-10-23 13:30 补充（第十七轮）**：本轮开工时 PostgreSQL(5544)、Web(3000)、API(3001) **均未运行**（会话结束时进程被回收，与 00:11 那次同类）。按本文件「当前运行基线」拉起 PG 与 `radar-ops start web`（API pid 45428 / Web pid 35040）后 3000/3001 均正常；**约 30 分钟后 Web 进程再次消失（pid 35040 DEAD，3000 不再监听，API 仍存活）**。原因与 BLOCKERS 第 1 条一致：本 Agent 作业对象关闭时 detached 子进程被回收。
  - **注意 `radar-ops start web` 的行为**：它对 web/api 做「全有或全无」判定——`probe(web)` 与 `probe(api)` 任一存活即拒绝启动（`scripts/radar-ops.ts:176-181`）。因此 API 存活而 Web 掉线时，**该命令无法单独补起 Web**，需要按「当前运行基线」里的 Web 启动命令单独拉起（cwd=`apps/web`，`API_BASE_URL=http://127.0.0.1:3001`，`node ../../node_modules/@react-router/dev/bin.cjs dev --port 3000 --host 127.0.0.1`）。本轮已用该方式恢复：Web pid 29652 监听 3000，3000 首页与 `/all?source=amazon-us-announcements` 均 200、3001 `/api/site/meta` 200。
  - 该行为属既有实现，非本轮引入；本轮只记录事实，**未改动 `radar-ops.ts`**。
- **现象**：开发库 `127.0.0.1:5544`、API 3101、Web 3100、专用 Worker 31592 在同一分钟内全部退出；postgres 日志停在 `00:10:55 could not receive data from client`，没有 shutdown 记录，属于进程被外部结束（与前一轮会话结束时后台进程被回收一致），不是数据库故障。
- **恢复**：用 `D:\Workspace\LightChoiceRadarRuntime\postgresql-17.11\pgsql\bin\postgres.exe -D D:/Workspace/LightChoiceRadarRuntime/pg/data -p 5544` 重新拉起，自动 crash recovery 后 `database system is ready to accept connections`；数据完整（20 条新记录、`publications` 123 条都在）。随后在 00:15 拉起 API（`API_PORT=3101`）、00:17 拉起 Web（`API_BASE_URL=http://127.0.0.1:3101`，`react-router dev --port 3100`）、00:19 用计划任务拉起专用 Worker（PID 44184，已持有 advisory lock，调度轮询 00:21 恢复）。
- **注意**：这些进程是本轮会话拉起的，会话结束可能再次被回收；下一轮开始前先按上面的命令检查并恢复，不要重复启动第二个 Worker。
- **2026-10-23 00:34 再次发生**：计划任务启动的 Worker（PID 44184）在 00:34 后消失，计划任务记录 `LastTaskResult=0xC000013A`，advisory lock 随之释放。00:37 手工重启为 **PID 46476**（带日志 `.data/_diag/worker-regulatory.log`），锁已重新获取，四条队列正常；本次改动（监管调度）在这台实例上验证通过。当前持锁者：PID 24900 的保留连接（backend pid 43000，01:11:41 建立）。
- **切换到第五轮代码的最小安全操作**：先确认 `pgboss.job` 无 `active`、`job_runs` 刚跑完一轮（每分钟 :19–:25 之间不切换）；然后停止 PID 46476（无活动任务时 `taskkill /PID <pid> /F` 即可，Windows 下 SIGTERM 不可达），用计划任务 `LightChoiceRadar-Amazon-US-Announcements-Monitor` 或手工 `node --env-file-if-exists=../../.env src/radar-announcements.ts` 重启；重启后核对：advisory lock 被新进程持有、启动日志 `subscribedQueues` 只有四条私有队列、`skippedSources` 为空、下一分钟 `job_runs` 恢复。

## 当前运行基线（2026-10-23 19:10）
- **唯一正式环境**：Web `http://127.0.0.1:3000`、API `http://127.0.0.1:3001`，指向开发库 `lightchoice_radar`（**129 篇文章**，`schema_migrations` **已到 0090**，`article_revisions.excerpt` 已存在）。3100/3101 已停用。
- **新入口**：政策线索 `http://127.0.0.1:3000/leads`（详情 `/leads/<id>`），状态条读 `sources` + 实例锁 + 最新 `fetch_runs`。
- **数据库启动方式（2026-10-24 修正，当前唯一推荐）**：`start-radar.cmd`——`scripts/radar-local.ts` 经 .NET `CREATE_NO_WINDOW` 以独立隐藏控制台启动 postmaster。**不要**再按下面的历史命令直启 `postgres.exe` 或 `Start-Process`——会复发「每条数据库连接弹一个 Windows Terminal 窗口」的故障（见 DONE「P0 紧急故障修复」）。
- **数据库**：`D:/Workspace/LightChoiceRadarRuntime/postgresql-17.11/pgsql/bin/postgres.exe -D D:/Workspace/LightChoiceRadarRuntime/pg/data -p 5544`（历史记录，2026-10-23 19:10 的直启命令，已过时）。库：`lightchoice_radar`（开发，20MB）、`lightchoice_radar_test`（测试模板，11MB）、`postgres`（系统库）。第十九轮两个 r19 隔离库与第二十轮的 `lightchoice_radar_r20_ci` **均已按精确名删除**。
- **备份**：`D:\Workspace\LightChoiceRadarRuntime\backups\lightchoice_radar-pre0090-r21-20261023-183114.dump`（970,722 字节，sha256 `6caf18d4…a26991`，`pg_restore -l` 可读）。恢复示例：`pg_restore -d <目标库> <dump>`；该目录在仓库外，不进 Git。
- **进程**：API（`API_PORT=3001 node --env-file=.env apps/api/src/main.ts`）、Web（`cd apps/web && API_BASE_URL=http://127.0.0.1:3001 node ../../node_modules/@react-router/dev/bin.cjs dev --port 3000 --host 127.0.0.1`）。也可用 `node --env-file=.env scripts/radar-ops.ts start web`。**第二十二轮改过 API 代码，必须重启 API 才会加载新端点。**
- **Worker**：**两个必要 Worker 均在运行**（R26 起为日常常态）：AMZ123 专用线索 Worker（锁 003，两条私有队列）与公告/监管 Worker（锁 001，六条专属队列：公告/费用/监管各调度+抓取）。Ads 仍关闭（锁 002 空闲）。两者都由 `start-radar.cmd` 统一补起，操作入口统一为 `scripts/radar-ops.ts`（status/start/stop），详见「运行与恢复手册」。

## 第一主线 V1 收口判断（2026-10-23 06:25）

| 条件 | 结论 | 依据 |
|---|---|---|
| 官方公告采集链路正常 | 达成 | 开发库公告源 `health=ok`，本轮真实采集 `found=11 / created=1`，二次 `created=0` |
| Ads 采集与独立调度具备可控运行能力 | 达成（默认关闭） | 独立进程 + 开关 + 频率 + 看门狗 + 单实例 + 退避；隔离库首跑 2 条、二次 0 条，强杀恢复与失败恢复均实测 |
| 去重、修订、日期语义正确 | 达成 | `ads-policy-persist` 4/4、`source-updated-timeline` 6/6、`publication-date-correction` 17/17；Ads 记录仍 `published_at=null`、`source_updated_at` 独立 |
| 失败可识别、可记录、可按现有机制恢复 | 达成（Ads 路径实测；公告/监管沿用既有结论） | 浏览器不可用 → `fetch_runs` failed + `health=degraded` + `next_fetch_at` 前进 + 无脏数据；恢复后 `health=ok` |
| 登录失效时安全停止并合法恢复 | 不适用（且已隔离） | Ads 页面公开、无登录态；登录墙/门户/404 被门禁拒绝；Seller Central 由 robots 拒绝 |
| 已验证/未验证来源明确区分 | 达成 | `source-check-round11.json` 逐条列出 6 个候选与结论 |
| 政策数量与限制如实记录 | 达成 | 平台政策 3 条（2 条列表可见）、Ads 2 条、监管 20 条；公开供给只有两条入口 |

**结论：第一主线达到 V1 收口条件。** 覆盖数量的天花板来自 Amazon 公开供给本身（公告博客 + sellingpartners），不是采集能力缺口；后续不再为凑数放宽分类或恢复人工录入。

## 第一主线 V1.1 运行可靠性判断（2026-10-23 07:05）

| 条件 | 结论 | 依据 |
|---|---|---|
| Ads 进程异常退出后有真实可用的重启机制 | **达成（本轮新建）** | `supervisor.ts` + `ads-policy-daemon.ts`；真实子进程 9/9；真实调度进程：失败→重启→再失败→止损 exit 1；开关关闭/来源停用不重启 |
| 公告与外部监管 Worker 崩溃恢复真实验证 | **达成** | 隔离库植入遗留记录 → 启动只收口自己的 4 条、保留他人 job → 随后真实采集 22 篇；`tests/worker-recovery.test.ts` 5/5 |
| 公告漏读修复的关键边界有证据 | **达成** | `tests/policy-gate-memory.standalone.test.ts` 8/8（版本、损坏游标、窗口、上限） |
| 失败可诊断 | **达成** | 退出码 0/2/3/1 + `failureClass` 七类 + 健康/重试数学实测 |
| 运行方式明确 | **达成** | 见下方「运行与恢复手册」 |
| 同一 Ads Worker 不并发 | **达成** | advisory lock（角色 `ads-policy`），第二实例退出 0 |
| 浏览器不进 API/Web/公告 Worker | **保持** | Playwright 只在 `ads-policy.ts` 子进程内动态导入 |

**结论：V1.1 运行可靠性目标达成。** 唯一保留的是部署动作（系统服务/开机自启）与「在开发库真正启用 Ads 采集」，两者都按边界留给部署方。

## 第一主线 V1.2 运行操作判断（2026-10-23 07:55）

| 条件 | 结论 | 依据 |
|---|---|---|
| Windows 下正常停止 | **达成（真实演练）** | 采集中途停止：跑完当前采集再退出（40.6s，`created=2`）；子进程退避睡眠中停止：1.2s；监督器自身退避中停止：1.2s；`worker-control` 9/9 |
| 启动/停止/状态可操作 | **达成（第十四轮修好 `start web`，第十五轮加 OS 可用性显示）** | `scripts/radar-ops.ts` 三个子命令；`status` 覆盖 8 个运维问题并显示「强杀身份校验（OS 级）可用/不可用」；实测重复启动被拒、隔离端口 `start web` 真实启动成功 |
| 避免重复进程与误杀 | **达成（第十六轮：句柄绑定终止）** | advisory lock + 心跳 + OS 命令行/创建时间 + 句柄绑定四重校验；`--force` 任何一步不符即拒绝（实测拒绝，未误杀 API）；无裸 PID 强杀路径 |
| Ads 仍默认关闭 | **达成** | 来源 `enabled=false`、开关未设；`start ads` 双门禁 |
| 公告 Worker 恢复/任务状态回归 | **达成（沿用+复跑）** | 收口逻辑未改，`worker-recovery` 5/5；本次仅新增停止通道 |
| 3000 验收 | **达成** | 公告/Ads 列表与详情、标签筛选、刷新、0 pageerror |
| 运行限制 | 已记录 | 后台 detached 存活受 Windows 作业对象影响（建议前台常驻）；公告 Worker 的「停止时正在采集」未演练；进程身份为自证心跳 |

## 运行与恢复手册（运维用）

**Ads 采集（默认关闭）**
1. 启用来源：`UPDATE sources SET enabled=true WHERE id='ads-policy-pages'`。
2. 启动：`cd apps/worker && RADAR_ADS_POLICY_ENABLED=1 npm run daemon:ads-policy`（内部以监督模式运行 `ads-policy.ts`）。
3. 停止：`Ctrl+C`（SIGTERM/SIGINT 会转发给子进程；Windows 下子进程被直接终止，锁随连接关闭释放）。
4. 只看一轮不常驻：`RADAR_ADS_POLICY_ENABLED=1 RADAR_ADS_POLICY_ONCE=1 npm run monitor:ads-policy`。
5. 调参：`RADAR_ADS_POLICY_INTERVAL_MINUTES`（360）、`RADAR_ADS_POLICY_TIMEOUT_MINUTES`（15）、`RADAR_SUPERVISOR_INITIAL_DELAY_SECONDS`（30）、`RADAR_SUPERVISOR_MAX_DELAY_SECONDS`（1800）、`RADAR_SUPERVISOR_MAX_FAILURES`（6）、`RADAR_BROWSER_CHANNEL`（chrome）。

**公告/监管 Worker**：`cd apps/worker && npm run monitor:amazon-announcements`；停止用 `Ctrl+C`，或另一个终端执行 `node --env-file=.env scripts/radar-ops.ts stop announcements`（请求文件，无需信号）。重启时它会自动收口自己范围内的遗留运行记录。

**AMZ123 线索 Worker（第十九轮新增，专用；第二十轮复核通过）**
- **启动**：`cd apps/worker && npm run monitor:amz123-leads`（**前台**运行）
- **状态**：`node --env-file=.env scripts/radar-ops.ts status`（看「线索 Worker」行），或直接打开 `http://127.0.0.1:3000/leads` 看顶部状态条（第二十二轮新增；它读同一个实例锁）
- **停止**：`node --env-file=.env scripts/radar-ops.ts stop leads`（请求文件，无需信号）
- **看线索**：`http://127.0.0.1:3000/leads`（有效候选 / 已排除 / 全部），详情 `/leads/<id>`；只读白名单元数据，不含正文。
- 它**只**注册并消费 `cron.radar.amz123-leads.schedule` 与 `sources.fetch-amz123-leads` 两个队列，**不注册任何官方队列**，因此启动它不会采集公告、监管或 Ads 来源。采集频率固定 360 分钟（取自 `sources.interval_minutes`），调度 tick 每分钟检查 `next_fetch_at` 是否到期。
- **运行前提（务必知悉，不要按「服务已就绪」理解）**：
  1. **前台进程必须保持终端打开**。关闭终端、断开远程会话或退出会话，采集可能随之停止；后台方式 `radar-ops start leads` 的 detached 进程在作业对象关闭后会被回收（见 BLOCKERS 第 1 条）。本轮**未安装系统服务、未配置开机自启、未改 Windows 计划任务**。
  2. 因此**不能把它称为「全天候无人值守服务」**。它的真实语义是「保持终端运行 → 每 6 小时自动采一轮」。需要长期无人值守，必须由部署方另行托管（systemd / pm2 / 计划任务等），本仓库不提供这些。
  3. 停止必须走上面的 `stop leads`（或前台 `Ctrl+C`）；直接杀进程虽然会因连接断开释放实例锁，但会留下 `running` 状态的遗留记录（下次启动时由该 Worker 自动收口）。

**统一操作入口**（只读状态 / 显式启动 / 受控停止）
- 状态：`node --env-file=.env scripts/radar-ops.ts status`（不动任何进程与数据）
- 启动：`... start web`（可用 `--port=3200 --api-port=3201` 在隔离端口演练，默认 3000/3001）、`... start announcements`、`... start leads`（AMZ123 专用 Worker，第十九轮新增）、`... start ads`（四个独立命令，不会互相牵连；`start ads` 需要开关和来源都打开，且监督进程不能已在运行）
- 停止：`... stop ads`、`... stop announcements`、`... stop leads`（默认等 180s；成功条件＝采集进程与监督进程都已退出、实例锁释放。仍不退出时打印 PID 与手工命令；`--force` 先停监督进程再停采集进程，身份核验与终止**通过同一个进程句柄**完成——OS 命令行、创建时间、句柄创建时间、记录启动时间四重一致才终止，任何不符或无法确认都拒绝）
- 后台启动的工作目录：第十九轮把 `startDetached` 的默认 `cwd` 固定为项目根目录，`.env` 的相对路径因此始终命中（此前从别处启动会静默打印 `.env not found`）
- 进程身份：以 advisory lock 为准；`status` 同时显示运行记录里的 pid（仅供人工核对）

**怎么看状态**
- 任务有没有跑：`job_runs`（`radar.ads-policy.collect`、`radar.amazon-announcements.schedule`、`radar.regulatory.schedule`）；抓取细节：`fetch_runs`（`status`、`found_count`、`new_count`、`error`、`detail->>'failureClass'`）。
- 为什么失败：`sources.last_error` + `fetch_runs.detail->>'failureClass'`（browser-unavailable 装浏览器/换 channel；page 页面结构变了；source-http 站点返回错误状态；network 网络/解析；blocked-address 配置指向内网；budget 付费额度；unknown 看 error 原文）。
- 会不会重试：成功按 `interval_minutes`；失败 `next_fetch_at = now + interval×(fail_count+2)`（上限 360 分钟）；Ads 进程内另有 1→2→4 倍退避，监督器再按 30s→…→30min 重启，连续 6 次停止。
- 要不要人工：`health=failing`（连续 5 次失败）、监督器 `exit 2/3`、`failureClass` 为 blocked-address/page 时需要人。
- 怎么安全恢复：修配置或页面 → 重启 Worker/监督器；遗留的 `running` 记录在下次启动时自动标为 failed，无需手工改库。

## Git 收口（R50 只读盘点，未执行任何写操作）

| 项 | 实测 |
|---|---|
| 分支 / HEAD | `master` / `e7ae89923fac178d450da6e82e6d99439f3332ee`（2026-10-21 21:09 docs: define LightChoice Radar roadmap and agent rules） |
| 工作区 | **50 个已跟踪修改 + 72 个未跟踪 = 122 项**（R49 记录为 117；本轮新增 `scripts/radar-translate-state.ts`、`tests/translate-run-state.test.ts`、`tests/worker-translate-isolation.test.ts` 改动、三个 `.cmd`、两份文档与 `.data/_diag/r50/*` 诊断件） |
| `.env` | **未被 Git 跟踪**（`.gitignore` 第 1 行 `.env`、第 2 行 `.env.*`、例外 `.env.example`） |
| 密钥泄漏扫描 | 已跟踪 diff 与 72 个未跟踪源码/脚本/配置里**未发现**硬编码密钥（仅测试用 `test-key` / `test-secret` 之类占位值）；`.data/` 与 `.env` 均被忽略，不会进入提交 |
| 大文件 / 截断 | 未跟踪项中无 >1MB 文件；唯一 0 字节文件是 `listing-urls.txt`（临时文件，建议忽略或删除） |
| 覆盖冲突 | 未发现被覆盖或截断的源码文件；本轮只改 3 个脚本 + 1 个既有测试 + 3 个 `.cmd` + 2 份文档，新增 1 个脚本与 1 个测试，未触碰他人未提交修改 |
| `docs/radar/` 跟踪状态 | **整个目录未被 Git 跟踪**（`?? docs/radar/`）——CURRENT.md 与《本地运行说明》的多轮修改因此从未进入提交；提交时必须显式决定是否纳入 |
| 写操作 | **无**（未 add / commit / push / merge / reset / clean / rebase） |

**建议的安全提交范围（需用户单独授权后再执行）**：分两次提交，避免把诊断产物混进源码历史——

1. `docs/radar/CURRENT.md`、`docs/radar/本地运行说明.md`、`README.md`（文档归一）；
2. `scripts/radar-local.ts`、`scripts/radar-ops.ts`、`scripts/radar-translate-state.ts`、`scripts/process-start.ts`、`start-radar.cmd`、`status-radar.cmd`、`stop-radar.cmd`、`tests/translate-run-state.test.ts`、`tests/worker-translate-isolation.test.ts`、`apps/worker/src/{main.ts,schedules.ts}`、`packages/backend/src/{jobs/content.ts,editorial/*,publication/*,sources/*}` 等本轮实际改动文件。

**不要提交**：`.env`、`.data/`（含 `.data/run`、`.data/_diag`）、`listing-urls.txt`。完整清单见 `.data/_diag/r50/git-inventory.txt`（不入 Git）。

**可回滚方案**：提交前 `git stash push -u -m r50-wip` 可整包保存；提交后用 `git revert <sha>` 回滚单次提交。两者都不影响未授权的其他工作树改动（本仓库只有一个工作树，无并行 Agent 写入记录）。

## NEXT（可直接执行）

**R50 的后续（按依赖排序，均需各自授权）**

- A. **批准新的付费预算窗口并启用常驻翻译**：当前窗口 `r49-formal` 上限为 **0 次 / ¥0.1976**（任何请求都会在发送前被拒）。启用步骤已完备：用户单独批准新窗口（`scripts/radar-translate-sample.ts --round <名> --max-requests N --max-articles N --budget 元`，上一轮整轮归档、历史费用不清空）→ 双击 `start-radar.cmd translate`。回滚：`stop-radar.cmd translate`（只停翻译，采集继续）。
- B. **自然周期观察**：授权后用真实运行观察至少 24 小时——重点看 ① 是否有自然新增官方文章被自动译成中文；② `待处理文章` 是否被消化；③ 预算计数与 `receipts` 是否一致；④ 跨会话/重启后常驻是否存活（本环境有「作业对象回收后代进程」限制，见 BLOCKERS 1）。
- C. **Git 恢复点**：工作区 119 个改动尚未提交。建议的最小可回滚检查点范围见下节「Git 收口（R50）」；提交动作需用户单独授权。

**R48 的后续**

- A. ~~**正式启用自动翻译（原手工命令）**~~ **（R50 已改为 `start-radar.cmd translate`，见上）**：手工命令 `COLLECT_ENABLED=false RADAR_TRANSLATE_ENABLED=true node apps/worker/src/main.ts` **不再推荐**（会注册无关定时任务并重评估历史文章）。
- B. ~~自然周期观察~~ 合并到上面 R50-B。
- C. **其余 15 篇的中文政策解释**：需对目标集合跑 `analyzeArticle`（会重写 publication），建议先 ≤5 篇小样本验证发布资格与三类统计不变。

**R47 的后续（按依赖排序，均需各自授权）**

- A. **其余 15 篇的关键信息**：它们没有 rule 解释记录；要生成必须对目标集合跑一次 `analyzeArticle`（会重写 publication）。建议下一轮先小样本（≤5 篇）验证发布资格与统计不变，再决定是否扩大。
- B. **结构化字段增强**：召回数量/补救措施/适用范围目前只能从摘要逐字提取；若要更稳，需要在采集层把 RSS/官方页面的结构化字段落库（属采集扩展，需单独授权）。
- C. **持续付费翻译启用**：需使用者单独授权 + 主 Worker 运行；启用步骤与月费用情景见上表。

**R46 的后续（按依赖排序，均需各自授权）**

- A. **关键信息补强（需数据侧决定）**：当前 `PolicyExplanation` 没有结构化的「适用对象 / 金额 / 生效时间」字段（`appliesTo` 是泛化句，日期差异 0 条，变化表述均为泛化句），所以「关键信息」区块多数文章不渲染。要真正按文章类型填字段，需要在 `policy-explain.ts` 增加可引用的结构化输出并重跑 8 篇白名单解释（成本 0，属派生数据重写），或由人工整理——不建议在前端从英文句子里抽取。
- B. **召回类要素抽取（不建议）**：商品/危险/处理措施目前只能靠速读与摘要呈现；前端抽取英文摘要容易出错，需在采集或规则层落结构化字段后才做。
- C. **线索页阅读长度**：AMZ123 已匹配线索仍约 1700px（主张 9 条 + 证据引文），可按主张合并同类项进一步压缩（需人工确认哪些主张可合并）。

**R45 的后续（按依赖排序，均需各自授权）**

- A. **覆盖率补齐（需新的额度授权）**：还有 15 篇官方条目没有中文标题。继续用同一工具限额推进：`RADAR_TRANSLATE_ENABLED=true node --env-file=.env scripts/radar-translate-sample.ts --ids <id,…> --apply`（每篇标题+摘要约 2 次请求、≈¥0.003，累计仍受 `RADAR_TRANSLATE_MAX_*`/`RADAR_TRANSLATE_BUDGET_CNY` 约束；要扩额度需显式改环境变量并重算预算，不要手改 `settings.translate.budget`）。
- B. **正文中文阅读（需产品决定）**：六来源 `site_fulltext=false`；开放正文展示属来源展示依据变更，须先确认法律/授权边界，再单独改配置。正文翻译器已在隔离库验证可用（`tests/translate-body-isolated.test.ts`）。
- C. **正式自动增量（需两项同时满足）**：使用者授权持续付费 + 主 Worker 运行（`apps/worker/src/main.ts`）。启用步骤：设 `RADAR_TRANSLATE_ENABLED=true` → 启动主 Worker（同时会开始消费通用 `sources.fetch`，两个社区 RSS 来源会重新采集）→ 首次运行写 `settings.translate.baseline`，只处理此后新文章（每轮 ≤3、每日 ≤12）。回滚：删掉该环境变量并重启主 Worker。
- D. **主 Worker 恢复（需授权）**：恢复后新入库官方文章会走 `content.sweep → analyze` 自动生成 `radar-explain-v1` 解释（无需迁移、无需新队列）。
- E. **人工语义核对（可选）**：对已译 8 篇做逐句人工核对并把结论写进本文件；自动校验只覆盖数字/编号/长度。
- F. **测试夹具小修（可选）**：给 `tests/page-metadata.standalone.test.ts` 的夹具 API 补 `/api/site/pool/sources`（返回 `[]`），即可恢复 3 例页面测试。
- G. **隔离测试运行方式**：本环境 `.env` 关闭模型调用，直接 `npm test` 会继承该值；用 `node --env-file=.env .data/_diag/run-tests.mjs [--standalone] <files…>`（只取 DATABASE_URL、指向 `*_test` 模板、其余环境保持 `npm test` 语义）。翻译链路测试需额外前缀 `RADAR_TRANSLATE_ENABLED=true`。

1. **（日常使用，唯一入口）双击 `start-radar.cmd`**——它会按顺序补起数据库 / API / Web / AMZ123 Worker / 公告监管 Worker（五步），已在运行的跳过；查看状态 `status-radar.cmd`（含两个 Worker 与官方五来源最近采集），停止 `stop-radar.cmd`（两个 Worker 优雅停止、Web/API 身份核验后结束、数据库保留）。说明见 `docs/radar/本地运行说明.md`。**未安装开机自启**：电脑重启后需要再双击一次；需要登录自动启动须用户单独授权后配置计划任务。**会话结束后是否存活未验证**（本环境作业对象会回收后代进程），用户在自己的 cmd 窗口内运行不受影响。2026-10-24 补充：PostgreSQL 一律由该入口（`radar-local.ts`，CREATE_NO_WINDOW 独立隐藏控制台）启动；**不要**用 postgres.exe 直启 / `Start-Process` / detached 方式拉起数据库——已证明会导致每条数据库连接弹一个 Windows Terminal 窗口（见 DONE「P0 紧急故障修复」与 BLOCKERS 3 修正注记）。
2. （AMZ123 后续可选改进，**需单独授权**）第二十轮已把误收/漏收修在 **AMZ123 专属准入层**，共享规则 `radar-rules.ts` 未动。剩余可选项：① 列表页翻页（当前只取首屏链接，靠 sitemap 归档覆盖兜底）；② 扩展专属准入层的词面覆盖更多中文表达（**改共享规则会影响官方来源判定，需单独授权**）。~~③ 让漏收样本 `t/zDrc37rW` 真正入库~~ **第二十一轮已完成**。
3. ~~（需用户授权）开发库执行 0090 迁移~~ **第二十一轮已完成**：`schema_migrations` 已到 0090，`article_revisions.excerpt` 已建，回填 127 条、0 冲突。**仍未授权**的是清理历史那条 27 字符摘要（在 `article_revisions.body_text`）。
4. ~~官方发现入口改用月度 sitemap~~ **R27 已完成验证并决定不接入**：授权窗口（约 13 个月）内 sitemap 仅 8 个公告 URL 且全部 ⊆ 列表页 11 个（独有 = 0），月度文件滞后（latest 为空）、历史覆盖也比列表稀疏——**零增量，现有列表页就是更优发现面**。若未来 Amazon 恢复完整收录公告文章，可重新评估。~~`federalregister.gov` 列表页现返回 "Request Access"，应改用其公开 API~~ **R25 修正：两个联邦公报源本就配置为官方 API 端点且工作正常，无需切换**。
5. （仅当未来启用 Ads 时的部署方选项，**不是日常 Radar 的启动方式**）Ads 常驻：在专用终端跑 `cd apps/worker && npm run daemon:ads-policy`（前台、日志可见），或自行用 systemd/pm2 托管；本仓库不提供服务文件、不设开机自启。**日常启动/状态/停止一律用 `start-radar.cmd` / `status-radar.cmd` / `stop-radar.cmd`（Ads 不在其中，保持默认关闭）。**
6. （可选）启用 Ads 采集：先 `UPDATE sources SET enabled=true WHERE id='ads-policy-pages'`，再以 `RADAR_ADS_POLICY_ENABLED=1` 启动；先看一轮 `radar-ops status` 的 `fetch_runs`/`job_runs`。
7. ~~公告 Worker 的「停止时正在采集」可在下次真实运行时观察~~ **R25/R26 已实测**：`radar-ops stop announcements` 两次优雅停止（锁正常释放、队列排空），`start announcements` 受控恢复正常。
8. （可选，独立授权）交付证据生成器已可用：`node --env-file=.env scripts/generate-amz123-delivery-evidence.ts --expect-no-worker --out docs/radar/<新名>.json`。它**只读数据库**（REPEATABLE READ, READ ONLY 事务），11 项验收全过则退出码 0，失败退出码 2（不伪造成功）；默认输出名按北京时间日期，已存在则拒绝覆盖，`--force` 可重生成同名。
9. 既有失败与本轮无关：第二十轮按边界**只跑定向套件**（AMZ123 相关 43/43、官方来源链路 51/51、四个 tsconfig 全部 exit=0），**未跑无关全量测试**。第十八轮记录的全量基线仍为 339 项中 333 通过、6 失败（`outbound-protocol` 本机**缺 openssl**、`page-metadata` 本地站点夹具 404），二者都不 import 本轮任何模块。
