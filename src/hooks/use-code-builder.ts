import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { loadSpecContract } from "@/lib/spec-builder/contract";
import { compileContract, filterByLayer } from "@/lib/spec-builder/codegen";
import type { CodegenLayer } from "@/lib/spec-builder/codegen";
import {
  buildEmUiModel,
  type CodeBuilderUnitGroup, type CodeBuilderEmInfo,
} from "@/lib/spec-builder/code-builder-em-ui-model";
import { useFbTemplates } from "@/hooks/use-fb-templates";
import { useSpecProject } from "@/hooks/use-spec-projects";
import {
  reconcileArtifacts, toUpserts,
} from "@/lib/spec-builder/code-builder-reconcile";
import type {
  CodeBuilderArtifactRow, CodeBuilderArtifactView,
} from "@/types/code-builder";
import type { FbTemplate } from "@/types/fb-template";
import type { ReviewFinding } from "@/lib/forge-review-parser";

const TABLE = "code_builder_artifacts";

export const codeBuilderKey = (specId?: string, revision?: number) =>
  ["code_builder", specId ?? "", revision ?? -1] as const;

async function loadRows(specId: string, revision: number): Promise<CodeBuilderArtifactRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("spec_id", specId)
    .eq("revision", revision);
  if (error) throw error;
  return (data ?? []) as CodeBuilderArtifactRow[];
}

/**
 * Compile the confirmed FDS, upsert fresh active-layer content for the current
 * revision, and return the reconciled view (edits/approvals preserved, drift
 * flagged). Re-runs whenever the spec revision or templates change.
 */
async function compileAndReconcile(
  specId: string, revision: number, templates: FbTemplate[], layer: CodegenLayer,
): Promise<CodeBuilderArtifactView[]> {
  const existing = await loadRows(specId, revision);
  const contract = await loadSpecContract(specId);
  const result = compileContract(contract, templates);
  const compiled = filterByLayer(result.artifacts, layer);

  const upserts = toUpserts({ specId, revision, compiled, existing });
  if (upserts.length) {
    const { error } = await supabase
      .from(TABLE)
      .upsert(upserts, { onConflict: "spec_id,revision,artifact_name" });
    if (error) throw error;
  }
  return reconcileArtifacts({ specId, revision, compiled, existing });
}

export function useCodeBuilder(specId: string | undefined, layer: CodegenLayer = "device") {
  const qc = useQueryClient();
  const { data: templates = [] } = useFbTemplates();
  const { data: spec } = useSpecProject(specId);

  // SpecProject.revision is stored as a string ("01", "2", ...) but the
  // code_builder_artifacts.revision column is INT. Coerce once and reuse the
  // numeric value for BOTH the query key and every DB write.
  const revisionNum = spec ? Number(spec.revision) : NaN;
  const revision = Number.isFinite(revisionNum) ? revisionNum : undefined;
  const ready =
    !!specId &&
    revision !== undefined &&
    spec?.confirmation_status === "confirmed";

  const artifacts = useQuery({
    queryKey: [...codeBuilderKey(specId, revision), layer],
    enabled: ready,
    queryFn: () => compileAndReconcile(specId as string, revision as number, templates, layer),
  });

  const emUi = useQuery({
    queryKey: ["code_builder_em_ui", specId ?? "", revision ?? -1],
    enabled: ready,
    queryFn: async () => buildEmUiModel(await loadSpecContract(specId as string)),
  });

  const approve = useMutation({
    mutationFn: async (artifactName: string) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase
        .from(TABLE)
        .update({ status: "approved", approved_by: user?.id ?? null, approved_at: new Date().toISOString() })
        .eq("spec_id", specId as string)
        .eq("revision", revision as number)
        .eq("artifact_name", artifactName);
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: codeBuilderKey(specId, revision) }); },
  });

  const saveEdit = useMutation({
    mutationFn: async (vars: { artifactName: string; content: string }) => {
      const { error } = await supabase
        .from(TABLE)
        .update({ edited_content: vars.content })
        .eq("spec_id", specId as string)
        .eq("revision", revision as number)
        .eq("artifact_name", vars.artifactName);
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: codeBuilderKey(specId, revision) }); },
  });

  const acknowledgeWarning = useMutation({
    mutationFn: async (vars: { artifactName: string; warningKeys: string[] }) => {
      const { error } = await supabase
        .from(TABLE)
        .update({ acknowledged_warnings: vars.warningKeys })
        .eq("spec_id", specId as string)
        .eq("revision", revision as number)
        .eq("artifact_name", vars.artifactName);
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: codeBuilderKey(specId, revision) }); },
  });

  const saveReview = useMutation({
    mutationFn: async (vars: { artifactName: string; status: "pass" | "findings"; findings: ReviewFinding[] }) => {
      const { error } = await supabase
        .from(TABLE)
        .update({ review_status: vars.status, review_findings: vars.findings })
        .eq("spec_id", specId as string)
        .eq("revision", revision as number)
        .eq("artifact_name", vars.artifactName);
      if (error) throw error;
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: codeBuilderKey(specId, revision) }); },
  });

  const unitGroups: CodeBuilderUnitGroup[] = emUi.data?.unitGroups ?? [];
  const emById: Record<string, CodeBuilderEmInfo> = emUi.data?.emById ?? {};

  return { artifacts, approve, saveEdit, acknowledgeWarning, saveReview, ready, revision, unitGroups, emById };
}
