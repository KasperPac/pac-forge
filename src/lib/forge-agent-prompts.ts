/**
 * forge-agent-prompts.ts
 * All agent prompt builders for the forge wizard pipeline.
 * Stage-scoped for Standards Reviewer; rewrite and compile-fix for Code Architect.
 */

import type { ForgeArtifact, ForgeIoEntry, ForgeDeviceEntry } from "@/types/forge";
import type { ReviewFinding } from "@/lib/forge-review-parser";
import type { PatternCandidate } from "@/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewStage = "io" | "fb" | "db" | "fc_ob" | "process" | "full";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function formatArtifactsForReview(artifacts: ForgeArtifact[]): string {
  return artifacts
    .map((a) => {
      const lang = a.language === "LAD" ? "json" : "scl";
      return `### ${a.name} (${a.type})\n\`\`\`${lang}\n${a.content}\n\`\`\``;
    })
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Standards Reviewer — stage-scoped prompts
// ---------------------------------------------------------------------------

const REVIEWER_CHECKLIST = `## Mandatory Checklist (all stages)
1. CASE labels must be integer literals — CRITICAL if not
2. CASE must have ELSE branch — CRITICAL if missing
3. Instance DBs required for every FB call — CRITICAL if missing
4. FB calls use instance DB name only (e.g., "InstMotor1"(...)) — CRITICAL if wrong syntax
5. Timers, Counters, R_TRIG/F_TRIG must be in VAR (not VAR_TEMP) — CRITICAL
6. Type conversions must be explicit (INT_TO_REAL, etc.) — CRITICAL if implicit
7. # prefix on all local variables — CRITICAL if missing
8. All FB parameters wired up in calls — CRITICAL if missing
9. All variables used in code bodies are declared — CRITICAL if undeclared
10. Naming conventions per platform rules (lowerCamelCase params, stat/temp/inst prefixes) — WARNING
11. REGION blocks for code organisation — INFO`;

const REVIEWER_OUTPUT_FORMAT = `## Output Format
List every finding using EXACTLY this format:
[FINDING:CRITICAL] ArtifactName | Description of the issue
[FINDING:WARNING] ArtifactName | Description of the issue
[FINDING:INFO] ArtifactName | Description of the issue

After all findings, output:
[REWRITE_SCOPE:TARGETED]
Files needing changes: ArtifactName1, ArtifactName2

If no issues found, output:
NO_CHANGES: All artifacts pass review.

Do NOT rewrite or correct code — only report findings.`;

const STAGE_SCOPE: Record<ReviewStage, string> = {
  io: `## Stage Scope: IO Configuration
Check ONLY: tag naming, data types, address format (%I/%Q/%IW/%QW), no duplicate addresses, inputs use %I/%IW, outputs use %Q/%QW.
Do NOT flag: missing FBs, FCs, OBs, DBs, or program logic — those come in later stages.`,

  fb: `## Stage Scope: Function Blocks
Check ONLY: FB interface sections, static vs temp declarations, no absolute addressing inside FBs, REGION blocks, CASE ELSE branches, naming conventions, timer/counter/edge in VAR.
Do NOT flag: missing OB1, instance DBs, Global DBs, Process FC, IO tag definitions — those come in other stages.`,

  db: `## Stage Scope: Data Blocks
Check ONLY: instance DBs match FB interfaces (same variable names and types), global DB initial values, UDT references correct, naming (Inst prefix for instance DBs), retain attributes.
Do NOT flag: missing OB1, FB internal logic, FC calls, IO tag definitions — those come in other stages.`,

  fc_ob: `## Stage Scope: Process FC + OB1
Check ONLY: all device FBs instantiated and called with correct instance DBs, call syntax correct, IO tags assigned to FB parameters, OB1 calls Process FC, parameter passing complete.
Do NOT flag: missing FB internal logic, IO tag address definitions, DB declarations — those were reviewed in earlier stages.`,

  process: `## Stage Scope: Process Code
Check ONLY: CASE state machines, step variable declared as INT in static, CASE ELSE branches, PLCopen enable/execute pattern, busy/done/error outputs, REGION blocks, cross-FB calls use instance DB syntax.
Apply full checklist — this stage references all previous artifacts.`,

  full: `## Stage Scope: Full Review
Apply the complete checklist above. No stage restrictions.`,
};

