# Forge Wizard — Device Code Generation Bugs

Found during wizard walkthrough (2026-03-30) using PAC-EFD-003 Single Conveyor spec.
All fixes are generic — they target the generation infrastructure, not spec-specific output.

---

## Fix Groups

| Group | Scope | Files | Complexity |
|-------|-------|-------|------------|
| **A** | XML parser | `simatic-xml-interface-parser.ts` | Low |
| **B** | Device code generation | `forge-prompts.ts`, `use-forge-device-generate.ts` | High |
| **C** | Review-rewrite loop | `forge-agent-prompts.ts`, `use-forge-rewrite.ts` | High |
| **D** | Validation + UI | Validation prompt, LAD renderer | Medium |

---

## Group A — XML Parser

### BUG-01: XML parser extracts "p" instead of actual block name

**Issue:** Library blocks imported via TIA Openness get named "p" — a garbage single-character name. Shows as unnamed artifact in Device FBs step.

**Cause:** `detectBlockType()` in `simatic-xml-interface-parser.ts` (line 25-48) uses regex `/<AttributeList>[\s\S]*?<Name>(.*?)<\/Name>/` which matches the FIRST `<Name>` tag after `<AttributeList>`. In Siemens SimaticML XML, the first `<Name>` is inside `<Prefix><Name>p</Name></Prefix>` — a namespace prefix, not the block name. The actual block name comes after the `</Prefix>` closing tag.

**Fix:** Change the regex to skip `<Prefix>` elements. Match `<Name>` that is a direct child of `<AttributeList>`, not nested inside other elements. Use a negative lookbehind or two-step parse: first strip `<Prefix>...</Prefix>`, then match `<Name>`.

**Why it works:** The regex will no longer match the prefix "p" and will instead find the real block name that follows it. All library imports will get correct names.

---

## Group B — Device Code Generation

These bugs all originate in `use-forge-device-generate.ts` and `forge-prompts.ts`. The root causes are:
1. `backfillGlobalDbFieldsFromWiring()` — broken type heuristics, no deduplication
2. `generateDeviceCallFc()` / `buildDeviceCallFcPrompt()` — blindly copies matrix, no polarity/type awareness
3. `generateOutputsDb()` / `generateIoLinkingFc()` — physical vs logical naming mismatch
4. No VAR_IN_OUT detection in FB interface parsing

### BUG-02: DB_Outputs empty — no output variables generated

**Issue:** DB_Outputs is generated with `// (no output signals)` but IoLinking and Device Call FCs reference fields like `DB_Outputs.M01_CMD_FWD`.

**Cause:** `generateOutputsDb()` in `forge-prompts.ts` (line 549) only populates DB_Outputs from the IO list's DQ/AQ entries. But device FB outputs (like motor command signals) are inter-device signals that exist only in the matrix wiring, not the IO list. `backfillGlobalDbFieldsFromWiring()` backfills HmiData and Configuration but skips DB_Outputs.

**Fix:** Extend `backfillGlobalDbFieldsFromWiring()` to also backfill DB_Outputs with any matrix wiring that targets the outputs DB. If a device FB output's `connectedTo` references `DB_Outputs.X`, field `X` must be added to DB_Outputs with the correct type from the FB interface.

**Why it works:** DB_Outputs will contain all fields that any call FC or IoLinking references, eliminating undeclared variable compile errors.

### BUG-03: DB_ProcessCommands duplicate variables

**Issue:** Both `m01CmdFwd` and `m01CommandForward` exist in DB_ProcessCommands for the same logical signal — one from the AI-generated sequence naming, one from the matrix wiring naming.

**Cause:** AI generates DB_ProcessCommands with shortened names (e.g., `m01CmdFwd`). Matrix wiring references the full name (e.g., `m01CommandForward`). `backfillGlobalDbFieldsFromWiring()` checks for exact field name matches only — since `m01CmdFwd` != `m01CommandForward`, it adds both.

**Fix:** Add field name normalization in backfill. Before adding a new field, normalize both the existing field names and the candidate name to a canonical form (strip common prefixes like `cmd`/`command`, lowercase compare). If a semantically identical field exists, skip the add and remap the matrix wire to use the existing name.

**Why it works:** One canonical name per signal. No duplicates. All references point to the same field.

### BUG-04: DB_HmiData wrong types (Bool instead of UDT/Int)

**Issue:** `m01ErrorCode` declared as `Bool` (should be `"udtError_Motor"` UDT). `cv01CurrentDirection` declared as `Bool` (should be `Int`).

