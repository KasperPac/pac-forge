import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type {
  AuditReferenceDoc,
  AuditReferenceDocInsert,
  ReferenceDocPriors,
  ReferenceDocParseStatus,
} from "@/types/audit";

const KEY = ["audit_reference_docs"] as const;

function projectKey(auditProjectId: string) {
  return [...KEY, auditProjectId] as const;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useAuditReferenceDocs(auditProjectId: string | null | undefined) {
  return useQuery({
    queryKey: projectKey(auditProjectId ?? "none"),
    queryFn: async (): Promise<AuditReferenceDoc[]> => {
      const { data, error } = await supabase
        .from("audit_reference_docs")
        .select("*")
        .eq("audit_project_id", auditProjectId!)
        .order("uploaded_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AuditReferenceDoc[];
    },
    enabled: !!auditProjectId,
  });
}

export function useAuditReferenceDoc(docId: string | null | undefined) {
  return useQuery({
    queryKey: [...KEY, "doc", docId ?? "none"],
    queryFn: async (): Promise<AuditReferenceDoc | null> => {
      const { data, error } = await supabase
        .from("audit_reference_docs")
        .select("*")
        .eq("id", docId!)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as AuditReferenceDoc | null;
    },
    enabled: !!docId,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useCreateAuditReferenceDoc() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      payload: AuditReferenceDocInsert,
    ): Promise<AuditReferenceDoc> => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("audit_reference_docs")
        .insert({
          ...payload,
          parse_status: payload.parse_status ?? "pending",
          parsed_priors: payload.parsed_priors ?? {},
          uploaded_by: user.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data as AuditReferenceDoc;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: projectKey(data.audit_project_id) });
    },
  });
}

/**
 * Called after the client-side extractor finishes — updates raw_text + priors
 * in one shot and transitions parse_status. The initial insert commonly sits
 * in `pending` while mammoth/pdfjs run.
 */
export function useUpdateAuditReferenceDocParse() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      raw_text,
      parsed_priors,
      parse_status,
      parse_error,
    }: {
      id: string;
      raw_text?: string | null;
      parsed_priors?: ReferenceDocPriors;
      parse_status: ReferenceDocParseStatus;
      parse_error?: string | null;
    }): Promise<AuditReferenceDoc> => {
      const { data, error } = await supabase
        .from("audit_reference_docs")
        .update({
          ...(raw_text !== undefined ? { raw_text } : {}),
          ...(parsed_priors !== undefined ? { parsed_priors } : {}),
          parse_status,
          parse_error: parse_error ?? null,
        })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as AuditReferenceDoc;
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: projectKey(data.audit_project_id) });
    },
  });
}

export function useDeleteAuditReferenceDoc() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      auditProjectId,
    }: {
      id: string;
      auditProjectId: string;
    }) => {
      const { error } = await supabase.from("audit_reference_docs").delete().eq("id", id);
      if (error) throw error;
      return auditProjectId;
    },
    onSuccess: (auditProjectId) => {
      void queryClient.invalidateQueries({ queryKey: projectKey(auditProjectId) });
    },
  });
}
