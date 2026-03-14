import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callNonStreaming } from "@/hooks/use-generation";
import { buildFbDiagramSystemPrompt, buildFbDiagramUserMessage } from "@/lib/forge-prompts";
import { supabase } from "@/lib/supabase";
import type { FbTemplate } from "@/types/fb-template";

export function useGenerateFbDiagram() {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const generate = useCallback(
    async (template: FbTemplate): Promise<string | null> => {
      const hasCode = (template.blocks ?? []).some((b) => b.scl_code.trim());
      if (!hasCode) return null;

      setLoadingId(template.id);
      try {
        const abort = new AbortController();
        const { content } = await callNonStreaming(
          buildFbDiagramSystemPrompt(),
          [{ role: "user", content: buildFbDiagramUserMessage(template) }],
          abort.signal,
          1024,
        );

        const chart = content.trim();

        const { error } = await supabase
          .from("fb_templates")
          .update({
            diagram_chart: chart,
            diagram_generated_at: new Date().toISOString(),
          })
          .eq("id", template.id);

        if (error) throw error;

        queryClient.invalidateQueries({ queryKey: ["fb-templates"] });
        return chart;
      } finally {
        setLoadingId(null);
      }
    },
    [queryClient],
  );

  return { generate, loadingId };
}
