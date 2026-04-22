/**
 * Deterministic CASE-statement walker. Given SCL/STL source plus the
 * driving state variable (from `detectStateMachineMechanism`), pulls:
 *   • `states` — distinct arm label values (ints, names, ranges)
 *   • `transitions` — every `<stateVar> := <value>;` assignment found
 *     inside an arm body, paired with the guarding IF-stack condition
 *     (joined with AND; "always" when unconditional)
 *
 * See PAC_AUDIT_DERIVED_SPEC.md §7.1.
 */

import {
  detectStateMachineMechanism,
  type MechanismDetection,
} from "@/lib/audit-analysis/state-machine-detector";
import type { StateMachineAnalysis } from "@/types/audit";

type Transition = StateMachineAnalysis["transitions"][number];

// ---------------------------------------------------------------------------
// Local comment stripper — mirrors the detector's.
// ---------------------------------------------------------------------------

function stripSclComments(src: string): string {
  const withoutBlock = src.replace(/\(\*[\s\S]*?\*\)/g, (m) =>
    m.replace(/[^\r\n]/g, " "),
  );
  return withoutBlock.replace(/\/\/[^\r\n]*/g, "");
}

// ---------------------------------------------------------------------------
// CASE block extraction
// ---------------------------------------------------------------------------

interface CaseBody {
  stateVar: string;
  body: string;
}

/**
 * Find the first top-level `CASE <stateVar> OF` and return the body
 * between the `OF` and its matching `END_CASE`, tracking nested CASE
 * statements so we don't return at an inner END_CASE.
 */
function extractCaseBody(source: string, stateVar: string): CaseBody | null {
  const headerRe = new RegExp(
    `\\bCASE\\s+${escapeRegex(stateVar)}\\s+OF\\b`,
    "i",
  );
  const headerMatch = headerRe.exec(source);
  if (!headerMatch) return null;

  const bodyStart = headerMatch.index + headerMatch[0].length;
  const rest = source.slice(bodyStart);

  const tokenRe = /\b(CASE|END_CASE)\b/gi;
  let depth = 1;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(rest)) !== null) {
    if (m[1].toUpperCase() === "CASE") depth++;
    else if (--depth === 0) {
      return { stateVar, body: rest.slice(0, m.index) };
    }
  }
  // Unterminated CASE — rare, but surface what we have.
  return { stateVar, body: rest };
}

// ---------------------------------------------------------------------------
// Arm splitter
// ---------------------------------------------------------------------------

interface Arm {
  /** Original label string (e.g. "10", "10, 20", "Init", "1..5"). */
  labelRaw: string;
  /** One state name per distinct label value. */
  labels: string[];
  body: string;
}

/**
 * Arm labels appear on their own line: `    <labels>:` with no `:=`
 * (we must not misread an assignment as a label). An `ELSE` arm has
 * no colon.
 */
