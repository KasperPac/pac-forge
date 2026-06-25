import { analyzeArtifacts } from "@/lib/safety-analyzer";
import type { SafetyWarning } from "@/types";

/** Stable acknowledgement key for a warning — independent of the random
 *  `SafetyWarning.id`, which changes every analyzer run. */
export function warningKey(w: SafetyWarning): string {
  return `${w.type}:${w.line ?? "?"}`;
}

export interface SafetyGateResult {
  /** Every warning the analyzer raised for this FB. */
  warnings: SafetyWarning[];
  /** True when at least one warning's key is not in `acknowledged`. */
  blocked: boolean;
}

/**
 * Run the rule-based safety analyzer over one FB's SCL and classify the gate.
 * `acknowledged` is the set of previously-acknowledged warning keys
 * (`warningKey`). The gate blocks Approve while any warning is unacknowledged.
 * Pure: no IO, deterministic for a given input.
 */
export function evaluateSafetyGate(
  name: string,
  type: string,
  content: string,
  acknowledged: string[]
): SafetyGateResult {
  const ackSet = new Set(acknowledged);
  const warnings = analyzeArtifacts([{ name, type, content }]);
  const blocked = warnings.some((w) => !ackSet.has(warningKey(w)));
  return { warnings, blocked };
}
