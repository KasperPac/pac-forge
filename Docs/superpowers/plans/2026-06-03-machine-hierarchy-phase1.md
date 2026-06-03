# Machine Hierarchy Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the register-driven hierarchy builder produce a correct ISA-88 tree — one subsystem by default, register grouping column treated as the *assembly* level, and no false device splits — and document the corrected hierarchy/FB model + PackML in `CLAUDE.md`.

**Architecture:** Rewrite the deterministic `buildHierarchyFromTags` so the register's grouping column maps to **assemblies** under a **single subsystem** (the system), fix the signal-suffix list so thermistor/fault tags don't split one device, add an `assembly` column alias, rewrite the AI `inferHierarchy` prompt to extract-don't-invent and default to one subsystem, and rewrite the `CLAUDE.md` hierarchy section with the ISA-88 + PackML model. Phase 2 (feeding spec-document text into the wizard) is a separate plan.

**Tech Stack:** TypeScript, Vite, Vitest, xlsx. Tests live under `src/**/__tests__/*.test.ts` and run with `npm test`.

---

## File Structure

- `src/lib/spec-builder/instrument-parser.ts` — rewrite `buildHierarchyFromTags`; extend `SIGNAL_SUFFIXES`; remove now-dead helpers (`extractAssemblyPrefix`, `suggestAssemblyName`, `DEVICE_KEYWORD_RE`). One responsibility: deterministic register → hierarchy.
- `src/types/spec-builder.ts` — add `"assembly"` alias to `CANONICAL_COLUMN_NAMES.subsystem`.
- `src/components/spec-builder/spec-skeleton-wizard.tsx` — rewrite the `inferHierarchy` system prompt; pass `spec.title` into `buildHierarchyFromTags` at both call sites.
- `src/lib/spec-builder/__tests__/instrument-parser.test.ts` — **new** test file for the deterministic builder + column detection.
- `CLAUDE.md` — rewrite the "Machine Hierarchy (Non-negotiable)" section + add a PackML standards note.

---

### Task 1: Add `assembly` column alias

**Files:**
- Modify: `src/types/spec-builder.ts` (the `CANONICAL_COLUMN_NAMES.subsystem` array, ~line 359)
- Test: `src/lib/spec-builder/__tests__/instrument-parser.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/__tests__/instrument-parser.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { detectColumns } from "@/lib/spec-builder/instrument-parser";

describe("detectColumns — assembly alias", () => {
  it("maps an 'assembly' header to the grouping column", () => {
    const csv = "tag,io_address,signal_type,description,assembly\n" +
      "M1_CMD,%Q0.0,DO,Motor 1 run,Conveyor CV01\n" +
      "M1_FB,%I0.0,DI,Motor 1 feedback,Conveyor CV01\n" +
      "M1_OL,%I0.1,DI,Motor 1 overload,Conveyor CV01";
    const wb = XLSX.read(csv, { type: "string" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;

    const { mapping } = detectColumns(sheet);

    expect(mapping.subsystem).not.toBeNull();
    expect(mapping.tag).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/__tests__/instrument-parser.test.ts`
Expected: FAIL — `mapping.subsystem` is `null` because `"assembly"` is not yet an alias.

- [ ] **Step 3: Add the alias**

In `src/types/spec-builder.ts`, change the `subsystem` line of `CANONICAL_COLUMN_NAMES`:

```ts
  subsystem: ["subsystem", "sub system", "system", "area", "unit", "group", "assembly"],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/__tests__/instrument-parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types/spec-builder.ts src/lib/spec-builder/__tests__/instrument-parser.test.ts
git commit -m "feat(spec-builder): accept 'assembly' as a register grouping column"
```

---

### Task 2: Rewrite `buildHierarchyFromTags` to one subsystem + assemblies-from-column

**Files:**
- Modify: `src/lib/spec-builder/instrument-parser.ts` (`buildHierarchyFromTags`, ~lines 443-516; remove `extractAssemblyPrefix` ~414-419, `suggestAssemblyName` ~429-441, `DEVICE_KEYWORD_RE` ~427)
- Test: `src/lib/spec-builder/__tests__/instrument-parser.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/spec-builder/__tests__/instrument-parser.test.ts`:

