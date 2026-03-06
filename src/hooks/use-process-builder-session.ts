import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ProcessBuilderSession } from "@/types";

const KEY = ["process-builder-session"] as const;

/** Fetch the process builder session by session_id. */
export function useProcessBuilderSession(sessionId: string | null) {
  return useQuery({
    queryKey: [...KEY, sessionId],
    queryFn: async (): Promise<ProcessBuilderSession | null> => {
      const { data, error } = await supabase
        .from("process_builder_sessions")
        .select("*")
        .eq("session_id", sessionId!)
        .maybeSingle();
      if (error) throw error;
      return data as ProcessBuilderSession | null;
    },
    enabled: !!sessionId,
  });
}

/** Create a new process builder session. */
export function useCreateProcessBuilderSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      sessionId: string;
      projectId: string;
    }): Promise<ProcessBuilderSession> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("process_builder_sessions")
        .insert({
          session_id: params.sessionId,
          project_id: params.projectId,
          user_id: user.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data as ProcessBuilderSession;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...KEY, variables.sessionId] });
    },
  });
}

/** Update an existing process builder session (partial JSON updates). */
export function useUpdateProcessBuilderSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      sessionId: string;
      updates: Partial<Pick<
        ProcessBuilderSession,
        | "current_stage"
        | "stage_statuses"
        | "qa_answers"
        | "io_recommendations"
        | "fb_recommendations"
        | "linkage_matrix"
        | "folder_structure"
        | "auto_gating"
        | "tia_project_path"
        | "pipeline_log"
      >>;
    }): Promise<ProcessBuilderSession> => {
      const { data, error } = await supabase
        .from("process_builder_sessions")
        .update(params.updates)
        .eq("session_id", params.sessionId)
        .select()
        .single();
      if (error) throw error;
      return data as ProcessBuilderSession;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: [...KEY, variables.sessionId] });
    },
  });
}
