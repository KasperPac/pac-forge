export interface ProcessRuleExample {
  label: string;
  example: string;
  analysis: string;
  /** Base64 data URIs of uploaded screenshots */
  screenshots?: string[];
}

// ── Rule card format ────────────────────────────────────────────────────────

export type RuleStrength = 'MUST' | 'MUST NOT' | 'SHOULD' | 'SHOULD NOT';

export type RuleBlockTarget =
  | 'ALL'
  | 'FB'
  | 'FC'
  | 'OB'
  | 'DB'
  | 'UDT'
  | 'CALL_FC'
  | 'PROCESS_FC'
  | 'DEVICE_FB';

export interface StructuredRule {
  id: string;
  category: string;
  target: RuleBlockTarget;
  strength: RuleStrength;
  statement: string;
  example?: string;
  enabled: boolean;
}

// ── General rules schema ────────────────────────────────────────────────────

export interface NamingRules {
  fb_prefix: string;
  fc_prefix: string;
  db_prefix: string;
  udt_prefix: string;
  instance_db_prefix: string;
  block_name_casing: 'UPPER_SNAKE_CASE' | 'UpperCamelCase' | 'custom';
  param_casing: 'lowerCamelCase' | 'custom';
  static_var_prefix: string;
  temp_var_prefix: string;
  instance_var_prefix: string;
  custom_notes: string;
}

export interface StateMachineRules {
  step_increment: number;
  step_start: number;
  fault_step: number;
  always_has_else: boolean;
  else_action: string;
  custom_notes: string;
}

export interface GeneralRulesSchema {
  version: 2;
  naming: NamingRules;
  state_machine: StateMachineRules;
  extra_rules: StructuredRule[];
  freetext: string;
}

// ── FB rules schema ─────────────────────────────────────────────────────────

export interface FbInterfaceRules {
  pattern: 'plcopen_execute' | 'plcopen_enable' | 'custom';
  include_busy: boolean;
  include_done: boolean;
  include_error: boolean;
  include_status: boolean;
  status_initial_value: string;
  custom_notes: string;
}

export interface AlarmRules {
  latching: boolean;
  reset_via_input: boolean;
  reset_input_name: string;
  custom_notes: string;
}

export interface FbRulesSchema {
  version: 2;
  interface_pattern: FbInterfaceRules;
  alarm_handling: AlarmRules;
  extra_rules: StructuredRule[];
  freetext: string;
}

// ── Process rules schema ─────────────────────────────────────────────────────

export interface StepActionDbRules {
  enabled: boolean;
  db_name_pattern: string;
  step_array_name: string;
  action_array_name: string;
  custom_notes: string;
}

export interface SequenceStructureRules {
  enabled?: boolean;
  safety_inline: boolean;
  permissives_as_first_rung: boolean;
  custom_notes: string;
}

export interface ProcessRulesSchema {
  version: 2;
  step_action_db: StepActionDbRules;
  sequence_structure: SequenceStructureRules;
  extra_rules: StructuredRule[];
  freetext: string;
}

// ── Folder rules schema ─────────────────────────────────────────────────────

export interface FolderRulesSchema {
  version: 2;
  pattern: 'section_per_area' | 'flat' | 'custom';
  shared_device_group: boolean;
  device_group_name: string;
  device_subfolders: {
    fbs: string;
    dbs: string;
    call_fcs_at_root: boolean;
  };
  section_groups: string[];
  other_root_groups: string[];
  call_fc_rules: {
    one_fc_per_device_type: boolean;
    one_network_per_instance: boolean;
    networks_contain_wiring_only: boolean;
  };
  custom_notes: string;
}

export interface DesignProfile {
  id: string;
  name: string;
  client_name: string | null;
  plc_brand: string;
  /** @deprecated Use general_rules instead. Kept for backward compat. */
  rules: string;
  /** Stores GeneralRulesSchema JSON (v2) or legacy freetext */
  general_rules: string;
  folder_rules: string;
  /** Stores ProcessRulesSchema JSON (v2) or legacy ProcessRuleExample[] */
  process_rules: ProcessRuleExample[] | string;
  /** Stores FbRulesSchema JSON (v2) or legacy ProcessRuleExample[] */
  fb_rules: ProcessRuleExample[] | string;
  /** Rules injected specifically into IO linking FC generation (migration 031) */
  io_linking_rules: string;
  /** Language used for device Function Blocks (migration 027) */
  device_fb_language: "SCL" | "LAD";
  /** Language used for device Call FCs — CALL_MOTOR, CALL_SENSOR etc. (migration 038) */
  device_call_fc_language: "SCL" | "LAD";
  /** Language used for the IO linking FC (migration 027) */
  io_linking_language: "SCL" | "LAD";
  /** Language used for process/sequence code (migration 025) */
  process_code_language: "SCL" | "LAD";
  /** HMI screen theme identifier (migration 025) */
  hmi_theme: string;
  /** FB/FC naming prefix for customer, e.g. "FB_CK_" (migration 025) */
  naming_prefix: string;
  /** DB naming prefix for customer, e.g. "DB_CK_" (migration 025) */
  db_naming_prefix: string;
  /**
   * Map of device_type → template_id for preferred FB templates.
   * When set for a device type, the matcher uses this template directly
   * without running heuristic scoring.
   * e.g. { "Motor DOL": "uuid...", "Solenoid Valve 2-pos": "uuid..." }
   */
  fb_favourites: Record<string, string>;
  created_by: string | null;
  updated_at: string;
  created_at: string;
}

export type DesignProfileCreate = Omit<
  DesignProfile,
  "id" | "created_at" | "updated_at" | "created_by"
>;

export type DesignProfileUpdate = Partial<DesignProfileCreate>;
