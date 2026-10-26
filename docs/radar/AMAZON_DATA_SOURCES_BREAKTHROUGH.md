# Amazon 美国站核心市场数据源深度核查、事实纠偏与准入决策报告 (MARKET-FREEZE-01)

> **核实日期**：2026-10-27
> **第一原则**：先证明数据能拿到，再写适配器；没有合法真实数据时，不制造虚假的市场机会。
> **严正纠偏**：彻底纠正过去“只要购买专业卖家账户并在 `.env` 填入凭据，就可以自动获得全部 Amazon 数据”的极化说法；严格区分账户资格、应用角色、具体权限、API 语义、用途许可与真实验收。

---

## 一、关键事实纠偏与最新官方政策核实

### 1. Amazon SP-API 真实资质与权限边界（2026 官方最新条文）
- **个人卖家计划（Individual）严禁开通开发者**：
  官方明文规定：个人卖家账户在 Seller Central 中没有开发者注册（Develop Apps）入口，无法创建自研私有应用（Self-authorized App），也无法获取 LWA Client ID 与 Client Secret。必须升级为固定月费 **$39.99/月的专业卖家计划（Professional Selling Plan）**；
- **开发者权限是细分且角色隔离的（Role-based RBAC）**：
  拥有专业卖家计划仅代表拥有开通开发者的“门票”，并不代表拥有全量数据访问权：
  - **商品目录与属性（Catalog Items API v2022-04-01）**：需要 `Product Listing` 角色，官方支持查询指定已知 ASIN 的标题、品牌、分类、属性与 `salesRanks`（分类销售排名）；
  - **`salesRanks` 绝不等于畅销榜（BSR Top 100）**：`salesRanks` 只是该特定 ASIN 在其所属分类下的当前位次（例如 `"rank": 42`），**官方根本不提供直接拉取全类目 Top 100 榜单的只读 API**；`searchCatalogItems` 按关键词或分类搜索返回的是相关度排序，不能替代全榜覆盖；
  - **搜索热词与需求转化（Brand Analytics Reports）**：属于高级分析能力，**必须拥有合规的注册商标，并在 Amazon Brand Registry 完成品牌备案，且必须分配 Brand Representative 角色**；普通无品牌专业卖家连 Seller Central 后台的 Brand Analytics 界面都无法查看，API 调用更会直接返回 `403 Forbidden`；
  - **竞争报价与 Buy Box（Product Pricing API）**：需要 `Pricing` 角色，提供指定 ASIN 的实时竞争报价，但不提供历史价格时间序列。
- **结论**：SP-API 是一条官方正规通路，但它被严格锁定在**专业卖家月租（$39.99/月）+ 品牌商标备案（Brand Registry）**的双重门禁之后。当前评级为 `ACCOUNT_GATED`。

### 2. Amazon Creators API 取代旧 PA-API 5.0（2025/2026 最新官方事实）
- **PA-API 5.0 已正式废弃并停用**：
  Amazon 官方已于 2025 年前后全面废弃 PA-API v5，其旧端点（`webservices.amazon.com/paapi5/...`）与基于 AWS SigV4 的签名认证已全面关停；
- **唯一正规替代者：Amazon Creators API**：
  官方正式接替者为 **Creators API**（端点：`creatorsapi.amazon/catalog/v1/...`，采用 OAuth 2.0 Bearer Token 认证，参数命名规范转为 lowerCamelCase）；
- **考核门禁进一步收紧（过去 30 天 10 单）**：
  旧 PA-API 历史上的“180 天 3 单”考核已被取代；当前开通并维持 Creators API 的官方硬性条件是：**关联的 Amazon Associates 推广账户在过去 30 天内必须产生至少 10 笔合格导流订单（10 qualifying sales in the last 30 days）**；未达标账户无法生成或维持凭据；
- **用途协议明文禁止市场情报库（法律红线）**：
  Creators API 与联盟体系的协议宗旨严格限定于为 Amazon 带来导流（Drive Traffic）；协议**明文规定非图片数据最长仅允许本地缓存 24 小时，且严禁将数据用于建立外部市场情报库（Market Intelligence）、竞品追踪数据库（Competitor Tracking）或历史价格数据库（Price History Databases）**；
- **结论**：Creators API 即使具备出单考核资格，在法律用途层面也被明文禁止用于个人市场情报库，当前评级为 `NOT_SUITABLE`。

### 3. Keepa API 当前真实价格与免费额度核实
- **完全没有免费套餐（No Free Tier）**：
  Keepa API 独立于其浏览器插件（Keepa Pro €29/月），API 采用专门的预付费订阅模式；
- **最低月费标准**：
  最低档 API 计划价格为 **€49/月（约合人民币 380 元/月）**，每分钟生成 20 个 token；按 ASIN 历史价格和 BSR 请求消耗 token；
