# Design Profile Structured Rules — Claude Code Tasks

## Overview

This task set replaces the freetext `general_rules`, `fb_rules`, and `process_rules` fields in
the design profile editor with a structured schema that eliminates ambiguity in AI prompt
injection. The approach is a **mix**: structured fields for known rule categories, freetext
escape hatch for everything else.

**Prerequisites:** Complete `DESIGN_PROFILE_TASKS.md` first (Tasks 1–6). This file builds on
top of those changes.

**Read `CLAUDE.md` first** — especially the "Four Generation Paths" section.

---

## Rule Injection Format

Every structured rule, when rendered into an AI prompt, MUST use this exact format:

```
RULE: [Category] — [BlockType] MUST [statement].
RULE: [Category] — [BlockType] MUST NOT [statement].
RULE: [Category] — [BlockType] MUST [statement]. Example:
  [code snippet]
```

This format is unambiguous — the word RULE at the start signals a hard constraint to the model,
the category tags allow the model to apply rules selectively, and MUST/MUST NOT leaves no
room for interpretation.

---

## Task 1 — Define the structured rules schema

**File:** `src/types/design-profile.ts`

Add the following types. These replace the existing `string` and `ProcessRuleExample[]` fields
at the schema level — but the DB columns remain unchanged (still stored as JSON strings).

```ts
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
  id: string;              // nanoid, used as React key
  category: string;        // e.g. "Naming", "State Machine", "Alarms"
  target: RuleBlockTarget; // which block type this applies to
  strength: RuleStrength;
  statement: string;       // the rule body — no leading "MUST", that comes from strength
  example?: string;        // optional SCL/LAD code snippet
  enabled: boolean;        // allow rules to be toggled without deleting
}

// ── General rules schema ────────────────────────────────────────────────────

export interface NamingRules {
  // Block prefixes (structured — directly used in prompt)
  fb_prefix: string;           // e.g. "MOTOR_FB", "FB_CK_"
  fc_prefix: string;           // e.g. "CALL_MOTOR"
  db_prefix: string;           // e.g. "DB_", "DB_CK_"
  udt_prefix: string;          // e.g. "type" (Siemens standard)
  instance_db_prefix: string;  // e.g. "Inst"
  // Casing rules (structured)
  block_name_casing: 'UPPER_SNAKE_CASE' | 'UpperCamelCase' | 'custom';
  param_casing: 'lowerCamelCase' | 'custom';
  static_var_prefix: string;   // e.g. "stat"
  temp_var_prefix: string;     // e.g. "temp"
  instance_var_prefix: string; // e.g. "inst"
  // Freetext escape hatch
  custom_notes: string;
}

export interface StateMachineRules {
  // Step numbering (structured)
  step_increment: number;        // e.g. 10 → steps are 10, 20, 30...
  step_start: number;            // e.g. 0 or 10
  fault_step: number;            // e.g. 99 or 999
  always_has_else: boolean;      // CASE must always have ELSE branch
  else_action: string;           // what ELSE does, e.g. "set fault state + status 16#8600"
  // Freetext escape hatch
  custom_notes: string;
}

export interface GeneralRulesSchema {
  version: 2;
  naming: NamingRules;
  state_machine: StateMachineRules;
  extra_rules: StructuredRule[];  // additional structured rules (user-defined)
  freetext: string;               // escape hatch for anything not covered above
}

// ── FB rules schema ─────────────────────────────────────────────────────────

export interface FbInterfaceRules {
  pattern: 'plcopen_execute' | 'plcopen_enable' | 'custom';
  // PLCopen outputs to always include
  include_busy: boolean;
  include_done: boolean;
  include_error: boolean;
  include_status: boolean;
  status_initial_value: string;  // e.g. "16#7000"
  custom_notes: string;
}

export interface AlarmRules {
  latching: boolean;             // alarms latch until explicit reset
  reset_via_input: boolean;      // reset via a VAR_INPUT (e.g. resetAlarms)
  reset_input_name: string;      // e.g. "resetAlarms"
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
  enabled: boolean;              // does this client use the step/action DB pattern?
  db_name_pattern: string;       // e.g. "STEPS_ACTIONS_{SECTION}_DB"
  step_array_name: string;       // e.g. "AS" → accessed as DB.AS[n]
  action_array_name: string;     // e.g. "AA" → accessed as DB.AA[n]
  // Freetext for structure details
  custom_notes: string;
}

export interface SequenceStructureRules {
  safety_inline: boolean;        // safety contacts inline in rung (true) vs separate network
  permissives_as_first_rung: boolean; // permissive conditions checked in first network
  custom_notes: string;
}

export interface ProcessRulesSchema {
  version: 2;
  step_action_db: StepActionDbRules;
  sequence_structure: SequenceStructureRules;
  extra_rules: StructuredRule[];
  freetext: string;
}

// ── Language defaults ────────────────────────────────────────────────────────
// Already on DesignProfile as device_fb_language, io_linking_language,
// process_code_language. No new fields needed — just surfaced better in UI.
```

Also update the `DesignProfile` interface to add JSDoc indicating these fields now store
JSON-serialised versions of the above schemas (the DB columns are still `text`):

```ts
export interface DesignProfile {
  // ... existing fields ...
  /** Stores GeneralRulesSchema JSON (v2) or legacy freetext */
  general_rules: string;
  /** Stores ProcessRulesSchema JSON (v2) or legacy freetext */
  process_rules: ProcessRuleExample[] | string; // will be string when v2
  /** Stores FbRulesSchema JSON (v2) or legacy freetext */
  fb_rules: ProcessRuleExample[] | string;
  // ... rest of existing fields unchanged ...
}
```

