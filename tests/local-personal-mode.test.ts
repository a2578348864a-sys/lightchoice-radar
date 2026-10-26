// Local personal mode (RADAR_LOCAL_PERSONAL_MODE): the third and fourth lanes open to the operator's
// own loopback without an admin session, while every protection that is not "who are you" stays on.
// Run on an isolated *_test database through the standard runner; the API app is exercised with
// fastify.inject, so remoteAddress / Host are set per request — exactly what the gate inspects.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { config } from "@aihot/backend/config";
import { buildApp } from "../apps/api/src/app.ts";

const app = await buildApp();
await app.ready();

const LOCAL = { remoteAddress: "127.0.0.1" };
const LAN = { remoteAddress: "192.168.1.50" };
const localHost = { host: "127.0.0.1:3000" };

const SCENARIOS_BODY = {
  salePriceUsd: 29.99, purchaseCostUsd: 8, moqUnits: 500, shippingPerUnitUsd: 1.2, tariffRate: 0.075,
  referralFeeRate: 0.15, fbaPerUnitUsd: 4.5, adCpcUsd: 0.8, conversionRate: 0.1,
  monthlyAdBudgetUsd: 600, returnRate: 0.04, unitsOptimistic: 900, unitsBase: 600, unitsConservative: 300,
};

let originalLocalPersonal: boolean;

before(() => {
  originalLocalPersonal = config.localPersonal;
  config.localPersonal = true;
});

after(() => {
  config.localPersonal = originalLocalPersonal;
});

test("本地个人模式：本机回环请求免管理员会话读取第三主线", async () => {
  const res = await app.inject({ method: "GET", url: "/api/voc/overview", ...{ ...LOCAL, headers: localHost } });
  assert.equal(res.statusCode, 200, `overview -> ${res.statusCode}: ${res.body.slice(0, 200)}`);
});

test("本地个人模式：本机回环请求免管理员会话读取第四主线（状态与调度）", async () => {
  for (const url of ["/api/market/overview", "/api/market/scheduler/status", "/api/market/keywords"]) {
    const res = await app.inject({ method: "GET", url, ...{ ...LOCAL, headers: localHost } });
    assert.equal(res.statusCode, 200, `${url} -> ${res.statusCode}: ${res.body.slice(0, 200)}`);
  }
});

test("本地个人模式：局域网地址请求被拒绝（socket 对端判定，不看代理标头）", async () => {
  const res = await app.inject({ method: "GET", url: "/api/voc/overview", ...{ ...LAN, headers: { ...localHost, "x-forwarded-for": "127.0.0.1", "x-real-ip": "127.0.0.1" } } });
  assert.equal(res.statusCode, 401, `LAN with forged forwarded headers -> ${res.statusCode}`);
});

test("本地个人模式：伪造 Host（DNS 重绑定形态）被拒绝", async () => {
  for (const host of ["evil.example.com", "attacker.com:3001"]) {
    const res = await app.inject({ method: "GET", url: "/api/voc/overview", ...{ ...LOCAL, headers: { host } } });
    assert.equal(res.statusCode, 401, `host=${host} -> ${res.statusCode}`);
  }
});

test("本地个人模式：localhost 主机名同样放行", async () => {
  const res = await app.inject({ method: "GET", url: "/api/voc/overview", ...{ ...LOCAL, headers: { host: "localhost:3000" } } });
  assert.equal(res.statusCode, 200, `localhost host -> ${res.statusCode}`);
});

test("本地个人模式：写操作仍强制 CSRF（缺令牌与错令牌都是 403）", async () => {
  const noToken = await app.inject({ method: "POST", url: "/api/market/scenarios", ...{ ...LOCAL, headers: localHost }, body: SCENARIOS_BODY });
  assert.equal(noToken.statusCode, 403, `missing token -> ${noToken.statusCode}`);
  const badToken = await app.inject({ method: "POST", url: "/api/market/scenarios", ...{ ...LOCAL, headers: { ...localHost, "x-csrf-token": "wrong" } }, body: SCENARIOS_BODY });
  assert.equal(badToken.statusCode, 403, `wrong token -> ${badToken.statusCode}`);
});

test("本地个人模式：本机合法写操作凭 CSRF 令牌成功（纯计算与隔离库写路径）", async () => {
  const headers = { ...localHost, "x-csrf-token": "local-personal" };
  const calc = await app.inject({ method: "POST", url: "/api/market/scenarios", ...{ ...LOCAL, headers }, body: SCENARIOS_BODY });
  assert.equal(calc.statusCode, 200, `scenarios -> ${calc.statusCode}: ${calc.body.slice(0, 200)}`);
  const alerts = await app.inject({ method: "POST", url: "/api/market/alerts/evaluate", ...{ ...LOCAL, headers }, body: {} });
  assert.equal(alerts.statusCode, 200, `alerts/evaluate -> ${alerts.statusCode}: ${alerts.body.slice(0, 200)}`);
});

test("本地个人模式：跨站表单形态（无自定义标头、携带 Origin）无法通过写操作", async () => {
  const res = await app.inject({
    method: "POST", url: "/api/market/scenarios",
    ...{ ...LOCAL, headers: { ...localHost, "content-type": "application/x-www-form-urlencoded", origin: "https://evil.example.com" } },
    body: "salePriceUsd=1",
  });
  // The request is refused before any write either way — 415 (this API only parses JSON bodies) or,
  // were a form parser ever added, 403 (no CSRF header on a cross-site form). Both mean "refused".
  assert.ok(res.statusCode >= 400 && res.statusCode < 500, `cross-site form shape -> ${res.statusCode}`);
  assert.notEqual(res.statusCode, 200);
});

after(async () => {
  const { closeDb } = await import("@aihot/backend/db");
  await app.close().catch(() => {});
  await closeDb().catch(() => {});
});

test("关闭本地个人模式：原有管理员会话保护立即恢复", async () => {
  config.localPersonal = false;
  try {
    const read = await app.inject({ method: "GET", url: "/api/voc/overview", ...{ ...LOCAL, headers: localHost } });
    assert.equal(read.statusCode, 401, `mode off read -> ${read.statusCode}`);
    const write = await app.inject({ method: "POST", url: "/api/market/scenarios", ...{ ...LOCAL, headers: { ...localHost, "x-csrf-token": "local-personal" } }, body: SCENARIOS_BODY });
    assert.equal(write.statusCode, 401, `mode off write -> ${write.statusCode}`);
  } finally {
    config.localPersonal = true;
  }
});
