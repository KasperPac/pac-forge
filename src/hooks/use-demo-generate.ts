import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { parseArtifacts } from "@/lib/artifact-parser";
import { PLATFORM_RULES } from "@/lib/platform-rules";
import { formatPatterns } from "@/lib/prompt-builder";
import type { ParsedArtifact } from "@/lib/artifact-parser";
import type { PatternCandidate } from "@/types";

/** Fetch approved patterns directly from Supabase (no hook dependency). */
async function fetchApprovedPatterns(): Promise<PatternCandidate[]> {
  const { data, error } = await supabase
    .from("pattern_candidates")
    .select("*")
    .eq("status", "APPROVED")
    .eq("plc_brand", "SIEMENS_TIA");
  if (error) {
    console.warn("[demo-generate] Failed to fetch patterns:", error.message);
    return [];
  }
  return (data ?? []) as PatternCandidate[];
}

interface DemoGenerateResult {
  sources: Record<string, string>;
  importOrder: string[];
  artifacts: ParsedArtifact[];
  summary: string;
}

function buildDemoSystemPrompt(approvedPatterns?: PatternCandidate[]): string {
  const patternsSection =
    approvedPatterns && approvedPatterns.length > 0
      ? `\n\n## MANDATORY: Learned Corrections from Previous Compile Errors

The following corrections were learned from real TIA Portal compile failures. You MUST apply every one of these rules. Generating code that violates these rules will cause compile errors.

${formatPatterns(approvedPatterns)}`
      : "";

  return `You are Pac-ST, a deterministic PLC code generation assistant for Siemens TIA Portal.
Generate a complete, ready-to-import TIA Portal S7-1500 project based on the user's description.

${PLATFORM_RULES}${patternsSection}

## Output Format

Output each artifact as a separate delimited block:

\`\`\`scl filename="<name>.scl" type="<TYPE>" name="<Name>" dependencies="<dep1, dep2>"
<SCL code>
\`\`\`

Where:
- type: one of UDT, FB, FC, DB, OB
- name: the block name (e.g., "UDT_Motor", "FB_Motor", "Main")
- dependencies: comma-separated names this block depends on (empty if none)

Rules:
- Always include an OB named "Main" that instantiates and calls all FBs.
- Use UDTs for structured data types when appropriate.
- Keep it practical and concise (30-80 lines per block).
- Use CASE-based state machines with integer literals for states.
- Include IEC timers (TON/TOF) where timing is needed — always supply both IN and PT.
- Use # prefix for all instance variables in FBs.
- Set S7_Optimized_Access := 'TRUE' on all FBs.
- Provide a brief summary after all code blocks.`;
}

/**
 * Hook that calls the Edge Function to generate SCL from a text description,
 * then parses the response into sources + import order for the bridge.
 */
export function useDemoGenerate() {
  return useMutation({
    mutationFn: async (description: string): Promise<DemoGenerateResult> => {
      // Fetch patterns fresh every generation — no stale closure issues
      const approvedPatterns = await fetchApprovedPatterns();
      console.log("[demo-generate] approvedPatterns count:", approvedPatterns.length);
      if (approvedPatterns.length > 0) {
        console.log("[demo-generate] injecting patterns:", approvedPatterns.map(p => p.explanation_tag?.slice(0, 80)));
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Not authenticated — sign in first");

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: import.meta.env.VITE_SUPABASE_ANON_KEY as string,
          },
          body: JSON.stringify({
            system_prompt: buildDemoSystemPrompt(approvedPatterns),
            messages: [{ role: "user", content: description }],
            stream: false,
          }),
        }
      );

      if (!response.ok) {
        const body = await response.text();
        let detail: string;
        try {
          const parsed = JSON.parse(body) as Record<string, unknown>;
          detail =
            (parsed.error as string) ??
            (parsed.details as string) ??
            body;
        } catch {
          detail = body;
        }
        throw new Error(`Generation failed (${response.status}): ${detail}`);
      }

      const result = (await response.json()) as { content: string };
      const rawResponse = result.content;

      const { artifacts, summary, errors } = parseArtifacts(rawResponse);

      if (artifacts.length === 0) {
        throw new Error(
          `No artifacts parsed from response. Parse errors: ${errors.join("; ") || "none"}. Raw response may not contain valid SCL blocks.`
        );
      }

      // Build sources map and import order from parsed artifacts
      const sources: Record<string, string> = {};
      const importOrder: string[] = [];

      // Topological-ish ordering: UDTs first, then FBs/FCs, then DBs, then OBs
      const typeOrder: Record<string, number> = {
        UDT: 0,
        FB: 1,
        FC: 1,
        DB: 2,
        OB: 3,
        SCL_SOURCE: 1,
        TAG_TABLE: 4,
      };

      const sorted = [...artifacts].sort(
        (a, b) => (typeOrder[a.type] ?? 2) - (typeOrder[b.type] ?? 2)
      );

      for (const artifact of sorted) {
        sources[artifact.name] = artifact.content;
        importOrder.push(artifact.name);
      }

      return { sources, importOrder, artifacts, summary };
    },
  });
}
