/**
 * System prompts for each spec section type.
 * All section generators return structured JSON — never prose blobs.
 *
 * V1 prompts (introduction, equipment_description, functional_state, alarm_table, settings_table)
 * are kept for backward compatibility. V2 prompts follow the industry-standard FDS structure.
 */
import type { UnitConfig, OperatingState, AlarmTier, InstrumentTag } from "@/types/spec-builder";
import { getUnitControlModuleCount } from "@/types/spec-builder";

// ---------------------------------------------------------------------------
// Introduction
// ---------------------------------------------------------------------------

export function buildIntroductionPrompt(
  title: string,
  clientName: string,
  plcModel: string,
  hmiType: string,
  commsProtocol: string,
  units: UnitConfig[],
): string {
  const unitList = units
    .filter((s) => !s.excluded)
    .map((s) => {
      const asmNames = s.equipment_modules.map((a) => a.equipment_module_name).join(", ");
      return `- ${s.unit_name} (${s.equipment_type}, ${s.equipment_modules.length} equipment_modules, ${getUnitControlModuleCount(s)} control_modules)${asmNames ? `\n  Assemblies: ${asmNames}` : ""}`;
    })
    .join("\n");

  return `You are a senior automation engineer authoring a formal functional specification document.

Generate the Introduction section for: "${title}"
Client: ${clientName}

CONTROL SYSTEM:
- PLC: ${plcModel}
- HMI: ${hmiType || "Not specified"}
- Communications: ${commsProtocol || "Not specified"}

SUBSYSTEMS:
${unitList}

Generate:
1. "overview" — 2-4 sentences describing the overall system purpose and scope (formal technical register, third person)
2. "brief_description" — 1-2 sentences per unit summarising its role

Respond ONLY with a JSON object:
{
  "overview": "...",
  "brief_description": "..."
}`;
}

// ---------------------------------------------------------------------------
// Equipment Description (per unit)
// ---------------------------------------------------------------------------

export function buildEquipmentDescriptionPrompt(
  unit: UnitConfig,
  tags: InstrumentTag[],
  designProfileRules?: string,
): string {
  const tagsJson = JSON.stringify(
    tags.map((t) => ({
      tag: t.tag,
      device_type: t.device_type,
      description: t.description,
      control_module_class: t.control_module_class,
      signal_direction: t.signal_direction,
      io_address: t.io_address,
      is_safety: t.is_safety,
    })),
    null,
    2
  );

  // Build equipment_module→device hierarchy for context
  const equipment_moduleHierarchy = unit.equipment_modules.map((a) => ({
    equipment_module: a.equipment_module_name,
    description: a.description,
    control_modules: a.control_modules.map((d) => ({
      control_module_id: d.control_module_id,
      control_module_name: d.control_module_name,
      control_module_class: d.control_module_class,
      is_safety: d.is_safety,
      signals: d.io_signals.map((s) => s.tag),
    })),
  }));

  const rulesSection = designProfileRules
    ? `\nDESIGN RULES:\n${designProfileRules}\n`
    : "";

  return `You are a senior automation engineer authoring a formal functional specification document.
Your output style must match professional EFD (Engineering Functional Description) documents.

You are generating the "Description of Subsystem Equipment" section for: ${unit.unit_name} (${unit.equipment_type}).
${unit.description ? `Subsystem description: ${unit.description}\n` : ""}${rulesSection}
MACHINE HIERARCHY (Assemblies and Devices):
${JSON.stringify(equipment_moduleHierarchy, null, 2)}

INSTRUMENT REGISTER FOR THIS SUBSYSTEM:
${tagsJson}

Generate a section with:
1. A short prose description of the equipment's purpose and operation (2-4 sentences, formal technical register, third person).
   - Reference the equipment_module structure: describe each equipment_module and its role within the unit.
2. A control device instrumentation table with columns: Device | Tag | Description
   - Every tag in the instrument register must appear in the table
   - Device column format: TAG (Type) e.g. "LP059 (Valve)"
   - Description column must be specific, not generic — state the device's actual function
   - Safety control_modules must include "(Safety)" in description
   - Group related control_modules by equipment_module, then by device (e.g. motor command + feedback + overload as consecutive rows)

Respond ONLY with a JSON object:
{
  "prose": "...",
  "control_module_table": [
    { "device": "FAN1_CMD (Motor Contactor)", "tag": "FAN1_CMD", "description": "Fan 1 motor contactor coil — 24VDC output" },
    ...
  ]
}`;
}

