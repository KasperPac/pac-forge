/**
 * Hook for AI ladder logic generation (text and image input).
 * Uses the Code Architect agent identity with reference library lookup.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { buildLadSystemPrompt } from "@/lib/lad-prompt-builder";
import { getRelevantReferenceSections } from "@/lib/reference-lookup";
import type { LadProgram } from "@/types/lad";
import type { AgentKnowledgeDoc } from "@/types";

interface UseLadGenerateOptions {
  agentKnowledgeDocs?: AgentKnowledgeDoc[];
  promptSections?: Record<string, string>;
}

interface UseLadGenerateReturn {
  generate: (prompt: string) => Promise<LadProgram | null>;
  generateFromImage: (imageBase64: string, prompt?: string) => Promise<LadProgram | null>;
  loading: boolean;
  error: string | null;
}

function parseLadResponse(content: string): LadProgram {
  // Extract JSON from ```json fences
  const jsonMatch = content.match(/```json\s*([\s\S]*?)```/);
  const jsonStr = jsonMatch ? jsonMatch[1].trim() : content.trim();
  const parsed = JSON.parse(jsonStr) as LadProgram;

  // Validate required fields
  if (!parsed.name || !parsed.rungs || !Array.isArray(parsed.rungs)) {
    throw new Error("Invalid LAD program structure: missing name or rungs");
  }
  if (!parsed.id) parsed.id = `lad_${Date.now()}`;
  if (!parsed.blockType) parsed.blockType = "FB";
  if (!parsed.variables) parsed.variables = [];

  return parsed;
}

export function useLadGenerate(options?: UseLadGenerateOptions): UseLadGenerateReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { agentKnowledgeDocs, promptSections } = options ?? {};

  const generate = useCallback(async (prompt: string): Promise<LadProgram | null> => {
    setLoading(true);
    setError(null);

    try {
      // Look up relevant reference sections for this generation request
      let referenceSections;
      try {
        referenceSections = await getRelevantReferenceSections(
          prompt,
          "generation_request",
          "SIEMENS_TIA",
          new AbortController().signal,
          15,
          promptSections,
          "LAD",
        );
        if (referenceSections.length > 0) {
          console.log(`LAD reference lookup: ${referenceSections.length} section(s) retrieved`);
        }
      } catch {
        // Non-fatal — proceed without reference sections
      }

      const { data, error: fnError } = await supabase.functions.invoke("generate", {
        body: {
          system_prompt: buildLadSystemPrompt(agentKnowledgeDocs, referenceSections),
          messages: [{ role: "user", content: prompt }],
          max_tokens: 8192,
        },
      });

      if (fnError) throw new Error(fnError.message ?? "Generation failed");
      const content = data?.content ?? "";
      return parseLadResponse(content);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Generation failed";
      setError(msg);
      return null;
    } finally {
      setLoading(false);
    }
  }, [agentKnowledgeDocs, promptSections]);

  const generateFromImage = useCallback(
    async (imageBase64: string, prompt?: string): Promise<LadProgram | null> => {
      setLoading(true);
      setError(null);

      try {
        // Look up reference sections based on the optional text prompt
        let referenceSections;
        if (prompt) {
          try {
            referenceSections = await getRelevantReferenceSections(
              prompt,
              "generation_request",
              "SIEMENS_TIA",
              new AbortController().signal,
              15,
              promptSections,
              "LAD",
            );
            if (referenceSections.length > 0) {
              console.log(`LAD image reference lookup: ${referenceSections.length} section(s) retrieved`);
            }
          } catch {
            // Non-fatal
          }
        }

        const { data, error: fnError } = await supabase.functions.invoke("generate", {
          body: {
            system_prompt: buildLadSystemPrompt(agentKnowledgeDocs, referenceSections),
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: "image/png",
                      data: imageBase64,
                    },
                  },
                  {
                    type: "text",
                    text: prompt || "Analyze this ladder logic diagram and recreate it as a LadProgram JSON. Preserve all contacts, coils, timers, counters, and the series/parallel structure exactly.",
                  },
                ],
              },
            ],
            max_tokens: 8192,
          },
        });

        if (fnError) throw new Error(fnError.message ?? "Generation failed");
        const content = data?.content ?? "";
        return parseLadResponse(content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Image analysis failed";
        setError(msg);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [agentKnowledgeDocs, promptSections],
  );

  return { generate, generateFromImage, loading, error };
}
