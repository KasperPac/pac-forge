# Register Template + Deterministic Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a downloadable Excel register template with explicit `device`/`assembly`/`subsystem` columns and make the parser extract the machine hierarchy deterministically from those columns (no AI, no prefix guessing for structure), with fallbacks that keep legacy registers working.

**Architecture:** Extend the register column model (`ColumnMapping`, `CANONICAL_COLUMN_NAMES`, `InstrumentTag`) with distinct `assembly`, `device`, `is_safety` columns; rewrite `buildHierarchyFromTags` to group `subsystem → assembly → device → signals` from explicit fields with precise fallbacks; add a `register-template.ts` generator and a "Download template" button. The Haiku device_class classification is retained (it has no role in structure).

**Tech Stack:** TypeScript, Vite, Vitest, `xlsx` (SheetJS community), `file-saver`. Tests under `src/**/__tests__/*.test.ts` via `npm test` / `npx vitest`.

---

## File Structure

- `src/types/spec-builder.ts` — `ColumnMapping` (+`assembly`,`device`,`is_safety`), `CANONICAL_COLUMN_NAMES` (rework aliases, fix `device` vs `device_type` collision), `InstrumentTag` (+`device`,`assembly`).
- `src/lib/spec-builder/instrument-parser.ts` — `detectColumns` initializer, `extractRows`, `parseInstrumentRegister` merge, and the `buildHierarchyFromTags` rewrite.
- `src/lib/spec-builder/register-template.ts` — **new**: `buildRegisterTemplateBlob()` producing the two-sheet `.xlsx`.
- `src/components/spec-builder/instrument-register-upload.tsx` — "Download template" button.
- `src/lib/spec-builder/__tests__/instrument-parser.test.ts` — extend (column detection, extraction, hierarchy).
- `src/lib/spec-builder/__tests__/register-template.test.ts` — **new**: template generator tests.

---

### Task 1: Explicit column model (types + detection)

**Files:**
- Modify: `src/types/spec-builder.ts` (`ColumnMapping` ~344-351, `CANONICAL_COLUMN_NAMES` ~353-360)
- Modify: `src/lib/spec-builder/instrument-parser.ts` (`detectColumns` mapping initializer ~39-46)
- Test: `src/lib/spec-builder/__tests__/instrument-parser.test.ts`

- [ ] **Step 1: Write failing tests** — append:

```ts
describe("detectColumns — distinct grouping columns", () => {
  function mappingFor(header: string) {
    const wb = XLSX.read(header + "\nX,Y,Z,W,D,A,S", { type: "string" });
    return detectColumns(wb.Sheets[wb.SheetNames[0]!]!).mapping;
  }

  it("maps device and device type to different columns", () => {
    const m = mappingFor("tag,description,signal_type,io_address,device,assembly,device type");
    expect(m.device).not.toBeNull();
    expect(m.device_type).not.toBeNull();
    expect(m.device).not.toBe(m.device_type);
  });

  it("maps assembly and subsystem to different columns", () => {
    const m = mappingFor("tag,subsystem,assembly,signal_type,io_address,device,description");
    expect(m.subsystem).not.toBeNull();
    expect(m.assembly).not.toBeNull();
    expect(m.subsystem).not.toBe(m.assembly);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/spec-builder/__tests__/instrument-parser.test.ts`
Expected: FAIL/typecheck error — `m.device`/`m.assembly` don't exist on `ColumnMapping`.

- [ ] **Step 3: Extend `ColumnMapping` and rework `CANONICAL_COLUMN_NAMES`**

In `src/types/spec-builder.ts`, replace the `ColumnMapping` interface with:

```ts
export interface ColumnMapping {
  tag: number | null;
  device_type: number | null;
  description: number | null;
  signal_type: number | null;
  io_address: number | null;
  subsystem: number | null;
  assembly: number | null;
  device: number | null;
  is_safety: number | null;
}
```

Replace `CANONICAL_COLUMN_NAMES` with (note: `device` removed from `device_type`; `assembly`/`group` removed from `subsystem`; new `assembly`/`device`/`is_safety`):

