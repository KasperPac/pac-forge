# Verified Library-EM Instantiation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make matched library-EM instantiation a first-class, verified path in the Code Builder compiler — verify the library FB's state machine covers the FDS states (block on a miss), wire the EM↔CM coordination and EM↔Unit command seam deterministically, and eliminate the double-drive of physical IO.

**Architecture:** Three new pure modules under `src/lib/spec-builder/codegen/` (`em-state-coverage.ts`, `matched-em-builder.ts`, `em-command-seam.ts`), a byte-for-byte extraction of the command seam out of `em-writer.ts`, a new `states` field on `FbInterfaceContract`, and a rewrite of the matched-EM branch in `compile-contract.ts` into a 4-case split. The EM coordinates separate Control-Module FBs (ISA-88 textbook); only CMs touch physical addresses, so double-drive is fixed structurally.

**Tech Stack:** TypeScript 5.9 strict (`import type`, no enums, `as const`), Vitest, pure functions (no React/IO in `codegen/`).

**Design:** `Docs/superpowers/specs/2026-06-30-verified-library-em-instantiation-design.md`

**Refinement vs spec:** The spec describes a "gap-report artifact" for a coverage miss. `CodegenArtifact.type` is a closed union (`UDT|FB|FC|DB|OB`) with no report type, and the compiler already has a `StubReport.equipmentModules` channel the UI surfaces. The plan delivers the coverage gap through that channel (`stubs.equipmentModules.push({ id, name, reason: "missing states: …" })`) plus a structured warning — faithful to the spec's intent (visible, non-importable, lists the missing states) without inventing an artifact type.

**Sequence:** Build this sub-project before resuming C3 (quality + versioning) tasks 4–8.

---

## File Structure

**New**
- `src/lib/spec-builder/codegen/em-state-coverage.ts` — `checkStateCoverage` + `normSlug`. Pure.
- `src/lib/spec-builder/codegen/__tests__/em-state-coverage.test.ts`
- `src/lib/spec-builder/codegen/em-command-seam.ts` — `buildCommandSeam` (shared CMD-DB + call bindings). Pure.
- `src/lib/spec-builder/codegen/__tests__/em-command-seam.test.ts`
- `src/lib/spec-builder/codegen/matched-em-builder.ts` — `buildEmCmLinks` + `linkKey`. Pure.
- `src/lib/spec-builder/codegen/__tests__/matched-em-builder.test.ts`

**Modified**
- `src/types/fb-interface.ts` — add `FbInterfaceState` + `states` field on `FbInterfaceContract`.
- `src/hooks/use-generate-fb-interface.ts` — add `states: []` to the constructed contract (line ~61).
- `src/components/fb-library/fb-interface-grid.tsx` — carry `states` through `handleSave` (line ~55).
- `src/lib/spec-builder/codegen/fb-instantiate.ts` — `InstantiateResult` gains `instanceDb` + `contract`; both instantiate fns populate them.
- `src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts` — add `states: []` to the `reviewedContract` fixture; assert the new result fields.
- `src/lib/spec-builder/codegen/em-writer.ts` — `writeCmdDb` + `buildCallLines` delegate to `em-command-seam` (output unchanged).
- `src/lib/spec-builder/codegen/compile-contract.ts` — matched-EM branch → 4-case split; double-drive fix; OB1 ordering.
- `src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts` — extend for the 4 cases + double-drive regression + OB1 ordering.

**Dependency order:** Task 1 → (Tasks 2, 3, 4, 5 independent) → Task 6.

---

## Task 1: Schema — declared states on the interface contract

**Goal:** `FbInterfaceContract` carries a `states` list the compiler can check coverage against; all construction sites compile.

**Files:**
- Modify: `src/types/fb-interface.ts`
- Modify: `src/hooks/use-generate-fb-interface.ts:61`
- Modify: `src/components/fb-library/fb-interface-grid.tsx:54-56`
- Modify: `src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts` (the `reviewedContract` fixture)

**Acceptance Criteria:**
- [ ] `FbInterfaceState` interface exists (`slug`, `name`, `is_safe?`).
- [ ] `FbInterfaceContract.states: FbInterfaceState[]` exists.
- [ ] `npx tsc -b` is clean and all existing tests pass.

**Verify:** `npx tsc -b && npx vitest run src/lib/spec-builder/codegen src/components/fb-library` → typecheck clean, suites green.

**Steps:**

- [ ] **Step 1: Add the type**

In `src/types/fb-interface.ts`, after the `FbInterfacePin` interface and before `FbInterfaceContract`, add:

```ts
/** A state a library EM FB implements. Compared against the FDS EM state
 *  machine for coverage. `slug` matches FDS EmStateV2.state_id. */
export interface FbInterfaceState {
  slug: string;
  name: string;
  is_safe?: boolean;
}
```

Then add the field to `FbInterfaceContract` (after `pins`):

```ts
export interface FbInterfaceContract {
  /** the main FB block this describes */
  block_name: string;
  pins: FbInterfacePin[];
  /** States this FB implements (EM templates). [] when none declared. */
  states: FbInterfaceState[];
  /** a human has confirmed the AI-extracted semantic layer */
  reviewed: boolean;
  /** ISO timestamp of the last AI extraction */
  generated_at: string;
}
```

- [ ] **Step 2: Update the AI-extract construction site**

In `src/hooks/use-generate-fb-interface.ts`, find the return at line ~61:

```ts
  return { block_name: blockName, pins, reviewed: false, generated_at: new Date().toISOString() };
```

Replace with (preserve any existing declared states if the caller passed an enriched contract — here there are none, so default `[]`):

```ts
  return { block_name: blockName, pins, states: [], reviewed: false, generated_at: new Date().toISOString() };
```

- [ ] **Step 3: Update the grid save site**

In `src/components/fb-library/fb-interface-grid.tsx`, find `handleSave` (line ~54):

