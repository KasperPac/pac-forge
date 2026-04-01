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
 * Generate derived DB findings from FC/FB findings.
 * When a finding says "wire param X to DB_HmiData.field", the DB also needs
 * that field added. This prevents the rewrite loop from fixing FCs without
 * updating the corresponding DBs (BUG-11).
 */
export function derivedDbFindings(
  findings: ReviewFinding[],
  artifactNames: string[],
): ReviewFinding[] {
  const derived: ReviewFinding[] = [];
  const addedKeys = new Set<string>();

  // Known global DB names (with and without DB_ prefix)
  const globalDbPatterns = [
    "DB_HmiData", "DB_ProcessCommands", "DB_Configuration",
    "DB_FaultData", "DB_ProcessState", "DB_Outputs",
    "HmiData", "ProcessCommands", "Configuration",
    "FaultData", "ProcessState", "Outputs",
  ];

  for (const f of findings) {
    // Look for patterns like: wire X to "DB_HmiData".field, add DB_HmiData.field,
    // DB_ProcessCommands.xyz, etc.
    const dbRefRe = /["']?(DB_\w+|HmiData|ProcessCommands|Configuration|FaultData|ProcessState|Outputs)["']?\.\w+/gi;
    let match: RegExpExecArray | null;
    while ((match = dbRefRe.exec(f.message)) !== null) {
      const dbName = match[0].split(".")[0].replace(/["']/g, "");
      // Only generate derived findings for DBs that aren't the finding's own target
      if (dbName.toLowerCase() === f.artifactName.toLowerCase()) continue;
      // Check this is a recognized global DB pattern
      if (!globalDbPatterns.some(p => p.toLowerCase() === dbName.toLowerCase())) continue;
      // Find the actual artifact name (may need DB_ prefix)
      const actualDb = artifactNames.find(n =>
        n.toLowerCase() === dbName.toLowerCase() ||
        n.toLowerCase() === `db_${dbName.toLowerCase()}` ||
        `db_${n.toLowerCase()}` === dbName.toLowerCase()
      );
      if (!actualDb) continue;

      const key = `${actualDb}:${f.message}`;
      if (addedKeys.has(key)) continue;
      addedKeys.add(key);

      derived.push({
        severity: f.severity,
        artifactName: actualDb,
        message: `[AUTO-DERIVED] Update DB schema to match: ${f.message}. Ensure all referenced fields exist with correct types.`,
      });
    }
  }

  return derived;
}

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
