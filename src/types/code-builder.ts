import type { CodegenLayer } from "@/lib/spec-builder/codegen";

/** A persisted row in code_builder_artifacts. */
export interface CodeBuilderArtifactRow {
  id: string;
  spec_id: string;
  revision: number;
  artifact_name: string;
  layer: CodegenLayer;
  owner_id: string | null;
  type: string;
  filename: string;
  folder: string;
  dependencies: string[];
  generated_content: string;
  edited_content: string | null;
  status: "pending" | "approved";
  approved_by: string | null;
  approved_at: string | null;
  updated_at: string;
}

/** The reconciled, in-memory view the UI renders (drift is computed, not stored). */
export interface CodeBuilderArtifactView {
  artifact_name: string;
  layer: CodegenLayer;
  owner_id: string | null;
  owner_name: string | null;
  type: string;
  filename: string;
  folder: string;
  dependencies: string[];
  generated_content: string;
  edited_content: string | null;
  status: "pending" | "approved";
  /** True when this artifact was edited/approved AND the FDS recompile differs. */
  drift: boolean;
}

/** The upsert payload written back to Supabase (no id; conflict on the unique key). */
export interface CodeBuilderArtifactUpsert {
  spec_id: string;
  revision: number;
  artifact_name: string;
  layer: CodegenLayer;
  owner_id: string | null;
  type: string;
  filename: string;
  folder: string;
  dependencies: string[];
  generated_content: string;
}
