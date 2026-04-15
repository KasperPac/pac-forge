/**
 * Compose assembly-level co-authored data into subsystem-level spec_sections.
 * Bridges the FDS co-author system with the existing editor and DOCX exporter.
 */
import { supabase } from "@/lib/supabase";
import type {
  SubsystemConfig,
  OperatingState,
  FdsAssemblySession,
  SubsystemOrchestration,
  StepEntry,
  FunctionalDescriptionContent,
} from "@/types/spec-builder";

/**
 * Compose all assembly sessions for a subsystem into spec_sections rows.
 * Handles assembly ordering via orchestration, merges device state tables,
 * and interleaves step tables with inter-assembly interlocks.
 */
export async function composeFdsToSections(
  specProjectId: string,
  subsystem: SubsystemConfig,
  sessions: FdsAssemblySession[],
  orchestration: SubsystemOrchestration | null,
  allStates: OperatingState[],
): Promise<void> {
  const staticStates = allStates.filter((s) => s.state_pattern === "static");
  const sequentialStates = allStates.filter((s) => s.state_pattern === "sequential");

  // Delete existing functional_description sections for this subsystem
  await supabase
    .from("spec_sections")
    .delete()
    .eq("spec_project_id", specProjectId)
    .eq("subsystem_id", subsystem.subsystem_id)
    .eq("section_type", "functional_description");

  // --- Static states: emit one row per (assembly, state) to match V2 shape. ---
  for (const state of staticStates) {
    for (const session of sessions) {
      const entries = session.static_states[state.state_id] ?? [];
      if (entries.length === 0) continue;

      const content: FunctionalDescriptionContent = {
        pattern: "static",
        device_states: entries,
      };

      await supabase.from("spec_sections").insert({
        spec_project_id: specProjectId,
        section_type: "functional_description",
        subsystem_id: subsystem.subsystem_id,
        assembly_id: session.assembly_id,
        state_id: state.state_id,
        state_pattern: "static",
        granularity: "assembly_state",
        state_name: state.state_id,
        content_json: content,
        model_used: "co-authored",
        generation_prompt: null,
        token_usage: {},
      });
    }
  }

  // --- Sequential states: interleave assembly steps with orchestration ---
  for (const state of sequentialStates) {
    const seq = orchestration?.state_sequences[state.state_id];

    // Determine assembly order
    const assemblyOrder = seq?.assembly_order ??
      sessions.map((s) => s.assembly_id);

    // Build ordered session list
    const orderedSessions = assemblyOrder
      .map((asmId) => sessions.find((s) => s.assembly_id === asmId))
      .filter((s): s is FdsAssemblySession => s !== undefined);

    // Build inter-assembly interlocks index (applied as extra permissives on
    // the target assembly's per-assembly row).
    const interlocksByTarget = new Map<string, string[]>();
    for (const il of seq?.inter_assembly_interlocks ?? []) {
      if (!interlocksByTarget.has(il.target_assembly)) {
        interlocksByTarget.set(il.target_assembly, []);
      }
      interlocksByTarget.get(il.target_assembly)!.push(
        `${il.source_condition} (${il.effect})`,
      );
    }

    // V2: emit one row per (assembly, state). Each row carries just that
    // assembly's permissives/steps/notes. Subsystem-level orchestration (order,
    // shared permissives, inter-assembly interlocks) is written separately to
    // `fds_subsystem_orchestrations` and composed at render time — it doesn't
    // live inside the per-assembly functional_description rows.
    for (const session of orderedSessions) {
      const data = session.sequential_states[state.state_id];
      if (!data) continue;

      const perAssemblyPerms: string[] = [...(seq?.shared_permissives ?? []), ...data.permissives];
      const interlocks = interlocksByTarget.get(session.assembly_id) ?? [];
      for (const il of interlocks) {
        if (!perAssemblyPerms.includes(il)) perAssemblyPerms.push(il);
      }

      const content: FunctionalDescriptionContent = {
        pattern: "sequential",
        permissives: perAssemblyPerms,
        steps: data.steps,
        notes: data.notes ?? undefined,
      };

      await supabase.from("spec_sections").insert({
        spec_project_id: specProjectId,
        section_type: "functional_description",
        subsystem_id: subsystem.subsystem_id,
        assembly_id: session.assembly_id,
        state_id: state.state_id,
        state_pattern: "sequential",
        granularity: "assembly_state",
        state_name: state.state_id,
        content_json: content,
        model_used: "co-authored",
        generation_prompt: null,
        token_usage: {},
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
