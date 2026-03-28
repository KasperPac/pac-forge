import { useState, useCallback } from "react";
import { callStreamingCollect } from "@/hooks/use-generation";
import { validateAndCall } from "@/lib/forge-pipeline-validator";
import {
  buildPlcsimTestPrompt,
  buildPlcsimTestUserMessage,
  PLCSIM_TEST_MAX_TOKENS,
} from "@/lib/plcsim-test-prompt";
import type { ForgeSession } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type {
  PlcsimTestSuite,
  PlcsimTestCase,
  IoSimulationRule,
  TestStep,
  TestIoAction,
} from "@/types/plcsim-test";
import { useActivePromptSections } from "@/hooks/use-prompt-sections";

// ---------------------------------------------------------------------------
// Truncation recovery — attempt to close open brackets in truncated JSON
// ---------------------------------------------------------------------------

/**
 * When the AI response is cut off at the token limit, the JSON is incomplete.
 * This function tries to salvage what we can by:
 * 1. Trimming back to the last complete array element or object
 * 2. Closing any open brackets/braces
 *
 * Returns null if recovery isn't feasible.
 */
function repairTruncatedJson(raw: string): string | null {
  // Must start with { to be a JSON object
  if (!raw.startsWith("{")) return null;

  // Track bracket/brace depth
  let inString = false;
  let escape = false;
  const stack: string[] = [];

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === "{" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === "]") {
      stack.pop();
    }
  }

  // If balanced already, no repair needed (shouldn't reach here, but safety)
  if (stack.length === 0) return raw;

  // Trim back: find the last comma or complete value boundary, then close
  // Remove any trailing partial string/value
  let trimmed = raw;

  // If we're inside a string, trim back to before the opening quote
  if (inString) {
    const lastQuote = trimmed.lastIndexOf('"');
    if (lastQuote > 0) {
      trimmed = trimmed.slice(0, lastQuote);
    }
  }

  // Trim trailing partial tokens (incomplete key-value pairs, trailing commas)
  trimmed = trimmed.replace(/,\s*$/, "");
  // Remove incomplete key: "foo": or "foo":  "bar  (no closing quote)
  trimmed = trimmed.replace(/,?\s*"[^"]*":\s*"?[^"{}[\],]*$/, "");
  trimmed = trimmed.replace(/,\s*$/, "");

  // Close remaining open brackets/braces in reverse order
  // Re-scan the trimmed string for current stack state
  const stack2: string[] = [];
  let inStr2 = false;
  let esc2 = false;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (esc2) { esc2 = false; continue; }
    if (ch === "\\") { esc2 = true; continue; }
    if (ch === '"') { inStr2 = !inStr2; continue; }
    if (inStr2) continue;
    if (ch === "{" || ch === "[") stack2.push(ch);
    else if (ch === "}" || ch === "]") stack2.pop();
  }

  // Build closing sequence
  let closing = "";
  while (stack2.length > 0) {
    const opener = stack2.pop()!;
    closing += opener === "{" ? "}" : "]";
  }

  return trimmed + closing;
}

// ---------------------------------------------------------------------------
// Validation — ensure required fields + assign IDs where missing
// ---------------------------------------------------------------------------

function ensureId(id: unknown): string {
  if (typeof id === "string" && id.length > 0) return id;
  return crypto.randomUUID();
}

function validateAction(raw: Record<string, unknown>): TestIoAction {
  return {
    id: ensureId(raw.id),
    type: (raw.type as TestIoAction["type"]) ?? "read",
    tag: (raw.tag as string) ?? "",
    value: (raw.value as boolean | number | string) ?? false,
    dataType: (raw.dataType as TestIoAction["dataType"]) ?? "Bool",
    tolerance: typeof raw.tolerance === "number" ? raw.tolerance : undefined,
    waitMs: typeof raw.waitMs === "number" ? raw.waitMs : undefined,
    description: (raw.description as string) ?? "",
  };
}

function validateStep(raw: Record<string, unknown>): TestStep {
  return {
    id: ensureId(raw.id),
    stepNumber: typeof raw.stepNumber === "number" ? raw.stepNumber : 1,
    description: (raw.description as string) ?? "",
    actions: Array.isArray(raw.actions)
      ? (raw.actions as Record<string, unknown>[]).map(validateAction)
      : [],
  };
}

