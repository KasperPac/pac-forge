# G0-14 — Recipe/Format Model — Design (+plan)

> **Task:** G0-14 (Monday subitem 3056974098) — P1/M
> **Depends on:** G0-6 boundary §N, G0-4 (config parameter model), G0-9 (modes for changeover gating)
> **Consumed by:** G4 (recipe DB emission), G8 (WinCC Unified native recipe controls — derived)

## Goal

Model format-changeover machines: named parameter sets (recipe = subset of config
parameters with per-product values) plus the selection/changeover policy (legal
only in declared states/modes). D's config model is one global set; this layers
per-product values over it.

## Schema — tier-1 project key `recipes` (new jsonb column; migration authored, NOT pushed)

Presence of the key = the machine is recipe/format-driven.

```ts
export const RecipeSchema = z.object({
  recipe_id: z.string().min(1),
  name: z.string().min(1), // product/format name
  values: z.record(z.string(), z.union([z.string(), z.number()])), // parameter_id → value
  description: z.string().optional(),
});
export const RecipeChangeoverSchema = z.object({
  // canonical PackML unit states where selection/changeover is legal
  allowed_states: z.array(UnitPackMLStateSchema).default([]),
  allowed_modes: z.array(z.string().min(1)).default([]), // mode ids (G0-9)
});
export const RecipeModelV1Schema = z.object({
  parameter_ids: z.array(z.string().min(1)).min(1), // recipe-scoped config params
  recipes: z.array(RecipeSchema).default([]),
  changeover: RecipeChangeoverSchema.optional(),
});
// SpecContractV2Schema / patch: recipes: RecipeModelV1Schema.optional()
```

## Validation (patch gate, context-absent convention)

- Duplicate `recipe_id` → error (always).
- Every `values` key must be in `parameter_ids` (always).
- `parameter_ids` must exist in `configuration_parameters` when co-sent; enum
  params' recipe values must be in `allowed_values` where the param is co-sent
  and the value is a string.
- `changeover.allowed_modes` must exist in co-sent `modes`.

## Testing

Round-trips + defaults + back-compat; each validation rule + skips. Generic
fixture (e.g. bottle formats over a fill-volume parameter).

## Non-goals

Recipe DB structure + HMI recipe screen (derived — WinCC Unified native
controls), per-unit recipes (project-level v1), changeover sequencing logic
(writer).
