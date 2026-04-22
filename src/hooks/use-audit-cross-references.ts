import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { AuditCrossReference } from "@/types/audit";
import type { ExtractedCrossReference } from "@/lib/tia-bridge-contract";

const KEY = ["audit_cross_references"] as const;
const INSERT_CHUNK = 500;

function projectKey(auditProjectId: string) {
  return [...KEY, auditProjectId] as const;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useAuditCrossReferences(
  auditProjectId: string | null | undefined,
  options?: { limit?: number },
) {
  return useQuery({
    queryKey: [...projectKey(auditProjectId ?? "none"), options?.limit ?? "all"],
    queryFn: async (): Promise<AuditCrossReference[]> => {
      let q = supabase
        .from("audit_cross_references")
        .select("*")
        .eq("audit_project_id", auditProjectId!)
        .order("created_at", { ascending: true });
      if (options?.limit) q = q.limit(options.limit);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AuditCrossReference[];
    },
    enabled: !!auditProjectId,
  });
}

export function useAuditCrossReferenceCount(auditProjectId: string | null | undefined) {
  return useQuery({
    queryKey: [...projectKey(auditProjectId ?? "none"), "count"],
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase
        .from("audit_cross_references")
        .select("*", { count: "exact", head: true })
        .eq("audit_project_id", auditProjectId!);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!auditProjectId,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Batch-insert cross references from the bridge DTO. Typical project yields
 * 10k–50k rows; chunks of 500 keep payload size under PostgREST limits.
 * `blockIdMap` resolves bridge `source_path` / `target_path` strings to the
 * `audit_blocks.id` UUID persisted during block extraction; pass null for
 * sources/targets that can't be mapped (tag/address-only references).
 */
export function useInsertAuditCrossReferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      auditProjectId,
      rows,
      resolveSourceBlockId,
      resolveTargetBlockId,
    }: {
      auditProjectId: string;
      rows: ExtractedCrossReference[];
      resolveSourceBlockId: (row: ExtractedCrossReference) => string | null;
      resolveTargetBlockId: (row: ExtractedCrossReference) => string | null;
    }): Promise<number> => {
      const payload = rows
        .map((row) => {
          const source_block_id = resolveSourceBlockId(row);
          if (!source_block_id) return null;
          return {
            audit_project_id: auditProjectId,
            source_block_id,
            target_block_id: resolveTargetBlockId(row),
            access: row.access,
            reference_type: row.reference_type,
            source_name: row.source_name,
            source_path: row.source_path,
            source_address: row.source_address,
            source_type_name: row.source_type_name,
            source_device: row.source_device,
            target_name: row.target_name,
            target_path: row.target_path,
            target_address: row.target_address,
            target_type_name: row.target_type_name,
            target_device: row.target_device,
            reference_location: row.reference_location,
            referenced_as_name: row.referenced_as_name,
            location_address: row.location_address,
            location_name: row.location_name,
            location_type_name: row.location_type_name,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      let inserted = 0;
      for (let i = 0; i < payload.length; i += INSERT_CHUNK) {
        const chunk = payload.slice(i, i + INSERT_CHUNK);
        const { error } = await supabase.from("audit_cross_references").insert(chunk);
        if (error) throw error;
        inserted += chunk.length;
      }
      return inserted;
    },
    onSuccess: (_count, variables) => {
      void queryClient.invalidateQueries({ queryKey: projectKey(variables.auditProjectId) });
    },
  });
}

export function useDeleteAuditCrossReferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (auditProjectId: string) => {
      const { error } = await supabase
        .from("audit_cross_references")
        .delete()
        .eq("audit_project_id", auditProjectId);
      if (error) throw error;
    },
    onSuccess: (_data, auditProjectId) => {
      void queryClient.invalidateQueries({ queryKey: projectKey(auditProjectId) });
    },
  });
}
