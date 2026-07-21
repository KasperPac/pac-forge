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

  it("skeleton IR without signal_routing emits no ok gate and no seq-test input", () => {
    const fb = writeUnitArtifacts(twoStateIr()).artifacts.find((a) => a.name === "UC_Carriage")!.content;
    expect(fb).not.toContain("#ok :=");
    expect(fb).not.toContain("i_Seq_Test");
  });
});
