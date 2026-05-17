import Fastify, { type FastifyInstance } from "fastify";
import { renderSnapshotToPdf } from "./render.js";
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

  return app;
}
