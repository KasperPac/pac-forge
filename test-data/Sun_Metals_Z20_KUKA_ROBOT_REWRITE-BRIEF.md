# Rewrite Brief — Sun Metals Z20 KUKA Robot Cell

> **Purpose:** define the **clean target design** for the rewrite. The existing code is not to be ported — it is to be re-implemented against this brief.
> **Companion docs:** `Sun_Metals_Z20_KUKA_ROBOT_FDS.md` (as-is reverse-engineering) and `Sun_Metals_Z20_KUKA_ROBOT.spec-v2.json` (structured contract).

---

## 1. Why the existing code is messy (history)

The cell was **originally written PLC-as-master** (the PLC counted layers, tracked stacks, indexed positions, and dispatched robot tasks). Mid-life, the control philosophy **switched to robot-as-master** — but the customer did not want a rewrite, so the old PLC-master logic was **frozen in place with `AFI()` (Always-False Instruction) and `Always_Off`** rather than removed. Years of incremental change-on-change were then layered on top.

The result is a program where the *structure* implies one architecture and the *live rungs* implement another. The rewrite's job is to **implement robot-as-master cleanly from scratch**, discarding the frozen PLC-master fossils.

---

## 2. The governing principle — master / slave split

| Function | Owner (target) | Notes |
|---|---|---|
| Robot motion & placement | **Robot** | — |
| Layer & stack **counting** | **Robot** | PLC mirrors `R_*_CUR_LAYERS` in for HMI display only |
| Stack **indexing / positioning** | **Robot** | Encoder-based, robot-side. **The SICK encoder is out of PLC scope entirely.** |
| Ingot **classification** (foot/standard/top) | **PLC** | Foot/standard via **infeed sensors**, top via **laser pattern**; PLC sends the resulting **type** to the robot (see §3.3) |
| Infeed **queue** (FIFO, order, delete-on-pick) | **PLC** | — |
| **Active-stack selection** (which stack to build) | **PLC** | PLC still tells the robot which stack via `PRIMSTCK/BKUPSTCK1/2_ENABLE` |
| **Automatic** pick request (queue full → pick) | **PLC** | The single auto task (Task 1) |
| **Manual** robot tasks | **Operator (HMI) → Robot** | PLC only passes the request through — no PLC logic |
| Gripper / pneumatics | **PLC** | Solenoids via valve manifold, per robot open/close ops |
| ConveyTech release handshake | **PLC** | — |
| System mode / state / fault | **PLC** | — |

---

## 3. Target PLC architecture

Six functional blocks. Everything the robot owns is **out of PLC scope** except the interface signals.

### 3.1 IO & Devices (basic control)
Device FBs over the two Balluff IO-Link masters, the SMC valve manifold, and the direct points:
- 4 laser height scanners (AI) · gripper reed-switch feedbacks · conveyor pos1–4 top/foot detection · infeed top/lower · safety input.
- 4 gripper solenoids + air-blast (DO) via the manifold.
- Pushbuttons: **E-Stop, Start, Stop only** — *PB4 is not used; drop it.*
- Network devices: KUKA robot (EtherNet/IP), 2× IO-Link master, valve manifold. **The SICK encoder is removed — now out of PLC scope.**

### 3.2 System / Mode / Fault
- PackML-style mode/state engine: Auto / Manual (+ Maintenance), Start/Stop/Pause/Reset/Robot-Enable, a single `SYS_Status` word.
- 14-word fault table; E-Stop = major (forces safe), device/comms faults = minor (latch → reset).
- This is the unit-level coordinator.

### 3.3 Infeed Queue & Classification  ← **top detection lives here**
Classification is a **PLC responsibility**; the resulting **type** is sent to the robot, which places accordingly. The three types are detected two different ways:
- **Foot vs Standard (Regular)** — detected by the **infeed sensors** (`FB_INGOT_DETECTION` on the top/foot detection sensors). Foot and Regular are genuinely different ingots, so the PLC must resolve which one and hand the **type** to the robot.
- **Top** — a **laser-pattern** outcome: the laser-scan FB matches the measured profile against an expected pattern; a match ⇒ type = **Top**. There is **no** PLC top-stacking step-machine.
- Maintain the FIFO `INFEED_Queue` (insert on detect, delete on pick) + turn-over flipper for reorientation.
- **Output:** per-position ingot **type** (foot / standard / top) to the robot. The robot owns placement — the PLC never decides *where* on the stack.