const LABEL_LINE_RE =
  /^[ \t]*([0-9A-Za-z_"#.,\s]+?)\s*:(?!=)\s*$/;
const ELSE_LINE_RE = /^[ \t]*ELSE\b.*$/i;

function splitArms(body: string): Arm[] {
  const lines = body.split(/\r?\n/);
  const arms: Arm[] = [];
  let current: Arm | null = null;

  const pushLine = (line: string) => {
    if (!current) return;
    current.body += (current.body ? "\n" : "") + line;
  };

  for (const line of lines) {
    if (ELSE_LINE_RE.test(line)) {
      if (current) arms.push(current);
      current = { labelRaw: "ELSE", labels: ["ELSE"], body: "" };
      continue;
    }
    const labelMatch = line.match(LABEL_LINE_RE);
    if (labelMatch) {
      // Guard: must not look like the *start* of an assignment spanning
      // multiple lines. If the line ended with `:=`, the earlier pattern
      // already excluded it. Still we require the label to be compact —
      // no parentheses.
      const labelText = labelMatch[1].trim();
      if (!labelText || labelText.includes("(")) {
        pushLine(line);
        continue;
      }
      if (current) arms.push(current);
      current = {
        labelRaw: labelText,
        labels: labelText.split(",").map((s) => s.trim()).filter(Boolean),
        body: "",
      };
      continue;
    }
    pushLine(line);
  }
  if (current) arms.push(current);
  return arms;
}

// ---------------------------------------------------------------------------
// Transition extraction per arm
// ---------------------------------------------------------------------------

/**
 * Walk an arm body line by line, maintaining a stack of open `IF`
 * conditions. When we hit `<stateVar> := <rhs>;`, emit a transition
 * whose `condition` is the joined AND of the stack, or "always" if the
 * stack is empty.
 *
 * Simplifications for v1:
 *   • ELSIF / ELSE branches reset the top-of-stack condition to its
 *     negation (`NOT (<prev>)`). Good enough for most SCL idioms.
 *   • FOR / WHILE loops are treated as unconditional scopes (no push).
 *   • Nested CASE inside an arm is flattened — its own transitions
 *     are reported with the outer arm's label as `from`.
 */
function extractArmTransitions(
  arm: Arm,
  stateVar: string,
): Transition[] {
  const assignRe = new RegExp(
    `\\b${escapeRegex(stateVar)}\\s*:=\\s*([^;]+);`,
    "g",
  );

  type Frame =
    | { kind: "IF"; cond: string }
    | { kind: "ELSIF"; cond: string }
    | { kind: "ELSE"; cond: string };

  const stack: Frame[] = [];
  const lines = arm.body.split(/\r?\n/);

  const from = arm.labels[0] ?? arm.labelRaw;
  const transitions: Transition[] = [];

  const joinedCondition = (): string => {
    if (stack.length === 0) return "always";
    return stack.map((f) => `(${f.cond.trim()})`).join(" AND ");
  };

  for (const line of lines) {
    // Track IF-THEN blocks.
    const ifMatch = line.match(/\bIF\s+([\s\S]*?)\bTHEN\b/i);
    if (ifMatch) {
      stack.push({ kind: "IF", cond: ifMatch[1] });
    }
    const elsifMatch = line.match(/\bELSIF\s+([\s\S]*?)\bTHEN\b/i);
    if (elsifMatch && stack.length > 0) {
      const prev = stack[stack.length - 1];
      stack[stack.length - 1] = {
        kind: "ELSIF",
        cond: `NOT (${prev.cond}) AND (${elsifMatch[1].trim()})`,
      };
    }
    if (/\bELSE\b/i.test(line) && !elsifMatch && stack.length > 0) {
      const prev = stack[stack.length - 1];
      stack[stack.length - 1] = {
        kind: "ELSE",
        cond: `NOT (${prev.cond})`,
      };
    }
    if (/\bEND_IF\s*;?/i.test(line)) {
      stack.pop();
    }

    // Assignment detection (may fire multiple times on the same line).
    assignRe.lastIndex = 0;
    let am: RegExpExecArray | null;
    while ((am = assignRe.exec(line)) !== null) {
      const to = am[1].trim();
      transitions.push({
        from,
        to,
        condition: joinedCondition(),
      });
    }
  }

  return transitions;
}

// ---------------------------------------------------------------------------
// Public entries
// ---------------------------------------------------------------------------

export interface ParsedCaseStateMachine {
  states: string[];
  transitions: Transition[];
}

/**
 * Pre-condition: caller has already determined that `stateVar` drives
 * a CASE-style state machine (via `detectStateMachineMechanism`).
 * Returns null when the CASE header can't be located.
 */
export function parseCaseStateMachine(
  source: string | null | undefined,
  stateVar: string,
): ParsedCaseStateMachine | null {
  if (!source) return null;
  const cleaned = stripSclComments(source);
  const caseBlock = extractCaseBody(cleaned, stateVar);
  if (!caseBlock) return null;

  const arms = splitArms(caseBlock.body);
  const states = new Set<string>();
  const transitions: Transition[] = [];

  for (const arm of arms) {
    for (const label of arm.labels) states.add(label);
    transitions.push(...extractArmTransitions(arm, stateVar));
  }

  return { states: [...states], transitions };
}

/**
 * Combined entry — runs the mechanism detector, then (if CASE-style)
 * the parser. Returns the `StateMachineAnalysis` shape persisted on
 * `audit_block_understanding.state_machine`, or null when no mechanism
 * fires.
 *
 * For non-CASE mechanisms (step_counter / seal_in_latch_chain /
 * other), returns a stub with empty states/transitions — the orchestrator
 * (step 10) layers AI transitions on top of that stub.
 */
export function extractStateMachine(
  source: string | null | undefined,
): (StateMachineAnalysis & { detection: MechanismDetection }) | null {
  const detection = detectStateMachineMechanism(source);
  if (!detection) return null;

  if (detection.mechanism === "case_on_variable" && detection.state_variable) {
    const parsed = parseCaseStateMachine(source, detection.state_variable);
    if (parsed) {
      return {
        mechanism: detection.mechanism,
        state_variable: detection.state_variable,
        states: parsed.states,
        transitions: parsed.transitions,
        detection,
      };
    }
  }

  return {
    mechanism: detection.mechanism,
    state_variable: detection.state_variable,
    states: [],
    transitions: [],
    detection,
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
