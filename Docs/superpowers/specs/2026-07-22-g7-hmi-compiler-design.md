# G7 — FDS → HMI Compiler (the derivation layer) — Design

> **Task:** G7 (roadmap `Docs/ROADMAP-RUNNABLE-CODE-HMI.md`, Monday item 3056337435)
> **Date:** 2026-07-22 · **Status:** DESIGN (authored by Claude, pending Kasper review)
> **Evidence:** `exports/SRL-1427-500802-PACKML/HMI-BUILD-PACK.md` (the hand-authored
> build-by-numbers spec) + the shipped G1–G5 deterministic writers (their naming
> rules ARE the tag universe)
> **Depends on:** G1–G5 (shipped), G0-9/G0-10 models, G3 maintenance layer, bridge
> `TiaPortalService.HmiUnified.cs` v1.2.0 (committed d4a1a2e — roadmap G8-6 stale)

## Goal

A pure, deterministic compiler `buildHmiSpec(contract) → HmiBuildSpec` that turns a
confirmed FDS into the JSON the bridge's `POST /tia/hmi/build` already accepts —
the machine-generated equivalent of the hand-authored HMI-BUILD-PACK. No AI in the
path; the build pack's "judgment calls" become contract data or fixed generic rules.

## The core insight — the tag universe is already deterministic

Every tag the golden-master build pack binds is a deterministic artifact of the
G1–G5 writers: `EM_<x>_DB.state`, `<EM>_CMD.sp_*`, `CFG_<Unit>.<member>`,
`STAT_<Unit>.<member>`, `UN_<Unit>.Cur_St/Mode_Req/St_Cmd`, `Maintenance_CMD.*`,
`<drive DB>.Error`. The HMI compiler therefore derives bindings from the **same
contract via the same naming helpers** — never from strings the user types.
Naming helpers (`sclIdent`, DB-name construction) move to a shared
`codegen/naming.ts` consumed by both the SCL writers and the HMI compiler, so a
rename in one place cannot desynchronize the two.

## Decision 1 — Intermediate representation, then bridge JSON

`src/lib/spec-builder/hmi/` (pure, no React/IO):

- `hmi-ir.ts` — typed IR: tags, text lists, alarm classes + discrete alarms,
  screens (typed items: state field, numeric IO field, lamp, button, alarm
  control), roles.
- `hmi-compiler.ts` — `buildHmiIr(contract): HmiIr` composing the per-domain
  generators below.
- `hmi-bridge-spec.ts` — lowers the IR to the `/tia/hmi/build` request shape
  (`tia-bridge-contract.ts` is the contract of record).
- Also lowers to a human-readable **build-pack markdown** (the HMI-BUILD-PACK
  shape) so projects panels can't reach still get a build-by-numbers document —
  and so G8-4's Openness gaps degrade to a documented manual step, not a dead end.

## Decision 2 — Per-domain generators (the G7 rows)