```ts
    const contract: FbInterfaceContract = {
      block_name: blockName, pins, reviewed: true,
      generated_at: template.interface_contract?.generated_at ?? new Date().toISOString(),
    };
```

Replace with (carry forward any states already on the template — authoring UI for states is out of scope, so this just preserves them):

```ts
    const contract: FbInterfaceContract = {
      block_name: blockName, pins,
      states: template.interface_contract?.states ?? [],
      reviewed: true,
      generated_at: template.interface_contract?.generated_at ?? new Date().toISOString(),
    };
```

- [ ] **Step 4: Update the test fixture**

In `src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts`, find the `reviewedContract` fixture (around line 88, before the `describe("instantiate contract wiring"`). It is an object literal typed as `FbInterfaceContract`. Add `states: [],` to it, e.g.:

```ts
const reviewedContract: FbInterfaceContract = {
  block_name: "CM_Motor",
  pins: [ /* …existing pins… */ ],
  states: [],
  reviewed: true,
  generated_at: "2026-06-24T00:00:00Z",
};
```

> If the fixture is currently built without an explicit `FbInterfaceContract` annotation, just add the `states: []` member alongside `reviewed`/`generated_at`.

- [ ] **Step 5: Verify typecheck + suites**

Run: `npx tsc -b && npx vitest run src/lib/spec-builder/codegen src/components/fb-library`
Expected: tsc clean; all suites pass (no behavior changed).

- [ ] **Step 6: Commit**

```bash
git add src/types/fb-interface.ts src/hooks/use-generate-fb-interface.ts src/components/fb-library/fb-interface-grid.tsx src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts
git commit -m "feat(code-builder): declared states on FbInterfaceContract"
```

---

## Task 2: State-coverage module

**Goal:** A pure check that asserts the FDS-required states are a subset of the library FB's declared states.

**Files:**
- Create: `src/lib/spec-builder/codegen/em-state-coverage.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/em-state-coverage.test.ts`

**Acceptance Criteria:**
- [ ] `checkStateCoverage(fds, declared)` returns `{ ok, missing }` where `missing` are FDS states with no declared slug match.
- [ ] Matching is trim + case-insensitive (`normSlug`).
- [ ] Surplus declared states never affect the result.
- [ ] Empty declared list ⇒ every FDS state is missing.

**Verify:** `npx vitest run src/lib/spec-builder/codegen/__tests__/em-state-coverage.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/codegen/__tests__/em-state-coverage.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { checkStateCoverage, normSlug } from "../em-state-coverage";
import type { EmStateV2 } from "@/types/spec-contract-v2";
import type { FbInterfaceState } from "@/types/fb-interface";

const fds = (slug: string, over: Partial<EmStateV2> = {}): EmStateV2 => ({
  state_id: slug, name: slug, kind: "sequential", allowed_modes: [], is_safe_state: false, ...over,
});
const decl = (slug: string, over: Partial<FbInterfaceState> = {}): FbInterfaceState => ({
  slug, name: slug, ...over,
});

describe("normSlug", () => {
  it("trims and lowercases", () => {
    expect(normSlug("  Driving_Fwd ")).toBe("driving_fwd");
  });
});

describe("checkStateCoverage", () => {
  it("passes when every FDS state is declared", () => {
    const r = checkStateCoverage([fds("stopped"), fds("running")], [decl("stopped"), decl("running")]);
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("ignores surplus declared states", () => {
    const r = checkStateCoverage([fds("stopped")], [decl("stopped"), decl("running"), decl("holding")]);
    expect(r.ok).toBe(true);
  });

  it("matches case- and whitespace-insensitively", () => {
    const r = checkStateCoverage([fds(" Stopped ")], [decl("stopped")]);
    expect(r.ok).toBe(true);
  });

  it("reports missing states", () => {
    const r = checkStateCoverage([fds("stopped"), fds("holding"), fds("aborting")], [decl("stopped")]);
    expect(r.ok).toBe(false);
    expect(r.missing.map((s) => s.state_id)).toEqual(["holding", "aborting"]);
  });

  it("treats an empty declared list as full miss", () => {
    const r = checkStateCoverage([fds("stopped")], []);
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/em-state-coverage.test.ts`
Expected: FAIL — cannot resolve `../em-state-coverage`.

- [ ] **Step 3: Implement the module**

Create `src/lib/spec-builder/codegen/em-state-coverage.ts`:

```ts
import type { EmStateV2 } from "@/types/spec-contract-v2";
import type { FbInterfaceState } from "@/types/fb-interface";

/** Normalize a state slug/id for comparison: trim + lowercase. */
export function normSlug(s: string): string {
  return s.trim().toLowerCase();
}

export interface CoverageResult {
  ok: boolean;
  /** FDS states with no declared counterpart. */
  missing: EmStateV2[];
}

/**
 * Assert the FDS-required states are a subset of the library FB's declared
 * states (by normalized slug). Surplus declared states are fine — a richer
 * library FB legitimately covers a leaner spec. Pure.
 */
export function checkStateCoverage(
  fdsStates: EmStateV2[],
  declared: FbInterfaceState[],
): CoverageResult {
  const have = new Set(declared.map((d) => normSlug(d.slug)));
  const missing = fdsStates.filter((s) => !have.has(normSlug(s.state_id)));
  return { ok: missing.length === 0, missing };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/em-state-coverage.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/codegen/em-state-coverage.ts src/lib/spec-builder/codegen/__tests__/em-state-coverage.test.ts
git commit -m "feat(code-builder): EM state-coverage check"
```

---

## Task 3: Shared command-seam module + em-writer refactor

**Goal:** One definition of the `<EM>_CMD` DB + its call bindings, used by both EM paths; the synthesized path's output is byte-for-byte unchanged.

**Files:**
- Create: `src/lib/spec-builder/codegen/em-command-seam.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/em-command-seam.test.ts`
- Modify: `src/lib/spec-builder/codegen/em-writer.ts`

