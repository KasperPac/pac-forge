import { describe, expect, it } from "vitest";
import { buildFdsInterviewSystemPrompt, buildFdsOrchestrationSystemPrompt, extractJsonFromResponse } from "../fds-prompts";
import { ensureV2 } from "../sequence-legacy-shim";
import { validateSpecContractPatch } from "../contract";
import catodoEquipmentModule from "./__fixtures__/catodo-equipment_module.json";
import catodoUnit from "./__fixtures__/catodo-unit.json";
import goldenEquipmentModule from "./__fixtures__/golden-ai-emission-equipment_module.json";
import goldenOrch from "./__fixtures__/golden-ai-emission-orchestration.json";
import type { UnitProcedureSequence, EmStateV2 } from "@/types/spec-contract-v2";

// Task 9 — the interview prompt is now keyed by the EM's OWN states (EmStateV2,
// EM-local string slugs). Convert the fixture's global OperatingStateV2[] into
// equivalent EM-local states. The slug mirrors the existing numeric id so the
// staticStates/completedSequentialStates fixture keys still resolve.
const catodoEmStates: EmStateV2[] = (catodoEquipmentModule.allStates as Array<{
  state_id: number;
  display_name: string;
  state_pattern: string;
}>).map((s) => ({
  state_id: String(s.state_id),
  name: s.display_name,
  kind: s.state_pattern === "sequential" ? "sequential" : "static",
  allowed_modes: [],
  is_safe_state: s.state_pattern === "static",
}));

describe("buildFdsInterviewSystemPrompt V2 snapshot", () => {
  it("produces stable output for the catodo lift equipment_module", () => {
    const prompt = buildFdsInterviewSystemPrompt(
      catodoEquipmentModule.equipment_module as never,
      catodoEquipmentModule.unit as never,
      catodoEquipmentModule.tags as never,
      catodoEquipmentModule.staticStates as never,
      catodoEquipmentModule.completedSequentialStates as never,
      catodoEmStates as never,
    );
    expect(prompt).toMatchSnapshot();
  });

  it("includes the V2 marker fields in the rendered RESPONSE FORMAT", () => {
    const prompt = buildFdsInterviewSystemPrompt(
      catodoEquipmentModule.equipment_module as never,
      catodoEquipmentModule.unit as never,
      catodoEquipmentModule.tags as never,
      catodoEquipmentModule.staticStates as never,
      catodoEquipmentModule.completedSequentialStates as never,
      catodoEmStates as never,
    );
    expect(prompt).toContain('"override_kind": "override"');
    expect(prompt).toContain('"kind": "tag_equals"');
    expect(prompt).toContain('"kind": "tag_compare"');
    expect(prompt).toContain('"target_step_id"');
    expect(prompt).toContain('"kind": "single"');
    expect(prompt).toContain("EM-LOCAL string slug");
  });

  it("renders a Customer Specification Context block when sections are passed", () => {
    const prompt = buildFdsInterviewSystemPrompt(
      catodoEquipmentModule.equipment_module as never,
      catodoEquipmentModule.unit as never,
      catodoEquipmentModule.tags as never,
      catodoEquipmentModule.staticStates as never,
      catodoEquipmentModule.completedSequentialStates as never,
      catodoEmStates as never,
      [{ heading: "Conveyor CV01", body: "Runs forward on M1 command.", order_index: 1 }],
    );
    expect(prompt).toContain("## Customer Specification Context");
    expect(prompt).toContain("Runs forward on M1 command.");
  });

  it("omits the Customer Specification Context block when no sections are passed", () => {
    const prompt = buildFdsInterviewSystemPrompt(
      catodoEquipmentModule.equipment_module as never,
      catodoEquipmentModule.unit as never,
      catodoEquipmentModule.tags as never,
      catodoEquipmentModule.staticStates as never,
      catodoEquipmentModule.completedSequentialStates as never,
      catodoEmStates as never,
    );
    expect(prompt).not.toContain("## Customer Specification Context");
  });

  it("renders the SEQUENTIAL STATES REMAINING table with EM-local state ids", () => {
    const prompt = buildFdsInterviewSystemPrompt(
      catodoEquipmentModule.equipment_module as never,
      catodoEquipmentModule.unit as never,
      catodoEquipmentModule.tags as never,
      catodoEquipmentModule.staticStates as never,
      catodoEquipmentModule.completedSequentialStates as never,
      catodoEmStates as never,
    );
    // Both sequential states from the fixture must appear with their numeric ids.
    expect(prompt).toMatch(/- 6 +\(Execute\)/);
    expect(prompt).toMatch(/- 16 +\(Completing\)/);
    // The static state (Idle, id 4) must NOT appear in the remaining-table.
    const remainingBlock = prompt.split("# SEQUENTIAL STATES REMAINING")[1] ?? "";
    expect(remainingBlock).not.toMatch(/- 4 +\(Idle\)/);
  });
});

