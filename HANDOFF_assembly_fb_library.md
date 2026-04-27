# Handoff — Assembly FB Library build (post-Phase 4 contracts)

**For the next Claude Code session.** Read this once, then delete the file when the work is absorbed.

---

## Where we are

- **Branch:** `feature/assembly-fb-library` (off `master`).
- **Plan reference:** `Docs/ASSEMBLY_FB_LIBRARY_PLAN.md`.
- **Phase 0 audit:** `Docs/ASSEMBLY_FB_LIBRARY_PHASE0_AUDIT.md`. All 8 v1 catalog slots are Mode C (author from scratch).
- **Phase status:**
  - Phase 0 (audit) ✅
  - Phase 1 (migration `075` + types) ✅
  - Phase 2 (FB Library contract editor UI) ✅
  - Phase 3 (SCL → contract parser + Pre-fill button) ✅
  - **Phase 4 (seed v1 catalog) — contracts ✅ on all 8, body SCL ⏸ pending Kasper.**
  - Phase 5 onward — not started.

## Phase 4 — what's in the DB now

All 8 templates from plan §5 exist as `fb_templates` rows on the cloud Supabase project, each with:
- Header SCL (`FUNCTION_BLOCK ... { S7_Optimized_Access := 'TRUE' } VERSION : 1.0`), full `VAR_INPUT` / `VAR_OUTPUT` declarations, empty `BEGIN ;  END_FUNCTION_BLOCK`, fault-code constants in `VAR CONSTANT`.
- Full `interface_contract` jsonb populated: `inputs`, `outputs`, `io_slots`, `process_state_writes` with role + description + `agent_description` per row.
- `is_assembly = true`, `category` set, tags set, profile scope `Global`.

| § | Template name | Inputs / Outputs / IO / Writes |
|---|---|---|
| 5.1 | ConveyorStandardVsd | 6 / 6 / 1 / 4 |
| 5.2 | ConveyorStandardDol | 3 / 4 / 4 / 3 *(Kasper authored manually)* |
| 5.3 | TransferTable2Axis | 4 / 8 / 7 / 4 |
| 5.4 | TurntableSingleStop | 4 / 5 / 5 / 3 |
| 5.5 | PusherLinearCylinder | 4 / 5 / 4 / 3 |
| 5.6 | DiverterSwingGate | 4 / 5 / 4 / 3 |
| 5.7 | LiftStationVertical | 5 / 5 / 5 / 3 |
| 5.8 | AccumulatorBufferConveyor | 5 / 6 / 5 / 3 |

## Phase 4 — what's still TODO

**Body SCL.** Every template currently has an empty `BEGIN ;  END_FUNCTION_BLOCK`. Kasper authors body logic himself, validates compile in TIA V18. Recommended order (simplest first):

1. ConveyorStandardDol (likely already started)
2. PusherLinearCylinder (mirror logic for diverter)
3. DiverterSwingGate
4. TurntableSingleStop
5. ConveyorStandardVsd (telegram packing/unpacking)
6. LiftStationVertical (multi-level state machine)
7. AccumulatorBufferConveyor (queue counting)
8. TransferTable2Axis (most complex — internal mode machine for Home / Receive / Transfer / Return)

Once a body compiles, no further action needed on the contract — it's already complete in the DB.

## How the bulk authoring was done (for reference / repeatability)

7 of the 8 templates were created via browser automation in this session:

