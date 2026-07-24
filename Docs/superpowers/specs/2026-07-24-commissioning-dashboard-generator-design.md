# Design — Commissioning Dashboard Generator (FDS → portable web HMI)

**Date:** 2026-07-24
**Status:** Design approved (brainstorm); pending spec review → implementation plan
**Home module:** Code Builder (`components/code-builder/`) — NOT the Forge wizard (being phased out)
**Quality bar:** `exports/SRL-1427-500802-PACKML/commissioning-hmi/plc-dash/` (reference, not to reproduce verbatim)

---

## 1. Purpose

Pac-Forge generates, deterministically from the FDS, a **portable standalone web dashboard** that serves as an **interim / commissioning operator HMI** for any new project — usable the moment the generated PLC code runs on a PLCSIM Advanced sim, long before (and independent of) the WinCC Unified HMI.

Two operating roles from one generated bundle:
- **Interim sim testing (dev):** drive and observe the generated program running on the sim, with a per-device simulation layer so the plant can be "run" from the dashboard and faults injected.
- **Commissioning (site):** the same bundle, pointed at a real PLC's Web API, as a portable operator HMI during commissioning before the WinCC HMI ships.

This is **not** a replacement for the WinCC Unified operator HMI that ships to the customer. It is a cheaper, faster, TIA-download-free operator surface for development and commissioning. The automated PLCSIM test loop (`use-plcsim-runner.ts`) already proves "the code runs" headless; this dashboard adds **human-in-the-loop** verification plus a reusable commissioning tool.

### Non-goals (explicit cuts)
- No graphical plant mimic **generation** in v1 (see §6 mimic slot).
- No analog **ramping** of simulated feedbacks in v1 (numeric feedbacks are set to a target value, not eased). Later enhancement.
- No AI in the generation hot path (deterministic only).
- Does not replace WinCC Unified HMI generation.

---

## 2. Core principle — fixed runtime, generated data

**The runtime library is identical for every project; only the data is generated.** Every bundle ships the same transport layer, sim engine, and UI renderer, parameterised solely by one generated data file (`dash-model.js`).

Consequences:
- The generator's only job is to emit a correct **data model**, so it can be deterministic and fully unit-testable with golden fixtures.
- A runtime bug-fix improves every dashboard ever generated (no per-project regeneration of logic).
- The runtime libraries are independently unit-testable with mocked transports.

---

## 3. Architecture & components

### 3.1 Pure builder modules (no React, no IO — same discipline as `compile-contract.ts`)
- `src/lib/spec-builder/dashboard/dashboard-model.ts` — `buildDashboardModel(forgeModel) → DashboardModel`. Projects the existing reconciled contract into a UI-oriented data model.
- `src/lib/spec-builder/dashboard/dashboard-emit.ts` — `emitDashboard(model) → Map<path, contents>`. Serialises the model to `dash-model.js`, assembles the full bundle file map (generated + static runtime), and generates `README.md`.
- `src/types/commissioning-dashboard.ts` — `DashboardModel` and sub-types.

### 3.2 Fixed runtime library (static template assets, copied verbatim into every bundle)
Location: `src/lib/spec-builder/dashboard/runtime/`
- `plc-transport.js` — dual adapter (bridge + Web API) behind a common interface.
- `sim-engine.js` — per-device simulation + fault injection.
- `dashboard-app.js` — renders the UI from `dash-model.js`.
- `index.html`, `styles.css` — static shell.
- `server.mjs` — tiny local static server (matches the reference bundle; dependency-free).

### 3.3 Hook + UI
- `src/hooks/use-generate-dashboard.ts` — triggers build + emit, packages output.
- Code Builder panel "Commissioning Dashboard" (next to the existing HMI build panel).

