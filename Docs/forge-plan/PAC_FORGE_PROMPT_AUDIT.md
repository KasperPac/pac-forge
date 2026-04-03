# Pac-Forge Pipeline Prompt Audit
**Reference spec:** PAC-EFD-003 Rev02 — Single Conveyor Transfer System  
**Session date:** 2026-04-03  
**Scope:** Full AI generation pipeline prompt/response review across all stages

---

## Cross-Cutting Issues (apply to every prompt in the pipeline)

These issues appear repeatedly across multiple stages. Fix these globally before tackling per-stage issues.

### CC-1 · Markdown fences on JSON/SCL output `[HIGH]`
The model wraps JSON and SCL output in ` ```json ` or ` ```scl ` fences despite explicit "no markdown" instructions. Every stage that parses AI output is affected. The instruction "Respond with only the raw JSON object" is ignored.

**Fix:** Strengthen all JSON-output instructions to: *"Do NOT wrap the output in markdown code fences. The response MUST start with `{` and end with `}`."* For SCL rewrites: *"The response MUST start with the block keyword (FUNCTION, DATA_BLOCK, etc.)."* Additionally, strip fences defensively in all parsers as a belt-and-suspenders measure.

### CC-2 · Dead input variables everywhere `[LOW]`
Every prompt (system and user messages) declares input_variables that include Siemens SCL syntax fragments: `S7_Optimized_Access`, `S7_SetPoint`, `InstructionName`, `"<"`, `"name"`, `"version"`, `"id"`, `"correction_type"`. These never appear as `{placeholders}` in the template body — they are leaked metadata from earlier prompt engineering and serve no function.

**Fix:** Audit all prompt templates and remove any input_variable declaration that does not have a corresponding `{variable_name}` placeholder in the template body.

### CC-3 · Design profile rules injected regardless of task type `[MEDIUM]`
The full design profile rules block (~30 naming rules, SCL syntax rules, CASE statement rules, type conversion rules) is injected into every generation prompt, including:
- LAD JSON generation tasks (IO Linking) where SCL naming conventions are irrelevant
- Reference lookup topic extraction where no code is produced
- Standards review prompts where the scope statement already limits what to check

This adds ~3,000 tokens of irrelevant context per call.

**Fix:** Implement task-type filtering. Categorise rules by task relevance:
- `LAD_GENERATION` → inject only LAD IO linking rules + instance DB naming
- `SCL_GENERATION` → inject full naming + syntax + state machine rules  
- `REVIEW` → inject only instance DB naming + FB call syntax rules
- `JSON_EXTRACTION` → inject none

### CC-4 · max_tokens too low across the pipeline `[HIGH]`
Multiple stages will truncate on real projects with more devices. Confirmed bottlenecks:

| Stage | Current | Minimum Recommended |
|---|---|---|
| Stage 2 — QA Gap Analysis | 697 | 4,000 |
| Stage 4 — FB Template Matching | 553 | 2,000 |
| Stage 6 — IO Linking FC | 1,710 | 3,000 |
| Stage 6 — Reference Lookup | 81–94 (varies) | 150 (standardise) |
| Stage 7 — Standards Review | 2,727 | 4,000 |
| Stage 8 — Rewrite (PushButtonCall) | 778 | 3,000 |
| Stage 8 — Rewrite (EStopCall) | 408 | 3,000 |

---

## Stage 1 · Spec Extraction (`forge.device_fb.generate`)

Extracts structured JSON from the functional specification document.

### S1-1 · `FAULT_LATCH` missing from severity enum `[CRITICAL]`
F004 uses severity `FAULT_LATCH` per the spec (Section 3.8 explicitly states this). The extraction schema does not include `FAULT_LATCH` as a valid enum value. The model defaults to `WARNING`, which is functionally incorrect — F004 is a post-stop monitoring fault, not a warning.

**Fix:** Add `FAULT_LATCH` to the severity enum in the extraction prompt schema.

