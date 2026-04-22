import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { AuditIoFbLink, WalkStatus } from "@/types/audit";

const KEY = ["audit_io_fb_links"] as const;

function projectKey(auditProjectId: string) {
  return [...KEY, auditProjectId] as const;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useAuditIoFbLinks(
  auditProjectId: string | null | undefined,
  options?: { walkStatus?: WalkStatus | WalkStatus[] },
) {
  return useQuery({
    queryKey: [...projectKey(auditProjectId ?? "none"), options?.walkStatus ?? "all"],
    queryFn: async (): Promise<AuditIoFbLink[]> => {
      let q = supabase
        .from("audit_io_fb_links")
        .select("*")
        .eq("audit_project_id", auditProjectId!)
        .order("io_address", { ascending: true });
      if (options?.walkStatus) {
        q = Array.isArray(options.walkStatus)
          ? q.in("walk_status", options.walkStatus)
          : q.eq("walk_status", options.walkStatus);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as AuditIoFbLink[];
    },
    enabled: !!auditProjectId,
  });
}

export function useAuditIoFbLinkByAddress(
  auditProjectId: string | null | undefined,
  ioAddress: string | null | undefined,
) {
  return useQuery({
    queryKey: [...projectKey(auditProjectId ?? "none"), "address", ioAddress ?? "none"],
    queryFn: async (): Promise<AuditIoFbLink | null> => {
      const { data, error } = await supabase
        .from("audit_io_fb_links")
        .select("*")
        .eq("audit_project_id", auditProjectId!)
        .eq("io_address", ioAddress!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as AuditIoFbLink | null;
    },
    enabled: !!auditProjectId && !!ioAddress,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/** Engineer confirms / edits a resolved walk. */
export function useUpdateAuditIoFbLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<
        Pick<
          AuditIoFbLink,
          | "engineer_verified"
          | "engineer_override_device_fb_block_id"
          | "physical_device_guess"
          | "physical_device_source"
          | "walk_notes"
        >
      >;
    }): Promise<AuditIoFbLink> => {
      const { data, error } = await supabase
        .from("audit_io_fb_links")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as AuditIoFbLink;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: projectKey(data.audit_project_id) });
    },
  });
}

/**
 * Clears all IO-FB links for a project. Called before Trace re-runs so the
 * walk can repopulate from scratch without leaving stale rows around.
 */
export function useDeleteAuditIoFbLinks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (auditProjectId: string) => {
      const { error } = await supabase
        .from("audit_io_fb_links")
        .delete()
        .eq("audit_project_id", auditProjectId);
      if (error) throw error;
    },
    onSuccess: (_data, auditProjectId) => {
      void queryClient.invalidateQueries({ queryKey: projectKey(auditProjectId) });
    },
  });
}
