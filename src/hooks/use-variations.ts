import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { nextVariationNumber } from "@/lib/quote-numbering";
import type {
  Variation,
  VariationUpdate,
} from "@/types";

const VARIATIONS_KEY = ["variations"] as const;

function variationsByProjectKey(projectId: string | undefined) {
  return [...VARIATIONS_KEY, projectId] as const;
}

function variationByIdKey(id: string | undefined) {
  return [...VARIATIONS_KEY, "by-id", id] as const;
}

export function useVariation(id: string | undefined) {
  return useQuery({
    queryKey: variationByIdKey(id),
    enabled: !!id,
    queryFn: async (): Promise<Variation> => {
      const { data, error } = await supabase
        .from("variations")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as Variation;
    },
  });
}

export function useVariationsForProject(projectId: string | undefined) {
  return useQuery({
    queryKey: variationsByProjectKey(projectId),
    enabled: !!projectId,
    queryFn: async (): Promise<Variation[]> => {
      const { data, error } = await supabase
        .from("variations")
        .select("*")
        .eq("project_id", projectId!)
        .order("variation_number");
      if (error) throw error;
      return data as Variation[];
    },
  });
}

export interface UseCreateVariationInput {
  project_id: string;
  summary?: string | null;
  clone_tnc_from_rev_id?: string;
}

export function useCreateVariation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: UseCreateVariationInput): Promise<Variation> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Determine next variation_number for this project.
      const { data: existing, error: lErr } = await supabase
        .from("variations")
        .select("*")
        .eq("project_id", input.project_id)
        .order("variation_number");
      if (lErr) throw lErr;
      const next = nextVariationNumber((existing as Variation[]) ?? []);

      const { data: varRow, error: vErr } = await supabase
        .from("variations")
        .insert({
          project_id: input.project_id,
          variation_number: next,
          status: "draft",
          summary: input.summary ?? null,
          created_by: user?.id ?? null,
        })
        .select()
        .single();
      if (vErr) throw vErr;
      const variation = varRow as Variation;

      const { error: ctErr } = await supabase
        .from("doc_commercial_terms")
        .insert({ parent_type: "variation", parent_id: variation.id });
      if (ctErr) throw ctErr;

      if (input.clone_tnc_from_rev_id) {
        const { data: src } = await supabase
          .from("doc_tnc_selections")
          .select("*")
          .eq("parent_type", "quote_revision")
          .eq("parent_id", input.clone_tnc_from_rev_id)
          .maybeSingle();
        if (src) {
          const { template_id, omitted_clause_ids, added_custom_clauses } =
            src as {
              template_id: string | null;
              omitted_clause_ids: string[];
              added_custom_clauses: unknown[];
            };
          await supabase.from("doc_tnc_selections").insert({
            parent_type: "variation",
            parent_id: variation.id,
            template_id,
            omitted_clause_ids,
            added_custom_clauses,
          });
        }
      }
      return variation;
    },
    onSuccess: (variation) => {
      qc.invalidateQueries({
        queryKey: variationsByProjectKey(variation.project_id),
      });
      qc.invalidateQueries({ queryKey: variationByIdKey(variation.id) });
    },
  });
}

export function useUpdateVariation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: VariationUpdate;
    }): Promise<Variation> => {
      const { data, error } = await supabase
        .from("variations")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Variation;
    },
    onSuccess: (variation) => {
      qc.invalidateQueries({ queryKey: variationByIdKey(variation.id) });
      qc.invalidateQueries({
        queryKey: variationsByProjectKey(variation.project_id),
      });
    },
  });
}

export function useDeleteVariation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<{ id: string; project_id: string }> => {
      const { data: existing, error: lErr } = await supabase
        .from("variations")
        .select("*")
        .eq("id", id)
        .single();
      if (lErr) throw lErr;
      const v = existing as Variation;
      if (v.status !== "draft") {
        throw new Error(
          `cannot delete variation in status=${v.status} (drafts only)`,
        );
      }
      const { error } = await supabase.from("variations").delete().eq("id", id);
      if (error) throw error;
      return { id, project_id: v.project_id };
    },
    onSuccess: ({ id, project_id }) => {
      qc.invalidateQueries({ queryKey: variationByIdKey(id) });
      qc.invalidateQueries({ queryKey: variationsByProjectKey(project_id) });
    },
  });
}
