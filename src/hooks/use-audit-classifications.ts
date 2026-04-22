import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  AuditFbClassification,
  AuditFbClassificationInsert,
  FbRole,
  HierarchyAssignment,
} from "@/types/audit";

const KEY = ["audit_fb_classifications"] as const;

function projectKey(auditProjectId: string) {
  return [...KEY, auditProjectId] as const;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useAuditClassifications(auditProjectId: string | null | undefined) {
  return useQuery({
    queryKey: projectKey(auditProjectId ?? "none"),
    queryFn: async (): Promise<AuditFbClassification[]> => {
      const { data, error } = await supabase
        .from("audit_fb_classifications")
        .select("*")
        .eq("audit_project_id", auditProjectId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as AuditFbClassification[];
    },
    enabled: !!auditProjectId,
  });
}

export function useAuditClassificationByBlock(blockId: string | null | undefined) {
  return useQuery({
    queryKey: [...KEY, "block", blockId ?? "none"],
    queryFn: async (): Promise<AuditFbClassification | null> => {
      const { data, error } = await supabase
        .from("audit_fb_classifications")
        .select("*")
        .eq("block_id", blockId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as AuditFbClassification | null;
    },
    enabled: !!blockId,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Upsert a batch of deterministic classifications from the Classify rule pass.
 * `onConflict: 'block_id'` keeps the row stable across re-runs — engineer
 * overrides are preserved (this mutation only touches auto_* fields + role).
 */
export function useUpsertAuditClassifications() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      auditProjectId,
      rows,
    }: {
      auditProjectId: string;
      rows: AuditFbClassificationInsert[];
    }): Promise<number> => {
      if (rows.length === 0) return 0;
      const payload = rows.map((r) => ({ ...r, audit_project_id: auditProjectId }));
      const { error } = await supabase
        .from("audit_fb_classifications")
        .upsert(payload, { onConflict: "block_id" });
      if (error) throw error;
      return payload.length;
    },
    onSuccess: (_count, variables) => {
      void queryClient.invalidateQueries({ queryKey: projectKey(variables.auditProjectId) });
    },
  });
}

export function useUpdateAuditClassification() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<
        Pick<
          AuditFbClassification,
          | "role"
          | "engineer_confirmed"
          | "engineer_override_role"
          | "hierarchy_assignment"
        >
      >;
    }): Promise<AuditFbClassification> => {
      const { data, error } = await supabase
        .from("audit_fb_classifications")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as AuditFbClassification;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: projectKey(data.audit_project_id) });
    },
  });
}

/** Engineer-initiated override — sets role + override flag + confirmed. */
export function useOverrideClassificationRole() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      role,
      hierarchyAssignment,
    }: {
      id: string;
      role: FbRole;
      hierarchyAssignment?: HierarchyAssignment | null;
    }): Promise<AuditFbClassification> => {
      const { data, error } = await supabase
        .from("audit_fb_classifications")
        .update({
          engineer_override_role: role,
          engineer_confirmed: true,
          role,
          ...(hierarchyAssignment !== undefined
            ? { hierarchy_assignment: hierarchyAssignment }
            : {}),
        })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as AuditFbClassification;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: projectKey(data.audit_project_id) });
    },
  });
}

export function useDeleteAuditClassifications() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (auditProjectId: string) => {
      const { error } = await supabase
        .from("audit_fb_classifications")
        .delete()
        .eq("audit_project_id", auditProjectId);
      if (error) throw error;
    },
    onSuccess: (_data, auditProjectId) => {
      void queryClient.invalidateQueries({ queryKey: projectKey(auditProjectId) });
    },
  });
}
