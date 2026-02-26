import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ConflictDismissal } from "@/types";

const DISMISSALS_KEY = ["conflict-dismissals"] as const;

export function useConflictDismissals() {
  return useQuery({
    queryKey: [...DISMISSALS_KEY],
    queryFn: async (): Promise<ConflictDismissal[]> => {
      const { data, error } = await supabase
        .from("conflict_dismissals")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as ConflictDismissal[];
    },
  });
}

export function useCreateConflictDismissal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dismissal: {
      fingerprint: string;
      source_a_type: string;
      source_a_label: string;
      source_a_excerpt: string;
      source_b_type: string;
      source_b_label: string;
      source_b_excerpt: string;
      reason: string;
      knowledge_doc_id?: string | null;
    }) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data, error } = await supabase
        .from("conflict_dismissals")
        .upsert(
          { ...dismissal, created_by: user?.id ?? null },
          { onConflict: "fingerprint" },
        )
        .select()
        .single();
      if (error) throw error;
      return data as ConflictDismissal;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DISMISSALS_KEY });
    },
  });
}

export function useDeleteConflictDismissal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("conflict_dismissals")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DISMISSALS_KEY });
    },
  });
}