/**
 * System prompt for the Standards Reviewer — stage-scoped.
 */
export function buildForgeReviewPrompt(
  stage: ReviewStage,
  platformRules: string,
  profileRules?: string,
): string {
  const profileSection = profileRules
    ? `\n\n## Design Profile Rules\n${profileRules}`
    : "";

  return `You are a Standards Reviewer inspecting generated Siemens TIA Portal SCL/LAD code artifacts.
Your job is to identify defects — not to rewrite code.

${REVIEWER_CHECKLIST}

## Platform Rules
${platformRules}
${profileSection}

${STAGE_SCOPE[stage]}

${REVIEWER_OUTPUT_FORMAT}`;
}

/**
 * User message for the Standards Reviewer — sends all artifacts.
 */
export function buildForgeReviewUserMessage(artifacts: ForgeArtifact[]): string {
  return `Review the following artifacts:\n\n${formatArtifactsForReview(artifacts)}`;
}

// ---------------------------------------------------------------------------
// Code Architect — rewrite prompt
// ---------------------------------------------------------------------------

/**
 * System prompt for Code Architect to rewrite artifacts based on review findings.
 */
export function buildForgeRewritePrompt(
  platformRules: string,
  profileRules?: string,
): string {
  const profileSection = profileRules
    ? `\n\n## Design Profile Rules\n${profileRules}`
    : "";

  return `You are Code Architect, a senior Siemens TIA Portal SCL programmer.
Specialist reviewers have inspected the generated code and reported findings. You MUST address every CRITICAL and WARNING finding. INFO findings are optional improvements.

## Platform Rules
${platformRules}
${profileSection}

## Rewrite Instructions
- Rewrite artifacts to fix all reported issues while preserving existing code structure and functionality
- Do not introduce changes beyond what the findings require
- After rewriting, verify:
  - All variables used in code bodies are declared in VAR sections
  - All UDT field accesses match the UDT STRUCT definitions
  - All cross-artifact references (UDTs, FBs, instance DBs, Main calls) are consistent
  - No parameters dropped from FB calls during rewrite

## CRITICAL: Cross-Artifact Consistency
When you rename a parameter or variable in an FB interface (VAR_INPUT/VAR_OUTPUT/VAR_IN_OUT), you MUST also rename every call site that uses that parameter across ALL other artifacts.
Example: if you rename _SensorDlyOnOff to sensorDlyOnOff in the FB, you must find every "_SensorDlyOnOff :=" and "_SensorDlyOnOff =>" in all Device Call FCs and update them to match.
Failure to do this will cause compile errors even though the review findings appear fixed.

## Rewrite Scope
- TARGETED: Only regenerate files with actual issues — BUT if a parameter rename affects call sites in other files, those files must also be updated
- COPY FORWARD: Unchanged files are identical to previous version
- FULL OUTPUT: Always provide the complete artifact set

## Response Format
## Rewrite Summary
**Files Changed ([N]):**
- [filename] — [specific change made]

**Files Unchanged ([N]):**
- [filename] — Copied from previous version

[Output ALL files — changed and unchanged — as \`\`\`scl [TYPE:Name] ... \`\`\` blocks]`;
}

/**
 * User message for Code Architect rewrite — sends findings + current artifacts.
 */
export function buildForgeRewriteUserMessage(
  findings: ReviewFinding[],
  artifacts: ForgeArtifact[],
): string {
  const findingLines = findings.map(
    (f) => `[${f.severity}] ${f.artifactName}: ${f.message}`,
  ).join("\n");

  return `## Review Findings to Address\n${findingLines}\n\n## Current Artifacts\n${formatArtifactsForReview(artifacts)}`;
}

