import { useCallback, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { MigrationDraft } from "@/lib/spec-builder/migrate/types";

const DRAFT_DEBOUNCE_MS = 300;

async function fetchDraft(specProjectId: string): Promise<MigrationDraft | null> {
  const { data, error } = await supabase
    .from("spec_projects")
    .select("migration_draft")
    .eq("id", specProjectId)
    .single();
  if (error) throw new Error(`fetchDraft: ${error.message}`);
  return (data?.migration_draft as MigrationDraft | null) ?? null;
}

async function writeDraft(
  specProjectId: string,
  draft: MigrationDraft | null,
): Promise<void> {
  const { error } = await supabase
    .from("spec_projects")
    .update({ migration_draft: draft })
    .eq("id", specProjectId);
  if (error) throw new Error(`writeDraft: ${error.message}`);
}

export function useMigrationDraft(specProjectId: string) {
  const queryClient = useQueryClient();
  const queryKey = ["migration-draft", specProjectId];

  const query = useQuery({
    queryKey,
    queryFn: () => fetchDraft(specProjectId),
    enabled: !!specProjectId,
  });

  const writeMutation = useMutation({
    mutationFn: (draft: MigrationDraft | null) => writeDraft(specProjectId, draft),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  // Debounced merge of partial updates into the latest known draft.
  const pendingRef = useRef<MigrationDraft | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const next = pendingRef.current;
    if (next === null) return;
    pendingRef.current = null;
    writeMutation.mutate(next);
  }, [writeMutation]);

  const saveDraft = useCallback(
    (partial: Partial<MigrationDraft>) => {
      const current = pendingRef.current ?? query.data ?? {};
      pendingRef.current = { ...current, ...partial } as MigrationDraft;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, DRAFT_DEBOUNCE_MS);
    },
    [query.data, flush],
  );

  const clearDraft = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = null;
    await writeMutation.mutateAsync(null);
  }, [writeMutation]);

  // Flush on unmount so wizard nav doesn't lose the last edit.
  useEffect(() => () => flush(), [flush]);

  return {
    draft: query.data ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
    error: query.error,
    saveDraft,
    clearDraft,
  };
}
