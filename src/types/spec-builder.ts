// Spec Builder types — functional specification document generation
import type { SequentialStateV2 } from "./spec-contract-v2";

// --- Spec Project ---

export interface SpecProject {
  id: string;
  created_by: string;
  project_id: string | null;
  doc_code: string;
  revision: string;
  title: string;
  client_name: string | null;
  project_number: string | null;
  issued_by: string | null;
  verified_by: string | null;
  approved_by: string | null;
  doc_date: string | null;
  plc_model: string | null;
  hmi_type: string | null;
  comms_protocol: string | null;
  design_profile_id: string | null;
  system_description: string | null;
  // Wizard state
  confirmed_subsystems: SubsystemConfig[];
  confirmed_states: OperatingState[];
  alarm_tiers: AlarmTier[];
  // V2 fields — scope & philosophy
  scope_exclusions: string[];
  safety_classification: string | null;
  fault_philosophy: string | null;
  design_principles: string[];
  // Status
  status: "draft" | "generating" | "review" | "complete";
  created_at: string;
  updated_at: string;
}

export interface SpecProjectCreate {
  project_id: string;
  doc_code: string;
  title: string;
  client_name?: string;
  revision?: string;
  project_number?: string;
  issued_by?: string;
  verified_by?: string;
  approved_by?: string;
  doc_date?: string;
  plc_model?: string;
  hmi_type?: string;
  comms_protocol?: string;
  design_profile_id?: string;
  system_description?: string;
  scope_exclusions?: string[];
  safety_classification?: string;
  fault_philosophy?: string;
  design_principles?: string[];
}

export interface SpecProjectUpdate {
  doc_code?: string;
  revision?: string;
  title?: string;
  client_name?: string;
  project_number?: string;
  issued_by?: string;
  verified_by?: string;
  approved_by?: string;
  doc_date?: string;
  plc_model?: string;
  hmi_type?: string;
  comms_protocol?: string;
  design_profile_id?: string;
  system_description?: string;
  confirmed_subsystems?: SubsystemConfig[];
  confirmed_states?: OperatingState[];
  alarm_tiers?: AlarmTier[];
  scope_exclusions?: string[];
  safety_classification?: string;
  fault_philosophy?: string;
  design_principles?: string[];
  status?: SpecProject["status"];
}

// --- Instrument Register ---

export interface InstrumentTag {
  tag: string;
  device_type: string;
  description: string;
  signal_type: string;
  io_address: string;
  // Enriched by Haiku
  device_class: DeviceClass;
  signal_direction: SignalDirection;
  subsystem_prefix: string;
  is_safety: boolean;
  // Assigned subsystem
  subsystem: string;
}

export type DeviceClass =
  | "valve"
  | "motor"
  | "sensor_level"
  | "sensor_pressure"
  | "sensor_temperature"
  | "sensor_weight"
  | "sensor_flow"
  | "sensor_position"
  | "indicator"
  | "transmitter"
  | "filter"
  | "conveyor"
  | "hopper"
  | "transporter"
  | "dryer"
  | "cooler"
  | "push_button"
  | "emergency_stop"
  | "other";

export type SignalDirection = "DI" | "DO" | "AI" | "AO" | "internal";

export interface InstrumentRegister {
  id: string;
  spec_project_id: string;
  raw_filename: string | null;
  parsed_at: string;
  tags: InstrumentTag[];
  subsystems: SubsystemSummary[];
  parse_warnings: ParseWarning[];
  haiku_usage: TokenUsage;
  created_at: string;
}

export interface SubsystemSummary {
  subsystem_id: string;
  subsystem_name: string;
  equipment_type: EquipmentType;
  tag_count: number;
}

export type EquipmentType =
  | "Hopper"
  | "Pneumatic Transporter"
  | "Dryer"
  | "Cooler"
  | "Unloading Station"
  | "Magnetic Filter"
  | "Fan/Blower"
  | "Milling"
  | "Conveyor"
  | "Other";

export interface ParseWarning {
  tag: string;
  reason: string;
  severity: "info" | "warning" | "error";
}

