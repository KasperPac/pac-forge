# G0-15 — Diagnostics & Condition-Monitoring Model — Design (+plan)

> **Task:** G0-15 (Monday subitem 3056948442) — P2/M
> **Depends on:** G0-6 boundary §O
> **Consumed by:** future P2 writer surface (counter/hour DB + HMI diagnostics view)

## Goal

Per-CM/EM capability flags for which condition-monitoring metrics are kept:
runtime hours, cycle/start counters, and the service-interval "service due"
warning.

## Schema — `diagnostics` on `ControlModuleV2Schema` and `EquipmentModuleV2Schema` (hierarchy JSON — no migration)

```ts
export const DiagnosticsCapabilitySchema = z.object({
  runtime_hours: z.boolean().default(false),
  cycle_counter: z.boolean().default(false),
  start_counter: z.boolean().default(false),
  service_interval: z
    .object({
      metric: z.enum(["runtime_hours", "cycles", "starts"]),
      threshold: z.number().positive(), // "service due" warning point
    })
    .optional(),
});
// ControlModuleV2Schema + EquipmentModuleV2Schema: diagnostics: ...optional()
```

## Derived (per §O — deliberately not modeled)

- Platform diagnostics (module/rack/device-failure OBs, OB82/86 family →
  alarm rows) — pure platform pattern, emitted from platform rules.
- Counter/hour DB structure + HMI diagnostics view — writer emission.

## Validation

Schema-level only (threshold positivity). No patch-gate rules — capability
flags have no cross-references.

## Testing

Round-trips + defaults + back-compat on both hosts.
