import { useState, useCallback } from "react";
import { streamFromEdgeFunction } from "@/hooks/use-generation";
import {
  buildMatrixGenerationPrompt,
  buildMatrixGenerationUserMessage,
} from "@/lib/forge-prompts";
import type { ForgeDeviceEntry, ForgeIoEntry, SpecAnalysis } from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";
import type { ProcessLinkageMatrix } from "@/types/process-builder";

const MATRIX_MAX_TOKENS = 12288;

function parseMatrix(content: string): ProcessLinkageMatrix {
  const matrixMatch = content.match(
    /\[PROCESS_MATRIX\]\s*([\s\S]*?)\s*\[\/PROCESS_MATRIX\]/,
  );
  if (!matrixMatch) {
    throw new Error(
      "Response did not contain [PROCESS_MATRIX]...[/PROCESS_MATRIX] tags",
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(matrixMatch[1]);
  } catch {
    throw new Error(
      `Matrix JSON is invalid: ${matrixMatch[1].slice(0, 200)}…`,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Matrix response is not a JSON object");
  }

  return parsed as ProcessLinkageMatrix;
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
