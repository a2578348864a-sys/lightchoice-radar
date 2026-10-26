# Amazon 美国站核心市场数据源深度核查与事实纠偏报告 (AUTO-TRUTH)

> **核心纠偏原则**：
> 1. **严谨区分事实与推论**：不能因为当前没有凭据就宣称“官方接口不存在”；不能因为单个 URL 404 就宣称“全类目数据永久无法获取”；也不能因为网页可以人工浏览就认定“具备合法机器自动采集许可”。
> 2. **七级递进状态标记 (Seven-Level Status)**：
>    - `OFFICIAL_DOCUMENTED`：官方是否有明确的开发者文档与接口规范？
>    - `ACCOUNT_ELIGIBLE`：当前个人用户在零额外支出约束下是否具备开通资格？
>    - `USE_PERMISSION_VERIFIED`：许可协议是否允许将数据用于个人内部选品与市场研究？
>    - `LIVE_FIELDS_VERIFIED`：在当前本地环境下是否已实际取得真实业务字段？
>    - `AUTOMATION_ELIGIBLE`：是否具备无需人工值守、无高危反爬封禁风险的机器自动调用机制？
>    - `INTEGRATED`：Radar 系统是否已具备标准适配器、数据模型与入库存储？
>    - `NATURAL_OPERATION_VERIFIED`：是否已具备连续多周期的自然运行证据？

---

## 一、Amazon 美国站各核心维度真实数据获取能力全景表

| 核心市场维度 | 官方是否存在正版接口 | 当前账户资格要求 | 免费可持续性 | 协议是否允许内部保存与研究 | 当前真实状态与七级判定 | 最合理的工程落地路径 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. 搜索需求 (ABA Search Terms)** | **是** (SP-API Brand Analytics) | 需专业卖家 ($39.99/月) + 品牌注册 (Brand Registry) | API 本身免费，但有卖家月租硬性前置成本 | 是（品牌所有者专属分析） | `DOCUMENTED_BUT_ACCOUNT_GATED`<br>[DOC:Y | ACCT:N | PERM:N | DATA:N | AUTO:Y | INT:Y | NAT:N] | 保持门禁受控关闭 (pending-credentials)；待用户拥有品牌卖家账号后在 `.env` 填入凭据一键激活。 |
| **2. 类目结构 (Browse Nodes)** | **是** (SP-API Catalog Items / PA-API) | 需专业卖家或联盟营销资格 | 包含在对应账户权限内 | 是 | `DOCUMENTED_BUT_ACCOUNT_GATED`<br>[DOC:Y | ACCT:N | PERM:N | DATA:N | AUTO:Y | INT:Y | NAT:N] | 本地模型 Browse Node ID 显式设为 null（坚决不伪造节点 ID）；等待官方凭证。 |
| **3. 商品详情 (Catalog Items)** | **是** (SP-API Catalog Items 2022-04-01) | 需专业卖家账号 (Product Listing 权限) | 包含在卖家月租内 | 是（允许查询非自有全站商品目录） | `DOCUMENTED_BUT_ACCOUNT_GATED`<br>[DOC:Y | ACCT:N | PERM:N | DATA:N | AUTO:Y | INT:Y | NAT:N] | 标准模型与字段已就绪，保持受控阻断等待合法授权。 |
| **4. 价格与 Buy Box (Pricing)** | **是** (SP-API Product Pricing) | 需专业卖家账号 (Pricing 权限) | 包含在卖家月租内（第三方 API 需 €19~$49/月） | 是 | `DOCUMENTED_BUT_ACCOUNT_GATED`<br>[DOC:Y | ACCT:N | PERM:N | DATA:N | AUTO:Y | INT:Y | NAT:N] | 坚决不采购外部商业 API；等待 SP-API 凭据，门禁受控关闭。 |
| **5. 销售热度与榜单 (BSR)** | **否官方公开免审接口** (历史 RSS 已 404；网页爬虫违背协议) | 无免登录接口；商业爬虫需高频住宅代理 | 维护代理池成本高昂 ($100+/月) | 否（违反 Amazon 爬虫协议，触发 BTS 503） | `SCRAPING_TOS_PROHIBITED`<br>[DOC:N | ACCT:N | PERM:N | DATA:N | AUTO:N | INT:Y | NAT:N] | 坚决不使用未授权代理爬虫；保持阻断，绝不引入封禁风险。 |
| **6. 评价与痛点 (Reviews / VOC)** | **部分存在** (AWS Open Data 1995-2015 历史集；实时抓取违规) | AWS Open Data 全球免费公开；实时评价无免审接口 | AWS S3 免费；实时商业抓取收费极高 | 历史数据集允许学术/研究；实时全量抓取违规 | `HISTORICAL_STATIC_ONLY`<br>[DOC:Y | ACCT:Y | PERM:Y | DATA:Y | AUTO:N | INT:Y | NAT:N] | 复用第三主线本地已有的 VOC 研究能力；不伪造 2026 年实时数据。 |
| **7. 推广联盟接口 (PA-API 5.0)** | **是** (Creators / PA-API 5.0) | 需 Associates 账号并在 180 天内产生 3 笔销售 | API 免费，但有强业务考核与流控 | 协议严格限定用于为 Amazon 导流，禁止独立情报建库 | `DOCUMENTED_BUT_AFFILIATE_GATED`<br>[DOC:Y | ACCT:N | PERM:N | DATA:N | AUTO:Y | INT:N | NAT:N] | 记录为官方合规候选通路，受导流协议与考核限制，当前保持受控阻断。 |
| **8. 宏观搜索趋势 (Google Trends)** | **是** (Google Cloud BigQuery Public Data) | 基础 Google Cloud 免费账号 | 长期每月 1TB 免费查询额度 (¥0) | 官方合规公开数据 | `MACRO_EXTERNAL_ONLY`<br>[DOC:Y | ACCT:Y | PERM:Y | DATA:N | AUTO:Y | INT:Y | NAT:N] | 作为 M07/M08 宏观趋势辅助参考，诚实声明为 Google 搜索热度而非 Amazon 站内热度。 |
| **9. 消费品安全召回 (CPSC Recalls)** | **是** (CPSC Official RSS & API) | **完全无门槛**，全球免费开放 (17 U.S.C. § 105) | 完全免费 (¥0) | 官方公共领域数据，完全合法 | `READY_AND_VERIFIED`<br>[DOC:Y | ACCT:Y | PERM:Y | DATA:Y | AUTO:Y | INT:Y | NAT:Y] | **【已全面接入运行】** 本机专用 Worker 全自动周期调度，产出 M09 创新痛点反证与 M12 风险预警。 |