**Acceptance Criteria:**
- [ ] `buildCommandSeam(name, pins)` returns `{ cmdDb, callBindings, warnings }`.
- [ ] `cmdDb` is a `DB` artifact `<name>_CMD` with one STRUCT member per pin.
- [ ] `callBindings[i]` is `"<pin> := \"<name>_CMD\".<pin>"`.
- [ ] Empty `pins` ⇒ valid empty-STRUCT DB + one warning.
- [ ] `em-writer.ts` delegates to it; **existing `em-writer.test.ts` stays green** (byte-for-byte).

**Verify:** `npx vitest run src/lib/spec-builder/codegen/__tests__/em-command-seam.test.ts src/lib/spec-builder/codegen/__tests__/em-writer.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/codegen/__tests__/em-command-seam.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCommandSeam } from "../em-command-seam";

describe("buildCommandSeam", () => {
  it("builds a CMD DB with one member per pin", () => {
    const { cmdDb } = buildCommandSeam("Carriage", [
      { name: "enable", scl_type: "Bool" },
      { name: "mode", scl_type: "Int" },
      { name: "cmd_start", scl_type: "Bool" },
    ]);
    expect(cmdDb.name).toBe("Carriage_CMD");
    expect(cmdDb.type).toBe("DB");
    expect(cmdDb.content).toContain("enable : Bool;");
    expect(cmdDb.content).toContain("mode : Int;");
    expect(cmdDb.content).toContain("cmd_start : Bool;");
    expect(cmdDb.content).toContain('DATA_BLOCK "Carriage_CMD"');
  });

  it("produces call bindings that read each pin from the CMD DB", () => {
    const { callBindings } = buildCommandSeam("Carriage", [{ name: "enable", scl_type: "Bool" }]);
    expect(callBindings).toEqual(['enable := "Carriage_CMD".enable']);
  });

  it("warns and emits a valid empty DB when there are no command pins", () => {
    const { cmdDb, callBindings, warnings } = buildCommandSeam("Carriage", []);
    expect(callBindings).toEqual([]);
    expect(warnings.length).toBe(1);
    expect(cmdDb.content).toContain("STRUCT");
    expect(cmdDb.content).toContain("END_STRUCT;");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/em-command-seam.test.ts`
Expected: FAIL — cannot resolve `../em-command-seam`.

- [ ] **Step 3: Implement the module**

Create `src/lib/spec-builder/codegen/em-command-seam.ts`:

```ts
import type { CodegenArtifact } from "./types";

const PROGRAM = "Program blocks";

/** A command/mode pin exposed on the EM's command seam. */
export interface CommandSeamPin {
  name: string;
  /** SCL type token, e.g. "Bool" | "Int". */
  scl_type: string;
}

export interface CommandSeam {
  cmdDb: CodegenArtifact;
  /** Param strings for the EM instance call, each reading a pin from the DB. */
  callBindings: string[];
  warnings: string[];
}

/**
 * Build the `<EM>_CMD` DATA_BLOCK (the Unit/HMI command seam) plus the instance-
 * call bindings that read each command pin from it. Shared by the synthesized
 * and matched EM paths so both emit an identical command DB. Status outputs are
 * NOT wired here — they are left for the Unit coordinator. Pure.
 */
export function buildCommandSeam(emSclName: string, pins: CommandSeamPin[]): CommandSeam {
  const dbName = `${emSclName}_CMD`;
  const structLines = pins.map((p) => `      ${p.name} : ${p.scl_type};`);
  const cmdDb: CodegenArtifact = {
    name: dbName,
    type: "DB",
    filename: `${dbName}.db`,
    content: [
      `DATA_BLOCK "${dbName}"`,
      `{ S7_Optimized_Access := 'TRUE' }`,
      `VERSION : 0.1`,
      `   STRUCT`,
      ...structLines,
      `   END_STRUCT;`,
      `BEGIN`,
      `END_DATA_BLOCK`,
      ``,
    ].join("\n"),
    dependencies: [],
    folder: PROGRAM,
    layer: "em",
  };
  const callBindings = pins.map((p) => `${p.name} := "${dbName}".${p.name}`);
  const warnings = pins.length === 0
    ? [`EM ${emSclName}: library FB exposes no command interface`]
    : [];
  return { cmdDb, callBindings, warnings };
}
```

- [ ] **Step 4: Refactor `em-writer.ts` to delegate**

In `src/lib/spec-builder/codegen/em-writer.ts`, add the import near the top (after the existing imports):

```ts
import { buildCommandSeam, type CommandSeamPin } from "./em-command-seam";
```

Add a small helper above `writeCmdDb` that builds the synthesized command-pin list once:

```ts
/** The fixed command-seam pins every synthesized EM FB exposes. */
function commandPins(seq: EmSequence): CommandSeamPin[] {
  return [
    { name: "enable", scl_type: "Bool" },
    { name: "mode", scl_type: "Int" },
    ...seq.cmdPins.map((p) => ({ name: p, scl_type: "Bool" })),
  ];
}
```

Replace the body of `writeCmdDb` with a delegation that re-attaches owner metadata (content is identical to before):

```ts
/** Command DB — the Unit/HMI seam that drives the EM's command inputs. */
function writeCmdDb(seq: EmSequence): CodegenArtifact {
  const { cmdDb } = buildCommandSeam(seq.sclName, commandPins(seq));
  return { ...cmdDb, ownerId: seq.emId, ownerName: seq.emName };
}
```

Replace `buildCallLines` so the command params come from the seam (the `enable := "<cmd>".enable, …` string is byte-for-byte the same):

```ts
/** OB1 call lines: instantiate the FB from its CMD DB, then run its MAP FC. */
function buildCallLines(seq: EmSequence): string[] {
  const inst = `EM_${seq.sclName}_DB`;
  const { callBindings } = buildCommandSeam(seq.sclName, commandPins(seq));
  return [`   "${inst}"(${callBindings.join(", ")});`, `   "MAP_${seq.sclName}"();`];
}
```

