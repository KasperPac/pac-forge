import { describe, expect, it } from "vitest";
import { proposeStateMapping } from "../propose-states";

describe("proposeStateMapping", () => {
  it("returns exact match against a PackML name", () => {
    const r = proposeStateMapping("Execute");
    expect(r.match_source).toBe("exact");
    expect(r.packml_id).toBe(6);
    expect(r.legacy_name).toBe("Execute");
  });

  it("matches case-insensitively", () => {
    expect(proposeStateMapping("execute").packml_id).toBe(6);
    expect(proposeStateMapping("EXECUTE").packml_id).toBe(6);
  });

  it("uses synonym map for 'running' → Execute", () => {
    const r = proposeStateMapping("Running");
    expect(r.match_source).toBe("synonym");
    expect(r.packml_id).toBe(6);
  });

  it("uses synonym map for 'e-stop' → Aborting", () => {
    const r = proposeStateMapping("E-Stop");
    expect(r.match_source).toBe("synonym");
    expect(r.packml_id).toBe(8);
  });

  it("uses synonym map for 'standby' → Idle", () => {
    const r = proposeStateMapping("Standby");
    expect(r.match_source).toBe("synonym");
    expect(r.packml_id).toBe(4);
  });

  it("falls through to unmapped for unrecognised names", () => {
    const r = proposeStateMapping("Lubrication");
    expect(r.match_source).toBe("unmapped");
    expect(r.packml_id).toBeUndefined();
    expect(r.legacy_name).toBe("Lubrication");
  });

  it("trims whitespace", () => {
    expect(proposeStateMapping("  Execute  ").packml_id).toBe(6);
  });
});
