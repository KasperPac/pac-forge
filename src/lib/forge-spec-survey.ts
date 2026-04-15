/**
 * forge-spec-survey.ts
 * Stage 1 of chunked spec analysis: survey the full spec and produce
 * a lightweight section map with extraction targets.
 */

import type { SpecSurveyResult } from "@/types/forge";

const SURVEY_SCHEMA = `{
  "project_name": "string",
  "project_description": "string (2-3 sentence summary)",
  "plc_type": "string (e.g. S7-1517F)",
  "plc_order_number": "string | null (MLFB if specified)",
  "hmi_type": "string (e.g. UNIFIED COMFORT, KTP900)",
  "safety_classification": "string | null (e.g. None, PLd Cat.3, SIL2)",
  "extraction_targets": [
    {
      "id": "string (T01, T02, ...)",
      "name": "string (human-readable: 'Fan Staging System', 'Conveyor Infeed')",
      "subsystem": "string (which logical subsystem)",
      "start_anchors": ["string (2-3 literal text strings from the spec that mark WHERE this section starts — use exact heading text, table titles, or unique phrases)"],
      "end_anchors": ["string (2-3 literal text strings that mark WHERE this section ends)"],
      "expected_device_count": "number (how many devices you expect to extract from this section)",
      "expected_sequences": ["string (names of process sequences in this section)"],
      "extraction_notes": "string (brief note on what to focus on when extracting this target)"
    }
  ],
  "cross_cutting_concerns": {
    "safety_systems": ["string (E-Stop circuits, safety relays, guard switches — shared across subsystems)"],
    "global_settings": ["string (configurable parameters that apply to multiple subsystems — thresholds, timeouts)"],
    "hmi_requirements": ["string (HMI screens, pages, or display requirements mentioned)"],
    "shared_interlocks": ["string (interlocks that span multiple subsystems)"]
  }
}`;

export function buildSurveySystemPrompt(): string {
  return `You are a senior automation engineer performing a STRUCTURAL SURVEY of a functional specification document.

Your job is NOT to extract detailed data. Your job is to READ THE ENTIRE DOCUMENT and produce a SECTION MAP that tells a downstream extraction AI exactly where to look for each piece of information.

## What You Must Do

1. **Identify all subsystems/logical groups** in the spec. Each becomes an extraction target.
   - A subsystem is a self-contained group of devices that work together (e.g., "Fan Cooling System", "Conveyor Infeed Section", "Packaging Station")
   - If the spec has clear section headings, use those as boundaries
   - If not, group by function/purpose

2. **For each extraction target**, provide:
   - **start_anchors**: 2-3 literal text strings copied EXACTLY from the spec that mark where this section begins. Use heading text, table titles, or unique phrases. These will be used for substring matching — they must appear verbatim in the document.
   - **end_anchors**: 2-3 literal text strings that mark where this section ends (typically the start of the next section)
   - **expected_device_count**: how many physical devices (motors, sensors, valves, buttons) you see in this section
   - **expected_sequences**: names of any process sequences described in this section
   - **extraction_notes**: what's important to capture — especially ANALOG THRESHOLDS, TEMPERATURE/PRESSURE/LEVEL CONDITIONS, STAGED OPERATIONS, and CONDITIONAL LOGIC

3. **Identify cross-cutting concerns** that span multiple subsystems:
   - Safety systems (E-Stop, safety relays)
   - Global configurable settings (thresholds, timeouts used by multiple subsystems)
   - HMI requirements
   - Shared interlocks

## Rules

- SCAN THE ENTIRE DOCUMENT. Do not stop after the first few sections.
- Prefer MORE extraction targets over fewer. A spec should have 5-15 targets, not 1-3.
- Each target should cover roughly 3-15 pages of spec content. NEVER create a target spanning more than 20 pages.
- If a section contains BOTH devices AND process sequences for ONE subsystem, keep them in ONE target.
- If process sequences span MULTIPLE subsystems or states, split them into SEPARATE targets (e.g. one target per state: "Idle State", "Starting Sequence", "Execute State", "E-Stop State"). NEVER bundle all sequences into a single target.
- Safety devices (E-Stop) that are shared across subsystems go in cross_cutting_concerns, but also include them in the extraction target where they're physically described.
- The anchors must be EXACT TEXT from the document — not paraphrased, not summarized.
- If the spec is in Italian, still use the original Italian text for anchors (they need to match the source).

## Output

Return JSON inside \`\`\`json fences matching this schema:
${SURVEY_SCHEMA}

Return ONLY the JSON. No commentary.`;
}

export function buildSurveyUserMessage(specText: string): string {
  return `<spec_document>
${specText}
</spec_document>

Survey this specification. Identify all subsystems, find their text boundaries, and produce the section map JSON.`;
}

export function validateSurveyResult(parsed: unknown): SpecSurveyResult {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Survey response is not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;

  const targets = Array.isArray(obj.extraction_targets)
    ? (obj.extraction_targets as Array<Record<string, unknown>>).map((t, i) => ({
        id: (t.id as string) ?? `T${String(i + 1).padStart(2, "0")}`,
        name: (t.name as string) ?? `Target ${i + 1}`,
        subsystem: (t.subsystem as string) ?? "",
        start_anchors: Array.isArray(t.start_anchors) ? (t.start_anchors as string[]) : [],
        end_anchors: Array.isArray(t.end_anchors) ? (t.end_anchors as string[]) : [],
        expected_device_count: typeof t.expected_device_count === "number" ? t.expected_device_count : 0,
        expected_sequences: Array.isArray(t.expected_sequences) ? (t.expected_sequences as string[]) : [],
        extraction_notes: (t.extraction_notes as string) ?? "",
      }))
    : [];

  const cc = (obj.cross_cutting_concerns ?? {}) as Record<string, unknown>;

  return {
    project_name: (obj.project_name as string) ?? "",
    project_description: (obj.project_description as string) ?? "",
    plc_type: (obj.plc_type as string) ?? "",
    plc_order_number: (obj.plc_order_number as string) ?? null,
    hmi_type: (obj.hmi_type as string) ?? "",
    safety_classification: (obj.safety_classification as string) ?? null,
    extraction_targets: targets,
    cross_cutting_concerns: {
      safety_systems: Array.isArray(cc.safety_systems) ? (cc.safety_systems as string[]) : [],
      global_settings: Array.isArray(cc.global_settings) ? (cc.global_settings as string[]) : [],
      hmi_requirements: Array.isArray(cc.hmi_requirements) ? (cc.hmi_requirements as string[]) : [],
      shared_interlocks: Array.isArray(cc.shared_interlocks) ? (cc.shared_interlocks as string[]) : [],
    },
  };
}
