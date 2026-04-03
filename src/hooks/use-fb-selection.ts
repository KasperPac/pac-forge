import { useMutation } from "@tanstack/react-query";
import { callNonStreaming } from "@/hooks/use-generation";
import {
  buildFbSelectionPrompt,
  templatesToCandidates,
  parseFbSelectionResponse,
} from "@/lib/fb-selection-prompt";
import type { FbSelectionResult } from "@/lib/fb-selection-prompt";
import type { FbTemplate, IoEntry } from "@/types";

export interface FbSelectionInput {
  userMessage: string;
  ioList: IoEntry[];
  templates: FbTemplate[];
}

/**
 * AI-powered FB template selection. Calls the PM agent to analyze
 * the user's message + IO list and recommend relevant templates.
 */
export function useAiFbSelection() {
  return useMutation({
    mutationFn: async (input: FbSelectionInput): Promise<FbSelectionResult> => {
      const { userMessage, ioList, templates } = input;

      if (templates.length === 0) {
        return { selected: [], reasoning: "No templates available." };
      }

      const candidates = templatesToCandidates(templates);
      const systemPrompt = buildFbSelectionPrompt(candidates, ioList);

      const abort = new AbortController();
      // Auto-abort after 30 seconds
      const timeout = setTimeout(() => abort.abort(), 30_000);

      try {
        const { content } = await callNonStreaming(
          systemPrompt,
          [{ role: "user", content: userMessage }],
          abort.signal,
          undefined,
          { agent_role: "project_manager", pipeline_step: "fb_selection" },
        );
        return parseFbSelectionResponse(content);
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}
