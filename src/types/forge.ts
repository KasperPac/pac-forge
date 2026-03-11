export const FORGE_STEPS = {
  SPEC_UPLOAD: "spec_upload",
  QA_REVIEW: "qa_review",
  PROJECT_SETUP: "project_setup",
  HARDWARE_IO: "hardware_io",
  DEVICE_CODE: "device_code",
  PROCESS_CODE: "process_code",
  HMI: "hmi",
  TIA_EXPORT: "tia_export",
} as const;

export type ForgeStep = (typeof FORGE_STEPS)[keyof typeof FORGE_STEPS];

export const FORGE_STEP_LABELS: Record<ForgeStep, string> = {
  spec_upload: "Functional Spec",
  qa_review: "Q&A Review",
  project_setup: "Project Setup",
  hardware_io: "Hardware & IO",
  device_code: "Device Code",
  process_code: "Process Code",
  hmi: "HMI Screens",
  tia_export: "TIA Export",
};

export const FORGE_STEP_ORDER: ForgeStep[] = [
  "spec_upload",
  "qa_review",
  "project_setup",
  "hardware_io",
  "device_code",
  "process_code",
  "hmi",
  "tia_export",
];

// ---------------------------------------------------------------------------
// Q&A review message
// ---------------------------------------------------------------------------

export interface QaMessage {
  id: string;
  role: "assistant" | "user";
  content: string;
  timestamp: string;
}

export type ForgeStepStatus = "pending" | "active" | "completed" | "failed";

// ---------------------------------------------------------------------------
// Forge session (mirrors forge_sessions DB table)
// ---------------------------------------------------------------------------

export interface ForgeSession {
  id: string;
  project_id: string;
  user_id: string;
  design_profile_id: string | null;
  current_step: ForgeStep;

  spec_text: string | null;
  spec_filename: string | null;
  spec_analysis: SpecAnalysis | null;
  qa_messages: QaMessage[];

  hardware_config: ForgeHardwareConfig;
  io_list: ForgeIoEntry[];
  device_list: ForgeDeviceEntry[];
  network_topology: Record<string, unknown>;

  linkage_matrix: unknown | null;

  device_artifacts: ForgeArtifact[];
  process_artifacts: ForgeArtifact[];
  hmi_artifacts: ForgeArtifact[];

  step_statuses: Partial<Record<ForgeStep, ForgeStepStatus>>;

  tia_project_path: string | null;
  tia_export_result: TiaForgeExportResult | null;

  created_at: string;
  updated_at: string;
}

export type ForgeSessionCreate = Pick<ForgeSession, "project_id" | "design_profile_id">;

export type ForgeSessionUpdate = Partial<
  Omit<ForgeSession, "id" | "user_id" | "project_id" | "created_at" | "updated_at">
>;

// ---------------------------------------------------------------------------
// Forge artifact — generated code block
// ---------------------------------------------------------------------------

export type ForgeArtifactType = "UDT" | "FB" | "FC" | "DB" | "OB" | "TAG_TABLE";
export type ForgeArtifactLanguage = "SCL" | "LAD";
export type ForgeArtifactStage = "device" | "process" | "hmi";

export interface ForgeArtifact {
  id: string;
  name: string;
  type: ForgeArtifactType;
  language: ForgeArtifactLanguage;
  /** SCL source code OR serialised LadProgram JSON */
  content: string;
  /** Pre-built SimaticML XML (for LAD/HMI blocks) */
  xml_content?: string;
  approved: boolean;
  fb_template_id?: string;
  stage: ForgeArtifactStage;
  destination_folder: string;
  dependencies: string[];
  compile_after_import: boolean;
}

// ---------------------------------------------------------------------------
// IO entry (extends project IoEntry with signal_type)
// ---------------------------------------------------------------------------

export type IoSignalType = "DI" | "DQ" | "AI" | "AQ";

export interface ForgeIoEntry {
  address: string;
  tag_name: string;
  signal_type: IoSignalType;
  data_type: string;
  description: string;
  module: string;
  slot: number;
  /** Device this IO point belongs to (from spec extraction) */
  device_id?: string;
}

// ---------------------------------------------------------------------------
// Device entry — device with FB assignment
// ---------------------------------------------------------------------------

export interface ForgeDeviceIoSignal {
  tag_name: string;
  signal_type: IoSignalType;
  description: string;
}

export interface ForgeDeviceEntry {
  id: string;
  name: string;
  tag: string;
  device_type: string;
  description: string;
  subsystem: string;
  io_signals: ForgeDeviceIoSignal[];
  /** Matched FB template ID — null means AI must generate the FB */
  fb_template_id: string | null;
  /** Match confidence from forge-device-matcher */
  fb_match_confidence: "exact" | "probable" | "none";
  /** Per-device language override — null means use profile's device_fb_language */
  language_override: "SCL" | "LAD" | null;
  approved: boolean;
}

// ---------------------------------------------------------------------------
// Hardware config
// ---------------------------------------------------------------------------

export interface ForgeIoModule {
  slot: number;
  rack: number;
  module_type: string;
  order_number?: string;
  description?: string;
  channel_count?: number;
  signal_type?: IoSignalType;
}

export interface ForgeHardwareConfig {
  cpu_type: string;
  cpu_order_number?: string;
  tia_version: string;
  racks: Array<{
    rack: number;
    modules: ForgeIoModule[];
  }>;
}

// ---------------------------------------------------------------------------
// Spec analysis — AI-parsed output from functional spec
// ---------------------------------------------------------------------------

export interface ForgeDeviceIoSignalExtracted {
  tag_name: string;
  signal_type: IoSignalType;
  description: string;
}

export interface SpecAnalysisDevice {
  id: string;
  name: string;
  tag: string;
  device_type: string;
  description: string;
  subsystem: string;
  io_signals: ForgeDeviceIoSignalExtracted[];
}

export interface SpecAnalysisProcessStep {
  step_number: number;
  action: string;
  completion_criteria: string;
}

export interface SpecAnalysisProcessSequence {
  name: string;
  subsystem: string;
  permissives: string[];
  steps: SpecAnalysisProcessStep[];
}

export interface SpecAnalysisAlarm {
  name: string;
  severity: "IMMEDIATE_SHUTDOWN" | "CONTROLLED_SHUTDOWN" | "WARNING";
  description: string;
  possible_causes: string[];
}

export interface SpecAnalysisInterlock {
  name: string;
  condition: string;
  affected_devices: string[];
}

export interface SpecAnalysis {
  project_name: string;
  project_description: string;
  plc_type: string;
  hmi_type: string;
  subsystems: Array<{ name: string; description: string }>;
  devices: SpecAnalysisDevice[];
  process_sequences: SpecAnalysisProcessSequence[];
  alarms: SpecAnalysisAlarm[];
  interlocks: SpecAnalysisInterlock[];
}

// ---------------------------------------------------------------------------
// TIA export result
// ---------------------------------------------------------------------------

export interface TiaForgeExportResult {
  success: boolean;
  scl_imported: number;
  lad_imported: number;
  hmi_imported: number;
  compile_errors: string[];
  compile_warnings: string[];
  timestamp: string;
}