```ts
export const CANONICAL_COLUMN_NAMES: Record<keyof ColumnMapping, string[]> = {
  tag: ["tag", "tag number", "tag no", "tag no.", "instrument tag", "device tag", "tag_no"],
  device_type: ["device type", "type", "instrument type", "device_type", "device class"],
  description: ["description", "desc", "function", "instrument description"],
  signal_type: ["signal", "signal type", "io type", "signal_type"],
  io_address: ["address", "io address", "plc address", "%i", "%q", "io_address"],
  subsystem: ["subsystem", "sub system", "area", "unit"],
  assembly: ["assembly", "equipment", "equipment module", "group"],
  device: ["device", "device id", "device name", "device_id"],
  is_safety: ["is_safety", "safety", "safety critical"],
} as const;
```

- [ ] **Step 4: Update `detectColumns` initializer**

In `src/lib/spec-builder/instrument-parser.ts`, the `mapping` object literal inside `detectColumns` (the one initialized with `tag: null, ...`) must include all keys. Replace that initializer block with:

```ts
    const mapping: ColumnMapping = {
      tag: null,
      device_type: null,
      description: null,
      signal_type: null,
      io_address: null,
      subsystem: null,
      assembly: null,
      device: null,
      is_safety: null,
    };
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npx vitest run src/lib/spec-builder/__tests__/instrument-parser.test.ts`
Expected: PASS (new detection tests + all existing).

- [ ] **Step 6: Commit**

```bash
git add src/types/spec-builder.ts src/lib/spec-builder/instrument-parser.ts src/lib/spec-builder/__tests__/instrument-parser.test.ts
git commit -m "feat(spec-builder): distinct subsystem/assembly/device register columns"
```

---

### Task 2: Carry device/assembly/is_safety through the parse

**Files:**
- Modify: `src/types/spec-builder.ts` (`InstrumentTag` ~90-103)
- Modify: `src/lib/spec-builder/instrument-parser.ts` (`extractRows` ~111-118; `parseInstrumentRegister` tag-merge ~572-589)
- Test: `src/lib/spec-builder/__tests__/instrument-parser.test.ts`

- [ ] **Step 1: Write failing test** — append:

```ts
describe("extractRows — explicit grouping columns", () => {
  it("reads device, assembly, subsystem from the row", () => {
    const csv =
      "tag,description,signal_type,io_address,device,assembly,subsystem\n" +
      "CV01_M1_CMD,Run,DO,%Q0.0,M1,Conveyor CV01,Infeed";
    const wb = XLSX.read(csv, { type: "string" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const { mapping, headerRow } = detectColumns(sheet);
    const rows = extractRows(sheet, mapping, headerRow);
    expect(rows[0].device).toBe("M1");
    expect(rows[0].assembly).toBe("Conveyor CV01");
    expect(rows[0].subsystem).toBe("Infeed");
  });
});
```