describe("golden AI emission — per-equipment_module", () => {
  const ASSEMBLY_ID = "00000000-0000-4000-8000-000000000aa1";
  const SUBSYSTEM_ID = "00000000-0000-4000-8000-000000000bb1";

  it.each(goldenEquipmentModule.responses)(
    "response '$name' parses + validates",
    ({ rawText, expectedStateId }) => {
      const extracted = extractJsonFromResponse(rawText) as unknown as Array<Record<string, unknown>> | null;
      expect(extracted).not.toBeNull();
      expect(Array.isArray(extracted)).toBe(true);
      expect(extracted![0]).toMatchObject({ state_id: expectedStateId });

      const v2 = ensureV2(extracted![0] as never, String(expectedStateId));

      const issues = validateSpecContractPatch({
        equipment_modules: {
          [ASSEMBLY_ID]: {
            equipment_module_id: ASSEMBLY_ID,
            unit_id: SUBSYSTEM_ID,
            static_states: {},
            sequential_states: { [String(expectedStateId)]: v2 },
          } as never,
        } as never,
      });

      expect(issues).toEqual([]);
    },
  );
});

describe("buildFdsOrchestrationSystemPrompt V2 snapshot", () => {
  it("produces stable output for the catodo unit", () => {
    const prompt = buildFdsOrchestrationSystemPrompt(
      catodoUnit.unit as never,
      catodoUnit.equipment_moduleSummaries as never,
      catodoUnit.sequentialStates as never,
    );
    expect(prompt).toMatchSnapshot();
  });

  it("inlines the shared closed-effect documentation", () => {
    const prompt = buildFdsOrchestrationSystemPrompt(
      catodoUnit.unit as never,
      catodoUnit.equipment_moduleSummaries as never,
      catodoUnit.sequentialStates as never,
    );
    for (const effect of ["hold", "block_transition", "trigger", "enable", "disable"]) {
      expect(prompt).toContain(`"${effect}"`);
    }
  });

  it("renders the V2 RESPONSE FORMAT example", () => {
    const prompt = buildFdsOrchestrationSystemPrompt(
      catodoUnit.unit as never,
      catodoUnit.equipment_moduleSummaries as never,
      catodoUnit.sequentialStates as never,
    );
    expect(prompt).toContain('"interlock_id"');
    expect(prompt).toContain('"effect_target"');
    expect(prompt).toContain('"prose"');
    expect(prompt).toContain('"kind": "tag_equals"');
  });
});

describe("golden AI emission — per-unit orchestration", () => {
  const SUB_ID = "00000000-0000-4000-8000-000000000b01";

  it.each(goldenOrch.responses)(
    "response '$name' parses + validates",
    ({ rawText, expectedStateId }) => {
      const extracted = extractJsonFromResponse(rawText) as unknown as Record<string, unknown> | null;
      expect(extracted).not.toBeNull();
      expect(extracted).toMatchObject({ state_id: expectedStateId });

      // Build the unit-orchestration patch the wizard would assemble.
      const sequence: UnitProcedureSequence = {
        equipment_module_order: extracted!.equipment_module_order as string[],
        shared_permissives: (extracted!.shared_permissives ?? []) as never,
        inter_equipment_module_interlocks: (extracted!.inter_equipment_module_interlocks ?? []) as never,
        notes: (extracted!.notes ?? null) as string | null,
      };

      const issues = validateSpecContractPatch({
        unit_procedures: {
          [SUB_ID]: { [String(expectedStateId)]: sequence } as never,
        },
      });

      expect(issues).toEqual([]);
    },
  );
});
