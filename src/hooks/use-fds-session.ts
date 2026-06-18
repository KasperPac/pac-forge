/**
 * TanStack Query hooks for FDS equipment_module sessions.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  OperationSession,
  ControlModuleStateEntry,
  FdsConversationTurn,
  FdsValidationResult,
  FdsSessionStatus,
} from "@/types/spec-builder";
import type { SequentialStateV2 } from "@/types/spec-contract-v2";
import { ensureV2Record } from "@/lib/spec-builder/sequence-legacy-shim";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run legacy v1→v2 SFC shim on a session's sequential_states at read time. */
function applyShim(session: OperationSession): OperationSession {
  if (!session.sequential_states) return session;
  return {
    ...session,
    sequential_states: ensureV2Record(
      session.sequential_states as Record<string, SequentialStateV2>,
    ),
  };
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

const fdsSessionsKey = (specProjectId: string) =>
  ["fds_operation_sessions", specProjectId] as const;

const fdsSessionKey = (id: string) =>
  ["fds_operation_sessions", "single", id] as const;

// ---------------------------------------------------------------------------
// Equipment Module Sessions — Queries
// ---------------------------------------------------------------------------

/** Fetch all equipment_module sessions for a spec project */
export function useFdsSessionsForProject(specProjectId: string | undefined) {
  return useQuery({
    queryKey: fdsSessionsKey(specProjectId ?? ""),
    queryFn: async () => {
      if (!specProjectId) return [];
      const { data, error } = await supabase
        .from("fds_operation_sessions")
        .select("*")
        .eq("spec_project_id", specProjectId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as OperationSession[]).map(applyShim);
    },
    enabled: !!specProjectId,
  });
}

/** Fetch sessions for a specific unit */
export function useFdsSessionsForUnit(specProjectId: string | undefined, unitId: string | undefined) {
  return useQuery({
    queryKey: [...fdsSessionsKey(specProjectId ?? ""), unitId],
    queryFn: async () => {
      if (!specProjectId || !unitId) return [];
      const { data, error } = await supabase
        .from("fds_operation_sessions")
        .select("*")
        .eq("spec_project_id", specProjectId)
        .eq("unit_id", unitId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as OperationSession[]).map(applyShim);
    },
    enabled: !!specProjectId && !!unitId,
  });
}

/** Fetch a single session */
export function useFdsSession(id: string | undefined) {
  return useQuery({
    queryKey: fdsSessionKey(id ?? ""),
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("fds_operation_sessions")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return applyShim(data as OperationSession);
    },
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Equipment Module Sessions — Mutations
// ---------------------------------------------------------------------------

/** Create or get an existing session for an equipment_module */
export function useEnsureFdsSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      spec_project_id: string;
      unit_id: string;
      equipment_module_id: string;
    }) => {
      // Check if session already exists
      const { data: existing } = await supabase
        .from("fds_operation_sessions")
        .select("*")
        .eq("spec_project_id", input.spec_project_id)
        .eq("unit_id", input.unit_id)
        .eq("equipment_module_id", input.equipment_module_id)
        .maybeSingle();

      if (existing) return existing as OperationSession;

      const { data, error } = await supabase
        .from("fds_operation_sessions")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as OperationSession;
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: fdsSessionsKey(input.spec_project_id) });
    },
  });
}

/** Update static states and mark as confirmed */
export function useConfirmStaticStates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      static_states: Record<string, ControlModuleStateEntry[]>;
    }) => {
      const { data, error } = await supabase
        .from("fds_operation_sessions")
        .update({
          static_states: input.static_states,
          static_confirmed: true,
          status: "static_confirmed",
        })
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as OperationSession;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: fdsSessionsKey(data.spec_project_id) });
      queryClient.invalidateQueries({ queryKey: fdsSessionKey(data.id) });
    },
  });
}

/** Update sequential state data (from conversation or direct edit) */
export function useUpdateSequentialState() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      state_id: string;
      data: SequentialStateV2;
    }) => {
      // Fetch current to merge
      const { data: current, error: fetchError } = await supabase
        .from("fds_operation_sessions")
        .select("sequential_states, status")
        .eq("id", input.id)
        .single();
      if (fetchError) throw fetchError;

      const existing = (current.sequential_states as Record<string, SequentialStateV2>) ?? {};
      const updated = { ...existing, [input.state_id]: input.data };

      const newStatus: FdsSessionStatus = current.status === "not_started" ? "in_progress" : current.status;

      const { data, error } = await supabase
        .from("fds_operation_sessions")
        .update({
          sequential_states: updated,
          status: newStatus === "static_confirmed" ? "in_progress" : newStatus,
        })
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as OperationSession;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: fdsSessionsKey(data.spec_project_id) });
      queryClient.invalidateQueries({ queryKey: fdsSessionKey(data.id) });
    },
  });
}

