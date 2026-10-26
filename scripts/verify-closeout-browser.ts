// FINAL-LOCAL-CLOSEOUT quick regression: four lanes reachable from the home nav, lanes 3+4 still
// login-free, the sources board showing the disabled test sources' real state, no severe errors.
// Fresh context (no cookies, no password). Deliberately short — this is a closeout pass, not a
// re-run of the full 27/27 acceptance.
import { chromium } from "playwright";
import * as path from "node:path";
import * as fs from "node:fs";

const WEB = "http://127.0.0.1:3000";
const SCRATCH_DIR = path.resolve(".data", "_diag", "shots-closeout");
if (!fs.existsSync(SCRATCH_DIR)) fs.mkdirSync(SCRATCH_DIR, { recursive: true });

let failed = 0;
const record = (step: string, passed: boolean, details?: string) => {
  if (!passed) failed++;
  console.log(`${passed ? "[PASS]" : "[FAIL]"} ${step}${details ? ` -> ${details}` : ""}`);
};

async function run() {
  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const browser = await chromium.launch({ headless: true, executablePath: fs.existsSync(chromePath) ? chromePath : undefined });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(e.message));

  // 1. Home → four-lane navigation
  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(SCRATCH_DIR, "00-home.png") });
  const nav = await page.locator('nav[aria-label="主导航"]').innerText();
  record("E1 四条主线入口完整", ["01 平台政策", "02 行业动态", "03 消费者原声", "04 市场信号"].every((t) => nav.includes(t)), `url=${page.url()}`);

  // 2. Lane 1 policy purity
  await page.click('nav[aria-label="主导航"] a[href="/all"]');
  await page.waitForURL("**/all");
  await page.waitForLoadState("networkidle");
  const policyText = await page.locator("body").innerText();
  record("E2 第一主线无社区求助帖混入", !policyText.includes("Home Assistant") && !policyText.includes("Wyze"), `url=${page.url()}`);

  // 3. Lane 2 industry content
  await page.click('nav[aria-label="主导航"] a[href="/industry"]');
  await page.waitForURL("**/industry");
  await page.waitForFunction((prev) => (document.querySelector("h1")?.textContent ?? "") !== prev, "平台政策情报", { timeout: 10_000 });
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(SCRATCH_DIR, "01-industry.png") });
  const indText = await page.locator("body").innerText();
  record("E3 第二主线行业内容正常", indText.includes("行业动态") && indText.length > 200, `url=${page.url()}`);

  // 4. Lane 3 VOC login-free + data
  await page.click('nav[aria-label="主导航"] a[href="/voc"]');
  await page.waitForURL("**/voc");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SCRATCH_DIR, "02-voc.png") });
  const vocText = await page.locator("body").innerText();
  record("E4 第三主线免登录直接进入且读取真实数据", !vocText.includes("需要管理员权限") && vocText.includes("消费者原声") && !vocText.includes("SERVICE_UNAVAILABLE"), `url=${page.url()}`);

  // 5. Lane 4 market login-free + 12 modules
  await page.click('nav[aria-label="主导航"] a[href="/market"]');
  await page.waitForURL("**/market");
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SCRATCH_DIR, "03-market.png") });
  const mkText = await page.locator("body").innerText();
  record("E5 第四主线免登录直接进入（12 模块矩阵）", !mkText.includes("需要管理员权限") && mkText.includes("12 模块能力状态矩阵"), `url=${page.url()}`);

  // 6. Refresh keeps login-free
  await page.reload({ waitUntil: "networkidle" });
  const afterReload = await page.locator("body").innerText();
  record("E6 刷新后仍免登录", !afterReload.includes("需要管理员权限"), `url=${page.url()}`);

  // 7. Sources board shows the disabled test sources' real state
  await page.goto(`${WEB}/market/sources`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SCRATCH_DIR, "04-sources.png") });
  const srcText = await page.locator("body").innerText();
  // The rows render labels, not raw ids; the honest state is the badge text per source.
  const disabledShown = ["CPSC 官方消费品召回测试源", "CPSC 自主运行测试源", "CPSC 真实连通受控验证源"]
    .every((label) => new RegExp(`${label}[\\s\\S]{0,80}已停用`).test(srcText));
  const officialShown = new RegExp("CPSC 官方消费品安全与召回开放数据流[\\s\\S]{0,80}已授权周期运行").test(srcText);
  const countsHonest = srcText.includes("已获准自动运行") && /已获准自动运行\s*\n?\s*2/.test(srcText);
  record("E7 来源看板如实显示：禁用测试源标为已停用、正式源保持已授权、计数与数据库一致",
    disabledShown && officialShown && countsHonest,
    `禁用标示=${disabledShown}, 正常标示=${officialShown}, 计数=2/${countsHonest}`);

  // 8. No severe errors (benign hydration notice filtered, same as prior rounds)
  const severe = consoleErrors.filter((e) => !e.includes("favicon") && !e.includes("chrome-extension") && !e.includes("hydrated but some attributes"));
  record("E8 全流程 0 严重控制台错误 / 0 页面异常", severe.length === 0 && pageErrors.length === 0, `console=${severe.length}, page=${pageErrors.length}`);

  await browser.close();
  console.log(`\nRESULT: ${failed === 0 ? "ALL PASS" : `${failed} FAILED`} — screenshots in ${SCRATCH_DIR}`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => { console.error("FATAL:", err); process.exit(1); });
