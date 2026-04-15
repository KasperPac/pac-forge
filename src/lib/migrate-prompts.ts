/**
 * Prompt builders for the S7-300/400 → S7-1500 Migration Wizard.
 *
 * All prompts are focused on migrating legacy Siemens code to S7-1500 / TIA Portal V20+
 * with Siemens Style Guide V2.1 naming conventions.
 */

import type { MigrationPlanStep, MigratedBlock, MigrationSession } from "@/types";
import type { ReferenceLibrarySection } from "@/types";
import type { PatternCandidate } from "@/types";
import { formatReferenceSections } from "@/lib/reference-lookup";

// ---------------------------------------------------------------------------
// 8.1  Analysis prompt
// ---------------------------------------------------------------------------

export function buildMigrationAnalysisSystemPrompt(referenceSections: ReferenceLibrarySection[] = []): string {
  const refBlock = referenceSections.length > 0
    ? "\n\n" + formatReferenceSections(referenceSections, "SCL") + "\n"
    : "";

  return `You are a Siemens S7 PLC migration expert. Your task is to analyse legacy S7-300/S7-400 SCL/AWL code
and produce a structured migration plan for upgrading to S7-1500 / TIA Portal V20.${refBlock}

Key migration concerns to identify:
- NAMING: Old prefix conventions (i_, o_, b_, r_) → Siemens Style Guide V2.1 lowerCamelCase
- TIMER: S7 timers (S_ODT, S_PULSE, T#, S5TIME) → IEC timers (TON, TOF, TP with TIME type)
- COUNTER: S7 counters (S_CU, S_CD, C#) → IEC counters (CTU, CTD, CTUD)
- ADDRESSING: Absolute addressing (M0.0, I0.0, Q1.1) → symbolic tag references only
- BLOCK_CALL: Old call syntax (FB10.DB20(...)) → symbolic instance DB calls ("InstName"(...))
- DATA_TYPE: S5TIME → TIME, S7 WORD/DWORD for booleans → BOOL, old FC/FB DB access patterns
- OB_INTERFACE: S7-300 OB start info (20 bytes) → S7-1500 system attributes
- SYSTEM_FUNCTION: SFC/SFB calls → equivalent S7-1500 system functions or library FBs
- OTHER: Any other legacy patterns

Respond ONLY with a JSON array of migration plan steps. Each step:
{
  "id": "step_<number>",
  "block_name": "<block name>",
  "change_type": "NAMING" | "TIMER" | "COUNTER" | "ADDRESSING" | "BLOCK_CALL" | "DATA_TYPE" | "OB_INTERFACE" | "SYSTEM_FUNCTION" | "OTHER",
  "severity": "BREAKING" | "WARNING" | "INFO",
  "description": "<what needs to change>",
  "action": "<specific action to take>",
  "approved": false,
  "skipped": false,
  "note": ""
}

SEVERITY:
- BREAKING: Will cause compile errors on S7-1500 if not changed
- WARNING: Will compile but may produce incorrect behaviour
- INFO: Style improvements recommended by Siemens Style Guide

Output ONLY the JSON array — no markdown fences, no explanation text.`;
}

/** Max chars per block sent to the analysis agent — captures all declarations + key logic patterns */
const ANALYSIS_BLOCK_CHARS = 2000;

/** How many blocks to send per API call — keep small to avoid JSON truncation */
export const ANALYSIS_BATCH_SIZE = 12;

export function buildMigrationAnalysisUserMessage(
  batch: Array<{ name: string; src: string; lang?: string }>,
  batchIndex: number,
  totalBatches: number,
): string {
  const blockList = batch
    .map(({ name, src, lang }) => {
      const truncated = src.length > ANALYSIS_BLOCK_CHARS
        ? src.slice(0, ANALYSIS_BLOCK_CHARS) + "\n// ... (truncated for analysis)"
        : src;
      const langLabel = lang && lang !== "SCL" ? ` [${lang}]` : "";
      const fence = lang === "STL" ? "awl" : "scl";
      return `### ${name}${langLabel}\n\`\`\`${fence}\n${truncated}\n\`\`\``;
    })
    .join("\n\n");

  const batchNote = totalBatches > 1
    ? ` (batch ${batchIndex + 1} of ${totalBatches})`
    : "";

  return `Analyse the following S7-300/S7-400 PLC blocks${batchNote} and produce the migration plan JSON array.\n\n${blockList}`;
}

// ---------------------------------------------------------------------------
// 8.2  Transform prompt
// ---------------------------------------------------------------------------

