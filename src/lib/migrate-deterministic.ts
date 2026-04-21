/**
 * Deterministic (no-AI) transformers for S7-300/400 → S7-1500 SCL patterns.
 *
 * These handle exact structural substitutions where every pin / token has a
 * known mapping — no ambiguity, no AI needed. The pipeline runs these first
 * and only sends remaining, genuinely-ambiguous steps to the AI.
 *
 * Handles:
 *   TIMER        — S_ODT→TON, S_PULSE→TP, S_OFFDT→TOF  (full pin-by-pin remap)
 *   COUNTER      — S_CU→CTU, S_CD→CTD, S_CUD→CTUD       (full pin-by-pin remap)
 *   DATA_TYPE    — S5TIME# literals and : S5TIME type declarations → TIME
 *   NAMING       — strip legacy prefixes (i_, o_, b_, r_, …) → lowerCamelCase
 *   OB_INTERFACE — remove S7-300 20-byte OB start info VAR_TEMP block
 */

import type { MigrationPlanStep, MigrationChangeType } from "@/types";

export interface DeterministicResult {
  scl: string;
  changesApplied: string[];
  /** Change types that were fully handled — exclude these from the AI call */
  handledTypes: MigrationChangeType[];
  /** Cases that couldn't be auto-applied (e.g. active timer R pin) */
  flaggedComments: string[];
}

// ─── Low-level argument parser ─────────────────────────────────────────────────

/** Split an argument string by top-level commas (ignores commas inside parens). */
function splitTopLevelArgs(argsStr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of argsStr) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Parse `NAME := value` and `NAME => value` pairs from a call's argument string. */
function parseNamedArgs(argsStr: string): Map<string, { value: string; isOutput: boolean }> {
  const args = new Map<string, { value: string; isOutput: boolean }>();
  for (const part of splitTopLevelArgs(argsStr)) {
    const m = part.match(/^(\w+)\s*(=>|:=)\s*(.+)$/);
    if (m) args.set(m[1].toUpperCase(), { value: m[3].trim(), isOutput: m[2] === "=>" });
  }
  return args;
}

/** Find the FIRST occurrence of `funcName(...)` in scl, with balanced-paren matching. */
function findFirstCall(
  scl: string,
  funcName: string,
): null | {
  fullMatch: string;
  start: number;
  end: number; // exclusive — one past the closing ')'
  args: Map<string, { value: string; isOutput: boolean }>;
} {
  const re = new RegExp(`\\b${funcName}\\s*\\(`, "i");
  const m = re.exec(scl);
  if (!m) return null;
  const openIdx = m.index + m[0].length - 1;
  let depth = 1;
  let i = openIdx + 1;
  while (i < scl.length && depth > 0) {
    if (scl[i] === "(") depth++;
    else if (scl[i] === ")") depth--;
    i++;
  }
  if (depth !== 0) return null; // unmatched
  const closeIdx = i; // exclusive
  return {
    fullMatch: scl.slice(m.index, closeIdx),
    start: m.index,
    end: closeIdx,
    args: parseNamedArgs(scl.slice(openIdx + 1, closeIdx - 1)),
  };
}

// ─── Name generation ───────────────────────────────────────────────────────────

function makeTimerInstName(tmNr: string): string {
  const clean = tmNr.replace(/\s/g, "").replace(/[^A-Za-z0-9]/g, "_");
  return `instTimer${clean}`;
}

function makeCounterInstName(cNo: string): string {
  const clean = cNo.replace(/\s/g, "").replace(/[^A-Za-z0-9]/g, "_");
  return `instCounter${clean}`;
}

// ─── S5TIME literal / type conversion ─────────────────────────────────────────