```ts
import { buildHierarchyFromTags } from "@/lib/spec-builder/instrument-parser";
import type { InstrumentTag } from "@/types/spec-builder";

function tag(t: string, subsystem: string): InstrumentTag {
  return {
    tag: t,
    device_type: "",
    description: t,
    signal_type: "DI",
    io_address: "",
    device_class: "other",
    signal_direction: "DI",
    subsystem_prefix: subsystem,
    is_safety: false,
    subsystem,
  };
}

describe("buildHierarchyFromTags — single subsystem, column = assembly", () => {
  const tags: InstrumentTag[] = [
    tag("VSD1_ENABLE", "Carriage"),
    tag("VSD1_FWD", "Carriage"),
    tag("VSD2_ENABLE", "Rotator"),
    tag("SR1_HEALTHY", "Safety & Control"),
    tag("CARR_FWD", "Operator Interface"),
  ];

  it("returns exactly one subsystem", () => {
    const result = buildHierarchyFromTags(tags);
    expect(result).toHaveLength(1);
  });

  it("puts the register groups in as assemblies, sorted", () => {
    const result = buildHierarchyFromTags(tags);
    const assemblyNames = result[0].assemblies.map((a) => a.assembly_name);
    expect(assemblyNames).toEqual([
      "Carriage",
      "Operator Interface",
      "Rotator",
      "Safety & Control",
    ]);
  });

  it("never emits an UNGROUPED subsystem", () => {
    const result = buildHierarchyFromTags(tags);
    expect(result.some((s) => s.subsystem_name === "UNGROUPED")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/__tests__/instrument-parser.test.ts`
Expected: FAIL — current code returns 4 subsystems (one per group), so `toHaveLength(1)` fails.

- [ ] **Step 3: Rewrite the function and delete dead helpers**

In `src/lib/spec-builder/instrument-parser.ts`, **delete** `DEVICE_KEYWORD_RE`, `suggestAssemblyName`, and `extractAssemblyPrefix` (they become unused — `noUnusedLocals` would otherwise fail the build). Keep `extractDevicePrefix`, `SIGNAL_SUFFIXES`, and `inferEquipmentType`.

Replace the entire `buildHierarchyFromTags` function with:

```ts
export function buildHierarchyFromTags(
  tags: InstrumentTag[],
  systemName = "System",
): SubsystemConfig[] {
  // The register grouping column is interpreted as the ASSEMBLY level.
  const assemblyGroups = new Map<string, InstrumentTag[]>();
  for (const t of tags) {
    const key = t.subsystem || "Unassigned";
    if (!assemblyGroups.has(key)) assemblyGroups.set(key, []);
    assemblyGroups.get(key)!.push(t);
  }

  const assemblies: AssemblyConfig[] = [];
  for (const [asmName, asmTags] of assemblyGroups) {
    // Within an assembly, group tags into devices by device prefix.
    const deviceGroups = new Map<string, InstrumentTag[]>();
    for (const t of asmTags) {
      const devPrefix = extractDevicePrefix(t.tag, asmName);
      if (!deviceGroups.has(devPrefix)) deviceGroups.set(devPrefix, []);
      deviceGroups.get(devPrefix)!.push(t);
    }

    const devices: DeviceConfig[] = [];
    for (const [devPrefix, devTags] of deviceGroups) {
      const ioSignals: IoSignal[] = devTags.map((t) => ({
        tag: t.tag,
        signal_type: t.signal_type || t.signal_direction,
        io_address: t.io_address,
        description: t.description,
      }));
      const representative = devTags[0];
      devices.push({
        device_id: devPrefix,
        device_name: representative.description || devPrefix,
        device_class: representative.device_class,
        description: representative.description || "",
        is_safety: devTags.some((t) => t.is_safety),
        io_signals: ioSignals,
      });
    }

    assemblies.push({
      assembly_id: asmName,
      assembly_name: asmName,
      description: "",
      devices: devices.sort((a, b) => a.device_id.localeCompare(b.device_id)),
    });
  }

  return [
    {
      subsystem_id: "system",
      subsystem_name: systemName,
      equipment_type: inferEquipmentType(systemName, systemName),
      description: "",
      assemblies: assemblies.sort((a, b) =>
        a.assembly_id.localeCompare(b.assembly_id),
      ),
      excluded: false,
    },
  ];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/spec-builder/__tests__/instrument-parser.test.ts`
