/**
 * Deterministic logic checker for Equipment Module FBs.
 * Pure client-side checks — no AI calls, instant results.
 * Validates generated SCL code against FDS behavioral specifications.
 */
import type { ForgeArtifact, ForgeEquipmentModuleEntry } from "@/types/forge";
import type { EquipmentModuleBrief } from "@/types/forge-brief";
import type { LogicCheckIssue, LogicCheckResult } from "@/types/forge-logic-check";

// ---------------------------------------------------------------------------
// SCL parsing helpers
// ---------------------------------------------------------------------------

/** Extract CASE state names from SCL code (looks for CASE #statState OF / CASE #state OF patterns) */
function extractCaseStates(scl: string): string[] {
  const states: string[] = [];
  // Match state constants in CASE blocks: 0, 1, 2... or named constants
  const caseBlockRe = /CASE\s+#\w+\s+OF([\s\S]*?)END_CASE/gi;
  let caseMatch: RegExpExecArray | null;

  while ((caseMatch = caseBlockRe.exec(scl)) !== null) {
    const body = caseMatch[1];
    // Match state labels: "10:" or "0:" or named like "STATE_IDLE:"
    const labelRe = /^\s*(\d+|[A-Z_][A-Z0-9_]*)\s*:/gm;
    let labelMatch: RegExpExecArray | null;
    while ((labelMatch = labelRe.exec(body)) !== null) {
      states.push(labelMatch[1]);
    }
  }
  return states;
}

/** Check if SCL contains a CASE with ELSE branch */
function hasCaseElse(scl: string): boolean {
  // Look for ELSE before END_CASE
  return /ELSE\s*:?\s*[\s\S]*?END_CASE/i.test(scl);
}

/** Extract all TON/TOF timer instance names from SCL */
function extractTimerInstances(scl: string): string[] {
  const timers: string[] = [];
  // Match timer declarations: instName : TON; or instName : TOF;
  const timerRe = /(\w+)\s*:\s*(?:TON|TOF|TP)\s*;/gi;
  let match: RegExpExecArray | null;
  while ((match = timerRe.exec(scl)) !== null) {
    timers.push(match[1]);
  }
  return timers;
}

/** Extract VAR_OUTPUT parameter names */
function extractVarOutputNames(scl: string): string[] {
  const names: string[] = [];
  const varOutputRe = /VAR_OUTPUT([\s\S]*?)END_VAR/gi;
  let match: RegExpExecArray | null;
  while ((match = varOutputRe.exec(scl)) !== null) {
    const body = match[1];
    const paramRe = /^\s*(\w+)\s*:/gm;
    let paramMatch: RegExpExecArray | null;
    while ((paramMatch = paramRe.exec(body)) !== null) {
      names.push(paramMatch[1]);
    }
  }
  return names;
}

/** Check if a string (tag, condition) appears somewhere in SCL code (case-insensitive) */
function sclContains(scl: string, term: string): boolean {
  return scl.toLowerCase().includes(term.toLowerCase());
}

// ---------------------------------------------------------------------------
// Check functions
// ---------------------------------------------------------------------------

function issue(
  severity: LogicCheckIssue["severity"],
  category: LogicCheckIssue["category"],
  equipment_moduleTag: string,
  blockName: string,
  message: string,
  suggestion?: string,
): LogicCheckIssue {
  return { id: crypto.randomUUID(), severity, category, equipment_moduleTag, blockName, message, suggestion };
}

/** Check state coverage: does the code implement every FDS operating state? */
function checkStateCoverage(
  equipment_moduleTag: string,
  fbCode: string,
  fbName: string,
  brief: EquipmentModuleBrief,
): LogicCheckIssue[] {
  const issues: LogicCheckIssue[] = [];
  const codeStates = extractCaseStates(fbCode);

  // For each operating state, check if there's a corresponding CASE branch or REGION
  for (const os of brief.operatingStates) {
    const stateName = os.state_name.toUpperCase().replace(/[\s-]/g, "_");
    // Check if the state name appears in the code (as a comment, constant, or REGION)
    const found = sclContains(fbCode, stateName) ||
      sclContains(fbCode, os.state_name) ||
      codeStates.some((s) => s.toUpperCase().includes(stateName));

    if (!found) {
      const severity = os.state_pattern === "sequential" ? "error" : "warning";
      issues.push(issue(
        severity, "state_coverage", equipment_moduleTag, fbName,
        `Operating state "${os.state_name}" (${os.state_pattern}) not found in code`,
        `Add a CASE branch or REGION for ${stateName}`,
      ));
    }
  }

  return issues;
}