### S1-2 · `plc_address` field missing from `io_signals` schema `[HIGH]`
IO address mapping from Section 7 of the spec (`%I0.0`, `%Q0.0`, etc.) is not captured. Downstream stages that need address information have no source for it.

**Fix:** Add `plc_address : string` field to the `io_signals` array schema.

### S1-3 · `process_settings` array missing `[MEDIUM]`
Timer defaults (`runFeedbackTimeout T#5s`, `stopFeedbackTimeout T#5s`, `eStopResetHoldTime T#3s`) from Section 6 are not extracted. These are injected as hardcoded values downstream rather than being driven from the spec.

**Fix:** Add `process_settings` array to the extraction schema with `name`, `default`, `range`, `db_field_name` fields.

### S1-4 · `hardware_modules` array missing `[MEDIUM]`
Slot/order-number data from Section 1.6 is not captured. Hardware configuration generation requires this.

**Fix:** Add `hardware_modules` array with `slot`, `module_name`, `order_number`, `io_count` fields.

### S1-5 · `hmi_type` should distinguish `"NONE"` from `""` `[LOW]`
The spec explicitly states no HMI. The extraction should return `hmi_type: "NONE"` (confirmed absent) rather than an empty string (not mentioned). This prevents the QA agent from asking about it in Stage 2.

### S1-6 · Dead `project_name` input variable `[LOW]`
`project_name` is declared as an input variable but has no `{project_name}` placeholder in the template.

---

## Stage 2 · QA Gap Analysis (PM Agent)

Audits extracted JSON against spec, asks clarifying questions.

### S2-1 · `max_tokens: 697` will truncate `[CRITICAL]`
On the completion path, the model must output a full updated JSON object. 697 tokens is insufficient for any real project. The output was already truncating during testing.

**Fix:** Set to at least 4,000.

### S2-2 · F004 severity question is noise `[HIGH]`
The QA agent asks a clarifying question about F004 severity because `FAULT_LATCH` is not in the enum. This is caused by the upstream schema gap (S1-1). Fixing S1-1 eliminates this question entirely.

### S2-3 · CV01 empty `io_signals` false-fail `[MEDIUM]`
The QA agent flags CV01 as having empty `io_signals` and asks about it. CV01 is an equipment device (conveyor) — it has no direct physical IO by design. The agent should skip the `io_signals` check for `device_type: "equipment"` devices.

**Fix:** Add rule: *"Do NOT flag empty `io_signals` for equipment/process devices. Only flag if device_type is 'sensor', 'actuator', 'motor', or 'button'."*

### S2-4 · Speculative questions not tied to failed audit checks `[MEDIUM]`
The agent generates "what if" questions that are not grounded in a specific audit check failure. These add unnecessary Q&A rounds.

**Fix:** Add constraint: *"Only ask questions when a specific audit check has failed or data is provably missing from the JSON. Do not ask speculative questions."*

### S2-5 · `hmi_type` false-fail `[MEDIUM]`
Even when the spec explicitly states "No HMI", the agent asks a clarifying question about it. The extraction should capture `"NONE"` (see S1-5) and the QA prompt should include a worked example showing that explicit "None" in the spec maps to `hmi_type: "NONE"` with no question needed.

### S2-6 · Dead `alarms` input variable `[LOW]`
`alarms` declared as input variable but unused.

---

## Stage 3 · JSON Merge (Q&A Incorporation)

Merges original extracted JSON with PM agent Q&A answers.

### S3-1 · IO addresses in Q&A were wrong — model merged without cross-checking spec `[CRITICAL]`
The Q&A step provided incorrect IO addresses (e.g., `M01_RUN` at `%I0.2` instead of `%I0.5`). The merge model accepted these without validating against the source spec, producing a corrupted SpecAnalysis JSON.

