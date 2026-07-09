# HRE Commissioning Dashboard — SCADA Redesign + Input Forcing

**Date:** 2026-07-08 · **Status:** APPROVED (Kasper), direct implementation · **Project-specific (HRE)** — NOT a Forja board item.
**Scope:** `exports/SRL-1427-500802-PACKML/` (PLC seam) + `commissioning-hmi/` (server + full UI rewrite).

## Decisions
- **Style:** ISA-101 high-performance — light-grey canvas, muted equipment, color = abnormal only
  (red Fault / amber Warning / blue forced-or-manual). Persistent "FORCES ACTIVE (n)" banner on every page.
- **Pages (8):** Overview · Pendant · IO · Permissives · VFD · Settings · Alarms · Testing.
- **Input forcing:** all 28 non-safety, non-spare DIs get latched force enable+value pairs.
  `EStop_Healthy`/`SR1_Healthy` are structurally unforcible (no members exist). Forces effective only in
  maintenance mode; ALL forces auto-clear when maintenance mode drops. Outputs keep the existing `ov_` path.
- **Single-file client, no framework** (inline SVG mimics), same Node server.

## PLC seam — conditioned-inputs layer (supersedes yesterday's OR-at-sites)
- **`Force_CMD` DB:** `f_<tag>`/`v_<tag>` per forcible DI + `maint_prev` edge memory.
- **`IO_Cond` DB:** one Bool per forcible DI — the conditioned value every consumer reads.
- **`FORCE_Input_Cond` FC** (OB1 position: after `SIM_Input_Guard`, before UCs):
  `IO_Cond.X := (Force_CMD.f_X AND Maintenance_CMD.maintenance_mode) ? Force_CMD.v_X : physical` —
  with `OR Sim_CMD.sim_X` folded into the physical term for the 9 pendant/reset signals.
  Clears all `f_`/`v_` on maintenance-mode falling edge.
- **Consumers re-pointed to `IO_Cond.*`:** UC_Carriage/Rotator/Indicators (pendant temps, limit, horn,
  travel request), MAP drives (faults/therms/CB/BR + AckError), MAP brakes (fault/open), MAP pendants,
  MAP limits, MAP E-Stop (`Reset_PB`, `ECB_Trip`; EStop/SR1 stay direct reads). Sim OR-injection lines
  from 2026-07-08 morning are replaced by IO_Cond reads (sim behavior unchanged: momentary, watchdog-guarded,
  works in normal mode). N/C inversions stay at the consumers (IO_Cond carries raw-polarity values).
- Forcible list (28): ECB_Trip, BR1_Fault, VSD1_CB_Trip, CM1–4_Fault, CM1–4_Therm, Carriage_Brake_Open,
  Carriage_Brake_Fault, Rotate_Left(+Fast), Reset_PB, BR2_Fault, VSD2_CB_Trip, M5_Therm, Rot_Brake_Open,
  Rot_Brake_Fault, Fwd/Rev_Carriage(+Fast), Rot_Right(+Fast), Long_Limit_Stop. Excluded: safety pair,
  MS1 (retired), 7 spares.

## Server
- Poll adds: `Force_CMD` f_/v_ pairs (56), `EM_Travel_Indicators_DB.permit_travel`.
- Endpoints: `POST /force/set {tag, enable, value}` (rejects non-forcible), `POST /force/clear`.
- `/state` adds `forcible` list + `forces` active summary. Alarm engine unchanged.

## Client pages
- **Overview:** SVG rotator disc (segment bar rotated to `rot_position_deg10/10`, 0°/180° straight ticks,
  STRAIGHT flag), SVG rail travel bar (carriage marker vs `rail_length_mm`, shaded ramp zones + end margins,
  motion arrow from speed sign), mode strip (Production/Maintenance/Seq-test), safety + alarm count,
  10 EM state chips, 2 compact drive tiles.
- **IO:** DI/DO rows (lamp, tag, address, desc); maintenance-gated force toggles per non-safety DI
  (blue F badge), `ov_` toggles per DO, clear-all-forces.
- **Permissives:** cards per action (Fwd Jog/Fast, Rev Jog/Fast, Rotate L/R, Straighten, Machine-arm) —
  live condition rows mirroring UC gate logic, first blocking term highlighted.
- **VFD:** per-drive decoded ZSW1 bits, FB status/diag, setpoint-vs-actual, speed setpoint entries,
  static reference card (Tel 1, HW-ID 322/323, p2000=1500).
- **Settings:** rail geometry (+1 SECTION), rotator cal + capture, encoder presets, 8 speed setpoints,
  horn toggle, maintenance + seq-test switches.
- **Pendant / Alarms / Testing:** existing function, ISA-101 restyle.

## Verification
node --check; offline smoke (8181 copy); Chrome screenshots per page + console-error check;
`/tia/reimport-compile` for the seam (0 errors expected); live force/pendant tests wait on PLC download.