Expected: PASS (all of Task 1 + Task 2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/instrument-parser.ts src/lib/spec-builder/__tests__/instrument-parser.test.ts
git commit -m "feat(spec-builder): hierarchy defaults to one subsystem, column = assembly"
```

---

### Task 3: Stop `_THERM`/other suffixes splitting one device

**Files:**
- Modify: `src/lib/spec-builder/instrument-parser.ts` (`SIGNAL_SUFFIXES`, ~line 389)
- Test: `src/lib/spec-builder/__tests__/instrument-parser.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the test file:

```ts
describe("buildHierarchyFromTags — device grouping", () => {
  it("keeps fault + thermistor tags on ONE device", () => {
    const tags: InstrumentTag[] = [
      tag("CARR_M1_FAULT", "Carriage"),
      tag("CARR_M1_THERM", "Carriage"),
    ];
    const result = buildHierarchyFromTags(tags);
    const carriage = result[0].assemblies.find((a) => a.assembly_id === "Carriage")!;
    expect(carriage.devices).toHaveLength(1);
    expect(carriage.devices[0].io_signals).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/__tests__/instrument-parser.test.ts`
Expected: FAIL — `_THERM` is not in `SIGNAL_SUFFIXES`, so `CARR_M1_THERM` yields device `M1_THERM` while `CARR_M1_FAULT` yields `M1`, giving 2 devices.

- [ ] **Step 3: Extend the suffix list**

In `src/lib/spec-builder/instrument-parser.ts`, update `SIGNAL_SUFFIXES` to add `THERM` and `THERMISTOR`:

```ts
const SIGNAL_SUFFIXES = /[_.](?:CMD|FB|RUN|RUNNING|START|STOP|FWD|REV|OL|FAULT|TRIP|THERM|THERMISTOR|SPD|SPEED|HZ|FREQ|LSH|LSL|ZSH|ZSL|SP|PV|AO|AI|DI|DO|EN|ALARM|STATUS|STATE|ACK|RESET|OPN|CLS|OPEN|CLOSE|SET|RST)$/i;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/spec-builder/__tests__/instrument-parser.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/instrument-parser.ts src/lib/spec-builder/__tests__/instrument-parser.test.ts
git commit -m "fix(spec-builder): thermistor/fault tags no longer split one device"
```

---

### Task 4: Name the single subsystem from the spec title

**Files:**
- Modify: `src/lib/spec-builder/instrument-parser.ts` (already has `systemName` param from Task 2 — no change)
- Modify: `src/components/spec-builder/spec-skeleton-wizard.tsx` (the two `buildHierarchyFromTags(register.tags)` call sites, ~line 91 and ~line 213)
- Test: `src/lib/spec-builder/__tests__/instrument-parser.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the test file:

```ts
describe("buildHierarchyFromTags — system name", () => {
  it("names the single subsystem from the passed systemName", () => {
    const tags: InstrumentTag[] = [tag("VSD1_ENABLE", "Carriage")];
    const result = buildHierarchyFromTags(tags, "Segment Wagon");
    expect(result[0].subsystem_name).toBe("Segment Wagon");
  });

  it("defaults the subsystem name to 'System'", () => {
    const tags: InstrumentTag[] = [tag("VSD1_ENABLE", "Carriage")];
    const result = buildHierarchyFromTags(tags);
    expect(result[0].subsystem_name).toBe("System");
  });
});
```

- [ ] **Step 2: Run test to verify it passes already**

Run: `npx vitest run src/lib/spec-builder/__tests__/instrument-parser.test.ts`
Expected: PASS (the `systemName` param was added in Task 2). This test locks the behavior.

- [ ] **Step 3: Pass `spec.title` at both wizard call sites**

In `src/components/spec-builder/spec-skeleton-wizard.tsx`, update the seed (~line 91):

```ts
    return buildHierarchyFromTags(register.tags, spec.title);
```

and the inferHierarchy fallback (~line 213):

```ts
      setSubsystems(buildHierarchyFromTags(register.tags, spec.title));
```

- [ ] **Step 4: Verify build/lint**

Run: `npm run lint`
Expected: no errors in `spec-skeleton-wizard.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/__tests__/instrument-parser.test.ts src/components/spec-builder/spec-skeleton-wizard.tsx
git commit -m "feat(spec-builder): seed the single subsystem name from the spec title"
```

---

### Task 5: Rewrite the `inferHierarchy` AI prompt (extract, don't invent)

**Files:**
- Modify: `src/components/spec-builder/spec-skeleton-wizard.tsx` (`systemPrompt` inside `inferHierarchy`, ~lines 161-193)

> Prompts are reviewed, not unit-tested. This task is a careful edit + lint/build check. Keep the JSON output shape **identical** (the parser at line ~209 expects `SubsystemConfig[]`).

- [ ] **Step 1: Replace the rules portion of the prompt**

Replace the text from `You are an industrial automation engineer...` down to the line ending `...group related devices into assemblies by equipment ID prefix.` with:

```ts
      const systemPrompt = `You are an industrial automation engineer applying the ISA-88 equipment model. Organize the instrument register tags into a machine hierarchy:

System (Process Cell) -> Subsystem (Unit) -> Assembly (Equipment Module) -> Device (Control Module)

Rules:
- **Device (Control Module)** = a single physical thing with IO signals (motor, sensor, valve, push button). Tags with different suffixes (_CMD, _FB, _OL, _FAULT, _THERM) that belong to the same physical device MUST be grouped as io_signals on ONE device, never as separate devices.
- **Assembly (Equipment Module)** = a coordinated group of devices that run together (a conveyor, a drive, a lift). Each assembly later gets its own FB wired to device signals.
- **Subsystem (Unit)** = the set of assemblies governed by ONE coordinated operating sequence. DEFAULT TO A SINGLE SUBSYSTEM containing all assemblies. Create more than one subsystem ONLY when the provided specification clearly describes assemblies running under INDEPENDENT operating sequences (for example a distinct infeed area vs. outfeed area). NEVER invent a subsystem split that is not stated in the specification. A lone assembly is never its own subsystem.
- **System (Process Cell)** = the whole machine.
- Extract the structure as described in the source material. Do not invent groupings. When uncertain, prefer fewer subsystems.`;
```

Leave the existing `Return ONLY a JSON array matching this TypeScript interface:` block and the interface shape exactly as they are.

- [ ] **Step 2: Verify build/lint**

Run: `npm run lint`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/spec-builder/spec-skeleton-wizard.tsx
git commit -m "feat(spec-builder): inferHierarchy extracts ISA-88 levels, defaults to one subsystem"
```

---

### Task 6: Rewrite the `CLAUDE.md` hierarchy section + add PackML note

**Files:**
- Modify: `CLAUDE.md` (the "Machine Hierarchy (Non-negotiable)" section)

- [ ] **Step 1: Replace the section**

Replace the entire `## Machine Hierarchy (Non-negotiable)` section (from its heading down to the end of its bullet list, before `## Critical: All Changes Must Be Generic`) with:

```markdown
## Machine Hierarchy (Non-negotiable)

Pac-Forge models machines with a 4-level hierarchy based on **ISA-88** (the physical
equipment model), with **PackML** governing the state/behaviour layer. These are
industry standards, not a custom Pac convention. The functional spec defines the
structure — the AI **extracts** it, never invents it.

| Label (used in code/DB/UI) | ISA-88 equivalent | Definition | Code artifact |
|---|---|---|---|
| **System** | Process Cell | The whole machine / production line | Sequence logic (top orchestration) |
| **Subsystem** | Unit | The set of assemblies governed by **one** coordinated operating sequence | Sequence logic (step sequencer) that calls assembly FBs |
| **Assembly** | Equipment Module | A coordinated group of devices that run together (a conveyor, a drive) | Its **own FB**, with named signal I/O wired to device signals |
| **Device** | Control Module | A single physical thing with IO signals (motor, sensor, valve, push button) | An FB instance in a per-type device layer (e.g. `SEN[4]`, `MOT[2]`) |

**FB-assignment model:**
- Every **device** gets its own FB instance, organised by type in a device layer.
- Every **assembly** gets its own FB with named signal inputs/outputs. The assembly FB
  does **not** instantiate device FBs — its inputs are wired externally to device-FB
  members (e.g. `Sensor_A <- SEN[4].Ctrl.OutDelayOnOff`).
- **Subsystem** and **System** levels are **sequence logic** that drive the assembly FBs,
  not wrapper FBs that contain them.
- Devices and assemblies are peers in code, coupled by wiring; a shared device can feed
  multiple assemblies. "Device under assembly" in the spec tree is a logical grouping,
  not code ownership.

**Subsystem boundary rule:**
- **Default to a single subsystem** (= the machine). A lone assembly is never its own subsystem.
- Create multiple subsystems **only** when the spec describes assemblies running under
  **independent operating sequences** (e.g. an infeed area vs. an outfeed area), or
  replicated identical systems.
- Extract subsystem boundaries from the spec document — **never invent** them. When only
  an instrument register is available (no document), default to one subsystem and let the
  engineer split manually.

**Rules:**
- Only **devices** appear in the device list. **Assemblies** and **devices** both get FBs.
- **Assemblies** are driven by subsystem/system process-sequence logic.
- The spec builder outputs this hierarchy — the wizard extracts it directly.

**State/behaviour layer — PackML (ISA-TR88.00.02 / OMAC):** operating states, modes, and
the machine data interface (PackTags) follow PackML. The spec-builder already uses the
PackML state model (`state-machine.ts`, `OperatingStateV2`, `CANONICAL_STATES`); treat
PackML as the standard for the state/mode layer.
```

- [ ] **Step 2: Verify it reads correctly**

Run: `git diff CLAUDE.md`
Expected: the old hierarchy definitions (including "Assembly — Has NO FB" and "Only devices ... get FBs") are gone; the table + FB model + PackML note are present.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: rewrite machine hierarchy as ISA-88 + PackML, correct FB model"
```

---

### Task 7: Full verification

- [ ] **Step 1: Run the whole test suite**

Run: `npm test -- --run`
Expected: all tests PASS (no regressions in spec-builder tests or snapshots).

- [ ] **Step 2: Lint + typecheck/build**

Run: `npm run lint` then `npm run build`
Expected: both succeed (confirms the deleted helpers don't break `noUnusedLocals` and the wizard edits typecheck).

- [ ] **Step 3: Manual sanity (register → hierarchy)**

Re-run the deterministic check from the design's success criteria: upload `scripts/hk-segment-wagon-io.csv` via the wizard (or call `buildHierarchyFromTags` on its parsed tags) and confirm **1 subsystem** with assemblies Carriage / Rotator / Safety & Control / Operator Interface, the `M1` device carrying both `_FAULT` and `_THERM`, and all 43 signals present.

---

## Known follow-ups (NOT in this plan)

- **Phase 2:** feed spec-document text into the wizard hierarchy step + an AI "extract subsystems from the spec" action (separate plan).
- **Register-upload display:** `groupSubsystems` still labels the grouping column values as "subsystems" in the Phase 1 upload summary — relabel to "assemblies" for consistency.
- **V1-badge cosmetic bug** (`spec-builder.tsx` `isUnconfirmed`) — separate trivial fix.
- **Existing specs** saved with the old over-elevated hierarchy — decide migrate vs. leave (the `/migrate` flow exists).

---

## Self-Review

- **Spec coverage:** §5.1 CLAUDE.md → Task 6; §5.2 `buildHierarchyFromTags` default-one-subsystem + column→assembly → Task 2; `_THERM` split fix → Task 3; `inferHierarchy` prompt → Task 5; register column alias → Task 1; system name → Task 4. Phase-2 items and `groupSubsystems` relabel are explicitly deferred. Covered.
- **Placeholder scan:** no TBD/TODO; all steps carry concrete code/commands.
- **Type consistency:** `buildHierarchyFromTags(tags, systemName?)`, `SubsystemConfig`/`AssemblyConfig`/`DeviceConfig`/`IoSignal` fields match `src/types/spec-builder.ts`; `detectColumns` returns `{ mapping }` with a `subsystem` field (a `number | null`), used only for null-check in tests.
- **Dead-code risk:** Task 2 explicitly deletes `extractAssemblyPrefix`, `suggestAssemblyName`, `DEVICE_KEYWORD_RE` to satisfy `noUnusedLocals`; Task 7 build step verifies.
