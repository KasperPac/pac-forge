# Assembly FB Library — Phase 5 + 5.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers-extended-cc:subagent-driven-development (recommended) or superpowers-extended-cc:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the contract-as-universal-unit hybrid architecture in the spec-builder Co-Author wizard. Library-bound assemblies pre-fill contract from template; custom assemblies have engineer-authored contracts that drive AI-against-contract SCL generation. One-click "save as library template" for promotion.

**Architecture:** Contract is the universal authoring artifact — every assembly carries one regardless of origin. Library path copies template SCL into the assembly. Custom path runs AI-against-contract generation with structural drift detection and a 2-retry feedback loop. Both produce an `AssemblyConfig` with `interface_contract`, `instance_params`, and `generated_scl_blocks` populated; downstream forge generation, SFC orchestration, and Pac-Audit consume the contract origin-blindly.

**Tech Stack:** React 19 + Vite 7 + TypeScript 5.9, Supabase (Postgres + Edge Functions), TanStack Query for server state, Zustand for UI state, shadcn/ui + Tailwind v3, Monaco Editor for SCL panes. No test runner is configured in this project — every task verifies via `npm run build` (TypeScript + Vite production build), `npm run lint`, and manual wizard-flow testing in `npm run dev`. Pure functions verify by being called from a fixture call site that's exercised by the integration test path. Per CLAUDE.md, all changes must be generic across machine types — no project-specific (PILOT-001) names in prompts, validators, or UI strings.

**Spec reference:** `Docs/superpowers/specs/2026-05-04-assembly-fb-library-hybrid-design.md`

**Out of scope (do not extend the plan to cover these):**
- Phase 6 — Subsystem SFC editor (separate workstream; Task 1 below sketches the boundary it consumes)
- Phase 7 — Forge wire-through (the existing forge step at `src/components/forge/steps/forge-assembly-fb.tsx` already consumes the contract once Task 4 lands; full Phase 7 verification is its own plan)
- Phase 8 (killed — folded into Phase 5 stretch)
- Phase 9 — Versioning / upgrade UI
- Phase 10 — PILOT-001 re-run (acceptance test, run after this plan ships)
- Variant-layer composition (deferred to v2)
- Pac-Audit R09b rule update (separate audit workstream)
- Test-runner setup (project convention is no tests; do not add Vitest)

---

## File Structure

**New files (8):**
- `supabase/migrations/076_assembly_custom_scl.sql` — adds `generated_scl_blocks jsonb` to `fds_assembly_sessions`
- `src/types/sfc-call-shape.ts` — boundary-spec types Phase 6 will consume
- `src/lib/forge-assembly-contract-prompt.ts` — `buildContractConstraintBlock(contract)` pure function
- `src/lib/fb-library/contract-drift.ts` — `compareToContract(parsedInterface, contract): DriftReport` pure function
- `src/lib/fb-library/contract-skeletons.ts` — 5 hardcoded starter contract shapes
- `src/components/spec-builder/co-author-assembly-contract.tsx` — contract editor + Generate button + Monaco SCL pane + drift indicator (used by both library and custom paths)
- `src/components/spec-builder/promote-to-library-dialog.tsx` — modal for "Save as library template"
- `src/hooks/use-promote-to-library.ts` — TanStack Query mutation that mints a new `fb_template` row from a custom assembly's contract+SCL

**Modified files (5):**
- `src/types/fb-interface-contract.ts` — add `custom:<name>` escape-hatch parsing helpers + role-enum unions adjusted to allow strings (closed enum stays the recommendation, escape hatch is opt-in per role value)
- `src/components/fb-library/interface-contract-editor.tsx` — accept custom role values from the editor (add "Add custom role…" affordance per role dropdown)
- `src/lib/forge-prompts.ts` — call `buildContractConstraintBlock` from `buildAssemblySclPrompt` when the assembly has a populated contract
- `src/hooks/use-forge-assembly-generate.ts` — accept contract as input to `generateSingle`, run drift detection on AI output, retry up to 2 times with drift feedback, surface remaining drift in returned `ForgeArtifact[]` shape via a new optional `drift?: DriftReport` field
- `src/components/spec-builder/fds-co-author.tsx` — embed `co-author-assembly-contract.tsx` inline for each assembly in the existing assembly stage flow; add `process_intent` textarea per assembly

**Migrations:**
- `076_assembly_custom_scl.sql` — `generated_scl_blocks jsonb NOT NULL DEFAULT '[]'` on `fds_assembly_sessions`

---

### Task 0: Migration 076 + AssemblyConfig type extension

**Goal:** Persist generated SCL blocks alongside the contract on each assembly session, so custom-path SCL survives wizard reloads, drives the forge step, and is available when promoting to library.

**Files:**
- Create: `supabase/migrations/076_assembly_custom_scl.sql`
- Modify: `src/types/spec-builder.ts` — extend `AssemblyConfig` with `generated_scl_blocks`
- Modify: `src/types/spec-contract-v2.ts` — extend `AssemblyV2Schema` with the same field

**Acceptance Criteria:**
- [ ] Migration applies cleanly to local Supabase (`npx supabase db push --local` succeeds)
- [ ] `AssemblyConfig.generated_scl_blocks` is typed as `Array<{ block_name: string; block_type: "FB" | "FC" | "DB" | "UDT"; scl_code: string; sort_order: number }>`
- [ ] Existing `useAssemblyConfig` consumers still type-check after the field addition (default `[]`)
- [ ] `AssemblyV2Schema` mirrors the same field shape (Zod schema + TS type stay aligned)

**Verify:**
```bash
npx supabase db push --local
npm run build
```
Expected: migration applies, `tsc -b` reports zero new errors.

**Steps:**

- [ ] **Step 1: Create migration file**

```sql
-- supabase/migrations/076_assembly_custom_scl.sql
-- Phase 5 of assembly FB library: persist generated SCL blocks alongside
-- the interface_contract on each assembly session, so custom-path AI
-- generation can be reviewed in the wizard, survives reload, drives the
-- forge step, and feeds the Promote-to-library workflow.

ALTER TABLE fds_assembly_sessions
  ADD COLUMN generated_scl_blocks jsonb NOT NULL DEFAULT '[]';

COMMENT ON COLUMN fds_assembly_sessions.generated_scl_blocks IS
  'Array of {block_name, block_type, scl_code, sort_order} entries produced by AI-against-contract generation in the spec wizard. Empty for library-bound assemblies (SCL comes from fb_templates.blocks at forge time). Empty for custom assemblies before the engineer clicks Generate SCL.';
```

- [ ] **Step 2: Apply locally and confirm**

Run: `npx supabase db push --local`
Expected: `Applying migration 076_assembly_custom_scl.sql...` followed by no errors.

- [ ] **Step 3: Extend `AssemblyConfig` type**

Open `src/types/spec-builder.ts`, locate the `AssemblyConfig` interface. Add the field, defaulting to empty array on read, exactly mirroring how `instance_params` was added in migration 075:

```ts
export interface AssemblyGeneratedSclBlock {
  block_name: string;
  block_type: "FB" | "FC" | "DB" | "UDT";
  scl_code: string;
  sort_order: number;
}

export interface AssemblyConfig {
  // ... existing fields ...
  generated_scl_blocks: AssemblyGeneratedSclBlock[];
}
```

- [ ] **Step 4: Mirror in `AssemblyV2Schema`**

