import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callNonStreaming } from "@/hooks/use-generation";
import { buildFbDiagramSystemPrompt, buildFbDiagramUserMessage } from "@/lib/forge-prompts";
import { supabase } from "@/lib/supabase";
import type { FbTemplate } from "@/types/fb-template";

const CLASS_DEFS = `    classDef action fill:#0a3d35,stroke:#1D9E75,color:#e8e8e8
    classDef decision fill:#1a2030,stroke:#4A90E2,color:#7ab3f0
    classDef startEnd fill:#2a2a3e,stroke:#555,color:#e8e8e8
    classDef fault fill:#3a1515,stroke:#E24B4A,color:#e8e8e8
    classDef state fill:#1a2a3e,stroke:#4A90E2,color:#e8e8e8`;

const PREFIX_CLASS: Record<string, string> = {
  act_: "action",
  dec_: "decision",
  se_: "startEnd",
  flt_: "fault",
  st_: "state",
};

/**
 * Strip all classDef/class lines Claude emits and replace with deterministic
 * ones derived from node ID prefixes. Avoids truncated/malformed class lines.
 */
function applyColorClasses(chart: string): string {
  // Remove any existing classDef or class assignment lines
  const stripped = chart
    .split("\n")
    .filter((l) => !/^\s*(classDef|class )\s/.test(l))
    .join("\n");

  // Collect all node IDs from the chart
  const nodeIdRe = /\b([a-zA-Z_]\w*)\s*[\[{(]/g;
  const allIds = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = nodeIdRe.exec(stripped)) !== null) allIds.add(m[1]);

  // Group IDs by their prefix
  const groups: Record<string, string[]> = {};
  for (const id of allIds) {
    for (const prefix of Object.keys(PREFIX_CLASS)) {
      if (id.startsWith(prefix)) {
        const cls = PREFIX_CLASS[prefix];
        groups[cls] = groups[cls] ?? [];
        groups[cls].push(id);
        break;
      }
    }
  }

  const classLines = Object.entries(groups)
    .map(([cls, ids]) => `    class ${ids.join(",")} ${cls}`)
    .join("\n");

  return `${stripped}\n${CLASS_DEFS}${classLines ? "\n" + classLines : ""}`;
}

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
          2048,
        );

        // Strip any init directive Claude may have included, then prepend ours
        const stripped = content.trim().replace(/^%%\{.*?\}%%\s*/s, "");
        // Remove quotes Claude incorrectly places inside pipe edge labels: |"Yes"| → |Yes|
        const noQuotedEdges = stripped.replace(/\|"([^"]+)"\|/g, "|$1|");
        // Remove incomplete edge lines (truncated output — target node missing)
        const noIncomplete = noQuotedEdges
          .split("\n")
          .filter((line) => !/--[->.]+\s*(\|[^|]*\|)?\s*$/.test(line))
          .join("\n");
        // Remove orphan node definitions that Claude generated but never connected
        const connected = removeOrphanNodes(noIncomplete);
        // Strip Claude's classDef/class lines and re-apply from node ID prefixes
        const colored = applyColorClasses(connected);
        const chart = `%%{init: {'flowchart': {'curve': 'stepBefore'}} }%%\n${colored}`;

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
