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
    const hasSafetyCounter = await page.locator("text=CPSC 安全反证").isVisible();
    
    const moduleCards = await page.locator('section[aria-label="12 模块状态"] .card').count();
    await logResult("3. 市场总览：12模块状态板、诚实空态、零模型预算与安全反证计数全部正常",
      Boolean(hasDataOverview && hasModuleBoard && hasGaps && hasBudget && hasSafetyCounter && moduleCards === 12),
      `12模块卡片数=${moduleCards}, safetyCounter=${hasSafetyCounter}`
    );

    // 4. Keyword Demand Page (/market/keywords)
    console.log("--- 4. Keyword Demand Page ---");
    await page.goto(`${BASE_URL}/market/keywords`, { waitUntil: "networkidle" });
    const kwTitle = await page.textContent("h1");
    const hasKwContent = await page.locator('section[aria-label="数据来源说明"]').isVisible() || await page.locator("text=当前没有已获准的自动数据来源").isVisible();
    const hasNoManualUploadPrompt = !(await page.locator("text=上传 CSV").isVisible());
    await logResult("4. 搜索需求页：多期快照筛选器与诚实空态正常，无手工上传引导", Boolean(kwTitle?.includes("搜索需求") && hasKwContent && hasNoManualUploadPrompt));

    // 5. Products Page (/market/products)
    console.log("--- 5. Products Page ---");
    await page.goto(`${BASE_URL}/market/products`, { waitUntil: "networkidle" });
    const prodTitle = await page.textContent("h1");
    const hasProdContent = await page.locator('section[aria-label="榜单快照"]').isVisible() || await page.locator("text=当前 Amazon 商品级自动采集保持安全阻断").isVisible() || await page.locator("text=商品观测依赖获准的官方商品").isVisible();
    const hasNoProdUploadPrompt = !(await page.locator("text=上传商品或榜单数据").isVisible());
    await logResult("5. 商品与竞争页：观测看板与安全阻断空态正常，无手工上传提示", Boolean(prodTitle?.includes("商品与竞争") && hasProdContent && hasNoProdUploadPrompt));

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

    // 8. Auto Source Governance & Scheduler Dashboard (/market/sources)
    console.log("--- 8. Auto Source Governance & Scheduler Dashboard ---");
    await page.goto(`${BASE_URL}/market/sources`, { waitUntil: "networkidle" });
    const sourceTitle = await page.textContent("h1");
    const hasScheduleSection = await page.locator('section[aria-label="调度执行与操作"]').isVisible();
    const hasSchedulerBadge = await page.locator("text=后台调度器").isVisible();
    const triggerBtn = page.locator('button:has-text("立即触发到期自动采集与分析")');
    const hasTriggerBtn = await triggerBtn.isVisible();
    const hasSourceLedger = await page.locator('section[aria-label="来源台账"]').isVisible();

    // Verify completely ZERO file upload elements exist
    const fileInputCount = await page.locator('input[type="file"]').count();
    const hasDragDropZone = await page.locator("text=点击或拖拽 CSV 文件至此处").isVisible();
    const hasExcelGuide = await page.locator("text=Excel (.xlsx)").isVisible();

    // Trigger auto scheduler
    await triggerBtn.click();
    await page.locator("text=自动调度执行完成").waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    const hasRunFeedback = await page.locator("text=自动调度执行完成").isVisible();

    await logResult("8. 自动来源管理与调度看板：调度器在线状态探针、一键触发自动调度、零文件上传残留",
      Boolean(sourceTitle?.includes("自动来源") && hasScheduleSection && hasSchedulerBadge && hasTriggerBtn && hasSourceLedger && fileInputCount === 0 && !hasDragDropZone && !hasExcelGuide && hasRunFeedback),
      `fileInputs=${fileInputCount}, triggerExecuted=${hasRunFeedback}, schedulerBadge=${hasSchedulerBadge}`
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
