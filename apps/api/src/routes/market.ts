// The fourth lane's private API (market signals). Same posture as the VOC API: every route behind
// adminHandler — market evidence, opportunities and human decisions are private research material.
// Reads never trigger collection or model calls; writes are import/review/alert actions only.
import type { FastifyInstance } from "fastify";
import { adminHandler } from "./admin-auth.ts";
import { loadMarketOverview, loadKeywordView, loadProductView, loadOpportunityView, loadAlertsView } from "@aihot/backend/market/market-read";
import { keywordHistoryDetail, productHistoryDetail, categoryMarketSummary, detectMarketSignals, isFormalMarketSignal } from "@aihot/backend/market/market-metrics";
import { seedMarketSources } from "@aihot/backend/market/market-import";
import { getMarketSchedulerStatus, runDueMarketSources } from "@aihot/backend/market/market-scheduler";
import { buildOpportunityCandidates, computeScenarios, evaluateAlerts, propagateSourceRevocation, refreshOpportunities, retireUnqualifiedAlerts, reviewOpportunity, type ScenarioInput } from "@aihot/backend/market/market-opportunity";
import { revokeMarketSource, saveMarketAlertRule, saveMarketSource, saveMarketExternalRecord, loadMarketExternalRecords, saveMarketInnovationCue, loadMarketInnovationCues, loadProductSafetyEvents, isFormalProductSafetyEvent, type MarketSource, type MarketExternalRecord, type MarketInnovationCue } from "@aihot/backend/market/market-model";

