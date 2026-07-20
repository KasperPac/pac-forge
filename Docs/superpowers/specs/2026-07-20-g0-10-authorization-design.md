# G0-10 — Authorization Model — Design (+plan)

> **Task:** G0-10 (Monday subitem 3057010746) — P1/M
> **Depends on:** G0-6 boundary §D, G0-4 (`GeometryParamDef`), G0-5 (`OverridableOutput`, `AxisPreset`)
> **Consumed by:** G8-3 (HMI access levels enforce WHO), G4/G2 writers (PLC enforces WHAT/WHEN — limits + state guards), G7-5 (screen-role assignment DERIVES from item levels)

## Goal

Model the signable authorization content: a project-configurable role ladder and
per-ITEM write access (required level, validity limits, write-state
preconditions). Authorization attaches to items, never screens.

## Deferred (explicit)

- **RETAIN + required_level on CMD `sp_` setpoint pins** — SP-4 lowered setpoints
  codegen-side from command branches; there is no contract-level setpoint model to
  attach to yet. Follow-up lands when the setpoint seam gets a contract surface.
- PLC identity checks — deliberately rejected per boundary §D (needs login-state
  interface; HMI enforces who). Safety functions rely on neither (hardwired).

## Schemas

**Project key `authorization`** (new jsonb column, migration authored NOT pushed):

```ts
export const AuthRoleSchema = z.object({
  level: z.number().int().nonnegative(),
  name: z.string().min(1),
  description: z.string().optional(),
});
export const AuthorizationV1Schema = z
  .object({ roles: z.array(AuthRoleSchema).min(1) })
  .refine(unique levels && unique names);
// SpecContractV2Schema / patch: authorization: AuthorizationV1Schema.optional()
```

`defaultRoleLadder()` helper (wizard-machine-layer.ts): 0 View · 1 Operator ·
2 Supervisor · 3 Maintenance · 4 Engineer.

**Shared `access` attachment**:

```ts
export const WriteAccessSchema = z
  .object({
    required_level: z.number().int().nonnegative().optional(),
    limits: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
    // same pattern as AxisPreset.blocked_while_em_execute (G0-5)
    write_blocked_while_em_execute: z.string().min(1).optional(),
  })
  .refine(min <= max when both present);
// access: WriteAccessSchema.optional() on:
//   GeometryParamDefSchema, OverridableOutputSchema, AxisPresetSchema,
//   ConfigParameterSchema
```

## Validation

- Schema level: unique role levels + names; `limits.min <= limits.max`.
- Patch gate (context-absent convention): when the patch carries
  `authorization`, every `access.required_level` used elsewhere in the SAME patch
  (unit_coordination axes' param defs + presets, maintenance outputs,
  configuration_parameters) must exist in the ladder.

## Testing

Ladder parse + uniqueness rejections + default helper; WriteAccess refine; access
round-trips on all four hosts; patch-gate unknown-level error + skip without
authorization context.

## Non-goals

Screen/HMI enforcement modeling, PLC guard emission (writers), setpoint model
(deferred above), UI/prompts.
