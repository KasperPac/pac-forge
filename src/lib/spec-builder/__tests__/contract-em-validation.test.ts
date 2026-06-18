import { describe, expect, it } from "vitest";
import { validateSpecContractPatch } from "../contract";

describe("validateSpecContractPatch — EM state machines", () => {
  it("flags an EM with states but no safe state", () => {
    const issues = validateSpecContractPatch({
      equipment_modules: {
        em1: {
          equipment_module_id: "00000000-0000-4000-8000-000000000001",
          unit_id: "00000000-0000-4000-8000-000000000002",
          states: [{ state_id: "run", name: "Run", kind: "static", allowed_modes: [], is_safe_state: false }],
          transitions: [],
          static_states: {},
          sequential_states: {},
        },
      },
    });
    expect(issues.some((i) => /exactly one is_safe_state/.test(i))).toBe(true);
  });

  it("flags a safety gate scoping an unknown equipment_module id", () => {
    const issues = validateSpecContractPatch({
      hierarchy: { units: [] },
      safety_gates: [
        {
          gate_id: "g1", name: "G1",
          condition: [{ tag: "E", operator: "=", value: false }],
          scope: ["does-not-exist"],
        },
      ],
    });
    expect(issues.some((i) => /unknown equipment_module/.test(i))).toBe(true);
  });
});
