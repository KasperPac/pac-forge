import type { SafetyWarning } from "./conversation";

export const ARTIFACT_TYPES = {
  UDT: "UDT",
  FB: "FB",
  FC: "FC",
  DB: "DB",
  OB: "OB",
  SCL_SOURCE: "SCL_SOURCE",
  TAG_TABLE: "TAG_TABLE",
} as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[keyof typeof ARTIFACT_TYPES];

export const OVERWRITE_STRATEGIES = {
  CREATE_OR_UPDATE: "CREATE_OR_UPDATE",
  FAIL_IF_EXISTS: "FAIL_IF_EXISTS",
  CREATE_NEW_VERSION: "CREATE_NEW_VERSION",
} as const;

export type OverwriteStrategy =
  (typeof OVERWRITE_STRATEGIES)[keyof typeof OVERWRITE_STRATEGIES];

export interface Artifact {
  id: string;
  project_id: string;
  session_id: string;
  name: string;
  type: ArtifactType;
  filename: string;
  content: string;
  approved_content: string | null;
  destination_folder: string;
  dependencies: string[];
  compile_after_import: boolean;
  overwrite_strategy: OverwriteStrategy;
  safety_warnings: SafetyWarning[];
  notes: string;
  created_at: string;
}

export interface ManifestArtifact {
  name: string;
  type: ArtifactType;
  filename: string;
  destination_folder: string;
  dependencies: string[];
  compile_after_import: boolean;
  overwrite_strategy: OverwriteStrategy;
  notes?: string;
}

export interface TiaManifest {
  manifest_version: string;
  project_id: string;
  platform: "SIEMENS_TIA";
  tia_version: string;
  cpu_type: string;
  created_at: string;
  created_by_user_id: string;
  generation_session_id: string;
  artifacts: ManifestArtifact[];
}
