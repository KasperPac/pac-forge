import type { ProcessSequence, ProcessStep, TransitionCondition } from "@/types/process-builder";

// ---------------------------------------------------------------------------
// Text reduction helpers
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

/** Truncate to maxLen chars, appending "…" if truncated. */
function truncate(str: string, maxLen = 30): string {
  const s = str.trim();
  if (s.length <= maxLen) return s;
  return s.substring(0, maxLen - 1) + "…";
}

/**
 * Strip implementation details from a description string.
 * Removes DB-name prefixes, Inst prefixes, field paths, and enforcement clauses.
 */
function cleanLabel(desc: string): string {
  let s = desc.trim();

  // Strip enforcement / consequence clauses before DB-name stripping
  s = s.replace(/\bif\s+(off|false|fails?|not\s+\w+)\b[^,;.]*/gi, "");
  s = s.replace(/\bmust\s+remain\s+\w+\s+throughout\b[^,;.]*/gi, "");
  s = s.replace(/\bimmediately\s+set\b[^,;.]*/gi, "");
  s = s.replace(/\band\s+latch\s+\w+\b[^,;.]*/gi, "");

  // Strip known DB name prefixes (with optional spaces around dot)
  s = s.replace(/\b(?:Fault\s*Data|Motor\s*Cmd\s*Data|Hmi\s*Data|System\s*State|Configuration)\s*\.\s*/gi, "");

  // Strip generic CamelCase DB prefixes: e.g. "SomeDB.someField" → "someField"
  s = s.replace(/\b[A-Z][A-Za-z0-9]+\s*\.\s*([a-z][A-Za-z0-9_]*)/g, "$1");

  // Strip Inst... prefixes: InstCV01., InstM01.
  s = s.replace(/\bInst[A-Z]\w*\.\s*/g, "");

  // Strip DB_...Inst.field pattern
  s = s.replace(/\bDB_(\w+?)Inst\.(\w+)/g, "$2");

  // Strip stat/temp/inst variable prefixes
  s = s.replace(/\b(?:stat|temp|inst)([A-Z])/g, "$1");

  // Split camelCase to words
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2");

  // Normalize booleans
  s = s.replace(/\bTRUE\b/gi, "ON");
  s = s.replace(/\bFALSE\b/gi, "OFF");
  s = s.replace(/:=/g, "=").replace(/\s*=\s*/g, " = ");

  // Strip IO address prefixes
  s = s.replace(/\b[AD][IQ]_/g, "");

  // Collapse whitespace
  s = s.replace(/\s{2,}/g, " ").trim();

  // Remove trailing punctuation
  s = s.replace(/[,;.]+$/, "").trim();

  return s;
}

/**
 * Reduce a verbose action description to a short imperative phrase (≤30 chars).
 */
function summarizeAction(description: string, _deviceName?: string | null): string {
  let s = cleanLabel(description);

  // "Set X = ON/OFF/val" → "X = ON"
  const setMatch = s.match(/^set\s+(.+?)\s*=\s*(ON|OFF|\d[\d.]*)/i);
  if (setMatch) return truncate(`${setMatch[1].trim()} = ${setMatch[2]}`, 30);

  // "Hold X = ON/OFF" → "X = OFF"
  const holdMatch = s.match(/^hold\s+(.+?)\s*=\s*(ON|OFF)/i);
  if (holdMatch) return truncate(`${holdMatch[1].trim()} = ${holdMatch[2]}`, 30);

  // Conditional "If X = ON ... Y = ON" → "Y = ON"
  const ifSetMatch = s.match(/\bif\s+\S.*?\bset\s+(.+?)\s*=\s*(ON|OFF)/i);
  if (ifSetMatch) return truncate(`${ifSetMatch[1].trim()} = ${ifSetMatch[2]}`, 30);

  // "Enable/disable/start/stop/activate/deactivate X"
  const verbMatch = s.match(/^(enable|disable|start|stop|activate|deactivate|turn\s+on|turn\s+off|energize|de-energize)\s+(.+)/i);
  if (verbMatch) return truncate(`${verbMatch[1]} ${verbMatch[2]}`, 30);

  // "Monitor X"
  const monitorMatch = s.match(/\bmonitor\s+(\S+)/i);
  if (monitorMatch) return truncate(`Monitor ${monitorMatch[1]}`, 30);

  // "Wait for X"
  const waitMatch = s.match(/\bwait\s+for\s+(.+)/i);
  if (waitMatch) return truncate(`Wait - ${waitMatch[1]}`, 30);

  // "Operator does X"
  const opMatch = s.match(/\boperator\s+(\w[\w\s]*)/i);
  if (opMatch) return truncate(`Operator ${opMatch[1]}`, 30);

  // Return to idle / all outputs off
  if (/\b(return\s+to\s+idle|all\s+outputs?\s*=?\s*off|reset\s+all)\b/i.test(s)) {
    return "Return to idle";
  }

  // Fallback: first 5 meaningful words
  const words = s.split(/\s+/).filter(w => w.length > 1);
  return truncate(words.slice(0, 5).join(" "), 30);
}

