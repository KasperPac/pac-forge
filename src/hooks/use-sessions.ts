import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Session } from "@/types";

const SESSIONS_KEY = ["sessions"] as const;

/**
 * Returns the most recent active session for the current user across all projects.
 */
export function useGlobalActiveSession() {
  return useQuery({
    queryKey: [...SESSIONS_KEY, "global-active"],
    queryFn: async (): Promise<Session | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("sessions")
        .select("*")
        .eq("user_id", user.id)
        .eq("status", "ACTIVE")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as Session) ?? null;
    },
  });
}

export function useActiveSession(projectId: string | undefined) {
  return useQuery({
    queryKey: [...SESSIONS_KEY, "active", projectId],
    queryFn: async (): Promise<Session | null> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("sessions")
        .select("*")
        .eq("project_id", projectId!)
        .eq("user_id", user.id)
        .eq("status", "ACTIVE")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data as Session) ?? null;
    },
    enabled: !!projectId,
  });
}

export function useCreateSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      agentIds,
    }: {
      projectId: string;
      agentIds: string[];
    }): Promise<Session> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create session
      const { data: session, error: sessionError } = await supabase
        .from("sessions")
        .insert({
          user_id: user.id,
          project_id: projectId,
          selected_agent_ids: agentIds,
          status: "ACTIVE",
        })
        .select()
        .single();
      if (sessionError) throw sessionError;

      // Reserve each agent
      const reservations = agentIds.map((agentId) => ({
        agent_id: agentId,
        session_id: session.id,
        user_id: user.id,
      }));

      const { error: reserveError } = await supabase
        .from("agent_reservations")
        .insert(reservations);

      if (reserveError) {
        // Rollback session on reservation failure
        await supabase.from("sessions").delete().eq("id", session.id);
        throw new Error(`Failed to reserve agents: ${reserveError.message}`);
      }

      // Update agent statuses to RESERVED
      const { error: statusError } = await supabase
        .from("agents")
        .update({ status: "RESERVED" })
        .in("id", agentIds);

      if (statusError) {
        console.error("Failed to update agent statuses:", statusError);
      }

      return session as Session;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}

export function useEndSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sessionId: string) => {
      // Get session to find reserved agents
      const { data: session, error: fetchError } = await supabase
        .from("sessions")
        .select("*")
        .eq("id", sessionId)
        .single();
      if (fetchError) throw fetchError;

      // Release all reservations
      const { error: releaseError } = await supabase
        .from("agent_reservations")
        .update({
          released_at: new Date().toISOString(),
          release_reason: "SESSION_END",
        })
        .eq("session_id", sessionId)
        .is("released_at", null);

      if (releaseError) throw releaseError;

      // Update agent statuses back to AVAILABLE
      if (session.selected_agent_ids?.length > 0) {
        await supabase
          .from("agents")
          .update({ status: "AVAILABLE" })
          .in("id", session.selected_agent_ids);
      }

      // Close session
      const { error: closeError } = await supabase
        .from("sessions")
        .update({ status: "CLOSED" })
        .eq("id", sessionId);
      if (closeError) throw closeError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SESSIONS_KEY });
      queryClient.invalidateQueries({ queryKey: ["agents"] });
    },
  });
}
