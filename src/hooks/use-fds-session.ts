/**
 * TanStack Query hooks for FDS assembly sessions and subsystem orchestrations.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  FdsAssemblySession,
  SubsystemOrchestration,
  DeviceStateEntry,
  FdsConversationTurn,
  FdsValidationResult,
  FdsSessionStatus,
} from "@/types/spec-builder";
import type { SequentialStateV2 } from "@/types/spec-contract-v2";
import { ensureV2Record } from "@/lib/spec-builder/sequence-legacy-shim";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Run legacy v1→v2 SFC shim on a session's sequential_states at read time.
 *  Also backfills generated_scl_blocks for rows written before migration 076. */
function applyShim(session: FdsAssemblySession): FdsAssemblySession {
  const shimmed = session.sequential_states
    ? {
        ...session,
        sequential_states: ensureV2Record(
          session.sequential_states as Record<string, SequentialStateV2>,
        ),
      }
    : session;
  return {
    ...shimmed,
    generated_scl_blocks: Array.isArray(shimmed.generated_scl_blocks)
      ? shimmed.generated_scl_blocks
      : [],
  };
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

const fdsSessionsKey = (specProjectId: string) =>
  ["fds_assembly_sessions", specProjectId] as const;

const fdsSessionKey = (id: string) =>
  ["fds_assembly_sessions", "single", id] as const;

const fdsOrchestrationKey = (specProjectId: string, subsystemId: string) =>
  ["fds_subsystem_orchestrations", specProjectId, subsystemId] as const;

const fdsOrchestrationsKey = (specProjectId: string) =>
  ["fds_subsystem_orchestrations", specProjectId] as const;

// ---------------------------------------------------------------------------
// Assembly Sessions — Queries
// ---------------------------------------------------------------------------

/** Fetch all assembly sessions for a spec project */
export function useFdsSessionsForProject(specProjectId: string | undefined) {
  return useQuery({
    queryKey: fdsSessionsKey(specProjectId ?? ""),
    queryFn: async () => {
      if (!specProjectId) return [];
      const { data, error } = await supabase
        .from("fds_assembly_sessions")
        .select("*")
        .eq("spec_project_id", specProjectId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as FdsAssemblySession[]).map(applyShim);
    },
    enabled: !!specProjectId,
  });
}

/** Fetch sessions for a specific subsystem */
export function useFdsSessionsForSubsystem(specProjectId: string | undefined, subsystemId: string | undefined) {
  return useQuery({
    queryKey: [...fdsSessionsKey(specProjectId ?? ""), subsystemId],
    queryFn: async () => {
      if (!specProjectId || !subsystemId) return [];
      const { data, error } = await supabase
        .from("fds_assembly_sessions")
        .select("*")
        .eq("spec_project_id", specProjectId)
        .eq("subsystem_id", subsystemId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data as FdsAssemblySession[]).map(applyShim);
    },
    enabled: !!specProjectId && !!subsystemId,
  });
}

/** Fetch a single session */
export function useFdsSession(id: string | undefined) {
  return useQuery({
    queryKey: fdsSessionKey(id ?? ""),
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("fds_assembly_sessions")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return applyShim(data as FdsAssemblySession);
    },
    enabled: !!id,
  });
}

// ---------------------------------------------------------------------------
// Assembly Sessions — Mutations
// ---------------------------------------------------------------------------

/** Create or get an existing session for an assembly */
export function useEnsureFdsSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      spec_project_id: string;
      subsystem_id: string;
      assembly_id: string;
    }) => {
      // Check if session already exists
      const { data: existing } = await supabase
        .from("fds_assembly_sessions")
        .select("*")
        .eq("spec_project_id", input.spec_project_id)
        .eq("subsystem_id", input.subsystem_id)
        .eq("assembly_id", input.assembly_id)
        .maybeSingle();

      if (existing) return existing as FdsAssemblySession;

      const { data, error } = await supabase
        .from("fds_assembly_sessions")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as FdsAssemblySession;
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
      static_states: Record<string, DeviceStateEntry[]>;
    }) => {
      const { data, error } = await supabase
        .from("fds_assembly_sessions")
        .update({
          static_states: input.static_states,
          static_confirmed: true,
          status: "static_confirmed",
        })
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as FdsAssemblySession;
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
        .from("fds_assembly_sessions")
        .select("sequential_states, status")
        .eq("id", input.id)
        .single();
      if (fetchError) throw fetchError;

      const existing = (current.sequential_states as Record<string, SequentialStateV2>) ?? {};
      const updated = { ...existing, [input.state_id]: input.data };

      const newStatus: FdsSessionStatus = current.status === "not_started" ? "in_progress" : current.status;

      const { data, error } = await supabase
        .from("fds_assembly_sessions")
        .update({
          sequential_states: updated,
          status: newStatus === "static_confirmed" ? "in_progress" : newStatus,
        })
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as FdsAssemblySession;
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
        .from("fds_assembly_sessions")
        .select("conversation")
        .eq("id", input.id)
        .single();
      if (fetchError) throw fetchError;

      const conversation = [...((current.conversation as FdsConversationTurn[]) ?? []), input.turn];

      const { data, error } = await supabase
        .from("fds_assembly_sessions")
        .update({ conversation })
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as FdsAssemblySession;
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
        .from("fds_assembly_sessions")
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
        .from("fds_assembly_sessions")
        .update({ status: "complete" })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as FdsAssemblySession;
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
        .from("fds_assembly_sessions")
        .update({ validation_results: input.results })
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as FdsAssemblySession;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: fdsSessionKey(data.id) });
    },
  });
}

