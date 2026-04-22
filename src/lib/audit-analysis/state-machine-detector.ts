/**
 * Deterministic state-machine mechanism classifier. Given SCL / STL
 * source, detect which one of three structural patterns the block
 * uses to drive state — or return null if none fire.
 *
 *   • case_on_variable   — `CASE <var> OF ... END_CASE` with arms
 *                          assigning back to `<var>`
 *   • step_counter       — `IF <var> = <n> THEN <var> := <m>`-style
 *                          counter advancement (no CASE)
 *   • seal_in_latch_chain — multiple self-referencing boolean coils
 *                          of the LAD-to-SCL seal-in pattern:
 *                          `X := (X OR <on>) AND NOT <off>`
 *
 * See PAC_AUDIT_DERIVED_SPEC.md §7.1 + §5.1.
 */

export type StateMachineMechanism =
  | "case_on_variable"
  | "seal_in_latch_chain"
  | "step_counter"
  | "other";

export interface MechanismDetection {
  mechanism: StateMachineMechanism;
  /** Variable driving the state machine, or null when unknown
   *  (seal-in chains have no single drive variable). */
  state_variable: string | null;
}

// ---------------------------------------------------------------------------
// Comment stripping — shared with interface-extractor but kept local to
// avoid cross-coupling the audit-analysis libs.
// ---------------------------------------------------------------------------

function stripSclComments(src: string): string {
  // Replace (* ... *) with equal-length whitespace to preserve offsets.
  const withoutBlock = src.replace(/\(\*[\s\S]*?\*\)/g, (m) =>
    m.replace(/[^\r\n]/g, " "),
  );
  // Drop line comments entirely.
  return withoutBlock.replace(/\/\/[^\r\n]*/g, "");
}

// ---------------------------------------------------------------------------
// Pattern matchers
// ---------------------------------------------------------------------------

/**
 * `CASE <var> OF` — captures the variable name. Handles qualified and
 * hash-prefixed variants: `CASE #Step OF`, `CASE "gDB".Step OF`.
 */
const CASE_HEADER_RE = /\bCASE\s+(#?"?[\w.]+"?)\s+OF\b/i;

/**
 * `IF <var> = <n> THEN <var> := <m>` — the same variable both
 * compared and reassigned within the same IF. We require at least two
 * occurrences to distinguish a step-counter idiom from a single guarded
 * assignment.
 */
function detectStepCounter(source: string): string | null {
  // Match all `IF <var> = <literal>` first, then check for a matching
  // assignment within a ~200-char window.
  const stepRe =
    /\bIF\s+(#?"?[\w.]+"?)\s*=\s*\d+[\s\S]{0,200}?\bTHEN\b[\s\S]{0,200}?\1\s*:=/gi;
  const counters = new Map<string, number>();
  let m: RegExpExecArray | null;
  while ((m = stepRe.exec(source)) !== null) {
    const v = m[1];
    counters.set(v, (counters.get(v) ?? 0) + 1);
  }
  // Prefer the counter with the most occurrences (≥ 2 to rule out one-off
  // guarded assignments).
  let best: { name: string; count: number } | null = null;
  for (const [name, count] of counters) {
    if (count < 2) continue;
    if (!best || count > best.count) best = { name, count };
  }
  return best?.name ?? null;
}

/**
 * Seal-in latch chains: at least 2 coils of the shape
 *   `X := (X OR <on>) AND NOT <off>;`
 *   `X := X AND NOT <reset> OR <set>;`
 *   `X := <set> OR X AND NOT <reset>;`
 *
 * One occurrence is too weak — any set/reset coil looks like this; we
 * require a chain to classify the block.
 */
function detectSealInChain(source: string): number {
  const sealRe = /\b(#?"?[\w.]+"?)\s*:=[^;]*?\b\1\b[^;]*?;/gi;
  const hits = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = sealRe.exec(source)) !== null) {
    const lhs = m[1];
    const rhs = m[0].slice(m[0].indexOf(":=") + 2);
    // Must contain the boolean shape — either AND NOT (reset-dominant)
    // or OR NOT / OR (set + maintain).
    if (/\b(AND\s+NOT|OR\s+NOT|OR)\b/i.test(rhs)) {
      hits.add(lhs);
    }
  }
  return hits.size;
}

// ---------------------------------------------------------------------------
// Public entry
// ---------------------------------------------------------------------------

/**
 * Run all three detectors in priority order. CASE wins over step-counter
 * wins over seal-in — a well-structured SCL program that uses CASE for
 * state is almost always intentional, even if some seal-in coils also
 * appear for latched bits.
 */
export function detectStateMachineMechanism(
  source: string | null | undefined,
): MechanismDetection | null {
  if (!source) return null;
  const src = stripSclComments(source);

  // 1. CASE-driven — strongest signal.
  const caseMatch = src.match(CASE_HEADER_RE);
  if (caseMatch) {
    const stateVar = caseMatch[1];
    // Confirm the arm bodies write back to the same variable; otherwise
    // the CASE is a dispatch / selector, not a state machine.
    const assignRe = new RegExp(
      `\\b${escapeRegex(stateVar)}\\s*:=`,
      "g",
    );
    const assignments = src.match(assignRe);
    if (assignments && assignments.length >= 2) {
      return { mechanism: "case_on_variable", state_variable: stateVar };
    }
    // CASE present but no write-back — still surfacing mechanism so
    // the orchestrator knows a CASE exists, just flagged as `other`.
    return { mechanism: "other", state_variable: stateVar };
  }

  // 2. Step-counter idiom.
  const counterVar = detectStepCounter(src);
  if (counterVar) return { mechanism: "step_counter", state_variable: counterVar };

  // 3. Seal-in chain — require ≥ 2 coils to avoid false positives on
  // single set/reset bits.
  const sealCount = detectSealInChain(src);
  if (sealCount >= 2) {
    return { mechanism: "seal_in_latch_chain", state_variable: null };
  }

  return null;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
