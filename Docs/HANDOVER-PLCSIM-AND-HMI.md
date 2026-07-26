# Handover — PLCSIM run loop + generated commissioning HMI (2026-07-26)

**Branch:** `master`, everything **pushed** (`96ce0bb`). **Bridge:** v1.9.0.
**Supersedes** `HANDOVER-IO-ADDRESSING.md` — that work (G0-18) is Done and FAT'd.

Written for pickup on a **different PC**, so read the setup section before anything else:
most of what bit us this session was environment, not code.

---

## The headline

The pipeline now produces a program that **compiles, downloads and runs** on a spec nobody
hand-tuned — but the machine **does not sequence**, because the EM step bodies are
deliberate AI-fill stubs. Structurally complete, behaviourally empty.

| Step | State |
|---|---|
| FDS → SCL codegen | ✅ 28 blocks, 4 UDTs, 2 tag tables |
| Import into TIA | ✅ foldered, tag table created |
| Compile | ✅ 0 errors, simulation support enabled |
| Download to PLCSIM | ⚠️ works **manually from the TIA UI**; Openness-automated still fails |
| Reach RUN | ✅ virtual S7-1511 runs and holds |
| Live tag read/write | ✅ symbolic, round-trips |
| **Sequence** | ❌ `EM_*_DB.state` never leaves 0 — step bodies are stubs |

---

## Start here — two things, in this order

### 1. `DownloadOptions.Hardware` (one line, top suspect for G9-W10)

`TiaPortalService.cs` passes `DownloadOptions.Software` only. A freshly registered PLCSIM
instance has **no hardware configuration**, so TIA has no module to connect to — which is
exactly what `"Connect to module PLC_1 failed."` says. Kasper's successful manual download
from the TIA UI would have sent **hardware + software**. That difference is the whole
remaining delta. Try `DownloadOptions.Hardware | DownloadOptions.Software`.

### 2. Fill the EM step bodies, then re-run the command test

The command seam is proven working end to end (see below), so once the stubs are filled this
test is cheap: re-send to TIA → download → Sequences tab → Enable, Clear, Reset, Start →
watch `EM_*_DB.state` move. Right now it cannot move; there is no logic behind the seam.

---

## New-PC setup (machine-specific — this is where the traps are)

| Requirement | Note |
|---|---|
| TIA Portal **V20** | Openness DLL path is hardcoded in `PacForgeBridge.csproj` |
| Windows group **`Siemens TIA Openness`** | user must be a member or every connect fails |
| **S7-PLCSIM Advanced** | see the two traps below |
| .NET Framework **4.8** SDK | bridge target |
| Node + `npm i` | app |
| `npx supabase link` | the DB is remote; nothing runs offline |

**Trap 1 — the PLCSIM API HintPath is machine-specific.** `PacForgeBridge.csproj` pins:

```
C:\Program Files (x86)\Common Files\Siemens\PLCSIMADV\API\7.0\Siemens.Simatic.Simulation.Runtime.Api.x64.dll
```

That folder holds `3.0 … 7.0` on this PC. **If the new PC has a different PLCSIM Advanced
version, edit the HintPath and rebuild** — there is no binding redirect. (Previously bit us
6.0 → 7.0, bridge v1.4.2.)

**Trap 2 — the PLCSIM Advanced Runtime Manager must be RUNNING.** Start the PLCSIM Advanced
Control Panel *before* using any `/tia/plcsim/*` endpoint. See G9-W12: the bridge currently
reports `success: true, has_instance: true` when no runtime exists at all. That false health
check cost this session five debugging cycles down entirely the wrong layer. **Ground truth
is the process list** — a real instance shows `Siemens.Simatic.Simulation.Runtime.Instance.x64`
alongside `…Runtime.Manager`. If those are absent, nothing is running no matter what the
bridge says.