**Fix:** Pass the original spec document to this step as a validation source. Add instruction: *"Prefer Q&A answers for information not present in the spec. Where Q&A answers conflict with explicit data in the spec (IO addresses, tag names, signal types), the spec takes priority. Flag any conflict rather than silently accepting the Q&A value."*

### S3-2 · No handling for unanswered/TBD Q&A responses `[MEDIUM]`
If an operator leaves a Q&A field blank or writes "TBD", the model has no guidance on what to do.

**Fix:** Add instruction: *"If a Q&A answer is blank, 'TBD', or 'unknown', set `_needs_review: true` on the affected field rather than using a default value."*

### S3-3 · Dead `alarms` input variable on both messages `[LOW]`

---

## Stage 4 · FB Template Matching

Scores 103 FB templates against extracted devices, returns best match per device.

### S4-1 · `max_tokens: 553` will truncate `[CRITICAL]`
Seven devices × JSON match output = easily exceeds 553 tokens for any real project.

**Fix:** Set to at least 2,000.

### S4-2 · No guidance on custom-only fallback vs. `null` `[MEDIUM]`
It is unclear when the model should return `null` (no match found) vs. fall back to a custom FB. The scoring behaviour for this case is undefined.

### S4-3 · 103 templates sent every call `[LOW]`
Pre-filter by device category before sending to reduce prompt size. A motor device doesn't need to see sensor FB templates.

### S4-4 · Dead `device_id` input variable `[LOW]`

---

## Stage 5 · Sequences + Global Data + Device Linkage

Two parallel sequence generation calls + device linkage wiring call.

### S5-1 · Two identical parallel sequence calls `[HIGH]`
Two calls with identical prompts run simultaneously. This appears unintentional — one generates seq1, one generates seq2, but the templates are the same. Verify whether this is correct or whether one call is redundant.

### S5-2 · Dead input variables — SCL fragments leaked into metadata `[HIGH]`
`globalData`, `paramName`, `step`, `S7_Optimized_Access`, `S7_SetPoint`, `InstructionName` are all declared as input_variables across the sequence and device linkage prompts but have no corresponding placeholders. These are SCL syntax fragments that leaked from earlier prompt work.

### S5-3 · `generatedAt` hardcoded as `2025-01-31T10:00:00.000Z` `[MEDIUM]`
This timestamp is stale and will be wrong on every future run.

**Fix:** Inject at call time using the actual generation timestamp, or remove the field.

### S5-4 · Step 10 duplicates permissive logic already in permissives array `[MEDIUM]`
The sequence step 10 re-declares the same permissive checks that are already captured in the `permissives` schema field. This creates a maintenance conflict.

### S5-5 · `m01Mode` referenced in MotorDOLCall wiring but never declared in DB_ProcessCommands `[CRITICAL]`
`DB_ProcessCommands.m01Mode` is used as the `iInMode` input to `fbMotor_Reversing` but is not declared in the DB schema. This will cause an "undeclared variable" compile error.

**Fix:** Declare `m01Mode : Int := 0` in `DB_ProcessCommands`.

### S5-6 · PE sensor `SensorDlyOnOff` outputs routed to `DB_HmiData` only — process state never written `[CRITICAL]`
`PE_Sensor.SensorDlyOnOff` outputs are wired only to `DB_HmiData.pe01SensorDlyOnOff` / `pe02SensorDlyOnOff`. However, `DB_ProcessState.pe01Detected` and `pe02Detected` are declared as the definitive detection flags read by sequence logic. These fields are never written — the sequence will always read `FALSE` for product detection.

**Fix:** Wire `SensorDlyOnOff` → both `DB_HmiData.pe01SensorDlyOnOff` AND `DB_ProcessState.pe01Detected`.

### S5-7 · `InstPE01.SensorDlyOnOff` used as direct FB wire into CV01 — violates global DB rule `[CRITICAL]`
`ConveyorCall` wires `endSensorForward` from `DB_HmiData.pE01SensorDlyOnOff` (mixed-case variant). The correct pattern is to read from `DB_ProcessState`, not from an HMI DB. Additionally, this field has a capitalisation mismatch with what `PhotoelectricSensorCall` actually writes (see S7-3).

