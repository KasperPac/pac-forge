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

  it("emits the 4-artifact bundle for each generated EM (no per-EM MAP FC)", () => {
    for (const em of ["Carriage", "Clamp"]) {
      expect(names).toContain(`EM_${em}`);
      expect(names).toContain(`EM_${em}_State`);
      expect(names).toContain(`EM_${em}_DB`);
      expect(names).toContain(`${em}_CMD`);
      expect(names).not.toContain(`MAP_${em}`); // G5-4: IO map moved to the layer FCs
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

  it("tags all EM artifacts layer 'em' (4 per EM, 2 FBs)", () => {
    const em = filterByLayer(res.artifacts, "em");
    expect(em).toHaveLength(8);
    expect(em.every((a) => a.layer === "em")).toBe(true);
    expect(em.filter((a) => a.type === "FB")).toHaveLength(2);
  });

  it("calls the generated EM instances from the unit Management FC", () => {
    const ob = res.artifacts.find((a) => a.type === "OB");
    expect(ob?.layer).toBe("ob1");
    // G5-4: EM instances execute in the unit Management FC, not directly in Main.
    const mgmt = res.artifacts.find((a) => a.name === "FC_Carriage_Unit_Management")!;
    expect(mgmt.content).toContain(`"EM_Carriage_DB"(`);
    expect(mgmt.content).toContain(`"EM_Clamp_DB"(`);
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

    it("orders Management-FC calls LINK_IN < EM instance < LINK_OUT", () => {
      // G5-4: the CM/link/EM instance calls live in the unit Management FC.
      const mgmt = res.artifacts.find((a) => a.name === "FC_Carriage_Unit_Management");
      expect(mgmt).toBeDefined();
      const body = mgmt!.content;
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

    it("double-drive: each physical address is written exactly once, program-wide (by the CM)", () => {
      // The write lands in the unit Management FC; no EM-owned artifact also
      // drives the address — so the count across the whole program is exactly 1.
      const all = res.artifacts.map((a) => a.content).join("\n");
      expect((all.match(/"Q0\.0" :=/g) ?? []).length).toBe(1);
    });
  });

  describe("Case A — coverage fail on an AUTO-match falls back to synthesis (G6-2)", () => {
    const res = compileContract(matchedFixture(), [emTemplate([{ slug: "idle", name: "Idle", is_safe: true }])]);
    const names = res.artifacts.map((a) => a.name);

    it("synthesizes the EM instead of blocking, with a fallback warning naming the missing state", () => {
      expect(res.stubs.equipmentModules).toHaveLength(0);
      expect(names).toContain("EM_Carriage"); // synthesized bundle
      expect(names).not.toContain("MAP_Carriage"); // G5-4: no per-EM MAP FC
      expect(
        res.warnings.some((w) => w.includes("falling back to synthesized") && w.includes("Active")),
      ).toBe(true);
    });

    it("emits no library link FCs for the fallen-back EM", () => {
      expect(names).not.toContain("LINK_Carriage_IN");
      expect(names).not.toContain("LINK_Carriage_OUT");
    });
  });

  describe("Case A — coverage fail on an ASSIGNED template stays a hard block (G6-2)", () => {
    it("blocks with the missing-states reason when the engineer explicitly chose the template", () => {
      const c = matchedFixture();
      (c as unknown as Record<string, unknown>).engineering = {
        drives: [], axis_constants: [], encoder_presets: [], upstream_endpoints: [],
        fb_assignments: [
          { target_kind: "equipment_module", target_id: "em-carriage", template_id: "tmpl-carriage", pin_bindings: [] },
        ],
      };
      const res = compileContract(c, [emTemplate([{ slug: "idle", name: "Idle", is_safe: true }])]);
      const stub = res.stubs.equipmentModules.find((s) => s.id === "em-carriage");
      expect(stub).toBeDefined();
      expect(stub!.reason).toContain("missing states");
      expect(res.artifacts.map((a) => a.name)).not.toContain("EM_Carriage");
    });
  });

  describe("explicit assignment flips a synthesizable EM to instantiate (G6-2)", () => {
    it("takes the library path over synthesis when the assignment names a coverage-passing template", () => {
      const c = matchedFixture();
      // rename the EM so score-matching would NOT pick the template on its own
      c.hierarchy.units[0].equipment_modules[0].equipment_module_name = "Unrelated Name";
      (c as unknown as Record<string, unknown>).engineering = {
        drives: [], axis_constants: [], encoder_presets: [], upstream_endpoints: [],
        fb_assignments: [
          { target_kind: "equipment_module", target_id: "em-carriage", template_id: "tmpl-carriage", pin_bindings: [] },
        ],
      };
      const res = compileContract(c, [emTemplate(FULL_STATES)]);
      const names = res.artifacts.map((a) => a.name);
      expect(names).not.toContain("EM_Unrelated_Name"); // no synthesized bundle
      expect(names.some((n) => n.startsWith("EM_LibCarriage_"))).toBe(true); // library instance DB
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
    // G5-4: the stub EM's instance call + its physical IO wiring land in the
    // unit Management FC (the instance-execution slot).
    const mgmt = res.artifacts.find((a) => a.name === "FC_Carriage_Unit_Management")!.content;

    it("reports the EM as a stub", () => {
      expect(res.stubs.equipmentModules.find((s) => s.id === "em-carriage")).toBeDefined();
    });

    it("wires the stub EM directly — it owns its physical IO", () => {
      expect(mgmt).toContain('"EM_Carriage_DB"(');
      expect(mgmt).toContain('"Q0.0"'); // EM drives the output itself; no separate CM
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
      // Every EM-owned artifact that IS emitted is referenced in the Management
      // FC (no orphans).
      const emArts = res.artifacts.filter((a) => a.ownerName === "Carriage" && (a.type === "FB" || a.type === "DB"));
      expect(emArts.length).toBeGreaterThan(0);
      expect(mgmt).toContain("EM_Carriage_DB");
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

  it("runs the UC brain (Process FC) before the unit's EM instances (Management FC)", () => {
    // G5-4: the UC instance is the unit's Process-FC brain call; the EM
    // instances execute in the Management FC. Main threads Process before
    // Management, so the UC's command-seam writes are consumed the same scan.
    const proc = res.artifacts.find((a) => a.name === "FC_Carriage_Unit_Process")!;
    const mgmt = res.artifacts.find((a) => a.name === "FC_Carriage_Unit_Management")!;
    expect(proc.content).toContain('"UC_Carriage_Unit_DB"();');
    expect(mgmt.content).toContain('"EM_Carriage_DB"(');
    expect(mgmt.content).toContain('"EM_Clamp_DB"(');
    const ob = res.artifacts.find((a) => a.type === "OB")!.content;
    expect(ob.indexOf('"FC_Carriage_Unit_Process"();')).toBeLessThan(
      ob.indexOf('"FC_Carriage_Unit_Management"();'),
    );
  });

  it("keeps the stub (with a warning) for units without unit_coordination", () => {
    const stubRes = compileContract(fixture(), []);
    const uc = stubRes.artifacts.find((a) => a.name === "UC_Carriage_Unit");
    expect(uc?.type).toBe("FC");
    expect(uc?.content).toContain("placeholder");
    expect(stubRes.warnings.some((w) => w.includes("no unit_coordination"))).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * Maintenance layer (G3) + OB1 ordering (G5-2/G5-3)
 * ------------------------------------------------------------------ */

describe("compileContract — maintenance layer emission", () => {
  function maintFixture(): SpecContractV2 {
    const c = fixture() as unknown as Record<string, unknown>;
    c.modes = [{ mode_id: "prod", name: "Production", is_default: true, kind: "production" }];
    c.safety_gates = [
      { gate_id: "estop", name: "E-Stop", condition: [{ tag: "EStop_OK", operator: "=", value: true }], scope: "all" },
    ];
    c.maintenance = {
      overridable_outputs: [
        { tag: "M01_Run", wire_check_only: false, description: "carriage motor" },
      ],
    };
    c.unit_coordination = {
      "unit-1": {
        unit_id: "unit-1",
        states: [
          { state_id: "idle", allowed_modes: [], mode_change_allowed: true },
          { state_id: "stopped", allowed_modes: [], mode_change_allowed: true },
        ],
        transitions: [],
        em_command_overrides: null,
        signal_routing: {
          safety_healthy: { gate_ids: ["estop"], exclude_maintenance: true },
          routing_rows: [],
          two_detent: [],
          command_routing: { policy: "walk_to_execute_stop_on_unhealthy", seq_test_release: true },
        },
        axes: [
          { axis_id: "rot", kind: "rotary", encoder_tag: "Enc_Rot",
            counts_per_rev: { db_member: "counts_per_360", default: 0, retain: true, operator_settable: false },
            preset_offset: 500000,
            home_windows: [{ center_deg10: 0, band_deg10: 20 }],
            gates: {},
            preset: { blocked_while_em_execute: "em-carriage" } },
        ],
      },
    };
    c.engineering = {
      drives: [], axis_constants: [], encoder_presets: [
        { unit_id: "unit-1", axis_id: "rot", ctrl_address: "QB70", value_address: "QD71", status_address: "IB78" },
      ], fb_assignments: [], upstream_endpoints: [],
    };
    return c as unknown as SpecContractV2;
  }

  const res = compileContract(maintFixture(), []);
  const names = res.artifacts.map((a) => a.name);

  it("emits the seam DB, override FC, and preset FC", () => {
    expect(names).toContain("Maintenance_CMD");
    expect(names).toContain("MAINT_Output_Override");
    expect(names).toContain("MAINT_Encoder_Preset");
    const db = res.artifacts.find((a) => a.name === "Maintenance_CMD")!;
    expect(db.content).toContain("ov_M01_Run : Bool;");
    expect(db.content).toContain("rot_preset_execute : Bool;");
  });

  it("routes preset + override into FC_Maintenance with override last, and Main runs it last (G5-2/G5-3)", () => {
    // G5-4: the maintenance calls live in FC_Maintenance (preset then override,
    // override structurally last); Main runs FC_Maintenance last of all layers,
    // so the override write wins over the output mapping.
    const maint = res.artifacts.find((a) => a.name === "FC_Maintenance")!.content;
    const preset = maint.indexOf('"MAINT_Encoder_Preset"();');
    const override = maint.indexOf('"MAINT_Output_Override"();');
    expect(preset).toBeGreaterThan(-1);
    expect(override).toBeGreaterThan(-1);
    expect(preset).toBeLessThan(override);
    const maintCalls = maint.split("\n").filter((l) => l.trim().startsWith('"MAINT_'));
    expect(maintCalls[maintCalls.length - 1]).toContain("MAINT_Output_Override");
    const ob = res.artifacts.find((a) => a.type === "OB")!.content;
    const lastCall = ob.trimEnd().split("\n").filter((l) => l.includes('"();')).pop() ?? "";
    expect(lastCall).toContain("FC_Maintenance");
  });

  it("guards the preset on the blocking EM's Execute dispatch index", () => {
    const fc = res.artifacts.find((a) => a.name === "MAINT_Encoder_Preset")!;
    // em-carriage declares idle(0)/active(1) — no canonical execute slug, so
    // the writer arms unguarded with a TODO instead of guessing an index
    expect(fc.content).toContain("// TODO no run-interlock");
  });

  it("resolves the UC's maintenance TODOs: #ok exclusion + i_Seq_Test binding", () => {
    const uc = res.artifacts.find((a) => a.name === "UC_Carriage_Unit")!;
    expect(uc.content).toContain('AND NOT "Maintenance_CMD".maintenance_mode');
    expect(uc.content).not.toContain("TODO exclude maintenance mode");
    // G5-4: the UC instance call (with its i_Seq_Test seam binding) is the
    // unit Process-FC brain call.
    const proc = res.artifacts.find((a) => a.name === "FC_Carriage_Unit_Process")!.content;
    expect(proc).toContain('"UC_Carriage_Unit_DB"(i_Seq_Test := "Maintenance_CMD".seq_test_mode);');
  });

  it("emits no maintenance layer when the contract declares none", () => {
    const bare = compileContract(fixture(), []);
    const bn = bare.artifacts.map((a) => a.name);
    expect(bn).not.toContain("Maintenance_CMD");
    expect(bn).not.toContain("MAINT_Output_Override");
    expect(bn).not.toContain("MAINT_Encoder_Preset");
  });
});

describe("compile-contract — matched template body de-dup (G6-1)", () => {
  it("emits a matched CM template's SCL body once across multiple instances", () => {
    const c = matchedFixture();
    const em = c.hierarchy.units[0].equipment_modules[0];
    em.control_modules.push({
      control_module_id: "cm2", control_module_name: "M02", control_module_class: "motor",
      is_safety: false, description: "M02",
      io_signals: [
        { tag: "M02_Run", signal_type: "DO", io_address: "Q0.1", description: "", source: "wired" },
        { tag: "M02_FB", signal_type: "DI", io_address: "I0.1", description: "", source: "wired" },
      ],
    } as SpecContractV2["hierarchy"]["units"][0]["equipment_modules"][0]["control_modules"][0]);
    const cmTmpl: FbTemplate = {
      id: "tmpl-motor", name: "Motor_Std", device_category: "motor", plc_brand: "SIEMENS_TIA",
      description: null, ai_summary: null, diagram_chart: null, diagram_generated_at: null,
      flow_diagram_json: null, flow_diagram_generated_at: null, version: 1, tags: [],
      source: "library", library_name: "TestLib", is_enabled: true, is_equipment_module: false,
      documentation: null, hmi_faceplate_type: null, interface_contract: null,
      created_by: null, updated_at: "", created_at: "",
      blocks: [{
        id: "mb1", template_id: "tmpl-motor", block_name: "CM_LibMotor", block_type: "FB",
        scl_code: 'FUNCTION_BLOCK "CM_LibMotor"\nEND_FUNCTION_BLOCK\n', block_xml: null,
        programming_language: "SCL", sort_order: 0, created_at: "",
      }],
    };
    const res = compileContract(c, [emTemplate(FULL_STATES), cmTmpl]);
    const bodies = res.artifacts.filter((a) => a.name === "CM_LibMotor");
    expect(bodies).toHaveLength(1);
    expect(bodies[0].content).toContain('FUNCTION_BLOCK "CM_LibMotor"');
    const instances = res.artifacts.filter((a) => /^CM_LibMotor_M0\d_DB$/.test(a.name));
    expect(instances).toHaveLength(2);
  });
});

describe("compile-contract — IO conditioning layer (G1-4b)", () => {
  it("emits the conditioning layer for blanket DI debounce and calls it FIRST in OB1", () => {
    const c = fixture() as unknown as Record<string, unknown>;
    c.engineering = {
      drives: [], axis_constants: [], encoder_presets: [], fb_assignments: [],
      upstream_endpoints: [], io_conditioning_defaults: { di_debounce_ms: 20 },
    };
    // reference the DI in state logic so the EM actually consumes it (pins
    // are created lazily from references)
    (c.equipment_modules as Record<string, { transitions: { guard: unknown[] }[] }>)[
      "em-carriage"
    ].transitions[0].guard = [{ tag: "M01_FB", operator: "=", value: true }];
    const res = compileContract(c as unknown as SpecContractV2, []);
    const names = res.artifacts.map((a) => a.name);
    expect(names).toContain("IO_Cond");
    expect(names).toContain("FB_IO_Conditioning");
    const fb = res.artifacts.find((a) => a.name === "FB_IO_Conditioning")!;
    // blanket debounce = symmetric TON + TOF on each DI
    expect(fb.content).toContain("t_on_M01_FB : TON;");
    expect(fb.content).toContain("t_off_M01_FB : TOF;");
    // G5-4: the conditioning call is the FIRST statement of FC_Inputs, so the
    // conditioned reads below it are same-scan fresh.
    const inputs = res.artifacts.find((a) => a.name === "FC_Inputs")!;
    const firstStmt = inputs.content.split("\n").find((l) => l.includes('"') && l.includes("("));
    expect(firstStmt).toContain("FB_IO_Conditioning_DB");
    // the synthesized input map (now routed into FC_Inputs) reads the
    // conditioned layer, not the raw tag
    expect(inputs.content).toContain('"IO_Cond".M01_FB');
    expect(res.artifacts.map((a) => a.name)).not.toContain("MAP_Carriage");
  });

  it("emits no conditioning layer when nothing is conditioned", () => {
    const res = compileContract(fixture(), []);
    expect(res.artifacts.map((a) => a.name)).not.toContain("IO_Cond");
  });
});

/* ------------------------------------------------------------------ *
 * Pac Program Structure Standard v1 — layer skeleton + folder stamping
 * (G5-4). The old flat MAP_<EM> / OB1-content model is superseded by the
 * FC_Inputs/FC_Outputs/FC_Maintenance layer FCs and per-unit
 * Process/Management FCs; every artifact carries its real folder.
 * ------------------------------------------------------------------ */

describe("G5-4 program structure", () => {
  const contract = fixture();

  it("emits the layer skeleton and no MAP FCs", () => {
    const { artifacts } = compileContract(contract, []);
    const names = artifacts.map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(["Main", "FC_Inputs", "FC_Outputs", "FC_Maintenance"]));
    expect(names.some((n) => n.startsWith("MAP_"))).toBe(false);
  });

  it("emits Process + Management per non-excluded unit, Process calling the UC", () => {
    const { artifacts } = compileContract(contract, []);
    const process = artifacts.filter((a) => /^FC_.*_Process$/.test(a.name));
    const mgmt = artifacts.filter((a) => /^FC_.*_Management$/.test(a.name));
    expect(process.length).toBeGreaterThan(0);
    expect(process.length).toBe(mgmt.length);
    for (const p of process) expect(p.content).toMatch(/"UC_\w+(_DB)?"\(/);
    for (const m of mgmt) expect(m.content).toMatch(/"EM_\w+_DB"\(|\/\/ \(no equipment modules\)/);
  });

  it("stamps folders: unit FCs at unit root, FBs in <U>/FB, DBs in <U>/DB, system in 00_System", () => {
    const { artifacts } = compileContract(contract, []);
    const byName = new Map(artifacts.map((a) => [a.name, a]));
    const anyProcess = artifacts.find((a) => /^FC_.*_Process$/.test(a.name))!;
    const unitScl = anyProcess.folder; // unit root
    expect(unitScl).not.toBe("Program blocks");
    const emFb = artifacts.find((a) => a.type === "FB" && a.name.startsWith("EM_"))!;
    expect(emFb.folder).toMatch(/\/FB$/);
    const emDb = artifacts.find((a) => a.type === "DB" && a.name.endsWith("_CMD"))!;
    expect(emDb.folder).toMatch(/\/DB$/);
    expect(byName.get("FC_Inputs")!.folder).toBe("00_System");
    expect(byName.get("Main")!.folder).toBe("Program blocks");
    const udt = artifacts.find((a) => a.type === "UDT");
    if (udt) expect(udt.folder).toBe("PLC data types");
  });

  it("keeps input mapping in FC_Inputs (with IO_Cond first when present) and outputs in FC_Outputs", () => {
    const { artifacts } = compileContract(contract, []);
    const inputs = artifacts.find((a) => a.name === "FC_Inputs")!;
    const outputs = artifacts.find((a) => a.name === "FC_Outputs")!;
    expect(inputs.content).not.toMatch(/^   "\w+" := "EM_/m);   // no physical-output writes
    expect(outputs.content).not.toMatch(/"EM_\w+_DB"\.\w+ := "(?!EM_)/); // no input reads
  });
});

/* ------------------------------------------------------------------ *
 * Unit-name sclIdent collision (G5-4 final-review finding 1) — two units
 * whose names sanitize to the same identifier must NOT silently collapse
 * onto one another's Process/Management FCs.
 * ------------------------------------------------------------------ */

/** Two units, "Infeed-1" and "Infeed 1", both sanitize to the SCL identifier
 *  "Infeed_1". Each owns one unmatched+contracted EM (generate path). */
function collidingUnitsFixture(): SpecContractV2 {
  const io = (tag: string, st: "DI" | "DO", addr: string) => ({
    tag, signal_type: st, io_address: addr, description: tag, source: "wired",
  });
  const cm = (id: string, name: string, cls: string) => ({
    control_module_id: id, control_module_name: name, control_module_class: cls,
    is_safety: false, description: name,
    io_signals: [io(`${name}_Run`, "DO", "Q0.0"), io(`${name}_FB`, "DI", "I0.0")],
  });
  const emContract = (emId: string, unitId: string, runTag: string) => ({
    equipment_module_id: emId, unit_id: unitId,
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
    project: {} as SpecContractV2["project"],
    hierarchy: { units: [
      {
        unit_id: "unit-1", unit_name: "Infeed-1", equipment_type: "station",
        description: "", excluded: false,
        equipment_modules: [
          { equipment_module_id: "em-a", equipment_module_name: "Loader", description: "",
            control_modules: [cm("cm1", "M01", "motor")] },
        ],
      },
      {
        unit_id: "unit-2", unit_name: "Infeed 1", equipment_type: "station",
        description: "", excluded: false,
        equipment_modules: [
          { equipment_module_id: "em-b", equipment_module_name: "Feeder", description: "",
            control_modules: [cm("cm2", "M02", "motor")] },
        ],
      },
    ] },
    alarm_tiers: [],
    equipment_modules: {
      "em-a": emContract("em-a", "unit-1", "M01_Run"),
      "em-b": emContract("em-b", "unit-2", "M02_Run"),
    },
    safety_gates: [], alarms: [], io_list: [], faults: [], sections: {},
    confirmation_status: "confirmed",
  } as unknown as SpecContractV2;
}

describe("compileContract — unit-name sclIdent collision", () => {
  const res = compileContract(collidingUnitsFixture(), []);
  const names = res.artifacts.map((a) => a.name);

  it("warns naming both colliding units", () => {
    const w = res.warnings.find((w) => w.includes("collision"));
    expect(w).toBeDefined();
    expect(w).toContain("Infeed-1");
    expect(w).toContain("Infeed 1");
  });

  it("keeps both units' Process/Management FCs, with distinct names", () => {
    const processFcs = names.filter((n) => /^FC_.*_Process$/.test(n));
    const managementFcs = names.filter((n) => /^FC_.*_Management$/.test(n));
    expect(processFcs).toHaveLength(2);
    expect(managementFcs).toHaveLength(2);
    expect(new Set(processFcs).size).toBe(2);
    expect(new Set(managementFcs).size).toBe(2);
  });

  it("keeps both units' EM instance calls reachable (never dropped)", () => {
    const mgmtFcs = res.artifacts.filter((a) => /^FC_.*_Management$/.test(a.name));
    const combined = mgmtFcs.map((a) => a.content).join("\n");
    expect(combined).toContain('"EM_Loader_DB"(');
    expect(combined).toContain('"EM_Feeder_DB"(');
  });

  it("Main calls both distinct unit Process FCs (never double-steps one UC)", () => {
    const ob = res.artifacts.find((a) => a.type === "OB")!.content;
    const processFcs = names.filter((n) => /^FC_.*_Process$/.test(n));
    for (const n of processFcs) {
      const re = new RegExp(`"${n}"\\(\\);`, "g");
      expect(ob.match(re)).toHaveLength(1);
    }
  });
});
