/**
 * Deterministic timer extractor. Scans parsed VAR blocks for IEC timer
 * types (TON/TOF/TP/TONR/TP_TIME/TON_TIME/TOF_TIME/IEC_TIMER/TIMER) and
 * classifies the preset source (PT) as constant / static / parameter /
 * db_field.
 *
 * See PAC_AUDIT_DERIVED_SPEC.md §7.1.
 */

import type { TimingAnalysis } from "@/types/audit";
import { parseVarBlocks, type VarDeclaration } from "@/lib/audit-analysis/interface-extractor";

// IEC timer function block types (S7-1200/1500). IEC_TIMER is the
// generic system type used by `TON_TIME` etc. once expanded.
const TIMER_TYPES = new Set([
  "TON",
  "TOF",
  "TP",
  "TONR",
  "TON_TIME",
  "TOF_TIME",
  "TP_TIME",
  "IEC_TIMER",
  "TIMER",
  "S_PULSE",
  "S_PEXT",
  "S_ODT",
  "S_ODTS",
  "S_OFFDT",
]);

type TimerEntry = NonNullable<TimingAnalysis["timers_used"]>[number];

/**
 * Return `timing_analysis.timers_used` for a block given its SCL/STL
 * source. Returns `{}` (no `timers_used`) when source yields no timer
 * declarations — caller merges with AI output for `timing_analysis.notes`.
 */
export function extractTimingAnalysis(
  source: string | null | undefined,
): TimingAnalysis {
  if (!source) return {};

  const blocks = parseVarBlocks(source);

  // Timers can appear in static VARs (instance DB-backed, typical on FB)
  // or temp VARs (rare — they'd lose state between scans and are usually
  // a bug, but we still surface them for auditor visibility).
  const allCandidates: Array<{ decl: VarDeclaration; section: "static" | "temp" }> = [
    ...blocks.static.map((d) => ({ decl: d, section: "static" as const })),
    ...blocks.temp.map((d) => ({ decl: d, section: "temp" as const })),
  ];

  const timers: TimerEntry[] = [];
  for (const { decl, section } of allCandidates) {
    const baseType = extractBaseTimerType(decl.type);
    if (!baseType) continue;
    timers.push({
      instance: decl.name,
      type: baseType,
      preset_source: classifyPresetSource(decl, source, section),
    });
  }

  // Also catch `instance-based timer calls` — e.g. `"MyTimer"(IN := ..., PT
  // := T#500ms)` where the timer was declared via `{ InstructionName :=
  // 'IEC_TIMER'} : TON;` but may not have been caught via TIMER_TYPES.
  // For v1 this is covered by the static-var scan above (TON is in the set).

  return timers.length > 0 ? { timers_used: timers } : {};
}

/**
 * Pull a known timer type out of a declaration. Handles:
 *   `TON`               → `TON`
 *   `TOF_TIME`          → `TOF_TIME`
 *   `"SystemTimers".TON`→ `TON`  (qualified reference — take the tail)
 *   `STRUCT …`          → null
 */
function extractBaseTimerType(type: string): string | null {
  const tail = type.split(".").pop()?.replace(/["'`]/g, "").trim() ?? type;
  const up = tail.toUpperCase();
  return TIMER_TYPES.has(up) ? up : null;
}

/**
 * Heuristic preset-source classification:
 *   • Declaration carries `:= (PT := <const>)` or `:= T#...`     → constant
 *   • Declaration initializer references a static var            → static
 *   • No initializer and PT wired at a visible call site:
 *       - `MyTimer(IN := ..., PT := T#…)`                        → constant
 *       - `MyTimer(IN := ..., PT := #Ivar)`                      → parameter
 *       - `MyTimer(IN := ..., PT := "DB_X".Field)`               → db_field
 *       - otherwise                                              → db_field
 *   • No visible call site                                       → db_field
 */
function classifyPresetSource(
  decl: VarDeclaration,
  source: string,
  section: "static" | "temp",
): TimerEntry["preset_source"] {
  // 1. Declaration-level initializer
  if (decl.initial) {
    const init = decl.initial.toLowerCase();
    if (/t#[\d.]+\s*(ms|s|m|h|d)/.test(init)) return "constant";
    if (/\bpt\s*:=\s*t#/.test(init)) return "constant";
    if (/\bpt\s*:=\s*#/.test(init)) return "parameter";
    if (/\bpt\s*:=\s*"[^"]+"\./.test(init)) return "db_field";
  }

  // 2. Call-site analysis. Look for `"<name>"(`, `<name>(`, or `#<name>(`
  // followed by a PT argument.
  const nameEsc = decl.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const callRe = new RegExp(
    `(?:"${nameEsc}"|#?${nameEsc})\\s*\\(([^)]*)\\)`,
    "gmi",
  );
  let m: RegExpExecArray | null;
  while ((m = callRe.exec(source)) !== null) {
    const args = m[1];
    const ptMatch = args.match(/\bPT\s*:=\s*([^,]+)/i);
    if (!ptMatch) continue;
    const ptVal = ptMatch[1].trim();
    if (/^t#/i.test(ptVal)) return "constant";
    if (/^#/.test(ptVal)) return "parameter";
    if (/^"[^"]+"\./.test(ptVal)) return "db_field";
    if (/^[A-Za-z_]\w*$/.test(ptVal)) return "static";
    return "db_field";
  }

  // 3. Temp-section timers without a PT source are almost always bugs; we
  // still classify conservatively as db_field so the auditor sees something.
  if (section === "temp") return "db_field";

  return "db_field";
}