---

## Stage 6 · IO Linking FC (`forge.device_fb.generate`)

Generates LAD JSON for physical IO → DB_Inputs / DB_Outputs → physical IO mapping.

### S6-1 · Output wrapped in markdown fences `[HIGH]`
See CC-1. Despite instruction "Respond with only the raw JSON object (no markdown wrapper)", output arrives in ` ```json ` fences.

### S6-2 · `max_tokens: 1710` too low for larger projects `[HIGH]`
See CC-4.

### S6-3 · 24 blank IO entries sent to model `[MEDIUM]`
The IO list passes all 32 signal slots including 24 unnamed/empty channels. The model correctly skips them, but they waste tokens.

**Fix:** Strip unnamed/blank signals from the IO list before injection.

### S6-4 · Design profile SCL naming rules irrelevant to LAD JSON generation `[MEDIUM]`
See CC-3. The full naming rule set for SCL has no bearing on LAD JSON output.

### S6-5 · Dead input variables `[LOW]`
`"name"`, `S7_Optimized_Access`, `S7_SetPoint`, `"<"`, `InstructionName` — none used.

---

## Stage 6b · Reference Lookup (Topic Extractor)

Five parallel calls that extract PLC programming topics from device FB interfaces for reference corpus lookup.

### S6b-1 · All outputs wrapped in markdown fences `[HIGH]`
Despite "Return ONLY a JSON array", all 5 outputs arrive in ` ```json ` fences. See CC-1.

### S6b-2 · Topic overlap across all 5 parallel calls `[MEDIUM]`
`"FB instance DB"`, `"TON timer"`, `"state machine CASE"` appear in every output. If these all query the same reference corpus, the same general docs are retrieved 5 times.

**Fix:** Merge all topics from all 5 calls, deduplicate, then query once.

### S6b-3 · Generic topics dilute relevance `[MEDIUM]`
Topics like `"FB input output VAR"`, `"VAR_INPUT VAR_OUTPUT"`, `"boolean signal processing"` are too generic to retrieve targeted documentation.

**Fix:** Add negative constraint: *"Do NOT include generic structural keywords like 'VAR_INPUT', 'VAR_OUTPUT', 'boolean handling' — only include specific, searchable Siemens TIA Portal terms."*

### S6b-4 · `max_tokens` varies between calls (81–94) `[LOW]`
Standardise to 150 across all 5 calls.

---

## Stage 7 · Standards Review (QA Gate)

Reviews all generated artifacts for compile errors and standards violations.

**Output quality: Excellent.** The review correctly caught all of the following real defects:
- Missing OB1 and Process FC
- Unwired `config` parameter on EStopCall and PushButtonCall
- `FC_TypeConvert` direction conversion bug (`cv01Direction=2` → `FALSE` → runs Forward not Reverse)
- `pE01SensorDlyOnOff` vs `pe01SensorDlyOnOff` capitalisation mismatch
- `bInSignalForward` and `bInSignalReverse` both wired to `M01_RUN`
- Sensor outputs not routed to `DB_ProcessState`
- `m01Running`, `m01Faulted`, `m01Status` never written

### S7-1 · `max_tokens: 2727` borderline for larger projects `[HIGH]`
The output for 7 devices was ~1,800 tokens. A 15-device project will exceed this.

**Fix:** Set to at least 4,000.

### S7-2 · Design profile rules section irrelevant to this stage `[MEDIUM]`
The full design profile (~3,000 tokens) is injected but the scope statement limits the review to instance DBs, call syntax, and parameter wiring. All other rules are noise.

**Fix:** For this stage, inject only: instance DB naming rules, DB prefix rules, FB call syntax rules.

