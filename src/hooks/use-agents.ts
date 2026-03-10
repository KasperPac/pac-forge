import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Agent } from "@/types";

const AGENTS_KEY = ["agents"] as const;

export function useAgents() {
  return useQuery({
    queryKey: AGENTS_KEY,
    queryFn: async (): Promise<Agent[]> => {
      const { data, error } = await supabase
        .from("agents")
        .select("*")
        .order("display_name");
      if (error) throw error;
      return data as Agent[];
    },
  });
}

export function useToggleAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const updates: { is_enabled: boolean; status?: string } = { is_enabled: enabled };
      if (!enabled) updates.status = "DISABLED";
      else updates.status = "AVAILABLE";
      const { error } = await supabase
        .from("agents")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AGENTS_KEY });
    },
  });
}

export function useAvailableAgents() {
  return useQuery({
    queryKey: [...AGENTS_KEY, "available"],
    queryFn: async (): Promise<Agent[]> => {
      const { data, error } = await supabase
        .from("agents")
        .select("*")
        .eq("is_enabled", true)
        .eq("status", "AVAILABLE")
        .order("display_name");
      if (error) throw error;
      return data as Agent[];
    },
  });
}
