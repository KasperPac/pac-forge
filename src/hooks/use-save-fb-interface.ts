// src/hooks/use-save-fb-interface.ts
// Dedicated raw-column save for a reviewed interface contract (mirrors how
// ai_summary is saved). NOT the version-snapshot path — contract history is YAGNI.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { FbInterfaceContract } from "@/types/fb-interface";

export function useSaveFbInterface() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ templateId, contract }: { templateId: string; contract: FbInterfaceContract }) => {
      const { error } = await supabase
        .from("fb_templates")
        .update({ interface_contract: { ...contract, reviewed: true } })
        .eq("id", templateId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fb-templates"] }),
  });
}
