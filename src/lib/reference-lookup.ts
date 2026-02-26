/**
 * Two-pass AI reference lookup: extracts relevant topics from context,
 * then searches the reference library for matching sections.
 */

import { supabase } from "@/lib/supabase";
import { callNonStreaming } from "@/hooks/use-generation";
import { resolveSection } from "@/lib/prompt-defaults";
import type { ReferenceLibrarySection } from "@/types";

type ContextType = "generation_request" | "generated_code" | "compile_errors";

const CONTEXT_LABELS: Record<ContextType, string> = {
  generation_request: "user's generation request",
  generated_code: "generated SCL code",
  compile_errors: "compile errors and affected source code",
};

/**
 * Use AI to extract relevant topic keywords from a context string.
 */
export async function extractRelevantTopics(
  context: string,
  contextType: ContextType,
  signal: AbortSignal,
  promptSections?: Record<string, string>,
): Promise<string[]> {
  const systemPrompt = resolveSection(promptSections, "shared", "reference_retrieval");
  const userMessage = `Analyze this ${CONTEXT_LABELS[contextType]} and extract relevant SCL topics:\n\n${context.slice(0, 8000)}`;

  const { content } = await callNonStreaming(
    systemPrompt,
    [{ role: "user", content: userMessage }],
    signal,
  );

  // Parse JSON array from response (handle markdown code fences)
  const jsonStr = content
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();

  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      return parsed.filter((t): t is string => typeof t === "string").slice(0, 15);
    }
  } catch {
    // Fallback: extract quoted strings
    const matches = content.match(/"([^"]+)"/g);
    if (matches) {
      return matches.map((m) => m.replace(/"/g, "")).slice(0, 15);
    }
  }

  return [];
}

/**
 * Search reference library sections using FTS + topic tag overlap.
 */
export async function searchReferenceSections(
  topics: string[],
  _plcBrand: string,
  maxSections = 20,
): Promise<ReferenceLibrarySection[]> {
  if (topics.length === 0) return [];

  // Build a search query from topics (join with OR for broader matching)
  const searchQuery = topics.join(" OR ");

  const { data, error } = await supabase.rpc("search_reference_sections", {
    search_query: searchQuery,
    topic_list: topics,
    max_results: maxSections,
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
): Promise<ReferenceLibrarySection[]> {
  try {
    const topics = await extractRelevantTopics(context, contextType, signal, promptSections);
    if (topics.length === 0) return [];
    return await searchReferenceSections(topics, plcBrand, maxSections);
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
): string {
  if (sections.length === 0) return "";

  const formatted = sections
    .map((s) => `### ${s.heading}\n${s.content}`)
    .join("\n\n---\n\n");

  return `## SCL Reference Documentation

The following reference sections were retrieved as relevant to this task. Use them as authoritative sources for syntax, instructions, and patterns.

${formatted}`;
}
