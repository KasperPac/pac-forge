# SRL-1427-500802 Segment Wagon — Generated PLC Sources

Generated 2026-07-05 from FDS spec `SRL-1427-500802-PACKML` (spec id
`8913bad6-7040-4908-bbb3-67f16a501802`) by the Pac-Forge deterministic Code
Builder (SP-4 compiler, includes command-branched Execute holds).

**Includes Daniel Stewart's 26-06 email corrections** (applied to the FDS,
then regenerated; pre-change FDS rows backed up in
`_fds-backup-before-customer-notes.json`):

- **No motor contactors** — `CM1–4_Run` outputs removed everywhere; the CMx
  fault inputs are overload trips and stay as fault fan-in. Drives run purely
  on the VSD speed reference.
- **PROFINET speed references** — `VSD1/VSD2 Speed_Ref/Speed_Fb` have no IO
  address; the MAP FCs emit `// TODO wire ...` lines — point them at the
  PROFINET telegram words (address "can be whatever" per customer).
- **Brakes controlled by the VSDs** — `Carriage_Brake_Rel` (Q1.0) is no
  longer written; the Carriage Brake EM is monitor-only. Brake-open was
  REMOVED from the drive Execute guards (the brake only opens when the VSD
  runs — gating run on brake-open would deadlock), and Carriage Drive's
  Unholding now confirms zero speed instead of brake-open.
- Rotation/travel remain **manual from the remote** — Execute is pendant
  command branches only; no automatic positioning sequences exist.

56 blocks: 10 EM function blocks + state UDTs + CMD DBs + MAP FCs + instance
DBs, 5 unit coordination stubs (`UC_*`), and `Main.ob` (OB1).

## Import order (TIA Portal → External source files → Generate blocks)

1. `*.udt` — PLC data types
2. `*_CMD.db` — command/setpoint interface DBs
3. `EM_*.scl` — EM function blocks
4. `EM_*_DB.db` — instance DBs
5. `MAP_*.scl` — IO mapping FCs (reference absolute addresses — PLC tag table
   must cover I0.0–I4.7, Q0.0–Q1.0, AI0/AI1 → IW address, AQ0/AQ1 → QW address;
   fix the analog addresses in MAP_Carriage_Drive / MAP_Rotator_Drive to the
   real IW/QW offsets)
6. `UC_*.scl` — unit stubs (optional; not called from OB1 yet)
7. `Main.ob` — OB1 with all EM instance calls + MAP calls

## Commissioning checklist

- **Set speed setpoints** (default 0 → drives will not move until set):
  - `Carriage_Drive_CMD`: `sp_JOG_SPEED_FWD`, `sp_FAST_SPEED_FWD`,
    `sp_JOG_SPEED_REV`, `sp_FAST_SPEED_REV`
  - `Rotator_Drive_CMD`: `sp_JOG_SPEED_LEFT`, `sp_FAST_SPEED_LEFT`,
    `sp_JOG_SPEED_RIGHT`, `sp_FAST_SPEED_RIGHT`
  - Reverse/left values are applied as-is to the speed reference — enter signed
    values if the VSD expects a signed reference.
- **Enable + drive the PackML machine**: each EM starts in state 0 (Aborted,
  safe). Route per EM: `CMD_CLEAR` → Clearing → Stopped, `CMD_RESET` →
  Resetting → Idle, `CMD_START` → Execute. Command sources are `ilk_*_CMD_*`
  inputs wired through the MAP FCs / coordination layer — for bench testing
  you can force them at the EM instance DB.
- **Pendant motion** happens inside Execute of Carriage/Rotator Drive: the
  four labelled command branches (jog/fast × fwd/rev) hold the contactors +
  speed reference only while the pendant input is TRUE, brake open, and (for
  the carriage) the longitudinal limit not tripped. Releasing the pendant
  drops all outputs (anti-latch defaults).
- **`// TODO (AI-fill)` regions** in sequential states (Clearing, Resetting,
  Aborting, Stopping, Holding) are intentional stubs: the exit conditions are
  real and the blocks compile; add device actions in the marked regions where
  needed (e.g. Stopping already ramps via the speed-ref default of the next
  state — most stubs need nothing for this machine).
- **Known spec nits** (harmless, fix in FDS later): Carriage Pendant and
  Rotator Drive have a completion transition out of Execute that can never
  fire (Execute is command-driven and never "completes") — Execute is exited
  via STOP/HOLD/fault commands instead, which are present.

## Plugging into your own device FBs

The EM FBs only touch their own `cmd_*` outputs; physical IO is isolated in
the `MAP_*` FCs. To use your own device/driver FBs instead of direct IO
writes, replace the corresponding assignment in the MAP FC (e.g. drive your
motor FB's run input from `"EM_Carriage_Drive_DB".cmd_CM1_Run` instead of
mapping straight to `Q0.4`). Nothing inside the EM FBs needs to change.
