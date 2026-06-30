// src/hooks/use-generate-fb-interface.ts
// AI pre-fill of an FB interface contract's SEMANTIC layer. The SCL parser is
// authoritative for which pins exist; AI only annotates role/binding/exposed.
// Mirrors use-generate-fb-summary.ts (callNonStreaming + raw-column update).
import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callNonStreaming } from "@/hooks/use-generation";
import { supabase } from "@/lib/supabase";
import {
  parseFbInterface, interfacePins, type ParsedSclVar,
} from "@/lib/spec-builder/fb-interface";
import {
  FB_PIN_ROLES, FB_BINDING_SOURCES,
  type FbInterfaceContract, type FbInterfacePin, type FbPinRole, type FbBindingSource,
} from "@/types/fb-interface";
import type { FbTemplate } from "@/types/fb-template";

/** The semantic annotation the AI returns per pin. */
export interface AiPinAnnotation {
  name: string;
  role: FbPinRole;
  default_binding: FbBindingSource;
  exposed: boolean;
}

const ROLE_SET = new Set<string>(FB_PIN_ROLES);
const BINDING_SET = new Set<string>(FB_BINDING_SOURCES);

function defaultRole(direction: FbInterfacePin["direction"]): FbPinRole {
  return direction === "output" ? "status" : "sensor_in";
}
function defaultBinding(direction: FbInterfacePin["direction"]): FbBindingSource {
  return direction === "output" ? "io_output" : "io_input";
}

/**
 * Merge the SCL-authoritative pin list with AI annotations.
 * Pure + exported for unit testing. SCL pins win: AI-invented pins are dropped,
 * missing/invalid annotations fall back to direction-based defaults.
 */
export function buildContractFromAi(
  parsed: ParsedSclVar[],
  ai: AiPinAnnotation[],
  blockName: string,
): FbInterfaceContract {
  const byName = new Map(ai.map((a) => [a.name, a]));
  const pins: FbInterfacePin[] = interfacePins(parsed).map((p) => {
    const a = byName.get(p.name);
    const role = a && ROLE_SET.has(a.role) ? a.role : defaultRole(p.direction);
    const default_binding = a && BINDING_SET.has(a.default_binding) ? a.default_binding : defaultBinding(p.direction);
    return {
      name: p.name,
      scl_type: p.scl_type,
      direction: p.direction,
      role,
      default_binding,
      exposed: a?.exposed ?? false,
      description: p.description,
    };
  });
  return { block_name: blockName, pins, states: [], reviewed: false, generated_at: new Date().toISOString() };
}

const SYSTEM_PROMPT = `You classify the interface pins of a Siemens TIA Portal Function Block for an industrial automation contract. You are GENERIC across all machine types — never reference a specific device, project, or signal name in your reasoning.

For EACH pin you are given (name, type, direction, comment), assign:
- role: one of cmd | mode | param | interlock | sensor_in | actuator_out | status | fault
- default_binding: one of io_input | io_output | fb_output | hmi | em | param
- exposed: boolean — true if this OUTPUT is a meaningful signal another block/sequence would consume (e.g. "running", "fault", "at-position"); false for internal/diagnostic outputs and for all inputs.

Guidance (abstract, not device-specific):
- Command/start/stop/forward/reverse inputs → role cmd, binding hmi or em.
- Mode/auto/manual selection inputs → role mode, binding hmi.
- Setpoint/time/limit configuration inputs → role param, binding param.
- Permissive/enable/interlock inputs → role interlock, binding em.
- Feedback inputs (sensor/limit/position/measured) → role sensor_in, binding io_input.
- Physical actuation outputs (run/open/close/energize) → role actuator_out, binding io_output, exposed true.
- Ready/running/done/position outputs → role status, exposed true.
- Fault/alarm/error outputs → role fault, exposed true.

Return ONLY a JSON array, no prose:
[{ "name": "...", "role": "...", "default_binding": "...", "exposed": true }]`;

/** Pick the main FB block (first FB, else first block). */
function mainBlock(template: FbTemplate): { block_name: string; scl_code: string } | null {
  const fb = template.blocks?.find((b) => b.block_type === "FB") ?? template.blocks?.[0];
  return fb?.scl_code ? { block_name: fb.block_name, scl_code: fb.scl_code } : null;
}

function parseAiArray(content: string): AiPinAnnotation[] {
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is AiPinAnnotation =>
      !!x && typeof (x as AiPinAnnotation).name === "string");
  } catch {
    return [];
  }
}

/** Generate a contract for a template. Standalone — callable from import or hooks. */
export async function generateFbInterfaceContract(
  template: FbTemplate, signal?: AbortSignal,
): Promise<FbInterfaceContract | null> {
  const block = mainBlock(template);
  if (!block) return null;
  const parsed = parseFbInterface(block.scl_code);
  const pins = interfacePins(parsed);
  if (pins.length === 0) return null;

  const abort = signal ?? new AbortController().signal;
  const userContent = `FB block: ${block.block_name}\nPins:\n${pins
    .map((p) => `- ${p.name} (${p.scl_type}, ${p.direction})${p.description ? ` // ${p.description}` : ""}`)
    .join("\n")}`;

  const { content } = await callNonStreaming(SYSTEM_PROMPT, [{ role: "user", content: userContent }], abort, 2048);
  return buildContractFromAi(parsed, parseAiArray(content), block.block_name);
}

export function useGenerateFbInterface() {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const generate = useCallback(
    async (template: FbTemplate): Promise<FbInterfaceContract | null> => {
      setLoadingId(template.id);
      try {
        const contract = await generateFbInterfaceContract(template);
        if (!contract) {
          console.warn(`[fb-interface] No pins to extract for "${template.name}"`);
          return null;
        }
        const { error } = await supabase
          .from("fb_templates")
          .update({ interface_contract: contract })
          .eq("id", template.id);
        if (error) throw error;
        queryClient.invalidateQueries({ queryKey: ["fb-templates"] });
        return contract;
      } catch (err) {
        console.error(`[fb-interface] Generation failed for "${template.name}":`, err);
        return null;
      } finally {
        setLoadingId(null);
      }
    },
    [queryClient],
  );

  return { generate, loadingId };
}
