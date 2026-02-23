import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { DesignProfile, DesignProfileCreate, DesignProfileUpdate } from "@/types";

const PROFILES_KEY = ["design-profiles"] as const;

export function useDesignProfiles() {
  return useQuery({
    queryKey: PROFILES_KEY,
    queryFn: async (): Promise<DesignProfile[]> => {
      const { data, error } = await supabase
        .from("design_profiles")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as DesignProfile[];
    },
  });
}

export function useDesignProfile(id: string | undefined) {
  return useQuery({
    queryKey: [...PROFILES_KEY, id],
    queryFn: async (): Promise<DesignProfile> => {
      const { data, error } = await supabase
        .from("design_profiles")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as DesignProfile;
    },
    enabled: !!id,
  });
}

export function useCreateDesignProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (profile: DesignProfileCreate) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("design_profiles")
        .insert({ ...profile, created_by: user.id })
        .select()
        .single();
      if (error) throw error;
      return data as DesignProfile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROFILES_KEY });
    },
  });
}

export function useUpdateDesignProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: DesignProfileUpdate }) => {
      const { data, error } = await supabase
        .from("design_profiles")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as DesignProfile;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROFILES_KEY });
    },
  });
}

export function useDeleteDesignProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("design_profiles")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROFILES_KEY });
    },
  });
}
