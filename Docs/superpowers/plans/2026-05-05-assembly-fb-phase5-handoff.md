# Handoff — Assembly FB Library Phase 5 complete

**For the next Claude Code session.** Read this once, then delete or archive when absorbed.

---

## Where we are

- **Branch:** `feature/assembly-fb-library` (off `master`)
- **PR:** https://github.com/KasperPac/pac-forge/pull/1 — open, not yet merged
- **Plan reference:** `Docs/superpowers/plans/2026-05-04-assembly-fb-library-hybrid-phase5.md`
- **Acceptance doc:** `Docs/superpowers/plans/2026-05-04-assembly-fb-library-hybrid-phase5.acceptance.md`

### Phase status

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Audit | ✅ |
| 1 | Migration 075 + types | ✅ |
| 2 | FB Library contract editor UI | ✅ |
| 3 | SCL → contract parser + Pre-fill | ✅ |
| 4 | Seed v1 catalog (8 templates, contracts in DB) | ✅ |
| 5 | Contract-as-universal-unit hybrid | ✅ code-complete, PR open |
| 6 | SFC call shape integration | ⏳ not started |

---

## What Phase 5 built

### New files

| File | Purpose |
|------|---------|
| `src/types/sfc-call-shape.ts` | Pre-flight typed boundary for Phase 6 SFC integration (`AssemblySfcCallSpec`, `AssemblyCallSite`) — types only, no runtime |
| `src/lib/forge-assembly-contract-prompt.ts` | Pure fn `buildContractConstraintBlock()` — renders `FbInterfaceContract` as a structured "MUST MATCH EXACTLY" prompt fragment |
| `src/lib/fb-library/contract-drift.ts` | Pure fns `compareToContract()` + `formatDriftFeedback()` — produces `DriftReport { hardDrifts, softDrifts, hasHardDrift }` |
| `src/lib/fb-library/contract-skeletons.ts` | 6 hardcoded starter contract shapes (`from_scratch` + 5 typed) + `getSkeleton()` helper |
| `src/components/spec-builder/co-author-assembly-contract.tsx` | New wizard panel — library path (`LibraryContractPanel`) and custom path (`CustomContractPanel`) with skeleton picker, `InterfaceContractEditor`, Generate button, Monaco SCL pane, drift chip |
| `src/hooks/use-promote-to-library.ts` | Mutation hook — mints `fb_templates` row from a custom assembly's contract + SCL (`is_assembly=true`, `source="custom"`, `profile_ids` for scope) |
| `src/components/spec-builder/promote-to-library-dialog.tsx` | Dialog — name/category/description/scope, name uniqueness check, success toast |
| `supabase/migrations/076_assembly_custom_scl.sql` | Adds `generated_scl_blocks jsonb NOT NULL DEFAULT '[]'` to `fds_assembly_sessions` (idempotent) |
| `supabase/migrations/077_assembly_interface_contract.sql` | Adds `interface_contract jsonb NOT NULL DEFAULT '{}'` to `fds_assembly_sessions` (idempotent) |

### Key modified files

| File | What changed |
|------|-------------|
| `src/types/fb-interface-contract.ts` | Custom role escape hatch — `role` union accepts `custom:<name>` strings via `isCustomRole()` helper |
| `src/components/fb-library/interface-contract-editor.tsx` | Custom role UI affordance in the contract editor |
| `src/types/spec-builder.ts` | `FdsAssemblySession` extended: `generated_scl_blocks`, `process_intent`, `interface_contract`, `created_at` |
| `src/hooks/use-fds-session.ts` | `applyShim()` normalises new fields; new `useUpdateAssemblyContractAndScl()` mutation |
| `src/hooks/use-forge-assembly-generate.ts` | Contract injection + drift retry loop (max 2 retries); library path bypasses contract entirely |
| `src/lib/forge-prompts.ts` | `buildAssemblySclPrompt()` injects `buildContractConstraintBlock()` when contract is populated |
| `src/types/forge.ts` | `ForgeArtifact.drift?: DriftReport` field |
| `src/components/spec-builder/fds-co-author.tsx` | Contract/interview tab toggle per assembly; `CoAuthorAssemblyContract` panel; `PromoteToLibraryDialog` wiring |

---

## Architecture summary

Every assembly — whether matched to a library template or AI-generated custom — now carries an `FbInterfaceContract`. Generation works as follows:

```
Assembly has fb_template_id?
  YES → LibraryContractPanel: show template contract (read-only), wire IO slots, fill process_intent
        forge step: copy template blocks, no AI call
  NO  → CustomContractPanel: pick skeleton → edit contract → Generate
        AI call with contract injected as structural constraint
        Drift check → retry loop (max 2) → DriftChip (green/red)
        Optionally: promote to library via PromoteToLibraryDialog
```

Token substitution: `{subsystem}` and `{assembly}` in `process_state_writes/reads` are resolved at generation time using `assembly.tag` and the subsystem name from the co-author context.

---

## Pending before merging PR

### 1. Live acceptance run (required)

The acceptance doc (`2026-05-04-assembly-fb-library-hybrid-phase5.acceptance.md`) has 5 items marked ⏳ that require a human tester with `npm run dev` running:

- Library-bound assembly end-to-end (template preview → IO slots → process intent → save)
- Custom assembly end-to-end (skeleton → contract → Generate → SCL in Monaco)
- Drift retry loop (deliberately mismatch contract after generating, confirm warn logs + red chip)
- Promote-to-library (clean custom assembly → dialog → save → verify in `/fb-library`)
- Confirm no fallback to free-form prose authoring

After running, update the acceptance doc and commit.

### 2. Apply migrations to remote Supabase

```bash
npx supabase db push
```

Both migrations are idempotent (`IF NOT EXISTS`) — safe to run against any environment.

---

## Known open follow-ups (filed in acceptance doc)

These were discovered during implementation — none block Phase 5 merge but should be addressed in a future plan:

| # | Description | Effort |
|---|-------------|--------|
| 1 | IO slot inputs in library path look editable but aren't — needs clearer read-only label | Low |
| 2 | Process intent in custom path not auto-saved on blur (library path does save on blur) | Low — 15-line fix |
| 3 | No "regenerate needed" indicator when contract is edited after SCL generation | Medium |
| 4 | Promote button should be gated on `!driftReport?.hasHardDrift` (currently not) | Low |
| 5 | Drift retry logs not surfaced in co-author UI (collected internally, not shown) | Low |
| 6 | Instance params display decision — editable from co-author or forge-wizard-only? | Design decision needed |

---

## Phase 6 entry point

The SFC call shape types are in `src/types/sfc-call-shape.ts`:

```ts
AssemblySfcCallSpec   // typed boundary for what Phase 6 will generate per assembly
AssemblyCallSite      // per-device call site within the assembly FC
```

Phase 6 will consume `FdsAssemblySession.interface_contract` and `generated_scl_blocks` to generate the call FCs that wire assemblies into the process sequence SFCs.

---

## Useful commands

```bash
npm run dev          # Start dev server
npm run build        # TypeScript check + Vite build (44 pre-existing TS errors on master, unchanged)
npx supabase db push # Apply migrations to remote
git log --oneline master..feature/assembly-fb-library  # See all Phase 5 commits (18 commits)
```
