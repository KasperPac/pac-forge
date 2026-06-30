# Verified Library-EM Instantiation — Design

**Date:** 2026-06-30
**Status:** Approved (brainstorming) — ready for implementation plan
**Sub-project:** Code Builder C5 (Library-EM). Built **before** resuming the in-flight C3 (quality + versioning, tasks 4–8).

## Problem

The Code Builder compiler (`src/lib/spec-builder/codegen/compile-contract.ts`) lowers a confirmed FDS into deterministic SCL. Per Equipment Module (EM) it chooses between two paths:

- **Matched library EM** — a library FB template (`is_equipment_module = true`) is picked; the compiler reuses the hand-built FB and emits only an instance DB.
- **Synthesized EM** — no template matched but the FDS defines a state machine; the compiler synthesizes the full 5-artifact bundle (`em-builder.ts` → `em-writer.ts`) with AI-fill for step bodies.

The project's chosen direction is to **hand-build library FBs containing all required state machines** and reuse them deterministically, rather than rely on AI synthesis. That makes the matched path the primary path — but it currently has three defects:

1. **Gap 2 — blind trust.** A matched library FB is instantiated with no verification that its state machine covers the states/transitions the FDS defines for that EM. A 3-state library FB can be silently instantiated against a 5-state spec.
2. **Gap 3 — missing seams.** The matched path emits only a bare instance DB. Unlike the synthesized path it builds **no command seam** (no `CMD` DB → nothing can command the EM), **no status routing**, and `contractWiringLines` wires only `sensor_in`/`actuator_out` roles — `cmd`/`mode`/`interlock`/`status`/`fault` are silently dropped.
3. **Double-drive.** The matched path wires the EM instance to its full IO union (physical addresses) **and** instantiates every Control Module (CM) separately, also wired to the same physical addresses — two writers per address.

## Goal

Make matched library-EM instantiation a first-class, **verified** path:

- Verify the library FB's state machine covers the FDS-required states; **block** (don't guess) on a miss.
- Wire the EM↔CM coordination and the EM↔Unit/HMI command seam deterministically, driven by the FB interface contract's pin roles.
- Eliminate double-drive structurally — only CMs touch physical IO.

## Decisions (from brainstorming)

1. **State coverage representation** — declare the implemented states on `FbInterfaceContract` (new `states` field). The compiler asserts `FDS states ⊆ declared states`.
2. **Coverage miss** — **block** + emit a structured gap report. No silent instantiate, no AI-synthesis fallback.
3. **EM↔CM model** — the EM **coordinates separate CM FBs** (textbook ISA-88). CMs own all physical IO; the EM never touches a physical address. This kills double-drive by construction.
4. **EM↔CM wiring** — resolve deterministically by **role + tag** (both pins trace to the same FDS `io_signal`); emit `// TODO bind` + a warning on ambiguity. Never auto-pick.
5. **Command seam** — factor a **shared seam builder** out of `em-writer`, used by *both* the synthesized and matched paths. Status outputs (`state`/`step`/`done`/`fault`) are left for the Unit coordinator (sub-project D).
6. **Code organization** — Approach A: three new pure modules under `codegen/`, plus a thin `compile-contract` branch and one schema field.

## Architecture

### The EM case matrix

The compiler decides per-EM on two axes: *template matched?* and *FDS state machine present?*

| Template matched? | FDS contract? | Path | Outcome |
|---|---|---|---|
| yes | yes | **Verified matched (NEW)** | Coverage check → pass: instantiate library FB + CMs + EM↔CM wiring + command seam. Fail: gap-report artifact, **blocked** (no instance). |
| yes | no | Matched, unverifiable | Instantiate library FB + CMs + wiring + command seam; emit a "coverage unverifiable — no FDS state machine" warning. |
| no | yes | Synthesized (existing) | Unchanged, except it now calls the shared command-seam builder. |
| no | no | Stub FB (existing) | Unchanged. |

`emRes.stub` (from `instantiateEquipmentModule`) is true when no template matched. The branch logic:

```
if  emRes.stub && emContract      → synthesized (case C)
if  emRes.stub && !emContract     → stub FB (case D)
if !emRes.stub                    → matched: instantiate CMs (own IO), then
        if emContract             → VERIFIED (case A): coverage gate
        else                      → unverifiable (case B): warn + proceed
```

### Artifacts a verified matched EM emits

The library FB itself is **not** generated (it is imported from the library); only its instance and wiring are emitted.

- **Per CM:** CM instance DB (+ stub FB if that CM did not match a template). **The only blocks touching physical IO.**
- `EM_<name>_DB` — instance DB referencing the library FB block.
- `LINK_<name>_IN` FC — CM status outputs → EM inputs (runs before the EM call).
- `LINK_<name>_OUT` FC — EM command outputs → CM command inputs (runs after the EM call).
- `<name>_CMD` DB — command seam (`enable`/`mode`/`cmd_*`), from the shared builder.
- OB1 call lines, ordered: CM calls → `LINK_IN` → EM call → `LINK_OUT`.

