import { describe, expect, it } from "vitest";
import { validateSpecContractPatch, SpecContractPatchSchema } from "../contract";

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

describe("validateSpecContractPatch — command_behavior wiring (SP-3c)", () => {
  const emPatch = (commandBehavior: Record<string, unknown>) => ({
    equipment_modules: {
      em1: {
        equipment_module_id: "3f2504e0-4f89-41d3-9a0c-0305e82c3301",
        unit_id: "9b2e4c6a-8f3d-4a1b-b2c7-1e5f7a9d0c3e",
        states: [
          { state_id: "execute", name: "Execute", kind: "sequential", allowed_modes: [], is_safe_state: false },
          { state_id: "aborted", name: "Aborted", kind: "static", allowed_modes: [], is_safe_state: true },
        ],
        transitions: [], static_states: {}, sequential_states: {},
        command_behavior: commandBehavior,
      },
    },
  });
  const dupBranch = (label: string, tag: string) => ({
    branch_id: "dup", label,
    when: [{ tag, operator: "=", value: true }],
    control_modules: [],
  });

  it("surfaces duplicate branch_ids through the patch validator", () => {
    const parsed = SpecContractPatchSchema.parse(
      emPatch({ execute: { branches: [dupBranch("A", "T1"), dupBranch("B", "T2")], default_hold: [] } }),
    );
    const issues = validateSpecContractPatch(parsed);
    expect(issues.some((i) => i.includes('duplicate branch_id "dup"'))).toBe(true);
  });

  it("accepts a clean command_behavior patch", () => {
    const parsed = SpecContractPatchSchema.parse(
      emPatch({ execute: { branches: [{ branch_id: "fwd", label: "Fwd", when: [{ tag: "T", operator: "=", value: true }], control_modules: [] }], default_hold: [] } }),
    );
    const issues = validateSpecContractPatch(parsed);
    expect(issues.filter((i) => i.includes("command_behavior"))).toEqual([]);
  });
});

describe("validateSpecContractPatch — unit_coordination (G0-9)", () => {
  it("flags a record key that disagrees with coord.unit_id", () => {
    const issues = validateSpecContractPatch({
      unit_coordination: {
        unit_1: {
          unit_id: "unit_2",
          states: [{ state_id: "stopped", allowed_modes: [], mode_change_allowed: true }],
          transitions: [],
        },
      },
    });
    expect(issues.some((i) => i.includes("unit_1") && i.includes("unit_2"))).toBe(true);
  });

  it("runs validateUnitCoordination per unit with modes from the same patch", () => {
    const issues = validateSpecContractPatch({
      modes: [
        { mode_id: "production", name: "P", is_default: true, kind: "production" },
        { mode_id: "maintenance", name: "M", is_default: false, kind: "maintenance" },
      ],
      unit_coordination: {
        unit_1: {
          unit_id: "unit_1",
          states: [
            { state_id: "stopped", allowed_modes: ["production"], mode_change_allowed: true },
          ],
          transitions: [],
        },
      },
    });
    expect(issues.some((i) => i.includes("maintenance"))).toBe(true); // rule 2
  });

  it("accepts a valid coordination patch", () => {
    const issues = validateSpecContractPatch({
      unit_coordination: {
        unit_1: {
          unit_id: "unit_1",
          states: [{ state_id: "stopped", allowed_modes: [], mode_change_allowed: true }],
          transitions: [],
        },
      },
    });
    expect(issues).toEqual([]);
  });
});
