import { useState, useCallback } from "react";
import { streamFromEdgeFunction } from "@/hooks/use-generation";
import {
  buildMatrixGenerationPrompt,
  buildMatrixGenerationUserMessage,
} from "@/lib/forge-prompts";
import type { ForgeDeviceEntry, ForgeIoEntry, SpecAnalysis } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";
import type { ProcessLinkageMatrix } from "@/types/process-builder";

const MATRIX_MAX_TOKENS = 24000;

function tryParseJson(text: string): ProcessLinkageMatrix | null {
  try {
    const parsed = JSON.parse(text.trim());
    if (typeof parsed === "object" && parsed !== null) return parsed as ProcessLinkageMatrix;
  } catch { /* fall through */ }
  return null;
}

function parseMatrix(content: string): ProcessLinkageMatrix {
  // 1. Try explicit [PROCESS_MATRIX] tags
  const tagMatch = content.match(
    /\[PROCESS_MATRIX\]\s*([\s\S]*?)\s*\[\/PROCESS_MATRIX\]/,
  );
  if (tagMatch) {
    const result = tryParseJson(tagMatch[1]);
    if (result) return result;
    throw new Error(`Matrix JSON is invalid: ${tagMatch[1].slice(0, 200)}…`);
  }

  // 2. Try fenced code block (```json ... ```)
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    const result = tryParseJson(fenceMatch[1]);
    if (result) return result;
  }

  // 3. Try to extract the outermost JSON object from the response
  const objStart = content.indexOf("{");
  const objEnd = content.lastIndexOf("}");
  if (objStart !== -1 && objEnd > objStart) {
    const result = tryParseJson(content.slice(objStart, objEnd + 1));
    if (result) return result;
  }

  throw new Error(
    "Could not parse matrix from response. Ensure the AI returned valid JSON.",
  );
}

/**
 * Hook to generate a ProcessLinkageMatrix from session data via the PM agent.
 */
export function useForgeMatrixGenerate() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async (
      devices: ForgeDeviceEntry[],
      ioList: ForgeIoEntry[],
      specAnalysis: SpecAnalysis | null,
      fbTemplates?: FbTemplate[],
    ): Promise<ProcessLinkageMatrix> => {
      setLoading(true);
      setError(null);

      const abort = new AbortController();

      try {
        const systemPrompt = buildMatrixGenerationPrompt();
        const userMessage = buildMatrixGenerationUserMessage(
          devices,
          ioList,
          specAnalysis,
          fbTemplates,
        );

        // Use streaming to avoid edge function memory limits on large responses
        const content = await streamFromEdgeFunction(
          {
            system_prompt: systemPrompt,
            messages: [{ role: "user", content: userMessage }],
            stream: true,
          },
          abort.signal,
          () => {}, // no incremental UI needed — we parse the full response
          MATRIX_MAX_TOKENS,
        );

        return parseMatrix(content);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  return { generate, loading, error };
}
