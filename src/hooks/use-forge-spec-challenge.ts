import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import { validateAndCall } from "@/lib/forge-pipeline-validator";
import type { SpecAnalysis } from "@/types/forge";

const CHALLENGE_MAX_TOKENS = 16384;

export interface SpecChallengeResult {
  missing_trigger_conditions: Array<{
    sequence_name: string;
    step_number: number;
    expected_condition: string;
    reasoning: string;
  }>;
  missing_process_settings: Array<{
    name: string;
    description: string;
    default_value: string;
    data_type: string;
    unit?: string | null;
  }>;
  missing_devices: Array<{
    name: string;
    tag: string;
    device_type: string;
    reasoning: string;
  }>;
  missing_alarms: Array<{
    name: string;
    trigger_condition: string;
    severity: string;
    reasoning: string;
  }>;
  missing_interlocks: Array<{
    name: string;
    condition: string;
    reasoning: string;
  }>;
  general_gaps: string[];
}

function buildChallengerSystemPrompt(): string {
  return `You are a senior automation engineer acting as an independent CHALLENGER.

You have been given:
1. The ORIGINAL functional specification text
2. A structured JSON extraction produced by another AI from that specification

Your SOLE JOB is to find what the extraction MISSED, got wrong, or under-specified. You are NOT re-doing the extraction — you are auditing it.

## Focus Areas (in priority order)

### 1. Missing Trigger Conditions (HIGHEST PRIORITY)
For each process sequence step, check: does the extraction capture WHAT CAUSES this step to activate?
- Analog thresholds: "start fan when temperature > 40°C" → trigger_condition must contain the threshold
- Conditional staging: "activate pump when level > 80%" → must be a trigger_condition
- If the spec describes temperature/pressure/level/flow-based staging or switching, EVERY threshold MUST appear as a trigger_condition on the corresponding step
- A sequence that should be driven by analog comparisons but only has digital signal conditions is a CRITICAL gap

### 2. Missing Process Settings
Configurable parameters mentioned in the spec (thresholds, setpoints, timeouts, hysteresis values) that were NOT captured in the process_settings array.

### 3. Missing Devices
Physical devices mentioned in the spec that were not extracted (sensors, actuators, operator devices).

### 4. Missing Alarms
Fault conditions described in the spec that have no corresponding alarm entry.

### 5. Missing Interlocks
Safety interlocks or permissives described in the spec with no extraction entry.

### 6. General Gaps
Any other important information in the spec that the extraction does not reflect.

## Output Format
Return JSON inside \`\`\`json fences matching this schema:
{
  "missing_trigger_conditions": [
    {
      "sequence_name": "string (which sequence)",
      "step_number": "number (which step is missing its trigger)",
      "expected_condition": "string (the condition from the spec — e.g. 'temperature > 45.0 °C')",
      "reasoning": "string (quote from the spec that supports this)"
    }
  ],
  "missing_process_settings": [
    {
      "name": "string",
      "description": "string",
      "default_value": "string",
      "data_type": "string",
      "unit": "string | null"
    }
  ],
  "missing_devices": [
    {
      "name": "string",
      "tag": "string",
      "device_type": "string",
      "reasoning": "string"
    }
  ],
  "missing_alarms": [
    {
      "name": "string",
      "trigger_condition": "string",
      "severity": "string",
      "reasoning": "string"
    }
  ],
  "missing_interlocks": [
    {
      "name": "string",
      "condition": "string",
      "reasoning": "string"
    }
  ],
  "general_gaps": ["string (brief description of each gap)"]
}

If nothing is missing, return empty arrays for all fields. Do NOT invent gaps that don't exist in the spec.
Return ONLY the JSON, no commentary.`;
}

function buildChallengerUserMessage(specText: string, extraction: SpecAnalysis): string {
  return `<original_spec>
${specText}
</original_spec>

<extraction_result>
${JSON.stringify(extraction, null, 2)}
</extraction_result>

Audit the extraction against the original spec. Find what was missed. Return the JSON now.`;
}