- [ ] **Step 5: Run command-seam + em-writer suites**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/em-command-seam.test.ts src/lib/spec-builder/codegen/__tests__/em-writer.test.ts`
Expected: command-seam PASS; **em-writer PASS unchanged** (proves byte-for-byte extraction). If em-writer fails, diff the produced `_CMD` DB / call line against the test's expected string and reconcile the seam output exactly — do not edit the em-writer tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/spec-builder/codegen/em-command-seam.ts src/lib/spec-builder/codegen/__tests__/em-command-seam.test.ts src/lib/spec-builder/codegen/em-writer.ts
git commit -m "feat(code-builder): shared EM command-seam builder (extracted from em-writer)"
```

---

## Task 4: EM↔CM wiring module

**Goal:** Resolve EM `sensor_in`/`actuator_out` pins to CM instance pins by role + tag, emitting `LINK_<em>_IN` / `LINK_<em>_OUT` FCs with `// TODO bind` lines on ambiguity.

**Files:**
- Create: `src/lib/spec-builder/codegen/matched-em-builder.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/matched-em-builder.test.ts`

**Acceptance Criteria:**
- [ ] `linkKey` normalizes a pin/tag (drop role prefix, lowercase, strip non-alnum).
- [ ] Unambiguous `sensor_in` → `LINK_IN` assignment from the CM instance output pin.
- [ ] Unambiguous `actuator_out` → `LINK_OUT` assignment into the CM instance input pin.
- [ ] 0-match and 2+-match each produce a `// TODO bind` line + a warning (candidates named on 2+).
- [ ] Only `sensor_in` / `actuator_out` EM pins are processed; others are ignored.

**Verify:** `npx vitest run src/lib/spec-builder/codegen/__tests__/matched-em-builder.test.ts` → all pass.

**Steps:**

- [ ] **Step 1: Write the failing test**

Create `src/lib/spec-builder/codegen/__tests__/matched-em-builder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildEmCmLinks, linkKey, type CmLinkInfo } from "../matched-em-builder";
import type { FbInterfacePin } from "@/types/fb-interface";

const pin = (over: Partial<FbInterfacePin>): FbInterfacePin => ({
  name: "x", scl_type: "Bool", direction: "input", role: "sensor_in",
  default_binding: "fb_output", exposed: false, description: "", ...over,
});

const cm = (over: Partial<CmLinkInfo>): CmLinkInfo => ({
  instanceDb: "CM_X_DB", pins: [], tags: [], ...over,
});

describe("linkKey", () => {
  it("drops a role prefix and normalizes", () => {
    expect(linkKey("fb_at_top")).toBe("attop");
    expect(linkKey("cmd_Run")).toBe("run");
    expect(linkKey("AT_TOP")).toBe("attop");
  });
});

describe("buildEmCmLinks", () => {
  it("wires an unambiguous sensor_in from the CM output pin", () => {
    const emPins = [pin({ name: "fb_at_top", role: "sensor_in", direction: "input" })];
    const cms = [cm({
      instanceDb: "CM_LS_Top_DB", tags: ["at_top"],
      pins: [pin({ name: "at_top", role: "status", direction: "output" })],
    })];
    const { linkIn, warnings } = buildEmCmLinks("Carriage", "EM_Carriage_DB", emPins, cms);
    expect(linkIn.name).toBe("LINK_Carriage_IN");
    expect(linkIn.content).toContain('"EM_Carriage_DB".fb_at_top := "CM_LS_Top_DB".at_top;');
    expect(warnings).toEqual([]);
  });

  it("wires an unambiguous actuator_out into the CM input pin", () => {
    const emPins = [pin({ name: "cmd_run", role: "actuator_out", direction: "output" })];
    const cms = [cm({
      instanceDb: "CM_Motor_DB", tags: ["run"],
      pins: [pin({ name: "run", role: "actuator_out", direction: "input" })],
    })];
    const { linkOut } = buildEmCmLinks("Carriage", "EM_Carriage_DB", emPins, cms);
    expect(linkOut.name).toBe("LINK_Carriage_OUT");
    expect(linkOut.content).toContain('"CM_Motor_DB".run := "EM_Carriage_DB".cmd_run;');
  });

  it("emits a TODO + warning when no CM provides the tag", () => {
    const emPins = [pin({ name: "fb_missing", role: "sensor_in", direction: "input" })];
    const { linkIn, warnings } = buildEmCmLinks("Carriage", "EM_Carriage_DB", emPins, []);
    expect(linkIn.content).toContain("// TODO bind #fb_missing");
    expect(warnings[0]).toContain("no CM provides");
  });

  it("emits a TODO naming candidates when 2+ CMs match", () => {
    const emPins = [pin({ name: "cmd_lift", role: "actuator_out", direction: "output" })];
    const cms = [
      cm({ instanceDb: "CM_Motor_M01_DB", tags: ["lift"], pins: [pin({ name: "lift", role: "actuator_out", direction: "input" })] }),
      cm({ instanceDb: "CM_Motor_M02_DB", tags: ["lift"], pins: [pin({ name: "lift", role: "actuator_out", direction: "input" })] }),
    ];
    const { linkOut, warnings } = buildEmCmLinks("Carriage", "EM_Carriage_DB", emPins, cms);
    expect(linkOut.content).toContain("// TODO bind #cmd_lift");
    expect(linkOut.content).toContain("CM_Motor_M01_DB");
    expect(linkOut.content).toContain("CM_Motor_M02_DB");
    expect(warnings[0]).toContain("CMs consume");
  });

  it("ignores EM pins that are not sensor_in / actuator_out", () => {
    const emPins = [
      pin({ name: "enable", role: "cmd", direction: "input" }),
      pin({ name: "state", role: "status", direction: "output" }),
    ];
    const { linkIn, linkOut, warnings } = buildEmCmLinks("Carriage", "EM_Carriage_DB", emPins, []);
    expect(linkIn.content).not.toContain("enable");
    expect(linkOut.content).not.toContain("state");
    expect(warnings).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/matched-em-builder.test.ts`