/** Check step sequence: do sequential states have the right number of steps? */
function checkStepSequences(
  equipment_moduleTag: string,
  fbCode: string,
  fbName: string,
  brief: EquipmentModuleBrief,
): LogicCheckIssue[] {
  const issues: LogicCheckIssue[] = [];

  for (const [stateId, seqData] of Object.entries(brief.sequentialStates)) {
    const stateName = brief.operatingStates.find((os) => os.state_id === stateId)?.state_name ?? stateId;

    // Check permissives are referenced
    for (const permissive of seqData.permissives) {
      // Extract key terms from the permissive text
      const terms = permissive.match(/[A-Z_][A-Z0-9_]{2,}/gi) ?? [];
      const anyFound = terms.some((t) => sclContains(fbCode, t));
      if (!anyFound && terms.length > 0) {
        issues.push(issue(
          "warning", "permissive", equipment_moduleTag, fbName,
          `Permissive "${permissive}" for state "${stateName}" may not be checked in code`,
          `Verify the permissive condition is evaluated before entering ${stateName}`,
        ));
      }
    }

    // Check step count — the code should have at least as many step transitions
    if (seqData.steps.length > 0) {
      // Look for step-related patterns in the code near this state
      const stepCount = seqData.steps.length;
      // Count distinct step numbers/transitions in the code (rough heuristic)
      const stepRefs = (fbCode.match(/step|Step|STEP/g) ?? []).length;
      if (stepRefs < stepCount / 2) {
        issues.push(issue(
          "info", "step_sequence", equipment_moduleTag, fbName,
          `State "${stateName}" has ${stepCount} FDS steps but code has few step references`,
          `Verify all ${stepCount} steps are implemented in the state machine`,
        ));
      }
    }
  }

  return issues;
}

/** Check timeout coverage: sequential steps with timeouts should have TON timers */
function checkTimeouts(
  equipment_moduleTag: string,
  fbCode: string,
  fbName: string,
  brief: EquipmentModuleBrief,
): LogicCheckIssue[] {
  const issues: LogicCheckIssue[] = [];
  const timers = extractTimerInstances(fbCode);

  // Count how many sequential steps mention timeouts
  let stepsWithTimeouts = 0;
  for (const seqData of Object.values(brief.sequentialStates)) {
    for (const step of seqData.steps) {
      const s = step as unknown as Record<string, unknown>;
      if (s.timeout_value || /T#\d+/i.test(step.completion_criteria) || /timeout/i.test(step.completion_criteria)) {
        stepsWithTimeouts++;
      }
    }
  }

  if (stepsWithTimeouts > 0 && timers.length === 0) {
    issues.push(issue(
      "error", "timeout", equipment_moduleTag, fbName,
      `FDS specifies ${stepsWithTimeouts} steps with timeouts but no TON/TOF timers declared`,
      "Add TON timer instances for step timeout monitoring",
    ));
  } else if (stepsWithTimeouts > timers.length) {
    issues.push(issue(
      "warning", "timeout", equipment_moduleTag, fbName,
      `FDS has ${stepsWithTimeouts} steps with timeouts but only ${timers.length} timer instances`,
      "Some steps may share timers, but verify all timeouts are covered",
    ));
  }

  return issues;
}

/** Check fault handling: are FDS alarm conditions detected? */
function checkFaultHandling(
  equipment_moduleTag: string,
  fbCode: string,
  fbName: string,
  brief: EquipmentModuleBrief,
): LogicCheckIssue[] {
  const issues: LogicCheckIssue[] = [];

  if (brief.alarmConditions.length === 0) return issues;

  // Check if the code has any fault handling at all
  const hasFaultCode = sclContains(fbCode, "faultCode") || sclContains(fbCode, "fault_code") || sclContains(fbCode, "16#8");
  if (!hasFaultCode) {
    issues.push(issue(
      "error", "fault_handling", equipment_moduleTag, fbName,
      `FDS defines ${brief.alarmConditions.length} alarm conditions but no fault code handling found`,
      "Add fault detection logic with faultCode assignments (16#8001+)",
    ));
    return issues;
  }

  // Check individual alarm conditions
  for (const alarm of brief.alarmConditions) {
    // Extract key terms from the alarm
    const terms = alarm.description.match(/[A-Z_][A-Z0-9_]{2,}/gi) ?? [];
    const codeRef = sclContains(fbCode, alarm.code);
    const termRef = terms.some((t) => sclContains(fbCode, t));

    if (!codeRef && !termRef) {
      issues.push(issue(
        "warning", "fault_handling", equipment_moduleTag, fbName,
        `Alarm "${alarm.code}: ${alarm.description}" may not be detected in code`,
        `Add fault detection for ${alarm.code}`,
      ));
    }
  }

  return issues;
}

