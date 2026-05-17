import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Project, Quote } from "@/types";

function invalidateLifecycleQueries(
  qc: ReturnType<typeof useQueryClient>,
  projectId?: string,
  quoteId?: string,
  revId?: string,
) {
  qc.invalidateQueries({ queryKey: ["projects"] });
  qc.invalidateQueries({ queryKey: ["quotes"] });
  qc.invalidateQueries({ queryKey: ["quote-revisions"] });
  if (projectId) qc.invalidateQueries({ queryKey: ["projects", projectId] });
  if (quoteId) qc.invalidateQueries({ queryKey: ["quotes", "by-id", quoteId] });
  if (revId)
    qc.invalidateQueries({ queryKey: ["quote-revisions", "by-id", revId] });
}

/**
 * Award a quote revision. Atomic on the server: flips quote.status to
 * 'awarded', sets project.stage='awarded' + project.awarded_quote_id, and
 * writes an issue_audit_log row. The revision itself stays 'issued'
 * (REV_STATUSES does not include 'awarded').
 */
export function useAwardQuoteRevision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (revId: string): Promise<Project> => {
      const { data, error } = await supabase.rpc("award_quote_revision", {
        _rev_id: revId,
      });
      if (error) throw error;
      return data as Project;
    },
    onSuccess: (project, revId) => {
      invalidateLifecycleQueries(qc, project.id, undefined, revId);
    },
  });
}

/**
 * Mark a revision as lost. Sets the parent quote.status='lost'; the
 * revision itself stays 'issued'. Writes an audit log row.
 */
export function useMarkRevisionLost() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (revId: string): Promise<Quote> => {
      const { data, error } = await supabase.rpc(
        "mark_quote_revision_lost",
        { _rev_id: revId },
      );
      if (error) throw error;
      return data as Quote;
    },
    onSuccess: (quote, revId) => {
      invalidateLifecycleQueries(qc, quote.project_id, quote.id, revId);
    },
  });
}