Expected: FAIL — cannot resolve `../matched-em-builder`.

- [ ] **Step 3: Implement the module**

Create `src/lib/spec-builder/codegen/matched-em-builder.ts`:

```ts
import type { FbInterfacePin } from "@/types/fb-interface";
import type { CodegenArtifact } from "./types";

const PROGRAM = "Program blocks";

/** Per control-module facts the linker needs. */
export interface CmLinkInfo {
  /** instance DB name, e.g. "CM_Motor_M01_DB" */
  instanceDb: string;
  /** the CM's contract pins ([] when no reviewed contract) */
  pins: FbInterfacePin[];
  /** the FDS tags this CM owns (from its io_signals) */
  tags: string[];
}

export interface EmCmLinkResult {
  linkIn: CodegenArtifact;
  linkOut: CodegenArtifact;
  warnings: string[];
}

/** Comparison key for a pin name or tag: drop a leading role-ish prefix,
 *  lowercase, strip non-alphanumerics. Lets `fb_at_top` match tag `at_top`. */
export function linkKey(s: string): string {
  const stripped = s.replace(/^(fb|cmd|act|ilk|sensor|status|out|in)_/i, "");
  return stripped.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** CMs whose owned tags match `key`. */
function candidatesFor(key: string, cms: CmLinkInfo[]): CmLinkInfo[] {
  return cms.filter((cm) => cm.tags.some((t) => linkKey(t) === key));
}

/** Pick the CM pin of the wanted direction: same-key first, else the first of
 *  that direction; null if none. */
function pickCmPin(cm: CmLinkInfo, key: string, dir: FbInterfacePin["direction"]): FbInterfacePin | null {
  return cm.pins.find((p) => p.direction === dir && linkKey(p.name) === key)
    ?? cm.pins.find((p) => p.direction === dir)
    ?? null;
}

function fc(name: string, bodyLines: string[]): CodegenArtifact {
  return {
    name,
    type: "FC",
    filename: `${name}.scl`,
    content: [
      `FUNCTION "${name}" : Void`,
      `{ S7_Optimized_Access := 'TRUE' }`,
      `VERSION : 0.1`,
      `BEGIN`,
      ...bodyLines,
      `END_FUNCTION`,
      ``,
    ].join("\n"),
    dependencies: [],
    folder: PROGRAM,
    layer: "em",
  };
}

/**
 * Resolve EM↔CM wiring by role + tag. Produces LINK_<em>_IN (CM outputs → EM
 * inputs, run before the EM call) and LINK_<em>_OUT (EM outputs → CM inputs,
 * run after). Only `sensor_in` (IN) and `actuator_out` (OUT) EM pins are linked
 * here; command/mode/status/interlock pins are handled elsewhere. Ambiguous or
 * unresolved pins become `// TODO bind` lines + warnings; never guesses. Pure.
 */
export function buildEmCmLinks(
  emSclName: string,
  emInstanceDb: string,
  emPins: FbInterfacePin[],
  cms: CmLinkInfo[],
): EmCmLinkResult {
  const warnings: string[] = [];
  const inLines: string[] = [`   // CM status feedback -> EM inputs`];
  const outLines: string[] = [`   // EM commands -> CM inputs`];

  for (const p of emPins) {
    const key = linkKey(p.name);

    if (p.role === "sensor_in" && p.direction === "input") {
      const cands = candidatesFor(key, cms);
      if (cands.length !== 1) {
        const why = cands.length === 0
          ? `no CM provides "${p.name}"`
          : `${cands.length} CMs provide "${p.name}" (${cands.map((c) => c.instanceDb).join(" | ")})`;
        inLines.push(`   // TODO bind #${p.name} — ${why}`);
        warnings.push(`EM ${emSclName}: IN pin ${p.name} — ${why}`);
        continue;
      }
      const cm = cands[0];
      const cmPin = pickCmPin(cm, key, "output");
      if (!cmPin) {
        inLines.push(`   // TODO bind #${p.name} — ${cm.instanceDb} exposes no output pin`);
        warnings.push(`EM ${emSclName}: IN pin ${p.name} — ${cm.instanceDb} has no output pin`);
        continue;
      }
      inLines.push(`   "${emInstanceDb}".${p.name} := "${cm.instanceDb}".${cmPin.name};`);
      continue;
    }

    if (p.role === "actuator_out" && p.direction === "output") {
      const cands = candidatesFor(key, cms);
      if (cands.length !== 1) {
        const why = cands.length === 0
          ? `no CM consumes "${p.name}"`
          : `${cands.length} CMs consume "${p.name}" (${cands.map((c) => c.instanceDb).join(" | ")})`;
        outLines.push(`   // TODO bind #${p.name} — ${why}`);
        warnings.push(`EM ${emSclName}: OUT pin ${p.name} — ${why}`);
        continue;
      }
      const cm = cands[0];
      const cmPin = pickCmPin(cm, key, "input");
      if (!cmPin) {
        outLines.push(`   // TODO bind #${p.name} — ${cm.instanceDb} exposes no input pin`);
        warnings.push(`EM ${emSclName}: OUT pin ${p.name} — ${cm.instanceDb} has no input pin`);
        continue;
      }
      outLines.push(`   "${cm.instanceDb}".${cmPin.name} := "${emInstanceDb}".${p.name};`);
    }
  }

  return {
    linkIn: fc(`LINK_${emSclName}_IN`, inLines),
    linkOut: fc(`LINK_${emSclName}_OUT`, outLines),
    warnings,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/matched-em-builder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/codegen/matched-em-builder.ts src/lib/spec-builder/codegen/__tests__/matched-em-builder.test.ts
git commit -m "feat(code-builder): EM<->CM link resolution (role+tag, TODO on ambiguity)"
```

---

## Task 5: Expose instance DB + contract from fb-instantiate

**Goal:** `InstantiateResult` carries the instance-DB name and the matched template's contract, so the compiler can build CM link info and run the coverage check.

**Files:**
- Modify: `src/lib/spec-builder/codegen/fb-instantiate.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts`

**Acceptance Criteria:**
- [ ] `InstantiateResult` has `instanceDb: string` and `contract: FbInterfaceContract | null`.
- [ ] Matched CM/EM: `instanceDb` is the instance DB name; `contract` is the template's `interface_contract`.
- [ ] Stub CM/EM: `instanceDb` is `<fbName>_DB`; `contract` is `null`.
- [ ] Existing fb-instantiate tests still pass.

**Verify:** `npx vitest run src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts && npx tsc -b` → pass + clean.

**Steps:**

- [ ] **Step 1: Write the failing test**

Append to `src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts`, inside the `describe("instantiate contract wiring", …)` block (before its closing `});`):

```ts
  it("exposes the instance DB name and contract for a matched CM", () => {
    const r = instantiateControlModule(contractCm(), [tmpl({ interface_contract: reviewedContract })]);
    expect(r.instanceDb).toBe("CM_Motor_M01_DB");
    expect(r.contract).not.toBeNull();
    expect(r.contract?.block_name).toBe("CM_Motor");
  });

  it("exposes a stub instance DB name and null contract when nothing matched", () => {
    const r = instantiateControlModule(contractCm(), []);
    expect(r.instanceDb).toMatch(/_DB$/);
    expect(r.contract).toBeNull();
  });
