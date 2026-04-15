# Contributing to Pac-Forge

Internal guide for engineers working on Pac-Forge. Read `CLAUDE.md` first for architecture and tech constraints.

## Repository

- **GitHub**: https://github.com/KasperPac/pac-forge
- **Default branch**: `master` (protected — no direct pushes)
- **Task tracking**: Monday.com board `5092432355`

## Workflow

Every change — bug fix, feature, tweak — follows the same loop:

1. **Create the Monday task first** (see `CLAUDE.monday.md`). No code before the task exists.
2. **Branch from `master`**
3. **Work on the branch** — commit early, commit often
4. **Open a PR** when ready for review (or when you want CI to run)
5. **Merge via squash** after review passes
6. **Update Monday** to `Awaiting Testing` → `Done`

## Branch Naming

Use typed prefixes matching Monday item IDs:

| Prefix      | Use case                         | Example                                |
|-------------|----------------------------------|----------------------------------------|
| `feat/`     | New feature (FEAT-XX)            | `feat/feat-42-hmi-faceplates`          |
| `fix/`      | Bug fix (BUG-XX)                 | `fix/bug-108-compile-db-naming`        |
| `imp/`      | Improvement (IMP-XX)             | `imp/imp-31-pipeline-logging`          |
| `ui/`       | UI/UX change (UI-XX)             | `ui/ui-17-sidebar-redesign`            |
| `chore/`    | Tooling, docs, deps (no ticket)  | `chore/update-eslint-config`           |

One branch per Monday item. Rebase on `master` before opening the PR.

## Module Ownership

Split to minimize merge conflicts on hot files. Owners are **first reviewers**, not gatekeepers — anyone can touch anything, but ping the owner on the PR.

| Area                                          | Owner     |
|-----------------------------------------------|-----------|
| Pac-ST pipeline + prompts                     | Kasper    |
| .NET TIA Bridge (`bridge/`)                   | Kasper    |
| Pac-LAD (`src/routes/pac-lad.tsx`, LAD libs)  | TBD       |
| HMI Builder (`src/components/hmi-editor/`)    | TBD       |
| Supabase migrations + Edge Functions          | Kasper    |
| Agent/knowledge system                        | TBD       |

**High-contention files** — coordinate in Monday or Slack before editing in parallel:
- `src/lib/prompt-builder.ts`
- `src/lib/pipeline.ts`
- `src/stores/pac-st-store.ts`
- `src/routes/pac-st.tsx`
- `supabase/migrations/*`

## Pull Requests

### Opening a PR

- **Title**: short, imperative — `fix: normalize DB names in step matcher` (≤70 chars)
- **Body**: use the template below
- **Link the Monday item**: paste the URL in the description
- **Keep PRs small**: <500 lines diff when possible. Split refactors from feature work.

### PR template

```markdown
## Summary
- What changed and why (1-3 bullets)

## Monday
https://pactech-group.monday.com/boards/5092432355/pulses/XXXXXXXXX

## Test plan
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
- [ ] Manual test: <what you clicked through>
- [ ] Bridge smoke test (if bridge changed)

## Risk
- Files outside your ownership touched? List them.
- Breaking changes? Migration needed?
```

### Merging

- **Squash merge** into `master` — keeps history linear
- Delete the branch after merge
- Update the Monday task to `Awaiting Testing`

## Migrations & Shared State

Supabase is shared across all engineers. Coordinate schema changes:

1. **Announce migrations in Monday before writing them** — avoids two people numbering `008_*.sql` simultaneously
2. **Never edit a migration that has been pushed** — always add a new one
3. **Test locally first** with `npx supabase start` before `npx supabase db push`
4. **Edge function deploys** (`npx supabase functions deploy generate`) are global — one person at a time, announce first

Monday has an API budget constraint — see `CLAUDE.md` ("MINIMIZE CALLS"). Don't spam comments on every step.

## Environment Per Engineer

Each engineer needs:

**Required**
- Node 20+, npm
- `.env.local` with Supabase URL + anon key (ask Kasper)
- Git with GitHub SSH or HTTPS access

**For TIA Bridge work (Windows only)**
- Windows 11
- TIA Portal V18 (match production — see memory: Openness DLL at `Portal V18\PublicAPI\V18\Siemens.Engineering.dll`)
- .NET Framework 4.8 Developer Pack + .NET SDK 8.0
- Update `HintPath` in `bridge/PacForgeBridge/PacForgeBridge.csproj` to match your TIA install

**Secrets**
- `ANTHROPIC_API_KEY` — only Kasper holds deploy rights. Edge function proxies Claude API, so local dev uses the deployed function, not a local key.

## Code Style

- TypeScript strict mode is non-negotiable (`verbatimModuleSyntax`, `noUnusedLocals`)
- Tailwind utility classes only — no inline styles, no additional UI frameworks
- shadcn/ui for primitives (`npx shadcn@latest add <component>`)
- Import alias `@/` for `src/`
- Dark-first UI, dense spacing (see `UI_STYLE_GUIDE.md`)
- `npm run build && npm run lint` must pass before opening a PR

## When You Get Stuck

- Architecture questions → `CLAUDE.md` and `Docs/PAC_ST_MASTER_SPEC.md`
- TIA Openness questions → `Docs/TIA_OPENNESS_INTEGRATION.md` and memory: `tia-openness-api.md`
- SCL generation rules → `ai/PLATFORM_RULES_SIEMENS_TIA.md` and `ai/SCL_LANGUAGE_REFERENCE.md`
- Pattern learning / agent flow → `Docs/agent-flow.mmd`

## Quick Reference

```bash
# New task
git checkout master && git pull
git checkout -b fix/bug-NN-short-description

# While working
npm run dev                    # Vite dev server
dotnet run --project bridge/PacForgeBridge    # TIA bridge
npm run lint                   # Before committing
npm run build                  # Before pushing

# Ship it
git push -u origin <branch>
gh pr create                   # Opens PR with template
```
