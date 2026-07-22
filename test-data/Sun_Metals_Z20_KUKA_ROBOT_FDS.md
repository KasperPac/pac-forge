# Functional Design Spec — Sun Metals Z20 Robotic Ingot-Stacking Cell

> **Source:** reverse-engineered from `Sun_Metals_Z20_20260708.L5K` (RSLogix 5000 v33, controller `Sun_Metals_Z20`, 5069-L310ERM), **`KUKA_ROBOT` program only**, plus its external connectors. Exported Sun Jul 19 2026.
> **Status:** First-pass, machine-derived. Items I inferred rather than read explicitly are tagged **[ASSUMPTION]**. Behaviour is lifted from ladder/neutral-text logic — a paper spec or P&ID would let us separate *what the code does* from *what it is meant to do*.
> **Scope note:** the `KUKA_ROBOT` program is one **Unit** inside the larger Z20 strapping line (the same controller also runs `Strapping_Machine`, `OLD_Strapping_Machine`, `Channel1Program` — out of scope here).

---

## 1. Purpose & Process Overview (ISA-88 §4.3 — Process Model)

The cell **palletises cast aluminium ingots into strapped stacks**. Product-centric process:

1. Ingots arrive on an **infeed conveyor** with up to **4 pickup positions**.
2. Per-position sensors classify each ingot as **Foot**, **Standard (Regular)**, **Top**, or **Flip** type; a **laser height scan** verifies/refines the type.
3. An **infeed queue** tracks ingot type/order across the 4 positions (with a turn-over "flipper" path for ingots needing reorientation).
4. A **KUKA KRC5 robot** with a **4-gripper end-effector** picks 1–4 ingots per cycle and builds **layered stacks** on up to **3 stacker positions** (1 primary + 2 backup) plus a **makeup table** for accumulating partial layers.
5. Layers build bottom-up: **Foot** layer → **Regular** layers → **Top** layer, up to **9–10 layers** per stack.
6. Completed stacks **index off-conveyor** to the downstream strapper; a **SICK encoder** tracks stack X-position during indexing.
7. **Good/discard bin** management for rejected ingots.

**Machine type for genericity check:** robotic pick-and-place palletiser. Nothing below is hard-coded to ingots specifically — the same structure (infeed queue → classify → robot task dispatch → layered stack build → outfeed index) applies to any robot palletising cell.

---

## 2. ISA-88 Physical Hierarchy (§4.4)

| Level | Instance | Evidence |
|---|---|---|
| **Process Cell** | Z20 Strapping Line | Controller `Sun_Metals_Z20`, "Strapping Machine" |
| **Unit** | Robotic Stacking Cell | `KUKA_ROBOT` program, `KUKA_MAIN` routine |
| **Equipment Modules** | see §3 | routine groups R2xx/R3xx/R4xx + step-action AOIs |
| **Control Modules** | see §5 | `FB_DI_Sensor`/`FB_AI_Sensor`/`FB_DI_PushButton`/`FB_D_Solenoid` instances |

Single Unit is correct here — the whole program runs under one coordinated operating sequence (one robot, one infeed, one set of stacks). Equipment-module boundaries below are extracted from the routine decomposition, not invented.

---

## 3. Equipment Modules (Procedural Control, ISA-88 §5.3)

