/**
 * forge-review-parser.ts
 * Parses structured findings from the Standards Reviewer agent.
 * Expected format:
 *   [FINDING:CRITICAL] ArtifactName | Description
 *   [FINDING:WARNING] ArtifactName | Description
 *   [FINDING:INFO] ArtifactName | Description
 *   [REWRITE_SCOPE:TARGETED|CASCADE|ARCHITECTURAL]
 *   Files needing changes: file1, file2
 */

export type FindingSeverity = "CRITICAL" | "WARNING" | "INFO";
export type RewriteScope = "TARGETED" | "CASCADE" | "ARCHITECTURAL";

export interface ReviewFinding {
  severity: FindingSeverity;
  artifactName: string;
  message: string;
}

export interface ForgeReviewResult {
  findings: ReviewFinding[];
  rewriteScope: RewriteScope;
  affectedFiles: string[];
  hasCritical: boolean;
  hasWarning: boolean;
  /** Raw response text for logging */
  rawResponse: string;
}

const FINDING_RE = /\[FINDING:(CRITICAL|WARNING|INFO)\]\s+([^|]+)\|\s*(.*)/gi;
const SCOPE_RE = /\[REWRITE_SCOPE:(TARGETED|CASCADE|ARCHITECTURAL)\]/i;
const FILES_RE = /Files needing changes:\s*(.+)/i;

export function parseForgeReviewResponse(responseText: string): ForgeReviewResult {
  const findings: ReviewFinding[] = [];

  // Parse findings
  let match: RegExpExecArray | null;
  const re = new RegExp(FINDING_RE.source, "gi");
  while ((match = re.exec(responseText)) !== null) {
    findings.push({
      severity: match[1].toUpperCase() as FindingSeverity,
      artifactName: match[2].trim(),
      message: match[3].trim(),
    });
  }

  // Parse rewrite scope
  const scopeMatch = SCOPE_RE.exec(responseText);
  const rewriteScope: RewriteScope = scopeMatch
    ? (scopeMatch[1].toUpperCase() as RewriteScope)
    : "TARGETED";

  // Parse affected files
  const filesMatch = FILES_RE.exec(responseText);
  const affectedFiles = filesMatch
    ? filesMatch[1].split(",").map((f) => f.trim()).filter(Boolean)
    : [];

  return {
    findings,
    rewriteScope,
    affectedFiles,
    hasCritical: findings.some((f) => f.severity === "CRITICAL"),
    hasWarning: findings.some((f) => f.severity === "WARNING"),
    rawResponse: responseText,
  };
}

/**
 * Returns true if the reviewer said NO_CHANGES (no findings, clean pass).
 */
export function isCleanReview(responseText: string): boolean {
  return /NO_CHANGES/i.test(responseText.split("\n").slice(0, 5).join("\n"));
}