---

## 二、官方与开源路径的准确事实核实

### 1. 官方 SP-API 深入拆解
- **公开应用 vs 私有应用**：
  - 私有自研应用无需通过第三方安全审查即可自用，但其开发者必须是注册且在缴的专业卖家（$39.99/月）；
  - 即使获得了开发者权限，**Brand Analytics（ABA 搜索词排名）** 也仅向通过了 **Amazon Brand Registry（品牌备案，持有真实商标）** 的品牌所有者开放；普通非品牌卖家仅能查看自身店铺的 Search Query Performance (SQP)，无法透视全市场竞品搜索表现。
- **全市场竞品目录 (Catalog Items API)**：
  - 官方支持查询任意公开商品的 Title、Brand、Bullet Points 等目录信息，这是一条真正合规的市场情报通路；缺口在于当前环境未配置专业卖家开发者凭据。

### 2. 官方 PA-API 5.0（联盟商品接口）深入拆解
- **准入门槛**：
  - 注册账号本身免费，但受限于严格的**“180 天 3 笔有效订单”考核门禁**；通过人工审核后开放凭据，但若连续 30 天无新推广订单，API 权限将被暂停；
- **用途协议限制**：
  - PA-API 协议核心宗旨为“销售导流”（Drive traffic to Amazon），明文限制第三方独立缓存价格和构建非导流用途的商业情报库。

### 3. GitHub 开源 SDK 真实状态
- 如 `amz-tools/amazon-sp-api` 等高星开源项目，本质均为**官方 REST 接口的协议封装器 (Client Wrappers)**，底层依然必须传入合法的 LWA Client ID/Secret，无法绕过官方身份认证门槛；
- 开源网页刮削库（如各种不带凭证的 scraper）在无高昂住宅代理轮换的情况下，运行数次即被 Amazon BTS 防火墙封禁并报 HTTP 503 / CAPTCHA，无法支撑个人电脑长期稳定自动化运行。

---

## 三、用户最终问题的坦诚回答

> **问：在用户当前没有新增订阅、不愿意手工导入、希望本机自动运行的前提下，究竟哪些 Amazon 美国站核心数据能够真实获取？**

**答：**
1. **现在就能合法自动获取并已跑通的**：
   - **强制合规与产品缺陷反证 (CPSC Recalls)**：已实现本机全自动获取，产出可靠的产品安全避坑依据与创新反证；
   - **全网宏观搜索趋势 (Google Trends)**：可通过公共免额度通道获取宏观品类关注度。
2. **需要账号资格才能获取的正版核心商业数据**：
   - **搜索需求 (ABA) 与竞品详情/价格 (Catalog & Pricing)**：Amazon 官方 SP-API 拥有最权威的实时全美站数据，但必须依赖专业卖家账号 ($39.99/月) 与品牌备案资质。系统已预留好标准数据接口，未来一旦持有账号可立即激活。
3. **只能作为离线基准的历史数据**：
   - **买家真实痛点 (Reviews)**：可基于 AWS Open Data 1.3 亿条公开历史评价库进行离线聚类，但不具备 2026 年实时增量能力。
4. **当前没有合格来源、坚决不引入违规爬虫的**：
   - **BSR 销售榜单实时爬取**：官方无免审接口，公开网页抓取违背协议且受高频反爬封禁；系统拒绝引入黑产代理爬虫，保持受控阻断。
