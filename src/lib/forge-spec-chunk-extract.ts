/**
 * forge-spec-chunk-extract.ts
 * Stage 2 of chunked spec analysis: per-chunk targeted extraction.
 * Each call extracts devices, sequences, alarms, settings for ONE subsystem.
 */

import type { PartialSpecAnalysis, SpecSurveyResult, SpecChunk } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";
import { SPEC_ANALYSIS_SCHEMA } from "@/lib/forge-prompts";
import { resolveSection } from "@/lib/prompt-defaults";

const PARTIAL_SCHEMA = `{
  "target_id": "string (the extraction target ID, e.g. T01)",
  "subsystems": [{ "name": "string", "description": "string" }],
  "assemblies": ${extractSubSchema(SPEC_ANALYSIS_SCHEMA, '"assemblies"')},
  "devices": ${extractSubSchema(SPEC_ANALYSIS_SCHEMA, '"devices"')},
  "process_sequences": ${extractSubSchema(SPEC_ANALYSIS_SCHEMA, '"process_sequences"')},
  "alarms": ${extractSubSchema(SPEC_ANALYSIS_SCHEMA, '"alarms"')},
  "interlocks": ${extractSubSchema(SPEC_ANALYSIS_SCHEMA, '"interlocks"')},
  "process_settings": ${extractSubSchema(SPEC_ANALYSIS_SCHEMA, '"process_settings"')},
  "hardware_rack": ${extractSubSchema(SPEC_ANALYSIS_SCHEMA, '"hardware_rack"')}
}`;

/** Extract a sub-array schema from the full schema by key name. */
function extractSubSchema(schema: string, key: string): string {
  const idx = schema.indexOf(key);
  if (idx === -1) return "[]";
  // Find the opening bracket after the key
  const afterKey = schema.indexOf("[", idx);
  if (afterKey === -1) return "[]";
  // Find matching close bracket
  let depth = 0;
  for (let i = afterKey; i < schema.length; i++) {
    if (schema[i] === "[") depth++;
    if (schema[i] === "]") depth--;
    if (depth === 0) return schema.substring(afterKey, i + 1);
  }
  return "[]";
}

export function buildChunkExtractionSystemPrompt(
  survey: SpecSurveyResult,
  targetId: string,
  fbTemplates?: FbTemplate[],
  promptSections?: Record<string, string>,
): string {
  const target = survey.extraction_targets.find((t) => t.id === targetId);
  const targetName = target?.name ?? targetId;
  const targetSubsystem = target?.subsystem ?? "";

  const instructions = resolveSection(promptSections, "forge_pm_spec_analysis", "instructions");

  const librarySection =
    fbTemplates && fbTemplates.length > 0
      ? `## FB Library (available Function Blocks)\n${fbTemplates.map((t) => `- **${t.name}** (${t.device_category ?? "general"})`).join("\n")}\n\n`
      : "";

  return `You are a senior automation engineer extracting structured data from a SECTION of a functional specification.

## Extraction Scope

You are extracting ONLY for: **${targetName}** (subsystem: ${targetSubsystem})
Target ID: ${targetId}

Do NOT extract devices, sequences, or alarms belonging to other subsystems. If you see references to devices from other systems, note them in the relevant sequence step's \`devices_involved\` or interlock's \`affected_devices\` but do NOT create device entries for them.

## Cross-Cutting Context

The full project has these subsystems: ${survey.extraction_targets.map((t) => t.name).join(", ")}

Safety systems shared across subsystems: ${survey.cross_cutting_concerns.safety_systems.join(", ") || "none identified"}
Global settings: ${survey.cross_cutting_concerns.global_settings.join(", ") || "none identified"}
Shared interlocks: ${survey.cross_cutting_concerns.shared_interlocks.join(", ") || "none identified"}

If any of these cross-cutting concerns are DESCRIBED in detail in your section, extract them. If they're only referenced briefly, skip them (another chunk will extract them).

${librarySection}

${instructions}

## Output Rules — CRITICAL

1. Keep ALL descriptions to ONE SHORT LINE (max 15 words). Do NOT copy spec text verbatim.
2. IO signal descriptions: just the function, e.g. "Run feedback" not "Motor M01 run feedback signal from contactor auxiliary contact"
3. Sequence step actions: one imperative verb phrase, e.g. "Start rinse pump" not a paragraph
4. Do NOT pad JSON with extra whitespace or empty lines

Return JSON inside \`\`\`json fences matching this schema:
${PARTIAL_SCHEMA}

Return ONLY the JSON. No commentary.`;
}