// ---------------------------------------------------------------------------
// Compile fix prompt
// ---------------------------------------------------------------------------

/**
 * System prompt for Code Architect to fix compile errors.
 * Minimal, targeted — preserve interfaces and structure.
 * Accepts optional patterns so previously-learned fixes are injected.
 */
export function buildForgeCompileFixPrompt(platformRules: string, patterns?: PatternCandidate[]): string {
  const patternSection = patterns && patterns.length > 0
    ? `## Mandatory: Learned Corrections from Previous Compile Errors\n` +
      `These mistakes have been fixed before — do NOT repeat them:\n` +
      patterns.map(p =>
        `### ${p.correction_type ?? "CORRECTION"}: ${p.explanation_tag ?? ""}\n` +
        `❌ WRONG:\n\`\`\`scl\n${p.original_snippet}\n\`\`\`\n` +
        `✅ CORRECT:\n\`\`\`scl\n${p.corrected_snippet}\n\`\`\``
      ).join("\n\n")
    : "";

  return `You are Code Architect, fixing Siemens TIA Portal SCL compile errors.

## Platform Rules
${platformRules}
${patternSection ? "\n" + patternSection + "\n" : ""}
## Fixing Methodology (in order)
1. Syntax errors — fix malformed statements, missing semicolons, wrong keywords
2. Undeclared identifiers — add missing variable declarations to the correct VAR section
3. Data type mismatches — add explicit type conversion functions (INT_TO_REAL, etc.)
4. Call interface mismatches — match formal parameter names and types exactly

## Rules
- Apply MINIMAL corrections — do not redesign, rename, or remove logic
- Preserve block interface (VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT sections) exactly
- Preserve STAT memory layout and UDT structures
- Do NOT invent missing members or add unrelated improvements
- If no safe fix is possible, output: NO_SAFE_FIX_FOUND

## Output Format
Return the complete corrected artifact as a \`\`\`scl [TYPE:Name] ... \`\`\` block.`;
}

/**
 * User message for compile fix — sends one artifact + its compile errors.
 * Optionally includes related FB artifacts as reference for resolving interface mismatches.
 */
export function buildForgeCompileFixUserMessage(
  artifact: ForgeArtifact,
  compileErrors: string[],
  referenceFbs?: ForgeArtifact[],
): string {
  const errorLines = compileErrors.map((e, i) => `${i + 1}. ${e}`).join("\n");
  const lang = artifact.language === "LAD" ? "json" : "scl";

  const fbReferenceSection = referenceFbs && referenceFbs.length > 0
    ? `\n## FB Interface Reference (authoritative — use these exact parameter names)\n` +
      referenceFbs.map(fb => {
        const interfaceRe = /(VAR_INPUT[\s\S]*?END_VAR|VAR_OUTPUT[\s\S]*?END_VAR|VAR_IN_OUT[\s\S]*?END_VAR)/gi;
        const matches = fb.content.match(interfaceRe) ?? [];
        return `### ${fb.name}\n\`\`\`scl\n${matches.join("\n") || fb.content.slice(0, 400)}\n\`\`\``;
      }).join("\n\n")
    : "";

  return `## Compile Errors\n${errorLines}${fbReferenceSection}\n\n## Artifact to Fix\n### ${artifact.name} (${artifact.type})\n\`\`\`${lang}\n${artifact.content}\n\`\`\`\n\nFix the compile errors and return the corrected complete artifact. If an error says a formal parameter is invalid, check the FB Interface Reference above for the correct parameter names.`;
}

// ---------------------------------------------------------------------------
// Pattern Librarian — post-fix analysis
// ---------------------------------------------------------------------------

/**
 * System prompt for the Pattern Librarian to analyse a before/after diff.
 */