/** Map freeform AI category strings to valid TestCategory values */
function normalizeCategory(raw: unknown): PlcsimTestCase["category"] {
  if (typeof raw !== "string") return "normal";
  const lower = raw.toLowerCase().replace(/[^a-z]/g, "");
  if (lower.includes("devicefb") || lower.includes("fb") || lower.includes("functionblock")) return "device_fb";
  if (lower.includes("fault") || lower.includes("error") || lower.includes("estop") || lower.includes("emergency")) return "fault";
  if (lower.includes("permissive") || lower.includes("prerequisite") || lower.includes("precondition")) return "permissive";
  if (lower.includes("interlock") || lower.includes("safety")) return "interlock";
  if (lower.includes("reset") || lower.includes("recovery") || lower.includes("restart")) return "reset";
  if (lower.includes("normal") || lower.includes("sequence") || lower.includes("happy")) return "normal";
  return "normal";
}

function validateTestCase(raw: Record<string, unknown>): PlcsimTestCase {
  return {
    id: ensureId(raw.id),
    name: (raw.name as string) ?? "Unnamed Test",
    sequenceName: (raw.sequenceName as string | null) ?? null,
    category: normalizeCategory(raw.category),
    description: (raw.description as string) ?? "",
    steps: Array.isArray(raw.steps)
      ? (raw.steps as Record<string, unknown>[]).map(validateStep)
      : [],
    simRules: Array.isArray(raw.simRules) ? (raw.simRules as string[]) : [],
    priority: typeof raw.priority === "number" ? raw.priority : 100,
    approved: false, // Always start unapproved — user must review
  };
}

function validateSimRule(raw: Record<string, unknown>): IoSimulationRule {
  return {
    id: ensureId(raw.id),
    triggerTag: (raw.triggerTag as string) ?? "",
    triggerValue: (raw.triggerValue as boolean | number) ?? true,
    responseTag: (raw.responseTag as string) ?? "",
    responseValue: (raw.responseValue as boolean | number) ?? true,
    delayMs: typeof raw.delayMs === "number" ? raw.delayMs : 500,
    description: (raw.description as string) ?? "",
    enabled: raw.enabled !== false,
  };
}

function validateTestSuite(parsed: unknown): PlcsimTestSuite {
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Test suite response is not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;

  const testCases = Array.isArray(obj.testCases)
    ? (obj.testCases as Record<string, unknown>[]).map(validateTestCase)
    : [];

  const ioSimRules = Array.isArray(obj.ioSimRules)
    ? (obj.ioSimRules as Record<string, unknown>[]).map(validateSimRule)
    : [];

  return {
    testCases,
    ioSimRules,
    generatedAt: new Date().toISOString(),
    lastRunAt: null,
    results: [],
    summary: null,
  };
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Hook to generate PLCSIM test cases from the forge session context.
 *
 * Usage:
 *   const { generate, loading, error } = usePlcsimTestGenerate();
 *   const suite = await generate(session, profile);
 */
export function usePlcsimTestGenerate() {
  const { data: promptSections } = useActivePromptSections();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(
    async (
      session: ForgeSession,
      profile: DesignProfile | null,
    ): Promise<PlcsimTestSuite> => {
      setLoading(true);
      setError(null);

      const abort = new AbortController();

      try {
        const systemPrompt = buildPlcsimTestPrompt(promptSections);
        const userMessage = buildPlcsimTestUserMessage(session, profile);

        // Use callStreamingCollect to avoid 60s edge function timeout
        // (test generation can produce large JSON responses)
        const { content } = await validateAndCall(
          callStreamingCollect,
          systemPrompt,
          [{ role: "user", content: userMessage }],
          abort.signal,
          PLCSIM_TEST_MAX_TOKENS,
          "pm_test_generation",
        );

        // Strip markdown fences if present
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
          // Attempt truncation recovery — close any open brackets/braces
          const repaired = repairTruncatedJson(cleaned);
          if (repaired) {
            try {
              parsed = JSON.parse(repaired);
              console.warn("[plcsim-test] Recovered truncated JSON response");
            } catch {
              throw new Error(`Test generation returned invalid JSON (truncated at token limit). Try reducing project complexity or run again.`);
            }
          } else {
            throw new Error(`Test generation returned invalid JSON: ${cleaned.slice(0, 300)}…`);
          }
        }

        return validateTestSuite(parsed);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [promptSections],
  );

  return { generate, loading, error };
}
