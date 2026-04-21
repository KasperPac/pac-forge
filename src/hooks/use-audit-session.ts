import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { AuditProject, AuditProjectCreate } from "@/types/audit";

const KEY = ["audit_projects"] as const;

function projectKey(id: string) {
  return [...KEY, id] as const;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useAuditProject(projectId: string | null | undefined) {
  return useQuery({
    queryKey: projectKey(projectId ?? "none"),
    queryFn: async (): Promise<AuditProject | null> => {
      const { data, error } = await supabase
        .from("audit_projects")
        .select("*")
        .eq("id", projectId!)
        .maybeSingle();
      if (error) throw error;
      return data as AuditProject | null;
    },
    enabled: !!projectId,
  });
}

export function useAuditProjects() {
  return useQuery({
    queryKey: KEY,
    queryFn: async (): Promise<AuditProject[]> => {
      const { data, error } = await supabase
        .from("audit_projects")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AuditProject[];
    },
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateAuditProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: AuditProjectCreate): Promise<AuditProject> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("audit_projects")
        .insert({
          user_id: user.id,
          name: payload.name,
          description: payload.description ?? null,
          tia_project_path: payload.tia_project_path,
          audit_type: payload.audit_type,
          project_id: payload.project_id ?? null,
          design_profile_id: payload.design_profile_id ?? null,
          tia_version: payload.tia_version ?? null,
          cpu_order_number: payload.cpu_order_number ?? null,
          cpu_family: payload.cpu_family ?? null,
          current_step: "connect",
          step_statuses: {},
          extraction_status: "pending",
          extraction_stats: {},
          analysis_progress: {},
        })
        .select()
        .single();
      if (error) throw error;
      return data as AuditProject;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useUpdateAuditProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: string;
      updates: Partial<AuditProject>;
    }): Promise<AuditProject> => {
      const { data, error } = await supabase
        .from("audit_projects")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as AuditProject;
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: projectKey(variables.id) });
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
}

export function useDeleteAuditProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("audit_projects").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
}