| EM | Routine(s) / AOI | Responsibility | State-bearing? |
|---|---|---|---|
| **EM-INFEED** Infeed Queue & Detection | `R201_INFEED_QUEUE`, `R202_FOR_LOOP_DELETE`, `R203_INGOT_CONVEYOR_DETEC`, `FB_INGOT_DETECTION`, `FB_IngotDetect_Scan` | Detect ingots at 4 positions, classify Foot/Std/Top/Flip, maintain FIFO queue + tracking array, delete picked ingots, drive turn-over flipper | Yes — queue index + tracking |
| **EM-ROBOT** Robot Interface & Task Executor | `R004_KUKA_ROB_EIP_IO`, `R204_EXECUTE_ROBOT_TASK`, `FB_EXECUTE_R_STEPS_ACTIONS`, `AOI_KRC5_KUKA` | Map the full KRC5 EtherNet/IP handshake, select/dispatch robot task (PGNO), enforce ready/interlock conditions, reflect robot status to PLC/HMI | Yes — task step/action FB |
| **EM-STACK-FOOT** | `R302_FOOT_INGOTS`, `FB_FOOT_INGOTS_STEPS_ACTIONS` (`FOOT_SAS`/`FOOT_SECTION`) | Sequence for placing the foot (bottom) layer; picks foot ingots, assigns active stack, advances layer | Yes — step/action machine |
| **EM-STACK-REG** | `R303_REGULAR_INGOTS`, `FB_REG_INGOTS_STEPS_ACTIONS` (`REGULAR_SAS`) | Sequence for regular (mid) layers | Yes |
| **EM-STACK-TOP** | `R304_TOP_INGOTS`, `FB_TOP_INGOTS_STEPS_ACTIONS` (`TOP_SAS`) | Sequence for the top layer (uses flip-detected ingots) | Yes |
| **EM-STACKMGMT** Stack Bookkeeping | `R301_STACKS_MGMT`, `STACK_COUNT`, `MAKEUP_COUNT`, `FB_OUTFEED_ENC_TRACK` | Layer/quantity counting per stack, active-stack rotation, stack-off-conveyor shift, X-position tracking via encoder | Yes — counters + index track |
| **EM-MAKEUP** Makeup Table | `MAKEUP_TABLE` tag, `MAKEUP_1`, makeup fill request logic in R203 | Partial-layer buffer (top/mid/btm racks with required qty per option) | Yes |
| **EM-GRIPPER** Gripper & Pneumatics | `R003_K_VALVE_MANIFOLD_EIP_IO`, `R008_DO_SOLENOIDS`, `FB_D_Solenoid` | 4 gripper solenoids (extend/retract + reed-switch feedback) + laser air-blast | No — basic control |
| **EM-CONVEYTECH** Downstream Conveyor Handshake | `R305_CONVEYTECH_INT` | 6-step handshake (via robot Task 6) to release a completed stack to the downstream ConveyTech conveyor/strapper | Yes — step machine (Step 0→6→31) |
| **EM-SYS** System / Mode & Fault Manager | `R101_SYS_Process`, `R102_SYS_Fault` | PackML-style mode/state engine + 14-word fault table (see §4) | Yes — SYS_Status |

**Robot task map (PGNO program numbers)** — the robot is commanded by numeric program select:

| Task | Meaning (from `R401_ROBOT_ACTIONS` rung comments) |
|---|---|
| 0 | Idle / clear request |
| 1 | Move to position (pick from conveyor) |
| 2 | Stack **with makeup table** |
| 3 | Stack (variant) |
| 4 | Stack (variant) |
| 5 | Send robot data / update layers & quantities |
| 6 | ConveyTech interface action (release stack) |
| 7 | Go to maintenance position |

**[ASSUMPTION]** Tasks 3 & 4 are distinct stacking motions (e.g. multi-pick vs single, or backup-stack placement) — the exact motion lives in the KUKA `.src` programs, not the PLC. Confirm against the robot program listing.

---

## 4. State & Mode Model (PackML-style — ISA-TR88.00.02)

The cell implements a **custom PackML-lite** model via the `BASE` / `BASE_CONTROL` UDT on the controller-scoped **`TOP`** tag (`TOP.CTRL` = live control, `TOP.HMI` = HMI mirror).

**Modes:** `Automatic` / `Manual` (toggle latched in `R101`), plus a `Maintenance` request path.

**States** — `TOP.CTRL.SYS_Status` (INT), documented inline in `R101_SYS_Process`:

| # | State | # | State (minor-fault variant) |
|---|---|---|---|
| 0 | No Status | | |
| 1 | Stop – No Mode | 11 | Stop-NoMode-MinorFault |
| 2 | Stop – Auto Mode | 12 | Stop-AutoMode-MinorFault |
| 3 | Starting – Auto Mode | 13 | Starting-AutoMode-MinorFault |
| 4 | Running – Auto Mode | 14 | Running-AutoMode-MinorFault |
| 5 | Paused – Auto Mode | 15 | Paused-AutoMode-MinorFault |
| 6 | Stop – Manual Mode | 16 | Stop-ManualMode-MinorFault |
| 7 | Starting – Manual Mode | 17 | Starting-ManualMode-MinorFault |
| 8 | Running – Manual Mode | 18 | Running-ManualMode-MinorFault |
| 9 | **Major Fault** | | |