// ---------------------------------------------------------------------------
// Functional State (per unit × operating state)
// ---------------------------------------------------------------------------

export function buildFunctionalStatePrompt(
  unit: UnitConfig,
  state: OperatingState,
  deviceTable: Array<{ device: string; tag: string; description: string }>,
): string {
  const deviceTableJson = JSON.stringify(deviceTable, null, 2);

  return `You are a senior automation engineer authoring a formal functional specification.

You are generating the "${state.state_name}" state section for: ${unit.unit_name} (${unit.equipment_type}).

State description: ${state.description}

DEVICE TABLE (use ONLY these tag names — never invent tags):
${deviceTableJson}

Write 3-6 formal technical sentences describing the equipment behaviour in this state.
- Use third person formal register ("The fan array operates continuously...")
- Reference specific tag names from the device table where relevant
- Do not use bullet points — prose paragraphs only
- If a behaviour is not determinable from the available data, write: "[ENGINEER TO COMPLETE — {reason}]"

Respond ONLY with a JSON object:
{
  "state_narrative": "..."
}`;
}

// ---------------------------------------------------------------------------
// Alarm Table (all units)
// ---------------------------------------------------------------------------

export function buildAlarmTablePrompt(
  units: UnitConfig[],
  tagsBySubsystem: Record<string, InstrumentTag[]>,
  alarmTiers: AlarmTier[],
): string {
  const unitData = units
    .filter((s) => !s.excluded)
    .map((s) => ({
      unit: s.unit_name,
      equipment_type: s.equipment_type,
      tags: (tagsBySubsystem[s.unit_id] ?? []).map((t) => ({
        tag: t.tag,
        device_type: t.device_type,
        description: t.description,
        control_module_class: t.control_module_class,
        is_safety: t.is_safety,
      })),
    }));

  return `You are a senior automation engineer authoring a formal functional specification alarm section.

SUBSYSTEMS AND DEVICE TABLES:
${JSON.stringify(unitData, null, 2)}

ALARM TIERS DEFINED FOR THIS PROJECT:
${JSON.stringify(alarmTiers, null, 2)}

Generate an alarm table for each tier. For each alarm entry include:
- tag: the instrument tag that triggers this alarm
- description: what the alarm condition is
- action: what the control system does automatically
- setpoint: use "[ENGINEER TO SET]" as placeholder if not determinable
- delay: use "[ENGINEER TO SET]" as placeholder if not determinable

Classification rules:
- Safety control_modules (is_safety: true) → highest severity tier
- Overload relays → Immediate Shutdown or Controlled Shutdown
- E-Stop control_modules → Immediate Shutdown
- Temperature out of range → Warning or Controlled Shutdown depending on severity
- Run feedback timeout on motors → Controlled Shutdown
- Position confirmation timeout → Controlled Shutdown
- Interlock conditions (permissive not met) → Interlock tier

Respond ONLY with a JSON object:
{
  "alarm_tiers": [
    {
      "tier_name": "Immediate Shutdown",
      "alarms": [
        { "tag": "ESTOP", "description": "...", "action": "...", "setpoint": "...", "delay": "..." }
      ]
    }
  ]
}`;
}

// ---------------------------------------------------------------------------
// Settings Table (all units)
// ---------------------------------------------------------------------------

