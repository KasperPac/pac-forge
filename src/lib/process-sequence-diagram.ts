import type {
  ProcessSequence,
  ProcessStep,
  TransitionCondition,
  LinkageDevice,
} from "@/types/process-builder";
import type { ForgeIoEntry, ForgeDeviceEntry } from "@/types/forge";

// ---------------------------------------------------------------------------
// Text reduction helpers
// ---------------------------------------------------------------------------

/** Sanitise a string for use as a Mermaid node ID (alphanumeric + underscore). */
function safeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9]/g, "_").replace(/^_+/, "X");
}

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

const BR = "<br/>";

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

/** Determine the CSS class for a step node. */
function getStepClass(step: ProcessStep, deviceLinkage: LinkageDevice[]): string {
  const allText = [
    ...(step.actions ?? []).map(a => a.description),
    step.notes ?? "",
  ].join(" ").toLowerCase();

  if (/\b(wait|monitor|poll|await|watching)\b/.test(allText)) return "monitor";

  const deviceInstances = new Set(deviceLinkage.map(d => d.instanceDbName.toLowerCase()));
  const deviceNames = new Set(deviceLinkage.map(d => d.name.toLowerCase()));
  if ((step.devicesInvolved ?? []).some(d =>
    deviceInstances.has(d.toLowerCase()) || deviceNames.has(d.toLowerCase())
  )) {
    return "fb_call";
  }

  return "step";
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

// ---------------------------------------------------------------------------
// Context for the new process flow diagram
// ---------------------------------------------------------------------------

export interface ProcessFlowContext {
  devices: ForgeDeviceEntry[];
  deviceLinkage: LinkageDevice[];
  ioList: ForgeIoEntry[];
}

// ---------------------------------------------------------------------------
// Device classification helpers
// ---------------------------------------------------------------------------

/** True if the device receives signals from physical inputs (DI/AI). */
function isInputDevice(dev: LinkageDevice): boolean {
  return (dev.wiring ?? []).some(w => w.direction === "in" && w.wireType === "io");
}

/** True if the device drives physical outputs (DQ/AQ). */
function isOutputDevice(dev: LinkageDevice): boolean {
  return (dev.wiring ?? []).some(w => w.direction === "out" && w.wireType === "io");
}

/**
 * Find the "key output" parameter names for an input FB device —
 * those outputs that other devices consume as FB inputs.
 */
function getKeyOutputs(dev: LinkageDevice, allDevices: LinkageDevice[]): string[] {
  // Collect all connectedTo values from other devices' "in" FB wires
  const fbSources = new Set<string>();
  for (const other of allDevices) {
    if (other.instanceDbName === dev.instanceDbName) continue;
    for (const w of (other.wiring ?? [])) {
      if (w.direction === "in" && w.wireType === "fb") {
        fbSources.add(w.connectedTo.toLowerCase());
      }
    }
  }

  const keyOuts: string[] = [];
  for (const w of (dev.wiring ?? [])) {
    if (w.direction !== "out") continue;
    const fullRef = `${dev.instanceDbName}.${w.paramName}`.toLowerCase();
    const shortRef = w.paramName.toLowerCase();
    if (
      fbSources.has(fullRef) ||
      fbSources.has(shortRef) ||
      [...fbSources].some(s => s.includes(shortRef))
    ) {
      keyOuts.push(w.paramName);
    }
  }
  return [...new Set(keyOuts)];
}

// ---------------------------------------------------------------------------
// Section builders
// ---------------------------------------------------------------------------

function buildPhysicalInputsSection(ioList: ForgeIoEntry[]): string[] {
  const inputs = ioList.filter(
    io => (io.signal_type === "DI" || io.signal_type === "AI") && io.tag_name?.trim(),
  );
  if (inputs.length === 0) return [];

  // Deduplicate by safeId to avoid Mermaid parse errors from duplicate node definitions
  const seen = new Set<string>();
  const lines: string[] = ["    %% Physical inputs"];
  const usedIds: string[] = [];

  for (let i = 0; i < inputs.length; i++) {
    const io = inputs[i];
    let id = safeId(`PI_${io.tag_name}`);
    // Ensure unique ID
    if (seen.has(id)) id = `${id}_${i}`;
    seen.add(id);
    usedIds.push(id);
    const label = escapeLabel(io.tag_name) || io.address || `IO${i}`;
    lines.push(`    ${id}["${label}"]:::input`);
  }

  lines.push("    %% Inputs DB");
  lines.push(`    IDB["Inputs DB"]:::db`);
  for (const id of usedIds) {
    lines.push(`    ${id} --> IDB`);
  }
  return lines;
}

function buildFbInstancesSection(
  deviceLinkage: LinkageDevice[],
  hasPhysicalInputs: boolean,
): string[] {
  const inputDevices = deviceLinkage.filter(isInputDevice);
  if (inputDevices.length === 0) return [];

  const lines: string[] = ["    %% FB instances"];
  for (const dev of inputDevices) {
    const fbId = safeId(`FB_${dev.instanceDbName}`);
    const keyOuts = getKeyOutputs(dev, deviceLinkage);
    const outPart = keyOuts.length > 0 ? `${BR}→ ${keyOuts.slice(0, 3).join(", ")}` : "";
    const instLabel = escapeLabel(dev.instanceDbName) || dev.name || "FB";
    const fbLabel = escapeLabel(dev.fbName) || "FB";
    lines.push(`    ${fbId}["${instLabel}${BR}${fbLabel}${outPart}"]:::fb`);
    if (hasPhysicalInputs) {
      lines.push(`    IDB --> ${fbId}`);
    }
  }
  return lines;
}

function buildSafetySection(sequence: ProcessSequence): { lines: string[]; hasSafety: boolean } {
  const conditions = sequence.safetyConditions ?? [];
  if (conditions.length === 0) return { lines: [], hasSafety: false };

  const safetyText = conditions
    .map(sc => {
      const mark = sc.polarity ? "✓" : "✗";
      return `${mark} ${truncate(escapeLabel(shortenCondition(sc.description, sc.deviceName)), 25)}`;
    })
    .join(BR);

  const lines = [
    "    %% Safety",
    `    SAFETY{{"SAFETY${BR}${safetyText}"}}:::safety`,
    `    SAFETY -->|Fail| FAULT["⚠ FAULT"]:::fault`,
  ];
  return { lines, hasSafety: true };
}

function buildPermissivesSection(
  sequence: ProcessSequence,
  hasSafety: boolean,
): { lines: string[]; hasPerm: boolean } {
  const permissives = sequence.permissives ?? [];
  if (permissives.length === 0) return { lines: [], hasPerm: false };

  const permText = permissives
    .map(p => {
      const mark = p.polarity ? "✓" : "✗";
      return `${mark} ${truncate(escapeLabel(shortenCondition(p.description, p.deviceName)), 25)}`;
    })
    .join(BR);

  const lines = [
    "    %% Permissives",
    `    PERM{{"PERMISSIVES${BR}${permText}"}}:::perm`,
  ];

  if (hasSafety) {
    lines.push(`    SAFETY -->|All OK| PERM`);
  }
  lines.push(`    PERM -->|Fail| IDLE`);

  return { lines, hasPerm: true };
}

function buildStepsSection(
  sequence: ProcessSequence,
  context: ProcessFlowContext,
  entryNode: string,
  entryLabel: string,
): string[] {
  const steps = sequence.steps ?? [];
  if (steps.length === 0) return [];

  const lines: string[] = ["    %% Steps"];

  // Pre-compute branch target step numbers (reached via XOR diamond, not linear chain)
  const branchTargetNums = new Set<number>();
  for (const step of steps) {
    if (step.transition?.combinator === "OR" && (step.transition.conditions ?? []).length > 1) {
      for (const c of step.transition.conditions ?? []) {
        if (c.targetStepNumber != null) branchTargetNums.add(c.targetStepNumber);
      }
    }
  }

  let prevNode = entryNode;
  let prevLabel = entryLabel;
  const pendingBranchEnds: Array<{ nodeId: string; label: string }> = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepId = `S${step.stepNumber}`;
    const conditions = step.transition?.conditions ?? [];
    const isOr = step.transition?.combinator === "OR" && conditions.length > 1;
    const isBranchTarget = branchTargetNums.has(step.stepNumber);

    const stepClass = getStepClass(step, context.deviceLinkage);
    const nodeLabel = buildStepLabel(step);

    lines.push(`    ${stepId}["${nodeLabel}"]:::${stepClass}`);

    if (isBranchTarget) {
      // Branch target: park the current chain as a pending end
      if (prevNode) {
        pendingBranchEnds.push({ nodeId: prevNode, label: prevLabel });
      }
    } else {
      // Normal step: connect from previous
      if (prevNode) {
        const arrow = prevLabel ? `-->|${escapeLabel(prevLabel)}|` : `-->`;
        lines.push(`    ${prevNode} ${arrow} ${stepId}`);
      }
      // Flush pending branch ends at this merge point
      for (const { nodeId, label } of pendingBranchEnds) {
        const arrow = label ? `-->|${escapeLabel(label)}|` : `-->`;
        lines.push(`    ${nodeId} ${arrow} ${stepId}`);
      }
      pendingBranchEnds.length = 0;
    }

    // Fault exit
    const hasFaultExit =
      (step.notes ?? "").toLowerCase().includes("fault") ||
      (step.actions ?? []).some(a => a.description.toLowerCase().includes("fault")) ||
      (step.devicesInvolved ?? []).some(d => /estop|emergency/i.test(d));
    if (hasFaultExit) {
      lines.push(`    ${stepId} -->|Fault| FAULT`);
    }

    if (isOr) {
      const hasTargets = conditions.every(c => c.targetStepNumber != null);
      if (hasTargets) {
        const xorId = `X${step.stepNumber}`;
        lines.push(`    ${xorId}{"XOR"}:::decision`);
        lines.push(`    ${stepId} --> ${xorId}`);
        for (const cond of conditions) {
          const condLabel = truncate(escapeLabel(shortenTransitionLabel(cond.description, cond.deviceName ?? null)), 18);
          lines.push(`    ${xorId} -->|${condLabel}| S${cond.targetStepNumber}`);
        }
      } else {
        // Fallback: merge node
        const mergeId = `M${step.stepNumber}`;
        lines.push(`    ${mergeId}{ }`);
        for (const cond of conditions) {
          const condLabel = truncate(escapeLabel(shortenTransitionLabel(cond.description, cond.deviceName ?? null)), 18);
          lines.push(`    ${stepId} -->|${condLabel}| ${mergeId}`);
        }
        const nextStepId = i + 1 < steps.length ? `S${steps[i + 1].stepNumber}` : "IDLE";
        lines.push(`    ${mergeId} --> ${nextStepId}`);
      }
      prevNode = "";
      prevLabel = "";
    } else {
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

  // Connect trailing chain to IDLE
  lines.push(`    IDLE(["Idle / Complete"]):::idle`);
  if (prevNode) {
    const arrow = prevLabel ? `-->|${escapeLabel(prevLabel)}|` : `-->`;
    lines.push(`    ${prevNode} ${arrow} IDLE`);
  }
  for (const { nodeId, label } of pendingBranchEnds) {
    const arrow = label ? `-->|${escapeLabel(label)}|` : `-->`;
    lines.push(`    ${nodeId} ${arrow} IDLE`);
  }

  return lines;
}

function buildOutputPathSection(
  deviceLinkage: LinkageDevice[],
  ioList: ForgeIoEntry[],
): string[] {
  const outputDevices = deviceLinkage.filter(isOutputDevice);
  const physicalOutputs = ioList.filter(
    io => (io.signal_type === "DQ" || io.signal_type === "AQ") && io.tag_name?.trim(),
  );

  if (outputDevices.length === 0 && physicalOutputs.length === 0) return [];

  const lines: string[] = ["    %% Output path"];

  if (outputDevices.length > 0) {
    for (const dev of outputDevices) {
      const fbId = safeId(`FB_${dev.instanceDbName}`);
      const outWires = (dev.wiring ?? []).filter(w => w.direction === "out" && w.wireType === "io");
      const outParams = outWires
        .slice(0, 2)
        .map(w => escapeLabel(w.paramName))
        .join(", ");
      const paramPart = outParams ? `${BR}${outParams}` : "";
      const instLabel = escapeLabel(dev.instanceDbName) || dev.name || "FB";
      const fbLabel = escapeLabel(dev.fbName) || "FB";
      lines.push(`    ${fbId}["${instLabel}${BR}${fbLabel}${paramPart}"]:::fb`);
    }

    if (physicalOutputs.length > 0) {
      lines.push(`    OUTDB["Outputs DB"]:::db`);
      for (const dev of outputDevices) {
        lines.push(`    ${safeId(`FB_${dev.instanceDbName}`)} --> OUTDB`);
      }
      const seenOut = new Set<string>();
      for (let i = 0; i < physicalOutputs.length; i++) {
        const io = physicalOutputs[i];
        let id = safeId(`PO_${io.tag_name}`);
        if (seenOut.has(id)) id = `${id}_${i}`;
        seenOut.add(id);
        const label = escapeLabel(io.tag_name) || io.address || `OUT${i}`;
        lines.push(`    ${id}["${label}"]:::output`);
        lines.push(`    OUTDB --> ${id}`);
      }
    }
  } else if (physicalOutputs.length > 0) {
    lines.push(`    OUTDB["Outputs DB"]:::db`);
    const seenOut = new Set<string>();
    for (let i = 0; i < physicalOutputs.length; i++) {
      const io = physicalOutputs[i];
      let id = safeId(`PO_${io.tag_name}`);
      if (seenOut.has(id)) id = `${id}_${i}`;
      seenOut.add(id);
      const label = escapeLabel(io.tag_name) || io.address || `OUT${i}`;
      lines.push(`    ${id}["${label}"]:::output`);
      lines.push(`    OUTDB --> ${id}`);
    }
  }

  return lines;
}

function buildStopFaultSection(
  sequence: ProcessSequence,
  ioList: ForgeIoEntry[],
): string[] {
  const lines: string[] = ["    %% Stop and fault"];

  // E-Stop from safety conditions
  const eStopCond = sequence.safetyConditions.find(sc =>
    /estop|emergency.stop/i.test(sc.description + (sc.deviceName ?? "")),
  );
  if (eStopCond) {
    const label = truncate(escapeLabel(shortenCondition(eStopCond.description, eStopCond.deviceName)), 25);
    lines.push(`    ESTOP["E-Stop${BR}${label} = FALSE${BR}→ All OFF"]:::fault`);
  }

  // Normal stop from IO list
  const stopIo = ioList.find(io => /stop/i.test(io.tag_name));
  if (stopIo) {
    lines.push(`    STOP["Normal stop${BR}${escapeLabel(stopIo.tag_name)}${BR}→ Idle"]:::stop`);
  }

  // Fault reset (if any step has reset/clear action or stop IO exists)
  const hasResetStep = (sequence.steps ?? []).some(s =>
    (s.actions ?? []).some(a => /reset|clear.fault/i.test(a.description)),
  );
  if (hasResetStep || stopIo) {
    lines.push(`    RESET["Fault reset${BR}→ Clear latches → idle"]:::reset`);
  }

  // Only emit section if there's something to show
  return lines.length > 1 ? lines : [];
}

function buildStylesSection(): string[] {
  return [
    "    %% Styles",
    "    classDef input fill:#0C447C,stroke:#85B7EB,color:#E6F1FB",
    "    classDef output fill:#3B6D11,stroke:#97C459,color:#EAF3DE",
    "    classDef db fill:#2C2C2A,stroke:#888780,color:#F1EFE8",
    "    classDef fb fill:#085041,stroke:#5DCAA5,color:#E1F5EE",
    "    classDef fb_call fill:#085041,stroke:#5DCAA5,color:#E1F5EE",
    "    classDef step fill:#085041,stroke:#5DCAA5,color:#E1F5EE",
    "    classDef monitor fill:#3C3489,stroke:#AFA9EC,color:#EEEDFE",
    "    classDef safety fill:#3C3489,stroke:#AFA9EC,color:#EEEDFE",
    "    classDef perm fill:#3C3489,stroke:#AFA9EC,color:#EEEDFE",
    "    classDef decision fill:#2C2C2A,stroke:#888780,color:#F1EFE8",
    "    classDef fault fill:#791F1F,stroke:#F09595,color:#FCEBEB",
    "    classDef stop fill:#712B13,stroke:#F0997B,color:#FAECE7",
    "    classDef reset fill:#712B13,stroke:#F0997B,color:#FAECE7",
    "    classDef idle fill:#2C2C2A,stroke:#888780,color:#F1EFE8",
  ];
}

// ---------------------------------------------------------------------------
// New main builder — template-fill approach
// ---------------------------------------------------------------------------

/**
 * Build a complete Mermaid flowchart TD for a process sequence.
 * Follows a fixed 10-section template filled from sequence + context data.
 * Mermaid handles the layout.
 */
export function buildProcessFlowDiagram(
  sequence: ProcessSequence,
  context: ProcessFlowContext,
): string {
  const physicalInputs = context.ioList.filter(
    io => io.signal_type === "DI" || io.signal_type === "AI",
  );
  const hasPhysicalInputs = physicalInputs.length > 0;

  const { lines: safetyLines, hasSafety } = buildSafetySection(sequence);
  const { lines: permLines, hasPerm } = buildPermissivesSection(sequence, hasSafety);

  // Determine entry node and label for the steps chain
  let entryNode: string;
  let entryLabel: string;
  if (hasPerm) {
    entryNode = "PERM";
    entryLabel = "Pass";
  } else if (hasSafety) {
    entryNode = "SAFETY";
    entryLabel = "All OK";
  } else {
    entryNode = "";
    entryLabel = "";
  }

  const sections: string[][] = [
    ["flowchart TD"],
    buildPhysicalInputsSection(context.ioList),
    buildFbInstancesSection(context.deviceLinkage, hasPhysicalInputs),
    safetyLines,
    permLines,
    buildStepsSection(sequence, context, entryNode, entryLabel),
    buildOutputPathSection(context.deviceLinkage, context.ioList),
    buildStopFaultSection(sequence, context.ioList),
    buildStylesSection(),
  ];

  return sections
    .filter(s => s.length > 0)
    .map(s => s.join("\n"))
    .join("\n");
}

// ---------------------------------------------------------------------------
// Legacy builder (used by process-builder linkage-matrix-panel)
// ---------------------------------------------------------------------------

/**
 * Build a Mermaid flowchart TD from a ProcessSequence.
 * Legacy version without IO/device context — kept for backward compatibility.
 *
 * @deprecated Use buildProcessFlowDiagram for Forge matrix review.
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
    lines.push(...legacyStyleLines(hasSafety, hasPerm, faultNodeAdded, []));
    return lines.join("\n");
  }

  // Pre-compute branch targets
  const branchTargetNums = new Set<number>();
  const xorNodeIds: string[] = [];
  for (const step of steps) {
    if ((step.transition?.combinator === "OR") && (step.transition.conditions ?? []).length > 1) {
      for (const c of step.transition.conditions ?? []) {
        if (c.targetStepNumber != null) branchTargetNums.add(c.targetStepNumber);
      }
    }
  }

  const allStepIds: string[] = [];
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
      if (prevNode) {
        pendingBranchEnds.push({ nodeId: prevNode, label: prevLabel });
      }
    } else {
      if (prevNode) {
        const arrow = prevLabel ? `-->|${escapeLabel(prevLabel)}|` : `-->`;
        lines.push(`    ${prevNode} ${arrow} ${stepId}`);
      }
      for (const { nodeId, label } of pendingBranchEnds) {
        const arrow = label ? `-->|${escapeLabel(label)}|` : `-->`;
        lines.push(`    ${nodeId} ${arrow} ${stepId}`);
      }
      pendingBranchEnds.length = 0;
    }

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

  lines.push(`    Idle([Idle / Complete])`);
  if (prevNode) {
    const arrow = prevLabel ? `-->|${escapeLabel(prevLabel)}|` : `-->`;
    lines.push(`    ${prevNode} ${arrow} Idle`);
  }
  for (const { nodeId, label } of pendingBranchEnds) {
    const arrow = label ? `-->|${escapeLabel(label)}|` : `-->`;
    lines.push(`    ${nodeId} ${arrow} Idle`);
  }

  lines.push(...legacyStyleLines(hasSafety, hasPerm, faultNodeAdded, allStepIds, xorNodeIds));
  return lines.join("\n");
}

function legacyStyleLines(
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
// Multi-sequence helper (backward compat)
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
