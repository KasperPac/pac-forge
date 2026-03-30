import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callNonStreaming } from "@/hooks/use-generation";
import { supabase } from "@/lib/supabase";
import type { FbTemplate } from "@/types/fb-template";

const FB_SUMMARY_SYSTEM_PROMPT = `You are a PLC automation expert documenting Function Block templates for Siemens TIA Portal.

Generate a structured AI summary for this FB template. The summary serves TWO audiences:
- A Project Manager agent that needs to MATCH this template to the right device type (reads the first section only)
- A Code Architect agent that needs to WIRE the FB correctly (reads the full summary)

Structure your response in this EXACT order:

## SECTION 1 — MATCHING KEYWORDS (PM reads this)
Write 2-3 sentences front-loaded with device-matching keywords. Include:
- Exact device types this FB handles (e.g. "DOL motor", "reversing motor", "solenoid valve 2-position", "4-20mA pressure transmitter", "proximity sensor NO/NC")
- Signal types: how many discrete inputs/outputs, analog inputs/outputs
- What makes this FB different from similar FBs in the same category (e.g. "reversing motor with forward/reverse contactors" vs "DOL motor with single contactor")
- Key capabilities in searchable terms: "interlock", "E-stop", "HMI faceplate", "mode control", "manual override", "alarm", "scaling", "filtering"

## SECTION 2 — INTERFACE TABLE (Code Architect reads this)
List EVERY parameter:
INPUTS: paramName (Type) [required/optional] — description
OUTPUTS: paramName (Type) — description
IN_OUT: paramName (Type) — description

## SECTION 3 — COMPANION UDTs
If the FB uses UDT parameters (especially for HMI), name the UDT and list its fields with types.

## SECTION 4 — WIRING NOTES
- Mode control: if uses integer mode input (0=Stop, 1=Auto, 2=Manual, 10=Independent), state this
- Required connections: which inputs MUST be wired for the block to function
- HMI binding: how the HMI UDT connects to faceplate
- Dependencies: other FBs or UDTs that must be present`;

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
        if (!summary) {
          console.warn(`[fb-summary] No content to summarize for "${template.name}" — blocks: ${template.blocks?.length ?? 0}, docs: ${template.documentation ? template.documentation.length + " chars" : "none"}`);
          return null;
        }

        const { error } = await supabase
          .from("fb_templates")
          .update({ ai_summary: summary })
          .eq("id", template.id);

        if (error) throw error;

        queryClient.invalidateQueries({ queryKey: ["fb-templates"] });
        return summary;
      } catch (err) {
        console.error(`[fb-summary] Generation failed for "${template.name}":`, err);
        return null;
      } finally {
        setLoadingId(null);
      }
    },
    [queryClient],
  );

  return { generate, loadingId };
}