export function buildChunkExtractionUserMessage(chunk: SpecChunk): string {
  return `## Extraction Context
${chunk.contextPreamble}

## Spec Section to Extract
<spec_section>
${chunk.text}
</spec_section>

Extract devices, sequences, alarms, interlocks, settings, and hardware from this section. Return the JSON now.`;
}

export function validatePartialSpecAnalysis(
  parsed: unknown,
  targetId: string,
): PartialSpecAnalysis {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Chunk extraction response is not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;

  return {
    target_id: (obj.target_id as string) ?? targetId,
    subsystems: Array.isArray(obj.subsystems)
      ? (obj.subsystems as Array<{ name: string; description: string }>)
      : [],
    assemblies: Array.isArray(obj.assemblies)
      ? (obj.assemblies as Array<Record<string, unknown>>).map((a) => ({
          id: (a.id ?? "") as string,
          name: (a.name ?? a.tag ?? "") as string,
          tag: (a.tag ?? a.name ?? "") as string,
          assembly_type: (a.assembly_type ?? a.type ?? "") as string,
          description: (a.description ?? "") as string,
          subsystem: (a.subsystem ?? "") as string,
          device_ids: Array.isArray(a.device_ids) ? (a.device_ids as string[]) : [],
        }))
      : [],
    devices: Array.isArray(obj.devices)
      ? (obj.devices as Array<Record<string, unknown>>).map((d) => ({
          ...d,
          name: (d.name ?? d.tag ?? "") as string,
          tag: (d.tag ?? d.name ?? "") as string,
          io_signals: Array.isArray(d.io_signals)
            ? (d.io_signals as Array<Record<string, unknown>>).map((sig) => ({
                tag_name: (sig.tag_name ?? sig.signal_name ?? sig.name ?? "") as string,
                signal_type: (sig.signal_type ?? sig.type ?? "") as string,
                description: (sig.description ?? sig.desc ?? "") as string,
                signal_behaviour: (sig.signal_behaviour ?? sig.behaviour ?? "") as string,
                contact_type: (sig.contact_type ?? "") as string,
              }))
            : [],
        })) as unknown as PartialSpecAnalysis["devices"]
      : [],
    process_sequences: Array.isArray(obj.process_sequences)
      ? (obj.process_sequences as Array<Record<string, unknown>>).map((s) => ({
          ...s,
          steps: Array.isArray(s.steps)
            ? (s.steps as Array<Record<string, unknown>>).map((step) => ({
                ...step,
                trigger_condition: (step.trigger_condition ?? step.trigger ?? null) as string | null,
              }))
            : [],
          permissives: Array.isArray(s.permissives) ? s.permissives : [],
        })) as PartialSpecAnalysis["process_sequences"]
      : [],
    alarms: Array.isArray(obj.alarms)
      ? (obj.alarms as PartialSpecAnalysis["alarms"])
      : [],
    interlocks: Array.isArray(obj.interlocks)
      ? (obj.interlocks as PartialSpecAnalysis["interlocks"])
      : [],
    process_settings: Array.isArray(obj.process_settings)
      ? (obj.process_settings as PartialSpecAnalysis["process_settings"])
      : [],
    hardware_rack: Array.isArray(obj.hardware_rack)
      ? (obj.hardware_rack as PartialSpecAnalysis["hardware_rack"])
      : [],
  };
}
