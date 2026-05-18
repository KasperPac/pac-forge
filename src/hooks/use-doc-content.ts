import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  ParentType,
  DocScopeItem,
  DocInclusion,
  DocExclusion,
  DocAssumption,
  DocLineItem,
  DocCommercialTerms,
  CitationTargetSection,
} from "@/types";

export type ParentRef = { parent_type: ParentType; parent_id: string };

function contentKey(
  table: string,
  ref: ParentRef | undefined | { parent_type?: ParentType; parent_id?: string }
) {
  return ["doc-content", table, ref?.parent_type, ref?.parent_id] as const;
}

function makeListCrud<T extends { id: string }>(
  table: string,
  targetSection?: CitationTargetSection
) {
  return {
    useList(ref: ParentRef | undefined) {
      return useQuery({
        queryKey: contentKey(table, ref),
        enabled: !!ref,
        queryFn: async (): Promise<T[]> => {
          const { data, error } = await supabase
            .from(table)
            .select("*")
            .eq("parent_type", ref!.parent_type)
            .eq("parent_id", ref!.parent_id)
            .order("ordering");
          if (error) throw error;
          return data as T[];
        },
      });
    },

    useCreate() {
      const queryClient = useQueryClient();
      return useMutation({
        mutationFn: async (row: Partial<T> & ParentRef): Promise<T> => {
          const { data, error } = await supabase
            .from(table)
            .insert(row)
            .select()
            .single();
          if (error) throw error;
          return data as T;
        },
        onSuccess: (_data, vars) => {
          queryClient.invalidateQueries({ queryKey: contentKey(table, vars) });
        },
      });
    },

    useUpdate() {
      const queryClient = useQueryClient();
      return useMutation({
        mutationFn: async ({
          id,
          updates,
          ref,
        }: {
          id: string;
          updates: Partial<T>;
          ref: ParentRef;
        }) => {
          const { data, error } = await supabase
            .from(table)
            .update(updates)
            .eq("id", id)
            .select()
            .single();
          if (error) throw error;
          return { row: data as T, ref };
        },
        onSuccess: ({ ref }) => {
          queryClient.invalidateQueries({ queryKey: contentKey(table, ref) });
        },
      });
    },

    useDelete() {
      const queryClient = useQueryClient();
      return useMutation({
        mutationFn: async ({ id, ref }: { id: string; ref: ParentRef }) => {
          if (ref.parent_type === "variation" && targetSection !== undefined) {
            const { error: citationError } = await supabase
              .from("variation_citations")
              .delete()
              .eq("variation_id", ref.parent_id)
              .eq("target_section", targetSection)
              .eq("target_doc_id", id);
            if (citationError) throw citationError;
          }
          const { error } = await supabase.from(table).delete().eq("id", id);
          if (error) throw error;
          return ref;
        },
        onSuccess: (ref) => {
          queryClient.invalidateQueries({ queryKey: contentKey(table, ref) });
          if (ref.parent_type === "variation") {
            queryClient.invalidateQueries({
              queryKey: ["variation-citations", ref.parent_id],
            });
          }
        },
      });
    },
  };
}

export const scopeItems = makeListCrud<DocScopeItem>("doc_scope_items", "scope");
export const inclusions = makeListCrud<DocInclusion>("doc_inclusions", "inclusion");
export const exclusions = makeListCrud<DocExclusion>("doc_exclusions", "exclusion");
export const assumptions = makeListCrud<DocAssumption>("doc_assumptions", "assumption");
export const lineItems = makeListCrud<DocLineItem>("doc_line_items", "line_item");

export function useCommercialTerms(ref: ParentRef | undefined) {
  return useQuery({
    queryKey: contentKey("doc_commercial_terms", ref),
    enabled: !!ref,
    queryFn: async (): Promise<DocCommercialTerms | null> => {
      const { data, error } = await supabase
        .from("doc_commercial_terms")
        .select("*")
        .eq("parent_type", ref!.parent_type)
        .eq("parent_id", ref!.parent_id)
        .maybeSingle();
      if (error) throw error;
      return (data as DocCommercialTerms | null) ?? null;
    },
  });
}

export function useUpsertCommercialTerms() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      row: Partial<DocCommercialTerms> & ParentRef
    ): Promise<DocCommercialTerms> => {
      const { data, error } = await supabase
        .from("doc_commercial_terms")
        .upsert(row, { onConflict: "parent_type,parent_id" })
        .select()
        .single();
      if (error) throw error;
      return data as DocCommercialTerms;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: contentKey("doc_commercial_terms", vars),
      });
    },
  });
}
