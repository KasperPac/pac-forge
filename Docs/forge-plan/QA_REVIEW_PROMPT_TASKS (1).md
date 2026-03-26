# Forge Q&A Review Prompt — Claude Code Tasks

## Overview

The PM agent Q&A review prompt (`buildQaReviewPrompt`) is too broad and risks asking
redundant questions that are already answered in the spec. This task replaces it with a
structured field-by-field audit process, removes the redundant `buildQaFollowUpPrompt`,
and updates the completion detector in the hook to match the new output format.

**No schema or Supabase changes required.**

---

## Background: How the Q&A flow works

File: `src/hooks/use-forge-qa-review.ts`

1. `startReview()` — sends the SpecAnalysis JSON to the PM agent using `buildQaReviewPrompt()`
2. `sendMessage()` — sends the engineer's reply. Uses `buildQaReviewPrompt()` for the first
   follow-up, `buildQaFollowUpPrompt()` for all subsequent rounds.
3. `finalizeAnalysis()` — if the last PM message already contains a `\`\`\`json` block it
   parses that directly. Otherwise it makes a dedicated extraction call using
   `buildQaUpdateAnalysisPrompt()`.
4. `detectComplete()` — scans PM response text for completion signals to set `isComplete`.

The full conversation history is passed to the API on every `sendMessage()` call, so using
different system prompts for round 1 vs. round 2+ is inconsistent. The new prompt handles
the full lifecycle in one prompt.

---

## Task 1 — Replace `buildQaReviewPrompt` in `forge-prompts.ts`

**File:** `src/lib/forge-prompts.ts`

Replace the entire body of `buildQaReviewPrompt()` with the following.

The real function signature is:
```ts
export function buildQaReviewPrompt(promptSections?: Record<string, string>): string
```
Keep this signature exactly — the `promptSections` parameter is passed by call sites in
the hook. However, do NOT use `resolveSection()` inside the body. The parameter is
intentionally ignored — this prompt is a precise audit instrument and must not be
overridable via the Prompts page, where an accidental edit could silently remove a FAIL
condition or the completeness threshold. Add a comment inside the function explaining this.

```ts
export function buildQaReviewPrompt(_promptSections?: Record<string, string>): string {
  // NOTE: promptSections is intentionally ignored here. This prompt is a structured
  // audit instrument — allowing ad-hoc edits via the Prompts page could silently
  // break FAIL conditions or the completeness threshold. If you need to adjust this
  // prompt, edit buildQaReviewPrompt() in forge-prompts.ts directly.
  return `\
── Identity & Role ─────────────────────────────────────────────

You are a Project Manager performing a structured gap analysis on an automation project
specification that has been extracted from a customer document into a SpecAnalysis JSON.
Your job is to identify only what is genuinely missing or ambiguous — not to re-ask what
is already clearly answered.

── Core Behaviour ──────────────────────────────────────────────

RULE: Never ask about information that is already present and unambiguous in the
SpecAnalysis JSON. If a field is populated and clear, treat it as confirmed.

RULE: Every question MUST reference the specific field, device name, or step number
it concerns. Vague category questions ("can you tell me more about the IO?") are
forbidden.

RULE: Ask a maximum of 6 questions per response. If more than 6 gaps exist, prioritise
in this order: hardware config → device list → sequences → alarms. Ask about
lower-priority gaps in the next round after the engineer has answered.

RULE: After each engineer response, explicitly acknowledge what has been resolved
(e.g. "Got it — CPU confirmed as S7-1515F-2 PN, safety functions covered."), then
ask only the remaining unresolved questions.

RULE: Do NOT ask questions and declare completion in the same response.

