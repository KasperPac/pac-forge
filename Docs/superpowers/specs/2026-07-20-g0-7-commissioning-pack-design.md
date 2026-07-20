# G0-7 — Engineering Data Commissioning-Pack Sections — Design (+plan)

> **Task:** G0-7 (Monday subitem 3057010311) — P1/Small, record-only
> **Depends on:** G0-6 boundary §H (decided section list, "no automation committed"), G0-1 (`EngineeringDataV1` container)

## Goal

Give the tier-2 `engineering` container the five structured commissioning-pack
sections boundary §H names: drive parameter checklist (p2000 etc.), network/IP +
device-name plan, PLC tag table with absolute addresses, panel user accounts, and
the time-sync/NTP plan. Pure record — humans execute; the app documents.

## Non-goals (per §H sweep)

- Any automation over these records (bridge tag-table creation, HW-ID lookup —
  future board items once value is proven).
- Validators — record-only data has no invariants worth failing a patch over.
- DOCX rendering — later exporter wave.
- Credentials: `panel_accounts` records who exists and their role, NEVER passwords
  (no secret field exists in the schema by design).
- Energy monitoring (appliance instance, K), HMI screen inventory (derived, G7),
  cause & effect matrix (derived DOCX) — deliberately not modeled.

## Schema — `engineering.commissioning_pack` (optional; no migration)

```ts
export const DriveChecklistRowSchema = z.object({
  drive_name: z.string().min(1),
  parameter: z.string().min(1), // e.g. "p2000"
  value: z.string().min(1), // string — units/expressions vary
  verified: z.boolean().default(false),
  control_module_id: z.string().min(1).optional(), // link when known
  notes: z.string().optional(),
});

export const NetworkPlanRowSchema = z.object({
  device_name: z.string().min(1), // PROFINET station / device name
  ip_address: z.string().optional(),
  subnet_mask: z.string().optional(),
  role: z.string().optional(), // PLC / HMI / drive / IO-Link master …
  set_on_site: z.boolean().default(false),
  notes: z.string().optional(),
});

export const TagTableRowSchema = z.object({
  tag: z.string().min(1),
  address: z.string().min(1), // absolute %I/%Q/%M
  data_type: z.string().optional(),
  comment: z.string().optional(),
});

// Records WHO exists and their role (maps onto the G0-10 ladder later).
// Deliberately no password/secret field — this is documentation, never a vault.
export const PanelAccountRowSchema = z.object({
  username: z.string().min(1),
  role: z.string().min(1),
  notes: z.string().optional(),
});

export const TimeSyncPlanSchema = z.object({
  ntp_servers: z.array(z.string().min(1)).default([]),
  timezone: z.string().optional(),
  dst_rule: z.string().optional(),
  notes: z.string().optional(),
});

export const CommissioningPackSchema = z.object({
  drive_checklist: z.array(DriveChecklistRowSchema).default([]),
  network_plan: z.array(NetworkPlanRowSchema).default([]),
  tag_table: z.array(TagTableRowSchema).default([]),
  panel_accounts: z.array(PanelAccountRowSchema).default([]),
  time_sync: TimeSyncPlanSchema.optional(),
});
export type CommissioningPack = z.infer<typeof CommissioningPackSchema>;

// on EngineeringDataV1Schema:
commissioning_pack: CommissioningPackSchema.optional(),
```

## Testing

Parse round-trip of a filled pack; empty-object defaults; back-compat (engineering
blob without the key parses; G0-1/G0-2/G0-4 keys untouched); rejects a
`panel_accounts` row with unknown keys is NOT required (Zod strips) — but assert
the schema has no password field by parsing a row with `password` and confirming
it is stripped.
