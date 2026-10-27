import assert from "node:assert/strict";
import { test } from "node:test";
import { isFormalProductSafetyEvent, type ProductSafetyEvent } from "@aihot/backend/market/market-model";
import { isFormalMarketSignal, type MarketSignal } from "@aihot/backend/market/market-metrics";

test("isFormalProductSafetyEvent: blocks synthetic runs, test GUIDs, test sources, and future dates", () => {
  const now = new Date("2026-10-27T12:00:00.000Z");

  const validEvt: ProductSafetyEvent = {
    id: "evt:cpsc:recall:valid1",
    sourceId: "cpsc-product-recalls",
    officialUrl: "https://www.cpsc.gov/Recalls/2026/real-product-recall",
    recallTitle: "Real Baby Stroller Recalled Due to Latch Failure",
    productName: "SafeStroll Stroller",
    hazardType: "fall",
    hazardDescriptionZh: "锁扣松动跌落风险",
    categoryCandidate: {
      rawCategory: "Baby Products",
      normalizedCategoryZh: "母婴出行",
      mappingBasis: "分词推断",
      confidence: "high",
      humanConfirmed: false,
      browseNodeId: null,
    },
    sourcePublishedAt: "2026-10-25T00:00:00.000Z",
    observedAt: "2026-10-25T10:00:00.000Z",
    ingestedAt: "2026-10-25T10:00:00.000Z",
    explanation: {
      officialAnnouncementZh: "官方通告",
      productScopeZh: "涉及品类",
      safetyRiskZh: "安全风险",
      whyResearchWorthyZh: "反证价值",
      developmentCautionZh: "研发避坑",
      amazonIdentityVerificationZh: "未绑定",
      unsupportedConclusionsZh: ["严禁推断为爆品商机"],
    },
  };

  // 1. Valid event passes
  assert.equal(isFormalProductSafetyEvent(validEvt, now), true);

  // 2. Synthetic run is blocked
  const synthEvt: ProductSafetyEvent = {
    ...validEvt,
    id: "evt:cpsc:recall:synth1",
    runId: "cpsc-synth-run-1793004849037",
    officialUrl: "https://www.cpsc.gov/Recalls/2026/test-cpsc-test-guid-1793004849037",
    productName: "Apex Thermal Flask",
  };
  assert.equal(isFormalProductSafetyEvent(synthEvt, now), false);

  // 3. Test sourceId is blocked
  const testSourceEvt: ProductSafetyEvent = {
    ...validEvt,
    sourceId: "cpsc-test-source",
  };
  assert.equal(isFormalProductSafetyEvent(testSourceEvt, now), false);

  const autorunSourceEvt: ProductSafetyEvent = {
    ...validEvt,
    sourceId: "cpsc-autorun-source",
  };
  assert.equal(isFormalProductSafetyEvent(autorunSourceEvt, now), false);

  // 4. Future date is blocked
  const futureEvt: ProductSafetyEvent = {
    ...validEvt,
    sourcePublishedAt: "2026-11-05T00:00:00.000Z",
  };
  assert.equal(isFormalProductSafetyEvent(futureEvt, now), false);

  // 5. Non-cpsc URL or mock URL is blocked
  const fakeUrlEvt: ProductSafetyEvent = {
    ...validEvt,
    officialUrl: "http://example.com/fake-recall",
  };
  assert.equal(isFormalProductSafetyEvent(fakeUrlEvt, now), false);
});

test("isFormalMarketSignal: blocks future dates, test sources, test products, and synthetic evidence", () => {
  const now = new Date("2026-10-27T12:00:00.000Z");

  const validSignal: MarketSignal = {
    id: "kw-rise:amz123-us-keywords:2026-10-20:stainless-tumbler",
    module: "01",
    kind: "keyword-rank-rise",
    subjectZh: "关键词「stainless tumbler」排名上升 8 位",
    detailZh: "本周第 20 名（上周第 28 名）；排名前进不等于需求增长百分比",
    strength: 8,
    evidenceRefs: ["market://keywords/amz123-us-keywords/2026-10-20"],
    basisVersions: ["amz123-us-keywords@2026-10-20#rows=50"],
    formulaVersion: "market-metrics-v1",
    at: "2026-10-20T00:00:00.000Z",
  };

  // 1. Valid formal signal passes
  assert.equal(isFormalMarketSignal(validSignal, now), true);

  // 2. Future observation date is blocked
  const futureSignal: MarketSignal = {
    ...validSignal,
    at: "2026-11-02T00:00:00.000Z",
  };
  assert.equal(isFormalMarketSignal(futureSignal, now), false);

  // 3. Future date in evidenceRefs (e.g. 2026-11-02) is blocked
  const futureRefSignal: MarketSignal = {
    ...validSignal,
    evidenceRefs: ["market://chart/amazon-us-bestsellers-beauty/2026-11-02"],
  };
  assert.equal(isFormalMarketSignal(futureRefSignal, now), false);

  // 4. Test source in basisVersions is blocked
  const testBasisSignal: MarketSignal = {
    ...validSignal,
    basisVersions: ["test-amz-chart@2026-10-20#rows=1"],
  };
  assert.equal(isFormalMarketSignal(testBasisSignal, now), false);

  // 5. Test product in title is blocked
  const testProductSignal: MarketSignal = {
    ...validSignal,
    subjectZh: "新进入榜单：New Entrant Product",
  };
  assert.equal(isFormalMarketSignal(testProductSignal, now), false);

  const histTestProductSignal: MarketSignal = {
    ...validSignal,
    subjectZh: "榜单位次变化：Historical Test Product",
  };
  assert.equal(isFormalMarketSignal(histTestProductSignal, now), false);

  // 6. Test keyword source is blocked
  const testKwBasisSignal: MarketSignal = {
    ...validSignal,
    basisVersions: ["test-amz123@2026-10-20#rows=20"],
  };
  assert.equal(isFormalMarketSignal(testKwBasisSignal, now), false);
});