### 3.4 Bundle layout (mirrors `exports/plc-dash`)
```
commissioning-hmi/
  index.html          (static)
  styles.css          (static)
  dash-model.js       (GENERATED — the only per-project logic-bearing file)
  plc-transport.js    (static runtime)
  sim-engine.js       (static runtime)
  dashboard-app.js    (static runtime)
  server.mjs          (static — local serving)
  README.md           (GENERATED — project-specific run instructions)
```

### 3.5 Output form
- **Primary:** downloadable zip via `jszip` (already a dependency) — portable, runs at site with no build step, PLC-hostable later.
- **Optional (dev convenience):** "write to `exports/<project>/commissioning-hmi/` via the bridge."

---

## 4. The generated data model (`DashboardModel`)

Derived entirely from structures the app already builds — no new authoring, no AI. The builder reads the **same reconciled contract the Code Builder compiles from**, so a dashboard is only generated for a spec that already compiles (no separate extraction pipeline to drift out of sync).

Contents:
- **Devices** — from `ForgeControlModuleEntry` + `LinkageDevice` (resolved as `plcsim-test-instantiate.ts` does): per control module — display name, tag, `device_type`, instance DB, command pins and feedback/status signals (roles from the FB interface contract), and each physical IO tag **with explicit data type**. (Type matters: the bridge transport requires it; the Web API infers it.)
- **EMs / sequences** — from the EM registry (`buildEmUiModel` territory): per-EM state list, transitions, command pins.
- **Alarms** — from the fault/alarm spec: tag, trigger polarity (hi/lo), class, text.
- **Per-device sim models** — from per-device `IoSimulationRule`s (`instantiateSimRules`): command→feedback rules (trigger tag, response tag, delay) + which signals are fault-injectable.
- **Config / setpoints** — writable config-DB members (setpoints, presets) for the settings page.

Each tag is stored **once** as a canonical symbolic name + type; adapters format per transport (§5).

---

## 5. Dual-transport data layer

One common interface, two adapters, selected at runtime. UI and sim engine only ever talk to the interface.

**Interface:** `read(tags[]) → values[]` (batched), `write(tag, value)`, `status()`. Poll ~400–800 ms.

**Bridge adapter (sim / dev):** POSTs `localhost:5102/tia/plcsim/{read-tags,write-tag}`; sends each tag's explicit data type; unquoted names (`DB.member`, existing `stripTagQuotes` convention); no auth.

**Web API adapter (real PLC / site):** POSTs `/api/jsonrpc` — `PlcProgram.Read/Write`, `Api.Login/Logout`; quoted SCL names (`"DB"."member"`, `plcVar` convention); type inferred by firmware; session token in `localStorage` with reference session discipline (login-only-from-overlay, cooldown, drop token only on genuine auth error).

**Normalisation** (why one bundle serves both): `dash-model` stores each tag once (canonical name + type). Each adapter formats the name and decides whether to send the type. Transport difference is entirely inside the two fixed adapter files.

**Transport selection:** header toggle (Sim ↔ PLC), default from a generated config field + optional auto-hint (served same-origin from a PLC → Web API; opened locally with bridge reachable → bridge). **Sim engine enabled only in bridge/sim transport.**

**Transport-level failures never crash the poll loop:** bridge unreachable → "bridge not running / sim not started" banner; Web API token invalid → login overlay; per-tag read error → that value shows `—`, others keep updating.

---

## 6. Per-device sim engine & fault injection

Fixed runtime lib (`sim-engine.js`), parameterised by the per-device sim models. Runs **browser-side, sim transport only**. A repackaging of the existing `scheduleSimRules` engine, reorganised per device with operator controls.

**Per device:** command outputs (FB contract), feedback/status inputs, command→feedback sim rules (trigger, response, delay).

**Healthy behaviour ("AUTO", default):** engine watches each command in the poll loop; command active → start timer → after `delayMs` write feedback input active via the bridge (PLCSIM allows writing `%I` with no HW config); command clears → feedback clears. This is what stops state machines faulting on missing feedback, so the plant "runs."

**Operator drives it:** start/stop (and other command) buttons write the command source directly; live state + feedback on each device card.