**Commands (into `TOP.CTRL` / `TOP.HMI`):** `Start_Request`, `Stop_Request`, `Pause_Req`, `Fault_Reset_Request`, `Robot_Enable` (latched toggle), `Automatic_Request`/`Manual_Request`, `Maintenance_Request`. Sources: HMI (`TOP.HMI.*` and `KUKA_HMI.IN_*`) and hard pushbuttons (`FB_DI_PushButtonData[2..4]`).

**Run gating:** `Automatic_Run` = (Start OR already running) AND NOT Stop AND Automatic_Request AND NOT MajorFault. `Run` asserts after a `SystemBootDelay` timer. `Paused` when Pause_Req during Auto_Run.

**Fault model** — `TOP.CTRL.Fault[0..13]`, each a `SYSTEM_FAULT` word with `.F.0..31`, `MinorFault`, `MajorFault`. Faults captured in `R102_SYS_Fault`:

| Bit (Fault[0]) | Condition |
|---|---|
| F.1 | K_RIO1 (IO-Link master 1) connection faulted |
| F.2 | K_RIO2 connection faulted |
| F.3 | KUKA_ROBOT connection faulted |
| F.4 | Valve manifold status fault |
| F.5 | SICK encoder connection faulted |
| F.6 / F.7 | K_RIO1 / K_RIO2 UA or US power fault |
| F.8 | Robot `ALARM_STOP` |
| F.9 | Valve manifold under-voltage |
| F.10 | Sensor 23 (safety/e-stop input) |
| F.30 | E-Stop 1 (pushbutton 1) → **MajorFault** |
| F.31 | E-Stop 1 (sensor 23) → **MajorFault** |

Major fault = F.30 OR F.31. Faults latch until `Fault_Reset_Request`. Minor faults roll up from Fault[6..8].

---

## 5. Control Modules (Basic Control, ISA-88 §5.2)

All field devices are wrapped in **4 reusable device AOIs** — these are the CM-level "FB library":

| Device AOI | Role | Instances |
|---|---|---|
| `FB_DI_Sensor` | Digital-input sensor w/ fault (`InSignal`, `InSensorFault` → `OutSignal`) | `FB_DI_SensorData[1..23]` — infeed top/lower sensors, per-position top/foot detection sensors, safety input (23) |
| `FB_AI_Sensor` | Analog (laser) sensor w/ fault | `FB_AI_SensorData[1..4]` — 4 laser height scanners (A/B/C/D), one per pickup position |
| `FB_DI_PushButton` | Pushbutton | `FB_DI_PushButtonData[1..4]` — E-Stop(1), Start(2), Stop(3), Pause(4) |
| `FB_D_Solenoid` | Double/single solenoid w/ reed-switch feedback (`OutExtend`/`OutRetract`, `InSol_Feedback*`) | `FB_DO_SolenoidData[1..5]` — grippers A–D (1–4) + laser air-blast (5) |

Signal flow: raw I/O (from IO-Link masters / manifold) → mapped in `R001`–`R003`/`R008` → device-AOI `*Data[]` arrays → consumed by sequences and the robot handshake.

---

## 6. External Connectors ⭐ (your specific ask)

Everything the `KUKA_ROBOT` program exchanges with the outside world. All EtherNet/IP devices hang off `Local` (the CompactLogix backplane) on subnet **192.168.1.x**.

### 6.1 Physical I/O connectors (EtherNet/IP)

