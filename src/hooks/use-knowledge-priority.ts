import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { KnowledgePriorityOverride, KnowledgeSource } from "@/lib/knowledge-priority";

const PRIORITY_KEY = ["knowledge-priority-overrides"] as const;

export function usePriorityOverrides() {
  return useQuery({
    queryKey: [...PRIORITY_KEY],
    queryFn: async (): Promise<KnowledgePriorityOverride[]> => {
      const { data, error } = await supabase
        .from("knowledge_priority_overrides")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as KnowledgePriorityOverride[];
    },
  });
}

export function useCreatePriorityOverride() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (override: {
      source_a: KnowledgeSource;
      source_b: KnowledgeSource;
      winner: KnowledgeSource;
      scope: string;
      reason?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("knowledge_priority_overrides")
        .upsert(
          {
            source_a: override.source_a,
            source_b: override.source_b,
            winner: override.winner,
            scope: override.scope,
            reason: override.reason ?? null,
            created_by: user?.id ?? null,
          },
          { onConflict: "source_a,source_b,scope" },
        )
        .select()
        .single();
      if (error) throw error;
      return data as KnowledgePriorityOverride;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRIORITY_KEY });
    },
  });
}

export function useDeletePriorityOverride() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("knowledge_priority_overrides")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PRIORITY_KEY });
    },
  });
}
