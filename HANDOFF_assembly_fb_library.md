# Handoff — Assembly FB Library build (post-Phase 3)

**For the next Claude Code session.** Read this once, then delete the file when the work is absorbed.

---

## Where we are

- **Branch:** `feature/assembly-fb-library` (off `master`).
- **Commits (in order):**
  - `e5ba994` — Phase 0 audit + Phase 1 schema/types
  - `a65638b` — Phase 2 interface-contract editor UI
  - `6e6f4e0` — Phase 3 SCL → interface-contract parser ("Pre-fill from SCL")
  - `ae52547` — `agent_description` field + reclassify actions (move rows between Inputs/Outputs ↔ IO Slots)
- **Remote status:** pushed through this handoff update — remote should be even with `HEAD` after the commit that added this file change. Pull on the office laptop to resume.
- **Plan reference:** `Docs/ASSEMBLY_FB_LIBRARY_PLAN.md`. We just finished the editor infrastructure. **Phase 4 (seed v1 catalog — 8 assembly FBs) is next and has not started.**
- **Phase 0 audit:** `Docs/ASSEMBLY_FB_LIBRARY_PHASE0_AUDIT.md`. Headline: all 8 v1 catalog slots are Mode C (author from scratch) — the Open Library V19 import is device-level only.

## What the last session delivered

### Phase 3 — SCL parser (`6e6f4e0`)

- New module `src/lib/fb-library/scl-interface-parser.ts`:
  - `parseSclInterface(scl)` and `parseSclInterfaceFromBlocks(blocks)` extract `VAR_INPUT` / `VAR_OUTPUT` decls out of raw SCL. Fills `name`, `tia_name`, `data_type`, `udt_name` (quoted or unknown identifier), `default_value`, `description` (from trailing `//` comments). Skips `ARRAY` / `STRUCT` (conservative — "leave blank rather than guess").
  - Infers `InterfaceInputRole` / `InterfaceOutputRole` from naming conventions (`AutoRun` → `auto_run`, `FaultCode` → `fault_code`, `AtHome` → `at_home`, etc.). Falls back to `other` when no token matches.
  - `prefillContractFromScl(contract, blocks)` merges parsed rows into the existing contract, de-duping case-insensitively on `tia_name` so engineer-labelled rows are preserved.
- Editor: `InterfaceContractEditor` gained a `sclBlocks?` prop and a "Pre-fill from SCL" button in the header (wand icon). Emits a toast with added / already-present counts. `fb-library.tsx` wires `form.blocks` through.

### Agent-description + reclassify UX (`ae52547`)

- Optional `agent_description?: string` added to `FbInterfaceInput` / `FbInterfaceOutput` / `FbIoSlot` in `src/types/fb-interface-contract.ts`. It's long-form per-pin notes intended for AI prompts when the template is loaded by Co-Author / Spec Builder.
- Editor adds a **Bot-icon popover** per row (all three tabs) for editing that field. Icon turns primary-colored when the field is populated.
- Editor adds **Move-to-IO-Slots** (MoveRight ⮕) and **Move-back** (MoveLeft ⬅) actions:
  - Inputs/Outputs rows → IO Slots: `signal_type` guessed from `data_type` (BOOL → DI/DO, numeric → AI/AO), role defaults to `other`, cardinality `one`.
  - IO Slots rows → Inputs (DI/AI) or Outputs (DO/AO): data type defaults to BOOL (digital) or REAL (analog); role resets to `other`.
  - `description` + `agent_description` carry in both directions.
- Net effect: **SCL naming is now completely unconstrained.** Engineer uses whatever names they want; classification lives in the DB and is one-click adjustable in the editor.

## Key design decisions made (don't re-open these)

