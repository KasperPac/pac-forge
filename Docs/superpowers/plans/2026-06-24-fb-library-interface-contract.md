# FB Library Interface Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every FB Library template a structured, human-reviewed interface contract (role-tagged pins + binding hints + exposed flag), authored from a single shared SCL parser and an AI pre-fill, stored as a JSONB column — so a later Phase 3.5 can bind devices to FBs deterministically.

**Architecture:** A new contract type (`src/types/fb-interface.ts`) + one shared SCL var parser (`src/lib/spec-builder/fb-interface.ts`) that replaces three ad-hoc regex parsers. An AI hook pre-fills the semantic layer (role/binding/exposed), merged onto the SCL-authoritative pin list. The contract persists in a new `fb_templates.interface_contract` JSONB column via a dedicated raw-column mutation (mirroring how `ai_summary` is saved). The FB Library page surfaces an editable grid that sets `reviewed: true` on save. **No Code Builder consumption** — `fb-instantiate.ts` is untouched; all consumption is deferred to Phase 3.5.

**Tech Stack:** React 19 + Vite 7 + TypeScript 5.9 (strict: `import type`, no enums → `as const`, no unused locals), Supabase (Postgres + RLS), TanStack Query, vitest 2.1.8 + jsdom + React Testing Library.

**Spec:** `Docs/superpowers/specs/2026-06-23-fb-library-interface-contract-design.md`

---

## Reference: current state (read before starting)

Three duplicate parsers exist today and must all keep behaving identically after Task 2:

| File | Function | Purpose | Sections it parses |
|---|---|---|---|
| `src/routes/fb-library.tsx:1497` | `parseVarsFromScl` | display grid | INPUT, OUTPUT, IN_OUT, TEMP, STATIC |
| `src/lib/forge-device-matcher.ts:46` | `parseInterface` | Bool/analog **counts** for match scoring | INPUT, OUTPUT |
| `src/lib/fb-flow-diagram.ts:105` | `parseVarSections` | flow SVG (traces static/temp) | INPUT, OUTPUT, STATIC, TEMP (no inout) |

**The shared parser MUST be a superset** (all five sections) or `fb-flow-diagram` regresses — it depends on static/temp intermediate vars.

---

### Task 1: Contract types + shared SCL parser

**Goal:** One contract type module and one shared parser that extracts every VAR section from SCL, with a derived helper for the contract-relevant pins.

**Files:**
- Create: `src/types/fb-interface.ts`
- Create: `src/lib/spec-builder/fb-interface.ts`
- Create: `src/lib/spec-builder/__tests__/fb-interface.test.ts`
- Modify: `src/types/index.ts` (add barrel export)

**Acceptance Criteria:**
- [ ] `FbInterfaceContract`, `FbInterfacePin`, `FbPinRole`, `FbBindingSource` exported from `src/types/fb-interface.ts` and re-exported from the barrel.
- [ ] `FB_PIN_ROLES` and `FB_BINDING_SOURCES` const arrays exist (drive UI dropdowns; no enums per TS config).
- [ ] `parseFbInterface(scl)` returns every var across input/output/inout/static/temp with name, scl_type, section, description.
- [ ] `interfacePins(vars)` filters to input/output/inout and maps `section` → `direction`.
- [ ] Test passes: `npx vitest run src/lib/spec-builder/__tests__/fb-interface.test.ts`.

**Verify:** `npx vitest run src/lib/spec-builder/__tests__/fb-interface.test.ts` → all green; `npx tsc -b` → no errors.

**Steps:**

- [ ] **Step 1: Write the contract types**

Create `src/types/fb-interface.ts`:

```ts
// src/types/fb-interface.ts
// Structured, self-describing interface contract for an FB Library template.
// Generic across machine types — roles and binding sources are abstract; never
// device-specific. See Docs/superpowers/specs/2026-06-23-fb-library-interface-contract-design.md.

/** Semantic purpose of an FB pin. */
export const FB_PIN_ROLES = [
  "cmd",          // command input (start/stop/forward) — typically HMI or EM
  "mode",         // mode / selection input
  "param",        // configuration parameter input
  "interlock",    // interlock / permissive input
  "sensor_in",    // process feedback input (wired DI/AI or conditioned upstream FB output)
  "actuator_out", // physical actuation output (to the Output image DB)
  "status",       // status output (running / ready / done / position)
  "fault",        // fault / alarm output
] as const;
export type FbPinRole = (typeof FB_PIN_ROLES)[number];

/** Expected source kind a pin binds to. A per-instance binding (Phase 3.5) may override. */
export const FB_BINDING_SOURCES = [
  "io_input",   // Input image-DB member
  "io_output",  // Output image-DB member
  "fb_output",  // upstream FB instance-DB output
  "hmi",        // HMI / command interface
  "em",         // EM / coordination interface
  "param",      // config constant
] as const;
export type FbBindingSource = (typeof FB_BINDING_SOURCES)[number];

export interface FbInterfacePin {
  /** pin identifier, from SCL */
  name: string;
  /** Bool | Int | Real | … (first token of the SCL type) */
  scl_type: string;
  direction: "input" | "output" | "inout";
  role: FbPinRole;
  /** expected source; a per-instance binding may override */
  default_binding: FbBindingSource;
  /** output that becomes an fb_instance tag once bound */
  exposed: boolean;
  /** from the SCL // comment */
  description: string;
}

export interface FbInterfaceContract {
  /** the main FB block this describes */
  block_name: string;
  pins: FbInterfacePin[];
  /** a human has confirmed the AI-extracted semantic layer */
  reviewed: boolean;
  /** ISO timestamp of the last AI extraction */
  generated_at: string;
}
```