### S7-3 · eStop inversion finding mislabelled as WARNING `[MEDIUM]`
The finding about `eStop` parameter logic in `ConveyorCall` is labelled WARNING but the model concludes "this is not a defect." A finding that is not a defect should be INFO or omitted — WARNING implies action is required.

### S7-4 · "Recorded as reviewed — no finding" paragraphs add noise `[LOW]`
Intermediate confirmation statements for clean artifacts add length without value. The output format already handles the no-issues case.

### S7-5 · Dead input variables `[LOW]`
`"version"`, `S7_Optimized_Access`, `S7_SetPoint`, `"name"`, `InstructionName` on system message; `"id"`, `"version"`, `S7_Optimized_Access`, `S7_SetPoint`, `"name"`, `InstructionName` on user message.

---

## Stage 8 · Rewrite (Code Architect)

Applies fixes from QA review findings back to the affected artifacts.

### S8-1 · Output wrapped in markdown fences `[HIGH]`
Both PushButtonCall and EStopCall rewrites arrive in ` ```scl ` fences. If the rewrite parser expects raw SCL, this breaks ingestion. See CC-1.

### S8-2 · Scope ambiguity — CRITICAL-only or all findings? `[MEDIUM]`
The prompt says "Fix all reported CRITICAL and WARNING findings" but the rewrite for PushButtonCall only addresses the CRITICAL finding (missing `config`). The WARNING findings (process state outputs not wired) are left unaddressed. Either the scope should be explicit, or the findings passed to the rewrite should be pre-filtered to only what will be fixed in this pass.

### S8-3 · PushButtonCall drops process state output routing `[MEDIUM]`
The QA review flagged (WARNING) that `shortHold` and `longHold` outputs from PushButtonCall should also route to `DB_ProcessState.pbStartShortHold`, `pbStopShortHold`, `pbStopLongHold`. The rewrite does not address this. The sequence logic will continue reading stale `FALSE` values.

### S8-4 · Cross-artifact note in PushButtonCall output is wrong `[LOW]`
The rewrite output includes a note that `DB_Configuration` must declare `pbStartConfig` and `pbStopConfig`. These fields already exist in `DB_Configuration`. The note is unnecessary and may cause confusion.

### S8-5 · Dead input variable in output message template `[LOW]`
The output message itself declares `S7_Optimized_Access` as an input_variable. The output message template should not have input_variable declarations.

---

## Stage 9 · Correction Capture (Pattern Librarian)

Extracts reusable WRONG→CORRECT patterns from each rewrite for the corrections corpus.

### S9-1 · Output wrapped in markdown fences `[HIGH]`
Both correction capture outputs arrive in ` ```json ` fences. If the corpus ingestion pipeline parses raw JSON, this breaks it. See CC-1.

### S9-2 · `original_snippet` is synthetic, not actual wrong artifact `[MEDIUM]`
The `original_snippet` field contains a paraphrased/generic representation of the wrong code rather than the actual artifact as generated. For a corrections corpus, the real wrong output is more useful for pattern recognition.

**Fix:** Add instruction: *"The `original_snippet` must be the exact code or JSON from the artifact as generated. Do not paraphrase or generalise it."*

### S9-3 · `correction_type: IO_MAPPING` is a misclassification `[MEDIUM]`
Wiring a structured input parameter at a call site is a `PARAMETER_WIRING` or `CALL_SYNTAX` issue. `IO_MAPPING` typically refers to physical IO address assignment. Misclassification will affect how corrections are retrieved when the model searches the corpus.

**Fix:** Add `PARAMETER_WIRING` as a valid correction_type, or reclassify these as `DECLARATION`.

### S9-4 · Two near-identical corrections for the same pattern `[LOW]`
PushButtonCall and EStopCall both produce `IO_MAPPING / SYSTEMIC_PATTERN` for "missing config UDT parameter." These are the same underlying pattern. Consider deduplicating by `explanation_tag` in the corpus, or adding a `device_type` field to distinguish instances while marking both as instances of the same rule.

