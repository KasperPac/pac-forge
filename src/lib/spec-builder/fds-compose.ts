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
  DeviceStateEntry,
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

  // --- Static states: merge all assembly device state tables ---
  for (const state of staticStates) {
    const merged: DeviceStateEntry[] = [];
    for (const session of sessions) {
      const entries = session.static_states[state.state_id] ?? [];
      merged.push(...entries);
    }

    if (merged.length === 0) continue;

    const content: FunctionalDescriptionContent = {
      pattern: "static",
      device_states: merged,
    };

    await supabase.from("spec_sections").insert({
      spec_project_id: specProjectId,
      section_type: "functional_description",
      subsystem_id: subsystem.subsystem_id,
      state_name: state.state_id,
      content_json: content,
      model_used: "co-authored",
      generation_prompt: null,
      token_usage: {},
    });
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

    // Merge permissives: shared first, then per-assembly
    const allPermissives: string[] = [];
    if (seq?.shared_permissives?.length) {
      allPermissives.push(...seq.shared_permissives);
    }

    // Add inter-assembly interlocks as permissives on target assemblies
    const interlocksByTarget = new Map<string, string[]>();
    for (const il of seq?.inter_assembly_interlocks ?? []) {
      if (!interlocksByTarget.has(il.target_assembly)) {
        interlocksByTarget.set(il.target_assembly, []);
      }
      interlocksByTarget.get(il.target_assembly)!.push(
        `${il.source_condition} (${il.effect})`,
      );
    }

    // Merge steps: renumber sequentially across assemblies
    const allSteps: StepEntry[] = [];
    let stepNum = 1;
    const allNotes: string[] = [];

    for (const session of orderedSessions) {
      const data = session.sequential_states[state.state_id];
      if (!data) continue;

      // Add assembly-specific permissives
      for (const perm of data.permissives) {
        if (!allPermissives.includes(perm)) {
          allPermissives.push(perm);
        }
      }

      // Add interlock permissives for this assembly
      const interlocks = interlocksByTarget.get(session.assembly_id) ?? [];
      for (const il of interlocks) {
        if (!allPermissives.includes(il)) {
          allPermissives.push(il);
        }
      }

      // Renumber and add steps
      const assemblyName = subsystem.assemblies.find(
        (a) => a.assembly_id === session.assembly_id,
      )?.assembly_name ?? session.assembly_id;

      for (const step of data.steps) {
        allSteps.push({
          step: stepNum++,
          action: step.action,
          completion_criteria: step.completion_criteria,
        });
      }

      if (data.notes) {
        allNotes.push(`${assemblyName}: ${data.notes}`);
      }
    }

    if (allSteps.length === 0 && allPermissives.length === 0) continue;

    const content: FunctionalDescriptionContent = {
      pattern: "sequential",
      permissives: allPermissives,
      steps: allSteps,
      notes: allNotes.length > 0 ? allNotes.join("\n") : null,
    };

    await supabase.from("spec_sections").insert({
      spec_project_id: specProjectId,
      section_type: "functional_description",
      subsystem_id: subsystem.subsystem_id,
      state_name: state.state_id,
      content_json: content,
      model_used: "co-authored",
      generation_prompt: null,
      token_usage: {},
    });
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