/**
 * Reduce a safety/permissive condition description to a short label (≤25 chars).
 * Strips enforcement clauses and returns just the check phrase.
 */
function shortenCondition(description: string, deviceName?: string | null): string {
  if (deviceName && deviceName.length <= 22) return deviceName;

  let s = cleanLabel(description);

  // Strip everything after "must remain" / "must be"
  s = s.replace(/\s*must\s+(remain|be)\s+.*/i, "");

  // Strip parenthetical explanations
  s = s.replace(/\s*\(.*?\)/g, "");

  // "X = ON/OFF" → keep as is
  const eqMatch = s.match(/^(\S+)\s*=\s*(ON|OFF)/i);
  if (eqMatch) return truncate(`${eqMatch[1]} = ${eqMatch[2]}`, 25);

  // First 4 words
  const words = s.split(/\s+/).filter(w => w.length > 1);
  return truncate(words.slice(0, 4).join(" "), 25);
}

/**
 * Build a short transition arrow label (≤20 chars).
 */
function shortenTransitionLabel(description: string, deviceName?: string | null): string {
  if (deviceName && deviceName.length <= 20) return truncate(deviceName, 20);

  let s = cleanLabel(description);

  // "X rising edge" → "X active"
  s = s.replace(/\brising\s+edge\b(\s+detected|\s+seen)?/gi, "active");
  s = s.replace(/\bfalling\s+edge\b(\s+detected|\s+seen)?/gi, "inactive");

  // Strip filler words
  s = s.replace(/\b(detected|confirmed|observed|triggered|sensed)\b/gi, "");
  s = s.replace(/\s{2,}/g, " ").trim();

  // "X = ON/OFF"
  const eqMatch = s.match(/(\S+)\s*=\s*(ON|OFF)/i);
  if (eqMatch) return truncate(`${eqMatch[1]} = ${eqMatch[2]}`, 20);

  const words = s.split(/\s+/).filter(w => w.length > 1);
  return truncate(words.slice(0, 3).join(" "), 20);
}

/** Build the title + subtitle label for a step node. */
function buildStepLabel(step: ProcessStep): string {
  const actions = step.actions ?? [];
  const title = `Step ${step.stepNumber}`;

  if (actions.length === 0) return title;

  const primary = summarizeAction(actions[0].description, actions[0].deviceName);
  const label = `${title}- ${primary}`;

  // Subtitle: second action summarized (only if meaningfully different)
  if (actions.length > 1) {
    const sub = summarizeAction(actions[1].description, actions[1].deviceName);
    if (sub !== primary) {
      return `${escapeLabel(label)}${BR}${escapeLabel(sub)}`;
    }
  }
  return escapeLabel(label);
}