export function buildSettingsTablePrompt(
  units: UnitConfig[],
): string {
  const unitList = units
    .filter((s) => !s.excluded)
    .map((s) => ({
      unit_id: s.unit_id,
      unit_name: s.unit_name,
      equipment_type: s.equipment_type,
      equipment_modules: s.equipment_modules.map((a) => ({
        equipment_module_name: a.equipment_module_name,
        control_module_count: a.control_modules.length,
      })),
    }));

  return `You are generating the Process Settings and Alarm Settings section of a functional specification.

SUBSYSTEMS:
${JSON.stringify(unitList, null, 2)}

For each unit, generate two tables:
1. Process settings — operational parameters (temperatures, pressures, weights, timers, speeds)
2. Alarm settings — the threshold values that trigger alarms

For every setpoint value, use "[ENGINEER TO SET]" as placeholder unless the value is a well-known industry standard for this equipment type.

Respond ONLY with a JSON object:
{
  "units": [
    {
      "unit_id": "...",
      "process_settings": [
        { "parameter": "...", "default": "[ENGINEER TO SET]", "unit": "...", "notes": "" }
      ],
      "alarm_settings": [
        { "parameter": "...", "setpoint": "[ENGINEER TO SET]", "unit": "...", "delay": "[ENGINEER TO SET]" }
      ]
    }
  ]
}`;
}

// ---------------------------------------------------------------------------
// Gap Audit (Opus)
// ---------------------------------------------------------------------------

export function buildGapAuditPrompt(
  allTags: InstrumentTag[],
  fullSpecMarkdown: string,
): string {
  return `You are a principal automation engineer conducting a formal review of a functional specification document before client issue.

COMPLETE INSTRUMENT REGISTER:
${JSON.stringify(allTags.map((t) => ({ tag: t.tag, device_type: t.device_type, description: t.description, unit: t.unit, is_safety: t.is_safety })), null, 2)}

GENERATED SPECIFICATION:
${fullSpecMarkdown}

Conduct a structured gap audit. Check:

1. TAG COVERAGE — Is every tag in the instrument register referenced at least once in the specification? List any missing tags.

2. STATE COVERAGE — For each unit, is every defined operating state described? List any missing state/unit combinations.

3. ALARM COVERAGE — Is every safety device represented in the alarm table? List any missing.

4. PLACEHOLDER COUNT — Count all "[ENGINEER TO SET]" and "[ENGINEER TO COMPLETE]" placeholders. List each one with its location.

5. TAG CONSISTENCY — Are tag names used consistently throughout? Flag any inconsistencies.

6. INTERLOCK COMPLETENESS — Are interlocks defined for all critical permissive conditions?

7. PATTERN A COMPLETENESS — For every static state (Idle, E-Stop, etc.), is every DO and AO tag listed with an explicit state?

8. PATTERN B COMPLETENESS — For every sequential state (Starting, Execute, etc.), are permissives defined? Are steps numbered with specific completion criteria?

Respond ONLY with a JSON object:
{
  "overall_status": "pass" | "review_required" | "fail",
  "missing_tags": [],
  "missing_states": [],
  "missing_alarms": [],
  "placeholders": [{ "text": "...", "location": "..." }],
  "tag_inconsistencies": [],
  "interlock_gaps": [],
  "pattern_a_gaps": [],
  "pattern_b_gaps": [],
  "summary": "..."
}`;
}

// ===========================================================================
// V2 PROMPTS — Industry-standard FDS (Sections 0–8)
// ===========================================================================

// ---------------------------------------------------------------------------
// Section 0 — Document Control
// ---------------------------------------------------------------------------

