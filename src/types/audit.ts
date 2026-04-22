// Types for the Pac-Audit reverse-engineering module

import type { SpecContractV2 } from "@/types/spec-contract-v2";

// ---------------------------------------------------------------------------
// Wizard steps
// ---------------------------------------------------------------------------

// CLASSIFY / TRACE / VERIFY added for the derived-spec pipeline
// (see Docs/PAC_AUDIT_DERIVED_SPEC.md §4.1). The legacy REVIEW step is
// retained during the transitional period — navigation ordering still
// routes analyze → review → ready until the Verify UI lands (step 21 of
// §16); hooks/stores can reference CLASSIFY/TRACE/VERIFY today.
export const AUDIT_STEPS = {
  CONNECT: "connect",
  EXTRACT: "extract",
  SELECT: "select",
  ANALYZE: "analyze",
  CLASSIFY: "classify",
  TRACE: "trace",
  VERIFY: "verify",
  REVIEW: "review",
  READY: "ready",
} as const;

export type AuditStep = (typeof AUDIT_STEPS)[keyof typeof AUDIT_STEPS];

export const AUDIT_STEP_LABELS: Record<AuditStep, string> = {
  connect: "Connect",
  extract: "Extract",
  select: "Select",
  analyze: "Analyze",
  classify: "Classify",
  trace: "Trace",
  verify: "Verify",
  review: "Review",
  ready: "Ready",
};

export const AUDIT_STEP_ORDER: AuditStep[] = [
  "connect",
  "extract",
  "select",
  "analyze",
  "classify",
  "review",
  "ready",
];

// ---------------------------------------------------------------------------
// Analysis status state machine
// ---------------------------------------------------------------------------

export type BlockAnalysisStatus =
  | "extracted"
  | "queued"
  | "analyzing"
  | "understood"
  | "modified"
  | "testing"
  | "tested"
  | "failed";

export type ExtractionStatus = "pending" | "extracting" | "extracted" | "failed";

export type AuditType = "targeted" | "full";

// ---------------------------------------------------------------------------
// Block types
// ---------------------------------------------------------------------------

export type PlcBlockType = "FB" | "FC" | "OB" | "DB" | "UDT" | "SFB" | "SFC";

export type ProgrammingLanguage =
  | "SCL"
  | "LAD"
  | "FBD"
  | "STL"
  | "GRAPH"
  | "DB"
  | "UDT";

export type SourceFormat = "scl" | "xml" | "awl";

export type CompileStatus = "unknown" | "clean" | "errors" | "warnings";

// ---------------------------------------------------------------------------
// Cross-reference types
// ---------------------------------------------------------------------------

export type CrossReferenceType =
  | "calls"
  | "instantiates"
  | "reads"
  | "writes"
  | "uses_type"
  | "inherits"
  | "triggers"
  | "references_tag";

// ---------------------------------------------------------------------------
// Convention types
// ---------------------------------------------------------------------------

export type ConventionType =
  | "block_naming"
  | "tag_naming"
  | "variable_naming"
  | "folder_structure"
  | "db_naming"
  | "comment_style"
  | "numbering_scheme"
  | "io_addressing";

// ---------------------------------------------------------------------------
// Modification types
// ---------------------------------------------------------------------------

export type ModificationType =
  | "source_edit"
  | "interface_change"
  | "refactor"
  | "bugfix"
  | "optimization"
  | "comment_update"
  | "reimport";

// ---------------------------------------------------------------------------
// Test environment
// ---------------------------------------------------------------------------

export type TestEnvironment = "plcsim" | "physical_plc";
export type TestRunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

// ---------------------------------------------------------------------------
// Conversation context types
// ---------------------------------------------------------------------------

export type AuditConversationContext =
  | "general"
  | "onboarding"
  | "block_analysis"
  | "modification"
  | "impact_review";

// ---------------------------------------------------------------------------
// Database row types (matching Supabase schema)
// ---------------------------------------------------------------------------