- **结论**：属于直接违背项目零额外费用（¥0）红线的商业付费通道，评级为 `PAID_REQUIRED`。

### 4. Amazon 官方公开榜单网页（BSR）与网页抓取
- **公开 RSS 彻底废弃**：
  Amazon 早在 2018 年前后关闭了全部面向公众的 RSS 榜单流（请求均返回 HTTP 404）；
- **公开网页抓取违背协议且受高频反爬**：
  `amazon.com/robots.txt` 明确将 `/gp/bestsellers/` 等路径列入 Disallow；且网页端部署了严格的 BTS 防火墙拦截（返回 503 / 验证码）；在无高成本住宅代理池轮换的前提下，数次请求即被封禁；
- **结论**：严禁引入未授权代理爬虫，保持受控阻断，评级为 `NOT_SUITABLE`。

### 5. Google Trends 宏观搜索趋势
- **可用性**：可通过 Google Cloud BigQuery Public Data 获得长期每月 1TB 的免费查询额度（¥0）；
- **指标含义**：返回的是 0~100 的宏观相对搜索热度指数，反映全网用户在 Google 上的泛搜索偏好，**不等于 Amazon 站内带有购买意图的搜索量与转化率**，仅能作为 M07 趋势雷达的宏观外部佐证，评级为 `READY_NOW`（仅作宏观辅助）。

### 6. CPSC 官方消费品安全通告的真实定位与网络状态
- **业务定位**：美国消费品安全委员会官方公开通告（公共领域，无需 API Key），用于在产品研发中识别结构缺陷、材料阻燃隐患与强制认证标准（M09 创新反证与 M12 风险警示），**绝不是 Amazon 站内热卖选品数据**；
- **真实网络状态客观澄清**：
  - 合成数据离线合约断言：`CPSC_SYNTHETIC_E2E = PASS`；
  - 真实外网请求：`CPSC_LIVE_SOURCE_FETCH = BLOCKED_BY_NETWORK`（在当前本地代理与网络环境下，域名解析为保留地址被系统通用 SSRF 守卫拦截 `Blocked private address for www.cpsc.gov`，用时 13ms）；
  - 自然多周期真实运行：`CPSC_NATURAL_OPERATION = NOT_VERIFIED`；
  - 坚决不因追求假连通而关闭 SSRF 安全守卫，保持 fail-closed 退避保护。

---

## 二、Amazon 美国站核心市场数据源决策矩阵总表

