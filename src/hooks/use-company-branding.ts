import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { CompanyBranding, CompanyBrandingUpdate } from "@/types";

const COMPANY_BRANDING_KEY = ["company-branding"] as const;

export function useCompanyBranding() {
  return useQuery({
    queryKey: COMPANY_BRANDING_KEY,
    queryFn: async (): Promise<CompanyBranding> => {
      const { data, error } = await supabase
        .from("company_branding")
        .select("*")
        .eq("singleton", true)
        .single();
      if (error) throw error;
      return data as CompanyBranding;
    },
  });
}

export function useUpdateCompanyBranding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (updates: CompanyBrandingUpdate) => {
      const { data, error } = await supabase
        .from("company_branding")
        .update(updates)
        .eq("singleton", true)
        .select()
        .single();
      if (error) throw error;
      return data as CompanyBranding;
    },
    onSuccess: (data) => {
      queryClient.setQueryData(COMPANY_BRANDING_KEY, data);
    },
  });
}
