import type {
  GeneralRulesSchema,
  FbRulesSchema,
  ProcessRulesSchema,
  FolderRulesSchema,
  NamingRules,
  StateMachineRules,
  FbInterfaceRules,
  AlarmRules,
  StepActionDbRules,
  SequenceStructureRules,
  RuleBlockTarget,
  RuleStrength,
  StructuredRule,
} from '@/types/design-profile';

// ── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_NAMING: NamingRules = {
  fb_prefix: '',
  fc_prefix: '',
  db_prefix: '',
  udt_prefix: 'type',
  instance_db_prefix: 'Inst',
  block_name_casing: 'UpperCamelCase',
  param_casing: 'lowerCamelCase',
  static_var_prefix: 'stat',
  temp_var_prefix: 'temp',
  instance_var_prefix: 'inst',
  custom_notes: '',
};

export const DEFAULT_STATE_MACHINE: StateMachineRules = {
  step_increment: 10,
  step_start: 0,
  fault_step: 99,
  always_has_else: true,
  else_action: 'set fault step and status 16#8600',
  custom_notes: '',
};

export const DEFAULT_GENERAL_RULES: GeneralRulesSchema = {
  version: 2,
  naming: { ...DEFAULT_NAMING },
  state_machine: { ...DEFAULT_STATE_MACHINE },
  extra_rules: [],
  freetext: '',
};

export const DEFAULT_FB_INTERFACE: FbInterfaceRules = {
  pattern: 'plcopen_enable',
  include_busy: true,
  include_done: false,
  include_error: true,
  include_status: true,
  status_initial_value: '16#7000',
  custom_notes: '',
};

export const DEFAULT_ALARM_RULES: AlarmRules = {
  latching: true,
  reset_via_input: true,
  reset_input_name: 'resetAlarms',
  custom_notes: '',
};

export const DEFAULT_FB_RULES: FbRulesSchema = {
  version: 2,
  interface_pattern: { ...DEFAULT_FB_INTERFACE },
  alarm_handling: { ...DEFAULT_ALARM_RULES },
  extra_rules: [],
  freetext: '',
};

export const DEFAULT_STEP_ACTION_DB: StepActionDbRules = {
  enabled: false,
  db_name_pattern: 'STEPS_ACTIONS_{SECTION}_DB',
  step_array_name: 'AS',
  action_array_name: 'AA',
  custom_notes: '',
};

export const DEFAULT_SEQUENCE_STRUCTURE: SequenceStructureRules = {
  safety_inline: true,
  permissives_as_first_rung: true,
  custom_notes: '',
};

export const DEFAULT_PROCESS_RULES: ProcessRulesSchema = {
  version: 2,
  step_action_db: { ...DEFAULT_STEP_ACTION_DB },
  sequence_structure: { ...DEFAULT_SEQUENCE_STRUCTURE },
  extra_rules: [],
  freetext: '',
};

// ── Pac Standard Template ─────────────────────────────────────────────────────

export const PAC_STANDARD_GENERAL_RULES: GeneralRulesSchema = {
  version: 2,
  naming: {
    fb_prefix: '',
    fc_prefix: 'CALL_',
    db_prefix: 'DB_',
    udt_prefix: 'type',
    instance_db_prefix: 'Inst',
    block_name_casing: 'UPPER_SNAKE_CASE',
    param_casing: 'lowerCamelCase',
    static_var_prefix: 'stat',
    temp_var_prefix: 'temp',
    instance_var_prefix: 'inst',
    custom_notes:
      'Device FB names use UPPER_SNAKE_CASE with _FB suffix (e.g. MOTOR_FB, SENSOR_FB).\n' +
      'Call FC names use CALL_ prefix + device type (e.g. CALL_MOTOR, CALL_SENSOR).',
  },
  state_machine: {
    step_increment: 10,
    step_start: 0,
    fault_step: 99,
    always_has_else: true,
    else_action: 'set fault step and status word 16#8600',
    custom_notes:
      'Intermediate steps (e.g. 11, 12) may be used as branches between main steps.\n' +
      'Step 0 is always IDLE. Step 99 is always FAULT.',
  },
  extra_rules: [],
  freetext: '',
};