export interface TokenUsage {
  input?: number;
  output?: number;
  total?: number;
}

// --- Machine Hierarchy (wizard) ---
// System → Subsystem → Assembly → Device (each 1-to-many downstream)

export interface IoSignal {
  tag: string;
  signal_type: string;
  io_address: string;
  description: string;
}

export interface DeviceConfig {
  device_id: string;
  device_name: string;
  device_class: DeviceClass;
  description: string;
  is_safety: boolean;
  io_signals: IoSignal[];
}

export interface AssemblyConfig {
  assembly_id: string;
  assembly_name: string;
  description: string;
  devices: DeviceConfig[];
}

export interface SubsystemConfig {
  subsystem_id: string;
  subsystem_name: string;
  equipment_type: EquipmentType;
  description: string;
  assemblies: AssemblyConfig[];
  excluded: boolean;
}

/** Compute tag count for a subsystem by summing IO signals across all devices */
export function getSubsystemTagCount(sub: SubsystemConfig): number {
  return sub.assemblies.reduce(
    (sum, a) => sum + a.devices.reduce((ds, d) => ds + d.io_signals.length, 0),
    0
  );
}

/** Compute total device count for a subsystem */
export function getSubsystemDeviceCount(sub: SubsystemConfig): number {
  return sub.assemblies.reduce((sum, a) => sum + a.devices.length, 0);
}

/** Migrate legacy flat SubsystemConfig (no assemblies) to nested format */
export function migrateSubsystemConfig(raw: unknown[]): SubsystemConfig[] {
  return (raw as Record<string, unknown>[]).map((s) => {
    if (Array.isArray(s.assemblies)) return s as unknown as SubsystemConfig;
    // Legacy flat format — wrap in single assembly with no devices
    return {
      subsystem_id: String(s.subsystem_id ?? ""),
      subsystem_name: String(s.subsystem_name ?? ""),
      equipment_type: (s.equipment_type as EquipmentType) ?? "Other",
      description: String(s.description ?? ""),
      assemblies: [],
      excluded: Boolean(s.excluded),
    };
  });
}

// --- State Pattern (drives Section 3 table format) ---

export type StatePattern = "static" | "sequential";

export interface OperatingState {
  state_id: string;
  state_name: string;
  description: string;
  state_pattern: StatePattern;
}

/** Default pattern inference from state name */
export function inferStatePattern(stateName: string): StatePattern {
  const lower = stateName.toLowerCase();
  if (
    lower.includes("idle") ||
    lower.includes("e-stop") ||
    lower.includes("estop") ||
    lower.includes("emergency") ||
    lower.includes("completed") ||
    lower.includes("stopped") ||
    lower.includes("abort") ||
    lower.includes("held")
  ) {
    return "static";
  }
  return "sequential";
}

/** Migrate legacy OperatingState (no state_pattern) */
export function migrateOperatingState(raw: unknown): OperatingState {
  const s = raw as Record<string, unknown>;
  return {
    state_id: String(s.state_id ?? ""),
    state_name: String(s.state_name ?? ""),
    description: String(s.description ?? ""),
    state_pattern: (s.state_pattern as StatePattern) ?? inferStatePattern(String(s.state_name ?? "")),
  };
}

/** Migrate an array of legacy OperatingStates */
export function migrateOperatingStates(raw: unknown[]): OperatingState[] {
  return raw.map(migrateOperatingState);
}

export interface AlarmTier {
  tier_id: string;
  tier_name: string;
  description: string;
}

// --- Spec Sections ---

export interface SpecSection {
  id: string;
  spec_project_id: string;
  section_type: SpecSectionType;
  subsystem_id: string | null;
  state_name: string | null;
  content_json: Record<string, unknown>;
  content_markdown: string | null;
  model_used: string | null;
  generation_prompt: string | null;
  token_usage: TokenUsage;
  reviewed_by: string | null;
  review_notes: string | null;
  approved: boolean;
  created_at: string;
  updated_at: string;
}

