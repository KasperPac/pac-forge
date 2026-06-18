/**
 * Compose equipment-module-level co-authored data into unit-level spec_sections.
 * Bridges the FDS co-author system with the existing editor and DOCX exporter.
 */
import { supabase } from "@/lib/supabase";
import type {
  UnitConfig,
  OperatingState,
  OperationSession,
  StepEntry,
  FunctionalDescriptionContent,
} from "@/types/spec-builder";
import type { PermissiveCondition } from "@/types/spec-contract-v2";

function serializePermissive(p: PermissiveCondition): string {
  const val = p.value === true ? "TRUE" : p.value === false ? "FALSE" : String(p.value);
  return `${p.tag} ${p.operator} ${val}`;
}

/**
 * Compose all equipment_module sessions for a unit into spec_sections rows.
 * Emits one functional_description row per (equipment_module, state) using each
 * session's own permissives/steps. Inter-EM coordination is expressed as
 * permissive guards on EM transitions in the hybrid state model — there is no
 * separate unit-orchestration layer to merge here.
 */
export async function composeFdsToSections(
  specProjectId: string,
  unit: UnitConfig,
  sessions: OperationSession[],
  allStates: OperatingState[],
): Promise<void> {
  const staticStates = allStates.filter((s) => s.state_pattern === "static");
  const sequentialStates = allStates.filter((s) => s.state_pattern === "sequential");

  // Delete existing functional_description sections for this unit
  await supabase
    .from("spec_sections")
    .delete()
    .eq("spec_project_id", specProjectId)
    .eq("unit_id", unit.unit_id)
    .eq("section_type", "functional_description");

  // --- Static states: emit one row per (equipment_module, state) to match V2 shape. ---
  for (const state of staticStates) {
    for (const session of sessions) {
      const entries = session.static_states[state.state_id] ?? [];
      if (entries.length === 0) continue;

      const content: FunctionalDescriptionContent = {
        pattern: "static",
        control_module_states: entries,
      };

      await supabase.from("spec_sections").insert({
        spec_project_id: specProjectId,
        section_type: "functional_description",
        unit_id: unit.unit_id,
        state_name: `${state.state_name} — ${session.equipment_module_id}`,
        content_json: content,
        content_markdown: null,
        model_used: "co-authored",
        generation_prompt: null,
        token_usage: {},
        approved: false,
        reviewed_by: null,
        review_notes: null,
      });
    }
  }

  // --- Sequential states: emit one row per (equipment_module, state) ---
  // Each row carries just that equipment_module's own permissives/steps/notes.
  // Inter-EM coordination is expressed as permissive guards on EM transitions
  // (hybrid state model) — not merged in here.
  for (const state of sequentialStates) {
    for (const session of sessions) {
      const data = session.sequential_states[state.state_id];
      if (!data) continue;

      const perAssemblyPerms: string[] = data.permissives.map(serializePermissive);

      const content: FunctionalDescriptionContent = {
        pattern: "sequential",
        permissives: perAssemblyPerms,
        // Shim cast: legacy StepEntry expects completion_criteria:string while
        // PhaseStep carries CompletionCriterion[]. DOCX renderer reads the legacy
        // field via completion_criteria_text during the SFC v2 migration.
        steps: data.steps as unknown as StepEntry[],
        notes: data.notes ?? undefined,
      };

      await supabase.from("spec_sections").insert({
        spec_project_id: specProjectId,
        section_type: "functional_description",
        unit_id: unit.unit_id,
        state_name: `${state.state_name} — ${session.equipment_module_id}`,
        content_json: content,
        content_markdown: null,
        model_used: "co-authored",
        generation_prompt: null,
        token_usage: {},
        approved: false,
        reviewed_by: null,
        review_notes: null,
      });
    }
  }
}

/**
 * Apply a tag remap to all text fields in sequential state data.
 * Used by the duplicate feature.
 */
export function remapSequentialStates(
  states: Record<string, { permissives: string[]; steps: StepEntry[]; notes: string | null }>,
  remap: Record<string, string>,
): Record<string, { permissives: string[]; steps: StepEntry[]; notes: string | null }> {
  const result: Record<string, { permissives: string[]; steps: StepEntry[]; notes: string | null }> = {};

  for (const [stateId, data] of Object.entries(states)) {
    result[stateId] = {
      permissives: data.permissives.map((p) => applyRemap(p, remap)),
      steps: data.steps.map((s) => ({
        step: s.step,
        action: applyRemap(s.action, remap),
        completion_criteria: applyRemap(s.completion_criteria, remap),
      })),
      notes: data.notes ? applyRemap(data.notes, remap) : null,
    };
  }

  return result;
}

/** Replace all occurrences of old tags with new tags in a string */
function applyRemap(text: string, remap: Record<string, string>): string {
  let result = text;
  // Sort by length descending to avoid partial replacements
  const entries = Object.entries(remap).sort((a, b) => b[0].length - a[0].length);
  for (const [oldTag, newTag] of entries) {
    result = result.replaceAll(oldTag, newTag);
  }
  return result;
}
