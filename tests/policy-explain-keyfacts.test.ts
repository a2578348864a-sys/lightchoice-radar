// Positive and negative cases for the scannable facts the rule engine lifts out of stored material
// (editorial/policy-explain.ts keyFactsOf). Pure function: no database, no provider.
import "./setup.ts";
import assert from "node:assert/strict";
import { test } from "node:test";
import { keyFactsOf, type ExplanationInput } from "@aihot/backend/editorial/policy-explain";
import { chineseProductHint, keyFactsFromMaterial } from "@aihot/backend/editorial/key-facts";

const CPSC = { name: "美国监管｜CPSC 官方产品召回 RSS", kind: "rss", tags: [] };
const FTC = { name: "美国监管｜联邦公报 FTC 规则与拟议规则 RSS", kind: "rss", tags: [] };
const PLAIN = { name: "某个没有机构名的来源", kind: "rss", tags: [] };

const base: ExplanationInput = {
  revision: 1, title: "", url: "https://example.org/x", publishedAt: new Date("2026-10-22"),
  bodyText: null, excerpt: null, source: CPSC, tags: [], ruleEvidence: [], hasRuleSummary: false,
};

const of = (fields: Partial<ExplanationInput>): ExplanationInput => ({ ...base, ...fields });
const labels = (input: ExplanationInput) => keyFactsOf(input).map((f) => f.label);

test("a recall headline yields the product, the hazards and the measure, each with its source field", () => {
  const facts = keyFactsOf(of({
    title: "Costway Recalls Convertible High Chairs Due to Risk of Serious Injury or Death from Entrapment and Fall Hazards; Violate Mandatory Standard for High Chairs",
    excerpt: "The convertible high chairs violate the mandatory safety standard for high chairs because children can slip through the opening between the tray and the seat.",
  }));
  const byLabel = new Map(facts.map((f) => [f.label, f]));
  assert.match(byLabel.get("涉及商品")!.value, /Costway 召回 Convertible High Chairs/);
  assert.match(byLabel.get("主要风险")!.value, /夹困/);
  assert.match(byLabel.get("主要风险")!.value, /跌落/);
  assert.equal(byLabel.get("官方做法")!.value, "召回（recall）");
  assert.equal(byLabel.get("发布机构")!.value, "美国消费品安全委员会（CPSC）");
  for (const f of facts) assert.ok(f.evidence.length > 0, `${f.label} carries its evidence`);
});

test("amounts and unit counts come from the text that printed them", () => {
  const facts = keyFactsOf(of({
    title: "VQQQ Gas Patio Heaters Recalled Due to Risk of Serious Injury or Death from Fire and Burn Hazards",
    excerpt: "About 12,300 units were sold in the United States. Consumers with the recalled patio heaters should receive a refund of $85 to $120.",
  }));
  const amounts = facts.find((f) => f.label === "数量与金额");
  assert.ok(amounts, "the amount fact exists");
  assert.match(amounts!.value, /12,300 units/);
  assert.match(amounts!.value, /\$85 to \$120/);
});

test("a proposed Federal Register rule is labelled proposed, not issued", () => {
  const facts = keyFactsOf(of({
    source: FTC,
    title: "Rule on Impersonation of Government and Businesses",
    excerpt: "The Federal Trade Commission proposes to commence a rulemaking proceeding to prevent certain unfair or deceptive acts or practices by search engine, social media, and other digital marketplace platforms.",
  }));
  assert.equal(facts.find((f) => f.label === "文件类型")!.value, "拟议规则（尚未生效）");
  assert.equal(facts.find((f) => f.label === "发布机构")!.value, "美国联邦贸易委员会（FTC）");
  assert.ok(!labels(base).includes("涉及商品"), "no product fact without a recall headline");
});

test("material that states nothing of the sort produces no facts at all", () => {
  const facts = keyFactsOf(of({
    source: PLAIN,
    title: "Rules of Practice",
    excerpt: "The Commission published a document about its rules of practice.",
  }));
  assert.deepEqual(facts, [], "nothing is invented to fill the block");
});

test("a hazard word the table does not know is not translated into a guess", () => {
  const facts = keyFactsOf(of({
    title: "Some Brand Recalls A Widget Due to Risk of Ultraviolet Overexposure",
    excerpt: "The widget emits ultraviolet light.",
  }));
  const hazards = facts.find((f) => f.label === "主要风险");
  // "serious injury or death" is not in this text, and ultraviolet overexposure is not in the table:
  // the block says nothing about the risk rather than naming the wrong one.
  assert.equal(hazards, undefined);
  assert.match(facts.find((f) => f.label === "涉及商品")!.value, /Some Brand 召回 A Widget/);
});