---

## Task 2 — Add parse/serialize helpers and the Pac Standard template

**File:** `src/lib/design-profile-schemas.ts` (new file)

Create this file. It contains all parse/serialize helpers, default schemas, and the Pac Standard
template. Keeping this out of the type file and the prompt builder keeps each file focused.

```ts
import { nanoid } from 'nanoid'; // already in package.json via other deps; if missing use crypto.randomUUID()
import type {
  GeneralRulesSchema,
  FbRulesSchema,
  ProcessRulesSchema,
  NamingRules,
  StateMachineRules,
  FbInterfaceRules,
  AlarmRules,
  StepActionDbRules,
  SequenceStructureRules,
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
// Based on the Pac Technologies standard layout shown in screenshots.
// Used as the pre-fill option when creating a new profile.

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
    // Legacy ProcessRuleExample[] array — move to freetext
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
  target: import('@/types/design-profile').RuleBlockTarget,
  strength: import('@/types/design-profile').RuleStrength,
  statement: string,
  example?: string,
): import('@/types/design-profile').StructuredRule {
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
```

---

## Task 3 — Update `formatDesignProfile()` to render structured schemas

**File:** `src/lib/prompt-builder.ts`

Replace the existing `general_rules`, `process_rules`, and `fb_rules` rendering in
`formatDesignProfile()` with schema-aware rendering. Add these helper functions before
`formatDesignProfile()`:

