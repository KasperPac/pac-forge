import type { ProcessLinkageMatrix } from "@/types/forge-matrix";
import type { HmiPanelConfig } from "@/types/hmi-panel";
import type { InterfaceContractMap } from "@/types/forge-contract";
import type { DriftReport } from "@/lib/fb-library/contract-drift";

// Wave 5: re-export contract-v2 types so forge consumers can reach them
// without importing from @/types/spec-contract-v2 directly.
export type {
  NetworkConfig,
  VfdParams,
  CompletionCriterion,
} from "@/types/spec-contract-v2";

export const FORGE_STEPS = {
  SPEC_UPLOAD: "spec_upload",
  QA_REVIEW: "qa_review",
  PROJECT_SETUP: "project_setup",
  HARDWARE_IO: "hardware_io",
  INTERFACE_CONTRACT: "interface_contract",
  DEVICE_FB: "device_fb",
  ASSEMBLY_FB: "assembly_fb",
  LOGIC_CHECK: "logic_check",
  MATRIX_REVIEW: "matrix_review",
  DEVICE_CODE: "device_code",
  PLCSIM_DEVICE_TEST: "plcsim_device_test",
  PROCESS_CODE: "process_code",
  HMI: "hmi",
  PLCSIM_SYSTEM_TEST: "plcsim_system_test",
  TIA_EXPORT: "tia_export",
} as const;

export type ForgeStep = (typeof FORGE_STEPS)[keyof typeof FORGE_STEPS];

export const FORGE_STEP_LABELS: Record<ForgeStep, string> = {
  spec_upload: "Functional Spec",
  qa_review: "Q&A Review",
  project_setup: "Project Setup",
  hardware_io: "Hardware & IO",
  interface_contract: "Interface Contracts",
  device_fb: "Device FBs",
  assembly_fb: "Assembly FBs",
  logic_check: "Logic Check",
  matrix_review: "Matrix Review",
  device_code: "Device Code",
  plcsim_device_test: "Device Tests",
  process_code: "Process Code",
  hmi: "HMI Screens",
  plcsim_system_test: "System Tests",
  tia_export: "TIA Export",
};

export const FORGE_STEP_ORDER: ForgeStep[] = [
  "spec_upload",
  "qa_review",
  "project_setup",
  "hardware_io",
  "interface_contract",
  "device_fb",
  "assembly_fb",
  "logic_check",
  "matrix_review",
  "device_code",
  "plcsim_device_test",
  "process_code",
  "hmi",
  "plcsim_system_test",
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
  /** Links to FDS spec_project — when set, forge reads behavioral data from fds_assembly_sessions */
  spec_project_id: string | null;
  current_step: ForgeStep;

  spec_text: string | null;
  spec_filename: string | null;
  spec_analysis: SpecAnalysis | null;
  qa_messages: QaMessage[];

  hardware_config: ForgeHardwareConfig;
  io_list: ForgeIoEntry[];
  device_list: ForgeDeviceEntry[];
  /** Assembly entries with FB assignments — coordinated device groups */
  assembly_list: ForgeAssemblyEntry[];
  network_topology: Record<string, unknown>;

  /** Interface contracts defining how assemblies communicate (exposed/consumed signals + state defs) */
  interface_contracts: InterfaceContractMap | null;

  linkage_matrix: ProcessLinkageMatrix | null;

  device_artifacts: ForgeArtifact[];
  /** Assembly FB artifacts (FB, config UDT, HMI UDT, instance DB) */
  assembly_artifacts: ForgeArtifact[];
  process_artifacts: ForgeArtifact[];
  hmi_artifacts: ForgeArtifact[];

  /** HMI panel configuration (family, model, resolution) — set during HMI step */
  hmi_panel_config: HmiPanelConfig | null;

  step_statuses: Partial<Record<ForgeStep, ForgeStepStatus>>;

  tia_project_path: string | null;
  tia_export_result: TiaForgeExportResult | null;

  /** Language overrides set in project setup — take precedence over design profile defaults */
  device_fb_language: "SCL" | "LAD" | null;
  device_call_fc_language: "SCL" | "LAD" | null;
  io_linking_language: "SCL" | "LAD" | null;
  process_code_language: "SCL" | "LAD" | null;
  conversion_fc_language: "SCL" | "LAD" | null;

  /** PLCSIM device FB test suite — runs after device code, before process code */
  plcsim_device_test_suite: import("./plcsim-test").PlcsimTestSuite | null;
  /** PLCSIM system test suite — runs after process code (normal/fault/interlock/reset) */
  plcsim_test_suite: import("./plcsim-test").PlcsimTestSuite | null;

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

export type ForgeArtifactType = "UDT" | "FB" | "FC" | "DB" | "OB" | "TAG_TABLE" | "HMI_SCREEN" | "HMI_TAG_TABLE";
export type ForgeArtifactLanguage = "SCL" | "LAD";
export type ForgeArtifactStage = "device_fb" | "assembly_fb" | "device" | "process" | "hmi";

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
  /**
   * True when this artifact is a block that already exists in the TIA Portal
   * project library (imported from a global library). These are excluded from
   * SCL export — they should be copied from the library instead.
   */
  library_block?: boolean;
  stage: ForgeArtifactStage;
  destination_folder: string;
  dependencies: string[];
  compile_after_import: boolean;
  /**
   * True when this artifact was generated by the deterministic compiler
   * (not by AI). These should be excluded from AI review/rewrite passes
   * since the compiler output is structurally correct by construction.
   */
  deterministic?: boolean;
  /**
   * Set when AI-against-contract generation produced unresolved drift after
   * the retry budget was exhausted. UI surfaces this for engineer review.
   * Library-path and contract-clean AI artifacts have this undefined.
   */
  drift?: DriftReport;
}

