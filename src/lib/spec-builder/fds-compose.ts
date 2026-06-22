/**
 * Compose equipment-module-level co-authored data into unit-level spec_sections.
 * Bridges the FDS co-author system with the existing editor and DOCX exporter.
 */
import { supabase } from "@/lib/supabase";
import type {
  UnitConfig,
  OperationSession,
  StepEntry,
  FunctionalDescriptionContent,
  TransitionEntry,
} from "@/types/spec-builder";
import type { EmStateV2, EmTransitionV2, PermissiveCondition } from "@/types/spec-contract-v2";

function serializePermissive(p: PermissiveCondition): string {
  const val = p.value === true ? "TRUE" : p.value === false ? "FALSE" : String(p.value);
  return `${p.tag} ${p.operator} ${val}`;
}

/**
 * Build the operation-logic rows for one state: every transition leaving that
 * state, with its trigger (command condition or completion), target state name,
 * and permissive guards. This is the cross-EM coordination + operation narrative
 * the FDS needs ("pressing FWD drives the carriage", "the limit stops it").
 */
function outgoingTransitions(
  stateId: string,
  transitions: EmTransitionV2[],
  stateNameById: Record<string, string>,
): TransitionEntry[] {
  return transitions
    .filter((t) => t.from_state_id === stateId)
    .map((t) => ({
      trigger:
        t.trigger.kind === "command"
          ? serializePermissive(t.trigger.expr)
          : "On completion",
      to_state: stateNameById[t.to_state_id] ?? t.to_state_id,
      permissives: (t.guard ?? []).map(serializePermissive),
    }));
}

/**
 * Compose all equipment_module sessions for a unit into spec_sections rows.
 * Emits one functional_description row per (equipment_module, state) using each
 * session's OWN states (hybrid per-EM state model). Each session declares its
 * states in `em_states` (EmStateV2.kind = static | sequential); the per-state
 * behaviour lives in that session's static_states / sequential_states maps,
 * keyed by EM-local state_id. Inter-EM coordination is expressed as permissive
 * guards on EM transitions — there is no separate unit-orchestration layer.
 */
export async function composeFdsToSections(
  specProjectId: string,
  unit: UnitConfig,
  sessions: OperationSession[],
): Promise<void> {
  // Delete existing functional_description sections for this unit
  await supabase
    .from("spec_sections")
    .delete()
    .eq("spec_project_id", specProjectId)
    .eq("unit_id", unit.unit_id)
    .eq("section_type", "functional_description");

  // One functional_description row per (equipment_module, EM-local state). The
  // V2 editor + DOCX exporter key on equipment_module_id / state_id / state_pattern,
  // and the editor reads the EM id from content_json — so all of those must be
  // populated, not just unit_id (the old shape only set unit_id + a combined
  // state_name string, which left every row orphaned in the editor tree).
  const insertRow = async (
    session: OperationSession,
    state: EmStateV2,
    content: FunctionalDescriptionContent,
  ) => {
    const contentWithEm = { ...content, equipment_module_id: session.equipment_module_id };
    await supabase.from("spec_sections").insert({
      spec_project_id: specProjectId,
      section_type: "functional_description",
      unit_id: unit.unit_id,
      equipment_module_id: session.equipment_module_id,
      state_id: state.state_id,
      state_pattern: state.kind,
      // NB: granularity is omitted so it takes the column default ('assembly_state').
      // The spec_sections_granularity_check constraint only permits the legacy
      // values on this DB; the editor/exporter key on equipment_module_id +
      // state_id, not granularity, so the legacy default is harmless here.
      state_name: state.name,
      content_json: contentWithEm,
      content_markdown: null,
      model_used: "co-authored",
      generation_prompt: null,
      token_usage: {},
      approved: false,
      reviewed_by: null,
      review_notes: null,
    });
  };

  for (const session of sessions) {
    const emStates: EmStateV2[] = session.em_states ?? [];
    const transitions: EmTransitionV2[] = session.em_transitions ?? [];
    // EM-local state_id → human name, for naming transition targets.
    const stateNameById: Record<string, string> = Object.fromEntries(
      emStates.map((s) => [s.state_id, s.name]),
    );

    // --- Static states: one row per (equipment_module, state). Emitted even
    // when the device table is empty (input-only modules) so every state is
    // documented. ---
    for (const state of emStates.filter((s) => s.kind === "static")) {
      const entries = session.static_states[state.state_id] ?? [];
      await insertRow(session, state, {
        pattern: "static",
        control_module_states: entries,
        transitions: outgoingTransitions(state.state_id, transitions, stateNameById),
      });
    }

    // --- Sequential states: one row per (equipment_module, state), carrying
    // that module's own permissives/steps/notes. ---
    for (const state of emStates.filter((s) => s.kind === "sequential")) {
      const data = session.sequential_states[state.state_id];
      if (!data) continue;
      await insertRow(session, state, {
        pattern: "sequential",
        permissives: data.permissives.map(serializePermissive),
        // Shim cast: legacy StepEntry expects completion_criteria:string while
        // PhaseStep carries CompletionCriterion[]. DOCX renderer reads the legacy
        // field via completion_criteria_text during the SFC v2 migration.
        steps: data.steps as unknown as StepEntry[],
        notes: data.notes ?? undefined,
        transitions: outgoingTransitions(state.state_id, transitions, stateNameById),
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