/** Duplicate a session to target assemblies with tag remap */
export function useDuplicateFdsSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      source_id: string;
      spec_project_id: string;
      targets: Array<{
        subsystem_id: string;
        assembly_id: string;
        tag_remap: Record<string, string>;
      }>;
    }) => {
      // Fetch source session
      const { data: source, error: fetchError } = await supabase
        .from("fds_assembly_sessions")
        .select("*")
        .eq("id", input.source_id)
        .single();
      if (fetchError) throw fetchError;

      const results: FdsAssemblySession[] = [];

      for (const target of input.targets) {
        // Apply remap to static states
        const remappedStatic: Record<string, DeviceStateEntry[]> = {};
        for (const [stateId, entries] of Object.entries(source.static_states as Record<string, DeviceStateEntry[]>)) {
          remappedStatic[stateId] = entries.map((e: DeviceStateEntry) => ({
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
          .from("fds_assembly_sessions")
          .delete()
          .eq("spec_project_id", input.spec_project_id)
          .eq("subsystem_id", target.subsystem_id)
          .eq("assembly_id", target.assembly_id);

        const { data, error } = await supabase
          .from("fds_assembly_sessions")
          .insert({
            spec_project_id: input.spec_project_id,
            subsystem_id: target.subsystem_id,
            assembly_id: target.assembly_id,
            status: "complete",
            static_states: remappedStatic,
            static_confirmed: true,
            sequential_states: remappedSequential,
            conversation: [{
              role: "system",
              content: `Duplicated from assembly ${source.assembly_id} with tag remapping.`,
              timestamp: new Date().toISOString(),
            }],
            duplicated_from: input.source_id,
            tag_remap: target.tag_remap,
          })
          .select()
          .single();
        if (error) throw error;
        results.push(data as FdsAssemblySession);
      }

      return results;
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: fdsSessionsKey(input.spec_project_id) });
    },
  });
}

// ---------------------------------------------------------------------------
// Subsystem Orchestrations
// ---------------------------------------------------------------------------

export function useFdsOrchestration(specProjectId: string | undefined, subsystemId: string | undefined) {
  return useQuery({
    queryKey: fdsOrchestrationKey(specProjectId ?? "", subsystemId ?? ""),
    queryFn: async () => {
      if (!specProjectId || !subsystemId) return null;
      const { data, error } = await supabase
        .from("fds_subsystem_orchestrations")
        .select("*")
        .eq("spec_project_id", specProjectId)
        .eq("subsystem_id", subsystemId)
        .maybeSingle();
      if (error) throw error;
      return data as SubsystemOrchestration | null;
    },
    enabled: !!specProjectId && !!subsystemId,
  });
}

export function useFdsOrchestrationsForProject(specProjectId: string | undefined) {
  return useQuery({
    queryKey: fdsOrchestrationsKey(specProjectId ?? ""),
    queryFn: async () => {
      if (!specProjectId) return [];
      const { data, error } = await supabase
        .from("fds_subsystem_orchestrations")
        .select("*")
        .eq("spec_project_id", specProjectId);
      if (error) throw error;
      return data as SubsystemOrchestration[];
    },
    enabled: !!specProjectId,
  });
}

export function useUpsertFdsOrchestration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      spec_project_id: string;
      subsystem_id: string;
      state_sequences: SubsystemOrchestration["state_sequences"];
      conversation?: FdsConversationTurn[];
    }) => {
      const { data, error } = await supabase
        .from("fds_subsystem_orchestrations")
        .upsert({
          spec_project_id: input.spec_project_id,
          subsystem_id: input.subsystem_id,
          state_sequences: input.state_sequences,
          conversation: input.conversation ?? [],
        }, { onConflict: "spec_project_id,subsystem_id" })
        .select()
        .single();
      if (error) throw error;
      return data as SubsystemOrchestration;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: fdsOrchestrationKey(data.spec_project_id, data.subsystem_id),
      });
      queryClient.invalidateQueries({
        queryKey: fdsOrchestrationsKey(data.spec_project_id),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Compose — merge assembly data into spec_sections
// ---------------------------------------------------------------------------

export function useComposeFds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      spec_project_id: string;
      subsystem: import("@/types/spec-builder").SubsystemConfig;
      sessions: FdsAssemblySession[];
      orchestration: import("@/types/spec-builder").SubsystemOrchestration | null;
      allStates: import("@/types/spec-builder").OperatingState[];
    }) => {
      const { composeFdsToSections } = await import("@/lib/spec-builder/fds-compose");
      await composeFdsToSections(
        input.spec_project_id,
        input.subsystem,
        input.sessions,
        input.orchestration,
        input.allStates,
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
