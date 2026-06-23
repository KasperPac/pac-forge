# FB Library Interface Contract + Device FB Binding carve-out

**Date:** 2026-06-23
**Status:** Approved design, ready for implementation planning
**Module:** Pac-Forge spec-builder → FB Library + Phase 4 Code Builder program

---

## Context

The Phase 4 Code Builder compiles a confirmed ISA-88/PackML FDS into a Siemens TIA
project **deterministically** (see `Docs/superpowers/specs/2026-06-23-code-builder-shell-device-layer-design.md`).
Its Device layer (sub-project B) instantiates a device FB per Control Module.

Today the FB Library stores each FB only as **raw SCL text** (`fb_template_blocks.scl_code`)
plus tags / category / `description` / `ai_summary` / `documentation`. There is **no
structured representation of an FB's interface** — its pins, their purpose, or how they
bind. Three separate, ad-hoc regex parsers each re-derive a partial pin list:

- `src/routes/fb-library.tsx` `parseVarsFromScl` — Direction/Name/Type/Description, **display only**.
- `src/lib/forge-device-matcher.ts` `parseInterface` — Bool/analog **counts only**, for match scoring.
- `src/lib/fb-flow-diagram.ts` `parseVarSections` — for the signal-flow SVG.

The deterministic compiler (`src/lib/spec-builder/codegen/fb-instantiate.ts` `wiringLines`)
ignores all of them and wires by **tag-name coincidence**: it maps each device IO signal's
`tag` straight onto an FB parameter of the same name and reads physical `%I`/`%Q` addresses
directly. The compiler has no idea what pins the FB actually exposes, what they are for, or
that a device FB should never touch raw IO.

### Two findings that shape this design

**1. Device FBs bind through a process-image + signal-conditioning layer, never to raw IO.**
A device FB pin's value comes from one of: an Input image-DB member, the **output of an
upstream FB's instance DB** (e.g. a debounce/sensor FB feeding a motor FB), or an HMI/EM
internal interface. Outputs land in the Output image DB, never `%Q` directly.

