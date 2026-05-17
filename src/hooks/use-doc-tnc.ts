import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  DocTncOverride,
  DocTncOverrideUpsert,
  DocTncSelection,
  DocTncSelectionUpsert,
} from "@/types";
import type { ParentRef } from "@/hooks/use-doc-content";

function selKey(ref: ParentRef | undefined) {
  return ["doc-tnc-selection", ref?.parent_type, ref?.parent_id] as const;
}

function ovrKey(ref: ParentRef | undefined) {
  return ["doc-tnc-override", ref?.parent_type, ref?.parent_id] as const;
}

export function useTncSelection(ref: ParentRef | undefined) {
  return useQuery({
    queryKey: selKey(ref),
    enabled: !!ref,
    queryFn: async (): Promise<DocTncSelection | null> => {
      const { data, error } = await supabase
        .from("doc_tnc_selections")
        .select("*")
        .eq("parent_type", ref!.parent_type)
        .eq("parent_id", ref!.parent_id)
        .maybeSingle();
      if (error) throw error;
      return (data as DocTncSelection | null) ?? null;
    },
  });
}

export function useUpsertTncSelection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (row: DocTncSelectionUpsert): Promise<DocTncSelection> => {
      const { data, error } = await supabase
        .from("doc_tnc_selections")
        .upsert(row, { onConflict: "parent_type,parent_id" })
        .select()
        .single();
      if (error) throw error;
      return data as DocTncSelection;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: selKey({
          parent_type: vars.parent_type,
          parent_id: vars.parent_id,
        }),
      });
    },
  });
}

export function useTncOverride(ref: ParentRef | undefined) {
  return useQuery({
    queryKey: ovrKey(ref),
    enabled: !!ref,
    queryFn: async (): Promise<DocTncOverride | null> => {
      const { data, error } = await supabase
        .from("doc_tnc_override")
        .select("*")
        .eq("parent_type", ref!.parent_type)
        .eq("parent_id", ref!.parent_id)
        .maybeSingle();
      if (error) throw error;
      return (data as DocTncOverride | null) ?? null;
    },
  });
}

export function useUpsertTncOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (row: DocTncOverrideUpsert): Promise<DocTncOverride> => {
      const { data, error } = await supabase
        .from("doc_tnc_override")
        .upsert(row, { onConflict: "parent_type,parent_id" })
        .select()
        .single();
      if (error) throw error;
      return data as DocTncOverride;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: ovrKey({
          parent_type: vars.parent_type,
          parent_id: vars.parent_id,
        }),
      });
    },
  });
}

export function useClearTncOverride() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ref: ParentRef): Promise<ParentRef> => {
      const { error } = await supabase
        .from("doc_tnc_override")
        .delete()
        .eq("parent_type", ref.parent_type)
        .eq("parent_id", ref.parent_id);
      if (error) throw error;
      return ref;
    },
    onSuccess: (ref) => {
      queryClient.invalidateQueries({ queryKey: ovrKey(ref) });
    },
  });
}
