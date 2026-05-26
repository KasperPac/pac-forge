# FDS Random Builder V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the random FDS builder so every spec it produces is V2 by construction (numeric PackML `state_id` with matching `packml_id`, structured `CompletionCriterion`, `StepV2`, `SharedPermissive[]`, `InterAssemblyInterlock[]`) and passes `validateSpecContractPatch` end-to-end.

**Architecture:** Two-stage pipeline. Stage 1 is a small AI call returning a `RandomFdsTheme` (title, names, prose, device specs — no schema-bound structure). Stage 2 is fully deterministic: canonical PackML state machine, per-subsystem IO byte ranges, per-device-class step templates, canonical orchestration interlocks. Wizard data (`hierarchy`, `states`, `alarm_tiers`, `alarms`, `modes`) flows through `writeSpecContract` and is validator-gated. Per-table V2 surfaces that the writer doesn't route yet (`fds_assembly_sessions`, `fds_subsystem_orchestrations`, `spec_sections.functional_description`) are written directly but constructed from the same deterministic builders, with belt-and-braces `StepV2Schema.parse()` / `SubsystemStateSequenceSchema.parse()` before insert.

**Tech Stack:** TypeScript 5.9, React 19, Vite 7, Zod, Vitest, Supabase, TanStack Query.

**Spec:** `Docs/superpowers/specs/2026-05-26-fds-random-builder-v2-design.md`

**Out of scope for this PR** (acknowledged deferral, see §7 of the spec for the full out-of-scope list):

- **Non-functional_description spec_sections** (doc_control, system_overview, control_philosophy, io_list, alarm_spec, hmi, testing). The spec specifies deterministic renderers for these; this plan delivers only `functional_description`. Rationale: the user picked "dev/test fixture" as the builder's purpose — matrix view, forge handoff, code generation, and assembly authoring all work from `confirmed_states` + assembly sessions + orchestrations without the prose sections. DOCX export will produce a partial document; that is an acceptable dev-fixture limitation. Follow-up plan if/when full DOCX completeness is required.

---

## Pre-flight

**Branch:** `feature/fds-engine-phase3` (already checked out — continues the V2 work).

**Files this plan touches:**

Create:
- `src/lib/spec-builder/random/theme-prompt.ts`
- `src/lib/spec-builder/random/theme-schema.ts`
- `src/lib/spec-builder/random/state-machine.ts`
- `src/lib/spec-builder/random/io-allocator.ts`
- `src/lib/spec-builder/random/device-templates.ts`
- `src/lib/spec-builder/random/sequence-builder.ts`
- `src/lib/spec-builder/random/orchestration-builder.ts`
- `src/lib/spec-builder/random/section-renderer.ts`
- `src/lib/spec-builder/random/assemble.ts`
- `src/lib/spec-builder/random/__tests__/theme-schema.test.ts`
- `src/lib/spec-builder/random/__tests__/state-machine.test.ts`
- `src/lib/spec-builder/random/__tests__/io-allocator.test.ts`
- `src/lib/spec-builder/random/__tests__/device-templates.test.ts`
- `src/lib/spec-builder/random/__tests__/sequence-builder.test.ts`
- `src/lib/spec-builder/random/__tests__/orchestration-builder.test.ts`
- `src/lib/spec-builder/random/__tests__/section-renderer.test.ts`
- `src/lib/spec-builder/random/__tests__/assemble.integration.test.ts`

Modify:
- `src/hooks/use-random-fds-generate.ts` — rewrite as thin wrapper over `assemble.ts`; delete `parseCompletionCriteria`.
- `src/components/spec-builder/random-fds-dialog.tsx` — remove `autoComplete` checkbox + state.

**Key V2 facts to anchor coding decisions** (from `src/types/spec-contract-v2.ts`):

- `OperatingStateV2.state_id` is `string | number`. Numeric IDs 1..17 are PackML and **require** `packml_id === state_id`. Numeric > 100 are custom and require `custom_name`. Numeric 18..100 are invalid.
- PackML IDs used by this builder: `IDLE=4`, `STARTING=3`, `EXECUTE=6`, `STOPPING=7`, `COMPLETE=17`, `ABORTED=9` (mapped to E_STOP).
- `StepV2` has **both** v1 fields (`step`, `action`, `completion_criteria`, `completion_criteria_text` — required) and v2 SFC fields (`step_id`, `branch_id`, `actions`, `transitions` — optional during shim). The builder populates both.
- `TransitionV2.kind` is `"single" | "parallel"` — there is no `"default"` kind. Use `kind: "single"` with `is_default: true` for the normal sequential next-step edge.
- `InterAssemblyInterlock.effect` is one of `"hold" | "block_transition" | "trigger" | "enable" | "disable"`. The builder uses `"enable"` for the AT_HOME → STARTING permit pattern.
- `SubsystemStateSequence` keys: `assembly_order: string[]`, `shared_permissives: SharedPermissive[]`, `inter_assembly_interlocks: InterAssemblyInterlock[]`, `notes: string | null`.
- `validateSpecContractPatch` (in `src/lib/spec-builder/contract.ts:1260`) enforces: modes has exactly one default, PackML invariants, override_kind content rules, IO tag global uniqueness across the hierarchy. The builder must satisfy all of these.

---

## Conventions

- Test runner: `vitest`. Run individual tests with `npx vitest run <path> -t "<test name>"`. Run a file with `npx vitest run <path>`.
- All new files start with a one-line JSDoc header explaining the file's responsibility.
- Imports use the `@/` alias (resolves to `src/`).
- Each task ends with a commit. Commit messages follow the existing `feat(fds-engine): …` / `test(fds-engine): …` / `fix(fds-engine): …` pattern visible in `git log`.
- Do **not** skip the "run test, see it fail" step. The point is to verify the test exercises the thing under test before it goes green.
- Each `git commit` uses a heredoc for the message and includes the `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.

---

### Task 1: Theme schema + Zod validator

**Files:**
- Create: `src/lib/spec-builder/random/theme-schema.ts`
- Test: `src/lib/spec-builder/random/__tests__/theme-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/spec-builder/random/__tests__/theme-schema.test.ts
import { describe, expect, it } from "vitest";
import { RandomFdsThemeSchema } from "../theme-schema";