**Fault injection — per-device selectable mode:**
- **Healthy** — feedback follows command (default).
- **Withhold feedback** — command active but feedback never arrives → exercises feedback-timeout fault handling.
- **Assert fault input** — force a specific fault tag (overload, thermistor, CB trip) → exercises fault reaction + alarm.

Fault-injectable signals come from the fault/alarm spec in `dash-model`. The **Sim & Faults** page is devices × fault options + a global sim arm.

**Hard safety boundary:** the engine is structurally inert unless the live transport is bridge/sim. Auto-writing feedbacks or injecting faults against a real PLC must be impossible — injection controls do not exist in PLC transport. Explicitly tested.

**v1 cut:** sim rules are trigger→response (bool, or set-a-number). Analog ramping deferred.

---

## 7. Pages

All rendered from `dash-model`, structured/functional:
- **Overview** — unit/EM state chips, active-alarm count, sim/transport status; hosts the mimic slot.
- **Devices** — per-control-module cards: command buttons, live feedback/status, per-device sim-mode selector, current state.
- **Sequences / EMs** — per-EM state machine, current state highlighted, transitions, command pins.
- **Alarms** — active + history.
- **IO** — raw DI/DO tables with live values.
- **Sim & Faults** — devices × fault-options matrix + global sim arm. *Sim transport only; absent in PLC transport.*
- **Settings** — writable config/setpoint members.

**Mimic slot:** designated region on Overview. v1 fills it with a simple auto-grid of device state tiles + a clearly-marked editable hook (`mimic.js` / commented `<div>`) for later per-project hand-dressing. Additive, never blocks generation.

---

## 8. Error handling (generation-time — never silent)
- Unresolved tags / missing types → **warnings panel** (spirit of `InstantiateResult.warnings`).
- Spec doesn't compile → generation **blocked** (reuses existing compile gate).
- Device with no sim rule → still works in healthy mode, warns feedback won't auto-fire (operator can set manually).

---

## 9. Testing (no live bridge/PLC — all mocked)
- **Deterministic builder:** golden-fixture unit tests (forge model → `DashboardModel` + file map) across **multiple machine types** (conveyor, filler, warm-up spec) to enforce genericity per CLAUDE.md "All Changes Must Be Generic."
- **Runtime libs:** transport adapters (mock `fetch`; assert bridge vs Web API name/type formatting); sim engine (command→feedback timing, three fault modes, and the sim-only safety guard).

---

## 10. Reused existing assets (nothing built from zero)
| Need | Existing asset |
|---|---|
| Device → tags/wiring/IO/instance-DB resolution | `plcsim-test-instantiate.ts` (`buildReplacementMap`, `instantiateSimRules`) |
| Per-device command→feedback sim rules | `IoSimulationRule` (`types/plcsim-test.ts`), `scheduleSimRules` (`use-plcsim-runner.ts`) |
| Bridge read/write transport | `/tia/plcsim/{read-tags,write-tag}` + `use-plcsim-runner.ts` helpers (`stripTagQuotes`) |
| Web API transport pattern | reference `plc-client.js` (`plcVar`, session discipline) |
| EM state/transition model | `buildEmUiModel` / `code-builder-em-ui-model.ts` |
| Device / linkage types | `ForgeControlModuleEntry`, `LinkageDevice` |
| Compile gate (only generate for compiling specs) | Code Builder compile path |
| Zip packaging | `jszip` (existing dependency) |

---

## 11. Open decisions deferred to implementation plan
- Exact `DashboardModel` field shapes and file-map contract.
- Whether the bridge gains a "write file to exports/" endpoint or the dev-write option reuses an existing one.
- Precise poll cadence + batching limits per transport.
- Header/nav layout specifics (visual design, not architecture).
- What a "drive command" button writes exactly — the EM command pin, a device-level command input, or both — and how that maps per `device_type`. Affects the sim engine, device cards, and the sim-only guard scope.