test("the shared extractor names the product in Chinese only when the translated title says it plainly", () => {
  // "Costway 因可转换高脚椅存在夹困和跌落风险…而召回" → the phrase between 因 and the hazard verb.
  assert.equal(chineseProductHint("Costway 因可转换高脚椅存在夹困和跌落风险导致严重伤害或死亡而召回；违反高脚椅强制性标准"), "可转换高脚椅");
  // A hazard phrase is not a product name.
  assert.equal(chineseProductHint("某品牌 因存在火灾和烧伤危险导致严重伤害或死亡而召回"), null);
  // Nothing between 因 and a hazard verb: no hint, the English name stands alone.
  assert.equal(chineseProductHint("某品牌 召回存在问题产品"), null);
  assert.equal(chineseProductHint(null), null);

  const facts = keyFactsFromMaterial({
    title: "Costway Recalls Convertible High Chairs Due to Risk of Serious Injury or Death from Entrapment and Fall Hazards",
    excerpt: "The convertible high chairs violate the mandatory safety standard for high chairs.",
    sourceName: "美国监管｜CPSC 官方产品召回 RSS",
    chineseTitle: "Costway 因可转换高脚椅存在夹困和跌落风险导致严重伤害或死亡而召回；违反高脚椅强制性标准",
  });
  const product = facts.find((f) => f.label === "涉及商品");
  assert.match(product!.value, /^Costway 召回 Convertible High Chairs（可转换高脚椅）$/);
  assert.match(product!.evidence, /Costway Recalls Convertible High Chairs Due to（title）/);
});

test("the read layer computes the same facts for an article with no explanation record", () => {
  // What publication/detail.ts passes: the stored fields, no analysis output anywhere.
  const facts = keyFactsFromMaterial({
    title: "Decathlon America Recalls Van Rysel GRVL AF Bicycles Due to Risk of Serious Injury from Fall Hazard",
    excerpt: "The recalled bicycles' front lock nut can loosen during use, posing a fall hazard.",
    sourceName: "美国监管｜CPSC 官方产品召回 RSS",
    chineseTitle: "Decathlon America 召回 Van Rysel GRVL AF 自行车，因前锁紧螺母可能松动导致跌落危险",
  });
  const labels = facts.map((f) => f.label);
  assert.ok(labels.includes("涉及商品"), "product from the recall headline");
  assert.ok(labels.includes("主要风险"), "hazard from the summary");
  assert.ok(labels.includes("发布机构"), "agency from the source name");
  assert.ok(!labels.includes("数量与金额"), "no numbers in the material → no amount fact");
  for (const f of facts) assert.ok(f.evidence.length > 0);
});

test("several hazards in one headline are all kept, including asphyxiation", () => {
  const facts = keyFactsFromMaterial({
    title: "usOpal Recalls Xalirium Portable Bed Rails Due to Risk of Serious Injury or Death from Entrapment and Asphyxiation; Violate Mandatory Standard for Adult Portable Bed Rails",
    excerpt: "The recalled bed rails violate the mandatory standard for adult portable bed rails.",
    sourceName: "美国监管｜CPSC 官方产品召回 RSS",
    chineseTitle: "usOpal 召回 Xalirium 便携式床栏，因存在夹困和窒息导致严重伤害或死亡的风险",
  });
  const hazards = facts.find((f) => f.label === "主要风险")!.value;
  for (const word of ["夹困", "窒息", "严重伤害或死亡"]) assert.ok(hazards.includes(word), `${word} missing from ${hazards}`);
});

test("a company name with a comma and a phthalate hazard are both kept", () => {
  const facts = keyFactsFromMaterial({
    title: "Papablic, of USA Recalls Convertible Bedside Sleepers Due to Risk of Serious Injury or Death from Entrapment and Fall Hazards",
    excerpt: "The bedside sleepers with play yard extensions violate the mandatory standard for bedside sleepers.",
    sourceName: "美国监管｜CPSC 官方产品召回 RSS",
  });
  const product = facts.find((f) => f.label === "涉及商品");
  assert.match(product!.value, /^Papablic, of USA 召回 Convertible Bedside Sleepers$/);

  const purses = keyFactsFromMaterial({
    title: "Primark Recalls 101 Dalmatians Faux Leather Children’s Coin Purses Due to Phthalate Levels and Risk of Serious Injury",
    excerpt: "The coin purses contain higher phthalate concentration levels than allowed.",
    sourceName: "美国监管｜CPSC 官方产品召回 RSS",
  });
  assert.match(purses.find((f) => f.label === "主要风险")!.value, /邻苯二甲酸盐超标/);
});
