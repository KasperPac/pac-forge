# G0-12 — Upstream Comms Interface Model — Design (+plan)

> **Task:** G0-12 (Monday subitem 3056948812) — P1/M
> **Depends on:** G0-6 boundary §L, G0-9 (PackTags = natural emission target), G0-1 (`EngineeringDataV1`)
> **Consumed by:** G2 (PackTags DB), future OPC UA exposure writer surface

## Goal

Model the plant-system interface: which upstream systems exist (SCADA/MES/
historian) and what data crosses — the signable interface list. Endpoints and
tag exposure are tier-2 record; certificates/hardening/segregation are tier-3
commissioning-pack territory and stay out of the model.

## Tier 1 — project key `upstream_comms` (new jsonb column; migration authored, NOT pushed)

```ts
export const UpstreamDataKindSchema = z.enum([
  "production_counts",
  "unit_states_modes",
  "alarm_forwarding",
  "order_job_data",
  "custom",
]);
export const UpstreamDataCrossingSchema = z.object({
  kind: UpstreamDataKindSchema,
  direction: z.enum(["to_plant", "from_plant", "bidirectional"]),
  description: z.string().optional(), // required context for "custom"
});
export const UpstreamSystemSchema = z.object({
  system_id: z.string().min(1),
  name: z.string().min(1), // "Plant SCADA", "MES"
  kind: z.enum(["scada", "mes", "historian", "other"]),
  data: z.array(UpstreamDataCrossingSchema).default([]),
  notes: z.string().optional(),
});
export const UpstreamCommsV1Schema = z.object({
  systems: z.array(UpstreamSystemSchema).default([]),
});
// SpecContractV2Schema / patch: upstream_comms: UpstreamCommsV1Schema.optional()
```

## Tier 2 — `engineering.upstream_endpoints[]`

```ts
export const UpstreamEndpointEntrySchema = z.object({
  system_id: z.string().min(1), // must reference a declared system
  protocol: z.string().optional(), // "opcua" / "s7" / "modbus_tcp" …
  endpoint: z.string().optional(), // URL / address
  exposed_tags: z.array(z.string().min(1)).default([]), // node IDs / tag list
  notes: z.string().optional(),
});
// EngineeringDataV1Schema: upstream_endpoints: z.array(...).default([])
```

## Validation (patch gate, context-absent convention)

- Duplicate `system_id` → error (always).
- `engineering.upstream_endpoints[].system_id` must exist when `upstream_comms`
  rides the same patch.

## Testing

Round-trips + defaults + back-compat; duplicate system, unknown endpoint
system + skip. Generic fixtures.

## Non-goals

PackTags/OPC UA emission (G2/writer), certificates & hardening (tier 3,
commissioning pack), per-tag node-id modeling beyond a string list.
