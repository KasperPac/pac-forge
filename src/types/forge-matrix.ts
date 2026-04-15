/**
 * Forge matrix types — device linkage, process sequences, and staged pipeline.
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

/** Config UDT definition from matrix generation — defines fields for configuration structs */
export interface ConfigUdtDefinition {
  name: string;
  description: string;
  fields: Array<{
    fieldName: string;
    dataType: string;
    defaultValue?: string | null;
    description: string;
  }>;
}

/** Assembly linkage — wiring for assembly-level FBs that coordinate device groups */
export interface LinkageAssembly {
  id: string;
  name: string;
  assemblyType: string;
  description: string;
  fbName: string;
  fbTemplateName: string | null;
  fbTemplateId: string | null;
  instanceDbName: string;
  /** IDs of constituent devices in deviceLinkage */
  deviceIds: string[];
  wiring: FbWire[];
  interlocks: LinkageInterlock[];
  statusMirrors?: StatusMirror[];
}

export interface ProcessLinkageMatrix {
  version: number;
  deviceLinkage: LinkageDevice[];
  /** Assembly-level FB linkage — coordinates groups of devices */
  assemblyLinkage?: LinkageAssembly[];
  globalData: LinkageGlobalData[];
  processSequences: ProcessSequence[];
  faultMatrix?: FaultMatrixEntry[];
  /** Config UDT definitions generated alongside device linkage wiring */
  configUdts?: ConfigUdtDefinition[];
  /** @deprecated Use processSequences instead — kept for backward compat */
  processSteps?: ProcessStep[];
  notes: string;
  generatedAt: string;
  lastReviewedAt: string | null;
  reviewStatus: MatrixReviewStatus;
}

/** FB-to-FB wiring entry: captures what each FB parameter connects to. */
export interface FbWire {
  id: string;
  paramName: string;
  direction: "in" | "out";
  connectedTo: string;
  wireType: "fb" | "io" | "global" | "constant";
  dataType?: string;
  /** Auto-generated notes (e.g. TYPE_CONVERSION: Int→Bool) */
  notes?: string;
  /** When TYPE_CONVERSION is needed, this is the rewired source from DB_Converted */
  convertedSource?: string;
}

/**
 * Status mirror: copies an IO tag value or FB output to ProcessState
 * so process sequences can read operational status without crossing
 * into instance DBs directly.
 *
 * The call FC generator produces an assignment line for each mirror:
 *   "DB_ProcessState".fan01Running := "FAN1_RUN";            (sourceType: "io")
 *   "DB_ProcessState".tt01Value := "InstTT01".rOutEngUnitsValue; (sourceType: "fb_output")
 */
export interface StatusMirror {
  /** Source signal — IO tag name or FB output param name */
  source: string;
  /** Where the source value lives */
  sourceType: "io" | "fb_output";
  /** Target ProcessState field (e.g. "ProcessState.fan01Running") */
  target: string;
  /** PLC data type */
  dataType: string;
  /** Human-readable description */
  description: string;
}

export interface LinkageDevice {
  id: string;
  name: string;
  deviceType: string;
  description: string;
  wiring: FbWire[];
  fbName: string;
  fbTemplateName: string | null;
  fbTemplateId: string | null;
  instanceDbName: string;
  interlocks: LinkageInterlock[];
  /** Operational status values mirrored to ProcessState for sequence access */
  statusMirrors?: StatusMirror[];
}

/** @deprecated Kept for backward compat with existing sessions in DB. */
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
// Process Sequence (enhanced state-machine model)
// ---------------------------------------------------------------------------

/** A sub-condition within a compound transition */
export interface TransitionSubCondition {
  id: string;
  description: string;
  deviceName: string | null;
  /** For XOR/OR transitions: the step number this condition routes to (optional, enables proper diagram branching) */
  targetStepNumber?: number;
}

/** Compound transition condition with AND/OR logic */
export interface TransitionCondition {
  combinator: "AND" | "OR";
  conditions: TransitionSubCondition[];
}

export interface ProcessAction {
  id: string;
  description: string;
  deviceName: string | null;
}

export interface ProcessPermissive {
  id: string;
  description: string;
  deviceName: string | null;
  polarity: boolean;
}

/** Safety condition — continuously monitored, halts sequence to safe state on failure */
export interface SafetyCondition {
  id: string;
  description: string;
  deviceName: string | null;
  polarity: boolean;
}

export interface FaultMatrixEntry {
  id: string;
  code: string;
  tag: string;
  description: string;
  condition: string;
  resetCondition: string;
  source: string;
  severity: "fault" | "warning";
  affectsSequences: string[];
}

// ---------------------------------------------------------------------------
// Sequence Row — one-condition-per-row table format (v2)
// ---------------------------------------------------------------------------

/**
 * A single row in the process sequence table.
 * Rows sharing the same `step` number are ALTERNATIVES (branches).
 * The `next` field makes control flow explicit — no text parsing needed.
 */
export interface SequenceRow {
  /** Step number. Rows sharing this value are parallel branch alternatives. */
  step: number;
  /** Sub-ID for branches: "a", "b", "c". null if no branching at this step. */
  branch: string | null;
  /** The ONE condition for this row to execute. Use actual signal names. */
  condition: string;
  /** What this row does — one short imperative action. */
  action: string;
  /** The specific signal change, or null. Format: "SIGNAL = VALUE". */
  output: string | null;
  /** Which step executes next. "FAULT" → fault state. "IDLE" → return to idle. */
  next: number | "FAULT" | "IDLE";
  /** Row type — drives how the flow diagram renders it. */
  type: "action" | "monitor" | "branch" | "fault_exit" | "merge";
  /** Device names involved in this row. */
  devices: string[];
}

export interface ProcessSequence {
  id: string;
  name: string;
  description: string;
  permissives: ProcessPermissive[];
  safetyConditions: SafetyCondition[];
  /** New table format (v2) — one condition per row, branching explicit via step/branch fields. */
  rows?: SequenceRow[];
  /** @deprecated Legacy step format — used when rows is absent. */
  steps?: ProcessStep[];
}

export interface ProcessStep {
  id: string;
  stepNumber: number;
  transition: TransitionCondition;
  actions: ProcessAction[];
  devicesInvolved: string[];
  notes: string;
  /** @deprecated Use transition instead */
  action?: string;
  /** @deprecated Use transition instead */
  completionCriteria?: string;
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
  /** Full pipeline agent conversation log (system prompts, user messages, responses). */
  pipeline_log: Record<string, unknown>[];
  created_at: string;
  updated_at: string;
}
