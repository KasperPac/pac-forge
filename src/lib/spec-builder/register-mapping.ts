import { z } from "zod";
import { streamFromEdgeFunction } from "@/hooks/use-generation";
import {
  OperatingStateV2Schema,
  FaultRowSchema,
  ProcessModelSchema,
} from "@/types/spec-contract-v2";
import type { Hierarchy } from "@/types/spec-contract-v2";

/**
 * Response from the register-aware mapping pass. Structure (units/EMs/CMs/IO) is
 * NOT here — it is built deterministically from the register. The model only
 * binds requirements onto fixed EM ids and extracts machine-level behavior.
 * States/faults/process_model are parsed leniently: a malformed secondary field
 * falls back to empty rather than failing the whole mapping.
 */
const MappingResponseSchema = z.object({
  unit_name: z.string().optional(),
  modules: z
    .array(
      z.object({
        equipment_module_id: z.string(),
        source_requirements: z.string(),
      }),
    )
    .default([]),
  states: z.array(OperatingStateV2Schema).default([]).catch([]),
  faults: z.array(FaultRowSchema).default([]).catch([]),
  process_model: ProcessModelSchema.nullable().default(null).catch(null),
});
export type MappingResponse = z.infer<typeof MappingResponseSchema>;

function stripFence(s: string): string {
  let c = s.trim().replace(/^[\s\S]*?```json\s*/i, "").replace(/```[\s\S]*$/, "").trim();
  if (!c.startsWith("{")) {
    const i = c.indexOf("{");
    if (i >= 0) c = c.slice(i);
  }
  return c;
}

/** Parse the model response and DROP any module id we did not provide. */
export function parseMappingResponse(
  raw: string,
  validIds: Set<string>,
): { mapping: MappingResponse; droppedIds: string[] } {
  const parsed = MappingResponseSchema.parse(JSON.parse(stripFence(raw)));
  const droppedIds: string[] = [];
  const modules = parsed.modules.filter((m) => {
    const ok = validIds.has(m.equipment_module_id);
    if (!ok) droppedIds.push(m.equipment_module_id);
    return ok;
  });
  return { mapping: { ...parsed, modules }, droppedIds };
}

export function buildMappingPrompt(hierarchy: Hierarchy, docText: string): { system: string; user: string } {
  const emList = hierarchy.units
    .flatMap((u) =>
      u.equipment_modules.map((em) => {
        const cms = em.control_modules
          .map(
            (cm) =>
              `    - ${cm.control_module_name} [${cm.control_module_class}] tags: ${cm.io_signals
                .map((s) => s.tag)
                .join(", ")}`,
          )
          .join("\n");
        return `  equipment_module_id "${em.equipment_module_id}" — ${em.equipment_module_name}\n${cms}`;
      }),
    )
    .join("\n");

  const system = `You map an industrial functional specification onto an EXISTING, FIXED equipment hierarchy.
RULES:
- The equipment modules and their ids below are FIXED. You MUST NOT invent modules, control modules, tags, or ids.
- For each equipment_module_id, extract the requirements from the document relevant to THAT module. Use the control-module names and tag codes (CM=contactor/motor, VSD=variable speed drive, BR=brake resistor, SR=safety relay, MS=maintenance switch, M#=motor) to decide what belongs where.
- Also extract machine-level operating states, faults, and (if present) a process_model, plus a suggested unit_name.
- Return ONLY JSON: { "unit_name": string, "modules": [{ "equipment_module_id": <one of the ids above>, "source_requirements": string }], "states": [...], "faults": [...], "process_model": null | {...} }.`;

  const user = `FIXED EQUIPMENT HIERARCHY:\n${emList}\n\n--- FUNCTIONAL SPECIFICATION ---\n${docText}\n--- END ---`;
  return { system, user };
}

const MAPPING_MODEL = "claude-opus-4-8";
const MAPPING_MAX_TOKENS = 16384;

export async function runRegisterMappingPass(
  hierarchy: Hierarchy,
  docText: string,
  abortSignal: AbortSignal,
): Promise<{ mapping: MappingResponse; droppedIds: string[] }> {
  const validIds = new Set(
    hierarchy.units.flatMap((u) => u.equipment_modules.map((em) => em.equipment_module_id)),
  );
  const { system, user } = buildMappingPrompt(hierarchy, docText);
  const content = await streamFromEdgeFunction(
    { system_prompt: system, messages: [{ role: "user", content: user }], stream: true, model: MAPPING_MODEL },
    abortSignal,
    () => {},
    MAPPING_MAX_TOKENS,
    { prompt_name: "spec-register-mapping", agent_role: "spec_analysis", pipeline_step: "spec_ingest" },
  );
  return parseMappingResponse(content, validIds);
}
