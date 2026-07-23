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
  /** Artifact-name → compile-time advisory messages (e.g. custom-region
   *  carry-over failures) to attach to the matching view row's `warnings`. */
  artifactWarnings?: Map<string, string[]>;
  /** G5-4 final-review finding 2: artifact-name → merged custom-region
   *  content the CALLER just upserted as this artifact's `edited_content`
   *  (custom-region carry-over). `existing` was read BEFORE that upsert, so
   *  without this overlay the first render after a revision bump would show
   *  the region-blanked generation — a window where a save could silently
   *  clobber the hand-authored region just persisted. Only applied when the
   *  matching row has no current-revision edit of its own (never overrides
   *  an already-saved edit). */
  carryOverContents?: Map<string, string>;
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
    // A same-call carry-over never overrides an already-saved edit — it only
    // fills the gap left by a stale `existing` read for a row the caller
    // just upserted `edited_content` onto.
    const editedContent = prior?.edited_content ?? input.carryOverContents?.get(a.name) ?? null;
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
      edited_content: editedContent,
      status: prior?.status ?? "pending",
      drift,
      regionDrift,
      warnings: input.artifactWarnings?.get(a.name) ?? [],
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
