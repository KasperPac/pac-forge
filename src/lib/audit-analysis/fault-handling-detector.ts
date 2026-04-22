/**
 * Deterministic fault-handling detector. Scans block source + its
 * cross-references for fault-named symbol writes and fault-DB access
 * patterns. Returns a structured finding; the `description` prose
 * remains an AI responsibility (§7.2).
 *
 * See PAC_AUDIT_DERIVED_SPEC.md §7.1.
 */

import type { AuditCrossReference } from "@/types/audit";

export interface FaultHandlingDetection {
  /** True when any fault-pattern write or fault-DB reference was found. */
  detected: boolean;
  /** Tokens that fired (deduplicated, ordered by first occurrence). */
  patterns: string[];
  /** Fault-named symbols written by this block. */
  fault_writes: string[];
  /** Fault-DB-like targets this block touches (read or write). */
  fault_db_refs: string[];
}

// Substring patterns (case-insensitive) that identify fault-bearing symbols
// in tag / variable / DB names. Tuned for Siemens naming conventions seen
// in the audited projects (SIWAREX, Sinamics, conveyor FBs).
const FAULT_SYMBOL_PATTERNS: RegExp[] = [
  /\bFAULT(?:S|ED|ING)?\b/i,
  /\bFLT\b/i,
  /\bF_FLT\b/i,
  /\bERR(?:OR)?\b/i,
  /\bALM\b/i,
  /\bALARM(?:S|ED|ING)?\b/i,
  /\bTRIP(?:PED|S)?\b/i,
  // Prefix / suffix shapes frequently used in the codebases we audit.
  /_FLT(?:_|$)/i,
  /_FAULT(?:_|$)/i,
  /_ERR(?:_|$)/i,
  /_ALM(?:_|$)/i,
  /^FLT_/i,
  /^FAULT_/i,
  /^ERR_/i,
  /^ALM_/i,
  /^ALARM_/i,
];

const FAULT_DB_PATTERNS: RegExp[] = [
  /FAULT(?:S)?_?DB/i,
  /DB_?FAULT(?:S)?/i,
  /ALARM(?:S)?_?DB/i,
  /DB_?ALARM(?:S)?/i,
  /ERROR(?:S)?_?DB/i,
  /DB_?ERROR(?:S)?/i,
];

export interface FaultHandlingInput {
  /** Block source (SCL / STL text). Pass null/undefined to skip source scan. */
  source: string | null | undefined;
  /** Cross-references owned by this block. */
  crossReferences: AuditCrossReference[];
}

export function detectFaultHandling(input: FaultHandlingInput): FaultHandlingDetection {
  const { source, crossReferences: refs } = input;

  const patternHits = new Set<string>();
  const faultWrites = new Set<string>();
  const faultDbRefs = new Set<string>();

  // 1. Cross-reference scan — precise, stmt-anchored.
  for (const xr of refs) {
    const target = xr.target_name ?? xr.location_name ?? "";
    if (!target) continue;

    // Fault-DB — match by DB name regardless of access direction.
    for (const re of FAULT_DB_PATTERNS) {
      if (re.test(target)) {
        faultDbRefs.add(target);
        patternHits.add(re.source);
        break;
      }
    }

    // Fault-named writes specifically.
    const isWrite =
      xr.access === "Write" ||
      xr.access === "WriteAndSymbol" ||
      xr.access === "RW" ||
      xr.access === "Modify";
    if (isWrite) {
      const ref = xr.location_name ?? xr.target_name ?? "";
      for (const re of FAULT_SYMBOL_PATTERNS) {
        if (re.test(ref)) {
          faultWrites.add(ref);
          patternHits.add(re.source);
          break;
        }
      }
    }
  }

  // 2. Source scan — catches fault-bit assignments against global memory
  // that the cross-ref index may not have flagged (e.g. temp-var proxies
  // later written to global M-bits).
  if (source) {
    // Look for `<lhs> := ...;` statements where lhs contains a fault token.
    const assignRe = /^[ \t]*(#?"?[\w.[\]]+"?)\s*:=/gmi;
    let m: RegExpExecArray | null;
    while ((m = assignRe.exec(source)) !== null) {
      const lhs = m[1];
      for (const re of FAULT_SYMBOL_PATTERNS) {
        if (re.test(lhs)) {
          faultWrites.add(lhs.replace(/^#/, ""));
          patternHits.add(re.source);
          break;
        }
      }
    }
  }

  return {
    detected: faultWrites.size > 0 || faultDbRefs.size > 0,
    patterns: [...patternHits],
    fault_writes: [...faultWrites],
    fault_db_refs: [...faultDbRefs],
  };
}
