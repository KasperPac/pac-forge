import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  VariationCitation,
  VariationCitationCreate,
} from "@/types";

const CITATIONS_KEY = ["variation-citations"] as const;

function citationsKey(variationId: string | undefined) {
  return [...CITATIONS_KEY, variationId] as const;
}

export function useCitationsForVariation(variationId: string | undefined) {
  return useQuery({
    queryKey: citationsKey(variationId),
    enabled: !!variationId,
    queryFn: async (): Promise<VariationCitation[]> => {
      const { data, error } = await supabase
        .from("variation_citations")
        .select("*")
        .eq("variation_id", variationId!)
        .order("created_at");
      if (error) throw error;
      return data as VariationCitation[];
    },
  });
}

export function useCreateCitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: VariationCitationCreate,
    ): Promise<VariationCitation> => {
      const { data, error } = await supabase
        .from("variation_citations")
        .insert(input)
        .select()
        .single();
      if (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new Error(
            "That row already has a citation. Delete it first if you want to cite a different source.",
          );
        }
        throw error;
      }
      return data as VariationCitation;
    },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: citationsKey(row.variation_id) });
    },
  });
}

export function useDeleteCitation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      variation_id,
    }: {
      id: string;
      variation_id: string;
    }) => {
      const { error } = await supabase
        .from("variation_citations")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return { id, variation_id };
    },
    onSuccess: ({ variation_id }) => {
      qc.invalidateQueries({ queryKey: citationsKey(variation_id) });
    },
  });
}
