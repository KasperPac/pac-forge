/**
 * TanStack Query hooks for spec_projects and instrument_registers tables.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  SpecProject,
  SpecProjectCreate,
  SpecProjectUpdate,
  InstrumentRegister,
  SpecSection,
} from "@/types/spec-builder";

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

const SPEC_PROJECTS_KEY = ["spec_projects"] as const;
const specProjectsForProject = (projectId: string) =>
  ["spec_projects", "by_project", projectId] as const;
const specProjectKey = (id: string) => ["spec_projects", id] as const;
const instrumentRegisterKey = (specProjectId: string) =>
  ["instrument_registers", specProjectId] as const;
const specSectionsKey = (specProjectId: string) =>
  ["spec_sections", specProjectId] as const;

// ---------------------------------------------------------------------------
// Spec Projects
// ---------------------------------------------------------------------------

/** Fetch all specs for a given project */
export function useSpecProjectsForProject(projectId: string | undefined) {
  return useQuery({
    queryKey: specProjectsForProject(projectId ?? ""),
    queryFn: async () => {
      if (!projectId) return [];
      const { data, error } = await supabase
        .from("spec_projects")
        .select("*")
        .eq("project_id", projectId)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as SpecProject[];
    },
    enabled: !!projectId,
  });
}

export function useSpecProject(id: string | undefined) {
  return useQuery({
    queryKey: specProjectKey(id ?? ""),
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("spec_projects")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as SpecProject;
    },
    enabled: !!id,
  });
}

export function useCreateSpecProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: SpecProjectCreate) => {
      const { data, error } = await supabase
        .from("spec_projects")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as SpecProject;
    },
    onSuccess: (_, input) => {
      queryClient.invalidateQueries({ queryKey: SPEC_PROJECTS_KEY });
      queryClient.invalidateQueries({
        queryKey: specProjectsForProject(input.project_id),
      });
    },
  });
}

export function useUpdateSpecProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...update }: SpecProjectUpdate & { id: string }) => {
      const { data, error } = await supabase
        .from("spec_projects")
        .update(update)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as SpecProject;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: SPEC_PROJECTS_KEY });
      queryClient.invalidateQueries({ queryKey: specProjectKey(data.id) });
      if (data.project_id) {
        queryClient.invalidateQueries({
          queryKey: specProjectsForProject(data.project_id),
        });
      }
    },
  });
}

export function useDeleteSpecProject() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, projectId }: { id: string; projectId: string }) => {
      const { error } = await supabase
        .from("spec_projects")
        .delete()
        .eq("id", id);
      if (error) throw error;
      return projectId;
    },
    onSuccess: (projectId) => {
      queryClient.invalidateQueries({ queryKey: SPEC_PROJECTS_KEY });
      queryClient.invalidateQueries({
        queryKey: specProjectsForProject(projectId),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Instrument Registers
// ---------------------------------------------------------------------------

export function useInstrumentRegister(specProjectId: string | undefined) {
  return useQuery({
    queryKey: instrumentRegisterKey(specProjectId ?? ""),
    queryFn: async () => {
      if (!specProjectId) return null;
      const { data, error } = await supabase
        .from("instrument_registers")
        .select("*")
        .eq("spec_project_id", specProjectId)
        .order("parsed_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data as InstrumentRegister | null;
    },
    enabled: !!specProjectId,
  });
}

export function useSaveInstrumentRegister() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      spec_project_id: string;
      raw_filename: string;
      tags: unknown[];
      units: unknown[];
      parse_warnings: unknown[];
      haiku_usage: unknown;
    }) => {
      // Delete existing register for this project (replace on re-upload)
      await supabase
        .from("instrument_registers")
        .delete()
        .eq("spec_project_id", input.spec_project_id);

      const { data, error } = await supabase
        .from("instrument_registers")
        .insert(input)
        .select()
        .single();
      if (error) throw error;
      return data as InstrumentRegister;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: instrumentRegisterKey(data.spec_project_id),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Spec Sections
// ---------------------------------------------------------------------------

export function useSpecSections(specProjectId: string | undefined) {
  return useQuery({
    queryKey: specSectionsKey(specProjectId ?? ""),
    queryFn: async () => {
      if (!specProjectId) return [];
      const { data, error } = await supabase
        .from("spec_sections")
        .select("*")
        .eq("spec_project_id", specProjectId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as SpecSection[];
    },
    enabled: !!specProjectId,
  });
}

export function useUpdateSpecSection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      content_json,
      approved,
      review_notes,
    }: {
      id: string;
      content_json?: Record<string, unknown>;
      approved?: boolean;
      review_notes?: string | null;
    }) => {
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (content_json !== undefined) update.content_json = content_json;
      if (approved !== undefined) update.approved = approved;
      if (review_notes !== undefined) update.review_notes = review_notes;

      const { data, error } = await supabase
        .from("spec_sections")
        .update(update)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as SpecSection;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: specSectionsKey(data.spec_project_id),
      });
    },
  });
}

// ---------------------------------------------------------------------------
// Spec Exports
// ---------------------------------------------------------------------------

export function useSpecExports(specProjectId: string | undefined) {
  return useQuery({
    queryKey: ["spec_exports", specProjectId ?? ""],
    queryFn: async () => {
      if (!specProjectId) return [];
      const { data, error } = await supabase
        .from("spec_exports")
        .select("*")
        .eq("spec_project_id", specProjectId)
        .order("exported_at", { ascending: false });
      if (error) throw error;
      return data as Array<{
        id: string;
        spec_project_id: string;
        revision: string;
        exported_at: string;
        exported_by: string | null;
        storage_path: string | null;
        page_count: number | null;
        status: "pending" | "complete" | "failed";
      }>;
    },
    enabled: !!specProjectId,
  });
}
