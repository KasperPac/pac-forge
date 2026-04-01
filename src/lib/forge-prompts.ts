/**
 * forge-prompts.ts
 * Central prompt builders for the Forge Wizard pipeline.
 * All wizard AI calls originate from this file.
 */

import type { DesignProfile } from "@/types/design-profile";
import type {
  ForgeDeviceEntry,
  ForgeIoEntry,
  ForgeArtifact,
  SpecAnalysis,
  SpecAnalysisProcessSequence,
} from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";
import type { PatternCandidate } from "@/types";
import type { ProcessLinkageMatrix, FbWire } from "@/types/forge-matrix";
import type { ProcessRulesSchema } from "@/types/design-profile";
import { parseProcessRules } from "@/lib/design-profile-schemas";
import { formatDesignProfile } from "@/lib/prompt-builder";
import { resolveSection } from "@/lib/prompt-defaults";
import { buildWiringContext } from "@/lib/wiring-context";

// ---------------------------------------------------------------------------
// Step/Action DB pattern rules (injected when profile enables this pattern)
// ---------------------------------------------------------------------------

function buildStepActionRules(processSchema: ProcessRulesSchema | null): string {
  if (!processSchema?.step_action_db?.enabled) return "";

  const { step_array_name, action_array_name, db_name_pattern, custom_notes } = processSchema.step_action_db;
  const S = step_array_name || "S";
  const A = action_array_name || "A";
  const seq = processSchema.sequence_structure;

  return `## MANDATORY: Step/Action DB Pattern

### Step Transition — Latching Circuit (REQUIRED for every step)
Every step rung MUST use this exact latching pattern:

\`\`\`
──┤ ${S}[x-1] ├──┤ Condition ├──┬──( ${S}[x] )──
                                │
──┤ ${S}[x]   ├──┤/${S}[x+1]  ├──┘
\`\`\`

**Top branch (transition)**: Previous step active AND transition condition met — contacts only, NO coil here.
**Bottom branch (seal)**: Current step seals itself (NO_CONTACT) AND next step not yet active (NC_CONTACT) — contacts only, NO coil here.
**After the parallel closes**: A SINGLE OUTPUT_COIL for ${S}[x] — this is the ONLY coil in the rung.

CRITICAL: The OUTPUT_COIL appears ONCE, AFTER the parallel block, NOT inside the branches.
A coil operand must NEVER appear more than once in the entire program.

Rules for STEP TRANSITION rungs:
- NEVER use SET_COIL or RESET_COIL — use OUTPUT_COIL with latching circuits only
- Each coil operand appears in exactly ONE rung — never duplicate a coil
- The rung structure is: series[ parallel[ transition_branch, seal_branch ], OUTPUT_COIL ]
- Transition and seal branches contain only contacts (NO_CONTACT, NC_CONTACT) — never coils
- The seal contact is the step itself (${S}[x])
- The break contact is the next step (NC of ${S}[x+1])

### Fault Handling — SEPARATE FC (do NOT put faults in the sequence FB)
- Fault detection, fault latching, and fault reset logic belong in a SEPARATE Fault FC
- The sequence FB contains ONLY: step transitions, action mapping, and action linking
- NO fault exit rungs in the sequence FB — the fault FC monitors process state and handles all faults
- The fault FC reads step bits, process IO, and timer outputs to detect fault conditions
- The fault FC sets fault flags (statF001, statF002, etc.), statFaultActive, and routes to the fault step
- The fault FC handles operator reset (clearing fault latches, returning to idle)
- Generate the Fault FC as a separate artifact alongside the sequence FB
${db_name_pattern ? `\n### DB naming: \`${db_name_pattern}\` (replace {SECTION} with sequence name)` : ""}

### Action Mapping (REQUIRED)
- Every step ${S}[n] MUST have a corresponding action rung: \`${S}[n] → ${A}[n]\` (1:1 mapping via OUTPUT_COIL)
- Actions are the ONLY outputs that feed process commands — steps NEVER drive outputs directly
- Action linking rungs map ${A}[n] to actual process outputs (ProcessCommands.*, HMI flags, timer enables)
${seq?.safety_inline ? `\n### Safety: Safety contacts (ESTOP_OK, overload) are inline in step transition rungs` : ""}
${seq?.permissives_as_first_rung ? `\n### Permissives: All permissive conditions are evaluated in the first network(s) before any step transitions` : ""}
${custom_notes ? `\n### Additional Notes\n${custom_notes}` : ""}
${seq?.custom_notes ? `\n### Sequence Notes\n${seq.custom_notes}` : ""}`;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const SPEC_ANALYSIS_SCHEMA = `{
  "project_name": "string",
  "project_description": "string (2-4 sentence summary)",
  "plc_type": "string (e.g. S7-1517F)",
  "hmi_type": "string (e.g. UNIFIED COMFORT, KTP900)",
  "subsystems": [
    { "name": "string", "description": "string" }
  ],
  "devices": [
    {
      "id": "string (unique, e.g. DEV001)",
      "name": "string (e.g. GK002-M01-VFD)",
      "tag": "string (instrument tag)",
      "device_type": "string (e.g. Motor DOL, Motor VFD, Solenoid 2-pos, Photoelectric Sensor, Proximity Sensor, Valve)",
      "description": "string (one line, what it does)",
      "subsystem": "string (which subsystem it belongs to)",
      "io_signals": [
        {
          "tag_name": "string (full PLC tag name)",
          "signal_type": "DI | DQ | AI | AQ",
          "description": "string (signal description)",
          "signal_behaviour": "momentary | maintained | continuous | pulsed (how the physical signal behaves: momentary=push button/spring return, maintained=selector switch/toggle, continuous=sensor always on/off, pulsed=encoder/flow meter)",
          "contact_type": "NO | NC (normally open or normally closed wiring — for DI signals)"
        }
      ]
    }
  ],
  "process_sequences": [
    {
      "name": "string (e.g. Conveyor Sorting Sequence)",
      "subsystem": "string",
      "permissives": ["string (pre-conditions that must be true)"],
      "steps": [
        {
          "step_number": 1,
          "action": "string (what happens)",
          "completion_criteria": "string (how we know this step is done)"
        }
      ]
    }
  ],
  "alarms": [
    {
      "name": "string",
      "severity": "IMMEDIATE_SHUTDOWN | CONTROLLED_SHUTDOWN | WARNING",
      "description": "string",
      "possible_causes": ["string"]
    }
  ],
  "interlocks": [
    {
      "name": "string",
      "condition": "string (Boolean expression or natural language)",
      "affected_devices": ["string (device names)"]
    }
  ]
}`;

function formatPatterns(patterns: PatternCandidate[]): string {
  if (patterns.length === 0) return "";
  const lines = patterns.map(
    (p) =>
      `### Correction: ${p.correction_type}\nWRONG:\n\`\`\`scl\n${p.original_snippet}\n\`\`\`\nCORRECT:\n\`\`\`scl\n${p.corrected_snippet}\n\`\`\``,
  );
  return `## MANDATORY: Learned Corrections from Previous Compile Errors\n\n${lines.join("\n\n---\n\n")}`;
}


// ---------------------------------------------------------------------------
// Q&A Review prompts
// ---------------------------------------------------------------------------

/**
 * System prompt for the PM agent to review spec analysis and ask clarifying questions.
 * Uses resolveSection() so the prompt is viewable and editable on the Prompts page.
 */
export function buildQaReviewPrompt(promptSections?: Record<string, string>): string {
  const identity = resolveSection(promptSections, "forge_pm_qa_review", "identity");
  const instructions = resolveSection(promptSections, "forge_pm_qa_review", "instructions");

  return `${identity}

${instructions}`;
}

/**
 * System prompt for producing the final updated SpecAnalysis from Q&A conversation.
 * Use this for a dedicated "finalize" call when the PM hasn't already output updated JSON.
 *
 * HARDCODED — not configurable via Prompts page.
 * Design Profile fields used: none.
 */
export function buildQaUpdateAnalysisPrompt(): string {
  return `You are a senior automation engineer. You have been given:
1. The original spec analysis JSON
2. A Q&A conversation between a Project Manager and an engineer that clarified gaps

Your task is to produce an updated SpecAnalysis JSON that incorporates all the information provided in the Q&A conversation.

Rules:
- Keep all original data that was correct
- Update fields where the engineer provided corrections or additional detail
- Fill in previously empty fields using information from the Q&A answers
- Do NOT invent data that wasn't provided
- Return the updated JSON inside \`\`\`json fences — no explanation`;
}

// ---------------------------------------------------------------------------
// TASK 4: Spec analysis prompt
// ---------------------------------------------------------------------------

/**
 * System prompt for the PM agent to extract structured data from a functional spec.
 * Call with callNonStreaming(), max_tokens: 16384.
 *
 * HARDCODED — not configurable via Prompts page.
 * Design Profile fields used: none (spec analysis is profile-agnostic; the spec defines the project).
 * Design Profile fields NOT used (could be added):
 *   - general_rules: could bias device naming conventions during extraction
 *   - naming_prefix: could pre-apply tag name prefixes
 * To make configurable: add "forge:spec_analysis" section key to PROMPT_DEFAULTS and use resolveSection().
 */
export function buildSpecAnalysisPrompt(fbTemplates?: FbTemplate[], promptSections?: Record<string, string>): string {
  const librarySection =
    fbTemplates && fbTemplates.length > 0
      ? `## FB Library (available Function Blocks)

The following FBs exist in the company library. Use this to decide how many device entries to create:
- Each FB handles EXACTLY ONE physical device instance.
- If the spec describes N physical devices of the same type, create N separate device entries — one per FB instance.
- Match device_type names to the closest FB category name.

${fbTemplates
  .map((t) => `- **${t.name}** (category: ${t.device_category ?? "general"}) — ${t.blocks?.length ?? 1} block(s): ${(t.blocks ?? []).map((b) => `${b.block_type}:${b.block_name}`).join(", ") || t.name}`)
  .join("\n")}

`
      : "";

  const identity = resolveSection(promptSections, "forge_pm_spec_analysis", "identity");
  const instructions = resolveSection(promptSections, "forge_pm_spec_analysis", "instructions");

  return `${identity}

${librarySection}

${instructions}

Return the JSON inside \`\`\`json fences, matching this schema exactly (no explanation):
${SPEC_ANALYSIS_SCHEMA}`;
}

/**
 * User message for spec analysis — wraps the spec text.
 */
export function buildSpecAnalysisUserMessage(specText: string): string {
  return `<spec_text>\n${specText}\n</spec_text>\n\nExtract and return the structured JSON now.`;
}

// ---------------------------------------------------------------------------
// TASK 6: Device SCL code generation prompt
// ---------------------------------------------------------------------------

export interface DeviceGenContext {
  profile?: DesignProfile;
  platformRules: string;
  patterns?: PatternCandidate[];
  fbTemplate?: FbTemplate | null;
  /** Generated device FB artifacts — used by IO linking to know actual variable names */
  deviceArtifacts?: ForgeArtifact[];
  /** Prefixed Inputs DB name (e.g. "DB_Inputs") */
  inputsDbName?: string;
  /** Prefixed Outputs DB name (e.g. "DB_Outputs") */
  outputsDbName?: string;
}

/**
 * System prompt for generating a single device FB in SCL.
 *
 * HARDCODED — not configurable via Prompts page.
 * Design Profile fields used:
 *   - general_rules: injected as "Code Design Profile" coding standards section
 *   - (device_fb_language determines SCL vs LAD path — handled in hook, not here)
 * Design Profile fields NOT used (could be added):
 *   - io_linking_rules: not relevant (device FB generation, not IO linking)
 *   - process_rules: not relevant (device FB, not process sequence)
 *   - naming_prefix / db_naming_prefix: could apply to FB and instance DB names
 * To make configurable: add "forge:device_scl" section key to PROMPT_DEFAULTS and use resolveSection().
 */
export function buildDeviceSclPrompt(
  device: ForgeDeviceEntry,
  context: DeviceGenContext,
  promptSections?: Record<string, string>,
): string {
  const { profile, platformRules, patterns, fbTemplate } = context;

  const templateSection = fbTemplate?.blocks?.length
    ? `## FB Library Template (${fbTemplate.name})\nUse this existing template as the base. Adapt only what's necessary for this device's IO signals.\nDo NOT rename blocks or restructure the code — preserve the template structure.\n\n${
        fbTemplate.blocks
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((b) => `### ${b.block_type}: ${b.block_name}\n\`\`\`scl\n${b.scl_code}\n\`\`\``)
          .join("\n\n")
      }`
    : `## FB Library Template\nNo matching template found. Generate a complete FB from scratch following the platform rules below.`;

  const patternSection = formatPatterns(patterns ?? []);
  const profileSection = profile ? formatDesignProfile(profile, "fb") : "";

  const identity = resolveSection(promptSections, "forge_arch_device", "identity");
  const instructions = resolveSection(promptSections, "forge_arch_device", "instructions");

  return `${identity}

${profileSection}

## Platform Rules
${platformRules}

${templateSection}

${patternSection}

${instructions}

## Output Format
Return the complete SCL code for:
1. Any custom UDT types used by the FB (type UDT) — output FIRST, before the FB
2. The device FB (type FB, named according to naming conventions)
3. The instance DB (type DB, named "Inst${device.name.replace(/[^A-Za-z0-9]/g, "")}")

**UDT rule**: If the FB declares any parameter or static variable with a custom struct type (name starts with "type"), output that UDT as a separate block BEFORE the FB. Do NOT skip UDTs — a missing UDT causes a compile error. Do NOT output standard built-in types (Bool, Int, Real, Time, etc.).

Use this exact format:
\`\`\`scl [BlockType:BlockName]
// content
\`\`\`

Example with UDT:
\`\`\`scl [UDT:typeMotorConfig]
TYPE "typeMotorConfig" :
STRUCT
  runTimeout : Time;
  startDelay : Time;
END_STRUCT;
END_TYPE
\`\`\`
\`\`\`scl [FB:ControlMotorDol]
// FB code
\`\`\`
\`\`\`scl [DB:InstMotor1]
// DB code
\`\`\``;
}

/**
 * User message for device SCL generation.
 */
export function buildDeviceSclUserMessage(device: ForgeDeviceEntry): string {
  const signals = device.io_signals
    .map((s) => `  - ${s.tag_name} (${s.signal_type}): ${s.description}`)
    .join("\n");

  return `Generate the SCL Function Block and instance DB for this device:

**Device name:** ${device.name}
**Tag:** ${device.tag}
**Type:** ${device.device_type}
**Description:** ${device.description}
**Subsystem:** ${device.subsystem}

**IO Signals:**
${signals || "  (no IO signals specified)"}

Generate complete, compile-ready SCL code.`;
}

// ---------------------------------------------------------------------------
// Device LAD code generation prompt
// ---------------------------------------------------------------------------

