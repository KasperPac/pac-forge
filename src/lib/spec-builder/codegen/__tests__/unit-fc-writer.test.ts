import { describe, expect, it } from "vitest";
import { writeUnitProcessFc, writeUnitManagementFc } from "../unit-fc-writer";
import { CUSTOM_REGION_BEGIN, CUSTOM_REGION_END } from "../custom-region";

const base = { unitScl: "Process_Unit", unitName: "Process Unit", unitId: "u-1" };

describe("writeUnitProcessFc", () => {
  it("calls the UC then the custom region, in unit-root folder / unit layer", () => {
    const a = writeUnitProcessFc({ ...base, ucCallLine: `   "UC_Process_Unit_DB"();` });
    expect(a.name).toBe("FC_Process_Unit_Process");
    expect(a.folder).toBe("Process_Unit");
    expect(a.layer).toBe("unit");
    expect(a.ownerId).toBe("u-1");
    const uc = a.content.indexOf(`"UC_Process_Unit_DB"();`);
    const begin = a.content.indexOf(CUSTOM_REGION_BEGIN);
    const end = a.content.indexOf(CUSTOM_REGION_END);
    expect(uc).toBeGreaterThan(-1);
    expect(begin).toBeGreaterThan(uc);
    expect(end).toBeGreaterThan(begin);
  });
});

describe("writeUnitManagementFc", () => {
  it("emits the unit's call lines verbatim, in order", () => {
    const lines = [`   "EM_Agitator_Module_DB"(enable := "Agitator_Module_CMD".enable);`, `   "EM_Dosing_Module_DB"();`];
    const a = writeUnitManagementFc({ ...base, callLines: lines });
    expect(a.name).toBe("FC_Process_Unit_Management");
    expect(a.content.indexOf("Agitator_Module")).toBeLessThan(a.content.indexOf("Dosing_Module"));
  });
  it("emits an empty-body FC for a unit with no members", () => {
    expect(writeUnitManagementFc({ ...base, callLines: [] }).content).toContain("// (no equipment modules)");
  });
});