export const PAC_STANDARD_FB_RULES: FbRulesSchema = {
  version: 2,
  interface_pattern: {
    pattern: 'plcopen_enable',
    include_busy: true,
    include_done: false,
    include_error: true,
    include_status: true,
    status_initial_value: '16#7000',
    custom_notes:
      'All device FBs use the PLCopen enable pattern (EN input, not execute/rising edge).\n' +
      'Status word follows Siemens PLCopen ranges: 16#7000 idle, 16#7002 running, 16#8xxx error.',
  },
  alarm_handling: {
    latching: true,
    reset_via_input: true,
    reset_input_name: 'resetAlarms',
    custom_notes:
      'Alarms latch on fault condition. Operator must explicitly reset via resetAlarms input.\n' +
      'Do not auto-clear alarms when fault condition clears.',
  },
  extra_rules: [],
  freetext: '',
};

export const PAC_STANDARD_PROCESS_RULES: ProcessRulesSchema = {
  version: 2,
  step_action_db: {
    enabled: true,
    db_name_pattern: 'STEPS_ACTIONS_{SECTION}_DB',
    step_array_name: 'AS',
    action_array_name: 'AA',
    custom_notes:
      'Each process section has its own STEPS_ACTIONS DB.\n' +
      'AS[] array holds step activation bits. AA[] array holds action activation bits.\n' +
      'These are Bool arrays indexed from 0. Accessed as e.g. "STEPS_ACTIONS_INFEED_DB".AS[0].',
  },
  sequence_structure: {
    safety_inline: true,
    permissives_as_first_rung: true,
    custom_notes:
      'Safety interlock contacts (e.g. DB_Safety_IO.SectionSafetyOK) are placed inline\n' +
      'in the step transition rung — not in a separate safety network.\n' +
      'The management FC reads step bits from the STEPS_ACTIONS DB to drive device outputs.',
  },
  extra_rules: [],
  freetext: '',
};

// ── Parse helpers ─────────────────────────────────────────────────────────────

export function parseGeneralRules(raw: string | null | undefined): GeneralRulesSchema {
  if (!raw?.trim()) return structuredClone(DEFAULT_GENERAL_RULES);
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version === 2) return parsed as GeneralRulesSchema;
  } catch { /* fall through */ }
  // Legacy freetext — preserve in escape hatch
  return { ...structuredClone(DEFAULT_GENERAL_RULES), freetext: raw };
}

export function parseFbRules(raw: string | Array<unknown> | null | undefined): FbRulesSchema {
  if (!raw) return structuredClone(DEFAULT_FB_RULES);
  const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
  try {
    const parsed = JSON.parse(str);
    if (parsed?.version === 2) return parsed as FbRulesSchema;
    if (Array.isArray(parsed)) {
      const legacyText = parsed
        .map((r: { label?: string; example?: string; analysis?: string }) =>
          `### ${r.label ?? ''}\n${r.example ?? ''}\n${r.analysis ?? ''}`)
        .join('\n\n');
      return { ...structuredClone(DEFAULT_FB_RULES), freetext: legacyText };
    }
  } catch { /* fall through */ }
  return { ...structuredClone(DEFAULT_FB_RULES), freetext: str };
}

export function parseProcessRules(
  raw: string | Array<unknown> | null | undefined
): ProcessRulesSchema {
  if (!raw) return structuredClone(DEFAULT_PROCESS_RULES);
  const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
  try {
    const parsed = JSON.parse(str);
    if (parsed?.version === 2) return parsed as ProcessRulesSchema;
    if (Array.isArray(parsed)) {
      const legacyText = parsed
        .map((r: { label?: string; example?: string; analysis?: string }) =>
          `### ${r.label ?? ''}\n${r.example ?? ''}\n${r.analysis ?? ''}`)
        .join('\n\n');
      return { ...structuredClone(DEFAULT_PROCESS_RULES), freetext: legacyText };
    }
  } catch { /* fall through */ }
  return { ...structuredClone(DEFAULT_PROCESS_RULES), freetext: str };
}