| 数据类别 | 目标业务维度 | 候选数据渠道 | 官方/第三方 | 真实数据粒度 | 是否美站直接数据 | 2026 准入条件与账号资格 | 费用与配额要求 | 许可协议是否允许持久化分析 | 本机网络可达 | 真实字段获取证据 | Radar当前集成状态 | 决策状态评级 | 真实阻塞原因与客观定论 |
| :--- | :--- | :--- | :---: | :--- | :---: | :--- | :--- | :---: | :---: | :---: | :--- | :---: | :--- |
| **商品信息** | ASIN、标题、品牌、分类、属性 | **SP-API Catalog Items** | 官方 | 全美 ASIN 级目录 | 是 | 专业卖家 ($39.99/月) + Product Listing 角色 | 包含在卖家月租中 (2~5 req/s) | 是 (私有自研用途) | 是 | 否 (门禁阻断) | 标准数据模型已就绪 | `ACCOUNT_GATED` | 官方明文限制个人卖家无开发者资格；需专业卖家账号审核。 |
| **商品信息** | ASIN、标题、价格、主图 | **Creators API (新版)** | 官方 | ASIN 级商品推广资料 | 是 | Associates 推广账号 + 过去 30 天 10 单考核 | 免费 (按出单量流控) | **否 (明文禁止情报库，限24h缓存)** | 是 | 否 (门禁阻断) | 仅保留插拔位置 | `NOT_SUITABLE` | 考核门槛高且协议禁止用于市场情报与历史分析。 |
| **搜索需求** | 搜索词、频率排名 (SFR)、Top3转化 | **SP-API Brand Analytics** | 官方 | 全美搜索词周/月聚合报表 | 是 | 专业卖家 ($39.99/月) + **Brand Registry 品牌商标备案** | 包含在卖家月租中 (异步报表) | 是 (品牌方内部研究) | 是 | 否 (门禁阻断) | 报告解析模型已就绪 | `ACCOUNT_GATED` | 除专业卖家外，必须持有合规注册商标并完成官方品牌备案。 |
| **商品榜单** | 类目 Top100 榜单、排名位移 | **公开网页抓取** | 官方网页 | 类目 Top100 排位 | 是 | **无免登录接口** (robots 明确禁止) | 需高成本住宅代理池 | **否 (违反爬虫条款，触发反爬)** | 否 (503拦截) | 否 (无授权抓取) | 拒绝引入黑产爬虫 | `NOT_SUITABLE` | 公开 RSS 早已 404；网页抓取被反爬 503 阻断且违反 ToS。 |
| **商品榜单** | 单品分类排名 (salesRanks) | **SP-API Catalog Items** | 官方 | 特定 ASIN 当前分类排名 | 是 | 专业卖家 ($39.99/月) | 包含在卖家月租中 | 是 | 是 | 否 (门禁阻断) | 字段支持已就绪 | `ACCOUNT_GATED` | 仅支持已知 ASIN 查询所属分类排名，**无法拉取全榜单**。 |
| **价格变化** | 实时竞争报价、Buy Box 状态 | **SP-API Product Pricing** | 官方 | ASIN 级实时报价分布 | 是 | 专业卖家 ($39.99/月) + Pricing 角色 | 包含在卖家月租中 (10 req/s) | 是 | 是 | 否 (门禁阻断) | 报价口径检查已就绪 | `ACCOUNT_GATED` | 需专业卖家开发者凭据；无历史价格时间序列。 |
| **价格历史** | 历史价格走势、BSR 走势 | **Keepa API** | 第三方商业 | ASIN 级全历史序列 | 是 | 无需卖家账号 | **€49/月起 (无免费版)** | 是 (商业付费许可) | 是 | 否 (未购买) | 预留数据结构 | `PAID_REQUIRED` | 纯商业收费接口，直接违背 ¥0 零额外预算原则。 |
| **宏观趋势** | 全网关键词宏观相对热度 (0-100) | **Google Trends** | 第三方宏观 | 关键词时间序列指数 | **否 (Google)** | 基础 Google 账号 (免认证/公共) | **永久免费 (1TB/月)** | 是 (公开开放数据) | 是 | **是 (宏观字段)** | 趋势指标已实现 | `READY_NOW`<br>(仅作宏观辅助) | 反映全网宏观搜索趋势，**不等于 Amazon 站内搜索与转化**。 |
| **安全反证** | 召回品类、安全缺陷、通告日期 | **CPSC Official Recalls** | 美联邦官方 | 官方公开产品召回通报 | 是 (美市场) | **完全免认证** (公共领域) | **永久免费 (¥0)** | 是 (完全公开合法) | 受本机网络拦截 | 仅离线样本验证通过 | **已全面闭环** (Worker调度) | `READY_NOW`<br>(合规反证定位) | **非商业热销数据**；用于产品研发安全避坑，严禁冒充商机。 |

---

## 三、第四主线阶段性工程冻结决议 (MARKET_FREEZE)

在查清核心数据源的真实准入壁垒后，按照“先数据、后开发”的第一原则，第四主线正式实施**阶段性工程冻结**：

1. **冻结的真实含义**：
   - **保留已有全部工程成果**：原始 12 个市场模块定义、来源权限控制（`sourceAllows`）、市场数据模型（`MarketProductRecord` / `MarketKeywordSnapshot` / `ProductSafetyEvent`）、历史观测与指标引擎（C1~C12）、后台专用 Worker 守护（`radar-market`，PID/顾问锁排他）、执行互斥锁（`7204229009`）、多日关机防风暴单窗口补偿、机会候选生成与 7 段式确定性中文解释、商业情景计算器、站内分型预警、Web 前端诚实看板；
   - **暂停新增开发**：不新增没有数据支撑的市场模块，不写空来源适配器，不开发虚假算法，不伪造商业商机；
   - **保持系统诚实空态**：Web 界面清晰展示 `● 后台调度器在线 · Amazon 核心源未启用`，坚决不恢复任何手工 CSV/Excel 上传，不给用户虚假预期。
2. **状态权威冻结**：
   - `MARKET_ENGINEERING = FROZEN_WITH_LIMITATIONS`
   - `AMAZON_CORE_DATA = BLOCKED_BY_SOURCE_ELIGIBILITY`
   - `AMAZON_MARKET_NATURAL_OPERATION = NOT_STARTED`
   - `R7_CLOUD = DEFERRED_BY_USER`
3. **恢复开发的先决条件**：
   只有当以下两项条件之一实质成立时，第四主线才值得恢复代码开发：
   - **条件 A**：用户持有合规的 **Amazon 专业卖家账号（$39.99/月）** 或 **品牌备案资格**，并在 `.env` 中提供已核验的 SP-API 凭据；
   - **条件 B**：用户明确批准采购合规的第三方商业数据 API（如 Keepa API），并提供有效订阅凭据。
   在上述先决条件未成立前，第四主线维持冻结，避免继续投入无效的软件工程劳动。
