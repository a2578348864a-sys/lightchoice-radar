import assert from "node:assert/strict";
import { test } from "node:test";
import { config } from "@aihot/backend/config";
import { classifyRadarText, summarizeRadarPolicy } from "@aihot/backend/editorial/radar-rules";
import { buildPolicyExplanation, keepCompleteExplanation, EXPLANATION_RULE_VERSION } from "@aihot/backend/editorial/policy-explain";
import { isCurrentMaterialHash } from "@aihot/backend/content/materials";
import { normalizeRadarMonitor } from "@aihot/backend/admin/radar-monitors";
import { radarExportMarkdown, type RadarExport } from "@aihot/backend/publication/radar";
import { paidRequest } from "@aihot/backend/providers/receipts";

test("Radar forces rule-only mode and blocks paid callbacks before network work", async () => {
  assert.equal(config.ruleOnlyMode, true);
  let called = false;
  await assert.rejects(
    () => paidRequest({} as never, async () => { called = true; throw new Error("paid callback must not run"); }),
    /Paid provider requests are disabled in LightChoice Radar mode/,
  );
  assert.equal(called, false);
});

test("Radar rules return source-field offsets and leave unrelated text unclassified", () => {
  const title = "Amazon seller policy update changes listing requirements";
  const result = classifyRadarText({ title });
  // A seller policy update that changes listing requirements is both a platform policy change and a
  // seller program rule change; both rules own their own evidence.
  assert.deepEqual(result.tags, ["亚马逊平台政策线索", "亚马逊卖家项目规则线索"]);
  const policy = result.evidence.find((e) => e.ruleId === "platform-policy");
  assert.ok(policy);
  assert.equal(title.slice(policy.start, policy.end), policy.matchedText);
  assert.equal(policy.field, "title");
  assert.deepEqual(classifyRadarText({ title: "Quarterly report published" }).tags, []);
});

test("A to B to A is a new current revision; only the current hash is a duplicate", () => {
  const a = "hash-a";
  const b = "hash-b";
  assert.equal(isCurrentMaterialHash(a, a), true);
  assert.equal(isCurrentMaterialHash(a, b), false);
  assert.equal(isCurrentMaterialHash(b, a), false);
});

test("saved keyword monitors normalize whitespace and reject empty fields", () => {
  assert.deepEqual(normalizeRadarMonitor({ name: "  门锁反馈  ", query: " smart   lock  battery " }), { name: "门锁反馈", query: "smart lock battery" });
  assert.throws(() => normalizeRadarMonitor({ name: "", query: "battery" }), /监控名称不能为空/);
  assert.throws(() => normalizeRadarMonitor({ name: "电池", query: "  " }), /关键词不能为空/);
});

test("Markdown export preserves source, collection time, and rule evidence", () => {
  const text = radarExportMarkdown({
    generatedAt: "2026-10-21T00:00:00.000Z",
    filters: { q: null, from: null, to: null, channel: "all", category: null, tag: null },
    total: 1, truncated: false,
    items: [{
      id: "abc", title: "Battery stopped working", summary: "Battery failed after one week", reason: null,
      source: { name: "Forum" }, originalUrl: "https://example.test/item/1", publishedAt: null, discoveredAt: "2026-10-20T16:00:00.000Z",
      timelineAt: "2026-10-20T16:00:00.000Z", category: null, tags: ["线索：产品问题"], score: null, selected: false, channel: "news",
      x: null, ruleVersion: "radar-rules-v1", ruleEvidence: [{ ruleId: "product-problem", label: "产品问题线索", field: "title", start: 8, end: 26, matchedText: "stopped working", context: "Battery stopped working" }],
    }],
  } as RadarExport);
  assert.match(text, /https:\/\/example\.test\/item\/1/);
  assert.match(text, /收录时间/);
  assert.match(text, /产品问题线索/);
  assert.match(text, /stopped working/);
});

// ---- Chinese policy explanations (editorial/policy-explain.ts) --------------------------------

const FR_SOURCE = { name: "美国监管｜联邦公报 FTC 规则与拟议规则 RSS", kind: "rss", tags: ["external_regulation"] };

test("a proposed rule reads as 拟议, its change claim stays qualified, and dates keep their own labels", () => {
  const explanation = buildPolicyExplanation({
    revision: 1,
    title: "Rule on Impersonation of Government and Businesses",
    url: "https://www.federalregister.gov/d/2026-0001",
    publishedAt: new Date("2026-10-01T04:00:00Z"),
    publicationTime: "2026-10-01",
    discoveredAt: new Date("2026-10-22T16:02:44Z"),
    bodyText: null,
    excerpt: 'The Federal Trade Commission ("FTC") proposes to commence a rulemaking to amend its rules against impersonation.',
    bodyStatus: "pending",
    source: FR_SOURCE, tags: [], ruleEvidence: [], hasRuleSummary: false, translationZh: null,
  });
  assert.ok(explanation);
  assert.equal(explanation.ruleVersion, EXPLANATION_RULE_VERSION);
  assert.equal(explanation.method, "rule");
  assert.equal(explanation.material, "excerpt");
  assert.equal(explanation.complete, true, "a source excerpt covers the same fields an excerpt can support");
  assert.match(explanation.oneLiner, /拟议文件线索/);
  assert.ok(explanation.current.some((line) => line.includes("拟议阶段")), "拟议 must not read as implemented");
  assert.ok(explanation.change, "the official text itself says something is amended");
  assert.match(explanation.change!.statement, /尚未实施/);
  assert.ok(explanation.pending.some((line) => line.includes("拟议阶段")));
  assert.match(explanation.notice, /不是模型翻译/);
  const published = explanation.keyDates.find((d) => d.kind === "published");
  const discovered = explanation.keyDates.find((d) => d.kind === "discovered");
  assert.ok(published && /官方发布日期/.test(published.label));
  assert.ok(discovered && /不是发布日期/.test(discovered.label), "a discovery date never reads as a publication date");
  assert.equal(explanation.keyDates.some((d) => d.kind === "effective-claim"), false, "no effective date was claimed");
});

