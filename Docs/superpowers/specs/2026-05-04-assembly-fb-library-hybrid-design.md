# Assembly FB Library — Hybrid Architecture (Critique + Design)

**Status:** DESIGN — pending engineer approval
**Owner:** Kasper
**Date:** 2026-05-04
**Branch:** `feature/assembly-fb-library`
**Supersedes (in part):** `Docs/ASSEMBLY_FB_LIBRARY_PLAN.md` Phases 5–10
**Reuses without change:** Phases 0–4 of the original plan (audit, schema, editor, parser, seed catalog)

---

## 1. Why this document exists

The original plan (`Docs/ASSEMBLY_FB_LIBRARY_PLAN.md`, 2026-04-23) committed to a library-first architecture: every assembly is bound to an `FbTemplate`; the wizard's role is to wire instance parameters; per-assembly sequence authoring goes away. Phases 0–4 implemented the foundation (audit, schema migration `075`, contract editor UI, SCL parser, 8 seed templates with contracts).

Before sinking the L-sized Phase 5 (spec-builder integration), we ran a critique session focused on whether the library-first approach scales to **complex Pac projects** and what alternatives exist. Two findings tilted the design:

1. **Coverage math from real project sizing.** Typical projects = ~10 distinct assembly types; complex projects = up to 30. Pac's "standard" floor is ~8 assemblies. That gives the seeded library 27% coverage on complex projects (8 of 30) and ~80% on typical (8 of 10). The plan's implicit model — library covers most, custom is an escape hatch — inverts on complex projects.
2. **Today's free-form custom-assembly authoring is C-grade.** AI-generated assembly FBs without structural constraints are inconsistent and don't repeat well. Library-first was partly a flight from that pain. Pure library-first leaves the 73% custom case on complex projects inheriting that same pain.

The hybrid design below keeps Phases 0–4 intact and modifies Phases 5–10 so the contract becomes the universal authoring unit, with library copy and AI generation as interchangeable SCL sources.

## 2. Architecture — Contract as Universal Unit

```
                    ┌──────────────────────────────────────────────┐
                    │  Spec → assemblies (one per machine element) │
                    └──────────────────┬───────────────────────────┘
                                       │
                       matchAssembliesToTemplates()
                                       │
                ┌──────────────────────┴──────────────────────┐
                │                                             │
        confidence ≥ probable                       confidence = none
                │                                             │
                ▼                                             ▼
   ┌─────────────────────────┐                  ┌─────────────────────────────┐
   │  Library path           │                  │  Custom path                │
   │  • Template picked      │                  │  • Engineer authors         │
   │  • Contract pre-filled  │                  │    contract (form)          │
   │  • SCL copied from      │                  │  • AI generates SCL         │
   │    template blocks      │                  │    constrained BY contract  │
   │  Engineer task:         │                  │  Engineer task:             │
   │  ─ wire IO slots        │                  │  ─ author contract          │
   │  ─ set instance params  │                  │  ─ wire IO slots            │
   │                         │                  │  ─ review & approve SCL     │
   │                         │                  │  ─ optional: "Save to lib"  │
   └────────────┬────────────┘                  └──────────────┬──────────────┘
                │                                              │
                └──────────────────────┬───────────────────────┘
                                       ▼
                    ┌──────────────────────────────────────┐
                    │  Bound AssemblyConfig                │
                    │  • interface_contract  (always)      │
                    │  • SCL blocks          (always)      │
                    │  • instance_params     (always)      │
                    │  • fb_template_id      (only if lib) │
                    └──────────────────┬───────────────────┘
                                       ▼
                    [Phase 6 — subsystem SFC orchestration]
                    [Phase 7 — forge generation, unchanged]
```

### Three load-bearing principles

1. **Contract is universal.** Every assembly carries a complete `interface_contract` regardless of origin. Downstream consumers (SFC orchestration, forge generation, ProcessState UDT assembly, Pac-Audit) only consume the contract — they don't branch on origin.
2. **Contract precedes SCL.** For custom assemblies the contract is authored *before* AI generates SCL. AI receives the contract as a structural constraint in its prompt and must produce SCL whose `VAR_INPUT` / `VAR_OUTPUT` / IO bindings / UDT writes match the contract.
3. **Promotion is one-click.** A custom assembly's contract+SCL combo can be saved as a new library template after engineer review. The library grows project-by-project.

### What this changes vs original plan

- The custom path is no longer an escape hatch — it is a first-class authoring flow with the same downstream guarantees as the library path.
- Today's free-form prose authoring (`forge-assembly-fb.tsx`) becomes a fallback-to-the-fallback, used only when the engineer doesn't want to author a contract (rare, primarily for prototyping).

## 3. Per-bet verdicts (critique findings)

