# Amazon 美国站核心市场数据源深度突破与 14 维度价值评估报告
## LightChoice Radar｜AUTO-ACTIVATE 调查与最小真实验证交付

> **调查结论先行**：
> 在**零额外支出（¥0 采购）**、**无个人专业卖家账号（$39.99/月）**、**无品牌注册（Brand Registry）**的前提下：
> **当前市场上不存在既合法、稳定、免费、又具备官方正版 Amazon 美国站实时商业/搜索/销售数据的外部 API**。
>
> 任何宣称“零成本全自动获取 Amazon 站内搜索热词与真实销量”的现成方案，本质均为**高频爬虫与黑产代理轮换（严重违背 ToS 并伴随频繁 IP 封禁与反爬中断）**，或**限期几天的商业试用陷阱**。
>
> 本系统坚持 **第一性原理与合规防伪底线**：
> 1. 唯一合法稳定且零成本的外部自动化来源：**美国 CPSC 官方消费品安全通告**（已实现单 Run ID 闭环，定位于合规避坑反证，绝不伪造为商业商机）；
> 2. 对核心商业维度（ABA 需求、榜单商品）：系统已具备完善标准模型与插拔式接入点（SP-API / PA-API 适配器结构），在没有合法免费凭证前，**保持门禁受控关闭（fail-closed）**，绝不通过黑灰产爬虫破坏系统稳定性。

---

## 一、真实网络与渠道探测实证

| 渠道类别 | 目标维度 | 真实探测证据 | 官方门禁与费用边界 | 最终结论 |
| :--- | :--- | :--- | :--- | :--- |
| **Amazon 官方历史公开 RSS** | BSR、类目榜单 | 真实 HTTP 探测返回 404 / 重定向至主页 | Amazon 早在 2018 年前后已全线下线公共 RSS 接口 | **永久废弃 (DEPRECATED)** |
| **Amazon 网页公开抓取** | 商品、价格、榜单 | robots.txt 显式 `Disallow: /gp/bestsellers/`，BTS 防火墙直接返回 HTTP 503 / 验证码拦截 | 违反用户协议，面临 IP 封锁与高维护成本 | **严禁引入 (GATE_CLOSED)** |
| **官方 SP-API (Catalog/Pricing)** | 类目节点、商品、价格 | 依赖 LWA OAuth2 + AWS SigV4 认证 | 必须活跃专业卖家账号 ($39.99/月) + DPP 数据保护审核 | **凭证阻断 (BLOCKED_SELLER)** |
| **官方 SP-API (Brand Analytics)** | 搜索词排名 (ABA) | 依赖 Brand Analytics 专用 Report 接口 | 必须专业卖家 + 官方品牌注册 (Brand Registry) | **凭证阻断 (BLOCKED_BRAND)** |
| **官方 PA-API 5.0** | 商品详情、关联推荐 | 依赖 Associates 签名请求 | 必须加入联盟并在 180 天内产生 3 笔合规订单且持续有单 | **门禁阻断 (BLOCKED_AFFILIATE)** |
| **Keepa API** | 历史价格、BSR | 免费版每分钟仅 1 token 且掩盖 BSR / Buy Box 核心数据 | 基础版 €19/月（约合 ¥150/月），超出零预算 | **付费阻断 (PAID_WALL)** |
| **Rainforest API** | 搜索、商品、评论 | 仅提供 100 次单次试用点数，用完即停 | 基础版 $49/月（约合 ¥350/月），超出零预算 | **付费阻断 (PAID_WALL)** |
| **AWS Open Data 评价集** | 历史评论与买家痛点 | 托管在 S3，免费提供 1.3 亿条历史评论 | 数据仅截止至 2015 年，缺乏 2026 年即时性 | **静态历史 (HISTORICAL)** |
| **Google Trends** | 宏观全网搜索趋势 | 公开网页与 BigQuery 免费额度可查 | 衡量 Google 全网兴趣，非 Amazon 站内购买频次 | **参考辅助 (MACRO_ONLY)** |
| **美国 CPSC 官方召回流** | 强制合规、结构避坑 | 官方 XML RSS 稳定输出，已实测单 Run ID 追溯 | 免费公共数据，零门禁，零费用 | **正式启用 (ADOPT_NOW)** |

