import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { TncTemplate, TncTemplateCreate, TncTemplateUpdate } from "@/types";

const TNC_TEMPLATES_KEY = ["tnc-templates"] as const;

export function useTncTemplates() {
  return useQuery({
    queryKey: TNC_TEMPLATES_KEY,
    queryFn: async (): Promise<TncTemplate[]> => {
      const { data, error } = await supabase
        .from("tnc_templates")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as TncTemplate[];
    },
  });
}

export function useTncTemplate(id: string | undefined) {
  return useQuery({
    queryKey: [...TNC_TEMPLATES_KEY, id],
    enabled: !!id,
    queryFn: async (): Promise<TncTemplate> => {
      const { data, error } = await supabase
        .from("tnc_templates")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as TncTemplate;
    },
  });
}

export function useCreateTncTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: TncTemplateCreate) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("tnc_templates")
        .insert({ ...input, created_by: user?.id ?? null })
        .select()
        .single();
      if (error) throw error;
      return data as TncTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TNC_TEMPLATES_KEY });
    },
  });
}

export function useUpdateTncTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: TncTemplateUpdate;
    }) => {
      const { data, error } = await supabase
        .from("tnc_templates")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as TncTemplate;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: TNC_TEMPLATES_KEY });
      queryClient.setQueryData([...TNC_TEMPLATES_KEY, data.id], data);
    },
  });
}

export function useDeleteTncTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("tnc_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TNC_TEMPLATES_KEY });
    },
  });
}

export function useSetDefaultTncTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<TncTemplate> => {
      const { error: clearErr } = await supabase
        .from("tnc_templates")
        .update({ is_default: false })
        .eq("is_default", true);
      if (clearErr) throw clearErr;

      const { data, error } = await supabase
        .from("tnc_templates")
        .update({ is_default: true })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as TncTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TNC_TEMPLATES_KEY });
    },
  });
}
