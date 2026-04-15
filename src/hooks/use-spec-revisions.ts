/**
 * TanStack Query hooks for spec_project_revisions + the SQL RPCs introduced
 * in migration 066. All mutations invalidate both the revisions list and the
 * derived spec-contract cache for the project.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// ---------------------------------------------------------------------------
// Types (narrow — the builder consumes these shapes directly)
// ---------------------------------------------------------------------------

export type SpecRevisionStatus = "draft" | "submitted" | "approved" | "revised";
export type SpecRevisionSource = "authored" | "markup" | "foreign_ingest";

export interface SpecRevision {
  id: string;
  spec_project_id: string;
  revision_number: number;
  display_label: string;
  status: SpecRevisionStatus;
  source: SpecRevisionSource;
  parent_revision_id: string | null;
  snapshot_json: Record<string, unknown> | null;
  snapshot_storage_path: string | null;
  docx_storage_path: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by: string | null;
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

const revisionsKey = (specProjectId: string) =>
  ["spec_revisions", specProjectId] as const;

function invalidate(qc: ReturnType<typeof useQueryClient>, specProjectId: string) {
  qc.invalidateQueries({ queryKey: revisionsKey(specProjectId) });
  qc.invalidateQueries({ queryKey: ["spec_contract", specProjectId] });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useRevisions(specProjectId: string | undefined) {
  return useQuery({
    queryKey: revisionsKey(specProjectId ?? ""),
    queryFn: async (): Promise<SpecRevision[]> => {
      if (!specProjectId) return [];
      const { data, error } = await supabase
        .from("spec_project_revisions")
        .select("*")
        .eq("spec_project_id", specProjectId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as SpecRevision[];
    },
    enabled: !!specProjectId,
  });
}

// ---------------------------------------------------------------------------
// Mutations (RPC wrappers)
// ---------------------------------------------------------------------------

export function useCreateDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (specProjectId: string): Promise<SpecRevision> => {
      const { data, error } = await supabase.rpc("create_draft_from_current", {
        p_spec_project_id: specProjectId,
      });
      if (error) throw error;
      return data as SpecRevision;
    },
    onSuccess: (row) => invalidate(qc, row.spec_project_id),
  });
}

export function useSubmitDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      revisionId,
      notes,
    }: {
      revisionId: string;
      notes?: string | null;
    }): Promise<SpecRevision> => {
      const { data, error } = await supabase.rpc("submit_draft", {
        p_revision_id: revisionId,
        p_notes: notes ?? null,
      });
      if (error) throw error;
      return data as SpecRevision;
    },
    onSuccess: (row) => invalidate(qc, row.spec_project_id),
  });
}

export function useApproveRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (revisionId: string): Promise<SpecRevision> => {
      const { data, error } = await supabase.rpc("approve_revision", {
        p_revision_id: revisionId,
      });
      if (error) throw error;
      return data as SpecRevision;
    },
    onSuccess: (row) => invalidate(qc, row.spec_project_id),
  });
}

export function useRejectRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      revisionId,
      notes,
    }: {
      revisionId: string;
      notes: string;
    }): Promise<SpecRevision> => {
      const { data, error } = await supabase.rpc("reject_revision", {
        p_revision_id: revisionId,
        p_notes: notes,
      });
      if (error) throw error;
      return data as SpecRevision;
    },
    onSuccess: (row) => invalidate(qc, row.spec_project_id),
  });
}

export function useRevertRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (targetRevisionId: string): Promise<SpecRevision> => {
      const { data, error } = await supabase.rpc("revert_to_revision", {
        p_target_revision_id: targetRevisionId,
      });
      if (error) throw error;
      return data as SpecRevision;
    },
    onSuccess: (row) => invalidate(qc, row.spec_project_id),
  });
}

export function useCreateDraftFromIngest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      specProjectId,
      tree,
      source,
      parentRevisionId,
    }: {
      specProjectId: string;
      tree: Record<string, unknown>;
      source: "markup" | "foreign_ingest";
      parentRevisionId?: string | null;
    }): Promise<SpecRevision> => {
      const { data, error } = await supabase.rpc("create_draft_from_ingest", {
        p_spec_project_id: specProjectId,
        p_ingest_tree: tree,
        p_source: source,
        p_parent_revision_id: parentRevisionId ?? null,
      });
      if (error) throw error;
      return data as SpecRevision;
    },
    onSuccess: (row) => invalidate(qc, row.spec_project_id),
  });
}