export type SpecSectionType =
  // V2 section types (industry-standard FDS)
  | "document_control"         // Section 0
  | "system_overview"          // Section 1
  | "control_philosophy"       // Section 2
  | "functional_description"   // Section 3 (per subsystem × state)
  | "io_list"                  // Section 4
  | "alarm_specification"      // Section 5
  | "hmi_specification"        // Section 6
  | "interfaces"               // Section 7
  | "testing_fat"              // Section 8
  | "audit_report"             // Gap audit (Opus)
  // Legacy V1 types (kept for backward compatibility)
  | "introduction"
  | "equipment_description"
  | "functional_state"
  | "alarm_table"
  | "settings_table";

// --- Spec Exports ---

export interface SpecExport {
  id: string;
  spec_project_id: string;
  revision: string;
  exported_at: string;
  exported_by: string | null;
  storage_path: string | null;
  page_count: number | null;
  status: "pending" | "complete" | "failed";
}

// --- Column mapping for register parsing ---

export interface ColumnMapping {
  tag: number | null;
  device_type: number | null;
  description: number | null;
  signal_type: number | null;
  io_address: number | null;
  subsystem: number | null;
}

export const CANONICAL_COLUMN_NAMES: Record<keyof ColumnMapping, string[]> = {
  tag: ["tag", "tag number", "tag no", "tag no.", "instrument tag", "device tag", "tag_no"],
  device_type: ["device", "device type", "type", "instrument type", "device_type"],
  description: ["description", "desc", "function", "instrument description"],
  signal_type: ["signal", "signal type", "io type", "signal_type"],
  io_address: ["address", "io address", "plc address", "%i", "%q", "io_address"],
  subsystem: ["subsystem", "sub system", "system", "area", "unit", "group"],
} as const;

// --- Equipment type inference from prefix ---

// --- V2 Section Content JSON Shapes ---
// These interfaces document the expected AI output for each section type.

/** Section 0 — Document Control */
export interface DocControlContent {
  revision_history: Array<{ rev: string; date: string; description: string; author: string }>;
  referenced_documents: Array<{ doc_code: string; title: string; revision: string }>;
  acronyms: Array<{ term: string; definition: string }>;
}

/** Section 1 — System Overview */
export interface SystemOverviewContent {
  hardware_description: string;
  io_summary: IoSummaryRow[];
  scope_exclusions: string;
  safety_classification: string;
}

export interface IoSummaryRow {
  subsystem_id: string;
  subsystem_name: string;
  di_count: number;
  do_count: number;
  ai_count: number;
  ao_count: number;
}

/** Section 2 — Control Philosophy */
export interface ControlPhilosophyContent {
  state_list: Array<{ state_name: string; pattern: StatePattern; brief: string }>;
  mode_transitions: string;
  fault_philosophy: string;
  design_principles: string[];
}

/** Section 3 — Functional Description (per subsystem × state) */
export interface FunctionalDescriptionContent {
  pattern: StatePattern;
  // Pattern A (static) — device state table
  device_states?: DeviceStateEntry[];
  // Pattern B (sequential) — step table
  permissives?: string[];
  steps?: StepEntry[];
  // Both patterns
  notes?: string;
}

export interface DeviceStateEntry {
  tag: string;
  description: string;
  state: string; // e.g. "STOP", "DE-ENERGISED", "OPEN"
}

export interface StepEntry {
  step: number;
  action: string;
  completion_criteria: string;
}

/** Section 3 preamble — equipment description (per subsystem, no state) */
export interface EquipmentDescriptionContent {
  prose: string;
  device_table: Array<{ device: string; tag: string; description: string }>;
}

/** Section 4 — I/O List */
export interface IoListContent {
  io_entries: IoListEntry[];
}

export interface IoListEntry {
  tag: string;
  device_type: string;
  description: string;
  signal_type: string;
  io_address: string;
  normal_state: string;
  failsafe_state: string;
}

/** Section 5 — Alarm Specification */
export interface AlarmSpecificationContent {
  alarm_tiers: Array<{
    tier_name: string;
    alarms: Array<{
      tag: string;
      description: string;
      action: string;
      setpoint: string;
      delay: string;
    }>;
  }>;
  cause_effect_matrix: CauseEffectMatrix;
}

