// src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts
import { describe, it, expect } from "vitest";
import { compileContract } from "../compile-contract";
import { filterByLayer } from "../layer-filter";
import type { SpecContractV2 } from "@/types/spec-contract-v2";

/** 1 Process Cell → 1 Unit → 2 EMs, each one control module with a Run output
 *  and a feedback input, plus a static 2-state machine that drives Run. EMs are
 *  unmatched (no templates) but carry contracts → they take the generate path.
 *  Cast through unknown: the compiler reads only a subset of the full schema. */
function fixture(): SpecContractV2 {
  const io = (tag: string, st: "DI" | "DO", addr: string) => ({
    tag, signal_type: st, io_address: addr, description: tag, source: "wired",
  });
  const cm = (id: string, name: string, cls: string) => ({
    control_module_id: id, control_module_name: name, control_module_class: cls,
    is_safety: false, description: name,
    io_signals: [io(`${name}_Run`, "DO", "Q0.0"), io(`${name}_FB`, "DI", "I0.0")],
  });
  const emContract = (emId: string, runTag: string) => ({
    equipment_module_id: emId, unit_id: "unit-1",
    states: [
      { state_id: "idle", name: "idle", kind: "static", allowed_modes: [], is_safe_state: true },
      { state_id: "active", name: "active", kind: "static", allowed_modes: [], is_safe_state: false },
    ],
    transitions: [
      { transition_id: `${emId}-t1`, from_state_id: "idle", to_state_id: "active",
        trigger: { kind: "command", expr: { tag: "cmd_start", operator: "=", value: true } }, guard: [] },
      { transition_id: `${emId}-t2`, from_state_id: "active", to_state_id: "idle",
        trigger: { kind: "command", expr: { tag: "cmd_stop", operator: "=", value: true } }, guard: [] },
    ],
    static_states: { idle: [{ tag: runTag, description: "run", state: "STOP" }],
                     active: [{ tag: runTag, description: "run", state: "RUN" }] },
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
    equipment_modules: {
      "em-carriage": emContract("em-carriage", "M01_Run"),
      "em-clamp": emContract("em-clamp", "SOL1_Run"),
    },
    safety_gates: [], alarms: [], io_list: [], faults: [], sections: {},
    confirmation_status: "confirmed",
  } as unknown as SpecContractV2;
}

describe("compileContract — EM-layer path", () => {
  const res = compileContract(fixture(), []); // no templates → unmatched → generate
  const names = res.artifacts.map((a) => a.name);

  it("emits the 5-artifact bundle for each generated EM", () => {
    for (const em of ["Carriage", "Clamp"]) {
      expect(names).toContain(`EM_${em}`);
      expect(names).toContain(`EM_${em}_State`);
      expect(names).toContain(`EM_${em}_DB`);
      expect(names).toContain(`${em}_CMD`);
      expect(names).toContain(`MAP_${em}`);
    }
  });

  it("supersedes the flattened per-Unit sequencer", () => {
    expect(names).not.toContain("UDT_Carriage_Unit");
    expect(names).not.toContain("DB_Carriage_Unit");
  });

  it("emits one UC_<unit> coordination stub naming each EM", () => {
    const uc = res.artifacts.find((a) => a.name === "UC_Carriage_Unit");
    expect(uc?.type).toBe("FC");
    expect(uc?.layer).toBe("unit");
    expect(uc?.content).toContain("coordinate Carriage");
    expect(uc?.content).toContain("coordinate Clamp");
    expect(uc?.content).toContain("placeholder");
  });

  it("reports no CM or EM stubs (CMs subsumed, EMs generated)", () => {
    expect(res.stubs.controlModules).toHaveLength(0);
    expect(res.stubs.equipmentModules).toHaveLength(0);
  });

  it("tags all EM artifacts layer 'em' (5 per EM, 2 FBs)", () => {
    const em = filterByLayer(res.artifacts, "em");
    expect(em).toHaveLength(10);
    expect(em.every((a) => a.layer === "em")).toBe(true);
    expect(em.filter((a) => a.type === "FB")).toHaveLength(2);
  });

  it("emits one OB1 that calls the generated EM instances", () => {
    const ob = res.artifacts.find((a) => a.type === "OB");
    expect(ob?.layer).toBe("ob1");
    expect(ob?.content).toContain(`"EM_Carriage_DB"(`);
    expect(ob?.content).toContain(`"EM_Clamp_DB"(`);
  });

  it("produces no duplicate artifact names", () => {
    expect(new Set(names).size).toBe(names.length);
  });
});
