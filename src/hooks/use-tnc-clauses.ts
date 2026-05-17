import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { TncClause, TncClauseCreate, TncClauseUpdate } from "@/types";

const TNC_CLAUSES_KEY = ["tnc-clauses"] as const;

export function useTncClauses(templateId: string | undefined) {
  return useQuery({
    queryKey: [...TNC_CLAUSES_KEY, templateId],
    enabled: !!templateId,
    queryFn: async (): Promise<TncClause[]> => {
      const { data, error } = await supabase
        .from("tnc_clauses")
        .select("*")
        .eq("template_id", templateId!)
        .order("ordering");
      if (error) throw error;
      return data as TncClause[];
    },
  });
}

export function useCreateTncClause() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TncClauseCreate) => {
      const { data, error } = await supabase
        .from("tnc_clauses")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as TncClause;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: [...TNC_CLAUSES_KEY, data.template_id],
      });
    },
  });
}

export function useUpdateTncClause() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: TncClauseUpdate;
    }) => {
      const { data, error } = await supabase
        .from("tnc_clauses")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as TncClause;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: [...TNC_CLAUSES_KEY, data.template_id],
      });
    },
  });
}

export function useDeleteTncClause() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      template_id,
    }: {
      id: string;
      template_id: string;
    }) => {
      const { error } = await supabase
        .from("tnc_clauses")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return template_id;
    },
    onSuccess: (template_id) => {
      queryClient.invalidateQueries({
        queryKey: [...TNC_CLAUSES_KEY, template_id],
      });
    },
  });
}

export function useReorderTncClauses() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      template_id,
      ordered,
    }: {
      template_id: string;
      ordered: { id: string; ordering: number }[];
    }): Promise<string> => {
      for (const { id, ordering } of ordered) {
        const { error } = await supabase
          .from("tnc_clauses")
          .update({ ordering })
          .eq("id", id);
        if (error) throw error;
      }
      return template_id;
    },
    onSuccess: (template_id) => {
      queryClient.invalidateQueries({
        queryKey: [...TNC_CLAUSES_KEY, template_id],
      });
    },
  });
}
