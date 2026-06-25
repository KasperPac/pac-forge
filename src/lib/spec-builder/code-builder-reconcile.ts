import type { CodegenArtifact } from "@/lib/spec-builder/codegen";
import type {
  CodeBuilderArtifactRow, CodeBuilderArtifactView, CodeBuilderArtifactUpsert,
} from "@/types/code-builder";
import { regionDrift as computeRegionDrift } from "@/lib/spec-builder/codegen/em-fill-regions";

export interface ReconcileInput {
  specId: string;
  revision: number;
  /** Freshly compiled artifacts to surface (Device layer for this slice). */
  compiled: CodegenArtifact[];
  /** Stored rows for the same (spec_id, revision). */
  existing: CodeBuilderArtifactRow[];
}

/**
 * Merge freshly compiled artifacts with stored rows. Reviewer edits/approvals
 * survive a recompile; `generated_content` is always refreshed to the latest
 * deterministic output. `drift` is set when an artifact already carried an
 * edit or approval AND the recompiled content differs — never silently lost.
 * Pure: no IO.
 */
export function reconcileArtifacts(input: ReconcileInput): CodeBuilderArtifactView[] {
  const byName = new Map(input.existing.map((r) => [r.artifact_name, r]));
  return input.compiled.map((a) => {
    const prior = byName.get(a.name);
    const reviewed = !!prior && (prior.status === "approved" || prior.edited_content !== null);
    const drift = !!prior && reviewed && prior.generated_content !== a.content;
    const regionDrift = drift ? computeRegionDrift(prior!.generated_content, a.content) : [];
    return {
      artifact_name: a.name,
      layer: a.layer,
      owner_id: a.ownerId ?? prior?.owner_id ?? null,
      owner_name: a.ownerName ?? null,
      type: a.type,
      filename: a.filename,
      folder: a.folder,
      dependencies: a.dependencies,
      generated_content: a.content,
      edited_content: prior?.edited_content ?? null,
      status: prior?.status ?? "pending",
      drift,
      regionDrift,
      acknowledged_warnings: prior?.acknowledged_warnings ?? [],
      review_status: prior?.review_status ?? null,
      review_findings: prior?.review_findings ?? [],
    };
  });
}

/** Build the upsert payloads that refresh stored `generated_content` for the
 *  current revision. Edits/approvals are NOT touched here. */
export function toUpserts(input: ReconcileInput): CodeBuilderArtifactUpsert[] {
  return input.compiled.map((a) => ({
    spec_id: input.specId,
    revision: input.revision,
    artifact_name: a.name,
    layer: a.layer,
    owner_id: a.ownerId ?? null,
    type: a.type,
    filename: a.filename,
    folder: a.folder,
    dependencies: a.dependencies,
    generated_content: a.content,
  }));
}