// ── Serialize helpers ─────────────────────────────────────────────────────────

export const serializeGeneralRules = (s: GeneralRulesSchema): string =>
  JSON.stringify(s, null, 2);

export const serializeFbRules = (s: FbRulesSchema): string =>
  JSON.stringify(s, null, 2);

export const serializeProcessRules = (s: ProcessRulesSchema): string =>
  JSON.stringify(s, null, 2);

// ── Extra rule helpers ────────────────────────────────────────────────────────

export function makeRule(
  category: string,
  target: RuleBlockTarget,
  strength: RuleStrength,
  statement: string,
  example?: string,
): StructuredRule {
  return {
    id: crypto.randomUUID(),
    category,
    target,
    strength,
    statement,
    example,
    enabled: true,
  };
}

// ── Folder rules ─────────────────────────────────────────────────────────────

const DEFAULT_FOLDER_SCHEMA: FolderRulesSchema = {
  version: 2,
  pattern: 'section_per_area',
  shared_device_group: true,
  device_group_name: 'DEVICE',
  device_subfolders: { fbs: 'FB', dbs: 'DB', call_fcs_at_root: true },
  section_groups: [],
  other_root_groups: ['OB', 'IO_MAPPING'],
  call_fc_rules: {
    one_fc_per_device_type: true,
    one_network_per_instance: true,
    networks_contain_wiring_only: true,
  },
  custom_notes: '',
};

export function parseFolderRules(raw: string | null | undefined): FolderRulesSchema {
  if (!raw?.trim()) return { ...DEFAULT_FOLDER_SCHEMA };
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.version === 2) return parsed as FolderRulesSchema;
  } catch { /* fall through */ }
  return { ...DEFAULT_FOLDER_SCHEMA, custom_notes: raw ?? '' };
}

/**
 * Resolve the TIA Portal destination folder for a given artifact type.
 * Uses the profile's structured folder rules to determine the correct path.
 *
 * blockKind: "device_fb" | "device_instance_db" | "device_call_fc" | "io_linking" | "global_db" | "udt"
 */
export function resolveDestinationFolder(
  folderRules: FolderRulesSchema,
  blockKind: 'device_fb' | 'device_instance_db' | 'device_call_fc' | 'io_linking' | 'global_db' | 'udt',
): string {
  const groupName = folderRules.device_group_name || 'DEVICE';
  const fbSub = folderRules.device_subfolders?.fbs || 'FB';
  const dbSub = folderRules.device_subfolders?.dbs || 'DB';
  const callFcsAtRoot = folderRules.device_subfolders?.call_fcs_at_root ?? true;
  const hasIoMapping = folderRules.other_root_groups?.includes('IO_MAPPING');

  switch (blockKind) {
    case 'device_fb':
      return folderRules.shared_device_group
        ? `Program blocks/${groupName}/${fbSub}`
        : 'Program blocks';
    case 'device_instance_db':
      return folderRules.shared_device_group
        ? `Program blocks/${groupName}/${dbSub}`
        : 'Data blocks';
    case 'device_call_fc':
      if (folderRules.shared_device_group) {
        return callFcsAtRoot
          ? `Program blocks/${groupName}`
          : `Program blocks/${groupName}/${fbSub}`;
      }
      return 'Program blocks';
    case 'io_linking':
      return hasIoMapping ? 'Program blocks/IO_MAPPING' : 'Program blocks';
    case 'global_db':
      return 'Data blocks';
    case 'udt':
      return 'Data blocks';
    default:
      return 'Program blocks';
  }
}