| Connector | Device | Catalog | IP | Role in cell |
|---|---|---|---|---|
| **`KUKA_ROBOT`** | KUKA KRC5 robot controller | `KRC` (vendor 121) | 192.168.1.24 | **Primary connector** — full handshake + task dispatch. UDT `UDT_IO_KUKA_ROBOT` (In/Out V2). See §6.2. |
| **`K_RIO1`** | Balluff BNI IO-Link master | `BNI006A` (vendor 43) | 192.168.1.21 | 8 ports: P1–P4 IO-Link (laser sensors + DI sensors 9–12), P5–P8 DI (sensors 1–8) |
| **`K_RIO2`** | Balluff BNI IO-Link master | `BNI006A` | 192.168.1.22 | 8 ports DI (sensors 13–22 incl. per-position conveyor detection) |
| **`K_VALVE_MANIFOLD`** | SMC valve manifold | `EX260-SEN1/A` (vendor 7) | 192.168.1.23 | 5 solenoid points → grippers A–D + air-blast |
| **`SickAFX_Enc1_xyz`** | SICK absolute encoder | `AFM60A-Eth/IP` (vendor 808) | 192.168.1.25 | Outfeed/stack index X-position; read via **explicit MSG** (`SICK_AFX60..._AOI`, get/set data) |

> `Slab_1_M580` / `SLAB_1` (Schneider M580 CIP bridge, 172.17.64.178) exists on the controller **but is not referenced by the `KUKA_ROBOT` program** — it belongs to the strapping side. Excluded.

### 6.2 Robot handshake interface (`KUKA_ROBOT.In` / `.Out`, UDT_IO_KUKA_ROBOT_*_V2)

The richest connector — a program-number (PGNO) style interface. Key signals:

