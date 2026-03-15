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

  // Strip any markdown code fences the AI may have added inside the tags
  let jsonStr = match[1].trim();
  jsonStr = jsonStr.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();

  try {
    const parsed = JSON.parse(jsonStr);
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
          8192,
        );

        const diagrams = parseFlowDiagramJson(content);
        if (!diagrams) {
          console.error("[FbFlow] Failed to parse AI response. Raw content:", content.slice(0, 500));
          throw new Error("AI did not return valid [FLOW_DIAGRAM] JSON. Check console for raw response.");
        }

        const now = new Date().toISOString();
        const jsonStr = JSON.stringify(diagrams);
        const { error } = await supabase
          .from("fb_templates")
          .update({
            flow_diagram_json: jsonStr,
            flow_diagram_generated_at: now,
          })
          .eq("id", template.id);

        if (error) throw error;

        // Write directly into every matching cache entry so the data survives
        // navigation without depending on a background refetch completing first.
        queryClient.setQueriesData<FbTemplate[]>(
          { queryKey: ["fb-templates"] },
          (old) =>
            old?.map((t) =>
              t.id === template.id
                ? { ...t, flow_diagram_json: jsonStr, flow_diagram_generated_at: now }
                : t,
            ),
        );

        return diagrams;
      } finally {
        setLoadingId(null);
      }
    },
    [queryClient],
  );

  return { generate, loadingId };
}
