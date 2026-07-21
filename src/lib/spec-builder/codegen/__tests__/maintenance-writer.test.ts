// src/lib/spec-builder/codegen/__tests__/maintenance-writer.test.ts
import { describe, it, expect } from "vitest";
import { writeMaintenanceArtifacts, type MaintenanceInput } from "../maintenance-writer";

function input(overrides?: Partial<MaintenanceInput>): MaintenanceInput {
  return {
    overridableOutputs: [
      { tag: "Travel_Horn", address: "Q0.2", wireCheckOnly: false, description: "pre-travel horn" },
      { tag: "CM1_Run", address: "Q0.4", wireCheckOnly: true },
    ],
    presets: [
      {
        axisId: "rot",
        ident: "rot",
        ctrlAddress: "%QB70",
        valueAddress: "%QD71",
        statusAddress: "%IB78",
        blockedWhileEmExecute: { emName: "Rotator_Drive", executeIndex: 6 },
      },
    ],
    ...overrides,
  };
}

describe("writeMaintenanceArtifacts — Maintenance_CMD seam DB (G3-1)", () => {
  it("emits flags, preset channels, and ov_ bools per overridable output", () => {
    const { artifacts } = writeMaintenanceArtifacts(input());
    const db = artifacts.find((a) => a.name === "Maintenance_CMD")!;
    expect(db.type).toBe("DB");
    expect(db.content).toContain("maintenance_mode : Bool;");
    expect(db.content).toContain("seq_test_mode : Bool;");
    expect(db.content).toContain("rot_preset_execute : Bool;");
    expect(db.content).toContain("rot_preset_value : DInt;");
    expect(db.content).toContain("rot_preset_done : Bool;");
    expect(db.content).toContain("rot_preset_step : Int;");
    expect(db.content).toContain("rot_preset_timer : Int;");
    expect(db.content).toContain("ov_Travel_Horn : Bool;   // Q0.2 pre-travel horn");
    expect(db.content).toContain("ov_CM1_Run : Bool;   // Q0.4 (wire check only)");
  });
});

describe("writeMaintenanceArtifacts — MAINT_Output_Override FC (G3-2)", () => {
  it("returns unless maintenance_mode, then writes each override to its DO tag", () => {
    const { artifacts } = writeMaintenanceArtifacts(input());
    const fc = artifacts.find((a) => a.name === "MAINT_Output_Override")!;
    expect(fc.type).toBe("FC");
    expect(fc.content).toContain('IF NOT "Maintenance_CMD".maintenance_mode THEN');
    const ret = fc.content.indexOf("RETURN;");
    expect(ret).toBeGreaterThan(-1);
    expect(fc.content).toContain('"Travel_Horn" := "Maintenance_CMD".ov_Travel_Horn;   // %Q0.2');
    expect(fc.content).toContain('"CM1_Run" := "Maintenance_CMD".ov_CM1_Run;   // %Q0.4 (wire check only)');
    // writes come after the gate
    expect(fc.content.indexOf('"Travel_Horn" :=')).toBeGreaterThan(ret);
  });

  it("emits no override FC when no outputs are declared", () => {
    const { artifacts } = writeMaintenanceArtifacts(input({ overridableOutputs: [] }));
    expect(artifacts.find((a) => a.name === "MAINT_Output_Override")).toBeUndefined();
  });
});

describe("writeMaintenanceArtifacts — MAINT_Encoder_Preset FC (G3-3)", () => {
  it("zeroes trigger bytes, resets outside maintenance, and runs the 3-step pulse sequencer", () => {
    const { artifacts } = writeMaintenanceArtifacts(input());
    const fc = artifacts.find((a) => a.name === "MAINT_Encoder_Preset")!;
    expect(fc.type).toBe("FC");
    // trigger byte defaults to zero every scan
    expect(fc.content).toContain("%QB70 := 16#00;");
    // reset + release outside maintenance mode
    expect(fc.content).toContain('IF NOT "Maintenance_CMD".maintenance_mode THEN');
    expect(fc.content).toContain('"Maintenance_CMD".rot_preset_step := 0;');
    // step 0: arm only while the blocking EM is not in Execute
    expect(fc.content).toContain(
      'IF "Maintenance_CMD".rot_preset_execute AND ("EM_Rotator_Drive_DB".state <> 6) THEN',
    );
    expect(fc.content).toContain('%QD71 := DINT_TO_DWORD("Maintenance_CMD".rot_preset_value);');
    // step 1: hold the trigger ~1 s of scans
    expect(fc.content).toContain("%QB70 := 16#01;");
    expect(fc.content).toContain(">= 100");
    // step 2: done until execute drops
    expect(fc.content).toContain('"Maintenance_CMD".rot_preset_done := TRUE;');
  });

  it("emits no preset FC when no preset channels are recorded", () => {
    const { artifacts } = writeMaintenanceArtifacts(input({ presets: [] }));
    expect(artifacts.find((a) => a.name === "MAINT_Encoder_Preset")).toBeUndefined();
  });

  it("arms without an EM guard (plus TODO) when the blocking EM is unresolved", () => {
    const { artifacts } = writeMaintenanceArtifacts(
      input({ presets: [{ axisId: "rot", ident: "rot", ctrlAddress: "%QB70", valueAddress: "%QD71", statusAddress: "%IB78" }] }),
    );
    const fc = artifacts.find((a) => a.name === "MAINT_Encoder_Preset")!;
    expect(fc.content).toContain('IF "Maintenance_CMD".rot_preset_execute THEN');
    expect(fc.content).toContain("// TODO no run-interlock");
  });
});
