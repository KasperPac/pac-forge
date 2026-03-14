import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callNonStreaming } from "@/hooks/use-generation";
import { buildFbDiagramSystemPrompt, buildFbDiagramUserMessage } from "@/lib/forge-prompts";
import { supabase } from "@/lib/supabase";
import type { FbTemplate } from "@/types/fb-template";

/**
 * Remove orphan node definition lines — nodes Claude defined with a shape/label
 * but never wired into any edge. These appear as disconnected nodes at the top
 * of the Mermaid diagram.
 */
function removeOrphanNodes(chart: string): string {
  const lines = chart.split("\n");

  // Collect every node ID that appears in an edge line (-->  ---  -.->  ==>)
  const connectedIds = new Set<string>();
  const edgeLine = /--[->.]/;
  const tokenRe = /\b([a-zA-Z_]\w*)\b/g;

  for (const line of lines) {
    if (edgeLine.test(line)) {
      let m: RegExpExecArray | null;
      while ((m = tokenRe.exec(line)) !== null) {
        connectedIds.add(m[1]);
      }
      tokenRe.lastIndex = 0;
    }
  }

  // Drop lines that are standalone node definitions whose ID is never in an edge.
  // A standalone node def looks like:   nodeId["..."]  nodeId{...}  nodeId([...])
  // It does NOT contain --> or ---.
  const standaloneNodeDef = /^\s{2,}([a-zA-Z_]\w*)\s*[\[{(]/;

  return lines
    .filter((line) => {
      if (edgeLine.test(line)) return true; // keep all edge lines
      const m = line.match(standaloneNodeDef);
      if (m) return connectedIds.has(m[1]); // only keep if ID is connected
      return true; // keep classDef, class, %%, flowchart, blank lines etc.
    })
    .join("\n");
}

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

        // Strip any init directive Claude may have included, then prepend ours
        const stripped = content.trim().replace(/^%%\{.*?\}%%\s*/s, "");
        // Remove quotes Claude incorrectly places inside pipe edge labels: |"Yes"| → |Yes|
        const noQuotedEdges = stripped.replace(/\|"([^"]+)"\|/g, "|$1|");
        // Remove orphan node definitions that Claude generated but never connected
        const connected = removeOrphanNodes(noQuotedEdges);
        const chart = `%%{init: {'flowchart': {'curve': 'stepBefore'}} }%%\n${connected}`;

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
