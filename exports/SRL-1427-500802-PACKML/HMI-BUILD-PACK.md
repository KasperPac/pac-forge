# Segment Wagon — MTP700 Unified Basic HMI Build Pack

Build-by-numbers spec for the commissioning/operator HMI. Everything binds to
tags that already exist in `SegmentWagon_Site` and are proven via the
commissioning dashboard. PLC: `PLC_1` @ 192.168.0.10.

> **Commercial note:** the Pac FDS recorded `hmi_type: None`, but the customer
> FD rev B *does* reference the HMI ("the HMI will have a function to increase
> the distance to end of travel") — so a basic HMI with that function is
> arguably in scope; the *extent* (alarms, maintenance screens, overrides —
> per Daniel's 26-06 email) is the variation conversation.

## FD rev B traceability (requirements this HMI must carry)
| FD requirement | Where |
|---|---|
| "Function to increase the distance to end of travel" | Setpoints screen — rail length + **+1 SECTION (1.7 m)** button |
| Ramp-down 2 m before either stop position | `Rail_Config.ramp_zone_mm` = 2000 (display on Setpoints; PLC enforces: fast → jog inside the zone) |
| Speed limited ~10 m/min unless segment at 0° **or 180°** | PLC enforces (fast falls back to jog off-straight); Overview shows angle + "straight" lamp |
| Full speed 32 m/min | Tune `sp_FAST_*` % against measured wagon speed during commissioning |
| Encoder zeroed at tunnel entrance | Maintenance screen — rail preset |
| Flashing light + audible alarm | Travel Indicators EM (already in logic) |

**Open questions from the FD (not in the IO register):** the remote/pendant
lists *horn* and *remote generator start* buttons — neither has a PLC input in
the register. Confirm whether they're hardwired (horn direct, genset's own
receiver) or need IO added.

## Judgment calls baked into this spec (veto before building)
1. **Seq-test mode stays OFF the panel** — it's an engineering tool; leaving
   it off prevents an operator freezing the coordinators. Dashboard keeps it.
2. **Three access levels** — Operator (view + alarm ack), Supervisor
   (setpoints + rail length), Maintenance (mode, overrides, presets, scaling).
3. **Alarm classes**: motor/drive/brake faults = *Fault* (red, ack required);
   maintenance-switch-off and end-of-travel = *Warning* (no ack).
4. **Units**: speeds in % (matches drive p2000 scaling), rotator in °, rail in m.

## 0. Device setup
- Add device → HMI → **MTP700 Unified Basic** (7"). The physical panel is on
  the network already: MAC `10:d6:57:91:8a:f1`, currently unconfigured (was
  0.0.0.0) — give it **192.168.0.9**, device name `hmi-wagon`, assign name
  online (same DCP flow as the encoders).
- Networks view: drag an **HMI connection** between MTP700 and PLC_1.
- HMI tags: create one tag table "Wagon" and add the tags below via the
  connection browser (symbolic — no PUT/GET or absolute addressing needed).

## 1. Screen: OVERVIEW (start screen)
| Element | Tag / source | Display |
|---|---|---|
| Carriage state | `EM_Carriage_Drive_DB.state` (Int) | text list `CarriageDrive_States` |
| Rotator state | `EM_Rotator_Drive_DB.state` (Int) | text list `RotatorDrive_States` |
| Safety state | `EM_E_Stop_Circuit_DB.state` (Int) | text list `EStop_States` |
| Rail position | `Rail_Config.position_mm` (DInt) | ÷1000, "0.00 m" |
| Rail length | `Rail_Config.rail_length_mm` | ÷1000, "0.0 m" (bar graph vs position is a nice touch) |
| Rotator angle | `Rail_Config.rot_position_deg10` (DInt) | ÷10, "+0.0°" |
| Rotator at home | `Rail_Config.rot_at_home` (Bool) | lamp — green when TRUE ("FAST enabled") |
| Safety chain | `EStop_Healthy`, `SR1_Healthy`, `MS1_Healthy` (Bool, PLC tags) | 3 lamps |
| Active speeds | `EM_Carriage_Drive_DB.cmd_VSD1_Speed_Ref`, `EM_Rotator_Drive_DB.cmd_VSD2_Speed_Ref` (Int) | "%" readouts |

## 2. Screen: SETPOINTS (Supervisor level)
IO fields (Int, %, sensible limits 0..100 / -100..0):
- `Carriage_Drive_CMD.sp_JOG_SPEED_FWD` / `sp_FAST_SPEED_FWD` (0..100)
- `Carriage_Drive_CMD.sp_JOG_SPEED_REV` / `sp_FAST_SPEED_REV` (-100..0)
- `Rotator_Drive_CMD.sp_JOG_SPEED_LEFT` / `sp_FAST_SPEED_LEFT` (-100..0)
- `Rotator_Drive_CMD.sp_JOG_SPEED_RIGHT` / `sp_FAST_SPEED_RIGHT` (0..100)

Rail envelope:
- `Rail_Config.rail_length_mm` — IO field (mm) **plus a "+1 SECTION (1.7 m)"
  button**: script `Tags("Rail_Config_rail_length_mm").Write(x + 1700)` (read
  current, add 1700, write — 3-line Unified JS)
- `Rail_Config.ramp_zone_mm`, `Rail_Config.end_margin_mm` — IO fields
  (Maintenance level; defaults 3000 / 500)

## 3. Screen: ALARMS
Alarm view control (Unified "Alarm control", active + logged tabs) + an
**ACK button** — note the physical `Reset_PB` also acks drive faults via
SINA_SPEED; the HMI ack clears the HMI alarm state.

Discrete alarms (create under HMI alarms; trigger tag = PLC tag, trigger on
the state shown):

| # | Tag | Trig | Class | Text |
|---|---|---|---|---|
| 1–4 | `CM1_Fault`…`CM4_Fault` | =1 | Fault | "Carriage motor n overload trip" |
| 5–8 | `CM1_Therm`…`CM4_Therm` | =1 | Fault | "Carriage motor n thermistor overtemperature" |
| 9 | `VSD1_CB_Trip` | =1 | Fault | "Carriage VSD circuit breaker trip" |
| 10 | `BR1_Fault` | =1 | Fault | "Carriage braking resistor fault" |
| 11 | `VSD2_CB_Trip` | =1 | Fault | "Rotator VSD circuit breaker trip" |
| 12 | `BR2_Fault` | =1 | Fault | "Rotator braking resistor fault" |
| 13 | `M5_Therm` | =1 | Fault | "Rotator motor thermistor overtemperature" |
| 14 | `Carriage_Brake_Fault` | =1 | Fault | "Carriage brake contactor fault" |
| 15 | `Rot_Brake_Fault` | =1 | Fault | "Rotator brake contactor fault" |
| 16 | `ECB_Trip` | =1 | Fault | "Earth circuit breaker tripped" |
| 17 | `EStop_Healthy` | =0 | Fault | "Emergency stop active" |
| 18 | `SR1_Healthy` | =0 | Fault | "Safety relay tripped" |
| 19 | `MS1_Healthy` | =0 | Warning | "Maintenance isolation switch off" |
| 20 | `Long_Limit_Stop` | =1 | Warning | "Carriage at end-of-travel limit" |
| 21 | `SinaSpeed_Rail_DB.Error` | =1 | Fault | "Carriage drive fault — press reset" |
| 22 | `SinaSpeed_Rot_DB.Error` | =1 | Fault | "Rotator drive fault — press reset" |

## 4. Screen: MAINTENANCE (Maintenance level)
| Element | Tag |
|---|---|
| MAINTENANCE MODE toggle (big, red when on) | `Maintenance_CMD.maintenance_mode` |
| Output override switches ×9 (enabled only in maint mode) | `Maintenance_CMD.ov_Reset_ECB` … `ov_Carriage_Brake_Rel` |
| Rotator preset: value + EXECUTE + done lamp | `Maintenance_CMD.rot_preset_value` / `rot_preset_execute` / `rot_preset_done` |
| Rail preset: value + EXECUTE + done lamp | `Maintenance_CMD.rail_preset_value` / `rail_preset_execute` / `rail_preset_done` |
| Encoder raw values | `Rotator_Encoder_Pos`, `Carriage_Encoder_Pos` |
| Rail scale (set once) | `Rail_Config.mm_per_rev_x10` |

Preset EXECUTE buttons: set bit on press, **reset on release** (button
"press/release" events) — the PLC sequencer needs only a pulse.

## 5. State text lists (index → text)
- **CarriageDrive_States**: 0 Aborted · 1 Clearing · 2 Stopped · 3 Resetting · 4 Idle · 5 Aborting · 6 Execute · 7 Stopping · 8 Holding · 9 Held · 10 Unholding
- **RotatorDrive_States**: 0 Aborted · 1 Clearing · 2 Stopped · 3 Resetting · 4 Aborting · 5 Idle · 6 Execute · 7 Stopping
- **EStop_States**: 0 Aborted · 1 Clearing · 2 Stopped · 3 Resetting · 4 Aborting · 5 Idle
- (Others if ever displayed — CarriageBrake: 0 Aborted · 1 Clearing · 2 Stopped · 3 Aborting · 4 Resetting · 5 Idle · 6 Starting · 7 Execute · 8 Stopping; RotatorBrake: as CarriageDrive; Limits: 0 Aborted · 1 Resetting · 2 Idle · 3 Execute · 4 Stopping · 5 Aborting · 6 Stopped; Indicators: 0 Aborted · 1 Resetting · 2 Idle · 3 Aborting · 4 Execute · 5 Stopping · 6 Stopped; Pendants/Spare: 0 Aborted · 1 Clearing · 2 Stopped · 3 Resetting · 4 Aborting/Idle per EM — see dashboard server.mjs EMS table for exact.)

## 6. Access levels → Unified roles
| Role | Rights |
|---|---|
| Operator (no login) | Overview, Alarms view + ack |
| Supervisor | + Setpoints screen (speeds, rail length, +section) |
| Maintenance | + Maintenance screen, ramp/margin/scale |

## 7. Build notes
- All DB tags are optimized/symbolic — browse them via the HMI connection;
  no PUT/GET, no absolute addresses.
- After first download to the panel: set the PLC connection online and watch
  Overview — if state numbers show but text lists don't, the text list
  isn't bound to the field (common Unified gotcha).
- Retentivity: tick retain on `Rail_Config` operative fields (length, scale,
  ramp, margin) in the PLC DB — the HMI writes are pointless if a power cycle
  wipes them.
- The commissioning dashboard keeps working alongside the panel — same tags,
  no conflict (last write wins on setpoints, which is fine).
