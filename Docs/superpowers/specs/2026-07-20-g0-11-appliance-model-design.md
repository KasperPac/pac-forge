# G0-11 — Appliance Model — Design (+plan)

> **Task:** G0-11 (Monday subitem 3056974078) — P1/L
> **Depends on:** G0-6 boundary §K; G0-8 (`fb_assignments` carry driver FBs), G0-3b (EM↔EM handshake analogue)
> **Evidence:** Sun Metals Z20 KUKA reverse-engineering (`test-data/`): PGNO request/valid/complete handshake over EtherNet/IP, task executor EM, typed ingot-type payload to robot — the UDT telegrams had to be shoehorned into plain `io_signals`, the exact gap §K names.
> **Scope split (2026-07-20, with Kasper):** the criteria-model extension for data
> comparisons ("scanned code matches expected") is **G0-11b** (subitem 3097194539),
> designed alongside the G9-4 pilot. v1 records payloads with a `comparable` flag.

## Goal

Model third-party intelligent appliances (robots, conveyor cards, RFID/barcode
scanners — drives are retroactively the first instance of this class): signable
inventory + ISA-88 placement, functional comms interface (handshake patterns),
and typed data payloads — the new signal kind the Bool/analog IO list cannot
express.

## Tier 1 — project key `appliances` (new jsonb column; migration authored, NOT pushed)

```ts
export const AppliancePlacementSchema = z.enum([
  "cm_like", // scanner: trigger→result under an EM
  "own_em", // robot: own EM whose PackML states wrap the job handshake
  "hybrid", // conveyor card: FDS must say who owns zone logic
]);

export const ApplianceHandshakePatternSchema = z.enum([
  "job_request_ack_done", // KUKA PGNO: request/valid/complete
  "trigger_result_valid", // scanner: trigger → result + valid
  "zone_release_occupied", // conveyor card zone handshake
  "custom",
]);

export const ApplianceDataPayloadSchema = z.object({
  payload_id: z.string().min(1),
  name: z.string().min(1), // e.g. "ingot_type", "scanned_code"
  direction: z.enum(["to_appliance", "from_appliance"]),
  data_type: z.enum(["string", "int", "dint", "real", "record"]),
  validity_flag_tag: z.string().optional(), // Bool qualifying the payload
  comparable: z.boolean().default(false), // criteria use — G0-11b delivers it
  description: z.string().optional(),
});

export const ApplianceHandshakeSchema = z.object({
  handshake_id: z.string().min(1),
  pattern: ApplianceHandshakePatternSchema,
  description: z.string().optional(),
});

export const ApplianceSchema = z.object({
  appliance_id: z.string().min(1),
  name: z.string().min(1),
  vendor_model: z.string().optional(), // "KUKA KRC5", "Interroll MultiControl"
  function: z.string().min(1), // what it does — customer signs this
  placement: AppliancePlacementSchema,
  zone_logic_owner: z.enum(["plc", "appliance"]).optional(), // REQUIRED when hybrid
  target_kind: z.enum(["control_module", "equipment_module"]).optional(),
  target_id: z.string().min(1).optional(), // realizing CM/EM in the hierarchy
  protocol: NetworkProtocolSchema.optional(),
  handshakes: z.array(ApplianceHandshakeSchema).default([]),
  payloads: z.array(ApplianceDataPayloadSchema).default([]),
  notes: z.string().optional(),
});

export const ApplianceModelV1Schema = z.object({
  appliances: z.array(ApplianceSchema).default([]),
});
// SpecContractV2Schema / patch: appliances: ApplianceModelV1Schema.optional()
```

## Tier 2 — nothing new (deliberate)

- Driver FB per appliance rides `fb_assignments` (G0-8) unchanged; appliance
  driver templates belong in the FB library (G6).
- Telegram/byte layouts, GSDML/EDS refs, HW identifiers, IP/device names ride
  the existing `network_config` + engineering surfaces (table A + §H plan).
- Vendor-side configuration (robot program, card web config, scanner codepage)
  is tier 3 — the FDS signs only the interface to it.

## Validation (patch gate, context-absent convention)

- Duplicate `appliance_id` → error (always).
- `placement: "hybrid"` without `zone_logic_owner` → error (always).
- Placement/target consistency when `target_kind` present: `cm_like` ⇒
  control_module, `own_em` ⇒ equipment_module (hybrid: either).
- `target_id` must exist in the hierarchy pool for its kind when the patch
  carries hierarchy.
- Duplicate `handshake_id`/`payload_id` within an appliance → error.

## Testing

Round-trips + defaults + back-compat; every validation rule + skips; golden
fixture shaped on the Sun Metals KUKA (own_em, ethernet_ip,
job_request_ack_done handshake, ingot_type payload to_appliance with validity
flag) + a generic scanner (cm_like, trigger_result_valid, scanned_code
comparable) — values in tests only.

## Non-goals

Criteria/data-comparison extension (G0-11b), driver FB emission (G1
generalized / G6), handshake pin-set emission (writer), vendor config (tier 3).
