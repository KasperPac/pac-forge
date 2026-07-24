# Commissioning Dashboard Generator — Plan 1 (Generator Core + Monitoring Dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From a compiling FDS, deterministically generate a portable, standalone web dashboard bundle that connects to either a PLCSIM sim (via the bridge) or a real PLC (via its Web API), shows live device/EM/alarm/IO state, and drives basic commands.

**Architecture:** A pure builder (`dashboard-model.ts`) projects the reconciled `SpecContractV2` + `CodegenResult` into a UI-oriented `DashboardModel`. A pure emitter (`dashboard-emit.ts`) serialises that model to a single `dash-model.js` and assembles a bundle alongside a *fixed* runtime library (transport adapters + renderer + static shell) that is identical for every project. A hook + Code Builder panel trigger generation and package the bundle as a downloadable zip.

**Tech Stack:** TypeScript (strict, `import type`, no enums), vitest, vanilla ES-module browser JS for the runtime (no framework, no build step at site), `jszip` (existing dep), React 19 for the panel.

**Scope boundary:** This plan delivers a *monitoring + basic-drive* dashboard. The per-device **sim engine, fault injection, and Sim & Faults page are Plan 2** — but Plan 1's builder already emits the per-device `simRules` data they will consume, so Plan 2 adds only runtime, not model rework. Runtime UI here is functional-but-minimal (tables + cards + state chips); visual polish rides with Plan 2.

## Global Constraints

- All generation logic MUST be generic across machine types — no project-specific device names, sequences, or fault conditions (CLAUDE.md "All Changes Must Be Generic"). Golden tests cover ≥2 distinct machine types.
- **Input model = the reconciled `SpecContractV2`** (via `loadSpecContract`) + `CodegenResult` (via `compileContract`) — NOT the Forge wizard's `ForgeControlModuleEntry` (being retired). Devices are nested `contract.hierarchy.units[!excluded].equipment_modules[].control_modules[]` with fields `control_module_id/_name/_class` and `io_signals[].tag/.signal_type` (`DI|DO|AI|AO|internal`). Instance DBs are `CodegenArtifact.type === "DB"` matched by `ownerId`. EM state tags use `emDbName(sclIdent(emName))` from codegen `naming.ts` so tag paths stay in lockstep with generated code.
- Deterministic only — NO AI in the generation path.
- TS strict: `import type` for type-only imports; no `enum` (use `as const` / string unions); no unused locals/params.
- Pure builder/emitter modules: no React, no IO, no `Date.now()` inside the pure functions — the timestamp/note is passed in by the caller.
- Runtime library files are byte-identical across projects; only `dash-model.js` and `README.md` are generated per project.
- Path alias `@/` maps to `src/`.
- Bridge base URL comes from `DEFAULT_BRIDGE_CONFIG.baseUrl` (`http://localhost:5102`); tag names are stripped of SCL quotes for the bridge (`stripTagQuotes` convention) and quoted for the Web API (`plcVar` convention).
- Typecheck gate: `npx tsc -b` clean. Test gate: relevant `npx vitest run <path>` green.

---

### Task 1: DashboardModel types + device derivation

**Files:**
- Create: `src/types/commissioning-dashboard.ts`
- Create: `src/lib/spec-builder/dashboard/dashboard-model.ts`
- Test: `src/lib/spec-builder/dashboard/__tests__/dashboard-model.devices.test.ts`

**Interfaces:**
- Consumes: `SpecContractV2`, `ControlModuleV2`, `SignalType` (`@/types/spec-contract-v2`), `CodegenResult`/`CodegenArtifact` (`@/lib/spec-builder/codegen/types`).
- Produces: the `DashboardModel` type and `buildDevices(contract, compile): { devices: DashDevice[]; warnings: string[] }`.

**REAL CONTRACT SHAPE (verified — do not use the Forge `ForgeControlModuleEntry` model, which is being retired):**
- Devices live at `contract.hierarchy.units[]` (skip `unit.excluded`) → `unit.equipment_modules[]` → `em.control_modules[]`.
- `ControlModuleV2` fields: `control_module_id`, `control_module_name`, `control_module_class`, `is_safety`, `description`, `io_signals: IoSignalV2[]`. There is **no** `tag`/`device_type`/`fb_template_id` on the CM.
- `IoSignalV2` fields: `tag` (the PLC symbol — NOT `tag_name`), `signal_type` (`"DI"|"DO"|"AI"|"AO"|"internal"`), `io_address`, `description`, `source`.
- Instance DBs: `CodegenArtifact.type === "DB"` (there is **no** `"instance_db"` literal); match to a CM via `artifact.ownerId === control_module_id` (often absent in the synthesize path — `instanceDb` is nullable/display-only).

- [ ] **Step 1: Write the failing test**

```ts
// dashboard-model.devices.test.ts
import { describe, it, expect } from "vitest";
import { buildDevices } from "@/lib/spec-builder/dashboard/dashboard-model";
import type { SpecContractV2 } from "@/types/spec-contract-v2";
import type { CodegenResult } from "@/lib/spec-builder/codegen/types";

// Minimal fixture in the REAL contract shape: one motor CM under a unit/EM.
const contract = {
  hierarchy: {
    units: [
      {
        unit_id: "u1", unit_name: "Line", excluded: false,
        equipment_modules: [
          {
            equipment_module_id: "em1", equipment_module_name: "Drive",
            control_modules: [
              {
                control_module_id: "cm1", control_module_name: "Conveyor Motor",
                control_module_class: "motor", is_safety: false, description: "",
                io_signals: [
                  { tag: "M01_Run", signal_type: "DO", io_address: "Q0.0", description: "Run output", source: "wired" },
                  { tag: "M01_Fbk", signal_type: "DI", io_address: "I0.0", description: "Run feedback", source: "wired" },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  equipment_modules: {}, alarms: [], faults: [], io_list: [],
} as unknown as SpecContractV2;

const compile = {
  artifacts: [
    { name: "EM_Drive_DB", type: "DB", filename: "EM_Drive_DB.db", content: "",
      dependencies: [], folder: "Devices", layer: "em", ownerId: "cm1" },
  ],
  warnings: [],
} as unknown as CodegenResult;

describe("buildDevices", () => {
  it("emits one device with typed signals, a command, and its instance DB", () => {
    const { devices, warnings } = buildDevices(contract, compile);
    expect(devices).toHaveLength(1);
    const d = devices[0];
    expect(d.name).toBe("Conveyor Motor");
    expect(d.deviceType).toBe("motor");
    expect(d.instanceDb).toBe("EM_Drive_DB");
    // DI/DO signals become live-read tags with a Bool type
    expect(d.signals.map((s) => s.id)).toContain("M01_Fbk");
    expect(d.signals.every((s) => s.type === "Bool")).toBe(true);
    // a DO signal is drivable as a momentary command
    expect(d.commands.map((c) => c.tag)).toContain("M01_Run");
    expect(warnings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/dashboard/__tests__/dashboard-model.devices.test.ts`
Expected: FAIL — `buildDevices` is not exported / module not found.

- [ ] **Step 3: Write the types**

