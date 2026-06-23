// src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts
import { describe, it, expect } from "vitest";
import { compileContract } from "../compile-contract";
import type { SpecContractV2 } from "@/types/spec-contract-v2";

/** Build a minimal but valid-enough contract: 1 Process Cell → 1 Unit → 2 EMs,
 *  each EM a single control module, with a 2-state machine. We cast through
 *  unknown because the compiler only reads a subset of the full schema. */
function fixture(): SpecContractV2 {
  const io = (tag: string, st: "DI" | "DO", addr: string) => ({
    tag, signal_type: st, io_address: addr, description: tag, source: "field",
  });
  const cm = (id: string, name: string, cls: string) => ({
    control_module_id: id, control_module_name: name, control_module_class: cls,
    is_safety: false, description: name,
    io_signals: [io(`${name}_Run`, "DO", "Q0.0"), io(`${name}_FB`, "DI", "I0.0")],
  });
  const emContract = (emId: string) => ({
    equipment_module_id: emId, unit_id: "unit-1",
    states: [
      { state_id: "idle", name: "idle", kind: "static", allowed_modes: [], is_safe_state: true },
      { state_id: "active", name: "active", kind: "static", allowed_modes: [], is_safe_state: false },
    ],
    transitions: [
      { transition_id: `${emId}-t1`, from_state_id: "idle", to_state_id: "active",
        trigger: { kind: "command", expr: { tag: "CMD_GO", operator: "=", value: true } }, guard: [] },
      { transition_id: `${emId}-t2`, from_state_id: "active", to_state_id: "idle",
        trigger: { kind: "command", expr: { tag: "CMD_GO", operator: "=", value: false } }, guard: [] },
    ],
    static_states: { idle: [{ tag: `${emId}_M_Run`, description: "m", state: "STOP" }],
                     active: [{ tag: `${emId}_M_Run`, description: "m", state: "RUN" }] },
    sequential_states: {},
  });
  return {
    schema_version: 3,
    project: { } as SpecContractV2["project"],
    hierarchy: { units: [{
      unit_id: "unit-1", unit_name: "Carriage Unit", equipment_type: "station",
      description: "", excluded: false,
      equipment_modules: [
        { equipment_module_id: "em-carriage", equipment_module_name: "Carriage", description: "",
          control_modules: [cm("cm1", "M01", "motor")] },
        { equipment_module_id: "em-clamp", equipment_module_name: "Clamp", description: "",
          control_modules: [cm("cm2", "SOL1", "solenoid")] },
      ],
    }] },
    alarm_tiers: [],
    equipment_modules: { "em-carriage": emContract("em-carriage"), "em-clamp": emContract("em-clamp") },
    safety_gates: [], alarms: [], io_list: [], faults: [], sections: {},
    confirmation_status: "confirmed",
  } as unknown as SpecContractV2;
}

describe("compileContract", () => {
  const res = compileContract(fixture(), []); // no templates → all stubs

  it("emits the per-Unit sequencer artifacts", () => {
    const names = res.artifacts.map((a) => a.name);
    expect(names).toContain("UDT_Carriage_Unit");
    expect(names).toContain("DB_Carriage_Unit");
    expect(names).toContain("UC_Carriage_Unit");
    expect(names).toContain("Main");
  });

  it("reports a stub per unmatched control module", () => {
    expect(res.stubs.controlModules.map((s) => s.name).sort()).toEqual(["M01", "SOL1"]);
  });

  it("produces a sequence covering both EMs (4 steps total)", () => {
    const udt = res.artifacts.find((a) => a.name === "UDT_Carriage_Unit");
    expect(udt?.content).toContain("S : ARRAY[0..3] OF BOOL;");
  });

  it("produces no duplicate artifact names", () => {
    const names = res.artifacts.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
