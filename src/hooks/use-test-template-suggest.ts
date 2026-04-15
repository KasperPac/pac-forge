import { useState, useCallback } from "react";
import { callStreamingCollect } from "@/hooks/use-generation";
import type { PlcsimTestCase } from "@/types/plcsim-test";
import type { FbTemplate } from "@/types/fb-template";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestSuggestion {
  id: string;
  name: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Step 1: Suggest test names + descriptions (lightweight)
// ---------------------------------------------------------------------------

function buildSuggestListPrompt(fb: FbTemplate): { system: string; user: string } {
  const blocks = fb.blocks ?? [];
  const mainBlock = blocks.find((b) => b.block_type === "FB") ?? blocks[0];

  const system = `You are a PLC test engineer. Given an FB definition, suggest a list of test procedures that should be created for PLCSIM Advanced testing.

Return ONLY a JSON array of objects with "name" and "description" fields. Do NOT generate the full test steps — just the test names and what they verify.

Example:
[
  { "name": "{device:name} FB — Auto Run and Stop", "description": "Enable FB, set auto mode, verify output activates. Remove auto-run, verify output drops." },
  { "name": "{device:name} FB — Overload Fault Latch", "description": "Trigger overload input, verify fault latches and output drops. Reset fault and verify recovery." }
]

Use {device:name} in test names. Cover: basic operation, each operating mode, fault conditions, fault reset, interlocks, edge cases.
Return ONLY the JSON array.`;

  let user = `## FB: ${fb.name}\nCategory: ${fb.device_category}\n`;
  if (fb.description) user += `Description: ${fb.description}\n`;
  if (fb.ai_summary) user += `Summary: ${fb.ai_summary}\n`;
  if (mainBlock?.scl_code) {
    user += `\n## SCL Code\n\`\`\`scl\n${mainBlock.scl_code}\n\`\`\`\n`;
  }
  user += `\nSuggest test procedures for this FB.`;

  return { system, user };
}

// ---------------------------------------------------------------------------
// Step 2: Generate a single full test case from a suggestion
// ---------------------------------------------------------------------------

function buildGenerateOnePrompt(
  fb: FbTemplate,
  suggestion: TestSuggestion,
): { system: string; user: string } {
  const blocks = fb.blocks ?? [];
  const mainBlock = blocks.find((b) => b.block_type === "FB") ?? blocks[0];

  const system = `You are a PLC test engineer. Generate a single complete PLCSIM test procedure.

## Tag Placeholders (MANDATORY — use these, not concrete tag names)
- {instanceDb} — instance DB name (e.g., InstFAN01)
- {io:TAG_NAME} — physical IO tag from device signals
- {wiring:paramName} — connected DB path from device wiring
- {config:paramName} — config DB path
- {device:name} — device display name
- {device:tag} — device tag prefix

## Rules
- First step must set healthy preconditions
- Use the FB's actual parameter names in {wiring:paramName} placeholders
- Keep descriptions short
- Include wait actions between writes and reads (200-500ms)

## Output Format
Return a single JSON object (NOT an array):
{
  "name": "string",
  "description": "string",
  "category": "device_fb",
  "steps": [
    {
      "stepNumber": 1,
      "description": "string",
      "actions": [
        { "type": "write|read|wait", "tag": "string", "value": "...", "dataType": "Bool|Int|Real|Word|Time", "description": "string" }
      ]
    }
  ]
}

Return ONLY the JSON object, no markdown fencing.`;

  let user = `## FB: ${fb.name}\nCategory: ${fb.device_category}\n`;
  if (mainBlock?.scl_code) {
    user += `\n## SCL Code\n\`\`\`scl\n${mainBlock.scl_code}\n\`\`\`\n`;
  }
  user += `\n## Test to Generate\nName: ${suggestion.name}\nDescription: ${suggestion.description}\n\nGenerate the complete test procedure.`;

  return { system, user };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTestTemplateSuggest() {
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Step 1: Get lightweight list of suggested test names */
  const suggest = useCallback(
    async (fb: FbTemplate): Promise<TestSuggestion[]> => {
      setLoading(true);
      setError(null);
      try {
        const { system, user } = buildSuggestListPrompt(fb);
        console.log("[test-template-suggest] Calling edge function...");
        const token = (await import("@/hooks/use-generation")).getAuthToken();
        const authToken = await token;
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`,
              apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
            },
            body: JSON.stringify({
              system_prompt: system,
              messages: [{ role: "user", content: user }],
              stream: false,
              max_tokens: 4096,
              promptlayer_metadata: {
                prompt_name: "forge-test-template-suggest",
                agent_role: "pm_test_generation",
                pipeline_step: "test_template_suggest",
              },
            }),
          },
        );
        if (!resp.ok) {
          const errText = await resp.text();
          throw new Error(`Edge function error (${resp.status}): ${errText}`);
        }
        const result = await resp.json();
        const content = result.content?.[0]?.text ?? result.text ?? "";
        console.log("[test-template-suggest] Raw response:", content.slice(0, 500));
        if (!content || !content.trim()) {
          throw new Error("AI returned an empty response. Try again.");
        }
        const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();
        const parsed = JSON.parse(cleaned);
        if (!Array.isArray(parsed)) throw new Error("Expected JSON array");
        return parsed.map((item: Record<string, unknown>, i: number) => ({
          id: `sug_${i}`,
          name: String(item.name ?? `Test ${i + 1}`),
          description: String(item.description ?? ""),
        }));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  /** Step 2: Generate full test case for a selected suggestion */
  const generateOne = useCallback(
    async (fb: FbTemplate, suggestion: TestSuggestion): Promise<PlcsimTestCase> => {
      setGenerating(true);
      setError(null);
      try {
        const { system, user } = buildGenerateOnePrompt(fb, suggestion);
        const { content } = await callStreamingCollect(
          system,
          [{ role: "user", content: user }],
          new AbortController().signal,
          16384,
          { prompt_name: "forge-test-template-suggest", agent_role: "pm_test_generation", pipeline_step: "test_template_generate" },
        );
        const cleaned = content.trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/, "").trim();
        const parsed = JSON.parse(cleaned) as Record<string, unknown>;
        return {
          id: crypto.randomUUID(),
          name: String(parsed.name ?? suggestion.name),
          sequenceName: null,
          category: "device_fb",
          description: String(parsed.description ?? suggestion.description),
          steps: Array.isArray(parsed.steps)
            ? parsed.steps.map((s: Record<string, unknown>, si: number) => ({
                id: crypto.randomUUID(),
                stepNumber: Number(s.stepNumber ?? si + 1),
                description: String(s.description ?? ""),
                actions: Array.isArray(s.actions)
                  ? s.actions.map((a: Record<string, unknown>) => ({
                      id: crypto.randomUUID(),
                      type: String(a.type ?? "write") as "write" | "read" | "wait",
                      tag: String(a.tag ?? ""),
                      value: a.value ?? "",
                      dataType: String(a.dataType ?? "Bool"),
                      tolerance: a.tolerance != null ? Number(a.tolerance) : undefined,
                      waitMs: a.waitMs != null ? Number(a.waitMs) : undefined,
                      description: String(a.description ?? ""),
                    }))
                  : [],
              }))
            : [],
          simRules: [],
          priority: 0,
          approved: false,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setGenerating(false);
      }
    },
    [],
  );

  return { suggest, generateOne, loading, generating, error };
}
