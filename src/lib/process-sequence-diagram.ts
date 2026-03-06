import type { ProcessSequence, TransitionCondition } from "@/types/process-builder";

/** Sanitize a string for use as a Mermaid state ID. */
function sanitizeId(str: string): string {
  return str.replace(/[^a-zA-Z0-9_]/g, "_").substring(0, 40);
}

/**
 * Escape special chars for Mermaid quoted labels.
 */
function escapeLabel(str: string): string {
  return str
    .replace(/\\/g, "")
    .replace(/"/g, "'")
    .replace(/:=/g, "=")
    .replace(/:/g, "-")
    .replace(/[#;{}]/g, "");
}

/**
 * Clean up a description for display in the diagram.
 * Strips SCL variable prefixes and syntax to show human-readable text.
 */
function cleanLabel(desc: string): string {
  let s = desc;
  s = s.replace(/\bDB_(\w+?)Inst\.(\w+)/g, "$1 $2");
  s = s.replace(/\b(?:stat|temp|inst)([A-Z])/g, "$1");
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2");
  s = s.replace(/\bTRUE\b/gi, "ON");
  s = s.replace(/\bFALSE\b/gi, "OFF");
  s = s.replace(/:=/g, "=").replace(/\s*=\s*/g, " = ");
  s = s.replace(/\b[AD][IQ]_/g, "");
  return s;
}

/** Truncate a label to maxLen, appending "..." if truncated. */
function truncate(str: string, maxLen = 45): string {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 3) + "...";
}

/** Format a transition condition as a human-readable label. */
export function formatTransitionLabel(transition: TransitionCondition, clean = false): string {
  if (transition.conditions.length === 0) return "";
  const fmt = (s: string) => truncate(clean ? cleanLabel(s) : s, 50);
  if (transition.conditions.length === 1) {
    return fmt(transition.conditions[0].description);
  }
  if (!clean) {
    return transition.conditions
      .map((c) => fmt(c.description))
      .join(transition.combinator === "AND" ? " AND " : " OR ");
  }
  const combLine = transition.combinator;
  return transition.conditions
    .map((c) => fmt(c.description))
    .join(`\n${combLine}\n`);
}

const BR = "<br/>";


/**
 * Build a Mermaid stateDiagram-v2 from a ProcessSequence.
 *
 * Steps are rendered as **parallel branches** (CASE), not a linear chain.
 * Each step fans out from the permissives/safety gate:
 *
 *   SAFETY → PERMISSIVES → Condition 1 → Actions 1
 *                        → Condition 2 → Actions 2
 *                        → Condition 3 → Actions 3
 */
export function buildSequenceDiagram(sequence: ProcessSequence): string {
  const lines: string[] = ["stateDiagram-v2"];

  // Safety conditions state
  if (sequence.safetyConditions.length > 0) {
    const parts = ["SAFETY", ...sequence.safetyConditions.map((sc) => {
      const mark = sc.polarity ? "✓" : "✗";
      return `${mark} ${truncate(escapeLabel(cleanLabel(sc.description)), 40)}`;
    })];
    lines.push(`    state "${parts.join(BR)}" as Safety`);
  }

  // Permissives state
  if (sequence.permissives.length > 0) {
    const parts = ["PERMISSIVES", ...sequence.permissives.map((p) => {
      const mark = p.polarity ? "✓" : "✗";
      return `${mark} ${truncate(escapeLabel(cleanLabel(p.description)), 40)}`;
    })];
    lines.push(`    state "${parts.join(BR)}" as Permissives`);
  }

  const hasSafety = sequence.safetyConditions.length > 0;
  const hasPermissives = sequence.permissives.length > 0;

  // Entry transitions: [*] → Safety → Permissives
  if (hasSafety) {
    lines.push(`    [*] --> Safety`);
    if (hasPermissives) {
      lines.push(`    Safety --> Permissives`);
    }
    lines.push(`    Safety --> [*] : FAULT`);
  } else if (hasPermissives) {
    lines.push(`    [*] --> Permissives`);
  }

  // The state that all steps branch from
  const branchFrom = hasPermissives ? "Permissives" : hasSafety ? "Safety" : "[*]";

  if (sequence.steps.length === 0) {
    if (branchFrom !== "[*]") {
      lines.push(`    ${branchFrom} --> [*]`);
    }
    return lines.join("\n");
  }

  // Determine if steps are parallel branches or truly sequential.
  // Heuristic: if each step has its own independent transition conditions
  // (not "after step N completes"), treat as parallel CASE branches.
  // For now we always use parallel layout since that matches PLC CASE logic.

  for (const step of sequence.steps) {
    const condId = `Cond_${sanitizeId(String(step.stepNumber))}`;
    const actionId = `Act_${sanitizeId(String(step.stepNumber))}`;

    // Condition state: shows the transition conditions
    const condParts = step.transition.conditions.length > 0
      ? step.transition.conditions.map((c) => truncate(escapeLabel(cleanLabel(c.description)), 45))
      : ["(always)"];
    if (step.transition.conditions.length > 1) {
      // Interleave combinator between conditions
      const interleaved: string[] = [];
      for (let i = 0; i < condParts.length; i++) {
        interleaved.push(condParts[i]);
        if (i < condParts.length - 1) {
          interleaved.push(step.transition.combinator);
        }
      }
      lines.push(`    state "${interleaved.join(BR)}" as ${condId}`);
    } else {
      lines.push(`    state "${condParts[0]}" as ${condId}`);
    }

    // Action state: shows what happens
    const actionParts = step.actions
      .slice(0, 4)
      .map((a) => truncate(escapeLabel(cleanLabel(a.description)), 45));
    if (step.actions.length > 4) {
      actionParts.push(`+${step.actions.length - 4} more`);
    }
    if (actionParts.length > 0) {
      lines.push(`    state "${actionParts.join(BR)}" as ${actionId}`);
    }

    // Branch from permissives/safety to condition
    lines.push(`    ${branchFrom} --> ${condId}`);

    // Condition to actions
    if (actionParts.length > 0) {
      lines.push(`    ${condId} --> ${actionId}`);
    }
  }

  return lines.join("\n");
}

/** Build diagram for the first/selected sequence from a list. */
export function buildMultiSequenceDiagram(
  sequences: ProcessSequence[],
  selectedId?: string,
): string {
  const seq = selectedId
    ? sequences.find((s) => s.id === selectedId) ?? sequences[0]
    : sequences[0];
  if (!seq) return "";
  return buildSequenceDiagram(seq);
}
