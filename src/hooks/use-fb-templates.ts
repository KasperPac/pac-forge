import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { FbTemplate, FbTemplateCreate, FbTemplateUpdate, FbDeviceCategory } from "@/types";

const FB_TEMPLATES_KEY = ["fb-templates"] as const;

export function useFbTemplates(category?: FbDeviceCategory) {
  return useQuery({
    queryKey: [...FB_TEMPLATES_KEY, category ?? "all"],
    queryFn: async (): Promise<FbTemplate[]> => {
      let query = supabase
        .from("fb_templates")
        .select("*")
        .order("device_category")
        .order("name");

      if (category) {
        query = query.eq("device_category", category);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as FbTemplate[];
    },
  });
}

export function useFbTemplate(id: string | undefined) {
  return useQuery({
    queryKey: [...FB_TEMPLATES_KEY, id],
    queryFn: async (): Promise<FbTemplate> => {
      const { data, error } = await supabase
        .from("fb_templates")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as FbTemplate;
    },
    enabled: !!id,
  });
}

export function useCreateFbTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (template: FbTemplateCreate) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("fb_templates")
        .insert({ ...template, created_by: user.id })
        .select()
        .single();
      if (error) throw error;
      return data as FbTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FB_TEMPLATES_KEY });
    },
  });
}

export function useUpdateFbTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: FbTemplateUpdate }) => {
      const { data, error } = await supabase
        .from("fb_templates")
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as FbTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FB_TEMPLATES_KEY });
    },
  });
}

export function useDeleteFbTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("fb_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FB_TEMPLATES_KEY });
    },
  });
}
