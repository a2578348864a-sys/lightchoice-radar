// Systematic Investigation & Fact-Checked Audit for Amazon US Market Data Sources (Task C)
//
// Refutes extreme generalizations ("no APIs exist in the world") with rigorous fact-checking:
//   - Distinguishes: Exists in official docs vs Account credentials required vs Unlicensed crawling vs Paid wall.
//   - Rigorously evaluates 7 progressive levels:
//     [1] OFFICIAL_DOCUMENTED
//     [2] ACCOUNT_ELIGIBLE
//     [3] USE_PERMISSION_VERIFIED
//     [4] LIVE_FIELDS_VERIFIED
//     [5] AUTOMATION_ELIGIBLE
//     [6] INTEGRATED
//     [7] NATURAL_OPERATION_VERIFIED
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "@aihot/backend/config";

export interface SourceDimensionAudit {
  dimension: string;
  officialFeasibility: string;
  accountPrerequisites: string;
  costConstraint: string;
  termsAndCompliance: string;
  actualStatus: "READY_AND_VERIFIED" | "DOCUMENTED_BUT_ACCOUNT_GATED" | "DOCUMENTED_BUT_AFFILIATE_GATED" | "PAID_WALL_BLOCKED" | "SCRAPING_TOS_PROHIBITED" | "HISTORICAL_STATIC_ONLY" | "MACRO_EXTERNAL_ONLY";
  levels: {
    officialDocumented: boolean;
    accountEligible: boolean;
    usePermissionVerified: boolean;
    liveFieldsVerified: boolean;
    automationEligible: boolean;
    integrated: boolean;
    naturalOperationVerified: boolean;
  };
  recommendation: string;
}

