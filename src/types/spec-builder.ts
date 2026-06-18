// Spec Builder types — functional specification document generation
import type { PermissiveCondition, SequentialStateV2, OperatorMode, SafetyGateV2, EmStateV2, EmTransitionV2 } from "./spec-contract-v2";

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
  // Machine-level layer (replaces the removed global states): per-machine
  // operating modes + safety gates. States now live per-equipment-module
  // (fds_operation_sessions.em_states).
  confirmed_modes?: OperatorMode[];
  safety_gates?: SafetyGateV2[];
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
  confirmed_modes?: OperatorMode[];
  safety_gates?: SafetyGateV2[];
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
  // Enriched by AI / deterministic classification
  control_module_class: ControlModuleClass;
  signal_direction: SignalDirection;
  unit_prefix: string;
  is_safety: boolean;
  // ISA-88 Physical Model hierarchy assignment (from column or AI-inferred)
  process_cell: string;
  unit: string;
  equipment_module: string;
  control_module: string;
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
  /** Provenance: 'upload' (engineer-supplied) or 'ingest' (synthesized from a .docx). */
  source: "upload" | "ingest";
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

/**
 * A per-equipment-module operating state, projected to a flat display shape.
 * Derived from the EM's OWN states (EmStateV2) — the legacy global
 * operating-states layer (and its migrate*() helpers) was removed.
 */
export interface OperatingState {
  state_id: string;
  state_name: string;
  description: string;
  state_pattern: StatePattern;
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
  process_cell: number | null;
  unit: number | null;
  equipment_module: number | null;
  control_module: number | null;
  tag: number | null;
  device_type: number | null;
  description: number | null;
  signal_type: number | null;
  io_address: number | null;
  // Optional explicit safety-flag column (deterministic override of inferred is_safety)
  is_safety: number | null;
}

export const CANONICAL_COLUMN_NAMES: Record<keyof ColumnMapping, string[]> = {
  process_cell: ["process cell", "process_cell", "cell", "line", "plant"],
  unit: ["unit", "sub system", "system", "area", "group"],
  equipment_module: ["equipment module", "equipment_module", "assembly name", "equipment", "equipment group", "machine", "station", "em"],
  control_module: ["control module", "control_module", "device name", "device id", "cm", "instrument"],
  tag: ["tag", "tag number", "tag no", "tag no.", "instrument tag", "device tag", "tag_no"],
  // NB: no bare "type"/"device" aliases here — they greedily steal the
  // "Signal Type" / "Device Name" columns from signal_type / control_module.
  device_type: ["device type", "instrument type", "device_type", "device class"],
  description: ["description", "desc", "function", "instrument description"],
  signal_type: ["signal", "signal type", "io type", "signal_type"],
  io_address: ["address", "io address", "plc address", "%i", "%q", "io_address"],
  is_safety: ["is_safety", "safety", "safety critical"],
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
  // Hybrid per-EM state model (Task 5/9b) — the EM's OWN authored states +
  // transitions. EM-local string slugs become the keys of static_states /
  // sequential_states. Empty until Stage A authors them.
  em_states?: EmStateV2[];
  em_transitions?: EmTransitionV2[];
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
    | "orchestration"
    | "isa88_compliance";
  message: string;
  equipment_module_id?: string;
  state_id?: string;
  tag?: string;
}

// --- Equipment type inference from prefix ---

// Match only on descriptive words — NOT short tag-prefix codes. The old
// project-specific prefixes (^TE/^VZ/^HX/^VK/^NZ/^CA/^GK) misfired on real unit
// names (e.g. "^CA" classified "Carriage" as a Magnetic Filter). Anything not
// recognised here falls back to "Other".
export const UNIT_PREFIX_MAP: Array<{ pattern: RegExp; type: EquipmentType }> = [
  { pattern: /hopper/i, type: "Hopper" },
  { pattern: /transporter/i, type: "Pneumatic Transporter" },
  { pattern: /dryer/i, type: "Dryer" },
  { pattern: /cooler/i, type: "Cooler" },
  { pattern: /unloading/i, type: "Unloading Station" },
  { pattern: /magnetic.*filter/i, type: "Magnetic Filter" },
  { pattern: /fan|blower/i, type: "Fan/Blower" },
  { pattern: /mill/i, type: "Milling" },
  { pattern: /conv(?:ey)?/i, type: "Conveyor" },
];
