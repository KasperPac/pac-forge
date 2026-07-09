// src/lib/spec-builder/codegen/__tests__/unit-writer.test.ts
import { describe, it, expect } from "vitest";
import { writeUnitArtifacts } from "../unit-writer";
import { buildUnitSequence } from "../unit-builder";
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