/** Format a transition condition for an arrow label (exported for external use). */
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
 * Each node is a compact title + one subtitle.
 * OR transitions branch visually and rejoin at the next step.
 * Fault exits are red-labelled arrows to a Fault node.
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
        const label = truncate(escapeLabel(shortenCondition(sc.description, sc.deviceName)), 28);
        return `${mark} ${label}`;
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
        const label = truncate(escapeLabel(shortenCondition(p.description, p.deviceName)), 28);
        return `${mark} ${label}`;
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

  // Track all generated step IDs for classDef
  const allStepIds: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepId = `S${step.stepNumber}`;
    const nodeLabel = buildStepLabel(step);
    const conditions = step.transition.conditions ?? [];
    const isOr = step.transition.combinator === "OR" && conditions.length > 1;

    lines.push(`    ${stepId}["${nodeLabel}"]`);
    allStepIds.push(stepId);

    // Connect from previous node
    if (prevNode) {
      const arrow = prevLabel ? `-->|${escapeLabel(prevLabel)}|` : `-->`;
      lines.push(`    ${prevNode} ${arrow} ${stepId}`);
    }

    // Fault exit detection
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

    const nextStepId = i + 1 < steps.length ? `S${steps[i + 1].stepNumber}` : "Idle";

    if (isOr) {
      // Check if conditions have targetStepNumber for proper XOR routing
      const hasTargets = conditions.every(c => c.targetStepNumber != null);

      if (hasTargets) {
        // Proper XOR diamond: each branch routes to its own target step
        const xorId = `X${step.stepNumber}`;
        lines.push(`    ${xorId}{XOR}`);
        lines.push(`    ${stepId} --> ${xorId}`);

        for (const cond of conditions) {
          const condLabel = truncate(escapeLabel(shortenTransitionLabel(cond.description, cond.deviceName)), 20);
          const targetId = `S${cond.targetStepNumber}`;
          lines.push(`    ${xorId} -->|${condLabel}| ${targetId}`);
        }

        // Reject branch if noted
        const hasReject = (step.notes ?? "").toLowerCase().match(/reject|neither|both/);
        if (hasReject) {
          lines.push(`    ${xorId} -->|Neither| Reject([Reject])`);
        }
      } else {
        // Fallback: merge diamond — conditions labelled, all route to next step
        const mergeId = `M${step.stepNumber}`;
        lines.push(`    ${mergeId}{ }`);

        for (const cond of conditions) {
          const condLabel = truncate(escapeLabel(shortenTransitionLabel(cond.description, cond.deviceName)), 20);
          lines.push(`    ${stepId} -->|${condLabel}| ${mergeId}`);
        }

        const hasReject = (step.notes ?? "").toLowerCase().match(/reject|neither|both/);
        if (hasReject) {
          lines.push(`    ${mergeId} -->|Neither| Reject([Reject])`);
        }

        lines.push(`    ${mergeId} --> ${nextStepId}`);
      }

      prevNode = "";
      prevLabel = "";
    } else {
      // Normal sequential step — compute label for next arrow
      if (conditions.length === 0) {
        prevLabel = "";
      } else if (conditions.length === 1) {
        prevLabel = truncate(escapeLabel(shortenTransitionLabel(conditions[0].description, null)), 20);
      } else {
        // AND: show first condition + count
        const first = truncate(escapeLabel(shortenTransitionLabel(conditions[0].description, null)), 14);
        prevLabel = conditions.length === 2
          ? `${first} ∧ …`
          : `${first} +${conditions.length - 1}`;
      }
      prevNode = stepId;
    }
  }

  // --- End / Idle node ---
  lines.push(`    Idle([Idle / Complete])`);
  if (prevNode) {
    const arrow = prevLabel ? `-->|${escapeLabel(prevLabel)}|` : `-->`;
    lines.push(`    ${prevNode} ${arrow} Idle`);
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
  out.push(`    classDef merge fill:#1a2a3e,stroke:#4A90E2,color:#e8e8e8`);
  out.push(`    classDef xor fill:#1a2030,stroke:#4A90E2,color:#7ab3f0`);

  if (hasSafety) out.push(`    class Safety safety`);
  if (hasPerm) out.push(`    class Perm perm`);
  if (hasFault) out.push(`    class Fault fault`);
  out.push(`    class Start,Idle idle`);
  if (stepIds.length > 0) out.push(`    class ${stepIds.join(",")} step`);
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
