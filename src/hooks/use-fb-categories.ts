import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { FbDeviceCategory } from "@/types";

const FB_CATEGORIES_KEY = ["fb-device-categories"] as const;

export function useFbDeviceCategories() {
  return useQuery({
    queryKey: FB_CATEGORIES_KEY,
    queryFn: async (): Promise<FbDeviceCategory[]> => {
      const { data, error } = await supabase
        .from("fb_device_categories")
        .select("*")
        .order("sort_order");
      if (error) throw error;
      return data as FbDeviceCategory[];
    },
  });
}

export function useCreateFbDeviceCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { name: string; display_name: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get max sort_order to append at end
      const { data: existing } = await supabase
        .from("fb_device_categories")
        .select("sort_order")
        .order("sort_order", { ascending: false })
        .limit(1);

      const nextOrder = (existing?.[0]?.sort_order ?? 0) + 1;

      const { data, error } = await supabase
        .from("fb_device_categories")
        .insert({
          name: input.name,
          display_name: input.display_name,
          sort_order: nextOrder,
          created_by: user.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data as FbDeviceCategory;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FB_CATEGORIES_KEY });
    },
  });
}

export function useDeleteFbDeviceCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      // Check if any templates use this category
      const { data: cats } = await supabase
        .from("fb_device_categories")
        .select("name")
        .eq("id", id)
        .single();

      if (cats) {
        const { count } = await supabase
          .from("fb_templates")
          .select("id", { count: "exact", head: true })
          .eq("device_category", cats.name);

        if (count && count > 0) {
          throw new Error(`Cannot delete category: ${count} template(s) still use it`);
        }
      }

      const { error } = await supabase
        .from("fb_device_categories")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: FB_CATEGORIES_KEY });
    },
  });
}