// ---------------------------------------------------------------------------
// IO entry (extends project IoEntry with signal_type)
// ---------------------------------------------------------------------------

export type IoSignalType = "DI" | "DQ" | "AI" | "AQ";

/** How the physical signal behaves over time */
export type SignalBehaviour = "momentary" | "maintained" | "continuous" | "pulsed";

/** Contact/switch wiring type */
export type ContactType = "NO" | "NC";

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
  /** How the signal behaves: momentary (push button), maintained (selector switch), continuous (sensor), pulsed (encoder) */
  signal_behaviour?: SignalBehaviour;
  /** Contact wiring type: NO (normally open) or NC (normally closed) */
  contact_type?: ContactType;
  /** Whether this signal should be processed on rising/falling edge */
  edge_trigger?: "rising" | "falling" | "both" | null;
}

// ---------------------------------------------------------------------------
// Device entry — device with FB assignment
// ---------------------------------------------------------------------------

export interface ForgeDeviceIoSignal {
  tag_name: string;
  signal_type: IoSignalType;
  description: string;
  signal_behaviour?: SignalBehaviour;
  contact_type?: ContactType;
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
  /** What triggers entry into this step — machine-parseable condition expression
   *  e.g. "DB_ProcessState.tt01Value > 40.0", "fan01Running = TRUE", "pushButtonHold = TRUE"
   *  For the first step, use the permissive/start condition. */
  trigger_condition?: string | null;
  action: string;
  completion_criteria: string;
  /** Device names involved in this step */
  devices_involved?: string[];
  /** Signal changes at this step (e.g. "FAN1_CMD = TRUE") */
  outputs?: string[];
  /** What happens if completion_criteria not met within timeout */
  timeout_action?: string | null;
  /** Edge cases, conditions, or clarifications */
  notes?: string | null;
}

/** Depth of spec analysis: how many AI passes to run */
export type SpecAnalysisDepth = 1 | 2 | 3;

export interface SpecAnalysisProcessSequence {
  name: string;
  subsystem: string;
  permissives: string[];
  steps: SpecAnalysisProcessStep[];
  /** What happens when this sequence stops */
  shutdown_behaviour?: string;
  /** Names of related sequences (de-staging, reverse, companion) */
  related_sequences?: string[];
}

export interface SpecAnalysisAlarm {
  name: string;
  /** Fault code in Fxxx format */
  code?: string;
  severity: "IMMEDIATE_SHUTDOWN" | "CONTROLLED_SHUTDOWN" | "WARNING";
  description: string;
  /** Specific signal condition that triggers this alarm */
  trigger_condition?: string;
  /** auto = clears when condition clears, manual = requires operator reset */
  reset_type?: "auto" | "manual";
  /** What must happen before reset is possible */
  reset_condition?: string;
  /** Which sequences are stopped or modified by this alarm */
  affected_sequences?: string[];
  possible_causes: string[];
}

export interface SpecAnalysisInterlock {
  name: string;
  condition: string;
  /** permissive = must be true to start, runtime_safety = continuously monitored */
  interlock_type?: "permissive" | "runtime_safety";
  /** What happens when interlock trips */
  trip_action?: string;
  affected_devices: string[];
}

export interface SpecAnalysisHardwareSlot {
  slot: number;
  module_description: string;
  order_number?: string | null;
  channels_used?: string | null;
}

export interface SpecAnalysisProcessSetting {
  name: string;
  description: string;
  default_value: string;
  data_type: string;
  unit?: string | null;
  range_min?: string | null;
  range_max?: string | null;
}

