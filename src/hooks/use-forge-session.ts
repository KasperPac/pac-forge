import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ForgeSession, ForgeSessionCreate, ForgeSessionUpdate } from "@/types/forge";

const KEY = ["forge_sessions"] as const;

function sessionKey(id: string) {
  return [...KEY, id] as const;
}

function projectSessionsKey(projectId: string) {
  return [...KEY, "project", projectId] as const;
}

/** Deserialise DB row — JSONB fields arrive as parsed JS objects already. */
function rowToSession(row: Record<string, unknown>): ForgeSession {
  return row as unknown as ForgeSession;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Fetch a single forge session by ID. */
export function useForgeSession(sessionId: string | undefined) {
  return useQuery({
    queryKey: sessionId ? sessionKey(sessionId) : KEY,
    queryFn: async (): Promise<ForgeSession | null> => {
      const { data, error } = await supabase
        .from("forge_sessions")
        .select("*")
        .eq("id", sessionId!)
        .maybeSingle();
      if (error) throw error;
      return data ? rowToSession(data) : null;
    },
    enabled: !!sessionId,
  });
}

/**
 * Fetch the most-recent active (non-completed) forge session for a project.
 * "Active" means current_step is not "tia_export" completed — we just return
 * the latest session and let the UI decide whether to resume or start fresh.
 */
export function useActiveForgeSession(projectId: string | undefined) {
  return useQuery({
    queryKey: projectId ? projectSessionsKey(projectId) : KEY,
    queryFn: async (): Promise<ForgeSession | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("forge_sessions")
        .select("*")
        .eq("project_id", projectId!)
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data ? rowToSession(data) : null;
    },
    enabled: !!projectId,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Create a new forge session for a project. */
export function useCreateForgeSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: ForgeSessionCreate): Promise<ForgeSession> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("forge_sessions")
        .insert({
          project_id: payload.project_id,
          user_id: user.id,
          design_profile_id: payload.design_profile_id ?? null,
          current_step: "spec_upload",
        })
        .select()
        .single();
      if (error) throw error;
      return rowToSession(data);
    },
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: KEY });
      queryClient.setQueryData(sessionKey(session.id), session);
      queryClient.invalidateQueries({ queryKey: projectSessionsKey(session.project_id) });
    },
  });
}

/** Update step data, step_statuses, or current_step on an existing session. */
export function useUpdateForgeSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: ForgeSessionUpdate;
    }): Promise<ForgeSession> => {
      const { data, error } = await supabase
        .from("forge_sessions")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return rowToSession(data);
    },
    onSuccess: (session) => {
      queryClient.setQueryData(sessionKey(session.id), session);
      queryClient.invalidateQueries({ queryKey: projectSessionsKey(session.project_id) });
    },
  });
}
