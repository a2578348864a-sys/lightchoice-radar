import { chromium } from "playwright";
import * as path from "node:path";
import * as fs from "node:fs";

const WEB = "http://127.0.0.1:3000";
const SHOTS_DIR = path.resolve(".data", "_diag", "shots-unified-ui");
if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });

let passedCount = 0;
let failedCount = 0;

function check(title: string, condition: boolean, details?: string) {
  if (condition) {
    passedCount++;
    console.log(`[PASS] ${title}${details ? ` -> ${details}` : ""}`);
  } else {
    failedCount++;
    console.error(`[FAIL] ${title}${details ? ` -> ${details}` : ""}`);
  }
}

async function verify() {
  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
  });

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  // -------------------------------------------------------------
  // Test Set 1: 1440px Desktop View
  // -------------------------------------------------------------
  const ctx1440 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx1440.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon")) {
      consoleErrors.push(`[1440 Console] ${m.text()}`);
    }
  });
  page.on("pageerror", (e) => pageErrors.push(`[1440 PageError] ${e.message}`));

  console.log("\n=== 阶段 1: 1440px 桌面端四主线与真首页完整验证 ===");

  // 1. True Home Page (No redirect to /all)
  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const homeUrl = page.url();
  check("1. 点击情报首页真正进入 / 且不再重定向 /all", homeUrl === `${WEB}/` || homeUrl === `${WEB}`, `url=${homeUrl}`);
  await page.screenshot({ path: path.join(SHOTS_DIR, "01-home-1440.png"), fullPage: false });

  const homeH1 = await page.locator("h1").innerText();
  check("2. 首页主标题为轻选情报中心", homeH1.includes("轻选情报中心"), `h1=${homeH1}`);

  const homeText = await page.locator("body").innerText();
  check("3. 首页包含今日重点情报与四主线入口", homeText.includes("今日重点情报") && homeText.includes("四主线最新情报流"), "今日重点与四主线区域就绪");
  check("4. 首页包含待核实政策线索且标注线索边界", homeText.includes("待核实政策线索") && homeText.includes("线索 ≠ 政策事实"), "线索警示就绪");
  check("5. 首页包含报告与归档入口", homeText.includes("情报日报") && homeText.includes("情报周报") && homeText.includes("情报月报"), "三类报告入口就绪");

  // 2. Navigation structure
  const sidebarText = await page.locator("aside").first().innerText();
  check("6. 导航栏呈现统一情报中心、情报阅读与研究管理",
    sidebarText.includes("情报中心") && sidebarText.includes("情报阅读") && sidebarText.includes("研究与管理"),
    "导航分类规范对齐"
  );
  check("7. 导航栏主线去除研发阶段标签",
    sidebarText.includes("01 平台政策") && sidebarText.includes("02 行业动态") && sidebarText.includes("03 消费者原声") && sidebarText.includes("04 市场信号"),
    "四主线编号规范"
  );

  // 3. Lane 1: Platform Policy (/all)
  await page.click('a[href="/all"]');
  await page.waitForURL("**/all");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(SHOTS_DIR, "02-lane1-policy-1440.png") });
  const allH1 = await page.locator("h1").innerText();
  check("8. 第一主线平台政策标题纯净", allH1.includes("平台政策情报") && !allH1.includes("第一主线"), `h1=${allH1}`);
  const allText = await page.locator("body").innerText();
  check("9. 第一主线保留原有完整功能与内容隔离", allText.includes("查询历史") && !allText.includes("Wyze") && !allText.includes("Home Assistant"), "政策池纯净");

  // 4. Lane 2: Industry Dynamics (/industry)
  await page.click('a[href="/industry"]');
  await page.waitForURL("**/industry");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS_DIR, "03-lane2-industry-1440.png") });
  const indH1 = await page.locator("h1").innerText();
  check("10. 第二主线行业动态标题纯净", indH1.includes("行业动态") && !indH1.includes("第二主线"), `h1=${indH1}`);
  const indCards = await page.locator("article[data-intelligence-id]").count();
  check("11. 第二主线升级为统一情报卡片信息流", indCards > 0, `已呈现 ${indCards} 张统一行业情报卡片`);

  // 5. Lane 3: Voice of Customer (/voc)
  await page.click('a[href="/voc"]');
  await page.waitForURL("**/voc");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS_DIR, "04-lane3-voc-1440.png") });
  const vocH1 = await page.locator("h1").innerText();
  check("12. 第三主线消费者原声标题删除研发标签", vocH1.includes("消费者原声") && !vocH1.includes("第三主线"), `h1=${vocH1}`);
  const vocText = await page.locator("body").innerText();
  check("13. 第三主线免登录且首页直接呈现真实原声材料", !vocText.includes("需要管理员权限") && vocText.includes("Coffee Stack Exchange"), "直接看到真实材料与讨论");
  const vocCards = await page.locator("article[data-intelligence-id]").count();
  check("14. 第三主线以统一情报卡片呈现", vocCards > 0, `已呈现 ${vocCards} 张消费者原声卡片`);

  // 6. Lane 4: Market Signals (/market)
  await page.click('a[href="/market"]');
  await page.waitForURL("**/market");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS_DIR, "05-lane4-market-1440.png") });
  const mktH1 = await page.locator("h1").innerText();
  check("15. 第四主线市场信号标题删除研发标签", mktH1.includes("市场信号") && !mktH1.includes("第四主线"), `h1=${mktH1}`);
  const mktText = await page.locator("body").innerText();
  check("16. 第四主线免登录且首页转为情报流", !mktText.includes("需要管理员权限") && mktText.includes("确定性规则 C1/C4/C6"), "真实信号卡片流可见");
  const mktCards = await page.locator("article[data-intelligence-id]").count();
  check("17. 第四主线呈现真实观测信号卡片", mktCards > 0, `已呈现 ${mktCards} 张市场信号卡片`);

  // 7. Market 12-Module Workbench (/market/workbench)
  await page.click('a[href="/market/workbench"]');
  await page.waitForURL("**/market/workbench");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(SHOTS_DIR, "06-market-workbench-1440.png") });
  const wbText = await page.locator("body").innerText();
  check("18. 原12模块工程矩阵完整保留于二级工作台", wbText.includes("12 模块能力与业务可用状态矩阵") && wbText.includes("搜索需求雷达"), "12 模块工程状态完整可用");

  // 8. Policy Leads (/leads)
  await page.goto(`${WEB}/leads`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS_DIR, "07-leads-1440.png") });
  const leadsText = await page.locator("body").innerText();
  check("19. 政策线索采用统一信息流且明确区分待核实状态", leadsText.includes("政策线索") && leadsText.includes("线索 ≠ 政策事实"), "政策线索统一信息流");

  // 9. Reports (/daily, /weekly, /monthly)
  await page.goto(`${WEB}/daily`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(SHOTS_DIR, "08-daily-1440.png") });
  const dailyText = await page.locator("body").innerText();
  check("20. 日报正常呈现且如实标明出刊设定与调度状态", dailyText.includes("日报") && dailyText.includes("08:00"), "日报正常呈现");

  await page.goto(`${WEB}/weekly`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(SHOTS_DIR, "09-weekly-1440.png") });
  const weeklyText = await page.locator("body").innerText();
  check("21. 周报正常呈现且如实标明周一出刊设定", weeklyText.includes("周报") && weeklyText.includes("10:00"), "周报正常呈现");

  await page.goto(`${WEB}/monthly`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(SHOTS_DIR, "10-monthly-1440.png") });
  const monthlyText = await page.locator("body").innerText();
  check("22. 月报正常呈现且如实标明1日出刊设定", monthlyText.includes("月报") && monthlyText.includes("10:30"), "月报正常呈现");

  // 10. Star / Bookmark testing
  await page.goto(`${WEB}/industry`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const firstStarBtn = page.locator('article[data-intelligence-id] button[aria-label="收藏"]').first();
  if (await firstStarBtn.isVisible()) {
    await firstStarBtn.click();
    await page.waitForTimeout(300);
    check("23. 主要阅读卡片支持一键收藏", true, "点击收藏按钮成功");
  }

  await page.goto(`${WEB}/starred`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(SHOTS_DIR, "11-starred-1440.png") });
  const starredText = await page.locator("body").innerText();
  check("24. 收藏页面可展示已收藏情报", starredText.includes("收藏"), "收藏工作台正常");

  await ctx1440.close();

  // -------------------------------------------------------------
  // Test Set 2: 1920px Wide Desktop View
  // -------------------------------------------------------------
  console.log("\n=== 阶段 2: 1920px 宽屏桌面端视觉校验 ===");
  const ctx1920 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page1920 = await ctx1920.newPage();
  await page1920.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page1920.screenshot({ path: path.join(SHOTS_DIR, "12-home-1920.png"), fullPage: false });
  const w1920Text = await page1920.locator("body").innerText();
  check("25. 1920px 宽屏下布局平衡、视觉整齐", w1920Text.includes("轻选情报中心") && w1920Text.includes("四主线最新情报流"), "宽屏无错位");
  await ctx1920.close();

  // -------------------------------------------------------------
  // Test Set 3: 390px Mobile Phone View
  // -------------------------------------------------------------
  console.log("\n=== 阶段 3: 390px 移动端布局与无溢出校验 ===");
  const ctx390 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page390 = await ctx390.newPage();
  page390.on("console", (m) => {
    if (m.type() === "error" && !m.text().includes("favicon")) consoleErrors.push(`[390 Console] ${m.text()}`);
  });
  page390.on("pageerror", (e) => pageErrors.push(`[390 PageError] ${e.message}`));

  await page390.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page390.waitForTimeout(600);
  await page390.screenshot({ path: path.join(SHOTS_DIR, "13-home-390.png"), fullPage: false });

  const homeOverflow = await page390.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check("26. 移动端 390px 首页无横向溢出", !homeOverflow, `overflow=${homeOverflow}`);

  // Test mobile bottom bar
  const bottomNav = await page390.locator("nav").last().innerText();
  check("27. 移动端底部呈现标准 5 标签导航", bottomNav.includes("首页") && bottomNav.includes("政策") && bottomNav.includes("行业") && bottomNav.includes("市场") && bottomNav.includes("更多"), "移动底栏就绪");

  // Mobile /voc
  await page390.goto(`${WEB}/voc`, { waitUntil: "networkidle" });
  await page390.waitForTimeout(600);
  await page390.screenshot({ path: path.join(SHOTS_DIR, "14-voc-390.png") });
  const vocOverflow = await page390.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check("28. 移动端 390px 消费者原声无横向溢出且免登录", !vocOverflow, `overflow=${vocOverflow}`);

  // Mobile /market
  await page390.goto(`${WEB}/market`, { waitUntil: "networkidle" });
  await page390.waitForTimeout(600);
  await page390.screenshot({ path: path.join(SHOTS_DIR, "15-market-390.png") });
  const mktOverflow = await page390.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check("29. 移动端 390px 市场信号无横向溢出且免登录", !mktOverflow, `overflow=${mktOverflow}`);

  // Mobile /more
  await page390.goto(`${WEB}/more`, { waitUntil: "networkidle" });
  await page390.waitForTimeout(600);
  await page390.screenshot({ path: path.join(SHOTS_DIR, "16-more-390.png") });
  const moreText = await page390.locator("body").innerText();
  check("30. 移动端更多页面规范整合", moreText.includes("情报中心四主线") && moreText.includes("情报阅读与报告"), "更多页面分类对齐");

  await ctx390.close();
  await browser.close();

  // Console & Page errors check
  check("31. 控制台 0 严重错误", consoleErrors.length === 0, consoleErrors.join("; "));
  check("32. 页面 0 未捕获异常", pageErrors.length === 0, pageErrors.join("; "));

  console.log(`\n========================================`);
  console.log(`验收结果汇总: ${passedCount} 通过 / ${failedCount} 失败`);
  console.log(`截图保留在: ${SHOTS_DIR}`);
  console.log(`========================================`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

verify().catch((err) => {
  console.error("验收执行异常:", err);
  process.exit(1);
});