export function buildDocumentControlPrompt(
  title: string,
  docCode: string,
  revision: string,
  clientName: string,
  units: UnitConfig[],
): string {
  const equipmentList = units
    .filter((s) => !s.excluded)
    .map((s) => s.unit_name)
    .join(", ");

  return `You are a senior automation engineer preparing the Document Control section of a functional specification.

Document: "${title}"
Document Code: ${docCode}
Revision: ${revision}
Client: ${clientName}
Equipment covered: ${equipmentList}

Generate:
1. A revision history table with a single entry for the current revision (initial issue).
2. A list of referenced documents — infer relevant standards and references based on the equipment types (e.g. IEC 61131-3, ISA-88, relevant safety standards). Include 4–8 entries.
3. An acronym/definition table — include all standard automation acronyms relevant to this specification (PLC, HMI, FB, UDT, IO, DI, DO, AI, AO, VFD, E-Stop, SIL, etc.). Include 10–20 entries.

Respond ONLY with a JSON object:
{
  "revision_history": [
    { "rev": "01", "date": "${new Date().toISOString().split("T")[0]}", "description": "Initial issue", "author": "[ENGINEER NAME]" }
  ],
  "referenced_documents": [
    { "doc_code": "IEC 61131-3", "title": "Programmable Controllers — Programming Languages", "revision": "Ed. 3" }
  ],
  "acronyms": [
    { "term": "PLC", "definition": "Programmable Logic Controller" }
  ]
}`;
}

// ---------------------------------------------------------------------------
// Section 1 — System Overview
// ---------------------------------------------------------------------------

export function buildSystemOverviewPrompt(
  title: string,
  plcModel: string,
  hmiType: string,
  commsProtocol: string,
  units: UnitConfig[],
  scopeExclusions: string[],
  safetyClassification: string | null,
): string {
  const unitList = units
    .filter((s) => !s.excluded)
    .map((s) => {
      const devCount = getUnitControlModuleCount(s);
      return `- ${s.unit_name} (${s.equipment_type}, ${s.equipment_modules.length} equipment_modules, ${devCount} control_modules)`;
    })
    .join("\n");

  const exclusionsText = scopeExclusions.length > 0
    ? `\nSCOPE EXCLUSIONS (user-defined):\n${scopeExclusions.map((e) => `- ${e}`).join("\n")}`
    : "";

  return `You are a senior automation engineer authoring the System Overview section of a functional specification.

Document: "${title}"
PLC: ${plcModel}
HMI: ${hmiType || "Not specified"}
Communications: ${commsProtocol || "Not specified"}
Safety Classification: ${safetyClassification || "Non-safety (standard control)"}

SUBSYSTEMS:
${unitList}
${exclusionsText}

Generate:
1. "hardware_description" — 3–5 sentences describing the control system hardware architecture. Mention the PLC model, HMI type, communications protocol, and any relevant rack/module configuration. Formal technical register, third person.
2. "scope_exclusions" — A formal paragraph listing what is explicitly NOT included in this specification's scope. If no exclusions were provided, state standard exclusions (e.g. "Electrical power distribution", "Mechanical installation", "Network infrastructure").
3. "safety_classification" — A formal statement of the safety classification for this control system.

NOTE: The IO summary table will be computed deterministically — do NOT generate it.

Respond ONLY with a JSON object:
{
  "hardware_description": "...",
  "scope_exclusions": "...",
  "safety_classification": "..."
}`;
}

// ---------------------------------------------------------------------------
// Section 2 — Control Philosophy
// ---------------------------------------------------------------------------