### 3.4 Robot Interface & Task Executor  ← **the critical seam**
- **PGNO handshake** (request/valid/complete) over EtherNet/IP — the whole robot conversation.
- **Automatic path:** when the infeed queue is full → request **Task 1** (pick). This is the *only* PLC-initiated task.
- **Manual path:** operator presses an HMI task button (`IN_TASK_n_EXE`) → PLC passes it straight through as the robot program number. **Tasks 2–7 carry no PLC logic** — they are operator-run robot programs (maintenance move, table stack, etc.).
- **Active-stack selection:** PLC asserts `PRIMSTCK_ENABLE` / `BKUPSTCK1_ENABLE` / `BKUPSTCK2_ENABLE` to tell the robot which stack to build.
- **Mirror-in:** copy robot-reported layer/stack/makeup counts to HMI tags (display only — not used for control).
- Map robot gripper open/close ops to the solenoid FBs; echo gripper feedback back.

### 3.5 Gripper & Pneumatics
- 4 gripper double-solenoids (extend/retract + reed feedback) + laser air-blast, following the robot's gripper ops in Auto and HMI jog in Manual.

### 3.6 ConveyTech Interface
- Step handshake releasing a completed stack to the downstream conveyor/strapper (robot Task 6 mediated).

---

## 4. DROP list — frozen/dead logic that must NOT be carried into the rewrite

