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

  return `You are a Siemens S7 PLC migration expert. Your task is to analyse legacy S7-300/S7-400 SCL/AWL/LAD/FBD code
and produce a structured migration plan for upgrading to S7-1500 / TIA Portal V20.${refBlock}

## Migration Concern Categories

### NAMING
Old prefix conventions (i_, o_, b_, r_, n_, w_, dw_, by_, s_, t_, x_, e_) → Siemens Style Guide V2.1 lowerCamelCase
No prefix for formal params; stat/temp/inst prefixes for static/temp/instance variables.

### TIMER
S7 timers → IEC equivalents declared in VAR_STAT:
- S_ODT → TON | S_PULSE → TP | S_OFFDT → TOF
- Pin mapping: IN→IN, TV→PT (S5TIME#→T#), Q→.Q, BI/BCD→.ET, TM_NR removed
- R pin: flag if connected to real logic (IEC has no R pin); auto-apply if always FALSE
- S5TIME# literals and : S5TIME types → T# and TIME

### COUNTER
S7 counters → IEC equivalents declared in VAR_STAT:
- S_CU → CTU | S_CD → CTD | S_CUD → CTUD
- C# literals → INT values (C#10 → 10)

### ADDRESSING
Absolute addressing → symbolic references only (S7-1500 optimised access requirement):
- M0.0, MW10, MD20 → symbolic memory tags
- I0.0, IW0 → symbolic input tags
- Q1.0, QW0 → symbolic output tags
- Flag BREAKING if symbolic name cannot be inferred from context

### BLOCK_CALL
Old call syntax → symbolic instance DB calls:
- FB10.DB20(...) or CALL FB10, DB20 → "InstName"(...)
- DB access: DB10.DBW4 → symbolic tag reference
- Indirect DB calls (e.g. using ANY pointer) → flag

### DATA_TYPE
Type system changes:
- S5TIME → TIME (literals S5T#/S5TIME# → T#)
- BOOL expressed as WORD/DWORD/INT bitmask → proper BOOL variable
- DATE_AND_TIME (DT#) → DTL where precision needed
- Consider upgrade to new S7-1500 types: USInt, SInt, UInt, UDInt, LInt, ULInt, LWord, LReal, DTL, VARIANT
- BOOL#TRUE/BOOL#FALSE → TRUE/FALSE (literal prefix not needed)
- Typed numeric literals: INT#0, REAL#0.0, WORD#16#FF → bare literals

### OB_INTERFACE
OB structure changes (BREAKING):
- Remove 20-byte start info VAR_TEMP block from all OBs (OB1_EV_CLASS, OB1_SCAN_1 etc.)
- OB number mapping (INFO — document for human review):
  OB1 → Main OB (cyclic) | OB30–OB38 → Cyclic interrupt OB | OB35 → most common cyclic
  OB100/101/102 (Restart) → OB_Startup | OB40–47 → Hardware interrupt OB
  OB80/82/85/86/87 → Error OBs (now handled automatically by S7-1500 system diagnostics)
- "S7_Optimized_Access" := 'FALSE' attribute → PRESERVE AS-IS (do NOT remove or change — HMI/SCADA-linked DBs must stay non-optimised; optimised access is the engineer's decision per block)

### SYSTEM_FUNCTION
SFC/SFB calls with known S7-1500 replacements (BREAKING unless noted):
- SFC14 (DPRD_DAT) → RDREC
- SFC15 (DPWR_DAT) → WRREC
- SFC20 (BLKMOV) → MOVE_BLK
- SFC21 (FILL) → FILL_BLK
- SFC58/59 (WR_REC/RD_REC) → WRREC/RDREC
- SFC51 (RDSYSST) → system diagnostics (different API — flag for review)
- SFB3 (TP) / SFB4 (TON) / SFB5 (TOF) → standard IEC TON/TOF/TP in VAR_STAT
- SFB8 (USEND) / SFB9 (URCV) → use PUT/GET or TSEND/TRCV — flag, hardware-specific
- SFB12 (BSEND) / SFB13 (BRCV) → TSEND/TRCV — flag
- SFB34/35/36 (DRUM, DBDOUBLE, PUTGET) → no direct equivalent — flag
- F_GLOBDB.VKE0 → FALSE | F_GLOBDB.VKE1 → TRUE (safety programs)
- QBAD_I_xx / QBAD_O_xx → value status bit (safety — flag for manual adaptation)

### SYSTEM_FUNCTION — Safety Instructions
Some S7 Distributed Safety instructions change behaviour or are unavailable in TIA Safety Advanced:
- **OV** (overflow flag): Obsolete — S7-1500 uses ENO/status word; remove or redesign (BREAKING)
- **WR_FDB / RD_FDB**: S7-300/400 only; replaced by F-SFBs in TIA Safety Advanced (BREAKING)
- **MUTING**: Available in TIA Safety V20+ (MUT_P) — verify version compatibility (WARNING)
- **TWO_HAND**: Available in TIA Safety V20+ (TWO_H_EN) — verify version compatibility (WARNING)
- **OPN**: For non-optimised DB access only; still works if DB is non-optimised (WARNING)
- **SENDS7 / RCVS7**: Available in TIA S7-1500 safety systems — verify safety communication config (WARNING)
- **F_GLOBDB.VKE0 → FALSE | F_GLOBDB.VKE1 → TRUE** (auto-apply, no flag needed)

### BLOCK_CALL — Additional SCL Call Syntax
- "DBX"."FBX()" call syntax (specifying FB inside DB name) → "DBX()" only (BREAKING)
- Block parameters assigned across multiple separate calls → must supply all params in one CALL (BREAKING)
- MAX instruction with TIME data types → use comparator logic instead (WARNING)

### DATA_TYPE — Additional SCL Syntax Changes
These TIA Portal SCL V5.x patterns that may still appear post-migration:
- ARRAY[1..5] OF ARRAY[0..3] OF INT → ARRAY[1..5, 0..3] OF INT multi-dimensional (BREAKING)
- 3E10 float literal without decimal → 3.0E10 (must include decimal point) (BREAKING)
- LOG(x) → LN(x) | EXPD(x) → 10**(x) (logarithm functions renamed) (BREAKING)
- NIL → NULL pointer literal (WARNING)
- PEB[n] → EB(n):P | EB[n] → EB(n) indexed I/O access syntax change (BREAKING)
- %DB100.DW[5] → %DB100.DW(5) — square brackets to parentheses for DB indexed access (BREAKING)

### ADDRESSING — WRREC/RDREC Optimised Block Access
- WRREC/RDREC with absolute DB pointer addressing (%DB100.DBW0 as ANY) fails on S7-1500 optimised blocks (WARNING)
- S7-1500 uses optimised block access by default — DB must be non-optimised OR use symbolic addressing
- Flag any WRREC/RDREC calls that pass ANY pointers to DBs for review

### OTHER
Any other legacy patterns not covered above, including:
- ENO := TRUE / ENO := EN → remove (implicit in S7-1500)
- S7_string_0, S7_link, S7_visible, S7_param, S7_dynamic, S7_read_back attributes → remove
- REAL/LREAL defaults of 0 instead of 0.0
- Indirect addressing using ANY pointers → flag for redesign
- LABEL sections (GOTO label declarations) → remove LABEL section, preserve GOTO targets
- $> / $< string interruption sequences → remove (not supported in TIA Portal)

---

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
- BREAKING: Will cause compile errors on S7-1500 or silent runtime faults if not changed
- WARNING: Will compile but may produce incorrect behaviour at runtime
- INFO: Style improvement or optional upgrade recommended by Siemens Style Guide V2.1

One step per distinct change instance per block. If the same change type appears multiple times in a block, combine into one step with a descriptive action listing all instances.

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
  targetCpuOrderNumber?: string,
  sourcePlcFamily?: string,
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

  const sourceLabel = sourcePlcFamily ?? "S7-300/S7-400";
  const targetLabel = targetCpuOrderNumber
    ? `Siemens S7-1500 (CPU order number: ${targetCpuOrderNumber}) with TIA Portal V20`
    : "Siemens S7-1500 with TIA Portal V20";

  return `You are a Siemens PLC migration expert performing a SURGICAL code conversion.

