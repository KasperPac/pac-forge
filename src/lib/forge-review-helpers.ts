/**
 * forge-review-helpers.ts
 *
 * Shared helpers for the review step pipeline.
 */

import type { ReviewFinding } from "@/lib/forge-review-parser";

/** A finding with tracking metadata */
export interface TrackedFinding extends ReviewFinding {
  id: string;
  selected: boolean;
  unresolved: boolean;
  round: number;
}

export type ReviewStepStatus = "idle" | "reviewing" | "findings" | "rewriting" | "re-reviewing" | "clean" | "accepted" | "skipped";

/**
 * Convert raw review findings to tracked findings with selection state.
 * If previousFindings are provided, marks repeat findings as "unresolved".
 */
export function toTrackedFindings(
  findings: ReviewFinding[],
  round: number,
  previousFindings?: TrackedFinding[],
): TrackedFinding[] {
  return findings.map((f, i) => {
    const isRepeat = previousFindings?.some(
      (pf) =>
        pf.artifactName === f.artifactName &&
        (pf.message === f.message || f.message.includes(pf.artifactName)),
    ) ?? false;

    return {
      ...f,
      id: `r${round}-${i}-${f.artifactName}`,
      selected: round === 1 && f.severity === "CRITICAL",
      unresolved: isRepeat && round > 1,
      round,
    };
  });
}