```

> The `contractCm()` / `tmpl()` / `reviewedContract` helpers already exist in this file from C1. If `reviewedContract.block_name` differs from `"CM_Motor"`, match the assertion to the fixture's actual block name. The matched instance name format is `<templateBlockName>_<sclIdent(deviceName)>_DB`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts`
Expected: FAIL — `instanceDb` / `contract` are `undefined` on `InstantiateResult`.

- [ ] **Step 3: Extend `InstantiateResult` and populate it**

In `src/lib/spec-builder/codegen/fb-instantiate.ts`, add to the imports at the top:

```ts
import type { FbInterfacePin, FbInterfaceContract } from "@/types/fb-interface";
```

(Replace the existing `import type { FbInterfacePin } from "@/types/fb-interface";` line with the line above.)

Extend the interface:

```ts
export interface InstantiateResult {
  artifacts: CodegenArtifact[];
  callLines: string[];
  stub: { id: string; name: string; reason: string } | null;
  warnings: string[];
  /** The instance DB block name (matched or stub). */
  instanceDb: string;
  /** The matched template's interface contract, or null for a stub. */
  contract: FbInterfaceContract | null;
}
```

In the shared `instantiate(...)` function, update both return sites. The stub branch:

```ts
  if (!t) {
    const fb = stubFb(prefix, name, io);
    const instanceName = `${fb.name}_DB`;
    return {
      artifacts: [fb, instanceDb(instanceName, fb.name)].map(tag),
      callLines: wiringLines(instanceName, io),
      stub: { id, name, reason: `no ${isEm ? "EM" : "CM"} template matched "${deviceClass}"` },
      warnings: [],
      instanceDb: instanceName,
      contract: null,
    };
  }
```

The matched branch:

```ts
  const block = templateBlockName(t);
  const instance = `${block}_${sclIdent(name)}_DB`;
  const db = instanceDb(instance, block);
  const w = buildWiring(instance, t, io);
  return {
    artifacts: [db].map(tag),
    callLines: w.lines,
    stub: null,
    warnings: w.warnings,
    instanceDb: instance,
    contract: t.interface_contract,
  };
```

> Note: there is a local function `instanceDb(...)` and a new field `instanceDb`. They do not collide — the field is on the returned object literal; the function is called as `instanceDb(instance, block)`. Leave the function name as-is.

- [ ] **Step 4: Run the test + typecheck**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts && npx tsc -b`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/codegen/fb-instantiate.ts src/lib/spec-builder/codegen/__tests__/fb-instantiate.test.ts
git commit -m "feat(code-builder): expose instance DB name + contract from fb-instantiate"
```

---

## Task 6: Compile-contract 4-case integration

**Goal:** Replace the matched-EM branch with the 4-case split — verified instantiation with coverage gating, EM↔CM links, command seam, and the structural double-drive fix — and order OB1 calls CM → IN → EM → OUT.

**Files:**
- Modify: `src/lib/spec-builder/codegen/compile-contract.ts`
- Test: `src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts`

**Acceptance Criteria:**
- [ ] Case A (matched + contract, coverage passes): emits CM instances, EM instance DB, `<em>_CMD`, `LINK_*_IN/_OUT`; OB1 order is CM calls → IN → EM → OUT.
- [ ] Case A coverage fails: a `stubs.equipmentModules` entry naming the missing states; **no EM instance DB / CMD / LINK emitted**.
- [ ] Case B (matched, no contract): instantiates with a "coverage unverifiable" warning.
- [ ] Cases C (synthesized) and D (stub FB) behave as before.
- [ ] Double-drive regression: each physical IO address is written by exactly one block (the CM), never the EM.
- [ ] `npx tsc -b` clean; full codegen suite passes.

**Verify:** `npx vitest run src/lib/spec-builder/codegen && npx tsc -b` → all pass, clean.

**Steps:**

- [ ] **Step 1: Write the failing tests**

In `src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts`, add a helper to build a matched EM template + an EM with a state machine, then the case tests. Append inside the existing top-level `describe(...)` block (adapt the fixture helpers `unit(...)`, `em(...)`, `cm(...)`, `contractV2(...)` to whatever the file already defines from C1 — reuse them):

