import { describe, expect, it } from "vitest";
import { proposeModes } from "../propose-modes";

describe("proposeModes", () => {
  it("returns a single default 'auto' mode when no hints are found", () => {
    const r = proposeModes(["Idle", "Execute", "Stopped"]);
    expect(r.modes).toEqual([
      { mode_id: "auto", name: "Auto", is_default: true },
    ]);
    expect(r.hints).toEqual([]);
  });

  it("emits a Manual hint when a state name contains 'manual'", () => {
    const r = proposeModes(["Idle", "Manual Run", "Execute"]);
    expect(r.modes[0].is_default).toBe(true);
    expect(r.hints.some((h) => /manual/i.test(h.hint))).toBe(true);
  });

  it("emits a Service hint for service / maintenance", () => {
    const r = proposeModes(["Idle", "Service", "Maintenance Mode"]);
    expect(r.hints.length).toBeGreaterThanOrEqual(1);
    expect(r.hints.some((h) => /service/i.test(h.hint))).toBe(true);
  });

  it("deduplicates hints (one per detected mode keyword)", () => {
    const r = proposeModes(["Manual Start", "Manual Run", "Manual Stop"]);
    expect(r.hints.filter((h) => /manual/i.test(h.hint))).toHaveLength(1);
  });

  it("handles empty input safely", () => {
    const r = proposeModes([]);
    expect(r.modes).toEqual([{ mode_id: "auto", name: "Auto", is_default: true }]);
    expect(r.hints).toEqual([]);
  });
});
