import { chromium } from "playwright";
import * as path from "node:path";
import * as fs from "node:fs";

const WEB = "http://127.0.0.1:3000";
const API = "http://127.0.0.1:3001";
const ARTIFACT_DIR = "C:\\Users\\a2578\\.gemini\\antigravity\\brain\\d4cd9c37-14f7-4f30-89e4-0eab87110042\\screenshots";
const LOCAL_DIR = path.resolve(".data", "_diag", "shots-all");

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
fs.mkdirSync(LOCAL_DIR, { recursive: true });

interface PageTarget {
  id: string;
  name: string;
  category: string;
  path: string;
  viewport?: { width: number; height: number };
}

async function run() {
  console.log("Starting full site screenshot capture on port 3000...");

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
  });

  // Find sample item IDs
  let samplePolicyId = "";
  let sampleIndustryId = "";
  let sampleLeadId = "";

  try {
    const pRes = await fetch(`${API}/api/site/pool?lane=policy&page=1`);
    if (pRes.ok) {
      const pData: any = await pRes.json();
      samplePolicyId = pData.items?.[0]?.id || "";
    }
  } catch (e) {
    console.warn("Could not fetch policy sample ID:", e);
  }

  try {
    const indRes = await fetch(`${API}/api/site/industry?days=30`);
    if (indRes.ok) {
      const indData: any = await indRes.json();
      sampleIndustryId = indData.items?.[0]?.id || "";
    }
  } catch (e) {
    console.warn("Could not fetch industry sample ID:", e);
  }

  try {
    const lRes = await fetch(`${API}/api/site/leads?state=active`);
    if (lRes.ok) {
      const lData: any = await lRes.json();
      sampleLeadId = lData.items?.[0]?.id || "";
    }
  } catch (e) {
    console.warn("Could not fetch lead sample ID:", e);
  }

  console.log("Sample IDs:", { samplePolicyId, sampleIndustryId, sampleLeadId });

  const targets: PageTarget[] = [
    // 1. 核心情报主线 (Desktop)
    { id: "01_home", name: "情报中心首页", category: "四主线与真首页", path: "/" },
    { id: "02_policy_all", name: "01 平台政策情报", category: "四主线与真首页", path: "/all" },
    { id: "03_industry", name: "02 行业动态信息流", category: "四主线与真首页", path: "/industry" },
    { id: "04_voc", name: "03 消费者原声信息流", category: "四主线与真首页", path: "/voc" },
    { id: "05_market", name: "04 市场信号情报流", category: "四主线与真首页", path: "/market" },
    { id: "06_leads", name: "待核实政策线索池", category: "情报阅读与报告", path: "/leads" },

    // 2. 第四主线二级工作台与子页面 (Desktop)
    { id: "07_market_workbench", name: "市场 12 模块工程状态矩阵", category: "市场信号下钻工作台", path: "/market/workbench" },
    { id: "08_market_keywords", name: "搜索需求雷达与 ABA 追踪", category: "市场信号下钻工作台", path: "/market/keywords" },
    { id: "09_market_products", name: "商品与新品雷达 (BSR)", category: "市场信号下钻工作台", path: "/market/products" },
    { id: "10_market_opportunities", name: "商业可行性与情景计算器", category: "市场信号下钻工作台", path: "/market/opportunities" },
    { id: "11_market_alerts", name: "市场站内预警中心", category: "市场信号下钻工作台", path: "/market/alerts" },
    { id: "12_market_sources", name: "市场数据源监控与自动化调度", category: "市场信号下钻工作台", path: "/market/sources" },

    // 3. 第三主线消费者原声二级工具 (Desktop)
    { id: "13_voc_evidence", name: "消费者原声证据库", category: "消费者原声二级工具", path: "/voc/evidence" },
    { id: "14_voc_research", name: "痛点研究与高频需求看板", category: "消费者原声二级工具", path: "/voc/research" },
    { id: "15_voc_system", name: "VOC 来源历史与审核流", category: "消费者原声二级工具", path: "/voc/system" },

    // 4. 第二主线行业子页面 (Desktop)
    { id: "16_industry_daily", name: "行业动态每日精选", category: "行业动态工具", path: "/industry/daily" },

    // 5. 报告中心与阅读 (Desktop)
    { id: "17_daily_report", name: "情报日报", category: "情报阅读与报告", path: "/daily" },
    { id: "18_weekly_report", name: "情报周报", category: "情报阅读与报告", path: "/weekly" },
    { id: "19_monthly_report", name: "情报月报", category: "情报阅读与报告", path: "/monthly" },
    { id: "20_daily_archive", name: "历史报告归档库", category: "情报阅读与报告", path: "/daily/archive" },
    { id: "21_starred", name: "标星与收藏情报库", category: "情报阅读与报告", path: "/starred" },

    // 6. 详情页真实样本 (Desktop)
    ...(samplePolicyId ? [{ id: "22_policy_detail", name: "政策详情页样本", category: "详情页样本", path: `/items/${samplePolicyId}` }] : []),
    ...(sampleIndustryId ? [{ id: "23_industry_detail", name: "行业动态详情页样本", category: "详情页样本", path: `/industry/${sampleIndustryId}` }] : []),
    ...(sampleLeadId ? [{ id: "24_lead_detail", name: "政策线索详情页样本", category: "详情页样本", path: `/leads/${sampleLeadId}` }] : []),

    // 7. 平台辅助页面 (Desktop)
    { id: "25_more", name: "导航与功能全景 (更多)", category: "平台辅助与设置", path: "/more" },
    { id: "26_about", name: "关于轻选情报中心", category: "平台辅助与设置", path: "/about" },
    { id: "27_terms", name: "使用协议与免责声明", category: "平台辅助与设置", path: "/terms" },
    { id: "28_privacy", name: "隐私保护说明", category: "平台辅助与设置", path: "/privacy" },
    { id: "29_changelog", name: "系统演进与变更日志", category: "平台辅助与设置", path: "/changelog" },
    { id: "30_feedback", name: "建议与问题反馈", category: "平台辅助与设置", path: "/feedback" },

    // 8. 移动端 (Mobile 390x844)
    { id: "31_mobile_home", name: "移动端 · 情报首页", category: "移动端体验 (390px)", path: "/", viewport: { width: 390, height: 844 } },
    { id: "32_mobile_policy", name: "移动端 · 平台政策", category: "移动端体验 (390px)", path: "/all", viewport: { width: 390, height: 844 } },
    { id: "33_mobile_industry", name: "移动端 · 行业动态", category: "移动端体验 (390px)", path: "/industry", viewport: { width: 390, height: 844 } },
    { id: "34_mobile_voc", name: "移动端 · 消费者原声", category: "移动端体验 (390px)", path: "/voc", viewport: { width: 390, height: 844 } },
    { id: "35_mobile_market", name: "移动端 · 市场信号", category: "移动端体验 (390px)", path: "/market", viewport: { width: 390, height: 844 } },
    { id: "36_mobile_more", name: "移动端 · 更多导航", category: "移动端体验 (390px)", path: "/more", viewport: { width: 390, height: 844 } },
  ];

  console.log(`Starting capture for ${targets.length} pages...`);

  const manifest: Array<{ id: string; name: string; category: string; path: string; file: string; artifactPath: string }> = [];

  for (const t of targets) {
    const isMobile = !!t.viewport;
    const vp = t.viewport || { width: 1440, height: 900 };
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();

    const fullUrl = `${WEB}${t.path}`;
    try {
      await page.goto(fullUrl, { waitUntil: "networkidle", timeout: 15000 });
      await page.waitForTimeout(500);

      const fileName = `${t.id}.png`;
      const artifactFile = path.join(ARTIFACT_DIR, fileName);
      const localFile = path.join(LOCAL_DIR, fileName);

      await page.screenshot({ path: artifactFile, fullPage: false });
      fs.copyFileSync(artifactFile, localFile);

      manifest.push({
        id: t.id,
        name: t.name,
        category: t.category,
        path: t.path,
        file: fileName,
        artifactPath: artifactFile,
      });

      console.log(`[OK] Captured ${t.name} (${t.path}) -> ${fileName}`);
    } catch (err: any) {
      console.error(`[FAIL] ${t.name} (${t.path}):`, err.message);
    } finally {
      await ctx.close();
    }
  }

  await browser.close();

  fs.writeFileSync(
    path.join(ARTIFACT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );
  fs.writeFileSync(
    path.join(LOCAL_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2),
    "utf-8"
  );

  console.log(`\nAll done! Successfully captured ${manifest.length} screenshots.`);
}

run().catch((err) => {
  console.error("Capture process error:", err);
  process.exit(1);
});
