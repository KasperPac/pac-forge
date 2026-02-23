import { useQuery } from "@tanstack/react-query";
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