```ts
import type { FbTemplate } from "@/types/fb-template";
import type { FbInterfaceContract } from "@/types/fb-interface";

// A library EM template that declares its states + role-tagged pins.
const emTemplate = (states: { slug: string; name: string }[]): FbTemplate => ({
  // minimal fields used by pickTemplate + instantiate; fill the rest per the
  // file's existing `tmpl(...)` helper if present, else a full FbTemplate literal.
  id: "emT", name: "IndexConveyor", device_category: "conveyor", plc_brand: "SIEMENS_TIA",
  description: null, ai_summary: null, diagram_chart: null, diagram_generated_at: null,
  flow_diagram_json: null, flow_diagram_generated_at: null, version: 1, tags: ["conveyor"],
  source: "library", library_name: "Std", is_enabled: true, is_equipment_module: true,
  documentation: null, hmi_faceplate_type: null,
  interface_contract: {
    block_name: "EM_IndexConveyor",
    pins: [
      { name: "fb_at_home", scl_type: "Bool", direction: "input", role: "sensor_in", default_binding: "fb_output", exposed: false, description: "" },
      { name: "cmd_run", scl_type: "Bool", direction: "output", role: "actuator_out", default_binding: "io_output", exposed: true, description: "" },
      { name: "mode", scl_type: "Int", direction: "input", role: "mode", default_binding: "hmi", exposed: false, description: "" },
    ],
    states: states.map((s) => ({ slug: s.slug, name: s.name })),
    reviewed: true,
    generated_at: "2026-06-30T00:00:00Z",
  } as FbInterfaceContract,
  created_by: null, updated_at: "", created_at: "",
  blocks: [{ id: "b", template_id: "emT", block_name: "EM_IndexConveyor", block_type: "FB", scl_code: "", block_xml: null, programming_language: "SCL", sort_order: 0, created_at: "" }],
});

describe("compile-contract — verified matched EM", () => {
  it("Case A pass: emits instance + CMD + LINK and orders OB1 CM→IN→EM→OUT", () => {
    const tmpls = [emTemplate([{ slug: "home", name: "Home" }, { slug: "running", name: "Running" }])];
    // contractV2 must define a Unit > EM "IndexConveyor" with states home/running
    // and one CM owning tags "at_home" + "run".
    const res = compileContract(matchedEmContract(["home", "running"]), tmpls);
    const names = res.artifacts.map((a) => a.name);
    expect(names).toContain("LINK_IndexConveyor_IN");
    expect(names).toContain("LINK_IndexConveyor_OUT");
    expect(names).toContain("IndexConveyor_CMD");
    const ob1 = res.artifacts.find((a) => a.type === "OB")!;
    const body = ob1.content;
    expect(body.indexOf("LINK_IndexConveyor_IN")).toBeLessThan(body.indexOf("EM_IndexConveyor"));
    expect(body.indexOf("EM_IndexConveyor")).toBeLessThan(body.indexOf("LINK_IndexConveyor_OUT"));
  });

  it("Case A fail: blocks with a stub entry naming missing states, no instance", () => {
    const tmpls = [emTemplate([{ slug: "home", name: "Home" }])]; // missing "running"
    const res = compileContract(matchedEmContract(["home", "running"]), tmpls);
    const gap = res.stubs.equipmentModules.find((e) => e.reason.includes("missing states"));
    expect(gap).toBeTruthy();
    expect(gap!.reason).toContain("running");
    expect(res.artifacts.some((a) => a.name === "IndexConveyor_CMD")).toBe(false);
    expect(res.artifacts.some((a) => a.name.startsWith("LINK_IndexConveyor"))).toBe(false);
  });

  it("Case B: matched but no FDS contract → coverage-unverifiable warning", () => {
    const tmpls = [emTemplate([{ slug: "home", name: "Home" }])];
    const res = compileContract(matchedEmNoStateMachine(), tmpls);
    expect(res.warnings.some((w) => w.includes("coverage unverifiable"))).toBe(true);
  });

  it("double-drive: no physical address is written by the EM instance", () => {
    const tmpls = [emTemplate([{ slug: "home", name: "Home" }, { slug: "running", name: "Running" }])];
    const res = compileContract(matchedEmContract(["home", "running"]), tmpls);
    const emInstanceWrites = res.artifacts
      .filter((a) => a.name.startsWith("EM_IndexConveyor"))
      .map((a) => a.content)
      .join("\n");
    // The EM never assigns a physical address literal like "Q0.0" / "I0.0".
    expect(emInstanceWrites).not.toMatch(/"[IQ]\d+\.\d+"/);
  });
});
```