```ts
// src/types/commissioning-dashboard.ts
export type DashTagType = "Bool" | "Int" | "DInt" | "Real" | "Word" | "Time";

export interface DashTag {
  /** canonical symbolic name, UNQUOTED, e.g. "EM_Drive_DB.state" or "M01_Fbk" */
  id: string;
  type: DashTagType;
  label: string;
}

export interface DashCommand {
  tag: string;
  type: DashTagType;
  label: string;
  /** momentary = write true then false after a short pulse; false = level toggle */
  momentary: boolean;
}

export interface DashDevice {
  id: string;
  name: string;
  tag: string;
  deviceType: string;
  instanceDb: string | null;
  signals: DashTag[];
  commands: DashCommand[];
}

export interface DashEmState { index: number; name: string; }
export interface DashEmTransition { from: string; to: string; label: string; }

export interface DashEm {
  id: string;
  name: string;
  unit: string;
  stateTag: string;
  states: DashEmState[];
  transitions: DashEmTransition[];
  commands: DashCommand[];
}

export interface DashAlarm {
  tag: string;
  /** active when tag === true ("hi") or tag === false ("lo") */
  trigger: "hi" | "lo";
  class: "Fault" | "Warning";
  text: string;
}

export interface DashSetpoint {
  tag: string;
  type: DashTagType;
  label: string;
  min: number | null;
  max: number | null;
}

/** command→feedback rule; EMITTED in Plan 1, CONSUMED by the Plan 2 sim engine */
export interface DashSimRule {
  deviceId: string;
  triggerTag: string;
  triggerValue: boolean | number;
  responseTag: string;
  responseValue: boolean | number;
  responseType: DashTagType;
  delayMs: number;
  faultInjectable: boolean;
  description: string;
}

export interface DashboardModel {
  project: { name: string; specId: string; revision: number; generatedNote: string };
  devices: DashDevice[];
  ems: DashEm[];
  alarms: DashAlarm[];
  setpoints: DashSetpoint[];
  simRules: DashSimRule[];
  /** union of every tag the poll loop must read */
  readTags: DashTag[];
  warnings: string[];
}
```

- [ ] **Step 4: Write the minimal device builder**

```ts
// src/lib/spec-builder/dashboard/dashboard-model.ts
import type { SpecContractV2, SignalType } from "@/types/spec-contract-v2";
import type { CodegenResult } from "@/lib/spec-builder/codegen/types";
import type { DashDevice, DashTag, DashCommand, DashTagType } from "@/types/commissioning-dashboard";

/** DI/DO → Bool; AI/AO → Real. ("internal" signals are skipped in Plan 1.) */
function dashType(sig: SignalType): DashTagType {
  return sig === "AI" || sig === "AO" ? "Real" : "Bool";
}

export function buildDevices(
  contract: SpecContractV2,
  compile: CodegenResult,
): { devices: DashDevice[]; warnings: string[] } {
  const warnings: string[] = [];
  // instance DBs by owning control-module id, from the compile result
  const dbByOwner = new Map<string, string>();
  for (const a of compile.artifacts) {
    if (a.type === "DB" && a.ownerId) dbByOwner.set(a.ownerId, a.name);
  }

  const devices: DashDevice[] = [];
  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;
    for (const em of unit.equipment_modules) {
      for (const cm of em.control_modules) {
        const signals: DashTag[] = [];
        const commands: DashCommand[] = [];
        for (const sig of cm.io_signals) {
          if (sig.signal_type === "internal") continue;
          signals.push({ id: sig.tag, type: dashType(sig.signal_type), label: sig.description || sig.tag });
          // Outputs (DO) are operator-drivable as momentary commands.
          if (sig.signal_type === "DO") {
            commands.push({ tag: sig.tag, type: "Bool", label: sig.description || sig.tag, momentary: true });
          }
        }
        if (signals.length === 0) warnings.push(`Device ${cm.control_module_name}: no IO signals — nothing to display`);
        devices.push({
          id: cm.control_module_id,
          name: cm.control_module_name,
          tag: cm.control_module_name, // contract CMs carry no short tag; name doubles as the label
          deviceType: cm.control_module_class,
          instanceDb: dbByOwner.get(cm.control_module_id) ?? null,
          signals,
          commands,
        });
      }
    }
  }
  return { devices, warnings };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/dashboard/__tests__/dashboard-model.devices.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/commissioning-dashboard.ts src/lib/spec-builder/dashboard/dashboard-model.ts src/lib/spec-builder/dashboard/__tests__/dashboard-model.devices.test.ts
git commit -m "feat(dashboard): DashboardModel types + device derivation (G7-9)"
```

---

### Task 2: EM derivation (states, transitions, commands)

**Files:**
- Modify: `src/lib/spec-builder/dashboard/dashboard-model.ts`
- Test: `src/lib/spec-builder/dashboard/__tests__/dashboard-model.ems.test.ts`

**Interfaces:**
- Consumes: `buildEmUiModel` (`@/lib/spec-builder/code-builder-em-ui-model`) → `{ unitGroups: {unitId,unitName,emIds:string[]}[], emById: Record<id,{emId,emName,states:EmStateV2[],transitions:EmTransitionV2[]}> }`; `emDbName` (`@/lib/spec-builder/codegen/naming`); `sclIdent` (`@/lib/spec-builder/codegen/sa-builder`).
- Produces: `buildEms(contract): { ems: DashEm[]; warnings: string[] }`.

**REAL shapes (verified):** `EmStateV2` = `{ state_id, name, kind, ... }`; `EmTransitionV2` = `{ transition_id, from_state_id, to_state_id, trigger, guard }` (transitions reference state *ids*, not names — map through the state list). `emDbName(emScl)` returns `EM_<emScl>_DB` and its `.state` member is the codegen/HMI state binding, so the dashboard's state tag is exactly `${emDbName(sclIdent(emName))}.state` — reusing codegen's own naming keeps tag paths in lockstep.

- [ ] **Step 1: Write the failing test**

```ts
// dashboard-model.ems.test.ts
import { describe, it, expect } from "vitest";
import { buildEms } from "@/lib/spec-builder/dashboard/dashboard-model";
import type { SpecContractV2 } from "@/types/spec-contract-v2";

const contract = {
  hierarchy: {
    units: [
      { unit_id: "u1", unit_name: "Line", excluded: false,
        equipment_modules: [{ equipment_module_id: "em1", equipment_module_name: "Drive", control_modules: [] }] },
    ],
  },
  equipment_modules: {
    em1: {
      states: [
        { state_id: "s0", name: "Idle", kind: "idle" },
        { state_id: "s1", name: "Execute", kind: "active" },
      ],
      transitions: [{ transition_id: "t1", from_state_id: "s0", to_state_id: "s1", trigger: {}, guard: [] }],
    },
  },
} as unknown as SpecContractV2;

describe("buildEms", () => {
  it("emits an EM with an ordered state list, a state tag, and name-mapped transitions", () => {
    const { ems } = buildEms(contract);
    expect(ems).toHaveLength(1);
    expect(ems[0].stateTag).toBe("EM_Drive_DB.state");
    expect(ems[0].unit).toBe("Line");
    expect(ems[0].states.map((s) => s.name)).toEqual(["Idle", "Execute"]);
    expect(ems[0].states[0].index).toBe(0);
    expect(ems[0].transitions[0]).toMatchObject({ from: "Idle", to: "Execute" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/dashboard/__tests__/dashboard-model.ems.test.ts`
Expected: FAIL — `buildEms` not exported.

- [ ] **Step 3: Implement `buildEms`**