**Cause:** `backfillGlobalDbFieldsFromWiring()` (line 723-737) determines data types using name-based heuristics. The heuristic `lower.includes("error") → Bool` is too broad — it matches `errorCode` which should be a UDT struct. The heuristic `lower.includes("direction") → Bool` assumes binary on/off, not tristate.

**Fix:** Priority order for type resolution: (1) FB interface declaration type (look up the output parameter's declared type from the FB's VAR_OUTPUT section), (2) matrix wire's `dataType` field, (3) name heuristics as last resort. For heuristics, add context-aware rules: `direction` with conveyor/motor → `Int`; `errorCode`/`errorStruct` → check FB for UDT type.

**Why it works:** FB interface types are authoritative. Using them first eliminates guessing. The heuristics only fire for fields with no FB interface match.

### BUG-05: eStopConfig uses wrong UDT

**Issue:** `DB_Configuration.eStopConfig` is typed as `"typePushButtonConfig"` instead of `"typeEStopConfig"`. No `typeEStopConfig` UDT artifact is generated.

**Cause:** `reconcileUdtReferences()` (line 1736) uses overly permissive substring matching. `stem("typeEStopConfig")` = "estopconfig", `stem("typePushButtonConfig")` = "pushbuttonconfig". When the correct UDT doesn't exist, the reconciler picks the closest substring match — which is wrong. The ControlEStop FB's config parameter expects a different UDT than ControlPushButton, but the library import didn't generate it.

**Fix:** (1) Tighten `reconcileUdtReferences()` matching — require prefix+suffix alignment, not just substring overlap. (2) When a matrix wire references a UDT that doesn't exist in the artifact set, generate a stub UDT with fields extracted from the FB interface. (3) Validate: if no matching UDT exists and none can be inferred, emit a CRITICAL error instead of silently substituting.

**Why it works:** Wrong UDTs won't be substituted. Missing UDTs will be generated or flagged.

### BUG-06: DB_Configuration missing default values

**Issue:** Timer presets like `runFeedbackTimeout`, `stopFeedbackTimeout`, `resetHoldDuration` have no default values — they initialize to T#0s causing immediate timeout faults on first PLC cycle.

**Cause:** `generateGlobalDb()` in `forge-prompts.ts` (line 485) only accepts `fieldName` + `dataType`, not default values. The matrix structure has no `defaultValue` field. The `BEGIN...END_DATA_BLOCK` section is always empty.

**Fix:** (1) Extend `ProcessLinkageMatrix.GlobalData` field definition to include `defaultValue?: string`. (2) Update matrix generation prompt to output defaults for Time/Int/Word fields. (3) Modify `generateGlobalDb()` to render initialization: `BEGIN runFeedbackTimeout := T#5s; END_DATA_BLOCK`.

**Why it works:** DBs will have sensible defaults. PLC won't fault on first cycle.

### BUG-07: eStop polarity inversion (SAFETY BUG)

**Issue:** `safetyOk` (TRUE = safe/healthy) wired directly to `eStop` input (TRUE = danger/stop) without negation. Conveyor runs when e-stop is active. Motor stops when system is healthy.

**Cause:** Both the deterministic generator (`generateDeviceCallFc`) and the AI prompt (`buildDeviceCallFcPrompt`) copy matrix wiring verbatim with zero polarity validation. The prompt explicitly says "Do NOT change, reorder, or omit any wire from the Matrix wiring" — forbidding the AI from fixing it even if detected. No domain logic exists for safety signal conventions.

**Fix:** (1) Add "Safety Signal Conventions" section to `buildDeviceCallFcPrompt()` documenting polarity rules: `safetyOk` signals need `NOT` when wired to `eStop`/`fault` inputs. (2) Add polarity validation in the deterministic generator: if paramName contains "estop"/"emergency" and source contains "safetyOk"/"systemOk", flag or auto-invert. (3) Extend matrix wire structure with optional `invert?: boolean` flag. (4) Remove the "do NOT change any wire" instruction — replace with "validate polarity for safety signals".

**Why it works:** Safety signals will be correctly inverted. The system won't produce code that runs motors during e-stop.

### BUG-08: Direct instance DB access instead of global DB routing

**Issue:** ControlConveyorCall and MotorDOLCall read `"InstESTOP".safetyOk` directly from the instance DB instead of `"DB_HmiData".eStopSafetyOk` (which EStopCall already writes to).

**Cause:** Matrix wiring allows any "fb" wireType reference. `normalizeConnectedTo()` validates and canonicalizes the reference but doesn't restrict targets. Instance DB fields pass through unchecked. No architectural rule enforces global DB routing.