/**
 * System prompt for generating a device program as LadProgram JSON.
 * The JSON is converted to SimaticML XML by lad-xml-builder.ts.
 *
 * HARDCODED — not configurable via Prompts page.
 * Design Profile fields used:
 *   - general_rules: injected as coding standards
 * Design Profile fields NOT used:
 *   - io_linking_rules, process_rules: not relevant to device LAD generation
 *   - naming_prefix: not applied (LAD program name comes from device name in hook)
 * To make configurable: add "forge:device_lad" section key to PROMPT_DEFAULTS and use resolveSection().
 */
export function buildDeviceLadPrompt(
  _device: ForgeDeviceEntry,
  context: DeviceGenContext,
): string {
  const { profile, platformRules, patterns } = context;
  const profileSection = profile ? formatDesignProfile(profile, "fb") : "";
  const patternSection = formatPatterns(patterns ?? []);

  return `You are a Siemens TIA Portal LAD (Ladder Logic) programmer generating ladder rungs for a single device.

${profileSection}

## Platform Rules
${platformRules}

${patternSection}

## Output Format
Return raw JSON only — no markdown fences. Use this EXACT schema:

{
  "id": "prog_1",
  "name": "DeviceName",
  "blockType": "FB",
  "variables": [],
  "rungs": [
    {
      "id": "rung_1",
      "title": "Description of what this rung does",
      "logic": {
        "type": "series",
        "nodes": [
          { "type": "element", "element": { "id": "e1", "type": "NO_CONTACT", "operand": "TagName", "dataType": "Bool" } },
          { "type": "element", "element": { "id": "e2", "type": "OUTPUT_COIL", "operand": "OutputTag", "dataType": "Bool" } }
        ]
      }
    }
  ]
}

Valid element type values (use EXACTLY these strings):
  "NO_CONTACT"   — normally-open contact
  "NC_CONTACT"   — normally-closed contact
  "OUTPUT_COIL"  — output coil
  "SET_COIL"     — set coil (latch)
  "RESET_COIL"   — reset coil (unlatch)
  "TON"          — on-delay timer: add presetTime "T#5s", instanceDb "InstTimerName"
  "TOF"          — off-delay timer: same fields as TON
  "CMP"          — compare box: add cmpOperator "==" | "!=" | ">" | "<" | ">=" | "<=", operand2 "value"
  "MOVE"         — move box: operand=source, outputOperand=destination

CRITICAL: every rung MUST have a "logic" object with a "nodes" array. Do NOT put "nodes" directly on the rung.
CRITICAL: every rung MUST contain at least one output element (OUTPUT_COIL, SET_COIL, or RESET_COIL).`;
}

/**
 * User message for device LAD generation (same device info as SCL variant).
 */
export function buildDeviceLadUserMessage(device: ForgeDeviceEntry): string {
  return buildDeviceSclUserMessage(device).replace(
    "Generate complete, compile-ready SCL code.",
    "Generate the LadProgram JSON for this device.",
  );
}

// ---------------------------------------------------------------------------
// Deterministic artifact generators (no AI needed)
// ---------------------------------------------------------------------------

/**
 * Convert a device_type string to a valid FC name.
 * e.g. "Motor DOL" → "MotorDolCall", "Photoelectric Sensor" → "PhotoelectricSensorCall"
 *
 * HARDCODED — not configurable via Prompts page.
 * Design Profile fields used: naming_prefix (if set, prepended to the FC name)
 */