function validateChallengeResult(parsed: unknown): SpecChallengeResult {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Challenge response is not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  return {
    missing_trigger_conditions: Array.isArray(obj.missing_trigger_conditions)
      ? (obj.missing_trigger_conditions as SpecChallengeResult["missing_trigger_conditions"])
      : [],
    missing_process_settings: Array.isArray(obj.missing_process_settings)
      ? (obj.missing_process_settings as SpecChallengeResult["missing_process_settings"])
      : [],
    missing_devices: Array.isArray(obj.missing_devices)
      ? (obj.missing_devices as SpecChallengeResult["missing_devices"])
      : [],
    missing_alarms: Array.isArray(obj.missing_alarms)
      ? (obj.missing_alarms as SpecChallengeResult["missing_alarms"])
      : [],
    missing_interlocks: Array.isArray(obj.missing_interlocks)
      ? (obj.missing_interlocks as SpecChallengeResult["missing_interlocks"])
      : [],
    general_gaps: Array.isArray(obj.general_gaps) ? (obj.general_gaps as string[]) : [],
  };
}

/** Merge challenger findings back into the extraction. */
export function mergeChallenge(extraction: SpecAnalysis, challenge: SpecChallengeResult): SpecAnalysis {
  const merged = structuredClone(extraction);

  // Patch missing trigger conditions onto existing steps
  for (const mtc of challenge.missing_trigger_conditions) {
    const seq = merged.process_sequences.find(
      (s) => s.name.toLowerCase() === mtc.sequence_name.toLowerCase(),
    );
    if (!seq) continue;
    const step = seq.steps.find((s) => s.step_number === mtc.step_number);
    if (step && !step.trigger_condition) {
      step.trigger_condition = mtc.expected_condition;
    }
  }

  // Append missing process settings
  const existingSettings = new Set(
    (merged.process_settings ?? []).map((s) => s.name.toLowerCase()),
  );
  for (const mps of challenge.missing_process_settings) {
    if (!existingSettings.has(mps.name.toLowerCase())) {
      if (!merged.process_settings) merged.process_settings = [];
      merged.process_settings.push(mps);
    }
  }

  // Append missing alarms
  const existingAlarms = new Set(
    (merged.alarms ?? []).map((a) => a.name.toLowerCase()),
  );
  for (const ma of challenge.missing_alarms) {
    if (!existingAlarms.has(ma.name.toLowerCase())) {
      merged.alarms.push({
        name: ma.name,
        trigger_condition: ma.trigger_condition,
        severity: ma.severity as "IMMEDIATE_SHUTDOWN" | "CONTROLLED_SHUTDOWN" | "WARNING",
        description: ma.reasoning,
        possible_causes: [],
      });
    }
  }

  // Append missing interlocks
  const existingInterlocks = new Set(
    (merged.interlocks ?? []).map((i) => i.name.toLowerCase()),
  );
  for (const mi of challenge.missing_interlocks) {
    if (!existingInterlocks.has(mi.name.toLowerCase())) {
      merged.interlocks.push({
        name: mi.name,
        condition: mi.condition,
        affected_devices: [],
      });
    }
  }

  return merged;
}

/**
 * Hook to run the Gemini challenger pass on a spec analysis extraction.
 */
export function useForgeSpecChallenge() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SpecChallengeResult | null>(null);

  const challenge = useCallback(
    async (specText: string, extraction: SpecAnalysis): Promise<SpecChallengeResult> => {
      setLoading(true);
      setError(null);

      const abort = new AbortController();

      try {
        const systemPrompt = buildChallengerSystemPrompt();
        const userMessage = buildChallengerUserMessage(specText, extraction);

        const { content } = await validateAndCall(
          callNonStreaming,
          systemPrompt,
          [{ role: "user", content: userMessage }],
          abort.signal,
          CHALLENGE_MAX_TOKENS,
          "spec_challenge",
          false,
          {
            prompt_name: "forge-spec-challenge",
            agent_role: "spec_challenge",
            pipeline_step: "spec_challenge",
            model: "gemini-2.5-pro",
            provider: "google",
          },
        );

        const cleaned = content
          .trim()
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/```\s*$/, "")
          .trim();

        let parsed: unknown;
        try {
          parsed = JSON.parse(cleaned);
        } catch {
          throw new Error(`Challenge response returned invalid JSON: ${cleaned.slice(0, 200)}...`);
        }

        const validated = validateChallengeResult(parsed);
        setResult(validated);
        return validated;
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

  return { challenge, loading, error, result };
}