export function buildControlPhilosophyPrompt(
  units: UnitConfig[],
  states: OperatingState[],
  alarmTiers: AlarmTier[],
  faultPhilosophy: string | null,
  designPrinciples: string[],
): string {
  const stateList = states
    .map((s) => `- ${s.state_name} (${s.state_pattern}): ${s.description}`)
    .join("\n");

  const unitList = units
    .filter((s) => !s.excluded)
    .map((s) => `- ${s.unit_name} (${s.equipment_type})`)
    .join("\n");

  const tierList = alarmTiers
    .map((t) => `- ${t.tier_name}: ${t.description}`)
    .join("\n");

  const faultText = faultPhilosophy
    ? `\nUSER-DEFINED FAULT PHILOSOPHY:\n${faultPhilosophy}`
    : "";

  const principlesText = designPrinciples.length > 0
    ? `\nUSER-DEFINED DESIGN PRINCIPLES:\n${designPrinciples.map((p) => `- ${p}`).join("\n")}`
    : "";

  return `You are a senior automation engineer authoring the Control Philosophy section of a functional specification. This section must be concise (2–3 pages) — it defines the RULES that govern all functional descriptions. The detailed per-device per-state behaviour belongs in Section 3, not here.

SUBSYSTEMS:
${unitList}

OPERATING STATES:
${stateList}

ALARM TIERS:
${tierList}
${faultText}
${principlesText}

Generate:
1. "state_list" — For each operating state, provide the state name, its pattern (static/sequential), and a brief 1–2 sentence description of what the system does in this state.
2. "mode_transitions" — 2–4 paragraphs describing how the system transitions between states. Cover: normal start sequence flow, normal stop flow, emergency stop transitions, fault-to-idle recovery. Reference specific state names.
3. "fault_philosophy" — 2–3 paragraphs describing the general fault handling approach: how faults are detected, how they are latched, how they are cleared/reset, and the fault priority hierarchy. If user-defined text was provided, incorporate and expand it.
4. "design_principles" — A list of 6–10 general design principles that apply across all units. Include any user-defined principles and add standard industry practices (e.g. "All outputs de-energise to safe state on loss of communications", "Fault conditions are latched and require manual acknowledgement").

Use formal technical register, third person throughout.

Respond ONLY with a JSON object:
{
  "state_list": [
    { "state_name": "Idle", "pattern": "static", "brief": "All outputs de-energised, system in safe state awaiting start command." }
  ],
  "mode_transitions": "...",
  "fault_philosophy": "...",
  "design_principles": ["...", "..."]
}`;
}

// ---------------------------------------------------------------------------
// Section 3 — Functional Description: Equipment Preamble (per unit)
// ---------------------------------------------------------------------------
// Note: buildEquipmentDescriptionPrompt (V1) is reused for the Section 3 preamble.
// It already generates the prose + device instrumentation table per unit.

// ---------------------------------------------------------------------------
// Section 3 — Functional Description: Pattern A (Device State Table)
// ---------------------------------------------------------------------------

export function buildDeviceStateTablePrompt(
  unit: UnitConfig,
  states: OperatingState[],
  tags: InstrumentTag[],
  deviceTable: Array<{ device: string; tag: string; description: string }>,
): string {
  // Only output tags (DO, AO) need explicit states — inputs are monitoring only
  const outputTags = tags.filter((t) => t.signal_direction === "DO" || t.signal_direction === "AO");
  const outputTagList = outputTags.map((t) => ({
    tag: t.tag,
    description: t.description,
    signal_direction: t.signal_direction,
    device_type: t.device_type,
  }));

  const staticStates = states.filter((s) => s.state_pattern === "static");
  const stateNames = staticStates.map((s) => s.state_name);

  return `You are a senior automation engineer authoring the functional specification for ${unit.unit_name} (${unit.equipment_type}).

You are generating Device State Tables for ALL static operating states. In a device state table, every output (DO/AO) is listed with its exact state in that operating mode. This is the definitive reference — a PLC programmer must be able to read this table and know exactly what every output does in each state.

DEVICE TABLE (reference — all control_modules for this unit):
${JSON.stringify(deviceTable, null, 2)}

OUTPUT TAGS (these must ALL appear in every device state table):
${JSON.stringify(outputTagList, null, 2)}

STATIC STATES TO GENERATE:
${staticStates.map((s) => `- ${s.state_name}: ${s.description}`).join("\n")}

Rules:
- Every DO tag must have a state value: "STOP", "DE-ENERGISED", "OFF", "CLOSED", or similar clear command state
- Every AO tag must have a state value: "0", "0%", "0 RPM", or the specific safe value
- Motor commands in Idle/E-Stop are always STOP
- Solenoid/valve commands in Idle/E-Stop are always DE-ENERGISED
- Safety outputs in E-Stop follow the fail-safe principle
- Use the EXACT tag names from the output tags list — never invent or abbreviate
- If a state value cannot be determined, use "[ENGINEER TO CONFIRM]"

Respond ONLY with a JSON object:
{
  "states": {
${stateNames.map((n) => `    "${n}": [
      { "tag": "...", "description": "...", "state": "STOP" }
    ]`).join(",\n")}
  }
}`;
}

