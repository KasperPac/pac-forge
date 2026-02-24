import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Project, ProjectCreate, ProjectUpdate, RevisionLogEntry } from "@/types";

const PROJECTS_KEY = ["projects"] as const;

export function useProjects() {
  return useQuery({
    queryKey: PROJECTS_KEY,
    queryFn: async (): Promise<Project[]> => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as Project[];
    },
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: [...PROJECTS_KEY, id],
    queryFn: async (): Promise<Project> => {
      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .eq("id", id!)
        .single();
      if (error) throw error;
      return data as Project;
    },
    enabled: !!id,
  });
}

export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (project: ProjectCreate) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("projects")
        .insert({ ...project, created_by: user.id })
        .select()
        .single();
      if (error) throw error;
      return data as Project;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });
    },
  });
}

function describeChanges(updates: ProjectUpdate): string {
  const fields = Object.keys(updates).filter(
    (k) => k !== "revision_log"
  );
  if (fields.length === 0) return "Project updated";
  const labels: Record<string, string> = {
    client_name: "client name",
    project_number: "project number",
    plc_brand: "PLC brand",
    tia_version: "TIA version",
    cpu_type: "CPU type",
    safety_level: "safety level",
    safety_notes: "safety notes",
    io_lists: "IO list",
    tag_db_definitions: "tag DB definitions",
    uploaded_docs: "documents",
    design_profile_id: "design profile",
    functional_description: "functional description",
    functional_description_filename: "functional description file",
    rack_slot_layout: "rack/slot layout",
  };
  const named = fields.map((f) => labels[f] ?? f);
  return `Updated ${named.join(", ")}`;
}

export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: ProjectUpdate }) => {
      // Fetch current project to get existing revision_log
      const { data: current, error: fetchError } = await supabase
        .from("projects")
        .select("revision_log")
        .eq("id", id)
        .single();
      if (fetchError) throw fetchError;

      const { data: { user } } = await supabase.auth.getUser();

      const existingLog: RevisionLogEntry[] = (current?.revision_log as RevisionLogEntry[]) ?? [];
      const nextVersion = `v${existingLog.length + 1}`;
      const newEntry: RevisionLogEntry = {
        version: nextVersion,
        description: describeChanges(updates),
        author: user?.email ?? user?.id ?? "unknown",
        timestamp: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from("projects")
        .update({ ...updates, revision_log: [...existingLog, newEntry] })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Project;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });
      queryClient.setQueryData([...PROJECTS_KEY, data.id], data);
    },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("projects")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: PROJECTS_KEY });
    },
  });
}
