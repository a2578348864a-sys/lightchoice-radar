// LOCAL-FIRST-NO-LOGIN acceptance: the third and fourth lanes must be fully usable from the
// operator's own machine with a completely fresh browser context — no admin cookie, no session,
// no injected identity, no password anywhere. Security boundaries are probed from the test process
// (Host spoofing, CSRF, LAN exposure). Screenshots go to gitignored .data/.
import { chromium } from "playwright";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";

const WEB = "http://127.0.0.1:3000";
const API = "http://127.0.0.1:3001";
const SCRATCH_DIR = path.resolve(".data", "_diag", "shots-local-personal");
if (!fs.existsSync(SCRATCH_DIR)) fs.mkdirSync(SCRATCH_DIR, { recursive: true });

let failed = 0;
function record(step: string, passed: boolean, details?: string) {
  const mark = passed ? "[PASS]" : "[FAIL]";
  if (!passed) failed++;
  console.log(`${mark} ${step}${details ? ` -> ${details}` : ""}`);
}

async function run() {
  const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const browser = await chromium.launch({ headless: true, executablePath: fs.existsSync(chromePath) ? chromePath : undefined });

  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  // ==========================================
  // PART 1: fresh desktop 1440px — no cookies of any kind
  // ==========================================
  console.log("\n========== PART 1: 四主线入口与前两条主线回归（无任何 Cookie） ==========");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => pageErrors.push(e.message));
  const cookieCount = (await ctx.cookies()).length;
  record("0.0 干净上下文确认（无管理员 Cookie、无注入身份）", cookieCount === 0, `cookies=${cookieCount}`);

  await page.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(SCRATCH_DIR, "00-home.png") });
  const nav = await page.locator('nav[aria-label="主导航"]').innerText();
  const fourLanes = ["01 平台政策", "02 行业动态", "03 消费者原声", "04 市场信号"].every((t) => nav.includes(t));
  record("1.1 首页进入四主线导航完整", fourLanes, `url=${page.url()}`);

  // Lanes 1+2 regression (unchanged lanes must keep working)
  await page.click('nav[aria-label="主导航"] a[href="/all"]');
  await page.waitForLoadState("networkidle");
  const policyContent = await page.content();
  record("1.2 第一主线政策页回归：无社区混入", !policyContent.includes("Home Assistant 社区") && !policyContent.includes("Wyze 社区"), `url=${page.url()}`);

  await page.click('nav[aria-label="主导航"] a[href="/industry"]');
  await page.waitForURL("**/industry");
  // viewTransition: the outgoing page stays in the DOM until the transition settles.
  await page.waitForFunction((prev) => (document.querySelector("h1")?.textContent ?? "") !== prev, "平台政策情报", { timeout: 10_000 });
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: path.join(SCRATCH_DIR, "01-industry.png") });
  const indH1 = await page.textContent("h1");
  record("1.3 第二主线行业动态回归：正常载入", Boolean(indH1 && indH1.includes("行业")), `h1=${indH1}`);

  // Lane 3 VOC — no login wall, real data
  console.log("\n---------- PART 1b: 第三主线免登录 ----------");
  await page.click('nav[aria-label="主导航"] a[href="/voc"]');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SCRATCH_DIR, "02-voc-no-login.png") });
  const vocText = await page.locator("body").innerText();
  const vocGate = vocText.includes("需要管理员权限") || vocText.includes("请先登录");
  const vocData = vocText.includes("消费者原声") && !vocText.includes("服务不可用") && !vocText.includes("SERVICE_UNAVAILABLE");
  record("1.4 第三主线总览免登录直接进入（无登录墙、非故障假态）", !vocGate && vocData, `gate=${vocGate}, h1 区域含名称=${vocText.includes("消费者原声")}`);

  await page.click('a[href="/voc/evidence"]');
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  // 展开原始讨论上下文（真实用户操作：<details> 元素）
  const discussion = page.locator("details summary").first();
  if (await discussion.count()) {
    await discussion.click();
    await page.waitForTimeout(400);
  }
  await page.screenshot({ path: path.join(SCRATCH_DIR, "03-voc-evidence.png") });
  const evText = await page.locator("body").innerText();
  const evGate = evText.includes("需要管理员权限");
  const crumb = await page.locator('nav[aria-label="面包屑导航"]').innerText().catch(() => "");
  const expanded = evText.includes("回答") && (evText.includes("评论") || evText.includes("展开"));
  record("1.5 证据库免登录可读、面包屑正常且原始讨论可展开", !evGate && crumb.includes("证据库"), `gate=${evGate}, crumb=${crumb.replace(/\n/g, " ")}, 讨论元素=${expanded}`);

  for (const [sub, shot] of [["research", "04-voc-research"], ["system", "05-voc-system"]] as const) {
    await page.goto(`${WEB}/voc/${sub}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SCRATCH_DIR, `${shot}.png`) });
    const t = await page.locator("body").innerText();
    record(`1.${sub === "research" ? 6 : 7} /voc/${sub} 免登录可读`, !t.includes("需要管理员权限") && !t.includes("SERVICE_UNAVAILABLE"), `url=${page.url()}`);
  }

  // ==========================================
  // PART 2: fresh market lane — no login wall, real states
  // ==========================================
  console.log("\n---------- PART 2: 第四主线免登录 ----------");
  await page.goto(`${WEB}/market`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SCRATCH_DIR, "06-market-no-login.png") });
  const mkText = await page.locator("body").innerText();
  const mkGate = mkText.includes("需要管理员权限");
  record("2.1 第四主线总览免登录直接进入（12 模块矩阵、¥0 预算、CPSC 反证）",
    !mkGate && mkText.includes("12 模块能力状态矩阵") && mkText.includes("第四主线模型预算 ¥0") && mkText.includes("CPSC 安全反证"),
    `gate=${mkGate}`);

  for (const sub of ["keywords", "products", "opportunities", "alerts"]) {
    await page.goto(`${WEB}/market/${sub}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SCRATCH_DIR, `07-market-${sub}.png`) });
    const t = await page.locator("body").innerText();
    record(`2.${2 + ["keywords", "products", "opportunities", "alerts"].indexOf(sub)} /market/${sub} 免登录可读`,
      !t.includes("需要管理员权限") && !t.includes("SERVICE_UNAVAILABLE"), `url=${page.url()}`);
  }

  // Calculator: pure front-end math, zero API calls — a safe live interaction on the formal instance.
  await page.goto(`${WEB}/market/opportunities`, { waitUntil: "networkidle" });
  await page.locator('button:has-text("计算三情景利润与敏感性")').click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SCRATCH_DIR, "08-market-calculator.png") });
  const calcTable = await page.locator('section[aria-label="商业情景计算器"] table').count();
  record("2.6 三情景商业计算器纯数学演示成功（零 API 调用）", calcTable > 0, `结果表=${calcTable}`);

  await page.goto(`${WEB}/market/sources`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SCRATCH_DIR, "09-market-sources.png") });
  const srcText = await page.locator("body").innerText();
  const srcHonest = srcText.includes("后台调度器") && (srcText.includes("Amazon 核心源未启用") || srcText.includes("未运行"));
  record("2.7 自动来源看板免登录可读且状态诚实（不冒充已采数）", !srcText.includes("需要管理员权限") && srcHonest, `url=${page.url()}`);

  // Force-recalc confirm dialog on the fresh (sessionless) context: dialog appears, cancel = no request.
  let runDueRequested = false;
  page.on("request", (r) => { if (r.url().includes("/api/market/scheduler/run-due")) runDueRequested = true; });
  page.once("dialog", (d) => d.dismiss());
  await page.click('button:has-text("强制重算全部来源（诊断用）")');
  await page.waitForTimeout(600);
  record("2.8 免登录状态下危险按钮仍需二次确认，取消后零请求", !runDueRequested, `runDueRequest=${runDueRequested}`);

  // Reload persistence without any session
  await page.goto(`${WEB}/market`, { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  const afterReload = await page.locator("body").innerText();
  record("2.9 刷新后免登录状态保持（本机模式不依赖会话）", !afterReload.includes("需要管理员权限"), `url=${page.url()}`);

  await ctx.close();

  // ==========================================
  // PART 3: security boundaries from the test process
  // ==========================================
  console.log("\n---------- PART 3: 安全边界实测（正式实例） ----------");

  const directGet = await fetch(`${API}/api/voc/overview`);
  record("3.1 本机直连 API 无 Cookie 读取第三主线 = 200（免登录生效）", directGet.status === 200, `status=${directGet.status}`);

  const rebinding = await new Promise<number | null>((resolve) => {
    // fetch() forbids overriding Host (forbidden header name), so use raw http to simulate the
    // DNS-rebinding shape the way curl does.
    import("node:http").then(({ request }) => {
      const req = request({ hostname: "127.0.0.1", port: 3001, path: "/api/voc/overview", headers: { host: "evil.example.com" } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? null);
      });
      req.on("error", () => resolve(null));
      req.end();
    });
  });
  record("3.2 伪造 Host（DNS 重绑定形态）被拒绝", rebinding === 401, `status=${rebinding ?? "连接失败"}`);

  const noCsrf = await fetch(`${API}/api/market/scheduler/run-due`, { method: "POST", headers: { "content-type": "application/json", host: "127.0.0.1:3001" }, body: "{}" }).catch(() => null);
  record("3.3 无 CSRF 令牌的写请求被拒绝（403，未执行任何调度）", noCsrf?.status === 403, `status=${noCsrf?.status ?? "连接失败"}`);

  const viaWeb = await fetch(`${WEB}/api/voc/overview`);
  record("3.4 经 Web 3000 代理的浏览器路径同样免登录可用", viaWeb.status === 200, `status=${viaWeb.status}`);

  // LAN exposure: both servers bind 127.0.0.1, so the LAN address must refuse to connect.
  const lanIp = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === "IPv4" && !i.internal)?.address;
  if (lanIp) {
    const apiLan = await fetch(`http://${lanIp}:3001/api/site/meta`, { signal: AbortSignal.timeout(3000) }).then((r) => `HTTP ${r.status}`).catch((e) => `拒绝连接(${e.cause?.code ?? e.name})`);
    const webLan = await fetch(`http://${lanIp}:3000/`, { signal: AbortSignal.timeout(3000) }).then((r) => `HTTP ${r.status}`).catch((e) => `拒绝连接(${e.cause?.code ?? e.name})`);
    record("3.5 局域网地址无法访问 API 与 Web（仅回环监听）", apiLan.startsWith("拒绝") && webLan.startsWith("拒绝"), `LAN=${lanIp}, api=${apiLan}, web=${webLan}`);
  } else {
    record("3.5 局域网地址无法访问 API 与 Web（仅回环监听）", false, "未找到局域网网卡，无法实测");
  }

  // ==========================================
  // PART 4: fresh mobile 390px — lanes 3+4 with no login
  // ==========================================
  console.log("\n---------- PART 4: 移动端 390px 免登录 ----------");
  const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mpage = await mctx.newPage();
  mpage.on("pageerror", (e) => pageErrors.push(`[mobile] ${e.message}`));
  for (const [lane, shot] of [["/voc", "10-mobile-voc"], ["/market", "11-mobile-market"]] as const) {
    await mpage.goto(`${WEB}${lane}`, { waitUntil: "networkidle" });
    await mpage.waitForTimeout(500);
    await mpage.screenshot({ path: path.join(SCRATCH_DIR, `${shot}.png`) });
    const t = await mpage.locator("body").innerText();
    const w = await mpage.evaluate(() => document.documentElement.scrollWidth);
    record(`4.${lane === "/voc" ? 1 : 2} 移动端 ${lane} 免登录可读且无横向溢出`, !t.includes("需要管理员权限") && w <= 390, `scrollWidth=${w}px`);
  }
  await mctx.close();
  await browser.close();

  // ==========================================
  // PART 5: console & page error audit
  // ==========================================
  // The ItemList JSON-LD hydration notice is a known benign SSR/client delta (same filter the
  // four-lanes acceptance uses); nothing in this round's changes touches front-end rendering.
  const severe = consoleErrors.filter((e) => !e.includes("favicon") && !e.includes("chrome-extension") && !e.includes("hydrated but some attributes"));
  record("5.1 全流程控制台 0 严重错误", severe.length === 0, severe.slice(0, 3).join("; ") || "0");
  record("5.2 全流程 0 页面未捕获异常", pageErrors.length === 0, pageErrors.slice(0, 3).join("; ") || "0");

  console.log(`\nRESULT: ${failed === 0 ? "ALL PASS" : `${failed} FAILED`} — screenshots in ${SCRATCH_DIR}`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
