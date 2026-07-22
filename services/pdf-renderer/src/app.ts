import Fastify, { type FastifyInstance } from "fastify";
import { renderSnapshotToPdf } from "./render.js";
import { renderFdsToPdf } from "./render-fds.js";
import { mapSpecContractToFdsView, type FdsViewModel } from "./fds-viewmodel.js";
import { requireBearer, HttpError } from "./auth.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    bodyLimit: 4 * 1024 * 1024,
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) {
      reply.code(err.statusCode).send({ error: err.message });
      return;
    }
    app.log.error(err);
    reply.code(500).send({ error: "internal_error" });
  });

  app.get("/healthz", async () => ({ ok: true }));

  app.post<{ Body: { snapshot: unknown } }>("/render", async (req, reply) => {
    requireBearer(req);
    if (
      !req.body ||
      typeof req.body !== "object" ||
      !("snapshot" in req.body) ||
      !req.body.snapshot
    ) {
      reply.code(400).send({ error: "snapshot required" });
      return;
    }
    const pdf = await renderSnapshotToPdf(req.body.snapshot);
    reply.header("content-type", "application/pdf");
    reply.send(pdf);
  });

  // FDS document rendering. Accepts either a ready view-model ({ fds }) or a
  // raw Spec Contract V2 ({ contract, meta }) which is mapped server-side.
  app.post<{
    Body: { fds?: FdsViewModel; contract?: unknown; meta?: Record<string, string> };
  }>("/render-fds", async (req, reply) => {
    requireBearer(req);
    const body = req.body;
    if (!body || typeof body !== "object" || (!body.fds && !body.contract)) {
      reply.code(400).send({ error: "fds or contract required" });
      return;
    }
    const fds =
      body.fds ??
      mapSpecContractToFdsView(
        body.contract as Record<string, unknown>,
        body.meta ?? {},
      );
    const pdf = await renderFdsToPdf(fds);
    reply.header("content-type", "application/pdf");
    reply.send(pdf);
  });

  return app;
}