Also add `extractRows` to the import at the top of the test file:
`import { detectColumns, buildHierarchyFromTags, extractRows } from "@/lib/spec-builder/instrument-parser";`

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/spec-builder/__tests__/instrument-parser.test.ts`
Expected: FAIL/typecheck — `rows[0].device`/`.assembly` not on `InstrumentTag` (Partial).

- [ ] **Step 3: Extend `InstrumentTag`**

In `src/types/spec-builder.ts`, replace the `InstrumentTag` interface with:

```ts
export interface InstrumentTag {
  tag: string;
  device_type: string;
  description: string;
  signal_type: string;
  io_address: string;
  // Enriched by Haiku
  device_class: DeviceClass;
  signal_direction: SignalDirection;
  subsystem_prefix: string;
  is_safety: boolean;
  // Explicit hierarchy columns (deterministic extraction)
  device: string;
  assembly: string;
  subsystem: string;
}
```

- [ ] **Step 4: Read the columns in `extractRows`**

`InstrumentTag.is_safety` is a `boolean`, so the raw safety cell (a string) cannot be pushed onto a `Partial<InstrumentTag>`. Carry it on a dedicated raw field. In `src/lib/spec-builder/instrument-parser.ts`:

First, change the `extractRows` return type annotation:

```ts
export function extractRows(
  sheet: XLSX.WorkSheet,
  mapping: ColumnMapping,
  headerRow: number
): Array<Partial<InstrumentTag> & { is_safety_raw?: string }> {
```

And change its local `rows` declaration to match:

```ts
  const rows: Array<Partial<InstrumentTag> & { is_safety_raw?: string }> = [];
```

Then replace the `rows.push({ ... })` object with:

```ts
    rows.push({
      tag,
      device_type: cellVal(mapping.device_type),
      description: cellVal(mapping.description),
      signal_type: cellVal(mapping.signal_type),
      io_address: cellVal(mapping.io_address),
      subsystem: cellVal(mapping.subsystem),
      assembly: cellVal(mapping.assembly),
      device: cellVal(mapping.device),
      is_safety_raw: cellVal(mapping.is_safety),
    });
```

- [ ] **Step 5: Populate new fields + explicit is_safety in `parseInstrumentRegister`**

In `parseInstrumentRegister`, inside the `rawRows.map((row, i) => {...})` callback, add a parse of the raw safety cell above the `return`, then replace the returned object literal:

```ts
    const safetyRaw = (row.is_safety_raw ?? "").trim().toLowerCase();
    const explicitSafety =
      safetyRaw === "" ? undefined : ["true", "yes", "1", "y"].includes(safetyRaw);

    return {
      tag: row.tag ?? "",
      device_type: row.device_type ?? "",
      description: row.description ?? "",
      signal_type: row.signal_type ?? "",
      io_address: row.io_address ?? "",
      device_class: det.device_class ?? aiCls?.device_class ?? "other",
      signal_direction: det.signal_direction ?? aiCls?.signal_direction ?? "internal",
      subsystem_prefix: row.subsystem || aiCls?.subsystem || "",
      is_safety: explicitSafety ?? det.is_safety ?? aiCls?.is_safety ?? false,
      device: row.device ?? "",
      assembly: row.assembly ?? "",
      subsystem: row.subsystem || aiCls?.subsystem || "",
    };
```

Behavior: an explicit truthy `is_safety` cell (`true/yes/1/y`, case-insensitive) overrides classification; a blank cell defers to the deterministic/AI classification. `RawRow` (`Partial<InstrumentTag> & { is_safety_raw?: string }`) is assignable to `classifyTags`'s `Array<Partial<InstrumentTag>>` parameter, so `needsAi`/`classifyTags` are unaffected.

- [ ] **Step 6: Update the test `tag()` helper for new required fields**

In `src/lib/spec-builder/__tests__/instrument-parser.test.ts`, the existing `tag()` helper builds an `InstrumentTag`. Update it to include the new fields and accept optional `assembly`/`device`:

```ts
function tag(
  t: string,
  subsystem: string,
  assembly = "",
  device = "",
): InstrumentTag {
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
    device,
    assembly,
    subsystem,
  };
}
```

- [ ] **Step 7: Run tests + typecheck**

Run: `npx vitest run src/lib/spec-builder/__tests__/instrument-parser.test.ts` (all pass)
Run: `npx tsc -b` (exit 0 — confirms the two `InstrumentTag` construction sites compile)

- [ ] **Step 8: Commit**

```bash
git add src/types/spec-builder.ts src/lib/spec-builder/instrument-parser.ts src/lib/spec-builder/__tests__/instrument-parser.test.ts
git commit -m "feat(spec-builder): carry device/assembly/is_safety through register parse"
```

---

### Task 3: Deterministic `subsystem → assembly → device` hierarchy

**Files:**
- Modify: `src/lib/spec-builder/instrument-parser.ts` (`buildHierarchyFromTags` ~396-457)
- Test: `src/lib/spec-builder/__tests__/instrument-parser.test.ts`

- [ ] **Step 1: Write failing tests** — append:

```ts
describe("buildHierarchyFromTags — explicit columns", () => {
  it("template-style: one subsystem, explicit assemblies + devices", () => {
    const tags: InstrumentTag[] = [
      tag("CV01_M1_CMD", "", "Conveyor CV01", "M1"),
      tag("CV01_M1_FB", "", "Conveyor CV01", "M1"),
      tag("CV01_PE1", "", "Conveyor CV01", "PE1"),
    ];
    const result = buildHierarchyFromTags(tags, "Line A");
    expect(result).toHaveLength(1);
    expect(result[0].subsystem_name).toBe("Line A");
    const asm = result[0].assemblies;
    expect(asm).toHaveLength(1);
    expect(asm[0].assembly_name).toBe("Conveyor CV01");
    const devIds = asm[0].devices.map((d) => d.device_id).sort();
    expect(devIds).toEqual(["M1", "PE1"]);
    const m1 = asm[0].devices.find((d) => d.device_id === "M1")!;
    expect(m1.io_signals).toHaveLength(2);
  });

  it("multi-subsystem when subsystem column is filled", () => {
    const tags: InstrumentTag[] = [
      tag("A_M1_CMD", "Infeed", "Conveyor CV01", "M1"),
      tag("B_M2_CMD", "Outfeed", "Conveyor CV02", "M2"),
    ];
    const result = buildHierarchyFromTags(tags);
    expect(result.map((s) => s.subsystem_name).sort()).toEqual(["Infeed", "Outfeed"]);
  });

  it("legacy lone grouping column stays at assembly level (one subsystem)", () => {
    const tags: InstrumentTag[] = [tag("VSD1_FWD", "Carriage"), tag("VSD2_FWD", "Rotator")];
    const result = buildHierarchyFromTags(tags);
    expect(result).toHaveLength(1);
    expect(result[0].assemblies.map((a) => a.assembly_name).sort()).toEqual(["Carriage", "Rotator"]);
  });

  it("no grouping at all → one subsystem, one Unassigned assembly", () => {
    const tags: InstrumentTag[] = [tag("M1_CMD", ""), tag("M1_FB", "")];
    const result = buildHierarchyFromTags(tags);
    expect(result).toHaveLength(1);
    expect(result[0].assemblies).toHaveLength(1);
    expect(result[0].assemblies[0].assembly_name).toBe("Unassigned");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/spec-builder/__tests__/instrument-parser.test.ts`
Expected: FAIL — the current builder groups by `t.subsystem` only and always returns one subsystem; the multi-subsystem and explicit-device assertions fail.

- [ ] **Step 3: Rewrite `buildHierarchyFromTags`**

Replace the entire function with:

```ts
export function buildHierarchyFromTags(
  tags: InstrumentTag[],
  systemName = "System",
): SubsystemConfig[] {
  const hasAssembly = tags.some((t) => t.assembly);
  const hasSubsystem = tags.some((t) => t.subsystem);
  const hasDevice = tags.some((t) => t.device);

  // subsystem -> assembly -> device -> tags
  const subMap = new Map<string, Map<string, Map<string, InstrumentTag[]>>>();
  for (const t of tags) {
    const subKey = hasAssembly && hasSubsystem ? t.subsystem || systemName : systemName;
    const asmKey = hasAssembly ? t.assembly || "Unassigned" : t.subsystem || "Unassigned";
    const devKey = hasDevice && t.device ? t.device : extractDevicePrefix(t.tag, asmKey);

    if (!subMap.has(subKey)) subMap.set(subKey, new Map());
    const aMap = subMap.get(subKey)!;
    if (!aMap.has(asmKey)) aMap.set(asmKey, new Map());
    const dMap = aMap.get(asmKey)!;
    if (!dMap.has(devKey)) dMap.set(devKey, []);
    dMap.get(devKey)!.push(t);
  }

  const subsystems: SubsystemConfig[] = [];
  for (const [subKey, aMap] of subMap) {
    const assemblies: AssemblyConfig[] = [];
    for (const [asmKey, dMap] of aMap) {
      const devices: DeviceConfig[] = [];
      for (const [devKey, devTags] of dMap) {
        const ioSignals: IoSignal[] = devTags.map((t) => ({
          tag: t.tag,
          signal_type: t.signal_type || t.signal_direction,
          io_address: t.io_address,
          description: t.description,
        }));
        const representative = devTags[0];
        devices.push({
          device_id: devKey,
          device_name: representative.description || devKey,
          device_class: representative.device_class,
          description: representative.description || "",
          is_safety: devTags.some((t) => t.is_safety),
          io_signals: ioSignals,
        });
      }
      assemblies.push({
        assembly_id: asmKey,
        assembly_name: asmKey,
        description: "",
        devices: devices.sort((a, b) => a.device_id.localeCompare(b.device_id)),
      });
    }
    subsystems.push({
      subsystem_id: subKey === systemName ? "system" : subKey,
      subsystem_name: subKey,
      equipment_type: inferEquipmentType(subKey, subKey),
      description: "",
      assemblies: assemblies.sort((a, b) => a.assembly_id.localeCompare(b.assembly_id)),
      excluded: false,
    });
  }

  return subsystems.sort((a, b) => a.subsystem_name.localeCompare(b.subsystem_name));
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/spec-builder/__tests__/instrument-parser.test.ts`
Expected: PASS — including the pre-existing Phase 1 tests (which use a lone subsystem column and now exercise the legacy fallback branch).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/instrument-parser.ts src/lib/spec-builder/__tests__/instrument-parser.test.ts
git commit -m "feat(spec-builder): deterministic subsystem/assembly/device hierarchy from explicit columns"
```

---

### Task 4: Excel template generator

**Files:**
- Create: `src/lib/spec-builder/register-template.ts`
- Test: `src/lib/spec-builder/__tests__/register-template.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/__tests__/register-template.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildRegisterTemplateWorkbook, REGISTER_TEMPLATE_HEADERS } from "@/lib/spec-builder/register-template";
import { detectColumns } from "@/lib/spec-builder/instrument-parser";

describe("register template", () => {
  it("has Instructions and Register sheets", () => {
    const wb = buildRegisterTemplateWorkbook();
    expect(wb.SheetNames).toContain("Instructions");
    expect(wb.SheetNames).toContain("Register");
  });

  it("Register header row matches the documented columns", () => {
    const wb = buildRegisterTemplateWorkbook();
    const sheet = wb.Sheets["Register"]!;
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    expect(rows[0]).toEqual(REGISTER_TEMPLATE_HEADERS);
  });

  it("parser detects tag/device/assembly/subsystem from the template header", () => {
    const wb = buildRegisterTemplateWorkbook();
    const { mapping } = detectColumns(wb.Sheets["Register"]!);
    expect(mapping.tag).not.toBeNull();
    expect(mapping.device).not.toBeNull();
    expect(mapping.assembly).not.toBeNull();
    expect(mapping.subsystem).not.toBeNull();
    expect(mapping.signal_type).not.toBeNull();
    expect(mapping.device).not.toBe(mapping.device_type);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/spec-builder/__tests__/register-template.test.ts`
Expected: FAIL — module `register-template` does not exist.

- [ ] **Step 3: Implement the generator**

Create `src/lib/spec-builder/register-template.ts`:

```ts
import * as XLSX from "xlsx";

/** Column headers for the Register sheet, in order. Must stay in sync with
 *  CANONICAL_COLUMN_NAMES so the parser detects every column. */
export const REGISTER_TEMPLATE_HEADERS = [
  "tag",
  "description",
  "io_address",
  "signal_type",
  "device",
  "assembly",
  "subsystem",
  "device_type",
  "is_safety",
] as const;

const EXAMPLE_ROWS: string[][] = [
  ["CV01_M1_CMD", "Conveyor CV01 run command", "%Q0.0", "DO", "M1", "Conveyor CV01", "", "Motor", "FALSE"],
  ["CV01_M1_FB", "Conveyor CV01 run feedback", "%I0.0", "DI", "M1", "Conveyor CV01", "", "Motor", "FALSE"],
  ["CV01_PE1", "Conveyor CV01 jam photo-eye", "%I0.1", "DI", "PE1", "Conveyor CV01", "", "Sensor", "FALSE"],
];

const INSTRUCTIONS: string[][] = [
  ["Pac-Forge Instrument Register Template"],
  [""],
  ["Fill in the Register sheet. One row per signal. The hierarchy is extracted"],
  ["deterministically from the columns below — no AI is used for structure."],
  [""],
  ["Column", "Required", "Meaning / allowed values"],
  ["tag", "Yes", "The signal tag."],
  ["description", "Yes", "Human-readable description."],
  ["io_address", "No", "PLC address e.g. %I0.0 / %Q0.1. Blank for network/derived."],
  ["signal_type", "Yes", "One of: DI, DO, AI, AO."],
  ["device", "Yes", "Groups signals onto one device, e.g. M1, VSD1. Same device = same value."],
  ["assembly", "Yes", "Equipment module the device belongs to, e.g. Conveyor CV01, Carriage."],
  ["subsystem", "No", "Leave BLANK for a single-machine job. Fill ONLY when groups of"],
  ["", "", "assemblies run under independent operating sequences (e.g. Infeed vs Outfeed)."],
  ["device_type", "No", "Device kind for FB selection, e.g. Motor, Sensor, VSD, Push Button."],
  ["is_safety", "No", "TRUE or FALSE. Marks safety-critical signals."],
  [""],
  ["Hierarchy: System (the machine) > Subsystem (Unit) > Assembly (Equipment Module) > Device (Control Module)."],
  ["Default is ONE subsystem. Only add subsystems for independent operating sequences."],
];

/** Build the two-sheet register template workbook. */
export function buildRegisterTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const instructions = XLSX.utils.aoa_to_sheet(INSTRUCTIONS);
  XLSX.utils.book_append_sheet(wb, instructions, "Instructions");

  const register = XLSX.utils.aoa_to_sheet([
    [...REGISTER_TEMPLATE_HEADERS],
    ...EXAMPLE_ROWS,
  ]);
  XLSX.utils.book_append_sheet(wb, register, "Register");

  return wb;
}

/** Serialize the template workbook to an .xlsx Blob for download. */
export function buildRegisterTemplateBlob(): Blob {
  const wb = buildRegisterTemplateWorkbook();
  const data = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Blob([data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `npx vitest run src/lib/spec-builder/__tests__/register-template.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/register-template.ts src/lib/spec-builder/__tests__/register-template.test.ts
git commit -m "feat(spec-builder): downloadable Excel register template generator"
```

---

### Task 5: "Download template" button

**Files:**
- Modify: `src/components/spec-builder/instrument-register-upload.tsx`

> UI wiring — verified by lint/build + manual check, not a unit test.

- [ ] **Step 1: Read the component** to find the upload dropzone/card region and the existing import style (it uses `lucide-react` icons and the `Button` from `@/components/ui/button`). Identify where to place a secondary action near the dropzone.

- [ ] **Step 2: Add the download handler + button**

At the top of `src/components/spec-builder/instrument-register-upload.tsx`, add imports (merge with existing import lines; do not duplicate):

```ts
import { saveAs } from "file-saver";
import { Download } from "lucide-react";
import { buildRegisterTemplateBlob } from "@/lib/spec-builder/register-template";
```

Inside the component, add a handler:

```ts
  const handleDownloadTemplate = () => {
    saveAs(buildRegisterTemplateBlob(), "pac-register-template.xlsx");
  };
```

Render a button near the upload dropzone (place it just above or beside the dropzone container; match existing `Button` usage — `variant="outline" size="sm"`):

```tsx
        <Button variant="outline" size="sm" onClick={handleDownloadTemplate}>
          <Download className="h-3.5 w-3.5 mr-1.5" />
          Download template
        </Button>
```

- [ ] **Step 3: Verify lint + build**

Run: `npm run lint` (no new errors in this file)
Run: `npx tsc -b` (exit 0)

- [ ] **Step 4: Commit**

```bash
git add src/components/spec-builder/instrument-register-upload.tsx
git commit -m "feat(spec-builder): add Download template button to register upload"
```

---

### Task 6: Full verification

- [ ] **Step 1: Spec-builder + types tests**

Run: `npx vitest run src/lib/spec-builder src/types`
Expected: all PASS (existing + new instrument-parser + register-template).

- [ ] **Step 2: Typecheck + build**

Run: `npx tsc -b` (exit 0), then `npm run build` (succeeds).

- [ ] **Step 3: Manual sanity**

In the spec-builder register upload: click **Download template**, confirm a two-sheet `.xlsx` downloads and opens. Fill a few rows (device + assembly, subsystem blank), upload, and confirm the wizard shows **one subsystem** with your assemblies and devices grouped exactly by the `device` column. Fill `subsystem` on some rows and confirm multiple subsystems appear.

---

## Known follow-ups (NOT in this plan)
- Excel data-validation dropdowns (community SheetJS can't write them) — allowed values are documented on the Instructions sheet instead.
- `groupSubsystems` upload-summary still labels groups as "subsystems" — relabel separately.
- Migrating existing saved specs to the new column model.

---

## Self-Review

- **Spec coverage:** template (§2) → Task 4 + Task 5; deterministic extraction (§3) → Task 3 with the precise fallback rules; explicit columns + collision fix + InstrumentTag (§4.2) → Tasks 1-2; UI (§4.3) → Task 5; AI classification retained (untouched). Covered.
- **Placeholder scan:** no TBD/TODO; every code step shows complete code.
- **Type consistency:** `buildRegisterTemplateWorkbook`/`buildRegisterTemplateBlob`/`REGISTER_TEMPLATE_HEADERS` used consistently across Task 4 + Task 5; `ColumnMapping` gains `assembly`/`device`/`is_safety`, `InstrumentTag` gains `device`/`assembly` (is_safety stays boolean), consistent across Tasks 1-3; `extractRows` returns `Partial<InstrumentTag> & { is_safety_raw?: string }` and the merge reads `is_safety_raw`; `tag()` helper signature `(t, subsystem, assembly?, device?)` matches Task 3 usage.
- **Risk flagged:** the `device` vs `device_type` alias collision is the subtle bit — Task 1's detection test asserts they map to different columns. Fallback correctness (legacy lone-column → assembly level) is covered by Task 3's legacy test.