| Row | Generator | Source → output |
|---|---|---|
| G7-1 | Text lists | Per EM: dispatch-order states (same ordering as `em-builder`; matched library EMs use contract state order) → `<EM>_States` index→name list. Unit lists: declared `unit_coordination` states in canonical order → `<Unit>_States`. |
| G7-2 | Alarms | `contract.alarms[]` → discrete alarm defs (trigger tag, trigger value =1 unless the tag is a healthy-signal — safety-gate conditions with `value:false` trigger =0 — class from tier via G7-6, text from description). Plus derived drive-fault alarms per detected drive (`<SINA DB>.Error` = "drive fault — press reset"). |
| G7-3 | Setpoints screen | EM command-seam `sp_` pins (Int) → IO fields grouped per EM; `CFG_<Unit>` members with `operator_settable` → IO fields with their G0-10 `access` level. No limits are modeled on `sp_` pins today → fields emit without limits + a build-report note (TODO-not-guess); limits become a G0 follow-up if commissioning demands them. |
| G7-4 | Tag binding | Symbolic DB-member bindings only (build-pack rule: optimized/symbolic, no PUT/GET). HMI tag name = PLC tag with `.`→`_`. The legacy `Inst<Dev>.hmi.*` convention in `hmi-tag-mapper.ts` stays for the old forge path; the new compiler does not use it. |
| G7-5 | Roles | G0-10 `authorization` ladder → Unified roles; screen access = max of its items' `required_level` (G0-10 rule: screens DERIVE from item levels). No ladder authored → single-role fallback + note. |
| G7-6 | Alarm classes | `alarm_tiers` → classes. Generic mapping: a tier whose id/name matches /critical|fault/i → **Fault** (ack required), else **Warning**. Bridge creates missing classes (G8-2). |
| G7-7 | Maintenance screen | `maintenance.overridable_outputs` → override switches (enabled only in maintenance mode); presettable axes + `encoder_presets` → preset value/EXECUTE (press/release pulse)/done rows; `CFG` scale members; maintenance-mode toggle bound to `Maintenance_CMD.maintenance_mode`. Seq-test stays OFF the panel (build-pack judgment call #1, now a fixed rule). |
| G7-8 | Assembly | Screens: **Overview** (per unit: EM state fields with text lists, `STAT_<Unit>` readbacks with EU scaling from the axis model, safety-gate lamps), **Setpoints**, **Alarms** (alarm control + ACK), **Maintenance** (only when the maintenance layer exists) → one `HmiBuildSpec`. |

## Decision 3 — What stays out (v1)

- PackML faceplates (G8-7, parked idea) — v1 uses plain fields + text lists.
- Panel device creation/addressing (physical commissioning, tier 3).
- The `+1 SECTION` style scripted buttons — generic mechanism = a
  `scripted_increment` item kind on operator-settable CFG members with a
  declared step; only emitted when the axis `length` param declares
  `increment_step` (small G0-4 additive field, part of this wave).
- Trend/logging config.

## Decision 4 — G8 wiring

- **G8-1**: `use-hmi-build.ts` hook → POST `/tia/hmi/build` with the lowered
  spec; surfaced in the Code Builder as an "HMI" artifact group (spec JSON +
  build-pack markdown as artifacts, then a "Build in TIA" action).
- **G8-2** (bridge): create alarm classes when absent — small Openness addition,
  bump BridgeVersion + CHANGELOG.
- **G8-4** (⛔ research first): Unified text-list creation via Openness is
  unverified. Discovery method per `Docs/WINCC-UNIFIED-OPENNESS-DISCOVERY.md`
  (grep `Siemens.Engineering.xml` for `TextList` under HmiUnified). If
  unsupported: compiler still emits the lists in the build-pack markdown as a
  manual step, and state fields fall back to plain numeric display + a note.
- **G8-3** (⛔ research): role creation via UserAdministration — same discovery
  method; fallback = roles documented in the build pack, assigned manually.
- **G8-5**: panel family model — `hmi_type` on the spec project selects
  MTP Unified Basic vs Comfort; v1 targets Unified (the golden master's family).

## Testing

Vitest, all machine-generic; the HRE contract as parity fixture:
1. Text lists match each EM's dispatch order exactly (regression against
   em-builder ordering — shared fixture).
2. Alarm generator: tier mapping, healthy-signal trigger inversion, drive-fault
   derivation.
3. Setpoints: sp_ pin discovery through the command seam; CFG operator_settable
   + access levels.
4. Assembly snapshot: small generic 1-unit contract → stable HmiBuildSpec JSON.
5. HRE parity: compiler over the reverse-engineered HRE contract reproduces the
   hand-authored build pack's bindings (structural parity: same tags bound to
   same screen roles; not text parity).

## Wave plan

- **W1**: shared naming module + IR + G7-1 text lists + G7-6 classes (small,
  anchors conventions).
- **W2**: G7-2 alarms + G7-4 binding + G7-3 setpoints.
- **W3**: G7-7 maintenance + G7-5 roles + G7-8 assembly + build-pack markdown.
- **W4**: G8-1 hook/UI + G8-2 bridge classes (+ BridgeVersion bump).
- **W5**: G8-3/G8-4 Openness discovery spikes (bridge, gated on TIA access) —
  outcomes feed back into the lowering (native vs manual-step).

## Genericity check

Every generator keys off contract structure + writer naming rules; the build
pack's HRE specifics (screen inventory, judgment calls) become either fixed
generic rules (seq-test off-panel), tier/kind-driven mappings, or contract data
(increment step). HRE values appear only in the parity fixture.
