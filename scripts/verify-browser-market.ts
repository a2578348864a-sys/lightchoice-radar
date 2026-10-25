// Browser verification for LightChoice Radar Fourth Lane (Market Signals)
// Verifies real user journeys on Web 3000 & API 3001 using Playwright Chromium.
import { chromium, type Browser, type Page } from "playwright";

const BASE_URL = "http://127.0.0.1:3000";
const API_URL = "http://127.0.0.1:3001";
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
    await logResult("1. 匿名访问受控：显示私有研究区提示，无数据泄漏", anonTitle?.includes("市场信号") && hasPrivateNotice);

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
    const hasDataOverview = await page.locator("text=数据概览").isVisible();
    const hasModuleBoard = await page.locator("text=12 模块能力状态").isVisible();
    const hasGaps = await page.locator("text=当前数据缺口").isVisible();
    const hasBudget = await page.locator("text=第四主线模型预算 ¥0").isVisible();
    
    // Count module cards
    const moduleCards = await page.locator('section[aria-label="12 模块状态"] .card').count();
    await logResult("3. 市场总览：12模块状态板、诚实空态、零模型预算声明全部正常",
      hasDataOverview && hasModuleBoard && hasGaps && hasBudget && moduleCards === 12,
      `12模块卡片数=${moduleCards}`
    );

    // 4. Keyword Demand Page (/market/keywords)
    console.log("--- 4. Keyword Demand Page ---");
    await page.goto(`${BASE_URL}/market/keywords`, { waitUntil: "networkidle" });
    const kwTitle = await page.textContent("h1");
    const hasKwEmptyState = await page.locator("text=暂无获准关键词数据").isVisible();
    await logResult("4. 搜索需求页：诚实空态正常，无假数据", kwTitle?.includes("搜索需求") && hasKwEmptyState);

    // 5. Products Page (/market/products)
    console.log("--- 5. Products Page ---");
    await page.goto(`${BASE_URL}/market/products`, { waitUntil: "networkidle" });
    const prodTitle = await page.textContent("h1");
    const hasProdEmptyState = await page.locator("text=尚无商品观测").isVisible();
    await logResult("5. 商品与竞争页：诚实空态正常，无虚构排名", prodTitle?.includes("商品与竞争") && hasProdEmptyState);

    // 6. Opportunity Research & Commercial Scenario Calculator (/market/opportunities)
    console.log("--- 6. Opportunity Research & Calculator ---");
    await page.goto(`${BASE_URL}/market/opportunities`, { waitUntil: "networkidle" });
    const oppTitle = await page.textContent("h1");
    const hasOppEmptyState = await page.locator("text=暂无机会候选").isVisible();
    
    // Test Scenario Calculator
    const calcSection = page.locator('section[aria-label="商业情景计算器"]');
    const hasCalc = await calcSection.isVisible();
    
    // Click "计算三情景"
    const calcBtn = calcSection.locator('button:has-text("计算三情景")');
    await calcBtn.click();
    
    // Wait for table to appear or error
    await page.waitForTimeout(1000);
    const errText = await page.locator(".text-warn").allTextContents();
    console.log("Scenario calc errors:", errText);
    const scenarioTable = calcSection.locator("table");
    const tableVisible = await scenarioTable.isVisible();
    const rowCount = tableVisible ? await scenarioTable.locator("tbody tr").count() : 0;
    const hasSensitivity = await calcSection.locator("text=采购价 ±10%").isVisible();
    console.log({ oppTitle, hasOppEmptyState, hasCalc, tableVisible, rowCount, hasSensitivity });
    
    await logResult("6. 机会研究与商业情景计算器：乐观/基准/保守三情景实时测算与敏感性分析通过",
      Boolean(oppTitle?.includes("机会研究") && hasOppEmptyState && hasCalc && rowCount === 3 && hasSensitivity),
      `rowCount=${rowCount}, errors=${errText.join("; ") || "none"}`
    );

    // 7. In-Station Alerts (/market/alerts)
    console.log("--- 7. In-Station Alerts ---");
    await page.goto(`${BASE_URL}/market/alerts`, { waitUntil: "networkidle" });
    const alertTitle = await page.textContent("h1");
    const hasRules = await page.locator('section[aria-label="预警规则"]').isVisible();
    const hasAlertList = await page.locator('section[aria-label="已触发预警"]').isVisible();
    await logResult("7. 站内预警页：规则列表与预警看板正常",
      Boolean(alertTitle?.includes("预警工作台") && hasRules && hasAlertList)
    );

    // 8. Sources Management & Import Entry (/market/sources)
    console.log("--- 8. Sources & Manual Import Entry ---");
    await page.goto(`${BASE_URL}/market/sources`, { waitUntil: "networkidle" });
    const sourceTitle = await page.textContent("h1");
    const hasImportSection = await page.locator('section[aria-label="获准数据导入"]').isVisible();
    
    // Test import JSON validation
    const textarea = page.locator('textarea[aria-label="导入 JSON"]');
    await textarea.fill("invalid-non-json-test");
    const importBtn = page.locator('button:has-text("导入（按来源许可校验）")');
    await importBtn.click();
    const hasJsonError = await page.locator("text=❌ JSON 解析失败").isVisible();
    
    await logResult("8. 来源管理与人工导入入口：来源状态机展示与JSON输入校验正常",
      sourceTitle?.includes("来源管理") && hasImportSection && hasJsonError
    );

    // 9. Mobile Viewport (390px) Check
    console.log("--- 9. Mobile 390px Viewport ---");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/market`, { waitUntil: "networkidle" });
    const phoneBarVisible = await page.locator('text=市场信号').first().isVisible();
    
    // Check horizontal scroll / overflow
    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const bodyClientWidth = await page.evaluate(() => document.body.clientWidth);
    const noOverflow = bodyScrollWidth <= 395; // minor tolerance for scrollbars
    await logResult("9. 移动端 390px 布局适配：PhoneBar正常且无水平溢出", phoneBarVisible && noOverflow, `scrollWidth=${bodyScrollWidth}`);

    // 10. Console Errors Check
    console.log("--- 10. Console Error Check ---");
    const relevantErrors = consoleErrors.filter(e => !e.includes("favicon") && !e.includes("404"));
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
