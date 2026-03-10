/**
 * Hook for AI ladder logic generation (text and image input).
 */

import { useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { buildLadSystemPrompt } from "@/lib/lad-prompt-builder";
import type { LadProgram } from "@/types/lad";

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

export function useLadGenerate(): UseLadGenerateReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (prompt: string): Promise<LadProgram | null> => {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("generate", {
        body: {
          system_prompt: buildLadSystemPrompt(),
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
  }, []);

  const generateFromImage = useCallback(
    async (imageBase64: string, prompt?: string): Promise<LadProgram | null> => {
      setLoading(true);
      setError(null);

      try {
        const { data, error: fnError } = await supabase.functions.invoke("generate", {
          body: {
            system_prompt: buildLadSystemPrompt(),
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
    [],
  );

  return { generate, generateFromImage, loading, error };
}
