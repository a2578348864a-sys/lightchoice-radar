# LightChoice Radar 情报中心

**面向个人跨境电商商品研究与产品开发决策的公开情报中心。**

本仓库是这套情报中心的长期产品目标、业务主线与路线图的**唯一入口**。工程规则、Agent 协作边界见 [AGENTS.md](AGENTS.md)；技术细节见 [docs/](docs/)。

---

## 1. 项目定位

**服务对象**：以个人身份做亚马逊美国站（及后续可验证的其它跨境电商市场）选品、产品开发与改进决策的人。

**它要做的事**：

- 收集**公开**信息（官方公告、行业媒体、公开社区、公开评论等），保留来源、时间与可核查证据。
- 把信息整理成**需求线索**：用户抱怨、功能缺失、替代需求、新品提及、竞争变化。
- 为"要不要做某个产品/改进某个产品"提供可回查的判断材料，而不是替人拍板。

**它明确不做的事**：

| 不做 | 原因 |
|---|---|
| 亚马逊全站爬虫、全量评论抓取 | 这是情报线索系统，不是数据抓取农场；也避免违反平台条款 |
| 把关键词命中直接当成市场结论 | 关键词出现次数不等于需求规模、竞争格局或可做性 |
| 销量推算、BSR 预测、自动选品 | 缺少可验证的公开数据支撑，属于过度承诺 |
| 绕过平台限制的采集（代理池、验证码绕过、登录态爬取） | 合规红线，见 [§8](#8-边界与合规) |
| 用付费模型/付费数据服务替代规则 | 零新增付费是硬约束，见 [AGENTS.md](AGENTS.md) |

**与 DSH 的关系**：**网页工作台（Radar Web）是当前主要使用入口**。DSH / MCP 集成保留已有能力，但**已暂停**，不作为验收条件，也不影响网页侧的使用。Radar 本身保持独立、可单独运行的情报引擎，不因"集成"而被改写。已有集成方式见 [§6.4](#64-在-dsh-里查询情报)。

---

## 2. 四条核心业务主线（严格按顺序推进）

业务主线是**产品能力的推进顺序**，不是功能清单。**必须按 1 → 2 → 3 → 4 的顺序推进**：前一条达到"可用、可验证"的验收标准后，才进入下一条。

- 后续主线**可以提前做调研**（读官方文档、找公开信源、验证可行性），但**不得因此打乱当前开发顺序**，也不得提前接入采集、写页面或改数据结构。
- 任何"顺手把后面主线一起做了"的改动，视为范围扩大，需要先回到顺序本身确认。

### 主线 1：平台政策（当前优先）

**目标**：跟踪亚马逊官方公告、费用变更、合规要求、分仓/物流政策、账号与招商政策，及时提示对个人卖家的实际影响。

**验收标准**（达到才算可用）：

1. 至少 1 个**官方公开**来源（官方公告页/官方博客/官方帮助中心）稳定入库，不依赖登录态。
2. 每条记录保留：原文标题、官方原文链接、官方发布时间、本地收录时间；缺失值如实留空，不猜。
3. 可按政策类型（费用 / 合规 / 物流分仓 / 账号 / 其它）筛选或打标。
4. 抽检 10 条，标题、时间、链接与官方原文一致率 100%；不允许把自媒体转述当成官方政策。
5. 来源失效、页面改版、连续抓取失败时**能被发现**（来源状态可见，不静默失败）。

**当前状态：进行中。** Amazon 美国站费用公告与 Amazon Selling Partners 的 Accelerate 公告仍保留在库。2026-10-22 已用项目自己的 Node 采集器修复并验证 Amazon Sell on Amazon 官方公告列表：英文地区参数下 HTTP 200，列表使用 `.PagePromoC` / `.PagePromo-title` / `.PagePromo-date` 结构；旧 `.PageList-items-item` 选择器已失效。当前 `amazon-us-announcements` 使用严格的官方公告路径白名单，只把正文确实包含卖家规则证据的文章保存为政策线索，功能宣传、培训及营销内容不会仅凭标题入库。

`amazon-us-announcements` 已通过本机管理员 API 注册到开发库 `127.0.0.1:5544/lightchoice_radar`。真实采集第一轮 `found=11 / created=1 / revised=0`，正文提取 2,820 字符并按本地规则完成处理；目标公告为 “Upgrades to Customer Service by Amazon help sellers save time and reduce refunds”，官方列表日期为 2026-05-22，内容哈希为 `572f533f…279ff`。规则摘要对应退货退款适用条件、95% 有效追踪率要求移除和季度低于 30 单卖家的免费资格；文章没有单列生效日期，页面明确显示“未确认”。后续重复采集均为 `found=11 / created=0 / revised=0`，数据库仍只有一个身份、修订号仍为 1、哈希不变。该记录属于历史回填，不会进入最近 7 天默认列表；历史 API 需显式使用 `dateBasis=published&from=2026-05-22&to=2026-05-22` 才按来源发布日期命中。公开详情页显示标题、来源、日期、中文规则摘要、五条正文命中证据及官方原文链接。来源设置 `site_fulltext=false`，因此公开 API 不返回完整正文，只展示摘要和可核查证据。

本轮补齐情报列表的来源筛选及“收录日期/发布日期”选择，关键词搜索和 Markdown/JSON 导出会保留相同筛选条件。实际浏览器在临时验证地址 `http://127.0.0.1:3100` 查到上述真实公告；桌面与手机宽度下均显示来源、日期依据、日期范围、摘要和详情链接，手机搜索继续保留来源与日期条件。发布日期查询 API 返回 1 条，未指定 `dateBasis=published` 时仍按收录日期筛选，旧行为保持不变。Markdown 导出已显示正确日期口径。

2026-10-22 又用项目的 `fetchWebList` / `fetchDetail` 顺序检查了公告索引与 6 篇最新候选：索引解析出 11 条；6 篇正文均成功读取，正文长度 866–2,820 字符，列表日期与文章日期一致。只有 2026-05-22 的 Customer Service 公告通过“明确卖家规则证据”筛选，并命中 5 条原文证据；Deals、Seller Café、Seller University、Seller News 和 FBA Grade & Resell 更新未通过。Seller Café 文中仅提到 `account health`，通用规则会给出账号健康标签，但来源专属准入规则拒绝该文，因此未入库；这仍说明账号健康关键词规则有误标风险。费用来源本轮也通过项目采集器读取 1 篇 5,573 字符的 2026 费用公告，命中费用/FBA 线索及原文明确的 2026-01-15 生效日期；这是既有公告的只读核验，不是新写库。定向政策测试 `radar-policy.standalone.test.ts` 为 13/13 通过，覆盖政策证据、来源白名单、HTTP 失败和空解析错误。

2026-10-23 监管来源进入定时调度：专用 Worker 新增两条私有队列 `cron.radar.regulatory.schedule` 与 `sources.fetch-regulatory`，只服务 `RADAR_REGULATORY_SOURCE_IDS` 里的三个来源。调度入队（`scheduleDueSources`）与任务执行（Worker 的 fetch 处理器）两处都校验来源 ID，执行处还要求来源仍是启用状态、且 `feedUrl` 主机与其官方域名一致；Worker **不订阅** `sources.fetch`，因此不会取走其他来源的任务。实测（00:39）：三个来源在同一分钟各入队 1 条，分别抓取完成 `found=40 / 3 / 5`、`created=0`、`health=ok`、`fail_count=0`，`next_fetch_at` 推进到 01:39 / 02:39；紧接着的一分钟调度 `enqueued=0`，没有重复执行。同一时段 `cron.sources.schedule` 的 110 条任务仍全部停留在 `created`，证明本 Worker 没有消费全局调度队列。

2026-10-23 来源扩展实测（第六轮，结论：没有新来源通过）：用项目自己的 HTTP 层逐条探测了 Seller Forums 公告板块、Seller Central 帮助中心政策页、Selling Partners RSS、Amazon Ads 政策页、Brand Registry 政策页、官方费用页与博客 RSS 变体。结果：`sellercentral.amazon.com/robots.txt` 首条就是 `Disallow: /`（Seller Forums 与 Help Hub 一律不自动采集，保持人工导入），Help Hub 还要登录；Selling Partners 的 `data-insights.rss` 只有 4 条洞察/宣传，`?tag=`/`?category=` 参数无效；Ads 政策页 404 或只有 JS 壳；Brand Registry 是营销页；公告列表 p≥5 会回落第 1 页（共 4 页 23 条，第 1 页最旧 2025-09-02，已覆盖 13 个月窗口）；`/blog/rss.xml`、`/rss`、`/policies`、`/announcements` 全部 404。每个候选的 robots、状态码、字节数、正文长度与结论都记在 `docs/radar/source-research-2026-10-23.json`。结论：Amazon 公开政策供给只剩公告博客一条、约一年一条政策，平台政策记录少是供给问题而不是采集器问题；为防止以后误接，新增 `tests/radar-source-compliance.standalone.test.ts`（robots 禁止的主机与未验证主机不得出现在来源配置里）。

2026-10-23 Amazon Ads 政策独立链路（第七轮）：Ads 政策页只在 JavaScript 执行后才有正文，HTTP 层拿到的是 6 字符空壳。新增 `browser-render.ts`（Playwright 动态导入 + 本机 Chrome，`channel: "chrome"`，不下载浏览器；API/Web/常驻 Worker 不会加载）与 `ads-policy.ts`：目录页 `G29MAQ3YTK5LQ7VC` 只用来发现链接，两个子页（`G4U9JBZH3664JWX2`、`GZS8A5XCFQJTS88N`）各自按渲染正文判定，正文必须出现 ≥3 条条款级广告规则（禁止事项、广告主要求、违规处置）才放行，日期只认正文里的 `Updated on`。`radar-rules.ts` 增 `ads-policy` 规则与「亚马逊广告政策线索」标签；采集按 `adapter=browser_help` 走浏览器分支，其余来源仍走原 HTTP 链路。来源 `ads-policy-pages` 在 `industry/sources.json` 里声明但 `enabled=false`，本轮只做受控实采，**未写入数据库、未进入 Worker 调度**。实采结果：两页 `Updated on` 分别为 2026-07-22 / 2026-06-25，写入候选时只作为 `sourceUpdatedAt`（来源更新时间），`publishedAt` 与 `publicationTime` 保持 null——帮助页没有发布日期，不能拿更新时间冒充；正文 2401 / 3465 字符，条款证据 4 / 3 条；连续两次渲染身份与哈希一致，改动正文后哈希变化。证据见 `docs/radar/ads-policy-collection-2026-10-23.json` 与 `tests/ads-policy.standalone.test.ts`（6/6）。

2026-10-23 端到端打通（第八轮）：① **迁移修复**——`0090_article_revision_excerpt.sql` 是多语句迁移，违反「一条语句」规则，任何全新库都装不上。在 `migration-safety.ts` 增加首行 `-- atomic` 声明：多条语句在一个事务里执行，沿用同样的 1s 锁超时 / 10s 语句超时，分词器仍拒绝函数体；0090 加上声明后，全新库一次装完 65 条迁移。② **Ads 入库**——隔离库 `lightchoice_radar_test` 与开发库都跑通了真实浏览器采集：首次 `found=2 / created=2`，第二次 `created=0 / revised=0`；两条记录 `published_at` 与 `publication_time` 均为 null，`source_updated_at` 为 2026-07-22 / 2026-06-25，正文 2401 / 3465 字符，标签「亚马逊广告政策线索」。③ **已知缺口**：这两条记录 `publications.eligible=false`（发布层挡掉「无发布日期的首次导入」），所以详情页可访问、默认列表不出现——要进列表必须先决定 timeline 用来源更新时间还是单开政策库视图，本轮不做该产品决定。数据库现有 `platform_policy` 2 条、`ads_policy` 2 条、`external_regulation` 20 条。

2026-10-23 第九轮：① **atomic 门禁收紧**——`-- atomic` 必须位于文件首行，且允许的语句只有 0090 那两条（按 token 逐一比对）；其它 UPDATE/DELETE/TRUNCATE/SELECT、第三条语句、改列名、去掉 hash 守卫、函数体全部拒绝，1s 锁超时与 10s 语句超时不变。② **Ads 进入列表**——`decideTimeline` 在没有发布日期时改用来源更新时间作时间轴（有发布日期的行为不变），`publishArticle` 允许「无发布但有来源更新日期」的首次导入入库列表；两条 Ads 记录 `eligible=true`、按 2026-07-22 / 2026-06-25 展示，`published_at` 仍为 null，详情页显示「未确认」。真实 Chrome 验证：`/all?source=ads-policy-pages` 2 条、点进详情正常、无 pageerror。③ 官方政策人工补录仍未实现（见 `CURRENT.md` 的未完成项与所需最小 Schema 改动）。

端口核对（2026-10-23 00:20 复核）：默认开发端口 3000 / 3001 此前被更早启动的旧进程占用且功能不全，**这些旧进程已在 00:11 前后与开发库一起退出，两个端口现在空闲**。当前源码的预览实例是 API `127.0.0.1:3101`（`/api/health` 返回 `{"ok":true,"db":"ok"}`）与 Web `127.0.0.1:3100`（`/all` 返回 200），由本轮在 00:15–00:17 重新拉起。**看当前源码的数据请访问 `http://127.0.0.1:3100`。**规则模式 `ruleOnlyMode=true`、`modelCallsEnabled=false`；付费请求门禁测试确认网络回调执行 0 次，未经批准的网页来源仍被拦截。Contracts、Backend、API 类型检查和 Web 构建均通过。

专用 Worker 当前只有**一个**运行实例：PID 24900（2026-10-23 01:11 以第五轮代码启动，启动日志已确认），订阅四条私有队列 `cron.radar.amazon-announcements.schedule`、`cron.radar.regulatory.schedule`、`sources.fetch-amazon-announcements`、`sources.fetch-regulatory`，**不订阅 `sources.fetch`**，因此不会取走其他来源的任务。此前 44184 / 31592 / 42608 都在确认无任务执行后停止或随环境退出。重复启动的保护来自 `apps/worker/src/instance-lock.ts` 的 PostgreSQL 会话级 advisory lock：第二个进程在注册任何队列之前退出（2026-10-23 实测输出 `another instance already holds this worker role`，退出码 0，不触发计划任务的重启策略）。

**22:49 到点采集已实测完成**：调度轮询 22:49:35 入队 1 条，抓取任务 22:49:35 创建、22:49:44 完成（`fetch_runs` id=61，`status=ok`，`found=11 / new=0`，`detailErrors` 为空），来源 `health=ok`、`fail_count=0`、`last_ok_at=22:49:44`，`next_fetch_at` 推进到 `2026-10-23 04:49:44`；同一分钟内没有第二条调度或抓取任务，库内该来源仍只有 1 篇公告、修订号 1。

2026-10-22 收口：补齐 10 条 Amazon 官方政策历史回测样本（`docs/radar/amazon-policy-backtest.json`，逐条核对原标题、官方链接、发布日期、生效日期、适用范围与规则证据）。第一轮 8/10，S03（FBA Grade and Resell 参与方式由 opt-out 改 opt-in）与 S04（FBA 库容政策，明确 2023-03-01 生效）被公告正文门禁漏掉，原因是门禁只匹配 `requirement` / `must maintain` 一类句式。当天已最小修改 `isQualifyingAmazonPolicyAnnouncement`，补两类证据：同一句内 opt-in 与 opt-out 并存且指向 program / enrollment；`effective` / `takes effect` / `goes into effect` 与政策主体在 ±160 字符内同时出现。修复后回测 **10/10**，并把公告列表页全部 23 条正文重跑一遍：只有 S02、S03、S04 通过，20 条功能与营销内容仍被拒绝（0 误报）。回测准确率 10/10 与生产覆盖率（列表页 23 条中人工判定为政策的 3 条，门禁召回 3/3；生产库仍只有 1 条，S03/S04 属历史公告未回填）分别统计，不互相替代。定向测试 `tests/radar-policy-backtest.standalone.test.ts` 6/6 通过，`tests/radar-policy.standalone.test.ts` 13/13 通过。

2026-10-22 深夜续做三件事。① **S03 标签**：门禁放行后标签仍为空，因为 `seller-program-rules` 只认 requirement / must maintain 一类句式；在 `radar-rules.ts` 补「同一句 opt-in 对 opt-out」后，S03 得到「亚马逊卖家项目规则线索」，全语料 23 条里只有它命中该句式，没有新增误标。② **回测口径**：改为用保存下来的官方正文原文判定——`docs/radar/amazon-policy-backtest-bodies.json` 存 10 篇正文、抓取时间与 sha256，测试重算哈希并对**完整正文**调用当前分类器，`engine` 字段不再作为判定依据；`gateText` 摘录回归只作辅助断言，两者结论必须一致。③ **信源覆盖**：新增 2 个联邦公报 RSS（CPSC / FTC 的最终规则与拟议规则），并把此前只写在 `industry/sources.json`、从未注册进库的 CPSC 召回 RSS 补注册。三者都走现有 RSS 链路，未改采集框架、未放宽全局限制。

受控采集结果（2026-10-22，开发库 `127.0.0.1:5544/lightchoice_radar`）：CPSC 召回 `found=40 / created=15`，联邦公报 CPSC `found=3 / created=3`，联邦公报 FTC `found=5 / created=2`（2 条 petition 被噪声规则丢弃、1 条同身份去重）；随即重复采集，三个来源均 `created=0`，去重有效。库内记录合计 23 条：**Amazon 平台政策 2 条**（费用公告 1 + 公告列表 1，来源带 `platform_policy` 标签）+ **美国监管 20 条**（CPSC 召回 15 + 联邦公报 5，来源带 `external_regulation` 标签）+ 1 条 Accelerate 会议综述（营销，见下段，不计入平台政策）。监管与 Amazon 记录全部 `backfill=1`，即「首次历史发现」，不会冒充当天新消息。10 条事实抽检：标题与官方页面一致 **10/10**，发布日期一致 **10/10**（联邦公报按页面 meta，CPSC 按页面正文日期）。修订路径本轮未被触发（上游内容未变），由既有 `radar-core` 的 `A→B→A` 用例覆盖。

2026-10-23 修正一处统计风险：`amazon-us-accelerate-updates` 的唯一记录 “At Accelerate 2026, Amazon shares new AI tools as a force multiplier for independent sellers” 原文是**会议综述与功能宣传**（“Amazon Accelerate 2026, the company's annual seller conference… Nearly 4,000 selling partners came together in Seattle”），没有任何卖家规则或生效日期证据，属于营销内容。此前它被算进「Amazon 官方 3 条」是错的。处理：来源改名为「亚马逊官方｜卖家大会与功能宣传（已停采，历史记录保留）」、`enabled=false`、tags 去掉政策口径且不带 `platform_policy`；**文章本身、原文链接与历史发布记录全部保留**，详情页仍可访问。同时把 `platform_policy` / `external_regulation` 明确写进来源 tags，平台政策统计只认前者：现在 Amazon 平台政策是 **2 条**，美国监管是 **20 条**，两者不再混算。随后这层准入被彻底移除：`amazon-us-accelerate-updates` 已不在 `RADAR_POLICY_SOURCE_IDS`，`isApprovedRadarPolicyWebList` 里针对它的分支也一并删除——即使有人把来源重新启用，它也过不了平台政策来源检查；历史文章、原文链接与发布记录保持不动。

网页验收（HTTP 层，当前预览 `3100` / API `3101`）：来源列表返回 7 个来源、按来源筛选可用、按标签「美国监管与产品召回线索」筛出 17 条、关键词 `Costway` 命中、空结果返回 `total=0`、详情页显示标题/来源/原文链接/日期/标签、按发布日期查 2026-05-22 命中 S02。**浏览器交互验收未完成**：本机 Playwright 浏览器二进制缺失，只有 HTTP 证据。

按当前交接要求，DSH/MCP 本轮冻结，不调用凭据、不重发工具查询，也不作为本轮验收门槛。第一主线仍为**进行中**：库内只有 3 条官方政策线索（每个来源各 1 条），达不到验收标准里「抽检 10 条」的样本量；历史回测的 10 条样本只用于检验规则判定，不写入生产库，**不能替代库内抽检**；更多稳定的官方政策来源仍未验证。Seller Central/帮助中心没有取得稳定公开正文；SP-API RSS 属开发者更新，不混入卖家政策；CPSC 仍单独标记为美国监管来源。此前的受限 Sitemap 解析代码与测试保留，但线上子 Sitemap 响应不稳定，本次继续使用已验证的官方公告 HTML 列表。
### 主线 2：行业动态

**目标**：收集跨境电商行业新闻、市场变化与可信行业信息，形成"这个市场最近在发生什么"的背景面。

**验收标准**：

1. 至少 2 个**免费公开**行业信源（RSS 优先），互不重复；付费墙、需登录、需购买的数据源不接。
2. 判重有效：同一新闻转载不重复占位；来源与原文链接可回溯。
3. 时间口径正确：按信源时区解析，展示统一为北京时间；无可信发布时间的记录不冒充新消息。
4. 能区分"新闻事件 / 观点评论 / 厂商软文"，抽检 10 条判断与人工一致。
5. 单源失败不影响其它源，失败可见。

**当前状态：未开始。** 现有 2 个信源属智能家居/消费产品社区，不是行业媒体。

### 主线 3：消费者原声

**目标**：收集公开商品评论、问答、Reddit、YouTube 等买家反馈，提炼真实痛点与需求。

**验收标准**：

1. 来源合规：只读取**公开可匿名访问**的内容，不绕验证码、不使用代理池、不冒用登录态。
2. 每条保留：原文链接、采集时间、可得的发布时间、来源与所属商品/品类（能判定时）。
3. 抽检 10 条，至少 5 条确实是产品体验、故障、推荐或替代需求；泛技术讨论不算数。
4. 不把同一用户重复发帖计成多个买家；不把转述当一手反馈。
5. 明确标注"这是线索，不是该商品买家事实"，需回原文核对。

**当前状态：部分具备（未达验收）。** 已接入 Home Assistant 社区与 Wyze 用户社区的公开 RSS，属**社区讨论**，不等于亚马逊评论；Amazon 评论、Reddit、YouTube 均未接入。规则线索识别已可用（见 [§3.1](#31-已实现并验证)）。

### 主线 4：市场信号

**目标**：围绕关键词需求、价格、排名、新品与竞争格局，形成可验证的市场判断材料。

**验收标准**：

1. 至少 1 个**可验证、可复查**的免费数据入口；数据口径（采样范围、时间窗、单位）写清楚。
2. 每个结论都能追到原始记录，并与其它主线信息交叉验证。
3. 明确声明局限：关键词热度 ≠ 销量，排名 ≠ 利润，样本 ≠ 全市场。
4. 不购买商业数据服务、不使用付费代理、不调用付费 API。

**当前状态：第四主线 OVERNIGHT-01 市场信号深度建设完成（2026-10-26）。** 权威工程主计划见 **[docs/radar/FOURTH_LANE_MARKET_MASTER_PLAN.md](docs/radar/FOURTH_LANE_MARKET_MASTER_PLAN.md)**。个人市场情报工作台业务能力全面跃升：支持合法 CSV / JSON 交互式导入、列推测映射与入库前预览校验；支持多期关键词与商品历史观测累积、名次位移与价格变动率追踪、反转 Y 轴走势图；类目聚合看板、候选跨期去重、预警评估与三情景计算器全线可用；PostgreSQL 隔离环境与备份验证完备；R7 云端保持 DEFERRED_BY_USER（不做云端，专注本机使用）；R8 本地自然运行 = NOT_STARTED（无自动周期采集，零付费零模型调用）。工作台入口 `/market`（管理员登录）。模型预算保持 ¥0。

### 主线状态总表

| # | 主线 | 状态 | 下一步（仅当前主线可执行） |
|---|---|---|---|
| 1 | 平台政策 | **进行中（Amazon 平台政策 2 条 + 美国监管 20 条已真实入库；监管来源已进入专用 Worker 定时调度并实测跑通；回测 10/10、公告门禁召回 3/3；但 Amazon 平台政策只有 2 条、登录后自动恢复未验证）** | 补充 Amazon 官方政策来源，提高平台政策真实覆盖；完成注销登录后的自动恢复验证 |
| 2 | 行业动态 | 未开始 | 等主线 1 验收通过 |
| 3 | 消费者原声 | 部分具备（社区 RSS 已通，评论/Reddit/YouTube 未接） | 等主线 1、2 通过后补齐来源 |
| 4 | 市场信号 | **OVERNIGHT-01 深度建设就绪（[主计划](docs/radar/FOURTH_LANE_MARKET_MASTER_PLAN.md)）；支持 CSV 导入、多期位移、类目竞争与机会研究** | 操作员随时按需导入个人合法数据开展多期研究；云端部署按用户决定暂缓 |

---

## 3. 当前阶段与已实现能力

> 本节的"已实现"只指**代码存在且实际跑通过**的能力；"计划"不得当成已完成。

### 3.1 已实现并验证

| 能力 | 说明 | 证据 |
|---|---|---|
| 规则模式（无模型） | `packages/backend/src/config.ts` 按站名强制 `ruleOnlyMode`：不做模型评分、不做事件归并、不调用付费接口。**采集不受此限制**——RSS 与白名单官方 HTML 列表都会采，官方列表还会做受限正文采集（`fetchWebList` / `fetchDetail`，正文只用于规则证据与摘要，单篇有抓取上限） | `tests/radar-core.standalone.test.ts` 断言 `config.ruleOnlyMode === true`；`tests/radar-policy.standalone.test.ts` 覆盖 HTML 列表与正文解析 |
| 零付费硬拦截 | 规则模式下所有付费请求在发网络前抛错 | 同上测试断言 `paidRequest` 被拒；`providers/receipts.ts` |
| RSS 采集 + 判重 + 内容材料哈希 | pg-boss 队列、按来源间隔调度、`A→B→A` 视为新修订而非重复 | `apps/worker/src/schedules.ts`、`tests/radar-core.standalone.test.ts` |
| 规则线索识别 | 四个规则（产品问题 / 新品提及 / 替代需求 / 产品相关行业动态）带字段偏移与命中原文 | `packages/backend/src/editorial/radar-rules.ts`（`radar-rules-v1`） |
| 公告正文准入门禁 | `isQualifyingAmazonPolicyAnnouncement`：原有卖家规则句式、参与方式切换（同一句 opt-in 对 opt-out 且指向 program/enrollment）、明确生效日期 + 政策主体（±160 字符内）；日期或数量单独出现不放行 | `tests/radar-policy-backtest.standalone.test.ts`（10 条样本 + 5 条诱饵文本）；公告列表页 23 条全量重跑为 3 通过 / 20 拒绝 |
| 美国监管信源（`external_regulation`） | CPSC 召回 RSS、联邦公报 CPSC / FTC 规则 RSS，全部走现有 RSS 链路；来源 tags 标 `external_regulation`，与 Amazon 政策严格分开，不冒充官方政策 | 2026-10-22 实测：40 / 3 / 5 条解析，20 条入库，重复采集 `created=0` |
| 监管来源定时调度 | 专用 Worker 的 `cron.radar.regulatory.schedule` + `sources.fetch-regulatory` 两条私有队列，`RADAR_REGULATORY_SOURCE_IDS` 白名单在入队与执行两处校验，执行处还校验启用状态与官方主机 | 2026-10-23 00:39 实测：3 来源各入队 1 条、抓取完成、`enqueued=0` 于下一分钟，无重复执行 |
| 页面：全部动态 / 今日新增 / 搜索 / 详情 / 主题 / 热门 / 关于 | `/all`、`/today`（按北京时间与 `discovered_at` 倒序）、搜索、条目详情与原文跳转 | `apps/web/app/routes/` |
| 关键词监控（后台） | 保存监控词、按词查询线索 | `packages/backend/src/admin/radar-monitors.ts`、后台 `/admin/radar` |
| 线索导出（Markdown） | 导出保留来源、收录时间与规则证据 | `packages/backend/src/publication/radar.ts` |
| 公开出口 | 网页、RSS、`/api/v1/`、`/api/v1/agent`（Markdown）、`/api/mcp`、`/llms.txt` | `apps/api/src/routes/` |
| DSH 只读查询（**已暂停**） | `lightchoice_latest` / `lightchoice_search` 两个工具，查真实记录；能力保留，本轮不作为验收条件 | 2026-10-21 实测：最新 5 条、搜索 `Wyze` 命中 5 条、无匹配返回空状态（详见 §6.4） |
| 专用 Worker 单实例保护 | `apps/worker/src/instance-lock.ts`：PostgreSQL 会话级 advisory lock，重复启动在注册队列之前退出 | 2026-10-22 实测：第二实例输出 `another instance already holds this worker role` 并以退出码 0 结束 |

### 3.2 存在但本轮未逐一验证

- MCP 工具集合：`/api/mcp` 与 `scripts/mcp-check.ts` 存在，本轮未逐个工具实跑。
- 后台全部页面（信源、内容诊断、运行记录）：本轮未逐个打开验证。
- Docker 部署路径：`docker-compose.yml` 存在，本机实验环境未走 Docker。
- 采集定时任务：**专用公告 Worker 已验证连续运行**（2026-10-22 08:48–13:54 UTC 共 307 次每分钟调度轮询，无缺口、无重复分钟）；**全局 Worker 本轮未启动**，其连续运行稳定性仍未验证。

### 3.3 计划中（未实现）

- 四条主线中的来源接入与页面（见 [§2](#2-四条核心业务主线严格按顺序推进)）。
- 机器翻译：`content.translate` 在规则模式下**关闭**，英文原文按英文展示，不伪称已翻译。
- 事件归并（新内容）、模型综述与日报周报月报的定时任务：规则模式下**已停用**，不要重新打开当作可用功能；热度统计仍在按事件运行。
- 商品维度聚合（ASIN/品类）、价格与排名时间序列。

### 3.4 尚未验证的数据来源

- Amazon Seller Central/帮助中心的更多政策页面（公开访问条件、稳定格式及正文采集能力仍未验证）。
- Amazon Seller Forums：`robots.txt` 对 `/forums/` 是 Allow，但内容多在登录后、且卖家协议与 Agent Policy 边界不明确，**保持人工导入，不自动采集**。
- 未接入的候选：Amazon Selling Partners 的 `data-insights.rss`（可读，但只有 4 条洞察/宣传，无政策公告）；FTC 新闻稿 RSS（可读，多为执法个案而非规则）；FDA RSS（食品与消费者健康，与目标类目弱相关）；CPSC 召回 JSON 接口（单次响应 8.9 MB，超出受限抓取预算，且 `format=rss` 实际返回 XML 非 RSS）。
- Amazon 评论、Q&A（公开性、robots、条款均未核实）。
- Reddit / YouTube 公开内容（API 限额与条款未核实）。
- 任何价格、排名、销量类数据（无合法免费来源结论）。

---

## 4. 技术架构

### 4.1 三个进程

| 进程 | 位置 | 职责 |
|---|---|---|
| api | `apps/api/` | Fastify：站点接口 `/api/site/`、公开 API `/api/v1/`、RSS、MCP、后台、图片代理、分享图 |
| worker | `apps/worker/` | pg-boss 队列与定时任务：抓信源、处理内容、热度、清理、告警 |
| web | `apps/web/` | React Router 服务端渲染页面，只通过 HTTP 读 api，不碰数据库 |

业务代码在 `packages/backend/`；跨端类型在 `packages/contracts/`；本站文案与品牌在 `site/`；行业分类、信源、提示词在 `industry/`；本站专属功能放 `modules/`。

### 4.2 要守住的架构规则

- **一个公开读取层**：所有对外出口都从 `packages/backend/src/publication/` 读，新增出口同样。
- **页面不调模型**：读者打开页面只读已有数据；模型只在 worker 任务里调用（当前规则模式下整体关闭）。
- **付费请求有回执与预算熔断**：`providers/receipts.ts`；规则模式直接拒绝付费请求。
- **安全阀默认关**：`COLLECT_ENABLED`、`MODEL_CALLS_ENABLED`、`FEISHU_*_ENABLED`、`INDEXNOW_SUBMIT_ENABLED` 只有设成 `true` 才打开。
- **来源可追溯**：每条记录链接原文；`site_fulltext` 默认关，只展示来源提供的标题与摘要。
- **公开内容匿名**：管理员与访客看到的一样；后台只允许管理员。
- **数据迁移只增不改**：`database/migrations/` 按完整文件名排序执行，已发布的迁移不改写。

### 4.3 目录速览

| 位置 | 内容 |
|---|---|
| `apps/api`、`apps/worker`、`apps/web` | 三个进程 |
| `packages/backend/src/sources/` | 信源读取与抓取调度 |
| `packages/backend/src/content/` | 入库、判重、正文清洗 |
| `packages/backend/src/editorial/` | 判断与写作（当前为规则实现 `radar-rules.ts`） |
| `packages/backend/src/publication/` | 公开读取层（含 `radar.ts` 导出） |
| `packages/backend/src/admin/` | 后台接口（含 `radar-monitors.ts`） |
| `database/migrations/` | 数据库迁移 |
| `site/`、`industry/`、`modules/` | 本站配置、行业知识、本站专属功能 |
| `scripts/` | 初始化、迁移、种子、评测、检查 |
| `tests/` | 后端测试（库名须以 `_test` / `_ci` 结尾） |

---

## 5. 跑起来

### 5.1 前置

- Node.js 24（直接运行 TypeScript，后端无构建步骤）
- PostgreSQL 17（本机实验环境使用便携版，未注册 Windows 服务）
- 生成配置：`node scripts/init-env.ts`（生成 `.env`）。**本项目不把任何密钥写进文档或提交进仓库。**

### 5.2 本机开发（实测路径）

默认端口：web `127.0.0.1:3000`、api `127.0.0.1:3001`（`npm run dev:*` 的默认值）。**本机当前这两个端口被更早启动的旧进程占用且功能不全**（`/all` 与 `/api/site/pool/sources` 返回 404），实际可用预览是 web `127.0.0.1:3100` + api `127.0.0.1:3101`（见 §2 的端口核对）。实验环境数据库在 `127.0.0.1:5544`，数据库地址由 `.env` 的 `DATABASE_URL` 决定，本文不记录凭据。

```bash
# 首次或迁移后（脚本自带 --env-file-if-exists=.env）
npm run db:migrate

# 三个进程分别启动（各开一个终端）
npm run dev:api      # http://127.0.0.1:3001
npm run dev:worker   # 队列与定时任务
npm run dev:web      # http://127.0.0.1:3000
```

采集与否由 `COLLECT_ENABLED` 决定（默认关）。只做读取与页面验证时，可以只启动 api + web。

### 5.3 Docker 方式

```bash
docker compose up -d --build
```

打开 <http://localhost:3000>，后台在 `/admin`。域名、HTTPS、中国大陆网络、备份与更新见 [部署](docs/deploy.md)。

### 5.4 常用检查命令

```bash
npm run typecheck                                                  # 类型检查
DATABASE_URL=postgres://127.0.0.1:5544/<名字>_test npm test         # 后端测试（库名须以 _test / _ci 结尾，账号要能建库）
npm run build -w @aihot/web && node --test apps/web/tests/*.test.ts # 前端构建 + 页面测试
node scripts/smoke.ts --base http://localhost:3000                 # 站点冒烟（需先跑起来）
node scripts/mcp-check.ts                                          # MCP 工具集合检查
```

测试不访问任何外部服务；规则模式下模型与付费接口一律不调用。

### 5.5 怎么确认"真的有数据"

1. 打开 `/today`：条目按**北京时间收录日**倒序，点开能看到来源与原文链接。
2. 打开 `/all` 与 `/all?q=Wyze`，确认命中、排序与空状态都正确。
3. `curl http://127.0.0.1:3001/api/v1/agent/latest?limit=5&mode=all&window=7d` 应返回带来源与北京时间的中文 Markdown。
4. 页面能看到内容，只证明展示；**记录是否真实入库**还要回数据库核对来源链接与时间。

---

## 6. 使用说明

### 6.1 页面入口

| 地址 | 内容 |
|---|---|
| `/` | 首页（当前规则模式下以最新线索为主，不生成 AI 精选） |
| `/today` | 今日新增：按收录时间倒序，判断"今天有什么新线索" |
| `/all` | 全部动态：按时间浏览、进入详情与原文 |
| `/all?q=<关键词>` | 关键词搜索：可切换按时间或相关度排序；搜索繁忙时进入 `/all/search-busy` 提示页 |
| `/topics` `/hot` | 主题与热门：热门来自事件热度统计；规则模式下不做模型归并与综述，事件覆盖可能不全 |
| `/admin` | 后台：信源、内容诊断、关键词监控、运行记录 |

### 6.2 公开出口（给程序与 Agent）

| 地址 | 用途 |
|---|---|
| `/api/v1/` | 公开 JSON API，文档 `/openapi-v1.json` |
| `/api/v1/agent` | 给 Agent 读的 Markdown，`/api/v1/agent/latest`、`/api/v1/agent/search` 等 |
| `/api/mcp` | MCP 服务（工具名前缀 `lightchoice_radar`） |
| `/feed.xml` 等 | RSS：精选、全部、分类等 |
| `/llms.txt`、`/sitemap.xml` | 给大模型与搜索引擎的说明 |

### 6.3 关键词监控与线索导出

后台 `/admin/radar` 可保存监控词（名称 + 查询词，空白会被规整、空值被拒绝）；线索导出为 Markdown 时保留来源、收录时间与规则命中的原文片段，便于复核。

### 6.4 在 DSH 里查询情报

> **状态：已暂停。** 本轮不调用 DSH 凭据、不重发工具查询，DSH/MCP 也不作为验收条件；网页工作台是当前主要入口。以下保留已实现能力的说明，便于后续恢复。

插件位于仓库之外：`D:\Workspace\轻选情报中心\lightchoice-radar-plugin`（Cordis bundle，通过 `plugin_manager` 安装到 DSH profile）。提供两个**只读**工具：

| 工具 | 作用 | 实际接口 |
|---|---|---|
| `lightchoice_latest` | 查看最新情报（默认最近 7 天全部公开动态、5 条） | `GET /api/v1/agent/latest` |
| `lightchoice_search` | 按关键词搜索，返回命中内容与原文链接 | `GET /api/v1/agent/search` |

用法：在 DSH 里直接说「查看最新 5 条情报」「搜索关键词 Wyze」。插件只访问 `127.0.0.1:3001` 的这两个固定路径，参数中没有 URL 字段，不写数据库、不调用模型；API 未启动时返回中文错误，不伪造数据。

---

## 7. 文档

| 文档 | 内容 |
|---|---|
| [AGENTS.md](AGENTS.md) | 工程规则、零付费与合规边界、多 Agent 接力约定 |
| [架构](docs/architecture.md) | 三个进程、公开读取层、模块、迁移、对外出口、测试 |
| [信源](docs/sources.md) | 信源类型、分级、抓取频率、全文与外部推送 |
| [部署](docs/deploy.md) | Docker、域名与 HTTPS、中国大陆、更新、备份、成本 |
| [精选与校准](docs/selection.md) | 精选流程与用自己的样本校准（规则模式下不启用模型精选） |
| [把它改成你的行业](docs/customize.md) | 站点配置与行业知识的修改入口 |
| [事件归组与关系评测](docs/grouping.md) | 事件关系判断与评测（规则模式下归组关闭） |
| [综述评测](docs/story-digest-evaluation.md) | 改综述提示词前的并排比较方法 |

---

## 8. 边界与合规

- **零新增付费**：不调用付费模型 API、不产生付费 Token、不订阅商业数据服务、不购买代理。只用合法公开信源、免费 RSS、官方公开公告与免费工具。这条是硬约束，不接受"临时先付费验证"。
- **不绕过平台限制**：不使用代理池、验证码绕过、登录态爬取、伪造请求头等手段获取数据。
- **只收公开信息**：不采集非公开、需授权或明确禁止抓取的内容；robots 与来源条款优先。
- **来源可追溯**：任何进入系统的记录都必须能回到原文链接与时间；无法回溯的数据不入库。
- **不冒充**：不把社区讨论当买家事实，不把关键词命中当市场规模，不把规划写成已完成，不把英文原文说成已翻译。
- **不写真实数据**：开发与验证期间不修改真实库记录、不执行迁移、不触发采集或推送，除非任务明确授权。

---

## 9. 许可与来源

本仓库基于开源项目 [AIHOT](https://github.com/KKKKhazix/AIHOT) 的固定快照 `5633b648b9ca6453caec5bcf70a76785a794286f` 改造为 LightChoice Radar；本地 Git 基线为 `f44ad57bef555f33f7bd1733d6360699f2e5b319`。代码使用 [MIT 许可证](LICENSE)。

- AIHOT 的名字与 Logo 不在许可范围内；本站使用 LightChoice Radar 自己的名称与品牌，不沿用其标识。
- 字体许可见 [NOTICE](NOTICE)。
- 第三方信源内容版权归原发布者，本站只保存标题、摘要与原文链接，遵守各来源的使用条款。
