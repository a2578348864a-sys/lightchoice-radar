// Playwright browser acceptance test for Four Lanes Integration & Policy Boundary Verification
import { chromium } from "playwright";
import * as path from "node:path";
import * as fs from "node:fs";

const BASE_URL = "http://127.0.0.1:3000";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD not set in environment");
  process.exit(1);
}

const SCRATCH_DIR = "C:\\Users\\a2578\\.gemini\\antigravity\\brain\\86a65d3c-7c26-4b2a-8e44-14dbb045e3b5\\scratch";
if (!fs.existsSync(SCRATCH_DIR)) {
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });
}

interface TestStepResult {
  step: string;
  passed: boolean;
  details?: string;
}

const stepResults: TestStepResult[] = [];

function record(step: string, passed: boolean, details?: string) {
  stepResults.push({ step, passed, details });
  const mark = passed ? "[PASS]" : "[FAIL]";
  console.log(`${mark} ${step}${details ? ` -> ${details}` : ""}`);
  if (!passed) {
    throw new Error(`Step failed: ${step} (${details ?? "no detail"})`);
  }
}

async function run() {
  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
  });

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  // ==========================================
  // PART 1: Desktop Viewport (1440x900) - Unauthenticated
  // ==========================================
  console.log("\n==========================================");
  console.log("PART 1: Desktop 1440px - Unauthenticated Visitor");
  console.log("==========================================");

  const anonContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const page = await anonContext.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(`[Console Error] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => {
    pageErrors.push(`[Page Error] ${err.message}`);
  });

  // 1.1 Home page and sidebar four lanes
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(SCRATCH_DIR, "00-desktop-home.png") });

  const navSection = page.locator('nav[aria-label="主导航"]');
  const navText = await navSection.innerText();
  const has01 = navText.includes("01 平台政策");
  const has02 = navText.includes("02 行业动态");
  const has03 = navText.includes("03 消费者原声");
  const has04 = navText.includes("04 市场信号");

  record("1.1 桌面端侧边栏四条主线导航完整呈现", has01 && has02 && has03 && has04, `01:${has01}, 02:${has02}, 03:${has03}, 04:${has04}`);

  // 1.2 Lane 1: Platform Policy (/all) clean boundary check
  console.log("\n--- Checking Lane 1: Platform Policy (/all) ---");
  await page.click('nav[aria-label="主导航"] a[href="/all"]');
  await page.waitForURL(`${BASE_URL}/all`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(SCRATCH_DIR, "01-desktop-policy-clean.png") });

  const policyTitle = await page.textContent("h1");
  const hasPolicyTitle = policyTitle?.includes("平台政策") || policyTitle?.includes("政策");

  // Check sources filter: Home Assistant and Wyze must NOT be present
  const filterSection = await page.locator("section").first().innerText().catch(() => "");
  const pageContent = await page.content();
  const hasHACommunity = pageContent.includes("rss-home-assistant-community") || pageContent.includes("Home Assistant 社区");
  const hasWyzeCommunity = pageContent.includes("rss-wyze-community") || pageContent.includes("Wyze 社区");

  record("1.2 第一主线平台政策内容池纯净性验证（无智能家居社区讨论）", !hasHACommunity && !hasWyzeCommunity, `HomeAssistant泄漏:${hasHACommunity}, Wyze泄漏:${hasWyzeCommunity}`);

  // 1.3 Lane 2: Industry Dynamics (/industry)
  console.log("\n--- Checking Lane 2: Industry Dynamics (/industry) ---");
  await page.click('nav[aria-label="主导航"] a[href="/industry"]');
  await page.waitForURL(`${BASE_URL}/industry`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(SCRATCH_DIR, "02-desktop-industry.png") });

  const indTitle = await page.textContent("h1");
  record("1.3 第二主线行业动态工作台正常载入", Boolean(indTitle?.includes("行业动态") || indTitle?.includes("行业")), `Title=${indTitle}`);

  // 1.4 Lane 3: VOC (/voc) - Unauthenticated Auth Gate
  console.log("\n--- Checking Lane 3: VOC (/voc) Auth Gate ---");
  await page.click('nav[aria-label="主导航"] a[href="/voc"]');
  await page.waitForURL(`${BASE_URL}/voc`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(SCRATCH_DIR, "03-desktop-voc-auth-gate.png") });

  const vocGateVisible = await page.locator("text=消费者原声工作台需要管理员权限").isVisible();
  const vocGateExplain = await page.locator("text=为本地个人私有研究工作台，当前为未登录访客状态").isVisible();
  const vocLoginLink = await page.locator("text=立即登录管理员").isVisible();
  record("1.4 第三主线 VOC 匿名访问拦截引导正常（透明提示管理员权限）", vocGateVisible && vocGateExplain && vocLoginLink, `gate=${vocGateVisible}, explain=${vocGateExplain}, loginLink=${vocLoginLink}`);

  // 1.5 Lane 4: Market Signals (/market) - Unauthenticated Auth Gate
  console.log("\n--- Checking Lane 4: Market Signals (/market) Auth Gate ---");
  await page.click('nav[aria-label="主导航"] a[href="/market"]');
  await page.waitForURL(`${BASE_URL}/market`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(SCRATCH_DIR, "04-desktop-market-auth-gate.png") });

  const mktGateVisible = await page.locator("text=市场信号工作台需要管理员权限").isVisible();
  const mktGateExplain = await page.locator("text=为本地个人私有研究工作台，当前为未登录访客状态").isVisible();
  const mktLoginLink = await page.locator("text=立即登录管理员").isVisible();
  record("1.5 第四主线市场信号匿名访问拦截引导正常（透明提示管理员权限）", mktGateVisible && mktGateExplain && mktLoginLink, `gate=${mktGateVisible}, explain=${mktGateExplain}, loginLink=${mktLoginLink}`);

  await anonContext.close();

  // ==========================================
  // PART 2: Desktop Viewport (1440x900) - Authenticated Admin
  // ==========================================
  console.log("\n==========================================");
  console.log("PART 2: Desktop 1440px - Authenticated Admin");
  console.log("==========================================");

  const authContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  const authPage = await authContext.newPage();

  authPage.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(`[Auth Console Error] ${msg.text()}`);
    }
  });
  authPage.on("pageerror", (err) => {
    pageErrors.push(`[Auth Page Error] ${err.message}`);
  });

  // Perform backend session generation using passwordLogin
  const { passwordLogin, SESSION_COOKIE } = await import("@aihot/backend/admin/auth");
  const { token } = await passwordLogin(ADMIN_PASSWORD, "/admin", "playwright-four-lanes-verifier");
  await authContext.addCookies([
    { name: SESSION_COOKIE, value: token, domain: "127.0.0.1", path: "/" },
    { name: SESSION_COOKIE, value: token, domain: "localhost", path: "/" },
  ]);

  // 2.1 Authenticated Lane 3: VOC Overview (/voc)
  console.log("\n--- Checking Authenticated Lane 3: VOC (/voc) ---");
  await authPage.goto(`${BASE_URL}/voc`, { waitUntil: "networkidle" });
  await authPage.screenshot({ path: path.join(SCRATCH_DIR, "05-desktop-voc-authed.png") });

  const vocAuthedGate = await authPage.locator("text=消费者原声工作台需要管理员权限").isVisible();
  const vocHeader = await authPage.textContent("h1");
  const hasVocOverview = !vocAuthedGate && (vocHeader?.includes("消费者原声") || vocHeader?.includes("VOC"));
  record("2.1 第三主线 VOC 管理员会话下正常展示私有研究面板", hasVocOverview, `AuthGateGone=${!vocAuthedGate}, Header=${vocHeader}`);

  // 2.2 VOC Sub-page & Breadcrumbs (/voc/evidence)
  console.log("\n--- Checking Lane 3 Sub-page: VOC Evidence (/voc/evidence) ---");
  await authPage.goto(`${BASE_URL}/voc/evidence`, { waitUntil: "networkidle" });
  await authPage.screenshot({ path: path.join(SCRATCH_DIR, "05b-desktop-voc-evidence.png") });

  const vocBreadcrumb = await authPage.locator('nav[aria-label="面包屑导航"]').innerText().catch(() => "");
  const hasVocBreadcrumb = vocBreadcrumb.includes("消费者原声") && vocBreadcrumb.includes("证据库");
  record("2.2 第三主线证据库子页面与面包屑导航正常", hasVocBreadcrumb, `Breadcrumb=${vocBreadcrumb.replace(/\n/g, " ")}`);

  // 2.3 Authenticated Lane 4: Market Signals Overview (/market)
  console.log("\n--- Checking Authenticated Lane 4: Market Signals (/market) ---");
  await authPage.goto(`${BASE_URL}/market`, { waitUntil: "networkidle" });
  await authPage.screenshot({ path: path.join(SCRATCH_DIR, "06-desktop-market-authed.png") });

  const mktAuthedGate = await authPage.locator("text=市场信号工作台需要管理员权限").isVisible();
  const hasMatrix = await authPage.locator("text=12 模块能力状态矩阵").isVisible();
  const hasDataOverview = await authPage.locator("text=本地数据蓄积概览").isVisible();
  const hasBudgetZero = await authPage.locator("text=第四主线模型预算 ¥0").isVisible();
  const hasCpscCounter = await authPage.locator("text=CPSC 安全反证").isVisible();
  const moduleCards = await authPage.locator('section[aria-label="12 模块状态"] .card').count();

  record("2.3 第四主线市场信号总览看板正常（12模块矩阵、¥0预算、CPSC安全反证）",
    !mktAuthedGate && hasMatrix && hasDataOverview && hasBudgetZero && hasCpscCounter && moduleCards === 12,
    `GateGone=${!mktAuthedGate}, Matrix=${hasMatrix}, BudgetZero=${hasBudgetZero}, CPSC=${hasCpscCounter}, Cards=${moduleCards}`
  );

  // 2.4 Market Opportunities Sub-page (/market/opportunities)
  console.log("\n--- Checking Lane 4 Sub-page: Opportunities (/market/opportunities) ---");
  await authPage.goto(`${BASE_URL}/market/opportunities`, { waitUntil: "networkidle" });
  await authPage.screenshot({ path: path.join(SCRATCH_DIR, "07-desktop-market-opportunities.png") });

  const oppBreadcrumb = await authPage.locator('nav[aria-label="面包屑导航"]').innerText().catch(() => "");
  const hasOppBreadcrumb = oppBreadcrumb.includes("市场信号") && oppBreadcrumb.includes("机会研究");
  const hasCalc = await authPage.locator("text=三情景商业可行性计算器").isVisible();
  record("2.4 第四主线机会研究工作台及面包屑正常", hasOppBreadcrumb && hasCalc, `Breadcrumb=${oppBreadcrumb.replace(/\n/g, " ")}, Calc=${hasCalc}`);

  // 2.5 Market Sources Sub-page & Diagnostic Trigger Button (/market/sources)
  console.log("\n--- Checking Lane 4 Sub-page: Sources & Trigger Buttons (/market/sources) ---");
  await authPage.goto(`${BASE_URL}/market/sources`, { waitUntil: "networkidle" });
  await authPage.screenshot({ path: path.join(SCRATCH_DIR, "08-desktop-market-sources.png") });

  const srcBreadcrumb = await authPage.locator('nav[aria-label="面包屑导航"]').innerText().catch(() => "");
  const hasSrcBreadcrumb = srcBreadcrumb.includes("市场信号") && (srcBreadcrumb.includes("自动来源") || srcBreadcrumb.includes("来源"));
  const hasNormalTriggerBtn = await authPage.locator("text=立即触发到期自动采集与分析").isVisible();
  const hasDiagTriggerBtn = await authPage.locator("text=强制重算全部来源（诊断用）").isVisible();

  record("2.5 第四主线自动化来源看板及触发按钮双态支持（常规到期触发 + 诊断重算按钮）",
    hasSrcBreadcrumb && hasNormalTriggerBtn && hasDiagTriggerBtn,
    `Breadcrumb=${hasSrcBreadcrumb}, NormalBtn=${hasNormalTriggerBtn}, DiagBtn=${hasDiagTriggerBtn}`
  );

  await authContext.close();

  // ==========================================
  // PART 3: Mobile Viewport (390x844) - iPhone 14 style
  // ==========================================
  console.log("\n==========================================");
  console.log("PART 3: Mobile 390px Viewport Verification");
  console.log("==========================================");

  const mobileContext = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await mobileContext.addCookies([
    { name: SESSION_COOKIE, value: token, domain: "127.0.0.1", path: "/" },
    { name: SESSION_COOKIE, value: token, domain: "localhost", path: "/" },
  ]);

  const mobilePage = await mobileContext.newPage();
  mobilePage.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(`[Mobile Console Error] ${msg.text()}`);
    }
  });

  // 3.1 Mobile Bottom Nav Tabs
  await mobilePage.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
  await mobilePage.screenshot({ path: path.join(SCRATCH_DIR, "09-mobile-home.png") });

  const bottomNav = await mobilePage.locator('nav[aria-label="底部导航"]').innerText().catch(() => "");
  const hasTabHome = bottomNav.includes("情报");
  const hasTabPolicy = bottomNav.includes("政策");
  const hasTabInd = bottomNav.includes("行业");
  const hasTabMarket = bottomNav.includes("市场");
  const hasTabMore = bottomNav.includes("我的");

  const homeScrollWidth = await mobilePage.evaluate(() => document.documentElement.scrollWidth);
  record("3.1 移动端底部 5 标签导航完整呈现且无水平溢出",
    hasTabHome && hasTabPolicy && hasTabInd && hasTabMarket && hasTabMore && homeScrollWidth <= 390,
    `Tabs: [${bottomNav.replace(/\n/g, ", ")}], scrollWidth=${homeScrollWidth}px`
  );

  // 3.2 Mobile Policy Page & Overflow Check
  await mobilePage.goto(`${BASE_URL}/all`, { waitUntil: "networkidle" });
  await mobilePage.screenshot({ path: path.join(SCRATCH_DIR, "10-mobile-policy.png") });
  const policyScrollWidth = await mobilePage.evaluate(() => document.documentElement.scrollWidth);
  record("3.2 移动端政策页面无水平溢出", policyScrollWidth <= 390, `scrollWidth=${policyScrollWidth}px`);

  // 3.3 Mobile Market Page & Tab Highlighting
  await mobilePage.goto(`${BASE_URL}/market`, { waitUntil: "networkidle" });
  await mobilePage.screenshot({ path: path.join(SCRATCH_DIR, "11-mobile-market.png") });
  const marketScrollWidth = await mobilePage.evaluate(() => document.documentElement.scrollWidth);
  const activeTabMarket = await mobilePage.locator('nav[aria-label="底部导航"] a[aria-current="page"]').innerText().catch(() => "");
  record("3.3 移动端市场信号页面底栏高亮与尺寸自适应正常",
    marketScrollWidth <= 390 && activeTabMarket.includes("市场"),
    `activeTab=${activeTabMarket}, scrollWidth=${marketScrollWidth}px`
  );

  // 3.4 Mobile More Page (/more) Four Lanes Entry Cards
  await mobilePage.goto(`${BASE_URL}/more`, { waitUntil: "networkidle" });
  await mobilePage.screenshot({ path: path.join(SCRATCH_DIR, "12-mobile-more.png") });

  const moreContent = await mobilePage.content();
  const hasMoreLanesGroup = moreContent.includes("四条主线工作台");
  const hasMorePolicy = moreContent.includes("01 平台政策");
  const hasMoreInd = moreContent.includes("02 行业动态");
  const hasMoreVoc = moreContent.includes("03 消费者原声");
  const hasMoreMkt = moreContent.includes("04 市场信号");
  const moreScrollWidth = await mobilePage.evaluate(() => document.documentElement.scrollWidth);

  record("3.4 移动端“更多”页面四主线工作台入口完整且无水平溢出",
    hasMoreLanesGroup && hasMorePolicy && hasMoreInd && hasMoreVoc && hasMoreMkt && moreScrollWidth <= 390,
    `Group=${hasMoreLanesGroup}, All4Lanes=${hasMorePolicy && hasMoreInd && hasMoreVoc && hasMoreMkt}, scrollWidth=${moreScrollWidth}px`
  );

  await mobileContext.close();
  await browser.close();

  // ==========================================
  // PART 4: Console & Page Errors Audit
  // ==========================================
  console.log("\n==========================================");
  console.log("PART 4: Browser Console & Runtime Errors Audit");
  console.log("==========================================");

  // Filter out any known benign favicon or harmless warnings if any
  const severeErrors = consoleErrors.filter(
    (e) =>
      !e.includes("favicon") &&
      !e.includes("chrome-extension") &&
      !e.includes("hydrated but some attributes") &&
      !e.includes("hydration-mismatch")
  );
  record("4.1 真实浏览器全流程执行控制台 0 严重错误", severeErrors.length === 0, `Total Severe Errors=${severeErrors.length}: ${severeErrors.join("; ")}`);
  record("4.2 真实浏览器全流程执行未发生页面未捕获异常", pageErrors.length === 0, `Total Page Errors=${pageErrors.length}`);

  console.log("\n==========================================");
  console.log("ALL BROWSER ACCEPTANCE TESTS PASSED!");
  console.log("==========================================");
}

run().catch((err) => {
  console.error("FATAL BROWSER ACCEPTANCE ERROR:", err);
  process.exit(1);
});
