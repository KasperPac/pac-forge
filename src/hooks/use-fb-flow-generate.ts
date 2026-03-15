import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callNonStreaming } from "@/hooks/use-generation";
import {
  buildFbFlowSystemPrompt,
  buildFbFlowUserMessage,
} from "@/lib/forge-prompts";
import { supabase } from "@/lib/supabase";
import type { FbTemplate } from "@/types/fb-template";
import type { FbFlowDiagram } from "@/lib/fb-flow-diagram";

/**
 * Parse [FLOW_DIAGRAM]...[/FLOW_DIAGRAM] from the AI response.
 * Returns null if the tag is missing or JSON is invalid.
 */
export function parseFlowDiagramJson(content: string): FbFlowDiagram[] | null {
  const match = content.match(/\[FLOW_DIAGRAM\]([\s\S]*?)\[\/FLOW_DIAGRAM\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1].trim());
    if (!Array.isArray(parsed)) return null;
    return parsed as FbFlowDiagram[];
  } catch {
    return null;
  }
}

export function useGenerateFbFlow() {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const generate = useCallback(
    async (template: FbTemplate): Promise<FbFlowDiagram[] | null> => {
      const hasCode = (template.blocks ?? []).some((b) => b.scl_code.trim());
      if (!hasCode) return null;

      setLoadingId(template.id);
      try {
        const abort = new AbortController();
        const { content } = await callNonStreaming(
          buildFbFlowSystemPrompt(),
          [{ role: "user", content: buildFbFlowUserMessage(template) }],
          abort.signal,
          4096,
        );

        const diagrams = parseFlowDiagramJson(content);
        if (!diagrams) return null;

        const jsonStr = JSON.stringify(diagrams);
        const { error } = await supabase
          .from("fb_templates")
          .update({
            flow_diagram_json: jsonStr,
            flow_diagram_generated_at: new Date().toISOString(),
          })
          .eq("id", template.id);

        if (error) throw error;

        queryClient.invalidateQueries({ queryKey: ["fb-templates"] });
        return diagrams;
      } finally {
        setLoadingId(null);
      }
    },
    [queryClient],
  );

  return { generate, loadingId };
}
