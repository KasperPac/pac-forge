import { describe, expect, it } from "vitest";
import { SpecContractV2Schema, type SpecContractV2 } from "@/types/spec-contract-v2";
import {
  validateSpecContractPatch,
  type SpecContractPatch,
} from "@/lib/spec-builder/contract";
import { applyOverrideKind } from "@/lib/spec-builder/migrate/apply-override-kind";
import { applyStructuredInterlocks } from "@/lib/spec-builder/migrate/apply-structured-interlocks";
import { proposeStateMapping } from "@/lib/spec-builder/migrate/propose-states";
import { proposeModes } from "@/lib/spec-builder/migrate/propose-modes";
import type { ProposedInterlock } from "@/lib/spec-builder/migrate/types";

import catodo from "../migrate/__fixtures__/catodo-v1.json";
import norteSur from "../migrate/__fixtures__/norte-sur-en-v1.json";
import cvl2129 from "../migrate/__fixtures__/cvl-2129-v1.json";

const FIXTURES: Array<{ name: string; data: unknown }> = [
  { name: "catodo", data: catodo },
  { name: "norte-sur-en", data: norteSur },
  { name: "cvl-2129", data: cvl2129 },
];

// Stub the AI classifier to "auto-accept" — every interlock gets a
// confident structured classification mirroring the original prose.
function autoClassify(contract: SpecContractV2): ProposedInterlock[] {
  const out: ProposedInterlock[] = [];
  for (const stateMap of Object.values(contract.unit_procedures)) {
    for (const seq of Object.values(stateMap)) {
      for (const il of seq.inter_equipment_module_interlocks ?? []) {
        out.push({
          interlock_id: il.interlock_id,
          source_equipment_module: il.source_equipment_module,
          target_equipment_module: il.target_equipment_module,
          original_prose_condition:
            typeof il.source_condition === "string"
              ? il.source_condition
              : il.prose,
          original_prose_effect: il.prose,
          effect: "hold",
          source_condition: { kind: "tag_equals", tag: "TEST_TAG", value: true },
          confidence: 0.95,
          reasoning: "test stub",
        });
      }
    }
  }
  return out;
}

describe.each(FIXTURES)("migration end-to-end: $name", ({ data }) => {
  it("loads the fixture as a valid SpecContractV2", () => {
    expect(() => SpecContractV2Schema.parse(data)).not.toThrow();
  });

  it("produces a writeSpecContract patch that validates", () => {
    const contract = SpecContractV2Schema.parse(data);
    const legacyStateNames = contract.states.map((s) =>
      typeof s.state_id === "string" ? s.state_id : String(s.state_id),
    );
    const modes = proposeModes(legacyStateNames).modes;
    const states = legacyStateNames.map(proposeStateMapping).map((row) => {
      // Resolve any unmapped → custom for the test
      if (row.match_source === "unmapped") {
        return { ...row, custom_state_id: 101, custom_name: row.legacy_name };
      }
      return row;
    });
    const interlocks = autoClassify(contract);

    const patch: SpecContractPatch = {
      modes,
      states: states.map((row) =>
        typeof row.packml_id === "number"
          ? {
              state_id: row.packml_id,
              packml_id: row.packml_id,
              display_name: row.legacy_name,
              description: row.legacy_name,
              state_pattern: "sequential",
            }
          : {
              state_id: row.custom_state_id!,
              custom_name: row.custom_name!,
              display_name: row.custom_name!,
              description: row.custom_name!,
              state_pattern: "static",
            },
      ),
      equipment_modules: applyOverrideKind(contract.equipment_modules),
      unit_procedures: applyStructuredInterlocks(
        contract.unit_procedures,
        interlocks,
      ),
      confirmation_status: "confirmed",
    };

    const issues = validateSpecContractPatch(patch);
    expect(issues).toEqual([]);
  });
});
