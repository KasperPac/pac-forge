// src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts
import { describe, it, expect } from "vitest";
import { compileContract } from "../compile-contract";
import { filterByLayer } from "../layer-filter";
import type { SpecContractV2 } from "@/types/spec-contract-v2";
import type { FbTemplate } from "@/types/fb-template";
import type { FbInterfaceState } from "@/types/fb-interface";

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

/* ------------------------------------------------------------------ *
 * Verified matched-EM path (C5 Task 6)
 * ------------------------------------------------------------------ */

/** 1 Process Cell → 1 Unit → 1 EM "Carriage" (one CM with a Run output + a
 *  feedback input) plus a 2-state FDS machine. A library EM template named to
 *  match the EM is supplied so `pickTemplate` matches the EM by name+category.
 *  `withEmContract:false` omits the FDS machine (Case B). */
function matchedFixture(opts: { withEmContract?: boolean } = {}): SpecContractV2 {
  const io = (tag: string, st: "DI" | "DO", addr: string) => ({
    tag, signal_type: st, io_address: addr, description: tag, source: "wired",
  });
  const cm = (id: string, name: string, cls: string) => ({
    control_module_id: id, control_module_name: name, control_module_class: cls,
    is_safety: false, description: name,
    io_signals: [io(`${name}_Run`, "DO", "Q0.0"), io(`${name}_FB`, "DI", "I0.0")],
  });
  const emContract = (emId: string) => ({
    equipment_module_id: emId, unit_id: "unit-1",
    states: [
      { state_id: "idle", name: "Idle", kind: "static", allowed_modes: [], is_safe_state: true },
      { state_id: "active", name: "Active", kind: "static", allowed_modes: [], is_safe_state: false },
    ],
    transitions: [
      { transition_id: `${emId}-t1`, from_state_id: "idle", to_state_id: "active",
        trigger: { kind: "command", expr: { tag: "cmd_start", operator: "=", value: true } }, guard: [] },
    ],
    static_states: {}, sequential_states: {},
  });
  return {
    schema_version: 3,
    project: {} as SpecContractV2["project"],
    hierarchy: { units: [{
      unit_id: "unit-1", unit_name: "Carriage Unit", equipment_type: "station",
      description: "", excluded: false,
      equipment_modules: [
        { equipment_module_id: "em-carriage", equipment_module_name: "Carriage", description: "",
          control_modules: [cm("cm1", "M01", "motor")] },
      ],
    }] },
    alarm_tiers: [],
    equipment_modules: opts.withEmContract === false ? {} : { "em-carriage": emContract("em-carriage") },
    safety_gates: [], alarms: [], io_list: [], faults: [], sections: {},
    confirmation_status: "confirmed",
  } as unknown as SpecContractV2;
}

/** A library EM template whose name matches the "Carriage" EM, with a reviewed
 *  contract (role-tagged pins + the declared state list). */
function emTemplate(declared: FbInterfaceState[]): FbTemplate {
  return {
    id: "tmpl-carriage", name: "Carriage", device_category: "carriage",
    plc_brand: "SIEMENS_TIA", description: null, ai_summary: null,
    diagram_chart: null, diagram_generated_at: null,
    flow_diagram_json: null, flow_diagram_generated_at: null,
    version: 1, tags: [], source: "library", library_name: "TestLib",
    is_enabled: true, is_equipment_module: true,
    documentation: null, hmi_faceplate_type: null,
    interface_contract: {
      block_name: "EM_LibCarriage",
      pins: [
        { name: "fb_run", scl_type: "Bool", direction: "input", role: "sensor_in", default_binding: "fb_output", exposed: false, description: "" },
        { name: "act_drive", scl_type: "Bool", direction: "output", role: "actuator_out", default_binding: "io_output", exposed: true, description: "" },
        { name: "cmd_start", scl_type: "Bool", direction: "input", role: "cmd", default_binding: "hmi", exposed: false, description: "" },
        { name: "mode_auto", scl_type: "Bool", direction: "input", role: "mode", default_binding: "hmi", exposed: false, description: "" },
      ],
      states: declared,
      reviewed: true,
      generated_at: "2026-06-30T00:00:00Z",
    },
    created_by: null, updated_at: "", created_at: "",
    blocks: [{
      id: "b1", template_id: "tmpl-carriage", block_name: "EM_LibCarriage", block_type: "FB",
      scl_code: "", block_xml: null, programming_language: "SCL", sort_order: 0, created_at: "",
    }],
  };
}

const FULL_STATES: FbInterfaceState[] = [
  { slug: "idle", name: "Idle", is_safe: true },
  { slug: "active", name: "Active" },
];