describe("RandomFdsThemeSchema", () => {
  const valid = {
    title: "Random Lift Station",
    system_description: "A two-station lift system.",
    plc_model: "S7-1500 / CPU 1516-3 PN/DP",
    hmi_type: "TP1200 Comfort",
    fault_philosophy: "Fault → controlled stop → operator reset",
    design_principles: ["Fail-safe defaults", "Operator-driven reset"],
    machine_theme: "vertical lift",
    safety_classification: null,
    subsystems: [
      {
        subsystem_name: "Infeed",
        equipment_type: "Conveyor",
        description: "Belt conveyor that feeds parts onto the lift.",
        assemblies: [
          {
            assembly_name: "Conveyor CV01",
            description: "Single drive belt conveyor.",
            devices: [
              { device_name: "Drive Motor M01", device_class: "motor", description: "1.5 kW belt drive", is_safety: false },
              { device_name: "Part-Present Sensor PS01", device_class: "sensor_position", description: "Photoelectric, part detect", is_safety: false },
            ],
          },
        ],
      },
    ],
  };

  it("accepts a well-formed theme", () => {
    expect(() => RandomFdsThemeSchema.parse(valid)).not.toThrow();
  });

  it("rejects a theme missing title", () => {
    const { title: _omit, ...rest } = valid;
    expect(() => RandomFdsThemeSchema.parse(rest)).toThrow();
  });

  it("rejects a device with an unknown device_class", () => {
    const bad = structuredClone(valid);
    bad.subsystems[0].assemblies[0].devices[0].device_class = "wormhole_drive";
    expect(() => RandomFdsThemeSchema.parse(bad)).toThrow();
  });

  it("rejects a subsystem with zero assemblies", () => {
    const bad = structuredClone(valid);
    bad.subsystems[0].assemblies = [];
    expect(() => RandomFdsThemeSchema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/random/__tests__/theme-schema.test.ts`
Expected: FAIL — cannot resolve `../theme-schema`.

- [ ] **Step 3: Implement the schema**

```ts
// src/lib/spec-builder/random/theme-schema.ts
/**
 * Zod schema for the small theme JSON the AI returns in Stage 1 of the
 * random FDS builder. The AI provides names + prose only — every shape
 * that the V2 contract validator checks is built deterministically in
 * Stage 2.
 */
import { z } from "zod";

export const RandomFdsDeviceClassSchema = z.enum([
  "valve",
  "motor",
  "sensor_level",
  "sensor_pressure",
  "sensor_temperature",
  "sensor_weight",
  "sensor_flow",
  "sensor_position",
  "indicator",
  "transmitter",
  "filter",
  "conveyor",
  "hopper",
  "transporter",
  "dryer",
  "cooler",
  "push_button",
  "emergency_stop",
  "other",
]);
export type RandomFdsDeviceClass = z.infer<typeof RandomFdsDeviceClassSchema>;

export const RandomFdsDeviceSpecSchema = z.object({
  device_name: z.string().min(1),
  device_class: RandomFdsDeviceClassSchema,
  description: z.string(),
  is_safety: z.boolean(),
});
export type RandomFdsDeviceSpec = z.infer<typeof RandomFdsDeviceSpecSchema>;

export const RandomFdsAssemblySpecSchema = z.object({
  assembly_name: z.string().min(1),
  description: z.string(),
  devices: z.array(RandomFdsDeviceSpecSchema).min(1),
});
export type RandomFdsAssemblySpec = z.infer<typeof RandomFdsAssemblySpecSchema>;

export const RandomFdsSubsystemSpecSchema = z.object({
  subsystem_name: z.string().min(1),
  equipment_type: z.string().min(1),
  description: z.string(),
  assemblies: z.array(RandomFdsAssemblySpecSchema).min(1),
});
export type RandomFdsSubsystemSpec = z.infer<typeof RandomFdsSubsystemSpecSchema>;

export const RandomFdsThemeSchema = z.object({
  title: z.string().min(1),
  system_description: z.string(),
  plc_model: z.string(),
  hmi_type: z.string(),
  fault_philosophy: z.string(),
  design_principles: z.array(z.string()).min(1),
  machine_theme: z.string(),
  safety_classification: z.string().nullable(),
  subsystems: z.array(RandomFdsSubsystemSpecSchema).min(1),
});
export type RandomFdsTheme = z.infer<typeof RandomFdsThemeSchema>;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/spec-builder/random/__tests__/theme-schema.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/random/theme-schema.ts src/lib/spec-builder/random/__tests__/theme-schema.test.ts
git commit -m "$(cat <<'EOF'
feat(fds-engine): RandomFdsThemeSchema — Stage 1 AI envelope

Closed-set device_class enum + min(1) on every collection. The AI is
fenced into names/prose only; all schema-bound structure is built
deterministically in Stage 2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Theme prompt

**Files:**
- Create: `src/lib/spec-builder/random/theme-prompt.ts`

(No standalone test — content is exercised by the integration test in Task 9.)

- [ ] **Step 1: Implement the prompt**

```ts
// src/lib/spec-builder/random/theme-prompt.ts
/**
 * Stage 1 system prompt for the random FDS builder. Returns a small
 * RandomFdsTheme JSON. The AI MUST NOT emit anything else — no state
 * machine, no IO addresses, no sequences. Stage 2 builds all of that
 * deterministically.
 */

export interface RandomFdsThemeParams {
  subsystems: number;
  assemblies: number;
  devices: number;
}

export function buildRandomFdsThemePrompt(p: RandomFdsThemeParams): string {
  return `You are a senior design engineer at an industrial automation company. Your only job in this step is to invent a realistic machine and name its parts. A separate deterministic builder will produce all schema-bound structure (state machine, IO addresses, sequences, interlocks).

## Pick a machine

Choose ONE realistic industrial machine or system. Examples:
- Material handling (conveyors, palletisers, AS/RS, shuttle systems)
- Packaging lines (filling, capping, labelling, case packing)
- Process systems (mixing, batching, CIP, pasteurisation)
- Assembly (press fitting, screwing, welding stations)
- Treatment (coating, drying, curing, heat treatment)
- Food/bev (forming, baking, cooling, freezing)
- Pharma (tablet press, coating pan, blister packing)
- Plastics (extrusion, injection moulding, blow moulding)
- Metalwork (stamping, laser cutting, bending, deburring)

Pick something specific. Give it a realistic project title.

## Required counts

- Subsystems: exactly ${p.subsystems}
- Assemblies: exactly ${p.assemblies} total, distributed across subsystems (every subsystem must have at least 1)
- Devices: exactly ${p.devices} total, distributed across assemblies (every assembly must have at least 1)

## Device classes (use these exact strings)

valve, motor, sensor_level, sensor_pressure, sensor_temperature, sensor_weight, sensor_flow, sensor_position, indicator, transmitter, filter, conveyor, hopper, transporter, dryer, cooler, push_button, emergency_stop, other

## Equipment types (use these exact strings)

Hopper, Pneumatic Transporter, Dryer, Cooler, Unloading Station, Magnetic Filter, Fan/Blower, Milling, Conveyor, Other

## Output

Return ONLY this JSON, no markdown fences, no commentary:

{
  "title": "string",
  "system_description": "2–3 sentence system overview",
  "plc_model": "e.g. S7-1500 / CPU 1516-3 PN/DP",
  "hmi_type": "e.g. TP1200 Comfort",
  "fault_philosophy": "1–2 sentences (e.g. fault → controlled stop → operator reset)",
  "design_principles": ["3–5 short bullets"],
  "machine_theme": "short free-form flavour string (e.g. 'rotary tablet press', 'vertical lift')",
  "safety_classification": "string or null",
  "subsystems": [{
    "subsystem_name": "string",
    "equipment_type": "string (from list above)",
    "description": "1–2 sentence subsystem overview",
    "assemblies": [{
      "assembly_name": "string",
      "description": "1 sentence",
      "devices": [{
        "device_name": "string (ISA-style, e.g. 'Conveyor Motor M01')",
        "device_class": "string (from list above)",
        "description": "1 sentence",
        "is_safety": false
      }]
    }]
  }]
}

DO NOT include: state machine, operating states, alarm tiers, IO signals, IO addresses, sequences, steps, completion criteria, interlocks, or any field beyond the schema above.`;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/lib/spec-builder/random/theme-prompt.ts
git commit -m "$(cat <<'EOF'
feat(fds-engine): buildRandomFdsThemePrompt — Stage 1 AI prompt

Fences the AI to names/prose only — explicitly forbids state machine,
IO, sequences, interlocks. Stage 2 builds those deterministically.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Canonical state machine

**Files:**
- Create: `src/lib/spec-builder/random/state-machine.ts`
- Test: `src/lib/spec-builder/random/__tests__/state-machine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/spec-builder/random/__tests__/state-machine.test.ts
import { describe, expect, it } from "vitest";
import { OperatingStateV2Schema } from "@/types/spec-contract-v2";
import {
  CANONICAL_STATES,
  STATE_ID_IDLE,
  STATE_ID_STARTING,
  STATE_ID_EXECUTE,
  STATE_ID_STOPPING,
  STATE_ID_COMPLETE,
  STATE_ID_E_STOP,
  SEQUENTIAL_STATE_IDS,
} from "../state-machine";

describe("canonical state machine", () => {
  it("exposes PackML-numeric state ids", () => {
    expect(STATE_ID_IDLE).toBe(4);
    expect(STATE_ID_STARTING).toBe(3);
    expect(STATE_ID_EXECUTE).toBe(6);
    expect(STATE_ID_STOPPING).toBe(7);
    expect(STATE_ID_COMPLETE).toBe(17);
    expect(STATE_ID_E_STOP).toBe(9);
  });

  it("CANONICAL_STATES contains exactly 6 entries", () => {
    expect(CANONICAL_STATES).toHaveLength(6);
  });

  it("every canonical state passes OperatingStateV2Schema", () => {
    for (const s of CANONICAL_STATES) {
      expect(() => OperatingStateV2Schema.parse(s)).not.toThrow();
    }
  });

  it("every numeric state_id satisfies packml_id === state_id", () => {
    for (const s of CANONICAL_STATES) {
      expect(typeof s.state_id).toBe("number");
      expect(s.packml_id).toBe(s.state_id);
    }
  });

  it("SEQUENTIAL_STATE_IDS lists STARTING / EXECUTE / STOPPING", () => {
    expect(SEQUENTIAL_STATE_IDS).toEqual([
      STATE_ID_STARTING,
      STATE_ID_EXECUTE,
      STATE_ID_STOPPING,
    ]);
  });

  it("CANONICAL_STATES has 3 sequential and 3 static states", () => {
    const seq = CANONICAL_STATES.filter((s) => s.state_pattern === "sequential");
    const stat = CANONICAL_STATES.filter((s) => s.state_pattern === "static");
    expect(seq).toHaveLength(3);
    expect(stat).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/random/__tests__/state-machine.test.ts`
Expected: FAIL — cannot resolve `../state-machine`.

- [ ] **Step 3: Implement the state machine**

```ts
// src/lib/spec-builder/random/state-machine.ts
/**
 * Canonical PackML-aligned state machine for the random FDS builder.
 * IDs use PackML packml_id values so writeSpecContract's validator
 * accepts them (numeric state_id 1..17 must equal packml_id).
 */
import type { OperatingStateV2 } from "@/types/spec-contract-v2";

export const STATE_ID_STARTING = 3;
export const STATE_ID_IDLE = 4;
export const STATE_ID_EXECUTE = 6;
export const STATE_ID_STOPPING = 7;
export const STATE_ID_E_STOP = 9;
export const STATE_ID_COMPLETE = 17;

export const SEQUENTIAL_STATE_IDS = [
  STATE_ID_STARTING,
  STATE_ID_EXECUTE,
  STATE_ID_STOPPING,
] as const;

export const CANONICAL_STATES: OperatingStateV2[] = [
  {
    state_id: STATE_ID_IDLE,
    packml_id: STATE_ID_IDLE,
    display_name: "Idle",
    description: "All outputs de-energised; awaiting start command.",
    state_pattern: "static",
  },
  {
    state_id: STATE_ID_STARTING,
    packml_id: STATE_ID_STARTING,
    display_name: "Starting",
    description: "Sequential start-up of devices until the machine is ready to execute.",
    state_pattern: "sequential",
  },
  {
    state_id: STATE_ID_EXECUTE,
    packml_id: STATE_ID_EXECUTE,
    display_name: "Execute",
    description: "Primary production cycle.",
    state_pattern: "sequential",
  },
  {
    state_id: STATE_ID_STOPPING,
    packml_id: STATE_ID_STOPPING,
    display_name: "Stopping",
    description: "Sequential shutdown of devices to a safe resting state.",
    state_pattern: "sequential",
  },
  {
    state_id: STATE_ID_COMPLETE,
    packml_id: STATE_ID_COMPLETE,
    display_name: "Complete",
    description: "Cycle finished; awaiting reset.",
    state_pattern: "static",
  },
  {
    state_id: STATE_ID_E_STOP,
    packml_id: STATE_ID_E_STOP,
    display_name: "E-Stop",
    description: "Emergency stop active; all motion inhibited.",
    state_pattern: "static",
  },
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/spec-builder/random/__tests__/state-machine.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/random/state-machine.ts src/lib/spec-builder/random/__tests__/state-machine.test.ts
git commit -m "$(cat <<'EOF'
feat(fds-engine): canonical PackML state machine for random builder

Six states (IDLE/STARTING/EXECUTE/STOPPING/COMPLETE/E_STOP), numeric
state_id = packml_id so writeSpecContract's PackML invariant validator
accepts them as-is.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: IO allocator

**Files:**
- Create: `src/lib/spec-builder/random/io-allocator.ts`
- Test: `src/lib/spec-builder/random/__tests__/io-allocator.test.ts`

The allocator hands out non-overlapping Siemens IO addresses. Each subsystem is given a non-overlapping byte range for DI/DO and a non-overlapping word range for AI/AO. Within a subsystem we walk devices in order and bump bit/word offsets as signals are emitted.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/spec-builder/random/__tests__/io-allocator.test.ts
import { describe, expect, it } from "vitest";
import { createIoAllocator } from "../io-allocator";

describe("createIoAllocator", () => {
  it("allocates DI addresses in %I<byte>.<bit> form starting at the subsystem's DI base", () => {
    const alloc = createIoAllocator({ subsystemIndex: 0, diBase: 0, doBase: 0, aiBase: 64, aoBase: 80 });
    expect(alloc.next("DI")).toBe("%I0.0");
    expect(alloc.next("DI")).toBe("%I0.1");
    expect(alloc.next("DI")).toBe("%I0.2");
  });

  it("rolls over from bit 7 to the next byte", () => {
    const alloc = createIoAllocator({ subsystemIndex: 0, diBase: 0, doBase: 0, aiBase: 64, aoBase: 80 });
    for (let i = 0; i < 8; i++) alloc.next("DI");
    expect(alloc.next("DI")).toBe("%I1.0");
  });

  it("allocates AI in %IW<word> form, incrementing by 2", () => {
    const alloc = createIoAllocator({ subsystemIndex: 0, diBase: 0, doBase: 0, aiBase: 64, aoBase: 80 });
    expect(alloc.next("AI")).toBe("%IW64");
    expect(alloc.next("AI")).toBe("%IW66");
  });

  it("DI/DO/AI/AO are independent counters", () => {
    const alloc = createIoAllocator({ subsystemIndex: 0, diBase: 0, doBase: 0, aiBase: 64, aoBase: 80 });
    expect(alloc.next("DI")).toBe("%I0.0");
    expect(alloc.next("DO")).toBe("%Q0.0");
    expect(alloc.next("AI")).toBe("%IW64");
    expect(alloc.next("AO")).toBe("%QW80");
  });

  it("two subsystems get disjoint address spaces", () => {
    const a = createIoAllocator({ subsystemIndex: 0, diBase: 0, doBase: 0, aiBase: 64, aoBase: 80 });
    const b = createIoAllocator({ subsystemIndex: 1, diBase: 16, doBase: 16, aiBase: 128, aoBase: 144 });
    const aAddrs = new Set<string>();
    const bAddrs = new Set<string>();
    for (let i = 0; i < 8; i++) {
      aAddrs.add(a.next("DI"));
      bAddrs.add(b.next("DI"));
    }
    for (const addr of aAddrs) expect(bAddrs.has(addr)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/random/__tests__/io-allocator.test.ts`
Expected: FAIL — cannot resolve `../io-allocator`.

- [ ] **Step 3: Implement the allocator**

```ts
// src/lib/spec-builder/random/io-allocator.ts
/**
 * Siemens IO address allocator. Each subsystem gets its own byte/word
 * base; within a subsystem we walk DI/DO bit-by-bit and AI/AO word-by-
 * word. Bases are computed by the caller (assemble.ts) so they're
 * disjoint across subsystems.
 */

export type IoSignalKind = "DI" | "DO" | "AI" | "AO";

export interface IoAllocatorBases {
  subsystemIndex: number;
  diBase: number; // byte
  doBase: number; // byte
  aiBase: number; // word
  aoBase: number; // word
}

export interface IoAllocator {
  next(kind: IoSignalKind): string;
}

interface BitCursor {
  byte: number;
  bit: number;
}

function bumpBit(c: BitCursor): void {
  c.bit += 1;
  if (c.bit > 7) {
    c.bit = 0;
    c.byte += 1;
  }
}

export function createIoAllocator(bases: IoAllocatorBases): IoAllocator {
  const diCursor: BitCursor = { byte: bases.diBase, bit: 0 };
  const doCursor: BitCursor = { byte: bases.doBase, bit: 0 };
  let aiWord = bases.aiBase;
  let aoWord = bases.aoBase;

  return {
    next(kind) {
      switch (kind) {
        case "DI": {
          const addr = `%I${diCursor.byte}.${diCursor.bit}`;
          bumpBit(diCursor);
          return addr;
        }
        case "DO": {
          const addr = `%Q${doCursor.byte}.${doCursor.bit}`;
          bumpBit(doCursor);
          return addr;
        }
        case "AI": {
          const addr = `%IW${aiWord}`;
          aiWord += 2;
          return addr;
        }
        case "AO": {
          const addr = `%QW${aoWord}`;
          aoWord += 2;
          return addr;
        }
      }
    },
  };
}

/**
 * Compute disjoint per-subsystem IO bases given subsystem count.
 * Each subsystem reserves 16 bytes of DI, 16 bytes of DO, 32 words of
 * AI (64 bytes), 32 words of AO (64 bytes). 8 subsystems × 16 bytes
 * fits comfortably inside an S7-1500's process image.
 */
export function computeSubsystemBases(subsystemIndex: number): IoAllocatorBases {
  return {
    subsystemIndex,
    diBase: subsystemIndex * 16,
    doBase: subsystemIndex * 16,
    aiBase: 64 + subsystemIndex * 64,
    aoBase: 80 + subsystemIndex * 64,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/spec-builder/random/__tests__/io-allocator.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/random/io-allocator.ts src/lib/spec-builder/random/__tests__/io-allocator.test.ts
git commit -m "$(cat <<'EOF'
feat(fds-engine): Siemens IO address allocator for random builder

Per-subsystem disjoint byte/word ranges (16 bytes DI/DO + 32 words
AI/AO per subsystem). Within a subsystem, walks bit-by-bit / word-by-
word so generated addresses are deterministic and collision-free.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Device templates

**Files:**
- Create: `src/lib/spec-builder/random/device-templates.ts`
- Test: `src/lib/spec-builder/random/__tests__/device-templates.test.ts`

Each device class maps to a list of IO signal slots (kind + suffix + description) and a small library of step templates per sequential state. The step templates use semantic placeholders (e.g. `{cmd}`, `{fb}`, `{fault}`) which are resolved to real tag names by the sequence builder.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/spec-builder/random/__tests__/device-templates.test.ts
import { describe, expect, it } from "vitest";
import { DEVICE_TEMPLATES, type DeviceTemplate } from "../device-templates";
import { RandomFdsDeviceClassSchema } from "../theme-schema";

describe("device templates", () => {
  it("covers every RandomFdsDeviceClass enum value", () => {
    const classes = RandomFdsDeviceClassSchema.options;
    for (const cls of classes) {
      expect(DEVICE_TEMPLATES[cls], `template for ${cls}`).toBeDefined();
    }
  });

  it("every template has at least one IO signal slot", () => {
    for (const [cls, tpl] of Object.entries(DEVICE_TEMPLATES) as [string, DeviceTemplate][]) {
      expect(tpl.ioSlots.length, `${cls}.ioSlots`).toBeGreaterThan(0);
    }
  });

  it("every IO slot uses a valid IO kind", () => {
    for (const tpl of Object.values(DEVICE_TEMPLATES)) {
      for (const slot of tpl.ioSlots) {
        expect(["DI", "DO", "AI", "AO"]).toContain(slot.kind);
      }
    }
  });

  it("every step template only references slot suffixes that exist on the device", () => {
    for (const [cls, tpl] of Object.entries(DEVICE_TEMPLATES) as [string, DeviceTemplate][]) {
      const knownSuffixes = new Set(tpl.ioSlots.map((s) => s.suffix));
      for (const [stateKey, steps] of Object.entries(tpl.stepTemplates)) {
        for (const step of steps) {
          for (const ref of step.referencedSuffixes) {
            expect(
              knownSuffixes.has(ref),
              `${cls}.stepTemplates[${stateKey}] references unknown suffix ${ref}`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("motor template has at least one Starting and one Stopping step", () => {
    const motor = DEVICE_TEMPLATES.motor;
    expect(motor.stepTemplates.STARTING.length).toBeGreaterThan(0);
    expect(motor.stepTemplates.STOPPING.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/random/__tests__/device-templates.test.ts`
Expected: FAIL — cannot resolve `../device-templates`.

- [ ] **Step 3: Implement the templates**

```ts
// src/lib/spec-builder/random/device-templates.ts
/**
 * Per-device-class IO + step shape library. The sequence builder
 * resolves the semantic slot suffixes to real tag names per device
 * (e.g. "{CMD}" → "CV01_M01_CMD") and uses these step templates to
 * populate sequential states deterministically.
 */
import type { IoSignalKind } from "./io-allocator";
import type { RandomFdsDeviceClass } from "./theme-schema";

export type StateKey = "STARTING" | "EXECUTE" | "STOPPING";

export interface IoSlot {
  /** Tag suffix appended to the device prefix, e.g. "CMD" → "<dev>_CMD". */
  suffix: string;
  kind: IoSignalKind;
  description: string;
}

export interface DeviceStepTemplate {
  name: string;
  action: string;
  /** Suffixes referenced by this step — used by sequence builder to
   *  produce completion_criteria and validated by device-templates.test. */
  referencedSuffixes: string[];
  /**
   * Optional completion criterion shape. The sequence builder uses
   * "tag_equals" against the named suffix and the given value.
   */
  completion: {
    suffix: string;
    value: boolean;
    within_ms: number;
  };
}

export interface DeviceTemplate {
  ioSlots: IoSlot[];
  /** Empty list = no contribution from this device class in that state. */
  stepTemplates: Record<StateKey, DeviceStepTemplate[]>;
}

// ---------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------

const motor: DeviceTemplate = {
  ioSlots: [
    { suffix: "CMD", kind: "DO", description: "Run command" },
    { suffix: "FB_RUN", kind: "DI", description: "Running feedback" },
    { suffix: "FAULT", kind: "DI", description: "Drive fault" },
  ],
  stepTemplates: {
    STARTING: [
      {
        name: "Energise motor",
        action: "Set {CMD} = TRUE",
        referencedSuffixes: ["CMD", "FB_RUN"],
        completion: { suffix: "FB_RUN", value: true, within_ms: 3000 },
      },
    ],
    EXECUTE: [],
    STOPPING: [
      {
        name: "De-energise motor",
        action: "Set {CMD} = FALSE",
        referencedSuffixes: ["CMD", "FB_RUN"],
        completion: { suffix: "FB_RUN", value: false, within_ms: 3000 },
      },
    ],
  },
};

const valve: DeviceTemplate = {
  ioSlots: [
    { suffix: "CMD", kind: "DO", description: "Solenoid command" },
    { suffix: "FB_OPEN", kind: "DI", description: "Open position feedback" },
    { suffix: "FB_CLOSED", kind: "DI", description: "Closed position feedback" },
  ],
  stepTemplates: {
    STARTING: [
      {
        name: "Open valve",
        action: "Set {CMD} = TRUE",
        referencedSuffixes: ["CMD", "FB_OPEN"],
        completion: { suffix: "FB_OPEN", value: true, within_ms: 2000 },
      },
    ],
    EXECUTE: [],
    STOPPING: [
      {
        name: "Close valve",
        action: "Set {CMD} = FALSE",
        referencedSuffixes: ["CMD", "FB_CLOSED"],
        completion: { suffix: "FB_CLOSED", value: true, within_ms: 2000 },
      },
    ],
  },
};

const conveyor: DeviceTemplate = {
  ioSlots: [
    { suffix: "CMD", kind: "DO", description: "Belt run command" },
    { suffix: "FB_RUN", kind: "DI", description: "Belt running feedback" },
    { suffix: "FAULT", kind: "DI", description: "Drive fault" },
  ],
  stepTemplates: {
    STARTING: [
      {
        name: "Start belt",
        action: "Set {CMD} = TRUE",
        referencedSuffixes: ["CMD", "FB_RUN"],
        completion: { suffix: "FB_RUN", value: true, within_ms: 3000 },
      },
    ],
    EXECUTE: [],
    STOPPING: [
      {
        name: "Stop belt",
        action: "Set {CMD} = FALSE",
        referencedSuffixes: ["CMD", "FB_RUN"],
        completion: { suffix: "FB_RUN", value: false, within_ms: 3000 },
      },
    ],
  },
};

const transporter: DeviceTemplate = {
  ioSlots: [
    { suffix: "CMD", kind: "DO", description: "Run command" },
    { suffix: "FB_RUN", kind: "DI", description: "Running feedback" },
    { suffix: "AT_DEST", kind: "DI", description: "Reached destination" },
  ],
  stepTemplates: {
    STARTING: [
      {
        name: "Energise transporter",
        action: "Set {CMD} = TRUE",
        referencedSuffixes: ["CMD", "FB_RUN"],
        completion: { suffix: "FB_RUN", value: true, within_ms: 5000 },
      },
    ],
    EXECUTE: [],
    STOPPING: [
      {
        name: "De-energise transporter",
        action: "Set {CMD} = FALSE",
        referencedSuffixes: ["CMD", "FB_RUN"],
        completion: { suffix: "FB_RUN", value: false, within_ms: 5000 },
      },
    ],
  },
};

const dryer: DeviceTemplate = {
  ioSlots: [
    { suffix: "CMD", kind: "DO", description: "Heater command" },
    { suffix: "TEMP", kind: "AI", description: "Temperature feedback" },
  ],
  stepTemplates: {
    STARTING: [
      {
        name: "Energise heater",
        action: "Set {CMD} = TRUE",
        referencedSuffixes: ["CMD"],
        completion: { suffix: "CMD", value: true, within_ms: 1000 },
      },
    ],
    EXECUTE: [],
    STOPPING: [
      {
        name: "De-energise heater",
        action: "Set {CMD} = FALSE",
        referencedSuffixes: ["CMD"],
        completion: { suffix: "CMD", value: false, within_ms: 1000 },
      },
    ],
  },
};

const cooler: DeviceTemplate = {
  ioSlots: [
    { suffix: "CMD", kind: "DO", description: "Cooler command" },
    { suffix: "TEMP", kind: "AI", description: "Temperature feedback" },
  ],
  stepTemplates: {
    STARTING: [
      {
        name: "Energise cooler",
        action: "Set {CMD} = TRUE",
        referencedSuffixes: ["CMD"],
        completion: { suffix: "CMD", value: true, within_ms: 1000 },
      },
    ],
    EXECUTE: [],
    STOPPING: [
      {
        name: "De-energise cooler",
        action: "Set {CMD} = FALSE",
        referencedSuffixes: ["CMD"],
        completion: { suffix: "CMD", value: false, within_ms: 1000 },
      },
    ],
  },
};

// Sensors / passive devices contribute IO only, no step templates.
const sensorDi = (descr: string): DeviceTemplate => ({
  ioSlots: [{ suffix: "STATE", kind: "DI", description: descr }],
  stepTemplates: { STARTING: [], EXECUTE: [], STOPPING: [] },
});

const sensorAi = (descr: string): DeviceTemplate => ({
  ioSlots: [{ suffix: "PV", kind: "AI", description: descr }],
  stepTemplates: { STARTING: [], EXECUTE: [], STOPPING: [] },
});

const passiveDo = (descr: string): DeviceTemplate => ({
  ioSlots: [{ suffix: "CMD", kind: "DO", description: descr }],
  stepTemplates: { STARTING: [], EXECUTE: [], STOPPING: [] },
});

// ---------------------------------------------------------------------
// Registry — every RandomFdsDeviceClass enum value must appear here
// ---------------------------------------------------------------------

export const DEVICE_TEMPLATES: Record<RandomFdsDeviceClass, DeviceTemplate> = {
  valve,
  motor,
  sensor_level: sensorAi("Level transmitter reading"),
  sensor_pressure: sensorAi("Pressure transmitter reading"),
  sensor_temperature: sensorAi("Temperature transmitter reading"),
  sensor_weight: sensorAi("Load cell reading"),
  sensor_flow: sensorAi("Flow transmitter reading"),
  sensor_position: sensorDi("Position switch state"),
  indicator: passiveDo("Indicator output"),
  transmitter: sensorAi("Process value transmitter"),
  filter: sensorDi("Filter differential pressure switch"),
  conveyor,
  hopper: sensorDi("Hopper low-level switch"),
  transporter,
  dryer,
  cooler,
  push_button: sensorDi("Push-button state"),
  emergency_stop: sensorDi("E-stop circuit state"),
  other: sensorDi("Generic input"),
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/spec-builder/random/__tests__/device-templates.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/random/device-templates.ts src/lib/spec-builder/random/__tests__/device-templates.test.ts
git commit -m "$(cat <<'EOF'
feat(fds-engine): device-class templates for random builder

Each RandomFdsDeviceClass maps to IO slots + per-state step templates
with semantic suffix refs. Sequence builder resolves suffixes to real
tag names per device.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Sequence builder

**Files:**
- Create: `src/lib/spec-builder/random/sequence-builder.ts`
- Test: `src/lib/spec-builder/random/__tests__/sequence-builder.test.ts`

Builds V2 `AssemblyContract` records (static + sequential states) per assembly. Inputs: resolved hierarchy with real tag names. Output: `Record<assemblyId, AssemblyContract>`, ready for the `assemblies` slot of `SpecContractPatch`.

Key behaviours:
- Sequential state walk: produces `StepV2[]` with both v1 fields (`step`, `action`, `completion_criteria`, `completion_criteria_text`) and v2 fields (`step_id`, `branch_id`, `actions`, `transitions`). The transition from step N to N+1 is `kind: "single"`, `is_default: true`. The last step has no transition.
- Static states: empty `devices: []` for IDLE / COMPLETE / E_STOP — by-design simplification for the fixture generator.
- Belt-and-braces: every produced `AssemblyContract` is `.parse()`d against `AssemblyContractSchema` before return; failure throws with the offending assembly id.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/spec-builder/random/__tests__/sequence-builder.test.ts
import { describe, expect, it } from "vitest";
import { AssemblyContractSchema, StepV2Schema } from "@/types/spec-contract-v2";
import { buildAssemblyContracts, type ResolvedAssembly, type ResolvedDevice } from "../sequence-builder";

function dev(id: string, name: string, deviceClass: string, prefix: string): ResolvedDevice {
  return {
    device_id: id,
    device_name: name,
    device_class: deviceClass as ResolvedDevice["device_class"],
    description: "",
    is_safety: false,
    tag_prefix: prefix,
    io_signals: [
      { tag: `${prefix}_CMD`, suffix: "CMD", kind: "DO", io_address: "%Q0.0", description: "" },
      { tag: `${prefix}_FB_RUN`, suffix: "FB_RUN", kind: "DI", io_address: "%I0.0", description: "" },
      { tag: `${prefix}_FAULT`, suffix: "FAULT", kind: "DI", io_address: "%I0.1", description: "" },
    ],
  };
}

function asm(id: string, name: string, devices: ResolvedDevice[]): ResolvedAssembly {
  return { assembly_id: id, assembly_name: name, subsystem_id: "00000000-0000-0000-0000-0000000000ff", devices };
}

describe("buildAssemblyContracts", () => {
  const aId = "00000000-0000-0000-0000-000000000001";
  const inputs: ResolvedAssembly[] = [
    asm(aId, "CV01", [dev("00000000-0000-0000-0000-000000000aaa", "M01", "motor", "CV01_M01")]),
  ];

  it("produces an AssemblyContract per assembly that passes Zod", () => {
    const out = buildAssemblyContracts(inputs);
    expect(out[aId]).toBeDefined();
    expect(() => AssemblyContractSchema.parse(out[aId])).not.toThrow();
  });

  it("STARTING sequence contains a step that targets the motor's FB_RUN tag with tag_equals=true", () => {
    const out = buildAssemblyContracts(inputs);
    const starting = out[aId].sequential_states["3"]; // STATE_ID_STARTING
    expect(starting).toBeDefined();
    expect(starting.steps.length).toBeGreaterThan(0);
    const step = starting.steps[0];
    expect(step.completion_criteria.length).toBeGreaterThan(0);
    const crit = step.completion_criteria[0];
    expect(crit.kind).toBe("tag_equals");
    if (crit.kind === "tag_equals") {
      expect(crit.tag).toBe("CV01_M01_FB_RUN");
      expect(crit.value).toBe(true);
    }
  });

  it("every step has both v1 and v2 fields populated", () => {
    const out = buildAssemblyContracts(inputs);
    const starting = out[aId].sequential_states["3"];
    for (const step of starting.steps) {
      expect(step.step).toBeTypeOf("number");
      expect(step.action).toBeTypeOf("string");
      expect(step.completion_criteria_text).toBeTypeOf("string");
      expect(step.step_id).toBeTypeOf("string");
      expect(step.branch_id).toBeTypeOf("string");
      expect(Array.isArray(step.actions)).toBe(true);
      expect(Array.isArray(step.transitions)).toBe(true);
      expect(() => StepV2Schema.parse(step)).not.toThrow();
    }
  });

  it("non-terminal steps have a single transition with is_default=true to the next step_id", () => {
    const twoDevices: ResolvedAssembly[] = [
      asm(aId, "CV01", [
        dev("00000000-0000-0000-0000-000000000aaa", "M01", "motor", "CV01_M01"),
        dev("00000000-0000-0000-0000-000000000bbb", "M02", "motor", "CV01_M02"),
      ]),
    ];
    const out = buildAssemblyContracts(twoDevices);
    const steps = out[aId].sequential_states["3"].steps;
    expect(steps.length).toBeGreaterThanOrEqual(2);
    const first = steps[0];
    expect(first.transitions).toHaveLength(1);
    const t = first.transitions![0];
    expect(t.kind).toBe("single");
    expect(t.is_default).toBe(true);
    if (t.kind === "single") expect(t.target_step_id).toBe(steps[1].step_id);
  });

  it("the last step in a sequence has no transitions", () => {
    const out = buildAssemblyContracts(inputs);
    const steps = out[aId].sequential_states["3"].steps;
    const last = steps[steps.length - 1];
    expect(last.transitions ?? []).toHaveLength(0);
  });

  it("static states IDLE / COMPLETE / E_STOP exist with empty devices arrays (StaticStateV2 shape)", () => {
    const out = buildAssemblyContracts(inputs);
    for (const k of ["4", "17", "8"]) {
      const s = out[aId].static_states[k];
      expect(s).toBeDefined();
      // StaticStateV2 shape, not bare DeviceStateEntry[]
      expect(Array.isArray(s)).toBe(false);
      if (!Array.isArray(s)) expect(s.devices).toEqual([]);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/random/__tests__/sequence-builder.test.ts`
Expected: FAIL — cannot resolve `../sequence-builder`.

- [ ] **Step 3: Implement the builder**

```ts
// src/lib/spec-builder/random/sequence-builder.ts
/**
 * Builds V2 AssemblyContract records (static + sequential states) per
 * assembly from resolved hierarchy + device IO. Each produced contract
 * is Zod-validated before return so a builder bug fails loudly here
 * rather than silently at insert time.
 */
import {
  AssemblyContractSchema,
  type AssemblyContract,
  type CompletionCriterion,
  type SequentialStateV2,
  type StaticStateV2,
  type StepV2,
  type TransitionV2,
  type ActionV2,
} from "@/types/spec-contract-v2";
import type { IoSignalKind } from "./io-allocator";
import type { RandomFdsDeviceClass } from "./theme-schema";
import { DEVICE_TEMPLATES, type StateKey } from "./device-templates";
import {
  STATE_ID_IDLE,
  STATE_ID_STARTING,
  STATE_ID_EXECUTE,
  STATE_ID_STOPPING,
  STATE_ID_COMPLETE,
  STATE_ID_E_STOP,
} from "./state-machine";

export interface ResolvedIoSignal {
  tag: string;
  suffix: string;
  kind: IoSignalKind;
  io_address: string;
  description: string;
}

export interface ResolvedDevice {
  device_id: string;
  device_name: string;
  device_class: RandomFdsDeviceClass;
  description: string;
  is_safety: boolean;
  /** Short tag prefix derived from assembly + device names, e.g. "CV01_M01". */
  tag_prefix: string;
  io_signals: ResolvedIoSignal[];
}

export interface ResolvedAssembly {
  assembly_id: string;
  assembly_name: string;
  subsystem_id: string;
  devices: ResolvedDevice[];
}

const STATE_KEY_TO_ID: Record<StateKey, number> = {
  STARTING: STATE_ID_STARTING,
  EXECUTE: STATE_ID_EXECUTE,
  STOPPING: STATE_ID_STOPPING,
};

function findIo(device: ResolvedDevice, suffix: string): ResolvedIoSignal | undefined {
  return device.io_signals.find((s) => s.suffix === suffix);
}

function buildSteps(assembly: ResolvedAssembly, stateKey: StateKey): StepV2[] {
  // For each device, append its step templates to the assembly's step list.
  // Step numbers are 1-based within the state. step_id = "<state>-<n>".
  const stateId = STATE_KEY_TO_ID[stateKey];
  const branchId = `b-${assembly.assembly_id}-${stateId}-main`;

  const collected: Array<{
    deviceTagPrefix: string;
    deviceName: string;
    template: ReturnType<typeof DEVICE_TEMPLATES.motor.stepTemplates.STARTING.at>;
    device: ResolvedDevice;
  }> = [];
  for (const dev of assembly.devices) {
    const tpl = DEVICE_TEMPLATES[dev.device_class];
    for (const step of tpl.stepTemplates[stateKey]) {
      collected.push({ deviceTagPrefix: dev.tag_prefix, deviceName: dev.device_name, template: step, device: dev });
    }
  }

  const built: StepV2[] = collected.map((c, idx) => {
    if (!c.template) throw new Error("step template missing");
    const tpl = c.template;
    const stepNumber = idx + 1;
    const stepId = `s-${stateId}-${stepNumber}`;

    // Resolve the completion criterion suffix → real tag
    const compIo = findIo(c.device, tpl.completion.suffix);
    if (!compIo) {
      throw new Error(
        `sequence-builder: device ${c.deviceTagPrefix} missing IO slot ${tpl.completion.suffix} for state ${stateKey}`,
      );
    }
    const criterion: CompletionCriterion = {
      kind: "tag_equals",
      tag: compIo.tag,
      value: tpl.completion.value,
      within_ms: tpl.completion.within_ms,
      on_fail: {
        fault_code: `F_${c.deviceTagPrefix}_TIMEOUT`,
        severity: "fault",
      },
    };

    // Resolve action prose (replace {SUFFIX} placeholders)
    const actionText = tpl.action.replace(/\{([A-Z_]+)\}/g, (_, suf: string) => {
      const io = findIo(c.device, suf);
      return io ? io.tag : `{${suf}}`;
    });

    // Build a single ActionV2 (manual_prose flavour — keeps the AI out of action structure)
    const action: ActionV2 = {
      kind: "manual_prose",
      action_id: `a-${stateId}-${stepNumber}-1`,
      text: actionText,
      referenced_tags: tpl.referencedSuffixes
        .map((s) => findIo(c.device, s)?.tag)
        .filter((t): t is string => Boolean(t)),
      prose: actionText,
    };

    return {
      // v2 SFC fields
      step_id: stepId,
      branch_id: branchId,
      name: `${c.deviceName}: ${tpl.name}`,
      actions: [action],
      monitors: [],
      transitions: [], // filled below
      // v1 legacy fields (still required by the schema during the shim window)
      step: stepNumber,
      action: actionText,
      completion_criteria: [criterion],
      completion_criteria_text: `${compIo.tag} = ${tpl.completion.value} within ${tpl.completion.within_ms}ms, else fault — ${c.deviceName} ${tpl.name.toLowerCase()} timeout`,
      on_fail: criterion.on_fail,
    };
  });

  // Wire transitions: every step except the last has a single default
  // transition to the next step.
  for (let i = 0; i < built.length - 1; i++) {
    const trans: TransitionV2 = {
      transition_id: `t-${stateId}-${i + 1}-to-${i + 2}`,
      kind: "single",
      target_step_id: built[i + 1].step_id!,
      guard: [],
      priority: 0,
      is_default: true,
      notes: null,
    };
    built[i].transitions = [trans];
  }

  return built;
}

function buildSequentialState(
  assembly: ResolvedAssembly,
  stateKey: StateKey,
): SequentialStateV2 {
  return {
    override_kind: "override",
    permissives: [],
    steps: buildSteps(assembly, stateKey),
    branches: [],
    state_monitors: [],
    sequence_model_version: 2,
    notes: null,
  };
}

function emptyStatic(): StaticStateV2 {
  return { override_kind: "override", devices: [], notes: null };
}

export function buildAssemblyContracts(
  assemblies: ResolvedAssembly[],
): Record<string, AssemblyContract> {
  const out: Record<string, AssemblyContract> = {};
  for (const asm of assemblies) {
    const contract: AssemblyContract = {
      assembly_id: asm.assembly_id,
      subsystem_id: asm.subsystem_id,
      static_states: {
        [String(STATE_ID_IDLE)]: emptyStatic(),
        [String(STATE_ID_COMPLETE)]: emptyStatic(),
        [String(STATE_ID_E_STOP)]: emptyStatic(),
      },
      sequential_states: {
        [String(STATE_ID_STARTING)]: buildSequentialState(asm, "STARTING"),
        [String(STATE_ID_EXECUTE)]: buildSequentialState(asm, "EXECUTE"),
        [String(STATE_ID_STOPPING)]: buildSequentialState(asm, "STOPPING"),
      },
    };
    // Belt-and-braces — fail loudly here, not at insert time.
    const parsed = AssemblyContractSchema.safeParse(contract);
    if (!parsed.success) {
      throw new Error(
        `sequence-builder: assembly ${asm.assembly_id} contract failed Zod parse:\n${parsed.error.message}`,
      );
    }
    out[asm.assembly_id] = parsed.data;
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/spec-builder/random/__tests__/sequence-builder.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/random/sequence-builder.ts src/lib/spec-builder/random/__tests__/sequence-builder.test.ts
git commit -m "$(cat <<'EOF'
feat(fds-engine): V2 AssemblyContract builder for random builder

Per-device step templates → StepV2[] with both v1 and v2 fields, single
default transitions, tag_equals completion criteria, manual_prose
actions. AssemblyContractSchema.parse before return.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Orchestration builder

**Files:**
- Create: `src/lib/spec-builder/random/orchestration-builder.ts`
- Test: `src/lib/spec-builder/random/__tests__/orchestration-builder.test.ts`

Builds `Record<subsystemId, Record<stateId, SubsystemStateSequence>>` for the `orchestrations` slot of `SpecContractPatch`. Canonical rules:

- One `SharedPermissive` per subsystem per sequential state: `E_STOP_CLEAR_<subsystem_id>` (tag_equals with value=true).
- One `InterAssemblyInterlock` per adjacent assembly pair in declaration order — `effect: "enable"`, `source_condition: tag_equals(<upstream-first-device>_FB_RUN, true)`, `effect_target: { assembly: downstream, state_id: 3 (STARTING) }`. (No AT_HOME tag is allocated — using the first device's run feedback keeps the rule deterministic with real tags that always exist.)
- Single-assembly subsystems produce no interlocks (only the shared permissive).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/spec-builder/random/__tests__/orchestration-builder.test.ts
import { describe, expect, it } from "vitest";
import { SubsystemStateSequenceSchema } from "@/types/spec-contract-v2";
import { buildOrchestrations, type OrchestrationInput } from "../orchestration-builder";

const SUB_A = "00000000-0000-0000-0000-0000000000a1";
const ASM_A1 = "00000000-0000-0000-0000-0000000000b1";
const ASM_A2 = "00000000-0000-0000-0000-0000000000b2";
const ASM_A3 = "00000000-0000-0000-0000-0000000000b3";
const SUB_B = "00000000-0000-0000-0000-0000000000a2";
const ASM_B1 = "00000000-0000-0000-0000-0000000000c1";

const inputs: OrchestrationInput[] = [
  {
    subsystem_id: SUB_A,
    assemblies: [
      { assembly_id: ASM_A1, first_device_run_tag: "CV01_M01_FB_RUN" },
      { assembly_id: ASM_A2, first_device_run_tag: "LFT01_M01_FB_RUN" },
      { assembly_id: ASM_A3, first_device_run_tag: "OUT01_M01_FB_RUN" },
    ],
  },
  { subsystem_id: SUB_B, assemblies: [{ assembly_id: ASM_B1, first_device_run_tag: "X_FB_RUN" }] },
];

describe("buildOrchestrations", () => {
  it("emits one entry per subsystem", () => {
    const out = buildOrchestrations(inputs);
    expect(Object.keys(out)).toHaveLength(2);
  });

  it("emits a SubsystemStateSequence for each sequential state per subsystem", () => {
    const out = buildOrchestrations(inputs);
    const a = out[SUB_A];
    expect(Object.keys(a).sort()).toEqual(["3", "6", "7"]); // STARTING, EXECUTE, STOPPING
  });

  it("multi-assembly subsystems get an interlock per adjacent pair", () => {
    const out = buildOrchestrations(inputs);
    const a3 = out[SUB_A]["3"];
    expect(a3.inter_assembly_interlocks).toHaveLength(2);
    expect(a3.inter_assembly_interlocks[0].source_assembly).toBe(ASM_A1);
    expect(a3.inter_assembly_interlocks[0].target_assembly).toBe(ASM_A2);
    expect(a3.inter_assembly_interlocks[1].source_assembly).toBe(ASM_A2);
    expect(a3.inter_assembly_interlocks[1].target_assembly).toBe(ASM_A3);
  });

  it("single-assembly subsystems get no interlocks", () => {
    const out = buildOrchestrations(inputs);
    expect(out[SUB_B]["3"].inter_assembly_interlocks).toHaveLength(0);
  });

  it("every sequential state has exactly one shared permissive", () => {
    const out = buildOrchestrations(inputs);
    for (const [, states] of Object.entries(out)) {
      for (const seq of Object.values(states)) {
        expect(seq.shared_permissives).toHaveLength(1);
      }
    }
  });

  it("every produced SubsystemStateSequence passes Zod", () => {
    const out = buildOrchestrations(inputs);
    for (const states of Object.values(out)) {
      for (const seq of Object.values(states)) {
        expect(() => SubsystemStateSequenceSchema.parse(seq)).not.toThrow();
      }
    }
  });

  it("interlock effect is 'enable' targeting STARTING (state_id 3)", () => {
    const out = buildOrchestrations(inputs);
    const il = out[SUB_A]["3"].inter_assembly_interlocks[0];
    expect(il.effect).toBe("enable");
    expect(il.effect_target?.state_id).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/random/__tests__/orchestration-builder.test.ts`
Expected: FAIL — cannot resolve `../orchestration-builder`.

- [ ] **Step 3: Implement the builder**

```ts
// src/lib/spec-builder/random/orchestration-builder.ts
/**
 * Builds the orchestrations slot of SpecContractPatch from resolved
 * subsystem/assembly inputs. Applies two canonical rules:
 *   - One SharedPermissive per subsystem per sequential state.
 *   - One InterAssemblyInterlock per adjacent assembly pair (none for
 *     single-assembly subsystems).
 */
import {
  SubsystemStateSequenceSchema,
  type SubsystemStateSequence,
  type SharedPermissive,
  type InterAssemblyInterlock,
} from "@/types/spec-contract-v2";
import { SEQUENTIAL_STATE_IDS, STATE_ID_STARTING } from "./state-machine";

export interface OrchestrationAssemblyInput {
  assembly_id: string;
  /** First device's run-feedback tag — used as the interlock source condition. */
  first_device_run_tag: string;
}

export interface OrchestrationInput {
  subsystem_id: string;
  assemblies: OrchestrationAssemblyInput[];
}

function buildSharedPermissive(subsystemId: string): SharedPermissive {
  return {
    permissive_id: `perm-${subsystemId}-estop`,
    condition: {
      kind: "tag_equals",
      tag: `E_STOP_CLEAR_${subsystemId.slice(0, 8)}`,
      value: true,
    },
    source_subsystem: subsystemId,
    prose: "Subsystem E-stop circuit clear",
  };
}

function buildInterlocks(input: OrchestrationInput): InterAssemblyInterlock[] {
  const out: InterAssemblyInterlock[] = [];
  for (let i = 0; i < input.assemblies.length - 1; i++) {
    const src = input.assemblies[i];
    const tgt = input.assemblies[i + 1];
    out.push({
      interlock_id: `il-${input.subsystem_id.slice(0, 8)}-${i}`,
      source_assembly: src.assembly_id,
      source_condition: {
        kind: "tag_equals",
        tag: src.first_device_run_tag,
        value: true,
      },
      target_assembly: tgt.assembly_id,
      effect: "enable",
      effect_target: { assembly: tgt.assembly_id, state_id: STATE_ID_STARTING },
      prose: `Upstream assembly running permits downstream STARTING`,
    });
  }
  return out;
}

export function buildOrchestrations(
  inputs: OrchestrationInput[],
): Record<string, Record<string, SubsystemStateSequence>> {
  const out: Record<string, Record<string, SubsystemStateSequence>> = {};
  for (const input of inputs) {
    const interlocks = buildInterlocks(input);
    const sharedPermissive = buildSharedPermissive(input.subsystem_id);

    const states: Record<string, SubsystemStateSequence> = {};
    for (const stateId of SEQUENTIAL_STATE_IDS) {
      const seq: SubsystemStateSequence = {
        assembly_order: input.assemblies.map((a) => a.assembly_id),
        shared_permissives: [sharedPermissive],
        inter_assembly_interlocks: interlocks,
        notes: null,
      };
      const parsed = SubsystemStateSequenceSchema.safeParse(seq);
      if (!parsed.success) {
        throw new Error(
          `orchestration-builder: subsystem ${input.subsystem_id} state ${stateId} failed Zod parse:\n${parsed.error.message}`,
        );
      }
      states[String(stateId)] = parsed.data;
    }
    out[input.subsystem_id] = states;
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/spec-builder/random/__tests__/orchestration-builder.test.ts`
Expected: PASS — 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/random/orchestration-builder.ts src/lib/spec-builder/random/__tests__/orchestration-builder.test.ts
git commit -m "$(cat <<'EOF'
feat(fds-engine): V2 orchestration builder for random builder

One SharedPermissive per subsystem-state, one InterAssemblyInterlock
per adjacent assembly pair (effect=enable → STARTING). Single-assembly
subsystems get no interlocks. Zod-validated.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Section renderer

**Files:**
- Create: `src/lib/spec-builder/random/section-renderer.ts`
- Test: `src/lib/spec-builder/random/__tests__/section-renderer.test.ts`

Renders `spec_sections.functional_description.content_json` payloads from V2 step tables, matching the shape `generateSpec` produces today. The DOCX exporter and the migration wizard both read this shape, so keeping it stable is critical.

Looking at the existing post-processing in `src/hooks/use-random-fds-generate.ts:531-562` shows the consumed shape: `{ pattern: "sequential" | "static", permissives: string[], steps: Array<{...}>, notes: string | null, device_states?: [...] }`. We render the same.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/spec-builder/random/__tests__/section-renderer.test.ts
import { describe, expect, it } from "vitest";
import type { AssemblyContract } from "@/types/spec-contract-v2";
import {
  renderSequentialContentJson,
  renderStaticContentJson,
} from "../section-renderer";
import { STATE_ID_STARTING, STATE_ID_IDLE } from "../state-machine";

const contract: AssemblyContract = {
  assembly_id: "00000000-0000-0000-0000-000000000001",
  subsystem_id: "00000000-0000-0000-0000-0000000000ff",
  static_states: {
    [String(STATE_ID_IDLE)]: { override_kind: "override", devices: [], notes: null },
  },
  sequential_states: {
    [String(STATE_ID_STARTING)]: {
      override_kind: "override",
      permissives: [],
      steps: [
        {
          step_id: "s-3-1",
          branch_id: "b-x-3-main",
          name: "M01: Energise motor",
          actions: [],
          monitors: [],
          transitions: [],
          step: 1,
          action: "Set CV01_M01_CMD = TRUE",
          completion_criteria: [
            { kind: "tag_equals", tag: "CV01_M01_FB_RUN", value: true, within_ms: 3000 },
          ],
          completion_criteria_text: "CV01_M01_FB_RUN = true within 3000ms, else fault",
        },
      ],
      branches: [],
      state_monitors: [],
      sequence_model_version: 2,
      notes: null,
    },
  },
};

describe("renderSequentialContentJson", () => {
  it("produces a payload with pattern='sequential' and a steps array", () => {
    const json = renderSequentialContentJson(contract.sequential_states[String(STATE_ID_STARTING)]);
    expect(json.pattern).toBe("sequential");
    expect(Array.isArray(json.steps)).toBe(true);
    expect(json.steps).toHaveLength(1);
  });

  it("each rendered step has step/action/completion_criteria (prose) keys", () => {
    const json = renderSequentialContentJson(contract.sequential_states[String(STATE_ID_STARTING)]);
    const s = json.steps[0] as Record<string, unknown>;
    expect(s.step).toBe(1);
    expect(s.action).toBe("Set CV01_M01_CMD = TRUE");
    expect(s.completion_criteria).toBe("CV01_M01_FB_RUN = true within 3000ms, else fault");
  });

  it("preserves notes=null and permissives=[]", () => {
    const json = renderSequentialContentJson(contract.sequential_states[String(STATE_ID_STARTING)]);
    expect(json.notes).toBeNull();
    expect(json.permissives).toEqual([]);
  });
});

describe("renderStaticContentJson", () => {
  it("produces pattern='static' with empty device_states for an empty StaticStateV2", () => {
    const json = renderStaticContentJson(contract.static_states[String(STATE_ID_IDLE)]);
    expect(json.pattern).toBe("static");
    expect(json.device_states).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/random/__tests__/section-renderer.test.ts`
Expected: FAIL — cannot resolve `../section-renderer`.

- [ ] **Step 3: Implement the renderer**

```ts
// src/lib/spec-builder/random/section-renderer.ts
/**
 * Renders spec_sections.functional_description.content_json from V2
 * AssemblyContract state tables. Mirrors the shape produced by
 * src/lib/spec-builder/orchestrator.ts so DOCX export and the live
 * wizard's post-processing both work unchanged.
 *
 * If `generateSpec` ever changes its content_json shape, this file's
 * snapshot test will fail and force a paired update.
 */
import type {
  DeviceStateEntry,
  SequentialStateV2,
  StaticStateV2,
} from "@/types/spec-contract-v2";

export interface SequentialSectionContent {
  pattern: "sequential";
  permissives: string[];
  steps: Array<{
    step: number;
    action: string;
    completion_criteria: string;
  }>;
  notes: string | null;
}

export interface StaticSectionContent {
  pattern: "static";
  device_states: Array<{ tag: string; state: string }>;
}

export function renderSequentialContentJson(
  seq: SequentialStateV2,
): SequentialSectionContent {
  return {
    pattern: "sequential",
    permissives: seq.permissives.map((p) => `${p.tag} ${p.operator} ${String(p.value)}`),
    steps: seq.steps.map((s) => ({
      step: s.step,
      action: s.action,
      completion_criteria: s.completion_criteria_text,
    })),
    notes: seq.notes,
  };
}

export function renderStaticContentJson(
  staticState: StaticStateV2 | DeviceStateEntry[],
): StaticSectionContent {
  const devices = Array.isArray(staticState) ? staticState : staticState.devices;
  return {
    pattern: "static",
    device_states: devices.map((d) => ({ tag: d.tag, state: d.state })),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/spec-builder/random/__tests__/section-renderer.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/random/section-renderer.ts src/lib/spec-builder/random/__tests__/section-renderer.test.ts
git commit -m "$(cat <<'EOF'
feat(fds-engine): functional_description content_json renderer

Renders the same shape orchestrator.ts produces so DOCX export and the
wizard's post-processing work unchanged when the random builder seeds
sections.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Top-level assembler + integration test

**Files:**
- Create: `src/lib/spec-builder/random/assemble.ts`
- Test: `src/lib/spec-builder/random/__tests__/assemble.integration.test.ts`

This is the orchestrator that consumes a `RandomFdsTheme` and emits everything downstream consumers need:
1. A `SpecContractPatch` ready for `writeSpecContract`.
2. An `InstrumentRegister` payload for `useSaveInstrumentRegister`.
3. A list of `fds_assembly_sessions` rows ready for direct insert.
4. A list of `fds_subsystem_orchestrations` rows ready for direct insert.
5. A list of `spec_sections` rows for `functional_description` (one per assembly per sequential state + per assembly per static state).

The integration test asserts that the produced `SpecContractPatch` passes `validateSpecContractPatch` for three parameter combinations (1×1×3, 3×6×18, 8×20×60).

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/spec-builder/random/__tests__/assemble.integration.test.ts
import { describe, expect, it } from "vitest";
import { SpecContractPatchSchema, validateSpecContractPatch } from "@/lib/spec-builder/contract";
import { assembleRandomFds } from "../assemble";
import type { RandomFdsTheme } from "../theme-schema";

function makeTheme(subsystems: number, assemblies: number, devices: number): RandomFdsTheme {
  const subs = Array.from({ length: subsystems }, (_, si) => {
    const asmsForSub = Math.max(1, Math.floor(assemblies / subsystems) + (si === 0 ? assemblies % subsystems : 0));
    return {
      subsystem_name: `SS${si + 1}`,
      equipment_type: "Conveyor",
      description: "",
      assemblies: Array.from({ length: asmsForSub }, (_, ai) => ({
        assembly_name: `ASM${si + 1}-${ai + 1}`,
        description: "",
        devices: Array.from({ length: Math.max(1, Math.floor(devices / assemblies)) }, (_, di) => ({
          device_name: `M${di + 1}`,
          device_class: "motor" as const,
          description: "",
          is_safety: false,
        })),
      })),
    };
  });
  return {
    title: "Test Random Spec",
    system_description: "x",
    plc_model: "S7-1500",
    hmi_type: "TP1200",
    fault_philosophy: "x",
    design_principles: ["x"],
    machine_theme: "x",
    safety_classification: null,
    subsystems: subs,
  };
}

describe("assembleRandomFds — patch passes validator", () => {
  const cases = [
    { subsystems: 1, assemblies: 1, devices: 3, label: "min" },
    { subsystems: 3, assemblies: 6, devices: 18, label: "mid" },
    { subsystems: 8, assemblies: 20, devices: 60, label: "max" },
  ];

  for (const c of cases) {
    it(`${c.label} (${c.subsystems}×${c.assemblies}×${c.devices}) produces a validator-passing patch`, () => {
      const theme = makeTheme(c.subsystems, c.assemblies, c.devices);
      const result = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000001" });

      const parsed = SpecContractPatchSchema.safeParse(result.patch);
      expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.format(), null, 2)).toBe(true);

      if (parsed.success) {
        const issues = validateSpecContractPatch(parsed.data);
        expect(issues, issues.join("\n")).toEqual([]);
      }
    });
  }

  it("populates instrument register with one tag per IO signal", () => {
    const theme = makeTheme(2, 4, 12);
    const result = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000001" });
    // motor has 3 IO slots → 12 devices × 3 = 36 tags
    expect(result.instrumentRegister.tags).toHaveLength(36);
    const addrs = new Set(result.instrumentRegister.tags.map((t) => t.io_address));
    expect(addrs.size).toBe(result.instrumentRegister.tags.length);
  });

  it("emits one 'fault' alarm per motor (devices with a FAULT IO slot)", () => {
    const theme = makeTheme(2, 4, 12); // 12 motors, each has FAULT slot
    const result = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000001" });
    expect(result.patch.alarms).toBeDefined();
    expect(result.patch.alarms).toHaveLength(12);
    for (const a of result.patch.alarms!) {
      expect(a.tier_id).toBe("critical");
      expect(a.tag).toMatch(/_FAULT$/);
    }
  });

  it("produces one assembly session row per assembly", () => {
    const theme = makeTheme(2, 4, 12);
    const result = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000001" });
    expect(result.assemblySessions).toHaveLength(4);
    for (const row of result.assemblySessions) {
      expect(row.status).toBe("complete");
      expect(row.static_confirmed).toBe(true);
    }
  });

  it("produces one orchestration row per multi-assembly subsystem", () => {
    const theme = makeTheme(2, 4, 12); // 2 assemblies per subsystem ⇒ both eligible
    const result = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000001" });
    expect(result.orchestrations).toHaveLength(2);
  });

  it("produces functional_description section rows for every (assembly, state) pair", () => {
    const theme = makeTheme(2, 4, 12);
    const result = assembleRandomFds(theme, { projectId: "00000000-0000-0000-0000-000000000001" });
    // 4 assemblies × 6 states = 24
    expect(result.functionalDescriptionRows).toHaveLength(24);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/random/__tests__/assemble.integration.test.ts`
Expected: FAIL — cannot resolve `../assemble`.

- [ ] **Step 3: Implement the assembler**

```ts
// src/lib/spec-builder/random/assemble.ts
/**
 * Top-level Stage-2 assembler. Consumes a RandomFdsTheme and produces
 * everything the hook needs to persist a complete V2 spec:
 *   - SpecContractPatch (for writeSpecContract — validator-gated)
 *   - InstrumentRegister tags + summaries (for useSaveInstrumentRegister)
 *   - fds_assembly_sessions rows (direct insert; V2-shaped)
 *   - fds_subsystem_orchestrations rows (direct insert; V2-shaped)
 *   - spec_sections rows for functional_description (direct insert)
 */
import type {
  AlarmTier,
  AssemblyContract,
  Hierarchy,
  OperatingStateV2,
  SubsystemStateSequence,
  SubsystemV2,
  IoSignalV2,
} from "@/types/spec-contract-v2";
import type { SpecContractPatch } from "@/lib/spec-builder/contract";
import { CANONICAL_STATES, SEQUENTIAL_STATE_IDS, STATE_ID_IDLE, STATE_ID_COMPLETE, STATE_ID_E_STOP } from "./state-machine";
import { computeSubsystemBases, createIoAllocator, type IoSignalKind } from "./io-allocator";
import { DEVICE_TEMPLATES } from "./device-templates";
import { buildAssemblyContracts, type ResolvedAssembly, type ResolvedDevice, type ResolvedIoSignal } from "./sequence-builder";
import { buildOrchestrations } from "./orchestration-builder";
import { renderSequentialContentJson, renderStaticContentJson } from "./section-renderer";
import type { RandomFdsTheme } from "./theme-schema";

export interface AssembleOptions {
  projectId: string;
}

export interface InstrumentTagRow {
  tag: string;
  device_type: string;
  description: string;
  signal_type: IoSignalKind;
  io_address: string;
  device_class: string;
  signal_direction: IoSignalKind;
  subsystem_prefix: string;
  is_safety: boolean;
  subsystem: string;
}

export interface InstrumentRegisterPayload {
  tags: InstrumentTagRow[];
  subsystems: Array<{
    subsystem_id: string;
    subsystem_name: string;
    equipment_type: string;
    tag_count: number;
  }>;
}

export interface AssemblySessionRow {
  spec_project_id: string;
  subsystem_id: string;
  assembly_id: string;
  status: "complete";
  static_confirmed: true;
  static_states_v2: Record<string, unknown>;
  sequential_states: Record<string, unknown>;
  conversation: unknown[];
}

export interface OrchestrationRow {
  spec_project_id: string;
  subsystem_id: string;
  state_sequences: Record<string, SubsystemStateSequence>;
  conversation: unknown[];
  validation_results: null;
  token_usage: { input: 0; output: 0 };
}

export interface FunctionalDescriptionRow {
  spec_project_id: string;
  section_type: "functional_description";
  subsystem_id: string;
  assembly_id: string;
  state_id: string;
  state_pattern: "static" | "sequential";
  granularity: "assembly_state";
  content_json: Record<string, unknown>;
  approved: true;
}

export interface AssembleResult {
  patch: SpecContractPatch;
  instrumentRegister: InstrumentRegisterPayload;
  assemblySessions: AssemblySessionRow[];
  orchestrations: OrchestrationRow[];
  functionalDescriptionRows: FunctionalDescriptionRow[];
  /** Cosmetic surface for the create-spec call. */
  projectFields: {
    title: string;
    plc_model: string;
    hmi_type: string;
    system_description: string;
    safety_classification: string | null;
    fault_philosophy: string;
    design_principles: string[];
  };
}

// ---------------------------------------------------------------------
// Tag prefix derivation — short ISA-style identifiers from theme names
// ---------------------------------------------------------------------

function tokenisePrefix(name: string, fallback: string): string {
  const cleaned = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 12) : fallback;
}

// ---------------------------------------------------------------------
// Resolution: theme → ResolvedAssembly[] with real UUIDs + IO addresses
// ---------------------------------------------------------------------

interface ResolvedHierarchy {
  subsystems: Array<{
    subsystem_id: string;
    subsystem_name: string;
    equipment_type: string;
    description: string;
    assemblies: ResolvedAssembly[];
  }>;
}

function resolveHierarchy(theme: RandomFdsTheme): ResolvedHierarchy {
  const subs = theme.subsystems.map((sub, si) => {
    const subsystem_id = crypto.randomUUID();
    const allocator = createIoAllocator(computeSubsystemBases(si));
    const subPrefix = tokenisePrefix(sub.subsystem_name, `SS${si + 1}`);

    const assemblies: ResolvedAssembly[] = sub.assemblies.map((asm, ai) => {
      const assembly_id = crypto.randomUUID();
      const asmPrefix = tokenisePrefix(asm.assembly_name, `ASM${ai + 1}`);

      const devices: ResolvedDevice[] = asm.devices.map((dev, di) => {
        const device_id = crypto.randomUUID();
        const devPrefix = `${asmPrefix}_${tokenisePrefix(dev.device_name, `D${di + 1}`)}`;
        const tpl = DEVICE_TEMPLATES[dev.device_class];
        const ioSignals: ResolvedIoSignal[] = tpl.ioSlots.map((slot) => ({
          tag: `${devPrefix}_${slot.suffix}`,
          suffix: slot.suffix,
          kind: slot.kind,
          io_address: allocator.next(slot.kind),
          description: `${dev.device_name} — ${slot.description}`,
        }));
        return {
          device_id,
          device_name: dev.device_name,
          device_class: dev.device_class,
          description: dev.description,
          is_safety: dev.is_safety,
          tag_prefix: devPrefix,
          io_signals: ioSignals,
        };
      });

      return { assembly_id, assembly_name: asm.assembly_name, subsystem_id, devices };
    });

    void subPrefix;
    return {
      subsystem_id,
      subsystem_name: sub.subsystem_name,
      equipment_type: sub.equipment_type,
      description: sub.description,
      assemblies,
    };
  });

  return { subsystems: subs };
}

// ---------------------------------------------------------------------
// Patch builders
// ---------------------------------------------------------------------

function buildHierarchy(resolved: ResolvedHierarchy): Hierarchy {
  const subsystems: SubsystemV2[] = resolved.subsystems.map((sub) => ({
    subsystem_id: sub.subsystem_id,
    subsystem_name: sub.subsystem_name,
    equipment_type: sub.equipment_type,
    description: sub.description,
    excluded: false,
    assemblies: sub.assemblies.map((asm) => ({
      assembly_id: asm.assembly_id,
      assembly_name: asm.assembly_name,
      description: "",
      devices: asm.devices.map((d) => ({
        device_id: d.device_id,
        device_name: d.device_name,
        device_class: d.device_class,
        is_safety: d.is_safety,
        description: d.description,
        io_signals: d.io_signals.map<IoSignalV2>((s) => ({
          tag: s.tag,
          signal_type: s.kind,
          io_address: s.io_address,
          description: s.description,
          source: "wired",
          tier: "wired",
        })),
      })),
    })),
  }));
  return { subsystems };
}

function buildStates(): OperatingStateV2[] {
  return CANONICAL_STATES;
}

function buildAlarmTiers(): AlarmTier[] {
  return [
    { tier_id: "critical", tier_name: "Critical", description: "Immediate shutdown" },
    { tier_id: "warning", tier_name: "Warning", description: "Operator notification" },
  ];
}

function buildAlarms(resolved: ResolvedHierarchy): import("@/types/spec-contract-v2").AlarmRow[] {
  const alarms: import("@/types/spec-contract-v2").AlarmRow[] = [];
  for (const sub of resolved.subsystems) {
    for (const asm of sub.assemblies) {
      for (const dev of asm.devices) {
        // Motors / drives that expose a FAULT input get a "fault" alarm.
        const faultIo = dev.io_signals.find((s) => s.suffix === "FAULT");
        if (faultIo) {
          alarms.push({
            id: crypto.randomUUID(),
            tier_id: "critical",
            device_id: dev.device_id,
            assembly_id: asm.assembly_id,
            subsystem_id: sub.subsystem_id,
            tag: faultIo.tag,
            description: `${dev.device_name} drive fault`,
            action: "Stop assembly; require operator reset",
          });
        }
        // Safety devices (E-stops, safety gates) get a "tripped" alarm.
        if (dev.is_safety) {
          const stateIo = dev.io_signals.find((s) => s.suffix === "STATE") ?? dev.io_signals[0];
          if (stateIo) {
            alarms.push({
              id: crypto.randomUUID(),
              tier_id: "critical",
              device_id: dev.device_id,
              assembly_id: asm.assembly_id,
              subsystem_id: sub.subsystem_id,
              tag: stateIo.tag,
              description: `${dev.device_name} safety device tripped`,
              action: "E-stop machine",
            });
          }
        }
      }
    }
  }
  return alarms;
}

// ---------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------

export function assembleRandomFds(theme: RandomFdsTheme, opts: AssembleOptions): AssembleResult {
  const resolved = resolveHierarchy(theme);
  const flatAssemblies: ResolvedAssembly[] = resolved.subsystems.flatMap((s) => s.assemblies);
  const assemblies = buildAssemblyContracts(flatAssemblies);
  const orchestrationsMap = buildOrchestrations(
    resolved.subsystems.map((s) => ({
      subsystem_id: s.subsystem_id,
      assemblies: s.assemblies.map((a) => ({
        assembly_id: a.assembly_id,
        // Pick the first device's run-feedback tag (if any) as the interlock source.
        // If the assembly has no DI/DO devices with FB_RUN, fall back to the first IO tag.
        first_device_run_tag:
          a.devices[0]?.io_signals.find((s) => s.suffix === "FB_RUN")?.tag ??
          a.devices[0]?.io_signals[0]?.tag ??
          `PLACEHOLDER_${a.assembly_id.slice(0, 8)}`,
      })),
    })),
  );

  const patch: SpecContractPatch = {
    hierarchy: buildHierarchy(resolved),
    states: buildStates(),
    alarm_tiers: buildAlarmTiers(),
    alarms: buildAlarms(resolved),
    modes: [{ mode_id: "auto", name: "Auto", description: "Single default mode", is_default: true }],
    assemblies,
    orchestrations: orchestrationsMap,
    confirmation_status: "confirmed",
  };

  // Instrument register
  const tags: InstrumentTagRow[] = [];
  const subSummaries: InstrumentRegisterPayload["subsystems"] = [];
  for (const sub of resolved.subsystems) {
    let count = 0;
    for (const asm of sub.assemblies) {
      for (const dev of asm.devices) {
        for (const sig of dev.io_signals) {
          tags.push({
            tag: sig.tag,
            device_type: dev.device_class,
            description: sig.description,
            signal_type: sig.kind,
            io_address: sig.io_address,
            device_class: dev.device_class,
            signal_direction: sig.kind,
            subsystem_prefix: sub.subsystem_id,
            is_safety: dev.is_safety,
            subsystem: sub.subsystem_name,
          });
          count += 1;
        }
      }
    }
    subSummaries.push({
      subsystem_id: sub.subsystem_id,
      subsystem_name: sub.subsystem_name,
      equipment_type: sub.equipment_type,
      tag_count: count,
    });
  }

  // Assembly sessions (one row per assembly, V2-shaped)
  const assemblySessions: AssemblySessionRow[] = [];
  for (const sub of resolved.subsystems) {
    for (const asm of sub.assemblies) {
      const ctr: AssemblyContract = assemblies[asm.assembly_id];
      assemblySessions.push({
        spec_project_id: opts.projectId,
        subsystem_id: sub.subsystem_id,
        assembly_id: asm.assembly_id,
        status: "complete",
        static_confirmed: true,
        static_states_v2: ctr.static_states,
        sequential_states: ctr.sequential_states,
        conversation: [],
      });
    }
  }

  // Subsystem orchestration rows (only multi-assembly subsystems)
  const orchestrations: OrchestrationRow[] = [];
  for (const sub of resolved.subsystems) {
    if (sub.assemblies.length <= 1) continue;
    orchestrations.push({
      spec_project_id: opts.projectId,
      subsystem_id: sub.subsystem_id,
      state_sequences: orchestrationsMap[sub.subsystem_id],
      conversation: [],
      validation_results: null,
      token_usage: { input: 0, output: 0 },
    });
  }

  // functional_description spec_sections rows (one per assembly per state)
  const functionalDescriptionRows: FunctionalDescriptionRow[] = [];
  for (const sub of resolved.subsystems) {
    for (const asm of sub.assemblies) {
      const ctr = assemblies[asm.assembly_id];
      for (const stateId of SEQUENTIAL_STATE_IDS) {
        functionalDescriptionRows.push({
          spec_project_id: opts.projectId,
          section_type: "functional_description",
          subsystem_id: sub.subsystem_id,
          assembly_id: asm.assembly_id,
          state_id: String(stateId),
          state_pattern: "sequential",
          granularity: "assembly_state",
          content_json: renderSequentialContentJson(
            ctr.sequential_states[String(stateId)],
          ) as unknown as Record<string, unknown>,
          approved: true,
        });
      }
      for (const stateId of [STATE_ID_IDLE, STATE_ID_COMPLETE, STATE_ID_E_STOP]) {
        functionalDescriptionRows.push({
          spec_project_id: opts.projectId,
          section_type: "functional_description",
          subsystem_id: sub.subsystem_id,
          assembly_id: asm.assembly_id,
          state_id: String(stateId),
          state_pattern: "static",
          granularity: "assembly_state",
          content_json: renderStaticContentJson(
            ctr.static_states[String(stateId)],
          ) as unknown as Record<string, unknown>,
          approved: true,
        });
      }
    }
  }

  return {
    patch,
    instrumentRegister: { tags, subsystems: subSummaries },
    assemblySessions,
    orchestrations,
    functionalDescriptionRows,
    projectFields: {
      title: theme.title,
      plc_model: theme.plc_model,
      hmi_type: theme.hmi_type,
      system_description: theme.system_description,
      safety_classification: theme.safety_classification,
      fault_philosophy: theme.fault_philosophy,
      design_principles: theme.design_principles,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/spec-builder/random/__tests__/assemble.integration.test.ts`
Expected: PASS — 7 tests.

If `validateSpecContractPatch` returns issues, fix the deterministic builder until the patch is clean. Do not silence the assertion.

- [ ] **Step 5: Run the full random/ test suite**

Run: `npx vitest run src/lib/spec-builder/random`
Expected: PASS — all tests across all 8 files.

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/random/assemble.ts src/lib/spec-builder/random/__tests__/assemble.integration.test.ts
git commit -m "$(cat <<'EOF'
feat(fds-engine): assembleRandomFds — Stage 2 deterministic builder

Consumes RandomFdsTheme → emits SpecContractPatch (validator-gated),
instrument register, V2-shaped assembly sessions / orchestrations /
functional_description sections. Integration test asserts validator-
passing patch across 1×1×3, 3×6×18, 8×20×60 parameter combos.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Rewrite `useRandomFdsGenerate` hook

**Files:**
- Modify: `src/hooks/use-random-fds-generate.ts` — full rewrite

The hook becomes a thin orchestrator over `assembleRandomFds`. It still:
- Creates the spec_project row via `useCreateSpecProject`.
- Saves the instrument register via `useSaveInstrumentRegister`.
- Cleans up the orphan spec on failure.
- Surfaces `loading`/`error` and a cancel signal.

Removed:
- `parseCompletionCriteria` (and its regex).
- The big AI prompt + V1 JSON envelope.
- The `autoComplete` toggle.
- The post-processing that reads `functional_description` rows to seed sessions — assemble.ts now produces those rows and the session rows in one pass.

Net change: ~660 lines → ~140 lines.

- [ ] **Step 1: Read the existing hook to know the call-site shape**

Read: `src/hooks/use-random-fds-generate.ts`

Note the export signature `useRandomFdsGenerate()` returns `{ generate, loading, error, cancel }` where `generate(params: RandomFdsParams): Promise<string | null>`. Callers (the dialog) depend on this. Keep it.

- [ ] **Step 2: Rewrite the hook**

Replace the entire file contents with:

```ts
// src/hooks/use-random-fds-generate.ts
/**
 * Hook for generating a random V2 FDS spec.
 *   Stage 1 — small AI theme call (names + prose).
 *   Stage 2 — fully deterministic V2 builder (assembleRandomFds).
 *
 * The hook is a thin wrapper around assembleRandomFds + the existing
 * mutation hooks. It does not own validator logic — the builder Zod-
 * parses every contract it produces, and writeSpecContract runs the
 * full structural validator before persisting.
 */
import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callNonStreaming } from "@/hooks/use-generation";
import {
  useCreateSpecProject,
  useUpdateSpecProject,
  useDeleteSpecProject,
  useSaveInstrumentRegister,
} from "@/hooks/use-spec-projects";
import { writeSpecContract } from "@/lib/spec-builder/contract";
import { supabase } from "@/lib/supabase";
import { buildRandomFdsThemePrompt } from "@/lib/spec-builder/random/theme-prompt";
import { RandomFdsThemeSchema } from "@/lib/spec-builder/random/theme-schema";
import { assembleRandomFds } from "@/lib/spec-builder/random/assemble";

export interface RandomFdsParams {
  subsystems: number;
  assemblies: number;
  devices: number;
  projectId: string;
  projectNumber?: string;
  clientName?: string;
  onProgress?: (stage: string) => void;
}

function extractJson(raw: string): unknown {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, "")
    .replace(/\n?```\s*$/, "")
    .trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new Error(`No JSON object found in AI response (length: ${raw.length})`);
  }
  return JSON.parse(trimmed.slice(first, last + 1));
}

export function useRandomFdsGenerate() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const createSpec = useCreateSpecProject();
  const updateSpec = useUpdateSpecProject();
  const deleteSpec = useDeleteSpecProject();
  const saveRegister = useSaveInstrumentRegister();
  const queryClient = useQueryClient();

  const generate = useCallback(
    async (params: RandomFdsParams): Promise<string | null> => {
      setLoading(true);
      setError(null);
      abortRef.current = new AbortController();

      let createdSpecId: string | null = null;
      try {
        // Stage 1 — AI theme
        params.onProgress?.("Generating theme…");
        const prompt = buildRandomFdsThemePrompt({
          subsystems: params.subsystems,
          assemblies: params.assemblies,
          devices: params.devices,
        });
        const { content } = await callNonStreaming(
          prompt,
          [
            {
              role: "user",
              content: `Generate a theme for exactly ${params.subsystems} subsystems, ${params.assemblies} assemblies, ${params.devices} devices.`,
            },
          ],
          abortRef.current.signal,
          4096,
          { prompt_name: "random-fds-theme", agent_role: "design_engineer", pipeline_step: "random_fds_theme" },
        );

        const themeRaw = extractJson(content);
        const themeParse = RandomFdsThemeSchema.safeParse(themeRaw);
        if (!themeParse.success) {
          throw new Error(
            `Stage 1 theme failed schema validation:\n${themeParse.error.message}`,
          );
        }
        const theme = themeParse.data;

        // Create the spec row early so the project_id is stable for Stage 2 rows.
        params.onProgress?.("Creating spec…");
        const docCode = `RAND-${Date.now().toString(36).toUpperCase()}`;
        const spec = await createSpec.mutateAsync({
          project_id: params.projectId,
          doc_code: docCode,
          title: theme.title,
          client_name: params.clientName,
          project_number: params.projectNumber,
          plc_model: theme.plc_model,
          hmi_type: theme.hmi_type,
          system_description: theme.system_description,
          safety_classification: theme.safety_classification ?? undefined,
          fault_philosophy: theme.fault_philosophy,
          design_principles: theme.design_principles,
        });
        createdSpecId = spec.id;

        // Stage 2 — deterministic build
        params.onProgress?.("Building V2 spec…");
        const result = assembleRandomFds(theme, { projectId: spec.id });

        // Wizard-data + validator gate (throws ContractValidationError on failure)
        params.onProgress?.("Writing contract…");
        await writeSpecContract(spec.id, result.patch);

        // Mirror the projectFields onto the spec row (createSpec already set them
        // but updateSpec touches the wizard summary columns the UI consumes).
        await updateSpec.mutateAsync({
          id: spec.id,
          confirmed_subsystems: result.patch.hierarchy?.subsystems ?? [],
          confirmed_states: result.patch.states ?? [],
          alarm_tiers: result.patch.alarm_tiers ?? [],
        });

        // Instrument register
        params.onProgress?.("Saving instrument register…");
        await saveRegister.mutateAsync({
          spec_project_id: spec.id,
          raw_filename: `${docCode}-random-fds.synthetic`,
          tags: result.instrumentRegister.tags,
          subsystems: result.instrumentRegister.subsystems,
          parse_warnings: [],
          haiku_usage: { input: 0, output: 0, total: 0 },
        });

        // Direct inserts for tables writeSpecContract does not route yet.
        params.onProgress?.("Seeding sessions + sections…");
        if (result.functionalDescriptionRows.length > 0) {
          await supabase
            .from("spec_sections")
            .delete()
            .eq("spec_project_id", spec.id)
            .eq("section_type", "functional_description");
          const { error: secErr } = await supabase
            .from("spec_sections")
            .insert(result.functionalDescriptionRows);
          if (secErr) throw new Error(`spec_sections insert: ${secErr.message}`);
        }
        if (result.assemblySessions.length > 0) {
          await supabase.from("fds_assembly_sessions").delete().eq("spec_project_id", spec.id);
          const { error: sesErr } = await supabase
            .from("fds_assembly_sessions")
            .insert(result.assemblySessions);
          if (sesErr) throw new Error(`fds_assembly_sessions insert: ${sesErr.message}`);
        }
        if (result.orchestrations.length > 0) {
          await supabase
            .from("fds_subsystem_orchestrations")
            .delete()
            .eq("spec_project_id", spec.id);
          const { error: orchErr } = await supabase
            .from("fds_subsystem_orchestrations")
            .insert(result.orchestrations);
          if (orchErr) throw new Error(`fds_subsystem_orchestrations insert: ${orchErr.message}`);
        }

        queryClient.invalidateQueries({ queryKey: ["spec_sections", spec.id] });
        queryClient.invalidateQueries({ queryKey: ["fds_assembly_sessions", spec.id] });
        queryClient.invalidateQueries({ queryKey: ["fds_subsystem_orchestrations", spec.id] });
        await queryClient.refetchQueries({
          queryKey: ["spec_projects", "by_project", params.projectId],
        });

        return spec.id;
      } catch (err) {
        if (abortRef.current?.signal.aborted) return null;
        const msg = err instanceof Error ? err.message : "Generation failed";
        console.error("[random-fds] generation failed:", err);
        setError(msg);
        if (createdSpecId) {
          try {
            await deleteSpec.mutateAsync({ id: createdSpecId, projectId: params.projectId });
          } catch (cleanupErr) {
            console.error("[random-fds] cleanup failed:", cleanupErr);
          }
        }
        return null;
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    },
    [createSpec, updateSpec, deleteSpec, saveRegister, queryClient],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { generate, loading, error, cancel };
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

If errors:
- A common one is the `useUpdateSpecProject` signature drift. Inspect `src/hooks/use-spec-projects.ts` for the exact param names and adjust the mutateAsync call.
- `useSaveInstrumentRegister` may have moved fields. Same fix.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/use-random-fds-generate.ts
git commit -m "$(cat <<'EOF'
refactor(fds-engine): use-random-fds-generate hook → V2 thin wrapper

Hook now orchestrates buildRandomFdsThemePrompt + assembleRandomFds +
writeSpecContract (validator-gated) + direct V2 inserts for tables the
writer doesn't route yet. Drops the big V1 AI prompt, parseCompletion-
Criteria regex, autoComplete branch, and the post-processing pass that
read functional_description rows to seed sessions.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Strip `autoComplete` from the dialog

**Files:**
- Modify: `src/components/spec-builder/random-fds-dialog.tsx`

The dialog no longer has two modes — every generate produces a fully complete V2 spec. Remove the checkbox, the state, and the `autoComplete` field on the `generate({...})` call.

- [ ] **Step 1: Apply the edits**

Open `src/components/spec-builder/random-fds-dialog.tsx` and make these edits:

a. Remove the `Checkbox` import:
```tsx
// DELETE this line:
import { Checkbox } from "@/components/ui/checkbox";
```

b. Delete the `autoComplete` state and the `progressLabel` plumbing it relied on (keep `progressLabel` itself — the stage string is still useful):
```tsx
// DELETE:
const [autoComplete, setAutoComplete] = useState(true);
```

c. Update the `handleGenerate` call to drop `autoComplete`. The `onProgress` callback in the new hook takes a single `stage` string (no `detail`):
```tsx
const handleGenerate = async () => {
  setProgressLabel(null);
  const specId = await generate({
    subsystems,
    assemblies,
    devices,
    projectId,
    projectNumber,
    clientName,
    onProgress: (stage) => setProgressLabel(stage),
  });
  setProgressLabel(null);
  if (specId) {
    onCreated(specId);
    onOpenChange(false);
  }
};
```

d. Delete the entire checkbox block (the `<div className="flex items-start gap-2 pt-1">` containing the `Checkbox` + label + helper text — currently lines 181–197 of the existing dialog).

- [ ] **Step 2: Type-check + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/spec-builder/random-fds-dialog.tsx
git commit -m "$(cat <<'EOF'
refactor(fds-engine): drop autoComplete toggle from RandomFdsDialog

Random builder always produces a fully complete V2 spec; the two-mode
UX no longer applies. Simplifies dialog state + props.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: PASS — all existing tests still pass, plus the 8 new test files in `src/lib/spec-builder/random/`.

If any pre-existing test fails, investigate. The most likely cause is that one of the new files shadows a name an existing test relies on; rename rather than silence.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Lint sweep**

Run: `npm run lint`
Expected: 0 errors. Warnings on pre-existing code are acceptable.

- [ ] **Step 5: Smoke test (manual, pre-merge)**

Start the dev server: `npm run dev`

In a browser:
1. Open a project → spec builder sidebar → click "Generate Random FDS".
2. Pick mid-range counts (e.g. 3 subsystems, 6 assemblies, 18 devices). Click Generate.
3. Verify the spec lands and opens, hierarchy + states + sections + assembly sessions + orchestrations are all populated.
4. Open browser dev tools → Network tab. Confirm the AI call payload size is small (Stage 1 only — under ~5kB response).
5. Open the matrix view. Confirm sequential states show step tables. Confirm a multi-assembly subsystem shows an orchestration row.
6. Confirm no console errors mentioning `ContractValidationError`, `validateSpecContractPatch`, or Zod parse failures.

- [ ] **Step 6: Commit (verification log only, no code changes)**

If verification surfaced any code fix, commit the fix separately. If verification was clean, no commit needed for this step.

---

## Phase done

When all 12 tasks check out, the random FDS builder ships V2-only specs end-to-end with validator gating on wizard data and Zod parsing on every contract surface. The `feature/fds-engine-phase3` branch is ready for the next phase (Phase 4 — Monitor picker UI) or for a PR back to master if you want to ship the random builder rewrite independently.
