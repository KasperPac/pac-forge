import type { TiaManifest } from "./artifact";

export const TIA_JOB_TYPES = {
  IMPORT_ONLY: "IMPORT_ONLY",
  IMPORT_AND_COMPILE: "IMPORT_AND_COMPILE",
  COMPILE_ONLY: "COMPILE_ONLY",
  EXPORT_REPORT: "EXPORT_REPORT",
} as const;

export type TiaJobType = (typeof TIA_JOB_TYPES)[keyof typeof TIA_JOB_TYPES];

export const TIA_JOB_STATUSES = {
  PENDING: "PENDING",
  RUNNING: "RUNNING",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
} as const;

export type TiaJobStatus =
  (typeof TIA_JOB_STATUSES)[keyof typeof TIA_JOB_STATUSES];

export interface CompileError {
  artifact_name: string;
  line: number | null;
  column: number | null;
  error_text: string;
  severity: "ERROR" | "WARNING" | "INFO";
}

export interface CompileResult {
  success: boolean;
  errors: CompileError[];
  warnings: CompileError[];
  compiled_at: string;
}

export interface TiaJob {
  id: string;
  project_id: string;
  session_id: string;
  job_type: TiaJobType;
  manifest: TiaManifest;
  status: TiaJobStatus;
  compile_results: CompileResult | null;
  created_by: string;
  created_at: string;
  completed_at: string | null;
}

export interface CompileResultWithSources extends CompileResult {
  sources: Record<string, string>;
}

export const AUDIT_ACTIONS = {
  GENERATION: "GENERATION",
  APPROVAL: "APPROVAL",
  APPROVE_ALL: "APPROVE_ALL",
  EXPORT: "EXPORT",
  TIA_SUBMIT: "TIA_SUBMIT",
  SNAPSHOT_CREATE: "SNAPSHOT_CREATE",
  SNAPSHOT_ROLLBACK: "SNAPSHOT_ROLLBACK",
  CLEAR_WORKSPACE: "CLEAR_WORKSPACE",
  PATTERN_APPROVE: "PATTERN_APPROVE",
  PATTERN_REJECT: "PATTERN_REJECT",
  TIA_IMPORT: "TIA_IMPORT",
  TIA_COMPILE: "TIA_COMPILE",
  COMPILE_FIX: "COMPILE_FIX",
  SESSION_START: "SESSION_START",
  SESSION_END: "SESSION_END",
} as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[keyof typeof AUDIT_ACTIONS];

export interface AuditLogEntry {
  id: string;
  user_id: string;
  project_id: string | null;
  action: AuditAction;
  details: Record<string, unknown>;
  created_at: string;
}
