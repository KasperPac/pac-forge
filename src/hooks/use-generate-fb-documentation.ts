import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callNonStreaming } from "@/hooks/use-generation";
import { supabase } from "@/lib/supabase";
import type { FbTemplate } from "@/types/fb-template";

const FB_DOCUMENTATION_SYSTEM_PROMPT = `You are a PLC automation documentation writer for Siemens TIA Portal Function Blocks.

Write full technical documentation for a reusable FB template in a practical Open Library style. Be concrete and implementation-aware. Do not invent hidden features not supported by the code or source documentation.

Structure your response in this EXACT order:

## Overview
- What the block controls or models
- Typical use case
- Important operating modes or behaviors

## Interface Table
List every visible parameter in this format:
- INPUT: Name (Type) - purpose and expected wiring/source
- OUTPUT: Name (Type) - meaning and downstream usage
- IN_OUT: Name (Type) - ownership and external binding
- STATIC: Name (Type) - only if clearly relevant from the source

## Companion UDTs
- Name each UDT and explain its role
- List notable fields with types when they are visible from the source

## Mode Control
- Explain Auto / Manual / Stop / Independent or equivalent mode behavior when present
- If no explicit mode control exists, say so

## Wiring Examples
- Give concise, practical wiring notes for sensors, actuators, interlocks, feedbacks, and HMI bindings
- Include any required enable, permissive, alarm, or command signals

## HMI Faceplate Interface
- Explain which tags or UDT members should be exposed to HMI
- Mention status, command, alarm, mode, and indication bindings if present

## Status Codes And Alarms
- Summarize any visible status bits, alarms, warnings, fault outputs, or numeric status codes
- If none are visible, state that the source does not expose explicit status codes

## Integration Notes
- Dependencies on other FBs, FCs, DBs, or UDTs
- Any commissioning or configuration notes that matter during integration`;

export async function generateFbDocumentationText(template: {
  name: string;
  device_category: string;
  tags: string[];
  description?: string | null;
  ai_summary?: string | null;
  documentation?: string | null;
  blocks?: Array<{ block_type: string; block_name: string; scl_code: string }>;
}, signal?: AbortSignal): Promise<string | null> {
  const code = (template.blocks ?? [])
    .filter((block) => block.scl_code.trim())
    .map((block) => `// ${block.block_type}: ${block.block_name}\n${block.scl_code}`)
    .join("\n\n");

  const existingDocs = template.documentation?.trim()
    ? `\n\nExisting Documentation / Notes:\n${template.documentation.slice(0, 7000)}`
    : "";
  const summary = template.ai_summary?.trim()
    ? `\n\nExisting AI Summary:\n${template.ai_summary.slice(0, 4000)}`
    : "";
  const description = template.description?.trim()
    ? `\n\nTemplate Description:\n${template.description}`
    : "";

  if (!code && !existingDocs && !summary && !description) return null;

  const abort = signal ?? new AbortController().signal;
  const { content } = await callNonStreaming(
    FB_DOCUMENTATION_SYSTEM_PROMPT,
    [
      {
        role: "user",
        content: `Template: "${template.name}"\nCategory: ${template.device_category}\nTags: ${template.tags.join(", ") || "none"}${description}${summary}\n\nSource Blocks:\n${code || "(No SCL source available)" }${existingDocs}`,
      },
    ],
    abort,
    3072,
    {
      agent_role: "pattern_librarian",
      pipeline_step: "fb_documentation",
      generation_mode: "agentic",
      artifact_type: "fb_template_docs",
      function_name: "forge.fb_template.documentation",
      call_role: "primary",
    },
  );

  return content.trim() || null;
}

export function useGenerateFbDocumentation() {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const generate = useCallback(
    async (template: FbTemplate): Promise<string | null> => {
      setLoadingId(template.id);
      try {
        const documentation = await generateFbDocumentationText(template);
        if (!documentation) return null;

        const { error } = await supabase
          .from("fb_templates")
          .update({ documentation })
          .eq("id", template.id);
        if (error) throw error;

        queryClient.invalidateQueries({ queryKey: ["fb-templates"] });
        return documentation;
      } catch (err) {
        console.error(`[fb-documentation] Generation failed for "${template.name}":`, err);
        return null;
      } finally {
        setLoadingId(null);
      }
    },
    [queryClient],
  );

  return { generate, loadingId };
}