| Item | Where (as-is) | Why it's dead |
|---|---|---|
| PLC stack counting, active-stack **rotation**, encoder **index tracking** | `R301_STACKS_MGMT` (JSR is `AFI()`'d) | Robot owns counting + indexing now |
| Top-ingot **step-machine** | `R304_TOP_INGOTS` (FB call `AFI()`'d) | Top is a classification result + robot task |
| Auto task **dispatch** for tasks 2/3/4/5/7 | `R401_ROBOT_ACTIONS` (all `MOV(n,Task_Request)` `AFI()`'d) | Those are manual HMI tasks |
| Layer-advance / picked-count rungs | `R302`/`R303` (`ACTIONS.4/6` rungs `AFI()`'d) | Robot reports layers |
| Duplicate robot-AOI call | `R000_DEVICES` (`Always_Off`) | Real call is R004 |
| Empty section stubs | `R100_SYS`, `R200_SEQUENCES_LOGIC` | No content |
| Simulation overrides | `Simulation[2..20]` OR'd into R201/R203 | Commissioning only — must be removed for production |
| Debug scaffolding | `CESAR`, `CESAR_TEST`, `TestBit`, `TEST_INGUTS` | Left-over test tags/routines |
| Pushbutton 4 | `FB_DI_PushButtonData[4]` | Not used |
| **SICK encoder** — device, `F0.5` fault, and the `Sick…Enc1_GetSet` routine | modules + `R102` + get/set routine | **Out of PLC scope** — indexing is entirely robot-side |
| Redundant mapping | repeated makeup-qty MOVs in `R004` | Copy-paste residue |

---

## 5. Resolved decisions (confirmed with the customer)

1. **Foot vs Regular are different ingots.** The PLC detects which via the **infeed sensors** and sends the **type** to the robot; the robot handles the differentiated placement. So the PLC side is *classify + send type*, not two bespoke placement sequences (see §3.3).
2. **SICK encoder is out of PLC scope.** Stack indexing/positioning is entirely robot-side — the encoder, its `F0.5` fault, and the get/set routine all leave the PLC design (see DROP list).
3. **Tasks 3 & 4** — labelled generically as **Task 3 / Task 4** for now (manual, operator-initiated). Their exact robot-program semantics live in the KUKA `.src` and can be named later without affecting the PLC design.

---

## 6. Second-pass findings that shape the design (full re-read incl. AOI internals)

**Refinements to the target design:**

- **§3.3 classification, precisely:** the **infeed entry pair** classifies (top-only ⇒ Standard, top+lower ⇒ Foot, flip ⇒ Top-candidate); the type rides the FIFO queue. The **per-position sensors are a verification layer** (`FB_INGOT_DETECTION` compares physical vs queued type ⇒ `QueueError`). **DECIDED: the verification layer is live production logic — keep it.** The saved-0 `EnableDetectionSensors` in this export is a **temporary test inhibit** (holds detection off so the robot can't auto-start during on-machine testing) and **will be removed before the code ships to site**.
  - **Rewrite recommendation:** don't reproduce the remove-before-site tag. Replace it with an engineered equivalent — a proper commissioning/dry-run inhibit tied to the mode manager (e.g. only effective outside Automatic, visible on the HMI, alarmed while active) — so the same test capability exists without a hidden tag whose removal is a manual pre-shipment step.
- **Turn-over flip:** live rule is internal — **every 36 tracked ingots latch a flip request; unlatch after 4 tops banked**. An external flip command exists from the **Slab 1 M580 PLC** (`N20[20].10 → Turn_Over_Flipper`) but is gated off. **DECIDED: delete the Slab1 coupling** — not needed anymore. The internal auto-flip rule is the only flip driver in the rewrite; the `N20`/M580 flip path (and `Turn_Over_Flipper` tag) go on the DROP list.
- **Task-sequence supervision must be carried over:** the executor FB is a 10-step dispatch machine with per-step timeouts, a retry counter, and its own fault word (`Fault[10].F.1–7`). The rewrite keeps this supervision (it is the only PLC-side watchdog on the robot conversation). Fix the latent bug: step 7's robot-not-OK branch is a contradiction (`XIC(x)XIO(x)`) and can never fault.
- **Wafer handling is a live requirement:** `WAFER_DETECTED` zeroes the task request and blocks the executor; operator clears via HMI (`IN_WAFER_CLEARED → Out.WAFER_CLEARED`). Include as a hold/permissive in the robot-interface EM.
- **Stacks:** live code effectively runs **2 stacks + makeup** (stack 3's enable is `Always_Off`-gated and its `Complete` is never computed). **DECIDED: stack 3 is real scope — keep it.** The rewrite must treat all three stacks symmetrically: implement stack 3's enable and `Complete` evaluation (missing in the as-is), so selection rotates primary → backup 1 → backup 2 → makeup uniformly.
- **Height verification** inputs (per-gripper laser vs setpoint/tolerance) are wired into the pick FBs but the check is commented "(Future)" — stubbed. **DECIDED: implement it.** Per-gripper laser height vs `SP_INGOT_HEIGHT ± SP_INGOT_TOL` (as-is setpoints: foot 260, regular 250, top 280, tol 100) becomes a real pick-validation step with a defined failure action (to be specified: reject/alarm/re-scan).

**Additional DROP-list entries (frozen-tag deadwood, no `AFI()` involved):**

| Item | Mechanism |
|---|---|
| `Robot_IN_Task_completed`, `Robot_IN_Current_Task` | never written ⇒ constant-0 FB inputs |
| `LOGIC_TEMP[]` (incl. executor `IN_SensorTrigger` path) | never written ⇒ frozen 0 |
| `INFEED_KUKA_TurnOverControl_Off` external-flip gate | never written ⇒ external branch dead |
| **Slab 1 M580 flip coupling** — `N20[20].10 → Turn_Over_Flipper` path + tag | **customer-confirmed: no longer needed** |
| `in_Healthy_CONVE_INT` | never written ⇒ "healthy" never true |
| `Ingot_Dropped` | only ever unlatched |
| Stop-rung `Always_Off` branches (encoder fault F.5, wafer) | neutralized in place |
| Duplicate makeup-type writes in R004 (hardcoded MOVs later overwritten from HMI) | copy-paste residue |

## 7. Rewrite acceptance shape

The rewritten program should read as robot-as-master end-to-end: **IO → System/Mode/Fault → Infeed-Queue-&-Classification → Robot-Interface (auto Task 1 + manual pass-through + stack select + handshake) → Gripper → ConveyTech.** No `AFI()`/`Always_Off` frozen rungs, no simulation bits, no debug tags, one clear owner for every responsibility.
