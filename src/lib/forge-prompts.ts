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
// TASK 4: Spec analysis prompt
// ---------------------------------------------------------------------------

/**
 * System prompt for the PM agent to extract structured data from a functional spec.
 * Call with callNonStreaming(), max_tokens: 16384.
 */
export function buildSpecAnalysisPrompt(): string {
  return `You are a senior automation engineer with deep experience in Siemens TIA Portal projects.
Your task is to read a functional specification document and extract structured project data as JSON.

Rules:
- Extract ALL devices, including those listed in instrumentation tables or IO schedules.
- Assign a unique device_type that represents the physical device category (e.g. "Motor DOL", "Motor VFD", "Solenoid 2-pos", "Pneumatic Cylinder", "Photoelectric Sensor", "Proximity Sensor", "Temperature Sensor", "Pressure Sensor", "Flow Meter", "Valve Motorised", "Valve Pneumatic").
- Extract ALL IO signals for each device. DI = digital input, DQ = digital output (coil), AI = analog input, AQ = analog output.
- Extract ALL process sequences with numbered steps, actions, and completion criteria.
- Extract alarms and interlocks where described.
- The spec may contain Italian terminology — translate to English for all output fields.
- Markdown tables (from mammoth/pandoc conversion) represent data tables — parse them carefully.
- If a field cannot be determined from the spec, use an empty string or empty array.
- Do NOT invent data that isn't in the spec.

Return ONLY valid JSON matching this schema exactly (no markdown fences, no explanation):
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

  const templateSection = fbTemplate
    ? `## FB Library Template\nUse this existing FB as the base — adapt it to the device's specific IO signals and configuration:\n\`\`\`scl\n${fbTemplate.blocks?.[0]?.scl_code ?? ""}\n\`\`\``
    : `## FB Library Template\nNo matching template found. Generate a complete FB from scratch following the platform rules below.`;

  const patternSection = formatPatterns(patterns ?? []);
  const profileSection = formatProfile(profile);

  return `You are a senior Siemens TIA Portal SCL programmer generating a Function Block for a single industrial device.

${profileSection}

## Platform Rules
${platformRules}

${templateSection}

${patternSection}

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
  const { profile, platformRules } = context;
  const profileSection = formatProfile(profile);

  return `You are a Siemens TIA Portal LAD (Ladder Logic) programmer generating ladder rungs for a single device.

${profileSection}

## Platform Rules
${platformRules}

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
 */
export function buildIoLinkingPrompt(
  devices: ForgeDeviceEntry[],
  ioList: ForgeIoEntry[],
  context: DeviceGenContext,
): string {
  const { profile, platformRules, patterns } = context;
  const profileSection = formatProfile(profile);
  const patternSection = formatPatterns(patterns ?? []);

  const deviceNames = devices.map((d) => `  - ${d.name} (tag: ${d.tag})`).join("\n");
  const ioEntries = ioList
    .map((io) => `  - ${io.tag_name} (${io.signal_type}, ${io.data_type}): ${io.description}`)
    .join("\n");

  return `You are generating an IO linking Function (FC) that maps physical IO tag values to FB instance inputs/outputs.

${profileSection}

## Platform Rules
${platformRules}

${patternSection}

## Devices
${deviceNames}

## IO List
${ioEntries}

## Output Format
Generate a single FC in SCL. The FC reads physical IO tags and writes them to the instance DBs of each device FB.
Use the format:
\`\`\`scl [FC:IoLinking]
// code
\`\`\``;
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

## Code Structure Requirements
- Use CASE-based state machines for sequences (step variable, CASE step OF ... END_CASE)
- Each step has a clear entry action, hold condition, and exit transition
- Include ELSE branch for undefined states
- Use REGION blocks to organise sections
- Declare step variable as INT in static variables
- Use PLCopen-style enable/execute + busy/done/error outputs

## Output Format
\`\`\`scl [FC:ProcessName]
// code
\`\`\`

Generate one FC per process sequence.`;
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
 * System prompt for generating process/sequence code in LAD (sequential ladder).
 */
export function buildProcessLadPrompt(context: ProcessGenContext): string {
  const { profile, platformRules } = context;
  const profileSection = formatProfile(profile);

  return `You are generating sequential ladder logic for a process sequence using Siemens TIA Portal LAD format.

${profileSection}

## Platform Rules
${platformRules}

## Device FB Interfaces
${context.deviceFbInterfaces || "(no device FBs)"}

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
Return ONLY a JSON array of HmiScreenSpec objects. No markdown fences, no explanation.`;
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