1. **IO slots are named pins.** Physical IO lives in `VAR_INPUT` / `VAR_OUTPUT` blocks in the SCL, same as coordination signals. Classification happens in the DB, not the SCL (option #1 in the earlier brainstorm; #2 `VAR_IN_OUT` rejected because it doesn't work for all signal types, #3 global absolute addresses rejected because it kills template reusability across projects).
2. **No SCL naming convention.** We briefly considered `PascalCase` for coordination vs `snake_case` for IO slots; Kasper rejected that and asked for a DB metadata approach instead. Don't reintroduce naming conventions — the parser stays naive (all `VAR_INPUT` → Inputs tab), and the engineer reclassifies with the move buttons.
3. **FB Builder revival is deferred to Phase 8.** There's a stale `src/routes/fb-builder.tsx` (~600 lines, unlinked in sidebar) that was a Pac-ST clone for device-level FB authoring. Kasper raised reviving it; we agreed to **seed v1 manually first → extract patterns from real exemplars → rebuild an Assembly FB Builder as Phase 8 using those patterns.** Don't sprint the Builder now.

## What's next — Phase 4 (seed v1 catalog, all 8 templates)

Plan §5 specifies the 8 canonical templates. All need to be authored from scratch in Siemens style. Kasper is doing the body SCL himself; I proposed scaffolding the declarations + interface contract so the mechanical work isn't repeated 8 times.

**Agreed approach when we left off (not yet executed):**
1. Hand Kasper the SCL skeleton + contract spec for **`conveyor_standard_dol`** (simplest of the 8) as a worked exemplar.
2. Kasper pastes into the FB Library UI via "New Template", clicks **Pre-fill from SCL**, uses the **Move-to-IO-Slots** button for physical-IO pins, fills IO slot roles + ProcessState reads/writes + `agent_description` fields.
3. Kasper writes the body SCL, validates the shape works end-to-end in the library.
4. Once the exemplar is validated, scaffold the remaining 7 (plan §5.1, §5.3 – §5.8) the same way.

**The 8 slots (from plan §5):**
- §5.1 `conveyor_standard_vsd` — VSD (Sinamics G120C, telegram 352 + safety 30)
- §5.2 `conveyor_standard_dol` — Direct-on-line, motor contactor + overload ← **start here**
- §5.3 `transfer_table_2axis` — lift + traverse with internal mode machine
- §5.4 `turntable_single_stop` — rotate between two fixed positions
- §5.5 `pusher_linear_cylinder` — pneumatic/hydraulic linear pusher
- §5.6 `diverter_swing_gate` — 2-way sortation node
- §5.7 `lift_station_vertical` — vertical lift, 2-3 levels
- §5.8 `accumulator_buffer_conveyor` — upstream/downstream ready handshake

For each template: `category` appropriate (Conveyors / Supplementary / Motors etc.), toggle `is_assembly = true`, populate `interface_contract`, set `process_state_reads[]` / `process_state_writes[]`. `agent_description` on every row is a high-leverage field to fill — it's what future agents see.

**When resuming:** my last message asked Kasper "Ready to scaffold `conveyor_standard_dol` as the Phase 4 exemplar?" — he cleared context instead. First question on resume: confirm he still wants to start with DOL, then deliver the SCL skeleton + contract spec. The skeleton I drafted earlier in the session is a reasonable starting point but can be regenerated — don't feel bound to it.

## Verification checklist if anything looks off

1. `git status` — clean (or only `HANDOFF_*.md` untracked).
2. `git log --oneline -5` — top should be `ae52547`.
3. `npm run dev` — boots without errors. `.env.local` should exist at repo root; if missing, copy from `C:\Users\Work\Pac Technologies Dropbox\Kasper Simonsen\dev\pac-forge\.env.local`.
4. `/fb-library` → edit any template → "Interface Contract" section renders with Inputs / Outputs / IO Slots / ProcessState tabs.
5. "Pre-fill from SCL" button populates inputs/outputs from the SCL blocks.
6. Each row has three trailing icons: Bot (agent description), MoveRight/MoveLeft (reclassify), Trash (remove).
7. Moving a row between tabs round-trips description + agent_description.

## Operational caveats

- **Monday integration is not wired for this branch.** CLAUDE.md mandates a Monday card before any code, but the earlier attempts in this series failed silently. Kasper said "don't worry about Monday for now" during this session — respect that unless he changes his mind.
- **Pre-existing tsc errors (~30)** in unrelated files (forge-hardware-io, hmi-unified-canvas, use-forge-*). All pre-date this branch. Don't try to fix them here.
- **Pipeline-auditor (`.claude/agents/pipeline-auditor.md`) is NOT required for Phase 4.** Its trigger patterns cover `src/hooks/use-forge-*`, `src/hooks/use-pipeline-*`, `src/lib/*-prompt*.ts`, `src/lib/forge-*.ts`, `src/lib/pipeline.ts`. Phase 4 work lives in FB Library / templates — not those paths. Skip unless you touch a forge hook.
- **Generic-changes rule (CLAUDE.md).** Plan §5 templates target generic conveyor / lift / etc. shapes. Don't slip in any project-specific (PILOT-001) naming into the seed templates — they're meant to be reusable across projects.
- **`.env.local` ignored by git.** Don't commit it. Don't print its contents. The Supabase project is `fsxfdkjjkbkzjntjxiyi`.

## Carryover questions — RESOLVED (session 2)

1. **VSD telegram** → **parameterise**. `conveyor_standard_vsd` (§5.1) should let the instance pick telegram (352 / 20 / 111 / etc.); the `vsd_drive` IO slot's UDT typing follows from the chosen telegram. Likely means a template-level config field (e.g. `telegram_type` enum) rather than one template per telegram. Don't hard-bind to Sinamics G120C + telegram 352.
2. **ProcessState UDT naming** → **`ProcessState_<SUBSYSTEM>.<assembly_tag>_<signal_name>`**. Assembly tags (CV01, LFT01, PSH01…) are **globally unique across the whole system** — not unique-per-subsystem — so no nested UDT path is needed. In each template's `process_state_writes[]` / `process_state_reads[]`, store entries with substitution tokens:
   ```
   ProcessState_{subsystem}.{assembly}_at_home
   ProcessState_{subsystem}.{assembly}_running
   ProcessState_{subsystem}.{assembly}_faulted
   ```
   Spec builder substitutes `{subsystem}` + `{assembly}` at generation time from the hierarchy.
3. **FB VERSION** → **`VERSION : 1.0`** on every seed SCL. No `0.x` for the shipped library.

## Immediate next action (confirmed before context-switch)

Scaffold `conveyor_standard_dol` (§5.2) as the Phase 4 worked exemplar. Deliver:
- **SCL skeleton** — header (`FUNCTION_BLOCK`, `VERSION : 1.0`, `{ S7_Optimized_Access := 'TRUE' }`), full `VAR_INPUT` / `VAR_OUTPUT` / `VAR` / `VAR_TEMP` declarations, empty `BEGIN … END_FUNCTION_BLOCK`. Kasper writes the body SCL himself.
- **Full interface contract spec** — every row of Inputs / Outputs / IO Slots / ProcessState reads + writes, with `role`, `description`, and `agent_description` populated. Use the `{subsystem}` + `{assembly}` tokens in the ProcessState entries.

Kasper will paste the skeleton into FB Library → New Template → Pre-fill from SCL → use Move-to-IO-Slots for physical pins → fill roles + agent_description from the spec → write the body → validate end-to-end. Once DOL is validated, scaffold the remaining 7 (§5.1, §5.3 – §5.8) the same way.

The "start with DOL" decision from the previous session still stands; Kasper confirmed on resume.

## Quick file map

```
Docs/ASSEMBLY_FB_LIBRARY_PLAN.md                   # master plan — §5 is the catalog
Docs/ASSEMBLY_FB_LIBRARY_PHASE0_AUDIT.md           # Phase 0 findings
Docs/_phase0_fb_templates_snapshot.tsv             # Raw 105-row library enumeration
supabase/migrations/075_assembly_fb_library.sql    # Schema for interface_contract + deprecated + spec-builder cols

src/types/fb-interface-contract.ts                 # FbInterfaceContract + role enums + agent_description (Phase 2 + new field)
src/types/fb-template.ts                           # Extended with interface_contract + deprecated
src/types/spec-builder.ts                          # AssemblyConfig extended
src/types/spec-contract-v2.ts                      # AssemblyV2Schema extended

src/lib/fb-library/scl-interface-parser.ts         # Phase 3 parser + role inference + prefill merge
src/components/fb-library/interface-contract-editor.tsx  # Editor with tabs, pre-fill, reclassify, agent-description popover
src/routes/fb-library.tsx                          # Edit dialog wires blocks into the editor
```

## Useful git context

```bash
git log --oneline feature/assembly-fb-library ^master    # Phase commits in order
git diff master...feature/assembly-fb-library --stat     # Net diff to master
git show --stat 6e6f4e0                                  # Phase 3 parser
git show --stat ae52547                                  # agent_description + reclassify
```

## When you're done

- Commit on the branch as you land exemplars. Use the established `feat(assembly-fb): …` style.
- If you land all 8, push the branch.
- Update this file or delete it when the work is absorbed.
