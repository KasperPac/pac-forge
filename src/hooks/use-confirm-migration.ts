import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { writeSpecContract, type SpecContractPatch } from "@/lib/spec-builder/contract";
import { applyOverrideKind } from "@/lib/spec-builder/migrate/apply-override-kind";
import { applyStructuredInterlocks } from "@/lib/spec-builder/migrate/apply-structured-interlocks";
import type { SpecContractV2, OperatingStateV2 } from "@/types/spec-contract-v2";
import type { MigrationDraft } from "@/lib/spec-builder/migrate/types";

interface ConfirmArgs {
  contract: SpecContractV2;
  draft: MigrationDraft;
}

function assemblePatch(contract: SpecContractV2, draft: MigrationDraft): SpecContractPatch {
  const states: OperatingStateV2[] = (draft.states?.rows ?? []).map((row) => {
    if (typeof row.packml_id === "number") {
      return {
        state_id: row.packml_id,
        packml_id: row.packml_id,
        display_name: row.legacy_name,
        description: row.legacy_name,
        state_pattern: "sequential",
      };
    }
    return {
      state_id: row.custom_state_id!,
      custom_name: row.custom_name!,
      display_name: row.custom_name!,
      description: row.custom_name!,
      state_pattern: "static",
    };
  });

  return {
    modes: draft.modes?.rows ?? [],
    states,
    equipment_modules: applyOverrideKind(contract.equipment_modules),
    unit_procedures: applyStructuredInterlocks(
      contract.unit_procedures,
      draft.interlocks?.rows ?? [],
    ),
    confirmation_status: "confirmed",
  };
}

export function useConfirmMigration(specProjectId: string) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async ({ contract, draft }: ConfirmArgs) => {
      const patch = assemblePatch(contract, draft);
      await writeSpecContract(specProjectId, patch);

      // TODO(fds-engine phase 2.5): archive in-flight co-author conversations.
      // Spec §4.4 calls for this but the schema doesn't have a single conversation
      // table to update — conversations live across fds_operation_sessions,
      // fds_unit_procedures, fds_system_procedures as JSONB columns.
      // Resolve in a follow-up wave when a conversation schema decision lands.

      // Telemetry — single row.
      const interlockRows = draft.interlocks?.rows ?? [];
      const overrideCount = interlockRows.filter((r) => r.confidence < 0.6).length;
      await supabase.from("fds_migration_events").insert({
        spec_project_id: specProjectId,
        modes_count: patch.modes?.length ?? 0,
        custom_states_count: (patch.states ?? []).filter((s) => typeof s.state_id === "number" && s.state_id > 100).length,
        interlocks_classified_count: interlockRows.length,
        interlocks_overridden_count: overrideCount,
      });

      // Clear the draft only after both writes succeed.
      const { error } = await supabase
        .from("spec_projects")
        .update({ migration_draft: null })
        .eq("id", specProjectId);
      if (error) throw new Error(`useConfirmMigration.clearDraft: ${error.message}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["spec-contract", specProjectId] });
      queryClient.invalidateQueries({ queryKey: ["migration-draft", specProjectId] });
    },
  });

  return {
    confirm: mutation.mutateAsync,
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error,
  };
}
