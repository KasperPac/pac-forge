import type { FbTemplate, IoEntry } from "@/types";
import { formatIoList } from "@/lib/prompt-builder";

export interface FbSelectionCandidate {
  id: string;
  name: string;
  category: string;
  description: string | null;
  blockNames: string[];
}

export interface FbSelectionResult {
  selected: string[];
  reasoning: string;
}

/**
 * Build the system prompt for the PM agent to select relevant FB templates.
 */
export function buildFbSelectionPrompt(
  candidates: FbSelectionCandidate[],
  ioList: IoEntry[],
): string {
  const candidateList = candidates
    .map(
      (c) =>
        `- ID: ${c.id}\n  Name: ${c.name}\n  Category: ${c.category}\n  Description: ${c.description ?? "(none)"}\n  Blocks: ${c.blockNames.join(", ") || "(none)"}`,
    )
    .join("\n\n");

  const ioSection =
    ioList.length > 0
      ? `## Project IO List\n${formatIoList(ioList)}`
      : "No IO list defined.";

  return `You are the Project Manager for a PLC code generation system.

Your task: analyze the user's generation request and the project's IO list, then select which company-standard FB templates are relevant and should be used during code generation.

## Available FB Templates

${candidateList}

${ioSection}

## Instructions

1. Read the user's message carefully to understand what they want to generate.
2. Cross-reference with the IO list to understand what devices/equipment are involved.
3. Select templates that match the devices, equipment types, or processes described.
4. Do NOT select templates that are clearly unrelated to the request.
5. If no templates are relevant, return an empty selection.

## Output Format

You MUST respond with ONLY a JSON object (no markdown fences, no explanation outside the JSON):

{
  "selected": ["id1", "id2"],
  "reasoning": "Brief explanation of why these templates were selected."
}

If no templates are relevant:

{
  "selected": [],
  "reasoning": "No templates match the requested functionality."
}`;
}

/**
 * Convert FbTemplate[] to the simplified candidate format for the selection prompt.
 */
export function templatesToCandidates(templates: FbTemplate[]): FbSelectionCandidate[] {
  return templates.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.device_category,
    description: t.description,
    blockNames: (t.blocks ?? []).map((b) => `${b.block_name} (${b.block_type})`),
  }));
}

/**
 * Parse the PM agent's response into a selection result.
 */
export function parseFbSelectionResponse(response: string): FbSelectionResult {
  // Try to extract JSON from the response (may be wrapped in markdown fences)
  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { selected: [], reasoning: "Failed to parse selection response." };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      selected: Array.isArray(parsed.selected) ? parsed.selected : [],
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };
  } catch {
    return { selected: [], reasoning: "Failed to parse selection response." };
  }
}
