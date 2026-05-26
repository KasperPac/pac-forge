import { describe, expect, it } from "vitest";
import { migrateOperatingState, migrateOperatingStates } from "../spec-builder";

describe("migrateOperatingState — V2 → V1 fallback", () => {
  it("uses state_name when present (legacy V1 path)", () => {
    const out = migrateOperatingState({
      state_id: "idle",
      state_name: "Idle",
      description: "x",
      state_pattern: "static",
    });
    expect(out.state_name).toBe("Idle");
    expect(out.state_id).toBe("idle");
    expect(out.state_pattern).toBe("static");
  });

  it("falls back to display_name when state_name is missing (V2 input)", () => {
    const out = migrateOperatingState({
      state_id: 4,
      packml_id: 4,
      display_name: "Idle",
      description: "x",
      state_pattern: "static",
    });
    expect(out.state_name).toBe("Idle");
    expect(out.state_id).toBe("4"); // coerced to string by migrator
  });

  it("returns empty state_name when neither field is present", () => {
    const out = migrateOperatingState({
      state_id: 6,
      description: "x",
      state_pattern: "sequential",
    });
    expect(out.state_name).toBe("");
  });

  it("preserves state_pattern from input when provided", () => {
    const out = migrateOperatingState({
      state_id: 6,
      display_name: "Execute",
      description: "x",
      state_pattern: "sequential",
    });
    expect(out.state_pattern).toBe("sequential");
  });

  it("migrateOperatingStates maps an array", () => {
    const out = migrateOperatingStates([
      { state_id: 4, display_name: "Idle", description: "", state_pattern: "static" },
      { state_id: 3, display_name: "Starting", description: "", state_pattern: "sequential" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].state_name).toBe("Idle");
    expect(out[1].state_name).toBe("Starting");
  });
});
