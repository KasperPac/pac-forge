/**
 * Two-pass AI reference lookup: extracts relevant topics from context,
 * then searches the reference library for matching sections.
 */

import { supabase } from "@/lib/supabase";
import { callNonStreaming } from "@/hooks/use-generation";
import { resolveSection } from "@/lib/prompt-defaults";
import { parseJsonResponse } from "@/lib/json-response";
import type { ReferenceLibrarySection } from "@/types";

type ContextType = "generation_request" | "generated_code" | "compile_errors";
export type ProgrammingLanguage = "LAD" | "SCL" | "GENERAL";

const CONTEXT_LABELS: Record<ContextType, string> = {
  generation_request: "user's generation request",
  generated_code: "generated code",
  compile_errors: "compile errors and affected source code",
};

const LANGUAGE_LABELS: Record<ProgrammingLanguage, string> = {
  LAD: "LAD (ladder logic) topics — contacts, coils, timers, counters, parallel branches, networks",
  SCL: "SCL (Structured Control Language) topics — functions, function blocks, data types, instructions",
  GENERAL: "PLC programming topics",
};

/**
 * Use AI to extract relevant topic keywords from a context string.
 */
export async function extractRelevantTopics(
  context: string,
  contextType: ContextType,
  signal: AbortSignal,
  promptSections?: Record<string, string>,
  programmingLanguage: ProgrammingLanguage = "GENERAL",
): Promise<string[]> {
  const systemPrompt = resolveSection(promptSections, "shared", "reference_retrieval");
  const languageHint = LANGUAGE_LABELS[programmingLanguage];
  const userMessage = `Analyze this ${CONTEXT_LABELS[contextType]} and extract relevant ${languageHint}:\n\n${context.slice(0, 8000)}`;

  const { content } = await callNonStreaming(
    systemPrompt,
    [{ role: "user", content: userMessage }],
    signal,
    undefined,
    { pipeline_step: "reference_lookup" },
  );

  const parsed = parseJsonResponse<unknown>(content);
  if (Array.isArray(parsed)) {
    return parsed.filter((t): t is string => typeof t === "string").slice(0, 15);
  }

  // Fallback: extract quoted strings
  const matches = content.match(/"([^"]+)"/g);
  if (matches) {
    return matches.map((m) => m.replace(/"/g, "")).slice(0, 15);
  }

  return [];
}

/**
 * Search reference library sections using FTS + topic tag overlap.
 * Filters by programmingLanguage when provided (GENERAL docs always match).
 */
export async function searchReferenceSections(
  topics: string[],
  _plcBrand: string,
  maxSections = 20,
  programmingLanguage?: ProgrammingLanguage,
): Promise<ReferenceLibrarySection[]> {
  if (topics.length === 0) return [];

  const searchQuery = topics.join(" OR ");
  const languageFilter = programmingLanguage && programmingLanguage !== "GENERAL"
    ? programmingLanguage
    : null;

  const { data, error } = await supabase.rpc("search_reference_sections", {
    search_query: searchQuery,
    topic_list: topics,
    max_results: maxSections,
    language_filter: languageFilter,
  });

  if (error) {
    console.warn("Reference section search failed:", error);
    return [];
  }

  return (data ?? []) as ReferenceLibrarySection[];
}

/**
 * Convenience: extract topics from context, then search for matching sections.
 * Returns empty array on any failure (non-fatal).
 */
export async function getRelevantReferenceSections(
  context: string,
  contextType: ContextType,
  plcBrand: string,
  signal: AbortSignal,
  maxSections = 20,
  promptSections?: Record<string, string>,
  programmingLanguage: ProgrammingLanguage = "GENERAL",
): Promise<ReferenceLibrarySection[]> {
  try {
    const topics = await extractRelevantTopics(context, contextType, signal, promptSections, programmingLanguage);
    if (topics.length === 0) return [];
    return await searchReferenceSections(topics, plcBrand, maxSections, programmingLanguage);
  } catch (err) {
    console.warn("Reference lookup failed:", err);
    return [];
  }
}

/**
 * Format reference sections for injection into a prompt.
 */
export function formatReferenceSections(
  sections: ReferenceLibrarySection[],
  programmingLanguage: ProgrammingLanguage = "GENERAL",
): string {
  if (sections.length === 0) return "";

  const formatted = sections
    .map((s) => `### ${s.heading}\n${s.content}`)
    .join("\n\n---\n\n");

  const label = programmingLanguage === "LAD"
    ? "LAD Reference Documentation"
    : programmingLanguage === "SCL"
    ? "SCL Reference Documentation"
    : "Reference Documentation";

  return `## ${label}

The following reference sections were retrieved as relevant to this task. Use them as authoritative sources for syntax, instructions, and patterns.

${formatted}`;
}
