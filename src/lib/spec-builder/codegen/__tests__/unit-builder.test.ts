// src/lib/spec-builder/codegen/__tests__/unit-builder.test.ts
import { describe, it, expect } from "vitest";
import { buildUnitSequence } from "../unit-builder";
import type { UnitCoordinationV1 } from "@/types/spec-contract-v2";

describe("buildUnitSequence — Cur_St state indexing (G2-1)", () => {
  it("orders declared states by canonical UNIT_PACKML_STATES and assigns sequential Cur_St indices", () => {
    // Authored in a deliberately non-canonical order; the writer must index by
    // the canonical UNIT_PACKML_STATES order (G0-9 PackTags rule; G7-1 text
    // lists share this order), NOT authoring order.
    const coord: UnitCoordinationV1 = {
      unit_id: "unit-1",
      states: [
        { state_id: "held", allowed_modes: [], mode_change_allowed: false },
        { state_id: "idle", allowed_modes: [], mode_change_allowed: true },
        { state_id: "execute", allowed_modes: [], mode_change_allowed: false },
      ],
      transitions: [],
      em_command_overrides: null,
    };

    const ir = buildUnitSequence("unit-1", "Carriage", coord);

    // canonical order: idle (0) < execute (2) < held (7) → reindexed 0,1,2
    expect(ir.states.map((s) => s.stateId)).toEqual(["idle", "execute", "held"]);
    expect(ir.states.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(ir.warnings).toEqual([]);
  });
});
