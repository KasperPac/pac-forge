import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { requireBearer, HttpError } from "../auth.js";
import type { FastifyRequest } from "fastify";

function makeReq(authHeader?: string): FastifyRequest {
  return { headers: { authorization: authHeader } } as unknown as FastifyRequest;
}

describe("requireBearer", () => {
  const original = process.env.PDF_RENDER_SECRET;

  beforeEach(() => {
    process.env.PDF_RENDER_SECRET = "shh-test-secret";
  });

  afterEach(() => {
    if (original === undefined) delete process.env.PDF_RENDER_SECRET;
    else process.env.PDF_RENDER_SECRET = original;
  });

  it("passes when header matches Bearer <secret>", () => {
    expect(() => requireBearer(makeReq("Bearer shh-test-secret"))).not.toThrow();
  });

  it("rejects when header missing", () => {
    expect(() => requireBearer(makeReq(undefined))).toThrowError(HttpError);
    try {
      requireBearer(makeReq(undefined));
    } catch (e) {
      expect(e).toBeInstanceOf(HttpError);
      expect((e as HttpError).statusCode).toBe(401);
    }
  });

  it("rejects when secret is different", () => {
    expect(() => requireBearer(makeReq("Bearer wrong"))).toThrowError(HttpError);
  });

  it("rejects when scheme is not Bearer", () => {
    expect(() => requireBearer(makeReq("Basic shh-test-secret"))).toThrowError(HttpError);
  });

  it("errors with 500 when server has no secret configured", () => {
    delete process.env.PDF_RENDER_SECRET;
    try {
      requireBearer(makeReq("Bearer anything"));
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(500);
    }
  });
});