**Robot → PLC (`.In`):** `RC_RDY1` (ready to start), `ALARM_STOP`, `USER_SAF`, `PERI_RDY` (drives on), `ROB_CAL` (mastered), `I_O_ACTCONF` (external iface active), `STOPMESS` (needs ack), `PRO_ACT` (cell prog running), `PGNO_REQ` (requesting program #), `APPL_RUN`, `IN_HOME`, `ROB_STOPPED`, `T1/T2/AUT/EXT` (mode), `GRIPPER_x_OPN/CLS_OP` (gripper open/close ops), `PGNO_FBIT_REFL` (last program reflected), stack layer reflections (`R_PRIMSTCK_CUR_LAYERS`, `R_BKUPSTCK1/2_*`), makeup qty reflections (`R_MKUP_TBL_TOP/MID/BTM_CUR_QTY`), `R_GOOD_DISC_CUR_QTY`, `CONVEYOR_INT`/`CONVEYOR_SIGNAL_REQ` (ConveyTech), `WAFER_DETECTED`, `RobotStartedScan`/`RobotEndedScan`.

**PLC → Robot (`.Out`):** `EXT_START`, `DRIVES_ON`/`DRIVES_OFF`, `MOVE_ENABLE`, `CONF_MESS` (ack), `PGNO` + `PGNO_VALID` (task select), `PRIMSTCK/BKUPSTCK1/2_ENABLE`, per-position `INFEED_INGOT_x_TYPE` (1=Foot,2=Std,3=Top,5=unknown), `LASER_A/B/C/D_VAL`, gripper reed-switch feedback echoes, makeup table type/qty setpoints, height limits (`FRM_PLC_FOOT/STD/TOP_MIN/MAX_HEIGHT`, `WAF_HEIGHT`), `RESET_BIN_COUNT`, `GOOD_DISCARD_BIN_MAX`/`ENABLED`, `IngotScanEnable`.

### 6.3 Data connectors (controller-scoped tags)

| Tag | Type | Connector to | Notes |
|---|---|---|---|
| **`TOP`** | `BASE` (`CTRL`+`HMI`) | Line/supervisory control | PackML-style command/status. `TOP.CTRL` is the live model; `TOP.HMI` is copied out for the HMI each scan. |
| **`KUKA_HMI`** | `HMI_DATA` ("UDT HMI to/from PLC") | Operator HMI | Task-execute buttons (`IN_TASK_1..8_EXE`), start/stop/reset, makeup enable/fill, bin enable/reset, height setpoints, status out (makeup qty, bin counter, chain height, maintenance status). |
| **`STACKS`** (`STACK[1..3]`) | `STACKS`/`STACK_CONTROL` | Shared with stack sequences (InOut) | Per-stack: `Active`, `CurrentLayer`/`NextLayer`/`Required_Layers`, counts (feet/regular/top), `Complete`, `StackOffConeyor`, `X_Pos_Initial`/`X_Position_Act`. |
| **`MAKEUP_TABLE`** | `MAKEUP_TABLE` | Makeup sequences | `Active`/`Enabled`/`Option`, required feet/regular per option. |
| **`ROBOT_VAR`** | `KUKA_VAR` | Robot task parameters | `Pick_Qty`, `Type_Of_Ingot`, `Active_Stack`, `Stack_Height`, `Gripper1..4_Activate`. |

### 6.4 Internal handshake (not external, noted to avoid confusion)

`CONVE_INT` signals (`in_Healthy_CONVE_INT`, `Output_CONVE_INT`, `Step/Action_CONVE_INT`) in `R305` are **program-local** tags; the actual downstream conveyor exchange happens **through the robot** (`KUKA_ROBOT.In.CONVEYOR_*`), i.e. the robot mediates the ConveyTech handshake rather than a direct PLC-to-PLC link.

---

## 7. Operating Sequences (per EM, from step/action FBs)

Each stacking EM runs a **step→action** state machine (`*_SAS` instance + `*_SECTION.ACTIONS.n`). Common action semantics (from `FOOT_SECTION` rung comments):

| Action bit | Meaning |
|---|---|
| ACTIONS.2 | Run Task 1 (move to pick) |
| ACTIONS.3 | Run Task 0 (idle) |
| ACTIONS.4 | Send robot data / update CurrentLayer |
| ACTIONS.5 | Run Task 5 |
| ACTIONS.6 | Update picked-ingot count / advance NextLayer |
| ACTIONS.7 | Update layers & quantities / trigger queue delete + layer-complete |
| ACTIONS.11 | Run Task 2 (stack with table) |
| ACTIONS.20 | Run Task 3 |
| ACTIONS.26 | Run Task 4 |

**Typical Foot-layer cycle:** queue full (4 ingots detected) → `Task_Request:=1` → robot moves to pick → grippers activated per `LOCn_PICK` → robot stacks → ACTIONS.7 marks `FootLayerComplete`, deletes picked ingots from queue, advances `NextLayer` → active-stack rotates when `CurrentLayer ≥ 10` (`Complete`).

**Stack completion → outfeed:** stack `Complete` (≥10 layers) → `StackOffConeyor` → `R301` shifts `STACK[2]→[1]`, `[3]→[2]` (rotate backups forward) → ConveyTech handshake (`R305`, Task 6) releases to strapper → encoder tracks X-position during index.

---

## 8. Open Questions / To Confirm (before this FDS is build-ready)

1. **Robot motion detail** — Tasks 3/4 exact behaviour lives in the KUKA `.src`; PLC only dispatches PGNO. **[ASSUMPTION]** on their meaning.
2. **Layer recipe** — max layers read as 9–10 and makeup options 1/2 have fixed required feet/regular (11/3 and 4/10). Confirm these are product-configurable, not constants.
3. **Flip / turn-over logic** — the infeed flipper path (`INFEED_KUKA_Turn_Over_Flipper` after 36 tracked / every 4 tops) looks heuristic; confirm intended rule.
4. **Safety** — F.30/F.31 e-stop mapping is via standard DI + sensor 23; the actual safety controller/GuardLogix scope isn't in this program. Safety FDS is separate.
5. **Simulation tags** (`Simulation[2..20]`) are wired into detection/queue — confirm they're commissioning-only and masked in production.

---

## 9. Second-Pass Addendum (full re-read incl. AOI internals — corrections & new findings)

**Corrections to the sections above:**

1. **Classification actually happens at the infeed ENTRY, not the pickup positions.** `R201` insert logic: entry **top sensor only** ⇒ Standard (2); **top + lower** ⇒ Foot (1); flip-active ⇒ Flip/Top-candidate (3). The type rides the FIFO queue to each position. The per-position sensors (SEN13–20) feed `FB_INGOT_DETECTION` as a **verification layer** — the AOI compares physical profile vs queued type and raises `QueueError` on mismatch.
2. **That verification layer is currently bypassed:** `EnableDetectionSensors` (controller tag) gates all four position-sensor paths, is **never written by logic, and is saved = 0 in this export**. If 0 at runtime, `TypeDetected` is forced 0 and the queue-full auto-pick could never trigger — so the **live controller almost certainly has it set 1 online**. ⚠️ Confirm the live value; the saved file does not represent runtime here.
3. **`Slab_1_M580` is NOT fully out of scope** (correcting §6.1): `A_PLC_COMMS` (OLD_Strapping_Machine) COPs `Slab_1_M580:I.Data → N20[20..39]`, and `N20[20].10 → Turn_Over_Flipper` — an external flip command from the Slab 1 M580 PLC into this cell's infeed. **However** that external branch is gated `XIC(INFEED_KUKA_TurnOverControl_Off)` (never written, =0) ⇒ **currently dead**. The live flip driver is internal: every **36 tracked ingots** ⇒ latch flip request, unlatch after **4 tops** banked.
4. **`STACK[3]` is half-disabled in live code:** its `Enabled` rung is gated `XIC(Always_Off)` (R302) and `Complete` is only computed for stacks 1–2 (R203). Effectively a 2-stack + makeup operation with stack-3 residue.
5. **Stop-rung branches neutralized by `Always_Off`:** the encoder-fault (F.5) and `WAFER_DETECTED` branches of `TOP.CTRL.Stop_Request` are dead — wafer handling instead zeroes `Task_Request` (R004) and blocks the executor trigger (R204).

**Newly documented live logic (was unread):**

6. **R004 tail:** wafer handshake (`WAFER_DETECTED` → HMI, `IN_WAFER_CLEARED` → `Out.WAFER_CLEARED`), per-gripper ingot heights → HMI, robot `PLC_ErrorCode`/`PLC_RobotMsgCode` → HMI, makeup top/mid **types from HMI** (overriding the earlier hardcoded MOV 3/2/1 rungs — duplicate-write smell), stack heights/layers → HMI mirrors.
7. **`FB_EXECUTE_R_STEPS_ACTIONS` is a 10-step dispatch machine** (0 stop → 1 wait-trigger → 2 robot-OK → 3 task-selected → 4 send-PGNO → 5 executing → 6 update-delay → 7 robot-OK-recheck → loop; 8 retry w/ counter+SP; 9 faulted). It owns a **second fault word: `TOP.CTRL.Fault[10].F.1–F.7`** (sequence timeouts, retry-exhausted, robot-not-OK) — add these to the alarm list.
8. **`FB_FOOT/REG` internals:** sequence on task *completion* (via `LAST_ROBOT_TASK` reflection); per-stack "layer-0 required" checks; makeup activation when no feet required; gripper-laser min/max calc present but the height check is commented **"(Future)"** — stubbed.
9. **`TEST_INGUTS`** (AFI'd ST routine) is the **prototype of the laser top-detection** now productionized as `FB_IngotDetect_Scan`: buffer the scan trace; counts >210 ⇒ Top, 180–210 ⇒ Standard; `GRIPPER_SLOT` 1=Top 2=Std; sets `IngutTypeDefined` handshake.

**Vestigial inputs (read by live code but frozen — safe to delete in rewrite):**

| Tag | Frozen value | Effect |
|---|---|---|
| `Robot_IN_Task_completed` / `Robot_IN_Current_Task` | 0 | FOOT/REG FB inputs `ROBOT_TASK_COMPLETE`/`CURRENT_ROBOT_TASK` are constant-0 (FBs sequence on `LAST_ROBot_TASK` instead) |
| `LOGIC_TEMP[1]`, `LOGIC_TEMP[6]` | 0 | `[6]` ⇒ executor `IN_SensorTrigger` permanently off (trigger is `IN_ExecuteSeqTrigger` only) |
| `INFEED_KUKA_TurnOverControl_Off` | 0 | kills the external (Slab1) flip branch; enables the internal auto-flip branch |
| `in_Healthy_CONVE_INT` | 0 | ConveyTech "healthy" never true; `XIO(Healthy)` guards always pass |
| `Ingot_Dropped` | only ever unlatched | set path not found in PLC logic (robot UDT has a dropped bit in the V1 UDT only) |

**Latent quirk:** executor Step 7's fault branch is `XIC(IN_Robot_OK) XIO(IN_Robot_OK)` — contradictory, can never fire. Step 7 can only loop back healthy; a robot-not-OK at that point hangs until a timeout elsewhere.
