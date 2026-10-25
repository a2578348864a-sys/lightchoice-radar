// The third lane's private API. Every route sits behind adminHandler (session or the dev stand-in)
// — the evidence, reviews and exports are private research material, never anonymous content.
// Writes are POST + CSRF by the same guard the admin uses; reads never touch a source or a model.
import type { FastifyInstance } from "fastify";
import { adminHandler } from "./admin-auth.ts";
import { loadVocOverview, loadVocEvidence, loadVocPains, loadVocHistory, loadVocSources, exportVocMarkdown } from "@aihot/backend/voc/voc-read";
import { recordReview, revokeBatch, processL2, groupPainCandidates } from "@aihot/backend/voc/voc-analysis";
import { previewImport, applyImport } from "@aihot/backend/voc/voc-ingest";
import { saveStudy } from "@aihot/backend/voc/voc-model";

export function registerVoc(app: FastifyInstance) {
  const noStore = { "Cache-Control": "no-store" } as const;

  // Area 1 — overview.
  app.get("/api/voc/overview", adminHandler(async (_req, reply) => reply.headers(noStore).send(await loadVocOverview())));

  // Area 2 — evidence library with filters; import preview/apply under the admin guard.
  app.get("/api/voc/evidence", adminHandler(async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    return reply.headers(noStore).send(await loadVocEvidence({ studyId: q.study ?? null, category: q.category ?? null, polarity: q.polarity ?? null, q: q.q ?? null }));
  }));
  app.post("/api/voc/import/preview", adminHandler(async (req, reply) => {
    const body = req.body as { rows?: Array<{ url: string; title: string; body: string; publishedAt?: string }> };
    if (!Array.isArray(body.rows)) return reply.status(400).send({ error: "rows[] required" });
    return reply.headers(noStore).send(await previewImport(body.rows.map((r) => ({ ...r, publishedAt: r.publishedAt ? new Date(r.publishedAt) : null }))));
  }));
  app.post("/api/voc/import/apply", adminHandler(async (req, reply) => {
    const body = req.body as {
      batch: { id: string; sourceId: string; label: string; license: { uses: string[]; basis: string } };
      studyIds: string[];
      rows: Array<{ url: string; title: string; body: string; publishedAt?: string }>;
    };
    if (!body.batch?.id || !Array.isArray(body.rows)) return reply.status(400).send({ error: "batch and rows[] required" });
    const result = await applyImport({
      batch: { ...body.batch, license: { uses: body.batch.license.uses as never[], basis: body.batch.license.basis } },
      studyIds: body.studyIds ?? [],
      rows: body.rows.map((r) => ({ ...r, publishedAt: r.publishedAt ? new Date(r.publishedAt) : null })),
    });
    return reply.headers(noStore).send(result);
  }));

  // Areas 3 & 4 — pain themes and (future) hypotheses; grouping is deterministic and read-side.
  app.get("/api/voc/pains", adminHandler(async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    return reply.headers(noStore).send(await loadVocPains(q.study ?? null));
  }));
  app.post("/api/voc/pains/group", adminHandler(async (req, reply) => {
    const body = req.body as { studyId: string };
    if (!body.studyId) return reply.status(400).send({ error: "studyId required" });
    return reply.headers(noStore).send({ candidates: await groupPainCandidates(body.studyId) });
  }));

  // L2 processing — the gated lane; refuses while closed, so the UI can say why.
  app.post("/api/voc/process/:id", adminHandler(async (req, reply) => {
    const id = (req.params as { id: string }).id;
    return reply.headers(noStore).send(await processL2(id));
  }));

  // Human decisions and batch revocation.
  app.post("/api/voc/review", adminHandler(async (req, reply) => {
    const body = req.body as { articleId: string; action: string; note?: string; decidedBy?: string; recordedBy?: string };
    const admin = reply.request.headers["x-admin-name"]; // decidedBy defaults to the session identity
    const result = await recordReview({
      articleId: body.articleId,
      action: body.action as never,
      note: body.note,
      decidedBy: body.decidedBy ?? String(admin ?? "admin"),
      recordedBy: body.recordedBy ?? "user",
    });
    return reply.status(result.ok ? 200 : 409).headers(noStore).send(result);
  }));
  app.post("/api/voc/batch/revoke", adminHandler(async (req, reply) => {
    const body = req.body as { batchId: string; reason?: string };
    if (!body.batchId) return reply.status(400).send({ error: "batchId required" });
    return reply.headers(noStore).send(await revokeBatch(body.batchId, body.reason ?? "operator revocation"));
  }));

  // Area 5 — history; Area 6 — sources & diagnostics.
  app.get("/api/voc/history", adminHandler(async (_req, reply) => reply.headers(noStore).send({ events: await loadVocHistory() })));
  app.get("/api/voc/sources", adminHandler(async (_req, reply) => reply.headers(noStore).send(await loadVocSources())));

  // Studies: define/update (definitions are private research config, admin-guarded like the rest).
  app.post("/api/voc/study", adminHandler(async (req, reply) => {
    const body = req.body as Parameters<typeof saveStudy>[0];
    if (!body?.id || !body?.name || !body?.terms) return reply.status(400).send({ error: "id, name, terms required" });
    await saveStudy({ ...body, createdAt: body.createdAt ?? new Date().toISOString() });
    return reply.headers(noStore).send({ ok: true });
  }));

  // The research export — markdown, licence-filtered, attribution-preserving.
  app.get("/api/voc/export", adminHandler(async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    if (!q.study) return reply.status(400).send({ error: "study required" });
    const md = await exportVocMarkdown(q.study);
    return reply.headers({ ...noStore, "Content-Disposition": `attachment; filename="voc-${q.study}.md"` }).type("text/markdown; charset=utf-8").send(md);
  }));
}
