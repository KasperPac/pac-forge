/**
 * forge-prompts.ts
 * Central prompt builders for the Forge Wizard pipeline.
 * All wizard AI calls originate from this file.
 */

import type { DesignProfile } from "@/types/design-profile";
import type {
  ForgeDeviceEntry,
  ForgeIoEntry,
  SpecAnalysis,
  SpecAnalysisProcessSequence,
} from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";
import type { PatternCandidate } from "@/types";

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
 */
export function buildQaFollowUpPrompt(): string {
  return `You are a Project Manager continuing a Q&A review of an automation project specification.
You have already asked an initial set of questions. Review the engineer's answers and:
- Acknowledge what has been clarified
- Ask any remaining important follow-up questions (max 3-4)
- If all significant gaps are now filled, say so clearly and output the updated analysis JSON

Keep it brief — the engineer wants to move forward. Only ask about genuinely important gaps.

When ready to finalize, output the complete updated spec analysis as valid JSON inside \`\`\`json fences. The JSON must contain ALL original devices and sequences — not just the ones discussed. Omitting any device causes it to be lost from the project.`;
}

/**
 * System prompt for producing the final updated SpecAnalysis from Q&A conversation.
 * Use this for a dedicated "finalize" call when the PM hasn't already output updated JSON.
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
}

/**
 * System prompt for generating a single device FB in SCL.
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
Return a JSON object matching the LadProgram type (defined below). Do NOT include any SCL. Do NOT wrap in markdown fences — return raw JSON only.

LadProgram JSON schema:
{
  "name": "string (program name)",
  "rungs": [
    {
      "id": "string",
      "comment": "string",
      "nodes": [
        // LadNode — either a chain or parallel:
        // Chain: { "type": "element", "element": LadElement }
        // Parallel: { "type": "parallel", "chains": [LadSeriesChain[]] }
      ]
    }
  ]
}

LadElement types: "contact_no" | "contact_nc" | "coil" | "set_coil" | "reset_coil" | "coil_p" | "coil_n" | "compare" | "timer_ton" | "timer_tof" | "timer_tp" | "counter_ctu" | "counter_ctd" | "move" | "math"

LadElement schema:
{
  "type": "contact_no",
  "tag": "full PLC tag name",
  "label": "display label"
}

For timers: add "instance": "TimerInstName", "pt": "T#5s"
For compare: add "operator": "GT"|"LT"|"EQ"|"GE"|"LE"|"NE", "in1": "tag or value", "in2": "tag or value"`;
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
// IO linking FC prompt
// ---------------------------------------------------------------------------

/**
 * System prompt for generating the IO linking FC (maps physical IO to FB inputs/outputs).
 * @param language "SCL" (default) or "LAD"
 */
export function buildIoLinkingPrompt(
  devices: ForgeDeviceEntry[],
  ioList: ForgeIoEntry[],
  context: DeviceGenContext,
  language: "SCL" | "LAD" = "SCL",
): string {
  const { profile, platformRules, patterns } = context;
  const profileSection = formatProfile(profile);
  const patternSection = formatPatterns(patterns ?? []);
  const ioLinkingRulesSection =
    profile?.io_linking_rules?.trim()
      ? `## IO Linking Rules (from Design Profile)\n${profile.io_linking_rules}`
      : "";

  const deviceNames = devices.map((d) => `  - ${d.name} (tag: ${d.tag})`).join("\n");
  const ioEntries = ioList
    .map((io) => `  - ${io.tag_name} (${io.signal_type}, ${io.data_type}): ${io.description}`)
    .join("\n");

  const outputFormat =
    language === "LAD"
      ? `## Output Format
Generate a single FC in LAD (Ladder Logic). Output a LadProgram JSON object.
The FC reads physical IO tags and writes them to the instance DBs of each device FB.
Follow the IO Linking Rules from the Design Profile for rung style.
IMPORTANT: Every rung MUST contain at least one output element (OUTPUT_COIL, SET_COIL, or RESET_COIL). Do NOT generate header/comment rungs with only contacts — they are invalid in TIA Portal. Use the rung title field for section descriptions instead.
Respond with only the raw JSON object (no markdown wrapper), using this exact schema:

Valid element type values (use EXACTLY these strings):
  "NO_CONTACT"   — normally-open contact (reads a Bool tag)
  "NC_CONTACT"   — normally-closed contact
  "OUTPUT_COIL"  — output coil (writes a Bool tag)
  "MOVE"         — MOVE box: operand=source, outputOperand=destination
  "TON"/"TOF"    — timer boxes
  "CMP"          — compare box

Example (Contact → Coil rung):
{
  "name": "IoLinking",
  "rungs": [
    {
      "id": "rung_1",
      "title": "Assign SensorSignal to InstDevice1.sensorInput",
      "logic": {
        "type": "series",
        "nodes": [
          { "type": "element", "element": { "id": "e1", "type": "NO_CONTACT", "operand": "SensorSignal", "dataType": "Bool" } },
          { "type": "element", "element": { "id": "e2", "type": "OUTPUT_COIL", "operand": "InstDevice1.sensorInput", "dataType": "Bool" } }
        ]
      }
    }
  ]
}`
      : `## Output Format
Generate a single FC in SCL. The FC reads physical IO tags and writes them to the instance DBs of each device FB.
Use the format:
\`\`\`scl [FC:IoLinking]
// code
\`\`\``;

  return `You are generating an IO linking Function (FC) that maps physical IO tag values to FB instance inputs/outputs.

${profileSection}

## Platform Rules
${platformRules}

${ioLinkingRulesSection}

${patternSection}

## Devices
${deviceNames}

## IO List
${ioEntries}

${outputFormat}`;
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
}

