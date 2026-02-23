import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePacStStore } from "@/stores/pac-st-store";
import { buildProcessPrompt } from "@/lib/process-prompt-builder";
import {
  streamFromEdgeFunction,
  processRawResponse,
} from "@/hooks/use-generation";
import type { GenerateInput, GenerateResult } from "@/hooks/use-generation";
import type { ProcessPromptInput } from "@/lib/process-prompt-builder";

const ARTIFACTS_KEY = ["artifacts"] as const;

export interface ProcessGenerateInput extends Omit<GenerateInput, "generationMode" | "userMessage" | "conversationHistory"> {
  functionalDescription: string;
}

export function useProcessGenerate() {
  const queryClient = useQueryClient();
  const { appendStreamChunk, clearStreaming } = usePacStStore();
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const generateProcess = useCallback(
    async (
      input: ProcessGenerateInput,
      callbacks?: {
        onSuccess?: (result: GenerateResult) => void;
        onError?: (error: Error) => void;
      },
    ) => {
      const { project, agents, approvedPatterns, fbTemplates, designProfile, functionalDescription } = input;

      const promptInput: ProcessPromptInput = {
        project,
        agents,
        designProfile,
        approvedPatterns,
        fbTemplates,
        functionalDescription,
      };

      const { systemPrompt, messages } = buildProcessPrompt(promptInput);

      const fetchBody = {
        system_prompt: systemPrompt,
        messages,
        project_context: {
          project_id: project.id,
          session_id: input.sessionId,
        },
        generation_mode: "PROCESS_CODE",
        stream: true,
      };

      setError(null);
      clearStreaming();
      setIsStreaming(true);

      const abort = new AbortController();
      abortRef.current = abort;

      try {
        const fullContent = await streamFromEdgeFunction(
          fetchBody,
          abort.signal,
          appendStreamChunk,
        );

        setIsStreaming(false);
        clearStreaming();

        // Reuse the shared post-processing pipeline
        // Build a GenerateInput-compatible object for processRawResponse
        const genInput: GenerateInput = {
          project,
          sessionId: input.sessionId,
          agents,
          generationMode: "PROCESS_CODE",
          userMessage: `[Process Code] Generated from functional description (${functionalDescription.length} chars)`,
          approvedPatterns,
          fbTemplates,
          designProfile,
        };

        const result = await processRawResponse(fullContent, genInput);

        queryClient.invalidateQueries({ queryKey: ARTIFACTS_KEY });
        queryClient.invalidateQueries({ queryKey: ["conversation-turns"] });
        queryClient.invalidateQueries({ queryKey: ["snapshots"] });

        callbacks?.onSuccess?.(result);
        return result;
      } catch (err) {
        setIsStreaming(false);
        clearStreaming();

        if (err instanceof DOMException && err.name === "AbortError") {
          return undefined;
        }

        const error = err instanceof Error ? err : new Error(String(err));
        setError(error);
        callbacks?.onError?.(error);
        return undefined;
      }
    },
    [queryClient, appendStreamChunk, clearStreaming],
  );

  const cancelProcess = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
    clearStreaming();
  }, [clearStreaming]);

  return { generateProcess, cancelProcess, isStreaming, error };
}
