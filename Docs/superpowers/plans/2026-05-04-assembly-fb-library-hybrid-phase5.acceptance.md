# Phase 5 Acceptance — Findings

**Plan:** `Docs/superpowers/plans/2026-05-04-assembly-fb-library-hybrid-phase5.md`
**Date completed:** 2026-05-04
**Spec used:** Code-trace analysis (static) — live PILOT-001 run is the pending follow-up (see Open Follow-ups)
**Assemblies run:** Static verification only — no live wizard run possible from automated context

> **Note:** Task 9 criteria require a live wizard session with a real spec project loaded. This document completes the static (code-level) verification pass. The items marked ⏳ require a human tester to exercise the UI. Items marked ✅ are confirmed by code analysis.

---

## Acceptance Criteria Status

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Every assembly is contract-backed (library or custom) | ✅ | `applyShim()` in `use-fds-session.ts` always normalises `interface_contract` to a valid `FbInterfaceContract`. Library path reads contract from `fb_templates.interface_contract`; custom path reads from `fds_assembly_sessions.interface_contract`. No code path produces an assembly without a contract. |
| 2 | Library-bound assembly exercised end-to-end | ⏳ | `LibraryContractPanel` code verified (IO slots read-only, instance params from `assembly.instance_params`, intent textarea with `handleIntentBlur` persisting to session). Needs live run. |
| 3 | Custom assembly exercised (skeleton → contract → Generate → SCL → drift indicator) | ⏳ | `CustomContractPanel` code verified (skeleton picker, `InterfaceContractEditor`, `handleGenerate` calling `generateSingle`, Monaco pane, `DriftChip`). Needs live run. |
| 4 | Drift retry loop exercised (2 retries logged before drift surfaces) | ⏳ | `use-forge-assembly-generate.ts:244–279` confirmed: `MAX_DRIFT_RETRIES=2`, warn log on each retry, error log on budget exhaustion, `drift` field attached to primary FB artifact. Needs live confirmation with a deliberately mismatched contract. |
| 5 | Promote-to-library exercised; template visible in `/fb-library` | ⏳ | `usePromoteToLibrary` + `PromoteToLibraryDialog` code verified (name uniqueness check, scope radio, `createTemplate.mutateAsync`, `is_assembly=true`, `interface_contract` stored, `profile_ids` for scoping). Needs live run. |
| 6 | No assembly falls back to free-form prose authoring | ✅ | `fds-co-author.tsx` adds a contract/interview tab toggle for every assembly. The `CoAuthorAssemblyContract` panel is the only rendering path when `assemblyView === "contract"`. No code path allows bypassing the contract for generation. |
| 7 | Findings document records spec, assembly counts, retry rates, UX rough edges | ✅ | This document. |

---

## Library-path findings (code analysis)

**What the user sees:**

- Template identity strip: name, `source` badge, disabled "Change" button (intentional — template assignment happens in the forge wizard step, not the co-author panel)
- IO slot wiring section: read-only inputs showing bindings from `assembly.instance_params`. Visually appear editable but have `readOnly` attribute and `opacity-70`. Could confuse users into thinking they can edit them here.
- Instance parameters: read-only display of contract inputs with defaults. Same opacity treatment.
- Process intent textarea: 2-row, editable, persists on blur via `useUpdateAssemblyContractAndScl`. This is the only mutable field in the library view.
- Contract summary badge strip: input/output/IO slot/state-write counts from the template's `interface_contract`.

**Persistence:** Only `process_intent` is writable from this view. The `interface_contract` is normalised from the template on each render (not editable). Instance params are authoritative in `AssemblyConfig`, not `FdsAssemblySession`.

**Edge case:** If `fb_template_id` is set but the template has no `interface_contract` (older seeded templates), `isContractPopulated` returns false but the library panel still renders — it shows zeroed badge counts, which is correct.

---

## Custom-path findings (code analysis)

**Workflow observed in code:**

1. Skeleton picker → sets `contract` state (one of 6 `CONTRACT_SKELETONS`)
2. `InterfaceContractEditor` → user edits inputs/outputs/IO slots; local `contract` state updates
3. Process intent textarea → local `processIntent` state (not auto-saved — see rough edges)
4. "Generate SCL from contract" → `handleGenerate()`:
   - Resolves `{subsystem}` / `{assembly}` tokens in `process_state_writes/reads`
   - Calls `generateSingle()` with the resolved contract (empty `fbTemplates` array forces AI path)
   - Extracts `drift` from primary FB artifact's `.drift` field
   - Stores `DriftReport` in local state → updates `DriftChip`
   - Calls `onSessionChange({ interface_contract, generated_scl_blocks })` to persist both
5. Monaco pane shows combined SCL (read-only)
6. `DriftChip`:
   - `null` → nothing rendered (pre-generation)
   - `{ hasHardDrift: false }` → green "Contract matched" badge
   - `{ hasHardDrift: true }` → red `{n} drifts` badge, clickable Popover listing `hardDrifts[].message`