export function deviceTypeToFcName(deviceType: string, namingPrefix?: string): string {
  const base =
    deviceType
      .replace(/[^A-Za-z0-9 ]/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join("") + "Call";
  return namingPrefix ? `${namingPrefix}${base}` : base;
}

/**
 * Return the call priority for a device type in OB1 Main.
 * 1 = sensors/inputs (called first), 2 = mid-level, 3 = actuators (called last before sequence FBs/FCs).
 */
export function getDeviceCallOrder(deviceType: string): number {
  const lower = deviceType.toLowerCase();
  const sensorKeywords = ["sensor", "detector", "photoeye", "proximity", "switch", "button", "level", "pressure", "temperature", "flow"];
  const actuatorKeywords = ["motor", "pump", "valve", "solenoid", "actuator", "vfd", "drive"];
  if (sensorKeywords.some((k) => lower.includes(k))) return 1;
  if (actuatorKeywords.some((k) => lower.includes(k))) return 3;
  return 2;
}

/**
 * Generate a global DATA_BLOCK from a matrix globalData entry.
 * Produces HmiData, Configuration, and any other global DBs declared in the matrix.
 *
 * HARDCODED — not configurable via Prompts page.
 */
export function generateGlobalDb(dbName: string, fields: Array<{ fieldName: string; dataType: string; description?: string; defaultValue?: string }>): string {
  const fieldLines = fields
    .filter(f => f.fieldName && f.fieldName.trim().length > 0)
    .map(f => {
      const init = f.defaultValue ? ` := ${f.defaultValue}` : "";
      return `    ${f.fieldName} : ${f.dataType || "Bool"}${init};${f.description ? `  // ${f.description}` : ""}`;
    })
    .join("\n");

  return [
    `DATA_BLOCK "${dbName}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `  VAR`,
    fieldLines || "    // (no fields declared)",
    `  END_VAR`,
    `BEGIN`,
    `END_DATA_BLOCK`,
  ].join("\n");
}

/**
 * Derive a safe SCL variable name from an IO entry.
 * When tag_name is missing or empty, generates a spare_Ix_y / spare_Qx_y name from the address.
 * e.g. %I0.7 → spare_I0_7, %IW256 → spare_IW256, %Q1.0 → spare_Q1_0
 */
function safeTagName(io: ForgeIoEntry): string {
  if (io.tag_name && io.tag_name.trim().length > 0) return io.tag_name.trim();
  // Derive from address: strip leading %, replace dots and colons with underscores
  const addr = (io.address ?? "").replace(/^%/, "").replace(/[.\s:]/g, "_").replace(/[^A-Za-z0-9_]/g, "");
  return addr ? `spare_${addr}` : `spare_${io.signal_type ?? "IO"}_${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Generate the Inputs global DB from the IO list.
 * Maps every physical input signal (DI/AI) to a named field.
 * Unnamed IO entries get a spare_Ix_y name derived from their address.
 *
 * HARDCODED — not configurable via Prompts page.
 * Design Profile fields used: db_naming_prefix (via dbName parameter)
 */
export function generateInputsDb(ioList: ForgeIoEntry[], dbName = "Inputs"): string {
  const inputs = ioList.filter((io) => io.signal_type === "DI" || io.signal_type === "AI");
  const fields = inputs
    .map((io) => `    ${safeTagName(io)} : ${io.data_type};  // ${io.address} - ${io.description ?? ""}`)
    .join("\n");
  return [
    `DATA_BLOCK "${dbName}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `NON_RETAIN`,
    `  VAR`,
    fields || "    // (no input signals)",
    `  END_VAR`,
    `BEGIN`,
    `END_DATA_BLOCK`,
  ].join("\n");
}

/**
 * Generate the Outputs global DB from the IO list.
 * Maps every physical output signal (DQ/AQ) to a named field.
 * Unnamed IO entries get a spare_Qx_y name derived from their address.
 *
 * HARDCODED — not configurable via Prompts page.
 * Design Profile fields used: db_naming_prefix (via dbName parameter)
 */
export function generateOutputsDb(ioList: ForgeIoEntry[], dbName = "Outputs"): string {
  const outputs = ioList.filter((io) => io.signal_type === "DQ" || io.signal_type === "AQ");
  const fields = outputs
    .map((io) => `    ${safeTagName(io)} : ${io.data_type};  // ${io.address} - ${io.description ?? ""}`)
    .join("\n");
  return [
    `DATA_BLOCK "${dbName}"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `NON_RETAIN`,
    `  VAR`,
    fields || "    // (no output signals)",
    `  END_VAR`,
    `BEGIN`,
    `END_DATA_BLOCK`,
  ].join("\n");
}

/**
 * Generate the IoLinking FC deterministically from the IO list.
 * Physical input tags → Inputs DB fields.
 * Outputs DB fields → physical output tags.
 * No FB instance DB access — that responsibility belongs to the Device Call FCs.
 *
 * HARDCODED — not configurable via Prompts page.
 * Design Profile fields used: none (io_linking_rules not applicable for purely deterministic generation)
 */
export function generateIoLinkingFc(
  ioList: ForgeIoEntry[],
  inputsDbName = "Inputs",
  outputsDbName = "Outputs",
  fcName = "IoLinking",
): string {
  const inputs = ioList.filter((io) => io.signal_type === "DI" || io.signal_type === "AI");
  const outputs = ioList.filter((io) => io.signal_type === "DQ" || io.signal_type === "AQ");

  const inputLines = inputs
    .map((io) => {
      const name = safeTagName(io);
      return `  "${inputsDbName}".${name} := "${name}";`;
    })
    .join("\n");
  const outputLines = outputs
    .map((io) => {
      const name = safeTagName(io);
      return `  "${name}" := "${outputsDbName}".${name};`;
    })
    .join("\n");

  return [
    `FUNCTION "${fcName}" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `BEGIN`,
    `  REGION Map Physical Inputs to ${inputsDbName} DB`,
    inputLines || "  // (no input signals)",
    `  END_REGION`,
    ``,
    `  REGION Map ${outputsDbName} DB to Physical Outputs`,
    outputLines || "  // (no output signals)",
    `  END_REGION`,
    `END_FUNCTION`,
  ].join("\n");
}

/**
 * Generate OB1 Main deterministically from the ordered list of device call FC names.
 * Call order: IoLinking → device call FCs (pre-sorted by caller) → sequence FBs/FCs.
 * Sequence FBs/FCs are called directly; no separate RunProcess FC wrapper.
 *
 * HARDCODED — not configurable via Prompts page.
 */
export function generateOb1Main(deviceCallFcNames: string[], sequenceFcNames: string[] = [], ioLinkingFcName = "IoLinking"): string {
  const fcCalls = deviceCallFcNames.map((name) => `  "${name}"();`).join("\n");
  const seqCalls = sequenceFcNames.map((name) => `  "${name}"();`).join("\n");
  return [
    `ORGANIZATION_BLOCK "Main"`,
    `TITLE = 'Main Program Sweep (Cycle)'`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `  VAR_TEMP`,
    `    tempFirstScan : Bool;`,
    `  END_VAR`,
    `BEGIN`,
    `  "${ioLinkingFcName}"();`,
    fcCalls,
    ...(seqCalls ? [seqCalls] : []),
    `END_ORGANIZATION_BLOCK`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Device Call FC prompt (AI-generated, one per device type)
// ---------------------------------------------------------------------------

export interface DeviceCallFcContext {
  /** Derived FC name, e.g. "MotorDolCall" */
  fcName: string;
  /** Device type string, e.g. "Motor DOL" */
  deviceType: string;
  /** EXACT FB block name from the generated artifact, e.g. "PE_Sensor". MUST be used verbatim. */
  fbName?: string;
  /** All devices of this type */
  devices: ForgeDeviceEntry[];
  /** Instance DB names for each device, e.g. ["InstMotor1", "InstMotor2"] */
  instanceDbNames: string[];
  /** VAR_INPUT/VAR_OUTPUT/VAR_IN_OUT sections extracted from the FB artifact for this type */
  fbInterfaceSection: string;
  /** Inputs DB field names (DI/AI signals) relevant to this device type */
  inputsDbFields: string[];
  /** Outputs DB field names (DQ/AQ signals) relevant to this device type */
  outputsDbFields: string[];
  /** Name of the Inputs global DB, e.g. "Inputs" */
  inputsDbName: string;
  /** Name of the Outputs global DB, e.g. "Outputs" */
  outputsDbName: string;
  profile?: DesignProfile;
  platformRules: string;
  patterns?: PatternCandidate[];
  /**
   * Matrix wiring for devices of this type — engineer-confirmed connections from Matrix Review.
   * When present, used as the primary wiring reference (no guessing).
   * When empty, the AI infers from device descriptions and FB interfaces.
   */
  matrixWiring: Array<{
    deviceName: string;
    instanceDbName: string;
    wiring: FbWire[];
  }>;
  /** Reference library sections relevant to this device type (from two-pass AI lookup) */
  referenceSections?: string;
}

/**
 * System prompt for generating one Device Call FC per device type.
 * This FC calls all FB instances of the given device type with all inputs fully wired.
 *
 * HARDCODED — not configurable via Prompts page.
 * Design Profile fields used:
 *   - general_rules: injected as coding standards
 *   - naming_prefix: used for FC naming (passed via context.fcName)
 * Design Profile fields NOT used (could be added):
 *   - io_linking_rules: not relevant (device call FC, not IO linking)
 *   - process_rules: not relevant (device call FC, not process sequences)
 * To make configurable: add "forge:device_call_fc" section key to PROMPT_DEFAULTS and use resolveSection().
 */
export function buildDeviceCallFcPrompt(context: DeviceCallFcContext, promptSections?: Record<string, string>): string {
  const { profile, platformRules, patterns, fcName, deviceType, devices, instanceDbNames, fbInterfaceSection, inputsDbFields, outputsDbFields, inputsDbName, outputsDbName, matrixWiring, referenceSections } = context;

  const profileSection = profile ? formatDesignProfile(profile, "general") : "";
  const patternSection = formatPatterns(patterns ?? []);
  const referenceSection = referenceSections ? `\n## Reference Documentation\n${referenceSections}\n` : "";

  const deviceList = devices
    .map((d, i) => `  ${i + 1}. "${instanceDbNames[i] ?? `Inst${d.name.replace(/[^A-Za-z0-9]/g, "")}`}" — ${d.name} (${d.tag}): ${d.description}`)
    .join("\n");

  const inputFieldsList = inputsDbFields.length > 0
    ? inputsDbFields.map((f) => `  - "${inputsDbName}".${f}`).join("\n")
    : "  (none)";

  const outputFieldsList = outputsDbFields.length > 0
    ? outputsDbFields.map((f) => `  - "${outputsDbName}".${f}`).join("\n")
    : "  (none)";

  // Format engineer-confirmed matrix wiring as the primary wiring reference
  const matrixWiringSection = matrixWiring.length > 0
    ? matrixWiring.map(device => {
        const inputWires = device.wiring
          .filter(w => w.direction === "in")
          .map(w => {
            let source: string;
            if (w.wireType === "io") {
              source = `"${inputsDbName}".${w.connectedTo}`;
            } else if (w.wireType === "fb") {
              const parts = w.connectedTo.split(".");
              source = parts.length >= 2 ? `"${parts[0]}".${parts.slice(1).join(".")}` : w.connectedTo;
            } else if (w.wireType === "global") {
              const parts = w.connectedTo.split(".");
              source = parts.length >= 2 ? `"${parts[0]}".${parts.slice(1).join(".")}` : w.connectedTo;
            } else {
              // constant — guard against UDT/struct params incorrectly wired as constants
              // (e.g. config := TRUE is invalid SCL when config is typeMotorConfig)
              const isUdtDataType = w.dataType
                ? !/^(Bool|Int|Real|Time|DInt|LInt|SInt|USInt|UInt|UDInt|Word|DWord|LWord|Byte|Char|LReal|LTime|S5Time|Date|TimeOfDay|DateTime)$/i.test(w.dataType)
                : false;
              if (isUdtDataType) {
                // Emit as a placeholder — AI must wire to Configuration DB instead
                source = `"Configuration".${w.paramName}Config (* ⚠ was constant "${w.connectedTo}" — wire UDT param to Configuration DB *)`;
              } else {
                source = w.connectedTo;
              }
            }
            return `    ${w.paramName} := ${source}`;
          })
          .join(",\n");

        const outputWires = device.wiring
          .filter(w => w.direction === "out")
          .map(w => {
            let target: string;
            if (w.wireType === "io") {
              target = `"${outputsDbName}".${w.connectedTo}`;
            } else if (w.wireType === "global") {
              const parts = w.connectedTo.split(".");
              target = parts.length >= 2 ? `"${parts[0]}".${parts.slice(1).join(".")}` : w.connectedTo;
            } else {
              target = w.connectedTo;
            }
            return `    ${w.paramName} => ${target}`;
          })
          .join(",\n");

        const allWires = [inputWires, outputWires].filter(Boolean).join(",\n");
        return `### "${device.instanceDbName}" (${device.deviceName})\n\`\`\`\n"${device.instanceDbName}"(\n${allWires}\n);\n\`\`\``;
      }).join("\n\n")
    : "";

  const hasMatrix = matrixWiring.length > 0;

  const identity = resolveSection(promptSections, "forge_arch_call_fc", "identity");

  return `${identity}

${profileSection}

## Platform Rules
${platformRules}

${patternSection}
${referenceSection}
## Your Task
Generate a single FC called "${fcName}" that calls ALL instances of the "${deviceType}" FB.

## Rules
1. Call EVERY instance DB listed below — no skipped instances.
2. Wire EVERY VAR_INPUT parameter of the FB — no unwired inputs.
3. Physical inputs come from the "${inputsDbName}" DB (pre-populated by IoLinking FC).
4. Physical outputs go to the "${outputsDbName}" DB (IoLinking FC will copy to hardware).
5. ${hasMatrix
    ? "Inter-device signals MUST match the Matrix wiring below. Do NOT guess or infer connections — the engineer has confirmed the exact wiring. If the matrix says endSensorForward connects to InstPE01._SensorDlyOnOff, write exactly: endSensorForward := \"InstPE01\"._SensorDlyOnOff"
    : "Inter-device signals (e.g. sensor output feeding conveyor input) use instance DB field access: \"InstSensor1\".outputField."}
6. Use named association for all FB calls: "InstDBName"(param1 := source, param2 := source, ...).
7. Do NOT wire IO tags directly — always go through the "${inputsDbName}"/"${outputsDbName}" DBs.
8. ⛔ VAR_OUTPUT: If an output parameter has no wiring target, OMIT it — TIA stores it in the instance DB automatically. NEVER write "paramName =>" with an empty right-hand side.
    ⛔ VAR_IN_OUT: These are MANDATORY — always wire them. If no matrix entry exists, wire to the instance DB field: \`paramName := "InstDBName".paramName\`. Siemens Open Library HMI UDTs (e.g. HMI_MotorControl) are VAR_IN_OUT — the HMI faceplate reads/writes the instance DB field directly.
${hasMatrix ? `9. Follow the Matrix wiring exactly. Do NOT add wires not listed unless they are mandatory FB parameters with no matrix entry. Exception: safety signal polarity — see rule 11.
10. ⛔ Do NOT write to HmiData unless that exact write is shown in the Matrix wiring. HmiData is for HMI DISPLAY ONLY — never read from it in PLC logic. Inter-device signals must flow through ProcessCommands, ProcessState, FaultData, or DeviceStatus DBs.
11. ## Safety Signal Polarity Convention
    - Signals named "safetyOk", "systemOk": TRUE = safe/healthy, FALSE = fault/danger
    - FB inputs named "eStop", "emergency", "bInEstop": TRUE = STOP/danger, FALSE = safe
    - When wiring safetyOk → eStop, ALWAYS negate: \`eStop := NOT source\`
    - When wiring safetyOk → bInEstop (Siemens Open Library), ALWAYS negate: \`bInEstop := NOT source\`
12. ## DB Architecture Rules
    - DB_HmiData: WRITE-ONLY for HMI display. Device call FCs write status to it. NO PLC logic ever reads from it.
    - DB_ProcessCommands: Sequence → device commands. Written by process code, read by device call FCs.
    - DB_ProcessState: Internal state tracking. Written/read by process code only.
    - DB_FaultData: Fault latches. Written by device FBs/process, read by process/sequences.
    - DB_Inputs/DB_Outputs: Physical IO. DB_Inputs written by IoLinking, DB_Outputs read by IoLinking.
    - Siemens Open Library FBs have built-in HMI UDTs (VAR_IN_OUT like HMI_MotorControl) — the HMI faceplate reads/writes the instance DB directly, NOT through DB_HmiData.` : ""}

## Type Conversion Rules
If a wire's notes contain "TYPE_CONVERSION: X→Y", the source signal type (X) differs from
the FB parameter type (Y). You MUST add inline conversion logic BEFORE the FB call:
- **Int→Bool**: Use comparison: \`tempBool := (intSource <> 0);\` or specific value check
- **Bool→Int**: Use conditional: \`tempInt := SEL(G := boolSource, IN0 := 0, IN1 := 1);\`
- **Int→Word**: Use type cast: \`tempWord := INT_TO_WORD(intSource);\`
- **Word→Int**: Use type cast: \`tempInt := WORD_TO_INT(wordSource);\`
Declare conversion temps in VAR_TEMP. NEVER silently wire mismatched types.

## Computed/Derived Signals
Some signals are NOT direct IO or DB fields — they are computed from other signals:
- XOR patterns (e.g. sensorXorOk): \`tempXor := sensor1 XOR sensor2;\`
- Inverted signals (e.g. overloadOk from overloadFault): \`tempOk := NOT faultSignal;\`
- Combined status (e.g. allSensorsOk): \`tempOk := sensor1 AND sensor2 AND sensor3;\`
If a wiring source doesn't exist as a DB field or IO tag, check if it can be computed
from available signals. Generate the computation BEFORE the FB call in VAR_TEMP.

## FB Interface — MANDATORY REFERENCE
⛔ HARD RULE: Only use parameter names that appear VERBATIM in the VAR_INPUT/VAR_OUTPUT sections below. Do NOT invent param names. Do NOT use param names from a different device type's FB.
${fbInterfaceSection || "(no FB interface available — infer from device type and IO signals)"}

## Devices of Type "${deviceType}" to Call
${deviceList}
${hasMatrix ? `
## ENGINEER-CONFIRMED WIRING (from Matrix Review)
The following wiring has been reviewed and confirmed by the engineer.
Use these EXACT connections. Do NOT change, reorder, or omit any wire.
Do NOT add wires that are not listed here unless they are mandatory FB parameters with no matrix entry.

${matrixWiringSection}
` : `
## Available Inputs DB Fields (DI/AI signals for this device type)
${inputFieldsList}

## Available Outputs DB Fields (DQ/AQ signals for this device type)
${outputFieldsList}
`}
## Output Format
\`\`\`scl [FC:${fcName}]
// code
\`\`\``;
}

/**
 * LAD version of the Device Call FC prompt.
 * Generates a LadProgram JSON where each network calls one FB instance.
 */
export function buildDeviceCallFcLadPrompt(context: DeviceCallFcContext): string {
  const { profile, platformRules, patterns, fcName, deviceType, devices, instanceDbNames, fbInterfaceSection, inputsDbFields, outputsDbFields, inputsDbName, outputsDbName, matrixWiring, referenceSections } = context;

  const profileSection = profile ? formatDesignProfile(profile, "general") : "";
  const patternSection = formatPatterns(patterns ?? []);
  const referenceSection = referenceSections ? `\n## Reference Documentation\n${referenceSections}\n` : "";

  const deviceList = devices
    .map((d, i) => `  ${i + 1}. "${instanceDbNames[i] ?? `Inst${d.name.replace(/[^A-Za-z0-9]/g, "")}`}" — ${d.name} (${d.tag}): ${d.description}`)
    .join("\n");

  const inputFieldsList = inputsDbFields.length > 0
    ? inputsDbFields.map((f) => `  - "${inputsDbName}".${f}`).join("\n")
    : "  (none)";

  const outputFieldsList = outputsDbFields.length > 0
    ? outputsDbFields.map((f) => `  - "${outputsDbName}".${f}`).join("\n")
    : "  (none)";

  // Build matrix wiring description for LAD context
  const matrixDescription = matrixWiring.length > 0
    ? matrixWiring.map(device => {
        const wires = device.wiring
          .map(w => {
            const dir = w.direction === "in" ? "←" : "→";
            let target: string;
            if (w.wireType === "io") {
              target = w.direction === "in" ? `"${inputsDbName}".${w.connectedTo}` : `"${outputsDbName}".${w.connectedTo}`;
            } else if (w.wireType === "fb" || w.wireType === "global") {
              const parts = w.connectedTo.split(".");
              target = parts.length >= 2 ? `"${parts[0]}".${parts.slice(1).join(".")}` : w.connectedTo;
            } else {
              target = w.connectedTo;
            }
            return `    ${w.paramName} ${dir} ${target}`;
          })
          .join("\n");
        return `### "${device.instanceDbName}" (${device.deviceName})\n${wires}`;
      }).join("\n\n")
    : "";

  const hasMatrix = matrixWiring.length > 0;

  // Use the exact FB name from the generated artifact — NEVER invent or guess
  const headerMatch = fbInterfaceSection.match(/###\s+(\S+)/);
  const fbName = context.fbName ?? headerMatch?.[1] ?? fcName;

  return `You are a senior Siemens TIA Portal LAD programmer generating a Device Call FC.

${profileSection}

## Platform Rules
${platformRules}

${patternSection}
${referenceSection}
## Your Task
Generate a single FC called "${fcName}" in LAD (Ladder Logic) that calls ALL instances of the "${deviceType}" FB.
Each rung contains ONE FB_CALL element that calls the FB instance with all parameters wired.

## Rules
1. ONE rung per FB instance — each rung has exactly ONE FB_CALL element.
2. The FB_CALL element calls the FB via its instance DB.
3. Wire EVERY VAR_INPUT and VAR_OUTPUT parameter in the callParams array.
4. ${hasMatrix ? "Use EXACT connections from the Matrix wiring below." : `Wire inputs from "${inputsDbName}" DB, outputs to "${outputsDbName}" DB.`}
5. Each callParam has: name (param name), direction ("in" or "out" or "inout"), value (the connected tag), dataType.
6. For input params: value is the source tag (e.g. "${inputsDbName}.startButton").
7. For output params: value is the destination tag (e.g. "HmiData.cv01Status").
8. Use quoted DB access format: "DbName".fieldName (with quotes around the DB name).

## FB Interface — MANDATORY REFERENCE
⛔ Only use parameter names that appear VERBATIM in the sections below.
${fbInterfaceSection || "(no FB interface available)"}

## FB Name for Calls
Use fbName: "${fbName}"

## Devices of Type "${deviceType}" to Call
${deviceList}
${hasMatrix ? `
## ENGINEER-CONFIRMED WIRING (from Matrix Review)
${matrixDescription}
` : `
## Available Inputs DB Fields
${inputFieldsList}

## Available Outputs DB Fields
${outputFieldsList}
`}
## Output Format
Generate a LadProgram JSON object. Respond with ONLY the raw JSON (no markdown wrapper).

The ONLY element type you should use is "FB_CALL". Each rung has ONE FB_CALL element.

Use this EXACT schema:
{
  "name": "${fcName}",
  "blockType": "FC",
  "variables": [],
  "rungs": [
    {
      "id": "rung_1",
      "title": "Call ${instanceDbNames[0] ?? "InstDevice1"}",
      "logic": {
        "type": "series",
        "nodes": [
          {
            "type": "element",
            "element": {
              "id": "e1",
              "type": "FB_CALL",
              "operand": "${fbName}",
              "fbName": "${fbName}",
              "fbInstanceDb": "${instanceDbNames[0] ?? "InstDevice1"}",
              "callParams": [
                { "name": "enable", "direction": "in", "value": "\\"HmiData\\".cv01Run", "dataType": "Bool" },
                { "name": "speed", "direction": "in", "value": "\\"${inputsDbName}\\".speedSetpoint", "dataType": "Real" },
                { "name": "busy", "direction": "out", "value": "\\"HmiData\\".cv01Busy", "dataType": "Bool" },
                { "name": "status", "direction": "out", "value": "\\"HmiData\\".cv01Status", "dataType": "Word" }
              ]
            }
          }
        ]
      }
    }
  ]
}

CRITICAL: Every rung must have exactly ONE FB_CALL element. Do NOT use NO_CONTACT, OUTPUT_COIL, or MOVE elements — the FB_CALL element handles all parameter wiring internally.`;
}

/**
 * User message for Device Call FC generation.
 */
export function buildDeviceCallFcUserMessage(context: DeviceCallFcContext): string {
  return `Generate the "${context.fcName}" FC that calls all ${context.devices.length} "${context.deviceType}" device instance(s) with all inputs fully wired.`;
}

/**
 * Extract VAR_IN_OUT parameter names from an FB interface section.
 * VAR_IN_OUT params are MANDATORY in TIA Portal — omitting them from a call
 * is a compile error. Returns param names with their declared types.
 */
function extractVarInOutParams(fbInterfaceSection: string): Array<{ name: string; dataType: string }> {
  const params: Array<{ name: string; dataType: string }> = [];
  const sectionRe = /VAR_IN_OUT([\s\S]*?)END_VAR/gi;
  let sectionMatch: RegExpExecArray | null;
  while ((sectionMatch = sectionRe.exec(fbInterfaceSection)) !== null) {
    const body = sectionMatch[1];
    const paramRe = /^\s+(\w+)\s*:\s*([^;]+)/gm;
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramRe.exec(body)) !== null) {
      params.push({ name: paramMatch[1], dataType: paramMatch[2].trim() });
    }
  }
  return params;
}

/**
 * Extract VAR_OUTPUT parameter names from an FB interface section.
 * Returns param names with their declared types.
 */
function extractVarOutputParams(fbInterfaceSection: string): Array<{ name: string; dataType: string }> {
  const params: Array<{ name: string; dataType: string }> = [];
  const sectionRe = /VAR_OUTPUT([\s\S]*?)END_VAR/gi;
  let sectionMatch: RegExpExecArray | null;
  while ((sectionMatch = sectionRe.exec(fbInterfaceSection)) !== null) {
    const body = sectionMatch[1];
    const paramRe = /^\s+(\w+)\s*:\s*([^;]+)/gm;
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramRe.exec(body)) !== null) {
      params.push({ name: paramMatch[1], dataType: paramMatch[2].trim() });
    }
  }
  return params;
}

/**
 * Detect safety signal polarity mismatches and return whether the source
 * value needs to be negated. E-stop/emergency inputs are active-high
 * (TRUE = danger), but safety feedback signals like safetyOk are active-low
 * (TRUE = healthy). Wiring safetyOk directly to eStop inverts the safety logic.
 */
function needsPolarityInversion(paramName: string, connectedTo: string): boolean {
  const param = paramName.toLowerCase();
  const source = connectedTo.toLowerCase();
  // eStop/emergency input params wired to safetyOk/systemOk sources need NOT
  const isEStopParam = param.includes("estop") || param.includes("emergency");
  const isSafetySource = source.includes("safetyok") || source.includes("systemok") || source.includes("safety_ok");
  return isEStopParam && isSafetySource;
}

/**
 * Generate a Device Call FC deterministically from matrix wiring — no AI needed.
 *
 * When the matrix has wiring entries for all devices of this type, we can produce
 * exact SCL directly: each instance DB is called with named-association params built
 * from the matrix wiring array. This eliminates AI hallucinations (invented HmiData
 * fields, wrong param names, duplicate assignments).
 *
 * Falls back to null if the matrix has no wiring for this device type (AI path used).
 */
export function generateDeviceCallFc(context: DeviceCallFcContext): string | null {
  const { fcName, matrixWiring, inputsDbName, outputsDbName, fbInterfaceSection } = context;
  if (matrixWiring.length === 0) return null;

  // Extract mandatory VAR_IN_OUT and VAR_OUTPUT params from FB interface
  const varInOutParams = extractVarInOutParams(fbInterfaceSection);
  const varOutputParams = extractVarOutputParams(fbInterfaceSection);

  const callBlocks: string[] = [];

  for (const device of matrixWiring) {
    const inputLines: string[] = [];
    const outputLines: string[] = [];
    const inoutLines: string[] = [];
    const wiredParams = new Set<string>(); // track which params have matrix wiring

    for (const w of device.wiring) {
      // Skip wires with no connectedTo — can't build a valid SCL expression
      if (!w.connectedTo?.trim()) continue;

      wiredParams.add(w.paramName.toLowerCase());

      let source: string;
      if (w.wireType === "io") {
        source = w.direction === "in"
          ? `"${inputsDbName}".${w.connectedTo}`
          : `"${outputsDbName}".${w.connectedTo}`;
      } else if (w.wireType === "fb") {
        const parts = (w.connectedTo ?? "").split(".");
        source = parts.length >= 2 ? `"${parts[0]}".${parts.slice(1).join(".")}` : (w.connectedTo ?? "");
      } else if (w.wireType === "global") {
        const parts = (w.connectedTo ?? "").split(".");
        source = parts.length >= 2 ? `"${parts[0]}".${parts.slice(1).join(".")}` : (w.connectedTo ?? "");
      } else {
        // constant — check for UDT params incorrectly wired as constants
        const isUdt = w.dataType
          ? !/^(Bool|Int|Real|Time|DInt|LInt|SInt|USInt|UInt|UDInt|Word|DWord|LWord|Byte|Char|LReal|LTime|S5Time|Date|TimeOfDay|DateTime)$/i.test(w.dataType)
          : false;
        if (isUdt) {
          // Wire config UDT to Configuration DB
          source = `"Configuration".${w.paramName}Config`;
        } else {
          source = w.connectedTo ?? "";
        }
      }

      // Skip wires with no resolved destination — emitting "param :=" or "param =>"
      // with a blank right-hand side is a compile error.
      if (!source.trim()) continue;

      if (w.direction === "in") {
        // Invert safety signals: safetyOk (TRUE=safe) must be negated
        // when wired to eStop inputs (TRUE=danger)
        const invert = needsPolarityInversion(w.paramName, w.connectedTo ?? "");
        const expr = invert ? `NOT ${source}` : source;
        inputLines.push(`        ${w.paramName} := ${expr}`);
      } else {
        outputLines.push(`        ${w.paramName} => ${source}`);
      }
    }

    // VAR_IN_OUT params are MANDATORY — wire to instance DB field if no matrix entry
    // (Siemens Open Library HMI UDTs like HMI_MotorControl live on the instance DB)
    for (const p of varInOutParams) {
      if (!wiredParams.has(p.name.toLowerCase())) {
        inoutLines.push(`        ${p.name} := "${device.instanceDbName}".${p.name}`);
      }
    }

    // VAR_OUTPUT params missing from matrix — wire to instance DB to avoid
    // "unwired output" compile warnings (output values remain accessible via inst DB)
    for (const p of varOutputParams) {
      if (!wiredParams.has(p.name.toLowerCase())) {
        // Don't add explicit wiring for unwired outputs — TIA Portal
        // stores them in the instance DB automatically. Only VAR_IN_OUT is mandatory.
      }
    }

    const allLines = [...inputLines, ...inoutLines, ...outputLines];
    if (allLines.length > 0) {
      callBlocks.push(`    "${device.instanceDbName}"(\n${allLines.join(",\n")}\n    );`);
    } else {
      callBlocks.push(`    "${device.instanceDbName}"();`);
    }
  }

  return [
    `FUNCTION "${fcName}" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `BEGIN`,
    callBlocks.join("\n\n"),
    `END_FUNCTION`,
  ].join("\n");
}

/**
 * Deterministic LAD version of the Device Call FC generator.
 * Produces a LadProgram JSON with one FB_CALL rung per device instance.
 * All wiring comes from the engineer-confirmed matrix — no AI needed.
 *
 * Returns null if matrixWiring is empty (nothing to generate).
 */
export function generateDeviceCallFcLad(context: DeviceCallFcContext): string | null {
  const { fcName, fbName: contextFbName, matrixWiring, inputsDbName, outputsDbName, fbInterfaceSection } = context;
  if (matrixWiring.length === 0) return null;

  // FB name MUST come from the actual generated artifact — no guessing or inventing.
  // Fallback chain: explicit fbName > interface section header > error-safe default.
  const headerMatch = fbInterfaceSection.match(/###\s+(\S+)/);
  const fbName = contextFbName ?? headerMatch?.[1] ?? fcName;

  // Extract parameter data types from the FB interface
  const paramDataTypes = new Map<string, string>();
  const paramTypeRe = /^\s+(\w+)\s*:\s*(\w+)/gm;
  let ptMatch: RegExpExecArray | null;
  while ((ptMatch = paramTypeRe.exec(fbInterfaceSection)) !== null) {
    paramDataTypes.set(ptMatch[1].toLowerCase(), ptMatch[2]);
  }

  // Extract mandatory VAR_IN_OUT params from FB interface
  const varInOutParams = extractVarInOutParams(fbInterfaceSection);

  const rungs = matrixWiring.map((device, idx) => {
    const wiredParams = new Set(device.wiring.filter(w => w.connectedTo?.trim()).map(w => w.paramName.toLowerCase()));

    const callParams = device.wiring
      .filter(w => w.connectedTo?.trim())
      .map(w => {
        let value: string;
        if (w.wireType === "io") {
          value = w.direction === "in"
            ? `"${inputsDbName}".${w.connectedTo}`
            : `"${outputsDbName}".${w.connectedTo}`;
        } else if (w.wireType === "fb" || w.wireType === "global") {
          const parts = (w.connectedTo ?? "").split(".");
          value = parts.length >= 2 ? `"${parts[0]}".${parts.slice(1).join(".")}` : w.connectedTo;
        } else {
          value = w.connectedTo ?? "";
        }
        // Invert safety signals: safetyOk (TRUE=safe) must be negated
        // when wired to eStop inputs (TRUE=danger)
        const invert = w.direction === "in" && needsPolarityInversion(w.paramName, w.connectedTo ?? "");
        const finalValue = invert ? `NOT ${value}` : value;
        return {
          name: w.paramName,
          direction: w.direction as "in" | "out" | "inout",
          value: finalValue,
          dataType: w.dataType ?? paramDataTypes.get(w.paramName.toLowerCase()) ?? "Variant",
        };
      });

    // Add mandatory VAR_IN_OUT params not in matrix wiring
    // (e.g., Siemens Open Library HMI UDTs — wired to instance DB field)
    for (const p of varInOutParams) {
      if (!wiredParams.has(p.name.toLowerCase())) {
        callParams.push({
          name: p.name,
          direction: "inout",
          value: `"${device.instanceDbName}".${p.name}`,
          dataType: p.dataType,
        });
      }
    }

    return {
      id: `rung_${idx + 1}`,
      title: `Call ${device.instanceDbName} — ${device.deviceName} (${fbName})`,
      logic: {
        type: "series",
        nodes: [
          {
            type: "element",
            element: {
              id: `e${idx + 1}`,
              type: "FB_CALL",
              operand: fbName,
              fbName,
              fbInstanceDb: device.instanceDbName,
              callParams,
            },
          },
        ],
      },
    };
  });

  const program = {
    name: fcName,
    blockType: "FC",
    variables: [],
    rungs,
  };

  return JSON.stringify(program);
}

// ---------------------------------------------------------------------------
// IO linking FC prompt — LAD fallback only
// ---------------------------------------------------------------------------

/**
 * System prompt for generating the IO linking FC in LAD format.
 * SCL IoLinking is generated deterministically via generateIoLinkingFc().
 * This builder is only needed when io_linking_language === "LAD".
 *
 * HARDCODED — not configurable via Prompts page.
 * Design Profile fields used:
 *   - general_rules: injected as coding standards
 *   - io_linking_rules: injected as IO linking conventions
 * Design Profile fields NOT used (could be added):
 *   - process_rules: not relevant
 *   - naming_prefix / db_naming_prefix: could apply to FC name or DB references
 * To make configurable: add "forge:io_linking_lad" section key to PROMPT_DEFAULTS and use resolveSection().
 */
export function buildIoLinkingLadPrompt(
  devices: ForgeDeviceEntry[],
  ioList: ForgeIoEntry[],
  context: DeviceGenContext,
  promptSections?: Record<string, string>,
): string {
  const { profile, platformRules, patterns, inputsDbName: inDb, outputsDbName: outDb } = context;
  const iDbName = inDb || "Inputs";
  const oDbName = outDb || "Outputs";
  const profileSection = profile ? formatDesignProfile(profile, "general") : "";
  const patternSection = formatPatterns(patterns ?? []);
  const ioLinkingRulesSection =
    profile?.io_linking_rules?.trim()
      ? `## IO Linking Rules (from Design Profile)\n${profile.io_linking_rules}`
      : "";

  const deviceNames = devices
    .map((d) => {
      const instDbName = `Inst${d.name.replace(/[^A-Za-z0-9]/g, "")}`;
      return `  - ${d.name} (tag: ${d.tag}, instanceDB: "${instDbName}")`;
    })
    .join("\n");
  const ioEntries = ioList
    .map((io) => `  - ${io.tag_name} (${io.signal_type}, ${io.data_type}): ${io.description}`)
    .join("\n");

  const identity = resolveSection(promptSections, "forge_arch_io_linking", "identity");

  return `${identity}
Generate an IO linking FC in LAD format that maps physical IO tags to the "${iDbName}" and "${oDbName}" global DBs.

${profileSection}

## Platform Rules
${platformRules}

${ioLinkingRulesSection}

${patternSection}

## Devices
${deviceNames}

## IO List
${ioEntries}

## Output Format
Generate a single FC in LAD (Ladder Logic). Output a LadProgram JSON object.
Map physical inputs to "${iDbName}".fieldName and "${oDbName}".fieldName to physical outputs.
IMPORTANT: Every rung MUST contain at least one output element (OUTPUT_COIL, SET_COIL, or RESET_COIL). Do NOT generate header/comment rungs with only contacts.
Respond with only the raw JSON object (no markdown wrapper).

Valid element type values (use EXACTLY these strings):
  "NO_CONTACT"   — normally-open contact
  "NC_CONTACT"   — normally-closed contact
  "OUTPUT_COIL"  — output coil (writes a Bool tag)
  "MOVE"         — MOVE box: operand=source, outputOperand=destination

Use this EXACT schema — the "logic" wrapper with "nodes" is mandatory:
{
  "name": "IoLinking",
  "rungs": [
    {
      "id": "rung_1",
      "title": "Map SensorInput to ${iDbName} DB",
      "logic": {
        "type": "series",
        "nodes": [
          { "type": "element", "element": { "id": "e1", "type": "NO_CONTACT", "operand": "SensorTag", "dataType": "Bool" } },
          { "type": "element", "element": { "id": "e2", "type": "OUTPUT_COIL", "operand": "${iDbName}.SensorTag", "dataType": "Bool" } }
        ]
      }
    }
  ]
}`;
}

/**
 * @deprecated Use generateIoLinkingFc() for SCL or buildIoLinkingLadPrompt() for LAD.
 * Kept for backward compatibility — routes to the appropriate builder.
 */
export function buildIoLinkingPrompt(
  devices: ForgeDeviceEntry[],
  ioList: ForgeIoEntry[],
  context: DeviceGenContext,
  language: "SCL" | "LAD" = "SCL",
): string {
  if (language === "LAD") return buildIoLinkingLadPrompt(devices, ioList, context);
  // SCL is now deterministic — return a minimal stub prompt (caller should use generateIoLinkingFc())
  return buildIoLinkingLadPrompt(devices, ioList, context);
}

// ---------------------------------------------------------------------------
// TASK 7: Process code generation prompts
// ---------------------------------------------------------------------------

export interface ProcessGenContext {
  profile?: DesignProfile;
  platformRules: string;
  patterns?: PatternCandidate[];
  deviceFbInterfaces: string; // SCL INTERFACE sections of generated device FBs
  specAnalysis?: SpecAnalysis;
  instanceDbNames?: string[];
  sequenceArtifactNames?: string[];
  ioEntries?: ForgeIoEntry[];
  /** Device entries (for IO wiring context) */
  deviceEntries?: ForgeDeviceEntry[];
  /** Full linkage matrix with engineer-confirmed device wiring and process sequences */
  linkageMatrix?: ProcessLinkageMatrix;
  /** SCL content of generated global DBs (HmiData, ProcessCommands, Configuration) */
  globalDbSchemas?: string;
  /** Maps wiring DB names (may lack prefix) → actual artifact/import names */
  dbNameMap?: Map<string, string>;
  /** Reference library sections relevant to this process sequence */
  referenceSections?: string;
  /** Agent knowledge docs (Code Architect learnings) */
  agentKnowledgeDocs?: string;
}

/**
 * System prompt for generating process/sequence code in SCL.
 * Generates individual sequence FBs/FCs (one per sequence) — NOT the master RunProcess FC.
 *
 * HARDCODED — not configurable via Prompts page.
 * Design Profile fields used:
 *   - general_rules: injected as coding standards
 *   - process_rules: injected as process code conventions with examples
 * Design Profile fields NOT used (could be added):
 *   - io_linking_rules: not relevant (process FB, not IO linking)
 *   - naming_prefix: could apply to FB/FC names
 * To make configurable: add "forge:process_scl" section key to PROMPT_DEFAULTS and use resolveSection().
 */
/** Extract only the platform rule sections relevant to process code generation. */
function trimPlatformRulesForProcess(rules: string): string {
  // Split into sections by "## N." headers
  const sections = rules.split(/(?=^## \d+\.)/m);
  // Keep: 1 (naming), 2 (FB/instance), 5 (FC vs FB), 6 (timers/counters/edges), 7 (syntax), 10 (status), 12 (common mistakes)
  const keepPrefixes = ["## 1.", "## 2.", "## 5.", "## 6.", "## 7.", "## 10.", "## 12."];
  const kept = sections.filter(s => {
    const trimmed = s.trimStart();
    return keepPrefixes.some(p => trimmed.startsWith(p)) || !trimmed.startsWith("## ");
  });
  return kept.join("\n").trim();
}

export function buildProcessSclPrompt(context: ProcessGenContext, promptSections?: Record<string, string>): string {
  const { profile, platformRules, patterns, deviceFbInterfaces, linkageMatrix, globalDbSchemas } = context;

  // Resolve wiring DB names using the dbNameMap (corrects "ProcessCommands" → "DB_ProcessCommands" etc.)
  const resolveWiringRef = (connectedTo: string): string => {
    if (!context.dbNameMap || !connectedTo) return connectedTo;
    const dotIdx = connectedTo.indexOf(".");
    if (dotIdx <= 0) return connectedTo;
    const dbName = connectedTo.slice(0, dotIdx);
    const fieldName = connectedTo.slice(dotIdx + 1);
    const resolved = context.dbNameMap.get(dbName.toLowerCase());
    return resolved ? `${resolved}.${fieldName}` : connectedTo;
  };

  // Build a wiring summary with resolved DB names
  const wiringSummary = linkageMatrix?.deviceLinkage.length
    ? linkageMatrix.deviceLinkage.map(device => {
        const inputsFromProcessCommands = device.wiring
          .filter(w => w.direction === "in" && w.wireType === "global")
          .filter(w => {
            const ref = resolveWiringRef(w.connectedTo ?? "");
            // Exclude Inputs/Outputs DBs — process code must not access these
            return !/^(Inputs|Outputs|DB_Inputs|DB_Outputs)\./i.test(ref);
          })
          .map(w => `    ${w.paramName} ← "${resolveWiringRef(w.connectedTo ?? "")}"`)
          .join("\n");
        const outputsToHmi = device.wiring
          .filter(w => w.direction === "out" && w.wireType === "global")
          .filter(w => {
            const ref = resolveWiringRef(w.connectedTo ?? "");
            return !/^(Inputs|Outputs|DB_Inputs|DB_Outputs)\./i.test(ref);
          })
          .map(w => `    ${w.paramName} → "${resolveWiringRef(w.connectedTo ?? "")}"`)
          .join("\n");
        if (!inputsFromProcessCommands && !outputsToHmi) return null;
        return [
          `  ${device.instanceDbName} (${device.name}):`,
          inputsFromProcessCommands && `  Commands written by process code:\n${inputsFromProcessCommands}`,
          outputsToHmi && `  Outputs readable by process code:\n${outputsToHmi}`,
        ].filter(Boolean).join("\n");
      }).filter(Boolean).join("\n\n")
    : "";

  // Parse structured process rules from profile
  let processSchema: ProcessRulesSchema | null = null;
  try {
    if (profile?.process_rules && typeof profile.process_rules === "string") {
      processSchema = parseProcessRules(profile.process_rules);
    }
  } catch { /* ignore parse errors */ }

  const stepActionRules = buildStepActionRules(processSchema);
  const hasStepActionPattern = !!processSchema?.step_action_db?.enabled;

  // Sequence structure notes from profile
  const seqNotes = processSchema?.sequence_structure?.custom_notes?.trim() ?? "";
  const freetext = processSchema?.freetext?.trim() ?? "";
  const processRulesSection = [
    stepActionRules,
    seqNotes ? `## Sequence Structure Notes\n${seqNotes}` : "",
    freetext ? `## Additional Process Rules\n${freetext}` : "",
  ].filter(Boolean).join("\n\n");

  // When step/action DB is enabled, the latching pattern governs structure.
  // Otherwise fall back to CASE-based state machines for SCL.
  const codeStructureInstructions = hasStepActionPattern
    ? `- Follow the Step/Action DB latching pattern defined above — it overrides defaults
- Use REGION blocks to organise sections
- Step array and action array in static variables
- Use PLCopen-style enable/execute + busy/done/error outputs
- All timers/counters/edges declared in VAR (static) with inst prefix, NEVER in VAR_TEMP`
    : `- Use CASE-based state machines for sequences (step variable, CASE step OF ... END_CASE)
- Each step has a clear entry action, hold condition, and exit transition
- Include ELSE branch for undefined states
- Use REGION blocks to organise sections
- Declare step variable as INT in static variables (VAR, not VAR_TEMP)
- Use PLCopen-style enable/execute + busy/done/error outputs
- All timers/counters/edges declared in VAR (static) with inst prefix, NEVER in VAR_TEMP`;

  const patternSection = formatPatterns(patterns ?? []);
  const profileSection = profile ? formatDesignProfile(profile, "process") : "";

  const identity = resolveSection(promptSections, "forge_arch_process", "identity");

  const trimmedRules = trimPlatformRulesForProcess(platformRules);

  // Build the prompt with aggressive size control — edge function has ~30KB practical limit
  const MAX_PROMPT_KB = 28;
  const MAX_PROMPT_CHARS = MAX_PROMPT_KB * 1024;

  // Priority order: identity, wiring (most actionable), code structure, patterns, FB interfaces, global DBs, platform rules
  // Platform rules are the biggest section (~25KB) — only include if there's room
  const coreSections = [
    identity,
    "",
    profileSection,
    "",
    processRulesSection,
    "",
    wiringSummary ? `## Device Wiring Reference
Use these exact field names — do NOT invent alternatives.

${wiringSummary}` : "",
    // Full signal path map — shows IO addresses, cross-device references, interlocks
    buildWiringContext(linkageMatrix, context.ioEntries ?? []),
    "",
    patternSection,
    "",
    `## Process Code Requirements
1. Implement each process sequence as an FB (stateful — needs timers and edge detection). Use FC only if purely stateless.
2. Include interlock checks at the start of each sequence step.
3. Every process FB must expose VAR_OUTPUT for HMI: currentStep (Int), running (Bool), faulted (Bool), complete (Bool).
4. Use latching alarm patterns — set on fault condition, require operator reset via resetAlarms (Bool) input.
5. All timed operations use TON with configurable PT as VAR_INPUT.
6. Include safety condition checks (E-stop, safety relay) that halt the sequence to safe state on failure.
7. Include permissive checks that gate sequence start.

## Code Structure Requirements
${codeStructureInstructions}

## Scope
Do NOT generate OB1 — only the sequence-specific FB/FC.

## Output Format — MANDATORY
\`\`\`scl [FB:ActualSequenceName]
FUNCTION_BLOCK ActualSequenceName
// ...
END_FUNCTION_BLOCK
\`\`\`
- Tag format: \`[FB:Name]\` for FBs, \`[FC:Name]\` for FCs
- Name in tag MUST match the FUNCTION_BLOCK / FUNCTION declaration
- Output the \`\`\`scl block directly — no prose or markdown headings`,
  ];

  let prompt = coreSections.filter(Boolean).join("\n");

  // Add FB interfaces if there's room
  const fbSection = `\n\n## Device FB Interfaces\n${deviceFbInterfaces || "(none)"}`;
  if (prompt.length + fbSection.length < MAX_PROMPT_CHARS - 4000) {
    prompt += fbSection;
  }

  // Add global DB schemas if there's room
  if (globalDbSchemas && prompt.length < MAX_PROMPT_CHARS - 4000) {
    const dbText = globalDbSchemas.length > 2000
      ? globalDbSchemas.slice(0, 2000) + "\n// ... (truncated)"
      : globalDbSchemas;
    prompt += `\n\n## Global DB Schemas\n\`\`\`scl\n${dbText}\n\`\`\``;
  }

  // Add trimmed platform rules only if there's room
  if (prompt.length < MAX_PROMPT_CHARS - 2000) {
    const remaining = MAX_PROMPT_CHARS - prompt.length - 200;
    const rules = trimmedRules.length > remaining ? trimmedRules.slice(0, remaining) + "\n// ..." : trimmedRules;
    prompt += `\n\n## Platform Rules (Key Sections)\n${rules}`;
  }

  console.log(`[process-prompt] Final size: ${(prompt.length / 1024).toFixed(1)}KB (cap: ${MAX_PROMPT_KB}KB)`);

  return prompt;
}

/**
 * User message for process SCL generation — one sequence at a time.
 */
export function buildProcessSclUserMessage(
  sequence: SpecAnalysisProcessSequence,
  devices: ForgeDeviceEntry[],
): string {
  const steps = (sequence.steps ?? [])
    .map((s) => `  Step ${s.step_number}: ${s.action} → Done when: ${s.completion_criteria}`)
    .join("\n");

  const permissives =
    (sequence.permissives ?? []).length > 0
      ? `\n**Permissives (must be true before starting):**\n${(sequence.permissives ?? []).map((p) => `  - ${p}`).join("\n")}`
      : "";

  const relevantDevices = devices.filter(
    (d) => d.subsystem === sequence.subsystem || devices.length <= 5,
  );
  const deviceList = relevantDevices
    .map((d) => `  - ${d.name} (${d.device_type}, tag: ${d.tag})`)
    .join("\n");

  return `Generate the SCL process FC for this sequence:

**Sequence name:** ${sequence.name}
**Subsystem:** ${sequence.subsystem}
${permissives}

**Steps:**
${steps}

**Relevant devices:**
${deviceList || "  (use all available devices)"}

Generate a complete, compile-ready FB/FC using the code structure pattern defined in the system prompt.`;
}

/**
 * System prompt for generating process/sequence code in LAD (sequential ladder).
 *
 * HARDCODED — not configurable via Prompts page.
 * Design Profile fields used:
 *   - general_rules: injected as coding standards
 * Design Profile fields NOT used:
 *   - process_rules: LAD process prompt uses a different step-bit approach; process_rules are SCL-specific examples
 *   - io_linking_rules: not relevant
 * To make configurable: add "forge:process_lad" section key to PROMPT_DEFAULTS and use resolveSection().
 */
export function buildProcessLadPrompt(context: ProcessGenContext, promptSections?: Record<string, string>): string {
  const { profile, platformRules, patterns } = context;
  const profileSection = profile ? formatDesignProfile(profile, "process") : "";
  const patternSection = formatPatterns(patterns ?? []);
  const identity = resolveSection(promptSections, "forge_arch_process", "identity");

  // Parse structured process rules for step/action pattern
  let processSchema: ProcessRulesSchema | null = null;
  try {
    if (profile?.process_rules && typeof profile.process_rules === "string") {
      processSchema = parseProcessRules(profile.process_rules);
    }
  } catch { /* ignore */ }

  const stepActionRules = buildStepActionRules(processSchema);
  const seqNotes = processSchema?.sequence_structure?.custom_notes?.trim() ?? "";
  const freetext = processSchema?.freetext?.trim() ?? "";

  return `${identity}
You are generating sequential ladder logic for a process sequence using Siemens TIA Portal LAD format.

${profileSection}

## Platform Rules
${platformRules}

## Device FB Interfaces
${context.deviceFbInterfaces || "(no device FBs)"}

${patternSection}
${context.referenceSections ? `\n## Reference Documentation\n${context.referenceSections}\n` : ""}
${context.agentKnowledgeDocs ? `\n## Agent Knowledge\n${context.agentKnowledgeDocs}\n` : ""}
${stepActionRules}
${seqNotes ? `## Sequence Structure Notes\n${seqNotes}` : ""}
${freetext ? `## Additional Process Rules\n${freetext}` : ""}

## Approach
${processSchema?.step_action_db?.enabled
    ? `Use latching circuits for ALL step transitions. NEVER use SET_COIL or RESET_COIL.
Every step rung is a parallel with two branches: (transition branch) OR (seal branch) → OUTPUT_COIL.
Map every step to an action bit. Actions drive process outputs — steps do not.`
    : `Use step bits (BOOL static variables, e.g. statStep01, statStep02) and transition rungs.
Each step: set step bit when entering, reset when leaving.
Transitions: contact on previous step + completion condition → set next step.`}

## Output Format
Return raw JSON only — no markdown fences. Use this EXACT schema:

{
  "id": "prog_1",
  "name": "SequenceName",
  "blockType": "FC",
  "variables": [],
  "rungs": [
    {
      "id": "rung_1",
      "title": "Step 10 — Description",
      "logic": {
        "type": "series",
        "nodes": [
          {
            "type": "parallel",
            "branches": [
              { "type": "series", "nodes": [
                { "type": "element", "element": { "id": "e1", "type": "NO_CONTACT", "operand": "S[0]", "dataType": "Bool" } },
                { "type": "element", "element": { "id": "e2", "type": "NO_CONTACT", "operand": "Condition", "dataType": "Bool" } }
              ]},
              { "type": "series", "nodes": [
                { "type": "element", "element": { "id": "e3", "type": "NO_CONTACT", "operand": "S[10]", "dataType": "Bool" } },
                { "type": "element", "element": { "id": "e4", "type": "NC_CONTACT", "operand": "S[20]", "dataType": "Bool" } }
              ]}
            ]
          },
          { "type": "element", "element": { "id": "e5", "type": "OUTPUT_COIL", "operand": "S[10]", "dataType": "Bool" } }
        ]
      }
    }
  ]
}

Valid element types: "NO_CONTACT", "NC_CONTACT", "OUTPUT_COIL", "TON", "TOF", "CMP", "MOVE"
CRITICAL RULES:
- Every rung MUST have a "logic" object. Use "type": "parallel" with "branches" for step latching rungs.
- NEVER use SET_COIL or RESET_COIL — use OUTPUT_COIL with latching circuits only.
- Every parallel branch must be a { "type": "series", "nodes": [...] } object.
- A coil operand must appear in exactly ONE rung across the entire program — never duplicate.
- Do NOT include fault detection, fault latching, or fault reset logic — that belongs in a separate Fault FC.
- Generate ONLY the sequence step/action logic in this block.`;
}

// ---------------------------------------------------------------------------
// Fault FC prompt (separate from sequence FB — handles all fault logic)
// ---------------------------------------------------------------------------

export interface FaultEntry {
  code: string;
  tag: string;
  description: string;
  source: string;
}

export function buildFaultFcPrompt(
  context: ProcessGenContext,
  sequenceArtifacts: ForgeArtifact[],
  promptSections?: Record<string, string>,
  faultEntries?: FaultEntry[],
): string {
  const { profile, platformRules, patterns } = context;
  const profileSection = profile ? formatDesignProfile(profile, "process") : "";
  const patternSection = formatPatterns(patterns ?? []);
  const identity = resolveSection(promptSections, "forge_arch_process", "identity");

  // Parse process rules for step/action config
  let processSchema: ProcessRulesSchema | null = null;
  try {
    if (profile?.process_rules && typeof profile.process_rules === "string") {
      processSchema = parseProcessRules(profile.process_rules);
    }
  } catch { /* ignore */ }

  const S = processSchema?.step_action_db?.step_array_name || "S";
  const seqNotes = processSchema?.sequence_structure?.custom_notes?.trim() ?? "";

  // Build summary of sequences and their step ranges for the fault FC to reference
  const seqSummary = sequenceArtifacts
    .filter(a => a.language === "LAD" && (a.type === "FC" || a.type === "FB"))
    .map(a => {
      const stepRe = new RegExp(`${S.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\[(\\d+)\\]`, "g");
      const steps: number[] = [];
      let match: RegExpExecArray | null;
      while ((match = stepRe.exec(a.content)) !== null) steps.push(parseInt(match[1], 10));
      const maxStep = steps.length > 0 ? Math.max(...steps) : 0;
      return `- ${a.name}: steps ${S}[0..${maxStep}]`;
    })
    .join("\n");

  return `${identity}
You are generating a FAULT HANDLING FC in LAD format. This FC is SEPARATE from the sequence FBs — it handles ALL fault detection, latching, and reset logic for the project.

${profileSection}

## Platform Rules
${platformRules}

## Device FB Interfaces
${context.deviceFbInterfaces || "(no device FBs)"}

${patternSection}
${context.referenceSections ? `\n## Reference Documentation\n${context.referenceSections}\n` : ""}
${context.agentKnowledgeDocs ? `\n## Agent Knowledge\n${context.agentKnowledgeDocs}\n` : ""}
## Sequences in this project
${seqSummary || "(no sequences generated yet)"}

## Fault DB — "DB_Faults"
A global DB called "DB_Faults" has been created with these fields:
${(faultEntries ?? []).map(f => `- "DB_Faults".${f.tag} : Bool — ${f.code}: ${f.description}`).join("\n")}
- "DB_Faults".faultActive : Bool — Any fault latched (OR of all above)
- "DB_Faults".faultCode : Word — Active fault code
- "DB_Faults".faultReset : Bool — Operator reset command

ALL fault variables MUST reference "DB_Faults".fieldName — do NOT use global variables or static variables for faults.
Use EXACTLY the tag names listed above — do NOT invent your own fault field names.

## Fault FC Requirements
1. **Fault Detection** — Monitor process state for fault conditions:
   - E-Stop: "DB_Faults".F001 latches when ESTOP_OK drops FALSE during active steps
   - Motor overload: "DB_Faults".F002 latches on overload trip
   - Run feedback timeout: "DB_Faults".F003 latches when run timer elapses without confirmation
   - Stop feedback timeout: "DB_Faults".F004 latches when stop timer elapses (welded contactor)

2. **Fault Latching** — Each fault uses the latching circuit pattern:
   - (FaultCondition OR "DB_Faults".Fxxx) AND NOT "DB_Faults".faultReset → "DB_Faults".Fxxx
   - "DB_Faults".faultActive = OR of all individual fault flags

3. **Fault Routing** — When any fault is detected:
   - The sequence FBs read "DB_Faults".faultActive and halt themselves
   - The fault FC does NOT write to step DBs — it only manages fault flags

4. **Fault Reset** — Via "DB_Faults".faultReset:
   - Only clears faults when ESTOP_OK is healthy
   - Clears all fault latches ("DB_Faults".F001–F004)
   - Clears "DB_Faults".faultActive

5. **Coil Rules**:
   - Use OUTPUT_COIL with latching circuits — NEVER SET_COIL or RESET_COIL
   - Each coil operand appears in exactly ONE rung across the entire FC
   - ALL fault operands use "DB_Faults".fieldName — never bare variable names

### Fault Latch Rung Pattern (REQUIRED)
Each fault uses this latching circuit:

\`\`\`
──┤ FaultCond        ├──┬──
                        │──( "DB_Faults".F001 )──
──┤ "DB_Faults".F001 ├──┘
      AND ──┤/"DB_Faults".faultReset├──
\`\`\`

In JSON: series[ parallel[ series[NO FaultCondition], series[NO "DB_Faults".F001, NC "DB_Faults".faultReset] ], OUTPUT_COIL "DB_Faults".F001 ]
- Top branch: fault condition contact(s)
- Bottom branch: self-seal contact AND NOT reset contact
- Single OUTPUT_COIL AFTER the parallel — never inside branches

### "DB_Faults".faultActive Rung
Parallel OR of all fault flags → single OUTPUT_COIL:
series[ parallel[ NO "DB_Faults".F001, NO "DB_Faults".F002, NO "DB_Faults".F003, NO "DB_Faults".F004 ], OUTPUT_COIL "DB_Faults".faultActive ]
${seqNotes ? `\n## Sequence Notes\n${seqNotes}` : ""}

## Output Format
Return raw JSON only — no markdown fences. Use this EXACT schema:

{
  "name": "FaultHandler",
  "blockType": "FC",
  "variables": [...],
  "rungs": [
    {
      "id": "rung_1",
      "title": "F001: E-Stop fault latch",
      "logic": {
        "type": "series",
        "nodes": [
          { "type": "parallel", "branches": [
            { "type": "series", "nodes": [contact_fault_condition] },
            { "type": "series", "nodes": [contact_self_seal, nc_contact_reset] }
          ]},
          { "type": "element", "element": { "id": "e5", "type": "OUTPUT_COIL", "operand": "\"DB_Faults\".F001", "dataType": "Bool" } }
        ]
      }
    }
  ]
}

CRITICAL RULES:
- Use "rungs" (not "networks"). Use "name" (not "blockName").
- Each parallel branch must be { "type": "series", "nodes": [...] }.
- ALL fault references use "DB_Faults".fieldName — never bare variable names.
- Single OUTPUT_COIL after each parallel — never inside branches.
- Do NOT declare fault variables as FC static/temp — they live in DB_Faults.`;
}

export function buildFaultFcUserMessage(
  sequences: Array<{ name: string; description?: string }>,
  devices: ForgeDeviceEntry[],
  faultEntries?: FaultEntry[],
): string {
  const seqList = sequences.map(s => `- ${s.name}${s.description ? `: ${s.description}` : ""}`).join("\n");
  const deviceList = devices.map(d => `- ${d.name} (${d.device_type}, tag: ${d.tag})`).join("\n");
  const faultList = (faultEntries ?? [])
    .map(f => `- ${f.code}: "DB_Faults".${f.tag} — ${f.description} [from: ${f.source}]`)
    .join("\n");

  return `Generate the Fault Handling FC for this project.

**Sequences:**
${seqList}

**Devices:**
${deviceList}

**Fault entries (derived from matrix — use EXACTLY these "DB_Faults" field names):**
${faultList || "(no faults derived)"}

For each fault entry, create ONE latching rung:
  series[ parallel[ series[fault_condition_contacts], series[NO "DB_Faults".tag, NC "DB_Faults".faultReset] ], OUTPUT_COIL "DB_Faults".tag ]

Then create the faultActive rung:
  series[ parallel[ NO each fault tag... ], OUTPUT_COIL "DB_Faults".faultActive ]

Then create the reset rung.

Output ONLY the raw JSON object. Do NOT output SCL code.`;
}

// ---------------------------------------------------------------------------
// TASK 8: HMI screen generation prompt
// ---------------------------------------------------------------------------

/**
 * System prompt for HMI overview + faceplate screen generation.
 * AI must output HmiScreenSpec JSON (src/types/hmi-screen.ts).
 *
 * HARDCODED — not configurable via Prompts page.
 * Design Profile fields used: none (theme is passed as a parameter directly).
 * Design Profile fields NOT used (could be added):
 *   - general_rules: could bias HMI naming conventions
 *   - db_naming_prefix: could apply to HMI tag DB names
 * To make configurable: add "forge:hmi" section key to PROMPT_DEFAULTS and use resolveSection().
 */
export function buildHmiPrompt(_devices: ForgeDeviceEntry[], theme: string): string {
  return `You are generating WinCC Unified HMI screen specifications for a Siemens TIA Portal project.

## Theme: ${theme}

## HmiScreenSpec JSON Schema
Return an array of HmiScreenSpec objects. Each object:
{
  "name": "string (screen name)",
  "width": 1920,
  "height": 1080,
  "elements": [
    {
      "id": "string",
      "type": "text_field" | "io_field" | "button" | "indicator_light" | "rectangle" | "ellipse" | "image" | "bar_graph" | "trend_view",
      "x": number,
      "y": number,
      "width": number,
      "height": number,
      "text"?: "string",
      "tag"?: "string (PLC tag path)",
      "background_color"?: "#RRGGBB",
      "foreground_color"?: "#RRGGBB",
      "visible_animation"?: { "tag": "string", "condition": "GT 0" | "EQ 1" | "EQ 0" }
    }
  ]
}

## Design Guidelines
- Dark background (#1A1A2E or #0D1117), bright accent colors for status
- Motors: green indicator (running), red (fault), grey (stopped)
- Valves: green (open), red (closed/fault)
- Sensors: blue indicator (active)
- Layout: device name label + status indicator pairs, arranged in a grid
- Screen size: 1920x1080

## Output Format
Return the JSON array of HmiScreenSpec objects inside \`\`\`json fences. No explanation.`;
}

/**
 * User message for HMI generation.
 */
export function buildHmiUserMessage(devices: ForgeDeviceEntry[]): string {
  const deviceList = devices
    .map(
      (d) =>
        `  - ${d.name} (${d.device_type}, tag: ${d.tag}): ${d.description}`,
    )
    .join("\n");

  return `Generate HMI screens for these devices:

${deviceList}

Create:
1. An overview screen showing all devices with status indicators
2. A faceplate screen for each unique device type (motor, valve, sensor)

Return the HmiScreenSpec JSON array now.`;
}

// ---------------------------------------------------------------------------
// Matrix generation prompts
// ---------------------------------------------------------------------------


const MATRIX_RULES_COMMON = `## Rules
- Device names must EXACTLY match the confirmed device list
- FB names: UpperCamelCase (e.g. ControlMotorDol, ControlValvePneumatic)
- Instance DB names: \`Inst\` prefix (e.g. InstMotor1, InstConveyor1)
- Wiring wireType:
  - \`io\` — PLC IO tag name (e.g. "DI_SensorName")
  - \`fb\` — another FB output (e.g. "InstPump1.busy")
  - \`global\` — global DB field (e.g. "ProcessCommands.cv01Run")
  - \`constant\` — scalar primitive ONLY: Bool (TRUE/FALSE), Time (T#5s), Int (0), Real (0.0). NEVER use constant for UDT/struct parameters — any param whose type starts with "type" or is a custom struct MUST use wireType "global" pointing to a Configuration DB field (e.g. connectedTo: "Configuration.motor1Config")
- **UDT/struct parameters** (e.g. \`config\` of type \`typeMotorConfig\`) MUST be wired to a "Configuration" global DB. Add the Configuration DB to globalData with appropriate fields for each UDT param. Example: \`{ "paramName": "config", "direction": "in", "wireType": "global", "connectedTo": "Configuration.motor1Config" }\`
- **CRITICAL — Sequence-driven commands MUST go through ProcessCommands DB:**
  Before wiring any operator-interface signal (pushbutton pressed, switch active) to a device FB command input, ask: does this signal appear as a condition that triggers or advances a step in the process sequences? If YES — the process code is the decision-maker, and the command must go through \`ProcessCommands.*\`. Wire the device FB input as \`wireType: "global"\` to \`ProcessCommands.*\`, and leave the process code to read the pushbutton and set that field.
  If NO — the signal is a direct device-level action independent of sequence logic (e.g. a reset button that resets a fault latch, an e-stop that directly halts a device, a jog button) — direct FB-to-FB wiring is acceptable.
  - WRONG (start button is a sequence trigger): \`{ "paramName": "run", "wireType": "fb", "connectedTo": "InstPbStart.pressed" }\`
  - WRONG (IO direct to command input): \`{ "paramName": "run", "wireType": "io", "connectedTo": "PB_START" }\`
  - WRONG (HmiData is not a command bus): \`{ "paramName": "run", "wireType": "global", "connectedTo": "HmiData.cv01Run" }\`
  - RIGHT (sequence-driven): \`{ "paramName": "run", "wireType": "global", "connectedTo": "ProcessCommands.cv01Run" }\`
  - RIGHT (direct reset, not sequence-driven): \`{ "paramName": "reset", "wireType": "fb", "connectedTo": "InstPbReset.pressed" }\`
  Physical sensor/feedback signals (detection, limits, overload, fault feedback) MAY always wire directly to IO tags.
- **HmiData is DISPLAY-ONLY** — contains status/feedback fields written by device FBs or process code. The ONLY consumer is the HMI runtime. Do NOT put command or control fields in HmiData. Do NOT wire device FB inputs FROM HmiData — use ProcessCommands, ProcessState, or FaultData for inter-device signals.
- **CRITICAL — Inter-device signals must flow through global DBs, NOT instance DBs:**
  - WRONG: \`{ "paramName": "eStop", "wireType": "fb", "connectedTo": "InstESTOP.safetyOk" }\` — direct instance DB access
  - RIGHT: \`{ "paramName": "eStop", "wireType": "global", "connectedTo": "ProcessState.eStopSafetyOk" }\` — through a global DB
  - The EStopCall FC writes \`safetyOk => "ProcessState".eStopSafetyOk\`, and downstream FCs read from ProcessState.
  - Exception: Siemens Open Library FB VAR_IN_OUT params (HMI UDTs) are accessed on the instance DB by the HMI faceplate — but PLC code never reads these.
- **CRITICAL — Output wires MUST use physical IO tag names from the IO list:**
  - Output direction wires targeting the Outputs DB must use the EXACT tag name from the confirmed IO list.
  - WRONG: \`{ "paramName": "bOutCommandForward", "direction": "out", "wireType": "io", "connectedTo": "M01_CMD" }\` — invented name
  - RIGHT: \`{ "paramName": "bOutCommandForward", "direction": "out", "wireType": "io", "connectedTo": "M01_CMD_FWD" }\` — matches IO list
  - Check the IO list DQ/AQ entries for the exact tag names to use.
- **CRITICAL — Type mismatches between process logic and FB parameters:**
  If the process logic uses a different type than the FB parameter expects (e.g., process uses Int for direction 0/1/2, but FB expects Bool), this is acceptable — but you MUST:
  1. Declare the globalData field with the process-logic type (Int)
  2. Add a note in the matrix \`notes\` field: "cv01Direction (Int) must be converted to Bool before writing to ControlConveyor.direction — process code or device call FC must handle conversion"
  3. The conversion happens in the process code or device call FC, NOT in the matrix wiring
  Do NOT silently wire an Int to a Bool — it will cause a compile error. Flag it for downstream handling.
- **CRITICAL — Device hierarchy: sequences command PARENT devices, never child devices directly:**
  - If a conveyor (CV01) contains a motor (M01), the sequence sets ProcessCommands.cv01Run — the conveyor FB internally commands the motor via its runForward/runReverse outputs. The sequence NEVER writes ProcessCommands.m01CmdFwd directly.
  - WRONG: sequence sets ProcessCommands.m01CmdFwd = TRUE (bypasses conveyor logic)
  - RIGHT: sequence sets ProcessCommands.cv01Run = TRUE, ProcessCommands.cv01Direction = 1 (conveyor FB handles M01)
  - This ensures the parent device's safety logic, interlocks, and state machine are always in the path.
- **Timer presets MUST use TIA TIME literal format: T#5s, T#30s, T#500ms, T#2m — NEVER raw millisecond integers like 5000 or 30000**
- Step descriptions and condition descriptions that reference timer delays must say "T#5s timer" not "5000ms" or "5s (5000ms)"
- All IDs must be unique strings (use numeric suffix, e.g. "w1", "i1", "s1")`;

const DEVICE_LINKAGE_SCHEMA = `{
  "deviceLinkage": [
    {
      "id": "string (unique, e.g. DEV001)",
      "name": "string (device name — MUST match confirmed list exactly)",
      "deviceType": "string",
      "description": "string",
      "fbName": "string (e.g. ControlMotorDol)",
      "fbTemplateName": "string | null",
      "fbTemplateId": "string | null",
      "instanceDbName": "string (e.g. InstMotor1)",
      "wiring": [
        {
          "id": "string (unique, e.g. w1)",
          "paramName": "string (FB parameter name)",
          "direction": "in | out",
          "connectedTo": "string — REQUIRED, never empty. IO tag name, global DB field (DB.field), or FB output (InstName.field). For constant wireType: the literal value (TRUE, FALSE, T#5s). If you don't know the connection, omit the wire entirely rather than leaving connectedTo blank.",
          "wireType": "fb | io | global | constant"
        }
      ],
      "interlocks": [
        {
          "id": "string (unique, e.g. i1)",
          "targetDeviceName": "string",
          "condition": "string",
          "direction": "requires | blocks | follows"
        }
      ]
    }
  ]
}`;

const SEQUENCES_SCHEMA = `{
  "globalData": [
    {
      "id": "string (unique)",
      "dbName": "string (global DB name)",
      "purpose": "string",
      "fields": [
        {
          "id": "string (unique)",
          "fieldName": "string",
          "dataType": "string",
          "description": "string",
          "defaultValue": "string | null (e.g. T#5s, 0, FALSE — only for Configuration DB fields)"
        }
      ]
    }
  ],
  "processSequences": [
    {
      "id": "string (unique)",
      "name": "string",
      "description": "string",
      "permissives": [
        {
          "id": "string (unique)",
          "description": "string",
          "deviceName": "string | null",
          "polarity": true
        }
      ],
      "safetyConditions": [
        {
          "id": "string (unique)",
          "description": "string",
          "deviceName": "string | null",
          "polarity": true
        }
      ],
      "rows": [
        {
          "step": 0,
          "branch": null,
          "condition": "string — ONE condition using actual signal names e.g. 'PE01_DET = TRUE', 'PB_START rising edge'",
          "action": "string — ONE short imperative e.g. 'Set motor forward', 'Start timeout timer'",
          "output": "string | null — specific signal change e.g. 'M01_CMD_FWD = TRUE', null if no output",
          "next": "number | FAULT | IDLE — step number to go to next, or FAULT, or IDLE",
          "type": "action | monitor | branch | fault_exit | merge",
          "devices": ["string — device names involved"]
        }
      ]
    }
  ],
  "notes": "string",
  "generatedAt": "string (ISO timestamp)"
}`;

/**
 * System prompt: device wiring section only (Process Linkage Matrix).
 *
 * HARDCODED — not configurable via Prompts page.
 * Design Profile fields used: none (matrix generation is profile-agnostic).
 * Design Profile fields NOT used (could be added):
 *   - general_rules: could bias FB naming conventions
 *   - naming_prefix / db_naming_prefix: could pre-apply naming conventions
 * To make configurable: add "forge:device_linkage" section key to PROMPT_DEFAULTS and use resolveSection().
 */
export function buildDeviceLinkagePrompt(
  promptSections?: Record<string, string>,
  platformRules?: string,
  profileRules?: string,
  patternSection?: string,
  referenceSections?: string,
  agentKnowledge?: string,
): string {
  const identity = resolveSection(promptSections, "forge_pm_device_linkage", "identity");
  const platformBlock = platformRules ? `\n## Platform Rules (coding standards)\n${platformRules}\n` : "";
  const profileBlock = profileRules ? `\n## Design Profile Rules\n${profileRules}\n` : "";
  const patternBlock = patternSection || "";
  const referenceBlock = referenceSections ? `\n## Reference Documentation\n${referenceSections}\n` : "";
  const knowledgeBlock = agentKnowledge ? `\n## Agent Knowledge\n${agentKnowledge}\n` : "";

  return `${identity}
${platformBlock}${profileBlock}${patternBlock}${referenceBlock}${knowledgeBlock}
Generate ONLY the deviceLinkage array — which FB each device uses, its instance DB name, how FB parameters wire to IO tags or global data, and interlocks between devices.

${MATRIX_RULES_COMMON}
- Interlocks must reference devices that exist in the device list
- Use EXACT parameter names from the FB Template Interfaces provided
- If an FB has a configuration/settings parameter of a UDT type (e.g. \`config : typeMotorConfig\`), wire it as: \`{ "wireType": "global", "connectedTo": "Configuration.<instanceName>Config" }\`. Include the Configuration DB in globalData with matching fields. NEVER wire a struct param as \`constant: TRUE\`.

## ProcessCommands DB (REQUIRED when any operator command inputs exist)
If any device FB has operator command inputs (run, stop, start, enable, direction, reset, mode), you MUST include a "ProcessCommands" DB in the globalData array with one field per command input.

Each field description MUST explain:
1. Which process sequence sets it
2. What it commands the device to do

Example globalData entry:
\`\`\`json
{
  "id": "gdb_commands",
  "dbName": "ProcessCommands",
  "purpose": "Interface between process sequences and device FBs. Process code writes these fields; device call FCs read them.",
  "fields": [
    { "id": "f1", "fieldName": "cv01Run",       "dataType": "Bool", "description": "Set by ConveyorSequence step 20 — commands CV01 to run forward" },
    { "id": "f2", "fieldName": "cv01Direction",  "dataType": "Bool", "description": "Set by ConveyorSequence step 20 — TRUE = forward, FALSE = reverse" },
    { "id": "f3", "fieldName": "m01Enable",      "dataType": "Bool", "description": "Set by MotorSequence step 10 — enables M01 main drive" }
  ]
}
\`\`\`

## Output Format
Wrap the JSON in [DEVICE_LINKAGE]...[/DEVICE_LINKAGE] tags:
[DEVICE_LINKAGE]
{ ... }
[/DEVICE_LINKAGE]

Schema:
${DEVICE_LINKAGE_SCHEMA}`;
}

/**
 * System prompt: process sequences + global data only (Process Linkage Matrix).
 *
 * HARDCODED — not configurable via Prompts page.
 * Design Profile fields used: none.
 * Design Profile fields NOT used (could be added):
 *   - process_rules: could bias step/transition naming conventions
 * To make configurable: add "forge:sequences" section key to PROMPT_DEFAULTS and use resolveSection().
 */
export function buildSequencesPrompt(
  promptSections?: Record<string, string>,
  platformRules?: string,
  profileRules?: string,
  patternSection?: string,
  referenceSections?: string,
  agentKnowledge?: string,
): string {
  const identity = resolveSection(promptSections, "forge_pm_sequences", "identity");
  const platformBlock = platformRules ? `\n## Platform Rules (coding standards)\n${platformRules}\n` : "";
  const profileBlock = profileRules ? `\n## Design Profile Rules\n${profileRules}\n` : "";
  const patternBlock = patternSection || "";
  const referenceBlock = referenceSections ? `\n## Reference Documentation\n${referenceSections}\n` : "";
  const knowledgeBlock = agentKnowledge ? `\n## Agent Knowledge\n${agentKnowledge}\n` : "";

  return `${identity}
${platformBlock}${profileBlock}${patternBlock}${referenceBlock}${knowledgeBlock}
Generate ONLY the processSequences array and globalData array — state-machine logic with permissives, safety conditions, step rows, and shared data blocks.

${MATRIX_RULES_COMMON}
- Process sequences use a ONE-CONDITION-PER-ROW table format (see rules below)
- Safety conditions are continuously monitored — failure stops the process
- generatedAt must be the current ISO timestamp
- Keep descriptions concise — avoid verbose prose

## CRITICAL: Row Format Rules

Each sequence has a \`rows\` array. EVERY row represents ONE condition, ONE action, ONE output change.

1. ONE condition per row. Never combine with AND/OR inside a single row.
   WRONG: "PE01_DET = TRUE AND ESTOP_OK = TRUE"
   RIGHT: Put AND conditions in permissives. Each row has a single signal condition.

2. ONE action per row. Never combine multiple operations.
   WRONG: "Set M01_CMD_FWD = TRUE, M01_CMD_REV = FALSE, start timer"
   RIGHT: Three separate rows for CMD_FWD, CMD_REV, and timer.

3. GATES vs BRANCHES — this is the most important rule:

   A BRANCH is a genuinely different process path where both outcomes continue the process in different directions.
   Use type "branch" ONLY when the two paths lead to DIFFERENT subsequent steps (different physical operations, different recipes, different routes).
   CORRECT branch example — product route depends on sensor:
     { "step": 70, "branch": "a", "condition": "PE01_DET = TRUE", "output": "M01_CMD_FWD = TRUE", "next": 80, "type": "branch" }
     { "step": 70, "branch": "b", "condition": "PE02_DET = TRUE", "output": "M01_CMD_REV = TRUE", "next": 80, "type": "branch" }

   A GATE is a pass/fail check where one outcome continues and the other rejects/faults.
   Use type "action" + "fault_exit" when one path continues the process and the other goes to FAULT/0/IDLE.
   NEVER use branch rows (a/b pairs) for gates.
   CORRECT gate example — permissive check:
     { "step": 20, "branch": null, "condition": "PB_START rising edge", "action": "Evaluate all permissives", "output": null, "next": 30, "type": "action" }
     { "step": 20, "branch": null, "condition": "Any permissive fails",  "action": "Reject start",              "output": null, "next": 0,  "type": "fault_exit" }

   THE ANTI-PATTERN TO AVOID — do NOT decompose permissive checks into individual pass/fail branch pairs:
   WRONG (creates a useless waterfall of XOR diamonds for what is just one AND gate):
     { "step": 20, "branch": "a", "condition": "ESTOP_OK = TRUE",              "next": 30, "type": "branch" }
     { "step": 20, "branch": "b", "condition": "ESTOP_OK = FALSE",             "next": 0,  "type": "branch" }
     { "step": 30, "branch": "a", "condition": "FaultData.anyFaultLatched = FALSE", "next": 40, "type": "branch" }
     { "step": 30, "branch": "b", "condition": "FaultData.anyFaultLatched = TRUE",  "next": 0,  "type": "branch" }
     ... (repeated for every individual check)
   RIGHT: one action row + one fault_exit row covers all permissives as a single gate.

   If all permissive conditions are already declared in the sequence's \`permissives\` array, you do NOT need any rows for them at all — they are checked automatically before the sequence can run.

4. Monitoring rows have type "monitor". Fault exits from a monitoring step are SEPARATE rows with type "fault_exit" at the SAME step number.
     { "step": 30, "branch": null, "condition": "PE02_DET = TRUE",  "action": "Arrived", "next": 50, "type": "monitor" }
     { "step": 30, "branch": null, "condition": "timeout elapsed",  "action": "Timeout", "next": "FAULT", "type": "fault_exit" }

5. CRITICAL — "next" pointer rules:
   - A branch row's "next" MUST point to the IMMEDIATELY NEXT step number in sequence.
   - NEVER skip over common/merge steps. If branches rejoin at step 40, ALL branch rows MUST have "next": 40 — not 50, not 60.
   - Every step number in the table must be reachable via at least one "next" pointer (except step 0, which is the entry).
   - WRONG: step 10a → next: 30  (skips common step 20)
   - RIGHT:  step 10a → next: 20  (points to the immediately next step, even if 20 is a common merge step)
   - Branches merge when two branches' "next" values BOTH point to the same common step.

6. Step numbers must be multiples of 10 (0, 10, 20, 30 ...). The "branch" letter is just a sub-ID — it does NOT affect step numbering.

7. Use actual signal names throughout: device instance names, IO tag names, DB field names.
   WRONG: "motor runs forward"   RIGHT: "M01_CMD_FWD = TRUE"

## Output Format
Wrap the JSON in [SEQUENCES_DATA]...[/SEQUENCES_DATA] tags:
[SEQUENCES_DATA]
{ ... }
[/SEQUENCES_DATA]

Schema:
${SEQUENCES_SCHEMA}`;
}

/** Shared helper: build device table, IO summary, and FB interface text. */
function buildMatrixContext(
  devices: ForgeDeviceEntry[],
  ioList: ForgeIoEntry[],
  fbTemplates?: FbTemplate[],
  generatedFbArtifacts?: ForgeArtifact[],
): { deviceTable: string; ioSummary: string; fbInterfacesText: string } {
  const templateMap = new Map(
    (fbTemplates ?? []).map((t) => [t.id, t]),
  );

  const deviceTable = devices
    .map((d) => {
      const signals = (d.io_signals ?? [])
        .map((s) => `    - ${s.tag_name} (${s.signal_type}): ${s.description}`)
        .join("\n");
      const tpl = d.fb_template_id ? templateMap.get(d.fb_template_id) : null;
      const fbInfo = tpl
        ? `FB Template: ${tpl.name} (${d.fb_match_confidence} match)`
        : `FB Template: none (AI-generated)`;
      return `**${d.name}** [${d.tag}]\n  Type: ${d.device_type}\n  Subsystem: ${d.subsystem}\n  ${fbInfo}\n  IO Signals:\n${signals || "    (none)"}`;
    })
    .join("\n\n");

  const ioSummary = ioList.length > 0
    ? ioList
        .slice(0, 50)
        .map((io) => `  ${io.address}: ${io.tag_name} (${io.signal_type}) — ${io.description}`)
        .join("\n") + (ioList.length > 50 ? `\n  ... and ${ioList.length - 50} more` : "")
    : "  (none)";

  // Helper: extract VAR_INPUT / VAR_OUTPUT param names from SCL text
  function extractParams(scl: string, section: "VAR_INPUT" | "VAR_OUTPUT"): string {
    return [...scl.matchAll(new RegExp(`${section}\\b[\\s\\S]*?END_VAR`, "g"))]
      .flatMap((m) => [...m[0].matchAll(/^\s+(\w+)\s*:/gm)].map((p) => p[1]))
      .join(", ");
  }

  // Library template interfaces (for devices with fb_template_id)
  const referencedTemplateIds = new Set(
    devices.map((d) => d.fb_template_id).filter(Boolean),
  );
  const templateInterfaces = referencedTemplateIds.size > 0
    ? [...referencedTemplateIds]
        .map((id) => {
          const tpl = templateMap.get(id!);
          if (!tpl?.blocks?.length) return null;
          const mainBlock = tpl.blocks.find((b) => b.block_type === "FB") ?? tpl.blocks[0];
          if (!mainBlock) return null;
          const inputParams = extractParams(mainBlock.scl_code, "VAR_INPUT");
          const outputParams = extractParams(mainBlock.scl_code, "VAR_OUTPUT");
          return `  **${tpl.name}** (library template)\n  VAR_INPUT: ${inputParams || "(none)"}\n  VAR_OUTPUT: ${outputParams || "(none)"}`;
        })
        .filter(Boolean)
        .join("\n\n")
    : null;

  // AI-generated FB interfaces (from Device FBs step — stage "device_fb", type "FB")
  const fbArtifacts = (generatedFbArtifacts ?? []).filter((a) => a.type === "FB");
  const generatedInterfaces = fbArtifacts.length > 0
    ? fbArtifacts
        .map((a) => {
          const inputParams = extractParams(a.content, "VAR_INPUT");
          const outputParams = extractParams(a.content, "VAR_OUTPUT");
          return `  **${a.name}** (AI-generated)\n  VAR_INPUT: ${inputParams || "(none)"}\n  VAR_OUTPUT: ${outputParams || "(none)"}`;
        })
        .join("\n\n")
    : null;

  const fbInterfacesText = [templateInterfaces, generatedInterfaces].filter(Boolean).join("\n\n")
    || "  (none — use standard parameter naming conventions)";

  return { deviceTable, ioSummary, fbInterfacesText };
}

/**
 * User message for device linkage call (call 1 of 2).
 * Contains: device list, IO signals, FB interfaces.
 */
export function buildDeviceLinkageUserMessage(
  devices: ForgeDeviceEntry[],
  ioList: ForgeIoEntry[],
  fbTemplates?: FbTemplate[],
  generatedFbArtifacts?: ForgeArtifact[],
): string {
  const { deviceTable, ioSummary, fbInterfacesText } = buildMatrixContext(devices, ioList, fbTemplates, generatedFbArtifacts);

  return `Generate the device linkage section for this project.

## Confirmed Device List (${devices.length} devices)
${deviceTable}

## IO List (${ioList.length} signals)
${ioSummary}

## FB Template Interfaces (use EXACT parameter names for wiring)
${fbInterfacesText}

Generate the deviceLinkage JSON now, wrapped in [DEVICE_LINKAGE]...[/DEVICE_LINKAGE] tags.`;
}

/**
 * User message for sequences + global data call (call 2 of 2).
 * Contains: device name list (compact), sequences from spec, interlocks.
 */
export function buildSequencesUserMessage(
  devices: ForgeDeviceEntry[],
  specAnalysis: SpecAnalysis | null,
): string {
  const deviceNames = devices
    .map((d) => `  - ${d.name} [${d.tag}] (${d.device_type}, ${d.subsystem})`)
    .join("\n");

  const sequenceSummary = specAnalysis?.process_sequences?.length
    ? specAnalysis.process_sequences
        .map((seq) => {
          const steps = (seq.steps ?? [])
            .map((st) => `      Step ${st.step_number}: ${st.action} → ${st.completion_criteria}`)
            .join("\n");
          const perms = (seq.permissives ?? []).length > 0 ? `\n    Permissives: ${(seq.permissives ?? []).join(", ")}` : "";
          return `  **${seq.name}** (${seq.subsystem})${perms}\n${steps}`;
        })
        .join("\n\n")
    : "  (none)";

  const interlocksText = specAnalysis?.interlocks?.length
    ? specAnalysis.interlocks
        .map((il) => `  - ${il.name}: ${il.condition} → affects: ${(il.affected_devices ?? []).join(", ")}`)
        .join("\n")
    : "  (none)";

  return `Generate the process sequences and global data for this project.

## Device List (${devices.length} devices — reference for device names in conditions)
${deviceNames}

## Process Sequences from Spec
${sequenceSummary}

## Interlocks from Spec
${interlocksText}

Generate the processSequences and globalData JSON now, wrapped in [SEQUENCES_DATA]...[/SEQUENCES_DATA] tags.`;
}

// ---------------------------------------------------------------------------
// FB Logic Diagram prompt
// ---------------------------------------------------------------------------

/**
 * System prompt for generating a Mermaid flowchart describing the internal logic
 * of a Function Block. Used in the FB Library to generate per-template diagrams.
 *
 * HARDCODED — not configurable via Prompts page.
 */
export function buildFbDiagramSystemPrompt(): string {
  return `You are a PLC automation expert creating logic flow diagrams for Siemens TIA Portal Function Blocks.

Your task is to generate a Mermaid flowchart that shows the INTERNAL LOGIC of the FB — the states, decisions, and actions that happen when the FB executes.

## Diagram requirements

- Use **flowchart TD** (top-down)
- Show the main execution path: enable/execute check → states → outputs
- Use **decision diamonds** for all IF/CASE conditions (e.g. fault check, mode selection, sensor states)
- Use **rectangles** for actions (output commands, timer starts, state changes)
- Use **rounded rectangles** for start/end nodes using syntax: \`id([text])\`
- Show the key state machine transitions if the FB has states
- Include fault/alarm paths — these are important for understanding safety behaviour
- If the FB has enable/execute inputs, show "Enabled?" as the first decision
- Keep labels SHORT — max 4 words per node. Use abbreviations if needed (e.g. "Run CMD ON", "Fault latch SET", "Timer elapsed?")
- Max 25 nodes — focus on the most important logic, not every line of code

## CRITICAL — Show HOW state transitions are determined
Do NOT just show a CASE/state dispatch diamond that fans out to state boxes. You MUST show the CONDITIONS that cause each transition:
- For state machines: show the decision nodes INSIDE each state that trigger the transition OUT of it
- Example for a motor FB in IDLE state: after the "Idle" state node, show a "Run edge?" decision diamond → Yes → another "Direction?" diamond → False = go to "St Fwd" node, True = go to "St Rev" node
- Arrow labels MUST show the condition that fires the transition (e.g. "Yes", "No", "Timeout", "End sensor", "direction=FWD")
- The viewer must be able to read the diagram and understand WHAT INPUT OR CONDITION causes each path — not just which states exist

## Node ID naming convention (REQUIRED for coloring)
Use these prefixes so nodes get the correct color class:
- \`act_\` prefix for action rectangles: \`act_runCmd["Run CMD ON"]\`
- \`dec_\` prefix for decision diamonds: \`dec_faultCheck{"Fault active?"}\`
- \`se_\` prefix for start/end rounded: \`se_start(["Start"])\`
- \`flt_\` prefix for fault/error nodes: \`flt_alarm["Fault latched"]\`
- \`st_\` prefix for state nodes (if FB has a state machine): \`st_running["State: Running"]\`

## Node label rules (CRITICAL — Mermaid will fail otherwise)
- NO colons inside node labels (they break Mermaid syntax). Use "→" or "-" instead.
- NO semicolons inside node text
- NO quotes inside node text — use apostrophes if needed
- String labels in quotes: \`act_x["label text"]\`
- Use \`<br/>\` for two-line labels: \`st_idle["State 0 - IDLE<br/>Outputs OFF, timers reset"]\` — title on line 1, key detail on line 2

## Edge label rules (CRITICAL — quotes inside pipes break Mermaid)
- Edge labels use pipe syntax: \`A -->|Yes| B\` or \`A -->|direction FWD| B\`
- NEVER put quotes inside pipe labels: \`-->|"Yes"|\` is INVALID — write \`-->|Yes|\`
- Keep edge labels short — 1-3 words max

## Orphan node rule (CRITICAL)
- Every node ID you define MUST appear in at least one \`-->\` edge as source or target
- NEVER write a standalone node definition like \`dec_foo{"label"}\` on its own line unless it is also referenced in an edge
- If a node is not connected to the graph, do not include it

## Color classes
Do NOT emit any \`classDef\` or \`class\` lines — coloring is applied automatically from the node ID prefixes after you output the chart.

## Output format
Output ONLY the raw Mermaid code — no explanation, no markdown fences, no comments before or after. Start directly with \`flowchart TD\`.`;
}

/**
 * User message for the FB diagram generation call.
 * Passes all SCL blocks for the template.
 */
export function buildFbDiagramUserMessage(template: { name: string; device_category: string; blocks?: Array<{ block_type: string; block_name: string; scl_code: string }> }): string {
  const code = (template.blocks ?? [])
    .filter((b) => b.scl_code.trim())
    .map((b) => `// ${b.block_type}: ${b.block_name}\n${b.scl_code}`)
    .join("\n\n---\n\n");

  return `Template: "${template.name}" | Category: ${template.device_category}

SCL Code:
${code}

Generate the Mermaid flowchart for this FB's internal logic now.`;
}

// ---------------------------------------------------------------------------
// FB Signal Flow Diagram prompt (AI-generated FbFlowDiagram[] JSON)
// ---------------------------------------------------------------------------

/**
 * System prompt for generating structured FbFlowDiagram[] JSON from SCL code.
 * The AI reads the SCL, understands the signal flow semantics, and produces
 * the exact JSON schema used by FbFlowRenderer.
 */
export function buildFbFlowSystemPrompt(): string {
  return `You are a senior PLC automation engineer analysing Siemens TIA Portal SCL Function Blocks.

Your task is to generate a structured signal flow diagram that shows how VAR_INPUT signals flow through internal logic to each VAR_OUTPUT.

## Output format

Output a JSON array of diagram groups wrapped in [FLOW_DIAGRAM]...[/FLOW_DIAGRAM] tags. Each group covers a set of related outputs. Use these exact TypeScript types:

\`\`\`
interface FbFlowDiagram {
  title: string;              // e.g. "ControlConveyor — Control Outputs"
  columns: FbFlowColumn[];
}
interface FbFlowTruthTableRow {
  values: string[];           // one value per header ("TRUE", "FALSE", "= 1", "ANY")
  result: string;             // output value for this combination ("TRUE", state name, etc.)
}
interface FbFlowColumn {
  outputName: string;         // The VAR_OUTPUT name this column traces to
  nodes: FbFlowNode[];
  connections: FbFlowConnection[];
  // Use truthTable INSTEAD of nodes/connections for IF/ELSIF/CASE state machine outputs:
  truthTable?: {
    headers: string[];        // input variable names shown as column headers
    rows: FbFlowTruthTableRow[];
  };
}
interface FbFlowNode {
  id: string;                 // unique within the diagram, e.g. "n1", "n2"
  type: "input" | "condition" | "timer" | "intermediate" | "output" | "fault";
  label: string;              // short, e.g. "#_Sensor", "#statState = 1", "#M002R.Q"
  sublabel?: string;          // optional second line, e.g. "PT: T#30s"
  shape: "rect" | "pill" | "hexagon";
  x: number;                  // layout x in pixels
  y: number;                  // layout y in pixels
  width: number;
  height: number;
}
interface FbFlowConnection {
  fromId: string;
  toId: string;
  type: "normal" | "fault" | "selfhold" | "reset";
  label?: string;             // "AND", "OR", "TRUE", "FALSE" at merge/split points
}
\`\`\`

## Node rules

- **VAR_INPUT** → type: "input", shape: "rect", width: 160, height: 38
- **Condition / comparison** → type: "condition", shape: "rect", width: 160, height: 38
- **Timer / edge instance** → type: "timer", shape: "rect", width: 160, height: 38, sublabel: "PT: T#Xs"
- **Static intermediate variable** → type: "intermediate", shape: "pill", width: 160, height: 38
- **VAR_OUTPUT** → type: "output", shape: "hexagon", width: 160, height: 44
- **Fault latch / fault output** → type: "fault", shape: "rect" (or "hexagon" for VAR_OUTPUT), width: 160, height: 38

## Layout rules

- Columns are laid out left to right. Column X positions: col 0 at x=32, col 1 at x=224, col 2 at x=416, col 3 at x=608
- Within each column, nodes stack top to bottom. Start y=32. Each node: y += (height + 28)
- The VAR_OUTPUT hexagon is always the BOTTOM node in its column
- AND conditions: stack vertically (one above the other in the same column)
- OR conditions: side by side at the same Y level, offset ±100px from column centre

## Signal tracing rules

For each VAR_OUTPUT:
1. Find its direct assignment: \`#output := expression\`
2. Trace the expression RECURSIVELY until you reach VAR_INPUT variables or constants
3. For intermediate static/temp vars, trace THEIR assignment too — show the full chain
4. For timers: \`#timer(IN := #cond, PT := T#Xs)\` then \`#result := #timer.Q\` → show condition → timer node (with PT sublabel) → .Q → result
5. For self-hold latches: \`#latch := (#set OR #latch) AND #hold\` → show set and latch (dashed selfhold) as OR inputs, then AND with hold, dashed arrow back to latch input
6. For CASE state machine outputs like \`#runForward := (#statState = 1) AND NOT #fault AND NOT #eStop\`: show each term as a condition node, AND-chained vertically

## Truth table rule (IMPORTANT)

For any output whose value is determined by a CASE statement or a chain of IF/ELSIF conditions based on a state machine variable, use \`truthTable\` INSTEAD of nodes/connections:
- \`headers\`: the input variables that determine the output (e.g. ["#statState", "#fault", "#eStop"])
- \`rows\`: one row per branch/case, \`values\` matching each header, \`result\` = what the output becomes
- Leave \`nodes\` as [] and \`connections\` as [] when \`truthTable\` is present
- Example: \`#_runForward\` driven by CASE #statState: headers=["#statState"], rows=[{values:["1"],result:"TRUE"},{values:["OTHER"],result:"FALSE"}]
- Example: \`#_status\` driven by (#statState = 2) AND NOT #fault: headers=["#statState","#fault"], rows=[{values:["= 2","FALSE"],result:"TRUE"},{values:["OTHER","ANY"],result:"FALSE"}]

## Grouping

Split outputs into diagrams by type (max 4 columns per diagram):
- "Control Outputs": run commands, direction outputs, motor outputs
- "Fault Outputs": fault latches, error flags, eStop status
- "Status Outputs": busy, idle, running flags, status words, remaining time

## Important

- Every connection's fromId and toId MUST reference real node IDs in the same diagram
- Nodes must be unique per column — do NOT reuse the same input node across columns if they have different IDs
- Keep labels SHORT — max 4-5 words. Use \`#varName\` format for variable references
- Generate realistic x/y coordinates that would produce a clean top-down layout

## Output instruction

Output ONLY the [FLOW_DIAGRAM] tag block — no explanation, no markdown fences, no text before or after the tags. Start your response with [FLOW_DIAGRAM] and end with [/FLOW_DIAGRAM].`;
}

/**
 * User message for the FB signal flow generation call.
 */
export function buildFbFlowUserMessage(template: {
  name: string;
  device_category: string;
  description: string | null;
  blocks?: Array<{ block_type: string; block_name: string; scl_code: string }>;
}): string {
  const code = (template.blocks ?? [])
    .filter((b) => b.scl_code.trim())
    .map((b) => `// ${b.block_type}: ${b.block_name}\n${b.scl_code}`)
    .join("\n\n---\n\n");

  const descLine = template.description ? `Description: ${template.description}\n` : "";

  return `FB Template: "${template.name}" | Category: ${template.device_category}
${descLine}
SCL Code:
${code}

Analyse the signal flow and generate the FbFlowDiagram[] JSON now, wrapped in [FLOW_DIAGRAM]...[/FLOW_DIAGRAM] tags.`;
}