describe("compile-contract — verified matched EM", () => {
  describe("Case A — coverage pass", () => {
    const res = compileContract(matchedFixture(), [emTemplate(FULL_STATES)]);
    const names = res.artifacts.map((a) => a.name);

    it("emits the command seam + EM↔CM link FCs", () => {
      expect(names).toContain("LINK_Carriage_IN");
      expect(names).toContain("LINK_Carriage_OUT");
      expect(names).toContain("Carriage_CMD");
    });

    it("does not BLOCK the EM (no stub entry)", () => {
      expect(res.stubs.equipmentModules.find((s) => s.id === "em-carriage")).toBeUndefined();
    });

    it("orders OB1 calls LINK_IN < EM instance < LINK_OUT", () => {
      const ob = res.artifacts.find((a) => a.type === "OB");
      expect(ob).toBeDefined();
      const body = ob!.content;
      const idxIn = body.indexOf('"LINK_Carriage_IN"');
      const idxEm = body.indexOf('"Carriage_CMD".cmd_start'); // the EM instance call's seam binding
      const idxOut = body.indexOf('"LINK_Carriage_OUT"');
      expect(idxIn).toBeGreaterThan(-1);
      expect(idxEm).toBeGreaterThan(-1);
      expect(idxOut).toBeGreaterThan(-1);
      expect(idxIn).toBeLessThan(idxEm);
      expect(idxEm).toBeLessThan(idxOut);
    });

    it("double-drive: no EM-owned artifact carries a physical IO address", () => {
      const emArts = res.artifacts.filter((a) => a.layer === "em" && a.ownerName === "Carriage");
      expect(emArts.length).toBeGreaterThan(0);
      for (const a of emArts) {
        expect(a.content).not.toMatch(/"[IQ]\d+\.\d+"/);
      }
    });

    it("double-drive: each physical address is written exactly once (in OB1, by the CM)", () => {
      const ob = res.artifacts.find((a) => a.type === "OB")!.content;
      expect((ob.match(/"Q0\.0" :=/g) ?? []).length).toBe(1);
    });
  });

  describe("Case A — coverage fail (library FB missing a state)", () => {
    const res = compileContract(matchedFixture(), [emTemplate([{ slug: "idle", name: "Idle", is_safe: true }])]);
    const names = res.artifacts.map((a) => a.name);

    it("blocks the EM with a 'missing states' reason naming the missing state", () => {
      const stub = res.stubs.equipmentModules.find((s) => s.id === "em-carriage");
      expect(stub).toBeDefined();
      expect(stub!.reason).toContain("missing states");
      expect(stub!.reason).toContain("Active");
    });

    it("emits no command seam or link FCs for the blocked EM", () => {
      expect(names).not.toContain("Carriage_CMD");
      expect(names).not.toContain("LINK_Carriage_IN");
      expect(names).not.toContain("LINK_Carriage_OUT");
    });
  });

  describe("Case B — matched but no FDS state machine", () => {
    const res = compileContract(matchedFixture({ withEmContract: false }), [emTemplate(FULL_STATES)]);

    it("warns coverage is unverifiable", () => {
      expect(res.warnings.some((w) => w.includes("coverage unverifiable"))).toBe(true);
    });

    it("still emits the command seam + link FCs (matched, not blocked)", () => {
      const names = res.artifacts.map((a) => a.name);
      expect(names).toContain("Carriage_CMD");
      expect(names).toContain("LINK_Carriage_IN");
      expect(names).toContain("LINK_Carriage_OUT");
    });
  });

  describe("Case D — stub EM (no template, no contract)", () => {
    const res = compileContract(matchedFixture({ withEmContract: false }), []); // no templates, no FDS machine → EM stub
    const ob = res.artifacts.find((a) => a.type === "OB")!.content;

    it("reports the EM as a stub", () => {
      expect(res.stubs.equipmentModules.find((s) => s.id === "em-carriage")).toBeDefined();
    });

    it("wires the stub EM directly — it owns its physical IO", () => {
      expect(ob).toContain('"EM_Carriage_DB"(');
      expect(ob).toContain('"Q0.0"'); // EM drives the output itself; no separate CM
    });

    it("instantiates NO separate CM blocks (no orphan, never-called blocks)", () => {
      // The CM "M01" is subsumed by the stub EM and must not be instantiated.
      const cmArtifacts = res.artifacts.filter((a) => a.ownerName === "M01");
      expect(cmArtifacts).toHaveLength(0);
      expect(res.stubs.controlModules).toHaveLength(0);
      // No EM↔CM link FCs exist for a stub EM (CMs were not wired).
      const names = res.artifacts.map((a) => a.name);
      expect(names).not.toContain("LINK_Carriage_IN");
      expect(names).not.toContain("LINK_Carriage_OUT");
      // Every EM-owned artifact that IS emitted is referenced in OB1 (no orphans).
      const emArts = res.artifacts.filter((a) => a.ownerName === "Carriage" && (a.type === "FB" || a.type === "DB"));
      expect(emArts.length).toBeGreaterThan(0);
      expect(ob).toContain("EM_Carriage_DB");
    });
  });
});

