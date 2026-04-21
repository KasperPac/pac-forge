// Types for the Pac-Audit reverse-engineering module

// ---------------------------------------------------------------------------
// Wizard steps
// ---------------------------------------------------------------------------

export const AUDIT_STEPS = {
  CONNECT: "connect",
  EXTRACT: "extract",
  SELECT: "select",
  ANALYZE: "analyze",
  REVIEW: "review",
  READY: "ready",
} as const;

export type AuditStep = (typeof AUDIT_STEPS)[keyof typeof AUDIT_STEPS];

export const AUDIT_STEP_LABELS: Record<AuditStep, string> = {
  connect: "Connect",
  extract: "Extract",
  select: "Select",
  analyze: "Analyze",
  review: "Review",
  ready: "Ready",
};

export const AUDIT_STEP_ORDER: AuditStep[] = [
  "connect",
  "extract",
  "select",
  "analyze",
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

export interface AuditCrossReference {
  id: string;
  audit_project_id: string;
  source_block_id: string;
  target_block_id: string;
  reference_type: CrossReferenceType;
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
