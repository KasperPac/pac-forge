// Types for the S7-300/400 → S7-1500 Migration Wizard

export const MIGRATION_STEPS = {
  CONNECT: "connect",
  ANALYSE: "analyse",
  APPROVE_PLAN: "approve_plan",
  TRANSFORM: "transform",
  COMPILE: "compile",
  REPORT: "report",
} as const;

export type MigrationStep = (typeof MIGRATION_STEPS)[keyof typeof MIGRATION_STEPS];

export const MIGRATION_STEP_LABELS: Record<MigrationStep, string> = {
  connect: "Connect & Export",
  analyse: "Analyse",
  approve_plan: "Approve Plan",
  transform: "Transform",
  compile: "Compile",
  report: "Report",
};

export const MIGRATION_STEP_ORDER: MigrationStep[] = [
  "connect",
  "analyse",
  "approve_plan",
  "transform",
  "compile",
  "report",
];

// ---------------------------------------------------------------------------
// Migration plan — returned by the Analyse step
// ---------------------------------------------------------------------------

export type MigrationChangeType =
  | "NAMING"
  | "TIMER"
  | "COUNTER"
  | "ADDRESSING"
  | "BLOCK_CALL"
  | "DATA_TYPE"
  | "OB_INTERFACE"
  | "SYSTEM_FUNCTION"
  | "OTHER";

export type MigrationSeverity = "BREAKING" | "WARNING" | "INFO";

export interface MigrationPlanStep {
  id: string;
  block_name: string;
  change_type: MigrationChangeType;
  severity: MigrationSeverity;
  description: string;
  /** AI-suggested action */
  action: string;
  /** User approval state */
  approved: boolean;
  /** User can choose to skip */
  skipped: boolean;
  /** Optional user note */
  note: string;
}

// ---------------------------------------------------------------------------
// Migrated block — output of the Transform step
// ---------------------------------------------------------------------------

export interface FlaggedDecision {
  id: string;
  /** Short description of where in the block this occurs */
  location: string;
  /** Why a direct substitution is not possible */
  issue: string;
  /** The original code snippet left unchanged in migrated_scl */
  original_code: string;
  /** AI's proposed workaround — informational, not auto-applied */
  proposed_solution: string;
  /** null = pending review, true = accepted (manual work needed), false = rejected (keep original) */
  accepted: boolean | null;
}

export interface MigratedBlock {
  name: string;
  block_type: "FB" | "FC" | "OB" | "DB" | "UDT";
  /** Source programming language — set when the original was not SCL (e.g. "LAD", "FBD", "STL", "GRAPH") */
  original_language?: string;
  original_scl: string;
  migrated_scl: string;
  approved: boolean;
  /** Changes applied during transformation */
  changes_applied: string[];
  /** Changes that could not be auto-applied and require human review */
  flagged_decisions?: FlaggedDecision[];
}

// ---------------------------------------------------------------------------
// Review finding — output of the Review step
// ---------------------------------------------------------------------------

export type ReviewSeverity = "CRITICAL" | "WARNING" | "INFO";

export interface ReviewFinding {
  id: string;
  block_name: string;
  severity: ReviewSeverity;
  description: string;
  suggestion: string;
}

// ---------------------------------------------------------------------------
// Migration session (mirrors migration_sessions DB table)
// ---------------------------------------------------------------------------

export interface MigrationSession {
  id: string;
  user_id: string;
  name: string;
  current_step: MigrationStep;

  source_blocks: Record<string, string>;
  source_block_count: number;
  /** Programming language per block: "SCL" | "STL" | "LAD" | "FBD" | "GRAPH" | "DB" */
  source_block_languages: Record<string, string>;

  /** Detected source PLC family, e.g. "SIMATIC 300" */
  source_plc_family: string | null;
  /** Raw TypeIdentifier string, e.g. "OrderNumber:6ES7 317-2EK14-0AB0/V3.3" */
  source_cpu_type_id: string | null;
  /** Chosen target S7-1500 CPU order number, e.g. "6ES7 516-3AN02-0AB0/V2.9" */
  target_cpu_order_number: string | null;
  /** Full path to the newly created S7-1500 .apXX project file */
  target_project_path: string | null;

  analysis_summary: string | null;
  migration_plan: MigrationPlanStep[];
  migrated_blocks: MigratedBlock[];
  review_findings: ReviewFinding[];
  compile_result: Record<string, unknown> | null;
  report_markdown: string | null;

  created_at: string;
  updated_at: string;
}

export type MigrationSessionCreate = Pick<MigrationSession, "name">;

export type MigrationSessionUpdate = Partial<
  Omit<MigrationSession, "id" | "user_id" | "created_at" | "updated_at">
>;