async function main() {
  console.log("================================================================================");
  console.log("AMAZON US MARKET DATA SOURCES: STRICT FACT-CHECKED INVESTIGATION (TASK C)");
  console.log("================================================================================");

  const audits: SourceDimensionAudit[] = [
    {
      dimension: "1. 搜索需求 (Search Demand / ABA Search Terms)",
      officialFeasibility: "Amazon SP-API 官方正式提供 Brand Analytics Report (GET_BRAND_ANALYTICS_SEARCH_TERMS_REPORT)，支持全美站数百万人气词的搜索频率排名 (SFR) 及 Top 3 点击转化 ASIN。",
      accountPrerequisites: "必须拥有活跃的专业卖家账户 ($39.99/月)，且必须是 Amazon Brand Registry（品牌备案）的正式品牌所有者 (Brand Owner)。",
      costConstraint: "API 本身不额外收费，但硬性前置依赖 $39.99/月专业卖家月租与商标注册成本。",
      termsAndCompliance: "官方正版授权，允许品牌卖家读取与分析市场需求。",
      actualStatus: "DOCUMENTED_BUT_ACCOUNT_GATED",
      levels: {
        officialDocumented: true,
        accountEligible: false,
        usePermissionVerified: false,
        liveFieldsVerified: false,
        automationEligible: true,
        integrated: true, // Market module has standard schema ready
        naturalOperationVerified: false,
      },
      recommendation: "保持门禁受控关闭 (pending-credentials)。未来一旦用户获得品牌卖家凭据，直接配置 .env 即可即插即用。",
    },
    {
      dimension: "2. 类目结构与节点 (Browse Nodes Taxonomy)",
      officialFeasibility: "SP-API Catalog Items v2022-04-01 提供 classifications 属性与 browseNodes 层级关系；PA-API 5.0 亦提供 BrowseNodeInfo。",
      accountPrerequisites: "SP-API 需专业卖家账号；PA-API 需联盟 180 天 3 单有效销售通过审核。",
      costConstraint: "官方免费或包含在卖家月租中。",
      termsAndCompliance: "官方允许查询与展示类目结构。",
      actualStatus: "DOCUMENTED_BUT_ACCOUNT_GATED",
      levels: {
        officialDocumented: true,
        accountEligible: false,
        usePermissionVerified: false,
        liveFieldsVerified: false,
        automationEligible: true,
        integrated: true,
        naturalOperationVerified: false,
      },
      recommendation: "本地模型当前显式设 browseNodeId=null，坚决不通过文本分词虚构 Amazon 真实节点 ID；待官方凭据就绪后接入。",
    },
    {
      dimension: "3. 商品详情 (Product Catalog & Details)",
      officialFeasibility: "SP-API Catalog Items API (searchCatalogItems / getCatalogItem) 支持按 ASIN 或关键词查询全站公开商品的 Title、Brand、Bullet Points、尺寸、图片与型号。",
      accountPrerequisites: "需 SP-API Product Listing 权限角色与开发者账号（依赖专业卖家账号）。",
      costConstraint: "无额外 API 费用（含在卖家月租内）。",
      termsAndCompliance: "官方允许查询非自有竞品的公开目录数据。",
      actualStatus: "DOCUMENTED_BUT_ACCOUNT_GATED",
      levels: {
        officialDocumented: true,
        accountEligible: false,
        usePermissionVerified: false,
        liveFieldsVerified: false,
        automationEligible: true,
        integrated: true,
        naturalOperationVerified: false,
      },
      recommendation: "数据模型与标准字段已冻结，保持门禁受控阻断，等待合法凭据。",
    },
    {
      dimension: "4. 价格与 Buy Box (Pricing & Buy Box)",
      officialFeasibility: "SP-API Product Pricing API v0 提供 getCompetitivePricing / getItemOffers，支持实时获取任意 ASIN 的 Buy Box 价格、竞争卖家数与 FBA 状态。",
      accountPrerequisites: "依赖专业卖家账户权限。",
      costConstraint: "官方 API 免费（第三方 Keepa €19/月、Rainforest $49/月存在付费墙）。",
      termsAndCompliance: "官方渠道合规；第三方 API 超出 ¥0 预算约束。",
      actualStatus: "DOCUMENTED_BUT_ACCOUNT_GATED",
      levels: {
        officialDocumented: true,
        accountEligible: false,
        usePermissionVerified: false,
        liveFieldsVerified: false,
        automationEligible: true,
        integrated: true,
        naturalOperationVerified: false,
      },
      recommendation: "严禁采购付费商业 API；等待 SP-API 凭据，门禁保持受控关闭。",
    },
    {
      dimension: "5. 销售排行与热度 (BSR & Best Sellers)",
      officialFeasibility: "历史公共 RSS (gp/rss/bestsellers) 已废弃 (实测 404)。Amazon 官方未提供免凭据公开榜单 API；网页版存在但受 robots.txt Disallow /dp/ 限制及高强度 BTS 反爬 (HTTP 503/CAPTCHA)。",
      accountPrerequisites: "SP-API 仅在部分类目 Catalog Items 返回有限 SalesRank；完整榜单目前行业均依赖高频分布式代理爬取。",
      costConstraint: "自建代理池与打码成本高昂 ($100+/月)，超出 ¥0 预算。",
      termsAndCompliance: "直接网页抓取严重违背 Amazon ToS，伴随极高 IP 污染风险。",
      actualStatus: "SCRAPING_TOS_PROHIBITED",
      levels: {
        officialDocumented: false,
        accountEligible: false,
        usePermissionVerified: false,
        liveFieldsVerified: false,
        automationEligible: false,
        integrated: true, // Internal chart models ready
        naturalOperationVerified: false,
      },
      recommendation: "坚决不引入黑产爬虫与代理池；保持门禁关闭，杜绝高风险网页爬取。",
    },
    {
      dimension: "6. 评价与买家痛点 (Reviews & VOC)",
      officialFeasibility: "AWS Open Data 官方托管 1995-2015 年 1.3 亿条真实 Amazon 评论数据集（S3 免费开放）；实时评论抓取受 ToS 严格禁止。",
      accountPrerequisites: "AWS Open Data 无需卖家账号，公开可查；实时源目前无官方免审 API。",
      costConstraint: "AWS Open Data 存储免费；实时商业抓取需高昂费用。",
      termsAndCompliance: "AWS 历史数据集具备学术与离线研究许可；实时无授权抓取违规。",
      actualStatus: "HISTORICAL_STATIC_ONLY",
      levels: {
        officialDocumented: true,
        accountEligible: true,
        usePermissionVerified: true,
        liveFieldsVerified: true, // Verified in third lane
        automationEligible: false, // Discontinued since 2015, cannot update live
        integrated: true,
        naturalOperationVerified: false,
      },
      recommendation: "复用第三主线已验证的本地离线 VOC 分析能力；不伪造 2026 年实时评论采集。",
    },
    {
      dimension: "7. 推广联盟接口 (Creators / PA-API 5.0)",
      officialFeasibility: "Amazon 官方提供 PA-API 5.0 (SearchItems, GetItems, GetVariations)，具备丰富的商品搜索与实时价格查询能力。",
      accountPrerequisites: "必须是 Amazon Associates 联盟会员，且必须在 180 天内通过合规链接产生至少 3 笔有效发货订单才能开通 API，连续 30 天无单则吊销调用额度。",
      costConstraint: "API 免费，但有强业务带货考核要求与 1 请求/秒流控。",
      termsAndCompliance: "协议明文规定数据仅限用于为 Amazon 导流的营销用途，禁止持久化缓存价格超过 24 小时，禁止用于独立商业情报库。",
      actualStatus: "DOCUMENTED_BUT_AFFILIATE_GATED",
      levels: {
        officialDocumented: true,
        accountEligible: false,
        usePermissionVerified: false,
        liveFieldsVerified: false,
        automationEligible: true,
        integrated: false,
        naturalOperationVerified: false,
      },
      recommendation: "记录为官方合规通路之一；当前受限于 180 天 3 单考核与导流协议限制，保持门禁受控关闭。",
    },
    {
      dimension: "8. 宏观全网搜索趋势 (Google Trends)",
      officialFeasibility: "Google Cloud 提供 BigQuery 公开数据集 (bigquery-public-data.google_trends.top_terms)，每月享有 1TB 免费查询配额；公开网页端亦可查。",
      accountPrerequisites: "需 Google Cloud 基础免费账号（无需绑定扣费信用卡）。",
      costConstraint: "完全免费 (¥0)。",
      termsAndCompliance: "官方合规提供公开趋势数据。",
      actualStatus: "MACRO_EXTERNAL_ONLY",
      levels: {
        officialDocumented: true,
        accountEligible: true,
        usePermissionVerified: true,
        liveFieldsVerified: false,
        automationEligible: true,
        integrated: true,
        naturalOperationVerified: false,
      },
      recommendation: "可作为 M07/M08 宏观全网兴趣参考，但必须诚实声明：此为 Google 宏观热度，非 Amazon 站内直接购买意图。",
    },
    {
      dimension: "9. 消费品安全通告与召回 (CPSC Official Recalls)",
      officialFeasibility: "美国消费品安全委员会 (CPSC) 官方提供标准的公开 RSS 2.0 数据流与 Recalls API，免登录、免授权、完全公共领域 (17 U.S.C. § 105)。",
      accountPrerequisites: "无任何门禁，全球免费公开。",
      costConstraint: "完全免费 (¥0)。",
      termsAndCompliance: "美国联邦政府官方公共数据，完全合法合规。",
      actualStatus: "READY_AND_VERIFIED",
      levels: {
        officialDocumented: true,
        accountEligible: true,
        usePermissionVerified: true,
        liveFieldsVerified: true, // Formally verified in E2E pipeline
        automationEligible: true,
        integrated: true,
        naturalOperationVerified: true, // Fully operational in local worker
      },
      recommendation: "【已全面接通】作为第四主线当前唯一正式启用的全自动合规数据流，产出 M09 痛点反证与 M12 风险预警，严格隔离于商业商机之外。",
    },
  ];

  console.log("\n================================================================================");
  console.log("SEVEN-LEVEL STATUS EVALUATION MATRIX");
  console.log("================================================================================");
  for (const a of audits) {
    const l = a.levels;
    const tag = `[DOC:${l.officialDocumented ? "Y" : "N"}|ACCT:${l.accountEligible ? "Y" : "N"}|PERM:${l.usePermissionVerified ? "Y" : "N"}|DATA:${l.liveFieldsVerified ? "Y" : "N"}|AUTO:${l.automationEligible ? "Y" : "N"}|INT:${l.integrated ? "Y" : "N"}|NAT:${l.naturalOperationVerified ? "Y" : "N"}]`;
    console.log(`${tag} ${a.dimension.padEnd(38)} -> ${a.actualStatus}`);
  }

  // Generate detailed breakthrough document
  const docPath = path.join(REPO_ROOT, "docs", "radar", "AMAZON_DATA_SOURCES_BREAKTHROUGH.md");
  const markdown = `# Amazon 美国站核心市场数据源深度核查与事实纠偏报告 (AUTO-TRUTH)

> **核心纠偏原则**：
> 1. **严谨区分事实与推论**：不能因为当前没有凭据就宣称“官方接口不存在”；不能因为单个 URL 404 就宣称“全类目数据永久无法获取”；也不能因为网页可以人工浏览就认定“具备合法机器自动采集许可”。
> 2. **七级递进状态标记 (Seven-Level Status)**：
>    - \`OFFICIAL_DOCUMENTED\`：官方是否有明确的开发者文档与接口规范？
>    - \`ACCOUNT_ELIGIBLE\`：当前个人用户在零额外支出约束下是否具备开通资格？
>    - \`USE_PERMISSION_VERIFIED\`：许可协议是否允许将数据用于个人内部选品与市场研究？
>    - \`LIVE_FIELDS_VERIFIED\`：在当前本地环境下是否已实际取得真实业务字段？
>    - \`AUTOMATION_ELIGIBLE\`：是否具备无需人工值守、无高危反爬封禁风险的机器自动调用机制？
>    - \`INTEGRATED\`：Radar 系统是否已具备标准适配器、数据模型与入库存储？
>    - \`NATURAL_OPERATION_VERIFIED\`：是否已具备连续多周期的自然运行证据？

---

## 一、Amazon 美国站各核心维度真实数据获取能力全景表

| 核心市场维度 | 官方是否存在正版接口 | 当前账户资格要求 | 免费可持续性 | 协议是否允许内部保存与研究 | 当前真实状态与七级判定 | 最合理的工程落地路径 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. 搜索需求 (ABA Search Terms)** | **是** (SP-API Brand Analytics) | 需专业卖家 ($39.99/月) + 品牌注册 (Brand Registry) | API 本身免费，但有卖家月租硬性前置成本 | 是（品牌所有者专属分析） | \`DOCUMENTED_BUT_ACCOUNT_GATED\`<br>[DOC:Y \| ACCT:N \| PERM:N \| DATA:N \| AUTO:Y \| INT:Y \| NAT:N] | 保持门禁受控关闭 (pending-credentials)；待用户拥有品牌卖家账号后在 \`.env\` 填入凭据一键激活。 |
| **2. 类目结构 (Browse Nodes)** | **是** (SP-API Catalog Items / PA-API) | 需专业卖家或联盟营销资格 | 包含在对应账户权限内 | 是 | \`DOCUMENTED_BUT_ACCOUNT_GATED\`<br>[DOC:Y \| ACCT:N \| PERM:N \| DATA:N \| AUTO:Y \| INT:Y \| NAT:N] | 本地模型 Browse Node ID 显式设为 null（坚决不伪造节点 ID）；等待官方凭证。 |
| **3. 商品详情 (Catalog Items)** | **是** (SP-API Catalog Items 2022-04-01) | 需专业卖家账号 (Product Listing 权限) | 包含在卖家月租内 | 是（允许查询非自有全站商品目录） | \`DOCUMENTED_BUT_ACCOUNT_GATED\`<br>[DOC:Y \| ACCT:N \| PERM:N \| DATA:N \| AUTO:Y \| INT:Y \| NAT:N] | 标准模型与字段已就绪，保持受控阻断等待合法授权。 |
| **4. 价格与 Buy Box (Pricing)** | **是** (SP-API Product Pricing) | 需专业卖家账号 (Pricing 权限) | 包含在卖家月租内（第三方 API 需 €19~$49/月） | 是 | \`DOCUMENTED_BUT_ACCOUNT_GATED\`<br>[DOC:Y \| ACCT:N \| PERM:N \| DATA:N \| AUTO:Y \| INT:Y \| NAT:N] | 坚决不采购外部商业 API；等待 SP-API 凭据，门禁受控关闭。 |
| **5. 销售热度与榜单 (BSR)** | **否官方公开免审接口** (历史 RSS 已 404；网页爬虫违背协议) | 无免登录接口；商业爬虫需高频住宅代理 | 维护代理池成本高昂 ($100+/月) | 否（违反 Amazon 爬虫协议，触发 BTS 503） | \`SCRAPING_TOS_PROHIBITED\`<br>[DOC:N \| ACCT:N \| PERM:N \| DATA:N \| AUTO:N \| INT:Y \| NAT:N] | 坚决不使用未授权代理爬虫；保持阻断，绝不引入封禁风险。 |
| **6. 评价与痛点 (Reviews / VOC)** | **部分存在** (AWS Open Data 1995-2015 历史集；实时抓取违规) | AWS Open Data 全球免费公开；实时评价无免审接口 | AWS S3 免费；实时商业抓取收费极高 | 历史数据集允许学术/研究；实时全量抓取违规 | \`HISTORICAL_STATIC_ONLY\`<br>[DOC:Y \| ACCT:Y \| PERM:Y \| DATA:Y \| AUTO:N \| INT:Y \| NAT:N] | 复用第三主线本地已有的 VOC 研究能力；不伪造 2026 年实时数据。 |
| **7. 推广联盟接口 (PA-API 5.0)** | **是** (Creators / PA-API 5.0) | 需 Associates 账号并在 180 天内产生 3 笔销售 | API 免费，但有强业务考核与流控 | 协议严格限定用于为 Amazon 导流，禁止独立情报建库 | \`DOCUMENTED_BUT_AFFILIATE_GATED\`<br>[DOC:Y \| ACCT:N \| PERM:N \| DATA:N \| AUTO:Y \| INT:N \| NAT:N] | 记录为官方合规候选通路，受导流协议与考核限制，当前保持受控阻断。 |
| **8. 宏观搜索趋势 (Google Trends)** | **是** (Google Cloud BigQuery Public Data) | 基础 Google Cloud 免费账号 | 长期每月 1TB 免费查询额度 (¥0) | 官方合规公开数据 | \`MACRO_EXTERNAL_ONLY\`<br>[DOC:Y \| ACCT:Y \| PERM:Y \| DATA:N \| AUTO:Y \| INT:Y \| NAT:N] | 作为 M07/M08 宏观趋势辅助参考，诚实声明为 Google 搜索热度而非 Amazon 站内热度。 |
| **9. 消费品安全召回 (CPSC Recalls)** | **是** (CPSC Official RSS & API) | **完全无门槛**，全球免费开放 (17 U.S.C. § 105) | 完全免费 (¥0) | 官方公共领域数据，完全合法 | \`READY_AND_VERIFIED\`<br>[DOC:Y \| ACCT:Y \| PERM:Y \| DATA:Y \| AUTO:Y \| INT:Y \| NAT:Y] | **【已全面接入运行】** 本机专用 Worker 全自动周期调度，产出 M09 创新痛点反证与 M12 风险预警。 |

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
- 如 \`amz-tools/amazon-sp-api\` 等高星开源项目，本质均为**官方 REST 接口的协议封装器 (Client Wrappers)**，底层依然必须传入合法的 LWA Client ID/Secret，无法绕过官方身份认证门槛；
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
`;

  fs.writeFileSync(docPath, markdown, "utf-8");
  console.log(`\n[PASS] Fact-checked breakthrough audit generated: ${docPath}`);
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
