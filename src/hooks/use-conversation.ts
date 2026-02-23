import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ConversationTurn, SafetyWarning } from "@/types";

const CONVERSATION_KEY = ["conversation-turns"] as const;

export function useConversationHistory(sessionId: string | null) {
  return useQuery({
    queryKey: [...CONVERSATION_KEY, sessionId],
    queryFn: async (): Promise<ConversationTurn[]> => {
      const { data, error } = await supabase
        .from("conversation_turns")
        .select("*")
        .eq("session_id", sessionId!)
        .order("created_at", { ascending: true });
      if (error) throw error;

      // Map DB rows to typed objects (safety_warnings and artifacts_generated are JSONB)
      return (data ?? []).map((row) => ({
        id: row.id,
        session_id: row.session_id,
        role: row.role,
        agent_id: row.agent_id,
        content: row.content,
        artifacts_generated: (row.artifacts_generated as string[]) ?? [],
        safety_warnings: (row.safety_warnings as SafetyWarning[]) ?? [],
        created_at: row.created_at,
      }));
    },
    enabled: !!sessionId,
    refetchInterval: false,
  });
}

export function useSaveConversationTurn() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (turn: {
      session_id: string;
      role: "USER" | "AGENT";
      agent_id?: string | null;
      content: string;
      artifacts_generated?: string[];
      safety_warnings?: SafetyWarning[];
    }) => {
      const { data, error } = await supabase
        .from("conversation_turns")
        .insert({
          session_id: turn.session_id,
          role: turn.role,
          agent_id: turn.agent_id ?? null,
          content: turn.content,
          artifacts_generated: turn.artifacts_generated ?? [],
          safety_warnings: turn.safety_warnings ?? [],
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: [...CONVERSATION_KEY, variables.session_id],
      });
    },
  });
}