### Module map (Approach A)

| Module | Responsibility | Purity |
|---|---|---|
| `codegen/em-state-coverage.ts` | `checkStateCoverage(fdsStates, declared)` + gap-report artifact builder | pure |
| `codegen/matched-em-builder.ts` | EM↔CM role+tag wiring → `LINK_<name>_IN`/`_OUT` FCs + warnings | pure |
| `codegen/em-command-seam.ts` | Shared `CMD` DB + command-binding builder (extracted from `em-writer`) | pure |
| `compile-contract.ts` (modify) | 4-case branch; delegates to the three modules | pure |
| `types/fb-interface.ts` (modify) | new `states` field on `FbInterfaceContract` | types |

## Component detail

### 1. State-coverage verification + contract schema

Schema addition (`types/fb-interface.ts`), back-compatible — `states` defaults to `[]` on every existing contract:

```ts
export interface FbInterfaceState {
  slug: string;        // EM-local state slug; matches FDS EmStateV2.state_id
  name: string;        // human label
  is_safe?: boolean;   // the FB's declared safe state
}

export interface FbInterfaceContract {
  block_name: string;
  pins: FbInterfacePin[];
  states: FbInterfaceState[];   // NEW — states this FB implements
  reviewed: boolean;
  generated_at: string;
}
```

The check (`codegen/em-state-coverage.ts`), pure, no IO:

```ts
checkStateCoverage(
  fdsStates: EmStateV2[],        // emContract.states
  declared: FbInterfaceState[],  // template.interface_contract.states
): { ok: boolean; missing: EmStateV2[] }
```

- Compares `slug` ⟷ `state_id`, case-insensitive and trimmed. Every FDS state must have a declared counterpart.
- `missing` = FDS states with no declared match → drives the gap report.
- **Safe-state cross-check:** if the FDS-marked safe state is covered but the FB declares a *different* slug as `is_safe`, emit a **warning** (covered, but safe intent differs) — not a block.
- **Surplus declared states are never flagged** — a richer library FB legitimately covers a leaner spec. This is the "all possible state machines" philosophy.

Gate: coverage runs **before** instantiation. On `ok: false`, emit a non-importable gap-report artifact `EM_<name>_COVERAGE_GAP` listing the missing states, push a structured warning, and emit **no** instance/wiring/seam. The EM is blocked until the library FB or spec is reconciled.

### 2. EM↔CM wiring resolution (`matched-em-builder.ts`)