export function buildForgePatternAnalysisPrompt(): string {
  return `You are Pattern Librarian, analyzing a before/after code correction to extract a reusable pattern.

## Your Task
Compare the original and corrected code. Identify what changed and why, then extract a generalised rule.

## Correction Types
NAMING | IO_MAPPING | STATE_LOGIC | ALARM | SAFETY | TIMING | TYPE_CONVERSION | DECLARATION | SYNTAX | OTHER

## Pattern Types
SYSTEMIC_PATTERN — a mistake that will likely recur across many similar blocks
LOCAL_PATTERN — a one-off specific to this device or context

## Output Format (JSON only, no markdown fences)
{
  "correction_type": "TYPE",
  "pattern_type": "SYSTEMIC_PATTERN | LOCAL_PATTERN",
  "original_snippet": "the wrong code pattern (generalised, < 20 lines)",
  "corrected_snippet": "the correct code pattern (generalised, < 20 lines)",
  "explanation_tag": "one-line rule summary for injection into future prompts",
  "context": "brief description of what the correction was about"
}`;
}

/**
 * User message for pattern analysis — sends original and fixed code.
 */
export function buildForgePatternAnalysisUserMessage(
  originalCode: string,
  fixedCode: string,
  artifactName: string,
): string {
  return `Artifact: ${artifactName}\n\n## Original\n\`\`\`scl\n${originalCode}\n\`\`\`\n\n## Corrected\n\`\`\`scl\n${fixedCode}\n\`\`\`\n\nAnalyse the diff and return the pattern JSON.`;
}

// ---------------------------------------------------------------------------
// IO Validator — cross-reference IO linking FC against IO list and FB interfaces
// ---------------------------------------------------------------------------

/**
 * System prompt for the IO Validator agent.
 * Checks that the generated IO linking FC correctly maps every IO signal to a
 * real, declared FB parameter — no invented variable names, no orphaned signals.
 */
export function buildForgeIoValidationPrompt(
  devices: ForgeDeviceEntry[],
  ioList: ForgeIoEntry[],
): string {
  const deviceSummary = devices
    .map((d) => {
      const signals = (d.io_signals ?? [])
        .map((s) => `    ${s.tag_name} (${s.signal_type}): ${s.description ?? ""}`)
        .join("\n");
      return `  ${d.name} [${d.tag}] — instance DB: Inst${d.name.replace(/[^A-Za-z0-9]/g, "")}\n${signals || "    (no signals)"}`;
    })
    .join("\n\n");

  const ioSummary = ioList
    .map((io) => `  ${io.tag_name} (${io.signal_type}, ${io.data_type}): ${io.description ?? ""}`)
    .join("\n");

  return `You are an IO Validator. Your job is to validate IO mapping in generated Siemens TIA Portal code. You validate IO mapping by cross-referencing the IO Linking FC against the known IO list and FB interfaces.

## Checks to perform

1. **No invented variable names** — every instance DB access (e.g. "InstM01".someVar) must use a variable that is declared in the FB's INTERFACE/VAR sections. Report CRITICAL for any access to a non-existent variable.
2. **No orphaned IO tags** — every IO signal in the IO list that is assigned to a device should appear in the IO linking FC. Report WARNING for any unlinked signal.
3. **Signal direction consistency** — DI/AI signals (inputs) should feed INTO FB parameters (reads), DQ/AQ signals (outputs) should be driven FROM FB outputs (writes). Report WARNING for any reversal.
4. **No duplicate address usage** — the same physical tag should not be written to from two different rungs/lines. Report WARNING for duplicates.

## Known Devices and IO Signals
${deviceSummary}

## Full IO List
${ioSummary}

${REVIEWER_OUTPUT_FORMAT}`;
}

/**
 * User message for the IO Validator — sends the IoLinking FC and all FB artifacts.
 */
export function buildForgeIoValidationUserMessage(artifacts: ForgeArtifact[]): string {
  const ioLinkingArtifacts = artifacts.filter(
    (a) => a.name === "IoLinking" || a.stage === "device",
  );
  return `Validate the IO mapping in the following artifacts:\n\n${formatArtifactsForReview(ioLinkingArtifacts)}`;
}
