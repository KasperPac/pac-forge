import { parseArtifacts } from "@/lib/artifact-parser";
import type { ParsedArtifact } from "@/lib/artifact-parser";

export interface ReviewResponse {
  /** Whether the reviewer made any modifications. */
  modified: boolean;
  /** Modified artifacts (only the ones that changed). Empty if modified=false. */
  artifacts: ParsedArtifact[];
  /** The reviewer's explanation or summary. */
  explanation: string;
  /** Any parse errors when extracting modified artifacts. */
  parseErrors: string[];
}

/**
 * Parse a reviewer agent's response.
 *
 * Two cases:
 * 1. Response starts with or contains "NO_CHANGES:" → no modifications
 * 2. Response contains artifact blocks → extract modified artifacts
 */
export function parseReviewResponse(responseText: string): ReviewResponse {
  const trimmed = responseText.trim();

  // Check for NO_CHANGES marker
  const noChangesMatch = trimmed.match(/^NO_CHANGES:\s*([\s\S]*)/i);
  if (noChangesMatch) {
    return {
      modified: false,
      artifacts: [],
      explanation: noChangesMatch[1].trim(),
      parseErrors: [],
    };
  }

  // Also check if NO_CHANGES appears anywhere in the first few lines
  const firstLines = trimmed.split("\n").slice(0, 5).join("\n");
  if (/NO_CHANGES/i.test(firstLines) && !trimmed.includes("```scl")) {
    const afterMarker = trimmed.replace(/.*NO_CHANGES:?\s*/i, "").trim();
    return {
      modified: false,
      artifacts: [],
      explanation: afterMarker || "No changes needed.",
      parseErrors: [],
    };
  }

  // Try to parse artifact blocks
  const { artifacts, summary, errors } = parseArtifacts(responseText);

  if (artifacts.length === 0) {
    // No artifact blocks found — treat as a text-only review (no modifications)
    return {
      modified: false,
      artifacts: [],
      explanation: trimmed,
      parseErrors: errors,
    };
  }

  return {
    modified: true,
    artifacts,
    explanation: summary,
    parseErrors: errors,
  };
}

// --- Report-mode parsing (reviewers report findings, don't rewrite) ---

export type FindingSeverity = "CRITICAL" | "WARNING" | "INFO";

export interface ReviewFinding {
  artifactName: string;
  severity: FindingSeverity;
  description: string;
}

export interface ReviewReport {
  hasFindings: boolean;
  findings: ReviewFinding[];
  summary: string;
}

/**
 * Parse a reviewer agent's structured findings report.
 * Extracts artifact-level findings with severity and description.
 */
export function parseReviewReport(responseText: string): ReviewReport {
  const trimmed = responseText.trim();

  // Check for NO_CHANGES marker
  if (/NO_CHANGES/i.test(trimmed.split("\n").slice(0, 5).join("\n"))) {
    const afterMarker = trimmed.replace(/.*NO_CHANGES:?\s*/i, "").trim();
    return {
      hasFindings: false,
      findings: [],
      summary: afterMarker || "No issues found.",
    };
  }

  const findings: ReviewFinding[] = [];
  let currentArtifact = "";

  // Extract findings from ### ArtifactName sections with **SEVERITY**: description lines
  const lines = trimmed.split("\n");
  for (const line of lines) {
    // Match artifact header: ### ArtifactName or ### ArtifactName (TYPE)
    const artifactMatch = line.match(/^###\s+(\S+)/);
    if (artifactMatch && !line.toLowerCase().includes("rule")) {
      currentArtifact = artifactMatch[1];
      continue;
    }

    // Match finding: - **CRITICAL**: description  or  - **[CRITICAL]**: description
    const findingMatch = line.match(
      /^[-*]\s+\*\*\[?(CRITICAL|WARNING|INFO)\]?\*\*:?\s+(.*)/i
    );
    if (findingMatch && currentArtifact) {
      findings.push({
        artifactName: currentArtifact,
        severity: findingMatch[1].toUpperCase() as FindingSeverity,
        description: findingMatch[2].trim(),
      });
    }
  }

  // Extract summary section
  const summaryMatch = trimmed.match(/##\s*Summary\s*\n([\s\S]*?)(?:\n##|$)/i);
  const summary = summaryMatch?.[1]?.trim() ?? "";

  // If structured parsing found nothing, treat entire response as a finding
  if (findings.length === 0 && !summaryMatch) {
    return {
      hasFindings: true,
      findings: [{ artifactName: "General", severity: "WARNING", description: trimmed.slice(0, 500) }],
      summary: trimmed.slice(0, 200),
    };
  }

  return {
    hasFindings: findings.length > 0,
    findings,
    summary,
  };
}

/**
 * Merge reviewer modifications into the current artifact set.
 * Modified artifacts replace originals by name; unchanged ones pass through.
 * @deprecated Use parseReviewReport + rewrite pipeline instead.
 */
export function mergeReviewedArtifacts(
  current: ParsedArtifact[],
  modifications: ParsedArtifact[]
): { merged: ParsedArtifact[]; modifiedNames: string[] } {
  const modMap = new Map(modifications.map((a) => [a.name, a]));
  const modifiedNames: string[] = [];

  const merged = current.map((artifact) => {
    const mod = modMap.get(artifact.name);
    if (mod) {
      modifiedNames.push(artifact.name);
      return mod;
    }
    return artifact;
  });

  // Add any new artifacts the reviewer created that weren't in the original set
  for (const mod of modifications) {
    if (!current.some((a) => a.name === mod.name)) {
      merged.push(mod);
      modifiedNames.push(mod.name);
    }
  }

  return { merged, modifiedNames };
}
