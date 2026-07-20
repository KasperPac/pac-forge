# G0-8 — Device-FB Assignment Model — Design (+plan)

> **Task:** G0-8 (Monday subitem 3056956541) — P1/M
> **Depends on:** G0-6 boundary §I, G0-1 (`EngineeringDataV1`), FB library interface contracts (`src/types/fb-interface.ts`, spec 2026-06-23)
> **Consumed by:** G6-2 (explicit "use library" selection), G6-4 (binding layer), DOCX exporter (derived behavior appendix)

## Goal

Record which FB-library template each CM/EM instantiates, plus explicit pin-binding
overrides where role/tag wiring is ambiguous — making G6 instantiation
deterministic (pins come from the template's reviewed `interface_contract`, no
guessing) and closing the C5 manual-link-naming gap.

## Tier decision (per §I)

- The assignment itself is **tier 2** (`engineering.fb_assignments`) — customers
  sign behavior, never template IDs.
- The tier-1 "standard device-type behavior descriptions" appendix is **derived at
  DOCX time** from the assigned template (`FbInterfaceContract.states`,
  description, `fb-flow-diagram.ts`) — NEVER stored or hand-written, else it
  drifts from the real FB. Nothing tier-1 lands in the contract this wave.

## Schema — `engineering.fb_assignments[]` (no migration)

```ts
export const FbPinBindingSchema = z.object({
  pin: z.string().min(1), // FbInterfacePin.name in the template's contract
  tag: z.string().min(1), // FDS tag / DB member it binds to
  notes: z.string().optional(),
});
export const FbAssignmentSchema = z.object({
  target_kind: z.enum(["control_module", "equipment_module"]),
  target_id: z.string().min(1),
  template_id: z.string().min(1), // fb_templates row id
  template_version: z.string().optional(),
  pin_bindings: z.array(FbPinBindingSchema).default([]),
  notes: z.string().optional(),
});
// EngineeringDataV1Schema: fb_assignments: z.array(FbAssignmentSchema).default([])
```

## Validation (patch gate, context-absent convention)

- Duplicate assignment per `(target_kind, target_id)` → error.
- Duplicate `pin` within one assignment's `pin_bindings` → error.
- `target_id` must exist among hierarchy CM ids (kind control_module) or EM ids
  (kind equipment_module) when the patch carries hierarchy.
- Template/pin existence against the FB library is a DB-time concern (G6
  instantiation) — deliberately NOT patch-validated.

## Testing

Schema round-trip + defaults + back-compat; duplicate-target, duplicate-pin,
unknown-target errors + hierarchy-absent skip; fixture uses generic names.

## Non-goals

DOCX appendix derivation (exporter/G6), template pin verification, tier-1 storage,
UI/prompts, migration (rides `engineering`).