```ts
// append to dashboard-model.ts
import { buildEmUiModel } from "@/lib/spec-builder/code-builder-em-ui-model";
import { emDbName } from "@/lib/spec-builder/codegen/naming";
import { sclIdent } from "@/lib/spec-builder/codegen/sa-builder";
import type { DashEm, DashEmState, DashEmTransition } from "@/types/commissioning-dashboard";

export function buildEms(contract: SpecContractV2): { ems: DashEm[]; warnings: string[] } {
  const warnings: string[] = [];
  const ui = buildEmUiModel(contract);
  const ems: DashEm[] = [];
  for (const group of ui.unitGroups) {
    for (const emId of group.emIds) {
      const info = ui.emById[emId];
      if (!info) continue;
      const states: DashEmState[] = info.states.map((s, i) => ({ index: i, name: s.name }));
      const nameById = new Map(info.states.map((s) => [s.state_id, s.name]));
      const transitions: DashEmTransition[] = info.transitions.map((t) => ({
        from: nameById.get(t.from_state_id) ?? t.from_state_id,
        to: nameById.get(t.to_state_id) ?? t.to_state_id,
        label: "", // trigger/guard formatting deferred to Plan 2
      }));
      if (states.length === 0) warnings.push(`EM ${info.emName}: no state machine — state view will be empty`);
      ems.push({
        id: emId,
        name: info.emName,
        unit: group.unitName,
        // `.state` value is the CASE-order index; the states array is in that
        // same order, so stateLabel(index) resolves correctly. Reusing
        // emDbName(sclIdent(name)) keeps the tag identical to generated code.
        stateTag: `${emDbName(sclIdent(info.emName))}.state`,
        states,
        transitions,
        commands: [], // EM command pins derived in Plan 2 once the CMD seam is wired
      });
    }
  }
  return { ems, warnings };
}
```

> NOTE for implementer: `sclIdent` is exported from `sa-builder.ts`. If importing it there pulls in heavy transitive deps that slow the suite, it is fine to leave as-is for Plan 1 — do not relocate it. The state-index↔array-order assumption is verified live against the sim in Plan 2; do not add PLC-specific index remapping here.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/dashboard/__tests__/dashboard-model.ems.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/dashboard/dashboard-model.ts src/lib/spec-builder/dashboard/__tests__/dashboard-model.ems.test.ts
git commit -m "feat(dashboard): EM state/transition derivation (G7-9)"
```

---

### Task 3: Alarms, setpoints, sim rules, readTags union, and top-level `buildDashboardModel`

**Files:**
- Modify: `src/lib/spec-builder/dashboard/dashboard-model.ts`
- Test: `src/lib/spec-builder/dashboard/__tests__/dashboard-model.test.ts`

**Interfaces:**
- Consumes: `contract.faults: FaultRow[]` (`{ fault_code, description, triggered_by_tag, severity: "warning"|"fault"|"critical", affected_control_modules, action_text }`) and `contract.alarms: AlarmRow[]` (`{ id, tier_id, tag, description, ... }`).
- Produces: `buildDashboardModel(input: DashboardBuildInput): DashboardModel`, where `DashboardBuildInput = { contract, compile, project }` and `project = { name; specId; revision; generatedNote }`. (No `templates` — device/EM/alarm derivation needs none.)

- [ ] **Step 1: Write the failing test**

```ts
// dashboard-model.test.ts
import { describe, it, expect } from "vitest";
import { buildDashboardModel } from "@/lib/spec-builder/dashboard/dashboard-model";
import type { SpecContractV2 } from "@/types/spec-contract-v2";
import type { CodegenResult } from "@/lib/spec-builder/codegen/types";

const contract = {
  hierarchy: {
    units: [
      { unit_id: "u1", unit_name: "Line", excluded: false,
        equipment_modules: [
          { equipment_module_id: "em1", equipment_module_name: "Drive",
            control_modules: [
              { control_module_id: "cm1", control_module_name: "Motor", control_module_class: "motor",
                is_safety: false, description: "",
                io_signals: [
                  { tag: "M01_Run", signal_type: "DO", io_address: "Q0.0", description: "Run", source: "wired" },
                  { tag: "M01_Fbk", signal_type: "DI", io_address: "I0.0", description: "Running feedback", source: "wired" },
                ] },
            ] },
        ] },
    ],
  },
  equipment_modules: {},
  alarms: [],
  faults: [
    { fault_code: "F01", description: "Motor overload trip", triggered_by_tag: "M01_Trip",
      severity: "fault", affected_control_modules: ["cm1"], action_text: "stop" },
  ],
  io_list: [],
} as unknown as SpecContractV2;
const compile = { artifacts: [], warnings: [] } as unknown as CodegenResult;