| # | Bet from critique | Verdict | Reasoning |
|---|---|---|---|
| 1 | Composition fit — 8 templates cover real projects | MODIFY | 27–80% coverage. Hybrid B fixes by making custom path first-class. |
| 2 | Closed role enums scale | MODIFY | Plan §8.4 already flagged. Add `custom:<name>` escape hatch on each role enum (`InterfaceInputRole`, `InterfaceOutputRole`, `IoSlotRole`). Existing `"other"` value is too coarse. |
| 3 | "No per-assembly sequence authoring" | KEEP for library, MODIFY for custom | Engineer never authors sequences visually. Library inherits from template SCL. Custom inherits from AI generation constrained by contract. Promise to engineer holds; implementation differs. |
| 4 | Matcher accuracy | KEEP, observe | Current name+summary affinity is fine for 8 templates. Won't scale to 30+, but that's a Phase 9 problem. Manual override is already first-class. |
| 5 | Phase 5 ↔ Phase 6 coupling | MODIFY | Sketch the contract→SFC call shape before locking Phase 5 contract UX. Doesn't require building Phase 6 — just specifying the boundary. |
| 6 | AI-first vs library-first | RESOLVED by hybrid | Both, contract-mediated. Prior architecture doc (`Docs/forge-plan/ASSEMBLY_ARCHITECTURE.md`) recommendation isn't contradicted — superseded by a more complete design. |
| 7 | 🆕 Promote-to-library workflow | NEW PHASE — must add | Critical for library to grow project-by-project. Adds Phase 5.5. |
| 8 | 🆕 AI-against-contract prompt | NEW WORK in Phase 5 | Modify `use-forge-assembly-generate.ts` + `forge-assembly-prompts.ts`. |
| 9 | 🆕 Custom contract-authoring UX in wizard | NEW WORK in Phase 5 | Reuse `interface-contract-editor.tsx` (Phase 2 component) inline in spec wizard. |

## 4. Phase 5 redesign

The wizard's overall flow stays as currently designed (Phase 2 Machine Hierarchy → Phase 3 Co-Author → downstream). What changes is the Co-Author step: instead of branching into "library form OR free-form prose", it branches into "library-pre-filled contract OR custom-authored contract" — and both end on the same artifact shape.

### 4.1 Sequencing within Phase 5

1. **Pre-flight (~½ day).** Sketch the contract→SFC-call shape (a typed interface, no implementation). Ensures Phase 6 won't push back contract design. Boundary spec only.
2. **Wizard plumbing (M).** Embed `InterfaceContractEditor` (from Phase 2) inline in Co-Author. Wire the Phase 2 match → Phase 3 prefill flow for library assemblies. Add `process_intent` textarea on every assembly.
3. **AI-against-contract path (L).** The heavy piece — see §5 for technical detail.
4. **Skeleton picker (S).** Dropdown of starter contract shapes (`from scratch`, `single-actuator`, `two-actuator`, `rotary`, `lift`, `accumulator`). Pre-fills the contract editor so the engineer isn't staring at a blank form. Hardcoded shapes for v1; library-aware as a follow-up.
5. **Phase 5.5 — Promote to library (S).** "Save as library template" button on saved custom assemblies. Dialog asks for name/category/description/scope. Posts the assembly's contract+SCL as a new `fb_template` row with `is_assembly = true`, `source = "custom"`, mints v1.0 cleanly. Default scope: scope-limited on first save (exact mechanism — `profile_ids[]` gating, draft flag, or new field — see §8.2); explicit promote-to-global later.

### 4.2 Co-Author wizard step — both paths

**Library-bound assembly (template matched):**
- Header: assembly tag, matched template name + version, confidence score, "change template" link
- Process intent textarea (optional but encouraged)
- IO slots form: one row per template slot, each with a picker scoped to this assembly's instrument register tags
- Instance params form: typed fields per template parameter
- SCL view: read-only Monaco pane showing template SCL with `{subsystem}`/`{assembly}` tokens substituted
- Actions: `Save assembly`

**Custom assembly (no template match or engineer rejected):**
- Header: assembly tag, "no template — authoring custom" status, "match again" link
- Skeleton picker: pre-fills contract editor with starter shape
- Process intent textarea: **required** for custom (drives AI generation)
- Contract editor: same `InterfaceContractEditor` component as FB Library, embedded inline
- Actions: `Generate SCL from contract` → AI generates → SCL pane (Monaco, editable) → `Regenerate` / `Save assembly` / `★ Save as library template`

## 5. AI-against-contract design (technical core)

The load-bearing new technique. If this works, the hybrid succeeds; if it doesn't, we are back to today's inconsistency.

### 5.1 Contract injected as structural constraint in the system prompt

Modify `forge-assembly-prompts.ts` (specifically `buildAssemblyContractPrompt()`). Today it teaches AI the abstract concept of contracts. We add: the concrete contract for THIS assembly as a hard constraint.

