// src/lib/spec-builder/codegen/__tests__/unit-writer.test.ts
import { describe, it, expect } from "vitest";
import { writeUnitArtifacts } from "../unit-writer";
import { buildUnitSequence, type UnitMemberEm } from "../unit-builder";
import type { UnitCoordinationV1 } from "@/types/spec-contract-v2";

function twoStateIr() {
  const coord: UnitCoordinationV1 = {
    unit_id: "unit-1",
    states: [
      { state_id: "idle", allowed_modes: [], mode_change_allowed: true },
      { state_id: "execute", allowed_modes: [], mode_change_allowed: false },
    ],
    transitions: [],
    em_command_overrides: null,
  };
  return buildUnitSequence({ unitId: "unit-1", unitName: "Carriage", coord, members: [], modes: [] });
}

describe("writeUnitArtifacts — UC_<Unit> FB skeleton (G2-1)", () => {
  it("emits a UC_<Unit> FB (unit layer) with a Cur_St CASE listing each declared state in canonical order", () => {
    const { artifacts } = writeUnitArtifacts(twoStateIr());
    const fb = artifacts.find((a) => a.name === "UC_Carriage");

    expect(fb).toBeDefined();
    expect(fb!.type).toBe("FB");
    expect(fb!.layer).toBe("unit");
    expect(fb!.filename).toBe("UC_Carriage.scl");
    expect(fb!.content).toContain(`FUNCTION_BLOCK "UC_Carriage"`);
    expect(fb!.content).toContain("CASE #Cur_St OF");
    // one branch per declared state, at its canonical Cur_St index
    expect(fb!.content).toContain("0:   // idle");
    expect(fb!.content).toContain("1:   // execute");
    expect(fb!.content).toContain("END_FUNCTION_BLOCK");
  });
});

describe("writeUnitArtifacts — UC_<Unit>_DB + UN_<Unit> PackTags DB (G2-1)", () => {
  it("emits the instance DB and a PackTags DB whose EM_St array spans the member EMs", () => {
    const members: UnitMemberEm[] = [
      { emId: "em-a", emName: "Drive", states: [] },
      { emId: "em-b", emName: "Brake", states: [] },
    ];
    const coord: UnitCoordinationV1 = {
      unit_id: "unit-1",
      states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
      transitions: [],
      em_command_overrides: null,
    };
    const ir = buildUnitSequence({ unitId: "unit-1", unitName: "Carriage", coord, members, modes: [] });
    const { artifacts } = writeUnitArtifacts(ir);

    const inst = artifacts.find((a) => a.name === "UC_Carriage_DB");
    expect(inst).toBeDefined();
    expect(inst!.type).toBe("DB");
    expect(inst!.content).toContain(`DATA_BLOCK "UC_Carriage_DB"`);
    expect(inst!.content).toContain(`"UC_Carriage"`); // instance of the FB
    expect(inst!.dependencies).toContain("UC_Carriage");

    const un = artifacts.find((a) => a.name === "UN_Carriage");
    expect(un).toBeDefined();
    expect(un!.type).toBe("DB");
    expect(un!.content).toContain("Cur_St : Int;");
    expect(un!.content).toContain("Cur_Mode : Int;");
    expect(un!.content).toContain("St_Cmd : Int;");
    expect(un!.content).toContain("Mode_Req : Int;");
    expect(un!.content).toContain("Mode_Change_Legal : Bool;");
    expect(un!.content).toContain("EM_St : Array[0..1] of Int;"); // 2 members → 0..1
  });
});