**2. FB selection must precede full FDS sequence authoring.**
A sequence guard can require a signal that only exists as an FB output (e.g. "fault confirmed
for 500 ms", "at-position"), which has no wired tag. The contract already anticipates this:
`IoSignalTier` (`src/types/spec-contract-v2.ts:250`) splits signals into **`wired`** vs
**`fb_instance`** ("signals that only resolve once a device FB template is assigned"). And
`fds_operation_sessions` already carries `fb_template_id`, `instance_params`,
`instance_overrides`, `tag_remap` (all empty in current specs) — the original schema
anticipated "bind a CM/EM to a library FB, then expose/remap its tags," it was just never
wired up.

Confirmed against the live HRE FDS (Carriage Drive EM, `stopped → driving_fwd`): the trigger
is `Fwd_Carriage = true` and the guard is `CM1_Fault = false AND … AND VSD1_CB_Trip = false`
— the relationship is expressed purely in **device tags**, with no knowledge of post-FB tag
names or image-DB members.

### Two namespaces, and the bridge this design defines

| Layer | Owner | Example |
|---|---|---|
| **Logical device tag** | FDS (done) | `CM1_Fault`, `Fwd_Carriage`, `CM1_Run` |
| **Resolved signal source** | FB Library contract + Code Builder (this gap) | `"SensorFB_CM1_DB".Q_Debounced`, `"HMI".Fwd_Carriage`, `"Outputs".CM1_Run` |

The FB Library interface contract is what lets the FDS author reference real FB outputs and
lets the Code Builder resolve every logical tag to a concrete source — deterministically.

---

## Design decisions (locked)

1. **Self-describing FBs.** Each FB declares a structured interface contract (role-tagged
   pins + binding source + exposed flag), so both the FDS builder agent and the Code Builder
   read "how this FB works" from one place. (Chosen over a thin pin-list-only contract.)
2. **Authoring = AI-extract + human-review blend.** A shared parser yields the pin list from
   SCL; an AI pass pre-fills the semantic layer; the FB Library UI is where a human confirms /
   overrides. At consume time the contract is concrete persisted data — fully deterministic.
3. **Storage = JSONB column** `interface_contract` on `fb_templates`, versioned with the
   existing template-version snapshots (no new child table — the contract is one cohesive
   object per template).
4. **B-carve.** This spec defines the **contract shape** (the shared dependency) and the
   Code Builder amendments to consume it. **Per-instance FB binding** and the `fb_instance`
   feedback loop are carved into a new sub-project, **Phase 3.5 — Device FB Binding**, with
   its own spec → plan → build cycle.
5. **Generic across machine types** (CLAUDE.md non-negotiable). Roles and binding sources are
   abstract; no device-specific names anywhere in the taxonomy or logic.

---

## Architecture

### 1. The contract shape

Scoped to the template's **main FB block** (the block that gets instantiated):

```ts
export type FbPinRole =
  | "cmd"          // command input (start/stop/forward) — typically from HMI or EM
  | "mode"         // mode / selection input
  | "param"        // configuration parameter input
  | "interlock"    // interlock / permissive input
  | "sensor_in"    // process feedback input (wired DI/AI, or conditioned upstream FB output)
  | "actuator_out" // physical actuation output (to the Output image DB)
  | "status"       // status output (running / ready / done / position)
  | "fault";       // fault / alarm output

export type FbBindingSource =
  | "io_input"     // Input image-DB member
  | "io_output"    // Output image-DB member
  | "fb_output"    // upstream FB instance-DB output
  | "hmi"          // HMI / command interface
  | "em"           // EM / coordination interface
  | "param";       // config constant

export interface FbInterfacePin {
  name: string;                      // pin identifier, from SCL
  scl_type: string;                  // Bool | Int | Real | …
  direction: "input" | "output" | "inout";
  role: FbPinRole;
  default_binding: FbBindingSource;  // expected source; a per-instance binding may override
  exposed: boolean;                  // output that becomes an fb_instance tag once bound
  description: string;               // from the SCL // comment
}

export interface FbInterfaceContract {
  block_name: string;                // the main FB block this describes
  pins: FbInterfacePin[];
  reviewed: boolean;                 // a human has confirmed the AI-extracted semantic layer
  generated_at: string;             // ISO timestamp of the last AI extraction
}
```

`role` is the semantic *purpose*; `default_binding` is the *expected* source kind and is a
hint the per-instance binding step (Phase 3.5) may override (e.g. a `sensor_in` whose
`default_binding` is `io_input` but is rebound to `fb_output` when a debounce FB sits in
front). `exposed` marks the outputs that become `fb_instance` tags the FDS can reference.

### 2. Shared parser (replaces the three regex parsers)

New `src/lib/spec-builder/fb-interface.ts`:

- `parseFbInterface(scl: string): Pick<FbInterfacePin, "name" | "scl_type" | "direction" | "description">[]`
  — single source of pin extraction (VAR_INPUT / VAR_OUTPUT / VAR_IN_OUT, name + type +
  inline comment + direction).
- The three existing call sites are refactored to consume this:
  - `fb-library.tsx` `VariableTable` renders from it (plus the editable semantic columns).
  - `forge-device-matcher.ts` derives its Bool/analog counts from it.
  - `fb-flow-diagram.ts` derives its `VarDecl[]` from it.

No behavioural change to matching or the flow diagram — only the parse is unified.

### 3. AI extraction of the semantic layer

- On import and on save (when SCL changes), an AI pass reads the main FB block's SCL +
  the template `documentation` / `ai_summary` and returns `role` / `default_binding` /
  `exposed` per pin, plus `block_name`. Reuses the existing Edge Function generation path
  and the same plumbing as "Generate Summaries / Generate Documentation".
- Output is persisted to `interface_contract` with `reviewed: false`.
- Strictly generic: the prompt classifies pins by abstract role/source, never by device name.

### 4. FB Library UI — editable interface grid

`fb-library.tsx` `VariableTable` is extended into an editable grid:

- Existing columns: Direction · Name · Type · Description (from `parseFbInterface`).
- New editable columns: **Role** (`FbPinRole` dropdown) · **Binding** (`FbBindingSource`
  dropdown) · **Expose** (checkbox).
- A "needs review" badge shows while `reviewed === false`; saving the grid sets
  `reviewed: true`. Persists through `useUpdateFbTemplate` (which already snapshots versions).

### 5. Persistence

- New JSONB column `fb_templates.interface_contract` (nullable). Migration adds the column;
  `FbTemplate` type gains `interface_contract: FbInterfaceContract | null`.
- The contract travels in the existing version snapshots (`fb_template_versions`) so history /
  revert keep it in sync with the SCL it describes.
- RLS unchanged (inherits `fb_templates` policies).

### 6. Code Builder consumption (amends sub-project B)

`fb-instantiate.ts` is amended to consume the contract instead of tag-name coincidence:

- When a template has a `reviewed` contract, `wiringLines` maps **by pin**, using each pin's
  `role` / `default_binding` to choose the source:
  - `sensor_in` / `io_input` → Input image-DB member derived from the matched device IO signal.
  - `actuator_out` / `io_output` → Output image-DB member.
  - `cmd` / `mode` / `hmi`, `interlock`, `param`, `em` → the corresponding interface member.
  - `fb_output` (cross-FB) and the `fb_instance` feedback loop → **deferred to Phase 3.5**;
    until then such pins are left unbound and reported as a builder warning (never silently
    wrong).
- **No raw `%I`/`%Q`** is emitted by the device layer.
- When a template has **no** `reviewed` contract (legacy / unreviewed), the builder falls
  back to the **current behaviour** (tag-name-coincidence wiring for a matched template, stub
  FB when nothing matched) so nothing regresses.

This requires the **Input/Output image-DB member interface** to exist as binding targets.
Pull that interface **forward** from sub-project E into this work (member references only;
physical rack/slot/card **addressing** stays deferred to E). The image-DB members are derived
from the CMs' `wired`-tier `io_signals`.

### 7. Program integration — Phase 3.5 (carved out, not designed here)

New sub-project **Phase 3.5 — Device FB Binding** (its own spec later):

- Assigns a specific library FB to each CM/EM, persisting via the existing
  `fds_operation_sessions` fields (`fb_template_id`, `instance_params`, `instance_overrides`,
  `tag_remap`).
- Lets a reviewer override per-pin bindings (including `fb_output` cross-FB wiring).
- Emits the FB's `exposed` outputs back into the FDS as `fb_instance`-tier `io_signals` with
  stable symbolic tags, so sequence authoring can reference them.
- Sits in the workflow **between structural FDS and sequence authoring**:

```
1. Structural FDS    — hierarchy + control modules + WIRED io_signals
2. Device FB binding — assign library FB per CM/EM  ─┐ exposes FB output pins
   (Phase 3.5)                                       └▶ as fb_instance-tier signals
3. Sequence authoring — guards/steps reference BOTH wired AND fb_instance tags
4. Code Builder       — deterministic compile; guards already point at real FB outputs
```

---

## Out of scope (this spec)

- The per-instance FB binding UI, override workflow, and `fb_instance` feedback loop (Phase 3.5).
- Cross-FB (`fb_output`) wiring in the Code Builder (Phase 3.5 supplies the binding).
- Physical rack/slot/card layout and IO **addressing** (sub-project E) — only image-DB
  member references are pulled forward.
- EM state-machine FBs (C), Unit/coordination (D), Export/compile (F).

---

## Testing

- **Vitest (parser):** `parseFbInterface` extracts name/type/direction/comment across
  VAR_INPUT/OUTPUT/IN_OUT; the three refactored call sites produce identical results to today.
- **Vitest (contract consumption):** given a `reviewed` contract, `fb-instantiate` wires
  `sensor_in`/`actuator_out` pins to image-DB members and emits **no** `%I`/`%Q`; `fb_output`
  pins produce a warning, not wrong code; a template with no contract falls back to the stub path.
- **Vitest (persistence):** `interface_contract` round-trips through create/update and is
  captured in a version snapshot.
- **Component smoke:** the editable interface grid renders, edits set `reviewed: true`, and
  persists.

All changes remain **generic across machine types** — no project-specific device names,
roles, or bindings.

---

## Appendix — briefing for the running FDS builder agent

> When authoring EM sequences / state machines, a guard or completion criterion may need a
> signal that only exists as the **output of a device function block** (a debounced/filtered
> sensor state, "at-position confirmed", "fault latched") rather than a raw wired input. These
> are **`fb_instance`-tier** signals and only exist once the device's library FB is assigned.
>
> - Before authoring such a guard, the CM's library FB must be assigned so its exposed output
>   pins are known.
> - When a needed signal is FB-derived: (1) add it to the CM's `io_signals` with
>   `tier: "fb_instance"`, `signal_type` matching the pin, and a stable symbolic `tag`;
>   (2) reference that `tag` in the guard.
> - Raw instrument signals stay `tier: "wired"`. **Never** reference a `%I`/`%Q` address directly.
> - If a guard needs an FB output whose FB isn't yet assigned, **flag it** rather than
>   inventing a wired tag for it.
