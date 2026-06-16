// Spec Builder types — functional specification document generation
import type { PermissiveCondition, SequentialStateV2 } from "./spec-contract-v2";

// --- ISA-88 Process Model (§4.3) ---
// Describes WHAT happens to the product (product-centric), not HOW equipment does it.
// Links to the Procedural Control Model and Physical Model:
//   Process Stage ↔ Unit Procedure ↔ Unit
//   Process Operation ↔ Operation ↔ Equipment Module
//   Process Action ↔ Phase ↔ Control Module action

export interface ProcessAction {
  action_id: string;
  action_name: string;
  description: string;
  /** Optional link to the control module tag that executes this action */
  control_module_tag?: string;
}

export interface ProcessOperation {
  operation_id: string;
  operation_name: string;
  description: string;
  /** Links to an equipment_module_id in UnitConfig.equipment_modules */
  equipment_module_id: string;
  actions: ProcessAction[];
}

export interface ProcessStage {
  stage_id: string;
  stage_name: string;
  description: string;
  /** Links to a unit_id in confirmed_units */
  unit_id: string;
  operations: ProcessOperation[];
  /** Execution order within the process (1-based) */
  order: number;
}

export interface ProcessModel {
  process_name: string;
  process_description: string;
  stages: ProcessStage[];
}

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
  confirmed_units: UnitConfig[];
  confirmed_states: OperatingState[];
  alarm_tiers: AlarmTier[];
  // V2 fields — scope & philosophy
  scope_exclusions: string[];
  safety_classification: string | null;
  fault_philosophy: string | null;
  design_principles: string[];
  // Status
  status: "draft" | "generating" | "review" | "complete";
  // FDS Engine Phase 1 — per-project migration gate (migration 088)
  confirmation_status: "unconfirmed" | "confirmed";
  // ISA-88 Process Model (migration 091)
  process_model: ProcessModel | null;
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
  confirmed_units?: UnitConfig[];
  confirmed_states?: OperatingState[];
  alarm_tiers?: AlarmTier[];
  scope_exclusions?: string[];
  safety_classification?: string;
  fault_philosophy?: string;
  design_principles?: string[];
  status?: SpecProject["status"];
  process_model?: ProcessModel | null;
}

// --- Instrument Register ---

export interface InstrumentTag {
  tag: string;
  device_type: string;
  description: string;
  signal_type: string;
  io_address: string;
  // Enriched by Haiku
  control_module_class: ControlModuleClass;
  signal_direction: SignalDirection;
  unit_prefix: string;
  is_safety: boolean;
  // Assigned unit + equipment module
  unit: string;
  equipment_module: string;
}

export type ControlModuleClass =
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
  units: UnitSummary[];
  parse_warnings: ParseWarning[];
  haiku_usage: TokenUsage;
  created_at: string;
}

