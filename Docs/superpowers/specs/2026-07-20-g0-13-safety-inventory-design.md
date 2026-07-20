# G0-13 — Safety Layer Inventory — Design (+plan)

> **Task:** G0-13 (Monday subitem 3056948929) — P1/M, record-only
> **Depends on:** G0-6 boundary §M; links to `safety_gates` (control-side reaction) and G0-3 safety-healthy aggregation

## Goal

Record the safety functions themselves — customers sign this. `safety_gates`
covers only the control-side reaction; this inventory records function, zone,
initiators, actuation path, PL/SIL rating, reset policy, and the
effect-on-control mapping the safety-healthy aggregation derives from.

## Hard boundary (permanent)

**Safety logic is never generated.** F-logic / safety-relay internals are
hardwired / F-PLC engineering — the app records and documents only.

## Schema — tier-1 project key `safety_inventory` (new jsonb column; migration authored, NOT pushed)

```ts
export const SafetyEffectSchema = z.object({
  target_kind: z.enum(["unit", "equipment_module"]),
  target_id: z.string().min(1),
  action: z.enum(["abort", "stop"]), // abort/stop class
});
export const SafetyFunctionSchema = z.object({
  function_id: z.string().min(1),
  name: z.string().min(1), // e.g. "E-Stop chain"
  zone: z.string().optional(),
  initiators: z.array(z.string().min(1)).default([]), // tags/devices
  actuation_path: z.string().optional(), // "STO", "main contactor" — free text
  rating: z.string().optional(), // "PLd Cat3" / "SIL2" — free text
  reset: z
    .object({
      policy: z.enum(["manual", "auto"]),
      reset_point: z.string().optional(), // e.g. "panel Reset_PB"
    })
    .optional(),
  effects: z.array(SafetyEffectSchema).default([]),
  gate_id: z.string().optional(), // SafetyGateV2 link (control-side reaction)
  notes: z.string().optional(),
});
export const SafetyInventoryV1Schema = z.object({
  functions: z.array(SafetyFunctionSchema).default([]),
});
// SpecContractV2Schema / patch: safety_inventory: SafetyInventoryV1Schema.optional()
```

## Validation (patch gate, context-absent convention)

- Duplicate `function_id` → error (always).
- `gate_id` must exist when the patch carries `safety_gates`.
- `effects` targets must exist when the patch carries hierarchy (unit ids /
  EM ids).

## Testing

Schema round-trip + defaults + back-compat; duplicate id, unknown gate, unknown
target errors + skips. Generic fixture values.

## Non-goals

Safety logic generation (never), DOCX rendering (exporter), zone modeling beyond
a name string, UI/prompts.