export function buildMigrationTransformSystemPrompt(
  referenceSections: ReferenceLibrarySection[] = [],
  approvedMigrationPatterns: PatternCandidate[] = [],
): string {
  const refBlock = referenceSections.length > 0
    ? "\n\n" + formatReferenceSections(referenceSections, "SCL") + "\n"
    : "";

  const patternBlock = approvedMigrationPatterns.length > 0
    ? "\n\n## Learned Migration Corrections (from previous compile fixes)\n" +
      "Apply these known fixes proactively when the same pattern appears:\n\n" +
      approvedMigrationPatterns.map((p) =>
        `### [${p.correction_type}] ${p.explanation_tag}\n` +
        `WRONG:\n\`\`\`scl\n${p.original_snippet}\n\`\`\`\n` +
        `CORRECT:\n\`\`\`scl\n${p.corrected_snippet}\n\`\`\``
      ).join("\n\n") + "\n"
    : "";

  return `You are a Siemens S7 PLC migration expert performing a SURGICAL conversion — not a rewrite.${refBlock}${patternBlock}

CRITICAL RULE: Apply ONLY the specific migration steps listed in the user message. Every line of code
that is NOT touched by an approved step MUST be preserved character-for-character. Do not:
- Rename any variable, parameter, or block that is not in an approved NAMING step
- Restructure, reformat, or reorder any logic
- Add, remove, or change any comments
- Add REGION/END_REGION blocks unless explicitly in an approved step
- "Clean up" or "improve" anything beyond the approved steps
- Apply style guide rules unless a NAMING step is approved for this block

FLAGGING RULE: If an approved step CANNOT be applied as a direct 1:1 substitution — e.g. a system
function with no S7-1500 equivalent, absolute address with unknown symbolic meaning, or legacy
instruction requiring architectural redesign — do NOT invent a workaround. Instead:
1. Leave the original code UNCHANGED in migrated_scl
2. Prepend a single-line comment to that code: (* MIGRATION_FLAG [<id>]: <one-line issue> *)
3. Add an entry to flagged_decisions with your proposed approach for human review

Examples that must NOT be flagged (apply directly):
- S_ODT → TON / S_PULSE → TP / S_OFFDT → TOF (using pin tables above)
- S5TIME#5s → T#5s, S5TIME type → TIME type
- S_CU → CTU / S_CD → CTD / S_CUD → CTUD (using pin tables above)
- Timer R pin hardwired FALSE → omit R param entirely
- Old prefix renames (i_Start → start)
- OB start info VAR_TEMP removal

Examples that MUST be flagged:
- Timer R pin connected to real logic signal → flag (IEC has no R pin; requires IN:=FALSE workaround)
- SFC14/SFC15 (DPRD_DAT/DPWR_DAT) — needs RDREC/WRREC, hardware-specific
- Absolute M/I/Q addresses where symbolic meaning cannot be inferred
- SFB calls tied to specific hardware modules
- FB calls using DB.instance syntax where instance DB name is unknown

Reference guidance (apply ONLY when that step type is approved):
- NAMING: lowerCamelCase params, stat/temp/inst prefixes for statics/temps/instance FBs
- ADDRESSING: absolute M/I/Q addresses → flag if unknown, symbolic param if inferable
- BLOCK_CALL: FB10.DB20(...) → "#instName(...)" syntax
- DATA_TYPE: S5TIME → TIME, WORD booleans → BOOL
- OB_INTERFACE: remove S7-300 20-byte OB start info VAR_TEMP block
- SYSTEM_FUNCTION: direct replacement if one exists; flag if not

TIMER CONVERSION (S7-300 → IEC, apply when TIMER step approved):
S_ODT (On-Delay) → TON | S_PULSE (Pulse) → TP | S_OFFDT (Off-Delay) → TOF
Pin-by-pin mapping (same for all three):
  TM_NR (timer number)  → REMOVE — declare instance var in VAR_STAT/VAR: instTimerName : TON; (or TP/TOF)
  IN    (enable input)   → IN    (BOOL, same semantics)
  TV    (S5TIME preset)  → PT    (TIME, convert literal: S5TIME#5s → T#5s)
  R     (reset input)    → FLAG if R is actively used — IEC timers have no R pin; reset by setting IN:=FALSE. Auto-apply if R is always FALSE or hardwired FALSE.
  Q     (timer output)   → Q     (BOOL, same semantics)
  BI    (binary time)    → ET    (TIME, elapsed time — if BI was read, replace with ET)
  BCD   (BCD time)       → ET    (TIME — if BCD was read, replace with ET)
Call syntax change:
  OLD: S_ODT(TM_NR:=T1, IN:=start, TV:=S5TIME#10s, R:=FALSE, Q=>done, BI=>elapsed);
  NEW: #instTimer(IN:=start, PT:=T#10s); done := #instTimer.Q; elapsed := #instTimer.ET;

COUNTER CONVERSION (S7-300 → IEC, apply when COUNTER step approved):
S_CU (Count Up) → CTU | S_CD (Count Down) → CTD | S_CUD (Up/Down) → CTUD
Pin-by-pin mapping:
  CTU:  CU→CU, R→R, PV→PV, Q→Q, CV→CV
  CTD:  CD→CD, LD→LOAD, PV→PV, Q→Q, CV→CV
  CTUD: CU→CU, CD→CD, R→R, LD→LOAD, PV→PV, QU→QU, QD→QD, CV→CV
  C# literal (e.g. C#10) → PV input as INT literal (10)
  Declare instance in VAR_STAT: instCounter : CTU; (or CTD/CTUD)
Call syntax change:
  OLD: S_CU(C_NO:=C1, CU:=pulse, R:=reset, PV:=C#10, Q=>reached, CV=>count);
  NEW: #instCounter(CU:=pulse, R:=reset, PV:=10); reached := #instCounter.Q; count := #instCounter.CV;

Respond with a JSON object:
{
  "name": "<block name>",
  "block_type": "FB" | "FC" | "OB" | "DB" | "UDT",
  "original_scl": "<original unchanged>",
  "migrated_scl": "<transformed SCL — identical to original except approved changes and flag comments>",
  "approved": false,
  "changes_applied": ["<one line per direct change applied>"],
  "flagged_decisions": [
    {
      "id": "flag_1",
      "location": "<short description: e.g. 'SFC14 call in main logic section'>",
      "issue": "<why a direct substitution is not possible>",
      "original_code": "<the exact original code snippet that was left unchanged>",
      "proposed_solution": "<recommended manual approach>",
      "accepted": null
    }
  ]
}

If no flags, include "flagged_decisions": [].
Output ONLY the JSON object — no markdown fences, no explanation.`;
}

