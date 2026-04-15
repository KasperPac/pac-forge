/**
 * logic-validator-prompt.ts
 *
 * Prompt builder for the Logic Validator agent.
 * Analyses generated PLC code for runtime logic bugs that static review can't catch.
 * 12 check categories covering state transitions, timing, data flow, and structural issues.
 */

import { resolveSection } from "@/lib/prompt-defaults";
import type { ForgeArtifact } from "@/types/forge";

export const LOGIC_VALIDATOR_MAX_TOKENS = 16384;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

export function buildLogicValidatorSystemPrompt(
  promptSections?: Record<string, string>,
): string {
  const identity = resolveSection(promptSections, "forge_logic_validator", "identity");
  const instructions = resolveSection(promptSections, "forge_logic_validator", "instructions");

  return `${identity}

## Input Contract

You will receive generated PLC code. This may be the FULL program (device + process) or ONLY the device layer (device FBs, call FCs, IO linking, DBs). When only device code is provided, you are in **device-only validation mode** — process sequence FCs do not exist yet and will be generated later. In this mode you MUST NOT report issues about missing consumers for DB signals, missing process logic, or unconnected handoff points. Only report bugs that exist WITHIN the device layer itself. Analyse ONLY the code provided. If a referenced block is not included in the input, note it as "out-of-scope" rather than assuming its behaviour — do NOT hallucinate findings for blocks you haven't seen.

If you cannot determine a signal's polarity or behaviour from the provided code (e.g., an IO tag with no linked hardware comment), flag the finding with confidence: LOW rather than skipping it.

## What to Check

### 1. Self-Defeating Transitions
Walk through each sequence FC step by step. For each step:
- What outputs/actions activate when this step is active?
- Does any output immediately satisfy the NEXT step's transition condition?
- If yes, the current step will only be active for ONE scan cycle — the output can never hold.
- Example bug: Step 10 activates → sets systemEnabled → Step 20's condition is "S[10] AND systemEnabled" → Step 20 immediately activates → kills Step 10 → systemEnabled drops.

### 2. Circular Dependencies
Trace inter-block dependencies:
- Does Block A require an output of Block B to function?
- Does Block B require an output of Block A to function?
- Example bug: ControlMotor FB gates fault reset with eStopSafetyOk, but eStopSafetyOk requires fault reset to clear — deadlock after e-stop.

### 3. Unstable Outputs
Check if any output can hold a stable TRUE/FALSE state:
- Is the output driven by a momentary condition that changes every scan?
- Is the output SET then immediately RESET by different logic in the same scan?
- Is a latch/seal circuit properly constructed (self-sealing contact + reset condition)?

### 4. Signal Polarity
Check NC (normally-closed) signals:
- Is an NC input (TRUE = healthy) wired to a fault input (TRUE = fault) without inversion?
- Example: FAN1_OL is NC (TRUE = healthy), but wired directly to extFault (TRUE = fault). Needs NOT inversion.

### 5. Call Order & Network Execution Order
Check BOTH inter-block call order AND intra-block network order:

**Inter-block (OB1 call order):**
- Are FCs called in the right sequence? (IoLinking first, then device calls, then process sequences)
- Does the call order cause one-scan-delay issues? (e.g., process FC reads a value that device FC hasn't written yet this scan)

**Intra-block (network order within an FC — critical for LAD):**
- In LAD, networks execute top-to-bottom within a single FC. If Network 5 writes an action coil (e.g., A[10] := TRUE) but Network 3 reads that action contact, the contact won't see the new value until the NEXT scan.
- This is especially important for step/action sequences: if the action output coil is in a network BELOW the network that reads the action contact as a transition condition, there is always a one-scan delay.
- Check: are step latch coils written BEFORE action coils that depend on them? Are action coils written BEFORE the networks that read them as conditions?
- Example bug: Network "Latch step 10" sets S[10]. Network "Action 10" reads S[10] and sets A[10]. Network "Latch step 20" reads A[10] as a transition condition. This order is correct. But if "Action 10" appears AFTER "Latch step 20", the A[10] contact in step 20's transition will be FALSE for one extra scan.

### 6. Unreachable States
Check for steps or branches that can never be reached:
- Is there a transition path to every step?
- Can the sequence ever get stuck in a step with no valid exit condition?

### 7. Timer Abuse
Check TON/TOF/TP timers for re-trigger bugs:
- Is the timer IN condition driven by a non-latched signal that goes TRUE every scan? The timer will restart every scan and never reach PT.
- Example bug: TON.IN := (step = 10) but step 10 is re-entered every scan because its output is not latched — timer never elapses.
- Is a TOF/TP instance DB set to retentive but the IN signal is non-retentive? After a cold restart the Q output may be stuck TRUE.

### 8. Counter Rollover / Reset Deadlock
Check CTU/CTD counters:
- Is there a reset path for every counter? A CTU with no reset will count up indefinitely.
- Is the counter CV read BEFORE the counter is reset in the same scan? The read sees the old value.
- Can CV overflow the data type range?

### 9. Data Type Mismatch at FB Boundaries
Check FB call parameter wiring:
- Is an INT value passed to a DINT or REAL input (or vice versa) without explicit conversion?
- Is a REAL compared to an INT without type conversion? Silent truncation produces wrong runtime values.
- This won't crash PLCSIM but produces silent wrong values.

### 10. Multiple Coil Drive Conflict
Check if the same output (Q, M, or DB tag) is written by more than one network or FC:
- Last-write-wins — earlier writes are silently overridden.
- Example: FC_ProcessSeq writes "DB_Outputs".fan01Run := TRUE in Network 3, but FC_FaultHandler writes "DB_Outputs".fan01Run := FALSE in Network 5. The fault handler always wins regardless of process state.

### 11. Missing Initial State
Check sequence startup behaviour:
- Does the sequence assume a known starting state (e.g., all steps reset, step 0 active)?
- What happens on a cold start with a dirty (non-reset) instance DB? Will the sequence be stuck or run from an undefined step?
- Is there explicit initialization logic (first-scan flag or step := 0 on OB100)?

### 12. Sequence Reset Path
Check if the sequence can be fully reset:
- Can the sequence be reset from ANY step, not just its final step?
- A reset that only works from the last step is a common oversight — if an operator needs to abort mid-sequence, there's no path back to step 0.
- Does the reset path also clear all associated action outputs and latches?

### 13. Retentive Coil vs SET/RESET Confusion
Check if an = (OUTPUT_COIL / non-retentive assignment) is used where S/R (SET/RESET latch) is needed:
- An = coil is re-evaluated every scan. If the enabling rung goes FALSE for even one scan during RLL evaluation order, the output drops to FALSE for that scan — causing a brief output glitch.
- Example bug: A fault latch uses = instead of S. During the scan where the fault condition is TRUE, the latch is set. But on the next scan, if a different network earlier in the evaluation resets the fault flag, the = coil sees FALSE and drops the latch for one scan before the fault network re-sets it.
- Latched outputs (fault flags, mode bits, seal-in circuits) MUST use SET/RESET or a self-sealing contact pattern, not a plain = coil.
- This is distinct from unstable_output — the output IS logically correct, but glitches for one scan due to coil type.

### 14. Edge Detection on Late-Written Signals
Check R_TRIG/F_TRIG instances for scan-order edge misses:
- If the signal being edge-detected is written by an FC that executes AFTER the FC containing the R_TRIG/F_TRIG in the OB1 call order, the edge will be missed entirely on the scan when the signal changes.
- Example bug: FC_ProcessSeq uses R_TRIG on "DB_ProcessCommands".startCmd. But FC_HmiHandler (which writes startCmd from HMI) is called AFTER FC_ProcessSeq in OB1. On the scan when the operator presses Start, the R_TRIG sees the OLD value (FALSE) because FC_HmiHandler hasn't run yet. Next scan, startCmd is already TRUE (written last scan), so the rising edge is gone — the edge is never detected.
- This is distinct from general call_order issues — specifically about edge detection timing.

### 15. Uninitialized Tag Reads
Check for tags that are read before any FC has written them in the current scan:
- On cold start with a zeroed DB, the default value (0, FALSE) may be acceptable.
- On warm restart, the tag retains its last value from before the restart. If the code assumes it starts at 0/FALSE, this can cause unexpected behaviour.
- Example bug: A sequence FC reads "DB_ProcessState".currentStep on its first scan after warm restart. The DB retained step 30 from the previous run, so the sequence resumes mid-sequence without proper initialization.
- Flag any tag that is read in an FC before being written in the same scan cycle, especially if used as a state variable or condition.

## Output Format

Return a JSON array of findings:
[
  {
    "severity": "CRITICAL" | "WARNING",
    "category": "self_defeating_transition" | "circular_dependency" | "unstable_output" | "signal_polarity" | "call_order" | "unreachable_state" | "timer_abuse" | "counter_deadlock" | "type_mismatch" | "coil_conflict" | "missing_initial_state" | "sequence_reset" | "retentive_coil_confusion" | "edge_detection_order" | "uninitialized_tag_read",
    "title": "Short description of the issue",
    "affected_blocks": ["BlockName1", "BlockName2"],
    "code_reference": "BlockName > Network N or BlockName > VAR section — where in the code the issue is",
    "description": "Detailed explanation of the bug — trace the logic step by step showing how the issue manifests",
    "suggested_fix": "What needs to change to fix this",
    "scan_cycle_sensitive": true | false,
    "confidence": "HIGH" | "MEDIUM" | "LOW"
  }
]

- scan_cycle_sensitive: true if the bug depends on scan timing (one-scan pulses, call order, timer re-trigger). false if deterministic regardless of scan timing.
- confidence: HIGH = certain from static analysis, MEDIUM = likely but depends on runtime conditions, LOW = possible but needs runtime verification.
- code_reference: point to the specific block and network/section where the issue originates (e.g., "Fan_Staging_Up_Fan_1_Stage > Network Latch step 10" or "ControlMotor > VAR_INPUT section").

If no issues are found, return an empty array: []

Return ONLY the JSON array, no markdown fencing, no commentary.

${instructions}`;
}