```ts
import {
  parseGeneralRules,
  parseFbRules,
  parseProcessRules,
} from '@/lib/design-profile-schemas';
import type {
  GeneralRulesSchema,
  FbRulesSchema,
  ProcessRulesSchema,
  StructuredRule,
} from '@/types/design-profile';

// ── Rule card renderer ────────────────────────────────────────────────────────

function renderStructuredRule(rule: StructuredRule): string {
  if (!rule.enabled) return '';
  const target = rule.target === 'ALL' ? 'All blocks' : rule.target;
  const header = `RULE: ${rule.category} — ${target} ${rule.strength} ${rule.statement}.`;
  if (rule.example?.trim()) {
    return `${header}\n  Example:\n${rule.example.split('\n').map(l => `    ${l}`).join('\n')}`;
  }
  return header;
}

function renderExtraRules(rules: StructuredRule[]): string {
  if (!rules?.length) return '';
  return rules
    .filter(r => r.enabled)
    .map(renderStructuredRule)
    .filter(Boolean)
    .join('\n');
}

// ── General rules renderer ────────────────────────────────────────────────────

function renderGeneralRules(schema: GeneralRulesSchema): string {
  const lines: string[] = [];
  const n = schema.naming;
  const sm = schema.state_machine;

  // Naming — only emit rules for non-empty fields
  if (n.fb_prefix) {
    lines.push(`RULE: Naming — FB MUST use the prefix "${n.fb_prefix}" (e.g. ${n.fb_prefix}Motor, ${n.fb_prefix}Sensor). Do NOT generate FBs without this prefix.`);
  }
  if (n.fc_prefix) {
    lines.push(`RULE: Naming — FC MUST use the prefix "${n.fc_prefix}" (e.g. ${n.fc_prefix}Motor, ${n.fc_prefix}Sensor). Do NOT generate FCs without this prefix.`);
  }
  if (n.db_prefix) {
    lines.push(`RULE: Naming — DB MUST use the prefix "${n.db_prefix}" (e.g. ${n.db_prefix}Motor, ${n.db_prefix}Sensors). Do NOT generate DBs without this prefix.`);
  }
  if (n.udt_prefix) {
    lines.push(`RULE: Naming — UDT MUST use the prefix "${n.udt_prefix}" (e.g. ${n.udt_prefix}MotorConfig, ${n.udt_prefix}SensorIO).`);
  }
  if (n.instance_db_prefix) {
    lines.push(`RULE: Naming — Instance DB MUST use the prefix "${n.instance_db_prefix}" (e.g. ${n.instance_db_prefix}Motor1, ${n.instance_db_prefix}Sensor001).`);
  }
  if (n.block_name_casing !== 'custom') {
    lines.push(`RULE: Naming — All block names MUST use ${n.block_name_casing} casing.`);
  }
  if (n.param_casing !== 'custom') {
    lines.push(`RULE: Naming — All formal parameters (VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT) MUST use ${n.param_casing} casing.`);
  }
  if (n.static_var_prefix) {
    lines.push(`RULE: Naming — Static variables MUST use the "${n.static_var_prefix}" prefix (e.g. ${n.static_var_prefix}State, ${n.static_var_prefix}AlarmLatch).`);
  }
  if (n.temp_var_prefix) {
    lines.push(`RULE: Naming — Temporary variables MUST use the "${n.temp_var_prefix}" prefix (e.g. ${n.temp_var_prefix}RunPermit, ${n.temp_var_prefix}Index).`);
  }
  if (n.instance_var_prefix) {
    lines.push(`RULE: Naming — Multi-instance variables (FBs, timers, counters, edge triggers declared in VAR) MUST use the "${n.instance_var_prefix}" prefix (e.g. ${n.instance_var_prefix}StartDelay, ${n.instance_var_prefix}RisingEdge).`);
  }
  if (n.custom_notes?.trim()) {
    lines.push(`\nAdditional naming notes:\n${n.custom_notes}`);
  }

  // State machine
  lines.push('');
  lines.push(`RULE: State Machine — FB MUST use CASE-based state machines with step values starting at ${sm.step_start} and incrementing by ${sm.step_increment} (e.g. ${sm.step_start}, ${sm.step_start + sm.step_increment}, ${sm.step_start + sm.step_increment * 2}...). Intermediate steps (e.g. ${sm.step_start + 1}, ${sm.step_start + 2}) MAY be used as branches between main steps.`);
  lines.push(`RULE: State Machine — FB MUST reserve step ${sm.fault_step} as the FAULT state.`);
  if (sm.always_has_else) {
    lines.push(`RULE: State Machine — ALL CASE statements MUST include an ELSE branch. ELSE action: ${sm.else_action}.`);
  }
  if (sm.custom_notes?.trim()) {
    lines.push(`\nAdditional state machine notes:\n${sm.custom_notes}`);
  }

  // Extra structured rules
  const extras = renderExtraRules(schema.extra_rules);
  if (extras) { lines.push(''); lines.push(extras); }

  // Freetext escape hatch
  if (schema.freetext?.trim()) {
    lines.push('');
    lines.push(`Additional general rules:\n${schema.freetext}`);
  }

  return lines.filter(l => l !== undefined).join('\n');
}

// ── FB rules renderer ─────────────────────────────────────────────────────────

function renderFbRules(schema: FbRulesSchema): string {
  const lines: string[] = [];
  const iface = schema.interface_pattern;
  const alarm = schema.alarm_handling;

  if (iface.pattern === 'plcopen_enable') {
    lines.push('RULE: FB Interface — DEVICE_FB MUST use the PLCopen enable pattern: EN (Bool input) controls activation. MUST NOT use rising-edge execute pattern for device FBs.');
  } else if (iface.pattern === 'plcopen_execute') {
    lines.push('RULE: FB Interface — DEVICE_FB MUST use the PLCopen execute pattern: rising edge on execute input triggers one-shot command.');
  }
  if (iface.include_busy)   lines.push('RULE: FB Interface — DEVICE_FB MUST include a "busy : Bool" VAR_OUTPUT.');
  if (iface.include_done)   lines.push('RULE: FB Interface — DEVICE_FB MUST include a "done : Bool" VAR_OUTPUT.');
  if (iface.include_error)  lines.push('RULE: FB Interface — DEVICE_FB MUST include an "error : Bool" VAR_OUTPUT.');
  if (iface.include_status) {
    lines.push(`RULE: FB Interface — DEVICE_FB MUST include a "status : Word" VAR_OUTPUT with initial value ${iface.status_initial_value}.`);
  }
  if (iface.custom_notes?.trim()) {
    lines.push(`\nAdditional interface notes:\n${iface.custom_notes}`);
  }

  lines.push('');
  if (alarm.latching) {
    lines.push('RULE: Alarm Handling — FB MUST latch alarms on fault condition. Alarms MUST NOT auto-clear when the fault condition clears.');
  }
  if (alarm.reset_via_input) {
    lines.push(`RULE: Alarm Handling — FB MUST provide a "${alarm.reset_input_name} : Bool" VAR_INPUT for operator alarm reset.`);
  }
  if (alarm.custom_notes?.trim()) {
    lines.push(`\nAdditional alarm notes:\n${alarm.custom_notes}`);
  }

  const extras = renderExtraRules(schema.extra_rules);
  if (extras) { lines.push(''); lines.push(extras); }

  if (schema.freetext?.trim()) {
    lines.push('');
    lines.push(`Additional FB rules:\n${schema.freetext}`);
  }

  return lines.join('\n');
}

// ── Process rules renderer ────────────────────────────────────────────────────

function renderProcessRules(schema: ProcessRulesSchema): string {
  const lines: string[] = [];
  const sad = schema.step_action_db;
  const seq = schema.sequence_structure;

  if (sad.enabled) {
    lines.push(`RULE: Process Structure — PROCESS_FC MUST use the step/action DB pattern. Each process section requires a dedicated DB named using the pattern "${sad.db_name_pattern}".`);
    lines.push(`RULE: Process Structure — PROCESS_FC MUST store step activation bits in a Bool array named "${sad.step_array_name}" (e.g. DB.${sad.step_array_name}[0], DB.${sad.step_array_name}[1]...).`);
    lines.push(`RULE: Process Structure — PROCESS_FC MUST store action activation bits in a Bool array named "${sad.action_array_name}" (e.g. DB.${sad.action_array_name}[0], DB.${sad.action_array_name}[1]...).`);
    if (sad.custom_notes?.trim()) {
      lines.push(`\nAdditional step/action DB notes:\n${sad.custom_notes}`);
    }
  }

  lines.push('');
  if (seq.safety_inline) {
    lines.push('RULE: Sequence Structure — PROCESS_FC MUST place safety interlock contacts inline within the step transition rung. MUST NOT use a separate dedicated safety network.');
  }
  if (seq.permissives_as_first_rung) {
    lines.push('RULE: Sequence Structure — PROCESS_FC MUST check all permissive preconditions in the first network before any step transitions.');
  }
  if (seq.custom_notes?.trim()) {
    lines.push(`\nAdditional sequence notes:\n${seq.custom_notes}`);
  }

  const extras = renderExtraRules(schema.extra_rules);
  if (extras) { lines.push(''); lines.push(extras); }

  if (schema.freetext?.trim()) {
    lines.push('');
    lines.push(`Additional process rules:\n${schema.freetext}`);
  }

  return lines.join('\n');
}
```

Now update `formatDesignProfile()` to use these renderers. Replace the existing sections that
push `general_rules`, `process_rules`, and `fb_rules`:

