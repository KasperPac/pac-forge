import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { PatternCandidate, PatternStatus } from "@/types";

const PATTERNS_KEY = ["pattern-candidates"] as const;

export function usePatternCandidates(status?: PatternStatus) {
  return useQuery({
    queryKey: [...PATTERNS_KEY, status ?? "all"],
    queryFn: async (): Promise<PatternCandidate[]> => {
      let query = supabase
        .from("pattern_candidates")
        .select("*")
        .order("created_at", { ascending: false });

      if (status) {
        query = query.eq("status", status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as PatternCandidate[];
    },
  });
}

export function useActivePatterns(plcBrand: string) {
  return useQuery({
    queryKey: [...PATTERNS_KEY, "active", plcBrand],
    queryFn: async (): Promise<PatternCandidate[]> => {
      const { data, error } = await supabase
        .from("pattern_candidates")
        .select("*")
        .eq("status", "APPROVED")
        .eq("plc_brand", plcBrand);
      if (error) throw error;
      return (data ?? []) as PatternCandidate[];
    },
    enabled: !!plcBrand,
  });
}

export function useCreatePatternCandidate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (candidate: {
      plc_brand: string;
      device_type: string;
      context: string;
      original_snippet: string;
      corrected_snippet: string;
      correction_type: string;
      explanation_tag: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("pattern_candidates")
        .insert({
          ...candidate,
          status: "PENDING",
          created_by: user?.id ?? "",
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PATTERNS_KEY });
    },
  });
}

/**
 * Query the count of PENDING patterns for notification badges.
 */
export function usePendingPatternCount() {
  return useQuery({
    queryKey: [...PATTERNS_KEY, "pending-count"],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("pattern_candidates")
        .select("*", { count: "exact", head: true })
        .eq("status", "PENDING");
      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useApprovePattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patternId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("pattern_candidates")
        .update({
          status: "APPROVED",
          reviewed_by: user?.id ?? "",
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", patternId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PATTERNS_KEY });
    },
  });
}

export function useRejectPattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patternId: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("pattern_candidates")
        .update({
          status: "REJECTED",
          reviewed_by: user?.id ?? "",
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", patternId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PATTERNS_KEY });
    },
  });
}

export function useDeletePattern() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (patternId: string) => {
      const { error } = await supabase
        .from("pattern_candidates")
        .delete()
        .eq("id", patternId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PATTERNS_KEY });
    },
  });
}
