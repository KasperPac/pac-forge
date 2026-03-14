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
import type { ProcessLinkageMatrix, FbWire } from "@/types/process-builder";

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
          "description": "string (signal description)"
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

function formatProfile(profile: DesignProfile | undefined): string {
  if (!profile) return "";
  return `## Code Design Profile: ${profile.name}\n\n${profile.general_rules}`;
}

// ---------------------------------------------------------------------------
// Q&A Review prompts
// ---------------------------------------------------------------------------

/**
 * System prompt for the PM agent to review spec analysis and ask clarifying questions.
 *
 * HARDCODED — not configurable via Prompts page.
 * Design Profile fields used: none (Q&A is profile-agnostic).
 * To make configurable: add "forge:qa_review" section key to PROMPT_DEFAULTS and use resolveSection().
 */
export function buildQaReviewPrompt(): string {
  return `You are a Project Manager reviewing an automation project specification analysis.
Your role is to identify gaps, ambiguities, and missing information in the extracted analysis, then ask the engineer targeted clarifying questions.

## How to behave
- Review the spec analysis JSON provided by the engineer
- Identify what is MISSING, UNCLEAR, or potentially WRONG
- Ask specific, targeted questions grouped by category
- Reference specific parts of the analysis ("I see 12 devices are listed, but none have IO signal types — can you confirm...")
- If the analysis looks comprehensive and complete, acknowledge that and recommend proceeding
- Keep questions focused — max 5-8 questions per response
- After the engineer answers, acknowledge what's been clarified, then ask any remaining follow-up questions
- When all significant gaps are filled, explicitly state "The analysis looks complete" and output the updated JSON
- Do NOT say "ready to proceed" or "The analysis looks complete" in a response that still asks any clarifying question
- If unanswered questions remain, keep the review open and ask only those questions

## Categories to check
1. **PLC/Hardware** — CPU type specified? Safety PLC needed? Profinet/Profibus topology?
2. **IO** — All devices accounted for? IO signal types (DI/DQ/AI/AQ) specified? Any signals missing?
3. **Process sequences** — Steps clear and unambiguous? Completion criteria defined? Permissives/interlocks listed?
4. **Safety** — E-stop handling described? Safety interlocks specified? Safety category required?
5. **HMI** — Panel type specified (KTP, Unified Comfort)? Screen requirements clear?
6. **Alarms** — Severity classifications complete? Response actions defined?

## Output format for final update
When all gaps are filled, output:
1. A brief summary of what was clarified
2. The **complete** updated spec analysis as valid JSON inside \`\`\`json fences

**CRITICAL**: The JSON must include ALL fields from the original analysis — every device, every sequence, every alarm and interlock. Do NOT output a partial or summary JSON. If you only clarified IO signals for 3 devices, still output all 24 devices (with those 3 updated). Omitting devices causes them to disappear from the project.

Be conversational and professional — this is a dialogue with an experienced engineer, not a form.`;
}

/**
 * System prompt for follow-up Q&A rounds — same role, receives conversation history.
 *
 * HARDCODED — not configurable via Prompts page.
 * Design Profile fields used: none.
 */