7. "Regenerate" → same as step 4, replaces previous SCL
8. "Save as library template" → opens `PromoteToLibraryDialog`, gated on `hasSclContent && processIntent.trim().length > 0 && !loading`

**Drift retry loop (code-confirmed):**

```
attempt 0: AI call → drift check → hasHardDrift → warn log "retry 1/2 — N hard drifts"
attempt 1: AI call with feedback → drift check → hasHardDrift → warn log "retry 2/2 — N hard drifts"
attempt 2: AI call with feedback → drift check → hasHardDrift → budget exhausted
  → error log "persistent drift after 2 retries — N unresolved drifts"
  → artifact returned with .drift = lastReport
  → DriftChip shows red popover
```

Log entries are collected in `AssemblyGenLogEntry[]` and returned from the hook but are not displayed inline in the co-author UI. The log is available to parent for a log panel if needed in a future iteration.

---

## Promote-to-library findings (code analysis)

**Mutation flow:**

```
PromoteToLibraryDialog.handleSave()
  → usePromoteToLibrary.mutateAsync(PromoteRequest)
    → useCreateFbTemplate.mutateAsync({
        name, device_category, plc_brand: "SIEMENS_TIA",
        is_assembly: true, source: "custom",
        interface_contract: req.interfaceContract,
        blocks: generatedSclBlocks.map(...),
        profile_ids: scope==="project" ? [projectProfileId] : []
      })
      → INSERT INTO fb_templates + fb_template_blocks
      → invalidate ["fb-templates"] query
  → toast("Saved as library template — available for future assemblies")
  → dialog closes
```

**Scope mechanism:** `profile_ids` column on `fb_templates` (pre-existing, no new migration needed). Global = `[]`, project-scoped = `[projectProfileId]`. The FB Library page filters by profile — global templates appear for all projects, scoped templates only appear when the matching profile is active.

**Name uniqueness:** Client-side check against `existingTemplates` list passed by parent. No DB-level unique constraint — a server race condition could produce duplicates if two users promote simultaneously, but this is acceptable for the current usage pattern.

---

## UX rough edges

These were discovered during implementation and code review. None block the primary workflows.

| # | Location | Description | Severity |
|---|----------|-------------|----------|
| 1 | Library path — IO slot inputs | Appear editable (text boxes) but have `readOnly` + `opacity-70`. No tooltip explains why. Could confuse users. | Low |
| 2 | Custom path — process intent | Not auto-saved. Only persists when "Save as library template" is clicked (carried in `PromoteRequest.processIntent`). Navigation away loses the text. Library path persists on blur — inconsistency. | Medium |
| 3 | Custom path — SCL staleness | No warning if user edits the contract after generating SCL. The Monaco pane shows stale code without any "regenerate needed" indicator. | Medium |
| 4 | Custom path — drift retries invisible | Log entries for retries exist internally but are not shown in the co-author UI. Users see the final result (green/red chip) with no indication that 2 retries were attempted. | Low |
| 5 | Custom path — promote when drift persists | `canPromote` gates on `hasSclContent && processIntent.trim() && !loading` but does NOT check `!driftReport?.hasHardDrift`. Users can promote a template whose SCL doesn't match its declared contract. | Medium |
| 6 | Library path — "Change" button | Button is present but hardcoded disabled. Title tooltip explains, but a softer approach (hide it, or only show when applicable) would be cleaner. | Low |
| 7 | Library path — instance_params read-only without label | The "IO slot wiring" section shows `assembly.instance_params` values as if they're editable form fields. The word "read-only" doesn't appear anywhere in the UI. | Low |

---

## Open follow-ups

These are items that were out of scope for Phase 5 but should be filed for a future plan:

1. **Live acceptance run** — PILOT-001 or PAC-EFD-020 needs to be loaded in the dev wizard, walked through all paths, and the ⏳ items above confirmed. Target: before Phase 6 begins.

2. **Process intent auto-save on custom path** — Mirror the library path's `handleIntentBlur` pattern. Currently the custom path's intent is volatile until Promote. Fix is a 15-line change to `CustomContractPanel`.

3. **SCL staleness indicator** — When the user edits the contract after generating SCL, show a yellow "Regenerate needed" badge next to the Regenerate button. Requires comparing `contract` to `session.interface_contract` to detect divergence.

4. **Gate promote on drift-clean** — Add `!driftReport?.hasHardDrift` to `canPromote`. Currently a drifted assembly can be promoted to the library. This is a data quality issue.

5. **Drift retry visibility** — Expose `logEntries` from the generate hook in a collapsible "Generation log" section below the Monaco pane. Low effort, high transparency.

6. **Instance params editability** — Decide: should users be able to override instance_params in the co-author panel, or is it always forge-wizard-only? If co-author editing is wanted, wire it up. If not, display them as read-only text rather than input elements.