**Fix:** (1) Validate in `buildNormalizedMatrixWiring()`: reject "fb" wires that point to instance DBs; require global DB references. (2) Add prompt instruction: "Inter-device data must flow through global DBs, never direct instance DB access." (3) If matrix wire targets an instance DB, auto-resolve to the corresponding global DB field (e.g., `InstESTOP.safetyOk` → `DB_HmiData.eStopSafetyOk`).

**Why it works:** All inter-device data flows through standardized global DBs. No fragile coupling to instance DB internals.

### BUG-09: Motor outputs + VAR_IN_OUT not wired

**Issue:** `bOutCommandForward`, `bOutCommandReverse` (VAR_OUTPUT) and `HMI_MotorControl` (VAR_IN_OUT) not wired in MotorDOLCall. Motor never receives run command. VAR_IN_OUT omission is a compile error.

**Cause:** (1) The deterministic generator skips params with no matrix wiring entry: `if (!w.connectedTo?.trim()) continue;`. (2) FB interface parsing (`interfaceRe`) concatenates VAR_INPUT, VAR_OUTPUT, and VAR_IN_OUT sections — losing the distinction. VAR_IN_OUT params are mandatory but treated the same as optional outputs. (3) The prompt says "If an output parameter has no wiring target, OMIT it entirely" — explicitly telling the AI to skip mandatory params.

**Fix:** (1) Parse VAR_IN_OUT section separately in FB interface extraction. Store as `fbMandatoryParams[]` in `DeviceCallFcContext`. (2) Deterministic generator: always wire VAR_IN_OUT params, even if no matrix entry — create a dummy global DB field. (3) For VAR_OUTPUT params with no matrix entry, wire to a global DB field (HmiData or a catch-all). (4) Update prompt: "VAR_IN_OUT parameters are MANDATORY and must always be wired. VAR_OUTPUT parameters should be wired to HmiData for observability."

**Why it works:** All mandatory params will be wired. No compile errors from missing VAR_IN_OUT. Motor will receive commands.

### BUG-10: IoLinking wrong output signal names

**Issue:** IoLinking references `DB_Outputs.CV01_CMD` and `DB_Outputs.M01_CMD` but the IO list has physical tags `M01_CMD_FWD` and `M01_CMD_REV`.

**Cause:** Two naming systems that never synchronize: (1) Physical IO system uses hardware tag names from the IO list (`M01_CMD_FWD`). (2) Logical signal system uses semantic names from the matrix (`M01_CMD`). `generateIoLinkingFc()` uses physical IO tag names. Matrix wiring uses logical names. DB_Outputs gets populated from one or the other depending on which path runs first.

**Fix:** (1) Enforce that matrix wiring output references must match actual IO list tag names. (2) Add validation in `buildNormalizedMatrixWiring()`: resolve output field names against IO list tags. If matrix says `M01_CMD` but IO list has `M01_CMD_FWD`/`M01_CMD_REV`, emit CRITICAL error or auto-resolve. (3) Single source of truth: IO list tag names are authoritative for physical signals.

**Why it works:** One naming system. IoLinking, DB_Outputs, and Device Call FCs all reference the same physical tag names.

### BUG-12: Duplicate/overlapping HmiData variables

**Issue:** DB_HmiData contains both high-level process state (`conveyorRunning`, `conveyorDirection`) AND per-device status (`cv01RunningForward`, `cv01RunningReverse`) — semantically overlapping.

**Cause:** Multiple field sources feed into HmiData: process-level (from sequence/process generation), device-level (from FB output wiring), and matrix backfill. `backfillGlobalDbFieldsFromWiring()` checks only exact field name matches, not semantic equivalence. No deduplication pass exists.

**Fix:** (1) Add semantic field name normalization — map all variants to a canonical form. (2) Before backfilling, check if a semantically similar field exists (e.g., `conveyorRunning` ≈ `cv01RunningForward`). (3) Add a dedup pass after all backfills complete. (4) Prefer device-prefixed names (`cv01RunningForward`) over generic names (`conveyorRunning`) since they scale to multi-device projects.

**Why it works:** Each signal has one canonical field. HMI developers don't have to guess which field is populated.

---

## Group C — Review-Rewrite Loop

### BUG-11: Review-rewrite loop fails on cross-artifact coordination

**Issue:** Standards reviewer finds "MotorDOLCall needs to wire ERROR_Motor to a UDT field in DB_HmiData". Rewrite agent adds the wire in MotorDOLCall but doesn't add the field to DB_HmiData. Round 2 introduces more compile errors (20 criticals, up from 12).