- [ ] **Step 2: Write the failing parser test**

Create `src/lib/spec-builder/__tests__/fb-interface.test.ts`:

```ts
// src/lib/spec-builder/__tests__/fb-interface.test.ts
import { describe, it, expect } from "vitest";
import { parseFbInterface, interfacePins } from "../fb-interface";

const SCL = `FUNCTION_BLOCK "CM_Motor"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      Run : Bool;   // start command
      Speed : Int := 0; // setpoint
   END_VAR
   VAR_OUTPUT
      Running : Bool; // status
      Fault : Bool;
   END_VAR
   VAR_IN_OUT
      Cfg : "udtCfg";
   END_VAR
   VAR
      iState : Int;  // internal
   END_VAR
   VAR_TEMP
      tEdge : Bool;
   END_VAR
BEGIN
END_FUNCTION_BLOCK`;

describe("parseFbInterface", () => {
  it("extracts every section as a superset", () => {
    const vars = parseFbInterface(SCL);
    const sections = vars.map((v) => v.section).sort();
    expect(sections).toEqual(["input", "input", "inout", "output", "output", "static", "temp"]);
  });

  it("captures name, type and inline comment", () => {
    const run = parseFbInterface(SCL).find((v) => v.name === "Run");
    expect(run).toMatchObject({ name: "Run", scl_type: "Bool", section: "input", description: "start command" });
  });

  it("keeps static and temp vars (flow-diagram dependency)", () => {
    const names = parseFbInterface(SCL).filter((v) => v.section === "static" || v.section === "temp").map((v) => v.name);
    expect(names).toEqual(["iState", "tEdge"]);
  });
});

describe("interfacePins", () => {
  it("returns only input/output/inout, mapped to direction", () => {
    const pins = interfacePins(parseFbInterface(SCL));
    expect(pins.map((p) => p.name)).toEqual(["Run", "Speed", "Running", "Fault", "Cfg"]);
    expect(pins.find((p) => p.name === "Cfg")?.direction).toBe("inout");
    expect(pins.find((p) => p.name === "Running")?.direction).toBe("output");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/spec-builder/__tests__/fb-interface.test.ts`
Expected: FAIL — cannot resolve `../fb-interface`.

- [ ] **Step 4: Write the shared parser**

Create `src/lib/spec-builder/fb-interface.ts`:

