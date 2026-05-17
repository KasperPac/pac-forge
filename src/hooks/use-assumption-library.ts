import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  AssumptionLibraryEntry,
  AssumptionLibraryEntryCreate,
  AssumptionLibraryEntryUpdate,
} from "@/types";

const ASSUMPTION_LIBRARY_KEY = ["assumption-library"] as const;

export function useAssumptionLibrary() {
  return useQuery({
    queryKey: ASSUMPTION_LIBRARY_KEY,
    queryFn: async (): Promise<AssumptionLibraryEntry[]> => {
      const { data, error } = await supabase
        .from("assumption_library")
        .select("*")
        .order("ordering");
      if (error) throw error;
      return data as AssumptionLibraryEntry[];
    },
  });
}

export function useCreateAssumptionLibraryEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: AssumptionLibraryEntryCreate) => {
      const { data, error } = await supabase
        .from("assumption_library")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as AssumptionLibraryEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ASSUMPTION_LIBRARY_KEY });
    },
  });
}

export function useUpdateAssumptionLibraryEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: AssumptionLibraryEntryUpdate;
    }) => {
      const { data, error } = await supabase
        .from("assumption_library")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as AssumptionLibraryEntry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ASSUMPTION_LIBRARY_KEY });
    },
  });
}

export function useDeleteAssumptionLibraryEntry() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("assumption_library")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ASSUMPTION_LIBRARY_KEY });
    },
  });
}
