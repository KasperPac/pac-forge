import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname =
  typeof globalThis.__dirname !== "undefined"
    ? globalThis.__dirname
    : path.dirname(fileURLToPath(import.meta.url));

// Load the runtime script into a window-like global, then exercise it.
function loadTransport(): any {
  const src = readFileSync(
    path.resolve(__dirname, "../runtime/plc-transport.js"), "utf8",
  );
  const win: any = {};
  new Function("window", src)(win);
  return win.PlcTransport;
}

describe("plc-transport bridge adapter", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("reads via the bridge with explicit types and unquoted names", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ values: [{ tag_name: "DB.member", value: true }] }),
    }));
    const T = loadTransport();
    const t = T.create("bridge", { fetch: fetchMock, baseUrl: "http://localhost:5102" });
    const out = await t.read([{ id: "DB.member", type: "Bool" }]);
    expect(out["DB.member"]).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body[0]).toEqual({ tag_name: "DB.member", data_type: "Bool" });
    expect(fetchMock.mock.calls[0][0]).toContain("/tia/plcsim/read-tags");
  });

  it("writes via the Web API with quoted SCL names", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ result: true }) }));
    const T = loadTransport();
    const t = T.create("webapi", { fetch: fetchMock, baseUrl: "", token: "abc" });
    await t.write("DB.member", true, "Bool");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.method).toBe("PlcProgram.Write");
    expect(body.params.var).toBe('"DB"."member"');
  });
});
