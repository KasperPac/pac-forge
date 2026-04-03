import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { usePacStStore } from "@/stores/pac-st-store";
import { buildProcessPrompt } from "@/lib/process-prompt-builder";
import {
  streamFromEdgeFunction,
  processRawResponse,
} from "@/hooks/use-generation";
import type { GenerateInput, GenerateResult, PromptLayerMeta } from "@/hooks/use-generation";
import type { ProcessPromptInput } from "@/lib/process-prompt-builder";
import { getRelevantReferenceSections } from "@/lib/reference-lookup";
import { CODE_GEN_MAX_TOKENS } from "@/lib/pipeline";

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
      const { project, agents, approvedPatterns, fbTemplates, designProfile, agentKnowledgeDocs, promptSections, functionalDescription } = input;

      setError(null);
      clearStreaming();
      setIsStreaming(true);

      const abort = new AbortController();
      abortRef.current = abort;

      // Reference lookup from functional description
      let referenceSections;
      try {
        referenceSections = await getRelevantReferenceSections(
          functionalDescription,
          "generation_request",
          project.plc_brand,
          abort.signal,
          20,
          promptSections,
          "SCL",
        );
      } catch {
        // Non-fatal
      }

      const promptInput: ProcessPromptInput = {
        project,
        agents,
        designProfile,
        approvedPatterns,
        fbTemplates,
        agentKnowledgeDocs,
        functionalDescription,
        promptSections,
        referenceSections,
      };

      const { systemPrompt, messages } = buildProcessPrompt(promptInput);

      const fetchBody: Record<string, unknown> = {
        system_prompt: systemPrompt,
        messages,
        project_context: {
          project_id: project.id,
          session_id: input.sessionId,
        },
        generation_mode: "PROCESS_CODE",
        stream: true,
        max_tokens: CODE_GEN_MAX_TOKENS,
      };

      try {
        const processPlMeta: PromptLayerMeta = {
          agent_role: "code_architect",
          pipeline_step: "process_generate",
          session_id: input.sessionId,
          project_id: project.id,
          generation_mode: "PROCESS_CODE",
        };
        const fullContent = await streamFromEdgeFunction(
          fetchBody,
          abort.signal,
          appendStreamChunk,
          undefined,
          processPlMeta,
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