export interface AuditProject {
  id: string;
  user_id: string;
  project_id: string | null;
  design_profile_id: string | null;
  name: string;
  description: string | null;
  tia_project_path: string;
  audit_type: AuditType;
  tia_version: string | null;
  cpu_order_number: string | null;
  cpu_family: string | null;
  extraction_status: ExtractionStatus;
  extracted_at: string | null;
  extraction_stats: ExtractionStats;
  current_step: AuditStep;
  step_statuses: Record<AuditStep, string>;
  analysis_progress: AnalysisProgress;
  // Derived-spec layer (migration 073). See PAC_AUDIT_DERIVED_SPEC.md §3.1.
  derived_spec: DerivedSpec | Record<string, never>;
  derived_spec_version: number;
  spec_provenance: SpecProvenanceMap;
  tia_project_modified_at: string | null;
  cross_refs_extracted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExtractionStats {
  block_count?: number;
  udt_count?: number;
  tag_count?: number;
  hmi_screen_count?: number;
  hw_device_count?: number;
  library_count?: number;
}

export interface AnalysisProgress {
  total_blocks?: number;
  analyzed?: number;
  pending?: number;
  failed?: number;
}

export interface AuditFolder {
  id: string;
  audit_project_id: string;
  parent_folder_id: string | null;
  name: string;
  folder_type: string;
  path: string;
  depth: number;
  created_at: string;
}

export interface AuditBlock {
  id: string;
  audit_project_id: string;
  folder_id: string | null;
  name: string;
  block_type: PlcBlockType;
  block_number: number | null;
  programming_language: ProgrammingLanguage;
  source_code: string | null;
  source_format: SourceFormat;
  interface_definition: Record<string, unknown>;
  analysis_status: BlockAnalysisStatus;
  analysis_error: string | null;
  analyzed_at: string | null;
  line_count: number | null;
  complexity_score: number | null;
  compile_status: CompileStatus;
  compile_errors: unknown[];
  created_at: string;
  updated_at: string;
}

export interface AuditBlockUnderstanding {
  id: string;
  block_id: string;
  audit_project_id: string;
  purpose: string | null;
  category: string | null;
  complexity_rating: string | null;
  has_state_machine: boolean;
  state_machine: StateMachineAnalysis | null;
  data_flow: DataFlowAnalysis;
  timing_analysis: TimingAnalysis;
  fault_handling: { description: string } | null;
  interface_contract: InterfaceContract;
  code_quality: CodeQualityAnalysis;
  detailed_notes: string | null;
  model_used: string | null;
  token_usage: Record<string, number>;
  version: number;
  is_current: boolean;
  created_at: string;
}

export interface StateMachineAnalysis {
  mechanism: "case_on_variable" | "seal_in_latch_chain" | "step_counter" | "other";
  state_variable: string | null;
  states: string[];
  transitions: Array<{ from: string; to: string; condition: string }>;
}

export interface DataFlowAnalysis {
  called_blocks?: Array<{
    name: string;
    kind: "project" | "library";
    call_context: "instance_db" | "static_call" | "parameter_call" | "unknown";
  }>;
  reads_from?: Array<{
    reference: string;
    kind: "project_db" | "other_instance_db" | "global_memory" | "io_input";
  }>;
  writes_to?: Array<{
    reference: string;
    kind: "project_db" | "other_instance_db" | "global_memory" | "io_output";
  }>;
  key_static_vars?: Array<{ name: string; type: string; role: string }>;
}

export interface TimingAnalysis {
  timers_used?: Array<{
    instance: string;
    type: string;
    preset_source: "static" | "parameter" | "constant" | "db_field";
  }>;
  notes?: string | null;
}

export interface InterfaceContract {
  inputs?: Array<{ name: string; type: string; meaning: string }>;
  outputs?: Array<{ name: string; type: string; meaning: string }>;
  in_out?: Array<{ name: string; type: string; meaning: string }>;
  members?: Array<{ name: string; type: string; initial: string | null; meaning: string }>;
}

export interface CodeQualityAnalysis {
  deviations_from_conventions?: string[];
  risks?: string[];
  analysis_confidence?: "high" | "medium" | "low";
  confidence_notes?: string | null;
}

/**
 * One row per Openness `(SourceObject → ReferenceObject → Location)` triple.
 * Reshaped in migration 073 to match the bridge DTO. `target_block_id` is
 * nullable because many references target tags or absolute addresses.
 * `access` / `reference_type` are free-form strings carrying the Openness
 * `Access` and `ReferenceType` enums respectively — no CHECK constraint
 * (see PAC_AUDIT_DERIVED_SPEC.md §12.0).
 */
export interface AuditCrossReference {
  id: string;
  audit_project_id: string;
  source_block_id: string;
  target_block_id: string | null;

