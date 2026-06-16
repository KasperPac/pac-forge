/**
 * System-level orchestration hooks (Wave A).
 *
 * Thin TanStack Query wrappers over the `fds_system_procedures` table.
 * Writes go through a direct upsert here rather than `writeSpecContract`
 * so the builder can save mid-interview without touching the rest of the
 * contract. Wave C's UI owns the compose/save flow.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  SystemProcedureSchema,
  type SystemProcedure,
} from "@/types/spec-contract-v2";

export function useSystemProcedure(specProjectId: string | undefined) {
  return useQuery({
    queryKey: ["system_orchestration", specProjectId],
    queryFn: async (): Promise<SystemProcedure | null> => {
      if (!specProjectId) return null;
      const { data, error } = await supabase
        .from("fds_system_procedures")
        .select("*")
        .eq("spec_project_id", specProjectId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return SystemProcedureSchema.parse(data);
    },
    enabled: !!specProjectId,
  });
}

export interface UpsertSystemProcedureInput {
  spec_project_id: string;
  state_sequences?: unknown;
  conversation?: unknown[];
  validation_results?: unknown;
  token_usage?: unknown;
}

export function useUpsertSystemProcedure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpsertSystemProcedureInput) => {
      const { data, error } = await supabase
        .from("fds_system_procedures")
        .upsert(payload, { onConflict: "spec_project_id" })
        .select()
        .single();
      if (error) throw error;
      return data as { id: string; spec_project_id: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({
        queryKey: ["system_orchestration", data.spec_project_id],
      });
      qc.invalidateQueries({
        queryKey: ["spec_contract", data.spec_project_id],
      });
    },
  });
}