> `matchedEmContract(states)` and `matchedEmNoStateMachine()` are local fixture builders you write next to this block, using the file's existing `contractV2`/`unit`/`em`/`cm` helpers: a single Unit with one EM named `IndexConveyor` (so `pickTemplate` matches by name+category) whose `equipment_modules[emId]` contract has `states` = the given slugs, and one Control Module owning IO tags (`at_home` DI `I0.0`, `run` DO `Q0.0`). For `matchedEmNoStateMachine()`, omit the EM from `equipment_modules` (so `emContract` is undefined) while keeping it in the hierarchy. Mirror the existing C1 fixtures' shape exactly.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts`
Expected: FAIL — current code wires the matched EM to physical IO and emits no LINK/CMD.

- [ ] **Step 3: Rewrite the matched branch**

In `src/lib/spec-builder/codegen/compile-contract.ts`, update the imports at the top:

```ts
import { sclIdent } from "./sa-builder";
import { buildEmSequence } from "./em-builder";
import { writeEmArtifacts } from "./em-writer";
import { instantiateControlModule, instantiateEquipmentModule } from "./fb-instantiate";
import { writeOb1 } from "./ob1-writer";
import { checkStateCoverage, normSlug } from "./em-state-coverage";
import { buildCommandSeam, type CommandSeamPin } from "./em-command-seam";
import { buildEmCmLinks, type CmLinkInfo } from "./matched-em-builder";
```

Replace the entire `for (const em of unit.equipment_modules) { … }` body (the block currently spanning lines ~39–68) with:

```ts
    for (const em of unit.equipment_modules) {
      const emContract = contract.equipment_modules[em.equipment_module_id];
      const emRes = instantiateEquipmentModule(em, templates);

      // Case C: synthesized (unmatched + contract). CMs are subsumed via MAP.
      if (emRes.stub && emContract) {
        const seq = buildEmSequence(em, emContract);
        const { artifacts: emArts, callLines } = writeEmArtifacts(seq);
        emArts.forEach(push);
        deviceCallLines.push(...callLines);
        warnings.push(...seq.warnings);
        continue;
      }

      // Matched or stub-without-contract: CMs are their own FBs and own all
      // physical IO. Collect link info as we instantiate them.
      const cmLinks: CmLinkInfo[] = [];
      const cmCallLines: string[] = [];
      for (const cm of em.control_modules) {
        const cmRes = instantiateControlModule(cm, templates);
        cmRes.artifacts.forEach(push);
        cmCallLines.push(...cmRes.callLines);
        warnings.push(...cmRes.warnings);
        if (cmRes.stub) stubs.controlModules.push(cmRes.stub);
        cmLinks.push({
          instanceDb: cmRes.instanceDb,
          pins: cmRes.contract?.pins ?? [],
          tags: cm.io_signals.map((s) => s.tag),
        });
      }

      // Case D: stub EM (no template, no contract). Keep the stub FB + wiring.
      if (emRes.stub) {
        emRes.artifacts.forEach(push);
        deviceCallLines.push(...emRes.callLines);
        stubs.equipmentModules.push(emRes.stub);
        continue;
      }

      // Matched EM (Cases A/B). The EM never touches physical IO — its
      // emRes.callLines are intentionally NOT pushed (double-drive fix).
      const sclName = sclIdent(em.equipment_module_name);

      if (emContract) {
        // Case A — verified: coverage gates instantiation.
        const cov = checkStateCoverage(emContract.states, emRes.contract?.states ?? []);
        if (!cov.ok) {
          const missing = cov.missing.map((s) => s.name).join(", ");
          stubs.equipmentModules.push({
            id: em.equipment_module_id,
            name: em.equipment_module_name,
            reason: `library FB "${emRes.contract?.block_name ?? sclName}" missing states: ${missing}`,
          });
          warnings.push(`EM ${em.equipment_module_name}: BLOCKED — library FB missing states: ${missing}`);
          continue;
        }
        const fdsSafe = emContract.states.find((s) => s.is_safe_state);
        const declSafe = (emRes.contract?.states ?? []).find((s) => s.is_safe);
        if (fdsSafe && declSafe && normSlug(fdsSafe.state_id) !== normSlug(declSafe.slug)) {
          warnings.push(`EM ${em.equipment_module_name}: safe-state mismatch — FDS "${fdsSafe.state_id}" vs FB "${declSafe.slug}"`);
        }
      } else {
        // Case B — matched but no FDS state machine to verify against.
        warnings.push(`EM ${em.equipment_module_name}: coverage unverifiable — no FDS state machine`);
      }

      // EM instance DB (from the matched instantiate result).
      emRes.artifacts.forEach(push);

      // Command seam: <EM>_CMD DB from the contract's cmd/mode pins.
      const cmdPins: CommandSeamPin[] = (emRes.contract?.pins ?? [])
        .filter((p) => p.role === "cmd" || p.role === "mode")
        .map((p) => ({ name: p.name, scl_type: p.scl_type }));
      const seam = buildCommandSeam(sclName, cmdPins);
      push({ ...seam.cmdDb, ownerId: em.equipment_module_id, ownerName: em.equipment_module_name });
      warnings.push(...seam.warnings);

      // EM↔CM links.
      const links = buildEmCmLinks(sclName, emRes.instanceDb, emRes.contract?.pins ?? [], cmLinks);
      push({ ...links.linkIn, ownerId: em.equipment_module_id, ownerName: em.equipment_module_name });
      push({ ...links.linkOut, ownerId: em.equipment_module_id, ownerName: em.equipment_module_name });
      warnings.push(...links.warnings);

      // OB1 order: CM calls → IN → EM call → OUT.
      deviceCallLines.push(...cmCallLines);
      deviceCallLines.push(`   "${links.linkIn.name}"();`);
      deviceCallLines.push(`   "${emRes.instanceDb}"(${seam.callBindings.join(", ")});`);
      deviceCallLines.push(`   "${links.linkOut.name}"();`);
    }
```

- [ ] **Step 4: Run the codegen suite + typecheck**

Run: `npx vitest run src/lib/spec-builder/codegen && npx tsc -b`
Expected: all pass, clean. If a pre-existing compile-contract test asserted the old matched behavior (EM wired to physical IO), update that assertion to the new model — the EM no longer wires physical addresses; CMs do. Do not weaken the double-drive regression.

- [ ] **Step 5: Commit**

```bash
git add src/lib/spec-builder/codegen/compile-contract.ts src/lib/spec-builder/codegen/__tests__/compile-contract.test.ts
git commit -m "feat(code-builder): verified matched-EM compile path + double-drive fix"
```

---

## Final Verification

After Task 6, run the whole codegen surface + typecheck:

```bash
npx vitest run src/lib/spec-builder/codegen src/components/fb-library && npx tsc -b
```

Expected: all green, `tsc -b` clean.

**Post-task self-check (CLAUDE.md):** `compile-contract.ts` is a pipeline file. Re-read "All Changes Must Be Generic": coverage compares slugs, links resolve through FDS tags, the seam reads roles — no device name, sequence, or fault condition is hard-coded. Mentally verify against conveyor / lift-table / stamping EM shapes. The `.claude/agents/pipeline-auditor.md` agent does not exist (per memory + CLAUDE.md note) — perform the manual generic-check instead.

**Migration note:** no DB migration in this sub-project — `states` rides inside the existing `interface_contract` JSONB column. Existing rows decode with `states` absent; every consumer reads `?? []`.
