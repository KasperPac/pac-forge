# PLC-side event logger — CVL-2129-5002001

Scan-accurate event capture in the PLC itself, so nothing is lost when the
dashboard PC is off or disconnected. One SCL source (`EVENT_LOGGER_PKG.scl`)
generates five objects:

| Object | Type | Purpose |
|---|---|---|
| `UDT_EventLogEntry` | UDT | one entry: Seq, DateNum, TimeNum, Cat, Code, Val, Info[32] |
| `EVENT_LOG_DB` | global DB | 500-entry ring buffer + monotonic `Head` |
| `EVENT_PUSH` | FC | timestamp (PLC local time) + append one entry |
| `EVENT_LOGGER` | FB | edge detection on all monitored signals, once per scan |
| `EVENT_LOGGER_DB` | instance DB | |

Categories: 1 SYSTEM · 2 LIFT_A · 3 LIFT_B · 4 CONVEYOR · 5 DEVICE · 6 SAFETY ·
7 COMMS. Full Cat/Code table in the SCL header (mirrored in
`../plc-dash/plc-log.mjs`, which decodes entries for the dashboard).

## Status

- **2026-07-21**: rev 1 imported into `CVL-2129-5002001 6.8` (02 Chiller copy)
  via the Pac-Forge bridge — generated clean, compiled 0 errors, project saved.
- **2026-07-22**: rev 2 imported + compiled clean (0 errors). Adds `Val2` field,
  task lifecycle, sequence-step tracking, fault durations, restart marker, and
  an `Enable_ConveyorTrail` input (set FALSE to drop the position trail).
- Captures: system mode changes (Manual/SemiAuto/Auto/Run/Stop), per-elevator
  mode + faults (incl. `ELV_A_Faults` codes) **with active-duration on clear**,
  pallet in/out of both elevators **with barcode + level** (PTF02 validation
  string), barcode pass/fail, **WMS task lifecycle** (PTF03 received with
  start>target route, PTF04 status sent, PTF05 step reason incl. reason text),
  **elevator + carriage sequence steps with previous-step dwell time**,
  conveyor-position occupancy trail, drive status changes (with device tag from
  `HMI_DEV_VSD_MOT_TAG`), safety trip/restore (with tripped duration), comms
  errors (with duration), F38 pallet-on-infeed, and a **logger-started marker**
  on every download/PLC restart.

## To commission (manual steps in TIA)

1. Open `Main` (OB1) and add a network at the end: call `EVENT_LOGGER` with
   instance `EVENT_LOGGER_DB`. No parameters.
2. Check *Program info → Resources* — the project compile reports a
   pre-existing "required code memory larger than available" warning; confirm
   the CPU has room before downloading.
3. Download to the PLC (the new DB + FB go down; existing block values are
   untouched — nothing else was modified).
4. Start `plc-dash/server.mjs` — it auto-detects `EVENT_LOG_DB` and switches to
   scan-accurate drained logging (`source: PLC ring buffer` in the Events tab).

## Sizing / behaviour

- Ring holds **500 events** (~30 KB, NON_RETAIN). At a typical busy rate
  (~500 events/h) that bridges ~1 h of dashboard downtime before overwrite;
  the server reports "N events lost to ring overwrite" if it ever gaps.
- `Head` is a monotonic DInt — the drain protocol reads entries `lastSeq+1 … Head`
  and verifies each entry's `Seq` to detect mid-read overwrite.
- PLC cold restart clears the log (NON_RETAIN) — switch the two DBs to RETAIN
  if the retentive budget allows and that matters.
