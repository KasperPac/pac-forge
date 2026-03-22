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

// ─── OTHER: known single-token / attribute fixes ──────────────────────────────

/**
 * Apply all known deterministic fixes that fall under the "OTHER" category.
 * Each rule is a simple regex substitution — no context needed.
 *
 * Rules applied:
 *   S7_Optimized_Access := 'FALSE'  → remove attribute line (optimized is default)
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
  // Remove { S7_Optimized_Access := 'FALSE' } line — optimized is the S7-1500 default
  // (the attribute can also appear inline with other attributes; handle both forms)
  const beforeOptimized = result;
  result = result
    // Standalone attribute block on its own line
    .replace(/^[^\S\n]*\{[^}]*S7_Optimized_Access\s*:=\s*'FALSE'[^}]*\}\s*\n/gim, "")
    // Inline FALSE → TRUE inside a multi-attribute block
    .replace(/(S7_Optimized_Access\s*:=\s*)'FALSE'/gi, "$1'TRUE'");
  if (result !== beforeOptimized)
    changesApplied.push("Removed/updated S7_Optimized_Access := 'FALSE' (optimized DB)");

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

  // OTHER — known single-token/attribute fixes (DB optimized access, typed literals, etc.)
  // Always run when ANY approved steps exist — these patterns are unambiguously correct
  // and never conflict with other step types.
  if (approvedSteps.length > 0) {
    const r = transformOtherPatterns(current);
    if (r.changesApplied.length > 0) {
      current = r.scl;
      changesApplied.push(...r.changesApplied);
      // Mark OTHER as handled only if there was an explicit OTHER step approved
      if (hasType("OTHER")) handledTypes.push("OTHER");
    }
  }

  return { scl: current, changesApplied, handledTypes, flaggedComments };
}