export function registerMarket(app: FastifyInstance) {
  const noStore = { "Cache-Control": "no-store" } as const;

  // Area 1 — overview: 12-module honest board, sources, counts, gaps, budget state.
  app.get("/api/market/overview", adminHandler(async (_req, reply) => reply.headers(noStore).send(await loadMarketOverview())));

  // Area 2 — keyword demand (module 01) with honest filters & multi-period history.
  app.get("/api/market/keywords", adminHandler(async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    return reply.headers(noStore).send(await loadKeywordView({ direction: q.direction, q: q.q, limit: q.limit ? Number(q.limit) : undefined, periodStart: q.periodStart }));
  }));
  app.get("/api/market/keywords/history", adminHandler(async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    if (!q.keyword) return reply.status(400).send({ error: "keyword 查询参数必填" });
    return reply.headers(noStore).send(await keywordHistoryDetail(q.keyword));
  }));

  // Area 3 — products & competition & prices (modules 03/04/05/06) & categories (module 02).
  app.get("/api/market/products", adminHandler(async (_req, reply) => reply.headers(noStore).send(await loadProductView())));
  app.get("/api/market/products/history", adminHandler(async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    if (!q.asin) return reply.status(400).send({ error: "asin 查询参数必填" });
    return reply.headers(noStore).send(await productHistoryDetail(q.asin));
  }));
  app.get("/api/market/categories", adminHandler(async (_req, reply) => reply.headers(noStore).send(await categoryMarketSummary())));

  // Area 4 — opportunities (modules 10/12) + generation + review + scenario calculator.
  app.get("/api/market/opportunities", adminHandler(async (_req, reply) => reply.headers(noStore).send(await loadOpportunityView())));
  app.post("/api/market/opportunities/build", adminHandler(async (req, reply) => {
    const body = (req.body ?? {}) as { minRise?: number };
    return reply.headers(noStore).send({ created: await buildOpportunityCandidates({ minRise: body.minRise }) });
  }));
  app.post("/api/market/opportunities/review", adminHandler(async (req, reply) => {
    const body = req.body as { id: string; action: string; note?: string };
    const allowed = ["deep-dive", "watch", "need-evidence", "high-risk", "exclude", "mark-reviewed"] as const;
    if (!body?.id || !allowed.includes(body.action as never)) return reply.status(400).send({ error: "id 和合法 action 必填" });
    const r = await reviewOpportunity(body.id, body.action as never, body.note, "admin");
    return r.ok ? reply.headers(noStore).send(r) : reply.status(404).send(r);
  }));
  app.post("/api/market/scenarios", adminHandler(async (req, reply) => {
    const body = req.body as Partial<ScenarioInput>;
    const required: Array<keyof ScenarioInput> = ["salePriceUsd", "purchaseCostUsd", "moqUnits", "shippingPerUnitUsd", "tariffRate", "referralFeeRate", "fbaPerUnitUsd", "adCpcUsd", "conversionRate", "monthlyAdBudgetUsd", "returnRate", "unitsOptimistic", "unitsBase", "unitsConservative"];
    const missing = required.filter((k) => typeof body[k] !== "number");
    if (missing.length) return reply.status(400).send({ error: `缺少数值输入：${missing.join(", ")}` });
    return reply.headers(noStore).send(computeScenarios(body as ScenarioInput));
  }));

  // Area 5 — alerts (module 12, station-internal only).
  app.get("/api/market/alerts", adminHandler(async (_req, reply) => reply.headers(noStore).send(await loadAlertsView())));
  app.post("/api/market/alerts/evaluate", adminHandler(async (_req, reply) => reply.headers(noStore).send(await evaluateAlerts())));
  app.post("/api/market/alerts/rules", adminHandler(async (req, reply) => {
    const body = req.body as { id: string; name: string; module: string; kind: string; threshold: number; cooldownHours?: number; enabled?: boolean };
    if (!body?.id || !body?.name || !body?.module || !body?.kind || typeof body.threshold !== "number") return reply.status(400).send({ error: "规则字段不完整" });
    await saveMarketAlertRule({
      id: body.id, name: body.name, module: body.module,
      rule: { kind: body.kind as never, threshold: body.threshold },
      cooldownHours: body.cooldownHours ?? 24, enabled: body.enabled ?? true,
    });
    return reply.headers(noStore).send({ ok: true });
  }));

  // Area 6 — sources: registry state, seeding of the two R0-DATA real sources, permission-gated import.
  app.post("/api/market/sources/seed", adminHandler(async (_req, reply) => {
    await seedMarketSources();
    return reply.headers(noStore).send({ ok: true });
  }));
  app.post("/api/market/sources", adminHandler(async (req, reply) => {
    const body = req.body as MarketSource;
    if (!body?.id || !body?.kind || !body?.permission?.uses) return reply.status(400).send({ error: "来源字段不完整" });
    await saveMarketSource(body);
    return reply.headers(noStore).send({ ok: true });
  }));

  // Automated scheduler execution & status — runs all due periodic sources and auto-triggers downstream analysis.
  app.get("/api/market/scheduler/status", adminHandler(async (_req, reply) => reply.headers(noStore).send(await getMarketSchedulerStatus())));
  app.post("/api/market/scheduler/run-due", adminHandler(async (req, reply) => {
    const body = (req.body ?? {}) as { forceAll?: boolean; dryRun?: boolean };
    const res = await runDueMarketSources({ forceAll: body.forceAll, dryRun: body.dryRun });
    return reply.headers(noStore).send(res);
  }));
  app.get("/api/market/safety-events", adminHandler(async (_req, reply) => reply.headers(noStore).send(await loadProductSafetyEvents())));

  // Area 8 — unified market signals feed: search demand, chart changes, and safety recalls.
  app.get("/api/market/signals", adminHandler(async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const includeTest = q.includeTest === "true";
    const [rawSignals, allSafetyEvents] = await Promise.all([
      detectMarketSignals({ includeTest }),
      loadProductSafetyEvents(),
    ]);

    const safetyEvents = includeTest ? allSafetyEvents : allSafetyEvents.filter((evt) => isFormalProductSafetyEvent(evt));

    const safetySignals = safetyEvents.map((evt) => {
      const isFormal = isFormalProductSafetyEvent(evt);
      return {
        id: evt.id,
        module: "09",
        kind: "product-safety-recall",
        subjectZh: `消费品安全召回反证：${evt.productName}`,
        detailZh: `${evt.recallTitle} · 隐患：${evt.hazardDescriptionZh}。CPSC 官方通告反证，严禁推断为爆品商机。`,
        strength: 1,
        evidenceRefs: [evt.officialUrl],
        basisVersions: [evt.sourceId],
        formulaVersion: "cpsc-v1",
        at: evt.sourcePublishedAt || evt.observedAt,
        isTest: !isFormal,
        sourceName: "CPSC 官方通告",
        extra: {
          productName: evt.productName,
          officialUrl: evt.officialUrl,
          hazardType: evt.hazardType,
          hazardDescriptionZh: evt.hazardDescriptionZh,
          explanation: evt.explanation,
          categoryCandidate: evt.categoryCandidate,
        },
      };
    });

    let all = [
      ...rawSignals.map((s) => ({
        ...s,
        isTest: !isFormalMarketSignal(s),
        sourceName: s.module === "01" ? "AMZ123 ABA 热搜" : "Amazon BSR 观察",
      })),
      ...safetySignals,
    ];

    if (!includeTest) {
      all = all.filter((s) => !s.isTest);
    }

    if (q.module) all = all.filter((s) => s.module === q.module);
    if (q.q) {
      const term = q.q.toLowerCase();
      all = all.filter((s) => s.subjectZh.toLowerCase().includes(term) || s.detailZh.toLowerCase().includes(term));
    }
    all.sort((a, b) => b.at.localeCompare(a.at));
    return reply.headers(noStore).send({ signals: all, total: all.length });
  }));

  // Area 7 — External platforms (module 08) & Innovations (module 09) private manual records.
  app.get("/api/market/externals", adminHandler(async (_req, reply) => reply.headers(noStore).send(await loadMarketExternalRecords())));
  app.post("/api/market/externals", adminHandler(async (req, reply) => {
    const body = req.body as MarketExternalRecord;
    if (!body?.id || !body?.platform || !body?.title) return reply.status(400).send({ error: "外部记录字段不完整" });
    await saveMarketExternalRecord(body);
    return reply.headers(noStore).send({ ok: true });
  }));

  app.get("/api/market/innovations", adminHandler(async (_req, reply) => reply.headers(noStore).send(await loadMarketInnovationCues())));
  app.post("/api/market/innovations", adminHandler(async (req, reply) => {
    const body = req.body as MarketInnovationCue;
    if (!body?.id || !body?.title || !body?.differenceSummaryZh) return reply.status(400).send({ error: "创新线索字段不完整" });
    await saveMarketInnovationCue(body);
    return reply.headers(noStore).send({ ok: true });
  }));

  // Refresh: rebuild scores + review states after evidence revisions; retire now-unqualified alerts.
  app.post("/api/market/opportunities/refresh", adminHandler(async (_req, reply) => {
    const refreshed = await refreshOpportunities();
    const retired = await retireUnqualifiedAlerts();
    return reply.headers(noStore).send({ ...refreshed, alertsRetired: retired });
  }));

  // Revoke a source: disabled + stamped, alerts retired, dependent opportunities re-review.
  app.post("/api/market/sources/revoke", adminHandler(async (req, reply) => {
    const body = req.body as { id: string; reason?: string };
    if (!body?.id) return reply.status(400).send({ error: "id 必填" });
    const revoked = await revokeMarketSource(body.id, body.reason ?? "操作员撤销");
    if (!revoked) return reply.status(404).send({ error: "来源不存在" });
    const propagation = await propagateSourceRevocation(body.id, body.reason ?? "操作员撤销");
    return reply.headers(noStore).send({ ok: true, revokedAt: revoked.revokedAt, ...propagation });
  }));
}