/** Check static state device tables: are safe states set correctly? */
function checkDeviceStates(
  equipment_moduleTag: string,
  fbCode: string,
  fbName: string,
  brief: EquipmentModuleBrief,
): LogicCheckIssue[] {
  const issues: LogicCheckIssue[] = [];

  for (const [stateId, entries] of Object.entries(brief.staticStates)) {
    const stateName = brief.operatingStates.find((os) => os.state_id === stateId)?.state_name ?? stateId;

    for (const entry of entries) {
      // Check if the device tag appears in the code at all
      if (!sclContains(fbCode, entry.tag)) {
        issues.push(issue(
          "info", "device_state", equipment_moduleTag, fbName,
          `Device "${entry.tag}" from FDS static state "${stateName}" not referenced in code`,
          `The equipment_module FB may not directly control ${entry.tag} (it may be handled via device FB parameters)`,
        ));
      }
    }
  }

  return issues;
}

/** Check basic SCL syntax/structure */
function checkSyntax(
  equipment_moduleTag: string,
  fbCode: string,
  fbName: string,
): LogicCheckIssue[] {
  const issues: LogicCheckIssue[] = [];

  // CASE must have ELSE
  if (/CASE\s+/i.test(fbCode) && !hasCaseElse(fbCode)) {
    issues.push(issue(
      "error", "syntax", equipment_moduleTag, fbName,
      "CASE statement without ELSE branch",
      "Add ELSE branch for undefined state handling",
    ));
  }

  // Check for required output signals
  const outputs = extractVarOutputNames(fbCode);
  const requiredOutputs = ["busy", "done", "error", "faultCode", "stateNumber"];
  for (const req of requiredOutputs) {
    if (!outputs.some((o) => o.toLowerCase() === req.toLowerCase())) {
      issues.push(issue(
        "warning", "interface", equipment_moduleTag, fbName,
        `Missing required VAR_OUTPUT: ${req}`,
        `Add ${req} to VAR_OUTPUT section`,
      ));
    }
  }

  // Check END_FUNCTION_BLOCK exists
  if (/FUNCTION_BLOCK/i.test(fbCode) && !/END_FUNCTION_BLOCK/i.test(fbCode)) {
    issues.push(issue(
      "error", "syntax", equipment_moduleTag, fbName,
      "Missing END_FUNCTION_BLOCK",
    ));
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Main checker function
// ---------------------------------------------------------------------------

/**
 * Run all deterministic checks on equipment_module FB artifacts.
 * When briefs are available (FDS-linked), checks against FDS spec.
 * When standalone, runs structural checks only.
 */
export function runLogicCheck(
  equipment_modules: ForgeEquipmentModuleEntry[],
  artifacts: ForgeArtifact[],
  briefs?: Record<string, EquipmentModuleBrief>,
): LogicCheckResult {
  const allIssues: LogicCheckIssue[] = [];
  let artifactsChecked = 0;

  for (const asm of equipment_modules) {
    const tagClean = asm.tag.toLowerCase().replace(/[^a-z0-9]/g, "");
    const asmArtifacts = artifacts.filter(
      (a) => a.stage === "equipment_module_fb" && a.name.toLowerCase().includes(tagClean),
    );

    // Find the main FB artifact
    const fbArtifact = asmArtifacts.find((a) => a.type === "FB");
    if (!fbArtifact) {
      allIssues.push(issue(
        "error", "general", asm.tag, "(missing)",
        `No FB artifact found for equipment_module ${asm.tag}`,
        "Generate the equipment_module FB first",
      ));
      continue;
    }

    artifactsChecked += asmArtifacts.length;
    const brief = briefs?.[asm.id];

    // Syntax checks (always run)
    allIssues.push(...checkSyntax(asm.tag, fbArtifact.content, fbArtifact.name));

    // FDS-driven checks (only when brief is available)
    if (brief) {
      allIssues.push(...checkStateCoverage(asm.tag, fbArtifact.content, fbArtifact.name, brief));
      allIssues.push(...checkStepSequences(asm.tag, fbArtifact.content, fbArtifact.name, brief));
      allIssues.push(...checkTimeouts(asm.tag, fbArtifact.content, fbArtifact.name, brief));
      allIssues.push(...checkFaultHandling(asm.tag, fbArtifact.content, fbArtifact.name, brief));
      allIssues.push(...checkDeviceStates(asm.tag, fbArtifact.content, fbArtifact.name, brief));
    }
  }

  const hasErrors = allIssues.some((i) => i.severity === "error");

  return {
    passed: !hasErrors,
    issues: allIssues,
    checkedAt: new Date().toISOString(),
    equipment_modulesChecked: equipment_modules.length,
    artifactsChecked,
  };
}