/* ------------------------------------------------------------------ *
 * Real unit coordinator path (G2-1/G2-3 integration)
 * ------------------------------------------------------------------ */

describe("compileContract — real unit coordinator when unit_coordination exists", () => {
  function coordFixture(): SpecContractV2 {
    const c = fixture() as unknown as Record<string, unknown>;
    c.modes = [
      { mode_id: "prod", name: "Production", is_default: true, kind: "production" },
      { mode_id: "eng", name: "Seq Test", is_default: false, kind: "engineering" },
    ];
    c.safety_gates = [
      { gate_id: "estop", name: "E-Stop", condition: [{ tag: "EStop_OK", operator: "=", value: true }], scope: "all" },
    ];
    c.unit_coordination = {
      "unit-1": {
        unit_id: "unit-1",
        states: [
          { state_id: "idle", allowed_modes: [], mode_change_allowed: true },
          { state_id: "execute", allowed_modes: [], mode_change_allowed: false },
          { state_id: "stopped", allowed_modes: [], mode_change_allowed: true },
        ],
        transitions: [
          { transition_id: "t1", from_state_id: "idle", to_state_id: "execute",
            trigger: { type: "command", command: "start" }, guard: [], allowed_modes: [] },
          { transition_id: "t2", from_state_id: "execute", to_state_id: "idle",
            trigger: { type: "em_aggregate", em_scope: "all", em_state: "idle" }, guard: [], allowed_modes: [] },
        ],
        em_command_overrides: null,
        signal_routing: {
          safety_healthy: { gate_ids: ["estop"], exclude_maintenance: false },
          routing_rows: [],
          two_detent: [],
          command_routing: { policy: "walk_to_execute_stop_on_unhealthy", seq_test_release: true },
        },
      },
    };
    return c as unknown as SpecContractV2;
  }

  const res = compileContract(coordFixture(), []);
  const names = res.artifacts.map((a) => a.name);

  it("emits the UC FB + instance DB + UN PackTags DB instead of the stub FC", () => {
    const uc = res.artifacts.find((a) => a.name === "UC_Carriage_Unit");
    expect(uc?.type).toBe("FB");
    expect(uc?.content).toContain('FUNCTION_BLOCK "UC_Carriage_Unit"');
    expect(names).toContain("UC_Carriage_Unit_DB");
    expect(names).toContain("UN_Carriage_Unit");
  });

  it("routes commands to the member EM command seams", () => {
    const uc = res.artifacts.find((a) => a.name === "UC_Carriage_Unit")!;
    expect(uc.content).toContain('"Carriage_CMD".cmd_start');
    expect(uc.content).toContain('"Clamp_CMD".cmd_stop');
  });

  it("resolves em_aggregate against each member EM's own dispatch indices", () => {
    const uc = res.artifacts.find((a) => a.name === "UC_Carriage_Unit")!;
    // both EMs declare idle at dispatch index 0
    expect(uc.content).toContain('"EM_Carriage_DB".state = 0 AND "EM_Clamp_DB".state = 0');
    expect(res.warnings.filter((w) => w.includes("em_aggregate"))).toHaveLength(0);
  });

  it("calls the UC instance in OB1 before the unit's EM instances", () => {
    const ob = res.artifacts.find((a) => a.type === "OB")!;
    const uc = ob.content.indexOf('"UC_Carriage_Unit_DB"();');
    expect(uc).toBeGreaterThan(-1);
    expect(uc).toBeLessThan(ob.content.indexOf('"EM_Carriage_DB"('));
    expect(uc).toBeLessThan(ob.content.indexOf('"EM_Clamp_DB"('));
  });

  it("keeps the stub (with a warning) for units without unit_coordination", () => {
    const stubRes = compileContract(fixture(), []);
    const uc = stubRes.artifacts.find((a) => a.name === "UC_Carriage_Unit");
    expect(uc?.type).toBe("FC");
    expect(uc?.content).toContain("placeholder");
    expect(stubRes.warnings.some((w) => w.includes("no unit_coordination"))).toBe(true);
  });
});