// ---------------------------------------------------------------------------
// Section 3 — Functional Description: Pattern B (Step Table)
// ---------------------------------------------------------------------------

export function buildStepTablePrompt(
  unit: UnitConfig,
  state: OperatingState,
  tags: InstrumentTag[],
  deviceTable: Array<{ device: string; tag: string; description: string }>,
): string {
  const tagsJson = JSON.stringify(
    tags.map((t) => ({
      tag: t.tag,
      device_type: t.device_type,
      description: t.description,
      signal_direction: t.signal_direction,
    })),
    null,
    2,
  );

  return `You are a senior automation engineer authoring the functional specification for ${unit.unit_name} (${unit.equipment_type}).

You are generating a Step Table for the "${state.state_name}" state. A step table is a numbered sequence of actions with explicit completion criteria — the PLC programmer reads this as a direct programming specification.

State: ${state.state_name}
Description: ${state.description}

DEVICE TABLE (reference — all control_modules for this unit):
${JSON.stringify(deviceTable, null, 2)}

ALL TAGS FOR THIS SUBSYSTEM:
${tagsJson}

Rules:
- Start with a PERMISSIVES list — conditions that must ALL be TRUE before the sequence can begin
- Permissives reference specific input tags (e.g. "GK01_M01_OL = FALSE", "ESTOP_01 = TRUE")
- Each step has: step number, action description, and completion criteria
- Actions must reference specific output tags (e.g. "Energise GK01_M01_CMD")
- Completion criteria must reference specific input tags or timer conditions (e.g. "GK01_M01_FB = TRUE within 3s")
- Include timeout handling: what happens if completion criteria is not met within the specified time
- If a timeout occurs, specify the fault action (e.g. "Fault — Motor GK01_M01 failed to start, transition to Idle")
- Use the EXACT tag names from the tags list — never invent or abbreviate
- Steps should follow a logical sequence (e.g. safety checks → pre-conditions → main operation → verification)
- If specific timing or setpoint values cannot be determined, use "[ENGINEER TO SET]"
- For Execute state: describe the ongoing monitoring and control logic, not just a one-time sequence

Respond ONLY with a JSON object:
{
  "permissives": [
    "ESTOP_01 = TRUE (E-Stop not active)",
    "GK01_M01_OL = FALSE (No overload condition)"
  ],
  "steps": [
    { "step": 1, "action": "Energise fan motor contactor GK01_M01_CMD", "completion_criteria": "GK01_M01_FB = TRUE within 3s, else fault — Fan 1 failed to start" }
  ],
  "notes": null
}`;
}

// ---------------------------------------------------------------------------
// Section 4 — I/O List
// ---------------------------------------------------------------------------

export function buildIoListPrompt(
  tags: InstrumentTag[],
): string {
  const tagsJson = JSON.stringify(
    tags.map((t) => ({
      tag: t.tag,
      device_type: t.device_type,
      description: t.description,
      signal_type: t.signal_type,
      io_address: t.io_address,
      signal_direction: t.signal_direction,
      is_safety: t.is_safety,
      unit: t.unit,
    })),
    null,
    2,
  );

  return `You are a senior automation engineer preparing the formal I/O List section of a functional specification.

INSTRUMENT REGISTER (all tags):
${tagsJson}

For each tag, infer the normal (de-energised / no-signal) state and the failsafe state (what the output should do on CPU fault, comms loss, or safety trip).

Rules:
- Digital Inputs (DI): Normal state is the resting state of the field device (e.g. N/O contact = FALSE, N/C contact = TRUE)
- Digital Outputs (DO): Normal state = FALSE (de-energised). Failsafe state = FALSE (de-energised) unless specified otherwise
- Analog Inputs (AI): Normal state = "0" or "4 mA" depending on signal range. Failsafe state = "Last value" or "0"
- Analog Outputs (AO): Normal state = "0" or "0%". Failsafe state = "0" (safe value)
- Safety control_modules: Failsafe state must ensure safe condition (E-Stop failsafe = trip/de-energise)
- Emergency stop inputs are typically N/C (Normal state = TRUE, loss of signal = fault)
- If the normal or failsafe state cannot be determined from the tag info, use "[ENGINEER TO CONFIRM]"

Respond ONLY with a JSON object:
{
  "io_entries": [
    {
      "tag": "...",
      "device_type": "...",
      "description": "...",
      "signal_type": "DI",
      "io_address": "%I0.0",
      "normal_state": "FALSE",
      "failsafe_state": "FALSE"
    }
  ]
}`;
}

