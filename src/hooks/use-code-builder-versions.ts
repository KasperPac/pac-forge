import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { codeBuilderKey } from "@/hooks/use-code-builder";
import type { CodegenLayer } from "@/lib/spec-builder/codegen";
import type { CodeBuilderVersionRow } from "@/types/code-builder";

const VERSIONS_TABLE = "code_builder_versions";

export type VersionArtifact = { artifact_name: string; content: string };

export const codeBuilderVersionsKey = (
  specId?: string, revision?: number, ownerId?: string, layer?: CodegenLayer,
) => ["code_builder_versions", specId ?? "", revision ?? -1, ownerId ?? "", layer ?? ""] as const;

/**
 * Per-EM (owner_id + layer) version log. Snapshots are append-only; restore
 * writes the chosen snapshot back onto the working artifacts as edits and never
 * deletes history.
 */
export function useCodeBuilderVersions(
  specId: string | undefined,
  revision: number | undefined,
  ownerId: string | null | undefined,
  layer: CodegenLayer,
) {
  const qc = useQueryClient();
  const enabled = !!specId && revision !== undefined && !!ownerId;

  const versions = useQuery({
    queryKey: codeBuilderVersionsKey(specId, revision, ownerId ?? undefined, layer),
    enabled,
    queryFn: async (): Promise<CodeBuilderVersionRow[]> => {
      const { data, error } = await supabase
        .from(VERSIONS_TABLE)
        .select("*")
        .eq("spec_id", specId as string)
        .eq("revision", revision as number)
        .eq("owner_id", ownerId as string)
        .eq("layer", layer)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CodeBuilderVersionRow[];
    },
  });

  const saveVersion = useMutation({
    mutationFn: async (vars: { artifacts: VersionArtifact[]; note: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from(VERSIONS_TABLE).insert({
        spec_id: specId as string,
        revision: revision as number,
        owner_id: ownerId as string,
        layer,
        payload: { artifacts: vars.artifacts },
        note: vars.note,
        author: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codeBuilderVersionsKey(specId, revision, ownerId ?? undefined, layer) });
    },
  });

  const restoreVersion = useMutation({
    mutationFn: async (version: CodeBuilderVersionRow) => {
      for (const a of version.payload.artifacts) {
        const { error } = await supabase
          .from("code_builder_artifacts")
          .update({ edited_content: a.content })
          .eq("spec_id", specId as string)
          .eq("revision", revision as number)
          .eq("artifact_name", a.artifact_name);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: codeBuilderKey(specId, revision) });
    },
  });

  return { versions, saveVersion, restoreVersion };
}
