/**
 * forge-agent-prompts.ts
 * All agent prompt builders for the forge wizard pipeline.
 * Stage-scoped for Standards Reviewer; rewrite and compile-fix for Code Architect.
 */

import type { ForgeArtifact, ForgeIoEntry, ForgeControlModuleEntry } from "@/types/forge";
import type { ReviewFinding } from "@/lib/forge-review-parser";
import type { PatternCandidate } from "@/types";
import { resolveSection } from "@/lib/prompt-defaults";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ReviewStage = "io" | "fb" | "equipment_module" | "db" | "fc_ob" | "process" | "full";

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

  fb: `## Stage Scope: Function Blocks (Device + Assembly)
Check ONLY: FB interface sections, static vs temp declarations, no absolute addressing inside FBs, REGION blocks, CASE ELSE branches, naming conventions, timer/counter/edge in VAR. Assembly FBs should have state machines, fault detection, config UDT, and HMI UDT.
Do NOT flag: missing OB1, instance DBs, Global DBs, Process FC, IO tag definitions — those come in other stages.`,

  equipment_module: `## Stage Scope: Assembly Function Blocks
Check ONLY: Assembly FB has state machine (CASE), fault detection (travel timeout, overtravel, motor fault), config UDT input, HMI UDT IN_OUT, command inputs (enable, reset, cmd*), status outputs (busy, done, error, faultCode, stateNumber), REGION blocks. Assembly FB must NOT read physical IO directly.
Do NOT flag: missing OB1, device FBs, Global DBs, Process FC — those come in other stages.`,

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
  promptSections?: Record<string, string>,
): string {
  const identity = resolveSection(promptSections, "forge_reviewer", "identity");
  const instructions = resolveSection(promptSections, "forge_reviewer", "instructions");
  const profileSection = profileRules
    ? `\n\n## Design Profile Rules\n${profileRules}`
    : "";

  return `${identity}

${instructions}

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
  promptSections?: Record<string, string>,
): string {
  const identity = resolveSection(promptSections, "forge_arch_rewrite", "identity");
  const instructions = resolveSection(promptSections, "forge_arch_rewrite", "instructions");
  const profileSection = profileRules
    ? `\n\n## Design Profile Rules\n${profileRules}`
    : "";

  return `${identity}

## Platform Rules
${platformRules}
${profileSection}

${instructions}

## CRITICAL: Cross-Artifact Consistency
When you rename a parameter or variable in an FB interface (VAR_INPUT/VAR_OUTPUT/VAR_IN_OUT), you MUST also rename every call site that uses that parameter across ALL other artifacts.
Example: if you rename _SensorDlyOnOff to sensorDlyOnOff in the FB, you must find every "_SensorDlyOnOff :=" and "_SensorDlyOnOff =>" in all Device Call FCs and update them to match.

## CRITICAL: DB Schema Must Match All References
When a finding says to wire a parameter to a global DB field (e.g., \`error => "DB_HmiData".m01Error\`), you MUST:
1. Add the wire to the call FC
2. **Also check** that the target DB declares that field with the correct type
3. If the field is missing from the DB, **add it** with the correct type from the FB interface
4. If the field exists but with the wrong type (e.g., Bool instead of UDT), **fix the type**

This applies to ALL global DBs: DB_HmiData, DB_ProcessCommands, DB_Configuration, DB_FaultData, DB_ProcessState, DB_Outputs.
Failure to update the DB schema when adding new wires will cause "undeclared variable" compile errors.

## DB Architecture Rules
- DB_HmiData: WRITE-ONLY for HMI display. Device call FCs write status to it. NO PLC logic ever reads from it.
- DB_ProcessCommands: Sequence → device commands. Written by process code, read by device call FCs.
- DB_ProcessState: Internal state. Written/read by process code.
- DB_FaultData: Fault latches. Written by control_modules/process, read by process/sequences.
- Siemens Open Library FBs have HMI UDTs as VAR_IN_OUT — the HMI faceplate reads the instance DB directly.

## LAD JSON Artifacts
Some artifacts (device call FCs) use LAD format and are encoded as JSON, not SCL. When fixing LAD artifacts:
- The JSON structure contains rungs with elements that have properties like \`negated\`, \`operand\`, \`type\`, etc.
- To invert a signal: change \`"negated": false\` to \`"negated": true\` (or vice versa) on the relevant element
- To add a NOT: set the \`negated\` flag on the contact/coil element — do NOT add separate NOT instructions
- Output LAD artifacts as \`\`\`json [FC:Name] ... \`\`\` blocks (not \`\`\`scl)
- Preserve the complete JSON structure — do not convert LAD to SCL

## Response Format
## Rewrite Summary
**Files Changed ([N]):**
- [filename] — [specific change made]

**Files Unchanged ([N]):**
- [filename] — Copied from previous version

[Output ALL files — changed and unchanged — as \`\`\`scl [TYPE:Name] ... \`\`\` (for SCL) or \`\`\`json [FC:Name] ... \`\`\` (for LAD JSON) blocks]`;
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
export function buildForgeCompileFixPrompt(
  platformRules: string,
  patterns?: PatternCandidate[],
  promptSections?: Record<string, string>,
): string {
  const identity = resolveSection(promptSections, "forge_arch_compile_fix", "identity");
  const instructions = resolveSection(promptSections, "forge_arch_compile_fix", "instructions");
  const patternSection = patterns && patterns.length > 0
    ? `## Mandatory: Learned Corrections from Previous Compile Errors\n` +
      `These mistakes have been fixed before — do NOT repeat them:\n` +
      patterns.map(p =>
        `### ${p.correction_type ?? "CORRECTION"}: ${p.explanation_tag ?? ""}\n` +
        `❌ WRONG:\n\`\`\`scl\n${p.original_snippet}\n\`\`\`\n` +
        `✅ CORRECT:\n\`\`\`scl\n${p.corrected_snippet}\n\`\`\``
      ).join("\n\n")
    : "";

  return `${identity}

## Platform Rules
${platformRules}
${patternSection ? "\n" + patternSection + "\n" : ""}
${instructions}

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
export function buildForgePatternAnalysisPrompt(
  promptSections?: Record<string, string>,
): string {
  const identity = resolveSection(promptSections, "forge_pattern_librarian", "identity");
  const instructions = resolveSection(promptSections, "forge_pattern_librarian", "instructions");

  return `${identity}

${instructions}

## Output Format (JSON only, wrapped in \`\`\`json fences)
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
  control_modules: ForgeControlModuleEntry[],
  ioList: ForgeIoEntry[],
  promptSections?: Record<string, string>,
): string {
  const identity = resolveSection(promptSections, "forge_io_validator", "identity");
  const instructions = resolveSection(promptSections, "forge_io_validator", "instructions");
  const deviceSummary = control_modules
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

  return `${identity}

${instructions}

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
