import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { PromptSection } from "@/types";

const SECTIONS_KEY = ["prompt-sections"] as const;

/**
 * Fetches all active prompt sections as a lookup map.
 * Key format: "role:section_key" → content string.
 * Returns empty object if no custom sections exist (all defaults used).
 */
export function useActivePromptSections() {
  return useQuery({
    queryKey: [...SECTIONS_KEY, "active"],
    queryFn: async (): Promise<Record<string, string>> => {
      const { data, error } = await supabase
        .from("prompt_sections")
        .select("role, section_key, content")
        .eq("is_active", true);

      if (error) throw error;

      const map: Record<string, string> = {};
      for (const row of data ?? []) {
        map[`${row.role}:${row.section_key}`] = row.content;
      }
      return map;
    },
    staleTime: 5 * 60 * 1000, // 5 min — prompts don't change often
  });
}

/**
 * Fetches version history for a specific role + section_key.
 * Returns all versions (active and inactive), newest first.
 */
export function usePromptSectionHistory(role: string, sectionKey: string) {
  return useQuery({
    queryKey: [...SECTIONS_KEY, "history", role, sectionKey],
    queryFn: async (): Promise<PromptSection[]> => {
      const { data, error } = await supabase
        .from("prompt_sections")
        .select("*")
        .eq("role", role)
        .eq("section_key", sectionKey)
        .order("version", { ascending: false });

      if (error) throw error;
      return (data ?? []) as PromptSection[];
    },
    enabled: !!role && !!sectionKey,
  });
}

/**
 * Saves a new version of a prompt section.
 * Deactivates the current active version, then inserts the new one as active.
 */
export function useSavePromptSection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      role: string;
      sectionKey: string;
      content: string;
      notes?: string;
    }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get current max version for this role+section
      const { data: existing } = await supabase
        .from("prompt_sections")
        .select("version")
        .eq("role", input.role)
        .eq("section_key", input.sectionKey)
        .order("version", { ascending: false })
        .limit(1);

      const nextVersion = (existing?.[0]?.version ?? 0) + 1;

      // Deactivate current active version
      await supabase
        .from("prompt_sections")
        .update({ is_active: false })
        .eq("role", input.role)
        .eq("section_key", input.sectionKey)
        .eq("is_active", true);

      // Insert new active version
      const { data, error } = await supabase
        .from("prompt_sections")
        .insert({
          role: input.role,
          section_key: input.sectionKey,
          content: input.content,
          version: nextVersion,
          is_active: true,
          created_by: user.id,
          notes: input.notes ?? null,
        })
        .select()
        .single();

      if (error) throw error;
      return data as PromptSection;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SECTIONS_KEY });
    },
  });
}

/**
 * Activates a specific version (by id), deactivating the current active one.
 */
export function useActivatePromptVersion() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; role: string; sectionKey: string }) => {
      // Deactivate current active
      await supabase
        .from("prompt_sections")
        .update({ is_active: false })
        .eq("role", input.role)
        .eq("section_key", input.sectionKey)
        .eq("is_active", true);

      // Activate the target version
      const { error } = await supabase
        .from("prompt_sections")
        .update({ is_active: true })
        .eq("id", input.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SECTIONS_KEY });
    },
  });
}

/**
 * Resets a prompt section to its code default by deactivating all versions.
 */
export function useResetPromptSection() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { role: string; sectionKey: string }) => {
      const { error } = await supabase
        .from("prompt_sections")
        .update({ is_active: false })
        .eq("role", input.role)
        .eq("section_key", input.sectionKey)
        .eq("is_active", true);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: SECTIONS_KEY });
    },
  });
}