describe("writeUnitArtifacts — unit SM transition lowering (G2-1)", () => {
  function smIr() {
    const members: UnitMemberEm[] = [
      {
        emId: "em-a",
        emName: "Drive",
        states: [
          { slug: "idle", index: 0 },
          { slug: "execute", index: 1 },
        ],
      },
    ];
    const coord: UnitCoordinationV1 = {
      unit_id: "unit-1",
      states: [
        { state_id: "idle", allowed_modes: [], mode_change_allowed: true },
        { state_id: "starting", allowed_modes: [], mode_change_allowed: false },
        { state_id: "execute", allowed_modes: [], mode_change_allowed: false },
      ],
      transitions: [
        {
          transition_id: "t-start",
          from_state_id: "idle",
          to_state_id: "starting",
          trigger: { type: "command", command: "start" },
          guard: [{ tag: "Air_OK", operator: "=", value: true }],
          allowed_modes: ["m-prod"],
        },
        {
          transition_id: "t-started",
          from_state_id: "starting",
          to_state_id: "execute",
          trigger: { type: "em_aggregate", em_scope: "all", em_state: "execute" },
          guard: [],
          allowed_modes: [],
        },
        {
          transition_id: "t-cond",
          from_state_id: "execute",
          to_state_id: "idle",
          trigger: { type: "condition", expr: [{ tag: "Cycle_Done", operator: "=", value: true }] },
          guard: [],
          allowed_modes: [],
        },
      ],
      em_command_overrides: null,
    };
    return buildUnitSequence({
      unitId: "unit-1",
      unitName: "Carriage",
      coord,
      members,
      modes: [
        { mode_id: "m-prod", name: "Production", is_default: true, kind: "production" },
        { mode_id: "m-man", name: "Manual", is_default: false, kind: "manual" },
      ],
    });
  }

  it("consumes and clears UN_<Unit>.St_Cmd each scan", () => {
    const fb = writeUnitArtifacts(smIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).toContain('#cmd := "UN_Carriage".St_Cmd;');
    expect(fb).toContain('"UN_Carriage".St_Cmd := 0;');
  });

  it("lowers a command trigger to its PackML command-word constant, ANDing guard and mode mask", () => {
    const fb = writeUnitArtifacts(smIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    // start = 1; guard term; Production mode mask (index 0)
    expect(fb).toContain(
      'IF #cmd = 1 AND ("Air_OK" = TRUE) AND #Cur_Mode = 0 THEN',
    );
    expect(fb).toContain("#Cur_St := 1;   // t-start -> starting");
  });

  it("lowers an em_aggregate trigger to EM state comparisons", () => {
    const fb = writeUnitArtifacts(smIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).toContain('IF "EM_Drive_DB".state = 1 THEN');
    expect(fb).toContain("#Cur_St := 2;   // t-started -> execute");
  });

  it("lowers a condition trigger to its serialized permissive expression", () => {
    const fb = writeUnitArtifacts(smIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).toContain('IF ("Cycle_Done" = TRUE) THEN');
    expect(fb).toContain("#Cur_St := 0;   // t-cond -> idle");
  });

  it("emits the SM dispatch as its own CASE, separate from the command-assertion CASE", () => {
    const fb = writeUnitArtifacts(smIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    const first = fb.indexOf("CASE #Cur_St OF");
    const second = fb.indexOf("CASE #Cur_St OF", first + 1);
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
  });
});

describe("writeUnitArtifacts — mode manager (G2-1)", () => {
  function modesIr() {
    const members: UnitMemberEm[] = [
      {
        emId: "em-a",
        emName: "Drive",
        states: [
          { slug: "idle", index: 0, allowedModes: [] },
          { slug: "active", index: 1, allowedModes: ["prod"] },
        ],
      },
    ];
    const coord: UnitCoordinationV1 = {
      unit_id: "unit-1",
      states: [
        { state_id: "idle", allowed_modes: [], mode_change_allowed: true },
        { state_id: "execute", allowed_modes: ["prod"], mode_change_allowed: false },
        { state_id: "stopped", allowed_modes: [], mode_change_allowed: true },
      ],
      transitions: [],
      em_command_overrides: null,
    };
    return buildUnitSequence({
      unitId: "unit-1",
      unitName: "Carriage",
      coord,
      members,
      modes: [
        { mode_id: "prod", name: "Production", is_default: false, kind: "production" },
        { mode_id: "maint", name: "Maintenance", is_default: true, kind: "maintenance" },
      ],
    });
  }

  it("mirrors Mode_Change_Legal from the current state's mode_change_allowed set", () => {
    const fb = writeUnitArtifacts(modesIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).toContain('"UN_Carriage".Mode_Change_Legal := #Cur_St = 0 OR #Cur_St = 2;');
  });

  it("grants a legal Mode_Req via the compile-time legality expansion and always clears the request", () => {
    const fb = writeUnitArtifacts(modesIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).toContain('IF "UN_Carriage".Mode_Req > 0 THEN');
    expect(fb).toContain('CASE "UN_Carriage".Mode_Req OF');
    // Production (index 0): unrestricted -> unconditional grant
    expect(fb).toContain("#Cur_Mode := 0;");
    // Maintenance (index 1): unit-state mask + Drive allowed-state term
    expect(fb).toContain(
      'IF (#Cur_St = 0 OR #Cur_St = 2) AND ("EM_Drive_DB".state = 0) THEN',
    );
    expect(fb).toContain("#Cur_Mode := 1;");
    expect(fb).toContain('"UN_Carriage".Mode_Req := 0;   // request always cleared');
  });

  it("initializes Cur_Mode to the default mode's index", () => {
    const fb = writeUnitArtifacts(modesIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).toContain("Cur_Mode : Int := 1;"); // Maintenance is_default
  });
});

describe("writeUnitArtifacts — #ok, command assertion, PackTags mirror (G2-2)", () => {
  function fullIr() {
    const members: UnitMemberEm[] = [
      { emId: "em-a", emName: "Drive", states: [] },
      { emId: "em-b", emName: "Brake", states: [] },
    ];
    const coord: UnitCoordinationV1 = {
      unit_id: "unit-1",
      states: [
        { state_id: "idle", allowed_modes: [], mode_change_allowed: true },
        { state_id: "execute", allowed_modes: [], mode_change_allowed: false },
      ],
      transitions: [],
      em_command_overrides: null,
      signal_routing: {
        safety_healthy: { gate_ids: ["estop"], exclude_maintenance: true },
        routing_rows: [],
        two_detent: [],
        command_routing: {
          policy: "walk_to_execute_stop_on_unhealthy",
          seq_test_release: true,
        },
      },
    };
    return buildUnitSequence({
      unitId: "unit-1",
      unitName: "Carriage",
      coord,
      members,
      modes: [],
      safetyGates: [
        {
          gate_id: "estop",
          name: "E-Stop",
          condition: [{ tag: "EStop_Healthy", operator: "=", value: true }],
          scope: "all",
        },
      ],
    });
  }

  it("emits #ok from the referenced safety gates with a maintenance TODO", () => {
    const fb = writeUnitArtifacts(fullIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).toContain('#ok := ("EStop_Healthy" = TRUE);');
    expect(fb).toContain("// TODO exclude maintenance mode (G3 maintenance DB)");
  });

  it("stops all members when NOT ok, asserts per-state commands otherwise", () => {
    const fb = writeUnitArtifacts(fullIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).toContain("IF NOT #ok THEN");
    // stop-all branch
    expect(fb).toContain('"Drive_CMD".cmd_stop := TRUE;');
    expect(fb).toContain('"Brake_CMD".cmd_stop := TRUE;');
    // execute (canonical map: START): start TRUE, stop FALSE
    const exec = fb.slice(fb.indexOf("1:   // execute"));
    expect(exec).toContain('"Drive_CMD".cmd_start := TRUE;');
    expect(exec).toContain('"Drive_CMD".cmd_stop := FALSE;');
    // idle (canonical map: NONE): nothing asserted
    const idle = fb.slice(fb.indexOf("0:   // idle"), fb.indexOf("1:   // execute"));
    expect(idle).toContain('"Drive_CMD".cmd_start := FALSE;');
  });

  it("seq-test release early-returns before the command block", () => {
    const fb = writeUnitArtifacts(fullIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).toContain("i_Seq_Test : Bool;");
    const ret = fb.indexOf("IF #i_Seq_Test THEN");
    expect(ret).toBeGreaterThan(-1);
    expect(fb.slice(ret)).toContain("RETURN;");
    // mirror runs before the release, commands after
    expect(fb.indexOf('"UN_Carriage".Cur_St := #Cur_St;')).toBeLessThan(ret);
    expect(fb.indexOf("IF NOT #ok THEN")).toBeGreaterThan(ret);
  });

  it("mirrors PackTags including member EM states", () => {
    const fb = writeUnitArtifacts(fullIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).toContain('"UN_Carriage".Cur_St := #Cur_St;');
    expect(fb).toContain('"UN_Carriage".Cur_Mode := #Cur_Mode;');
    expect(fb).toContain('"UN_Carriage".EM_St[0] := "EM_Drive_DB".state;');
    expect(fb).toContain('"UN_Carriage".EM_St[1] := "EM_Brake_DB".state;');
  });

  it("forces Cur_St to the abort target on NOT #ok, excluding aborting/aborted (G2-1 safety override)", () => {
    const members: UnitMemberEm[] = [{ emId: "em-a", emName: "Drive", states: [] }];
    const coord: UnitCoordinationV1 = {
      unit_id: "unit-1",
      states: [
        { state_id: "idle", allowed_modes: [], mode_change_allowed: true },
        { state_id: "aborting", allowed_modes: [], mode_change_allowed: false },
        { state_id: "aborted", allowed_modes: [], mode_change_allowed: true },
      ],
      transitions: [],
      em_command_overrides: null,
      signal_routing: {
        safety_healthy: { gate_ids: ["estop"], exclude_maintenance: false },
        routing_rows: [],
        two_detent: [],
        command_routing: { policy: "walk_to_execute_stop_on_unhealthy", seq_test_release: false },
      },
    };
    const ir = buildUnitSequence({
      unitId: "unit-1", unitName: "Carriage", coord, members, modes: [],
      safetyGates: [
        { gate_id: "estop", name: "E-Stop", condition: [{ tag: "EStop_OK", operator: "=", value: true }], scope: "all" },
      ],
    });
    const fb = writeUnitArtifacts(ir).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    // canonical order: idle 0, aborting 1, aborted 2
    expect(fb).toContain("IF NOT #ok AND #Cur_St <> 1 AND #Cur_St <> 2 THEN");
    expect(fb).toContain("#Cur_St := 1;   // safety gate -> aborting");
  });

  it("skeleton IR without signal_routing emits no ok gate and no seq-test input", () => {
    const fb = writeUnitArtifacts(twoStateIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).not.toContain("#ok :=");
    expect(fb).not.toContain("i_Seq_Test");
  });
});

describe("writeUnitArtifacts — mode-kind command gating (G2-3)", () => {
  function gatedIr(memberOverrides?: Partial<UnitMemberEm>) {
    const members: UnitMemberEm[] = [
      { emId: "em-a", emName: "Drive", states: [] },
      { emId: "em-b", emName: "Lifter", states: [], ...memberOverrides },
    ];
    const coord: UnitCoordinationV1 = {
      unit_id: "unit-1",
      states: [
        { state_id: "idle", allowed_modes: [], mode_change_allowed: true },
        { state_id: "execute", allowed_modes: [], mode_change_allowed: false },
      ],
      transitions: [],
      em_command_overrides: null,
      signal_routing: {
        safety_healthy: { gate_ids: ["estop"], exclude_maintenance: true },
        routing_rows: [],
        two_detent: [],
        command_routing: { policy: "walk_to_execute_stop_on_unhealthy", seq_test_release: true },
      },
    };
    return buildUnitSequence({
      unitId: "unit-1", unitName: "Carriage", coord, members,
      modes: [
        { mode_id: "prod", name: "Production", is_default: true, kind: "production" },
        { mode_id: "maint", name: "Maintenance", is_default: false, kind: "maintenance" },
        { mode_id: "eng", name: "Seq Test", is_default: false, kind: "engineering" },
      ],
      safetyGates: [
        { gate_id: "estop", name: "E-Stop", condition: [{ tag: "EStop_OK", operator: "=", value: true }], scope: "all" },
      ],
    });
  }

  it("releases command assertion in engineering-kind modes (OR'd with the seq-test input)", () => {
    const fb = writeUnitArtifacts(gatedIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).toContain("IF #i_Seq_Test OR #Cur_Mode = 2 THEN");
    expect(fb.slice(fb.indexOf("IF #i_Seq_Test OR #Cur_Mode = 2 THEN"))).toContain("RETURN;");
  });

  it("forces STOP to every member in maintenance-kind modes, same as safety-unhealthy", () => {
    const fb = writeUnitArtifacts(gatedIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).toContain("IF NOT #ok OR #Cur_Mode = 1 THEN");
    const stop = fb.slice(fb.indexOf("IF NOT #ok OR #Cur_Mode = 1 THEN"));
    expect(stop).toContain('"Drive_CMD".cmd_stop := TRUE;');
    expect(stop).toContain('"Lifter_CMD".cmd_stop := TRUE;');
  });

  it("emits a TODO instead of seam writes for library-FB members", () => {
    const fb = writeUnitArtifacts(gatedIr({ librarySeam: "FB_Lift_Std" }))
      .artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).toContain(
      "// TODO: wire unit command to Lifter (library FB FB_Lift_Std — no command-role pins in its interface contract yet)",
    );
    expect(fb).not.toContain('"Lifter_CMD".cmd_stop');
  });

  it("engineering release still emits without a seq-test input when seq_test_release is off", () => {
    const ir = gatedIr();
    ir.commandRouting = { seqTestRelease: false };
    const fb = writeUnitArtifacts(ir).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).not.toContain("i_Seq_Test");
    expect(fb).toContain("IF #Cur_Mode = 2 THEN");
  });
});