/**
 * System prompt for generating process/sequence code in SCL.
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
  const steps = sequence.steps
    .map((s) => `  Step ${s.step_number}: ${s.action} → Done when: ${s.completion_criteria}`)
    .join("\n");

  const permissives =
    sequence.permissives.length > 0
      ? `\n**Permissives (must be true before starting):**\n${sequence.permissives.map((p) => `  - ${p}`).join("\n")}`
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
 * Receives device FB interfaces, IO entries, instance DB names, and sequence artifact names.
 */
export function buildProcessFcPrompt(context: ProcessGenContext): string {
  const { profile, platformRules, patterns, deviceFbInterfaces, instanceDbNames = [], sequenceArtifactNames = [], ioEntries = [], deviceEntries = [] } = context;
  const profileSection = formatProfile(profile);
  const patternSection = formatPatterns(patterns ?? []);

  const instanceDbList = instanceDbNames.length > 0
    ? instanceDbNames.map((n) => `  - "${n}"`).join("\n")
    : "  (no instance DBs available)";

  const sequenceList = sequenceArtifactNames.length > 0
    ? sequenceArtifactNames.map((n) => `  - "${n}"()`).join("\n")
    : "  (no sequence FBs/FCs generated)";

  const ioList = ioEntries.length > 0
    ? ioEntries.map((io) => `  - ${io.tag_name} (${io.signal_type}): ${io.description}`).join("\n")
    : "  (no IO entries)";

  const deviceIoMap = deviceEntries.length > 0
    ? deviceEntries.map((d) => {
        const sigs = (d.io_signals ?? []).map((s) => `    - ${s.tag_name} (${s.signal_type})`).join("\n");
        const instName = `Inst${d.name.replace(/[^A-Za-z0-9]/g, "")}`;
        return `  "${instName}" (${d.device_type}):\n${sigs || "    (no signals)"}`;
      }).join("\n")
    : "  (no device entries)";

  return `You are a senior Siemens TIA Portal SCL programmer generating the master RunProcess FC.

${profileSection}

## Platform Rules
${platformRules}

${patternSection}

## Your Task
Generate a single FC called "RunProcess" that:
1. Calls every device FB via its instance DB (using "InstDeviceName"(inputs...) syntax)
2. Wires physical IO tags to FB inputs/outputs using the IO list below
3. Calls all process sequence FBs/FCs

## Device FB Interfaces
${deviceFbInterfaces}

## Device Instance DBs and Their IO Signals
${deviceIoMap}

## All Instance DBs to Call
${instanceDbList}

## All Process Sequence FBs/FCs to Call
${sequenceList}

## Full IO List (for wiring)
${ioList}

## Calling Convention
- Call device FBs: "InstMotor1"(start := %I0.0, feedback := %I0.1)
- NEVER use "FBName"."InstDBName" syntax
- Call sequence FBs: "SeqConveyor"(enable := statRunning)
- Wire IO tags symbolically (no absolute addresses)

## Output Format
\`\`\`scl [FC:RunProcess]
// RunProcess FC code
\`\`\``;
}