**Cause:** (1) Review findings target individual artifacts — no derived findings for dependent artifacts. (2) Rewrite prompt mentions "cross-artifact consistency" but provides no mechanism to enforce it. (3) The instruction says "output ALL files" but doesn't say "update DBs when FBs change". (4) The AI sees no finding for DB_HmiData, so it doesn't touch it.

**Fix:** (1) Post-process review findings: for each "add/change param in FC/FB" finding, auto-generate a corresponding "add/change field in DB" finding. (2) Enhance rewrite prompt: "For each NEW parameter wired in a call FC, verify the target DB declares that field with the correct type. If not, add it." (3) Add a cross-artifact impact checker that runs after rewrite to verify DB schemas match all call FC references. (4) Consider a two-pass rewrite: first pass fixes FCs, second pass fixes DBs to match.

**Why it works:** DB artifacts will always be updated when call FCs change. The rewrite loop won't introduce new undeclared-variable errors.

---

## Group D — Validation + UI

### BUG-13: Validation fix JSON truncation

**Issue:** When applying validation fixes, the AI response hits max_tokens and produces unterminated JSON. Fails on a 7-device project — will be much worse on larger ones.

**Cause:** The validation fix prompt asks the AI to return the entire updated matrix as JSON. For even a small project, the matrix JSON exceeds the token budget.

**Fix:** (1) Use targeted patch format instead of full matrix replacement — AI returns only the changed fields as JSON patches. (2) Increase max_tokens for validation fix calls. (3) If response truncates, detect the truncation and retry with a smaller scope (fix fewer issues per call).

**Why it works:** Patch format is orders of magnitude smaller than full matrix. Scales to large projects.

### BUG-14: Validation false positives

**Issue:** 4 of 7 validation findings are false positives:
- Jam sensor wired to FALSE flagged as error (valid when spec has no jam sensor)
- "Missing PB_STOP permissive" (stop buttons aren't start permissives)
- "Circular dependency" M01↔CV01 (normal bidirectional device interaction)
- "PB_STOP requires M01 should be CV01" (PB_STOP longHold specifically targets M01 reset)

**Cause:** Validation prompt rules are too rigid. No context-awareness for intentional design choices (unused FB inputs set to constants, stop vs start semantics, normal bidirectional wiring).

**Fix:** (1) Add exceptions to validation rules: "FALSE constant for unused optional inputs is valid — downgrade to INFO". (2) Distinguish start permissives from runtime stop commands. (3) Recognize bidirectional device wiring as normal (device A commands B, B feeds back to A). (4) Check interlock direction semantics before flagging.

**Why it works:** Fewer false positives means engineers trust the validation output and don't ignore real issues.

### BUG-15: Add dismiss option for validation warnings

**Issue:** No way to acknowledge and skip false positive validation warnings. User must either fix them or ignore the entire validation panel.

**Cause:** UI only has checkboxes for selecting issues to fix. No dismiss/acknowledge action.

**Fix:** Add a "Dismiss" button per finding (or multi-select dismiss). Dismissed findings persist as "acknowledged" with visual distinction (greyed out, strikethrough). Dismissed findings don't count toward the issue total. Store dismiss state in session so it survives re-validation.

**Why it works:** Engineers can acknowledge false positives without losing track of them. Real issues remain prominent.

### UI-01: LAD diagram clips off left edge of screen

**Issue:** LAD visualization in fullscreen dialog overflows the left boundary.

**Fix:** Check the SVG viewport/viewBox calculation in the LAD renderer. Ensure the diagram is positioned within bounds or add horizontal scroll/pan.

### UI-02: LAD networks have no comments/titles

**Issue:** Generated LAD call FCs have no network titles or comments on rungs.

**Cause:** LAD generation prompt doesn't instruct the AI to add network titles. The LAD JSON schema may not include a comment/title field per network.

**Fix:** (1) Add network title field to LAD JSON schema. (2) Instruct prompt to generate descriptive titles per network (e.g., "Call InstPE01 — Photoelectric Sensor PE01"). (3) Render titles above each rung in the LAD viewer.

**Why it works:** Engineers can read the LAD at a glance without expanding each rung to understand what it does.

---

## Fix Priority

1. **BUG-07** (eStop polarity) — safety bug, highest priority
2. **BUG-01** (XML parser) — quick win, affects all library imports
3. **Group B** (BUG-02 through BUG-10, BUG-12) — core generation quality
4. **BUG-11** (rewrite loop) — less urgent if generation improves
5. **Group D** (BUG-13 through UI-02) — polish