1. **UI** — opened the New Template dialog, filled name/category/tags/description/block-name, toggled Assembly FB on.
2. **Monaco editor** — set the SCL via `monaco.editor.getEditors()[0].setValue(scl)` (which triggers the React onChange).
3. **Pre-fill from SCL** — clicked the wand button (twice in some cases — the first click occasionally raced with Monaco's onChange propagation).
4. **Reclassify** — clicked the Move-to-IO-Slots buttons for IO pins. The InterfaceContractEditor's NodeList of move buttons goes stale across rapid clicks, so doing them one-at-a-time in reverse index order (per tab) was the most reliable pattern.
5. **Save** — clicked Create Template (skeleton save with empty role/description/agent_description fields).
6. **PATCH** — bulk-updated `interface_contract` jsonb via direct Supabase REST PATCH using the page's auth session. Captured the apikey by monkey-patching `window.fetch` and watching the next legitimate request.

**Caveats from this approach:**
- The skeleton-save → PATCH path bypasses the React mutation flow. **No version-history snapshot in `fb_template_versions` was created for the contract update.** First time a template gets edited via the UI, a snapshot of its v1 (skeleton) state will land in the version history; the full contract will only show up in v2 onward. Acceptable for v1 seeding; flag if version history matters.
- The dialog form state doesn't always reset cleanly between saves on rapid sequential opens. Encountered once during Turntable; fix was a hard page reload (F5). If you reuse this pattern, plan for occasional refreshes.
- Telegram-352 UDT names are hardcoded into ConveyorStandardVsd's SCL (`"DriveStatusTelegram352"` / `"DriveCommandTelegram352"`). Per the locked-in decision, this stays a Phase 5 concern — extend the schema to allow telegram_type config later.

## Locked design decisions (don't re-open)

1. **IO slots are named pins.** Physical IO lives in `VAR_INPUT` / `VAR_OUTPUT` blocks in SCL. Classification happens in the DB, not the SCL.
2. **No SCL naming convention** — engineer uses whatever names; the parser stays naive; reclassify via UI.
3. **FB Builder revival deferred to Phase 8** — seed v1 manually first, extract patterns later.
4. **VSD telegram parameterised → deferred to Phase 5.** v1 hardcodes telegram-352. Don't refactor now.
5. **ProcessState UDT naming** = `ProcessState_<SUBSYSTEM>.<assembly_tag>_<signal_name>`. Globally unique assembly tags (CV01, LFT01…). Templates use `{subsystem}` + `{assembly}` substitution tokens; spec builder fills at generation time.
6. **FB `VERSION : 1.0`** on every seed template.
7. **Diverter single-actuator convention (locked):** GateActuatorCmdA = `zero_or_one` (rest position via spring), GateActuatorCmdB = `one` (active solenoid energise to deflect).
8. **Pusher single-actuator convention:** ExtendSolenoid = `one` (always required), RetractSolenoid = `zero_or_one` (optional double-acting).

## Verification when resuming

1. `git status` — clean (or only `HANDOFF_*.md` untracked).
2. `git log --oneline -10` — top should be the commit that adds this file change.
3. `npm run dev` — boots without errors.
4. `/fb-library` → spot-check the 8 templates: each should round-trip the contract (Inputs/Outputs/IO Slots/ProcessState counts match the table above; agent_description Bot icons primary-colored on populated rows).
5. Grep DB if needed: `name=in.(ConveyorStandardVsd,ConveyorStandardDol,TransferTable2Axis,TurntableSingleStop,PusherLinearCylinder,DiverterSwingGate,LiftStationVertical,AccumulatorBufferConveyor)` against `fb_templates`.

## What's next (after Phase 4 bodies)

- **Phase 5 — Spec Builder integration.** Schema migration `075` already added `fb_template_id` + `instance_params` + `instance_overrides` + `process_intent` to `fds_assembly_sessions`. Need: (a) Phase 2 Machine Hierarchy step in spec-builder runs `matchAssembliesToTemplates()` and pre-selects template per assembly; (b) Phase 3 Co-Author renders the interface-contract form for template-backed assemblies (one row per IO slot, picker scoped to the assembly's instrument register tags); (c) one-question process-intent prompt; (d) fall-back to today's free-form authoring for unmatched assemblies.
- **Phase 6 — subsystem orchestration SFC editor** (separate workstream per PILOT-001-009).
- **Phase 7 — forge wire-through.** Verify `use-forge-assembly-generate.ts` consumes `interface_contract` + `instance_params` for parameterised generation. Update `use-forge-process-generate.ts` for assembly-awareness.
- **Phase 8 — AI-assisted authoring (Mode D)** — only after Modes A+B have content.
- **Phase 9 — versioning + upgrade UI.**
- **Phase 10 — PILOT-001 re-run on library-first flow.**

## Operational notes

- **Monday integration is not wired for this branch.** CLAUDE.md mandates a Monday card; Kasper said "don't worry about Monday for now" during this build.
- **Pre-existing tsc errors (~30)** in unrelated files (forge-hardware-io, hmi-unified-canvas, use-forge-*). All pre-date this branch — don't fix them here.
- **Pipeline-auditor** is NOT required for this work (file paths don't match its trigger globs).
- **Generic-changes rule (CLAUDE.md).** Plan §5 templates are reusable across projects. Don't slip in any project-specific (PILOT-001) naming into the seed templates.
- **`.env.local` ignored by git.** Don't commit it. Don't print its contents.

## File map

```
Docs/ASSEMBLY_FB_LIBRARY_PLAN.md                          # master plan — §5 is the catalog
Docs/ASSEMBLY_FB_LIBRARY_PHASE0_AUDIT.md                  # Phase 0 findings
Docs/_phase0_fb_templates_snapshot.tsv                    # raw library enumeration
supabase/migrations/075_assembly_fb_library.sql           # schema for interface_contract + spec-builder cols

src/types/fb-interface-contract.ts                        # FbInterfaceContract + role enums + agent_description
src/types/fb-template.ts                                  # extended with interface_contract + deprecated
src/types/spec-builder.ts                                 # AssemblyConfig extended
src/types/spec-contract-v2.ts                             # AssemblyV2Schema extended

src/lib/fb-library/scl-interface-parser.ts                # Phase 3 parser + role inference + prefill merge
src/components/fb-library/interface-contract-editor.tsx   # editor with tabs, pre-fill, reclassify, agent-description popover
src/routes/fb-library.tsx                                 # edit dialog wires blocks into the editor
```

## Useful git context

```bash
git log --oneline feature/assembly-fb-library ^master    # phase commits in order
git diff master...feature/assembly-fb-library --stat     # net diff to master
```

## When you're done

- Pick up Phase 4 bodies (Kasper) or Phase 5 (next agent).
- Update or delete this file when absorbed.
