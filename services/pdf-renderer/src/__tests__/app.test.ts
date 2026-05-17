import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const renderMock = vi.fn();

vi.mock("../render.js", () => ({
  renderSnapshotToPdf: (...args: unknown[]) => renderMock(...args),
  renderSnapshotToHtml: vi.fn(),
}));

import { buildApp } from "../app.js";

describe("Fastify app", () => {
  const originalSecret = process.env.PDF_RENDER_SECRET;

  beforeEach(() => {
    process.env.PDF_RENDER_SECRET = "shh-test-secret";
    renderMock.mockReset();
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.PDF_RENDER_SECRET;
    else process.env.PDF_RENDER_SECRET = originalSecret;
  });

  it("GET /healthz returns ok", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it("POST /render without auth → 401", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/render",
      payload: { snapshot: { schema_version: 1 } },
    });
    expect(res.statusCode).toBe(401);
    expect(renderMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("POST /render with valid bearer returns application/pdf bytes", async () => {
    renderMock.mockResolvedValue(Buffer.from("%PDF-FAKE-CONTENT"));
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/render",
      headers: { authorization: "Bearer shh-test-secret" },
      payload: { snapshot: { schema_version: 1 } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.rawPayload.subarray(0, 4).toString()).toBe("%PDF");
    expect(renderMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("POST /render with missing snapshot returns 400", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/render",
      headers: { authorization: "Bearer shh-test-secret" },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(renderMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("POST /render propagates render errors as 500", async () => {
    renderMock.mockRejectedValue(new Error("chrome blew up"));
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/render",
      headers: { authorization: "Bearer shh-test-secret" },
      payload: { snapshot: { schema_version: 1 } },
    });
    expect(res.statusCode).toBe(500);
    await app.close();
  });
});