  // Openness enums — widened beyond the legacy CrossReferenceType union.
  access: string | null;
  reference_type: string | null;

  source_name: string | null;
  source_path: string | null;
  source_address: string | null;
  source_type_name: string | null;
  source_device: string | null;

  target_name: string | null;
  target_path: string | null;
  target_address: string | null;
  target_type_name: string | null;
  target_device: string | null;

  reference_location: string | null;
  referenced_as_name: string | null;
  location_address: string | null;
  location_name: string | null;
  location_type_name: string | null;

  reference_details: Record<string, unknown>;
  reference_count: number;
  created_at: string;
}

export interface AuditTagTable {
  id: string;
  audit_project_id: string;
  name: string;
  tags: AuditTag[];
  tag_count: number;
  created_at: string;
}

export interface AuditTag {
  name: string;
  data_type: string;
  address: string | null;
  comment: string | null;
  is_retain: boolean;
}

export interface AuditHardwareConfig {
  id: string;
  audit_project_id: string;
  devices: HwDevice[];
  io_modules: HwIoModule[];
  networks: HwNetwork[];
  drives: HwDrive[];
  hmi_panels: HwHmiPanel[];
  safety_config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface HwDevice {
  name: string;
  type_id: string;
  order_number: string;
  rack: number;
  slot: number;
  firmware_version: string | null;
  ip_address: string | null;
}

export interface HwIoModule {
  mlfb: string;
  rack: number;
  slot: number;
  description: string;
  channel_count: number;
  signal_type: string;
}

export interface HwNetwork {
  name: string;
  type: string;
  subnet_mask: string | null;
  devices: string[];
}

export interface HwDrive {
  name: string;
  type: string;
  address: string;
  telegram_type: string | null;
  parameters: Record<string, unknown>;
}

export interface HwHmiPanel {
  name: string;
  type: string;
  order_number: string;
  resolution: string | null;
  ip_address: string | null;
}

export interface AuditHmiScreen {
  id: string;
  audit_project_id: string;
  name: string;
  screen_number: number | null;
  folder_path: string | null;
  width: number | null;
  height: number | null;
  content_xml: string | null;
  content_json: Record<string, unknown>;
  tag_bindings: HmiTagBinding[];
  purpose: string | null;
  connected_blocks: string[] | null;
  created_at: string;
}

export interface HmiTagBinding {
  element_name: string;
  property: string;
  hmi_tag: string;
  plc_tag: string;
}

export interface AuditNamingConvention {
  id: string;
  audit_project_id: string;
  convention_type: ConventionType;
  pattern: string;
  description: string;
  examples: string[];
  confidence: number;
  occurrence_count: number;
  total_count: number;
  deviations: NamingDeviation[];
  created_at: string;
}

export interface NamingDeviation {
  block_name: string;
  expected: string;
  actual: string;
  note: string;
}

export interface AuditModification {
  id: string;
  audit_project_id: string;
  block_id: string;
  user_id: string;
  modification_type: ModificationType;
  description: string;
  source_before: string | null;
  source_after: string | null;
  diff_hunks: unknown[];
  ai_assisted: boolean;
  ai_model: string | null;
  ai_prompt: string | null;
  reimported_to_tia: boolean;
  reimport_result: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditImpactAnalysis {
  id: string;
  audit_project_id: string;
  trigger_block_id: string;
  requested_by: string;
  change_type: string;
  change_description: string | null;
  directly_affected: ImpactEntry[];
  indirectly_affected: ImpactEntry[];
  hmi_affected: HmiImpact[];
  tag_affected: TagImpact[];
  risk_level: string;
  summary: string | null;
  created_at: string;
}

export interface ImpactEntry {
  block_id: string;
  block_name: string;
  impact_type: string;
  severity: string;
  reason: string;
}

export interface HmiImpact {
  screen_name: string;
  elements_affected: string[];
}

export interface TagImpact {
  tag_table: string;
  tag_name: string;
  usage: string;
}

export interface AuditTestRun {
  id: string;
  audit_project_id: string;
  user_id: string;
  test_environment: TestEnvironment;
  plcsim_instance_name: string | null;
  plc_ip_address: string | null;
  tested_block_ids: string[];
  modification_ids: string[];
  status: TestRunStatus;
  started_at: string | null;
  completed_at: string | null;
  test_suite: Record<string, unknown>;
  summary: TestRunSummary;
  notes: string | null;
  error_message: string | null;
  created_at: string;
}

export interface TestRunSummary {
  total?: number;
  passed?: number;
  failed?: number;
  errors?: number;
  skipped?: number;
}

export interface AuditConversation {
  id: string;
  audit_project_id: string;
  user_id: string;
  block_id: string | null;
  context_type: AuditConversationContext;
  title: string | null;
  messages: AuditMessage[];
  created_at: string;
  updated_at: string;
}

export interface AuditMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  model?: string;
  token_usage?: Record<string, number>;
}

export interface AuditLibrary {
  id: string;
  audit_project_id: string;
  library_type: "project" | "global";
  name: string;
  path: string | null;
  items: LibraryItem[];
  created_at: string;
}

export interface LibraryItem {
  name: string;
  path: string;
  kind: string;
  description: string | null;
}

// ---------------------------------------------------------------------------
// Create/update input types
// ---------------------------------------------------------------------------

export interface AuditProjectCreate {
  name: string;
  description?: string;
  tia_project_path: string;
  audit_type: AuditType;
  project_id?: string;
  design_profile_id?: string;
  tia_version?: string;
  cpu_order_number?: string;
  cpu_family?: string;
}

// ---------------------------------------------------------------------------
// Extraction progress (WebSocket events from bridge)
// ---------------------------------------------------------------------------

export interface ExtractionProgressEvent {
  category: string;
  status: "started" | "progress" | "complete" | "error";
  current?: number;
  total?: number;
  message?: string;
}

// ---------------------------------------------------------------------------
// Analysis pipeline types
// ---------------------------------------------------------------------------

export interface AnalysisClarificationQuestion {
  blockId: string;
  blockName: string;
  question: string;
  codeSnippet: string;
  suggestedOptions: string[];
}

// ---------------------------------------------------------------------------
// Block tree node (for UI rendering)
// ---------------------------------------------------------------------------

export interface AuditBlockTreeNode {
  id: string;
  name: string;
  type: "folder" | "block";
  blockType?: PlcBlockType;
  language?: ProgrammingLanguage;
  analysisStatus?: BlockAnalysisStatus;
  lineCount?: number;
  children: AuditBlockTreeNode[];
}

// ---------------------------------------------------------------------------
// Derived spec (migration 073) — alias onto SpecContractV2.
// Pac-Audit and the FDS Builder converge on the same shape; we don't need a
// separate `core/` type layer yet (§2, §14).
// ---------------------------------------------------------------------------

export type DerivedSpec = SpecContractV2;

export type SpecProvenanceValue =
  | "extracted"
  | "classified"
  | "traced"
  | "doc_ingest"
  | "interview"
  | "engineer_edit";

/** Maps spec paths ("hierarchy.subsystems.0.assemblies.0.devices.0") → source. */
export type SpecProvenanceMap = Record<string, SpecProvenanceValue>;

// ---------------------------------------------------------------------------
// FB classifications — per-block role assignment. See §3.3, §5.
// ---------------------------------------------------------------------------

export const FB_ROLES = [
  "device",
  "io_mapper",
  "dispatcher",
  "assembly",
  "subsystem",
  "sequence",
  "utility",
  "safety",
  "comms",
  "fault",
  "logic",
  "ob",
  "unknown",
] as const;

export type FbRole = (typeof FB_ROLES)[number];

export interface HierarchyAssignment {
  subsystem_id?: string;
  assembly_id?: string;
  device_id?: string;
}

export interface AuditFbClassification {
  id: string;
  audit_project_id: string;
  block_id: string;
  role: FbRole;
  auto_confidence: number | null;
  auto_reason: string | null;
  engineer_confirmed: boolean;
  engineer_override_role: FbRole | null;
  hierarchy_assignment: HierarchyAssignment | null;
  created_at: string;
  updated_at: string;
}

export interface AuditFbClassificationInsert {
  audit_project_id: string;
  block_id: string;
  role: FbRole;
  auto_confidence?: number | null;
  auto_reason?: string | null;
  engineer_confirmed?: boolean;
  engineer_override_role?: FbRole | null;
  hierarchy_assignment?: HierarchyAssignment | null;
}

// ---------------------------------------------------------------------------
// IO-to-FB link (materialised walk cache). See §3.3, §6.
// ---------------------------------------------------------------------------

export type IoDirection = "input" | "output";

export type WalkStatus =
  | "resolved"
  | "multiple_writers"
  | "indirect"
  | "unclassified"
  | "unresolved";

export type PhysicalDeviceSource = "hw_config" | "doc_ingest" | "engineer";

export interface WalkHop {
  block_id: string;
  /** kind of hop: `writer` (direct writer), `dispatcher` (intermediate coordinator),
   *  `udt_owner` (walked through a UDT field), `fb_instance` (hit an FB instance). */
  kind: "writer" | "dispatcher" | "udt_owner" | "fb_instance";
  /** Human-readable edge label, e.g. "M03_CMD := MOT[5].CTRL.RunFwd". */
  via: string;
}

export interface AuditIoFbLink {
  id: string;
  audit_project_id: string;
  io_address: string;
  io_module_ref: string | null;
  symbolic_tag: string | null;
  direction: IoDirection;
  device_fb_block_id: string | null;
  device_fb_instance_path: string | null;
  walk_path: WalkHop[] | null;
  walk_status: WalkStatus;
  walk_notes: string | null;
  physical_device_guess: string | null;
  physical_device_source: PhysicalDeviceSource | null;
  engineer_verified: boolean;
  engineer_override_device_fb_block_id: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Reference docs (uploaded priors). See §3.3, §9.
// ---------------------------------------------------------------------------

export type ReferenceDocType =
  | "fds"
  | "io_list"
  | "p_and_id"
  | "electrical_schematic"
  | "commissioning_notes"
  | "hmi_export"
  | "other";

export type ReferenceDocParseStatus = "pending" | "parsed" | "failed";

export interface ReferenceDocPriors {
  devices?: Array<{ name: string; tag?: string; description?: string }>;
  tags?: Array<{
    tag: string;
    address?: string;
    physical_device?: string;
    description?: string;
  }>;
  states?: Array<{ state_id?: string; state_name: string; description?: string }>;
  alarms?: Array<{ tag: string; description: string; tier?: string }>;
  prose?: string;
}

export interface AuditReferenceDoc {
  id: string;
  audit_project_id: string;
  doc_type: ReferenceDocType;
  filename: string;
  storage_path: string | null;
  raw_text: string | null;
  parsed_priors: ReferenceDocPriors;
  parse_status: ReferenceDocParseStatus;
  parse_error: string | null;
  uploaded_at: string;
  uploaded_by: string | null;
}

export interface AuditReferenceDocInsert {
  audit_project_id: string;
  doc_type: ReferenceDocType;
  filename: string;
  storage_path?: string | null;
  raw_text?: string | null;
  parsed_priors?: ReferenceDocPriors;
  parse_status?: ReferenceDocParseStatus;
  parse_error?: string | null;
}

// ---------------------------------------------------------------------------
// Module channels (per-channel IO detail). See §12.6.
// ---------------------------------------------------------------------------

export type IoSignalType = "DI" | "DO" | "AI" | "AO" | "DIQ" | "RS485" | "other";

export type ChannelCountSource =
  | "length_in_bits"
  | "length_bytes"
  | "name_pattern"
  | "single_row";

export interface AuditModuleChannel {
  id: string;
  audit_project_id: string;
  module_name: string;
  module_mlfb: string | null;
  channel_number: number;
  io_address: string | null;
  signal_type: IoSignalType | null;
  symbolic_tag: string | null;
  is_safety: boolean;
  channel_comment: string | null;
  channel_count_source: ChannelCountSource | null;
  rack: number | null;
  slot: number | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// IO-Link devices (master-port-device hierarchy). See §12.6.
// ---------------------------------------------------------------------------

export interface AuditIoLinkDevice {
  id: string;
  audit_project_id: string;
  master_module_name: string;
  port_number: number;
  vendor_id: string;
  product_id: string;
  product_name: string | null;
  iodd_sha: string | null;
  process_data_in: Record<string, unknown> | null;
  process_data_out: Record<string, unknown> | null;
  parameters: Record<string, unknown> | null;
  created_at: string;
}