/**
 * System prompt for generating OB1 Main.
 * Minimal — just calls RunProcess.
 */
export function buildOb1Prompt(): string {
  return `You are a senior Siemens TIA Portal SCL programmer generating OB1 Main.

Generate a minimal OB1 "Main" that calls the RunProcess FC. Keep it simple — just the FC call, no logic.

## Output Format
\`\`\`scl [OB:Main]
// OB1 Main code
\`\`\``;
}

/**
 * User message for RunProcess FC generation.
 */
export function buildProcessFcUserMessage(): string {
  return "Generate the RunProcess FC that calls all device FBs and sequence FBs/FCs as described above.";
}

/**
 * User message for OB1 Main generation.
 */
export function buildOb1UserMessage(): string {
  return 'Generate OB1 "Main" that calls RunProcess(). Keep it minimal — just the FC call.';
}

/**
 * System prompt for generating process/sequence code in LAD (sequential ladder).
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
Return raw LadProgram JSON only (same schema as device LAD generation). No markdown fences.`;
}

// ---------------------------------------------------------------------------
// TASK 8: HMI screen generation prompt
// ---------------------------------------------------------------------------

/**
 * System prompt for HMI overview + faceplate screen generation.
 * AI must output HmiScreenSpec JSON (src/types/hmi-screen.ts).
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
  - \`constant\` — fixed value (e.g. "TRUE", "T#5s", "T#30s") — NEVER raw integers for time values
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
                "description": "string",
                "deviceName": "string | null"
              }
            ]
          },
          "actions": [
            {
              "id": "string (unique)",
              "description": "string",
              "deviceName": "string | null"
            }
          ],
          "notes": "string"
        }
      ]
    }
  ],
  "notes": "string",
  "generatedAt": "string (ISO timestamp)"
}`;

/** System prompt: device wiring section only. */
export function buildDeviceLinkagePrompt(): string {
  return `You are a senior Siemens TIA Portal automation engineer generating the device wiring section of a Process Linkage Matrix.

Generate ONLY the deviceLinkage array — which FB each device uses, its instance DB name, how FB parameters wire to IO tags or global data, and interlocks between devices.

${MATRIX_RULES_COMMON}
- Interlocks must reference devices that exist in the device list
- Use EXACT parameter names from the FB Template Interfaces provided

## Output Format
Wrap the JSON in [DEVICE_LINKAGE]...[/DEVICE_LINKAGE] tags:
[DEVICE_LINKAGE]
{ ... }
[/DEVICE_LINKAGE]

Schema:
${DEVICE_LINKAGE_SCHEMA}`;
}

/** System prompt: process sequences + global data only. */
export function buildSequencesPrompt(): string {
  return `You are a senior Siemens TIA Portal automation engineer generating the process sequences and global data section of a Process Linkage Matrix.

Generate ONLY the processSequences array and globalData array — state-machine logic with permissives, safety conditions, step transitions, and shared data blocks.

${MATRIX_RULES_COMMON}
- Process sequences must include numbered steps starting at step 0 (idle)
- Step transitions use AND/OR combinator with explicit conditions
- Safety conditions are continuously monitored — failure stops the process
- generatedAt must be the current ISO timestamp
- Keep descriptions and notes concise (1 sentence max) — avoid verbose explanations

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
          const steps = seq.steps
            .map((st) => `      Step ${st.step_number}: ${st.action} → ${st.completion_criteria}`)
            .join("\n");
          const perms = seq.permissives.length > 0 ? `\n    Permissives: ${seq.permissives.join(", ")}` : "";
          return `  **${seq.name}** (${seq.subsystem})${perms}\n${steps}`;
        })
        .join("\n\n")
    : "  (none)";

  const interlocksText = specAnalysis?.interlocks?.length
    ? specAnalysis.interlocks
        .map((il) => `  - ${il.name}: ${il.condition} → affects: ${il.affected_devices.join(", ")}`)
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