test("a recall summary with no change claim describes only the current requirement", () => {
  const explanation = buildPolicyExplanation({
    revision: 1,
    title: "ONTHEWEI Recalls Baby Bath Seats Due to Risk of Serious Injury",
    url: "https://www.cpsc.gov/Recalls/2026/example",
    publishedAt: new Date("2026-10-07T16:00:00Z"),
    publicationTime: "2026-10-07",
    discoveredAt: new Date("2026-10-22T16:02:43Z"),
    bodyText: null,
    excerpt: "The recalled bath seats violate the mandatory standard for infant bath seats because they are unstable and can tip over, posing a drowning hazard.",
    bodyStatus: "pending",
    source: { name: "美国监管｜CPSC 官方产品召回 RSS", kind: "rss", tags: ["external_regulation", "产品召回"] },
    tags: ["美国监管与产品召回线索"], ruleEvidence: [], hasRuleSummary: false, translationZh: null,
  });
  assert.ok(explanation);
  assert.equal(explanation.change, null, "no official change statement means no change claim");
  assert.ok(explanation.pending.some((line) => line.includes("不作变化判断")));
  assert.ok(explanation.appliesTo?.includes("美国政府监管机构"));
  assert.ok(explanation.current.some((line) => line.includes("美国监管信息")));
  assert.ok(explanation.checks.includes("中文说明不含材料中不存在的数字"));
});

test("title-only material is a partial explanation and never invents numbers", () => {
  const explanation = buildPolicyExplanation({
    revision: 1,
    title: "Update to U.S. Referral and Fulfillment by Amazon fees for 2026",
    url: "https://sellercentral.amazon.com/fee-updates",
    publishedAt: null, publicationTime: null, discoveredAt: new Date("2026-10-21T17:03:43Z"),
    bodyText: null, excerpt: null, bodyStatus: "pending",
    source: { name: "亚马逊官方｜美国站销售与 FBA 年度费用更新", kind: "web_list", tags: ["platform_policy"] },
    tags: ["费用与物流线索"], ruleEvidence: [], hasRuleSummary: false, translationZh: null,
  });
  assert.ok(explanation);
  assert.equal(explanation.material, "title-only");
  assert.equal(explanation.complete, false);
  assert.ok(explanation.pending.some((line) => line.includes("仅取得标题")));
  assert.ok(explanation.pending.some((line) => line.includes("不能当作发布日期")), "no publication date must say so");
  const generated = [explanation.oneLiner, ...explanation.current, explanation.appliesTo ?? "", ...explanation.pending].join("\n");
  const material = "Update to U.S. Referral and Fulfillment by Amazon fees for 2026";
  for (const number of generated.match(/\d+(?:[.,]\d+)*/g) ?? []) {
    assert.ok(material.includes(number), `no invented number: ${number}`);
  }
  assert.equal(explanation.change, null);
});

test("evidence must be verbatim in its stored field, and a complete explanation is never downgraded", () => {
  const base = {
    revision: 1, title: "Amazon seller policy update", url: "https://example.test/a",
    publishedAt: new Date("2026-05-22T00:00:00Z"), publicationTime: "2026-05-22", discoveredAt: new Date("2026-10-22T07:35:39Z"),
    bodyText: "Amazon seller policy update: the requirement of maintaining a 95% valid tracking rate is removed.",
    excerpt: null, bodyStatus: "ok",
    source: { name: "亚马逊官方｜美国站公告列表", kind: "web_list", tags: ["platform_policy"] },
    tags: ["亚马逊平台政策线索"], hasRuleSummary: true, translationZh: null,
  };
  const good = { ruleId: "seller-program-rules", label: "卖家项目资格与运营规则", field: "body" as const, matchedText: "requirement of maintaining" };
  const forged = { ruleId: "fees-logistics", label: "销售费用与物流费率", field: "body" as const, matchedText: "10% surcharge" };
  const explanation = buildPolicyExplanation({ ...base, ruleEvidence: [good, forged] });
  assert.ok(explanation);
  assert.deepEqual(explanation.evidence.map((e) => e.matchedText), ["requirement of maintaining"], "an unmatched excerpt is dropped");
  assert.equal(explanation.checks.includes("证据摘录逐字来自原文字段"), false, "a dropped excerpt fails the verbatim check");
  assert.ok(explanation.current.some((line) => line.includes("已有依据正文明确表述整理的中文政策摘要")));
  assert.ok(explanation.change, "the official text says a requirement is removed");

  const partial = { ...explanation, complete: false, material: "title-only" as const };
  assert.equal(keepCompleteExplanation(explanation, partial), explanation, "an incomplete run never shadows a complete one of the same version");
  assert.equal(keepCompleteExplanation(explanation, explanation), explanation);
  assert.equal(keepCompleteExplanation(null, explanation), explanation);
  assert.equal(keepCompleteExplanation(explanation, null), explanation, "no new result keeps the stored one");
  const newer = { ...explanation, inputRevision: 2, complete: false, material: "title-only" as const };
  assert.equal(keepCompleteExplanation(explanation, newer), newer, "a new material version stands on its own");
});
