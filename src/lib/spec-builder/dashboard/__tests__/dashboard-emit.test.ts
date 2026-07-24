import { describe, it, expect } from "vitest";
import { emitDashboard, serializeModel } from "@/lib/spec-builder/dashboard/dashboard-emit";
import type { DashboardModel } from "@/types/commissioning-dashboard";

const model: DashboardModel = {
  project: { name: "M", specId: "s", revision: 1, generatedNote: "n" },
  devices: [], ems: [], alarms: [], setpoints: [], simRules: [], readTags: [], warnings: [],
};

describe("emitDashboard", () => {
  it("serializeModel produces an assignable global with valid JSON", () => {
    const js = serializeModel(model);
    expect(js.startsWith("window.__DASH_MODEL__ =")).toBe(true);
    const json = js.replace(/^window\.__DASH_MODEL__ =\s*/, "").replace(/;\s*$/, "");
    expect(JSON.parse(json).project.name).toBe("M");
  });

  it("file map contains the generated file + every runtime file", () => {
    const files = emitDashboard(model, { "index.html": "<html></html>", "plc-transport.js": "//t" });
    expect(files.get("dash-model.js")).toContain("__DASH_MODEL__");
    expect(files.get("index.html")).toBe("<html></html>");
    expect(files.get("plc-transport.js")).toBe("//t");
    expect(files.get("README.md")).toContain("M");
  });
});