// ---------------------------------------------------------------------------
// Assembly — coordinated group of devices (lift table, conveyor, press)
// ---------------------------------------------------------------------------

export interface SpecAnalysisAssembly {
  id: string;
  name: string;
  tag: string;
  assembly_type: string;
  description: string;
  subsystem: string;
  /** References to SpecAnalysisDevice.id for constituent devices */
  device_ids: string[];
}

export interface ForgeAssemblyEntry {
  id: string;
  name: string;
  tag: string;
  assembly_type: string;
  description: string;
  subsystem: string;
  device_ids: string[];
  /** Matched assembly FB template ID — null means AI must generate */
  fb_template_id: string | null;
  fb_match_confidence: "exact" | "probable" | "none";
  language_override: "SCL" | "LAD" | null;
  approved: boolean;
}

export interface SpecAnalysis {
  project_name: string;
  project_description: string;
  plc_type: string;
  /** CPU MLFB order number if specified in spec */
  plc_order_number?: string | null;
  hmi_type: string;
  /** Safety classification from spec (e.g. "None", "PLd Cat.3", "SIL2") */
  safety_classification?: string | null;
  /** Hardware rack layout if specified in spec */
  hardware_rack?: SpecAnalysisHardwareSlot[];
  /** Configurable process parameters with defaults and ranges */
  process_settings?: SpecAnalysisProcessSetting[];
  /** FB architecture design intent from spec */
  fb_architecture?: string | null;
  subsystems: Array<{ name: string; description: string }>;
  /** Coordinated groups of devices — each gets an assembly FB */
  assemblies: SpecAnalysisAssembly[];
  /** Leaf-level physical devices with IO signals */
  devices: SpecAnalysisDevice[];
  process_sequences: SpecAnalysisProcessSequence[];
  alarms: SpecAnalysisAlarm[];
  interlocks: SpecAnalysisInterlock[];
}

// ---------------------------------------------------------------------------
// Chunked spec analysis (FEAT-12)
// ---------------------------------------------------------------------------

/** Stage 1 output: section map + extraction targets */
export interface SpecSurveyResult {
  project_name: string;
  project_description: string;
  plc_type: string;
  plc_order_number: string | null;
  hmi_type: string;
  safety_classification: string | null;
  extraction_targets: SpecExtractionTarget[];
  cross_cutting_concerns: SpecCrossCuttingConcerns;
}

export interface SpecExtractionTarget {
  /** Unique target ID, e.g. "T01" */
  id: string;
  /** Human-readable name: "Fan Staging System" */
  name: string;
  /** Which subsystem this belongs to */
  subsystem: string;
  /** Literal text from spec marking the START of relevant content */
  start_anchors: string[];
  /** Literal text marking the END of relevant content */
  end_anchors: string[];
  /** Expected device count in this target */
  expected_device_count: number;
  /** Expected sequence names */
  expected_sequences: string[];
  /** Brief description of what to extract */
  extraction_notes: string;
}

export interface SpecCrossCuttingConcerns {
  /** Global safety systems (E-Stop circuits, safety relays) */
  safety_systems: string[];
  /** Global settings that apply to multiple subsystems */
  global_settings: string[];
  /** HMI requirements mentioned across subsystems */
  hmi_requirements: string[];
  /** Shared interlocks that span subsystems */
  shared_interlocks: string[];
}

/** Partial SpecAnalysis from one extraction target (Stage 2 output) */
export interface PartialSpecAnalysis {
  target_id: string;
  subsystems: Array<{ name: string; description: string }>;
  assemblies?: SpecAnalysisAssembly[];
  devices: SpecAnalysisDevice[];
  process_sequences: SpecAnalysisProcessSequence[];
  alarms: SpecAnalysisAlarm[];
  interlocks: SpecAnalysisInterlock[];
  process_settings: SpecAnalysisProcessSetting[];
  hardware_rack: SpecAnalysisHardwareSlot[];
}

/** A text chunk prepared for extraction */
export interface SpecChunk {
  targetId: string;
  targetName: string;
  text: string;
  contextPreamble: string;
}

/** Progress state for the chunked analysis pipeline */
export interface ChunkedAnalysisProgress {
  stage: "survey" | "extracting" | "merging";
  currentChunk: number;
  totalChunks: number;
  chunkName: string;
  /** Progressive extraction stats updated during streaming */
  streamStats?: {
    devices: number;
    assemblies: number;
    sequences: number;
  };
}

/** Chars threshold above which chunked extraction is used automatically */
/** Chunking only for truly massive specs — streaming handles normal specs in a single call */
export const CHUNKED_THRESHOLD = 80_000;

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
