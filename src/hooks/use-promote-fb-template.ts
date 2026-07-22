// src/hooks/use-promote-fb-template.ts
//
// G6-7 — persist a PromoteDerivation (see codegen/promote-template.ts) as a
// live FB Library template: fb_templates row carrying the auto-derived
// interface_contract, its blocks, and a v1 version snapshot. Enabled on
// creation so the G6 matcher/coverage gate can use it immediately.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { PromoteDerivation } from "@/lib/spec-builder/codegen/promote-template";
import type { FbTemplate } from "@/types/fb-template";

export function usePromoteFbTemplate() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ template, contract }: PromoteDerivation): Promise<FbTemplate> => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { blocks, ...templateData } = template;

      const { data: created, error: tErr } = await supabase
        .from("fb_templates")
        .insert({
          ...templateData,
          interface_contract: contract,
          is_enabled: true,
          version: 1,
          created_by: user.id,
        })
        .select()
        .single();
      if (tErr) throw tErr;

      const templateId = (created as FbTemplate).id;

      if (blocks.length > 0) {
        const { error: bErr } = await supabase.from("fb_template_blocks").insert(
          blocks.map((b) => ({
            template_id: templateId,
            block_name: b.block_name,
            block_type: b.block_type,
            scl_code: b.scl_code,
            sort_order: b.sort_order,
            programming_language: b.programming_language,
          })),
        );
        if (bErr) throw bErr;
      }

      const { error: vErr } = await supabase.from("fb_template_versions").insert({
        template_id: templateId,
        version: 1,
        blocks: JSON.parse(JSON.stringify(blocks)),
        description: templateData.description,
        tags: templateData.tags,
        notes: "Promoted from generated code",
      });
      if (vErr) throw vErr;

      return created as FbTemplate;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["fb-templates"] });
    },
  });
}
