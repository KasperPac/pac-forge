import type { ProcessSequence, ProcessStep, TransitionCondition } from "@/types/process-builder";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Escape special characters for Mermaid quoted labels. */
function escapeLabel(str: string): string {
  return str
    .replace(/\\/g, "")
    .replace(/"/g, "'")
    .replace(/:=/g, "=")
    .replace(/:/g, "-")
    .replace(/[#;{}()[\]]/g, "");
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

/** Build the title line for a step node. */
function stepTitle(step: ProcessStep): string {
  const actions = step.actions ?? [];
  if (actions.length === 0) return `Step ${step.stepNumber}`;
  return `Step ${step.stepNumber}: ${cleanLabel(actions[0].description)}`;
}

/** Format a transition condition for an arrow label. */
export function formatTransitionLabel(transition: TransitionCondition, clean = false): string {
  const conditions = transition.conditions ?? [];
  if (conditions.length === 0) return "";
  const fmt = (s: string) => clean ? cleanLabel(s) : s;
  if (conditions.length === 1) {
    return fmt(conditions[0].description);
  }
  return conditions
    .map((c) => fmt(c.description))
    .join(transition.combinator === "AND" ? " ∧ " : " ∨ ");
}

const BR = "<br/>";

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Build a Mermaid flowchart TD from a ProcessSequence.
 *
 * Steps are rendered as a sequential top-down flow:
 *   Safety → Permissives → Step 10 → Step 20 → ... → Idle
 *
 * OR transitions produce branching paths that rejoin at the next step.
 * Fault exits are shown as red-labeled arrows to a Fault node.
 */
export function buildSequenceDiagram(sequence: ProcessSequence): string {
  const lines: string[] = ["flowchart TD"];
  let faultNodeAdded = false;

  // --- Safety conditions node ---
  const hasSafety = (sequence.safetyConditions ?? []).length > 0;
  if (hasSafety) {
    const safetyText = sequence.safetyConditions
      .map(sc => {
        const mark = sc.polarity ? "✓" : "✗";
        return `${mark} ${escapeLabel(cleanLabel(sc.description))}`;
      })
      .join(BR);
    lines.push(`    Safety{{"SAFETY${BR}${safetyText}"}}`);
    lines.push(`    Start(( )) --> Safety`);
    lines.push(`    Safety -->|Fail| Fault[/"⚠ FAULT"/]`);
    faultNodeAdded = true;
  }

  // --- Permissives node ---
  const hasPerm = (sequence.permissives ?? []).length > 0;
  if (hasPerm) {
    const permText = sequence.permissives
      .map(p => {
        const mark = p.polarity ? "✓" : "✗";
        return `${mark} ${escapeLabel(cleanLabel(p.description))}`;
      })
      .join(BR);
    lines.push(`    Perm{{"PERMISSIVES${BR}${permText}"}}`);

    if (hasSafety) {
      lines.push(`    Safety -->|All OK| Perm`);
    } else {
      lines.push(`    Start(( )) --> Perm`);
    }
    lines.push(`    Perm -->|Fail| Idle([Idle])`);
  }

  // --- Entry point for first step ---
  let prevNode = hasPerm ? "Perm" : hasSafety ? "Safety" : "Start(( ))";
  let prevLabel = hasPerm ? "Pass" : hasSafety ? "All OK" : "";

  const steps = sequence.steps ?? [];
  if (steps.length === 0) {
    lines.push(`    Idle([Idle / Complete])`);
    if (prevNode !== "Start(( ))") {
      lines.push(`    ${prevNode} -->|${prevLabel}| Idle`);
    }
    lines.push(...styleLines(hasSafety, hasPerm, faultNodeAdded, []));
    return lines.join("\n");
  }

  // --- Sequential steps ---
  // Track all generated step IDs for classDef at the end
  const allStepIds: string[] = [];
  // Track branch-end nodes that need to rejoin (nodeId → next step index)
  const pendingRejoin: Array<{ nodeId: string; label: string }> = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepId = `S${step.stepNumber}`;
    const title = escapeLabel(stepTitle(step));

    // Extra action lines (up to 2 more beyond the title)
    const extraActions = (step.actions ?? [])
      .slice(1, 3)
      .map(a => escapeLabel(cleanLabel(a.description)));
    const nodeLabel = extraActions.length > 0
      ? `${title}${BR}${extraActions.join(BR)}`
      : title;

    // --- OR branching step ---
    if (step.transition.combinator === "OR" && (step.transition.conditions ?? []).length > 1) {
      lines.push(`    ${stepId}{"${nodeLabel}"}`);
      allStepIds.push(stepId);

      // Connect from previous
      if (prevNode) {
        lines.push(`    ${prevNode} -->|${escapeLabel(prevLabel)}| ${stepId}`);
      }

      // Each OR condition branches forward
      const nextStepId = i + 1 < steps.length ? `S${steps[i + 1].stepNumber}` : "Idle";
      for (const cond of (step.transition.conditions ?? [])) {
        const condLabel = escapeLabel(cleanLabel(cond.description));
        lines.push(`    ${stepId} -->|${condLabel}| ${nextStepId}`);
      }
      // Also handle "neither" / reject case if relevant
      const hasRejectNote = step.notes?.toLowerCase().includes("reject")
        || step.notes?.toLowerCase().includes("neither")
        || step.notes?.toLowerCase().includes("both");
      if (hasRejectNote) {
        lines.push(`    ${stepId} -->|Both / neither| Reject([Reject])`);
      }

      // The next step will have prevNode = "" since branches already connect to it
      prevNode = "";
      prevLabel = "";
      continue;
    }

    // --- Normal sequential step ---
    lines.push(`    ${stepId}["${nodeLabel}"]`);
    allStepIds.push(stepId);

    if (prevNode) {
      const arrow = prevLabel ? `-->|${escapeLabel(prevLabel)}|` : `-->`;
      lines.push(`    ${prevNode} ${arrow} ${stepId}`);
    }
    // Flush any pending rejoins into this step too
    for (const { nodeId, label } of pendingRejoin) {
      lines.push(`    ${nodeId} -->|${escapeLabel(label)}| ${stepId}`);
    }
    pendingRejoin.length = 0;

    // Fault exit if step involves fault-related devices or notes
    const hasFaultExit = (step.notes ?? "").toLowerCase().includes("fault")
      || (step.actions ?? []).some(a => (a.description ?? "").toLowerCase().includes("fault"))
      || (step.devicesInvolved ?? []).some(d => d.toLowerCase().includes("estop"));
    if (hasFaultExit) {
      if (!faultNodeAdded) {
        lines.push(`    Fault[/"⚠ FAULT"/]`);
        faultNodeAdded = true;
      }
      lines.push(`    ${stepId} -->|Fault| Fault`);
    }

    // Set transition label for next step
    if ((step.transition.conditions ?? []).length > 0) {
      prevLabel = (step.transition.conditions ?? [])
        .map(c => escapeLabel(cleanLabel(c.description)))
        .join(step.transition.combinator === "AND" ? " ∧ " : " ∨ ");
    } else {
      prevLabel = "";
    }
    prevNode = stepId;
  }

  // --- End / Idle node ---
  lines.push(`    Idle([Idle / Complete])`);
  if (prevNode) {
    const arrow = prevLabel ? `-->|${escapeLabel(prevLabel)}|` : `-->`;
    lines.push(`    ${prevNode} ${arrow} Idle`);
  }
  for (const { nodeId, label } of pendingRejoin) {
    lines.push(`    ${nodeId} -->|${escapeLabel(label)}| Idle`);
  }

  lines.push(...styleLines(hasSafety, hasPerm, faultNodeAdded, allStepIds));
  return lines.join("\n");
}

function styleLines(
  hasSafety: boolean,
  hasPerm: boolean,
  hasFault: boolean,
  stepIds: string[],
): string[] {
  const out: string[] = [];
  out.push(`    classDef safety fill:#3a1a50,stroke:#7F77DD,color:#e8e8e8`);
  out.push(`    classDef perm fill:#2a2150,stroke:#7F77DD,color:#e8e8e8`);
  out.push(`    classDef step fill:#0a3d35,stroke:#1D9E75,color:#e8e8e8`);
  out.push(`    classDef fault fill:#3a1515,stroke:#E24B4A,color:#e8e8e8`);
  out.push(`    classDef idle fill:#2a2a3e,stroke:#555,color:#e8e8e8`);
  out.push(`    classDef branch fill:#1a2a40,stroke:#4A90E2,color:#e8e8e8`);

  if (hasSafety) out.push(`    class Safety safety`);
  if (hasPerm) out.push(`    class Perm perm`);
  if (hasFault) out.push(`    class Fault fault`);
  out.push(`    class Start,Idle idle`);
  if (stepIds.length > 0) {
    out.push(`    class ${stepIds.join(",")} step`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Multi-sequence helper
// ---------------------------------------------------------------------------

/** Build diagram for the selected or first sequence from a list. */
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