Example prompt fragment:

```
## INTERFACE CONTRACT — STRUCTURAL, MUST MATCH EXACTLY

You MUST declare the FUNCTION_BLOCK with exactly these inputs, outputs,
and references. You may not add, remove, or rename them.

VAR_INPUT (declare with these exact names and types):
  AutoRun     : BOOL    // role: auto_run
  CmdPick     : BOOL    // role: start_cmd
  Reset       : BOOL    // role: reset_cmd

VAR_OUTPUT (declare with these exact names and types):
  PartGripped : BOOL    // role: at_target
  Faulted     : BOOL    // role: faulted
  FaultCode   : WORD    // role: fault_code

IO BINDINGS (must be referenced via instance params, not hardcoded):
  gripper_solenoid : DO  // role: actuator
  prox_grip        : DI  // role: position_sensor

PROCESS STATE WRITES (must write to these exact UDT members):
  ProcessState_{subsystem}.{assembly}_PartGripped : BOOL
```

Contract injection is purely additive — abstract teaching stays, concrete constraint is added. Prompt size grows by ~30 lines per assembly.

### 5.2 Validation pass — reuses Phase 3 SCL parser

After AI returns SCL, run `parseSclInterface()` (already built for the FB Library Pre-fill button). Compare extracted interface to the contract:

| Drift type | Example | Action |
|---|---|---|
| Hard — missing required | Contract declares `Reset`, generated SCL omits it | Auto-regenerate |
| Hard — wrong type | Contract `FaultCode : WORD`, generated `: INT` | Auto-regenerate |
| Hard — undeclared addition | Generated declares `EmergencyStop` not in contract | Auto-regenerate |
| Soft — extra internal var | Generated has internal `intStateTimer` not declared | Allow |
| Soft — extra fault code constant | Generated adds `FAULT_GRIPPER_TIMEOUT = 16#FF03` | Allow |

### 5.3 Regenerate loop — copy the `use-compile-fix.ts` pattern

```
Generate → Validate → drift?
                       │
            ┌──────────┴──────────┐
           yes                    no
            │                     │
   Retry ≤ 2 with                 │
   drift block prepended       Save to wizard
            │                     │
   After 2 retries:              [optional: "Save as
   surface to engineer            library template"]
   with diff view
```

Drift-feedback prompt prefix on retry:

```
## PREVIOUS GENERATION HAD DRIFT — FIX THESE

You declared `EmergencyStop : BOOL` which is not in the contract.
You omitted `Reset : BOOL` which is required.
Regenerate the FUNCTION_BLOCK to match the contract exactly.
```

Same self-correction shape as the compile-fix loop in `src/hooks/use-compile-fix.ts` — proven pattern.

### 5.4 File deltas (concrete)

| File | Change |
|---|---|
| `src/lib/forge-assembly-prompts.ts` | Add `buildContractConstraintBlock(contract)` — renders contract as injectable prompt fragment |
| `src/lib/scl-interface-parser.ts` (Phase 3) | Add `compareToContract(parsed, contract): DriftReport` |
| `src/hooks/use-forge-assembly-generate.ts` | Accept `contract` arg; on response, run validation; if drift → retry up to 2 with drift feedback; surface remaining drift to caller |
| `src/components/spec-builder/co-author-assembly-custom.tsx` (NEW) | Wizard step that hosts contract editor + Generate button + Monaco SCL pane + drift indicator + Regenerate / Save buttons |
| `src/hooks/use-promote-to-library.ts` (NEW) | Save custom assembly's contract+SCL as a new `fb_template` row |
| `src/components/spec-builder/promote-to-library-dialog.tsx` (NEW) | Modal: name/category/description/scope when promoting |
| `src/types/fb-interface-contract.ts` | Add `custom:<name>` escape-hatch values to role enums |

### 5.5 Risks named explicitly

- **AI body quality is the biggest unknown.** Structural validation catches drift, not semantic correctness. Mitigation: run the existing Standards Reviewer agent (from Pac-ST main pipeline) on AI-generated assembly bodies before save. PILOT-001 in Phase 10 is the empirical test.
- **Promotion polluting library with project-specific cruft.** Mitigation: scope-limit promoted templates on first save (exact mechanism — `profile_ids[]` gating, draft flag, or new field — is open question §8.2). Explicit promote-to-global step requires review. No automatic global promotion.
- **Contract gaps for novel assembly shapes.** What if engineer needs an interface input role that doesn't fit the closed enum? Mitigation: `custom:<name>` escape hatch on every role enum.
- **Contract-as-constraint may reduce AI creativity in body logic.** That is the goal — consistency over cleverness. Edge case where AI invents a useful fault code not in the contract: drift on fault-code constants is *soft* (allowed), and engineer can promote interesting AI-invented bits into the contract before save.