Open `src/types/spec-contract-v2.ts`. Find the `AssemblyV2Schema` Zod schema (added in migration 075's type pass). Add:

```ts
const AssemblyGeneratedSclBlockSchema = z.object({
  block_name: z.string(),
  block_type: z.enum(["FB", "FC", "DB", "UDT"]),
  scl_code: z.string(),
  sort_order: z.number().int(),
});

// inside AssemblyV2Schema:
generated_scl_blocks: z.array(AssemblyGeneratedSclBlockSchema).default([]),
```

- [ ] **Step 5: Update read sites that materialise `AssemblyConfig` from DB rows**

Search for `instance_params` initialisation in `src/hooks/use-fds-session.ts` (or wherever assembly session rows are mapped to `AssemblyConfig`). Add the same pattern for `generated_scl_blocks`:

```ts
// Existing:
instance_params: row.instance_params ?? {},
// Add:
generated_scl_blocks: Array.isArray(row.generated_scl_blocks) ? row.generated_scl_blocks : [],
```

- [ ] **Step 6: Verify**

Run: `npm run build && npm run lint`
Expected: zero new errors.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/076_assembly_custom_scl.sql src/types/spec-builder.ts src/types/spec-contract-v2.ts src/hooks/use-fds-session.ts
git commit -m "feat(assembly-fb): migration 076 — persist generated SCL on custom assemblies

Adds generated_scl_blocks jsonb to fds_assembly_sessions so AI-against-
contract output survives wizard reload, drives the forge step, and feeds
Promote-to-library. AssemblyConfig + AssemblyV2Schema extended to match.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1: Pre-flight — SFC call shape sketch

**Goal:** Define the typed boundary that Phase 6 (subsystem SFC editor) will consume from the assembly contract. No implementation — just types. Ensures contract design in this phase doesn't need rework when Phase 6 starts.

**Files:**
- Create: `src/types/sfc-call-shape.ts`

**Acceptance Criteria:**
- [ ] File defines `AssemblySfcCallSpec` and `AssemblyCallSite` types with JSDoc explaining each field
- [ ] Doc comment at top references `Docs/superpowers/specs/2026-05-04-assembly-fb-library-hybrid-design.md` §4.1 step 1
- [ ] No imports or runtime code — pure types
- [ ] Types compile against the existing `FbInterfaceContract` shape (the `inputs[]` and `outputs[]` of an assembly's contract should map cleanly to call-site action targets and guard sources)

**Verify:**
```bash
npm run build
```
Expected: zero new errors.

**Steps:**

- [ ] **Step 1: Create the types file**

```ts
// src/types/sfc-call-shape.ts
/**
 * Boundary types describing how the subsystem SFC editor (Phase 6) will
 * invoke an assembly via its interface contract. Phase 5 produces the
 * assembly + contract; Phase 6 produces the orchestration that calls them.
 * This file is the pre-flight sketch from the design doc:
 *
 *   Docs/superpowers/specs/2026-05-04-assembly-fb-library-hybrid-design.md §4.1
 *
 * No implementation here — these are the contracts Phase 6 will consume.
 * Adding them now ensures the Phase 5 contract editor surfaces the right
 * fields. If Phase 6 needs more, the contract editor needs reworking; if
 * Phase 5 over-exposes, Phase 6 will only use what it needs.
 */

import type { FbInterfaceContract } from "@/types/fb-interface-contract";

/**
 * What an SFC step needs to know about an assembly to call it.
 *
 * `inputs` becomes the universe of assignable action targets (Step actions:
 * "set CV01.AutoRun = TRUE", "trigger LFT01.CmdRaise"). `outputs` becomes
 * the universe of guard sources for transitions ("wait until LFT01.AtUpper",
 * "branch on LFT01.Faulted").
 */
export interface AssemblySfcCallSpec {
  assembly_id: string;
  assembly_tag: string;
  /**
   * Names of inputs the SFC may write to, with their data types so the
   * SFC editor can render the right action UI (boolean toggle, numeric
   * setpoint, enum picker for command_mode, etc.).
   */
  writable_inputs: Array<{
    tia_name: string;
    data_type: FbInterfaceContract["inputs"][number]["data_type"];
    role: string;
    description: string;
  }>;
  /**
   * Names of outputs the SFC may read for guard expressions and transitions.
   */
  readable_outputs: Array<{
    tia_name: string;
    data_type: FbInterfaceContract["outputs"][number]["data_type"];
    role: string;
    description: string;
  }>;
  /**
   * UDT members this assembly writes — the SFC editor highlights these
   * when authoring guard expressions so the engineer prefers
   * assembly-owned bits over raw IO reads.
   */
  process_state_writes: string[];
}

/**
 * A single SFC step's reference to an assembly call.
 * Phase 6 will materialise these inside Step / Transition AST nodes.
 */
export interface AssemblyCallSite {
  step_id: string;
  call: AssemblySfcCallSpec;
  /**
   * Action assignments — assembly input → expression evaluated at step entry.
   */
  action_assignments: Array<{
    target_input: string;
    expression: string;
  }>;
}

/**
 * Derive the call spec from a bound assembly's contract.
 * Pure projection — Phase 6 will use this at editor mount.
 */
export type DeriveSfcCallSpec = (
  assemblyId: string,
  assemblyTag: string,
  contract: FbInterfaceContract,
) => AssemblySfcCallSpec;
```

- [ ] **Step 2: Verify**

Run: `npm run build && npm run lint`
Expected: zero new errors.

- [ ] **Step 3: Commit**

```bash
git add src/types/sfc-call-shape.ts
git commit -m "feat(assembly-fb): pre-flight — SFC call shape boundary types

Phase 6 (subsystem SFC editor) will consume the assembly contract via
this typed boundary. Adding the types up-front ensures the Phase 5
contract editor surfaces what Phase 6 will need. No implementation.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Role-enum custom escape hatch

**Goal:** Allow engineers to declare project-specific role values on contract inputs/outputs/IO slots without breaking the closed enum union. Existing closed enums stay as guidance; `custom:<lowercase-name>` is the escape hatch (per spec §3 verdict #2).

**Files:**
- Modify: `src/types/fb-interface-contract.ts`
- Modify: `src/components/fb-library/interface-contract-editor.tsx` — add "Add custom role…" affordance to each role dropdown

**Acceptance Criteria:**
- [ ] `InterfaceInputRole`, `InterfaceOutputRole`, `IoSlotRole` accept either a closed-enum value OR a `custom:<name>` string where `<name>` is `[a-z][a-z0-9_]*`
- [ ] `isCustomRole(role)` and `customRoleLabel(role)` helpers exposed
- [ ] Editor dropdowns render an "Add custom role…" item that opens a tiny inline input. Submitted custom roles persist in the open contract editor session and become selectable for other rows.
- [ ] Existing seeded templates round-trip without their role values changing
- [ ] When `role.startsWith("custom:")`, the editor renders the role chip with a distinct (muted) badge color so it's visually obvious which rows used the escape hatch

**Verify:**
```bash
npm run build && npm run lint
```
Expected: zero new errors. Manual check in `npm run dev` — open FB Library editor on a seeded template, verify dropdown still works for closed enums, then add a custom role and confirm it persists in form state and is selectable on a sibling row.

**Steps:**

- [ ] **Step 1: Loosen the role union types**

Open `src/types/fb-interface-contract.ts`. Replace the closed `InterfaceInputRole` type alias with a union of the closed-enum values + a string template-literal validator:

```ts
export type CustomRoleValue = `custom:${string}`;

export type InterfaceInputRole =
  | (typeof INTERFACE_INPUT_ROLES)[number]
  | CustomRoleValue;

export type InterfaceOutputRole =
  | (typeof INTERFACE_OUTPUT_ROLES)[number]
  | CustomRoleValue;

export type IoSlotRole =
  | (typeof IO_SLOT_ROLES)[number]
  | CustomRoleValue;
```

- [ ] **Step 2: Add role helpers at the bottom of the file**

```ts
const CUSTOM_ROLE_NAME_RE = /^[a-z][a-z0-9_]*$/;

export function isCustomRole(role: string): role is CustomRoleValue {
  return role.startsWith("custom:");
}

/** Format a custom role for display: "custom:my_thing" → "My Thing (custom)" */
export function customRoleLabel(role: CustomRoleValue): string {
  const name = role.slice("custom:".length);
  const titled = name.split("_").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return `${titled} (custom)`;
}

/**
 * Validate and normalise a user-typed custom role name into a CustomRoleValue.
 * Returns null when the name is invalid (must match [a-z][a-z0-9_]*).
 */
export function buildCustomRoleValue(rawName: string): CustomRoleValue | null {
  const cleaned = rawName.trim().toLowerCase().replace(/\s+/g, "_");
  if (!CUSTOM_ROLE_NAME_RE.test(cleaned)) return null;
  return `custom:${cleaned}` as CustomRoleValue;
}
```

- [ ] **Step 3: Add the "Add custom role…" affordance to the editor dropdowns**

Open `src/components/fb-library/interface-contract-editor.tsx`. Find each `<Select>` that renders one of the role enums (there are three — one per tab). For each, append a `<SelectItem value="__add_custom__">+ Add custom role…</SelectItem>` row, plus track an `addingCustomFor: { rowKey: string; type: "input" | "output" | "io_slot" } | null` state in the component. When the engineer picks `__add_custom__`, render a small inline `<Input>` and a Confirm/Cancel button. On confirm, call `buildCustomRoleValue(input)`; if non-null, set the row's role to it and add it to a `customRolesSeen: Record<"input"|"output"|"io_slot", Set<string>>` so it shows up in the dropdown for sibling rows.

```tsx
// Inside the editor component, near other state:
const [addingCustomFor, setAddingCustomFor] = useState<
  { rowKey: string; type: "input" | "output" | "io_slot" } | null
>(null);
const [customRoleDraft, setCustomRoleDraft] = useState("");
const [customRolesSeen, setCustomRolesSeen] = useState<{
  input: Set<string>;
  output: Set<string>;
  io_slot: Set<string>;
}>({ input: new Set(), output: new Set(), io_slot: new Set() });
```

```tsx
// In the role <Select> for an input row:
<Select
  value={input.role}
  onValueChange={(v) => {
    if (v === "__add_custom__") {
      setAddingCustomFor({ rowKey: input.tia_name, type: "input" });
      setCustomRoleDraft("");
      return;
    }
    updateInput(idx, { ...input, role: v as InterfaceInputRole });
  }}
>
  <SelectTrigger>
    {isCustomRole(input.role)
      ? <Badge variant="secondary">{customRoleLabel(input.role)}</Badge>
      : <SelectValue />}
  </SelectTrigger>
  <SelectContent>
    {INTERFACE_INPUT_ROLES.map(r => (
      <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>
    ))}
    {[...customRolesSeen.input].map(r => (
      <SelectItem key={r} value={r}>{customRoleLabel(r as CustomRoleValue)}</SelectItem>
    ))}
    <SelectItem value="__add_custom__">+ Add custom role…</SelectItem>
  </SelectContent>
</Select>
{addingCustomFor?.rowKey === input.tia_name && addingCustomFor.type === "input" && (
  <div className="flex gap-2 mt-2">
    <Input
      value={customRoleDraft}
      onChange={(e) => setCustomRoleDraft(e.target.value)}
      placeholder="lowercase_with_underscores"
      autoFocus
    />
    <Button
      size="sm"
      onClick={() => {
        const v = buildCustomRoleValue(customRoleDraft);
        if (!v) {
          toast({ title: "Invalid role name", description: "Use lowercase letters, digits, underscores. Must start with a letter.", variant: "destructive" });
          return;
        }
        setCustomRolesSeen(prev => ({ ...prev, input: new Set([...prev.input, v]) }));
        updateInput(idx, { ...input, role: v });
        setAddingCustomFor(null);
        setCustomRoleDraft("");
      }}
    >
      Add
    </Button>
    <Button size="sm" variant="ghost" onClick={() => setAddingCustomFor(null)}>Cancel</Button>
  </div>
)}
```

Repeat the pattern for the output role dropdown and the IO slot role dropdown — three places total.

- [ ] **Step 4: Hydrate `customRolesSeen` on mount from the existing contract**

When the editor mounts with a contract that already contains custom roles (e.g. loaded from DB after save+reopen), populate `customRolesSeen`:

```tsx
useEffect(() => {
  const seen = { input: new Set<string>(), output: new Set<string>(), io_slot: new Set<string>() };
  contract.inputs.forEach(i => { if (isCustomRole(i.role)) seen.input.add(i.role); });
  contract.outputs.forEach(o => { if (isCustomRole(o.role)) seen.output.add(o.role); });
  contract.io_slots.forEach(s => { if (isCustomRole(s.role)) seen.io_slot.add(s.role); });
  setCustomRolesSeen(seen);
}, [contract]);
```

- [ ] **Step 5: Verify**

Run: `npm run build && npm run lint`
Then `npm run dev`, open FB Library, edit a seeded template, switch to the Inputs tab, click an input's role dropdown, pick "+ Add custom role…", type `weird_thing`, confirm. The badge should render "Weird Thing (custom)" and that role should be selectable on a different input row's dropdown.

- [ ] **Step 6: Commit**

```bash
git add src/types/fb-interface-contract.ts src/components/fb-library/interface-contract-editor.tsx
git commit -m "feat(assembly-fb): role-enum custom: escape hatch

Loosens InterfaceInputRole / InterfaceOutputRole / IoSlotRole to accept
custom:<name> values (lowercase + underscores). Editor adds 'Add custom
role…' affordance per dropdown. Closed enums stay as the recommended
choice; custom is opt-in per row.

Per Docs/superpowers/specs/2026-05-04-assembly-fb-library-hybrid-design.md §3 verdict #2.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Contract-as-constraint prompt block builder

**Goal:** Provide a pure function that renders an `FbInterfaceContract` as a structured "MUST MATCH EXACTLY" prompt fragment for injection into the assembly system prompt.

**Files:**
- Create: `src/lib/forge-assembly-contract-prompt.ts`

**Acceptance Criteria:**
- [ ] Exports `buildContractConstraintBlock(contract: FbInterfaceContract, opts?: { subsystem?: string; assemblyTag?: string }): string`
- [ ] Returns empty string when contract is unpopulated (per `isContractPopulated`)
- [ ] Substitutes `{subsystem}` and `{assembly}` tokens in `process_state_writes[]` and `process_state_reads[]` using the opts (matching the existing template substitution convention from spec §3.1 / handoff §"Locked design decisions" #5)
- [ ] Renders `custom:<name>` roles as `(custom:<name>)` inline so the AI sees the explicit marker
- [ ] Does not fail if `udt_name` is missing on a UDT-typed input (renders as `: UDT (UDT name not specified)` rather than crashing)
- [ ] Does not import from any React or hook code — pure function suitable for Node-side prompt assembly

**Verify:**
```bash
npm run build
```
Expected: zero new errors. Function is exercised end-to-end in Task 4 verification when the modified hook calls it.

**Steps:**

- [ ] **Step 1: Create the file**

```ts
// src/lib/forge-assembly-contract-prompt.ts
/**
 * Renders an FbInterfaceContract as a structural-constraint prompt fragment
 * for injection into the assembly Code Architect system prompt.
 *
 * Design ref: Docs/superpowers/specs/2026-05-04-assembly-fb-library-hybrid-design.md §5.1.
 *
 * Pure function — no React, no hooks, no IO. Suitable for both client-side
 * prompt assembly and Edge Function prompt assembly.
 */

import type { FbInterfaceContract } from "@/types/fb-interface-contract";
import { isContractPopulated, isCustomRole } from "@/types/fb-interface-contract";

export interface ContractPromptOptions {
  /** Used to substitute {subsystem} tokens in process_state_reads/writes */
  subsystem?: string;
  /** Used to substitute {assembly} tokens in process_state_reads/writes */
  assemblyTag?: string;
}

function roleLabel(role: string): string {
  if (isCustomRole(role)) return `(custom:${role.slice("custom:".length)})`;
  return `(${role})`;
}

function substituteTokens(s: string, opts: ContractPromptOptions): string {
  let out = s;
  if (opts.subsystem !== undefined) out = out.replace(/\{subsystem\}/g, opts.subsystem);
  if (opts.assemblyTag !== undefined) out = out.replace(/\{assembly\}/g, opts.assemblyTag);
  return out;
}

export function buildContractConstraintBlock(
  contract: FbInterfaceContract,
  opts: ContractPromptOptions = {},
): string {
  if (!isContractPopulated(contract)) return "";

  const parts: string[] = [];

  parts.push("## INTERFACE CONTRACT — STRUCTURAL, MUST MATCH EXACTLY");
  parts.push("");
  parts.push(
    "You MUST declare the FUNCTION_BLOCK with exactly these inputs, outputs,",
  );
  parts.push(
    "and references. You may NOT add, remove, or rename them. Internal",
  );
  parts.push("variables (timers, intermediate flags, fault-code constants) are");
  parts.push("allowed and encouraged where they make the body cleaner.");

  if (contract.inputs.length > 0) {
    parts.push("");
    parts.push("VAR_INPUT (declare with these exact names and types):");
    for (const i of contract.inputs) {
      const typeStr = i.data_type === "UDT"
        ? (i.udt_name ? `"${i.udt_name}"` : "UDT (UDT name not specified)")
        : i.data_type;
      const requiredStr = i.required ? " // REQUIRED" : "";
      parts.push(`  ${i.tia_name} : ${typeStr}    ${roleLabel(i.role)} — ${i.description}${requiredStr}`);
    }
  }

  if (contract.outputs.length > 0) {
    parts.push("");
    parts.push("VAR_OUTPUT (declare with these exact names and types):");
    for (const o of contract.outputs) {
      const typeStr = o.data_type === "UDT"
        ? (o.udt_name ? `"${o.udt_name}"` : "UDT (UDT name not specified)")
        : o.data_type;
      parts.push(`  ${o.tia_name} : ${typeStr}    ${roleLabel(o.role)} — ${o.description}`);
    }
  }

  if (contract.io_slots.length > 0) {
    parts.push("");
    parts.push("IO BINDINGS (must be referenced via instance params, not hardcoded):");
    for (const s of contract.io_slots) {
      parts.push(`  ${s.slot_name} : ${s.signal_type}    ${roleLabel(s.role)} — ${s.description}`);
    }
  }

  if (contract.process_state_writes.length > 0) {
    parts.push("");
    parts.push("PROCESS STATE WRITES (must write to these exact UDT members):");
    for (const w of contract.process_state_writes) {
      parts.push(`  ${substituteTokens(w, opts)}`);
    }
  }

  if (contract.process_state_reads.length > 0) {
    parts.push("");
    parts.push("PROCESS STATE READS (the SFC will populate these — do not invent reads):");
    for (const r of contract.process_state_reads) {
      parts.push(`  ${substituteTokens(r, opts)}`);
    }
  }

  return parts.join("\n");
}
```

- [ ] **Step 2: Verify**

Run: `npm run build && npm run lint`
Expected: zero new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/forge-assembly-contract-prompt.ts
git commit -m "feat(assembly-fb): contract-as-constraint prompt block builder

Pure function buildContractConstraintBlock(contract, opts) renders an
FbInterfaceContract as a structural 'MUST MATCH EXACTLY' fragment for
injection into the assembly system prompt. Substitutes {subsystem} and
{assembly} tokens in process_state references. Empty contract → empty
string. Custom roles rendered as (custom:name) markers.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Drift detection — `compareToContract`

**Goal:** Pure function that parses generated SCL, extracts its declared interface, and compares against the contract. Returns a structured `DriftReport` distinguishing hard drift (required item missing, type wrong, undeclared addition) from soft drift (extra internal vars, extra fault constants).

**Files:**
- Create: `src/lib/fb-library/contract-drift.ts`

**Acceptance Criteria:**
- [ ] Exports `DriftReport` type with `hardDrifts: HardDrift[]`, `softDrifts: SoftDrift[]`, and a `hasHardDrift: boolean` derived flag
- [ ] Exports `compareToContract(parsed: PrefilledContract, contract: FbInterfaceContract): DriftReport` (uses the existing `prefillContractFromScl` output type from `scl-interface-parser.ts` as input)
- [ ] Detects: missing-required-input, missing-required-output, type-mismatch (input or output), undeclared-input, undeclared-output (all → hard)
- [ ] Detects: extra-non-declared-internal-name, missing-process-state-write (→ hard)
- [ ] Treats extra fault-code constants and extra internal `VAR` block items as soft (no penalty)
- [ ] Renders `formatDriftFeedback(report): string` for the retry-loop prompt prefix
- [ ] Pure — no IO, no hooks

**Verify:**
```bash
npm run build && npm run lint
```
Expected: zero new errors. Function is exercised end-to-end in Task 5.

**Steps:**

- [ ] **Step 1: Create the file with type definitions**

```ts
// src/lib/fb-library/contract-drift.ts
/**
 * Compare a contract's declared interface to what an AI-generated SCL
 * actually declared. Returns a structured DriftReport that drives the
 * regenerate-with-feedback loop in use-forge-assembly-generate.ts.
 *
 * Design ref: Docs/superpowers/specs/2026-05-04-assembly-fb-library-hybrid-design.md §5.2.
 */

import type { FbInterfaceContract } from "@/types/fb-interface-contract";
import { isContractPopulated } from "@/types/fb-interface-contract";

/**
 * Output shape from prefillContractFromScl in scl-interface-parser.ts.
 * Mirroring it here avoids a circular type import — the parser exports
 * its return shape as `PrefilledContract` (already added in Phase 3).
 */
export interface ParsedDeclaredInterface {
  inputs: Array<{ tia_name: string; data_type: string; udt_name?: string }>;
  outputs: Array<{ tia_name: string; data_type: string; udt_name?: string }>;
  /** Names declared in plain VAR / VAR_TEMP / VAR_CONSTANT blocks — used to detect "extra internal" status only */
  internal_names?: string[];
  /** Detected references like "ProcessState_INFEED.CV_IN_01_PackageReady" found as write targets in the body */
  detected_process_state_writes?: string[];
}

export type HardDriftKind =
  | "missing_required_input"
  | "missing_required_output"
  | "input_type_mismatch"
  | "output_type_mismatch"
  | "undeclared_input"
  | "undeclared_output"
  | "missing_process_state_write";

export type SoftDriftKind =
  | "extra_internal_name"
  | "extra_fault_constant";

export interface HardDrift {
  kind: HardDriftKind;
  message: string;
}

export interface SoftDrift {
  kind: SoftDriftKind;
  message: string;
}

export interface DriftReport {
  hardDrifts: HardDrift[];
  softDrifts: SoftDrift[];
  hasHardDrift: boolean;
}
```

- [ ] **Step 2: Implement `compareToContract`**

Append to the same file:

```ts
function normaliseType(t: string): string {
  return t.toUpperCase().trim();
}

export function compareToContract(
  parsed: ParsedDeclaredInterface,
  contract: FbInterfaceContract,
): DriftReport {
  const hardDrifts: HardDrift[] = [];
  const softDrifts: SoftDrift[] = [];

  if (!isContractPopulated(contract)) {
    return { hardDrifts, softDrifts, hasHardDrift: false };
  }

  const parsedInputByName = new Map(parsed.inputs.map(i => [i.tia_name.toLowerCase(), i]));
  const parsedOutputByName = new Map(parsed.outputs.map(o => [o.tia_name.toLowerCase(), o]));
  const contractInputNames = new Set(contract.inputs.map(i => i.tia_name.toLowerCase()));
  const contractOutputNames = new Set(contract.outputs.map(o => o.tia_name.toLowerCase()));

  for (const ci of contract.inputs) {
    const found = parsedInputByName.get(ci.tia_name.toLowerCase());
    if (!found) {
      if (ci.required) {
        hardDrifts.push({
          kind: "missing_required_input",
          message: `Required input "${ci.tia_name} : ${ci.data_type}" is missing from VAR_INPUT.`,
        });
      }
      continue;
    }
    if (normaliseType(found.data_type) !== normaliseType(ci.data_type)) {
      hardDrifts.push({
        kind: "input_type_mismatch",
        message: `Input "${ci.tia_name}" was declared as ${found.data_type} but contract requires ${ci.data_type}.`,
      });
    }
  }

  for (const co of contract.outputs) {
    const found = parsedOutputByName.get(co.tia_name.toLowerCase());
    if (!found) {
      hardDrifts.push({
        kind: "missing_required_output",
        message: `Output "${co.tia_name} : ${co.data_type}" is missing from VAR_OUTPUT.`,
      });
      continue;
    }
    if (normaliseType(found.data_type) !== normaliseType(co.data_type)) {
      hardDrifts.push({
        kind: "output_type_mismatch",
        message: `Output "${co.tia_name}" was declared as ${found.data_type} but contract requires ${co.data_type}.`,
      });
    }
  }

  for (const pi of parsed.inputs) {
    if (!contractInputNames.has(pi.tia_name.toLowerCase())) {
      hardDrifts.push({
        kind: "undeclared_input",
        message: `Input "${pi.tia_name}" is declared in VAR_INPUT but not in the contract — remove it.`,
      });
    }
  }
  for (const po of parsed.outputs) {
    if (!contractOutputNames.has(po.tia_name.toLowerCase())) {
      hardDrifts.push({
        kind: "undeclared_output",
        message: `Output "${po.tia_name}" is declared in VAR_OUTPUT but not in the contract — remove it.`,
      });
    }
  }

  if (contract.process_state_writes.length > 0 && parsed.detected_process_state_writes) {
    const detected = new Set(parsed.detected_process_state_writes.map(s => s.toLowerCase()));
    for (const required of contract.process_state_writes) {
      if (!detected.has(required.toLowerCase())) {
        hardDrifts.push({
          kind: "missing_process_state_write",
          message: `Contract requires writing "${required}" but no assignment to it was found in the body.`,
        });
      }
    }
  }

  return { hardDrifts, softDrifts, hasHardDrift: hardDrifts.length > 0 };
}
```

- [ ] **Step 3: Add `formatDriftFeedback`**

Append:

```ts
export function formatDriftFeedback(report: DriftReport): string {
  if (!report.hasHardDrift) return "";
  const lines: string[] = [];
  lines.push("## PREVIOUS GENERATION HAD DRIFT — FIX THESE");
  lines.push("");
  lines.push("Your previous attempt did not match the interface contract. Fix:");
  for (const d of report.hardDrifts) {
    lines.push(`- ${d.message}`);
  }
  lines.push("");
  lines.push("Regenerate the FUNCTION_BLOCK to match the contract exactly.");
  return lines.join("\n");
}
```

- [ ] **Step 4: Extend the SCL parser to expose the inputs/outputs/internal_names/detected writes shape**

Open `src/lib/fb-library/scl-interface-parser.ts`. The current `prefillContractFromScl` returns a contract-shaped result. We need a parallel parser that exposes the raw declared shape (without role inference) so drift detection has clean inputs.

Add to the file's exports:

```ts
import type { ParsedDeclaredInterface } from "./contract-drift";

/**
 * Parse SCL into the raw declared interface shape used by drift detection.
 * This is a thinner read than prefillContractFromScl (no role inference, no
 * description extraction). Used in use-forge-assembly-generate.ts to compare
 * AI output against the contract.
 */
export function parseDeclaredInterface(scl: string): ParsedDeclaredInterface {
  // Extract VAR_INPUT block(s)
  const inputs: ParsedDeclaredInterface["inputs"] = [];
  const outputs: ParsedDeclaredInterface["outputs"] = [];
  const internal_names: string[] = [];
  const detected_process_state_writes: string[] = [];

  // Reuse the existing block parser pattern from this file
  const blockRe = /VAR_(INPUT|OUTPUT|TEMP|CONSTANT)\b([\s\S]*?)END_VAR/gi;
  let m: RegExpExecArray | null;
  while ((m = blockRe.exec(scl)) !== null) {
    const section = m[1].toUpperCase();
    const body = m[2];
    const declRe = /^\s*(\w+)\s*:\s*(?:"([^"]+)"|(\w+))(?:\s*\[\s*\d+\s*(?:\.\.\s*\d+)?\s*\])?/gm;
    let d: RegExpExecArray | null;
    while ((d = declRe.exec(body)) !== null) {
      const name = d[1];
      const udt = d[2];
      const type = d[3];
      const data_type = udt ? "UDT" : (type ?? "");
      const udt_name = udt;
      if (section === "INPUT") inputs.push({ tia_name: name, data_type, udt_name });
      else if (section === "OUTPUT") outputs.push({ tia_name: name, data_type, udt_name });
      else internal_names.push(name);
    }
  }

  // Extract ProcessState writes — assignments of the form "ProcessState_X.Y := ..."
  const writeRe = /(ProcessState_\w+\.\w+)\s*:=/g;
  let w: RegExpExecArray | null;
  while ((w = writeRe.exec(scl)) !== null) {
    detected_process_state_writes.push(w[1]);
  }

  return { inputs, outputs, internal_names, detected_process_state_writes };
}
```

- [ ] **Step 5: Verify**

Run: `npm run build && npm run lint`
Expected: zero new errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/fb-library/contract-drift.ts src/lib/fb-library/scl-interface-parser.ts
git commit -m "feat(assembly-fb): drift detection — compareToContract + parser

Adds compareToContract() — pure function that compares declared SCL
interface to a contract and returns a DriftReport (hard vs soft drifts).
formatDriftFeedback() renders the retry-loop prompt prefix. Adds a
parseDeclaredInterface() helper to scl-interface-parser to expose the
raw declared shape without role inference.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Generate hook — contract injection + drift retry loop

**Goal:** Modify `use-forge-assembly-generate.ts` so AI generation receives the contract as a structural constraint, validates output against the contract via drift detection, and retries up to 2 times with drift feedback before surfacing remaining drift to the caller.

**Files:**
- Modify: `src/hooks/use-forge-assembly-generate.ts`
- Modify: `src/lib/forge-prompts.ts` — `buildAssemblySclPrompt` accepts a contract and injects the constraint block when populated

**Acceptance Criteria:**
- [ ] `buildAssemblySclPrompt(assembly, context, promptSections)` accepts a new `contract?: FbInterfaceContract` field on `AssemblyGenContext` and calls `buildContractConstraintBlock` when populated
- [ ] `generateSingle` accepts `contract?: FbInterfaceContract`. Library path (template matched + has blocks) ignores contract and copies template SCL as today. AI path passes contract to the prompt builder.
- [ ] After AI returns SCL, the hook parses it (`parseDeclaredInterface`) and runs `compareToContract`. If `hasHardDrift`, prepend `formatDriftFeedback(report)` to the user message and re-run, up to 2 retries (3 total attempts).
- [ ] After 2 retries with persistent drift, return artifacts with `drift?: DriftReport` populated on the assembly's primary FB artifact. Caller surfaces the diff in the UI.
- [ ] Hook logs each retry via the existing `log("warn", ...)` mechanism with a clear message: `"${assembly.tag}: retry 1/2 — 3 hard drifts"`
- [ ] No project-specific names anywhere — generic across machine types

**Verify:**
```bash
npm run build && npm run lint
```
Expected: zero new errors. Manual test in `npm run dev` — open a spec wizard, force a custom-path assembly with a deliberately wrong contract, observe retry log entries.

**Steps:**

- [ ] **Step 1: Extend `AssemblyGenContext` and `buildAssemblySclPrompt`**

Open `src/lib/forge-prompts.ts`. Find the `AssemblyGenContext` type (referenced from `use-forge-assembly-generate.ts:14`) and add the contract field:

```ts
export interface AssemblyGenContext {
  profile: DesignProfile;
  platformRules: string;
  patterns: PatternCandidate[];
  constituentDevices: ForgeDeviceEntry[];
  deviceArtifacts: ForgeArtifact[];
  interlocks?: SpecAnalysis["interlocks"];
  alarms?: SpecAnalysis["alarms"];
  brief?: AssemblyBrief;
  /** Contract injected as structural constraint when populated */
  contract?: FbInterfaceContract;
  /** Subsystem tag for {subsystem} substitution in process_state declarations */
  subsystem?: string;
}
```

In `buildAssemblySclPrompt` (around line 557), import the new builder and inject the constraint block:

```ts
import { buildContractConstraintBlock } from "@/lib/forge-assembly-contract-prompt";

// inside buildAssemblySclPrompt, after the other section builders:
const contractSection = context.contract
  ? buildContractConstraintBlock(context.contract, {
      subsystem: context.subsystem,
      assemblyTag: assembly.tag,
    }) + "\n\n"
  : "";

// Insert `contractSection` early in the returned prompt — after the
// "What is an Assembly FB?" intro but BEFORE the constituent devices
// block. The contract is the most authoritative constraint.
return `You are a Code Architect generating an Assembly Function Block in SCL for Siemens S7-1200/S7-1500.

## What is an Assembly FB?
... existing intro text ...

${contractSection}## Constituent Devices
${deviceInterfaces}

... rest of existing prompt ...
`;
```

- [ ] **Step 2: Modify `useForgeAssemblyGenerate.generateSingle` to accept and use the contract**

Open `src/hooks/use-forge-assembly-generate.ts`. Modify the `generateSingle` signature and body:

```ts
import { parseDeclaredInterface } from "@/lib/fb-library/scl-interface-parser";
import { compareToContract, formatDriftFeedback, type DriftReport } from "@/lib/fb-library/contract-drift";
import type { FbInterfaceContract } from "@/types/fb-interface-contract";
import { isContractPopulated } from "@/types/fb-interface-contract";

const MAX_DRIFT_RETRIES = 2;

const generateSingle = useCallback(
  async (
    assembly: ForgeAssemblyEntry,
    session: ForgeSession,
    profile: DesignProfile,
    deviceArtifacts: ForgeArtifact[],
    fbTemplates: FbTemplate[],
    patterns: PatternCandidate[],
    brief?: AssemblyBrief,
    instructions?: string,
    contract?: FbInterfaceContract,
    subsystem?: string,
  ): Promise<ForgeArtifact[]> => {
    // Library path — unchanged
    const matchedTemplate = assembly.fb_template_id
      ? fbTemplates.find((t) => t.id === assembly.fb_template_id) ?? null
      : null;
    if (matchedTemplate && matchedTemplate.blocks && matchedTemplate.blocks.length > 0) {
      log("info", `${assembly.tag}: copying template "${matchedTemplate.name}"`);
      return copyTemplateAsAssemblyArtifacts(assembly, matchedTemplate);
    }

    // AI path — with contract constraint + drift retry loop
    log("info", `${assembly.tag}: generating via AI${brief ? " (FDS-driven)" : ""}${contract && isContractPopulated(contract) ? " (contract-bound)" : ""}`);
    const platformRules = await loadPlatformRules();
    const constituentDevices = (session.device_list ?? []).filter(
      (d) => assembly.device_ids.includes(d.id),
    );
    const specAnalysis = session.spec_analysis;
    const relevantInterlocks = specAnalysis?.interlocks?.filter(
      (i) => i.affected_devices?.some(
        (name) =>
          constituentDevices.some((d) => d.name === name || d.tag === name) ||
          name === assembly.name ||
          name === assembly.tag,
      ),
    );
    const relevantAlarms = specAnalysis?.alarms?.filter(
      (a) =>
        a.affected_sequences?.some((seq) =>
          seq.toLowerCase().includes(assembly.tag.toLowerCase()),
        ) || a.description?.toLowerCase().includes(assembly.tag.toLowerCase()),
    );

    const context: AssemblyGenContext = {
      profile,
      platformRules,
      patterns,
      constituentDevices,
      deviceArtifacts,
      interlocks: relevantInterlocks,
      alarms: relevantAlarms,
      brief,
      contract,
      subsystem,
    };

    const systemPrompt = buildAssemblySclPrompt(assembly, context, promptSections ?? undefined);
    const baseUserMessage = buildAssemblySclUserMessage(assembly);
    let userMessage = instructions
      ? `${baseUserMessage}\n\n## Engineer Instructions\n${instructions}`
      : baseUserMessage;

    let lastReport: DriftReport = { hardDrifts: [], softDrifts: [], hasHardDrift: false };
    let lastContent = "";
    let attempts = 0;

    while (attempts <= MAX_DRIFT_RETRIES) {
      const controller = new AbortController();
      const { content } = await callNonStreaming(
        systemPrompt,
        [{ role: "user", content: userMessage }],
        controller.signal,
        16384,
        { prompt_name: "forge-assembly-fb", agent_role: "code_architect", pipeline_step: "assembly_fb" },
      );

      lastContent = content;

      // No contract → skip drift detection (today's behaviour)
      if (!contract || !isContractPopulated(contract)) {
        const artifacts = parseSclArtifacts(content, "assembly_fb");
        log("info", `${assembly.tag}: generated ${artifacts.length} artifacts (no contract — skipping drift detection)`);
        return artifacts;
      }

      const parsed = parseDeclaredInterface(content);
      lastReport = compareToContract(parsed, contract);

      if (!lastReport.hasHardDrift) {
        const artifacts = parseSclArtifacts(content, "assembly_fb");
        log("info", `${assembly.tag}: generated ${artifacts.length} artifacts ${attempts > 0 ? `(after ${attempts} drift retries)` : "(contract clean on first try)"}`);
        return artifacts;
      }

      attempts += 1;
      if (attempts > MAX_DRIFT_RETRIES) break;

      log("warn", `${assembly.tag}: retry ${attempts}/${MAX_DRIFT_RETRIES} — ${lastReport.hardDrifts.length} hard drifts`);
      userMessage = `${formatDriftFeedback(lastReport)}\n\n${baseUserMessage}${instructions ? `\n\n## Engineer Instructions\n${instructions}` : ""}`;
    }

    // Persistent drift — surface to caller via the primary FB artifact
    const artifacts = parseSclArtifacts(lastContent, "assembly_fb");
    log("error", `${assembly.tag}: persistent drift after ${MAX_DRIFT_RETRIES} retries — ${lastReport.hardDrifts.length} unresolved drifts surfaced to UI`);
    if (artifacts.length > 0) {
      const primaryFb = artifacts.find(a => a.type === "FB") ?? artifacts[0];
      (primaryFb as ForgeArtifact & { drift?: DriftReport }).drift = lastReport;
    }
    return artifacts;
  },
  [promptSections, log],
);
```

- [ ] **Step 3: Extend the `ForgeArtifact` type to surface drift**

Open `src/types/forge.ts`. Add the optional field on `ForgeArtifact`:

```ts
import type { DriftReport } from "@/lib/fb-library/contract-drift";

export interface ForgeArtifact {
  // ... existing fields ...
  /**
   * Set when AI-against-contract generation produced unresolved drift after
   * the retry budget was exhausted. UI surfaces this for engineer review.
   * Library-path and contract-clean AI artifacts have this undefined.
   */
  drift?: DriftReport;
}
```

- [ ] **Step 4: Update `generateAll` to thread the new args**

In the same `use-forge-assembly-generate.ts`, update `generateAll` to accept (and pass through) optional `contracts: Record<string, FbInterfaceContract>` and `subsystems: Record<string, string>`. Existing callers without these keep working (undefined → skipped):

```ts
const generateAll = useCallback(
  async (
    assemblies: ForgeAssemblyEntry[],
    session: ForgeSession,
    profile: DesignProfile,
    deviceArtifacts: ForgeArtifact[],
    fbTemplates: FbTemplate[],
    patterns: PatternCandidate[],
    briefs?: Record<string, AssemblyBrief>,
    contracts?: Record<string, FbInterfaceContract>,
    subsystems?: Record<string, string>,
  ): Promise<ForgeArtifact[]> => {
    // ... existing setup ...
    for (let i = 0; i < assemblies.length; i++) {
      const asm = assemblies[i];
      setProgress({ current: i + 1, total: assemblies.length, assemblyTag: asm.tag });
      const arts = await generateSingle(
        asm, session, profile, deviceArtifacts, fbTemplates, patterns,
        briefs?.[asm.id],
        undefined,
        contracts?.[asm.id],
        subsystems?.[asm.id],
      );
      allArtifacts.push(...arts);
    }
    // ... existing finally / catch ...
  },
  [generateSingle, log],
);
```

- [ ] **Step 5: Verify**

Run: `npm run build && npm run lint`
Expected: zero new errors. Existing call sites of `useForgeAssemblyGenerate` continue to compile (the new args are optional).

- [ ] **Step 6: Run pipeline-auditor**

Per CLAUDE.md "Post-Task Hooks": `src/hooks/use-forge-*.ts` and `src/lib/forge-*.ts` were touched. Read `.claude/agents/pipeline-auditor.md` and run the audit. If it fails, fix violations before continuing. Do not skip.

- [ ] **Step 7: Commit**

```bash
git add src/lib/forge-prompts.ts src/hooks/use-forge-assembly-generate.ts src/types/forge.ts
git commit -m "feat(assembly-fb): contract injection + drift retry loop in assembly generate

Modifies use-forge-assembly-generate.ts to accept an optional contract per
assembly. When populated, the contract is injected as a structural
constraint into the system prompt; AI output is parsed and compared
against the contract; hard drift triggers up to 2 regenerate retries with
drift feedback prepended. Persistent drift after retries surfaces on the
primary FB artifact for engineer review.

Library-path (template matched) is unchanged. AI path with no contract
is unchanged (skips drift detection). Custom path with contract gets the
retry loop.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Skeleton picker — 5 starter contract shapes

**Goal:** Hardcoded library of starter contract shapes that pre-fill the contract editor when an engineer picks a skeleton (e.g. "single-actuator", "rotary"). Reduces blank-form friction.

**Files:**
- Create: `src/lib/fb-library/contract-skeletons.ts`

**Acceptance Criteria:**
- [ ] Exports `CONTRACT_SKELETONS: Array<{ id: string; label: string; description: string; contract: FbInterfaceContract }>` with 5 entries: `single_actuator`, `two_actuator`, `rotary`, `lift`, `accumulator`
- [ ] Plus a 6th `from_scratch` entry whose contract is `EMPTY_INTERFACE_CONTRACT`
- [ ] Each non-empty skeleton declares: `AutoRun`, `Reset` inputs; `Running`, `Faulted`, `FaultCode` outputs; common IO slots and process_state_writes for the shape
- [ ] No project-specific names — all generic
- [ ] Exports `getSkeleton(id: string): FbInterfaceContract | null`

**Verify:**
```bash
npm run build && npm run lint
```
Expected: zero new errors.

**Steps:**

- [ ] **Step 1: Create the skeleton library**

```ts
// src/lib/fb-library/contract-skeletons.ts
/**
 * Hardcoded starter contract shapes — pre-fills the contract editor when
 * the engineer picks a skeleton in the spec wizard's custom-assembly path.
 *
 * Per Docs/superpowers/specs/2026-05-04-assembly-fb-library-hybrid-design.md §4.1 step 4.
 *
 * Generic across machine types — no project-specific names.
 */

import type { FbInterfaceContract } from "@/types/fb-interface-contract";
import { EMPTY_INTERFACE_CONTRACT } from "@/types/fb-interface-contract";

export interface ContractSkeleton {
  id: string;
  label: string;
  description: string;
  contract: FbInterfaceContract;
}

const COMMON_INPUTS: FbInterfaceContract["inputs"] = [
  { name: "AutoRun", tia_name: "AutoRun", data_type: "BOOL", role: "auto_run", description: "Master enable from orchestration", required: true },
  { name: "Reset", tia_name: "Reset", data_type: "BOOL", role: "reset_cmd", description: "Edge-triggered fault reset", required: true },
];

const COMMON_OUTPUTS: FbInterfaceContract["outputs"] = [
  { name: "Running", tia_name: "Running", data_type: "BOOL", role: "running", description: "TRUE while the assembly is in any active motion state" },
  { name: "Faulted", tia_name: "Faulted", data_type: "BOOL", role: "faulted", description: "TRUE while a latched fault is present" },
  { name: "FaultCode", tia_name: "FaultCode", data_type: "WORD", role: "fault_code", description: "Active fault code (0 = no fault)" },
];

export const CONTRACT_SKELETONS: ContractSkeleton[] = [
  {
    id: "from_scratch",
    label: "From scratch",
    description: "Empty contract — author every field manually",
    contract: { ...EMPTY_INTERFACE_CONTRACT },
  },
  {
    id: "single_actuator",
    label: "Single actuator",
    description: "One DO command, one DI feedback. Pneumatic cylinder, solenoid valve, simple latch.",
    contract: {
      inputs: [
        ...COMMON_INPUTS,
        { name: "CmdActuate", tia_name: "CmdActuate", data_type: "BOOL", role: "start_cmd", description: "Pulse-or-level command from orchestration", required: true },
      ],
      outputs: [
        ...COMMON_OUTPUTS,
        { name: "AtTarget", tia_name: "AtTarget", data_type: "BOOL", role: "at_target", description: "TRUE when actuator is at commanded position" },
      ],
      io_slots: [
        { slot_name: "actuator_command", signal_type: "DO", role: "actuator_command", description: "Solenoid energise output", cardinality: "one" },
        { slot_name: "position_sensor", signal_type: "DI", role: "position_sensor", description: "End-of-stroke prox", cardinality: "one" },
      ],
      process_state_reads: [],
      process_state_writes: ["ProcessState_{subsystem}.{assembly}_AtTarget"],
    },
  },
  {
    id: "two_actuator",
    label: "Two actuators",
    description: "Pusher / extend-retract cylinder / dual-solenoid actuator. Two DOs, two DIs.",
    contract: {
      inputs: [
        ...COMMON_INPUTS,
        { name: "CmdExtend", tia_name: "CmdExtend", data_type: "BOOL", role: "command_extend", description: "TRUE to extend, FALSE to retract", required: true },
      ],
      outputs: [
        ...COMMON_OUTPUTS,
        { name: "Extended", tia_name: "Extended", data_type: "BOOL", role: "extended", description: "TRUE at extend prox" },
        { name: "Retracted", tia_name: "Retracted", data_type: "BOOL", role: "retracted", description: "TRUE at retract prox" },
      ],
      io_slots: [
        { slot_name: "extend_command", signal_type: "DO", role: "extend_command", description: "Extend solenoid", cardinality: "one" },
        { slot_name: "retract_command", signal_type: "DO", role: "retract_command", description: "Retract solenoid (optional for spring-return)", cardinality: "zero_or_one" },
        { slot_name: "extend_sensor", signal_type: "DI", role: "position_sensor", description: "Extend prox", cardinality: "one" },
        { slot_name: "retract_sensor", signal_type: "DI", role: "position_sensor", description: "Retract prox", cardinality: "one" },
      ],
      process_state_reads: [],
      process_state_writes: [
        "ProcessState_{subsystem}.{assembly}_Extended",
        "ProcessState_{subsystem}.{assembly}_Retracted",
      ],
    },
  },
  {
    id: "rotary",
    label: "Rotary station",
    description: "Two-position rotary index — turntable, swing gate, diverter.",
    contract: {
      inputs: [
        ...COMMON_INPUTS,
        { name: "CmdPosition", tia_name: "CmdPosition", data_type: "BOOL", role: "command_position", description: "FALSE = home, TRUE = rotated", required: true },
      ],
      outputs: [
        ...COMMON_OUTPUTS,
        { name: "AtHome", tia_name: "AtHome", data_type: "BOOL", role: "at_home", description: "" },
        { name: "AtRotated", tia_name: "AtRotated", data_type: "BOOL", role: "at_position", description: "" },
      ],
      io_slots: [
        { slot_name: "rotate_fwd_command", signal_type: "DO", role: "rotate_command", description: "Rotate-forward contactor / valve", cardinality: "one" },
        { slot_name: "rotate_rev_command", signal_type: "DO", role: "rotate_command", description: "Rotate-reverse (omit for spring-return)", cardinality: "zero_or_one" },
        { slot_name: "home_sensor", signal_type: "DI", role: "home_sensor", description: "", cardinality: "one" },
        { slot_name: "rotated_sensor", signal_type: "DI", role: "position_sensor", description: "", cardinality: "one" },
      ],
      process_state_reads: [],
      process_state_writes: [
        "ProcessState_{subsystem}.{assembly}_AtHome",
        "ProcessState_{subsystem}.{assembly}_AtRotated",
      ],
    },
  },
  {
    id: "lift",
    label: "Lift station",
    description: "Vertical lift between fixed levels — N proxes, up/down commands, optional permissive.",
    contract: {
      inputs: [
        ...COMMON_INPUTS,
        { name: "CmdLevel", tia_name: "CmdLevel", data_type: "INT", role: "command_level", description: "Target level (0 = bottom, 1 = next, …)", required: true },
        { name: "Permissive_LoadClear", tia_name: "Permissive_LoadClear", data_type: "BOOL", role: "permissive", description: "External permissive — block lift while load is in transit", required: true },
      ],
      outputs: [
        ...COMMON_OUTPUTS,
        { name: "AtLevel", tia_name: "AtLevel", data_type: "INT", role: "at_level", description: "Current level (-1 = between)" },
        { name: "Moving", tia_name: "Moving", data_type: "BOOL", role: "moving", description: "" },
      ],
      io_slots: [
        { slot_name: "up_command", signal_type: "DO", role: "lift_command", description: "", cardinality: "one" },
        { slot_name: "down_command", signal_type: "DO", role: "lower_command", description: "", cardinality: "one" },
        { slot_name: "level_sensors", signal_type: "DI", role: "level_sensor", description: "One DI per fixed level", cardinality: "one_or_more" },
      ],
      process_state_reads: [],
      process_state_writes: [
        "ProcessState_{subsystem}.{assembly}_AtLevel",
        "ProcessState_{subsystem}.{assembly}_Moving",
      ],
    },
  },
  {
    id: "accumulator",
    label: "Accumulator buffer",
    description: "Conveyor with upstream/downstream handshake holding a queue between stations.",
    contract: {
      inputs: [
        ...COMMON_INPUTS,
        { name: "UpstreamReady", tia_name: "UpstreamReady", data_type: "BOOL", role: "upstream_ready", description: "Feeder asserts ready-to-deliver", required: true },
        { name: "DownstreamReady", tia_name: "DownstreamReady", data_type: "BOOL", role: "downstream_ready", description: "Discharger asserts ready-to-receive", required: true },
      ],
      outputs: [
        ...COMMON_OUTPUTS,
        { name: "Full", tia_name: "Full", data_type: "BOOL", role: "full", description: "" },
        { name: "Empty", tia_name: "Empty", data_type: "BOOL", role: "empty", description: "" },
      ],
      io_slots: [
        { slot_name: "infeed_photoeye", signal_type: "DI", role: "infeed_sensor", description: "", cardinality: "one" },
        { slot_name: "discharge_photoeye", signal_type: "DI", role: "discharge_sensor", description: "", cardinality: "one" },
        { slot_name: "motor_command", signal_type: "DO", role: "motor_contactor", description: "", cardinality: "one" },
        { slot_name: "motor_running_feedback", signal_type: "DI", role: "running_feedback", description: "", cardinality: "one" },
      ],
      process_state_reads: [],
      process_state_writes: [
        "ProcessState_{subsystem}.{assembly}_Full",
        "ProcessState_{subsystem}.{assembly}_Empty",
      ],
    },
  },
];

export function getSkeleton(id: string): FbInterfaceContract | null {
  const found = CONTRACT_SKELETONS.find(s => s.id === id);
  return found ? { ...found.contract } : null;
}
```

- [ ] **Step 2: Verify**

Run: `npm run build && npm run lint`
Expected: zero new errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/fb-library/contract-skeletons.ts
git commit -m "feat(assembly-fb): hardcoded contract skeletons (5 + from-scratch)

Provides starter contract shapes for the custom-assembly path:
single_actuator, two_actuator, rotary, lift, accumulator. Plus
from_scratch (empty). Generic across machine types — no project-specific
names. Tokens {subsystem} and {assembly} substituted at generation time
by the contract-prompt builder.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Co-Author contract panel — library + custom paths

**Goal:** New wizard panel that hosts the contract editor inline for each assembly. Library-bound assemblies see the contract pre-filled (read-only edits to slots + instance_params + process_intent). Custom assemblies see the skeleton picker, contract editor, "Generate SCL from contract" button, Monaco SCL pane, regenerate, save, and "Save as library template" actions.

**Files:**
- Create: `src/components/spec-builder/co-author-assembly-contract.tsx`
- Modify: `src/components/spec-builder/fds-co-author.tsx` — render the new panel for the active assembly

**Acceptance Criteria:**
- [ ] Component takes `assembly: AssemblyConfig`, `subsystem: string`, `templates: FbTemplate[]`, `onChange(updates: Partial<AssemblyConfig>): void`, and renders one of two views based on whether `assembly.fb_template_id` is set
- [ ] Library view shows: matched template name + version + "change template" button (defers full picker to existing assembly-picker), IO slot wiring rows (one per template's `interface_contract.io_slots[]` with a tag picker scoped to the assembly's instrument register), instance_params form, process_intent textarea
- [ ] Custom view shows: skeleton picker (dropdown of `CONTRACT_SKELETONS`), `InterfaceContractEditor` (the same component reused from FB Library), process_intent textarea (required), "Generate SCL from contract" button, Monaco SCL pane (read-only display of `assembly.generated_scl_blocks` joined into one document), drift indicator chip when any block has drift, Regenerate button, Save assembly button, "★ Save as library template" button (only enabled when SCL has been generated and process_intent is non-empty)
- [ ] Generate button calls `useForgeAssemblyGenerate.generateSingle` with the authored contract; on success, persists `generated_scl_blocks` via `onChange`
- [ ] Drift on the returned artifact is surfaced as a red chip with a popover listing the unresolved drift messages
- [ ] No project-specific text — labels read "Assembly", "Contract", etc.

**Verify:**
```bash
npm run build && npm run lint
```
Expected: zero new errors. Manual test: open spec wizard, navigate to an assembly with a matched template — see library view. Navigate to one without — see custom view, pick skeleton, edit contract, click Generate, observe Monaco pane populates.

**Steps:**

- [ ] **Step 1: Build the component skeleton**

```tsx
// src/components/spec-builder/co-author-assembly-contract.tsx
import { useMemo, useState } from "react";
import { Sparkles, RefreshCw, Star, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import Editor from "@monaco-editor/react";
import { InterfaceContractEditor } from "@/components/fb-library/interface-contract-editor";
import { CONTRACT_SKELETONS, getSkeleton } from "@/lib/fb-library/contract-skeletons";
import { useForgeAssemblyGenerate } from "@/hooks/use-forge-assembly-generate";
import { normaliseInterfaceContract, isContractPopulated, type FbInterfaceContract } from "@/types/fb-interface-contract";
import type { AssemblyConfig, AssemblyGeneratedSclBlock } from "@/types/spec-builder";
import type { FbTemplate } from "@/types/fb-template";
import type { ForgeArtifact, ForgeSession } from "@/types/forge";
import type { DesignProfile } from "@/types/design-profile";
import type { DriftReport } from "@/lib/fb-library/contract-drift";

interface CoAuthorAssemblyContractProps {
  assembly: AssemblyConfig;
  subsystem: string;
  templates: FbTemplate[];
  /** ForgeSession-shaped context the wizard already has on hand for forge-prompt building */
  forgeSession: ForgeSession;
  profile: DesignProfile;
  /** Pre-generated device-FB artifacts the assembly references (already in wizard state) */
  deviceArtifacts: ForgeArtifact[];
  onChange: (updates: Partial<AssemblyConfig>) => void;
  onPromoteToLibrary?: () => void;
}

export function CoAuthorAssemblyContract(props: CoAuthorAssemblyContractProps) {
  const { assembly, subsystem, templates, forgeSession, profile, deviceArtifacts, onChange, onPromoteToLibrary } = props;
  const matchedTemplate = useMemo(
    () => templates.find(t => t.id === assembly.fb_template_id) ?? null,
    [assembly.fb_template_id, templates],
  );
  const isLibraryBound = matchedTemplate !== null;
  const contract = useMemo<FbInterfaceContract>(
    () => normaliseInterfaceContract(assembly.interface_contract),
    [assembly.interface_contract],
  );

  // ... see steps below for the body of this component ...
  return (
    <div className="space-y-4">
      {isLibraryBound
        ? <LibraryView ... />
        : <CustomView ... />}
    </div>
  );
}
```

- [ ] **Step 2: Build `LibraryView`**

In the same file, define the library view. Reuses today's tag picker for the IO slot wiring; renders `instance_params` as typed input rows.

```tsx
function LibraryView(props: {
  assembly: AssemblyConfig;
  template: FbTemplate;
  contract: FbInterfaceContract;
  onChange: (u: Partial<AssemblyConfig>) => void;
}) {
  const { assembly, template, contract, onChange } = props;
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="secondary" className="font-mono">TEMPLATE</Badge>
        <span className="font-mono">{template.name}</span>
        <span className="text-muted-foreground">v{template.version ?? 1}</span>
      </div>
      <div>
        <label className="text-xs font-mono uppercase text-muted-foreground">Process intent</label>
        <Textarea
          value={assembly.process_intent ?? ""}
          onChange={(e) => onChange({ process_intent: e.target.value })}
          placeholder="In 1-2 sentences, what does this assembly do in the overall process?"
          rows={2}
        />
      </div>
      <div>
        <label className="text-xs font-mono uppercase text-muted-foreground">IO Slots</label>
        {contract.io_slots.map(slot => (
          <div key={slot.slot_name} className="flex items-center gap-2 py-1 text-sm">
            <span className="font-mono w-44">{slot.slot_name}</span>
            <Badge variant="outline">{slot.signal_type}</Badge>
            {/* Tag picker — scoped to assembly's instrument register; reuse existing picker */}
            <TagPickerForSlot
              slot={slot}
              currentTag={assembly.instance_params?.[slot.slot_name] ?? ""}
              onPick={(tag) =>
                onChange({ instance_params: { ...assembly.instance_params, [slot.slot_name]: tag } })
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

(Where `TagPickerForSlot` reuses an existing picker from `src/components/spec-builder/pickers/`.)

- [ ] **Step 3: Build `CustomView`**

Same file. Hosts the skeleton picker, `InterfaceContractEditor`, `Generate` button, Monaco pane, drift chip, regenerate, save, promote.

```tsx
function CustomView(props: {
  assembly: AssemblyConfig;
  subsystem: string;
  contract: FbInterfaceContract;
  forgeSession: ForgeSession;
  profile: DesignProfile;
  deviceArtifacts: ForgeArtifact[];
  onChange: (u: Partial<AssemblyConfig>) => void;
  onPromoteToLibrary?: () => void;
}) {
  const { assembly, subsystem, contract, forgeSession, profile, deviceArtifacts, onChange, onPromoteToLibrary } = props;
  const { generateSingle, loading, log } = useForgeAssemblyGenerate();
  const [drift, setDrift] = useState<DriftReport | null>(null);

  const sclDoc = (assembly.generated_scl_blocks ?? [])
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(b => `// ${b.block_type}: ${b.block_name}\n${b.scl_code}`)
    .join("\n\n");

  const handleGenerate = async () => {
    if (!isContractPopulated(contract)) return;
    const matchedTemplate = null; // forces AI path
    const artifacts = await generateSingle(
      // Constructing the ForgeAssemblyEntry shape from AssemblyConfig:
      {
        id: assembly.assembly_id,
        name: assembly.assembly_name,
        tag: assembly.assembly_tag ?? assembly.assembly_name,
        assembly_type: assembly.assembly_type ?? "custom",
        device_ids: assembly.devices?.map(d => d.id) ?? [],
        fb_template_id: null,
        fb_match_confidence: "none",
      },
      forgeSession,
      profile,
      deviceArtifacts,
      [], // no fbTemplates → forces AI path
      [], // patterns — wizard caller passes its own list in the real wiring
      undefined, // brief
      assembly.process_intent ?? undefined,
      contract,
      subsystem,
    );

    const blocks: AssemblyGeneratedSclBlock[] = artifacts.map((a, i) => ({
      block_name: a.name,
      block_type: a.type as AssemblyGeneratedSclBlock["block_type"],
      scl_code: a.content,
      sort_order: i,
    }));

    onChange({ generated_scl_blocks: blocks });

    const primaryFb = artifacts.find(a => a.type === "FB");
    setDrift((primaryFb as ForgeArtifact & { drift?: DriftReport })?.drift ?? null);
  };

  const canPromote = (assembly.generated_scl_blocks?.length ?? 0) > 0
    && (assembly.process_intent ?? "").trim().length > 0
    && drift?.hasHardDrift !== true;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <label className="text-xs font-mono uppercase text-muted-foreground">Skeleton</label>
        <Select
          onValueChange={(id) => {
            const skel = getSkeleton(id);
            if (skel) onChange({ interface_contract: skel });
          }}
        >
          <SelectTrigger className="w-64"><SelectValue placeholder="Pick a starter shape…" /></SelectTrigger>
          <SelectContent>
            {CONTRACT_SKELETONS.map(s => (
              <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <label className="text-xs font-mono uppercase text-muted-foreground">Process intent <span className="text-destructive">required</span></label>
        <Textarea
          value={assembly.process_intent ?? ""}
          onChange={(e) => onChange({ process_intent: e.target.value })}
          placeholder="In 1-2 sentences, what does this assembly do in the overall process?"
          rows={2}
        />
      </div>

      <InterfaceContractEditor
        contract={contract}
        onChange={(c) => onChange({ interface_contract: c })}
      />

      <div className="flex items-center gap-2 border-t pt-4">
        <Button onClick={handleGenerate} disabled={loading || !isContractPopulated(contract)}>
          <Sparkles className="mr-2 h-4 w-4" /> Generate SCL from contract
        </Button>
        {assembly.generated_scl_blocks?.length ? (
          <Button onClick={handleGenerate} variant="outline" disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" /> Regenerate
          </Button>
        ) : null}
        {drift?.hasHardDrift && (
          <Popover>
            <PopoverTrigger asChild>
              <Badge variant="destructive" className="cursor-pointer">
                <AlertTriangle className="mr-1 h-3 w-3" /> {drift.hardDrifts.length} drift
              </Badge>
            </PopoverTrigger>
            <PopoverContent className="w-96 text-sm">
              <div className="font-medium mb-2">Unresolved drift after retries</div>
              <ul className="list-disc pl-4 space-y-1">
                {drift.hardDrifts.map((d, i) => <li key={i}>{d.message}</li>)}
              </ul>
            </PopoverContent>
          </Popover>
        )}
        {onPromoteToLibrary && (
          <Button onClick={onPromoteToLibrary} variant="outline" className="ml-auto" disabled={!canPromote}>
            <Star className="mr-2 h-4 w-4" /> Save as library template
          </Button>
        )}
      </div>

      {sclDoc && (
        <div className="border rounded-md overflow-hidden">
          <div className="bg-muted px-3 py-1 text-xs font-mono uppercase text-muted-foreground">Generated SCL</div>
          <Editor
            height="320px"
            language="scl"
            value={sclDoc}
            theme="vs-dark"
            options={{ readOnly: true, minimap: { enabled: false }, fontSize: 12 }}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Wire the panel into `fds-co-author.tsx`**

Open `src/components/spec-builder/fds-co-author.tsx`. Locate where the active assembly's authoring view is currently rendered (look for `<FdsStaticReview` and the conversational/table-pane stage). Add a third stage entry "Contract" or merge into the existing flow so the contract panel renders inside the right column. Pass `onChange` wired to the existing assembly-update mutation.

```tsx
// Inside fds-co-author.tsx, near the existing stage-based conditional render:
import { CoAuthorAssemblyContract } from "./co-author-assembly-contract";
// ...
{activeAssembly && (
  <CoAuthorAssemblyContract
    assembly={activeAssembly}
    subsystem={activeAssembly.subsystem ?? ""}
    templates={fbTemplates}
    forgeSession={forgeSessionShape}
    profile={profile}
    deviceArtifacts={deviceArtifactsForAssembly}
    onChange={(updates) => updateActiveAssembly(updates)}
    onPromoteToLibrary={() => setPromoteDialogAssembly(activeAssembly)}
  />
)}
```

The `updateActiveAssembly` mutation must persist `interface_contract` and `generated_scl_blocks` to `fds_assembly_sessions`. Use the existing `use-fds-session.ts` mutation pattern.

- [ ] **Step 5: Verify**

Run: `npm run build && npm run lint`
Manual test: `npm run dev`, open the wizard at the Co-Author stage on an existing project, observe the contract panel renders. Pick a skeleton on a custom assembly, edit a field, click Generate. Verify Monaco pane populates with SCL.

- [ ] **Step 6: Run pipeline-auditor**

Per CLAUDE.md, this task touched `src/hooks/use-forge-*.ts` (transitively) and adds wizard plumbing that consumes the modified hook. Run `.claude/agents/pipeline-auditor.md`. Fix any violations before continuing.

- [ ] **Step 7: Commit**

```bash
git add src/components/spec-builder/co-author-assembly-contract.tsx src/components/spec-builder/fds-co-author.tsx
git commit -m "feat(assembly-fb): wizard contract panel — library + custom paths

New CoAuthorAssemblyContract panel renders inline in fds-co-author.
Library-bound assemblies show pre-filled contract + IO slot tag pickers
+ instance_params + process_intent. Custom assemblies show skeleton
picker + InterfaceContractEditor + Generate-from-contract button +
Monaco SCL pane + drift chip + regenerate + Save-as-library-template.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Phase 5.5 — Promote-to-library hook + dialog

**Goal:** "Save as library template" mints a brand-new `fb_template` row from a custom assembly's authored contract+SCL. Scope-limited on first save (mechanism per spec §8.2 — `profile_ids[]` if a project profile exists, else add a `staged: boolean` column in this task's migration if needed).

**Files:**
- Create: `src/hooks/use-promote-to-library.ts`
- Create: `src/components/spec-builder/promote-to-library-dialog.tsx`
- Decide in implementation: either migration `077_fb_template_staged.sql` (adds `staged boolean`) or reuse `profile_ids[]` if the project's design profile is suitable

**Acceptance Criteria:**
- [ ] Hook exposes `usePromoteToLibrary()` returning a `mutate({ assembly, name, category, description, scope }): Promise<FbTemplate>` and TanStack Query loading/error state
- [ ] Mutation creates a `fb_templates` row with `is_assembly = true`, `source = "custom"`, `version = 1`, the assembly's `interface_contract` jsonb, and a single primary FB block built from `assembly.generated_scl_blocks[0]`
- [ ] Scope: if `scope === "project"`, sets `profile_ids[]` to include the project's design profile id (if there is one) OR sets `staged = true` (if migration 077 is added). If `scope === "global"`, leaves both unset.
- [ ] Dialog asks for: name (default = assembly_name), category (text input), description (default = process_intent), scope radio (Project-scoped / Global). Validates name is unique against existing `fb_templates.name`.
- [ ] On success, the dialog closes and the parent component (the contract panel) reflects the new template binding so a re-open of the assembly shows it as library-bound — but per spec, the existing assembly stays custom-bound on this run. The promotion is a *side effect* for future assemblies.
- [ ] Toast on success: "Saved as library template — available for future assemblies"
- [ ] Run-time error if the assembly has unresolved hard drift — promotion blocked

**Verify:**
```bash
npm run build && npm run lint
```
Expected: zero new errors. Manual test: complete a custom assembly with clean (no-drift) generation, click "Save as library template", fill the dialog, confirm. Open a fresh wizard session and verify the new template appears in the library list.

**Steps:**

- [ ] **Step 1 (decision-gate): Choose scope mechanism**

Read the project's design profile model (`src/types/design-profile.ts`, `src/hooks/use-design-profiles.ts`). Two paths:

(A) If a project's design profile is what should gate templates: pass `profile_ids: [project.profile_id]` for project scope, `[]` for global.
(B) If the design profile isn't a 1:1 with project, add migration `077_fb_template_staged.sql` adding `staged boolean NOT NULL DEFAULT false`, and use that flag.

Decide based on what's already in the schema. Default recommendation per the spec: **path (A) if a project profile exists, otherwise path (B)**. This step is *exploration only* — no code yet.

- [ ] **Step 2 (only if path B chosen): Add migration 077**

```sql
-- supabase/migrations/077_fb_template_staged.sql
ALTER TABLE fb_templates
  ADD COLUMN staged boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN fb_templates.staged IS
  'TRUE when the template was promoted from a custom assembly but not yet reviewed for global use. Library picker filters these out by default. Engineer review + clear flag to promote to global.';
```

Apply: `npx supabase db push --local`

- [ ] **Step 3: Create the promotion hook**

```ts
// src/hooks/use-promote-to-library.ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { AssemblyConfig } from "@/types/spec-builder";
import type { FbTemplate } from "@/types/fb-template";

export interface PromoteRequest {
  assembly: AssemblyConfig;
  name: string;
  category: string;
  description: string;
  scope: "project" | "global";
  /** Project's design profile id, when scope === "project" and we use path A */
  projectProfileId?: string | null;
}

export function usePromoteToLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (req: PromoteRequest): Promise<FbTemplate> => {
      const blocks = (req.assembly.generated_scl_blocks ?? []).map((b, i) => ({
        block_name: b.block_name,
        block_type: b.block_type,
        scl_code: b.scl_code,
        sort_order: i,
        programming_language: "SCL",
      }));

      if (blocks.length === 0) {
        throw new Error("Cannot promote — no generated SCL blocks on this assembly.");
      }

      // Insert template row
      const { data: tmpl, error: e1 } = await supabase
        .from("fb_templates")
        .insert({
          name: req.name,
          device_category: req.category,
          plc_brand: "SIEMENS_TIA",
          description: req.description,
          source: "custom",
          version: 1,
          is_assembly: true,
          is_enabled: true,
          interface_contract: req.assembly.interface_contract ?? {},
          // path A — profile gating
          profile_ids: req.scope === "project" && req.projectProfileId ? [req.projectProfileId] : [],
          // path B — staged flag (only present if migration 077 was applied)
          // staged: req.scope === "project",
        })
        .select()
        .single();
      if (e1 || !tmpl) throw e1 ?? new Error("Failed to insert template");

      // Insert template blocks
      const { error: e2 } = await supabase
        .from("fb_template_blocks")
        .insert(blocks.map(b => ({ ...b, fb_template_id: tmpl.id })));
      if (e2) throw e2;

      return tmpl as FbTemplate;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["fb-templates"] });
    },
  });
}
```

- [ ] **Step 4: Create the dialog**

```tsx
// src/components/spec-builder/promote-to-library-dialog.tsx
import { useState, useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { useFbTemplates } from "@/hooks/use-fb-templates";
import { usePromoteToLibrary, type PromoteRequest } from "@/hooks/use-promote-to-library";
import { useToast } from "@/hooks/use-toast";
import type { AssemblyConfig } from "@/types/spec-builder";

interface Props {
  assembly: AssemblyConfig | null;
  projectProfileId: string | null;
  onClose: () => void;
}

export function PromoteToLibraryDialog({ assembly, projectProfileId, onClose }: Props) {
  const { data: existing = [] } = useFbTemplates();
  const promote = usePromoteToLibrary();
  const { toast } = useToast();

  const [name, setName] = useState(assembly?.assembly_name ?? "");
  const [category, setCategory] = useState("Conveyor");
  const [description, setDescription] = useState(assembly?.process_intent ?? "");
  const [scope, setScope] = useState<"project" | "global">("project");

  const nameTaken = useMemo(
    () => existing.some(t => t.name.trim().toLowerCase() === name.trim().toLowerCase()),
    [existing, name],
  );

  if (!assembly) return null;

  const submit = async () => {
    if (nameTaken) { toast({ title: "Name already used", variant: "destructive" }); return; }
    try {
      const req: PromoteRequest = { assembly, name, category, description, scope, projectProfileId };
      await promote.mutateAsync(req);
      toast({ title: "Saved as library template", description: "Available for future assemblies" });
      onClose();
    } catch (e) {
      toast({ title: "Failed to promote", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Save as library template</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={e => setName(e.target.value)} />
            {nameTaken && <div className="text-xs text-destructive mt-1">A template with this name already exists</div>}
          </div>
          <div>
            <Label>Category</Label>
            <Input value={category} onChange={e => setCategory(e.target.value)} placeholder="Conveyor / Lift / etc." />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={3} />
          </div>
          <div>
            <Label>Scope</Label>
            <RadioGroup value={scope} onValueChange={(v) => setScope(v as "project" | "global")}>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="project" id="scope-project" />
                <Label htmlFor="scope-project">Project-scoped (default — review before global)</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="global" id="scope-global" />
                <Label htmlFor="scope-global">Global (available to all projects immediately)</Label>
              </div>
            </RadioGroup>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={promote.isPending || !name || nameTaken}>
            {promote.isPending ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Wire the dialog into `fds-co-author.tsx`**

Add state for the dialog and render it conditionally:

```tsx
const [promoteDialogAssembly, setPromoteDialogAssembly] = useState<AssemblyConfig | null>(null);
// ... at the bottom of the component, alongside other dialogs:
<PromoteToLibraryDialog
  assembly={promoteDialogAssembly}
  projectProfileId={project?.profile_id ?? null}
  onClose={() => setPromoteDialogAssembly(null)}
/>
```

- [ ] **Step 6: Verify**

Run: `npm run build && npm run lint`
Manual test in `npm run dev`: complete a custom assembly with clean SCL, click "Save as library template", fill in the dialog, confirm. Verify the new template appears in `/fb-library`.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/use-promote-to-library.ts src/components/spec-builder/promote-to-library-dialog.tsx src/components/spec-builder/fds-co-author.tsx
# Also include migration 077 if path B was chosen
git commit -m "feat(assembly-fb): Phase 5.5 — promote custom assembly to library

Adds usePromoteToLibrary mutation that mints an fb_templates row
(version 1, is_assembly = true, source = custom) from a custom
assembly's contract + generated SCL. Scope-limited on first save via
profile_ids[] (path A) or staged flag (path B — migration 077).
Dialog asks for name / category / description / scope. Blocks promotion
when SCL is missing or hard drift is unresolved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Acceptance test — end-to-end PILOT-001 dry-run on hybrid path

**Goal:** Validate the success criteria from spec §9 by running the full wizard flow on PILOT-001 (or whatever real spec is loaded). No new code — purely an acceptance pass with documented findings.

**Files:**
- Create: `Docs/superpowers/plans/2026-05-04-assembly-fb-library-hybrid-phase5.acceptance.md` — findings document

**Acceptance Criteria:**
- [ ] Wizard opens an existing project; every assembly is contract-backed (library or custom)
- [ ] At least one library-bound assembly is exercised end-to-end: matched template, IO slots wired, instance_params set, process_intent filled, save succeeds
- [ ] At least one custom assembly is exercised: skeleton picked, contract authored, process_intent filled, Generate clicked, SCL appears in Monaco pane, drift indicator either green or red — both states documented if encountered
- [ ] Drift retry loop exercised: deliberately introduce contract drift (e.g. force a wrong `data_type` for a required output via the editor) and confirm 2 retries occur in the log entries before drift surfaces in the UI
- [ ] Save-as-library-template exercised on a clean (no-drift) custom assembly; verify the template appears in `/fb-library`
- [ ] No assembly in the run falls back to today's free-form prose authoring
- [ ] Findings doc records: spec used, assembly count by type (library vs custom), retry rates, any drift patterns, any UX rough edges

**Verify:**
- Manual end-to-end run, findings document committed.

**Steps:**

- [ ] **Step 1: Pick a real spec to run against**

PILOT-001 is the canonical reference. PAC-EFD-020 (the InfeedConveyor_Elevator docx in `Docs/Functional Specs/`) is also viable. Pick one and load the project in the wizard.

- [ ] **Step 2: Walk through Phase 2 Machine Hierarchy**

Verify `matchAssembliesToTemplates()` runs and produces matches for the standard assemblies. Override any wrong matches manually. Reject the matcher's pick on at least one assembly to force the custom path on it.

- [ ] **Step 3: For each assembly, walk through Co-Author**

Library-bound: verify pre-fill, wire IO slots, fill process_intent, save.
Custom: pick a skeleton, edit the contract, fill process_intent, click Generate, observe Monaco pane.

- [ ] **Step 4: Force a drift scenario**

On one custom assembly, after a clean Generate, edit the contract to add a new required output. Click Regenerate. Confirm:
1. Log shows `retry 1/2 — N hard drifts`
2. Log shows `retry 2/2 — N hard drifts` if AI persists
3. Either drift resolves and SCL re-renders, or red drift chip appears with the unresolved drifts in a popover

- [ ] **Step 5: Promote one custom assembly to library**

After a clean Generate on a different custom assembly, click "Save as library template", fill the dialog, save. Open `/fb-library` in a new tab; verify the template appears with `is_assembly = true`.

- [ ] **Step 6: Document findings**

Write `Docs/superpowers/plans/2026-05-04-assembly-fb-library-hybrid-phase5.acceptance.md`:

```markdown
# Phase 5 Acceptance — Findings

**Spec used:** [name]
**Assemblies run:** [N library / M custom]

## Library-path findings
[per-assembly notes]

## Custom-path findings
[per-assembly notes — drift retries observed, regenerate counts]

## Promote-to-library findings
[template name, scope chosen, visible in /fb-library — yes/no]

## UX rough edges
[anything friction-y that didn't block but should be filed]

## Open follow-ups
[anything that needs a separate plan / spec / fix]
```

- [ ] **Step 7: Commit**

```bash
git add Docs/superpowers/plans/2026-05-04-assembly-fb-library-hybrid-phase5.acceptance.md
git commit -m "docs(assembly-fb): Phase 5 acceptance findings on hybrid path

Documents end-to-end run against [spec name]. Library + custom paths
exercised, drift retry loop validated, promote-to-library validated.
Open UX follow-ups listed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review Checklist (run after writing all tasks)

- [ ] Every spec §4–§9 requirement maps to a numbered task above
- [ ] Every step that changes code has an exact code block (no "implement X" without showing the code)
- [ ] Function and type names are consistent across tasks (e.g. `compareToContract` is the same name in Tasks 4, 5, and 7)
- [ ] No "TODO" or "TBD" remains
- [ ] Pipeline-auditor invocation is included on Tasks 5 and 7 (the tasks that touch hook + prompt files matched by CLAUDE.md's post-task hook globs)
- [ ] Migration ordering is sequential and won't conflict with existing migrations 075 / 076