describe("writeUnitArtifacts — signal routing rows + two-detent (G2-4)", () => {
  function routedIr() {
    const members: UnitMemberEm[] = [
      { emId: "em-a", emName: "Drive", states: [] },
      { emId: "em-b", emName: "Indicators", states: [] },
    ];
    const coord: UnitCoordinationV1 = {
      unit_id: "unit-1",
      states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
      transitions: [],
      em_command_overrides: null,
      signal_routing: {
        routing_rows: [
          { row_id: "r-fast", target: { equipment_module_id: "em-a", pin: "ilk_Fwd_Fast" },
            source: { kind: "io_tag", tag: "Fwd_Fast_PB" },
            gates: [
              { kind: "named_gate", gate_id: "g-fwd-fast" },
              { kind: "em_status", equipment_module_id: "em-b", member: "permit_travel" },
            ] },
          { row_id: "r-jog", target: { equipment_module_id: "em-a", pin: "ilk_Fwd" },
            source: { kind: "io_tag", tag: "Fwd_PB" },
            gates: [{ kind: "em_status", equipment_module_id: "em-b", member: "permit_travel" }] },
          { row_id: "r-plain", target: { equipment_module_id: "em-a", pin: "ilk_Limit_Stop" },
            source: { kind: "io_tag", tag: "Long_Limit_Stop" }, gates: [] },
        ],
        two_detent: [{ jog_row_id: "r-jog", fast_row_id: "r-fast", fallback: true }],
        command_routing: { policy: "walk_to_execute_stop_on_unhealthy", seq_test_release: true },
      },
      axes: [
        { axis_id: "ax1", kind: "linear", encoder_tag: "Enc", eu_unit: "mm",
          scale: { db_member: "scale", retain: true, operator_settable: false },
          length: { db_member: "len", retain: true, operator_settable: false },
          end_margin: { db_member: "margin", retain: true, operator_settable: false },
          ramp_zone: { db_member: "ramp", retain: true, operator_settable: false },
          gates: { fwd_fast_ok: "g-fwd-fast" }, unconfigured_open: true },
      ],
    };
    return buildUnitSequence({ unitId: "unit-1", unitName: "Carriage", coord, members, modes: [] });
  }

  it("emits a plain row as target := source", () => {
    const fb = writeUnitArtifacts(routedIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).toContain('"EM_Drive_DB".ilk_Limit_Stop := "Long_Limit_Stop";');
  });

  it("emits the fast row with the declared gate live (G2-5) and em_status gate", () => {
    const fb = writeUnitArtifacts(routedIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).toContain(
      '"EM_Drive_DB".ilk_Fwd_Fast := "Fwd_Fast_PB" AND #gate_g_fwd_fast AND "EM_Indicators_DB".permit_travel;',
    );
  });

  it("emits the jog row with fallback OR and NOT(fast expr) suppression", () => {
    const fb = writeUnitArtifacts(routedIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).toContain(
      '"EM_Drive_DB".ilk_Fwd := ("Fwd_PB" OR "Fwd_Fast_PB") AND NOT ("Fwd_Fast_PB" AND #gate_g_fwd_fast AND "EM_Indicators_DB".permit_travel) AND "EM_Indicators_DB".permit_travel;',
    );
  });

  it("holds an undeclared named gate FALSE with a TODO trailer", () => {
    const ir = routedIr();
    const row = ir.routingRows!.find((r) => r.rowId === "r-plain")!;
    row.gates = [{ kind: "gatePending", gateId: "g-mystery", declared: false }];
    const fb = writeUnitArtifacts(ir).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).toContain(
      '"EM_Drive_DB".ilk_Limit_Stop := "Long_Limit_Stop" AND FALSE;   // TODO gate g-mystery held FALSE pending G2-5',
    );
  });

  it("keeps routing rows running in seq-test mode (emitted before the release RETURN)", () => {
    const fb = writeUnitArtifacts(routedIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    const routing = fb.indexOf('"EM_Drive_DB".ilk_Fwd_Fast');
    const release = fb.indexOf("IF #i_Seq_Test");
    expect(routing).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(-1);
    expect(routing).toBeLessThan(release);
  });
});

