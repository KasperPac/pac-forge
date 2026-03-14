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
    // Keep "Step N:" colon but replace all other colons with dash
    .replace(/(?<!Step \d+):/g, "-")
    .replace(/[#;{}()[\]]/g, "");
}

/** Truncate to maxLen chars, appending "..." if truncated. */
function truncate(str: string, maxLen = 30): string {
  const s = str.trim();
  if (s.length <= maxLen) return s;
  return s.substring(0, maxLen - 3) + "...";
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

  // --- Semantic shortcuts for common automation phrases ---
  if (/\b(evaluat|check)\w*\s+(all\s+)?permissiv/i.test(s)) return "Check permissives";
  if (/\bPLC\s+(evaluat|check|verif)/i.test(s)) return "Check permissives";
  if (/\ball\s+output\w*\s*(=\s*)?off\b|\ball\s+cmd\w*\s*(=\s*)?off\b/i.test(s)) return "All outputs OFF";
  if (/\breturn\s+to\s+idle\b|\bgo\s+to\s+idle\b|\bset\s+.*idle\b/i.test(s)) return "Return to idle";
  if (/\breset\s+all\b|\bclear\s+all\b/i.test(s)) return "Reset all";
  if (/\bwait.*motor.*stop\b|\bwait.*speed.*zero\b|\bwait.*decel\b/i.test(s)) return "Wait for stop";
  if (/\boperator\b.*\bplace\b|\bplace\b.*\bproduct\b/i.test(s)) return "Place product";
  if (/\boperator\b.*\bremov\b|\bremov\b.*\bproduct\b/i.test(s)) return "Remove product";

  // "X = ON/OFF" as-is (already short)
  const directEq = s.match(/^(\S+)\s*=\s*(ON|OFF)$/i);
  if (directEq) return `${directEq[1]} = ${directEq[2]}`;

  // "Set X = ON/OFF/val" → "X = ON"
  const setMatch = s.match(/^set\s+(.+?)\s*=\s*(ON|OFF|\d[\d.]*)/i);
  if (setMatch) return truncate(`${setMatch[1].trim()} = ${setMatch[2]}`, 30);

  // "Hold X = ON/OFF" → "X = OFF"
  const holdMatch = s.match(/^hold\s+(.+?)\s*=\s*(ON|OFF)/i);
  if (holdMatch) return truncate(`${holdMatch[1].trim()} = ${holdMatch[2]}`, 30);

  // Conditional "If X = ON/OFF → set Y = V" → "Y = V"
  const ifSetMatch = s.match(/\bif\s+\S.*?\bset\s+(.+?)\s*=\s*(ON|OFF)/i);
  if (ifSetMatch) return truncate(`${ifSetMatch[1].trim()} = ${ifSetMatch[2]}`, 30);

  // "Enable/disable/start/stop X" → strip and truncate
  const verbMatch = s.match(/^(enable|disable|start|stop|activate|deactivate|energize|de-energize)\s+(\S+)/i);
  if (verbMatch) return truncate(`${verbMatch[1]} ${verbMatch[2]}`, 30);

  // "Monitor X" / "Wait for X"
  const monitorMatch = s.match(/\bmonitor\s+(\S+)/i);
  if (monitorMatch) return truncate(`Monitor ${monitorMatch[1]}`, 30);
  const waitMatch = s.match(/\bwait\s+for\s+(\S+)/i);
  if (waitMatch) return truncate(`Wait for ${waitMatch[1]}`, 30);

  // "Operator VERB [1-2 words]"
  const opMatch = s.match(/\boperator\s+(\w+(?:\s+\w+)?)/i);
  if (opMatch) return truncate(`Operator ${opMatch[1]}`, 30);

  // Fallback: first 4 meaningful words
  const words = s.split(/\s+/).filter(w => w.length > 1);
  return truncate(words.slice(0, 4).join(" "), 30);
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
 * Build a short transition arrow label (≤18 chars).
 */
function shortenTransitionLabel(description: string, deviceName?: string | null): string {
  if (deviceName && deviceName.length <= 18) return deviceName;
  if (deviceName) return truncate(deviceName, 18);

  let s = cleanLabel(description);

  // --- Semantic shortcuts ---
  if (/\ball\s+permissiv/i.test(s)) return "Permissives OK";
  if (/\bno\s+fault\b|\bfault.*clear\b|\bfault.*none\b/i.test(s)) return "No fault";
  if (/\bestop.*ok\b|\bestop.*(on|true|active)\b/i.test(s)) return "ESTOP OK";
  if (/\bmotor.*stop\b|\bconveyor.*stop\b|\bspeed.*zero\b/i.test(s)) return "Stopped";
  if (/\bmotor.*run\b|\bconveyor.*run\b|\bspeed.*nom\b/i.test(s)) return "Running";
  if (/\btimeout\b|\btime.*out\b/i.test(s)) return "Timeout";
  if (/\bproduct.*detect\b|\bpart.*detect\b|\bitem.*detect\b/i.test(s)) return "Product detected";
  if (/\bproduct.*remov\b|\bpart.*remov\b/i.test(s)) return "Product removed";

  // Extract leading TAG_NAME (all-caps with underscores) and state
  const tagStateMatch = s.match(/\b([A-Z][A-Z0-9_]{2,})\b.*?\b(active|on|off|true|false|ok|high|low)\b/i);
  if (tagStateMatch) return truncate(`${tagStateMatch[1]} ${tagStateMatch[2].toUpperCase()}`, 18);

  // Extract just the leading TAG_NAME if clearly a signal reference
  const tagMatch = s.match(/^([A-Z][A-Z0-9_]{2,})\b/);
  if (tagMatch) return truncate(tagMatch[1], 18);

  // "X rising/falling edge" → "X active/inactive"
  s = s.replace(/\brising\s+edge\b[^,]*/gi, "active");
  s = s.replace(/\bfalling\s+edge\b[^,]*/gi, "inactive");

  // "X = ON/OFF"
  const eqMatch = s.match(/(\S+)\s*=\s*(ON|OFF)/i);
  if (eqMatch) return truncate(`${eqMatch[1]} = ${eqMatch[2]}`, 18);

  // Strip noise words, take first 2-3 meaningful words
  s = s.replace(/\b(detected|confirmed|observed|triggered|sensed|pressed|active|true)\b/gi, "");
  s = s.replace(/\s{2,}/g, " ").trim();
  const words = s.split(/\s+/).filter(w => w.length > 2);
  return truncate(words.slice(0, 2).join(" "), 18);
}

/** Build the title + subtitle label for a step node. */
function buildStepLabel(step: ProcessStep): string {
  const actions = step.actions ?? [];
  const title = `Step ${step.stepNumber}`;

  if (actions.length === 0) return title;

  const primary = summarizeAction(actions[0].description, actions[0].deviceName);
  const label = `${title}: ${primary}`;

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
    .join(transition.combinator === "AND" ? " AND " : " OR ");
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

  // Pre-compute which step numbers are branch targets (reached via XOR diamonds,
  // NOT via the linear prevNode chain). These steps must NOT inherit prevNode.
  const branchTargetNums = new Set<number>();
  const xorNodeIds: string[] = [];
  for (const step of steps) {
    if ((step.transition?.combinator === "OR") && (step.transition.conditions ?? []).length > 1) {
      for (const c of step.transition.conditions ?? []) {
        if (c.targetStepNumber != null) branchTargetNums.add(c.targetStepNumber);
      }
    }
  }

  // Track all generated step IDs for classDef
  const allStepIds: string[] = [];
  // Branch ends that need to connect to the next merge (non-branch-target) step
  const pendingBranchEnds: Array<{ nodeId: string; label: string }> = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepId = `S${step.stepNumber}`;
    const nodeLabel = buildStepLabel(step);
    const conditions = step.transition?.conditions ?? [];
    const isOr = step.transition?.combinator === "OR" && conditions.length > 1;
    const isBranchTarget = branchTargetNums.has(step.stepNumber);

    lines.push(`    ${stepId}["${nodeLabel}"]`);
    allStepIds.push(stepId);

    if (isBranchTarget) {
      // This step is the start of a new branch. The XOR diamond already connects to it.
      // Park the current chain as a pending branch end so it can merge later.
      if (prevNode) {
        pendingBranchEnds.push({ nodeId: prevNode, label: prevLabel });
      }
      // Do NOT emit prevNode → stepId here.
    } else {
      // Normal step — connect from previous chain.
      if (prevNode) {
        const arrow = prevLabel ? `-->|${escapeLabel(prevLabel)}|` : `-->`;
        lines.push(`    ${prevNode} ${arrow} ${stepId}`);
      }
      // Flush all pending branch ends into this step (merge point).
      for (const { nodeId, label } of pendingBranchEnds) {
        const arrow = label ? `-->|${escapeLabel(label)}|` : `-->`;
        lines.push(`    ${nodeId} ${arrow} ${stepId}`);
      }
      pendingBranchEnds.length = 0;
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

    if (isOr) {
      const hasTargets = conditions.every(c => c.targetStepNumber != null);

      if (hasTargets) {
        // XOR diamond — each condition routes to a different branch start step.
        const xorId = `X${step.stepNumber}`;
        xorNodeIds.push(xorId);
        lines.push(`    ${xorId}{XOR}`);
        lines.push(`    ${stepId} --> ${xorId}`);

        for (const cond of conditions) {
          const condLabel = truncate(escapeLabel(shortenTransitionLabel(cond.description, cond.deviceName)), 18);
          lines.push(`    ${xorId} -->|${condLabel}| S${cond.targetStepNumber}`);
        }

        const hasReject = (step.notes ?? "").toLowerCase().match(/reject|neither|both/);
        if (hasReject) {
          lines.push(`    ${xorId} -->|Neither| Reject([Reject])`);
        }
      } else {
        // Fallback: all OR conditions lead to next step, show as labelled arrows via merge node.
        const mergeId = `M${step.stepNumber}`;
        lines.push(`    ${mergeId}{ }`);
        for (const cond of conditions) {
          const condLabel = truncate(escapeLabel(shortenTransitionLabel(cond.description, cond.deviceName)), 18);
          lines.push(`    ${stepId} -->|${condLabel}| ${mergeId}`);
        }
        const hasReject = (step.notes ?? "").toLowerCase().match(/reject|neither|both/);
        if (hasReject) {
          lines.push(`    ${mergeId} -->|Neither| Reject([Reject])`);
        }
        const nextStepId = i + 1 < steps.length ? `S${steps[i + 1].stepNumber}` : "Idle";
        lines.push(`    ${mergeId} --> ${nextStepId}`);
      }

      prevNode = "";
      prevLabel = "";
    } else {
      // Compute transition label for the next arrow.
      if (conditions.length === 0) {
        prevLabel = "";
      } else if (conditions.length === 1) {
        prevLabel = truncate(escapeLabel(shortenTransitionLabel(conditions[0].description, conditions[0].deviceName ?? null)), 18);
      } else {
        const first = truncate(escapeLabel(shortenTransitionLabel(conditions[0].description, conditions[0].deviceName ?? null)), 12);
        prevLabel = `${first} +${conditions.length - 1}`;
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
  // Any branch ends that never found a merge step → connect to Idle.
  for (const { nodeId, label } of pendingBranchEnds) {
    const arrow = label ? `-->|${escapeLabel(label)}|` : `-->`;
    lines.push(`    ${nodeId} ${arrow} Idle`);
  }

  lines.push(...styleLines(hasSafety, hasPerm, faultNodeAdded, allStepIds, xorNodeIds));
  return lines.join("\n");
}

function styleLines(
  hasSafety: boolean,
  hasPerm: boolean,
  hasFault: boolean,
  stepIds: string[],
  xorIds: string[] = [],
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
  if (xorIds.length > 0) out.push(`    class ${xorIds.join(",")} xor`);
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
