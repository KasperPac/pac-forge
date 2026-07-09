# Worktrees — Roadmap Stream Map

Live index of the per-stream git worktrees used to work the **Runnable Code + HMI Roadmap**
(`Docs/ROADMAP-RUNNABLE-CODE-HMI.md`) in parallel. Each stream is one worktree on its own
branch, all branched from `master`. Keep this file in sync with the roadmap and its
`.tasks.json` (the task tracker) as work lands.

> All worktrees live under `.claude/worktrees/` (git-ignored). Base ref for every stream
> branch is `master` (`5214f40` at creation). Switch into one with `EnterWorktree` (pass its
> `path`) or just `cd` there.

## Streams

| Stream | Worktree path | Branch | Roadmap groups | Focus / status |
|---|---|---|---|---|
| **Foundation** | `.claude/worktrees/foundation` | `feat/foundation` | **G0** — FDS schema (`spec-contract-v2.ts`) | Data-model additions that unblock G1/G3/G4/G6. G0-6 ✅ decided, G0-9 ✅ shipped; rest 🔴. |
| **PLC Codegen** | `.claude/worktrees/plc-codegen` | `feat/plc-codegen` | **G1–G6** — MAP/drive, unit coordinators, maintenance, config/status DBs, OB1, FB library | **Active: G2 (Unit-FB writer)** — spec `Docs/superpowers/specs/2026-07-08-g2-unit-fb-writer-design.md`; buildable now (consumes shipped G0-9). |
| **HMI** | `.claude/worktrees/hmi` | `feat/hmi` | **G7–G8** — FDS→HMI compiler, HMI bridge wiring | Independent of the codegen writers. Target deliverable `HMI-BUILD-PACK.md`. |
| **Integration & Run** | `.claude/worktrees/integration-run` | `feat/integration-run` | **G9** — prove generalization, e2e round-trip | Nothing to build until G1/G2/G5 land; holds e2e/validation + the second-project pilot. |

**Trunk:** `master` is checked out at `.claude/worktrees/master-hybrid`. Merge finished stream
branches here (or PR into it). `feat/project-docs-doc-control` (main repo checkout) is a
separate, older feature branch — not part of the roadmap streams.

## Why grouped this way (not one worktree per G-number)

G1/G2/G3/G5 all edit the same writers (`em-writer.ts`, `compile-contract.ts`, `ob1-writer.ts`);
G6 shares `compile-contract.ts` too. Grouping G1–G6 into one **PLC Codegen** worktree keeps those
edits sequential in one workspace instead of colliding across worktrees. Foundation (schema) and
HMI (separate subsystem) parallelize cleanly alongside it.

## Conventions

- **Branch from `master`**, never from `feat/project-docs-doc-control` (predates the roadmap).
- One stream branch may host per-task sub-branches/PRs (e.g. a `feat/plc-codegen` → G2 PR).
- Tracker of record: `Docs/ROADMAP-RUNNABLE-CODE-HMI.tasks.json`. Update task `state` there as
  work lands; reflect stream-level status in the table above.
- Monday board "Forja" mirrors the roadmap but is not writable from this environment — the
  `.tasks.json` is authoritative here.