```ts
// src/lib/spec-builder/fb-interface.ts
// THE single SCL var parser for the whole app. Replaces the three ad-hoc regex
// parsers (fb-library parseVarsFromScl, forge-device-matcher parseInterface,
// fb-flow-diagram parseVarSections). Returns a SUPERSET of all sections so the
// flow diagram (which traces static/temp intermediates) does not regress.

export type SclVarSection = "input" | "output" | "inout" | "static" | "temp";

export interface ParsedSclVar {
  name: string;
  /** first token of the declared type (e.g. "Int" from `Int := 0`) */
  scl_type: string;
  section: SclVarSection;
  /** trailing // comment, trimmed; "" when absent */
  description: string;
}

// One declaration line: `  name : Type[ := default][ // comment]`
const DECL_RE = /^\s+(\w+)\s*:\s*([^;]+);?\s*(?:\/\/\s*(.*))?$/gm;

function pushDecls(body: string, section: SclVarSection, out: ParsedSclVar[]): void {
  DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DECL_RE.exec(body)) !== null) {
    const rawType = m[2].trim();
    const scl_type = rawType.match(/^["']?[\w.]+["']?/)?.[0] ?? rawType;
    out.push({ name: m[1], scl_type, section, description: m[3]?.trim() ?? "" });
  }
}

/** Parse every VAR section of an SCL block. Superset: input/output/inout/static/temp. */
export function parseFbInterface(scl: string): ParsedSclVar[] {
  const out: ParsedSclVar[] = [];

  // Typed sections: VAR_INPUT / VAR_OUTPUT / VAR_IN_OUT / VAR_TEMP
  const typedRe = /VAR_(INPUT|OUTPUT|IN_OUT|TEMP)\b([\s\S]*?)END_VAR/gi;
  let block: RegExpExecArray | null;
  while ((block = typedRe.exec(scl)) !== null) {
    const tag = block[1].toUpperCase();
    const section: SclVarSection =
      tag === "INPUT" ? "input" : tag === "OUTPUT" ? "output" : tag === "IN_OUT" ? "inout" : "temp";
    pushDecls(block[2], section, out);
  }

  // Plain VAR (static) — the `(?!\s*_)` guard avoids re-matching VAR_INPUT etc.
  const staticRe = /\bVAR\b(?!\s*_)([\s\S]*?)END_VAR/gi;
  while ((block = staticRe.exec(scl)) !== null) {
    pushDecls(block[1], "static", out);
  }

  return out;
}

/** Direction-bearing pins (input/output/inout) only — the contract surface. */
export function interfacePins(vars: ParsedSclVar[]): Array<{
  name: string;
  scl_type: string;
  direction: "input" | "output" | "inout";
  description: string;
}> {
  return vars
    .filter((v) => v.section === "input" || v.section === "output" || v.section === "inout")
    .map((v) => ({ name: v.name, scl_type: v.scl_type, direction: v.section, description: v.description }));
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/spec-builder/__tests__/fb-interface.test.ts`
Expected: PASS (all 5 tests).

- [ ] **Step 6: Add the barrel export**

In `src/types/index.ts`, add next to the existing `export * from "./fb-template";`:

```ts
export * from "./fb-interface";
```

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc -b`
Expected: no errors.

```bash
git add src/types/fb-interface.ts src/lib/spec-builder/fb-interface.ts src/lib/spec-builder/__tests__/fb-interface.test.ts src/types/index.ts
git commit -m "feat(fb-library): interface contract types + shared SCL var parser"
```

---

### Task 2: Refactor the three parsers onto `parseFbInterface`

**Goal:** Delete the three duplicate regex parsers and route every call site through the shared parser, with **zero behavioural change** to matching counts or the flow diagram.

**Files:**
- Modify: `src/routes/fb-library.tsx:1497-1532` (`parseVarsFromScl`)
- Modify: `src/lib/forge-device-matcher.ts:46-70` (`parseInterface`) — **pipeline-auditor glob**
- Modify: `src/lib/fb-flow-diagram.ts:105-135` (`parseVarSections`)

**Acceptance Criteria:**
- [ ] `fb-library.tsx` `VariableTable` renders identically (Direction/Name/Type/Description) using the shared parser.
- [ ] `forge-device-matcher.ts` Bool/analog counts are unchanged for the same SCL.
- [ ] `fb-flow-diagram.ts` still receives static/temp vars (no diagram regression).
- [ ] Existing forge-device-matcher tests still pass.
- [ ] **pipeline-auditor agent run + PASS** (forge-device-matcher.ts matches `src/lib/forge-*.ts`).

**Verify:** `npx vitest run && npx tsc -b` → all green, then run `.claude/agents/pipeline-auditor.md` audit → PASS.

**Steps:**

- [ ] **Step 1: Refactor `forge-device-matcher.ts`**

Replace the `parseInterface` function body (lines 46-70) so counts derive from the shared parser. Keep the `FbInterface` shape and `ANALOG_TYPES` regex. Add the import at the top of the file:

```ts
import { parseFbInterface } from "@/lib/spec-builder/fb-interface";
```

Replace `parseInterface`:

```ts
function parseInterface(scl: string): FbInterface {
  let boolInputs = 0, boolOutputs = 0, analogInputs = 0, analogOutputs = 0;
  for (const v of parseFbInterface(scl)) {
    if (v.section !== "input" && v.section !== "output") continue;
    const type = v.scl_type.toLowerCase();
    if (type === "bool") {
      if (v.section === "input") boolInputs++; else boolOutputs++;
    } else if (ANALOG_TYPES.test(type)) {
      if (v.section === "input") analogInputs++; else analogOutputs++;
    }
  }
  return { boolInputs, boolOutputs, analogInputs, analogOutputs };
}
```

- [ ] **Step 2: Run matcher tests to confirm no regression**

Run: `npx vitest run src/lib/__tests__/forge-device-matcher.test.ts`
Expected: PASS (if this test file exists; if not, run `npx vitest run` and confirm no matcher-related failures).

- [ ] **Step 3: Refactor `fb-flow-diagram.ts`**

Add the import at the top:

```ts
import { parseFbInterface } from "@/lib/spec-builder/fb-interface";
```

Replace `parseVarSections` (lines 105-135) — map the shared parser's section to the local `VarKind`, dropping `inout` (the diagram never used it):

```ts
function parseVarSections(scl: string): VarDecl[] {
  const decls: VarDecl[] = [];
  for (const v of parseFbInterface(scl)) {
    if (v.section === "inout") continue; // flow diagram never traced inout
    const kind: VarKind =
      v.section === "input" ? "input"
      : v.section === "output" ? "output"
      : v.section === "temp" ? "temp"
      : "static";
    decls.push({ name: v.name, type: v.scl_type, kind });
  }
  return decls;
}
```

- [ ] **Step 4: Refactor `fb-library.tsx`**

Add the import near the other `@/lib` imports:

```ts
import { parseFbInterface } from "@/lib/spec-builder/fb-interface";
```

Replace `parseVarsFromScl` (lines 1497-1532) with a thin adapter that maps the shared parser's section to the display labels `VariableTable` groups on (`INPUT`/`OUTPUT`/`IN OUT`/`STATIC`/`TEMP`):

```ts
const SECTION_LABEL: Record<string, string> = {
  input: "INPUT", output: "OUTPUT", inout: "IN OUT", static: "STATIC", temp: "TEMP",
};

function parseVarsFromScl(scl: string): ParsedVar[] {
  return parseFbInterface(scl).map((v) => ({
    name: v.name,
    type: v.scl_type,
    section: SECTION_LABEL[v.section] ?? v.section.toUpperCase(),
    comment: v.description,
  }));
}
```

Leave the `ParsedVar` interface, `SECTION_COLORS`, and `VariableTable` unchanged.

- [ ] **Step 5: Full verification**

Run: `npx vitest run && npx tsc -b`
Expected: all tests green, no type errors.

- [ ] **Step 6: Run the pipeline-auditor (MANDATORY — forge-device-matcher.ts changed)**

Read `.claude/agents/pipeline-auditor.md` and execute the audit against the current codebase. Report findings. Do NOT proceed if it FAILs — fix violations first.

- [ ] **Step 7: Commit**

```bash
git add src/lib/forge-device-matcher.ts src/lib/fb-flow-diagram.ts src/routes/fb-library.tsx
git commit -m "refactor(fb-library): unify 3 SCL var parsers onto parseFbInterface"
```

---

### Task 3: Migration + `FbTemplate.interface_contract` field

**Goal:** Add the nullable JSONB column and surface it on the `FbTemplate` type without leaking it into the create/update form.

**Files:**
- Create: `supabase/migrations/20260624000000_fb_template_interface_contract.sql`
- Modify: `src/types/fb-template.ts` (add field + extend Create Omit list)

**Acceptance Criteria:**
- [ ] Migration adds nullable `interface_contract JSONB` to `fb_templates`.
- [ ] `FbTemplate` gains `interface_contract: FbInterfaceContract | null`.
- [ ] `"interface_contract"` is in the `FbTemplateCreate` Omit list (managed by dedicated mutations, like `ai_summary`).
- [ ] `npx tsc -b` passes.

**Verify:** `npx tsc -b` → no errors. (Migration applied by the user via `npx supabase db push` when deploying — do not run it here.)

**Steps:**

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260624000000_fb_template_interface_contract.sql`:

```sql
-- FB interface contract — structured, human-reviewed pin descriptor per template.
-- Nullable: legacy templates have no contract until authored. Inherits fb_templates RLS.

ALTER TABLE fb_templates
  ADD COLUMN interface_contract JSONB;

COMMENT ON COLUMN fb_templates.interface_contract IS
  'FbInterfaceContract: role-tagged pins + binding hints + reviewed flag. Authored in the FB Library; consumed by Phase 3.5 Device FB Binding.';
```

- [ ] **Step 2: Add the type field**

In `src/types/fb-template.ts`, add the import at the top:

```ts
import type { FbInterfaceContract } from "@/types/fb-interface";
```

Add the field to the `FbTemplate` interface (after `hmi_faceplate_type` on line 62):

```ts
  /** Structured interface contract (role-tagged pins). Null until authored. */
  interface_contract: FbInterfaceContract | null;
```

- [ ] **Step 3: Keep it out of the create/update form**

In the `FbTemplateCreate` Omit list (line 70), add `"interface_contract"` to the omitted keys (alongside `"ai_summary"`):

```ts
export type FbTemplateCreate = Omit<FbTemplate, "id" | "created_at" | "updated_at" | "created_by" | "blocks" | "profile_ids" | "version" | "ai_summary" | "interface_contract" | "diagram_chart" | "diagram_generated_at" | "flow_diagram_json" | "flow_diagram_generated_at" | "source" | "library_name" | "is_enabled" | "is_equipment_module" | "documentation" | "hmi_faceplate_type"> & {
```

- [ ] **Step 4: Typecheck + commit**

Run: `npx tsc -b`
Expected: no errors.

```bash
git add supabase/migrations/20260624000000_fb_template_interface_contract.sql src/types/fb-template.ts
git commit -m "feat(fb-library): interface_contract JSONB column + FbTemplate field"
```

---

### Task 4: AI extraction hook (`use-generate-fb-interface.ts`)

**Goal:** Generate the semantic layer (role/binding/exposed/block_name) with AI, merge it onto the SCL-authoritative pin list via a pure, unit-tested function, and persist with `reviewed: false`.

**Files:**
- Create: `src/hooks/use-generate-fb-interface.ts`
- Create: `src/hooks/__tests__/use-generate-fb-interface.test.ts`

**Acceptance Criteria:**
- [ ] Pure `buildContractFromAi(parsedPins, aiAnnotations, blockName)` returns a complete `FbInterfaceContract` with `reviewed: false`.
- [ ] SCL pins are authoritative: AI annotations for unknown pins are ignored; missing annotations default safely.
- [ ] `useGenerateFbInterface()` returns `{ generate, loadingId }`, mirroring `useGenerateFbSummary`.
- [ ] Persists to the `interface_contract` column and invalidates `["fb-templates"]`.
- [ ] Generic: the prompt classifies by abstract role/source, never by device name.
- [ ] Test passes: `npx vitest run src/hooks/__tests__/use-generate-fb-interface.test.ts`.

**Verify:** `npx vitest run src/hooks/__tests__/use-generate-fb-interface.test.ts && npx tsc -b` → green.

**Steps:**

- [ ] **Step 1: Write the failing merge test**

Create `src/hooks/__tests__/use-generate-fb-interface.test.ts`:

```ts
// src/hooks/__tests__/use-generate-fb-interface.test.ts
import { describe, it, expect } from "vitest";
import { buildContractFromAi } from "../use-generate-fb-interface";
import type { ParsedSclVar } from "@/lib/spec-builder/fb-interface";

const parsed: ParsedSclVar[] = [
  { name: "Run", scl_type: "Bool", section: "input", description: "start" },
  { name: "Fault", scl_type: "Bool", section: "output", description: "" },
  { name: "iState", scl_type: "Int", section: "static", description: "" }, // not a pin
];

describe("buildContractFromAi", () => {
  it("uses SCL pins as authoritative and applies AI annotations", () => {
    const c = buildContractFromAi(
      parsed,
      [
        { name: "Run", role: "cmd", default_binding: "hmi", exposed: false },
        { name: "Fault", role: "fault", default_binding: "io_output", exposed: true },
        { name: "Ghost", role: "status", default_binding: "hmi", exposed: true }, // AI-invented → ignored
      ],
      "CM_Motor",
    );
    expect(c.block_name).toBe("CM_Motor");
    expect(c.reviewed).toBe(false);
    expect(c.pins.map((p) => p.name)).toEqual(["Run", "Fault"]); // no static, no Ghost
    expect(c.pins[0]).toMatchObject({ role: "cmd", default_binding: "hmi", direction: "input" });
    expect(c.pins[1]).toMatchObject({ role: "fault", default_binding: "io_output", exposed: true });
  });

  it("defaults annotations when AI omits a pin", () => {
    const c = buildContractFromAi(parsed, [], "CM_Motor");
    // input defaults to sensor_in/io_input, output to status/io_output
    expect(c.pins[0]).toMatchObject({ name: "Run", role: "sensor_in", default_binding: "io_input", exposed: false });
    expect(c.pins[1]).toMatchObject({ name: "Fault", role: "status", default_binding: "io_output", exposed: false });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/hooks/__tests__/use-generate-fb-interface.test.ts`
Expected: FAIL — cannot resolve `../use-generate-fb-interface`.

- [ ] **Step 3: Write the hook + pure merge function**

Create `src/hooks/use-generate-fb-interface.ts`:

```ts
// src/hooks/use-generate-fb-interface.ts
// AI pre-fill of an FB interface contract's SEMANTIC layer. The SCL parser is
// authoritative for which pins exist; AI only annotates role/binding/exposed.
// Mirrors use-generate-fb-summary.ts (callNonStreaming + raw-column update).
import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callNonStreaming } from "@/hooks/use-generation";
import { supabase } from "@/lib/supabase";
import {
  parseFbInterface, interfacePins, type ParsedSclVar,
} from "@/lib/spec-builder/fb-interface";
import {
  FB_PIN_ROLES, FB_BINDING_SOURCES,
  type FbInterfaceContract, type FbInterfacePin, type FbPinRole, type FbBindingSource,
} from "@/types/fb-interface";
import type { FbTemplate } from "@/types/fb-template";

/** The semantic annotation the AI returns per pin. */
export interface AiPinAnnotation {
  name: string;
  role: FbPinRole;
  default_binding: FbBindingSource;
  exposed: boolean;
}

const ROLE_SET = new Set<string>(FB_PIN_ROLES);
const BINDING_SET = new Set<string>(FB_BINDING_SOURCES);

function defaultRole(direction: FbInterfacePin["direction"]): FbPinRole {
  return direction === "output" ? "status" : "sensor_in";
}
function defaultBinding(direction: FbInterfacePin["direction"]): FbBindingSource {
  return direction === "output" ? "io_output" : "io_input";
}

/**
 * Merge the SCL-authoritative pin list with AI annotations.
 * Pure + exported for unit testing. SCL pins win: AI-invented pins are dropped,
 * missing/invalid annotations fall back to direction-based defaults.
 */
export function buildContractFromAi(
  parsed: ParsedSclVar[],
  ai: AiPinAnnotation[],
  blockName: string,
): FbInterfaceContract {
  const byName = new Map(ai.map((a) => [a.name, a]));
  const pins: FbInterfacePin[] = interfacePins(parsed).map((p) => {
    const a = byName.get(p.name);
    const role = a && ROLE_SET.has(a.role) ? a.role : defaultRole(p.direction);
    const default_binding = a && BINDING_SET.has(a.default_binding) ? a.default_binding : defaultBinding(p.direction);
    return {
      name: p.name,
      scl_type: p.scl_type,
      direction: p.direction,
      role,
      default_binding,
      exposed: a?.exposed ?? false,
      description: p.description,
    };
  });
  return { block_name: blockName, pins, reviewed: false, generated_at: new Date().toISOString() };
}

const SYSTEM_PROMPT = `You classify the interface pins of a Siemens TIA Portal Function Block for an industrial automation contract. You are GENERIC across all machine types — never reference a specific device, project, or signal name in your reasoning.

For EACH pin you are given (name, type, direction, comment), assign:
- role: one of cmd | mode | param | interlock | sensor_in | actuator_out | status | fault
- default_binding: one of io_input | io_output | fb_output | hmi | em | param
- exposed: boolean — true if this OUTPUT is a meaningful signal another block/sequence would consume (e.g. "running", "fault", "at-position"); false for internal/diagnostic outputs and for all inputs.

Guidance (abstract, not device-specific):
- Command/start/stop/forward/reverse inputs → role cmd, binding hmi or em.
- Mode/auto/manual selection inputs → role mode, binding hmi.
- Setpoint/time/limit configuration inputs → role param, binding param.
- Permissive/enable/interlock inputs → role interlock, binding em.
- Feedback inputs (sensor/limit/position/measured) → role sensor_in, binding io_input.
- Physical actuation outputs (run/open/close/energize) → role actuator_out, binding io_output, exposed true.
- Ready/running/done/position outputs → role status, exposed true.
- Fault/alarm/error outputs → role fault, exposed true.

Return ONLY a JSON array, no prose:
[{ "name": "...", "role": "...", "default_binding": "...", "exposed": true }]`;

/** Pick the main FB block (first FB, else first block). */
function mainBlock(template: FbTemplate): { block_name: string; scl_code: string } | null {
  const fb = template.blocks?.find((b) => b.block_type === "FB") ?? template.blocks?.[0];
  return fb?.scl_code ? { block_name: fb.block_name, scl_code: fb.scl_code } : null;
}

function parseAiArray(content: string): AiPinAnnotation[] {
  const match = content.match(/\[[\s\S]*\]/);
  if (!match) return [];
  try {
    const arr = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is AiPinAnnotation =>
      !!x && typeof (x as AiPinAnnotation).name === "string");
  } catch {
    return [];
  }
}

/** Generate a contract for a template. Standalone — callable from import or hooks. */
export async function generateFbInterfaceContract(
  template: FbTemplate, signal?: AbortSignal,
): Promise<FbInterfaceContract | null> {
  const block = mainBlock(template);
  if (!block) return null;
  const parsed = parseFbInterface(block.scl_code);
  const pins = interfacePins(parsed);
  if (pins.length === 0) return null;

  const abort = signal ?? new AbortController().signal;
  const userContent = `FB block: ${block.block_name}\nPins:\n${pins
    .map((p) => `- ${p.name} (${p.scl_type}, ${p.direction})${p.description ? ` // ${p.description}` : ""}`)
    .join("\n")}`;

  const { content } = await callNonStreaming(SYSTEM_PROMPT, [{ role: "user", content: userContent }], abort, 2048);
  return buildContractFromAi(parsed, parseAiArray(content), block.block_name);
}

export function useGenerateFbInterface() {
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const generate = useCallback(
    async (template: FbTemplate): Promise<FbInterfaceContract | null> => {
      setLoadingId(template.id);
      try {
        const contract = await generateFbInterfaceContract(template);
        if (!contract) {
          console.warn(`[fb-interface] No pins to extract for "${template.name}"`);
          return null;
        }
        const { error } = await supabase
          .from("fb_templates")
          .update({ interface_contract: contract })
          .eq("id", template.id);
        if (error) throw error;
        queryClient.invalidateQueries({ queryKey: ["fb-templates"] });
        return contract;
      } catch (err) {
        console.error(`[fb-interface] Generation failed for "${template.name}":`, err);
        return null;
      } finally {
        setLoadingId(null);
      }
    },
    [queryClient],
  );

  return { generate, loadingId };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/hooks/__tests__/use-generate-fb-interface.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc -b`
Expected: no errors.

```bash
git add src/hooks/use-generate-fb-interface.ts src/hooks/__tests__/use-generate-fb-interface.test.ts
git commit -m "feat(fb-library): AI interface-contract extraction hook + merge"
```

---

### Task 5: FB Library editable interface grid + save mutation

**Goal:** Surface the contract in the FB Library as an editable grid (Role/Binding dropdowns + Expose checkbox), with a "needs review" badge, a Generate button, and a Save that sets `reviewed: true`.

**Files:**
- Create: `src/components/fb-library/fb-interface-grid.tsx`
- Create: `src/components/fb-library/__tests__/fb-interface-grid.test.tsx`
- Create: `src/hooks/use-save-fb-interface.ts`
- Modify: `src/routes/fb-library.tsx` (replace `<VariableTable>` usages at lines 1223, 1434)

**Acceptance Criteria:**
- [ ] Grid lists each input/output/inout pin with editable Role, Binding, Expose.
- [ ] A "Needs review" badge shows while `reviewed === false` (or no contract yet).
- [ ] "Generate" calls `useGenerateFbInterface`; "Save" persists with `reviewed: true`.
- [ ] When a template has no contract, the grid seeds from `parseFbInterface` so it's editable before first AI run.
- [ ] Component smoke test passes.

**Verify:** `npx vitest run src/components/fb-library/__tests__/fb-interface-grid.test.tsx && npx tsc -b` → green.

**Steps:**

- [ ] **Step 1: Write the save mutation hook**

Create `src/hooks/use-save-fb-interface.ts`:

```ts
// src/hooks/use-save-fb-interface.ts
// Dedicated raw-column save for a reviewed interface contract (mirrors how
// ai_summary is saved). NOT the version-snapshot path — contract history is YAGNI.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { FbInterfaceContract } from "@/types/fb-interface";

export function useSaveFbInterface() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ templateId, contract }: { templateId: string; contract: FbInterfaceContract }) => {
      const { error } = await supabase
        .from("fb_templates")
        .update({ interface_contract: { ...contract, reviewed: true } })
        .eq("id", templateId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["fb-templates"] }),
  });
}
```

- [ ] **Step 2: Write the failing component smoke test**

Create `src/components/fb-library/__tests__/fb-interface-grid.test.tsx`:

```tsx
// src/components/fb-library/__tests__/fb-interface-grid.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { FbInterfaceGrid } from "../fb-interface-grid";
import type { FbTemplate } from "@/types/fb-template";

vi.mock("@/lib/supabase", () => ({ supabase: { from: () => ({ update: () => ({ eq: () => ({ error: null }) }) }) } }));

const template = {
  id: "t1", name: "Motor", blocks: [
    { id: "b1", template_id: "t1", block_name: "CM_Motor", block_type: "FB",
      scl_code: "FUNCTION_BLOCK\nVAR_INPUT\n Run : Bool; // start\nEND_VAR\nVAR_OUTPUT\n Fault : Bool;\nEND_VAR\nBEGIN\nEND_FUNCTION_BLOCK",
      block_xml: null, programming_language: "SCL", sort_order: 0, created_at: "" },
  ],
  interface_contract: null,
} as unknown as FbTemplate;

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe("FbInterfaceGrid", () => {
  it("seeds rows from SCL and shows the needs-review badge when no contract", () => {
    wrap(<FbInterfaceGrid template={template} />);
    expect(screen.getByText("Run")).toBeInTheDocument();
    expect(screen.getByText("Fault")).toBeInTheDocument();
    expect(screen.getByText(/needs review/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/components/fb-library/__tests__/fb-interface-grid.test.tsx`
Expected: FAIL — cannot resolve `../fb-interface-grid`.

- [ ] **Step 4: Write the grid component**

Create `src/components/fb-library/fb-interface-grid.tsx`:

```tsx
// src/components/fb-library/fb-interface-grid.tsx
// Editable interface-contract grid for the FB Library. Seeds from the SCL parser
// when no contract exists; edits role/binding/exposed; Save sets reviewed:true.
import { useEffect, useState } from "react";
import { Sparkles, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { parseFbInterface, interfacePins } from "@/lib/spec-builder/fb-interface";
import {
  FB_PIN_ROLES, FB_BINDING_SOURCES,
  type FbInterfaceContract, type FbInterfacePin, type FbPinRole, type FbBindingSource,
} from "@/types/fb-interface";
import { useGenerateFbInterface } from "@/hooks/use-generate-fb-interface";
import { useSaveFbInterface } from "@/hooks/use-save-fb-interface";
import type { FbTemplate } from "@/types/fb-template";

function mainBlock(t: FbTemplate) {
  return t.blocks?.find((b) => b.block_type === "FB") ?? t.blocks?.[0];
}

/** Seed pins from SCL when the template has no contract yet. */
function seedPins(t: FbTemplate): FbInterfacePin[] {
  const block = mainBlock(t);
  if (!block?.scl_code) return [];
  return interfacePins(parseFbInterface(block.scl_code)).map((p) => ({
    name: p.name, scl_type: p.scl_type, direction: p.direction,
    role: (p.direction === "output" ? "status" : "sensor_in") as FbPinRole,
    default_binding: (p.direction === "output" ? "io_output" : "io_input") as FbBindingSource,
    exposed: false, description: p.description,
  }));
}

export function FbInterfaceGrid({ template }: { template: FbTemplate }) {
  const { generate, loadingId } = useGenerateFbInterface();
  const save = useSaveFbInterface();

  const initial = template.interface_contract?.pins ?? seedPins(template);
  const [pins, setPins] = useState<FbInterfacePin[]>(initial);
  const blockName = template.interface_contract?.block_name ?? mainBlock(template)?.block_name ?? template.name;
  const reviewed = template.interface_contract?.reviewed ?? false;

  // Re-seed when the persisted contract changes (after Generate/Save invalidation).
  const persistedKey = JSON.stringify(template.interface_contract?.pins ?? null);
  useEffect(() => {
    setPins(template.interface_contract?.pins ?? seedPins(template));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistedKey]);

  function update(i: number, patch: Partial<FbInterfacePin>) {
    setPins((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  }

  function handleSave() {
    const contract: FbInterfaceContract = {
      block_name: blockName, pins, reviewed: true,
      generated_at: template.interface_contract?.generated_at ?? new Date().toISOString(),
    };
    save.mutate({ templateId: template.id, contract });
  }

  if (pins.length === 0) return null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] uppercase text-muted-foreground">Interface Contract</span>
          {!reviewed && <Badge variant="outline" className="text-amber-600 border-amber-400/50">Needs review</Badge>}
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => generate(template)} disabled={loadingId === template.id}>
            {loadingId === template.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            <span className="ml-1">Generate</span>
          </Button>
          <Button size="sm" variant="ghost" onClick={handleSave} disabled={save.isPending}>
            <Save className="h-3.5 w-3.5" /><span className="ml-1">Save</span>
          </Button>
        </div>
      </div>

      <div className="rounded border border-border/40 overflow-hidden">
        <table className="w-full text-[11px]">
          <thead>
            <tr className="border-b border-border/30 bg-muted/30">
              {["Dir", "Name", "Type", "Role", "Binding", "Expose", "Description"].map((h) => (
                <th key={h} className="px-2 py-1 text-left font-mono text-[10px] uppercase text-muted-foreground">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pins.map((p, i) => (
              <tr key={`${p.name}-${i}`} className="border-b border-border/10 hover:bg-muted/20">
                <td className="px-2 py-0.5 font-mono text-muted-foreground">{p.direction}</td>
                <td className="px-2 py-0.5 font-mono text-foreground">{p.name}</td>
                <td className="px-2 py-0.5 font-mono text-muted-foreground">{p.scl_type}</td>
                <td className="px-2 py-0.5">
                  <select className="bg-transparent font-mono text-[11px]" value={p.role}
                    onChange={(e) => update(i, { role: e.target.value as FbPinRole })}>
                    {FB_PIN_ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-2 py-0.5">
                  <select className="bg-transparent font-mono text-[11px]" value={p.default_binding}
                    onChange={(e) => update(i, { default_binding: e.target.value as FbBindingSource })}>
                    {FB_BINDING_SOURCES.map((b) => <option key={b} value={b}>{b}</option>)}
                  </select>
                </td>
                <td className="px-2 py-0.5">
                  <input type="checkbox" checked={p.exposed}
                    onChange={(e) => update(i, { exposed: e.target.checked })} />
                </td>
                <td className="px-2 py-0.5 text-muted-foreground">{p.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run the smoke test to verify it passes**

Run: `npx vitest run src/components/fb-library/__tests__/fb-interface-grid.test.tsx`
Expected: PASS.

- [ ] **Step 6: Wire the grid into the FB Library page**

In `src/routes/fb-library.tsx`, add the import near the top:

```ts
import { FbInterfaceGrid } from "@/components/fb-library/fb-interface-grid";
```

At the detail/preview render site (the `<VariableTable blocks={blocks} />` usage around line 1434, which renders for a saved `template`), render the editable grid alongside the read-only table. Replace that `<VariableTable .../>` usage with:

```tsx
<FbInterfaceGrid template={template} />
```

Leave the create/edit-form usage at line ~1223 as the read-only `<VariableTable blocks={form.blocks} />` (there is no saved template id to attach a contract to during creation). Confirm the exact variable in scope at each call site before editing — the detail view has a `template: FbTemplate`, the form view has `form.blocks` only.

- [ ] **Step 7: Full verification**

Run: `npx vitest run && npx tsc -b`
Expected: all tests green, no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/fb-library/fb-interface-grid.tsx src/components/fb-library/__tests__/fb-interface-grid.test.tsx src/hooks/use-save-fb-interface.ts src/routes/fb-library.tsx
git commit -m "feat(fb-library): editable interface-contract grid + reviewed gate"
```

---

## Definition of done

- [ ] All five tasks committed; `npx vitest run` and `npx tsc -b` green.
- [ ] pipeline-auditor PASS (Task 2).
- [ ] Three duplicate parsers gone — one shared `parseFbInterface`.
- [ ] `fb_templates.interface_contract` migration present; `FbTemplate` typed.
- [ ] AI extraction + editable grid author a `reviewed` contract end-to-end.
- [ ] `fb-instantiate.ts` untouched — Code Builder consumption deferred to Phase 3.5 (per spec).
- [ ] Everything generic across machine types — no project-specific names anywhere.