## 6. Cascading impacts on Phases 6–10

Most of these get easier because the contract is now universal — downstream phases stop branching on origin.

| Phase | Impact | Notes |
|---|---|---|
| **6 — Subsystem SFC editor** | Same shape, easier | SFC operates on contracts only — origin-blind. Pre-flight task in §4.1 protects this. |
| **7 — Forge wire-through** | Slightly broadened | `use-forge-assembly-generate.ts` heavily modified in Phase 5. Phase 7 verifies the library copy path (template SCL + instance params injection) still works alongside the new custom path. |
| **8 — AI-assisted authoring (Mode D)** | Mostly subsumed by Phase 5 | The "AI generates SCL" piece moves to Phase 5. Phase 8 shrinks to "AI proposes contract from prose" — a UX shortcut for the custom path. **Recommend: kill Phase 8 as a phase, log as a Phase 5 stretch goal.** |
| **9 — Versioning + upgrade UI** | Same shape | Applies equally to seed templates + project-promoted templates. Promotion (Phase 5.5) must mint clean v1.0 records so this works. |
| **10 — PILOT-001 re-run** | Better test | Stress-tests both paths. PILOT-001 has 1–2 custom assemblies (transfer table mode machine, lift safety descend) that exercise AI-against-contract — exactly what we want validated before declaring v1 ready. |

**Pac-Audit (plan §8.7):** with hybrid, both library-bound and custom-promoted assemblies emit FBs that don't instantiate devices. Rule simplifies: **R09b — "any contract-bound assembly FB"** (no need to distinguish library vs custom origin in audit). Single rule, simpler classification.

## 7. Out-of-scope (kill list — don't reopen)

- Variant-layer composition (Alternative C from the brainstorm) — defer to v2 unless v1 hits a wall
- Multi-instance template patterns (one template instantiated N times within itself)
- Real-time contract editing during generation (engineer changes contract mid-stream)
- HMI faceplate auto-generation from contract
- TIA export back to .zap library (consume only)

## 8. Open questions to resolve in implementation

1. SFC call shape (§4.1 pre-flight) — boundary spec, ~½ day
2. "Save as library template" defaults — global scope vs scope-limited on first save? `FbTemplate.profile_ids[]` exists today for design-profile gating; could repurpose, or add a draft/staging flag. Recommendation: scope-limited via existing `profile_ids[]` if a "project profile" exists, otherwise add a `staged: boolean` column. Decide in implementation
3. Skeleton picker — hardcoded 5 vs library-aware. Recommendation: hardcoded for v1
4. Drift severity tuning — calibrate hard vs soft drift after first 20 generations
5. Pac-Audit R09b rule shape (§6 above)

## 9. Success criteria

The hybrid v1 ships when:

- [ ] Phase 5 wizard supports both library-bound and custom-authored assemblies through a single Co-Author step
- [ ] AI-against-contract generation produces structurally-valid SCL on first attempt for ≥80% of test cases (target empirical, will calibrate)
- [ ] Drift detection catches 100% of `VAR_INPUT`/`VAR_OUTPUT` mismatches; regenerate loop resolves ≥80% of detected drift within 2 retries
- [ ] "Save as library template" mints clean v1.0 `fb_template` records that downstream Phase 9 versioning can consume
- [ ] PILOT-001 re-run on hybrid path: every assembly is contract-backed; library path used where matched; custom path used elsewhere; final compile-clean code in TIA V18
- [ ] No assembly in PILOT-001 falls back to today's free-form prose authoring

## 10. What to do next

This document is the input to a structured implementation plan. The next session should invoke the writing-plans skill, with this design doc as the spec.

The plan should bite-size Phase 5 into:
- Pre-flight (SFC call shape sketch)
- Wizard plumbing (embed editor inline)
- AI-against-contract prompt + validation + regenerate loop
- Skeleton picker
- Phase 5.5 — Promote-to-library
- Plus the small role-enum extension for `custom:<name>` escape hatch

Phases 6, 7, 9, 10 stay as scoped in the original plan with the cascading-impact notes from §6 above. Phase 8 is killed as a phase and logged as a Phase 5 stretch.

---

**References:**
- Original plan: `Docs/ASSEMBLY_FB_LIBRARY_PLAN.md`
- Phase 0 audit: `Docs/ASSEMBLY_FB_LIBRARY_PHASE0_AUDIT.md`
- Prior recommendation (superseded): `Docs/forge-plan/ASSEMBLY_ARCHITECTURE.md` Open Question #2
- Phase-4 handoff (current state): `HANDOFF_assembly_fb_library.md`
- Visual companion artifacts: `.superpowers/brainstorm/2443-1777852534/content/`
