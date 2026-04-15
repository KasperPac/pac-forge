/**
 * instruction-lookup.ts
 *
 * Two-pass AI-powered instruction lookup.
 * Pass 1: AI analyses the generation context and returns which instruction names are needed.
 * Pass 2: Fetch only those specific instructions from the DB.
 *
 * Replaces the old category-based bulk injection which loaded 50+ instructions
 * when typically only 5-10 are actually needed.
 */

import { supabase } from "@/lib/supabase";
import { callNonStreaming } from "@/hooks/use-generation";
import { parseJsonResponse } from "@/lib/json-response";
import type { Instruction, InstructionPin } from "@/types";

// ---------------------------------------------------------------------------
// Pass 1: Extract needed instruction names from context
// ---------------------------------------------------------------------------

const EXTRACT_SYSTEM_PROMPT = `You are a PLC instruction analyst. Given a code generation request, identify which TIA Portal LAD instructions will be needed.

Return a JSON array of instruction name strings. Use the official Siemens instruction names:
- Bit logic: "NO_CONTACT", "NC_CONTACT", "OUTPUT_COIL", "SET_COIL", "RESET_COIL", "SR", "RS", "P_TRIG", "N_TRIG", "NOT"
- Timers: "TON", "TOF", "TP", "TONR"
- Counters: "CTU", "CTD", "CTUD"
- Comparators: "CMP_GT", "CMP_GE", "CMP_LT", "CMP_LE", "CMP_EQ", "CMP_NE"
- Math: "ADD", "SUB", "MUL", "DIV", "MOD", "NEG", "ABS", "MIN", "MAX"
- Move/Convert: "MOVE", "CONVERT", "NORM_X", "SCALE_X", "MUX", "SEL"
- Extended: "JUMP", "LABEL", "RET", "CALL", "O" (parallel branch)

Only include instructions that the generated code will actually USE. Be selective — 5-15 instructions is typical.
Return ONLY the JSON array, no explanation.`;

/**
 * Ask the AI which instructions are needed for a given generation context.
 */
export async function extractNeededInstructions(
  context: string,
  signal: AbortSignal,
): Promise<string[]> {
  try {
    const { content } = await callNonStreaming(
      EXTRACT_SYSTEM_PROMPT,
      [{ role: "user", content: `Identify the LAD instructions needed for this:\n\n${context.slice(0, 6000)}` }],
      signal,
      undefined,
      { pipeline_step: "instruction_lookup" },
    );

    const parsed = parseJsonResponse<unknown>(content);
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === "string").slice(0, 25);
    }

    // Fallback: extract quoted strings
    const matches = content.match(/"([^"]+)"/g);
    if (matches) {
      return matches.map((m) => m.replace(/"/g, "")).slice(0, 25);
    }

    return [];
  } catch (err) {
    console.warn("[instruction-lookup] Topic extraction failed:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Pass 2: Fetch matching instructions from DB
// ---------------------------------------------------------------------------

async function hydrateInstructionPins(instructions: Instruction[]): Promise<Instruction[]> {
  if (instructions.length === 0) return [];
  const ids = instructions.map((i) => i.id);
  const { data } = await supabase
    .from("instruction_pins")
    .select("*")
    .in("instruction_id", ids)
    .order("sort_order");

  const pinsMap = new Map<string, InstructionPin[]>();
  for (const p of (data ?? []) as InstructionPin[]) {
    const arr = pinsMap.get(p.instruction_id) ?? [];
    arr.push(p);
    pinsMap.set(p.instruction_id, arr);
  }

  return instructions.map((i) => ({
    ...i,
    pins: pinsMap.get(i.id) ?? [],
  }));
}

/**
 * Fetch specific instructions by name from the DB.
 * Falls back to category-based fetch if no matches found (safety net).
 */
export async function fetchInstructionsByName(
  names: string[],
  language: "LAD" | "SCL" = "LAD",
): Promise<Instruction[]> {
  if (names.length === 0) return [];

  // Fetch by name OR element_type OR simatic_part_name (AI might return any of these)
  const { data, error } = await supabase
    .from("instructions")
    .select("*")
    .in("programming_language", [language, "BOTH"])
    .or(
      `name.in.(${names.map(n => `"${n}"`).join(",")}),element_type.in.(${names.map(n => `"${n}"`).join(",")}),simatic_part_name.in.(${names.map(n => `"${n}"`).join(",")})`,
    )
    .order("sort_order");

  if (error) {
    console.warn("[instruction-lookup] DB fetch failed:", error.message);
    return [];
  }

  return hydrateInstructionPins(data as Instruction[]);
}

// ---------------------------------------------------------------------------
// Combined two-pass lookup
// ---------------------------------------------------------------------------

/**
 * Two-pass instruction lookup:
 * 1. AI analyses the context and returns needed instruction names
 * 2. Fetch those specific instructions from the DB with pins
 *
 * Falls back to category-based fetch if AI returns no results.
 */
export async function lookupInstructions(
  context: string,
  language: "LAD" | "SCL" = "LAD",
  signal?: AbortSignal,
  fallbackCategories?: string[],
): Promise<Instruction[]> {
  const abortSignal = signal ?? new AbortController().signal;

  // Pass 1: extract needed instruction names
  console.log("[instruction-lookup] Pass 1: extracting needed instructions...");
  const names = await extractNeededInstructions(context, abortSignal);
  console.log(`[instruction-lookup] AI identified ${names.length} instructions: ${names.join(", ")}`);

  if (names.length === 0 && fallbackCategories?.length) {
    // Fallback to category-based fetch
    console.log("[instruction-lookup] Falling back to category-based fetch");
    const { fetchInstructionsForPrompt } = await import("@/hooks/use-instructions");
    return fetchInstructionsForPrompt(language, fallbackCategories as import("@/types").InstructionCategory[]);
  }

  // Pass 2: fetch matching instructions
  const instructions = await fetchInstructionsByName(names, language);
  console.log(`[instruction-lookup] Pass 2: fetched ${instructions.length} instructions from DB`);

  // If very few matched, supplement with fallback
  if (instructions.length < 3 && fallbackCategories?.length) {
    console.log("[instruction-lookup] Too few matches, supplementing with category fallback");
    const { fetchInstructionsForPrompt } = await import("@/hooks/use-instructions");
    return fetchInstructionsForPrompt(language, fallbackCategories as import("@/types").InstructionCategory[]);
  }

  return instructions;
}