**The TIA project is NOT in git.** It lives at `C:\TIA Projects\RAND-MRWS3APP_2\`. On a new PC,
regenerate it from the app (Code Builder → fresh project build); that path is automated and FAT'd.

### Ports

| Port | What |
|---|---|
| 5102 | bridge (V20) — the app talks to this |
| 5103 | V18 twin, started by `npm run dev`. Harmless, ignore |
| 5173 | Vite dev server |
| 8099 | generated commissioning dashboard (`node server.mjs` in the bundle) |

---

## What shipped (10 commits, all pushed)

| Commit | What |
|---|---|
| `c8731c4` `dc26894` | G0-18 design + plan |
| `1d739b1` `703296b` `a0b4558` | collector, appliers, round-trip test |
| `f25f454` `165c1c9` `576f163` | diff panel, wizard wiring, drift banner |
| `58ce776` | **bridge v1.9.0** — G9-W10 + G9-W11 fixes |
| `96ce0bb` | **commissioning dashboard** — mimic, IO page, EM command seam |

### Bridge v1.9.0
- `EnsureCpuNetworkAddress` — projects had **no subnet**; download config showed
  `Target '1 X1' → Addresses: 0, Subnets: 0`. Now created and attached, idempotently.
- Download routing searches **target → subnet → direct**; it only ever looked at the target
  interface, which never carries an address.
- **Simulation support is a PROJECT property**, `ProjectBase.IsSimulationDuringBlockCompilationEnabled`
  — not a device attribute. The old three-way `SetAttribute` cascade threw on all three on V20.
  Now surfaced on `DownloadResultDto.SimulationSupportEnabled`, because the failure used to be a
  console line only and a non-simulatable compile still reported Success/0 errors.

### Commissioning dashboard (`Code Builder → Generate & Download`)
Portable bundle, ships its own `server.mjs`, polls the bridge. Pages: Overview / Devices /
IO / Sequences / Alarms.
- **Schematic mimic** (`mimic.js`) — each control module as its own symbol keyed off
  `control_module_class`; motors as ISA circles, valves as bowties, hoppers, filters,
  conveyors, instruments as ISA bubbles on lead lines showing live readings. Layout is
  **derived** from the ISA-88 hierarchy (units → lanes, EMs → process stages) because the FDS
  carries no geometry. Colour: running / starting / stopped / faulted.
- **IO page** — DI/DO/AI/AO with the absolute address beside the live value, plus a state pill.
  Doubles as the commissioning check that spec addressing matches the plugged cards.
- **EM command seam** — full PackML controls writing the generated `<EM>_CMD` DB.
- **Sim engine** — drives feedbacks from the emitted `simRules`. Bridge transport only.

---

## Facts learned the hard way

- **`RegisterInstance` + `PowerOn` both return OK against an absent PLCSIM runtime.** Every
  layer said "fine" while there was no virtual PLC. Check the process list first. (G9-W12)
- **Killing the bridge while an instance is registered** makes the next `RegisterInstance`
  return `LicenseNotFound (-30)`. It is **not** a licence problem — a clean bridge restart
  clears it.
- **Every bridge rebuild throws `Connection to TiaPortal failed.` on first attach.** A second
  bridge restart clears it; no whitelist prompt appeared in practice.
- **Two files independently deciding the same signal's data type is a silent bug factory.**
  `dashboard-model` mapped AI/AO → `Real` while `deriveIoTags` created them as `Int`; every
  analog read failed and displayed `—` on every project. Both now use the exported
  `PLC_TAG_DATA_TYPE`. `EM_CMD_PINS` is exported for the same reason.
- **Build `PacForgeBridge.csproj`, never the solution** — the solution also builds the V18 twin
  whose exe is usually running and locked. Stop the bridge before rebuilding; the C# compiles
  fine even when the exe copy fails, so a lock error does not mean a code error.
- **`npm run lint` is not clean at baseline** — 455 pre-existing problems (259 errors). The bar
  is "no new problems", not zero.
- **`git add -A` will sweep in `Projects/`** (untracked customer PDFs). Stage by explicit path.
  Consider gitignoring it.

---

## Test fixtures

| | |
|---|---|
| Spec | `RAND-MRWS3APP` — `5ac7b9c5-65b3-4cf0-91f4-926c2af70adf` |
| Project | Sun Metals Z20 — `def9fef9-b8da-43a1-8519-8abcbc22618e` |
| TIA project | `C:\TIA Projects\RAND-MRWS3APP_2\RAND-MRWS3APP_2.ap20` |
| Hardware | CPU 1511-1 PN `6ES7 511-1AK00-0AB0` V1.8 · slot 2 DQ16 · slot 3 AI8 · slot 4 DI16 |
| IO | 11 DI, 4 DO, 7 AI = 22 · DI `%I16.0–%I17.2` · DO `%Q0.0–%Q0.3` · AI `%IW0–%IW12` |

Note the earlier handover predicted **14** re-addressing moves; the correct answer is **20**
(hand-verified). It assumed the six DI already at `%I16.x` would stay put, but positional
assignment pushes them down five channels.

---

## Monday — board "Forja" `5099871231`

| Item | ID | State |
|---|---|---|
| G0-18 IO addressing | `3112412991` | ✅ **Done**, FAT'd |
| G0-19 post-confirm re-addressing | `3112947454` | Backlog (deferred by design) |
| G9-W10 Openness download connect | `3114609738` | Working on it — 2 defects fixed, connect still fails |
| G9-W11 sim flag on V20 | `3114575147` | Awaiting Testing — fixed, verified live |
| G9-W12 lying PLCSIM health check | `3114669780` | Needs design — **P0, small, high value** |
| G9-1 end-to-end | `3056349058` | Updated with the honest chain status |

---

## Verification at handover

- `npx tsc -b` clean.
- `npx vitest run src/lib/spec-builder src/components/spec-builder` — **103 files / 858 tests pass**.
- Dashboard suites: 46 tests (mimic layout/symbols, sim engine, device status, transport).
- Known-failing baseline: 33 in quote/variation/issue suites, unrelated and pre-existing.
- ESLint clean on every file touched.
- Bridge builds 0 errors (4 pre-existing NU1603 NuGet warnings).

**Left running on the old PC** (irrelevant on the new one, kill if you return to it): bridge
v1.9.0 on 5102, Vite on 5173, dashboard server on 8099, PLCSIM instance `PLC_1`.
