# Re-address IO from hardware (G0-18) — design

**Date:** 2026-07-25 · **Task:** G0-18 · **Status:** approved, ready to plan

Closes the last gap in G0-18. `planIoAddressing` already computes the correct
layout and the bridge already pins it onto the plugged modules, but nothing
writes the result back onto the spec — so a rebuild still produces tags that
disagree with the cards.

## Decision

**Spec follows hardware.** The declared rack is the source of truth; addresses
are recomputed onto it and written to `confirmed_units`. This was settled
before this design; it is restated here because everything below follows from
it.

The write is **explicit and reviewable** — a diff preview and an Apply button,
never a silent recompute on save.

## Why `confirmed_units` is the target

The TIA tag table is derived from
`hierarchy.units[].equipment_modules[].control_modules[].io_signals[].io_address`
in `deriveIoTags` (`src/lib/spec-builder/codegen/io-tag-table.ts:44`), and that
hierarchy is built from `confirmed_units` by `buildHierarchyFromLegacy`
(`src/lib/spec-builder/contract.ts:325`). The same field is also written
verbatim into SCL by `fb-instantiate.ts:70`. Correcting `confirmed_units`
therefore corrects both the tag table and the generated code.

## Where it lives

The panel renders on the skeleton wizard's **Hardware step** — `WIZARD_STEPS[2]`,
shown to the user as step 3 — below `<HardwareStep>`.

`hardware` (`spec-skeleton-wizard.tsx:87`) and `units` (line 96) are already
sibling state in the same component and are persisted together by the existing
Confirm & Save. So applying is an in-memory edit with no new write path and no
patch-gate work. The wizard reseeds `units` from `spec.confirmed_units` when
present, so it is re-enterable on an existing spec.

`HardwareStep`'s signature is unchanged — its `onChange` carries only hardware
and has no business touching signals. The panel is a sibling, not a child.

A standalone card in `ControlsDataPanel`, for re-addressing after confirmation
without re-entering the wizard, was considered and deferred. It needs a
`writeSpecContract` hierarchy patch; nothing blocks adding it later.

## Components

### 1. `src/lib/spec-builder/io-addressing-apply.ts` (new, pure)

The adapter between the legacy `UnitConfig[]` shape and the engine. It exists
so `io-addressing.ts` keeps depending on `HardwareModelV1` alone.

```ts
collectAddressableSignals(units: UnitConfig[]): AddressableSignal[]
applyIoAddresses(units: UnitConfig[], assignments: IoAssignment[]): UnitConfig[]
applyRegisterAddresses(tags: InstrumentTag[], assignments: IoAssignment[]): InstrumentTag[]
```

**The collector must mirror `deriveIoTags` exactly**, because a channel has to
be allocated for precisely the set of signals that become TIA tags. Any
divergence silently shifts every address after the point of disagreement.

Walk unit → equipment module → control module → signal, in array order, and
skip:

| Skip | Reason |
|---|---|
| `unit.excluded` | `deriveIoTags` skips them; allocating burns channels on out-of-scope units |
| `source === "network_telegram"` | addressed through the drive/telegram path, not a physical channel |
| empty `tag` | the hierarchy table pushes blank placeholder rows (`machine-hierarchy-table.tsx:365`) |
| `signal_type` resolving to `internal` | no physical channel |

`signal_type` is normalised with `convertSignalDirection`
(`src/lib/spec-builder/dialect.ts:50`), which is tolerant of Siemens and
mixed-case forms and returns `internal` for anything unknown.

Duplicate tags collapse to **one** channel, first occurrence wins — matching
`deriveIoTags`' "keeping first" rule. Both appliers are immutable and keyed by
tag, so a tag appearing more than once receives that single address everywhere
it appears.

### 2. `src/components/spec-builder/io-addressing-panel.tsx` (new)

Props `{ hardware, units, onApply }`. Computes the plan in a `useMemo`, renders
the changed-row diff (`tag`, `from → to`) plus any engine warnings, and offers
one Apply.

**All-or-nothing.** Channel assignment is positional — skipping one signal does
not free its channel — so applying a subset would produce a layout that
corresponds to no rack. Apply is disabled when nothing has changed.

### 3. `spec-skeleton-wizard.tsx` (wiring)

- `register.tags` becomes wizard state `registerTags`, seeded from props, and is
  what `MachineHierarchyTable` receives as `availableTags`.
- Apply rewrites `units` **and** `registerTags` in one go.

The second half matters because Hardware (`WIZARD_STEPS[2]`) comes before
Machine Hierarchy (`WIZARD_STEPS[3]`), and `assignTagToSignal`
(`machine-hierarchy-table.tsx:290`) copies
`io_address` straight off the register tag. Without it, a tag wired after
re-addressing arrives with a stale address.

`registerTags` is **in-session only**. The `instrument_registers` row is never
written: it is the as-received engineer-supplied import, and it keeps its
provenance. `confirmed_units` is the engineered artefact and the only thing
codegen reads.

### 4. Drift banner on Review & Confirm

Re-runs `planIoAddressing` — pure and free — and shows a warning line when any
signal still differs from the rack. It catches hand-edited addresses and
anything wired after Apply. It reports only; re-addressing stays on the
Hardware step.

### 5. Type change

`IoSignal` (`src/types/spec-builder.ts:239`) gains
`source?: "wired" | "network_telegram"`. The field already rides
`confirmed_units` at runtime — `contract.ts:340` reads it — it was simply never
declared on the legacy interface.

## Testing

The pure modules carry the weight:

- **Collector** — skips excluded units, telegram signals, blank tags and
  `internal`; dedupes by tag; walk order stable regardless of authoring order.
- **Appliers** — immutable; rewrite every occurrence of a tag; leave
  non-assigned signals untouched.
- **Round trip** — build a spec, plan, apply, then run `deriveIoTags` and assert
  its addresses equal the plan. This is the property that actually matters: it
  is the contract with TIA, and it is what fails today.

Component tests cover the changed-count summary, Apply firing `onApply`, the
disabled no-change state, and the Review drift banner.

## Generic-by-construction

Nothing here reads a device name, tag prefix, machine type or sequence. The
layout is a function of the declared rack and the signal classes alone, so it
behaves identically for a conveyor, a filling station or a stamping cell.

## Out of scope

- The `ControlsDataPanel` card (post-confirmation re-addressing).
- Persisting re-addressed values back to `instrument_registers`.
- Removing the now-redundant `VERSION_SUFFIXES` / CPU fallback ladders — they
  still cover hand-typed hardware entries.