export function buildMigrationTransformUserMessage(
  blockName: string,
  scl: string,
  steps: MigrationPlanStep[],
  /** Change types already handled deterministically — exclude from AI task list */
  excludeTypes: import("@/types").MigrationChangeType[] = [],
): string {
  const relevantSteps = steps.filter(
    (s) =>
      s.block_name === blockName &&
      s.approved &&
      !s.skipped &&
      !excludeTypes.includes(s.change_type),
  );

  const stepList = relevantSteps.length
    ? relevantSteps
        .map((s) => `- [${s.change_type}] ${s.description} → Action: ${s.action}${s.note ? ` (User note: ${s.note})` : ""}`)
        .join("\n")
    : "- No steps approved for this block — return the original SCL unchanged";

  const preTransformNote =
    excludeTypes.length > 0
      ? `\nNote: ${excludeTypes.join(", ")} conversions have already been applied. Apply ONLY the remaining steps above.\n`
      : "";

  return `Transform the following block "${blockName}" according to these approved migration steps:\n\n${stepList}${preTransformNote}\n\nSCL to transform:\n\`\`\`scl\n${scl}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// 8.2b  STL → SCL transform prompt (AWL source)
// ---------------------------------------------------------------------------

export function buildMigrationSTLTransformSystemPrompt(): string {
  return `You are a Siemens S7 PLC migration expert converting legacy STL (AWL) code to S7-1500 SCL.

Your task is to produce functionally equivalent SCL code for S7-1500 / TIA Portal V20.

CONVERSION RULES:
- Convert all STL/AWL instructions to equivalent SCL statements
- Replace S7-300 timers (S_ODT, S_PULSE, S_OFFDT) with IEC equivalents (TON, TP, TOF) declared in VAR_STAT
- Replace S7-300 counters (S_CU, S_CD, S_CUD) with IEC equivalents (CTU, CTD, CTUD) declared in VAR_STAT
- Convert absolute addresses (M0.0, I0.0, Q1.1) to symbolic params/statics where name can be inferred, or leave as TODO comment
- Convert S5TIME literals to TIME (e.g. S5T#5s → T#5s)
- Use lowerCamelCase for parameter names per Siemens Style Guide V2.1
- Use # prefix for all local variables
- Declare temporary bit variables (from STL status word: A, AN, O, etc.) as TEMP BOOL
- Preserve all comments where possible

BLOCK STRUCTURE:
- FUNCTION_BLOCK → FUNCTION_BLOCK with VAR_INPUT/VAR_OUTPUT/VAR_IN_OUT/VAR_STAT/VAR_TEMP
- FUNCTION → FUNCTION ... : <return_type>
- ORGANIZATION_BLOCK → ORGANIZATION_BLOCK (no 20-byte start info)
- DATA_BLOCK → DATA_BLOCK with VAR/END_VAR

IF a section of STL cannot be reliably converted (complex bit manipulation, indirect addressing,
SFB calls, STEP 7 system functions with no S7-1500 equivalent), preserve the original STL as a
block comment (* STL: ... *) and add a TODO comment explaining what manual work is needed.

Respond with a JSON object:
{
  "name": "<block name>",
  "block_type": "FB" | "FC" | "OB" | "DB" | "UDT",
  "original_scl": "<original STL/AWL source unchanged>",
  "migrated_scl": "<converted SCL for S7-1500>",
  "approved": false,
  "changes_applied": ["<summary of conversion>"],
  "flagged_decisions": [
    {
      "id": "flag_1",
      "location": "<where in the block>",
      "issue": "<why this section could not be auto-converted>",
      "original_code": "<original STL snippet>",
      "proposed_solution": "<recommended manual approach>",
      "accepted": null
    }
  ]
}

Output ONLY the JSON object — no markdown fences, no explanation.`;
}

export function buildMigrationSTLTransformUserMessage(blockName: string, stl: string): string {
  return `Convert the following STL/AWL block "${blockName}" to S7-1500 SCL:\n\n\`\`\`\n${stl}\n\`\`\``;
}

// ---------------------------------------------------------------------------
// 8.3  Review prompt
// ---------------------------------------------------------------------------

export function buildMigrationReviewSystemPrompt(): string {
  return `You are a senior Siemens S7-1500 code reviewer. Review transformed SCL code for
correctness on S7-1500 / TIA Portal V20 and compliance with Siemens Style Guide V2.1.

Check for:
1. Any remaining S7-300/400 patterns (absolute addresses, old timers/counters, old call syntax)
2. Correct IEC timer/counter usage (proper instance declarations, TIME data types)
3. Siemens Style Guide V2.1 naming compliance
4. Missing REGION blocks for organisation
5. CASE statements without ELSE branch
6. Uninitialized static variables that could cause startup issues
7. Missing error/status outputs on FBs (PLCopen pattern: busy, done, error, status)
8. Any syntax that will not compile on S7-1500

Respond ONLY with a JSON array of findings:
[
  {
    "id": "finding_<number>",
    "block_name": "<block name>",
    "severity": "CRITICAL" | "WARNING" | "INFO",
    "description": "<what is wrong>",
    "suggestion": "<how to fix it>"
  }
]

CRITICAL = will cause compile error or runtime fault
WARNING = compiles but incorrect behaviour possible
INFO = style/best practice improvement

Output ONLY the JSON array — no markdown fences, no explanation.`;
}

export function buildMigrationReviewUserMessage(
  migratedBlocks: MigratedBlock[]
): string {
  const blockList = migratedBlocks
    .map((b) => `### ${b.name} (${b.block_type})\n\`\`\`scl\n${b.migrated_scl}\n\`\`\``)
    .join("\n\n");

  return `Review the following transformed S7-1500 blocks:\n\n${blockList}`;
}

// ---------------------------------------------------------------------------
// 8.4  Report prompt
// ---------------------------------------------------------------------------

export function buildMigrationReportSystemPrompt(): string {
  return `You are a technical documentation specialist for Siemens PLC migrations.
Generate a concise migration report in Markdown format.

The report should include:
1. Executive Summary (2-3 sentences)
2. Migration Statistics table (blocks migrated, changes applied, findings by severity)
3. Key Changes Made (grouped by change type)
4. Outstanding Issues (CRITICAL and WARNING findings that were not auto-resolved)
5. Recommendations for testing (specific test cases for the migrated logic)
6. Sign-off checklist

Use clear Markdown formatting with headers, tables, and bullet lists.
Be concise and technical — audience is automation engineers.`;
}

export function buildMigrationReportUserMessage(
  session: MigrationSession
): string {
  const blockCount = session.migrated_blocks.length;
  const criticalCount = session.review_findings.filter((f) => f.severity === "CRITICAL").length;
  const warningCount = session.review_findings.filter((f) => f.severity === "WARNING").length;
  const infoCount = session.review_findings.filter((f) => f.severity === "INFO").length;

  const changesApplied = session.migrated_blocks.flatMap((b) =>
    b.changes_applied.map((c) => `- ${b.name}: ${c}`)
  );

  return `Generate a migration report for the following migration session.

Session: ${session.name}
Blocks migrated: ${blockCount}
Analysis summary: ${session.analysis_summary ?? "N/A"}

Review findings:
- CRITICAL: ${criticalCount}
- WARNING: ${warningCount}
- INFO: ${infoCount}

Changes applied:
${changesApplied.join("\n")}

Review findings detail:
${session.review_findings.map((f) => `- [${f.severity}] ${f.block_name}: ${f.description}`).join("\n")}`;
}