### S9-5 · Dead input variables `[LOW]`
`S7_Optimized_Access`, `"name"` declared on user message but unused. `"correction_type"` declared on output message — should not appear there.

---

## Known Functional Bugs in Generated Code

These are defects in the actual generated artifacts (not prompt issues) that were caught by the Stage 7 review and need to be fixed in the rewrite stage.

| Bug | Artifact | Description |
|---|---|---|
| **Direction conversion** | `FC_TypeConvert` | Only checks `cv01Direction = 1`. Value `2` (reverse) → `FALSE` → conveyor runs Forward. Needs a second rung for value = 2. |
| **Sensor outputs never written to process state** | `PhotoelectricSensorCall` | `PE01/PE02 SensorDlyOnOff` outputs go to `DB_HmiData` only. `DB_ProcessState.pe01Detected` / `pe02Detected` never written. Sequence reads stale `FALSE`. |
| **`pE01` vs `pe01` capitalisation** | `DB_HmiData` / `ConveyorCall` | `PhotoelectricSensorCall` writes to `pe01SensorDlyOnOff`. `ConveyorCall` reads from `pE01SensorDlyOnOff`. Different variables — conveyor end sensors never driven. |
| **`bInSignalForward` and `bInSignalReverse` both wired to `M01_RUN`** | `MotorDOLCall` | Both contactor feedback inputs wired to the same signal. FB cannot distinguish forward from reverse confirmation. |
| **`m01Running`, `m01Faulted`, `m01Status` never written** | `MotorDOLCall` | These HMI fields and `DB_ProcessState.m01Running` are declared but no motor FB output writes to them. |
| **Missing OB1** | — | No OB1 artifact generated. Nothing calls the call FCs. |
| **Missing Process FC** | — | No Process FC artifact generated. The call FCs have no orchestrator. |
| **`m01Mode` undeclared** | `DB_ProcessCommands` | Used in `MotorDOLCall` but not declared in the DB. Compile error. |

---

## Action Item Summary

### Must fix before next test run
- [ ] Add `FAULT_LATCH` to severity enum (S1-1)
- [ ] Fix `max_tokens` across all pipeline stages (CC-4)
- [ ] Strengthen "no markdown fences" instruction or add defensive stripping in all parsers (CC-1)
- [ ] Pass spec document to Stage 3 merge as validation source (S3-1)
- [ ] Fix `FC_TypeConvert` — add rung for `cv01Direction = 2` → TRUE
- [ ] Route PE sensor `SensorDlyOnOff` to `DB_ProcessState.pe01Detected` / `pe02Detected`
- [ ] Fix `pE01` / `pe01` capitalisation in `DB_HmiData` and `ConveyorCall`
- [ ] Declare `m01Mode` in `DB_ProcessCommands`
- [ ] Generate OB1
- [ ] Generate Process FC

### Should fix for production quality
- [ ] Add `plc_address` to `io_signals` schema (S1-2)
- [ ] Add `process_settings` array to extraction schema (S1-3)
- [ ] Filter design profile rules by task type (CC-3)
- [ ] Strip blank IO entries before injection (S6-3)
- [ ] Deduplicate reference lookup topics before querying corpus (S6b-2)
- [ ] Add `PARAMETER_WIRING` correction type (S9-3)
- [ ] Clarify rewrite scope — CRITICAL-only or all findings (S8-2)
- [ ] Fix `bInSignalForward` / `bInSignalReverse` wiring (separate feedback DIs needed)

### Nice to have
- [ ] Remove all dead input variables (CC-2)
- [ ] Add `hardware_modules` to extraction schema (S1-4)
- [ ] Standardise reference lookup `max_tokens` to 150 (S6b-4)
- [ ] Remove "recorded as reviewed — no finding" paragraphs from review output (S7-4)
- [ ] Fix `original_snippet` to use actual artifact in correction capture (S9-2)
