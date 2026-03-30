import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callNonStreaming } from "@/hooks/use-generation";
import { supabase } from "@/lib/supabase";
import type { FbTemplate } from "@/types/fb-template";

const FB_SUMMARY_SYSTEM_PROMPT = `You are a PLC automation expert documenting Function Block templates for Siemens TIA Portal.

Generate a detailed AI summary for this FB template. The summary will be used by a Project Manager agent to match devices to the right template, AND by a Code Architect agent to understand exactly how to wire the FB.

Your summary MUST include:

1. **Purpose** (1-2 sentences): What the block does, what device types it suits.

2. **Interface Table** — list EVERY parameter with direction, type, required/optional, and what it does:
   INPUTS: paramName (Type) [required/optional] — description
   OUTPUTS: paramName (Type) — description
   IN_OUT: paramName (Type) — description

3. **Companion UDTs**: If the FB uses UDT parameters (especially for HMI), name the UDT and list its key fields.

4. **Mode control**: If the FB uses an integer mode input (0=Stop, 1=Auto, 2=Manual, 10=Independent), state this explicitly.

5. **Usage notes**: Any special wiring requirements (e.g. "E-Stop input must be wired for the block to operate", "HMI UDT is IN_OUT — must be wired to the same instance in HMI tags").

Be exhaustive on the interface — the Code Architect must know every parameter without guessing.`;

/**
 * Generate an AI summary for a single FB template.
 * Standalone function — can be called from hooks or during import.
 * Returns the summary text, or null if there's no content to summarize.
 */
export async function generateFbSummaryText(template: {
  name: string;
  device_category: string;
  tags: string[];
  blocks?: Array<{ block_type: string; block_name: string; scl_code: string }>;
  documentation?: string | null;
}, signal?: AbortSignal): Promise<string | null> {
  const code = (template.blocks ?? [])
    .filter((b) => b.scl_code.trim())
    .map((b) => `// ${b.block_type}: ${b.block_name}\n${b.scl_code}`)
    .join("\n\n");

  const doc = template.documentation ? `\n\nManufacturer Documentation:\n${template.documentation.slice(0, 5000)}` : "";

  if (!code && !doc) return null;

  const abort = signal ?? new AbortController().signal;
  const { content } = await callNonStreaming(
    FB_SUMMARY_SYSTEM_PROMPT,
    [
      {
        role: "user",
        content: `Template: "${template.name}" | Category: ${template.device_category} | Tags: ${template.tags.join(", ") || "none"}\n\n${code ? `SCL Code:\n${code}` : "(LAD library block — no SCL source)"}${doc}`,
      },
    ],
    abort,
    2048,
  );

  return content.trim() || null;
}

export function useGenerateFbSummary() {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const generate = useCallback(
    async (template: FbTemplate): Promise<string | null> => {
      setLoadingId(template.id);
      try {
        const summary = await generateFbSummaryText(template);
        if (!summary) return null;

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
