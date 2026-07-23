# G5-4 Pac Program Structure Standard v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reshape the generated program from a flat OB1 + per-EM MAP FCs into the approved Pac standard: layer-ordered Main → `FC_Inputs` / per-unit `FC_<Unit>_Process`+`FC_<Unit>_Management` / `FC_Outputs` / `FC_Maintenance`, with by-unit TIA folders and a regen-preserved custom region.

**Architecture:** The existing writers keep producing the same *content*; only routing changes. `em-writer` splits its MAP FC into an `EmMapLines` IR (input lines / output+drive lines / temp vars) that new layer-FC writers assemble into `FC_Inputs`/`FC_Outputs`. `compile-contract` accumulates per-unit call lines into Process/Management FCs instead of one flat `deviceCallLines` array, and stamps folder paths by artifact type. The bridge gains a per-source folders map (its `GetOrCreateBlockGroup` already nests).

**Tech Stack:** TypeScript (pure codegen modules + vitest), React hooks (TanStack Query), C# .NET Framework 4.8 (TIA Openness bridge).

**Spec:** `Docs/superpowers/specs/2026-07-23-pac-program-structure-design.md` — read it before starting.

## Global Constraints

- All changes MUST be generic across machine types — no project-specific names in prompts/logic/fixtures (CLAUDE.md non-negotiable). Test fixtures use neutral names (`Process_Unit`, `Agitator_Module` style).
- TS strict: `import type` for type-only imports; no enums; no unused locals (`npx tsc -b` must pass clean after every task).
- Bridge changes MUST bump `BridgeVersion` in `TiaPortalService.cs` AND add a `bridge/PacForgeBridge/CHANGELOG.md` entry (CLAUDE.md mandatory). This plan's bridge change is v1.4.0 (new capability = minor).
- Bridge builds use `dotnet build bridge/PacForgeBridge/PacForgeBridge.csproj` (NEVER the .sln — the V18 twin's exe is often locked).
- UC/EM FB internals, command seam, PackTags (UN/CFG/STAT), IO tag table (G9-W4), promote-to-library, and the HMI compiler are **out of scope — do not modify**.
- Scan-order guarantees that MUST survive: IO_Cond runs before any conditioned read (both now inside `FC_Inputs`); every Process FC before every Management FC; `MAINT_Output_Override` is the final call of the scan.
- Commit after each task (house convention: direct to master, `feat(codegen):` / `fix(codegen):` style).

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `src/lib/spec-builder/codegen/types.ts` | Modify | Add `"system"` layer; add `EmMapLines` |
| `src/lib/spec-builder/codegen/em-writer.ts` | Modify | Split MAP FC into `buildEmMapLines()`; 4-artifact bundle; single call line |
| `src/lib/spec-builder/codegen/naming.ts` | Modify | Remove `mapFcName`; add layer/unit FC + folder name helpers |
| `src/lib/spec-builder/codegen/layer-fc-writer.ts` | Create | `FC_Inputs` / `FC_Outputs` / `FC_Maintenance` writers |
| `src/lib/spec-builder/codegen/custom-region.ts` | Create | Marker constants + extract/inject/merge (pure) |
| `src/lib/spec-builder/codegen/unit-fc-writer.ts` | Create | `FC_<Unit>_Process` / `FC_<Unit>_Management` writers |
| `src/lib/spec-builder/codegen/ob1-writer.ts` | Modify | Fixed layer-ordered Main |
| `src/lib/spec-builder/codegen/compile-contract.ts` | Modify | Per-unit assembly + folder stamping |
| `src/lib/spec-builder/codegen/fb-instantiate.ts` | Modify | Template body artifacts → `Library` folder |
| `src/lib/spec-builder/custom-region-carryover.ts` | Create | Cross-revision region carry-over (row-loader injected) |
| `src/hooks/use-code-builder.ts` | Modify | Apply carry-over on first compile of a new revision |
| `src/hooks/use-send-code-to-tia.ts` | Modify | Carry-over in buildPlan + folders map in send |
| `src/hooks/use-reimport-compile.ts` | Modify | `folders` in request body |
| `src/components/code-builder/artifact-viewer.tsx` | Modify | Remove dead Map tab |
| `src/components/code-builder/builder-stepper.tsx` | Modify | Enable Unit step |
| `src/routes/code-builder.tsx` | Modify | Unit layer selectable; promote panel gated to em/device |
| `bridge/PacForgeBridge/Models.cs` | Modify | `ReimportRequest.Folders` |
| `bridge/PacForgeBridge/TiaPortalService.cs` | Modify | Folder-aware reimport + recursive delete; v1.4.0 |
| `bridge/PacForgeBridge/BridgeServer.cs` | Modify | Pass `Folders` through |
| `bridge/PacForgeBridge/CHANGELOG.md` | Modify | 1.4.0 entry |

---

### Task 1: `EmMapLines` IR — em-writer stops emitting MAP FCs

**Files:**
- Modify: `src/lib/spec-builder/codegen/types.ts`
- Modify: `src/lib/spec-builder/codegen/em-writer.ts`
- Modify: `src/lib/spec-builder/codegen/naming.ts` (remove `mapFcName`)
- Test: `src/lib/spec-builder/codegen/__tests__/em-writer.test.ts`

**Interfaces:**
- Consumes: existing `EmSequence`, `buildDriveEmission`, `emDbName`.
- Produces: `EmMapLines { emName: string; inputLines: string[]; outputLines: string[]; tempVars: string[] }` (in types.ts); `writeEmArtifacts(seq): { artifacts: CodegenArtifact[]; callLines: string[]; mapLines: EmMapLines }` — artifacts is now the 4-artifact bundle + drive DBs (NO MAP FC), callLines is a SINGLE EM-instance call line. Task 5 consumes `mapLines`.

- [ ] **Step 1: Add the types**

In `types.ts`, change the layer union and add the IR (after `CodegenArtifact`):

```ts
export type CodegenLayer = "device" | "em" | "unit" | "system" | "ob1";
```

```ts
/** Per-EM mapping content routed into the layer FCs (G5-4). The writers keep
 *  producing the same lines the old MAP_<EM> FC held; only the destination
 *  changed: inputLines -> FC_Inputs, outputLines (+drive calls) -> FC_Outputs. */
export interface EmMapLines {
  /** sclIdent'ed EM name — used for the per-EM banner comment. */
  emName: string;
  /** Physical/conditioned/scaled reads -> instance-DB input pins. */
  inputLines: string[];
  /** Instance-DB actuator pins -> physical outputs, then drive telegram calls. */
  outputLines: string[];
  /** VAR_TEMP declarations the drive emissions need (land in FC_Outputs). */
  tempVars: string[];
}
```

- [ ] **Step 2: Write the failing tests**

In `em-writer.test.ts` add (adjusting imports to the file's existing fixture builder for `EmSequence` — reuse whatever helper the suite already uses to build a seq with sensors/actuators):

```ts
describe("G5-4 map-line split", () => {
  it("writeEmArtifacts emits 4 artifacts (no MAP FC) and a single call line", () => {
    const { artifacts, callLines, mapLines } = writeEmArtifacts(seq); // existing fixture
    expect(artifacts.some((a) => a.name.startsWith("MAP_"))).toBe(false);
    expect(artifacts.map((a) => a.type).sort()).toEqual(["DB", "DB", "FB", "UDT"]); // + drive DBs when fixture has drives
    expect(callLines).toHaveLength(1);
    expect(callLines[0]).toContain(`"EM_${seq.sclName}_DB"(`);
    expect(callLines[0]).not.toContain("MAP_");
    expect(mapLines.emName).toBe(seq.sclName);
  });

  it("routes sensor reads to inputLines and actuator writes + drive calls to outputLines", () => {
    const { mapLines } = writeEmArtifacts(seq);
    for (const l of mapLines.inputLines) expect(l).toMatch(/"EM_.*_DB"\.\w+ :=|\/\/ TODO wire sensor/);
    for (const l of mapLines.outputLines.filter((x) => x.includes(" := ") && !x.includes("("))) {
      expect(l).toMatch(/^   "\w+" := "EM_.*_DB"\./); // physical := instanceDB.pin
    }
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/em-writer.test.ts`
Expected: FAIL (`mapLines` undefined / MAP artifact still present).

- [ ] **Step 4: Implement**

In `em-writer.ts`:
1. Rename `writeMapFc` → `buildEmMapLines` with this shape (the sensor/actuator/drive line construction is IDENTICAL to today — only the FC shell wrapper is deleted):

```ts
/** The IO seam between physical addresses and the instance DB, as routed
 *  lines (G5-4): inputs land in FC_Inputs, outputs + drive calls in
 *  FC_Outputs. Replaces the per-EM MAP FC. */
function buildEmMapLines(seq: EmSequence): { mapLines: EmMapLines; driveDbs: CodegenArtifact[] } {
  const inst = emDbName(seq.sclName);
  // ... keep the existing emissions/consumed/tempVars/driveLines/driveDbs block verbatim ...
  // ... keep the existing sensorLines construction verbatim ...
  // ... keep the existing actuatorLines construction verbatim ...
  return {
    mapLines: {
      emName: seq.sclName,
      inputLines: sensorLines,
      outputLines: [...actuatorLines, ...(driveLines.length ? [``, ...driveLines] : [])],
      tempVars,
    },
    driveDbs,
  };
}
```

2. `buildCallLines` drops the MAP call:

```ts
/** Management-FC call line: instantiate the FB from its CMD DB. */
function buildCallLines(seq: EmSequence): string[] {
  const inst = emDbName(seq.sclName);
  const { callBindings } = buildCommandSeam(seq.sclName, commandPins(seq));
  return [`   "${inst}"(${callBindings.join(", ")});`];
}
```

3. `writeEmArtifacts`:

```ts
export function writeEmArtifacts(seq: EmSequence): {
  artifacts: CodegenArtifact[]; callLines: string[]; mapLines: EmMapLines;
} {
  const map = buildEmMapLines(seq);
  return {
    artifacts: [writeFb(seq), writeStateUdt(seq), writeCmdDb(seq), writeInstanceDb(seq), ...map.driveDbs],
    callLines: buildCallLines(seq),
    mapLines: map.mapLines,
  };
}
```

4. Remove the `mapFcName` import from em-writer; delete `mapFcName` from `naming.ts` (grep confirmed: no other non-test consumer). Add `import type { EmMapLines }` from `./types`.

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/em-writer.test.ts && npx tsc -b`
Expected: new tests PASS; pre-existing MAP-FC assertions in this suite FAIL — update them in place: any assertion on `MAP_<X>` artifact content moves to the equivalent `mapLines.inputLines`/`outputLines` assertion (same expected strings, minus the `FUNCTION "MAP_..."` shell lines). `compile-contract.test.ts` will fail until Task 5 — that is expected; do not fix it here.

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/codegen/types.ts src/lib/spec-builder/codegen/em-writer.ts src/lib/spec-builder/codegen/naming.ts src/lib/spec-builder/codegen/__tests__/em-writer.test.ts
git commit -m "feat(codegen): split MAP FC into EmMapLines IR — 4-artifact EM bundle (G5-4)"
```

---

### Task 2: layer-fc-writer — FC_Inputs / FC_Outputs / FC_Maintenance

**Files:**
- Create: `src/lib/spec-builder/codegen/layer-fc-writer.ts`
- Modify: `src/lib/spec-builder/codegen/naming.ts` (add name/folder constants)
- Test: `src/lib/spec-builder/codegen/__tests__/layer-fc-writer.test.ts`

**Interfaces:**
- Consumes: `EmMapLines` (Task 1).
- Produces (Task 5 consumes):
  - `writeFcInputs(input: { ioCondCallLine?: string; ems: EmMapLines[] }): CodegenArtifact`
  - `writeFcOutputs(input: { ems: EmMapLines[] }): CodegenArtifact`
  - `writeFcMaintenance(input: { presetCallLine?: string; overrideCallLine?: string }): CodegenArtifact`
  - naming.ts: `FC_INPUTS = "FC_Inputs"`, `FC_OUTPUTS = "FC_Outputs"`, `FC_MAINTENANCE = "FC_Maintenance"`, `FOLDER_SYSTEM = "00_System"`, `FOLDER_LIBRARY = "Library"`, `unitProcessFcName(unitScl)` → `` `FC_${unitScl}_Process` ``, `unitManagementFcName(unitScl)` → `` `FC_${unitScl}_Management` ``.
- All three FCs are ALWAYS emitted (empty body → `   // (nothing in this project)`) so every project has the same skeleton; `layer: "system"`, `folder: FOLDER_SYSTEM`.

- [ ] **Step 1: Add naming constants** (append to `naming.ts`):

```ts
/** G5-4 layer scaffolding (Pac Program Structure Standard v1). */
export const FC_INPUTS = "FC_Inputs";
export const FC_OUTPUTS = "FC_Outputs";
export const FC_MAINTENANCE = "FC_Maintenance";
export const FOLDER_SYSTEM = "00_System";
export const FOLDER_LIBRARY = "Library";
export const unitProcessFcName = (unitScl: string): string => `FC_${unitScl}_Process`;
export const unitManagementFcName = (unitScl: string): string => `FC_${unitScl}_Management`;
```

- [ ] **Step 2: Write the failing tests** (`layer-fc-writer.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { writeFcInputs, writeFcOutputs, writeFcMaintenance } from "../layer-fc-writer";
import type { EmMapLines } from "../types";

const em = (over: Partial<EmMapLines> = {}): EmMapLines => ({
  emName: "Agitator_Module",
  inputLines: [`   "EM_Agitator_Module_DB".fb_run := "AGITATOR_FB_RUN";   // %I0.0`],
  outputLines: [`   "AGITATOR_CMD" := "EM_Agitator_Module_DB".cmd_motor;   // %Q0.0`],
  tempVars: [],
  ...over,
});

describe("writeFcInputs", () => {
  it("calls IO_Cond FIRST, then per-EM banners with input lines", () => {
    const a = writeFcInputs({ ioCondCallLine: `   "FB_IO_Conditioning_DB"();`, ems: [em()] });
    expect(a.name).toBe("FC_Inputs");
    expect(a.layer).toBe("system");
    expect(a.folder).toBe("00_System");
    const body = a.content;
    expect(body.indexOf("FB_IO_Conditioning_DB")).toBeGreaterThan(-1);
    expect(body.indexOf("FB_IO_Conditioning_DB")).toBeLessThan(body.indexOf("// --- Agitator_Module ---"));
    expect(body).toContain(`"EM_Agitator_Module_DB".fb_run := "AGITATOR_FB_RUN"`);
    expect(body).not.toContain("AGITATOR_CMD :=");
  });

  it("emits an empty-body FC when there is nothing to map", () => {
    const a = writeFcInputs({ ems: [] });
    expect(a.content).toContain("// (nothing in this project)");
  });
});

describe("writeFcOutputs", () => {
  it("emits per-EM banners with output lines and hoists drive temp vars", () => {
    const a = writeFcOutputs({ ems: [em({ tempVars: [`      ref_M1 : Int;`], outputLines: [`   "AGITATOR_CMD" := "EM_Agitator_Module_DB".cmd_motor;`, `   #ref_M1 := "EM_Agitator_Module_DB".sp_speed;`] })] });
    expect(a.content).toContain("VAR_TEMP");
    expect(a.content).toContain("ref_M1 : Int;");
    expect(a.content).toContain("// --- Agitator_Module ---");
    expect(a.content).not.toContain("fb_run :=");
  });
});

describe("writeFcMaintenance", () => {
  it("puts the override call LAST", () => {
    const a = writeFcMaintenance({
      presetCallLine: `   "MAINT_Encoder_Preset"();`,
      overrideCallLine: `   "MAINT_Output_Override"();   // MUST stay the last call`,
    });
    const preset = a.content.indexOf("MAINT_Encoder_Preset");
    const override = a.content.indexOf("MAINT_Output_Override");
    expect(preset).toBeGreaterThan(-1);
    expect(override).toBeGreaterThan(preset);
  });

  it("emits an empty FC when no maintenance exists", () => {
    expect(writeFcMaintenance({}).content).toContain("// (nothing in this project)");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/layer-fc-writer.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement** (`layer-fc-writer.ts`):

```ts
// src/lib/spec-builder/codegen/layer-fc-writer.ts
//
// G5-4 — the three global scaffolding FCs of the Pac Program Structure
// Standard. FC_Inputs runs conditioning then maps physical inputs into the
// EM instance DBs (same-scan fresh); FC_Outputs maps EM outputs to physical
// tags and runs the drive telegram FBs; FC_Maintenance holds the maintenance
// FCs with the output override structurally last.
import type { CodegenArtifact, EmMapLines } from "./types";
import { FC_INPUTS, FC_OUTPUTS, FC_MAINTENANCE, FOLDER_SYSTEM } from "./naming";
import { emDbName } from "./naming";

const banner = (emName: string): string => `   // --- ${emName} ---`;

function fcShell(name: string, body: string[], tempVars: string[]): string {
  const trimmed = [...body];
  while (trimmed.length && trimmed[trimmed.length - 1] === ``) trimmed.pop();
  return [
    `FUNCTION "${name}" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    ...(tempVars.length ? [`   VAR_TEMP`, ...tempVars, `   END_VAR`, ``] : []),
    `BEGIN`,
    ...(trimmed.length ? trimmed : [`   // (nothing in this project)`]),
    `END_FUNCTION`,
    ``,
  ].join("\n");
}

function systemFc(name: string, content: string, dependencies: string[]): CodegenArtifact {
  return { name, type: "FC", filename: `${name}.scl`, content, dependencies, folder: FOLDER_SYSTEM, layer: "system" };
}

export function writeFcInputs(input: { ioCondCallLine?: string; ems: EmMapLines[] }): CodegenArtifact {
  const body: string[] = [];
  if (input.ioCondCallLine) {
    body.push(`   // conditioning first — conditioned reads below are same-scan fresh`, input.ioCondCallLine, ``);
  }
  for (const em of input.ems) {
    if (!em.inputLines.length) continue;
    body.push(banner(em.emName), ...em.inputLines, ``);
  }
  const deps = input.ems.filter((e) => e.inputLines.length).map((e) => emDbName(e.emName));
  return systemFc(FC_INPUTS, fcShell(FC_INPUTS, body, []), deps);
}

export function writeFcOutputs(input: { ems: EmMapLines[] }): CodegenArtifact {
  const body: string[] = [];
  const tempVars = input.ems.flatMap((e) => e.tempVars);
  for (const em of input.ems) {
    if (!em.outputLines.length) continue;
    body.push(banner(em.emName), ...em.outputLines, ``);
  }
  const deps = input.ems.filter((e) => e.outputLines.length).map((e) => emDbName(e.emName));
  return systemFc(FC_OUTPUTS, fcShell(FC_OUTPUTS, body, tempVars), deps);
}

export function writeFcMaintenance(input: { presetCallLine?: string; overrideCallLine?: string }): CodegenArtifact {
  const body: string[] = [];
  if (input.presetCallLine) body.push(input.presetCallLine);
  if (input.overrideCallLine) body.push(input.overrideCallLine);
  return systemFc(FC_MAINTENANCE, fcShell(FC_MAINTENANCE, body, []), []);
}
```

(Merge the two `./naming` imports into one line — shown split here only for clarity.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/layer-fc-writer.test.ts && npx tsc -b`
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/codegen/layer-fc-writer.ts src/lib/spec-builder/codegen/naming.ts src/lib/spec-builder/codegen/__tests__/layer-fc-writer.test.ts
git commit -m "feat(codegen): FC_Inputs/FC_Outputs/FC_Maintenance layer writers (G5-4)"
```

---

### Task 3: custom-region + unit-fc-writer — Process / Management FCs

**Files:**
- Create: `src/lib/spec-builder/codegen/custom-region.ts`
- Create: `src/lib/spec-builder/codegen/unit-fc-writer.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/custom-region.test.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/unit-fc-writer.test.ts`

**Interfaces:**
- Consumes: `unitProcessFcName` / `unitManagementFcName` (Task 2).
- Produces (Tasks 5 & 6 consume):
  - `CUSTOM_REGION_BEGIN` / `CUSTOM_REGION_END` (exact marker strings below)
  - `extractCustomRegion(content: string): string | null` — inner text between markers (exclusive), `null` when either marker is missing or out of order.
  - `mergeCustomRegion(fresh: string, previous: string | null | undefined): { content: string; warning?: string }` — carries the previous region body into `fresh`; on any marker problem returns `fresh` unchanged + a warning (never silently drops hand code).
  - `writeUnitProcessFc(input: { unitScl: string; unitName: string; unitId: string; ucCallLine: string }): CodegenArtifact`
  - `writeUnitManagementFc(input: { unitScl: string; unitName: string; unitId: string; callLines: string[] }): CodegenArtifact`
- Both unit FCs: `layer: "unit"`, `folder: unitScl` (unit-folder root), `ownerId: unitId`, `ownerName: unitName`.

- [ ] **Step 1: Write the failing tests**

`custom-region.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CUSTOM_REGION_BEGIN, CUSTOM_REGION_END, extractCustomRegion, mergeCustomRegion } from "../custom-region";

const fresh = [
  `FUNCTION "FC_Process_Unit_Process" : Void`,
  `BEGIN`,
  `   "UC_Process_Unit_DB"();`,
  `   ${CUSTOM_REGION_BEGIN}`,
  `   // (site/process-specific ties, one-shots, special cases)`,
  `   ${CUSTOM_REGION_END}`,
  `END_FUNCTION`,
].join("\n");

describe("extractCustomRegion", () => {
  it("returns the inner body", () => {
    const edited = fresh.replace(
      `   // (site/process-specific ties, one-shots, special cases)`,
      `   "SPECIAL_LAMP" := TRUE;`,
    );
    expect(extractCustomRegion(edited)).toContain(`"SPECIAL_LAMP" := TRUE;`);
  });
  it("returns null when a marker is missing or out of order", () => {
    expect(extractCustomRegion("no markers here")).toBeNull();
    expect(extractCustomRegion(`${CUSTOM_REGION_END}\n${CUSTOM_REGION_BEGIN}`)).toBeNull();
  });
});

describe("mergeCustomRegion", () => {
  it("carries the previous body into the fresh generation", () => {
    const edited = fresh.replace(
      `   // (site/process-specific ties, one-shots, special cases)`,
      `   "SPECIAL_LAMP" := TRUE;`,
    );
    const { content, warning } = mergeCustomRegion(fresh, edited);
    expect(warning).toBeUndefined();
    expect(content).toContain(`"SPECIAL_LAMP" := TRUE;`);
    expect(content).toContain(`"UC_Process_Unit_DB"();`);
  });
  it("returns fresh + warning when previous markers are mangled", () => {
    const { content, warning } = mergeCustomRegion(fresh, "markers gone");
    expect(content).toBe(fresh);
    expect(warning).toMatch(/NOT carried over/);
  });
  it("no-ops on null/undefined previous", () => {
    expect(mergeCustomRegion(fresh, null).content).toBe(fresh);
    expect(mergeCustomRegion(fresh, undefined).warning).toBeUndefined();
  });
});
```

`unit-fc-writer.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { writeUnitProcessFc, writeUnitManagementFc } from "../unit-fc-writer";
import { CUSTOM_REGION_BEGIN, CUSTOM_REGION_END } from "../custom-region";

const base = { unitScl: "Process_Unit", unitName: "Process Unit", unitId: "u-1" };

describe("writeUnitProcessFc", () => {
  it("calls the UC then the custom region, in unit-root folder / unit layer", () => {
    const a = writeUnitProcessFc({ ...base, ucCallLine: `   "UC_Process_Unit_DB"();` });
    expect(a.name).toBe("FC_Process_Unit_Process");
    expect(a.folder).toBe("Process_Unit");
    expect(a.layer).toBe("unit");
    expect(a.ownerId).toBe("u-1");
    const uc = a.content.indexOf(`"UC_Process_Unit_DB"();`);
    const begin = a.content.indexOf(CUSTOM_REGION_BEGIN);
    const end = a.content.indexOf(CUSTOM_REGION_END);
    expect(uc).toBeGreaterThan(-1);
    expect(begin).toBeGreaterThan(uc);
    expect(end).toBeGreaterThan(begin);
  });
});

describe("writeUnitManagementFc", () => {
  it("emits the unit's call lines verbatim, in order", () => {
    const lines = [`   "EM_Agitator_Module_DB"(enable := "Agitator_Module_CMD".enable);`, `   "EM_Dosing_Module_DB"();`];
    const a = writeUnitManagementFc({ ...base, callLines: lines });
    expect(a.name).toBe("FC_Process_Unit_Management");
    expect(a.content.indexOf("Agitator_Module")).toBeLessThan(a.content.indexOf("Dosing_Module"));
  });
  it("emits an empty-body FC for a unit with no members", () => {
    expect(writeUnitManagementFc({ ...base, callLines: [] }).content).toContain("// (no equipment modules)");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/custom-region.test.ts src/lib/spec-builder/codegen/__tests__/unit-fc-writer.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `custom-region.ts`**

```ts
// src/lib/spec-builder/codegen/custom-region.ts
//
// G5-4 §3 — the regen-preserved custom-logic region in FC_<Unit>_Process.
// Markers are exact-match; any mangling aborts the merge WITH a warning so
// hand code is never silently dropped.

export const CUSTOM_REGION_BEGIN = "// --- custom process logic (preserved on regen) ---";
export const CUSTOM_REGION_END = "// --- end custom ---";

/** Inner text between the markers (exclusive), or null when either marker is
 *  missing or out of order. Whitespace inside the region is preserved. */
export function extractCustomRegion(content: string): string | null {
  const b = content.indexOf(CUSTOM_REGION_BEGIN);
  const e = content.indexOf(CUSTOM_REGION_END);
  if (b === -1 || e === -1 || e <= b) return null;
  return content.slice(b + CUSTOM_REGION_BEGIN.length, e);
}

/** Replace fresh's region body with the region body extracted from previous.
 *  Any marker problem returns fresh unchanged plus a warning. */
export function mergeCustomRegion(
  fresh: string,
  previous: string | null | undefined,
): { content: string; warning?: string } {
  if (!previous) return { content: fresh };
  const body = extractCustomRegion(previous);
  if (body === null) {
    return { content: fresh, warning: "custom-region markers missing/mangled in the previous edit — region NOT carried over" };
  }
  const b = fresh.indexOf(CUSTOM_REGION_BEGIN);
  const e = fresh.indexOf(CUSTOM_REGION_END);
  if (b === -1 || e === -1 || e <= b) {
    return { content: fresh, warning: "fresh generation lacks custom-region markers — region NOT carried over" };
  }
  return { content: fresh.slice(0, b + CUSTOM_REGION_BEGIN.length) + body + fresh.slice(e) };
}
```

- [ ] **Step 4: Implement `unit-fc-writer.ts`**

```ts
// src/lib/spec-builder/codegen/unit-fc-writer.ts
//
// G5-4 — per-unit scaffolding FCs. Process is the unit's brain slot (UC call
// + preserved custom region; ONE brain per unit — never a second sequencer).
// Management is the unit's instance-call slot.
import type { CodegenArtifact } from "./types";
import { unitManagementFcName, unitProcessFcName } from "./naming";
import { CUSTOM_REGION_BEGIN, CUSTOM_REGION_END } from "./custom-region";

interface UnitFcBase { unitScl: string; unitName: string; unitId: string; }

function unitFc(name: string, base: UnitFcBase, content: string, dependencies: string[]): CodegenArtifact {
  return {
    name, type: "FC", filename: `${name}.scl`, content, dependencies,
    folder: base.unitScl, layer: "unit", ownerId: base.unitId, ownerName: base.unitName,
  };
}

export function writeUnitProcessFc(input: UnitFcBase & { ucCallLine: string }): CodegenArtifact {
  const name = unitProcessFcName(input.unitScl);
  const content = [
    `FUNCTION "${name}" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `BEGIN`,
    `   // --- generated: unit brain (${input.unitName}) ---`,
    input.ucCallLine,
    ``,
    `   ${CUSTOM_REGION_BEGIN}`,
    `   // (site/process-specific ties, one-shots, special cases)`,
    `   ${CUSTOM_REGION_END}`,
    `END_FUNCTION`,
    ``,
  ].join("\n");
  return unitFc(name, input, content, []);
}

export function writeUnitManagementFc(input: UnitFcBase & { callLines: string[] }): CodegenArtifact {
  const name = unitManagementFcName(input.unitScl);
  const content = [
    `FUNCTION "${name}" : Void`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `BEGIN`,
    ...(input.callLines.length ? input.callLines : [`   // (no equipment modules)`]),
    `END_FUNCTION`,
    ``,
  ].join("\n");
  return unitFc(name, input, content, []);
}
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/custom-region.test.ts src/lib/spec-builder/codegen/__tests__/unit-fc-writer.test.ts && npx tsc -b`
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/codegen/custom-region.ts src/lib/spec-builder/codegen/unit-fc-writer.ts src/lib/spec-builder/codegen/__tests__/custom-region.test.ts src/lib/spec-builder/codegen/__tests__/unit-fc-writer.test.ts
git commit -m "feat(codegen): Process/Management unit FCs + preserved custom region (G5-4)"
```

---

### Task 4: ob1-writer — fixed layer-ordered Main

**Files:**
- Modify: `src/lib/spec-builder/codegen/ob1-writer.ts` (full rewrite of `writeOb1`)
- Test: `src/lib/spec-builder/codegen/__tests__/ob1-writer.test.ts`

**Interfaces:**
- Consumes: naming constants (Task 2).
- Produces (Task 5 consumes): `writeOb1(units: UnitCallRef[]): CodegenArtifact` where `UnitCallRef { sclName: string }` (unchanged export name/type; the `deviceCallLines` param is GONE).

- [ ] **Step 1: Write the failing test** (replace the suite's existing call-order tests — the old flat-order assertions are obsolete by design):

```ts
import { describe, expect, it } from "vitest";
import { writeOb1 } from "../ob1-writer";

describe("writeOb1 (G5-4 layer shape)", () => {
  it("emits the fixed layer order: Inputs, all Process, all Management, Outputs, Maintenance", () => {
    const a = writeOb1([{ sclName: "Process_Unit" }, { sclName: "Packaging_Unit" }]);
    const c = a.content;
    const order = [
      `"FC_Inputs"();`,
      `"FC_Process_Unit_Process"();`,
      `"FC_Packaging_Unit_Process"();`,
      `"FC_Process_Unit_Management"();`,
      `"FC_Packaging_Unit_Management"();`,
      `"FC_Outputs"();`,
      `"FC_Maintenance"();`,
    ];
    const idx = order.map((s) => c.indexOf(s));
    expect(idx.every((i) => i > -1)).toBe(true);
    expect([...idx].sort((x, y) => x - y)).toEqual(idx); // strictly in order
    expect(c).not.toContain("MAP_");
    expect(c).not.toContain(`"EM_`); // no direct EM instance calls in Main
  });

  it("lists the layer + unit FCs as dependencies", () => {
    const a = writeOb1([{ sclName: "Process_Unit" }]);
    expect(a.dependencies).toEqual(
      expect.arrayContaining(["FC_Inputs", "FC_Outputs", "FC_Maintenance", "FC_Process_Unit_Process", "FC_Process_Unit_Management"]),
    );
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/spec-builder/codegen/__tests__/ob1-writer.test.ts` → FAIL.

- [ ] **Step 3: Implement** (full new `ob1-writer.ts`):

```ts
// src/lib/spec-builder/codegen/ob1-writer.ts
//
// G5-4 — Main is a fixed scan-cycle table of contents. It NEVER grows except
// by two lines per unit; all content lives in the layer / unit FCs.
import type { CodegenArtifact } from "./types";
import { FC_INPUTS, FC_MAINTENANCE, FC_OUTPUTS, unitManagementFcName, unitProcessFcName } from "./naming";

/** Minimal handle on a compiled Unit for the OB1 call tree. */
export interface UnitCallRef {
  sclName: string;
}

/** Emit the layer-ordered Main of the Pac Program Structure Standard v1. */
export function writeOb1(units: UnitCallRef[]): CodegenArtifact {
  const processCalls = units.map((u) => `   "${unitProcessFcName(u.sclName)}"();`);
  const managementCalls = units.map((u) => `   "${unitManagementFcName(u.sclName)}"();`);
  const deps = [
    FC_INPUTS, FC_OUTPUTS, FC_MAINTENANCE,
    ...units.flatMap((u) => [unitProcessFcName(u.sclName), unitManagementFcName(u.sclName)]),
  ];
  const content = [
    `ORGANIZATION_BLOCK "Main"`,
    `{ S7_Optimized_Access := 'TRUE' }`,
    `VERSION : 0.1`,
    `BEGIN`,
    `   "${FC_INPUTS}"();   // conditioning + input mapping`,
    ``,
    `   // --- process layer: unit brains decide ---`,
    ...processCalls,
    ``,
    `   // --- management layer: instances execute ---`,
    ...managementCalls,
    ``,
    `   "${FC_OUTPUTS}"();   // output mapping + drive telegrams`,
    `   "${FC_MAINTENANCE}"();   // overrides — always the last call`,
    `END_ORGANIZATION_BLOCK`,
    ``,
  ].join("\n");
  return { name: "Main", type: "OB", filename: "Main.ob", content, dependencies: deps, folder: "Program blocks", layer: "ob1" };
}
```

- [ ] **Step 4: Run tests + typecheck** — ob1 suite PASS; `npx tsc -b` will FAIL on `compile-contract.ts` (old 2-arg call) — expected until Task 5; verify the ONLY tsc error is that call site.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/codegen/ob1-writer.ts src/lib/spec-builder/codegen/__tests__/ob1-writer.test.ts
git commit -m "feat(codegen): layer-ordered Main — fixed scan table of contents (G5-4)"
```

---

### Task 5: compile-contract — per-unit assembly + folder stamping

**Files:**
- Modify: `src/lib/spec-builder/codegen/compile-contract.ts`
- Modify: `src/lib/spec-builder/codegen/fb-instantiate.ts` (template bodies → Library folder)
- Test: `src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4 (exact signatures in their Interfaces blocks).
- Produces: `compileContract(contract, templates): CodegenResult` — same signature; artifact set now contains `FC_Inputs`, `FC_Outputs`, `FC_Maintenance`, per-unit `FC_<U>_Process`/`FC_<U>_Management`, NO `MAP_*`, and every artifact carries its real folder.

**Folder stamping rules (implement as two helpers inside compile-contract):**

```ts
const stampUnit = (a: CodegenArtifact, unitScl: string): CodegenArtifact => {
  if (a.folder === FOLDER_LIBRARY || a.folder === "PLC data types") return a;
  if (a.type === "FB") return { ...a, folder: `${unitScl}/FB` };
  if (a.type === "DB") return { ...a, folder: `${unitScl}/DB` };
  return { ...a, folder: unitScl }; // FCs (LINK_IN/LINK_OUT, stubs) at unit root
};
const stampSystem = (a: CodegenArtifact): CodegenArtifact =>
  a.folder === "PLC data types" ? a : { ...a, folder: FOLDER_SYSTEM };
```

- [ ] **Step 1: Write the failing structural test** (add to `compile-contract.test.ts`, using the suite's existing 2-unit contract fixture or extending it to 2 units):

```ts
describe("G5-4 program structure", () => {
  it("emits the layer skeleton and no MAP FCs", () => {
    const { artifacts } = compileContract(contract, []);
    const names = artifacts.map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(["Main", "FC_Inputs", "FC_Outputs", "FC_Maintenance"]));
    expect(names.some((n) => n.startsWith("MAP_"))).toBe(false);
  });

  it("emits Process + Management per non-excluded unit, Process calling the UC", () => {
    const { artifacts } = compileContract(contract, []);
    const process = artifacts.filter((a) => /^FC_.*_Process$/.test(a.name));
    const mgmt = artifacts.filter((a) => /^FC_.*_Management$/.test(a.name));
    expect(process.length).toBeGreaterThan(0);
    expect(process.length).toBe(mgmt.length);
    for (const p of process) expect(p.content).toMatch(/"UC_\w+(_DB)?"\(/);
    for (const m of mgmt) expect(m.content).toMatch(/"EM_\w+_DB"\(|\/\/ \(no equipment modules\)/);
  });

  it("stamps folders: unit FCs at unit root, FBs in <U>/FB, DBs in <U>/DB, system in 00_System", () => {
    const { artifacts } = compileContract(contract, []);
    const byName = new Map(artifacts.map((a) => [a.name, a]));
    const anyProcess = artifacts.find((a) => /^FC_.*_Process$/.test(a.name))!;
    const unitScl = anyProcess.folder; // unit root
    expect(unitScl).not.toBe("Program blocks");
    const emFb = artifacts.find((a) => a.type === "FB" && a.name.startsWith("EM_"))!;
    expect(emFb.folder).toMatch(/\/FB$/);
    const emDb = artifacts.find((a) => a.type === "DB" && a.name.endsWith("_CMD"))!;
    expect(emDb.folder).toMatch(/\/DB$/);
    expect(byName.get("FC_Inputs")!.folder).toBe("00_System");
    expect(byName.get("Main")!.folder).toBe("Program blocks");
    const udt = artifacts.find((a) => a.type === "UDT");
    if (udt) expect(udt.folder).toBe("PLC data types");
  });

  it("keeps input mapping in FC_Inputs (with IO_Cond first when present) and outputs in FC_Outputs", () => {
    const { artifacts } = compileContract(contract, []);
    const inputs = artifacts.find((a) => a.name === "FC_Inputs")!;
    const outputs = artifacts.find((a) => a.name === "FC_Outputs")!;
    expect(inputs.content).not.toMatch(/^   "\w+" := "EM_/m);   // no physical-output writes
    expect(outputs.content).not.toMatch(/"EM_\w+_DB"\.\w+ := "(?!EM_)/); // no input reads
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts` → FAIL.

- [ ] **Step 3: `fb-instantiate.ts` — Library folder.** In `templateBodyArtifacts()` (the G6-1 lowering of a matched template's blocks, around line 189), change the emitted artifacts' `folder` from the current `"Program blocks"` value to `FOLDER_LIBRARY` (import from `./naming`). The instance-DB artifacts built elsewhere in `instantiate()` keep their folder (stamped per-unit by compile-contract).

- [ ] **Step 4: Rewrite the assembly in `compile-contract.ts`.** Keep ALL existing per-EM case logic (A/B/C/D, coverage gate, seam, links, presets, unit IR) — only the collection targets change:

Replace `const deviceCallLines: string[] = [];` with:

```ts
const emMapLines: EmMapLines[] = [];
interface UnitAssembly { unitScl: string; unitName: string; unitId: string; processCall: string; managementLines: string[] }
const unitAssemblies: UnitAssembly[] = [];
```

Inside the unit loop:
1. `const managementLines: string[] = [];` replaces the `unitCallStart` splice bookkeeping (delete `unitCallStart`).
2. `synthesizeEm`: `writeEmArtifacts(seq)` now also returns `mapLines` — push `emArts.forEach((a) => push(stampUnit(a, unitScl)))`, `managementLines.push(...callLines)`, `emMapLines.push(mapLines)`.
   (Compute `const unitScl = sclIdent(unit.unit_name);` once at the top of the unit loop.)
3. Case D: `emRes.artifacts.forEach((a) => push(stampUnit(a, unitScl)))`, `managementLines.push(...emRes.callLines)`.
4. Matched path: all pushes become `push(stampUnit(..., unitScl))` (seam cmdDb, links, emRes.artifacts, cmRes.artifacts — Library bodies pass through untouched thanks to the `FOLDER_LIBRARY` guard). The four call lines (`cmCallLines`, LINK_IN, EM instance, LINK_OUT) go to `managementLines` in the same order.
5. UC (coord path): `unitArts.forEach((a) => push(stampUnit(a, unitScl)))`; `const processCall = callLine;` — no splice.
   UC stub path: `push(stampUnit(unitCoordinationStub(...), unitScl))`; `const processCall = `   "UC_${unitScl}"();`;` (the stub FC is now CALLED from Process — update the stub's doc comment accordingly).
6. End of unit loop: `unitAssemblies.push({ unitScl, unitName: unit.unit_name, unitId: unit.unit_id, processCall, managementLines });`

After the unit loop, replace the maintenance/IO_Cond call-line splicing and `writeOb1(deviceCallLines, [])` with:

```ts
// G3 maintenance layer (artifacts unchanged; calls land in FC_Maintenance)
let presetCallLine: string | undefined;
let overrideCallLine: string | undefined;
if (maintenanceSeam) {
  // ... existing io map + warnings + writeMaintenanceArtifacts(...) unchanged ...
  maint.artifacts.forEach((a) => push(stampSystem(a)));
  presetCallLine = maint.presetCallLine;
  overrideCallLine = maint.overrideCallLine;
}

// G1-4b conditioning (artifacts unchanged; call lands FIRST in FC_Inputs)
const ioCond = writeIoConditioning(conditionedSignals);
ioCond.artifacts.forEach((a) => push(stampSystem(a)));

// G5-4 — the layer skeleton + per-unit scaffolding
push(writeFcInputs({ ioCondCallLine: ioCond.callLine, ems: emMapLines }));
for (const u of unitAssemblies) {
  push(writeUnitProcessFc({ unitScl: u.unitScl, unitName: u.unitName, unitId: u.unitId, ucCallLine: u.processCall }));
  push(writeUnitManagementFc({ unitScl: u.unitScl, unitName: u.unitName, unitId: u.unitId, callLines: u.managementLines }));
}
push(writeFcOutputs({ ems: emMapLines }));
push(writeFcMaintenance({ presetCallLine, overrideCallLine }));
push(writeOb1(unitAssemblies.map((u) => ({ sclName: u.unitScl }))));
return { artifacts, stubs, warnings };
```

New imports: `writeFcInputs/writeFcOutputs/writeFcMaintenance` from `./layer-fc-writer`, `writeUnitProcessFc/writeUnitManagementFc` from `./unit-fc-writer`, `FOLDER_LIBRARY, FOLDER_SYSTEM` from `./naming`, `type EmMapLines` from `./types`. Update the module doc comment (lines 18–28) to describe the new shape.

- [ ] **Step 5: Run the full codegen suite**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/ && npx tsc -b`
Expected: new structural tests PASS; update remaining failures in `compile-contract.test.ts` / `maintenance-writer.test.ts` in place — any assertion on OB1 content ordering (IO_Cond first / preset pre-EM / override last / UC-before-EM) becomes: IO_Cond call is first in `FC_Inputs`; preset + override are in `FC_Maintenance` with override last; Main's fixed order is already covered by the ob1 suite; UC-before-EM is now structural (Process layer before Management layer in Main). Delete assertions that MAP FCs exist. Do NOT weaken any assertion about EM/UC *content*.

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/codegen/compile-contract.ts src/lib/spec-builder/codegen/fb-instantiate.ts src/lib/spec-builder/codegen/__tests__/
git commit -m "feat(codegen): per-unit Process/Management assembly + folder stamping (G5-4)"
```

---

### Task 6: cross-revision custom-region carry-over

**Files:**
- Create: `src/lib/spec-builder/custom-region-carryover.ts`
- Modify: `src/hooks/use-code-builder.ts` (`compileAndReconcile`)
- Modify: `src/hooks/use-send-code-to-tia.ts` (`buildPlan`)
- Test: `src/lib/spec-builder/__tests__/custom-region-carryover.test.ts`

**Interfaces:**
- Consumes: `mergeCustomRegion` (Task 3); `unitProcessFcName` pattern (`/^FC_.+_Process$/`).
- Produces:

```ts
export interface PriorEditRow { artifact_name: string; edited_content: string }
export type PriorEditLoader = (specId: string, beforeRevision: number, artifactNames: string[]) => Promise<PriorEditRow[]>;
export async function carryOverCustomRegions(
  artifacts: { name: string; content: string }[],
  specId: string, revision: number, loadPriorEdits: PriorEditLoader,
): Promise<{ contents: Map<string, string>; warnings: string[] }>;
```

`contents` maps Process-FC artifact name → merged content (only entries that actually changed). The loader is injected so the module stays pure/testable; the Supabase implementation lives in the hooks.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { carryOverCustomRegions } from "../custom-region-carryover";
import { CUSTOM_REGION_BEGIN, CUSTOM_REGION_END } from "../codegen/custom-region";

const freshProcess = [
  `FUNCTION "FC_Process_Unit_Process" : Void`, `BEGIN`,
  `   "UC_Process_Unit_DB"();`,
  `   ${CUSTOM_REGION_BEGIN}`, `   // (site/process-specific ties, one-shots, special cases)`, `   ${CUSTOM_REGION_END}`,
  `END_FUNCTION`,
].join("\n");
const editedPrev = freshProcess.replace(`   // (site/process-specific ties, one-shots, special cases)`, `   "LAMP" := TRUE;`);

describe("carryOverCustomRegions", () => {
  it("merges the prior revision's region into the fresh Process FC", async () => {
    const { contents, warnings } = await carryOverCustomRegions(
      [{ name: "FC_Process_Unit_Process", content: freshProcess }, { name: "Main", content: "OB" }],
      "spec-1", 2,
      async (_s, before, names) => {
        expect(before).toBe(2);
        expect(names).toEqual(["FC_Process_Unit_Process"]); // only Process FCs queried
        return [{ artifact_name: "FC_Process_Unit_Process", edited_content: editedPrev }];
      },
    );
    expect(contents.get("FC_Process_Unit_Process")).toContain(`"LAMP" := TRUE;`);
    expect(warnings).toEqual([]);
  });

  it("returns a warning and no content when prior markers are mangled", async () => {
    const { contents, warnings } = await carryOverCustomRegions(
      [{ name: "FC_Process_Unit_Process", content: freshProcess }],
      "spec-1", 2, async () => [{ artifact_name: "FC_Process_Unit_Process", edited_content: "mangled" }],
    );
    expect(contents.size).toBe(0);
    expect(warnings[0]).toMatch(/NOT carried over/);
  });

  it("no-ops when there are no Process FCs or no prior edits", async () => {
    const r = await carryOverCustomRegions([{ name: "Main", content: "OB" }], "s", 2, async () => []);
    expect(r.contents.size).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure** → module not found.

- [ ] **Step 3: Implement**

```ts
// src/lib/spec-builder/custom-region-carryover.ts
//
// G5-4 §3 — when a spec revision bumps, the previous revision's hand-authored
// custom region in each FC_<Unit>_Process must survive into the fresh
// generation. The row loader is injected (Supabase in the hooks) so this
// stays pure and testable.
import { mergeCustomRegion } from "./codegen/custom-region";

export interface PriorEditRow { artifact_name: string; edited_content: string }
export type PriorEditLoader = (specId: string, beforeRevision: number, artifactNames: string[]) => Promise<PriorEditRow[]>;

const PROCESS_FC = /^FC_.+_Process$/;

export async function carryOverCustomRegions(
  artifacts: { name: string; content: string }[],
  specId: string,
  revision: number,
  loadPriorEdits: PriorEditLoader,
): Promise<{ contents: Map<string, string>; warnings: string[] }> {
  const contents = new Map<string, string>();
  const warnings: string[] = [];
  const processFcs = artifacts.filter((a) => PROCESS_FC.test(a.name));
  if (!processFcs.length) return { contents, warnings };
  const prior = await loadPriorEdits(specId, revision, processFcs.map((a) => a.name));
  const byName = new Map(prior.map((r) => [r.artifact_name, r.edited_content]));
  for (const a of processFcs) {
    const prev = byName.get(a.name);
    if (!prev) continue;
    const { content, warning } = mergeCustomRegion(a.content, prev);
    if (warning) warnings.push(`${a.name}: ${warning}`);
    else if (content !== a.content) contents.set(a.name, content);
  }
  return { contents, warnings };
}
```

- [ ] **Step 4: Wire into both hooks.**

`use-code-builder.ts` — in `compileAndReconcile`, after `const existing = await loadRows(specId, revision);` and compilation, when compiling the **unit layer** and an artifact has NO existing row yet, apply carry-over so the merged content lands as the new row's `edited_content` (survives reconcile + send overlay). Implement the loader against Supabase:

```ts
const loadPriorEdits: PriorEditLoader = async (sId, beforeRev, names) => {
  const { data } = await supabase
    .from("code_builder_artifacts")
    .select("artifact_name, edited_content, revision")
    .eq("spec_id", sId).lt("revision", beforeRev)
    .in("artifact_name", names).not("edited_content", "is", null)
    .order("revision", { ascending: false });
  const seen = new Set<string>();
  return (data ?? []).filter((r) => (seen.has(r.artifact_name) ? false : (seen.add(r.artifact_name), true)))
    .map((r) => ({ artifact_name: r.artifact_name as string, edited_content: r.edited_content as string }));
};
```

Then, before `toUpserts`: for each carried-over name with no existing row, set that upsert row's `edited_content` to the merged content and surface the warnings by appending them to the compiled result's warnings.

`use-send-code-to-tia.ts` — in `buildPlan`, after the edits map is built: run `carryOverCustomRegions(result.artifacts.map(a => ({name: a.name, content: a.content})), specId, revision, loadPriorEdits)` and, for any Process FC **without** a current-revision edit, use the merged content in `sources` and append its name to `editedBlocks` + warnings to `plan.warnings`. (Same loader implementation; import it from `use-code-builder.ts`? No — duplicate the 12-line loader locally or export it from a shared module: put `loadPriorEditsSupabase` in `custom-region-carryover.ts`? It must stay React-free but may import the supabase singleton — acceptable: add `export const loadPriorEditsSupabase: PriorEditLoader` there importing `@/lib/supabase`.)

- [ ] **Step 5: Run tests + typecheck** — carryover suite + `use-send-code-to-tia.test.tsx` (existing 3 tests must still pass; the fixture has no Process edits so carry-over no-ops) + `npx tsc -b`.

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/custom-region-carryover.ts src/lib/spec-builder/__tests__/custom-region-carryover.test.ts src/hooks/use-code-builder.ts src/hooks/use-send-code-to-tia.ts
git commit -m "feat(code-builder): custom-region carry-over across spec revisions (G5-4/G9-3 seed)"
```

---

### Task 7: UI — Unit step enabled, Map tab removed

**Files:**
- Modify: `src/components/code-builder/builder-stepper.tsx` (line 9: `{ id: "unit", label: "Unit", enabled: true }`)
- Modify: `src/routes/code-builder.tsx`
- Modify: `src/components/code-builder/artifact-viewer.tsx`
- Test: `src/components/code-builder/__tests__/control-module-list.test.tsx` (existing suite must stay green)

**Why:** the Process FC's custom region must be editable in-app; it lives on layer `"unit"`, so the Unit step becomes selectable. The Map tab's `mapFc` lookup is dead code once MAP artifacts stop existing.

- [ ] **Step 1: builder-stepper** — set `unit` to `enabled: true` (leave `export` disabled).

- [ ] **Step 2: route (`code-builder.tsx`)** — the stepper wiring at lines 107–112 becomes:

```tsx
active={activeLayer === "em" ? "em" : activeLayer === "unit" ? "unit" : "device"}
onSelect={(step) => {
  if (step === "device" || step === "em" || step === "unit") {
    setActiveLayer(step);
    setSelected(null);      // match the existing layer-switch reset behavior
    setEditing(null);       // (use the file's actual reset calls at that site)
  }
}}
```

Gate the promote panel (line ~174) to non-unit layers: wrap `<PromoteLibraryPanel …>` in `{activeLayer !== "unit" && (…)}` — promoting scaffolding FCs is meaningless.

- [ ] **Step 3: artifact-viewer** — delete the `map` tab: remove `"map"` from the `Tab` union (line 10), the `mapFc` lookup (line 36), the `{ id: "map", … }` TABS entry (line 50), and the `{tab === "map" && …}` renderer (line 84).

- [ ] **Step 4: Verify** — `npx vitest run src/components/code-builder/ && npx tsc -b` → PASS/clean. Manually: `npm run dev`, open Code Builder, click Unit step → UC/Process/Management artifacts listed; open a Process FC → editable; no Map tab anywhere.

- [ ] **Step 5: Commit**

```bash
git add src/components/code-builder/builder-stepper.tsx src/routes/code-builder.tsx src/components/code-builder/artifact-viewer.tsx
git commit -m "feat(code-builder): Unit step live (Process FC editing), Map tab removed (G5-4)"
```

---

### Task 8: send flow — folders map to the bridge

**Files:**
- Modify: `src/hooks/use-reimport-compile.ts`
- Modify: `src/hooks/use-send-code-to-tia.ts`
- Test: `src/hooks/__tests__/use-send-code-to-tia.test.tsx`

**Interfaces:**
- Produces: reimport POST body becomes `{ sources, folders }` where `folders: Record<string, string>` maps artifact name → folder path (`"00_System"`, `"<Unit>"`, `"<Unit>/FB"`, `"<Unit>/DB"`, `"Library"`, `"PLC data types"`); names in root `"Program blocks"` are OMITTED from the map.

- [ ] **Step 1: Failing test** (add to the existing suite; the fixture's EM FB should now carry a `<unit>/FB` folder after Task 5):

```ts
it("sends a folders map alongside the sources", async () => {
  fetchMock
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, message: "", created: [], skipped: [], errors: [] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, errors: [], warnings: [], compiled_at: "", sources: {} }) });
  const { result } = renderHook(() => useSendCodeToTia("spec-1", 1), { wrapper });
  let plan!: Awaited<ReturnType<typeof result.current.buildPlan>>;
  await act(async () => { plan = await result.current.buildPlan(); });
  await act(async () => { await result.current.send(plan); });
  const body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
  expect(body.folders["EM_Belt"]).toMatch(/\/FB$/);
  expect(body.folders["Main"]).toBeUndefined(); // root stays unmapped
});
```

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement.**
`use-reimport-compile.ts`: `interface ReimportCompileInput { sources: Record<string, string>; folders?: Record<string, string> }`; body `JSON.stringify({ sources: input.sources, folders: input.folders ?? {} })`.
`use-send-code-to-tia.ts`: `CodeSendPlan` gains `folders: Record<string, string>`; in `buildPlan`'s artifact loop: `if (a.folder && a.folder !== "Program blocks") folders[a.name] = a.folder;`; `send` passes `{ sources: sendPlan.sources, folders: sendPlan.folders }`.

- [ ] **Step 4: Run suite + typecheck** — all send tests PASS, `npx tsc -b` clean.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/use-reimport-compile.ts src/hooks/use-send-code-to-tia.ts src/hooks/__tests__/use-send-code-to-tia.test.tsx
git commit -m "feat(code-builder): send per-block folder paths to the bridge (G5-4)"
```

---

### Task 9: bridge v1.4.0 — folder-aware reimport + recursive delete

**Files:**
- Modify: `bridge/PacForgeBridge/Models.cs` (`ReimportRequest`, line ~192)
- Modify: `bridge/PacForgeBridge/TiaPortalService.cs` (`ReimportAndCompile` ~2275; `BridgeVersion` ~110)
- Modify: `bridge/PacForgeBridge/BridgeServer.cs` (`HandleReimportCompile` ~1497)
- Modify: `bridge/PacForgeBridge/CHANGELOG.md`

**Key facts (verified):** `ImportArtifact(plcSoftware, name, path, destinationFolder)` already exists and routes via `GetOrCreateBlockGroup`, which already creates NESTED groups from `/`-separated paths and special-cases `"PLC data types"` destinations. The one bug to avoid: `ReimportAndCompile`'s delete step uses root-level `plcSoftware.BlockGroup.Blocks.Find(name)`, which cannot see blocks inside subfolders — it must use the existing private `FindBlockRecursive(plcSoftware.BlockGroup, name)` or re-imports will DUPLICATE blocks on every send after the first.

- [ ] **Step 1: Models.cs** — add to `ReimportRequest`:

```csharp
/// <summary>Optional artifact name → block-group path (e.g. "Unit/DB").
/// Missing names import to the Program blocks root (pre-1.4.0 behavior).</summary>
public Dictionary<string, string> Folders { get; set; } = new Dictionary<string, string>();
```

- [ ] **Step 2: TiaPortalService.cs** — change the signature to `public CompileResultDto ReimportAndCompile(Dictionary<string, string> sources, Dictionary<string, string> folders = null)`. In the per-source loop:
  - Replace `PlcBlock existing = plcSoftware.BlockGroup.Blocks.Find(artifactName);` with `PlcBlock existing = FindBlockRecursive(plcSoftware.BlockGroup, artifactName);` (the types delete line stays as-is — UDTs live at the Types root).
  - Replace `ImportArtifact(plcSoftware, artifactName, filePath, "Program blocks");` with:

```csharp
string destination = "Program blocks";
if (folders != null && folders.TryGetValue(artifactName, out string mapped) && !string.IsNullOrEmpty(mapped))
    destination = mapped;
ImportArtifact(plcSoftware, artifactName, filePath, destination);
```

  - Bump `BridgeVersion = "1.4.0"`.

- [ ] **Step 3: BridgeServer.cs** — `HandleReimportCompile` passes the map: `_tiaService.ReimportAndCompile(request.Sources, request.Folders)`.

- [ ] **Step 4: CHANGELOG.md** — prepend:

```markdown
## 1.4.0 — 2026-07-23

G5-4 program-structure standard — folder-aware reimport:

- `POST /tia/reimport-compile` accepts an optional `folders` map (artifact
  name → block-group path, e.g. `"Unit/DB"`). Blocks import into that group
  (created on demand, nested paths supported); names not in the map keep the
  Program blocks root. The pre-import delete now finds blocks RECURSIVELY
  across user groups — previously a block living in a subfolder was invisible
  to the root-level delete and every resend duplicated it.
```

- [ ] **Step 5: Build + restart + verify**

```bash
powershell -NoProfile -Command "Get-Process -Name PacForgeBridge -ErrorAction SilentlyContinue | Stop-Process -Force"
dotnet build bridge/PacForgeBridge/PacForgeBridge.csproj
dotnet run --project bridge/PacForgeBridge/PacForgeBridge.csproj --no-build   # background
curl -s http://localhost:5102/tia/status
```

Expected: `"bridge_version":"1.4.0"`. (Openness whitelist will re-prompt on next Portal touch — user accepts.)

- [ ] **Step 6: Commit**

```bash
git add bridge/PacForgeBridge/Models.cs bridge/PacForgeBridge/TiaPortalService.cs bridge/PacForgeBridge/BridgeServer.cs bridge/PacForgeBridge/CHANGELOG.md
git commit -m "feat(bridge): folder-aware reimport with recursive delete — v1.4.0 (G5-4)"
```

---

### Task 10: full verification + live re-send

- [ ] **Step 1: Full typecheck + full test run** — `npx tsc -b && npx vitest run` → clean/green (modulo the pre-existing quote/variation failures documented in memory — do not fix those here; anything else that fails is this plan's regression).
- [ ] **Step 2: Post-Task Self-Check (CLAUDE.md)** — generic check: no project-specific names anywhere; mentally verify the structure works for a conveyor line and a filling station alike.
- [ ] **Step 3: Live verification (user in the loop)** — `npm run dev`; Code Builder on the warm-up spec → Assemble (expect NO `MAP_*` in the source list; skeleton FCs present) → Import + compile → expect 0 errors; verify in TIA: Main has the fixed layer shape; tree shows `00_System/`, one folder per unit with `FB/`+`DB/`, `Library/` when templates matched; no duplicate blocks after a SECOND send (recursive-delete regression).
- [ ] **Step 4: Board + docs sync** — G5-4 → *Awaiting Testing* after Step 1–2, *Done* after Step 3; update roadmap row state; `create_update` on G5-4 with commits; recompute G5 Progress %.
- [ ] **Step 5: Commit any straggler doc updates.**

---

## Self-Review (completed)

- **Spec coverage:** scan §1 (Task 4+5), mapping split §1 (Task 1+2), tree §2 (Task 5+8+9), custom region §3 (Task 3+6+7), bridge §4 (Task 9), UI (Task 7), testing §5 (per-task + Task 10), rollout §6 (Task 10). MAINT-preset scan-slot note honored (preset call now only in FC_Maintenance — Task 5 removes the unshift).
- **Placeholders:** the only "keep verbatim" references point at code that stays byte-identical and is quoted in the current file (em-writer lines 310–350) — acceptable as they are deletions-of-wrapper, not new logic.
- **Type consistency:** `EmMapLines` (T1) ↔ layer-fc-writer inputs (T2) ↔ compile-contract usage (T5); `UnitCallRef` unchanged; `folders` map key/values consistent app↔bridge (T8↔T9); `unitProcessFcName` used by T3/T4 via naming.
