import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { AuditLogEntry } from "@/types/tia";

/**
 * Fetch the current user's audit log entries.
 */
export function useUserAuditLog(limit = 50) {
  return useQuery({
    queryKey: ["user-audit-log", limit],
    queryFn: async (): Promise<AuditLogEntry[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("audit_logs")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as AuditLogEntry[];
    },
  });
}

export interface AgentChatEntry {
  id: string;
  user_id: string;
  agent_name: string;
  messages: Array<{ role: string; content: string; timestamp: string }>;
  created_at: string;
}

/**
 * Fetch the current user's saved agent chats.
 */
export function useUserAgentChats(limit = 20) {
  return useQuery({
    queryKey: ["user-agent-chats", limit],
    queryFn: async (): Promise<AgentChatEntry[]> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      const { data, error } = await supabase
        .from("agent_chats")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as AgentChatEntry[];
    },
  });
}