Inputs: the matched EM's `interface_contract.pins`; the EM's `control_modules` (each with its matched template, instance DB name, and that template's contract pins); the FDS `io_signals`.

Resolution principle: an EM input pin and the CM output pin feeding it both trace to the **same FDS `io_signal`** (same `tag`). Resolve through the shared tag, never by guessing.

1. **CM status → EM input.** For each EM pin with role `sensor_in`: find its FDS tag → the CM owning that `io_signal` → that CM's output pin carrying the same tag. Emit `#<em_pin> := "<CM_inst>".<cm_pin>;` into `LINK_<name>_IN`.
2. **EM command → CM input.** For each EM pin with role `actuator_out`/`cmd` driving a device: find the CM owning that tag → its `actuator_out`/`cmd` input pin. Emit `"<CM_inst>".<cm_pin> := #<em_pin>;` into `LINK_<name>_OUT`.

Ambiguity → explicit TODO seam + warning, never auto-pick:

- **0 matches** — no CM owns the tag → `// TODO bind #<pin> — no CM provides "<tag>"`.
- **2+ matches** — multiple CM instances own the tag (e.g. two identical motors) → `// TODO bind #<pin> -> {CM_A | CM_B}` naming candidates.
- Stub CMs still expose tag-named pins, so wiring resolves against the stub interface too.

Output: `LINK_<name>_IN` + `LINK_<name>_OUT` FCs and a `warnings[]`. Command/mode/enable pins are **not** handled here — those are the command seam.

### 3. Shared command seam (`em-command-seam.ts`)

```ts
buildCommandSeam(emName: string, commandPins: CommandPin[]): {
  cmdDb: CodegenArtifact;   // <EM>_CMD DB: enable, mode, cmd_*
  callBindings: string[];   // ["enable := \"<EM>_CMD\".enable", "mode := ...", ...]
}
```

- `cmdDb` is the `<name>_CMD` DATA_BLOCK: `enable : Bool`, `mode : Int`, one `Bool` per command pin — identical structure to the current `em-writer.writeCmdDb`.
- `callBindings` are the param strings the EM instance call uses to read those fields; the caller splices them into its instance call.
- **Status outputs are not wired here** — left for the Unit coordinator (sub-project D). The seam owns only the command (write-into-EM) direction.

Command-pin source per path:
- **Synthesized:** fed the known `CMD_PINS` constant + `enable`/`mode`.
- **Matched:** `interface_contract.pins` filtered to roles `cmd`/`mode` (+ `enable` convention). If the library FB declares no command pins → emit an empty-but-valid CMD DB + a warning ("library FB exposes no command interface").

**`em-writer.ts` refactor:** move `writeCmdDb` and the command-binding half of `buildCallLines` into `em-command-seam.ts`; `em-writer` imports and calls them. **Safety property: the synthesized 5-artifact bundle is byte-for-byte unchanged** — guarded by the existing `em-writer` tests staying green. Both paths call the same function, so the two CMD DBs are structurally incapable of drifting apart.

### 4. `compile-contract` integration + double-drive fix + OB1 ordering

Per-EM flow inside the `unit.equipment_modules` loop:

```
emRes = instantiateEquipmentModule(em, templates)

if emRes.stub && emContract:        // C — synthesized (now via shared seam); continue
if emRes.stub && !emContract:       // D — stub FB; continue

// matched (emRes NOT stub):
instantiate every CM → push CM artifacts + CM physical wiring   // CMs own IO

if emContract:                      // A — VERIFIED
    cov = checkStateCoverage(emContract.states, template.contract.states)
    if !cov.ok: push gap-report + warning; continue             // BLOCKED, no instance
    (safe-state mismatch → warning, proceed)
else:                               // B — unverifiable
    push warning "coverage unverifiable — no FDS state machine"

// A(pass) and B:
push EM instance DB
push <name>_CMD DB                  (em-command-seam)
push LINK_<name>_IN, LINK_<name>_OUT  (matched-em-builder)
deviceCallLines += [CM calls already pushed] + LINK_IN + EM call + LINK_OUT
```

**Double-drive fix is structural:** the matched EM no longer calls `contractWiringLines` against physical addresses. `instantiateEquipmentModule` shrinks to "pick the template + emit the instance DB" and returns **empty** physical `callLines` for the matched case; all physical IO is wired by the per-CM `instantiateControlModule` calls. Exactly one writer per address — the bug cannot recur.

**OB1 ordering** for a matched EM:

```
"CM_*_DB"(... read sensors ...);   // all CMs first — refresh status
"LINK_<name>_IN"();                // CM status → EM inputs
"EM_<name>_DB"(enable:=..., mode:=..., cmd_*:=...);  // EM computes
"LINK_<name>_OUT"();               // EM commands → CM command fields
```

CM command fields are consumed on the CM's next-scan call — standard PLC scan semantics; no stale-by-a-scan lag because `IN` runs before and `OUT` after the EM within the same scan.

## Error handling & warnings

Nothing throws — the compiler stays total (matches the existing `buildEmSequence` "never throws, report via warnings" contract). All conditions flow through `CodegenResult.warnings[]` plus stub/gap artifacts the UI already surfaces.

| Condition | Severity | Result |
|---|---|---|
| FDS state not covered by library FB | **block** | `EM_<name>_COVERAGE_GAP` artifact + warning; no instance emitted |
| Safe-state slug mismatch | warning | proceeds |
| Matched EM, no FDS contract | warning | proceeds (case B) |
| EM pin → 0 CMs for a tag | warning | `// TODO bind` line in `LINK` |
| EM pin → 2+ CM candidates | warning | `// TODO bind {candidates}` line in `LINK` |
| Library FB declares no command pins | warning | empty-but-valid CMD DB |

## Testing (vitest)

- `em-state-coverage.test.ts` — exact cover; missing states; surplus declared (ok); safe-state mismatch; case/whitespace normalization; empty declared list.
- `matched-em-builder.test.ts` — unambiguous IN/OUT wiring; 0-match TODO; 2-match TODO with named candidates; stub-CM pins still resolve; analog vs bool.
- `em-command-seam.test.ts` — CMD DB shape; bindings; empty-command-pins warning.
- `em-writer.test.ts` — **unchanged, must stay green** (proves the extraction is byte-for-byte).
- `compile-contract.test.ts` — the 4-case matrix; verified-pass emits the full matched set with **no physical EM wiring** (double-drive regression: assert each physical address is written by exactly one block); verified-fail emits gap report + no instance; case-B warning; OB1 ordering (CMs → IN → EM → OUT).

## Generic-by-construction (CLAUDE.md)

Every module is machine-agnostic: coverage compares slugs, wiring resolves through FDS tags, the seam reads roles. No device name, sequence, or fault condition appears in any module. Mentally re-verify against conveyor / lift-table / stamping EM shapes during the post-task self-check.

## Out of scope (explicit)

- **Contract-editor UI** for authoring the new `states` field — follow-up. This sub-project only *consumes* the field; the existing contract editor carries it through.
- **Unit coordinator** that consumes EM status outputs and drives `enable`/`mode`/interlocks — sub-project D.
- **Per-instance binding UI** — the `LINK` `// TODO bind` seam is the manual fallback until then.
- **AI extraction of declared states** from FB SCL — the existing contract extract/review flow can be extended later; not required for consumption.