// ---------------------------------------------------------------------------
// User message — includes all generated code
// ---------------------------------------------------------------------------

export function buildLogicValidatorUserMessage(
  deviceArtifacts: ForgeArtifact[],
  processArtifacts: ForgeArtifact[],
): string {
  const parts: string[] = [];

  parts.push("## Generated PLC Program — Review for Runtime Logic Bugs");
  parts.push("");
  parts.push("Below is the complete generated program. Mentally simulate the PLC execution and find any logic bugs.");
  parts.push("");

  // OB1 Main first — shows call order
  const ob1 = [...deviceArtifacts, ...processArtifacts].find(
    (a) => a.type === "OB" || a.name === "Main",
  );
  if (ob1) {
    parts.push("### OB1 Main (Call Order)");
    parts.push("```scl");
    parts.push(ob1.content);
    parts.push("```");
    parts.push("");
  }

  // Device FBs
  const fbs = deviceArtifacts.filter((a) => a.type === "FB");
  if (fbs.length) {
    parts.push("## Device Function Blocks (FBs)");
    for (const fb of fbs) {
      parts.push(`### ${fb.name} (${fb.type}, ${fb.language})`);
      parts.push("```scl");
      parts.push(fb.content);
      parts.push("```");
      parts.push("");
    }
  }

  // Device Call FCs
  const deviceFcs = deviceArtifacts.filter((a) => a.type === "FC");
  if (deviceFcs.length) {
    parts.push("## Device Call FCs");
    for (const fc of deviceFcs) {
      parts.push(`### ${fc.name} (FC, ${fc.language})`);
      if (fc.language === "LAD" && fc.content.startsWith("{")) {
        // LAD JSON — include full JSON for logic tracing
        parts.push("```json");
        parts.push(fc.content);
        parts.push("```");
      } else {
        parts.push("```scl");
        parts.push(fc.content);
        parts.push("```");
      }
      parts.push("");
    }
  }

  // Process sequence FCs
  const processFcs = processArtifacts.filter(
    (a) => a.type === "FC" || a.type === "FB",
  );
  if (processFcs.length) {
    parts.push("## Process Sequence FCs");
    for (const fc of processFcs) {
      parts.push(`### ${fc.name} (${fc.type}, ${fc.language})`);
      if (fc.language === "LAD" && fc.content.startsWith("{")) {
        parts.push("```json");
        parts.push(fc.content);
        parts.push("```");
      } else {
        parts.push("```scl");
        parts.push(fc.content);
        parts.push("```");
      }
      parts.push("");
    }
  }

  // Global DBs — for tracing tag references
  const dbs = [...deviceArtifacts, ...processArtifacts].filter(
    (a) => a.type === "DB" || a.type === "UDT",
  );
  if (dbs.length) {
    parts.push("## Data Blocks & UDTs");
    for (const db of dbs) {
      parts.push(`### ${db.name} (${db.type})`);
      parts.push("```scl");
      // Limit DB content to first 40 lines — interface/declaration only
      const lines = db.content.split("\n");
      parts.push(lines.slice(0, 40).join("\n"));
      if (lines.length > 40) parts.push(`// ... (${lines.length - 40} more lines)`);
      parts.push("```");
      parts.push("");
    }
  }

  parts.push("---");
  if (processArtifacts.length > 0) {
    parts.push("Simulate the PLC execution from OB1. Trace all sequence FCs step by step. Report any logic bugs found. Return ONLY the JSON array.");
  } else {
    parts.push(`## DEVICE-ONLY VALIDATION MODE

Process sequence FCs have NOT been generated yet — they will be created in a later pipeline step. This validation covers ONLY the device layer.

**DO NOT flag:**
- Signals written to DBs that have no reader yet (process code will consume them later)
- "Uninitialized" DB tags that process code will write
- Missing process FCs, missing OB1 call order for process FCs
- DB_ProcessCommands / DB_ProcessState fields with no consumer — these are handoff points TO the process layer
- Any concern about what happens "downstream" of device outputs into process logic

**DO flag:**
- Bugs WITHIN a device FB (internal logic errors, timer abuse, wrong type conversions)
- Coil conflicts (same physical output written by multiple device call FCs)
- Signal polarity errors (NC sensor wired without inversion)
- Type mismatches at FB call boundaries (INT passed to REAL without conversion)
- IO linking errors (wrong address, overlapping addresses, missing IO mappings)
- Device FBs that can never leave their initial state due to internal logic
- Missing initialization of device FB static variables that affect device behaviour

Simulate each device FB and its call FC in isolation. Return ONLY the JSON array — no commentary, no markdown fencing. If no issues are found, return: []`);
  }

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Peer validation prompt — review findings from another model
// ---------------------------------------------------------------------------

export function buildLogicValidationSystemPrompt(): string {
  return `You are a senior PLC commissioning engineer performing a PEER REVIEW of logic findings produced by another reviewer for Siemens S7-1500 code.

You will receive:
1. The complete generated PLC program
2. A set of findings from another reviewer

Your job is to validate each finding against the actual code. For each finding, determine:
- Is it a REAL bug? Verify the claim by tracing the code yourself.
- Is the severity correct? Upgrade or downgrade if warranted.
- Is anything MISSING? Are there related bugs or consequences the reviewer didn't catch?

## Output Format

Return a JSON object with two arrays:

{
  "validated_findings": [
    {
      "original_index": 0,
      "verdict": "CONFIRMED" | "FALSE_POSITIVE" | "SEVERITY_CHANGE",
      "adjusted_severity": "CRITICAL" | "WARNING",
      "reason": "Brief explanation of why you confirmed, rejected, or changed severity",
      "additional_context": "Any extra detail the original finding missed (or empty string)"
    }
  ],
  "missed_findings": [
    {
      "severity": "CRITICAL" | "WARNING",
      "category": "string",
      "title": "Short description",
      "affected_blocks": ["BlockName1"],
      "code_reference": "BlockName > Network N",
      "description": "Detailed explanation",
      "suggested_fix": "What needs to change",
      "scan_cycle_sensitive": true | false,
      "confidence": "HIGH" | "MEDIUM" | "LOW"
    }
  ]
}

Rules:
- Be rigorous. Verify each claim against the actual code before confirming.
- Do NOT rubber-stamp findings. If you can't verify a claim from the provided code, mark it FALSE_POSITIVE with explanation.
- For SEVERITY_CHANGE, always include adjusted_severity.
- missed_findings should only include bugs you found that the other reviewer completely missed — not refinements of existing findings.
- Return ONLY the JSON object, no markdown fencing, no commentary.`;
}

export function buildLogicValidationUserMessage(
  codeMessage: string,
  otherFindings: string,
  otherModelName: string,
): string {
  return `${codeMessage}

---

## Peer Review Task

The following findings were produced by ${otherModelName}. Validate each one against the code above.

\`\`\`json
${otherFindings}
\`\`\`

Review each finding. Return ONLY the JSON object with validated_findings and missed_findings.`;
}
