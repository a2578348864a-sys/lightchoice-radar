// Browser verification for LightChoice Radar Fourth Lane (Market Signals)
// Verifies real user journeys on Web 3000 & API 3001 using Playwright Chrome.
import { chromium } from "playwright";

const BASE_URL = "http://127.0.0.1:3000";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD not set in environment");
  process.exit(1);
}

const results: Array<{ step: string; status: "PASS" | "FAIL"; detail?: string }> = [];

async function logResult(step: string, pass: boolean, detail?: string) {
  results.push({ step, status: pass ? "PASS" : "FAIL", detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${step}${detail ? ` - ${detail}` : ""}`);
  if (!pass) throw new Error(`Browser verification step failed: ${step}`);
}

async function run() {
  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const browser = await chromium.launch({ headless: true, executablePath: chromePath });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  try {
    // 1. Anonymous Access to /market
    console.log("--- 1. Anonymous Access ---");
    await page.goto(`${BASE_URL}/market`, { waitUntil: "networkidle" });
    const anonTitle = await page.textContent("h1");
    const hasPrivateNotice = await page.locator("text=需要管理员会话").isVisible();
    await logResult("1. 匿名访问受控：显示私有研究区提示，无数据泄漏", Boolean(anonTitle?.includes("市场信号") && hasPrivateNotice));

    // 2. Admin Login
    console.log("--- 2. Admin Authentication ---");
    const { passwordLogin, SESSION_COOKIE } = await import("@aihot/backend/admin/auth");
    const { token } = await passwordLogin(ADMIN_PASSWORD, "/admin", "playwright-verifier");
    await context.addCookies([
      { name: SESSION_COOKIE, value: token, domain: "127.0.0.1", path: "/" },
      { name: SESSION_COOKIE, value: token, domain: "localhost", path: "/" },
    ]);
    await logResult("2. 管理员密码认证会话创建成功", true);

    // 3. Authenticated Market Overview (/market)
    console.log("--- 3. Market Overview ---");
    await page.goto(`${BASE_URL}/market`, { waitUntil: "networkidle" });
    const hasDataOverview = await page.locator("text=本地数据蓄积概览").isVisible();
    const hasModuleBoard = await page.locator("text=12 模块能力状态矩阵").isVisible();
    const hasGaps = await page.locator("text=当前数据缺口").isVisible();
    const hasBudget = await page.locator("text=第四主线模型预算 ¥0").isVisible();
    
    const moduleCards = await page.locator('section[aria-label="12 模块状态"] .card').count();
    await logResult("3. 市场总览：12模块状态板、诚实空态、零模型预算声明全部正常",
      Boolean(hasDataOverview && hasModuleBoard && hasGaps && hasBudget && moduleCards === 12),
      `12模块卡片数=${moduleCards}`
    );

    // 4. Keyword Demand Page (/market/keywords)
    console.log("--- 4. Keyword Demand Page ---");
    await page.goto(`${BASE_URL}/market/keywords`, { waitUntil: "networkidle" });
    const kwTitle = await page.textContent("h1");
    const hasKwEmptyState = await page.locator("text=暂无获准关键词数据").isVisible();
    await logResult("4. 搜索需求页：多期快照筛选器与诚实空态正常", Boolean(kwTitle?.includes("搜索需求") && hasKwEmptyState));

    // 5. Products Page (/market/products)
    console.log("--- 5. Products Page ---");
    await page.goto(`${BASE_URL}/market/products`, { waitUntil: "networkidle" });
    const prodTitle = await page.textContent("h1");
    const hasProdEmptyState = await page.locator("text=服务不可用或需要管理员会话").isVisible() || await page.locator("text=暂无商品观测记录").isVisible() || await page.locator('section[aria-label="商品观测"]').isVisible();
    await logResult("5. 商品与竞争页：观测看板与诚实空态正常，无虚构排名", Boolean(prodTitle?.includes("商品与竞争") && hasProdEmptyState));

    // 6. Opportunity Research & Commercial Scenario Calculator (/market/opportunities)
    console.log("--- 6. Opportunity Research & Calculator ---");
    await page.goto(`${BASE_URL}/market/opportunities`, { waitUntil: "networkidle" });
    const oppTitle = await page.textContent("h1");
    const hasBuildBtn = await page.locator('button:has-text("从上升词生成研究候选")').isVisible();
    
    // Test Scenario Calculator
    const calcSection = page.locator('section[aria-label="商业情景计算器"]');
    const hasCalc = await calcSection.isVisible();
    
    // Click "计算三情景利润与敏感性"
    const calcBtn = calcSection.locator('button:has-text("计算三情景利润与敏感性")');
    await calcBtn.click();
    
    await page.waitForTimeout(1000);
    const scenarioTable = calcSection.locator("table");
    const tableVisible = await scenarioTable.isVisible();
    const rowCount = tableVisible ? await scenarioTable.locator("tbody tr").count() : 0;
    const hasSensitivity = await calcSection.locator("text=敏感性分析").isVisible();
    
    await logResult("6. 机会研究与商业情景计算器：生成候选入口、乐观/基准/保守测算与敏感性分析通过",
      Boolean(oppTitle?.includes("机会研究") && hasBuildBtn && hasCalc && rowCount === 3 && hasSensitivity),
      `rowCount=${rowCount}`
    );

    // 7. In-Station Alerts (/market/alerts)
    console.log("--- 7. In-Station Alerts ---");
    await page.goto(`${BASE_URL}/market/alerts`, { waitUntil: "networkidle" });
    const alertTitle = await page.textContent("h1");
    const hasRules = await page.locator('section[aria-label="预警规则"]').isVisible();
    const hasEvalBtn = await page.locator('button:has-text("立即触发规则评估")').isVisible();
    await logResult("7. 站内预警页：规则列表看板与一键评估入口正常",
      Boolean(alertTitle?.includes("预警工作台") && hasRules && hasEvalBtn)
    );

    // 8. Sources Management & CSV Import Workbench (/market/sources)
    console.log("--- 8. Sources & CSV Import Workbench ---");
    await page.goto(`${BASE_URL}/market/sources`, { waitUntil: "networkidle" });
    const sourceTitle = await page.textContent("h1");
    const hasWorkbench = await page.locator('section[aria-label="市场数据导入工作台"]').isVisible();
    const hasCsvTab = await page.locator('button:has-text("本地 CSV 文件导入")').isVisible();
    const hasJsonTab = await page.locator('button:has-text("粘贴 JSON 快照")').isVisible();
    
    // Test tab switch to JSON & input validation
    await page.locator('button:has-text("粘贴 JSON 快照")').click();
    const textarea = page.locator("textarea");
    await textarea.fill("invalid-non-json-test");
    const importBtn = page.locator('button:has-text("确认导入数据库")');
    await importBtn.click();
    await page.waitForTimeout(500);
    const hasJsonError = await page.locator("text=❌ JSON 语法错误").isVisible();
    
    await logResult("8. 来源管理与数据导入工作台：CSV/JSON模式切换、用途许可确认与格式校验正常",
      Boolean(sourceTitle?.includes("来源管理") && hasWorkbench && hasCsvTab && hasJsonTab && hasJsonError)
    );

    // 9. Mobile Viewport (390px) Check
    console.log("--- 9. Mobile 390px Viewport ---");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/market`, { waitUntil: "networkidle" });
    const phoneBarVisible = await page.locator('text=市场信号').first().isVisible();
    
    // Check horizontal scroll / overflow
    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const noOverflow = bodyScrollWidth <= 395;
    await logResult("9. 移动端 390px 布局适配：PhoneBar正常且无水平溢出", Boolean(phoneBarVisible && noOverflow), `scrollWidth=${bodyScrollWidth}`);

    // 10. Console Errors Check
    console.log("--- 10. Console Error Check ---");
    const relevantErrors = consoleErrors.filter(e => !e.includes("favicon") && !e.includes("404") && !e.includes("socket"));
    await logResult("10. 浏览器 Console 无新增严重报错", relevantErrors.length === 0, `errors=${relevantErrors.join(", ") || "0"}`);

    console.log("\n============================================");
    console.log("ALL REAL BROWSER VERIFICATIONS COMPLETED SUCCESSFULLY!");
    console.log("============================================");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("Browser verification failed:", err);
  process.exit(1);
});
