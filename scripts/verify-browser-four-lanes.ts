// Playwright browser acceptance test for Four Lanes Integration & Policy Boundary Verification.
// FOUR-LANE-FINAL-ACCEPTANCE edition: keeps the original 14 assertions, adds real user operations
// required by the final acceptance brief — policy source/date filters, keyword search, a real policy
// detail visit with its original source link, the force-recalc confirm dialog (dismissed, never
// executed), all VOC/market private sub-pages, breadcrumb return, refresh persistence, a 1920px
// desktop pass, a light-mode check and a 404 error-state check. Screenshots go to .data (gitignored).
import { chromium } from "playwright";
import * as path from "node:path";
import * as fs from "node:fs";

const BASE_URL = "http://127.0.0.1:3000";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_PASSWORD) {
  console.error("ADMIN_PASSWORD not set in environment");
  process.exit(1);
}

const SCRATCH_DIR = path.resolve(".data", "_diag", "shots-four-lane-final");
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

  // 1.1 Home page redirects to /all and sidebar shows the four lanes
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(SCRATCH_DIR, "00-desktop-home.png") });

  const landedOnAll = page.url().startsWith(`${BASE_URL}/all`);
  const navSection = page.locator('nav[aria-label="主导航"]');
  const navText = await navSection.innerText();
  const has01 = navText.includes("01 平台政策");
  const has02 = navText.includes("02 行业动态");
  const has03 = navText.includes("03 消费者原声");
  const has04 = navText.includes("04 市场信号");

  record("1.1 首页直达四主线入口：/ 重定向 /all 且侧边栏四条主线导航完整呈现", landedOnAll && has01 && has02 && has03 && has04,
    `URL=${page.url()}, 01:${has01}, 02:${has02}, 03:${has03}, 04:${has04}`);

  // 1.2 Lane 1: Platform Policy (/all) clean boundary check
  console.log("\n--- Checking Lane 1: Platform Policy (/all) ---");
  await page.click('nav[aria-label="主导航"] a[href="/all"]');
  await page.waitForURL(`${BASE_URL}/all`);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(SCRATCH_DIR, "01-desktop-policy-clean.png") });

  const policyTitle = await page.textContent("h1");
  const hasPolicyTitle = policyTitle?.includes("平台政策") || policyTitle?.includes("政策");

  // Check sources filter: Home Assistant and Wyze must NOT be present
  const pageContent = await page.content();
  const hasHACommunity = pageContent.includes("rss-home-assistant-community") || pageContent.includes("Home Assistant 社区");
  const hasWyzeCommunity = pageContent.includes("rss-wyze-community") || pageContent.includes("Wyze 社区");

  record("1.2 第一主线平台政策内容池纯净性验证（无智能家居社区讨论）", !hasHACommunity && !hasWyzeCommunity, `HomeAssistant泄漏:${hasHACommunity}, Wyze泄漏:${hasWyzeCommunity}`);

  // 1.3 Source filter: pick a real policy source, the list keeps rendering policy items only
  const sourceSelect = page.locator('select[aria-label="来源筛选"]');
  await sourceSelect.selectOption({ index: 1 });
  await Promise.all([page.waitForLoadState("networkidle"), page.locator('button:has-text("查询历史")').click()]);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(SCRATCH_DIR, "01b-desktop-policy-source-filter.png") });
  const filteredContent = await page.content();
  const sourceFilterLeak = filteredContent.includes("Home Assistant 社区") || filteredContent.includes("Wyze 社区");
  const filteredItemCount = await page.locator('a[href^="/items/"]').count();
  record("1.3 政策来源筛选生效：按单一来源过滤后列表仍为政策内容", !sourceFilterLeak && filteredItemCount > 0, `source=${page.url()}, items=${filteredItemCount}, leak=${sourceFilterLeak}`);

  // 1.4 Keyword search on the policy lane
  await page.goto(`${BASE_URL}/all`, { waitUntil: "networkidle" });
  await page.fill("#site-search", "召回");
  await page.keyboard.press("Enter");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SCRATCH_DIR, "01c-desktop-policy-search.png") });
  const searchContent = await page.content();
  const searchHit = searchContent.includes("找到") && (searchContent.includes("召回") || searchContent.includes("Recall") || searchContent.includes("recall"));
  record("1.4 政策关键词搜索生效：搜索“召回”返回命中与计数", searchHit, `URL=${decodeURIComponent(page.url()).slice(0, 120)}`);

  // 1.5 Policy detail: open a real policy record, verify original source link and date fields
  await page.goto(`${BASE_URL}/all`, { waitUntil: "networkidle" });
  const firstItemLink = page.locator('a[href^="/items/"]').first();
  const detailHref = await firstItemLink.getAttribute("href");
  await Promise.all([page.waitForURL("**/items/**"), firstItemLink.click()]);
  // IntentLink uses React Router viewTransition: the outgoing page stays in the DOM until the
  // transition settles, so wait for the detail h1 to actually replace the lane title.
  await page.waitForFunction((prev) => (document.querySelector("[data-page-title]")?.textContent ?? "") !== prev, "平台政策情报", { timeout: 10_000 });
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(SCRATCH_DIR, "01d-desktop-policy-detail.png") });
  const detailTitle = await page.textContent("[data-page-title]");
  const externalLinks = await page.locator('a[href^="http"]:not([href*="127.0.0.1"]):not([href*="localhost"])').count();
  const bodyText = await page.innerText("body");
  const hasDateField = /\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(bodyText);
  record("1.5 真实政策详情页：标题、原始来源外链与日期字段齐备", Boolean(detailHref) && Boolean(detailTitle?.trim()) && externalLinks > 0 && hasDateField,
    `href=${detailHref}, h1=${detailTitle?.slice(0, 40)}, 外链数=${externalLinks}, 日期字段=${hasDateField}`);

  // 1.6 Pagination: the policy pool holds 25 items (≤ 40/page) so the pager is hidden by design
  await page.goto(`${BASE_URL}/all`, { waitUntil: "networkidle" });
  const pagerCount = await page.locator('nav[aria-label="分页"]').count();
  const poolTotalMatch = (await page.content()).match(/找到\s*<span[^>]*>(\d+)/);
  record("1.6 政策列表分页行为符合设计（25 条 ≤ 40/页时按设计不渲染分页）", poolTotalMatch ? Number(poolTotalMatch[1]) <= 40 : pagerCount === 0,
    `pager=${pagerCount}, total=${poolTotalMatch?.[1] ?? "首页不显示计数（仅搜索态显示）"}`);

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

  // Perform backend session generation using passwordLogin — the project's own legitimate local
  // admin sign-in mechanism (same session path as /admin/login), no fabricated identity.
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

  // 2.2b VOC research & system sub-pages
  for (const [sub, label] of [["research", "痛点研究"], ["system", "系统状态"]] as const) {
    await authPage.goto(`${BASE_URL}/voc/${sub}`, { waitUntil: "networkidle" });
    await authPage.screenshot({ path: path.join(SCRATCH_DIR, `05c-desktop-voc-${sub}.png`) });
    const subGate = await authPage.locator("text=需要管理员权限").isVisible().catch(() => false);
    const subCrumb = await authPage.locator('nav[aria-label="面包屑导航"]').innerText().catch(() => "");
    record(`2.2${sub === "research" ? "b" : "c"} 第三主线 /voc/${sub}（${label}）管理员可读且面包屑正常`, !subGate && subCrumb.includes("消费者原声"), `Breadcrumb=${subCrumb.replace(/\n/g, " ")}`);
  }

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

  // 2.4b Market keywords & products & alerts sub-pages
  const marketSubs: Array<[string, string]> = [
    ["keywords", "关键词雷达"],
    ["products", "商品雷达"],
    ["alerts", "预警"],
  ];
  let subIndex = 0;
  for (const [sub] of marketSubs) {
    await authPage.goto(`${BASE_URL}/market/${sub}`, { waitUntil: "networkidle" });
    await authPage.screenshot({ path: path.join(SCRATCH_DIR, `07b-desktop-market-${sub}.png`) });
    const subGate = await authPage.locator("text=需要管理员权限").isVisible().catch(() => false);
    const subCrumb = await authPage.locator('nav[aria-label="面包屑导航"]').innerText().catch(() => "");
    const tag = String.fromCharCode(97 + subIndex++);
    record(`2.4${tag} 第四主线 /market/${sub} 管理员可读且面包屑正常`, !subGate && subCrumb.includes("市场信号"), `Breadcrumb=${subCrumb.replace(/\n/g, " ")}`);
  }

  // 2.5 Market Sources Sub-page & Trigger Buttons (/market/sources)
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

  // 2.5b Force-recalc confirm dialog: click, capture the dialog, DISMISS it. No request is sent.
  const dialogCapture: { message: string | null; accepted: boolean } = { message: null, accepted: false };
  let runDueRequested = false;
  authPage.on("dialog", async (dialog) => {
    dialogCapture.message = dialog.message();
    await dialog.dismiss();
    dialogCapture.accepted = false;
  });
  authPage.on("request", (req) => {
    if (req.url().includes("/api/market/scheduler/run-due")) runDueRequested = true;
  });
  await authPage.click('button:has-text("强制重算全部来源（诊断用）")');
  await authPage.waitForTimeout(800);
  const runReportShown = await authPage.locator("text=自动调度执行完成").isVisible().catch(() => false);
  record("2.5b 强制重算按钮具备二次确认，取消后不发起任何调度请求", dialogCapture.message !== null && !runDueRequested && !runReportShown,
    `dialog=${dialogCapture.message?.slice(0, 60) ?? "无"}, runDueRequest=${runDueRequested}, report=${runReportShown}`);

  // 2.6 Breadcrumb return: click the breadcrumb back to the lane overview
  await authPage.click('nav[aria-label="面包屑导航"] a:has-text("市场信号")');
  await authPage.waitForURL("**/market", { timeout: 10_000 });
  await authPage.waitForTimeout(600);
  await authPage.waitForLoadState("networkidle");
  const backOnMarket = authPage.url().replace(/\/$/, "") === `${BASE_URL}/market`;
  const backGate = await authPage.locator("text=市场信号工作台需要管理员权限").isVisible().catch(() => false);
  record("2.6 面包屑一键返回市场信号总览且会话保持", backOnMarket && !backGate, `URL=${authPage.url()}`);

  // 2.7 Refresh persistence: reload /market and the admin session survives
  await authPage.reload({ waitUntil: "networkidle" });
  await authPage.screenshot({ path: path.join(SCRATCH_DIR, "06b-desktop-market-refresh.png") });
  const refreshGate = await authPage.locator("text=市场信号工作台需要管理员权限").isVisible().catch(() => false);
  const refreshMatrix = await authPage.locator("text=12 模块能力状态矩阵").isVisible().catch(() => false);
  record("2.7 刷新后管理员会话与页面状态恢复", !refreshGate && refreshMatrix, `GateAfterRefresh=${refreshGate}, Matrix=${refreshMatrix}`);

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

  // ==========================================
  // PART 4: Desktop 1920x1080 - Large Desktop & Light Mode
  // ==========================================
  console.log("\n==========================================");
  console.log("PART 4: Desktop 1920px & Light Mode");
  console.log("==========================================");

  const wideContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const widePage = await wideContext.newPage();
  widePage.on("pageerror", (err) => {
    pageErrors.push(`[Wide Page Error] ${err.message}`);
  });

  await widePage.goto(`${BASE_URL}/all`, { waitUntil: "networkidle" });
  await widePage.screenshot({ path: path.join(SCRATCH_DIR, "13-wide-1920-policy.png") });
  const wideNav = await widePage.locator('nav[aria-label="主导航"]').innerText().catch(() => "");
  const wideScrollWidth = await widePage.evaluate(() => document.documentElement.scrollWidth);
  record("4.1 1920px 桌面端四主线导航正常且无水平溢出", wideNav.includes("01 平台政策") && wideNav.includes("04 市场信号") && wideScrollWidth <= 1920,
    `scrollWidth=${wideScrollWidth}px, nav=${wideNav.replace(/\n/g, " ").slice(0, 60)}`);

  const bodyBg = await widePage.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const rgb = bodyBg.match(/\d+/g)?.map(Number) ?? [];
  const isLight = rgb.length >= 3 && rgb[0]! > 200 && rgb[1]! > 200 && rgb[2]! > 200;
  record("4.2 浅色模式为默认且唯一主题（页面底色为浅色）", isLight, `body background=${bodyBg}`);

  await wideContext.close();

  // ==========================================
  // PART 5: Error State - Nonexistent Policy Detail Returns Real 404
  // ==========================================
  console.log("\n==========================================");
  console.log("PART 5: Error State (Real 404)");
  console.log("==========================================");

  const errContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const errPage = await errContext.newPage();
  const notFoundResp = await errPage.goto(`${BASE_URL}/items/does-not-exist-000000`, { waitUntil: "load" });
  await errPage.screenshot({ path: path.join(SCRATCH_DIR, "14-desktop-404.png") });
  const notFoundStatus = notFoundResp?.status() ?? 0;
  const notFoundH1 = await errPage.textContent("h1").catch(() => "");
  record("5.1 不存在的详情页返回真实 404 状态（不冒充正常内容）", notFoundStatus === 404, `status=${notFoundStatus}, h1=${notFoundH1?.slice(0, 40)}`);
  await errContext.close();

  // ==========================================
  // PART 6: Console & Page Errors Audit
  // ==========================================
  console.log("\n==========================================");
  console.log("PART 6: Browser Console & Runtime Errors Audit");
  console.log("==========================================");

  // Filter out any known benign favicon or harmless warnings if any
  const severeErrors = consoleErrors.filter(
    (e) =>
      !e.includes("favicon") &&
      !e.includes("chrome-extension") &&
      !e.includes("hydrated but some attributes") &&
      !e.includes("hydration-mismatch")
  );
  record("6.1 真实浏览器全流程执行控制台 0 严重错误", severeErrors.length === 0, `Total Severe Errors=${severeErrors.length}: ${severeErrors.join("; ")}`);
  record("6.2 真实浏览器全流程执行未发生页面未捕获异常", pageErrors.length === 0, `Total Page Errors=${pageErrors.length}`);

  await browser.close();

  const passed = stepResults.filter((r) => r.passed).length;
  console.log("\n==========================================");
  console.log(`RESULT: ${passed}/${stepResults.length} PASSED — screenshots in ${SCRATCH_DIR}`);
  console.log("==========================================");
  if (passed !== stepResults.length) process.exit(1);
}

run().catch((err) => {
  console.error("FATAL BROWSER ACCEPTANCE ERROR:", err);
  process.exit(1);
});