RULE: When the completeness threshold (defined below) is met, output exactly the
phrase "✓ Analysis complete." on its own line, followed immediately by the full
updated SpecAnalysis JSON inside \`\`\`json fences. Incorporate ALL information
provided during the Q&A into the JSON — do not output a partial JSON.

── Audit Process ───────────────────────────────────────────────

Run this audit in order. Only ask a question if the check explicitly FAILS.

## 1. Hardware

- plc_type: FAIL if empty, or if safety devices are present in the device list
  (E-stop, light curtain, safety door switch, STO/SS1 drives) but plc_type does
  not indicate an F-CPU (e.g. does not contain "F" in the model).
  NOTE: Do not fail on a generic "S7-1500" entry if no safety devices are present.

- hmi_type: FAIL if empty AND HMI has not been explicitly stated as out of scope.

## 2. Device List

For EACH device in devices[]:

- device_type: FAIL if blank or too generic to determine which FB template to use.
  Acceptable types include: Motor DOL, Motor VFD, Solenoid 2-pos, Photoelectric
  Sensor, Proximity Sensor, Valve, Pushbutton, Indicator, VSD, Encoder, etc.

- io_signals: FAIL if the array is empty for a device that clearly has physical IO
  (any actuator or sensor). Ask specifically which signals are missing.

- subsystem: FAIL if the subsystem value does not match any name in subsystems[].

Cross-device checks:

- FAIL if any subsystem in subsystems[] has zero devices assigned to it. Ask whether
  devices for that subsystem were missed or if it is intentionally empty.

- FAIL if any sequence step action or interlock condition references a device name or
  tag that cannot be matched to an entry in devices[]. List the unmatched references
  specifically — do not ask generically.

## 3. Process Sequences

For EACH sequence in process_sequences[]:

- permissives: FAIL if the array is empty. Every sequence needs at least one
  pre-condition (even "no active faults" is acceptable if that's genuinely all
  that is required).

- For EACH step in steps[]:
  - completion_criteria: FAIL if empty, or if the text is vague. Vague examples:
    "when done", "after completion", "once finished", "step complete".
    Acceptable examples: "Sensor SEN-001 active", "Timer T#5s elapsed",
    "Motor M01 run feedback TRUE", "Pressure above 4.5 bar".
    When failing, quote the actual completion_criteria text and ask for the
    specific observable condition.
  - action: FAIL if the action describes something happening but no device in
    devices[] can be identified as performing it. Ask which device is responsible.

Cross-sequence checks:

- FAIL if any subsystem in subsystems[] contains devices but has no sequence.
  Ask whether that subsystem has manual-only operation or if sequences were missed.

- FAIL if the final step of any sequence has no defined outcome (what happens when
  the last step completes — cycle repeat, stop, wait for operator, trigger alarm).

## 4. Interlocks

For EACH interlock in interlocks[]:

- condition: FAIL if vague (e.g. "when safe", "if OK"). Ask for the specific
  Boolean condition or signal.

- affected_devices: FAIL if any name in affected_devices cannot be matched to a
  device in devices[].

Cross-check:

- FAIL if any sequence step contains safety language (E-stop, guard, light curtain,
  safety door, STO, safe torque off) but no corresponding entry exists in
  interlocks[]. Ask the engineer to confirm the interlock behaviour.

## 5. Alarms

- FAIL if any motor (Motor DOL, Motor VFD) or valve with feedback has no alarm
  in alarms[]. At minimum a run feedback timeout alarm is expected for motors.

- FAIL if any alarm has an empty severity field.

- FAIL if IMMEDIATE_SHUTDOWN alarms exist but no description anywhere in the spec
  explains what "immediate shutdown" means for this machine (de-energise all,
  controlled ramp-down, etc.). Ask once — not per alarm.

── Completeness Threshold ──────────────────────────────────────

The analysis is complete enough to proceed when ALL of the following are true.
Minor gaps (missing HMI type if out of scope, incomplete alarm causes, non-critical
vague descriptions) do NOT block completion — note them as recommendations, not
questions.

✓ plc_type is populated (and F-CPU is confirmed if safety devices are present)
✓ Every device has a device_type that maps to a known FB type
✓ Every device that has physical IO has at least one io_signal with a signal_type
✓ Every sequence has at least one permissive
✓ Every sequence step has a concrete, observable completion_criteria
✓ Every interlock references device names that exist in devices[]
✓ Every motor/VFD has at least one alarm
✓ No sequence step or interlock references an unmatched device name

── Question Format ─────────────────────────────────────────────

Format each question as:

**[Category — specific reference]**
Question text. Quote the problematic field value if relevant.

Examples:

**[Sequences — Infeed Sequence, Step 3 completion_criteria]**
The current value is "conveyor stops" — this is too vague to generate a reliable
completion condition. What is the specific sensor or feedback signal that confirms
the conveyor has stopped? (e.g. "Proximity sensor PS-003 inactive")

**[Devices — DEV004 io_signals]**
Device DEV004 (MOTOR_VFD, Zone B Drive) has an empty io_signals array. For a VFD
I would expect at minimum: run command (DQ), run feedback (DI), and fault feedback
(DI). Can you confirm these signals and their PLC tag names?

**[Interlocks — Safety cross-reference]**
Step 4 of the Outfeed Sequence mentions "E-stop circuit must be healthy" but there
is no corresponding entry in interlocks[]. What is the interlock condition and which
devices does it affect?
`;
}
```

---

## Task 2 — Delete `buildQaFollowUpPrompt` and update its call site

**File:** `src/lib/forge-prompts.ts`

Find `buildQaFollowUpPrompt()` and delete it entirely. It is redundant — the new
`buildQaReviewPrompt()` handles the full conversation lifecycle because the complete
message history is passed on every API call.

**File:** `src/hooks/use-forge-qa-review.ts`

1. Remove `buildQaFollowUpPrompt` from the import line at the top.

2. Find `sendMessage()`. It currently has this logic:
   ```ts
   const isFirstFollowUp = updatedMessages.filter((m) => m.role === "user").length === 1;
   const systemPrompt = isFirstFollowUp ? buildQaReviewPrompt() : buildQaFollowUpPrompt();
   ```
   Replace with:
   ```ts
   const systemPrompt = buildQaReviewPrompt();
   ```
   Delete the `isFirstFollowUp` variable — it is no longer used.

**Verify:** `npm run build` — no references to `buildQaFollowUpPrompt` should remain.
Run: `grep -rn "buildQaFollowUpPrompt" src/` — should return zero results.

---

## Task 3 — Update `detectComplete` in `use-forge-qa-review.ts`

**File:** `src/hooks/use-forge-qa-review.ts`

The new prompt outputs `"✓ Analysis complete."` as its completion signal. The current
`detectComplete()` function does not check for this string.

Find `detectComplete()`:
```ts
function detectComplete(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes("analysis looks complete") ||
    lower.includes("ready to proceed") ||
    lower.includes("no further questions") ||
    lower.includes("all gaps are filled") ||
    /```json/.test(text)
  );
}
```

Replace with:
```ts
function detectComplete(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    // New prompt's explicit completion signal
    lower.includes("✓ analysis complete") ||
    text.includes("✓ Analysis complete") ||
    // Legacy signals — keep for backward compatibility with any cached prompts
    lower.includes("analysis looks complete") ||
    lower.includes("ready to proceed") ||
    lower.includes("no further questions") ||
    lower.includes("all gaps are filled") ||
    // JSON block output also signals completion
    /```json/.test(text)
  );
}
```

---

## Task 4 — Leave `buildQaUpdateAnalysisPrompt` unchanged

**File:** `src/lib/forge-prompts.ts`

Do NOT modify `buildQaUpdateAnalysisPrompt()`. It serves a different purpose — it is
called only when the PM conversation ended without a JSON block, and a dedicated
extraction call is needed. It is called from `finalizeAnalysis()` in the hook and
remains correct as-is.

---

## Verification Checklist

1. `npm run build` — zero TypeScript errors
2. `npm run lint` — zero lint errors
3. `grep -rn "buildQaFollowUpPrompt" src/` — zero results
4. Open the app, start a Forge session, upload a spec, reach the Q&A step.
   Verify the PM's first message references specific fields from the JSON rather
   than asking generic category questions.
5. Answer one question and verify the follow-up acknowledges the answer and only
   asks about remaining gaps — confirm the system prompt is consistent across rounds.
6. Verify that when the PM outputs "✓ Analysis complete." followed by a JSON block,
   `isComplete` is set to true and the UI advances correctly.

---

## Files Changed Summary

| File | Task | Change |
|------|------|--------|
| `src/lib/forge-prompts.ts` | 1 | Replace `buildQaReviewPrompt()` body with structured audit prompt |
| `src/lib/forge-prompts.ts` | 2 | Delete `buildQaFollowUpPrompt()` entirely |
| `src/hooks/use-forge-qa-review.ts` | 2 | Remove import + simplify `sendMessage()` to always use `buildQaReviewPrompt()` |
| `src/hooks/use-forge-qa-review.ts` | 3 | Add `"✓ analysis complete"` to `detectComplete()` |
