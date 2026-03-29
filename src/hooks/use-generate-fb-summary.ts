import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callNonStreaming } from "@/hooks/use-generation";
import { supabase } from "@/lib/supabase";
import type { FbTemplate } from "@/types/fb-template";

const SYSTEM_PROMPT = `You are a PLC automation expert documenting Function Block templates for Siemens TIA Portal.

Generate a detailed AI summary for this FB template. The summary will be used by a Project Manager agent to match devices to the right template — so be specific and technical.

Your summary MUST cover:
1. What the block does (control logic, states, alarms, sequences)
2. What device types it is designed for (e.g. "DOL motor", "solenoid valve 2-position", "proximity sensor")
3. IO interface expectations: how many Bool inputs/outputs and analog inputs/outputs it handles
4. Key parameters and their purpose
5. Any special features (safety interlocks, HMI integration, timers, edge detection, etc.)

Write 3–6 sentences. Be specific. Focus on what makes this FB unique and exactly what devices it suits.`;

export function useGenerateFbSummary() {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const generate = useCallback(
    async (template: FbTemplate): Promise<string | null> => {
      const code = (template.blocks ?? [])
        .filter((b) => b.scl_code.trim())
        .map((b) => `// ${b.block_type}: ${b.block_name}\n${b.scl_code}`)
        .join("\n\n");

      // Use documentation if available (especially for library items with LAD code)
      const doc = template.documentation ? `\n\nManufacturer Documentation:\n${template.documentation.slice(0, 5000)}` : "";

      if (!code && !doc) return null;

      setLoadingId(template.id);
      try {
        const abort = new AbortController();
        const { content } = await callNonStreaming(
          SYSTEM_PROMPT,
          [
            {
              role: "user",
              content: `Template: "${template.name}" | Category: ${template.device_category} | Tags: ${template.tags.join(", ") || "none"}\n\n${code ? `SCL Code:\n${code}` : "(LAD library block — no SCL source)"}${doc}`,
            },
          ],
          abort.signal,
          512,
        );

        const summary = content.trim();

        const { error } = await supabase
          .from("fb_templates")
          .update({ ai_summary: summary })
          .eq("id", template.id);

        if (error) throw error;

        queryClient.invalidateQueries({ queryKey: ["fb-templates"] });
        return summary;
      } finally {
        setLoadingId(null);
      }
    },
    [queryClient],
  );

  return { generate, loadingId };
}