export interface CauseEffectMatrix {
  effects: string[];
  causes: CauseEffectEntry[];
}

export interface CauseEffectEntry {
  cause: string;
  cause_tag: string;
  effects: boolean[];
}

/** Section 6 — HMI Specification */
export interface HmiSpecificationContent {
  screen_hierarchy: Array<{ screen_name: string; parent: string | null; description: string }>;
  access_levels: Array<{ level: number; name: string; capabilities: string[] }>;
  trending: Array<{ tag: string; description: string; sample_rate: string }>;
}

/** Section 8 — Testing / FAT */
export interface TestingFatContent {
  test_procedures: Array<{
    test_id: string;
    description: string;
    section_ref: string;
    acceptance_criteria: string;
    result: string;
  }>;
}

// --- FDS Co-Author System ---

export type FdsSessionStatus = "not_started" | "static_confirmed" | "in_progress" | "complete";

/** Per-assembly co-authoring session */
export interface FdsAssemblySession {
  id: string;
  spec_project_id: string;
  subsystem_id: string;
  assembly_id: string;
  status: FdsSessionStatus;
  // Static states: { [state_id]: DeviceStateEntry[] }
  static_states: Record<string, DeviceStateEntry[]>;
  static_confirmed: boolean;
  // Sequential states: { [state_id]: SequentialStateData }
  sequential_states: Record<string, SequentialStateV2>;
  // Conversation audit trail
  conversation: FdsConversationTurn[];
  // Duplicate tracking
  duplicated_from: string | null;
  tag_remap: Record<string, string>;
  // Validation
  validation_results: FdsValidationResult | null;
  token_usage: TokenUsage;
  created_at: string;
  updated_at: string;
}

export interface SequentialStateData {
  permissives: string[];
  steps: StepEntry[];
  notes: string | null;
}

export interface FdsConversationTurn {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  state_context?: string;
  table_delta?: Partial<SequentialStateData>;
}

/** Subsystem-level orchestration — how assemblies coordinate */
export interface SubsystemOrchestration {
  id: string;
  spec_project_id: string;
  subsystem_id: string;
  // Per sequential state: assembly ordering + inter-assembly interlocks
  state_sequences: Record<string, SubsystemStateSequence>;
  // Conversation for orchestration interview
  conversation: FdsConversationTurn[];
  validation_results: FdsValidationResult | null;
  token_usage: TokenUsage;
  created_at: string;
  updated_at: string;
}

export interface SubsystemStateSequence {
  assembly_order: string[];
  shared_permissives: string[];
  inter_assembly_interlocks: InterAssemblyInterlock[];
  notes: string | null;
}

export interface InterAssemblyInterlock {
  source_assembly: string;
  source_condition: string;
  target_assembly: string;
  effect: string;
}

/** Validation result for logic checker */
export interface FdsValidationResult {
  passed: boolean;
  checked_at: string;
  issues: FdsValidationIssue[];
}

export interface FdsValidationIssue {
  severity: "error" | "warning" | "info";
  category:
    | "tag_coverage"
    | "permissive_ref"
    | "completion_ref"
    | "circular_interlock"
    | "missing_failure_path"
    | "state_completeness"
    | "cross_subsystem"
    | "orchestration";
  message: string;
  assembly_id?: string;
  state_id?: string;
  tag?: string;
}

// --- Equipment type inference from prefix ---

export const SUBSYSTEM_PREFIX_MAP: Array<{ pattern: RegExp; type: EquipmentType }> = [
  { pattern: /hopper|^TE/i, type: "Hopper" },
  { pattern: /^VZ|transporter/i, type: "Pneumatic Transporter" },
  { pattern: /^HX|dryer/i, type: "Dryer" },
  { pattern: /^VK|cooler/i, type: "Cooler" },
  { pattern: /^NZ|unloading/i, type: "Unloading Station" },
  { pattern: /^CA|magnetic.*filter/i, type: "Magnetic Filter" },
  { pattern: /^GK|fan|blower/i, type: "Fan/Blower" },
  { pattern: /mill/i, type: "Milling" },
  { pattern: /conv/i, type: "Conveyor" },
];