/** Append a conversation turn */
export function useAppendConversationTurn() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      turn: FdsConversationTurn;
    }) => {
      const { data: current, error: fetchError } = await supabase
        .from("fds_operation_sessions")
        .select("conversation")
        .eq("id", input.id)
        .single();
      if (fetchError) throw fetchError;

      const conversation = [...((current.conversation as FdsConversationTurn[]) ?? []), input.turn];

      const { data, error } = await supabase
        .from("fds_operation_sessions")
        .update({ conversation })
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as OperationSession;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: fdsSessionKey(data.id) });
    },
  });
}

/** Delete a session entirely — triggers re-creation via useEnsureFdsSession on next load */
export function useDeleteFdsSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; spec_project_id: string }) => {
      const { error } = await supabase
        .from("fds_operation_sessions")
        .delete()
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: fdsSessionsKey(input.spec_project_id) });
    },
  });
}

/** Mark session as complete */
export function useCompleteFdsSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase
        .from("fds_operation_sessions")
        .update({ status: "complete" })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as OperationSession;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: fdsSessionsKey(data.spec_project_id) });
      queryClient.invalidateQueries({ queryKey: fdsSessionKey(data.id) });
    },
  });
}

/** Save validation results */
export function useSaveValidationResults() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; results: FdsValidationResult }) => {
      const { data, error } = await supabase
        .from("fds_operation_sessions")
        .update({ validation_results: input.results })
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as OperationSession;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: fdsSessionKey(data.id) });
    },
  });
}

/** Duplicate a session to target equipment_modules with tag remap */
export function useDuplicateFdsSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      source_id: string;
      spec_project_id: string;
      targets: Array<{
        unit_id: string;
        equipment_module_id: string;
        tag_remap: Record<string, string>;
      }>;
    }) => {
      // Fetch source session
      const { data: source, error: fetchError } = await supabase
        .from("fds_operation_sessions")
        .select("*")
        .eq("id", input.source_id)
        .single();
      if (fetchError) throw fetchError;

      const results: OperationSession[] = [];

      for (const target of input.targets) {
        // Apply remap to static states
        const remappedStatic: Record<string, ControlModuleStateEntry[]> = {};
        for (const [stateId, entries] of Object.entries(source.static_states as Record<string, ControlModuleStateEntry[]>)) {
          remappedStatic[stateId] = entries.map((e: ControlModuleStateEntry) => ({
            ...e,
            tag: target.tag_remap[e.tag] ?? e.tag,
          }));
        }

        // Apply remap to sequential states
        const remappedSequential: Record<string, SequentialStateV2> = {};
        for (const [stateId, data] of Object.entries(source.sequential_states as Record<string, SequentialStateV2>)) {
          remappedSequential[stateId] = {
            permissives: data.permissives.map((p) => ({ ...p, tag: applyRemap(p.tag, target.tag_remap) })),
            steps: data.steps.map((s) => ({
              ...s,
              action: applyRemap(s.action ?? "", target.tag_remap),
              completion_criteria_text: applyRemap(s.completion_criteria_text ?? "", target.tag_remap),
            })),
            notes: data.notes ? applyRemap(data.notes, target.tag_remap) : null,
          };
        }

        // Delete existing session for this target if any
        await supabase
          .from("fds_operation_sessions")
          .delete()
          .eq("spec_project_id", input.spec_project_id)
          .eq("unit_id", target.unit_id)
          .eq("equipment_module_id", target.equipment_module_id);

        const { data, error } = await supabase
          .from("fds_operation_sessions")
          .insert({
            spec_project_id: input.spec_project_id,
            unit_id: target.unit_id,
            equipment_module_id: target.equipment_module_id,
            status: "complete",
            static_states: remappedStatic,
            static_confirmed: true,
            sequential_states: remappedSequential,
            // Carry the source EM's authored state machine (hybrid model).
            // EM-local slugs are reused as-is; only tag references are remapped.
            em_states: source.em_states ?? [],
            em_transitions: source.em_transitions ?? [],
            conversation: [{
              role: "system",
              content: `Duplicated from equipment_module ${source.equipment_module_id} with tag remapping.`,
              timestamp: new Date().toISOString(),
            }],
            duplicated_from: input.source_id,
            tag_remap: target.tag_remap,
          })
          .select()
          .single();
        if (error) throw error;
        results.push(data as OperationSession);
      }

      return results;
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: fdsSessionsKey(input.spec_project_id) });
    },
  });
}

// ---------------------------------------------------------------------------
// Compose — merge equipment_module data into spec_sections
// ---------------------------------------------------------------------------

export function useComposeFds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      spec_project_id: string;
      unit: import("@/types/spec-builder").UnitConfig;
      sessions: OperationSession[];
    }) => {
      const { composeFdsToSections } = await import("@/lib/spec-builder/fds-compose");
      await composeFdsToSections(
        input.spec_project_id,
        input.unit,
        input.sessions,
      );
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: ["spec_sections", input.spec_project_id] });
    },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function applyRemap(text: string, remap: Record<string, string>): string {
  let result = text;
  const entries = Object.entries(remap).sort((a, b) => b[0].length - a[0].length);
  for (const [oldTag, newTag] of entries) {
    result = result.replaceAll(oldTag, newTag);
  }
  return result;
}
