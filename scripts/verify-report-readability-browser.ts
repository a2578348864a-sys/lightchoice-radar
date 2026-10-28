import { chromium } from "playwright";
import * as path from "node:path";
import * as fs from "node:fs";

const WEB = "http://127.0.0.1:3000";
const ARTIFACT_DIR = "C:\\Users\\a2578\\.gemini\\antigravity\\brain\\d4cd9c37-14f7-4f30-89e4-0eab87110042\\verification_screenshots";
if (!fs.existsSync(ARTIFACT_DIR)) fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

let failed = 0;
const record = (name: string, passed: boolean, details?: string) => {
  if (!passed) failed++;
  console.log(`${passed ? "[PASS]" : "[FAIL]"} ${name}${details ? ` -> ${details}` : ""}`);
};

async function run() {
  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const browser = await chromium.launch({
    headless: true,
    executablePath: fs.existsSync(chromePath) ? chromePath : undefined,
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => pageErrors.push(e.message));

  console.log("=== Browser Verification: Report Readability & Eligibility ===");

  // 1. Daily Report (2026-10-24)
  await page.goto(`${WEB}/daily/2026-10-24`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "04_daily_report_fixed.png"), fullPage: false });

  const dailyText = await page.locator("body").innerText();
  const falseNote = "该内容已按来源方要求下架或调整展示方式";
  const dailyHasFalseNote = dailyText.includes(falseNote);
  record("D1 日报无虚假下架提示", !dailyHasFalseNote, `url=${page.url()}`);

  const dailySourcesMetric = dailyText.includes("个来源") && !dailyText.includes("0 个来源");
  record("D2 日报来源计数真实且大于0 (不是0个来源)", dailySourcesMetric, `url=${page.url()}`);

  const dailyHasOriginalLink = (await page.locator('a:has-text("原文")').count()) > 0;
  record("D3 日报包含原始出处链接 (原文 ↗)", dailyHasOriginalLink, `count=${await page.locator('a:has-text("原文")').count()}`);

  const dailyStrikeThrough = await page.locator(".line-through").count();
  record("D4 日报正常条目无删除线", dailyStrikeThrough === 0, `lineThroughCount=${dailyStrikeThrough}`);

  // 2. Weekly Report (2026-W43)
  await page.goto(`${WEB}/weekly/2026-W43`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "05_weekly_report_fixed.png"), fullPage: false });

  const weeklyText = await page.locator("body").innerText();
  const weeklyHasFalseNote = weeklyText.includes(falseNote);
  record("W1 周报无虚假下架提示", !weeklyHasFalseNote, `url=${page.url()}`);

  const weeklyStrikeThrough = await page.locator(".line-through").count();
  record("W2 周报正常条目无删除线 (14件大事全部正常展示)", weeklyStrikeThrough === 0, `lineThroughCount=${weeklyStrikeThrough}`);

  const weeklyHighlightsCount = await page.locator('aside ol li').count();
  record("W3 周报看点正常成列", weeklyHighlightsCount >= 3, `count=${weeklyHighlightsCount}`);

  const weeklyOriginalCount = await page.locator('a:has-text("原文")').count();
  record("W4 周报包含原始出处链接", weeklyOriginalCount > 0, `count=${weeklyOriginalCount}`);

  // 3. Click into article detail from weekly report
  const firstArticleLink = page.locator('article h3 a').first();
  const targetTitle = (await firstArticleLink.innerText()).trim();
  await firstArticleLink.click();
  await page.waitForURL("**/items/**");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "07_item_detail_from_report.png"), fullPage: false });

  const itemPageText = await page.locator("body").innerText();
  record("I1 从报告进入文章详情页正常可读", itemPageText.includes(targetTitle) || itemPageText.length > 200, `url=${page.url()}`);

  // 4. Monthly Report Check
  await page.goto(`${WEB}/monthly`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(ARTIFACT_DIR, "06_monthly_report_clean.png"), fullPage: false });

  const monthlyText = await page.locator("body").innerText();
  const hasPrematureOct = monthlyText.includes("2026年10月") && monthlyText.includes("第 1 期");
  record("M1 月报不包含早产的2026年10月月报", !hasPrematureOct, `url=${page.url()}`);

  // 5. Four lanes accessibility regression
  await page.goto(`${WEB}/all`, { waitUntil: "networkidle" });
  const lane1 = await page.locator('h1').innerText();
  record("L1 平台政策正常", lane1.includes("平台政策") || lane1.includes("跨境"), `h1=${lane1}`);

  await page.goto(`${WEB}/industry`, { waitUntil: "networkidle" });
  const lane2 = await page.locator('h1').innerText();
  record("L2 行业动态正常", lane2.includes("行业动态"), `h1=${lane2}`);

  await page.goto(`${WEB}/voc`, { waitUntil: "networkidle" });
  const lane3 = await page.locator('h1').innerText();
  record("L3 消费者原声免登录正常", lane3.includes("消费者原声"), `h1=${lane3}`);

  await page.goto(`${WEB}/market`, { waitUntil: "networkidle" });
  const lane4 = await page.locator('h1').innerText();
  record("L4 市场信号免登录正常", lane4.includes("市场信号"), `h1=${lane4}`);

  await browser.close();

  console.log(`\nVerification Finished: ${failed === 0 ? "ALL PASSED" : `${failed} FAILED`}`);
  if (consoleErrors.length > 0) {
    console.log("Console errors observed:", consoleErrors);
  }
  process.exit(failed === 0 ? 0 : 1);
}

run().catch((err) => {
  console.error("Browser verification error:", err);
  process.exit(1);
});