// ---------------------------------------------------------------------------
// Section 5 — Alarm Specification (extends V1 alarm_table)
// ---------------------------------------------------------------------------

export function buildAlarmSpecificationPrompt(
  units: UnitConfig[],
  tagsBySubsystem: Record<string, InstrumentTag[]>,
  alarmTiers: AlarmTier[],
): string {
  const unitData = units
    .filter((s) => !s.excluded)
    .map((s) => ({
      unit: s.unit_name,
      equipment_type: s.equipment_type,
      tags: (tagsBySubsystem[s.unit_id] ?? []).map((t) => ({
        tag: t.tag,
        device_type: t.device_type,
        description: t.description,
        control_module_class: t.control_module_class,
        signal_direction: t.signal_direction,
        is_safety: t.is_safety,
      })),
    }));

  // Build effect columns from alarm tiers
  const effectColumns = alarmTiers.map((t) => t.tier_name);

  return `You are a senior automation engineer authoring the Alarm Specification section of a functional specification.

SUBSYSTEMS AND DEVICE TABLES:
${JSON.stringify(unitData, null, 2)}

ALARM TIERS:
${JSON.stringify(alarmTiers, null, 2)}

Generate TWO things:

1. ALARM TABLE — For each alarm tier, list all alarms with:
- tag: the instrument tag that triggers this alarm
- description: what the alarm condition is (specific, not vague)
- action: what the control system does automatically
- setpoint: use "[ENGINEER TO SET]" if not determinable
- delay: use "[ENGINEER TO SET]" if not determinable

Classification rules:
- Safety control_modules (is_safety: true) → highest severity tier
- E-Stop control_modules → Immediate Shutdown
- Overload relays → Immediate Shutdown or Controlled Shutdown
- Temperature out of range → Warning or Controlled Shutdown depending on severity
- Run feedback timeout on motors → Controlled Shutdown
- Position confirmation timeout → Controlled Shutdown

2. CAUSE & EFFECT MATRIX — A cross-reference table where:
- Each row is a fault CAUSE (a specific input condition, e.g. "E-Stop Pressed", "Motor Overload")
- Columns are the EFFECTS: ${JSON.stringify(effectColumns)}
- Each cell is true/false indicating whether that cause triggers that effect
- Every alarm from the alarm table must appear as a cause
- Include the cause_tag (the instrument tag)

Respond ONLY with a JSON object:
{
  "alarm_tiers": [
    {
      "tier_name": "Immediate Shutdown",
      "alarms": [
        { "tag": "ESTOP_01", "description": "Main panel E-Stop activated", "action": "Immediate de-energisation of all outputs", "setpoint": "FALSE", "delay": "0s" }
      ]
    }
  ],
  "cause_effect_matrix": {
    "effects": ${JSON.stringify(effectColumns)},
    "causes": [
      { "cause": "Main Panel E-Stop", "cause_tag": "ESTOP_01", "effects": [true, false, false, false] }
    ]
  }
}`;
}

// ---------------------------------------------------------------------------
// Section 6 — HMI Specification
// ---------------------------------------------------------------------------