export function buildQaFollowUpPrompt(): string {
  return `You are a Project Manager continuing a Q&A review of an automation project specification.
You have already asked an initial set of questions. Review the engineer's answers and:
- Acknowledge what has been clarified
- Ask any remaining important follow-up questions (max 3-4)
- If all significant gaps are now filled, say so clearly and output the updated analysis JSON
- Do NOT mark the review complete if you are still asking a question in that same response

Keep it brief — the engineer wants to move forward. Only ask about genuinely important gaps.

When ready to finalize, output the complete updated spec analysis as valid JSON inside \`\`\`json fences. The JSON must contain ALL original devices and sequences — not just the ones discussed. Omitting any device causes it to be lost from the project.`;
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
export function buildSpecAnalysisPrompt(fbTemplates?: FbTemplate[]): string {
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

  return `You are a senior automation engineer with deep experience in Siemens TIA Portal projects.
Your task is to read a functional specification document and extract structured project data as JSON.

${librarySection}

## Device extraction rules

Extract devices at ALL levels of the system — not just physical actuators:

- **ACTUATORS**: Motors (DOL, VFD), Solenoids, Valves, Cylinders — have physical DQ outputs
- **SENSORS**: Photoelectric, Proximity, Temperature, Pressure, Level, Flow — have physical DI/AI inputs
- **SYSTEM DEVICES**: Conveyors, Pumps, Mixers — logical control entities that coordinate actuators and sensors
- **OPERATOR DEVICES**: Push buttons, Stack lights, Selector switches — have physical DI/DQ. Each individual push button is its OWN device with ONE DI signal — do NOT group multiple buttons into a single "Push Button Station" device.
- **SAFETY DEVICES**: E-stop circuits, Safety light curtains, Guard switches — have DI inputs

**IMPORTANT:** If the spec describes "Conveyor CV01 driven by motor M01 with sensors PE01 and PE02", extract THREE separate devices:
1. CV01 as device_type "Conveyor" — the system device for direction, sequencing, and sensor logic
2. M01 as device_type "Motor DOL" — the actuator that physically drives the belt
3. PE01, PE02 as device_type "Photoelectric Sensor" — the sensors that detect product

Each device type has its OWN Function Block in the PLC code. They are connected in the Process FC, not nested inside each other. The Conveyor FB does NOT contain a Motor FB — they are separate FBs wired together.

For IO signals per device:
- Motor: CMD (DQ), RUN feedback (DI), Overload/Fault (DI)
- Conveyor: NO direct physical IO — receives sensor data and motor feedback as FB parameters
- Sensor: Detection signal (DI) or analog value (AI)
- Push Button (each button is a separate device): exactly 1 DI signal per device
- Stack Light: One DQ per lamp colour (GREEN, AMBER, RED)
- E-Stop: Circuit OK signal (DI)

## General rules

- Extract ALL devices, including those in instrumentation tables or IO schedules.
- Extract ALL IO signals for each device. DI = digital input, DQ = digital output (coil), AI = analog input, AQ = analog output.
- Extract ALL process sequences with numbered steps, actions, and completion criteria.
- Extract alarms and interlocks where described.
- The spec may contain Italian terminology — translate to English for all output fields.
- Markdown tables (from mammoth/pandoc conversion) represent data tables — parse them carefully.
- If a field cannot be determined from the spec, use an empty string or empty array.
- Do NOT invent data that isn't in the spec.

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
  const profileSection = formatProfile(profile);

  return `You are a senior Siemens TIA Portal SCL programmer generating a Function Block for a single industrial device.

${profileSection}

## Platform Rules
${platformRules}

${templateSection}

${patternSection}

## FB Architecture Requirements
- Organize FB body into REGION blocks: IO Mapping, State Machine, Alarm Handling, Output Mapping
- Include PLCopen-style outputs: busy (Bool), error (Bool), status (Word := 16#7000)
- Use status word ranges: 16#0000 done, 16#7000 idle, 16#7001 first call, 16#7002 executing, 16#8xxx errors
- Use CASE-based state machines with integer literal labels for all sequential logic
- Include interlock checks, alarm handling with latching/operator reset
- All timers/counters/edges declared in VAR (static) with inst prefix, NEVER in VAR_TEMP
- Include a resetAlarms : Bool input for operator alarm acknowledgment

## Instance DB Rules
- Generate a separate instance DB for each FB
- Instance DB just references the FB name — do NOT redeclare variables inside the DB
- Format: DATA_BLOCK "InstDeviceName" { S7_Optimized_Access := 'TRUE' } NON_RETAIN "FBName" BEGIN END_DATA_BLOCK

## Calling Convention
- Device FBs are called from the Process FC using instance DB name ONLY: "InstMotor1"(start := signal)
- NEVER use "FBName"."InstDBName" syntax — it does not compile

## Output Format
Return the complete SCL code for:
1. The device FB (type FB, named according to naming conventions)
2. The instance DB (type DB, named "Inst${device.name.replace(/[^A-Za-z0-9]/g, "")}")

Use this exact format:
\`\`\`scl [BlockType:BlockName]
// content
\`\`\`

Example:
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
  const profileSection = formatProfile(profile);
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
 * 1 = sensors/inputs (called first), 2 = mid-level, 3 = actuators (called last before RunProcess).
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
export function generateGlobalDb(dbName: string, fields: Array<{ fieldName: string; dataType: string; description?: string }>): string {
  const fieldLines = fields
    .filter(f => f.fieldName && f.fieldName.trim().length > 0)
    .map(f => `    ${f.fieldName} : ${f.dataType || "Bool"};${f.description ? `  // ${f.description}` : ""}`)
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
    `FUNCTION "IoLinking" : Void`,
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
 * Call order: IoLinking → device call FCs (pre-sorted by caller) → RunProcess.
 *
 * HARDCODED — not configurable via Prompts page.
 */
export function generateOb1Main(deviceCallFcNames: string[]): string {
  const fcCalls = deviceCallFcNames.map((name) => `  "${name}"();`).join("\n");
  return [
    `ORGANIZATION_BLOCK "Main"`,
    `TITLE = 'Main Program Sweep (Cycle)'`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `  VAR_TEMP`,
    `    tempFirstScan : Bool;`,
    `  END_VAR`,
    `BEGIN`,
    `  "IoLinking"();`,
    fcCalls,
    `  "RunProcess"();`,
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
export function buildDeviceCallFcPrompt(context: DeviceCallFcContext): string {
  const { profile, platformRules, patterns, fcName, deviceType, devices, instanceDbNames, fbInterfaceSection, inputsDbFields, outputsDbFields, inputsDbName, outputsDbName, matrixWiring } = context;

  const profileSection = formatProfile(profile);
  const patternSection = formatPatterns(patterns ?? []);

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

  return `You are a senior Siemens TIA Portal SCL programmer generating a Device Call FC.

${profileSection}

## Platform Rules
${platformRules}

${patternSection}

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
7. Do NOT wire IO tags directly — always go through the Inputs/Outputs DBs.
${hasMatrix ? "8. Do NOT change, reorder, or omit any wire from the Matrix wiring. Do NOT add wires not listed unless they are mandatory FB parameters with no matrix entry." : ""}

## FB Interface — MANDATORY REFERENCE
⛔ HARD RULE: Only use variable names that appear verbatim in the interface below. Do NOT invent names.
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
 * User message for Device Call FC generation.
 */
export function buildDeviceCallFcUserMessage(context: DeviceCallFcContext): string {
  return `Generate the "${context.fcName}" FC that calls all ${context.devices.length} "${context.deviceType}" device instance(s) with all inputs fully wired.`;
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
): string {
  const { profile, platformRules, patterns } = context;
  const profileSection = formatProfile(profile);
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

  return `You are an IO Validator / IO Linking Engineer for Siemens TIA Portal. Generate an IO linking FC in LAD format that maps physical IO tags to the "Inputs" and "Outputs" global DBs.

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
Map physical inputs to "Inputs".fieldName and "Outputs".fieldName to physical outputs.
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
      "title": "Map SensorInput to Inputs DB",
      "logic": {
        "type": "series",
        "nodes": [
          { "type": "element", "element": { "id": "e1", "type": "NO_CONTACT", "operand": "SensorTag", "dataType": "Bool" } },
          { "type": "element", "element": { "id": "e2", "type": "OUTPUT_COIL", "operand": "Inputs.SensorTag", "dataType": "Bool" } }
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
  /** For RunProcess FC generation: instance DB names of all device FBs */
  instanceDbNames?: string[];
  /** For RunProcess FC generation: names of all generated sequence FBs/FCs */
  sequenceArtifactNames?: string[];
  /** For RunProcess FC generation: IO entries for tag wiring */
  ioEntries?: ForgeIoEntry[];
  /** Device entries (for IO wiring context) */
  deviceEntries?: ForgeDeviceEntry[];
  /** Full linkage matrix with engineer-confirmed device wiring and process sequences */
  linkageMatrix?: ProcessLinkageMatrix;
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
export function buildProcessSclPrompt(context: ProcessGenContext): string {
  const { profile, platformRules, patterns, deviceFbInterfaces } = context;

  const processRulesSection =
    profile && profile.process_rules.length > 0
      ? `## Process Code Rules (from Design Profile: ${profile.name})\n${profile.process_rules.map((r) => `### ${r.label}\n${r.example}\n*Analysis:* ${r.analysis}`).join("\n\n")}`
      : "";

  const patternSection = formatPatterns(patterns ?? []);
  const profileSection = formatProfile(profile);

  return `You are a senior Siemens TIA Portal SCL programmer generating process/sequence code.

${profileSection}

## Platform Rules
${platformRules}

${processRulesSection}

## Device FB Interfaces
The following FB interfaces are available for use in process code:
${deviceFbInterfaces || "(no device FBs generated yet)"}

${patternSection}

## Process Code Requirements
1. Implement each process sequence as an FB (not FC) with a CASE-based state machine if it needs timers or edge detection. Use FC only if purely stateless.
2. Steps should be numbered (0, 10, 20, 30...) with clear transitions.
3. Include interlock checks at the start of each sequence step using a dedicated #tempInterlockOK Bool.
4. Every process FB must expose VAR_OUTPUT for HMI: currentStep (Int), running (Bool), faulted (Bool), complete (Bool).
5. Use latching alarm patterns — set on fault condition, require operator reset via resetAlarms (Bool) input.
6. All timed operations use TON with configurable PT as VAR_INPUT.
7. Include safety condition checks (E-stop, safety relay) that halt the sequence to safe state on failure.
8. Include permissive checks that gate sequence start.

## Code Structure Requirements
- Use CASE-based state machines for sequences (step variable, CASE step OF ... END_CASE)
- Each step has a clear entry action, hold condition, and exit transition
- Include ELSE branch for undefined states
- Use REGION blocks to organise sections
- Declare step variable as INT in static variables (VAR, not VAR_TEMP)
- Use PLCopen-style enable/execute + busy/done/error outputs
- All timers/counters/edges declared in VAR (static) with inst prefix, NEVER in VAR_TEMP

## IMPORTANT: Scope of This Call
Do NOT generate OB1 or the master Process FC here — only the sequence-specific FB/FC.
The master Process FC (RunProcess) and OB1 Main are generated separately after all sequences.

## Output Format
\`\`\`scl [FB:ProcessName]
// code
\`\`\`

Generate one FB per process sequence (or FC if purely stateless).`;
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

Generate a complete, compile-ready CASE state machine FC.`;
}

/**
 * System prompt for generating the master RunProcess FC.
 * Called after all sequence FBs are generated.
 *
 * RunProcess contains ONLY process sequence logic — it does NOT call device FBs
 * (those are called in the per-device-type Device Call FCs) and does NOT wire IO
 * (that is done in IoLinking FC and Device Call FCs).
 *
 * HARDCODED — not configurable via Prompts page.
 * Design Profile fields used:
 *   - general_rules: injected as coding standards
 *   - process_rules: injected as process coding conventions
 * Design Profile fields NOT used (could be added):
 *   - io_linking_rules: RunProcess does not wire IO directly
 *   - naming_prefix: could apply to the RunProcess FC name
 * To make configurable: add "forge:process_fc" section key to PROMPT_DEFAULTS and use resolveSection().
 */
export function buildProcessFcPrompt(context: ProcessGenContext): string {
  const { profile, platformRules, patterns, deviceFbInterfaces, instanceDbNames = [], sequenceArtifactNames = [], linkageMatrix } = context;
  const profileSection = formatProfile(profile);
  const patternSection = formatPatterns(patterns ?? []);

  const instanceDbList = instanceDbNames.length > 0
    ? instanceDbNames.map((n) => `  - "${n}"`).join("\n")
    : "  (no instance DBs available)";

  const sequenceList = sequenceArtifactNames.length > 0
    ? sequenceArtifactNames.map((n) => `  - "${n}"()`).join("\n")
    : "  (no sequence FBs/FCs generated)";

  // Build matrix device state reference if available
  const matrixDeviceStateSection = linkageMatrix?.deviceLinkage && linkageMatrix.deviceLinkage.length > 0
    ? `## Device State Signals (from Matrix Review — engineer-confirmed)
Use these instance DB paths to read device state and send commands:
${linkageMatrix.deviceLinkage.map(d => {
  const outputs = (d.wiring ?? []).filter(w => w.direction === "out");
  if (outputs.length === 0) return `  - "${d.instanceDbName ?? d.name}" (${d.name})`;
  return `  - "${d.instanceDbName ?? d.name}" (${d.name}): ${outputs.map(w => w.paramName).join(", ")}`;
}).join("\n")}`
    : "";

  // Build matrix process sequences reference if available
  const matrixSequencesSection = linkageMatrix?.processSequences && linkageMatrix.processSequences.length > 0
    ? `## Process Sequences (from Matrix Review — engineer-confirmed structure)
${linkageMatrix.processSequences.map(seq => {
  const permissives = (seq.permissives ?? []).length > 0
    ? `  Permissives: ${seq.permissives.map(p => `${p.description ?? ""}${p.deviceName ? ` (${p.deviceName})` : ""}${!p.polarity ? " [INVERTED]" : ""}`).join(", ")}`
    : "";
  const safety = (seq.safetyConditions ?? []).length > 0
    ? `  Safety: ${seq.safetyConditions.map(s => `${s.description ?? ""}${s.deviceName ? ` (${s.deviceName})` : ""}${!s.polarity ? " [INVERTED]" : ""}`).join(", ")}`
    : "";
  const stepSummary = (seq.steps ?? []).map(s => {
    const actions = (s.actions ?? []).map(a => a.description ?? "").join(", ");
    const conditions = s.transition?.conditions ?? [];
    const condStr = conditions.map(c => c.description ?? "").join(` ${s.transition?.combinator ?? "AND"} `);
    return `    Step ${s.stepNumber ?? "?"}: ${actions || "(no actions)"} | Done: ${condStr || "(no conditions)"}`;
  }).join("\n");
  return `### ${seq.name ?? "(unnamed)"}\n${permissives ? permissives + "\n" : ""}${safety ? safety + "\n" : ""}  Steps:\n${stepSummary}`;
}).join("\n\n")}`
    : "";

  return `You are a senior Siemens TIA Portal SCL programmer generating the master RunProcess FC.

${profileSection}

## Platform Rules
${platformRules}

${patternSection}

## Your Task
Generate a single FC called "RunProcess" containing ONLY process sequence logic.

## CRITICAL SCOPE RESTRICTIONS
⛔ DO NOT call any device FBs — device FB calls are in the Device Call FCs (MotorCall, SensorCall, etc.)
⛔ DO NOT wire any physical IO tags — IO wiring is in the IoLinking FC and Device Call FCs
⛔ DO NOT wire config parameters — config wiring is in the Device Call FCs

## What RunProcess CAN do
✅ Call process sequence FBs/FCs to coordinate multi-step sequences
✅ Read instance DB output fields to check device status (e.g. "InstMotor1".running)
✅ Write instance DB fields to send commands (e.g. "InstMotor1".start := TRUE) where the FB supports it via VAR_IN_OUT
✅ Implement mode selection logic (Auto/Manual/Maintenance)
✅ Implement process-level interlocks and permissives using device state signals
✅ Implement alarm coordination logic

## Device FB Interfaces (for reading instance DB state — do NOT call these FBs here)
${deviceFbInterfaces}

## Device Instance DBs (for reading/writing device state)
${instanceDbList}

## Process Sequence FBs/FCs to Call
${sequenceList}
${matrixDeviceStateSection ? "\n" + matrixDeviceStateSection + "\n" : ""}
${matrixSequencesSection ? "\n" + matrixSequencesSection + "\n" : ""}
## Output Format
\`\`\`scl [FC:RunProcess]
// RunProcess FC code
\`\`\``;
}

/**
 * User message for RunProcess FC generation.
 */
export function buildProcessFcUserMessage(): string {
  return "Generate the RunProcess FC with pure process sequence logic as described above. Do NOT call device FBs or wire IO.";
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
export function buildProcessLadPrompt(context: ProcessGenContext): string {
  const { profile, platformRules, patterns } = context;
  const profileSection = formatProfile(profile);
  const patternSection = formatPatterns(patterns ?? []);

  return `You are generating sequential ladder logic for a process sequence using Siemens TIA Portal LAD format.

${profileSection}

## Platform Rules
${platformRules}

## Device FB Interfaces
${context.deviceFbInterfaces || "(no device FBs)"}

${patternSection}

## Approach
Use step bits (BOOL static variables, e.g. statStep01, statStep02) and transition rungs.
Each step: set step bit when entering, reset when leaving.
Transitions: contact on previous step + completion condition → set next step.

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
      "title": "Description of what this rung does",
      "logic": {
        "type": "series",
        "nodes": [
          { "type": "element", "element": { "id": "e1", "type": "NO_CONTACT", "operand": "statStep01", "dataType": "Bool" } },
          { "type": "element", "element": { "id": "e2", "type": "NO_CONTACT", "operand": "StartCondition", "dataType": "Bool" } },
          { "type": "element", "element": { "id": "e3", "type": "SET_COIL", "operand": "statStep02", "dataType": "Bool" } }
        ]
      }
    }
  ]
}

Valid element types: "NO_CONTACT", "NC_CONTACT", "OUTPUT_COIL", "SET_COIL", "RESET_COIL", "TON", "TOF", "CMP", "MOVE"
CRITICAL: every rung MUST have a "logic" object with a "nodes" array. Do NOT put "nodes" directly on the rung.`;
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
  - \`global\` — global DB field (e.g. "HmiData.motor1Start")
  - \`constant\` — scalar primitive ONLY: Bool (TRUE/FALSE), Time (T#5s), Int (0), Real (0.0). NEVER use constant for UDT/struct parameters — any param whose type starts with "type" or is a custom struct MUST use wireType "global" pointing to a Configuration DB field (e.g. connectedTo: "Configuration.motor1Config")
- **UDT/struct parameters** (e.g. \`config\` of type \`typeMotorConfig\`) MUST be wired to a "Configuration" global DB. Add the Configuration DB to globalData with appropriate fields for each UDT param. Example: \`{ "paramName": "config", "direction": "in", "wireType": "global", "connectedTo": "Configuration.motor1Config" }\`
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
          "connectedTo": "string (IO tag, global DB field, or other FB output)",
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
          "description": "string"
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
      "steps": [
        {
          "id": "string (unique)",
          "stepNumber": 0,
          "transition": {
            "combinator": "AND | OR",
            "conditions": [
              {
                "id": "string (unique)",
                "description": "short signal-level description e.g. 'PE01_DET active'",
                "deviceName": "string | null",
                "targetStepNumber": "number | null — REQUIRED for OR transitions: the step number this condition routes to. If condition A fires go to step 20, if condition B fires go to step 60, set targetStepNumber accordingly."
              }
            ]
          },
          "actions": [
            {
              "id": "string (unique)",
              "description": "short imperative e.g. 'M01_CMD_FWD = TRUE' or 'Set state = Running'",
              "deviceName": "string | null"
            }
          ],
          "devicesInvolved": ["string — tag or device names used in this step"],
          "notes": "string — optional implementation notes"
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
export function buildDeviceLinkagePrompt(): string {
  return `You are a senior Siemens TIA Portal automation engineer generating the device wiring section of a Process Linkage Matrix.

Generate ONLY the deviceLinkage array — which FB each device uses, its instance DB name, how FB parameters wire to IO tags or global data, and interlocks between devices.

${MATRIX_RULES_COMMON}
- Interlocks must reference devices that exist in the device list
- Use EXACT parameter names from the FB Template Interfaces provided
- If an FB has a configuration/settings parameter of a UDT type (e.g. \`config : typeMotorConfig\`), wire it as: \`{ "wireType": "global", "connectedTo": "Configuration.<instanceName>Config" }\`. Include the Configuration DB in globalData with matching fields. NEVER wire a struct param as \`constant: TRUE\`.

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
export function buildSequencesPrompt(): string {
  return `You are a senior Siemens TIA Portal automation engineer generating the process sequences and global data section of a Process Linkage Matrix.

Generate ONLY the processSequences array and globalData array — state-machine logic with permissives, safety conditions, step transitions, and shared data blocks.

${MATRIX_RULES_COMMON}
- Process sequences must include numbered steps starting at step 0 (idle)
- Step transitions use AND/OR combinator with explicit conditions
- Safety conditions are continuously monitored — failure stops the process
- generatedAt must be the current ISO timestamp
- Keep descriptions and notes concise (1 sentence max) — avoid verbose explanations
- For OR transitions, ALWAYS set targetStepNumber on each condition to the step number it routes to. This enables proper visual branching in the diagram. Example: if PE01 active → step 20, PE02 active → step 60, set targetStepNumber: 20 and 60 respectively.
- Action descriptions must be short imperatives: "M01_CMD_FWD = TRUE", "Set state = Running", "ESTOP latch = OFF" — never verbose prose
- Condition descriptions must be short signal-level labels: "PE01_DET active", "ESTOP = ON", "Speed = 0" — never full sentences

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
        : `FB Template: none (generate from scratch)`;
      return `**${d.name}** [${d.tag}]\n  Type: ${d.device_type}\n  Subsystem: ${d.subsystem}\n  ${fbInfo}\n  IO Signals:\n${signals || "    (none)"}`;
    })
    .join("\n\n");

  const ioSummary = ioList.length > 0
    ? ioList
        .slice(0, 50)
        .map((io) => `  ${io.address}: ${io.tag_name} (${io.signal_type}) — ${io.description}`)
        .join("\n") + (ioList.length > 50 ? `\n  ... and ${ioList.length - 50} more` : "")
    : "  (none)";

  const referencedTemplateIds = new Set(
    devices.map((d) => d.fb_template_id).filter(Boolean),
  );
  const fbInterfacesText =
    referencedTemplateIds.size > 0
      ? [...referencedTemplateIds]
          .map((id) => {
            const tpl = templateMap.get(id!);
            if (!tpl?.blocks?.length) return null;
            const mainBlock = tpl.blocks.find((b) => b.block_type === "FB") ?? tpl.blocks[0];
            if (!mainBlock) return null;
            const inputParams = [...mainBlock.scl_code.matchAll(/VAR_INPUT\b[\s\S]*?END_VAR/g)]
              .flatMap((m) => [...m[0].matchAll(/^\s+(\w+)\s*:/gm)].map((p) => p[1]))
              .join(", ");
            const outputParams = [...mainBlock.scl_code.matchAll(/VAR_OUTPUT\b[\s\S]*?END_VAR/g)]
              .flatMap((m) => [...m[0].matchAll(/^\s+(\w+)\s*:/gm)].map((p) => p[1]))
              .join(", ");
            return `  **${tpl.name}** (${mainBlock.block_name})\n  VAR_INPUT: ${inputParams || "(none)"}\n  VAR_OUTPUT: ${outputParams || "(none)"}`;
          })
          .filter(Boolean)
          .join("\n\n")
      : "  (none — use standard parameter naming conventions)";

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
): string {
  const { deviceTable, ioSummary, fbInterfacesText } = buildMatrixContext(devices, ioList, fbTemplates);

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
- Max 20 nodes — focus on the most important logic, not every line of code

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

## Color classes (REQUIRED — append EXACTLY these lines at the end of your output)
\`\`\`
    classDef action fill:#0a3d35,stroke:#1D9E75,color:#e8e8e8
    classDef decision fill:#1a2030,stroke:#4A90E2,color:#7ab3f0
    classDef startEnd fill:#2a2a3e,stroke:#555,color:#e8e8e8
    classDef fault fill:#3a1515,stroke:#E24B4A,color:#e8e8e8
    classDef state fill:#1a2a3e,stroke:#4A90E2,color:#e8e8e8
\`\`\`
Then assign classes using the node ID prefixes:
- All \`act_*\` nodes → \`class act_... action\`
- All \`dec_*\` nodes → \`class dec_... decision\`
- All \`se_*\` nodes → \`class se_... startEnd\`
- All \`flt_*\` nodes → \`class flt_... fault\`
- All \`st_*\` nodes → \`class st_... state\`

Example:
    class act_runCmd,act_stopCmd action
    class dec_faultCheck,dec_enabled decision
    class se_start,se_end startEnd
    class flt_alarm fault

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