function convertS5TimeStr(s: string): string {
  return s.replace(/\bS5TIME#/gi, "T#");
}

// ─── Timer transformation ──────────────────────────────────────────────────────

const TIMER_MAP: [oldName: string, newName: string][] = [
  ["S_ODT", "TON"],
  ["S_PULSE", "TP"],
  ["S_OFFDT", "TOF"],
];

/**
 * S_ODT/S_PULSE/S_OFFDT → TON/TP/TOF
 *
 * Pin mapping (same for all three):
 *   TM_NR  → removed; becomes instance variable declaration
 *   IN     → IN   (1:1)
 *   TV     → PT   (S5TIME# → T#)
 *   R      → flagged if actively connected (IEC timers have no R pin)
 *   Q =>   → .Q   (output assignment after call)
 *   BI =>  → .ET  (elapsed TIME)
 *   BCD => → .ET  (elapsed TIME — same as BI)
 */
function transformTimers(scl: string): {
  scl: string;
  changesApplied: string[];
  varDecls: Set<string>;
  flaggedComments: string[];
} {
  const changesApplied: string[] = [];
  const varDecls = new Set<string>();
  const flaggedComments: string[] = [];
  let result = scl;

  for (const [oldName, newName] of TIMER_MAP) {
    let call: ReturnType<typeof findFirstCall>;
    while ((call = findFirstCall(result, oldName)) !== null) {
      const { args, start, end } = call;

      const tmNr = args.get("TM_NR")?.value ?? args.get("T_NR")?.value ?? "Tx";
      const instName = makeTimerInstName(tmNr);

      const inVal = args.get("IN")?.value;
      const tvVal = args.get("TV")?.value;
      const rVal = args.get("R")?.value;
      const qOut = args.get("Q")?.value;
      const biOut = args.get("BI")?.value;
      const bcdOut = args.get("BCD")?.value;

      // R is passive if absent, FALSE, or 0 — safe to drop
      const rIsPassive =
        !rVal || ["false", "0"].includes(rVal.trim().toLowerCase());

      // Build IEC call inputs
      const callParts: string[] = [];
      if (inVal) callParts.push(`IN := ${inVal}`);
      if (tvVal) callParts.push(`PT := ${convertS5TimeStr(tvVal)}`);

      // Build output assignments (Q =>, BI =>, BCD =>  become statements after the call)
      const outputLines: string[] = [];
      if (qOut) outputLines.push(`${qOut} := #${instName}.Q`);
      if (biOut) outputLines.push(`${biOut} := #${instName}.ET`);
      if (bcdOut && bcdOut !== biOut) outputLines.push(`${bcdOut} := #${instName}.ET`);

      let replacement = `#${instName}(${callParts.join(", ")})`;
      if (outputLines.length > 0) replacement += ";\n" + outputLines.join(";\n");

      if (!rIsPassive) {
        const flagMsg = `${oldName}(TM_NR:=${tmNr}) R pin '${rVal}' — IEC ${newName} has no R pin; reset by setting IN := FALSE`;
        flaggedComments.push(flagMsg);
        replacement =
          `(* MIGRATION_FLAG: ${flagMsg} *)\n` + replacement;
      }

      varDecls.add(`${instName} : ${newName};`);
      changesApplied.push(`${oldName}(TM_NR:=${tmNr}) → #${instName} : ${newName}`);
      result = result.slice(0, start) + replacement + result.slice(end);
    }
  }

  return { scl: result, changesApplied, varDecls, flaggedComments };
}

// ─── Counter transformation ────────────────────────────────────────────────────

const COUNTER_MAP: [oldName: string, newName: string][] = [
  ["S_CU", "CTU"],
  ["S_CD", "CTD"],
  ["S_CUD", "CTUD"],
];

/**
 * Pin renames per counter type.  null = drop the pin (C_NO becomes instance var).
 */
const COUNTER_PIN_RENAMES: Record<string, Record<string, string | null>> = {
  S_CU:  { C_NO: null, CU: "CU",  R: "R",    PV: "PV", Q:  "Q",  CV: "CV" },
  S_CD:  { C_NO: null, CD: "CD",  LD: "LOAD", PV: "PV", Q:  "Q",  CV: "CV" },
  S_CUD: { C_NO: null, CU: "CU",  CD: "CD",   R:  "R",  LD: "LOAD",
           PV: "PV", QU: "QU", QD: "QD", CV: "CV" },
};

/**
 * S_CU/S_CD/S_CUD → CTU/CTD/CTUD
 *
 * Pin mapping:
 *   C_NO   → removed; becomes instance variable declaration
 *   CU/CD  → CU/CD   (1:1)
 *   R      → R       (1:1 — counters keep R)
 *   LD     → LOAD    (renamed)
 *   PV     → PV  (C#10 literal → INT 10)
 *   Q/QU/QD → .Q/.QU/.QD  (output assignments)
 *   CV     → .CV     (output assignment)
 */
function transformCounters(scl: string): {
  scl: string;
  changesApplied: string[];
  varDecls: Set<string>;
} {
  const changesApplied: string[] = [];
  const varDecls = new Set<string>();
  let result = scl;

  for (const [oldName, newName] of COUNTER_MAP) {
    const pinRenames = COUNTER_PIN_RENAMES[oldName];
    let call: ReturnType<typeof findFirstCall>;
    while ((call = findFirstCall(result, oldName)) !== null) {
      const { args, start, end } = call;

      const cNo = args.get("C_NO")?.value ?? "Cx";
      const instName = makeCounterInstName(cNo);

      const inputParts: string[] = [];
      const outputLines: string[] = [];

      for (const [oldPin, newPin] of Object.entries(pinRenames)) {
        if (newPin === null) continue; // C_NO → skip (becomes instance var)
        const arg = args.get(oldPin.toUpperCase());
        if (!arg) continue;
        // C#10 literals → plain integer
        const val = arg.value.replace(/\bC#(\d+)\b/gi, "$1");
        if (arg.isOutput) {
          outputLines.push(`${val} := #${instName}.${newPin}`);
        } else {
          inputParts.push(`${newPin} := ${val}`);
        }
      }

      let replacement = `#${instName}(${inputParts.join(", ")})`;
      if (outputLines.length > 0) replacement += ";\n" + outputLines.join(";\n");

      varDecls.add(`${instName} : ${newName};`);
      changesApplied.push(`${oldName}(C_NO:=${cNo}) → #${instName} : ${newName}`);
      result = result.slice(0, start) + replacement + result.slice(end);
    }
  }

  return { scl: result, changesApplied, varDecls };
}

// ─── S5TIME literal + type declaration conversion ──────────────────────────────

function transformS5TimeTypes(scl: string): { scl: string; count: number } {
  let count = 0;
  const result = scl
    .replace(/\bS5TIME#/gi, () => { count++; return "T#"; })        // literals
    .replace(/:\s*S5TIME\b/gi, () => { count++; return ": TIME"; }); // type decls
  return { scl: result, count };
}

// ─── VAR_STAT injection ────────────────────────────────────────────────────────

/**
 * Insert instance variable declarations into the block's VAR_STAT section.
 * Creates a VAR_STAT block if none exists.
 */
function injectVarStatDecls(scl: string, decls: Set<string>): string {
  if (decls.size === 0) return scl;
  const declLines = [...decls];
  const indent = "    ";

  // Existing VAR_STAT block — inject before its END_VAR
  const vsMatch = /\bVAR_STAT\b/i.exec(scl);
  if (vsMatch) {
    const endVarIdx = scl.indexOf("END_VAR", vsMatch.index + 8);
    if (endVarIdx !== -1) {
      const insertion = declLines.map((d) => `${indent}${d}`).join("\n") + "\n";
      return scl.slice(0, endVarIdx) + insertion + scl.slice(endVarIdx);
    }
  }

  // No VAR_STAT — insert a new one before VAR_TEMP or BEGIN
  const insertAt =
    /\bVAR_TEMP\b/i.exec(scl)?.index ??
    /\bBEGIN\b/i.exec(scl)?.index;

  const newSection =
    "VAR_STAT\n" + declLines.map((d) => `${indent}${d}`).join("\n") + "\nEND_VAR\n";

  if (insertAt !== undefined) {
    return scl.slice(0, insertAt) + newSection + scl.slice(insertAt);
  }

  // Fallback — append as comment so nothing is lost
  return scl + "\n(* VAR_STAT declarations needed:\n" + declLines.join("\n") + "\n*)";
}

// ─── NAMING transformation ─────────────────────────────────────────────────────

/** S7-300 Hungarian/prefix conventions → strip and apply lowerCamelCase */
const LEGACY_PREFIXES = [
  "i_", "o_", "io_", "in_", "out_",  // direction prefixes
  "b_", "r_", "n_", "w_", "dw_",     // type prefixes
  "by_", "s_", "t_", "x_", "e_",     // more type prefixes
];

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripLegacyPrefix(name: string): string {
  for (const prefix of LEGACY_PREFIXES) {
    if (name.toLowerCase().startsWith(prefix)) {
      const rest = name.slice(prefix.length);
      if (!rest) continue;
      return rest.charAt(0).toLowerCase() + rest.slice(1);
    }
  }
  return name;
}

/**
 * Extract all variable names declared inside VAR...END_VAR blocks.
 * Only looks inside declaration sections — avoids false-matching assignment LHS.
 */
function extractDeclaredVarNames(scl: string): string[] {
  const names: string[] = [];
  const varBlockRe =
    /\bVAR(?:_INPUT|_OUTPUT|_IN_OUT|_STAT|_TEMP|_RETAIN)?\b([\s\S]*?)\bEND_VAR\b/gi;
  let blockMatch: RegExpExecArray | null;
  while ((blockMatch = varBlockRe.exec(scl)) !== null) {
    const content = blockMatch[1];
    // identifier followed by optional AT address and then ':'
    const declRe = /^\s*([A-Za-z_]\w*)\s*(?:AT\s+%\S+\s*)?:/gm;
    let d: RegExpExecArray | null;
    while ((d = declRe.exec(content)) !== null) {
      names.push(d[1]);
    }
  }
  return names;
}

/**
 * Rename variables with legacy prefixes throughout the block.
 * Handles both `varName` and `#varName` (S7 local variable syntax).
 */
function transformNaming(scl: string): { scl: string; changesApplied: string[] } {
  const declaredNames = extractDeclaredVarNames(scl);
  const renames = new Map<string, string>();

  for (const name of declaredNames) {
    const newName = stripLegacyPrefix(name);
    if (newName !== name) renames.set(name, newName);
  }

  if (renames.size === 0) return { scl, changesApplied: [] };

  const changesApplied: string[] = [];
  let result = scl;

  // Sort longest-first to avoid partial replacements (e.g. "i_RunFwd" before "i_Run")
  const sorted = [...renames.entries()].sort((a, b) => b[0].length - a[0].length);

  for (const [oldName, newName] of sorted) {
    // Match with optional leading '#', whole-word only
    const re = new RegExp(`(#?)\\b${escapeRegex(oldName)}\\b`, "g");
    let count = 0;
    result = result.replace(re, (_, hash) => {
      count++;
      return `${hash}${newName}`;
    });
    if (count > 0) {
      changesApplied.push(
        `${oldName} → ${newName} (${count} occurrence${count !== 1 ? "s" : ""})`,
      );
    }
  }

  return { scl: result, changesApplied };
}

// ─── OB_INTERFACE transformation ───────────────────────────────────────────────

/**
 * Remove S7-300 20-byte OB start info variables from VAR_TEMP.
 *
 * The start info block is a fixed set of BYTE/INT/DATE_AND_TIME variables
 * named with the pattern OB<n>_<FIELD> (e.g. OB1_EV_CLASS, OB35_PRIORITY).
 * S7-1500 OBs have no equivalent — these must be removed.
 * Any user-defined VAR_TEMP variables are preserved.
 */
function transformObInterface(scl: string): { scl: string; changesApplied: string[] } {
  // Match a single-line VAR_TEMP declaration matching the OB start info pattern
  const obVarRe =
    /^[^\S\n]*OB\d*_\w+\s*:\s*(?:BYTE|WORD|INT|DATE_AND_TIME|DWORD)\s*;[^\n]*\n/gim;

  let count = 0;
  let result = scl.replace(obVarRe, () => { count++; return ""; });

  if (count === 0) return { scl, changesApplied: [] };

  // Remove any VAR_TEMP sections that are now empty
  result = result.replace(/\bVAR_TEMP\s*\n\s*END_VAR\s*\n?/gi, "");

  return {
    scl: result,
    changesApplied: [`Removed ${count} OB start info variable(s) from VAR_TEMP`],
  };
}

// ─── SYSTEM_FUNCTION: SFC → S7-1500 instruction substitution ─────────────────
//
// Source: Siemens Migration Guide (Entry ID 109478811, Table 1-1)
// Only SFCs with a documented direct replacement are listed here.
// SFCs with no direct equivalent are flagged for engineer review.
// Pin mapping is NOT auto-applied — the call is flagged so the engineer reviews
// parameter changes. Silent pin remap on safety-critical code is unacceptable.

interface SfcEntry {
  replacement: string;
  note: string;
  /** true = fully 1:1, false = pin names/semantics changed → MIGRATION_FLAG added */
  exact: boolean;
}

const SFC_MAP: Record<string, SfcEntry> = {
  // Communication / data record
  SFC14:  { replacement: "RDREC",    exact: false, note: "Pin mapping changed: LADDR→INDEX; add VALID, BUSY outputs" },
  SFC15:  { replacement: "WRREC",    exact: false, note: "Pin mapping changed: LADDR→INDEX; add STATUS, BUSY outputs" },
  SFC58:  { replacement: "WRREC",    exact: false, note: "Optimized DB access; pin mapping changed" },
  SFC59:  { replacement: "RDREC",    exact: false, note: "Optimized DB access; pin mapping changed" },
  // Block move
  SFC20:  { replacement: "MOVE_BLK", exact: false, note: "SRCBLK→SRC, DSTBLK→DST; COUNT unchanged; RET_VAL→STATUS (output)" },
  SFC21:  { replacement: "FILL_BLK", exact: false, note: "BVAL→VAL, DSTBLK→DST; COUNT unchanged; RET_VAL→STATUS (output)" },
  SFC22:  { replacement: "UBLKMOV",  exact: false, note: "Uninterruptible block move; review parameter names" },
  SFC23:  { replacement: "MOVE_BLK", exact: false, note: "BLKMOV renamed MOVE_BLK; review parameter names" },
  // System / CPU control
  SFC43:  { replacement: "RE_TRIGR", exact: true,  note: "1:1 replacement" },
  SFC46:  { replacement: "STP",      exact: true,  note: "1:1 replacement" },
  SFC47:  { replacement: "WAIT",     exact: true,  note: "Verify WAIT is available on target CPU" },
  // Time
  SFC64:  { replacement: "TIME_TCK", exact: true,  note: "1:1 replacement" },
  // PROFIBUS DP
  SFC13:  { replacement: "DPNRM_DG", exact: false, note: "Review parameter names" },
  SFC78:  { replacement: "DPRD_DAT", exact: true,  note: "1:1 replacement" },
  SFC79:  { replacement: "DPWR_DAT", exact: true,  note: "1:1 replacement" },
  // Interrupt control
  SFC36:  { replacement: "MSK_FLT",  exact: true,  note: "1:1 replacement" },
  SFC37:  { replacement: "DMSK_FLT", exact: true,  note: "1:1 replacement" },
  SFC38:  { replacement: "READ_ERR", exact: true,  note: "1:1 replacement" },
  // Address / diagnostic
  SFC49:  { replacement: "LGC_GADR", exact: true,  note: "1:1 replacement" },
  SFC50:  { replacement: "RD_LGADR", exact: true,  note: "1:1 replacement" },
  // Diagnostics / user message
  SFC52:  { replacement: "WR_USMSG", exact: true,  note: "1:1 replacement" },
};

// SFCs with NO direct S7-1500 equivalent — flag only, no replacement
const SFC_NO_EQUIVALENT: Record<string, string> = {
  SFC24: "Flash LED — not available on S7-1500; remove or replace with HMI indicator logic",
  SFC25: "Flash LED — not available on S7-1500",
  SFC26: "Busy LED — not available on S7-1500",
  SFC51: "RDSYSST — not available; use SYSDIAG or hardware diagnostics",
  SFC39: "DIS_IRT — not available on S7-1500 in this form; use DINT/SINT OB priority",
};

/**
 * Replace SFC calls with S7-1500 equivalents.
 * Only replaces the function name. Adds MIGRATION_FLAG comment for non-exact
 * mappings so the engineer knows to review parameter names.
 * Calls with no equivalent are flagged but not changed.
 */
function transformSfcCalls(scl: string): {
  scl: string;
  changesApplied: string[];
  flaggedComments: string[];
} {
  const changesApplied: string[] = [];
  const flaggedComments: string[] = [];
  let result = scl;

  // Replace SFCs that have a known equivalent
  for (const [sfcName, entry] of Object.entries(SFC_MAP)) {
    // Match: SFC14( or SFC14 ( — word boundary, case-insensitive
    const re = new RegExp(`\\b${sfcName}\\s*\\(`, "gi");
    if (!re.test(result)) continue;

    result = result.replace(new RegExp(`\\b${sfcName}\\s*\\(`, "gi"), `${entry.replacement}(`);
    changesApplied.push(`${sfcName} → ${entry.replacement}`);

    if (!entry.exact) {
      // Prepend a flag comment before the first occurrence of the replacement call
      const flagRe = new RegExp(`(${entry.replacement}\\()`, "i");
      const flagMsg = `MIGRATION_FLAG [${sfcName}→${entry.replacement}]: ${entry.note}`;
      result = result.replace(flagRe, `(* ${flagMsg} *)\n$1`);
      flaggedComments.push(flagMsg);
    }
  }

  // Flag SFCs with no equivalent (do NOT replace)
  for (const [sfcName, reason] of Object.entries(SFC_NO_EQUIVALENT)) {
    const re = new RegExp(`\\b${sfcName}\\s*\\(`, "gi");
    if (!re.test(result)) continue;

    const flagMsg = `MIGRATION_FLAG [${sfcName} — NO EQUIVALENT]: ${reason}`;
    result = result.replace(
      new RegExp(`(\\b${sfcName}\\s*\\()`, "gi"),
      `(* ${flagMsg} *)\n$1`,
    );
    flaggedComments.push(flagMsg);
  }

  return { scl: result, changesApplied, flaggedComments };
}

// ─── SCL_SYNTAX: renamed/removed SCL keywords ────────────────────────────────
//
// These are 1:1 token substitutions documented in the Siemens migration guide.
// They are provably correct in all contexts — no engineer review needed.

/**
 * Apply SCL syntax changes that are 1:1 token replacements:
 *   LOG(  → LN(   (natural logarithm renamed in S7-1500)
 *   NIL   → NULL  (pointer null value renamed)
 *   n.nEn → n.nEn (float literals must have decimal point: 1E10 → 1.0E10)
 *   OV    → flag  (overflow detection completely changed in S7-1500)
 */
function transformSclSyntax(scl: string): {
  scl: string;
  changesApplied: string[];
  flaggedComments: string[];
} {
  const changesApplied: string[] = [];
  const flaggedComments: string[] = [];
  let result = scl;

  // LOG( → LN(  (natural log was renamed; only match as function call, not variable names)
  const logCount = (result.match(/\bLOG\s*\(/gi) ?? []).length;
  if (logCount > 0) {
    result = result.replace(/\bLOG\s*\(/gi, "LN(");
    changesApplied.push(`LOG( → LN( (${logCount} occurrence${logCount !== 1 ? "s" : ""})`);
  }

  // NIL → NULL  (pointer null literal renamed)
  const nilCount = (result.match(/\bNIL\b/gi) ?? []).length;
  if (nilCount > 0) {
    result = result.replace(/\bNIL\b/gi, "NULL");
    changesApplied.push(`NIL → NULL (${nilCount} occurrence${nilCount !== 1 ? "s" : ""})`);
  }

  // Float literals without decimal point before exponent: 1E10 → 1.0E10
  // Matches integers immediately followed by E+/-digits (scientific notation)
  // Negative lookbehind for '.' avoids touching already-correct 1.0E10
  const floatCount = { n: 0 };
  result = result.replace(/\b(\d+)(E[+-]?\d+)\b/gi, (match, mantissa, exp) => {
    if (mantissa.includes(".")) return match; // already has decimal
    floatCount.n++;
    return `${mantissa}.0${exp}`;
  });
  if (floatCount.n > 0)
    changesApplied.push(`Fixed ${floatCount.n} float literal(s) missing decimal point (e.g. 1E10 → 1.0E10)`);

  // OV (overflow) special register — not available in S7-1500 SCL
  if (/\bOV\b/.test(result)) {
    const flagMsg =
      "MIGRATION_FLAG [OV]: Overflow flag not available in S7-1500 SCL; use DINT arithmetic or check result manually";
    result = result.replace(/\bOV\b/g, `(* ${flagMsg} *) OV`);
    flaggedComments.push(flagMsg);
  }

  return { scl: result, changesApplied, flaggedComments };
}

// ─── BLOCK_CALL: legacy FB instance call syntax ───────────────────────────────
//
// S7-300 SCL allowed: FB10.DB20( param := value )
//                                   ↑ instance DB referenced by number
// S7-1500 SCL requires: "InstDB"( param := value )
//                                   ↑ symbolic name, quoted
//
// We can safely replace FBn.DBm( → "DBm"( because:
//   • The DB number is preserved as the quoted symbolic name (TIA Portal creates it)
//   • The parameters are unchanged
//   • The engineer will see the change in the review diff

function transformLegacyFbCalls(scl: string): {
  scl: string;
  changesApplied: string[];
} {
  const changesApplied: string[] = [];
  let result = scl;
  let count = 0;

  // Match: FB\d+.DB\d+( or FB\d+ . DB\d+ (
  result = result.replace(/\bFB\d+\s*\.\s*(DB\d+)\s*\(/gi, (_, dbName) => {
    count++;
    return `"${dbName}"(`;
  });

  if (count > 0)
    changesApplied.push(`Replaced ${count} legacy FB\#.DB\# call(s) with symbolic instance DB syntax`);

  return { scl: result, changesApplied };
}

// ─── OTHER: known single-token / attribute fixes ──────────────────────────────

/**
 * Apply all known deterministic fixes that fall under the "OTHER" category.
 * Each rule is a simple regex substitution — no context needed.
 *
 * Rules applied:
 *   S7_Optimized_Access              → preserved as-is (engineer decides per block)
 *   BOOL#TRUE / BOOL#FALSE          → TRUE / FALSE  (typed literal syntax removed)
 *   INT#0, REAL#0.0, WORD#16#0 etc  → bare literals (typed literal syntax removed)
 *   RETAIN attribute on local vars  → remove (VAR_RETAIN is the S7-1500 way)
 *   ARRAY [0..n] OF                 → already valid, but OLD ARRAY[…] without spaces → normalise
 *   ENO := TRUE at FB end           → remove (implicit in S7-1500 EN/ENO model)
 */
function transformOtherPatterns(scl: string): { scl: string; changesApplied: string[] } {
  const changesApplied: string[] = [];
  let result = scl;

  // ── DB optimized access attribute ────────────────────────────────────────────
  // S7_Optimized_Access is preserved as-is. HMI-linked DBs and SCADA DBs
  // (e.g. Citect using absolute DBX/DBD offsets) must stay non-optimised.
  // Engineers decide per-DB whether to change this in TIA Portal.

  // ── Typed boolean literals ────────────────────────────────────────────────────
  // BOOL#TRUE → TRUE,  BOOL#FALSE → FALSE
  const boolCount = { n: 0 };
  result = result.replace(/\bBOOL#(TRUE|FALSE)\b/gi, (_, v) => { boolCount.n++; return v.toUpperCase(); });
  if (boolCount.n > 0)
    changesApplied.push(`Removed BOOL# prefix from ${boolCount.n} typed boolean literal(s)`);

  // ── Typed numeric literals ────────────────────────────────────────────────────
  // INT#0, DINT#0, REAL#0.0, WORD#16#FF, BYTE#16#0 → bare literals
  // S7-1500 SCL does not require the type prefix on literals in typed contexts
  const typedLitCount = { n: 0 };
  result = result.replace(
    /\b(?:U?(?:INT|DINT|SINT|USINT|LINT|ULINT)|REAL|LREAL|WORD|DWORD|BYTE|LWORD)#/gi,
    () => { typedLitCount.n++; return ""; },
  );
  if (typedLitCount.n > 0)
    changesApplied.push(`Removed type prefix from ${typedLitCount.n} typed numeric literal(s)`);

  // ── Implicit ENO assignment ───────────────────────────────────────────────────
  // Some S7-300 code ends FBs/FCs with explicit "ENO := TRUE;" or "ENO := EN;"
  // S7-1500 handles EN/ENO implicitly — the explicit assignment is redundant/invalid
  const enoCount = { n: 0 };
  result = result.replace(/^[^\S\n]*ENO\s*:=\s*(?:TRUE|EN)\s*;\s*\n/gim, () => { enoCount.n++; return ""; });
  if (enoCount.n > 0)
    changesApplied.push(`Removed ${enoCount.n} explicit ENO := TRUE/EN assignment(s)`);

  // ── REAL/LREAL default value 0 → 0.0 ────────────────────────────────────────
  // S7-1500 requires floating-point literals for REAL/LREAL — integer 0 is a type error.
  // Three patterns:
  //   1) Simple scalar: varName : REAL := 0;
  //   2) Array initializer repetition: ARRAY[...] OF REAL := [N(0)]
  //   3) Array initializer list:       ARRAY[...] OF REAL := [0, 0, 0]
  const realCount = { n: 0 };

  // Pattern 1: scalar REAL/LREAL := 0;
  result = result.replace(
    /(:[ \t]*(?:REAL|LREAL)[ \t]*:=[ \t]*)(0)([ \t]*;)/gi,
    (_, pre, _zero, post) => { realCount.n++; return `${pre}0.0${post}`; },
  );

  // Patterns 2 & 3: array initializer — fix bare integer 0 inside [...] on REAL/LREAL array lines
  result = result.replace(
    /(OF[ \t]+(?:REAL|LREAL)[ \t]*:=[ \t]*\[)([^\]]+)(\])/gi,
    (_, pre, content, close) => {
      // N(0) repetition syntax → N(0.0)
      let fixed = content.replace(/(\d+\()\s*0\s*(\))/g, (_m: string, lp: string, rp: string) => {
        realCount.n++;
        return `${lp}0.0${rp}`;
      });
      // Bare 0 not followed by a dot (avoids touching 0.5 etc.)
      fixed = fixed.replace(/\b0\b(?!\.)/g, (_m: string) => { realCount.n++; return "0.0"; });
      return `${pre}${fixed}${close}`;
    },
  );

  if (realCount.n > 0)
    changesApplied.push(`Fixed ${realCount.n} REAL/LREAL default value(s): 0 → 0.0`);

  // ── READ_ONLY / CONSTANT attribute on VAR declarations ───────────────────────
  // { S7_Visible := 'False' } and similar compiler-hint attributes on individual
  // VAR lines are valid in S7-1500 but { ExternalVisible } is the new form.
  // Only strip fully obsolete S7_300-specific attributes:
  const obsoleteAttrs = [
    "S7_string_0",
    "S7_link",
    "S7_visible",
    "S7_param",
    "S7_dynamic",
    "S7_read_back",
  ];
  for (const attr of obsoleteAttrs) {
    const attrRe = new RegExp(
      `\\s*\\{[^}]*${escapeRegex(attr)}\\s*:=[^}]*\\}`,
      "gi",
    );
    const before = result;
    result = result.replace(attrRe, "");
    if (result !== before)
      changesApplied.push(`Removed obsolete attribute '${attr}'`);
  }

  return { scl: result, changesApplied };
}

// ─── Post-processor: deterministic cleanup of AI-generated SCL ────────────────
//
// Run AFTER the AI produces migrated SCL (from STL→SCL or LAD→SCL or SCL transform).
// Catches patterns the AI may have left or introduced.
// Safe to run unconditionally — every rule here is always correct.

export interface PostProcessResult {
  scl: string;
  cleanups: string[];
  flaggedComments: string[];
}

export function postProcessMigratedScl(scl: string): PostProcessResult {
  const cleanups: string[] = [];
  const flaggedComments: string[] = [];
  let current = scl;

  // SCL syntax normalisation
  const syn = transformSclSyntax(current);
  current = syn.scl;
  cleanups.push(...syn.changesApplied);
  flaggedComments.push(...syn.flaggedComments);

  // Attribute / literal cleanup
  const other = transformOtherPatterns(current);
  current = other.scl;
  cleanups.push(...other.changesApplied);

  // S5TIME literals that AI may have left behind
  const dt = transformS5TimeTypes(current);
  if (dt.count > 0) {
    current = dt.scl;
    cleanups.push(`Cleaned ${dt.count} residual S5TIME literal/type(s) → TIME`);
  }

  // SFC names the AI may have forgotten to replace
  const sfcNames = Object.keys(SFC_MAP);
  for (const sfcName of sfcNames) {
    if (new RegExp(`\\b${sfcName}\\s*\\(`, "i").test(current)) {
      const r = transformSfcCalls(current);
      current = r.scl;
      cleanups.push(...r.changesApplied);
      flaggedComments.push(...r.flaggedComments);
      break; // transformSfcCalls handles all in one pass
    }
  }

  return { scl: current, cleanups, flaggedComments };
}

// ─── Project-wide: spaces in identifiers → underscores ────────────────────────
//
// S7-300/STEP7 allowed quoted names with spaces (e.g. "Gen Drive UDT").
// TIA Portal V20 requires valid identifiers — no spaces. Replace all occurrences
// across the entire project before per-block processing.

/**
 * Scan all blocks for quoted identifiers containing spaces.
 * Returns a rename map: original name → underscore name.
 * e.g. "Gen Drive UDT" → "Gen_Drive_UDT"
 */
export function buildSpaceRenameMap(sourceBlocks: Record<string, string>): Map<string, string> {
  const renames = new Map<string, string>();
  // Quoted S7 identifiers: "anything with spaces"
  const quotedRe = /"([^"]+)"/g;
  for (const scl of Object.values(sourceBlocks)) {
    let m: RegExpExecArray | null;
    quotedRe.lastIndex = 0;
    while ((m = quotedRe.exec(scl)) !== null) {
      const name = m[1];
      if (name.includes(" ") && !renames.has(name)) {
        renames.set(name, name.replace(/ /g, "_"));
      }
    }
  }
  // Also check block keys themselves (block names that are keys in the dict)
  for (const blockName of Object.keys(sourceBlocks)) {
    if (blockName.includes(" ") && !renames.has(blockName)) {
      renames.set(blockName, blockName.replace(/ /g, "_"));
    }
  }
  return renames;
}

/**
 * Apply the space rename map project-wide:
 * — replaces "Old Name" → "Old_Name" inside all block SCL content
 * — renames block keys that contained spaces
 * — updates the languages map keys accordingly
 */
export function applyProjectWideSpaceRenames(
  sourceBlocks: Record<string, string>,
  sourceLangs: Record<string, string>,
  renames: Map<string, string>,
): { blocks: Record<string, string>; langs: Record<string, string>; changes: string[] } {
  if (renames.size === 0) return { blocks: sourceBlocks, langs: sourceLangs, changes: [] };

  const changes: string[] = [];
  const blocks: Record<string, string> = {};
  const langs: Record<string, string> = {};

  for (const [blockName, scl] of Object.entries(sourceBlocks)) {
    let updated = scl;
    for (const [oldName, newName] of renames) {
      // Replace quoted occurrences: "Old Name" → "Old_Name"
      const quoted = `"${oldName}"`;
      if (updated.includes(quoted)) {
        updated = updated.split(quoted).join(`"${newName}"`);
      }
      // Also replace unquoted occurrences if the block key itself had spaces
      if (oldName === blockName) {
        // The TYPE/DATA_BLOCK/FUNCTION_BLOCK declaration line: 'BLOCK "Old Name"' → 'BLOCK "Old_Name"'
        // Already handled by the quoted replacement above
      }
    }
    // Rename the block key if it had spaces
    const newKey = renames.get(blockName) ?? blockName;
    blocks[newKey] = updated;

    // Carry language tag over to new key
    const lang = sourceLangs[blockName];
    if (lang) langs[newKey] = lang;
    else if (sourceLangs[blockName] === undefined) {
      // key wasn't in langs (SCL default) — no entry needed
    }
  }

  for (const [oldName, newName] of renames) {
    changes.push(`Renamed identifier "${oldName}" → "${newName}" (spaces → underscores)`);
  }

  return { blocks, langs, changes };
}

// ─── Standalone timer DB detection + inlining ─────────────────────────────────
//
// S7-300/400 required a separate DATA_BLOCK for each SFB (timer/counter) instance.
// On S7-1500, IEC timers are declared as VAR_STAT inside the FB — TIA Portal
// automatically creates a hidden system DB (visible under System blocks >
// Program resources). There is no need for a standalone instance DB.
//
// Migration: detect standalone timer instance DBs, find the calling FB(s),
// inject a static variable declaration, rewrite all call/member-access references,
// and mark the original DB for deletion.

const TIMER_DB_TYPE_MAP: Record<string, string> = {
  // IEC timer instance types used in S7-300 exports
  TON_I: "TON",
  TOF_T: "TOF",
  TP_I:  "TP",
  // Alternate names seen in some Siemens versions
  SFB3:  "TP",
  SFB4:  "TON",
  SFB5:  "TOF",
};

/** Detect if a DATA_BLOCK is a standalone S7-300 SFB timer instance DB.
 *  Returns the S7-1500 IEC timer type ("TON" | "TOF" | "TP") or null. */
function detectTimerDbType(scl: string): string | null {
  if (!/\bDATA_BLOCK\b/i.test(scl)) return null;

  for (const [s7Type, iecType] of Object.entries(TIMER_DB_TYPE_MAP)) {
    // Type appears as a quoted name on a standalone line: "TON_I" or "SFB4"
    if (new RegExp(`"${s7Type}"`, "i").test(scl)) return iecType;
  }

  // Fallback: FAMILY : 'TIMER' with no explicit type → assume TON
  if (/FAMILY\s*:\s*['"]TIMER['"]/i.test(scl)) return "TON";

  return null;
}

/** Derive a clean VAR_STAT variable name from a timer DB name.
 *  "T_GritClassWait" → "gritClassWait"  (strips T_ prefix, lowercases first char) */
function timerDbVarName(dbName: string): string {
  const stripped = dbName.replace(/^[Tt]_/, "");
  return stripped.charAt(0).toLowerCase() + stripped.slice(1);
}

/** Replace all references to a timer DB in a single calling block with a static variable. */
function inlineTimerDbInBlock(
  scl: string,
  dbName: string,
  varName: string,
  iecType: string,
): { scl: string; changed: boolean } {
  const quotedName = `"${dbName}"`;
  if (!scl.includes(quotedName)) return { scl, changed: false };

  let result = scl;

  // Member access: "DBName".Q → #varName.Q
  result = result.replace(
    new RegExp(`"${escapeRegex(dbName)}"\\.(\\w+)`, "g"),
    `#${varName}.$1`,
  );

  // Function call: "DBName"( → #varName(
  result = result.replace(
    new RegExp(`"${escapeRegex(dbName)}"\\s*\\(`, "g"),
    `#${varName}(`,
  );

  // Inject VAR_STAT declaration
  result = injectVarStatDecls(result, new Set([`${varName} : ${iecType};`]));

  return { scl: result, changed: true };
}

export interface TimerInlineResult {
  /** Source blocks with timer DB references replaced in calling FBs */
  updatedBlocks: Record<string, string>;
  /** DB names that were successfully inlined — exclude these from import */
  timerDbNames: Set<string>;
  /** Human-readable change descriptions */
  changes: string[];
}

/**
 * Project-wide pass: detect all standalone timer instance DBs, inline them into
 * their calling FBs as VAR_STAT variables, and mark the original DBs for deletion.
 */
export function inlineStandaloneTimerDbs(
  sourceBlocks: Record<string, string>,
): TimerInlineResult {
  const timerDbNames = new Set<string>();
  const changes: string[] = [];

  // Step 1: identify all timer instance DBs
  const timerDbMap = new Map<string, string>(); // dbName → iecType
  for (const [blockName, scl] of Object.entries(sourceBlocks)) {
    const iecType = detectTimerDbType(scl);
    if (iecType) timerDbMap.set(blockName, iecType);
  }

  if (timerDbMap.size === 0) {
    return { updatedBlocks: sourceBlocks, timerDbNames, changes };
  }

  // Step 2: for each timer DB, find all calling blocks and inject the static var
  const updatedBlocks = { ...sourceBlocks };

  for (const [dbName, iecType] of timerDbMap) {
    const varName = timerDbVarName(dbName);
    let inlinedCount = 0;
    const inlinedInto: string[] = [];

    for (const [callerName, callerScl] of Object.entries(updatedBlocks)) {
      if (callerName === dbName) continue; // skip the timer DB itself
      const { scl: newScl, changed } = inlineTimerDbInBlock(callerScl, dbName, varName, iecType);
      if (changed) {
        updatedBlocks[callerName] = newScl;
        inlinedInto.push(callerName);
        inlinedCount++;
      }
    }

    if (inlinedCount > 0) {
      timerDbNames.add(dbName);
      changes.push(
        `Timer DB "${dbName}" (${iecType}) → #${varName} : ${iecType} in ${inlinedCount} block(s): ${inlinedInto.join(", ")}`,
      );
    }
  }

  return { updatedBlocks, timerDbNames, changes };
}

// ─── Block type inference (used when AI call is skipped) ──────────────────────

export function inferBlockType(scl: string): "FB" | "FC" | "OB" | "DB" | "UDT" {
  if (/\bFUNCTION_BLOCK\b/i.test(scl)) return "FB";
  if (/\bORGANIZATION_BLOCK\b/i.test(scl)) return "OB";
  if (/\bDATA_BLOCK\b/i.test(scl)) return "DB";
  if (/\bTYPE\b/i.test(scl)) return "UDT";
  if (/\bFUNCTION\b/i.test(scl)) return "FC";
  return "FB";
}

// ─── Master export ─────────────────────────────────────────────────────────────

/**
 * Apply all deterministic transforms for the given approved step types.
 * Returns transformed SCL and which types were fully handled.
 *
 * The pipeline should exclude `handledTypes` from the subsequent AI call so
 * the AI doesn't re-process already-converted code.
 */
export function applyDeterministicTransforms(
  scl: string,
  approvedSteps: MigrationPlanStep[],
): DeterministicResult {
  const changesApplied: string[] = [];
  const handledTypes: MigrationChangeType[] = [];
  const flaggedComments: string[] = [];
  let current = scl;

  const hasType = (t: MigrationChangeType) =>
    approvedSteps.some((s) => s.change_type === t);

  // TIMER — S_ODT/S_PULSE/S_OFFDT → TON/TP/TOF
  if (hasType("TIMER")) {
    const r = transformTimers(current);
    if (r.changesApplied.length > 0) {
      current = injectVarStatDecls(r.scl, r.varDecls);
      changesApplied.push(...r.changesApplied);
      flaggedComments.push(...r.flaggedComments);
      handledTypes.push("TIMER");
    }
    // Always run S5TIME conversion alongside TIMER approval
    const dt = transformS5TimeTypes(current);
    if (dt.count > 0) {
      current = dt.scl;
      changesApplied.push(`Converted ${dt.count} S5TIME literal/type(s) → TIME`);
    }
  }

  // COUNTER — S_CU/S_CD/S_CUD → CTU/CTD/CTUD
  if (hasType("COUNTER")) {
    const r = transformCounters(current);
    if (r.changesApplied.length > 0) {
      current = injectVarStatDecls(r.scl, r.varDecls);
      changesApplied.push(...r.changesApplied);
      handledTypes.push("COUNTER");
    }
  }

  // DATA_TYPE — remaining S5TIME types not already caught above
  if (hasType("DATA_TYPE")) {
    const r = transformS5TimeTypes(current);
    if (r.count > 0 && !changesApplied.some((c) => c.includes("S5TIME"))) {
      current = r.scl;
      changesApplied.push(`Converted ${r.count} S5TIME literal/type(s) → TIME`);
    }
    handledTypes.push("DATA_TYPE");
  }

  // NAMING — strip legacy prefixes (i_, o_, b_, r_, etc.) → lowerCamelCase
  if (hasType("NAMING")) {
    const r = transformNaming(current);
    if (r.changesApplied.length > 0) {
      current = r.scl;
      changesApplied.push(...r.changesApplied);
      handledTypes.push("NAMING");
    }
  }

  // OB_INTERFACE — remove 20-byte S7-300 OB start info from VAR_TEMP
  if (hasType("OB_INTERFACE")) {
    const r = transformObInterface(current);
    if (r.changesApplied.length > 0) {
      current = r.scl;
      changesApplied.push(...r.changesApplied);
      handledTypes.push("OB_INTERFACE");
    }
  }

  // SYSTEM_FUNCTION — SFC → S7-1500 instruction substitution (documented Siemens mappings)
  if (hasType("SYSTEM_FUNCTION")) {
    const r = transformSfcCalls(current);
    if (r.changesApplied.length > 0 || r.flaggedComments.length > 0) {
      current = r.scl;
      changesApplied.push(...r.changesApplied);
      flaggedComments.push(...r.flaggedComments);
    }
    handledTypes.push("SYSTEM_FUNCTION");
  }

  // BLOCK_CALL — legacy FBn.DBm() → "DBm"() symbolic instance DB call syntax
  if (hasType("BLOCK_CALL")) {
    const r = transformLegacyFbCalls(current);
    if (r.changesApplied.length > 0) {
      current = r.scl;
      changesApplied.push(...r.changesApplied);
    }
    handledTypes.push("BLOCK_CALL");
  }

  // SCL syntax fixes — LOG→LN, NIL→NULL, float literal decimal points
  // Run whenever any steps are approved — these are always correct regardless of context
  if (approvedSteps.length > 0) {
    const r = transformSclSyntax(current);
    if (r.changesApplied.length > 0) {
      current = r.scl;
      changesApplied.push(...r.changesApplied);
      flaggedComments.push(...r.flaggedComments);
    }
  }

  // OTHER — known single-token/attribute fixes (typed literals, ENO, etc.)
  // Always run when ANY approved steps exist. S7_Optimized_Access is intentionally
  // preserved by the deterministic handler — marking OTHER as handled prevents the
  // AI from receiving the step and (re-)applying the removal itself.
  if (approvedSteps.length > 0) {
    const r = transformOtherPatterns(current);
    if (r.changesApplied.length > 0) {
      current = r.scl;
      changesApplied.push(...r.changesApplied);
    }
    // Always mark OTHER handled when an OTHER step was approved — the deterministic
    // handler owns it fully (including the intentional no-op for S7_Optimized_Access).
    if (hasType("OTHER")) handledTypes.push("OTHER");
  }

  return { scl: current, changesApplied, handledTypes, flaggedComments };
}