export function buildHmiSpecificationPrompt(
  hmiType: string,
  units: UnitConfig[],
  tags: InstrumentTag[],
): string {
  const unitList = units
    .filter((s) => !s.excluded)
    .map((s) => `- ${s.unit_name} (${s.equipment_type}, ${getUnitControlModuleCount(s)} control_modules)`)
    .join("\n");

  const analogTags = tags.filter((t) => t.signal_direction === "AI" || t.signal_direction === "AO");
  const analogList = analogTags.map((t) => `- ${t.tag}: ${t.description} (${t.signal_direction})`).join("\n");

  return `You are a senior automation engineer authoring the HMI Specification section of a functional specification.

HMI Type: ${hmiType}

SUBSYSTEMS:
${unitList}

ANALOG TAGS (candidates for trending):
${analogList || "None"}

Generate:
1. "screen_hierarchy" — A screen navigation tree. Include: Overview screen, one screen per unit, Alarm summary screen, Trend screen, Settings/Parameter screen, User administration screen. Each entry has a parent reference (null for top-level).

2. "access_levels" — A capability matrix with at least 4 levels:
   - Level 1 (Viewer): View screens only
   - Level 2 (Operator): View + acknowledge alarms + operate equipment
   - Level 3 (Supervisor): All operator rights + modify setpoints + view trends
   - Level 4 (Engineer): Full access including system configuration and user management

3. "trending" — List of tags to trend with sample rate. Include all analog tags plus any critical digital status tags. Sample rate depends on signal type (analog: 1s, digital: on-change).

Use formal technical register, third person.

Respond ONLY with a JSON object:
{
  "screen_hierarchy": [
    { "screen_name": "Overview", "parent": null, "description": "System overview showing all unit status" }
  ],
  "access_levels": [
    { "level": 1, "name": "Viewer", "capabilities": ["View process screens", "View alarm history"] }
  ],
  "trending": [
    { "tag": "GK01_TT01", "description": "Fan 1 Discharge Air Temperature", "sample_rate": "1s" }
  ]
}`;
}

// ---------------------------------------------------------------------------
// Section 8 — Testing / FAT
// ---------------------------------------------------------------------------

export function buildTestingFatPrompt(
  units: UnitConfig[],
  states: OperatingState[],
  alarmTiers: AlarmTier[],
  tags: InstrumentTag[],
): string {
  const unitList = units
    .filter((s) => !s.excluded)
    .map((s) => `- ${s.unit_name} (${s.equipment_type})`)
    .join("\n");

  const stateList = states
    .map((s) => `- ${s.state_name} (${s.state_pattern})`)
    .join("\n");

  const safetyTags = tags.filter((t) => t.is_safety);
  const safetyList = safetyTags.map((t) => `- ${t.tag}: ${t.description}`).join("\n");

  return `You are a senior automation engineer preparing the Factory Acceptance Test (FAT) procedure section of a functional specification.

SUBSYSTEMS:
${unitList}

OPERATING STATES:
${stateList}

ALARM TIERS:
${alarmTiers.map((t) => `- ${t.tier_name}`).join("\n")}

SAFETY DEVICES:
${safetyList || "None identified"}

Generate a structured test procedure table. Each test must:
- Have a unique test ID (T001, T002, etc.)
- Reference the specification section it validates (e.g. "3.1 Fan Array — Starting")
- Include specific acceptance criteria the tester can verify
- Cover: power-up/initialisation, each operating state transition for each unit, each alarm tier, E-Stop response and recovery, HMI functionality (if applicable)
- Result column should be "[PASS/FAIL]" (to be completed during test)

Minimum test coverage:
- 1 test per unit for power-up / initialisation
- 1 test per unit × sequential state (starting, execute, completing)
- 1 test per static state (idle state verification, E-Stop response)
- 1 test per alarm tier
- 1 test per safety device
- 1 HMI navigation test (if HMI is specified)
- 1 comms loss / failsafe test

Respond ONLY with a JSON object:
{
  "test_procedures": [
    {
      "test_id": "T001",
      "description": "Verify system powers up and enters Idle state with all outputs de-energised",
      "section_ref": "3.1",
      "acceptance_criteria": "All DO outputs = FALSE, all AO outputs = 0, system status = Idle",
      "result": "[PASS/FAIL]"
    }
  ]
}`;
}