describe("writeUnitArtifacts — envelope geometry emission (G2-5)", () => {
  function axedIr() {
    const members: UnitMemberEm[] = [{ emId: "em-a", emName: "Drive", states: [] }];
    const coord: UnitCoordinationV1 = {
      unit_id: "unit-1",
      states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
      transitions: [],
      em_command_overrides: null,
      signal_routing: {
        routing_rows: [
          { row_id: "r-fast", target: { equipment_module_id: "em-a", pin: "ilk_Fwd_Fast" },
            source: { kind: "io_tag", tag: "Fwd_Fast_PB" },
            gates: [
              { kind: "named_gate", gate_id: "g-fwd-fast" },
              { kind: "named_gate", gate_id: "g-at-home" },
            ] },
        ],
        two_detent: [],
      },
      axes: [
        { axis_id: "travel", kind: "linear", encoder_tag: "Enc_Travel", eu_unit: "mm",
          scale: { db_member: "mm_per_rev_x10", retain: true, operator_settable: false, description: "mm per encoder rev x10" },
          length: { db_member: "length_mm", default: 0, retain: true, operator_settable: true },
          end_margin: { db_member: "end_margin_mm", default: 500, retain: true, operator_settable: false },
          ramp_zone: { db_member: "ramp_zone_mm", default: 2000, retain: true, operator_settable: false },
          gates: { fwd_ok: "g-fwd", fwd_fast_ok: "g-fwd-fast", rev_ok: "g-rev", rev_fast_ok: "g-rev-fast" },
          unconfigured_open: true },
        { axis_id: "rot", kind: "rotary", encoder_tag: "Enc_Rot",
          counts_per_rev: { db_member: "counts_per_360", default: 0, retain: true, operator_settable: false },
          preset_offset: 500000,
          home_windows: [{ center_deg10: 0, band_deg10: 20 }, { center_deg10: 1800, band_deg10: 20 }],
          gates: { at_home: "g-at-home" } },
      ],
    };
    return buildUnitSequence({ unitId: "unit-1", unitName: "Carriage", coord, members, modes: [] });
  }
  const fb = () => writeUnitArtifacts(axedIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;

  it("emits the CFG_<Unit> DB with RETAIN params and seeded defaults", () => {
    const db = writeUnitArtifacts(axedIr()).artifacts.find((a) => a.name === "CFG_Carriage")!;
    expect(db.type).toBe("DB");
    expect(db.layer).toBe("unit");
    expect(db.content).toContain('DATA_BLOCK "CFG_Carriage"');
    expect(db.content).toContain("VAR RETAIN");
    expect(db.content).toContain("mm_per_rev_x10 : DInt;   // mm per encoder rev x10");
    const begin = db.content.slice(db.content.indexOf("BEGIN"));
    expect(begin).toContain("length_mm := 0;");
    expect(begin).toContain("end_margin_mm := 500;");
    expect(begin).toContain("ramp_zone_mm := 2000;");
    expect(begin).toContain("counts_per_360 := 0;");
    expect(begin).not.toContain("mm_per_rev_x10 :="); // no default declared
  });

  it("declares per-axis and per-gate VAR_TEMPs", () => {
    const c = fb();
    expect(c).toContain("pos_travel : DInt;");
    expect(c).toContain("raw_rot : LInt;");
    expect(c).toContain("deg10_rot : DInt;");
    expect(c).toContain("gate_g_fwd_fast : Bool;");
    expect(c).toContain("gate_g_at_home : Bool;");
  });

  it("emits linear scaling and the four envelope gates with the unconfigured-open policy", () => {
    const c = fb();
    expect(c).toContain(
      '#pos_travel := LINT_TO_DINT(DINT_TO_LINT("Enc_Travel") * "CFG_Carriage".mm_per_rev_x10 / 10000);',
    );
    expect(c).toContain('IF ("CFG_Carriage".mm_per_rev_x10 > 0) AND ("CFG_Carriage".length_mm > 0) THEN');
    expect(c).toContain('#gate_g_fwd := #pos_travel < ("CFG_Carriage".length_mm - "CFG_Carriage".end_margin_mm);');
    expect(c).toContain('#gate_g_fwd_fast := #pos_travel < ("CFG_Carriage".length_mm - "CFG_Carriage".ramp_zone_mm);');
    expect(c).toContain('#gate_g_rev := #pos_travel > "CFG_Carriage".end_margin_mm;');
    expect(c).toContain('#gate_g_rev_fast := #pos_travel > "CFG_Carriage".ramp_zone_mm;');
    const elseBranch = c.slice(c.indexOf("ELSE", c.indexOf("#gate_g_fwd :=")));
    expect(elseBranch).toContain("#gate_g_fwd := TRUE;");
  });

  it("emits rotary preset/scaling, wrap-normalization, and the OR'd home-window gate", () => {
    const c = fb();
    expect(c).toContain('IF "CFG_Carriage".counts_per_360 > 0 THEN');
    expect(c).toContain('#raw_rot := DINT_TO_LINT("Enc_Rot") - 500000;');
    expect(c).toContain(
      '#deg10_rot := LINT_TO_DINT(#raw_rot * 3600 / DINT_TO_LINT("CFG_Carriage".counts_per_360));',
    );
    expect(c).toContain("#deg10_rot := ((#deg10_rot MOD 3600) + 3600) MOD 3600;");
    expect(c).toContain("IF #deg10_rot > 1800 THEN");
    expect(c).toContain(
      "#gate_g_at_home := (ABS(((#deg10_rot + 5400) MOD 3600) - 1800) < 20) OR (ABS(((#deg10_rot + 3600) MOD 3600) - 1800) < 20);",
    );
  });

  it("routing rows consume the live gate temps", () => {
    const c = fb();
    expect(c).toContain(
      '"EM_Drive_DB".ilk_Fwd_Fast := "Fwd_Fast_PB" AND #gate_g_fwd_fast AND #gate_g_at_home;',
    );
  });

  it("computes geometry before the routing rows", () => {
    const c = fb();
    expect(c.indexOf("#pos_travel :=")).toBeLessThan(c.indexOf('"EM_Drive_DB".ilk_Fwd_Fast :='));
  });
});

describe("writeUnitArtifacts — STAT_<Unit> status readbacks (G4-2)", () => {
  function statIr() {
    const members: UnitMemberEm[] = [{ emId: "em-a", emName: "Drive", states: [] }];
    const coord: UnitCoordinationV1 = {
      unit_id: "unit-1",
      states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
      transitions: [],
      em_command_overrides: null,
      axes: [
        { axis_id: "travel", kind: "linear", encoder_tag: "Enc_Travel", eu_unit: "mm",
          scale: { db_member: "mm_per_rev_x10", retain: true, operator_settable: false },
          length: { db_member: "length_mm", retain: true, operator_settable: true },
          end_margin: { db_member: "end_margin_mm", default: 500, retain: true, operator_settable: false },
          ramp_zone: { db_member: "ramp_zone_mm", default: 2000, retain: true, operator_settable: false },
          gates: { fwd_ok: "g-fwd", fwd_fast_ok: "g-fwd-fast", rev_fast_ok: "g-rev-fast" },
          unconfigured_open: true },
        { axis_id: "rot", kind: "rotary", encoder_tag: "Enc_Rot",
          counts_per_rev: { db_member: "counts_per_360", default: 0, retain: true, operator_settable: false },
          preset_offset: 0,
          home_windows: [{ center_deg10: 0, band_deg10: 20 }],
          gates: { at_home: "g-at-home" } },
      ],
    };
    return buildUnitSequence({ unitId: "unit-1", unitName: "Carriage", coord, members, modes: [] });
  }

  it("emits the STAT_<Unit> DB with position, distance, zone, and gate members", () => {
    const db = writeUnitArtifacts(statIr()).artifacts.find((a) => a.name === "STAT_Carriage")!;
    expect(db.type).toBe("DB");
    expect(db.layer).toBe("unit");
    expect(db.content).toContain("travel_position_mm : DInt;");
    expect(db.content).toContain("travel_dist_to_fwd_end_mm : DInt;");
    expect(db.content).toContain("travel_dist_to_rev_end_mm : DInt;");
    expect(db.content).toContain("travel_in_ramp_zone : Bool;");
    expect(db.content).toContain("rot_position_deg10 : DInt;");
    expect(db.content).toContain("g_fwd : Bool;");
    expect(db.content).toContain("g_fwd_fast : Bool;");
    expect(db.content).toContain("g_at_home : Bool;");
  });

  it("writes positions, configured-gated distances, ramp-zone flag, and gate mirrors each scan", () => {
    const fb = writeUnitArtifacts(statIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).toContain('"STAT_Carriage".travel_position_mm := #pos_travel;');
    expect(fb).toContain(
      '"STAT_Carriage".travel_dist_to_fwd_end_mm := "CFG_Carriage".length_mm - "CFG_Carriage".end_margin_mm - #pos_travel;',
    );
    expect(fb).toContain(
      '"STAT_Carriage".travel_dist_to_rev_end_mm := #pos_travel - "CFG_Carriage".end_margin_mm;',
    );
    // unconfigured -> distances read 0
    expect(fb).toContain('"STAT_Carriage".travel_dist_to_fwd_end_mm := 0;');
    // ramp zone from the declared fast gates
    expect(fb).toContain(
      '"STAT_Carriage".travel_in_ramp_zone := (NOT #gate_g_fwd_fast) OR (NOT #gate_g_rev_fast);',
    );
    expect(fb).toContain('"STAT_Carriage".rot_position_deg10 := #deg10_rot;');
    expect(fb).toContain('"STAT_Carriage".g_fwd := #gate_g_fwd;');
    expect(fb).toContain('"STAT_Carriage".g_at_home := #gate_g_at_home;');
  });

  it("emits no STAT DB when the unit declares no axes", () => {
    const arts = writeUnitArtifacts(twoStateIr()).artifacts;
    expect(arts.find((a) => a.name.startsWith("STAT_"))).toBeUndefined();
  });
});
