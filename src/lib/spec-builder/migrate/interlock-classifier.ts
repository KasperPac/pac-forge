import { z } from "zod";
import { callNonStreaming } from "@/hooks/use-generation";
import {
  CompletionCriterionSchema,
  InterEquipmentModuleInterlockEffectSchema,
  type CompletionCriterion,
  type InterEquipmentModuleInterlockEffect,
} from "@/types/spec-contract-v2";

export interface RawInterlock {
  interlock_id: string;
  source_equipment_module: string;
  target_equipment_module: string;
  prose_source_condition: string;
  prose_effect: string;
}

export interface ClassifiedInterlock {
  interlock_id: string;
  source_equipment_module: string;
  target_equipment_module: string;
  effect: InterEquipmentModuleInterlockEffect;
  source_condition: CompletionCriterion;
  confidence: number;
  reasoning: string;
}

const ResponseRowSchema = z.object({
  interlock_id: z.string().min(1),
  effect: InterEquipmentModuleInterlockEffectSchema,
  source_condition: CompletionCriterionSchema,
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});
const ResponseSchema = z.object({ rows: z.array(ResponseRowSchema) });

const SYSTEM_PROMPT = `You are classifying inter-equipment_module interlocks from a legacy FDS document into a structured V2 contract.

For EACH input row, output one entry in "rows" with:
- interlock_id: same as input
- effect: one of "hold" | "block_transition" | "trigger" | "enable" | "disable"
  - "hold": pause the target equipment_module's current state
  - "block_transition": prevent the target from leaving its current state
  - "trigger": force the target into a specific state
  - "enable": allow a transition that was previously blocked
  - "disable": forbid a transition that was previously allowed
- source_condition: a CompletionCriterion object, one of:
  - { "kind": "tag_equals", "tag": "<SCL_TAG>", "value": <boolean | number | string> }
  - { "kind": "tag_compare", "tag": "<SCL_TAG>", "operator": "<" | "<=" | ">" | ">=", "value": <number> }
  - { "kind": "expression", "expr": "<short SCL expression>" }
  - { "kind": "placeholder", "criterion_id": "<unique id>", "prompt": "<original prose>" }  -- when the input is too vague
- confidence: 0.0 to 1.0
- reasoning: one short sentence

Output STRICTLY valid JSON of shape { "rows": [...] }. No prose outside the JSON.`;

function buildUserPrompt(rows: RawInterlock[]): string {
  return [
    "Classify these interlocks:",
    "",
    ...rows.map((r, i) =>
      [
        `Row ${i + 1}:`,
        `  interlock_id: ${r.interlock_id}`,
        `  source_equipment_module: ${r.source_equipment_module}`,
        `  target_equipment_module: ${r.target_equipment_module}`,
        `  prose source_condition: ${r.prose_source_condition}`,
        `  prose effect: ${r.prose_effect}`,
      ].join("\n"),
    ),
  ].join("\n");
}

function fallbackRow(raw: RawInterlock, reason: string): ClassifiedInterlock {
  return {
    interlock_id: raw.interlock_id,
    source_equipment_module: raw.source_equipment_module,
    target_equipment_module: raw.target_equipment_module,
    effect: "hold",
    source_condition: {
      kind: "placeholder",
      criterion_id: `placeholder-${raw.interlock_id}`,
      prompt: raw.prose_source_condition,
    },
    confidence: 0,
    reasoning: `Classifier ${reason}. Engineer must review and fill in.`,
  };
}

/**
 * Single batch classification call. On any failure (network, invalid JSON,
 * schema mismatch), returns a per-row placeholder fallback so the wizard
 * can still proceed. The engineer fills in by hand for fallback rows.
 */
export async function classifyInterlocks(
  rawInterlocks: RawInterlock[],
): Promise<ClassifiedInterlock[]> {
  if (rawInterlocks.length === 0) return [];

  let responseText: string;
  try {
    const result = await callNonStreaming(
      SYSTEM_PROMPT,
      [{ role: "user", content: buildUserPrompt(rawInterlocks) }],
      new AbortController().signal,
      8192,
    );
    responseText = result.content;
  } catch (err) {
    return rawInterlocks.map((r) =>
      fallbackRow(r, `failed: ${err instanceof Error ? err.message : String(err)}`),
    );
  }

  // Strip code fences if Claude wrapped the JSON.
  const trimmed = responseText
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return rawInterlocks.map((r) => fallbackRow(r, "returned invalid JSON"));
  }

  const result = ResponseSchema.safeParse(parsed);
  if (!result.success) {
    return rawInterlocks.map((r) => fallbackRow(r, "returned schema-invalid output"));
  }

  // Match returned rows back to inputs by interlock_id. Inputs without a
  // matching response row get the fallback.
  const byId = new Map(result.data.rows.map((r) => [r.interlock_id, r]));
  return rawInterlocks.map((raw) => {
    const ai = byId.get(raw.interlock_id);
    if (!ai) return fallbackRow(raw, "omitted the row from its response");
    return {
      interlock_id: raw.interlock_id,
      source_equipment_module: raw.source_equipment_module,
      target_equipment_module: raw.target_equipment_module,
      effect: ai.effect,
      source_condition: ai.source_condition,
      confidence: ai.confidence,
      reasoning: ai.reasoning,
    };
  });
}