```ts
// Replace existing generalRules section:
const generalSchema = parseGeneralRules(profile.general_rules);
const generalRendered = renderGeneralRules(generalSchema);
if (generalRendered.trim()) {
  sections.push(`### General Code Rules\n\n${generalRendered}`);
}

// Replace existing folder_rules section (already done in DESIGN_PROFILE_TASKS.md Task 5 —
// leave that renderFolderRulesFromSchema logic in place, do not duplicate it here)

// Replace existing process_rules section:
if (context === 'process' || context === 'all') {
  const processSchema = parseProcessRules(profile.process_rules as string);
  const processRendered = renderProcessRules(processSchema);
  if (processRendered.trim()) {
    sections.push(`### Process Code Rules\n\n${processRendered}`);
  }
}

// Replace existing fb_rules section:
if (context === 'fb' || context === 'all') {
  const fbSchema = parseFbRules(profile.fb_rules as string);
  const fbRendered = renderFbRules(fbSchema);
  if (fbRendered.trim()) {
    sections.push(`### Function Block Rules\n\n${fbRendered}`);
  }
}
```

Also remove the now-redundant `naming_prefix`/`db_naming_prefix` injection added in
`DESIGN_PROFILE_TASKS.md` Task 1 — that is now handled by `renderGeneralRules()` via
`fb_prefix` and `db_prefix` fields in the naming schema. The old `naming_prefix` and
`db_naming_prefix` profile fields still exist but are superseded by the schema.

**Verify:** `npm run build`. Run a quick smoke test — create a profile with naming prefixes
and step increment 10, then check the rendered output contains properly formatted RULE lines.

---

## Task 4 — Update the profile editor UI

**File:** `src/routes/profile-detail.tsx`

This is the largest change. The goal is to replace the freetext textareas on the General, FB,
and Process tabs with structured forms, while keeping the freetext escape hatch visible at the
bottom of each tab.

### Step 4a — Add imports and local state

Add to imports:
```ts
import type {
  GeneralRulesSchema,
  FbRulesSchema,
  ProcessRulesSchema,
} from '@/types/design-profile';
import {
  parseGeneralRules,
  parseFbRules,
  parseProcessRules,
  serializeGeneralRules,
  serializeFbRules,
  serializeProcessRules,
} from '@/lib/design-profile-schemas';
import { Switch } from '@/components/ui/switch';
```

Replace the existing local state for `generalRules`, `processRules`, `fbRules` with schema
state:
```ts
const [generalSchema, setGeneralSchema] = useState<GeneralRulesSchema | null>(null);
const [fbSchema, setFbSchema] = useState<FbRulesSchema | null>(null);
const [processSchema, setProcessSchema] = useState<ProcessRulesSchema | null>(null);
```

In the `useEffect` that initialises state from the loaded profile, replace the old freetext
initialisations with:
```ts
setGeneralSchema(parseGeneralRules(profile.general_rules));
setFbSchema(parseFbRules(profile.fb_rules as string));
setProcessSchema(parseProcessRules(profile.process_rules as string));
```

In the save handler, serialise back:
```ts
general_rules: generalSchema ? serializeGeneralRules(generalSchema) : '',
fb_rules: fbSchema ? serializeFbRules(fbSchema) : '[]',
process_rules: processSchema ? serializeProcessRules(processSchema) : '[]',
```

### Step 4b — General tab UI

Replace the existing `<Textarea>` for general_rules with the following structured form.
Use the existing shadcn/ui components already imported. Add `Select`/`SelectTrigger`/
`SelectContent`/`SelectItem` to imports if not already present.

The General tab renders two sections: **Naming** and **State Machine**, then a freetext
escape hatch at the bottom.

**Naming section:**
```tsx
{generalSchema && (
  <div className="space-y-6">
    <div>
      <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">
        Naming
      </h3>
      <div className="grid grid-cols-2 gap-3">
        {[
          { key: 'fb_prefix',           label: 'FB prefix',           placeholder: 'e.g. MOTOR_FB or FB_CK_' },
          { key: 'fc_prefix',           label: 'FC prefix',           placeholder: 'e.g. CALL_' },
          { key: 'db_prefix',           label: 'DB prefix',           placeholder: 'e.g. DB_' },
          { key: 'udt_prefix',          label: 'UDT prefix',          placeholder: 'e.g. type' },
          { key: 'instance_db_prefix',  label: 'Instance DB prefix',  placeholder: 'e.g. Inst' },
          { key: 'static_var_prefix',   label: 'Static var prefix',   placeholder: 'e.g. stat' },
          { key: 'temp_var_prefix',     label: 'Temp var prefix',     placeholder: 'e.g. temp' },
          { key: 'instance_var_prefix', label: 'Instance var prefix', placeholder: 'e.g. inst' },
        ].map(({ key, label, placeholder }) => (
          <div key={key} className="space-y-1">
            <Label className="text-xs text-muted-foreground">{label}</Label>
            <Input
              value={generalSchema.naming[key as keyof typeof generalSchema.naming] as string}
              onChange={e => setGeneralSchema(s => s && ({
                ...s, naming: { ...s.naming, [key]: e.target.value }
              }))}
              placeholder={placeholder}
              className="font-mono text-xs"
            />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 mt-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Block name casing</Label>
          <Select
            value={generalSchema.naming.block_name_casing}
            onValueChange={v => setGeneralSchema(s => s && ({
              ...s, naming: { ...s.naming, block_name_casing: v as GeneralRulesSchema['naming']['block_name_casing'] }
            }))}
          >
            <SelectTrigger className="font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="UPPER_SNAKE_CASE">UPPER_SNAKE_CASE</SelectItem>
              <SelectItem value="UpperCamelCase">UpperCamelCase</SelectItem>
              <SelectItem value="custom">Custom (see notes)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Parameter casing</Label>
          <Select
            value={generalSchema.naming.param_casing}
            onValueChange={v => setGeneralSchema(s => s && ({
              ...s, naming: { ...s.naming, param_casing: v as GeneralRulesSchema['naming']['param_casing'] }
            }))}
          >
            <SelectTrigger className="font-mono text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lowerCamelCase">lowerCamelCase</SelectItem>
              <SelectItem value="custom">Custom (see notes)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="mt-3 space-y-1">
        <Label className="text-xs text-muted-foreground">Naming notes</Label>
        <Textarea
          value={generalSchema.naming.custom_notes}
          onChange={e => setGeneralSchema(s => s && ({
            ...s, naming: { ...s.naming, custom_notes: e.target.value }
          }))}
          placeholder="Additional naming conventions not covered above..."
          className="font-mono text-xs min-h-[60px]"
        />
      </div>
    </div>

    <Separator />

    {/* State Machine section */}
    <div>
      <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">
        State Machine
      </h3>
      <div className="grid grid-cols-3 gap-3">
        {[
          { key: 'step_start',     label: 'First step value', type: 'number' },
          { key: 'step_increment', label: 'Step increment',   type: 'number' },
          { key: 'fault_step',     label: 'Fault step value', type: 'number' },
        ].map(({ key, label }) => (
          <div key={key} className="space-y-1">
            <Label className="text-xs text-muted-foreground">{label}</Label>
            <Input
              type="number"
              value={generalSchema.state_machine[key as keyof typeof generalSchema.state_machine] as number}
              onChange={e => setGeneralSchema(s => s && ({
                ...s, state_machine: { ...s.state_machine, [key]: parseInt(e.target.value) || 0 }
              }))}
              className="font-mono text-xs"
            />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-3">
        <Label className="text-xs text-muted-foreground">CASE always requires ELSE branch</Label>
        <Switch
          checked={generalSchema.state_machine.always_has_else}
          onCheckedChange={v => setGeneralSchema(s => s && ({
            ...s, state_machine: { ...s.state_machine, always_has_else: v }
          }))}
        />
      </div>
      {generalSchema.state_machine.always_has_else && (
        <div className="mt-2 space-y-1">
          <Label className="text-xs text-muted-foreground">ELSE action</Label>
          <Input
            value={generalSchema.state_machine.else_action}
            onChange={e => setGeneralSchema(s => s && ({
              ...s, state_machine: { ...s.state_machine, else_action: e.target.value }
            }))}
            placeholder="e.g. set fault step and status 16#8600"
            className="font-mono text-xs"
          />
        </div>
      )}
      <div className="mt-3 space-y-1">
        <Label className="text-xs text-muted-foreground">State machine notes</Label>
        <Textarea
          value={generalSchema.state_machine.custom_notes}
          onChange={e => setGeneralSchema(s => s && ({
            ...s, state_machine: { ...s.state_machine, custom_notes: e.target.value }
          }))}
          placeholder="Additional state machine conventions..."
          className="font-mono text-xs min-h-[60px]"
        />
      </div>
    </div>

    <Separator />

    {/* Extra structured rules */}
    <ExtraRulesEditor
      rules={generalSchema.extra_rules}
      onChange={v => setGeneralSchema(s => s && ({ ...s, extra_rules: v }))}
    />

    <Separator />

    {/* Freetext escape hatch */}
    <div className="space-y-1">
      <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        Additional Rules (freetext)
      </Label>
      <Textarea
        value={generalSchema.freetext}
        onChange={e => setGeneralSchema(s => s && ({ ...s, freetext: e.target.value }))}
        placeholder="Any additional general rules not covered by the structured fields above..."
        className="font-mono text-xs min-h-[100px]"
      />
    </div>
  </div>
)}
```

### Step 4c — FB tab UI

Replace the existing FB rules textarea with:

```tsx
{fbSchema && (
  <div className="space-y-6">
    {/* Interface pattern */}
    <div>
      <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">
        Interface Pattern
      </h3>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">PLCopen pattern</Label>
          <Select
            value={fbSchema.interface_pattern.pattern}
            onValueChange={v => setFbSchema(s => s && ({
              ...s, interface_pattern: { ...s.interface_pattern, pattern: v as FbInterfaceRules['pattern'] }
            }))}
          >
            <SelectTrigger className="font-mono text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="plcopen_enable">Enable (level-triggered, device FBs)</SelectItem>
              <SelectItem value="plcopen_execute">Execute (edge-triggered, one-shot commands)</SelectItem>
              <SelectItem value="custom">Custom (see notes)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Status word initial value</Label>
          <Input
            value={fbSchema.interface_pattern.status_initial_value}
            onChange={e => setFbSchema(s => s && ({
              ...s, interface_pattern: { ...s.interface_pattern, status_initial_value: e.target.value }
            }))}
            placeholder="16#7000"
            className="font-mono text-xs w-32"
          />
        </div>
        {(['include_busy', 'include_done', 'include_error', 'include_status'] as const).map(key => (
          <div key={key} className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">
              {key === 'include_busy' && 'Include "busy : Bool" output'}
              {key === 'include_done' && 'Include "done : Bool" output'}
              {key === 'include_error' && 'Include "error : Bool" output'}
              {key === 'include_status' && 'Include "status : Word" output'}
            </Label>
            <Switch
              checked={fbSchema.interface_pattern[key]}
              onCheckedChange={v => setFbSchema(s => s && ({
                ...s, interface_pattern: { ...s.interface_pattern, [key]: v }
              }))}
            />
          </div>
        ))}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Interface notes</Label>
          <Textarea
            value={fbSchema.interface_pattern.custom_notes}
            onChange={e => setFbSchema(s => s && ({
              ...s, interface_pattern: { ...s.interface_pattern, custom_notes: e.target.value }
            }))}
            className="font-mono text-xs min-h-[60px]"
            placeholder="Additional interface rules..."
          />
        </div>
      </div>
    </div>

    <Separator />

    {/* Alarm handling */}
    <div>
      <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">
        Alarm Handling
      </h3>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Alarms latch (require explicit reset)</Label>
          <Switch
            checked={fbSchema.alarm_handling.latching}
            onCheckedChange={v => setFbSchema(s => s && ({
              ...s, alarm_handling: { ...s.alarm_handling, latching: v }
            }))}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">Reset via VAR_INPUT</Label>
          <Switch
            checked={fbSchema.alarm_handling.reset_via_input}
            onCheckedChange={v => setFbSchema(s => s && ({
              ...s, alarm_handling: { ...s.alarm_handling, reset_via_input: v }
            }))}
          />
        </div>
        {fbSchema.alarm_handling.reset_via_input && (
          <div className="space-y-1 pl-3 border-l border-border">
            <Label className="text-xs text-muted-foreground">Reset input name</Label>
            <Input
              value={fbSchema.alarm_handling.reset_input_name}
              onChange={e => setFbSchema(s => s && ({
                ...s, alarm_handling: { ...s.alarm_handling, reset_input_name: e.target.value }
              }))}
              placeholder="resetAlarms"
              className="font-mono text-xs w-48"
            />
          </div>
        )}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Alarm notes</Label>
          <Textarea
            value={fbSchema.alarm_handling.custom_notes}
            onChange={e => setFbSchema(s => s && ({
              ...s, alarm_handling: { ...s.alarm_handling, custom_notes: e.target.value }
            }))}
            className="font-mono text-xs min-h-[60px]"
            placeholder="Additional alarm handling rules..."
          />
        </div>
      </div>
    </div>

    <Separator />
    <ExtraRulesEditor
      rules={fbSchema.extra_rules}
      onChange={v => setFbSchema(s => s && ({ ...s, extra_rules: v }))}
    />
    <Separator />
    <div className="space-y-1">
      <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        Additional Rules (freetext)
      </Label>
      <Textarea
        value={fbSchema.freetext}
        onChange={e => setFbSchema(s => s && ({ ...s, freetext: e.target.value }))}
        placeholder="Any additional FB rules not covered above..."
        className="font-mono text-xs min-h-[100px]"
      />
    </div>
  </div>
)}
```

### Step 4d — Process tab UI

Replace the existing process rules textarea with:

```tsx
{processSchema && (
  <div className="space-y-6">
    {/* Step/Action DB pattern */}
    <div>
      <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">
        Step / Action DB Pattern
      </h3>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">
            Use step/action DB pattern
          </Label>
          <Switch
            checked={processSchema.step_action_db.enabled}
            onCheckedChange={v => setProcessSchema(s => s && ({
              ...s, step_action_db: { ...s.step_action_db, enabled: v }
            }))}
          />
        </div>
        {processSchema.step_action_db.enabled && (
          <div className="space-y-3 pl-3 border-l border-border">
            {[
              { key: 'db_name_pattern',   label: 'DB name pattern',    placeholder: 'STEPS_ACTIONS_{SECTION}_DB' },
              { key: 'step_array_name',   label: 'Step array name',    placeholder: 'AS' },
              { key: 'action_array_name', label: 'Action array name',  placeholder: 'AA' },
            ].map(({ key, label, placeholder }) => (
              <div key={key} className="space-y-1">
                <Label className="text-xs text-muted-foreground">{label}</Label>
                <Input
                  value={processSchema.step_action_db[key as keyof StepActionDbRules] as string}
                  onChange={e => setProcessSchema(s => s && ({
                    ...s, step_action_db: { ...s.step_action_db, [key]: e.target.value }
                  }))}
                  placeholder={placeholder}
                  className="font-mono text-xs"
                />
              </div>
            ))}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Step/action DB notes</Label>
              <Textarea
                value={processSchema.step_action_db.custom_notes}
                onChange={e => setProcessSchema(s => s && ({
                  ...s, step_action_db: { ...s.step_action_db, custom_notes: e.target.value }
                }))}
                className="font-mono text-xs min-h-[60px]"
                placeholder="Structure details, array sizing, access patterns..."
              />
            </div>
          </div>
        )}
      </div>
    </div>

    <Separator />

    {/* Sequence structure */}
    <div>
      <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">
        Sequence Structure
      </h3>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">
            Safety contacts inline in step transition rung
          </Label>
          <Switch
            checked={processSchema.sequence_structure.safety_inline}
            onCheckedChange={v => setProcessSchema(s => s && ({
              ...s, sequence_structure: { ...s.sequence_structure, safety_inline: v }
            }))}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label className="text-xs text-muted-foreground">
            Permissive conditions checked in first network
          </Label>
          <Switch
            checked={processSchema.sequence_structure.permissives_as_first_rung}
            onCheckedChange={v => setProcessSchema(s => s && ({
              ...s, sequence_structure: { ...s.sequence_structure, permissives_as_first_rung: v }
            }))}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Sequence notes</Label>
          <Textarea
            value={processSchema.sequence_structure.custom_notes}
            onChange={e => setProcessSchema(s => s && ({
              ...s, sequence_structure: { ...s.sequence_structure, custom_notes: e.target.value }
            }))}
            className="font-mono text-xs min-h-[60px]"
            placeholder="Management FC pattern, how steps drive outputs..."
          />
        </div>
      </div>
    </div>

    <Separator />
    <ExtraRulesEditor
      rules={processSchema.extra_rules}
      onChange={v => setProcessSchema(s => s && ({ ...s, extra_rules: v }))}
    />
    <Separator />
    <div className="space-y-1">
      <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        Additional Rules (freetext)
      </Label>
      <Textarea
        value={processSchema.freetext}
        onChange={e => setProcessSchema(s => s && ({ ...s, freetext: e.target.value }))}
        placeholder="Any additional process rules not covered above..."
        className="font-mono text-xs min-h-[100px]"
      />
    </div>
  </div>
)}
```

### Step 4e — Add `ExtraRulesEditor` helper component

Add this local component before `ProfileDetailPage` in the file. It allows engineers to add
freeform structured rule cards for anything not covered by the fixed fields above:

```tsx
import type { StructuredRule, RuleBlockTarget, RuleStrength } from '@/types/design-profile';
import { makeRule } from '@/lib/design-profile-schemas';

const RULE_TARGETS: RuleBlockTarget[] = ['ALL','FB','FC','OB','DB','UDT','CALL_FC','PROCESS_FC','DEVICE_FB'];
const RULE_STRENGTHS: RuleStrength[] = ['MUST','MUST NOT','SHOULD','SHOULD NOT'];

function ExtraRulesEditor({
  rules,
  onChange,
}: {
  rules: StructuredRule[];
  onChange: (rules: StructuredRule[]) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Partial<StructuredRule>>({
    category: '', target: 'ALL', strength: 'MUST', statement: '', example: '', enabled: true,
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          Extra Rules
        </Label>
        <Button size="sm" variant="outline" onClick={() => setAdding(v => !v)}>
          {adding ? 'Cancel' : '+ Add rule'}
        </Button>
      </div>

      {/* Existing rules */}
      {rules.map(rule => (
        <div key={rule.id} className="flex items-start gap-2 p-2 rounded border border-border bg-muted/30">
          <Switch
            checked={rule.enabled}
            onCheckedChange={v => onChange(rules.map(r => r.id === rule.id ? { ...r, enabled: v } : r))}
            className="mt-0.5 shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className="font-mono text-xs">
              <span className="text-primary">RULE: {rule.category}</span>
              {' — '}
              <span className="text-muted-foreground">{rule.target}</span>
              {' '}
              <span className="font-semibold">{rule.strength}</span>
              {' '}
              {rule.statement}
            </p>
            {rule.example && (
              <pre className="mt-1 text-[10px] text-muted-foreground whitespace-pre-wrap">{rule.example}</pre>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 text-destructive hover:text-destructive"
            onClick={() => onChange(rules.filter(r => r.id !== rule.id))}
          >×</Button>
        </div>
      ))}

      {/* Add new rule form */}
      {adding && (
        <div className="p-3 rounded border border-border space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Category</Label>
              <Input
                value={draft.category ?? ''}
                onChange={e => setDraft(d => ({ ...d, category: e.target.value }))}
                placeholder="e.g. Naming"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Target</Label>
              <Select
                value={draft.target ?? 'ALL'}
                onValueChange={v => setDraft(d => ({ ...d, target: v as RuleBlockTarget }))}
              >
                <SelectTrigger className="font-mono text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RULE_TARGETS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Strength</Label>
              <Select
                value={draft.strength ?? 'MUST'}
                onValueChange={v => setDraft(d => ({ ...d, strength: v as RuleStrength }))}
              >
                <SelectTrigger className="font-mono text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RULE_STRENGTHS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Statement</Label>
            <Input
              value={draft.statement ?? ''}
              onChange={e => setDraft(d => ({ ...d, statement: e.target.value }))}
              placeholder="use the UPPER_SNAKE_CASE naming convention for all block names"
              className="font-mono text-xs"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Example (optional SCL/LAD snippet)</Label>
            <Textarea
              value={draft.example ?? ''}
              onChange={e => setDraft(d => ({ ...d, example: e.target.value }))}
              className="font-mono text-xs min-h-[60px]"
              placeholder="MOTOR_FB, SENSOR_FB, SOLENOID_2SEN_FB"
            />
          </div>
          <Button
            size="sm"
            onClick={() => {
              if (!draft.category?.trim() || !draft.statement?.trim()) return;
              onChange([...rules, makeRule(
                draft.category!, draft.target ?? 'ALL',
                draft.strength ?? 'MUST', draft.statement!, draft.example,
              )]);
              setDraft({ category: '', target: 'ALL', strength: 'MUST', statement: '', example: '', enabled: true });
              setAdding(false);
            }}
          >
            Add rule
          </Button>
        </div>
      )}
    </div>
  );
}
```

---

## Task 5 — Pac Standard template on profile creation

**File:** `src/routes/profiles.tsx` (or wherever the "Create Profile" dialog/form lives —
search for `useCreateDesignProfile`)

When creating a new profile, offer a template choice before the form is pre-filled. Add a
two-option selector at the top of the create dialog:

```tsx
import {
  PAC_STANDARD_GENERAL_RULES,
  PAC_STANDARD_FB_RULES,
  PAC_STANDARD_PROCESS_RULES,
  serializeGeneralRules,
  serializeFbRules,
  serializeProcessRules,
  DEFAULT_GENERAL_RULES,
  DEFAULT_FB_RULES,
  DEFAULT_PROCESS_RULES,
} from '@/lib/design-profile-schemas';
```

Add state:
```ts
const [template, setTemplate] = useState<'blank' | 'pac_standard'>('blank');
```

Show the selector before the profile name field:
```tsx
<div className="space-y-2">
  <Label className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
    Start from
  </Label>
  <div className="grid grid-cols-2 gap-2">
    {[
      { value: 'blank',        label: 'Blank',         desc: 'No pre-filled rules' },
      { value: 'pac_standard', label: 'Pac Standard',  desc: 'Pre-filled with Pac Technologies standard layout' },
    ].map(opt => (
      <button
        key={opt.value}
        type="button"
        onClick={() => setTemplate(opt.value as 'blank' | 'pac_standard')}
        className={cn(
          'p-3 rounded border text-left transition-colors',
          template === opt.value
            ? 'border-primary bg-primary/10'
            : 'border-border hover:border-primary/50'
        )}
      >
        <p className="font-mono text-xs font-medium">{opt.label}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5">{opt.desc}</p>
      </button>
    ))}
  </div>
</div>
```

When submitting the create form, pre-fill the rule fields based on the template:
```ts
const isPac = template === 'pac_standard';
const newProfile: DesignProfileCreate = {
  name: formName,
  // ... other fields ...
  general_rules: serializeGeneralRules(isPac ? PAC_STANDARD_GENERAL_RULES : DEFAULT_GENERAL_RULES),
  fb_rules: serializeFbRules(isPac ? PAC_STANDARD_FB_RULES : DEFAULT_FB_RULES) as unknown as ProcessRuleExample[],
  process_rules: serializeProcessRules(isPac ? PAC_STANDARD_PROCESS_RULES : DEFAULT_PROCESS_RULES) as unknown as ProcessRuleExample[],
  // ... rest of fields ...
};
```

---

## Task 6 — Surface language defaults in the profile editor

**File:** `src/routes/profile-detail.tsx`

The `device_fb_language`, `io_linking_language`, and `process_code_language` fields already
exist on `DesignProfile` and the wizard already reads them. This task just surfaces them
clearly in the profile editor so engineers can set the defaults.

Find the General tab (or create a small "Language Defaults" section within it, above the
Naming section). Add:

```tsx
<div>
  <h3 className="font-mono text-xs uppercase tracking-wider text-muted-foreground mb-3">
    Language Defaults
  </h3>
  <p className="text-xs text-muted-foreground mb-3">
    These are used as defaults in the project wizard. Engineers can still override per session.
  </p>
  <div className="grid grid-cols-3 gap-3">
    {[
      { field: 'device_fb_language',   label: 'Device FB language'  },
      { field: 'io_linking_language',  label: 'IO linking FC language' },
      { field: 'process_code_language', label: 'Process code language' },
    ].map(({ field, label }) => (
      <div key={field} className="space-y-1">
        <Label className="text-xs text-muted-foreground">{label}</Label>
        <Select
          value={(profile as Record<string, string>)[field] ?? 'SCL'}
          onValueChange={v => updateProfile.mutate({ id: profile.id, updates: { [field]: v } })}
        >
          <SelectTrigger className="font-mono text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="SCL">SCL</SelectItem>
            <SelectItem value="LAD">LAD</SelectItem>
          </SelectContent>
        </Select>
      </div>
    ))}
  </div>
</div>
```

Note: these three fields save immediately on change (using `updateProfile.mutate` directly)
rather than waiting for the main Save button, since they are simple enum fields that don't
need the schema serialisation pipeline. If you prefer consistency, buffer them in local state
and save with everything else — either approach works.

---

## Final Verification Checklist

1. `npm run build` — zero TypeScript errors
2. `npm run lint` — zero lint errors
3. Create a new profile using "Pac Standard" template — verify all three tabs pre-fill
   correctly with the Pac standard values
4. Save the profile, reload the page — verify all values persist correctly
5. Check the rendered prompt: in `prompt-builder.ts`, temporarily `console.log` the output
   of `formatDesignProfile()` for a profile with naming prefix `MOTOR_FB` and step increment
   10. Verify output contains lines like:
   ```
   RULE: Naming — FB MUST use the prefix "MOTOR_FB"...
   RULE: State Machine — FB MUST use CASE-based state machines with step values starting at 0 and incrementing by 10...
   ```
6. Verify legacy profiles (with freetext `general_rules`) still load without crashing —
   their text should appear in the freetext escape hatch at the bottom of the General tab
7. Create an extra rule via `ExtraRulesEditor`, save, reload — verify it persists and renders
   in the prompt output

---

## Files Changed Summary

| File | Task | Change |
|------|------|--------|
| `src/types/design-profile.ts` | 1 | Add all schema interfaces |
| `src/lib/design-profile-schemas.ts` | 2 | New file — parse/serialize helpers + Pac Standard template |
| `src/lib/prompt-builder.ts` | 3 | Replace freetext rendering with schema-aware RULE renderers |
| `src/routes/profile-detail.tsx` | 4 | Replace all three rule textareas with structured forms + ExtraRulesEditor |
| `src/routes/profiles.tsx` | 5 | Add template selector to profile create dialog |
| `src/routes/profile-detail.tsx` | 6 | Add language defaults section to General tab |
