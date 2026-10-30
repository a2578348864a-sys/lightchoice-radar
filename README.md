# LightChoice Radar · 轻选情报中心

**把公开信息整理成可追溯的跨境电商研究线索。**

LightChoice Radar 是一个本地优先的开源情报工作台，面向研究 Amazon 美国站商品与产品机会的个人卖家和开发者。它汇集公开的官方公告、监管信息、行业动态与受控导入的消费者材料，保留原文和时间依据，用本地规则帮助你筛选值得进一步核查的线索。

> **项目定位**：提供证据和研究工作流，由使用者判断产品机会；默认规则模式不调用付费模型或商业数据服务。

[快速开始](#快速开始) · [功能与现状](#四条业务主线现状) · [开放接口](#核心能力) · [使用边界](#边界与合规) · [贡献指南](CONTRIBUTING.md)

### 一眼看懂

| 你需要 | Radar 提供 |
| --- | --- |
| 找到值得关注的变化 | 汇集官方政策、监管通报及行业线索，按来源和时间筛选。 |
| 判断消息是否可靠 | 保留原文链接、日期口径、规则命中证据和修订历史。 |
| 持续研究一个问题 | 关键词检索与监控、网页工作台、Markdown 导出和公开 API。 |
| 控制运行成本 | 默认使用本地确定性规则；采集与可选扩展由配置控制。 |

**当前状态**：平台政策与监管线索可持续采集；行业动态具备基础信源；消费者原声提供受控研究工作台；市场信号的商业数据源仍未接入。各模块的能力和限制见下方[现状表](#四条业务主线现状)。

---

## 为什么做这个项目

公开消息分散在公告、监管网站、媒体和社区。研究商品时，重要的是知道一条信息来自哪里、何时发布、能支持什么判断。

- **证据与溯源缺失**：通用大模型摘要容易产生事实幻觉或遗漏关键上下文，模糊了政策的具体生效日期、适用范围与责任主体。
- **信息源真实度失真**：自媒体转述、二次加工与营销软文层出不穷，容易将媒体推测误判为官方正式政策。
- **样本与结论混淆**：社区里的单点吐槽不等于产品普遍缺陷，搜索词出现频率不等于真实商业需求规模。
- **不可控的成本与黑盒**：过度依赖商业付费数据或频繁调用大模型会导致不可控的开销，且缺乏底层证据链。

LightChoice Radar 坚持 **“证据可查、规则优先、零新增付费”**：

1. **保留可核查事实**：每条入库情报均保留官方原文链接、抓取时间、声明时间与字段级命中证据，不猜、不编造。
2. **纯本地规则驱动**：以确定性语法与句式规则预筛代替高成本的模型调用，实现默认零费用（¥0）持续运行。
3. **清晰的可信边界**：明确区分官方政策、监管召回、行业报道与第三方线索，未证实内容明确标注为“未确认”。

---

## 快速开始

### 1. 前置依赖

- **Node.js**：>= 24.11（原生支持 TypeScript 运行）
- **PostgreSQL**：16 或 17

### 2. 环境配置

克隆仓库并初始化配置文件：

```bash
git clone https://github.com/a2578348864a-sys/lightchoice-radar.git
cd lightchoice-radar
npm install
node scripts/init-env.ts
```

> `node scripts/init-env.ts` 会自动生成 `.env` 文件并生成必要的随机安全密钥。LightChoice Radar 默认在零模型费用的规则模式下运行，**无需填写任何大模型 API Key 即可完整运行**。

也可以直接复制模板进行配置：

```bash
cp .env.example .env
```

并在 `.env` 中按需确认：
- `SITE_URL`：读者访问地址（本机试用保留 `http://localhost:3000`）。
- `DATABASE_URL`：PostgreSQL 数据库连接串（例如 `postgres://user:password@127.0.0.1:5432/lightchoice_radar`）。
- `ADMIN_PASSWORD`：后台管理密码（至少 12 位）。

### 3. 初始化数据库

执行数据库迁移：

```bash
npm run db:migrate
```

### 4. 启动服务

在不同的终端窗口中分别启动三个独立进程：

```bash
# 终端 1：启动 API 接口服务（默认 http://127.0.0.1:3001）
npm run dev:api

# 终端 2：启动后台采集与定时任务 Worker
npm run dev:worker

# 终端 3：启动 Web 网页端（默认 http://127.0.0.1:3000）
npm run dev:web
```

启动完成后，在浏览器中打开：
- **平台政策**：<http://127.0.0.1:3000/all>
- **今日新增**：<http://127.0.0.1:3000/today>
- **行业动态**：<http://127.0.0.1:3000/industry>
- **消费者原声**：<http://127.0.0.1:3000/voc>
- **市场信号**：<http://127.0.0.1:3000/market>
- **管理后台**：<http://127.0.0.1:3000/admin>（使用 `.env` 中的 `ADMIN_PASSWORD` 登录）

---

### Windows 便捷运维脚本

如果在 Windows 环境下运行，仓库根目录提供了支持单实例保护与优雅停机的 CMD 入口：

| 操作 | 脚本 | 说明 |
|---|---|---|
| **一键启动** | `start-radar.cmd` | 按序检查并启动数据库、API、Web 及各主线专属 Worker，已运行的跳过 |
| **状态检查** | `status-radar.cmd` | 查看各进程运行状态、实例锁、五大信源最近采集与健康度 |
| **优雅停止** | `stop-radar.cmd` | 停止专用 Worker 与 Web/API 服务（保留底层数据库运行） |
| **受控翻译** | `start-radar-translate.cmd` | 启动受控中文机器翻译（需单独配置翻译额度并授权预算窗口） |

---

### Docker 部署方式

如果你偏好容器化部署：

```bash
docker compose up -d --build
```

Docker Compose 会启动 `db`、`setup`（自动跑迁移与种子数据）、`api`、`worker` 与 `web` 容器。详见 [docs/deploy.md](docs/deploy.md)。

---

## 核心能力

当前代码库中已实现并验证的核心能力包括：

- **公开信源采集与调度**：支持标准 RSS、官方公告 HTML 列表（带受限正文采集）以及监管机构通报（CPSC 召回、联邦公报规则）；支持按来源独立配置采集频率、失败退避与历史回溯窗口。
- **规则预筛与线索识别**：内置纯本地确定性规则引擎（`radar-rules-v1`），高效识别政策条款、产品问题、新品提及、替代需求等特征，提取可核查的原文片段与偏移量。
- **双重时间口径与版本追溯**：分离来源声称时间（`published_at_claim`）与可信发布时间（`published_at`），记录抓取发现时间（`discovered_at`），防止历史旧内容修改冒充当天新事件；通过内容哈希与 `identity_key` 严格去重与版本追踪。
- **情报浏览与工作台交互**：
  - **全部动态与今日新增**（`/all`、`/today`）：支持按时间、来源与政策/监管标签筛选浏览。
  - **关键词检索与监控**（`/all?q=...`、`/admin/radar`）：本地搜索，支持按相关度或时间排序，后台支持保存监控词与 Markdown 证据导出。
  - **多主线研究看板**：行业动态（`/industry`）、消费者原声工作台（`/voc`）、市场信号看板（`/market`）。
- **标准开放出口**：
  - 网页界面（Remix / React Router SSR，仅通过 HTTP 读 API）；
  - 标准公开 API（`/api/v1/`，OpenAPI 规范位于 `/openapi-v1.json`）；
  - 面向 Agent 的 Markdown 出口（`/api/v1/agent`，如 `/latest`、`/search` 等）；
  - 机器可读索引（`/llms.txt`、`/sitemap.xml`）与标准 RSS 订阅（`/feed.xml` 等）。
- **调度治理与运行保护**：
  - 基于 PostgreSQL 会话级 Advisory Lock 的专用 Worker 互斥锁（抢锁失败安全退出，杜绝多实例冲突）；
  - 专用私有队列（pg-boss）隔离不同来源的抓取任务；
  - 长期运行健康监控（双心跳机制、中断任务自动收口、本地备份与保留清理）。

> **集成状态说明**：DSH / MCP 只读查询工具（`/api/mcp` 与外部只读插件）作为技术储备保留，**当前处于暂停状态**，不作为日常主要操作入口或当前版本的验收依赖。网页端（Radar Web）是当前的主要交互工作台。

---

## 四条业务主线现状

本项目按阶段推进四条业务主线。按 V1.0 结项基准，各项主线的真实研发与交付状态如下：

| # | 业务主线 | V1.0 阶段定位 | 当前实际交付能力 | 局限与未交付部分 |
|:---:|:---|:---:|:---|:---|
| **01** | **平台政策** | **核心工程已交付**<br>（日常持续运行） | 接入 Amazon 官方费用公告、官方公告博客与美国联邦监管 RSS（CPSC 产品召回、FTC 规则制定）；公告正文门禁回测准确率 10/10；专用 Worker 定时调度与去重入库稳定运行。 | 官方高质量政策供给客观稀缺（年均公告数量有限）；Amazon 登录后卖家后台（Seller Central）与帮助中心因登录墙和 `robots.txt` 限制保持人工录入，未开放自动爬虫。 |
| **02** | **行业动态** | **基础框架与信源已交付** | 接入美国经济分析局（BEA 宏观数据）、美联储（FRB）、Retail Dive、Supply Chain Dive、Modern Retail 等信源；支持零售渠道、物流供应链动态等分类筛选。 | 受第三方商业媒体使用条款约束，严格限制为仅元数据准入与原文外链署名，不抓取、不存储完整正文，亦不送入第三方大模型。 |
| **03** | **消费者原声 (VOC)** | **研究工作台具备**<br>（增量采集受控） | 提供受控数据导入通道（adminHandler + CSRF 门禁）、L1 规则分类、L2/L3 痛点研究归并、乐观锁人工复核及撤销传播机制；已支持咖啡类目等 30 篇 VOC 材料与离线研究验证。 | 原有的两个社区 RSS 源自动增量已停摆（转为受管手动脚本 `voc-increment.ts`）；Amazon 商品全量评论、Reddit 与 YouTube 抓取由于合规与 API 限制未接入。 |
| **04** | **市场信号** | **工程框架冻结**<br>（MARKET-FREEZE-01） | 已实现 12 模块工作台交互、CPSC 官方产品安全风险通报流（直通创新反证与风险预警）、专用后台调度 Worker（顾问锁守护）。 | **核心商业数据源诚实冻结**：经 14 维度深度调研，Amazon 官方 SP-API / PA-API 存在严格的专业卖家/品牌备案资质门禁与反情报库条款限制，第三方商用数据服务违背 ¥0 约束；系统不编造假 ASIN，不展示虚假销量或价格预测。 |

---

## 系统架构

```mermaid
flowchart TD
    subgraph Sources["公开信源层 (Public Sources)"]
        S1["Amazon 官方公告 / 费用页<br>(HTML 列表 + 受限正文)"]
        S2["美国监管机构<br>(CPSC 召回 / FTC 规则 RSS)"]
        S3["行业与宏观数据<br>(BEA / FRB / 行业媒体 RSS)"]
        S4["消费者原声与线索<br>(受控材料导入 / AMZ123 线索)"]
    end

    subgraph Workers["调度与后台处理层 (Scoped Workers)"]
        W1["公告/监管 Worker<br>(radar-announcements)"]
        W2["行业动态 Worker<br>(radar-industry)"]
        W3["市场信号 Worker<br>(radar-market)"]
        W4["维护 Worker<br>(radar-maintenance)"]
        Lock["PostgreSQL Advisory Locks<br>(会话级顾问锁互斥 + 双心跳)"]
        W1 --- Lock
        W2 --- Lock
        W3 --- Lock
        W4 --- Lock
    end

    subgraph Processing["规则处理引擎 (Deterministic Rules)"]
        R1["准入门禁 (Gate Checks)"]
        R2["本地规则抽取 (radar-rules-v1)"]
        R3["内容清洗与哈希去重 (SHA-256)"]
        R4["零模型成本拦截 (Receipts Gate)"]
    end

    subgraph Storage["数据存储层 (PostgreSQL 17)"]
        DB1[("sources 表<br>信源配置与准入许可")]
        DB2[("articles / publications 表<br>单源事实 / 发布池 / 修订历史")]
        DB3[("fetch_runs / job_runs 表<br>运行审计与失败退避")]
        DB4[("settings 表<br>系统偏好 / 锁状态 / 预算")]
    end

    subgraph Publication["后端公开读取层 (Publication Layer)"]
        Pub["packages/backend/src/publication<br>(统一对外出口单一权威读取)"]
    end

    subgraph Surfaces["服务出口与用户界面"]
        API["Fastify API (端口 3001)<br>/api/v1/ 公开接口<br>/api/v1/agent Markdown<br>/llms.txt / feed.xml"]
        Web["Remix / React Router Web (端口 3000)<br>全部动态 / 今日新增 / 行业<br>消费者原声 / 市场信号 / 管理后台"]
    end

    Sources --> Workers
    Workers --> Processing
    Processing --> Storage
    Storage --> Publication
    Publication --> API
    API -->|SSR HTTP 回环读取| Web
```

### 架构守则

- **单一公开读取层**：所有对外接口和 Web 端数据均通过 `packages/backend/src/publication/` 读取，禁止在路由中散落数据库直连查询。
- **页面不调模型**：读者与管理员打开页面只读取既有持久化数据，无任何在线模型调用延迟。
- **Web 不碰数据库**：`apps/web` 仅作为服务端渲染层，通过本地回环 HTTP 代理读取 `apps/api`，数据库连接串与敏感配置只留在后端环境。
- **迁移只增不改**：数据库迁移（`database/migrations/`）按文件名顺序严格增量执行，索引用并发创建，历史迁移一旦发布绝不篡改。

---

## 检查与验证

运行项目内置的验证与测试命令：

```bash
# 静态类型检查（检查 contracts, backend, api, worker, tests, web）
npm run typecheck

# 前端构建验证
npm run build -w @aihot/web

# 核心独立回归测试（无需真实外部网络）
node --test tests/radar-core.standalone.test.ts
node --test tests/radar-policy-backtest.standalone.test.ts
node --test tests/radar-policy.standalone.test.ts
node --test tests/radar-source-compliance.standalone.test.ts
node --test tests/ads-policy.standalone.test.ts
```

---

## 文档导航

| 文档 | 核心内容 |
|---|---|
| [AGENTS.md](AGENTS.md) | 工程开发规范、多 Agent 协作约束、零付费硬红线与安全边界 |
| [docs/architecture.md](docs/architecture.md) | 系统整体架构、三进程职责、公开读取层规范与数据库迁移准则 |
| [docs/sources.md](docs/sources.md) | 信源类型、分级体系、采集调度策略与合规抓取说明 |
| [docs/deploy.md](docs/deploy.md) | 生产环境部署、Docker 配置、域名与 HTTPS、日常备份与维护 |
| [docs/customize.md](docs/customize.md) | 站点品牌文案、行业领域分类与模板定制指南 |
| [docs/radar/本地运行说明.md](docs/radar/本地运行说明.md) | Windows 本机日常启停、脚本用法、本地个人模式说明与状态诊断 |
| [docs/radar/FOURTH_LANE_MARKET_MASTER_PLAN.md](docs/radar/FOURTH_LANE_MARKET_MASTER_PLAN.md) | 第四主线市场信号工程主计划、模块说明与冻结决策依据 |

---

## 边界与合规

1. **零新增付费硬约束（¥0）**：默认关闭所有大语言模型调用（`modelCallsEnabled=false`），不购买商业代理池、不订阅付费商业数据接口。系统仅依托开源代码与合法免费公开信源持续运转。
2. **遵守公开采集协议**：不抓取任何需要登录态、付费墙或明确反爬限制的内容；严格受制于各信源的 `robots.txt` 规则与版权条款；不使用验证码绕过或伪造身份手段。
3. **证据边界与诚实表达**：
   - 政策线索 ≠ 最终确定政策（未由官方原文证实前仅作线索记录）；
   - 更新时间 ≠ 发布时间（严格区分发布日期与页面更新日期）；
   - 社区讨论数量 ≠ 独立故障发生数；
   - 排名波动 ≠ 真实销量预测（明确声明局限，不提供不可验证的销量或盈利保证）。
4. **数据安全与隐私保护**：系统不采集、不存储用户的店铺经营凭据或私有商业数据；配置文件中的密码与凭据严禁提交至版本库。

---

## 许可证与来源致谢

- 本项目基于开源项目 [AIHOT](https://github.com/KKKKhazix/AIHOT) 的固定快照（Commit `5633b648b9ca6453caec5bcf70a76785a794286f`）改造而来。
- 核心代码遵循 [MIT License](LICENSE)。
- “AIHOT” 名称与原项目 Logo 版权归原作者（数字生命卡兹克）所有。本项目使用 “LightChoice Radar（轻选情报中心）” 独立名称与品牌。
- 字体许可（Noto Sans SC）遵循 SIL Open Font License 1.1，第三方信源与测试数据版权属于原发布机构，详见 [NOTICE](NOTICE)。
