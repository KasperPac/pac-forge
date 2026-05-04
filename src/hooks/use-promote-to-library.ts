/**
 * usePromoteToLibrary — mints an fb_templates row from a custom assembly's
 * authored interface contract + generated SCL blocks.
 *
 * Phase 5, Task 8.
 */
import { useMutation } from "@tanstack/react-query";
import { useCreateFbTemplate } from "@/hooks/use-fb-templates";
import type { FbInterfaceContract } from "@/types/fb-interface-contract";
import type { AssemblyGeneratedSclBlock } from "@/types/spec-builder";

export interface PromoteRequest {
  /** From AssemblyConfig.assembly_name */
  assemblyName: string;
  /** From FdsAssemblySession.process_intent */
  processIntent: string | null;
  /** From FdsAssemblySession.interface_contract */
  interfaceContract: FbInterfaceContract;
  /** From FdsAssemblySession.generated_scl_blocks */
  generatedSclBlocks: AssemblyGeneratedSclBlock[];
  /** User-entered template name */
  name: string;
  /** User-entered category (default "Assembly") */
  category: string;
  /** User-entered description */
  description: string;
  /** "project" = profile-scoped; "global" = no profile restriction */
  scope: "project" | "global";
  /** Design profile ID from SpecProject.design_profile_id — used when scope = "project" */
  projectProfileId?: string | null;
}

export function usePromoteToLibrary() {
  const createTemplate = useCreateFbTemplate();

  return useMutation({
    mutationFn: async (req: PromoteRequest) => {
      const profileIds =
        req.scope === "project" && req.projectProfileId
          ? [req.projectProfileId]
          : [];

      const blocks = req.generatedSclBlocks.map((b, i) => ({
        block_name: b.block_name,
        block_type: b.block_type,
        scl_code: b.scl_code,
        sort_order: b.sort_order ?? i,
        programming_language: "SCL" as const,
      }));

      return createTemplate.mutateAsync({
        name: req.name,
        device_category: req.category,
        plc_brand: "SIEMENS_TIA",
        description: req.description || null,
        tags: [],
        source: "custom",
        is_assembly: true,
        interface_contract: req.interfaceContract,
        blocks,
        profile_ids: profileIds,
      });
    },
  });
}