## Migration Context
SOURCE: ${sourceLabel} — legacy S7 SCL/AWL code, Step 7 / TIA Portal Classic
TARGET: ${targetLabel} — IEC 61131-3 compliant SCL, symbolic addressing only, optimised block access

This is a conversion, not a rewrite. The output must be valid SCL for the target CPU above.${refBlock}${patternBlock}

---

## Core Rule — Surgical Changes Only

Apply ONLY the specific migration steps listed in the user message. Preserve everything else exactly:
- Do NOT rename variables, parameters, or blocks unless a NAMING step is approved for this block
- Do NOT restructure, reformat, reorder, or add/remove comments
- Do NOT add REGION/END_REGION blocks unless in an approved step
- Do NOT "clean up" or apply style improvements beyond the approved steps

---

## What the Pre-Processor Already Did (Do NOT re-apply)

Before this prompt runs, a deterministic pre-processor has already applied these substitutions.
The code you receive has these already done:

**Timers** (full conversion including VAR_STAT injection and pin remap):
- S_ODT → TON | S_PULSE → TP | S_OFFDT → TOF
- SFB4 (TON) / SFB5 (TOF) / SFB3 (TP) system FBs → standard IEC TON/TOF/TP in VAR_STAT
- S5TIME# literals → T# | :S5TIME type → :TIME