export interface UnitSummary {
  unit_id: string;
  unit_name: string;
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

// --- Machine Hierarchy — ISA-88 §4.4 (wizard) ---
// Process Cell → Unit → Equipment Module → Control Module (each 1-to-many downstream)

export interface IoSignal {
  tag: string;
  signal_type: string;
  io_address: string;
  description: string;
}

export interface ControlModuleConfig {
  control_module_id: string;
  control_module_name: string;
  control_module_class: ControlModuleClass;
  description: string;
  is_safety: boolean;
  io_signals: IoSignal[];
}

export interface EquipmentModuleConfig {
  equipment_module_id: string;
  equipment_module_name: string;
  description: string;
  control_modules: ControlModuleConfig[];
}

export interface UnitConfig {
  unit_id: string;
  unit_name: string;
  equipment_type: EquipmentType;
  description: string;
  equipment_modules: EquipmentModuleConfig[];
  excluded: boolean;
}

/** Compute tag count for a unit by summing IO signals across all devices */
export function getUnitTagCount(sub: UnitConfig): number {
  return sub.equipment_modules.reduce(
    (sum, a) => sum + a.control_modules.reduce((ds, d) => ds + d.io_signals.length, 0),
    0
  );
}

/** Compute total control module count for a unit */
export function getUnitControlModuleCount(sub: UnitConfig): number {
  return sub.equipment_modules.reduce((sum, a) => sum + a.control_modules.length, 0);
}

/** Migrate legacy flat UnitConfig (no assemblies) to nested format */
export function migrateUnitConfig(raw: unknown[]): UnitConfig[] {
  return (raw as Record<string, unknown>[]).map((s) => {
    if (Array.isArray(s.equipment_modules)) return s as unknown as UnitConfig;
    // Legacy flat format — wrap in single assembly with no devices
    return {
      unit_id: String(s.unit_id ?? ""),
      unit_name: String(s.unit_name ?? ""),
      equipment_type: (s.equipment_type as EquipmentType) ?? "Other",
      description: String(s.description ?? ""),
      equipment_modules: [],
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
  // V2 producers (random builder, post-Phase 3 prompts) set
  // `display_name` instead of legacy `state_name`. Fall back to it so
  // V1 viewers don't render empty labels for V2-shaped specs.
  const name = String(s.state_name ?? s.display_name ?? "");
  return {
    state_id: String(s.state_id ?? ""),
    state_name: name,
    description: String(s.description ?? ""),
    state_pattern: (s.state_pattern as StatePattern) ?? inferStatePattern(name),
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
  unit_id: string | null;
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
  | "functional_description"   // Section 3 (per unit × state)
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
  unit: number | null;
  equipment_module: number | null;
}

export const CANONICAL_COLUMN_NAMES: Record<keyof ColumnMapping, string[]> = {
  tag: ["tag", "tag number", "tag no", "tag no.", "instrument tag", "device tag", "tag_no"],
  device_type: ["device", "device type", "type", "instrument type", "device_type"],
  description: ["description", "desc", "function", "instrument description"],
  signal_type: ["signal", "signal type", "io type", "signal_type"],
  io_address: ["address", "io address", "plc address", "%i", "%q", "io_address"],
  unit: ["unit", "sub system", "system", "area", "unit", "group"],
  equipment_module: ["equipment_module", "assembly name", "equipment", "equipment group", "machine", "station"],
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
  unit_id: string;
  unit_name: string;
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

/** Section 3 — Functional Description (per unit × state) */
export interface FunctionalDescriptionContent {
  pattern: StatePattern;
  // Pattern A (static) — device state table
  control_module_states?: ControlModuleStateEntry[];
  // Pattern B (sequential) — step table
  permissives?: string[];
  steps?: StepEntry[];
  // Both patterns
  notes?: string;
}

export interface ControlModuleStateEntry {
  tag: string;
  description: string;
  state: string; // e.g. "STOP", "DE-ENERGISED", "OPEN"
}

export interface StepEntry {
  step: number;
  action: string;
  completion_criteria: string;
}

/** Section 3 preamble — equipment description (per unit, no state) */
export interface EquipmentDescriptionContent {
  prose: string;
  control_module_table: Array<{ control_module: string; tag: string; description: string }>;
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

/** Per-equipment-module operation session */
export interface OperationSession {
  id: string;
  spec_project_id: string;
  unit_id: string;
  equipment_module_id: string;
  status: FdsSessionStatus;
  // Static states: { [state_id]: ControlModuleStateEntry[] }
  static_states: Record<string, ControlModuleStateEntry[]>;
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
  permissives: PermissiveCondition[];
  steps: StepEntry[];
  notes: string | null;
}

export interface FdsConversationTurn {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  state_context?: string;
  table_delta?: Partial<SequentialStateV2>;
}

/** Unit-level procedure — how equipment modules coordinate */
export interface UnitProcedure {
  id: string;
  spec_project_id: string;
  unit_id: string;
  // Per sequential state: equipment module ordering + inter-equipment-module interlocks
  state_sequences: Record<string, UnitProcedureSequence>;
  // Conversation for orchestration interview
  conversation: FdsConversationTurn[];
  validation_results: FdsValidationResult | null;
  token_usage: TokenUsage;
  created_at: string;
  updated_at: string;
}

export interface UnitProcedureSequence {
  equipment_module_order: string[];
  shared_permissives: string[];
  inter_equipment_module_interlocks: InterEquipmentModuleInterlock[];
  notes: string | null;
}

export interface InterEquipmentModuleInterlock {
  source_equipment_module: string;
  source_condition: string;
  target_equipment_module: string;
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
    | "cross_unit"
    | "orchestration";
  message: string;
  equipment_module_id?: string;
  state_id?: string;
  tag?: string;
}

// --- Equipment type inference from prefix ---

export const UNIT_PREFIX_MAP: Array<{ pattern: RegExp; type: EquipmentType }> = [
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