---

## 二、14 维度覆盖状态矩阵

| 序号 | 维度名称 | 当前状态 | 实现与覆盖说明 |
| :--- | :--- | :--- | :--- |
| 1 | **搜索需求 (ABA / Search Terms)** | `BLOCKED_PENDING_CREDENTIALS` | SP-API ABA 接口已备好标准数据映射结构；门禁受控关闭，绝不使用模拟假数据 |
| 2 | **类目结构与节点 (Browse Nodes)** | `MODEL_READY` | 数据模型已定义，严格禁止分词推断虚构 Amazon Browse Node ID（当前显式为 null） |
| 3 | **商品详情 (Catalog / Details)** | `MODEL_READY` | 数据模型已定义，支持 ASIN、Title、Brand 结构，待官方凭证激活 |
| 4 | **价格与 Buy Box (Pricing)** | `BLOCKED_PAID_WALL` | 需专业卖家凭证或 Keepa 付费订阅，零预算下保持门禁关闭 |
| 5 | **销售排行与热度 (BSR)** | `BLOCKED_BY_POLICY` | 公开 RSS 已失效；严禁引入违反 ToS 的高风险网页爬虫 |
| 6 | **评价与声量 (Reviews / VOC)** | `ACTIVE_LOCAL` | 本项目第三主线本地离线分析链路已支持；AWS 1995-2015 库可用作离线基准 |
| 7 | **卖家与品牌格局 (Sellers)** | `BLOCKED_PENDING_CREDENTIALS` | 需 SP-API 品牌所有者权限 |
| 8 | **广告竞价与出价 (PPC)** | `BLOCKED_PENDING_CREDENTIALS` | 需 Amazon Ads API 广告主授权 |
| 9 | **促销与秒杀 (Deals / Coupons)** | `BLOCKED_BY_POLICY` | 无官方公开免费 API |
| 10 | **关联搭配与组合 (Bundles)** | `BLOCKED_AFFILIATE` | 依赖 PA-API 5.0，门禁受阻 |
| 11 | **存量与断货 (Stock / Inventory)** | `BLOCKED_SELLER` | 属于卖家私有 FBA 数据 |
| 12 | **退货与避坑缺陷 (Pains / Safety)** | `ACTIVE_AUTOMATED` | **【已全面接通】** CPSC 官方公开召回流自动采集并生成 M09 痛点反证 |
| 13 | **知识产权与专利 (IP / Trademarks)** | `MANUAL_LOOKUP` | USPTO 公共查询通道，暂未纳入周期调度 |
| 14 | **强制合规与召回 (Compliance)** | `ACTIVE_AUTOMATED` | **【已全面接通】** CPSC 官方数据流全自动周期运行，带单 Run ID 全链追溯 |

---

## 三、用户操作指南：未来如何启用核心来源？

若用户未来获得合法的 Amazon 专业卖家账号或商业 API 凭证，本系统提供了**极简且单一的插拔式配置入口**：

1. **配置环境变量**（在 `.env` 中填入）：
   ```bash
   # Amazon SP-API 配置示例（仅在获得官方授权后填写）
   SP_API_CLIENT_ID=amzn1.application-oa2-client.xxxx
   SP_API_CLIENT_SECRET=xxxx
   SP_API_REFRESH_TOKEN=Atzr|xxxx
   AWS_ACCESS_KEY_ID=AKIAxxxx
   AWS_SECRET_ACCESS_KEY=xxxx
   AWS_ROLE_ARN=arn:aws:iam::xxxx:role/sp-api-role
   ```
2. **在管理界面激活来源**：
   - 打开浏览器访问 `http://127.0.0.1:3000/market/sources`；
   - 将对应来源的状态由 `blocked` 切换为 `authorized-periodic`；
   - 系统将自动纳入后台 Worker 调度队列，无需修改任何底层代码。
