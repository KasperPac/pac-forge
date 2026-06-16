/**
 * Hook for ISA-88 Process Model authoring.
 * Generates a product-centric Process Model from the confirmed physical hierarchy.
 */
import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import { useUpdateSpecProject } from "@/hooks/use-spec-projects";
import {
  buildProcessModelSystemPrompt,
  buildProcessModelOpeningMessage,
  extractJsonFromResponse,
} from "@/lib/spec-builder/fds-prompts";
import { ProcessModelSchema } from "@/types/spec-contract-v2";
import type { UnitConfig, ProcessModel } from "@/types/spec-builder";

interface UseProcessModelGenerateReturn {
  generate: (
    units: UnitConfig[],
    systemDescription: string | null,
    existingModel: ProcessModel | null,
    userMessage?: string,
  ) => Promise<ProcessModel>;
  loading: boolean;
  error: string | null;
}

export function useProcessModelGenerate(): UseProcessModelGenerateReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async (
      units: UnitConfig[],
      systemDescription: string | null,
      existingModel: ProcessModel | null,
      userMessage?: string,
    ): Promise<ProcessModel> => {
      setLoading(true);
      setError(null);

      try {
        const systemPrompt = buildProcessModelSystemPrompt(
          units,
          systemDescription,
          existingModel,
        );
        const user =
          userMessage ??
          buildProcessModelOpeningMessage(units, existingModel);

        const controller = new AbortController();
        const { content } = await callNonStreaming(
          systemPrompt,
          [{ role: "user", content: user }],
          controller.signal,
          8192,
          {
            prompt_name: "process-model",
            agent_role: "code_architect",
            pipeline_step: "process_model",
          },
        );

        const json = extractJsonFromResponse(content);
        if (!json) {
          throw new Error("AI response did not contain a valid JSON block");
        }

        const parsed = ProcessModelSchema.parse(json);
        return parsed;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Process Model generation failed";
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

/**
 * Hook for saving the Process Model to the spec_projects table.
 */
export function useSaveProcessModel() {
  const updateSpec = useUpdateSpecProject();

  return useCallback(
    async (specProjectId: string, model: ProcessModel | null) => {
      await updateSpec.mutateAsync({
        id: specProjectId,
        process_model: model,
      });
    },
    [updateSpec],
  );
}
