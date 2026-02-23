export const SNAPSHOT_TRIGGERS = {
  GENERATION: "GENERATION",
  APPROVAL: "APPROVAL",
  EXPORT: "EXPORT",
} as const;

export type SnapshotTrigger =
  (typeof SNAPSHOT_TRIGGERS)[keyof typeof SNAPSHOT_TRIGGERS];

export interface Snapshot {
  id: string;
  project_id: string;
  artifact_id: string;
  content: string;
  trigger: SnapshotTrigger;
  version_number: number;
  created_by: string;
  created_at: string;
}