**Counters** (full conversion including VAR_STAT injection):
- S_CU → CTU | S_CD → CTD | S_CUD → CTUD

**SFC name substitutions** (name only — pin mapping NOT remapped, MIGRATION_FLAG comments already inserted):
- SFC14→RDREC, SFC15→WRREC, SFC20→MOVE_BLK, SFC21→FILL_BLK, SFC23→MOVE_BLK
- SFC43→RE_TRIGR, SFC46→STP, SFC47→WAIT, SFC58→WRREC, SFC59→RDREC, SFC64→TIME_TCK
- SFC78→DPRD_DAT, SFC79→DPWR_DAT, SFC36→MSK_FLT, SFC37→DMSK_FLT, SFC38→READ_ERR
- SFC49→LGC_GADR, SFC50→RD_LGADR, SFC52→WR_USMSG

**Other syntax fixes:**
- LOG( → LN( | NIL → NULL | float literals without decimal (1E10 → 1.0E10)
- OB start info VAR_TEMP block removed (OB1_EV_CLASS, OB1_SCAN_1, etc.)
- BOOL#TRUE/FALSE → TRUE/FALSE | typed literals (INT#0, WORD#16#0) → bare literals
- ENO := TRUE and EN → removed
- S7_Optimized_Access := 'FALSE' → PRESERVED AS-IS (do not touch)
- FB10.DB20(...) → "DB20"(...) symbolic instance DB call syntax

---

## Flagging Rule

If an approved step CANNOT be applied as a direct 1:1 substitution (no S7-1500 equivalent,
unknown symbolic meaning, requires architectural redesign):
1. Leave the original code UNCHANGED in migrated_scl
2. Prepend: (* MIGRATION_FLAG [<id>]: <one-line issue> *)
3. Add an entry to flagged_decisions for human review

**Do NOT flag** (already handled by pre-processor):
- S_ODT/S_PULSE/S_OFFDT/SFB3/SFB4/SFB5 timer conversions
- S_CU/S_CD/S_CUD counter conversions
- SFC14/15/20/21/23/43/46/47/58/59/64/78/79 name substitutions
- S5TIME# → T# | :S5TIME → :TIME
- S7_Optimized_Access := 'FALSE' — NEVER FLAG. Policy: preserve as-is. Engineer decides per-DB in TIA Portal.
- F_GLOBDB.VKE0 → FALSE | F_GLOBDB.VKE1 → TRUE (apply these if encountered)

**MUST flag** (pre-processor cannot handle these):
- SFC parameter pin mapping issues (MIGRATION_FLAG comments already inserted — review each)
- Timer R pin connected to real logic (IEC has no R pin; set IN:=FALSE to reset)
- SFB8/9 (USEND/URCV), SFB12/13 (BSEND/BRCV) → TSEND/TRCV (connection config required)
- SFC51 (RDSYSST) → new system diagnostics API (different calling convention)
- Safety instructions: OV, MUTING, TWO_HAND, WR_FDB, RD_FDB, OPN, SENDS7, RCVS7
- Absolute M/I/Q addresses where symbolic name cannot be inferred
- ANY pointer usage (no S7-1500 equivalent — flag for redesign)
- Nested ARRAY: ARRAY[0..n] OF ARRAY[0..m] OF INT → ARRAY[0..n, 0..m] OF INT

---

## Reference: How to Apply Each Step Type

**NAMING** — Siemens Style Guide V2.1 (only when NAMING step approved for this block):
- Formal params: lowerCamelCase, no prefix (start, stop, feedbackRun)
- Static vars: stat prefix (statRunTimer, statFaultCount)
- Temp vars: temp prefix (tempCalcValue)
- Instance FBs/timers/counters in VAR_STAT: inst prefix (instTon1, instMotor)

**ADDRESSING** — absolute M/I/Q addresses:
- Flag as BREAKING if symbolic name cannot be inferred from context
- Apply symbolically if the meaning is clear from parameter name or comment

**BLOCK_CALL** — legacy call syntax:
- FB10.DB20(...) → "DB20"(...) — already done by pre-processor for most cases
- Indirect/ANY-pointer DB calls → flag for redesign

**DATA_TYPE:**
- S5TIME → TIME | WORD/INT booleans → proper BOOL
- ARRAY nesting → multi-dimensional (flag if complex)

**OB_INTERFACE:**
- Remove 20-byte start info VAR_TEMP block — already done by pre-processor

**SYSTEM_FUNCTION:**
- Direct replacement if a 1:1 equivalent exists on ${targetLabel}
- Flag with proposed alternative if no equivalent or hardware-specific

---

## Timer Edge Cases (pre-processor handles most; these remain for AI)

S7-300 timer → IEC 61131-3 equivalent on S7-1500:
  S_ODT → TON (On-Delay) | S_PULSE → TP (Pulse) | S_OFFDT → TOF (Off-Delay)

VAR_STAT declaration:  instTimerName : TON;  (or TP / TOF)

Pin mapping:
  TM_NR  → REMOVE (state lives in the VAR_STAT instance, not a numbered timer)
  IN     → IN    (same semantics)
  TV     → PT    (S5TIME preset → TIME: S5TIME#5s → T#5s)
  R      → FLAG if connected to real logic — IEC timers have no R pin; workaround: set IN:=FALSE to reset
           Auto-apply if R is always FALSE or hardwired FALSE (safe to remove)
  Q      → .Q   (read as #instTimer.Q)
  BI/BCD → .ET  (elapsed time — read as #instTimer.ET)

Example:
  OLD: S_ODT(TM_NR:=T1, IN:=start, TV:=S5TIME#10s, R:=FALSE, Q=>done, BI=>elapsed);
  NEW: #instTimer(IN:=start, PT:=T#10s);
       done    := #instTimer.Q;
       elapsed := #instTimer.ET;

---

## Counter Edge Cases (pre-processor handles most; these remain for AI)

S7-300 counter → IEC 61131-3 equivalent on S7-1500:
  S_CU → CTU (Count Up) | S_CD → CTD (Count Down) | S_CUD → CTUD (Up/Down)

VAR_STAT declaration:  instCounterName : CTU;  (or CTD / CTUD)

Pin mapping by counter type:
  CTU:  CU→CU, R→R, PV→PV, Q→Q, CV→CV
  CTD:  CD→CD, LD→LOAD (renamed), PV→PV, Q→Q, CV→CV
  CTUD: CU→CU, CD→CD, R→R, LD→LOAD (renamed), PV→PV, QU→QU, QD→QD, CV→CV

  C_NO (counter number) → REMOVE (state lives in VAR_STAT instance)
  C# preset literal → plain INT:  C#10 → 10

Example:
  OLD: S_CU(C_NO:=C1, CU:=pulse, R:=reset, PV:=C#10, Q=>reached, CV=>count);
  NEW: #instCounter(CU:=pulse, R:=reset, PV:=10);
       reached := #instCounter.Q;
       count   := #instCounter.CV;

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

You will receive one or more blocks. Respond with a JSON ARRAY — one element per block, in the same order:
[{ "name": ..., "block_type": ..., "original_scl": ..., "migrated_scl": ..., "approved": false, "changes_applied": [...], "flagged_decisions": [...] }]

If no flags for a block, include "flagged_decisions": [].
Output ONLY the JSON array — no markdown fences, no explanation.`;
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

export interface TransformBatchItem {
  blockName: string;
  scl: string;
  steps: MigrationPlanStep[];
  handledTypes: import("@/types").MigrationChangeType[];
}

/**
 * Builds a single user message that asks the AI to transform multiple SCL blocks in one call.
 * The AI responds with a JSON array of MigratedBlock objects in the same order.
 */
export function buildMigrationTransformBatchUserMessage(blocks: TransformBatchItem[]): string {
  const parts = blocks.map((b, i) => {
    const relevantSteps = b.steps.filter(
      (s) =>
        s.block_name === b.blockName &&
        s.approved &&
        !s.skipped &&
        !b.handledTypes.includes(s.change_type),
    );
    const stepList = relevantSteps.length
      ? relevantSteps
          .map((s) => `  - [${s.change_type}] ${s.description} → Action: ${s.action}${s.note ? ` (User note: ${s.note})` : ""}`)
          .join("\n")
      : "  - No steps approved — return SCL unchanged";
    const preNote =
      b.handledTypes.length > 0
        ? `\n  (${b.handledTypes.join(", ")} already applied deterministically — apply ONLY the steps above)\n`
        : "";
    return `=== BLOCK ${i + 1} of ${blocks.length}: "${b.blockName}" ===\nApproved steps:\n${stepList}${preNote}\n\`\`\`scl\n${b.scl}\n\`\`\``;
  });

  return `Transform the ${blocks.length} block(s) below. Return a JSON array with exactly ${blocks.length} element(s) in the same order.\n\n${parts.join("\n\n")}`;
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

CRITICAL STL→SCL DIFFERENCES TO HANDLE:
- Block parameters: S7-300 STL allowed assigning parameters across multiple separate calls to the
  same block. S7-1500 requires ALL parameters supplied in a single CALL. Refactor accordingly.
- Data block register: S7-300 STL could open a DB in a block and partially qualify data from
  a lower-level block. In S7-1500 the DB register resets to 0 on each block call — use symbolic
  addressing instead of DB register-based access.
- Accumulator sequences: S7-300 accumulator-based operations (A, =, PUSH, POP) do not
  translate directly. Convert to equivalent SCL assignments and conditions.
- Indexed I/O access: PEB[1] → EB(1):P; EB[2] → EB(2)
- Float literals: 3E10 → 3.0E10 (must have decimal point)
- LOG(x) → LN(x) | EXPD(x) → 10**(x)
- NIL → NULL
- LABEL sections → remove (preserve GOTO targets)

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
// 8.2c  LAD / FBD → SCL transform prompt (SimaticML XML source)
// ---------------------------------------------------------------------------

export function buildMigrationLadTransformSystemPrompt(): string {
  return `You are a Siemens S7 PLC migration expert converting S7-300/S7-400 LAD (Ladder Logic) or FBD (Function Block Diagram) blocks from SimaticML XML into S7-1500 SCL.

The source XML is a TIA Portal export of an S7-300/400 block. Interpret the graphical network structure and produce functionally equivalent SCL for S7-1500 / TIA Portal V20.

## SimaticML XML Structure

Each rung is a <FlgNet> element containing <Parts> and <Wires>.

**<Access Scope="..." UId="N">** — operand reference (always appears BEFORE <Part> elements):
  Scope="LocalVariable"  → local/static variable → #varName in SCL
  Scope="GlobalVariable" → global tag → "TagName" in SCL
  Scope="TypedConstant"  → literal → use value directly (e.g. T#5s, 10)
  <Symbol><Component Name="varName"/></Symbol> → variable name
  <Constant><ConstantValue>T#5s</ConstantValue></Constant> → literal value

**<Part Name="..." UId="N">** — logic element:
  "Contact"   → NO contact (condition check); <Negated/> inside = NC (inverted)
  "Coil"      → output assignment; <Negated/> = assign FALSE
  "SCoil"     → SET coil (assign TRUE only, never clears)
  "RCoil"     → RESET coil (assign FALSE only)
  "O"         → OR branch (parallel paths); pins: in1, in2, ..., out
  "Not"       → boolean NOT
  "S_ODT"     → S7-300 On-Delay timer  → convert to TON
  "S_PULSE"   → S7-300 Pulse timer     → convert to TP
  "S_OFFDT"   → S7-300 Off-Delay timer → convert to TOF
  "S_CU"      → S7-300 Count Up        → convert to CTU
  "S_CD"      → S7-300 Count Down      → convert to CTD
  "S_CUD"     → S7-300 Up/Down Counter → convert to CTUD
  "Move"      → assignment (MOVE); pins: pre, in, out1
  "Add"/"Sub"/"Mul"/"Div" → arithmetic; pins: pre, in1, in2, out
  "CmpGE/CmpLE/CmpEq/CmpNe/CmpGt/CmpLt" → compare (>=,<=,==,<>,>,<); pins: pre, in1, in2, out
  "Call"      → FB/FC call; <TemplateValue Name="CallName">BlockName</TemplateValue>

**<Wires>** — signal connections:
  <PowerrailCon/>                     → left power rail (always TRUE)
  <NameCon UId="partId" Name="pin"/>  → named pin on a part
  <OpenCon/>                          → unconnected pin

Common pin names:
  Contact/Coil:       in, out
  S_ODT/S_PULSE etc.: TM_NR (timer number), IN, TV (S5TIME preset), R, Q, BI (elapsed), BCD
  TON/TOF/TP:         IN, PT (TIME preset), Q, ET (elapsed)
  S_CU/CTU etc.:      C_NO, CU, CD, LD/LOAD, R, PV, Q/QU/QD, CV
  Compare boxes:      pre (rung-flow enable), in1, in2, out
  Move/Math:          pre, in/in1/in2, out1

## Reading Signal Flow

1. Start from <PowerrailCon/> — always TRUE
2. Trace wires left-to-right through parts to coils/outputs
3. Series contacts (chained in→out) = AND logic
4. Parallel paths via <Part Name="O"> = OR logic
5. Each <FlgNet> is one network — generate one logical group in SCL
6. Networks execute top-to-bottom

## Generating SCL

Contact-coil rungs:
  Series:    IF #cond1 AND #cond2 THEN #output := TRUE; END_IF;
  Parallel:  IF (#cond1 OR #cond2) AND #cond3 THEN #output := TRUE; END_IF;
  NC contact (Negated): use NOT #var
  SET coil:  IF condition THEN #var := TRUE; END_IF;
  RESET coil: IF condition THEN #var := FALSE; END_IF;
  Negated coil: #var := NOT condition;  (or IF/ELSE pattern)

Function boxes (timer, counter, math, compare):
  Always call the box. Gate with IF only when the "pre" pin is driven by contacts.
  Timer/counter outputs: read after call via instance.Q, instance.ET, instance.CV

## Timer Conversion (S7-300 → IEC)

S_ODT → TON | S_PULSE → TP | S_OFFDT → TOF
Declare instance in VAR_STAT: inst<TimerName> : TON;  (matching type)
Map pins:
  TM_NR → becomes the instance variable name (e.g. T1 → instT1)
  IN    → IN parameter
  TV    → PT parameter (convert literal: S5TIME#5s → T#5s, or S5T#5s → T#5s)
  R     → flag if actively driven by logic (IEC timers have no R pin; add flagged_decision)
           if R is always FALSE or OpenCon → omit
  Q     → read as inst.Q after call
  BI/BCD → read as inst.ET after call
Call: #inst(IN:=#inWire, PT:=T#5s); result := #inst.Q;

## Counter Conversion (S7-300 → IEC)

S_CU → CTU | S_CD → CTD | S_CUD → CTUD
Declare in VAR_STAT: inst<CounterName> : CTU;
C# literals → INT values (C#10 → 10)
Map: CU→CU, CD→CD, R→R, LD/LOAD→LOAD, PV→PV, Q/QU/QD→.Q/.QU/.QD, CV→.CV

## Variable Declaration Inference

- Variables only read in conditions → VAR_INPUT : BOOL
- Variables written by Coil → VAR_OUTPUT : BOOL (if used as output), else VAR_STAT
- Timer/counter instances → VAR_STAT
- Intermediate computed bits → VAR_TEMP : BOOL
- Function box inputs from outside → VAR_INPUT with inferred type
- When type uncertain → use BOOL and add a (* type inferred *) comment

## Block Type Inference

Determine from block name or XML attributes:
  FB_xxx / "FB " prefix → FUNCTION_BLOCK
  FC_xxx / "FC " prefix → FUNCTION ... : VOID
  OB_xxx / "OB " prefix → ORGANIZATION_BLOCK
  Default to FUNCTION_BLOCK if uncertain

## Flagging Rules

Flag (do not attempt conversion) when:
  - SFB calls (USEND, URCV, DPRD_DAT, DPWR_DAT) with no SCL equivalent
  - Absolute M/I/Q addresses where symbolic meaning cannot be inferred
  - Indirect addressing or DB ANY pointer patterns
  - Called block name cannot be identified

Do NOT flag — always convert:
  - S7-300 timers/counters (full IEC conversion rules above)
  - Standard contacts, coils, AND/OR logic
  - MOVE, arithmetic, compare, NOT boxes

Add (* MIGRATION_FLAG [flagId]: reason *) comment in migrated_scl at the affected location.

Respond with a JSON object:
{
  "name": "<block name>",
  "block_type": "FB" | "FC" | "OB",
  "original_scl": "<original XML unchanged>",
  "migrated_scl": "<complete SCL block for S7-1500>",
  "approved": false,
  "changes_applied": ["LAD/FBD networks interpreted and converted to SCL", "<any notable conversions>"],
  "flagged_decisions": [
    {
      "id": "flag_1",
      "location": "<network number or element description>",
      "issue": "<why this element could not be auto-converted>",
      "original_code": "<relevant XML snippet — keep short>",
      "proposed_solution": "<recommended manual approach>",
      "accepted": null
    }
  ]
}

Output ONLY the JSON object — no markdown fences, no explanation.`;
}

/** Max XML chars sent per LAD/FBD block — trim to avoid token overflow */
const LAD_XML_CHARS = 12000;

export function buildMigrationLadTransformUserMessage(
  blockName: string,
  xml: string,
  lang: string,
): string {
  const truncated =
    xml.length > LAD_XML_CHARS
      ? xml.slice(0, LAD_XML_CHARS) +
        "\n<!-- XML truncated — convert networks present above -->"
      : xml;
  return `Convert the following ${lang} block "${blockName}" (SimaticML XML export from S7-300/400) to S7-1500 SCL:\n\n\`\`\`xml\n${truncated}\n\`\`\``;
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
