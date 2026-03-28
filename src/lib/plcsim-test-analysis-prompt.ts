/**
 * plcsim-test-analysis-prompt.ts
 *
 * Prompt for PM agent to analyse test failures and generate learnings.
 * Called after a test run completes with failures.
 */

import type { PlcsimTestSuite } from "@/types/plcsim-test";
import type { ForgeSession } from "@/types/forge";

export const TEST_ANALYSIS_MAX_TOKENS = 8192;

export function buildTestAnalysisPrompt(): string {
  return `You are a senior PLC commissioning engineer reviewing automated test results from PLCSIM Advanced.

Your task is to analyse test failures and generate actionable learnings for the engineer. You are NOT fixing the code — you are explaining what likely went wrong so the engineer can investigate and fix it.

## Guidelines

- Focus on FAILED and ERROR tests only — don't comment on passing tests
- For each failure, identify the most likely root cause based on:
  - The expected vs actual tag values
  - The PLC state snapshot (all tag values at the moment of failure)
  - The test steps that led to the failure
  - Common PLC programming mistakes
- Be specific: name the exact block, tag, or logic that's likely wrong
- Suggest what the engineer should check — don't guess at fixes you're not sure about
- Pay special attention to:
  - **Signal polarity inversions** (e.g., e-stop TRUE = healthy vs TRUE = tripped)
  - **Missing preconditions** (a permissive not set that should be)
  - **Timer/delay issues** (PLC logic needs more scan cycles than the test waited)
  - **Tag name mismatches** (test uses a different tag path than the code)
  - **FB interface wiring** (wrong parameter connected in the call FC)

## Severity Levels

- **bug**: A code defect that must be fixed (wrong logic, inverted signal, missing condition)
- **improvement**: A design suggestion (better structure, clearer naming, additional safety check)
- **note**: An observation that may or may not be an issue (timing sensitivity, edge case)

## Output Format

Return ONLY a JSON array of learnings (no markdown fencing):

[
  {
    "testCaseId": "id of the failed test",
    "testCaseName": "name of the failed test",
    "severity": "bug | improvement | note",
    "title": "Short title (1 line)",
    "description": "Detailed explanation of what went wrong",
    "affectedBlock": "Name of the FB/FC/DB that likely has the issue (or null)",
    "suggestedFix": "What the engineer should check or change (or null)"
  }
]`;
}

export function buildTestAnalysisUserMessage(
  suite: PlcsimTestSuite,
  session: ForgeSession,
): string {
  const parts: string[] = [];

  // Only include failed/error results
  const failures = suite.results.filter((r) => r.status === "fail" || r.status === "error");

  if (failures.length === 0) return "All tests passed. No analysis needed.";

  parts.push(`## Test Run Summary`);
  parts.push(`Total: ${suite.summary?.total ?? 0}, Passed: ${suite.summary?.passed ?? 0}, Failed: ${suite.summary?.failed ?? 0}, Errors: ${suite.summary?.errors ?? 0}`);
  parts.push("");

  // Failed test details with snapshots
  for (const result of failures) {
    const testCase = suite.testCases.find((tc) => tc.id === result.testCaseId);
    parts.push(`## FAILED: ${result.testCaseName} (${result.category})`);
    if (testCase?.description) parts.push(testCase.description);
    parts.push("");

    // Step results
    for (const sr of result.stepResults) {
      const step = testCase?.steps.find((s) => s.id === sr.stepId);
      parts.push(`### Step ${sr.stepNumber}: ${step?.description ?? ""} — ${sr.status.toUpperCase()}`);

      if (sr.assertions.length > 0) {
        parts.push("| Tag | Expected | Actual | Result |");
        parts.push("|-----|----------|--------|--------|");
        for (const a of sr.assertions) {
          parts.push(`| ${a.tag} | ${a.expected} | ${a.actual} | ${a.passed ? "PASS" : "**FAIL**"} |`);
        }
      }

      if (sr.errorMessage) {
        parts.push(`Error: ${sr.errorMessage}`);
      }

      // PLC state snapshot
      if (sr.snapshot && sr.snapshot.tags.length > 0) {
        parts.push("\n**PLC State Snapshot at failure:**");
        parts.push("| Tag | Value | Type |");
        parts.push("|-----|-------|------|");
        for (const t of sr.snapshot.tags) {
          parts.push(`| ${t.tag} | ${t.value ?? "null"} | ${t.dataType} |`);
        }
      }
      parts.push("");
    }

    if (result.comment) {
      parts.push(`**Anomalies:** ${result.comment}`);
      parts.push("");
    }
  }

  // Include relevant generated code for context
  const allArtifacts = [
    ...(session.device_artifacts ?? []),
    ...(session.process_artifacts ?? []),
  ];
  if (allArtifacts.length > 0) {
    parts.push("## Generated Code (for reference)");
    for (const art of allArtifacts) {
      const lines = art.content.split("\n");
      parts.push(`\n### ${art.name} (${art.type})`);
      parts.push("```scl");
      parts.push(lines.slice(0, 60).join("\n"));
      if (lines.length > 60) parts.push(`// ... ${lines.length - 60} more lines`);
      parts.push("```");
    }
  }

  parts.push("\n---");
  parts.push("Analyse the failures above and return a JSON array of learnings.");

  return parts.join("\n");
}
