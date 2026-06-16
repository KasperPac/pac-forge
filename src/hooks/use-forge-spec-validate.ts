import { useState, useCallback } from "react";
import { callNonStreaming } from "@/hooks/use-generation";
import { validateAndCall } from "@/lib/forge-pipeline-validator";
import type { SpecAnalysis } from "@/types/forge";

const VALIDATE_MAX_TOKENS = 8192;

export interface SpecValidationFinding {
  check: string;
  severity: "CRITICAL" | "WARNING" | "INFO";
  description: string;
  fix_applied?: string;
}

export interface SpecValidationResult {
  findings: SpecValidationFinding[];
  patches: SpecAnalysisPatch[];
}

export interface SpecAnalysisPatch {
  /** Which array/field to patch */
  target: "process_sequences" | "process_settings" | "alarms" | "interlocks" | "control_modules";
  action: "add_trigger_condition" | "add_setting" | "add_alarm" | "add_interlock" | "fix_step";
  detail: Record<string, unknown>;
}

function buildValidatorSystemPrompt(): string {
  return `You are a QA engineer performing a STRUCTURED VALIDATION of a spec analysis extraction.

You have the merged extraction (already enriched by a challenger pass). Your job is to run a checklist of cross-reference checks and flag any remaining gaps.

## Validation Checklist

### CHECK 1: Analog Input Coverage
For every device with an AI (analog input) signal:
- Is there at least ONE process_settings entry for its threshold/setpoint?
- Is there at least ONE process sequence step with a trigger_condition that references this analog value?
- If an analog sensor exists but no sequence step uses its value as a trigger → CRITICAL

### CHECK 2: Device Coverage
For every device in the control_modules array:
- Does it appear in at least one sequence step's control_modules_involved?
- If a device is never referenced by any sequence → WARNING (it may be OK for standalone control_modules)

### CHECK 3: Process Settings Linkage
For every entry in process_settings:
- Is there a sequence step whose trigger_condition, completion_criteria, or notes references this setting?
- If a setting exists but is never used → WARNING

### CHECK 4: Alarm Completeness
For every device with feedback signals (run feedback, overload, fault):
- Is there an alarm entry for feedback timeout?
- Is there an alarm entry for the fault/overload condition?

### CHECK 5: Trigger Condition Completeness
For every sequence step that has NO trigger_condition:
- Is this genuinely an unconditional step (e.g., "initialize", "set defaults")?
- Or does the action text suggest a condition that should have been captured?
- If the action mentions "when", "if", "exceeds", "reaches", "above", "below" → the step is missing its trigger

### CHECK 6: Sequence Logical Completeness
For every process sequence:
- Does it have a clear start condition (first step trigger)?
- Does it have a completion/end state?
- If the spec describes a paired sequence (staging/de-staging), does the related_sequences field link them?

## Output Format
Return JSON inside \`\`\`json fences:
{
  "findings": [
    {
      "check": "string (CHECK 1, CHECK 2, etc.)",
      "severity": "CRITICAL | WARNING | INFO",
      "description": "string (what's wrong and where)"
    }
  ],
  "patches": [
    {
      "target": "process_sequences | process_settings | alarms | interlocks | control_modules",
      "action": "add_trigger_condition | add_setting | add_alarm | add_interlock | fix_step",
      "detail": { ... }
    }
  ]
}

For patches:
- add_trigger_condition: { "sequence_name": "...", "step_number": N, "trigger_condition": "..." }
- add_setting: { "name": "...", "description": "...", "default_value": "...", "data_type": "...", "unit": "..." }
- add_alarm: { "name": "...", "trigger_condition": "...", "severity": "...", "description": "..." }

If everything checks out, return empty arrays. Do NOT invent problems.
Return ONLY the JSON.`;
}

function buildValidatorUserMessage(specText: string, extraction: SpecAnalysis): string {
  return `<original_spec>
${specText}
</original_spec>

<merged_extraction>
${JSON.stringify(extraction, null, 2)}
</merged_extraction>

Run the validation checklist. Return findings and patches as JSON.`;
}

function validateResult(parsed: unknown): SpecValidationResult {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Validation response is not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  return {
    findings: Array.isArray(obj.findings)
      ? (obj.findings as SpecValidationFinding[])
      : [],
    patches: Array.isArray(obj.patches)
      ? (obj.patches as SpecAnalysisPatch[])
      : [],
  };
}

/** Apply validation patches to the extraction. */
export function applyValidationPatches(
  extraction: SpecAnalysis,
  patches: SpecAnalysisPatch[],
): SpecAnalysis {
  const patched = structuredClone(extraction);

  for (const patch of patches) {
    const d = patch.detail as Record<string, unknown>;

    if (patch.action === "add_trigger_condition" && patch.target === "process_sequences") {
      const seq = patched.process_sequences.find(
        (s) => s.name.toLowerCase() === (d.sequence_name as string)?.toLowerCase(),
      );
      if (!seq) continue;
      const step = seq.steps.find((s) => s.step_number === d.step_number);
      if (step && !step.trigger_condition) {
        step.trigger_condition = d.trigger_condition as string;
      }
    }

    if (patch.action === "add_setting" && patch.target === "process_settings") {
      if (!patched.process_settings) patched.process_settings = [];
      const exists = patched.process_settings.some(
        (s) => s.name.toLowerCase() === (d.name as string)?.toLowerCase(),
      );
      if (!exists) {
        patched.process_settings.push({
          name: d.name as string,
          description: d.description as string,
          default_value: d.default_value as string,
          data_type: d.data_type as string,
          unit: (d.unit as string) ?? null,
        });
      }
    }

    if (patch.action === "add_alarm" && patch.target === "alarms") {
      const exists = patched.alarms.some(
        (a) => a.name.toLowerCase() === (d.name as string)?.toLowerCase(),
      );
      if (!exists) {
        patched.alarms.push({
          name: d.name as string,
          trigger_condition: d.trigger_condition as string,
          severity: (d.severity as "IMMEDIATE_SHUTDOWN" | "CONTROLLED_SHUTDOWN" | "WARNING") ?? "WARNING",
          description: (d.description as string) ?? "",
          possible_causes: [],
        });
      }
    }

    if (patch.action === "add_interlock" && patch.target === "interlocks") {
      const exists = patched.interlocks.some(
        (i) => i.name.toLowerCase() === (d.name as string)?.toLowerCase(),
      );
      if (!exists) {
        patched.interlocks.push({
          name: d.name as string,
          condition: d.condition as string,
          affected_control_modules: [],
        });
      }
    }
  }

  return patched;
}

/**
 * Hook to run the structured validation checklist pass on a spec analysis.
 */
export function useForgeSpecValidate() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SpecValidationResult | null>(null);

  const validate = useCallback(
    async (specText: string, extraction: SpecAnalysis): Promise<SpecValidationResult> => {
      setLoading(true);
      setError(null);

      const abort = new AbortController();

      try {
        const systemPrompt = buildValidatorSystemPrompt();
        const userMessage = buildValidatorUserMessage(specText, extraction);

        const { content } = await validateAndCall(
          callNonStreaming,
          systemPrompt,
          [{ role: "user", content: userMessage }],
          abort.signal,
          VALIDATE_MAX_TOKENS,
          "spec_validate",
          false,
          {
            prompt_name: "forge-spec-validate",
            agent_role: "spec_validate",
            pipeline_step: "spec_validate",
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
          throw new Error(`Validation response returned invalid JSON: ${cleaned.slice(0, 200)}...`);
        }

        const validated = validateResult(parsed);
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

  return { validate, loading, error, result };
}
