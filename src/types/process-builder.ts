/**
 * Process Builder types for staged multi-agent pipeline generation.
 */

/** The 7 generation stages in order. */
export const PROCESS_STAGES = {
  QA: "qa",
  MATRIX: "matrix",
  IO: "io",
  FOLDERS: "folders",
  FB: "fb",
  DB: "db",
  FC_OB: "fc_ob",
} as const;

export type ProcessStage = (typeof PROCESS_STAGES)[keyof typeof PROCESS_STAGES];

/** Ordered array for iteration. */
export const PROCESS_STAGE_ORDER: ProcessStage[] = [
  "qa",
  "matrix",
  "io",
  "folders",
  "fb",
  "db",
  "fc_ob",
];

/** Human-readable labels for each stage. */
export const PROCESS_STAGE_LABELS: Record<ProcessStage, string> = {
  qa: "PM Q&A",
  matrix: "Linkage Matrix",
  io: "IO List",
  folders: "Folder Structure",
  fb: "Function Blocks",
  db: "Data Blocks",
  fc_ob: "Process FC + OB1",
};

/** Stage descriptions for UI display. */
export const PROCESS_STAGE_DESCRIPTIONS: Record<ProcessStage, string> = {
  qa: "Gather requirements via AI-driven Q&A",
  matrix: "Review device linkage and process sequence",
  io: "Generate IO configuration from hardware modules",
  folders: "Create TIA Portal folder structure",
  fb: "Generate Function Blocks per device type",
  db: "Generate Instance + Global Data Blocks",
  fc_ob: "Generate Process FC and OB1 Main",
};

export const PROCESS_STAGE_STATUSES = {
  PENDING: "pending",
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  FAILED: "failed",
  SKIPPED: "skipped",
} as const;

export type ProcessStageStatusValue =
  (typeof PROCESS_STAGE_STATUSES)[keyof typeof PROCESS_STAGE_STATUSES];

/** Status tracking for a single stage. */
export interface ProcessStageStatus {
  stage: ProcessStage;
  status: ProcessStageStatusValue;
  startedAt: string | null;
  completedAt: string | null;
  artifactIds: string[];
  error: string | null;
}

/** Q&A answer categories. */
export const QA_CATEGORIES = {
  REQUIREMENTS: "requirements",
  DEVICES: "devices",
  IO_MODULES: "io_modules",
  FB_TEMPLATES: "fb_templates",
  FOLDERS: "folders",
  OTHER: "other",
} as const;

export type QaCategory = (typeof QA_CATEGORIES)[keyof typeof QA_CATEGORIES];

/** A single Q&A answer extracted from PM conversation. */
export interface QaAnswer {
  id: string;
  question: string;
  answer: string;
  category: QaCategory;
  timestamp: string;
}

/** IO module recommendation from PM (legacy — kept for backward compat). */
export interface IoRecommendation {
  mlfb: string;
  rack: number;
  slot: number;
  description: string;
  confirmed: boolean;
}

/** FB template recommendation from PM (legacy — kept for backward compat). */
export interface FbRecommendation {
  deviceType: string;
  templateId: string | null;
  templateName: string;
  instanceCount: number;
  confirmed: boolean;
}

// ---------------------------------------------------------------------------
// Device Linkage Matrix
// ---------------------------------------------------------------------------

export type MatrixReviewStatus = "draft" | "user_edited" | "pm_validated";

export interface ProcessLinkageMatrix {
  version: number;
  deviceLinkage: LinkageDevice[];
  globalData: LinkageGlobalData[];
  processSteps: ProcessStep[];
  notes: string;
  generatedAt: string;
  lastReviewedAt: string | null;
  reviewStatus: MatrixReviewStatus;
}

export interface LinkageDevice {
  id: string;
  name: string;
  deviceType: string;
  description: string;
  ioSignals: LinkageIoSignal[];
  fbName: string;
  fbTemplateName: string | null;
  fbTemplateId: string | null;
  instanceDbName: string;
  interlocks: LinkageInterlock[];
}

export interface LinkageIoSignal {
  id: string;
  tagName: string;
  signalType: "DI" | "DQ" | "AI" | "AQ";
  purpose: string;
}

export interface LinkageInterlock {
  id: string;
  targetDeviceName: string;
  condition: string;
  direction: "requires" | "blocks" | "follows";
}

export interface LinkageGlobalData {
  id: string;
  dbName: string;
  purpose: string;
  fields: LinkageGlobalField[];
}

export interface LinkageGlobalField {
  id: string;
  fieldName: string;
  dataType: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Process Sequence Table
// ---------------------------------------------------------------------------

export interface ProcessStep {
  id: string;
  stepNumber: number;
  action: string;
  completionCriteria: string;
  devicesInvolved: string[];
  notes: string;
}

// ---------------------------------------------------------------------------
// Session (persisted to DB)
// ---------------------------------------------------------------------------

/** Full process builder session state (persisted to DB). */
export interface ProcessBuilderSession {
  id: string;
  session_id: string;
  project_id: string;
  user_id: string;
  current_stage: ProcessStage;
  stage_statuses: ProcessStageStatus[];
  qa_answers: QaAnswer[];
  io_recommendations: IoRecommendation[];
  fb_recommendations: FbRecommendation[];
  linkage_matrix: ProcessLinkageMatrix | null;
  folder_structure: Record<string, unknown>;
  auto_gating: boolean;
  tia_project_path?: string;
  created_at: string;
  updated_at: string;
}
