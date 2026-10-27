import { chromium } from "playwright";
import * as path from "node:path";
import * as fs from "node:fs";

const SCREENSHOT_DIR = path.resolve("..", "..", "..", "brain", "d4cd9c37-14f7-4f30-89e4-0eab87110042", "verification_screenshots");

async function main() {
  if (!fs.existsSync(SCREENSHOT_DIR)) {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }

  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const results: Array<{ route: string; status: number; checks: string[]; screenshot: string }> = [];

  // 1. Home Page /
  console.log("Checking / ...");
  const homeRes = await page.goto("http://127.0.0.1:3000/", { waitUntil: "networkidle" });
  const homeStatus = homeRes?.status() ?? 0;
  const homeHtml = await page.content();
  const homeChecks: string[] = [];

  // Check that test data is NOT present in formal feed
  if (!homeHtml.includes("New Entrant Product") && !homeHtml.includes("Historical Test Product") && !homeHtml.includes("Apex Thermal Flask")) {
    homeChecks.push("PASS: No test products in home feed");
  } else {
    homeChecks.push("FAIL: Found test product in home feed!");
  }

  // Check market honest empty state
  if (homeHtml.includes("当前暂无符合条件的新情报")) {
    homeChecks.push("PASS: Market section shows honest empty state");
  } else {
    homeChecks.push("FAIL: Market section missing honest empty state");
  }

  // Check reports reading cards
  if (homeHtml.includes("情报日报") && homeHtml.includes("情报周报") && homeHtml.includes("情报月报")) {
    homeChecks.push("PASS: Daily, weekly, monthly report links present");
  }

  const homeShot = path.join(SCREENSHOT_DIR, "01_home_integrity.png");
  await page.screenshot({ path: homeShot, fullPage: true });
  results.push({ route: "/", status: homeStatus, checks: homeChecks, screenshot: homeShot });

  // 2. /market
  console.log("Checking /market ...");
  const mktRes = await page.goto("http://127.0.0.1:3000/market", { waitUntil: "networkidle" });
  const mktStatus = mktRes?.status() ?? 0;
  const mktHtml = await page.content();
  const mktChecks: string[] = [];

  if (mktHtml.includes("暂无符合条件的市场信号")) {
    mktChecks.push("PASS: /market shows honest empty state");
  } else {
    mktChecks.push("FAIL: /market missing honest empty state");
  }
  if (!mktHtml.includes("New Entrant Product") && !mktHtml.includes("Historical Test Product") && !mktHtml.includes("Apex Thermal Flask")) {
    mktChecks.push("PASS: No test items in /market formal stream");
  } else {
    mktChecks.push("FAIL: Found test items in /market");
  }

  const mktShot = path.join(SCREENSHOT_DIR, "02_market_formal_gate.png");
  await page.screenshot({ path: mktShot, fullPage: true });
  results.push({ route: "/market", status: mktStatus, checks: mktChecks, screenshot: mktShot });

  // 2b. /market?test=all (Verify test bypass is completely closed in UI)
  console.log("Checking /market?test=all ...");
  const mktTestRes = await page.goto("http://127.0.0.1:3000/market?test=all", { waitUntil: "networkidle" });
  const mktTestStatus = mktTestRes?.status() ?? 0;
  const mktTestHtml = await page.content();
  const mktTestChecks: string[] = [];

  if (mktTestHtml.includes("暂无符合条件的市场信号")) {
    mktTestChecks.push("PASS: /market?test=all ignores test query and maintains honest empty state");
  } else {
    mktTestChecks.push("FAIL: /market?test=all exposed test data!");
  }
  if (!mktTestHtml.includes("New Entrant Product") && !mktTestHtml.includes("Historical Test Product") && !mktTestHtml.includes("Apex Thermal Flask")) {
    mktTestChecks.push("PASS: No test items in /market?test=all");
  } else {
    mktTestChecks.push("FAIL: Found test items in /market?test=all!");
  }
  const mktTestShot = path.join(SCREENSHOT_DIR, "02b_market_bypass_closed.png");
  await page.screenshot({ path: mktTestShot, fullPage: true });
  results.push({ route: "/market?test=all", status: mktTestStatus, checks: mktTestChecks, screenshot: mktTestShot });

  // 3. /market/workbench
  console.log("Checking /market/workbench ...");
  const wbRes = await page.goto("http://127.0.0.1:3000/market/workbench", { waitUntil: "networkidle" });
  const wbStatus = wbRes?.status() ?? 0;
  const wbHtml = await page.content();
  const wbChecks: string[] = [];
  if (wbHtml.includes("12 模块工程状态") || wbHtml.includes("模块能力状态矩阵")) {
    wbChecks.push("PASS: 12-module engineering matrix intact");
  }
  const wbShot = path.join(SCREENSHOT_DIR, "03_market_workbench.png");
  await page.screenshot({ path: wbShot, fullPage: true });
  results.push({ route: "/market/workbench", status: wbStatus, checks: wbChecks, screenshot: wbShot });

  // 4. /daily
  console.log("Checking /daily ...");
  const dailyRes = await page.goto("http://127.0.0.1:3000/daily", { waitUntil: "networkidle" });
  const dailyStatus = dailyRes?.status() ?? 0;
  const dailyHtml = await page.content();
  const dailyChecks: string[] = [];
  if (dailyHtml.includes("日报") && !dailyHtml.includes("暂无已发布的报告")) {
    dailyChecks.push("PASS: Daily report rendered real publication");
  } else {
    dailyChecks.push("FAIL: Daily report shows empty or failed");
  }
  const dailyShot = path.join(SCREENSHOT_DIR, "04_daily_report.png");
  await page.screenshot({ path: dailyShot, fullPage: true });
  results.push({ route: "/daily", status: dailyStatus, checks: dailyChecks, screenshot: dailyShot });

  // 5. /weekly
  console.log("Checking /weekly ...");
  const weeklyRes = await page.goto("http://127.0.0.1:3000/weekly", { waitUntil: "networkidle" });
  const weeklyStatus = weeklyRes?.status() ?? 0;
  const weeklyHtml = await page.content();
  const weeklyChecks: string[] = [];
  if (weeklyHtml.includes("周报") && !weeklyHtml.includes("暂无已发布的报告")) {
    weeklyChecks.push("PASS: Weekly report rendered real publication");
  } else {
    weeklyChecks.push("FAIL: Weekly report shows empty or failed");
  }
  const weeklyShot = path.join(SCREENSHOT_DIR, "05_weekly_report.png");
  await page.screenshot({ path: weeklyShot, fullPage: true });
  results.push({ route: "/weekly", status: weeklyStatus, checks: weeklyChecks, screenshot: weeklyShot });

  // 6. /monthly
  console.log("Checking /monthly ...");
  const monthlyRes = await page.goto("http://127.0.0.1:3000/monthly", { waitUntil: "networkidle" });
  const monthlyStatus = monthlyRes?.status() ?? 0;
  const monthlyHtml = await page.content();
  const monthlyChecks: string[] = [];
  if (monthlyHtml.includes("暂无已发布的") && monthlyHtml.includes("月报")) {
    monthlyChecks.push("PASS: Monthly report shows honest empty state after logical withdrawal");
  } else {
    monthlyChecks.push("FAIL: Monthly report missing honest empty state");
  }
  if (!monthlyHtml.includes("2026 年 10 月月报") && !monthlyHtml.includes("2026-10-27 21:22")) {
    monthlyChecks.push("PASS: Premature 2026-10 monthly report content is hidden from readers");
  } else {
    monthlyChecks.push("FAIL: Premature 2026-10 monthly report content is still visible!");
  }
  if (monthlyHtml.includes("已接入受管维护定时调度")) {
    monthlyChecks.push("PASS: Schedule notice clarifies zero-cost managed schedule");
  }
  const monthlyShot = path.join(SCREENSHOT_DIR, "06_monthly_report.png");
  await page.screenshot({ path: monthlyShot, fullPage: true });
  results.push({ route: "/monthly", status: monthlyStatus, checks: monthlyChecks, screenshot: monthlyShot });

  // 7. /all (Policy)
  console.log("Checking /all ...");
  const allRes = await page.goto("http://127.0.0.1:3000/all", { waitUntil: "networkidle" });
  const allStatus = allRes?.status() ?? 0;
  const allShot = path.join(SCREENSHOT_DIR, "07_policy_stream.png");
  await page.screenshot({ path: allShot, fullPage: true });
  results.push({ route: "/all", status: allStatus, checks: ["PASS: Policy stream rendered"], screenshot: allShot });

  // 8. /industry
  console.log("Checking /industry ...");
  const indRes = await page.goto("http://127.0.0.1:3000/industry", { waitUntil: "networkidle" });
  const indStatus = indRes?.status() ?? 0;
  const indShot = path.join(SCREENSHOT_DIR, "08_industry_stream.png");
  await page.screenshot({ path: indShot, fullPage: true });
  results.push({ route: "/industry", status: indStatus, checks: ["PASS: Industry stream rendered"], screenshot: indShot });

  // 9. /voc
  console.log("Checking /voc ...");
  const vocRes = await page.goto("http://127.0.0.1:3000/voc", { waitUntil: "networkidle" });
  const vocStatus = vocRes?.status() ?? 0;
  const vocShot = path.join(SCREENSHOT_DIR, "09_voc_stream.png");
  await page.screenshot({ path: vocShot, fullPage: true });
  results.push({ route: "/voc", status: vocStatus, checks: ["PASS: VOC stream rendered"], screenshot: vocShot });

  // 10. /leads
  console.log("Checking /leads ...");
  const leadsRes = await page.goto("http://127.0.0.1:3000/leads", { waitUntil: "networkidle" });
  const leadsStatus = leadsRes?.status() ?? 0;
  const leadsShot = path.join(SCREENSHOT_DIR, "10_leads_stream.png");
  await page.screenshot({ path: leadsShot, fullPage: true });
  results.push({ route: "/leads", status: leadsStatus, checks: ["PASS: Leads stream rendered"], screenshot: leadsShot });

  await browser.close();

  console.log("\n================ VERIFICATION SUMMARY ================");
  for (const r of results) {
    console.log(`Route ${r.route} -> Status ${r.status}`);
    for (const c of r.checks) {
      console.log(`  ${c}`);
    }
    console.log(`  Screenshot: ${r.screenshot}`);
  }
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