describe("buildDashboardModel", () => {
  const model = buildDashboardModel({
    contract, compile,
    project: { name: "Test Machine", specId: "s1", revision: 3, generatedNote: "generated 2026-07-24" },
  });

  it("collects a fault into alarms with severity→class + hi trigger", () => {
    expect(model.alarms.map((a) => a.tag)).toContain("M01_Trip");
    expect(model.alarms[0]).toMatchObject({ trigger: "hi", class: "Fault" });
  });

  it("builds a command→feedback sim rule for the motor", () => {
    expect(model.simRules).toHaveLength(1);
    expect(model.simRules[0]).toMatchObject({ triggerTag: "M01_Run", responseTag: "M01_Fbk", delayMs: 500 });
  });

  it("readTags is the deduped union of device + em + alarm tags", () => {
    const ids = model.readTags.map((t) => t.id);
    expect(ids).toContain("M01_Run");
    expect(ids).toContain("M01_Trip");
    expect(new Set(ids).size).toBe(ids.length); // no duplicates
  });

  it("carries the project block through unchanged", () => {
    expect(model.project.name).toBe("Test Machine");
    expect(model.project.revision).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/dashboard/__tests__/dashboard-model.test.ts`
Expected: FAIL — `buildDashboardModel` not exported.

- [ ] **Step 3: Implement alarms/setpoints/simRules + assembly**

```ts
// append to dashboard-model.ts
import type {
  DashboardModel, DashDevice, DashAlarm, DashSetpoint, DashSimRule, DashTag,
} from "@/types/commissioning-dashboard";

export interface DashboardBuildInput {
  contract: SpecContractV2;
  compile: CodegenResult;
  project: { name: string; specId: string; revision: number; generatedNote: string };
}

function buildAlarms(contract: SpecContractV2): DashAlarm[] {
  const alarms: DashAlarm[] = [];
  // Faults carry the trigger tag + severity — the primary alarm source.
  for (const f of contract.faults ?? []) {
    alarms.push({
      tag: f.triggered_by_tag,
      trigger: "hi",
      class: f.severity === "warning" ? "Warning" : "Fault",
      text: f.description || f.fault_code,
    });
  }
  // Alarm rows add anything not already covered by a fault.
  for (const a of contract.alarms ?? []) {
    if (alarms.some((x) => x.tag === a.tag)) continue;
    alarms.push({ tag: a.tag, trigger: "hi", class: "Fault", text: a.description || a.tag });
  }
  return alarms;
}

function buildSetpoints(_contract: SpecContractV2): DashSetpoint[] {
  // Writable <EM>_CMD sp_* members are surfaced in Plan 2 once the command-DB
  // seam is wired; Plan 1 emits an empty list (Settings renders "no setpoints").
  return [];
}

function buildSimRules(contract: SpecContractV2, devices: DashDevice[]): DashSimRule[] {
  // Deterministic default rule per device that has EXACTLY ONE DO command AND
  // a genuine run/running feedback DI: feedback follows the command after
  // 500 ms. Devices with 0 or ≥2 commands are skipped — with multiple DOs
  // (bidirectional actuators: extend/retract, open/close, fwd/rev) there is
  // no way to tell which command correlates with the matched feedback, and a
  // wrong (backwards) rule is worse than none. Bidirectional pairing is
  // deferred to Plan 2, where the sim engine consumes these rules.
  const rules: DashSimRule[] = [];
  const byId = new Map(devices.map((d) => [d.id, d]));
  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;
    for (const em of unit.equipment_modules) {
      for (const cm of em.control_modules) {
        const dev = byId.get(cm.control_module_id);
        const fbk = cm.io_signals.find(
          (s) => s.signal_type === "DI" && /\b(fbk|feedback|running|run)\b/i.test(s.description || s.tag),
        );
        if (dev && dev.commands.length === 1 && fbk) {
          const cmd = dev.commands[0];
          rules.push({
            deviceId: cm.control_module_id, triggerTag: cmd.tag, triggerValue: true,
            responseTag: fbk.tag, responseValue: true, responseType: "Bool",
            delayMs: 500, faultInjectable: true,
            description: `${cm.control_module_name}: ${fbk.tag} follows ${cmd.tag} after 500 ms`,
          });
        }
      }
    }
  }
  return rules;
}

function unionReadTags(model: Omit<DashboardModel, "readTags" | "warnings">): DashTag[] {
  const seen = new Map<string, DashTag>();
  const add = (t: DashTag) => { if (!seen.has(t.id)) seen.set(t.id, t); };
  for (const d of model.devices) d.signals.forEach(add);
  for (const d of model.devices) d.commands.forEach((c) => add({ id: c.tag, type: c.type, label: c.label }));
  for (const e of model.ems) add({ id: e.stateTag, type: "Int", label: `${e.name} state` });
  for (const a of model.alarms) add({ id: a.tag, type: "Bool", label: a.text });
  for (const s of model.setpoints) add({ id: s.tag, type: s.type, label: s.label });
  return [...seen.values()];
}

export function buildDashboardModel(input: DashboardBuildInput): DashboardModel {
  const { devices, warnings: dw } = buildDevices(input.contract, input.compile);
  const { ems, warnings: ew } = buildEms(input.contract);
  const alarms = buildAlarms(input.contract);
  const setpoints = buildSetpoints(input.contract);
  const simRules = buildSimRules(input.contract, devices);
  const partial = { project: input.project, devices, ems, alarms, setpoints, simRules };
  const readTags = unionReadTags(partial);
  return { ...partial, readTags, warnings: [...dw, ...ew] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/dashboard/__tests__/dashboard-model.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/dashboard/dashboard-model.ts src/lib/spec-builder/dashboard/__tests__/dashboard-model.test.ts
git commit -m "feat(dashboard): alarms/setpoints/simRules + buildDashboardModel assembly (G7-9)"
```

---

### Task 4: Emitter — `emitDashboard(model, runtimeFiles) → file map`

**Files:**
- Create: `src/lib/spec-builder/dashboard/dashboard-emit.ts`
- Test: `src/lib/spec-builder/dashboard/__tests__/dashboard-emit.test.ts`

**Interfaces:**
- Consumes: `DashboardModel`, and a `runtimeFiles: Record<string, string>` map (the fixed static runtime, supplied by the caller — see Task 7).
- Produces: `emitDashboard(model, runtimeFiles): Map<string, string>` — keys are bundle-relative paths, values are file contents. Also `serializeModel(model): string` and `renderReadme(model): string`.

- [ ] **Step 1: Write the failing test**

```ts
// dashboard-emit.test.ts
import { describe, it, expect } from "vitest";
import { emitDashboard, serializeModel } from "@/lib/spec-builder/dashboard/dashboard-emit";
import type { DashboardModel } from "@/types/commissioning-dashboard";

const model: DashboardModel = {
  project: { name: "M", specId: "s", revision: 1, generatedNote: "n" },
  devices: [], ems: [], alarms: [], setpoints: [], simRules: [], readTags: [], warnings: [],
};

describe("emitDashboard", () => {
  it("serializeModel produces an assignable global with valid JSON", () => {
    const js = serializeModel(model);
    expect(js.startsWith("window.__DASH_MODEL__ =")).toBe(true);
    const json = js.replace(/^window\.__DASH_MODEL__ =\s*/, "").replace(/;\s*$/, "");
    expect(JSON.parse(json).project.name).toBe("M");
  });

  it("file map contains the generated file + every runtime file", () => {
    const files = emitDashboard(model, { "index.html": "<html></html>", "plc-transport.js": "//t" });
    expect(files.get("dash-model.js")).toContain("__DASH_MODEL__");
    expect(files.get("index.html")).toBe("<html></html>");
    expect(files.get("plc-transport.js")).toBe("//t");
    expect(files.get("README.md")).toContain("M");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/dashboard/__tests__/dashboard-emit.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the emitter**

```ts
// src/lib/spec-builder/dashboard/dashboard-emit.ts
import type { DashboardModel } from "@/types/commissioning-dashboard";

export function serializeModel(model: DashboardModel): string {
  return `window.__DASH_MODEL__ = ${JSON.stringify(model, null, 2)};\n`;
}

export function renderReadme(model: DashboardModel): string {
  return [
    `# ${model.project.name} — Commissioning Dashboard`,
    ``,
    model.project.generatedNote,
    ``,
    `## Run`,
    ``,
    `    node server.mjs        # serves http://localhost:8099`,
    ``,
    `Transports (toggle in the header):`,
    `- **Sim** — the PacForge bridge at http://localhost:5102 with a PLCSIM instance in RUN.`,
    `- **PLC** — a real PLC's Web API (open the dashboard from the PLC or set the PLC IP).`,
    ``,
    model.warnings.length ? `## Generation warnings\n\n${model.warnings.map((w) => `- ${w}`).join("\n")}\n` : ``,
  ].join("\n");
}

export function emitDashboard(
  model: DashboardModel,
  runtimeFiles: Record<string, string>,
): Map<string, string> {
  const files = new Map<string, string>();
  for (const [name, content] of Object.entries(runtimeFiles)) files.set(name, content);
  files.set("dash-model.js", serializeModel(model));
  files.set("README.md", renderReadme(model));
  return files;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/dashboard/__tests__/dashboard-emit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/dashboard/dashboard-emit.ts src/lib/spec-builder/dashboard/__tests__/dashboard-emit.test.ts
git commit -m "feat(dashboard): bundle emitter + model serialization (G7-9)"
```

---

### Task 5: Runtime — dual-transport data layer (`plc-transport.js`)

**Files:**
- Create: `src/lib/spec-builder/dashboard/runtime/plc-transport.js`
- Test: `src/lib/spec-builder/dashboard/__tests__/plc-transport.test.ts`

**Interfaces:**
- Produces (browser global): `window.PlcTransport = { create(kind, opts) }` returning `{ read(tags), write(tag, value, type), kind }`. `kind` is `"bridge"` or `"webapi"`. `tags` is `Array<{ id, type }>`; `read` resolves to `Record<id, value|null>`.
- The file is authored as a plain ES-module-free script (attaches to `window`) so it runs from `file://`/static serving with no bundler.

- [ ] **Step 1: Write the failing test**

```ts
// plc-transport.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Load the runtime script into a window-like global, then exercise it.
function loadTransport(): any {
  const src = readFileSync(
    path.resolve(__dirname, "../runtime/plc-transport.js"), "utf8",
  );
  const win: any = {};
  new Function("window", src)(win);
  return win.PlcTransport;
}

describe("plc-transport bridge adapter", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("reads via the bridge with explicit types and unquoted names", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ values: [{ tag_name: "DB.member", value: true }] }),
    }));
    const T = loadTransport();
    const t = T.create("bridge", { fetch: fetchMock, baseUrl: "http://localhost:5102" });
    const out = await t.read([{ id: "DB.member", type: "Bool" }]);
    expect(out["DB.member"]).toBe(true);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body[0]).toEqual({ tag_name: "DB.member", data_type: "Bool" });
    expect(fetchMock.mock.calls[0][0]).toContain("/tia/plcsim/read-tags");
  });

  it("writes via the Web API with quoted SCL names", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ result: true }) }));
    const T = loadTransport();
    const t = T.create("webapi", { fetch: fetchMock, baseUrl: "", token: "abc" });
    await t.write("DB.member", true, "Bool");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.method).toBe("PlcProgram.Write");
    expect(body.params.var).toBe('"DB"."member"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/dashboard/__tests__/plc-transport.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Implement the transport**

```js
// src/lib/spec-builder/dashboard/runtime/plc-transport.js
(function (window) {
  "use strict";

  function stripQuotes(tag) { return String(tag).replace(/"/g, ""); }
  // "DB.member" -> "\"DB\".\"member\"" ; "M01_Run" -> "\"M01_Run\""
  function plcVar(id) {
    var i = String(id).indexOf(".");
    return i < 0 ? '"' + id + '"' : '"' + id.slice(0, i) + '"."' + id.slice(i + 1) + '"';
  }

  function bridgeAdapter(opts) {
    var f = opts.fetch || window.fetch.bind(window);
    var base = opts.baseUrl || "http://localhost:5102";
    return {
      kind: "bridge",
      read: async function (tags) {
        var body = tags.map(function (t) { return { tag_name: stripQuotes(t.id), data_type: t.type }; });
        var r = await f(base + "/tia/plcsim/read-tags", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
        var j = await r.json();
        var out = {};
        (j.values || []).forEach(function (v) { out[v.tag_name] = v.error ? null : v.value; });
        // map back to requested ids (bridge echoes unquoted names)
        var res = {};
        tags.forEach(function (t) { res[t.id] = (stripQuotes(t.id) in out) ? out[stripQuotes(t.id)] : null; });
        return res;
      },
      write: async function (tag, value, type) {
        await f(base + "/tia/plcsim/write-tag", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tag_name: stripQuotes(tag), value: value, data_type: type }),
        });
      },
    };
  }

  function webapiAdapter(opts) {
    var f = opts.fetch || window.fetch.bind(window);
    var base = opts.baseUrl || "";
    var token = opts.token || null;
    var id = 0;
    function rpc(method, params) {
      return f(base + "/api/jsonrpc", {
        method: "POST",
        headers: Object.assign({ "Content-Type": "application/json" }, token ? { "X-Auth-Token": token } : {}),
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method: method, params: params }),
      }).then(function (r) { return r.json(); });
    }
    return {
      kind: "webapi",
      setToken: function (t) { token = t; },
      read: async function (tags) {
        var batch = tags.map(function (t, i) {
          return { jsonrpc: "2.0", id: i + 1, method: "PlcProgram.Read", params: { var: plcVar(t.id), mode: "simple" } };
        });
        var r = await f(base + "/api/jsonrpc", {
          method: "POST",
          headers: Object.assign({ "Content-Type": "application/json" }, token ? { "X-Auth-Token": token } : {}),
          body: JSON.stringify(batch),
        });
        var rows = await r.json();
        rows = Array.isArray(rows) ? rows : [rows];
        var byId = {};
        rows.forEach(function (row) { byId[row.id] = row; });
        var res = {};
        tags.forEach(function (t, i) { var row = byId[i + 1]; res[t.id] = row && !row.error ? row.result : null; });
        return res;
      },
      write: async function (tag, value) {
        var j = await rpc("PlcProgram.Write", { var: plcVar(tag), value: value, mode: "simple" });
        if (j.error) throw new Error(j.error.message || "write failed");
      },
      login: async function (user, password) {
        var j = await rpc("Api.Login", { user: user, password: password });
        if (j.error) throw new Error(j.error.message || "login failed");
        token = j.result.token; return token;
      },
    };
  }

  window.PlcTransport = {
    create: function (kind, opts) { return kind === "webapi" ? webapiAdapter(opts || {}) : bridgeAdapter(opts || {}); },
  };
})(typeof window !== "undefined" ? window : this);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/dashboard/__tests__/plc-transport.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/dashboard/runtime/plc-transport.js src/lib/spec-builder/dashboard/__tests__/plc-transport.test.ts
git commit -m "feat(dashboard): dual-transport data layer runtime (G7-9)"
```

---

### Task 6: Runtime — shell + renderer (`index.html`, `styles.css`, `dashboard-app.js`)

**Files:**
- Create: `src/lib/spec-builder/dashboard/runtime/index.html`
- Create: `src/lib/spec-builder/dashboard/runtime/styles.css`
- Create: `src/lib/spec-builder/dashboard/runtime/dashboard-app.js`
- Test: `src/lib/spec-builder/dashboard/__tests__/dashboard-app.test.ts`

**Interfaces:**
- Consumes: `window.__DASH_MODEL__` (from `dash-model.js`), `window.PlcTransport`.
- Produces (browser global): `window.DashApp = { render(root, model, transport), poll(model, transport) }`. `poll` returns a `values` object keyed by tag id.

- [ ] **Step 1: Write the failing test** (renderer is pure enough to unit-test the state→view mapping)

```ts
// dashboard-app.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

function loadApp(): any {
  const src = readFileSync(path.resolve(__dirname, "../runtime/dashboard-app.js"), "utf8");
  const win: any = { document: undefined };
  new Function("window", src)(win);
  return win.DashApp;
}

describe("DashApp.stateLabel", () => {
  it("maps an EM state index to its name", () => {
    const App = loadApp();
    const em = { states: [{ index: 0, name: "Idle" }, { index: 1, name: "Execute" }], stateTag: "EM.state" };
    expect(App.stateLabel(em, { "EM.state": 1 })).toBe("Execute");
    expect(App.stateLabel(em, { "EM.state": 9 })).toBe("#9"); // out-of-range → raw
  });

  it("activeAlarms filters by trigger polarity", () => {
    const App = loadApp();
    const alarms = [{ tag: "T", trigger: "hi", class: "Fault", text: "x" }];
    expect(App.activeAlarms(alarms, { T: true })).toHaveLength(1);
    expect(App.activeAlarms(alarms, { T: false })).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/dashboard/__tests__/dashboard-app.test.ts`
Expected: FAIL — file not found.

- [ ] **Step 3: Implement `dashboard-app.js`** (functional-minimal renderer; polish is Plan 2)

```js
// src/lib/spec-builder/dashboard/runtime/dashboard-app.js
(function (window) {
  "use strict";
  var doc = window.document;

  function stateLabel(em, values) {
    var idx = values[em.stateTag];
    if (typeof idx !== "number") return "—";
    var s = em.states.find(function (st) { return st.index === idx; });
    return s ? s.name : "#" + idx;
  }
  function activeAlarms(alarms, values) {
    return alarms.filter(function (a) {
      var v = values[a.tag];
      if (v == null) return false;
      return a.trigger === "hi" ? v === true : v === false;
    });
  }

  function el(tag, cls, text) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function render(root, model, transport) {
    root.innerHTML = "";
    root.appendChild(el("h1", "dash-title", model.project.name));
    var status = el("div", "dash-status", "connecting…");
    root.appendChild(status);

    // Devices
    var devWrap = el("section", "dash-devices");
    devWrap.appendChild(el("h2", null, "Devices"));
    model.devices.forEach(function (d) {
      var card = el("div", "dash-card");
      card.appendChild(el("div", "dash-card-title", d.name + " (" + d.tag + ")"));
      d.commands.forEach(function (c) {
        var btn = el("button", "dash-cmd", c.label);
        btn.onclick = function () {
          transport.write(c.tag, true, c.type);
          if (c.momentary) setTimeout(function () { transport.write(c.tag, false, c.type); }, 400);
        };
        card.appendChild(btn);
      });
      d.signals.forEach(function (s) {
        var row = el("div", "dash-sig");
        row.dataset.tag = s.id;
        row.appendChild(el("span", "dash-sig-label", s.label));
        row.appendChild(el("span", "dash-sig-val", "—"));
        card.appendChild(row);
      });
      devWrap.appendChild(card);
    });
    root.appendChild(devWrap);

    // EMs
    var emWrap = el("section", "dash-ems");
    emWrap.appendChild(el("h2", null, "Sequences"));
    model.ems.forEach(function (em) {
      var row = el("div", "dash-em");
      row.dataset.em = em.id;
      row.appendChild(el("span", "dash-em-name", em.name));
      row.appendChild(el("span", "dash-em-state", "—"));
      emWrap.appendChild(row);
    });
    root.appendChild(emWrap);

    // Alarms
    var alarmWrap = el("section", "dash-alarms");
    alarmWrap.appendChild(el("h2", null, "Alarms"));
    var alarmList = el("ul", "dash-alarm-list");
    alarmWrap.appendChild(alarmList);
    root.appendChild(alarmWrap);

    return {
      update: function (values, connected) {
        status.textContent = connected ? "connected · " + transport.kind : "disconnected";
        model.devices.forEach(function (d) {
          d.signals.forEach(function (s) {
            var row = devWrap.querySelector('.dash-sig[data-tag="' + s.id + '"] .dash-sig-val');
            if (row) row.textContent = values[s.id] == null ? "—" : String(values[s.id]);
          });
        });
        model.ems.forEach(function (em) {
          var cell = emWrap.querySelector('.dash-em[data-em="' + em.id + '"] .dash-em-state');
          if (cell) cell.textContent = stateLabel(em, values);
        });
        alarmList.innerHTML = "";
        activeAlarms(model.alarms, values).forEach(function (a) {
          alarmList.appendChild(el("li", "dash-alarm dash-" + a.class.toLowerCase(), a.text));
        });
      },
    };
  }

  async function start(root, model, transport) {
    var view = render(root, model, transport);
    for (;;) {
      try {
        var values = await transport.read(model.readTags);
        view.update(values, true);
      } catch (e) {
        view.update({}, false);
        await new Promise(function (r) { setTimeout(r, 2000); });
      }
      await new Promise(function (r) { setTimeout(r, 500); });
    }
  }

  window.DashApp = { render: render, start: start, stateLabel: stateLabel, activeAlarms: activeAlarms };
})(typeof window !== "undefined" ? window : this);
```

- [ ] **Step 4: Implement `index.html` and `styles.css`**

```html
<!-- src/lib/spec-builder/dashboard/runtime/index.html -->
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Commissioning Dashboard</title>
  <link rel="stylesheet" href="styles.css" />
</head>
<body>
  <header class="dash-header">
    <label>Transport
      <select id="dash-transport">
        <option value="bridge">Sim (bridge)</option>
        <option value="webapi">PLC (Web API)</option>
      </select>
    </label>
  </header>
  <main id="dash-root">loading…</main>
  <script src="dash-model.js"></script>
  <script src="plc-transport.js"></script>
  <script src="dashboard-app.js"></script>
  <script>
    (function () {
      var model = window.__DASH_MODEL__;
      var sel = document.getElementById("dash-transport");
      function boot() {
        var kind = sel.value;
        var transport = window.PlcTransport.create(kind, {});
        window.DashApp.start(document.getElementById("dash-root"), model, transport);
      }
      sel.onchange = function () { location.reload(); };
      boot();
    })();
  </script>
</body>
</html>
```

```css
/* src/lib/spec-builder/dashboard/runtime/styles.css */
:root { font-family: system-ui, "Segoe UI", sans-serif; }
body { margin: 0; background: #f5f6f8; color: #1c2b33; }
.dash-header { padding: 8px 16px; background: #3050A0; color: #fff; }
.dash-title { margin: 12px 16px 0; }
.dash-status { margin: 4px 16px 12px; font-size: 12px; color: #59636d; }
section { margin: 0 16px 20px; }
.dash-card { display: inline-block; vertical-align: top; min-width: 200px; margin: 6px; padding: 10px;
  background: #fff; border: 1px solid #d5dbe0; border-radius: 8px; }
.dash-card-title { font-weight: 600; margin-bottom: 6px; }
.dash-cmd { margin: 2px 4px 8px 0; padding: 6px 10px; background: #3050A0; color: #fff; border: 0; border-radius: 6px; cursor: pointer; }
.dash-sig { display: flex; justify-content: space-between; font-size: 13px; padding: 1px 0; }
.dash-sig-val { font-family: "JetBrains Mono", monospace; }
.dash-em { display: flex; justify-content: space-between; max-width: 360px; padding: 3px 0; }
.dash-alarm { padding: 4px 8px; border-radius: 4px; margin: 2px 0; }
.dash-fault { background: #fde2e1; }
.dash-warning { background: #fdf3d2; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/dashboard/__tests__/dashboard-app.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/dashboard/runtime/index.html src/lib/spec-builder/dashboard/runtime/styles.css src/lib/spec-builder/dashboard/runtime/dashboard-app.js src/lib/spec-builder/dashboard/__tests__/dashboard-app.test.ts
git commit -m "feat(dashboard): runtime shell + minimal renderer (G7-9)"
```

---

### Task 7: Runtime bundling — `server.mjs` + `runtime-files.ts` loader

**Files:**
- Create: `src/lib/spec-builder/dashboard/runtime/server.mjs`
- Create: `src/lib/spec-builder/dashboard/runtime-files.ts`
- Test: `src/lib/spec-builder/dashboard/__tests__/runtime-files.test.ts`

**Interfaces:**
- Produces: `RUNTIME_FILES: Record<string, string>` — the static runtime files inlined as string constants (so the browser app can `emitDashboard(model, RUNTIME_FILES)` with no filesystem access). Import the raw file contents via Vite's `?raw` suffix.

- [ ] **Step 1: Write `server.mjs`**

```js
// src/lib/spec-builder/dashboard/runtime/server.mjs
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".md": "text/markdown" };
const PORT = process.env.PORT || 8099;

http.createServer(async (req, res) => {
  const name = req.url === "/" ? "index.html" : decodeURIComponent(req.url.slice(1).split("?")[0]);
  try {
    const buf = await readFile(join(here, name));
    res.writeHead(200, { "Content-Type": TYPES[extname(name)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404); res.end("not found");
  }
}).listen(PORT, () => console.log(`Dashboard on http://localhost:${PORT}`));
```

- [ ] **Step 2: Write the failing test**

```ts
// runtime-files.test.ts
import { describe, it, expect } from "vitest";
import { RUNTIME_FILES } from "@/lib/spec-builder/dashboard/runtime-files";

describe("RUNTIME_FILES", () => {
  it("bundles every static runtime file as a non-empty string", () => {
    for (const name of ["index.html", "styles.css", "plc-transport.js", "dashboard-app.js", "server.mjs"]) {
      expect(typeof RUNTIME_FILES[name]).toBe("string");
      expect(RUNTIME_FILES[name].length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/dashboard/__tests__/runtime-files.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement the loader (Vite `?raw` imports)**

```ts
// src/lib/spec-builder/dashboard/runtime-files.ts
import indexHtml from "./runtime/index.html?raw";
import stylesCss from "./runtime/styles.css?raw";
import transportJs from "./runtime/plc-transport.js?raw";
import appJs from "./runtime/dashboard-app.js?raw";
import serverMjs from "./runtime/server.mjs?raw";

export const RUNTIME_FILES: Record<string, string> = {
  "index.html": indexHtml,
  "styles.css": stylesCss,
  "plc-transport.js": transportJs,
  "dashboard-app.js": appJs,
  "server.mjs": serverMjs,
};
```

> NOTE: vitest resolves Vite's `?raw` imports natively. If a suite runs before Vite config is picked up, add `assetsInclude`/`?raw` handling is already default in this repo's vite config — verify `vite.config.ts` has no override that strips it.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/dashboard/__tests__/runtime-files.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/dashboard/runtime/server.mjs src/lib/spec-builder/dashboard/runtime-files.ts src/lib/spec-builder/dashboard/__tests__/runtime-files.test.ts
git commit -m "feat(dashboard): static runtime files + server + raw loader (G7-9)"
```

---

### Task 8: Hook — `use-generate-dashboard.ts` (build → emit → zip)

**Files:**
- Create: `src/hooks/use-generate-dashboard.ts`
- Test: `src/hooks/__tests__/use-generate-dashboard.test.ts`

**Interfaces:**
- Consumes: `loadSpecContract` (`@/lib/spec-builder/contract`), `compileContract` (`@/lib/spec-builder/codegen/compile-contract`), `buildDashboardModel`, `emitDashboard`, `RUNTIME_FILES`, `jszip`.
- Produces: `useGenerateDashboard()` → `{ generate(specId, project): Promise<Blob>, isGenerating, warnings }`. Also exports pure `buildBundleZip(files): Promise<Blob>` for testing without React.

- [ ] **Step 1: Write the failing test**

```ts
// use-generate-dashboard.test.ts
import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { buildBundleZip } from "@/hooks/use-generate-dashboard";

describe("buildBundleZip", () => {
  it("packs the file map into a readable zip", async () => {
    const files = new Map([["a.txt", "hello"], ["b/c.js", "//x"]]);
    const blob = await buildBundleZip(files);
    const zip = await JSZip.loadAsync(await blob.arrayBuffer());
    expect(await zip.file("a.txt")!.async("string")).toBe("hello");
    expect(await zip.file("b/c.js")!.async("string")).toBe("//x");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/use-generate-dashboard.test.ts`
Expected: FAIL — `buildBundleZip` not exported.

- [ ] **Step 3: Implement the hook**

```ts
// src/hooks/use-generate-dashboard.ts
import { useState, useCallback } from "react";
import JSZip from "jszip";
import { loadSpecContract } from "@/lib/spec-builder/contract";
import { compileContract } from "@/lib/spec-builder/codegen/compile-contract";
import { buildDashboardModel } from "@/lib/spec-builder/dashboard/dashboard-model";
import { emitDashboard } from "@/lib/spec-builder/dashboard/dashboard-emit";
import { RUNTIME_FILES } from "@/lib/spec-builder/dashboard/runtime-files";
import { useFbTemplates } from "@/hooks/use-fb-templates";

export async function buildBundleZip(files: Map<string, string>): Promise<Blob> {
  const zip = new JSZip();
  for (const [name, content] of files) zip.file(name, content);
  return zip.generateAsync({ type: "blob" });
}

export function useGenerateDashboard() {
  const { data: templates = [] } = useFbTemplates();
  const [isGenerating, setGenerating] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);

  const generate = useCallback(
    async (specId: string, project: { name: string; revision: number; generatedNote: string }) => {
      setGenerating(true);
      try {
        const contract = await loadSpecContract(specId);
        const compile = compileContract(contract, templates); // templates still needed by the compiler
        const model = buildDashboardModel({
          contract, compile,
          project: { name: project.name, specId, revision: project.revision, generatedNote: project.generatedNote },
        });
        setWarnings(model.warnings);
        const files = emitDashboard(model, RUNTIME_FILES);
        return buildBundleZip(files);
      } finally {
        setGenerating(false);
      }
    },
    [templates],
  );

  return { generate, isGenerating, warnings };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/hooks/__tests__/use-generate-dashboard.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-generate-dashboard.ts src/hooks/__tests__/use-generate-dashboard.test.ts
git commit -m "feat(dashboard): use-generate-dashboard hook + zip packaging (G7-9)"
```

---

### Task 9: Code Builder panel — "Commissioning Dashboard"

**Files:**
- Create: `src/components/code-builder/commissioning-dashboard-panel.tsx`
- Modify: `src/routes/code-builder.tsx` (add the panel to the Code Builder shell — mirror how `hmi-build-panel.tsx` is mounted)
- Test: `src/components/code-builder/__tests__/commissioning-dashboard-panel.test.tsx`

**Interfaces:**
- Consumes: `useGenerateDashboard`, the current `specId`/`spec` already available in `code-builder.tsx`.
- Produces: a panel with a **Generate & Download** button that triggers `generate(...)` and saves the returned blob via a temporary object URL; renders the `warnings` list.

- [ ] **Step 1: Write the failing test**

```tsx
// commissioning-dashboard-panel.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommissioningDashboardPanel } from "@/components/code-builder/commissioning-dashboard-panel";

vi.mock("@/hooks/use-generate-dashboard", () => ({
  useGenerateDashboard: () => ({ generate: vi.fn(), isGenerating: false, warnings: ["w1"] }),
}));

describe("CommissioningDashboardPanel", () => {
  it("renders the generate button and warnings", () => {
    render(<CommissioningDashboardPanel specId="s1" projectName="M" revision={1} />);
    expect(screen.getByRole("button", { name: /generate/i })).toBeTruthy();
    expect(screen.getByText("w1")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/code-builder/__tests__/commissioning-dashboard-panel.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement the panel**

```tsx
// src/components/code-builder/commissioning-dashboard-panel.tsx
import { useGenerateDashboard } from "@/hooks/use-generate-dashboard";

interface Props { specId: string; projectName: string; revision: number; }

export function CommissioningDashboardPanel({ specId, projectName, revision }: Props) {
  const { generate, isGenerating, warnings } = useGenerateDashboard();

  async function onGenerate() {
    const blob = await generate(specId, {
      name: projectName, revision, generatedNote: `Generated for ${projectName} rev ${revision}.`,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${projectName.replace(/[^A-Za-z0-9]/g, "_")}-commissioning-hmi.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="p-4 space-y-3">
      <h3 className="text-sm font-semibold">Commissioning Dashboard</h3>
      <p className="text-xs text-muted-foreground">
        Generate a portable web dashboard for this project — connect it to the PLCSIM sim (bridge) or a real PLC (Web API).
      </p>
      <button
        onClick={onGenerate}
        disabled={isGenerating}
        className="px-3 py-1.5 rounded-md bg-pac-blue-600 text-white text-sm disabled:opacity-50"
      >
        {isGenerating ? "Generating…" : "Generate & Download"}
      </button>
      {warnings.length > 0 && (
        <ul className="text-xs text-amber-700 list-disc pl-4">
          {warnings.map((w, i) => <li key={i}>{w}</li>)}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Mount it in the Code Builder shell**

Open `src/routes/code-builder.tsx`, find where `hmi-build-panel` is rendered, and add alongside it (using the same `specId`/`spec.name`/`revision` already in scope):

```tsx
import { CommissioningDashboardPanel } from "@/components/code-builder/commissioning-dashboard-panel";
// …within the same panel region as HMI build:
{specId && spec && (
  <CommissioningDashboardPanel specId={specId} projectName={spec.name} revision={Number(spec.revision)} />
)}
```

- [ ] **Step 5: Run test + typecheck**

Run: `npx vitest run src/components/code-builder/__tests__/commissioning-dashboard-panel.test.tsx`
Expected: PASS.
Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/components/code-builder/commissioning-dashboard-panel.tsx src/routes/code-builder.tsx src/components/code-builder/__tests__/commissioning-dashboard-panel.test.tsx
git commit -m "feat(dashboard): Code Builder commissioning-dashboard panel (G7-9)"
```

---

### Task 10: Genericity golden test (≥2 machine types) + full-suite gate

**Files:**
- Create: `src/lib/spec-builder/dashboard/__tests__/dashboard-generic.test.ts`
- Create: `src/lib/spec-builder/dashboard/__tests__/fixtures/conveyor-contract.ts`
- Create: `src/lib/spec-builder/dashboard/__tests__/fixtures/filler-contract.ts`

**Interfaces:**
- Consumes: `buildDashboardModel`, two hand-written contract fixtures for *distinct* machine types (a conveyor line, a filling station) — NO shared device names.

- [ ] **Step 1: Write the two fixtures**

```ts
// fixtures/conveyor-contract.ts — a 2-conveyor line (real nested contract shape)
import type { SpecContractV2 } from "@/types/spec-contract-v2";
const cm = (id: string, name: string, run: string, fbk: string) => ({
  control_module_id: id, control_module_name: name, control_module_class: "conveyor",
  is_safety: false, description: "",
  io_signals: [
    { tag: run, signal_type: "DO", io_address: "Q0.0", description: "Run", source: "wired" },
    { tag: fbk, signal_type: "DI", io_address: "I0.0", description: "Running feedback", source: "wired" },
  ],
});
export const conveyorContract = {
  hierarchy: {
    units: [
      { unit_id: "u1", unit_name: "Transfer", excluded: false,
        equipment_modules: [
          { equipment_module_id: "em1", equipment_module_name: "Infeed",
            control_modules: [cm("c1", "Infeed Conveyor", "CV01_Run", "CV01_Fbk")] },
          { equipment_module_id: "em2", equipment_module_name: "Outfeed",
            control_modules: [cm("c2", "Outfeed Conveyor", "CV02_Run", "CV02_Fbk")] },
        ] },
    ],
  },
  equipment_modules: {}, alarms: [], faults: [], io_list: [],
} as unknown as SpecContractV2;
```

```ts
// fixtures/filler-contract.ts — a filling station with a fault (no run feedback)
import type { SpecContractV2 } from "@/types/spec-contract-v2";
export const fillerContract = {
  hierarchy: {
    units: [
      { unit_id: "u1", unit_name: "Fill Station", excluded: false,
        equipment_modules: [
          { equipment_module_id: "em1", equipment_module_name: "Filler",
            control_modules: [
              { control_module_id: "f1", control_module_name: "Fill Valve", control_module_class: "valve",
                is_safety: false, description: "",
                io_signals: [
                  { tag: "VLV01_Open", signal_type: "DO", io_address: "Q1.0", description: "Open", source: "wired" },
                ] },
            ] },
        ] },
    ],
  },
  equipment_modules: {}, alarms: [], io_list: [],
  faults: [
    { fault_code: "F10", description: "Overpressure trip", triggered_by_tag: "VLV01_Ovl",
      severity: "fault", affected_control_modules: ["f1"], action_text: "close" },
  ],
} as unknown as SpecContractV2;
```

- [ ] **Step 2: Write the generic test**

```ts
// dashboard-generic.test.ts
import { describe, it, expect } from "vitest";
import { buildDashboardModel } from "@/lib/spec-builder/dashboard/dashboard-model";
import { conveyorContract } from "./fixtures/conveyor-contract";
import { fillerContract } from "./fixtures/filler-contract";
import type { CodegenResult } from "@/lib/spec-builder/codegen/types";

const empty = { artifacts: [], warnings: [] } as unknown as CodegenResult;
const proj = { name: "X", specId: "s", revision: 1, generatedNote: "n" };

describe("generic across machine types", () => {
  it("conveyor line: 2 devices, 2 sim rules, 0 alarms", () => {
    const m = buildDashboardModel({ contract: conveyorContract, compile: empty, project: proj });
    expect(m.devices).toHaveLength(2);
    expect(m.simRules).toHaveLength(2);
    expect(m.alarms).toHaveLength(0);
  });

  it("filler: 1 device, 1 fault alarm, 0 sim rules (no run-feedback signal)", () => {
    const m = buildDashboardModel({ contract: fillerContract, compile: empty, project: proj });
    expect(m.devices).toHaveLength(1);
    expect(m.alarms.map((a) => a.tag)).toEqual(["VLV01_Ovl"]);
    expect(m.simRules).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run the generic test**

Run: `npx vitest run src/lib/spec-builder/dashboard/__tests__/dashboard-generic.test.ts`
Expected: PASS. If the filler expects 0 sim rules but the heuristic matches "Open"/"trip", tighten `buildSimRules`'s feedback regex so it only matches genuine run/running feedback — do NOT special-case device names.

- [ ] **Step 4: Full gate**

Run: `npx vitest run src/lib/spec-builder/dashboard src/hooks/__tests__/use-generate-dashboard.test.ts src/components/code-builder/__tests__/commissioning-dashboard-panel.test.tsx`
Expected: all PASS.
Run: `npx tsc -b`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/dashboard/__tests__/dashboard-generic.test.ts src/lib/spec-builder/dashboard/__tests__/fixtures/
git commit -m "test(dashboard): genericity golden tests across machine types (G7-9)"
```

---

## Post-Plan Verification

- [ ] `npx tsc -b` clean.
- [ ] `npx vitest run src/lib/spec-builder/dashboard` all green.
- [ ] Manual smoke (dev machine, bridge running, PLCSIM in RUN with a downloaded project): generate a bundle from the Code Builder panel, `node server.mjs`, open `http://localhost:8099`, confirm live values populate on the sim transport.
- [ ] Update Monday G7-9 → Awaiting Testing; comment the commit range + manual-smoke result.

## Deferred to Plan 2 (per-device sim engine)

- `sim-engine.js` runtime (per-device auto-feedback consuming `model.simRules`, fault modes, global arm).
- Sim & Faults page + per-device sim-mode selectors.
- The sim-only safety guard (engine inert unless transport === bridge) + its test.
- Web API login overlay + session discipline (Plan 1 leaves `token` settable but has no UI overlay).
- Setpoints/command-DB seam (`buildSetpoints`, EM command pins) once confirmed.
- Analog signal typing + ramping; visual polish of the runtime UI.
- Full page set: dedicated **IO table page**, **Settings page**, and the **Overview mimic slot** (auto-grid + editable hook). Plan 1 renders devices / EMs / alarms only.
- **Block generation on compile errors** (Plan 1 relies on the Code Builder's confirmed-spec gate; a hard "spec must compile clean" check before emit is Plan 2).
- Optional bridge "write bundle to `exports/<project>/commissioning-hmi/`" endpoint.
```
