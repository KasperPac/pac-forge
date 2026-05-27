# FDS Monitor Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface `MonitorV2` authoring in the spec-builder matrix view via one reusable `MonitorPicker` dialog with two entry points (state-level + per-step buttons in `fds-table-pane.tsx`).

**Architecture:** A single dialog component (`MonitorPicker`) takes a `monitors: MonitorV2[]` slice + callbacks and is opened from buttons rendered inside `fds-table-pane`. The pane handles persistence by mutating its `SequentialStateV2` and calling the existing `onUpdateState` callback (which routes through `updateSequential.mutate` in `fds-co-author.tsx` → no new supabase code needed). Step-level monitors are carried through the pane's `FlatStep` representation by adding a `monitors` field that `toFlatSteps`/`fromFlatSteps` round-trip; state-level monitors live directly on `SequentialStateV2.state_monitors` and are preserved via the existing `...currentState` spread in the pane's `save()` helper.

**Tech Stack:** TypeScript 5.9, React 19, Vite 7, Vitest, React Testing Library, Zod, shadcn/ui (Dialog, Select, Switch, Checkbox, RadioGroup), `@/hooks/use-toast`.

**Spec:** `Docs/superpowers/specs/2026-05-27-fds-monitor-picker-design.md`

---

## Pre-flight

**Branch:** Cut a new feature branch off master at task start.

```bash
git checkout -b feature/fds-monitor-picker master
```

**Files this plan touches:**

Create:
- `src/components/spec-builder/monitors/monitor-helpers.ts`
- `src/components/spec-builder/monitors/monitor-condition-form.tsx`
- `src/components/spec-builder/monitors/monitor-effect-form.tsx`
- `src/components/spec-builder/monitors/monitor-picker.tsx`
- `src/components/spec-builder/monitors/__tests__/monitor-helpers.test.ts`
- `src/components/spec-builder/monitors/__tests__/monitor-condition-form.test.tsx`
- `src/components/spec-builder/monitors/__tests__/monitor-effect-form.test.tsx`
- `src/components/spec-builder/monitors/__tests__/monitor-picker.test.tsx`
- `src/components/spec-builder/monitors/__tests__/monitor-pane-integration.test.tsx`

Modify:
- `src/components/spec-builder/fds-table-pane.tsx` — `FlatStep` gains `monitors`, `toFlatSteps`/`fromFlatSteps` round-trip, state-header monitor button, per-step monitor button.

**Key facts to anchor coding decisions** (from `src/types/spec-contract-v2.ts`):

- `MonitorV2`: `{ monitor_id, condition: CompletionCriterion, effect: "alarm"|"fault"|"hold"|"branch_to", fault_ref?: { fault_code, severity }, target_step_id?, auto_clear, priority }`.
- `CompletionCriterion` is a discriminated union on `kind`. The picker handles only `tag_equals` / `tag_compare` / `expression` (the three watchdog-relevant kinds).
- `FaultSeverity`: `"warning" | "fault" | "critical"`.
- `SequentialStateV2`: has `state_monitors?: MonitorV2[]` at the state level and `steps[*].monitors?: MonitorV2[]` at the step level.
- `StepV2.monitors` is optional. `toFlatSteps` currently drops it; `fromFlatSteps` currently writes `monitors: []` — both need to round-trip the field for Phase 4 to land.

**Pane callback chain** (no supabase from inside the pane):

```
MonitorPicker.onChange(next)
  → fds-table-pane handler (mutates local state + calls onUpdateState)
  → fds-co-author.handleUpdateSequentialState
  → updateSequential.mutate({ id, state_id, data })  ← existing TanStack mutation
```

---

## Conventions

- Test runner: `vitest`. Run a file with `npx vitest run <path>`. Run by test name with `-t "<name>"`.
- All new files start with a one-line JSDoc header explaining the file's responsibility.
- Imports use the `@/` alias (resolves to `src/`).
- Each task ends with a commit using a heredoc message + `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>` trailer.
- The user's working tree has unrelated WIP on quote/tnc/variations files. **Always use explicit file paths in `git add`** — never `git add .` / `git add -A`.
- Do not skip the "run test, see it fail" TDD step.
- shadcn primitives are in `src/components/ui/`. The dialog primitive is `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogDescription`/`DialogFooter`.

---

### Task 1: Monitor helpers (createDefaultMonitor / summariseMonitor / validateMonitor)

**Files:**
- Create: `src/components/spec-builder/monitors/monitor-helpers.ts`
- Test: `src/components/spec-builder/monitors/__tests__/monitor-helpers.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/components/spec-builder/monitors/__tests__/monitor-helpers.test.ts
import { describe, expect, it } from "vitest";
import { MonitorV2Schema, type MonitorV2 } from "@/types/spec-contract-v2";
import {
  createDefaultMonitor,
  summariseMonitor,
  validateMonitor,
} from "../monitor-helpers";

describe("createDefaultMonitor", () => {
  it("returns a MonitorV2Schema.parse()-passing object", () => {
    const m = createDefaultMonitor();
    expect(() => MonitorV2Schema.parse(m)).not.toThrow();
  });

  it("defaults to tag_equals + fault effect", () => {
    const m = createDefaultMonitor();
    expect(m.condition.kind).toBe("tag_equals");
    expect(m.effect).toBe("fault");
    expect(m.fault_ref?.fault_code).toBe("F_NEW");
    expect(m.auto_clear).toBe(false);
    expect(m.priority).toBe(0);
  });

  it("assigns a unique monitor_id each call", () => {
    const a = createDefaultMonitor();
    const b = createDefaultMonitor();
    expect(a.monitor_id).not.toBe(b.monitor_id);
  });
});

describe("summariseMonitor", () => {
  const base: MonitorV2 = {
    monitor_id: "m1",
    condition: { kind: "tag_equals", tag: "E_STOP_PB", value: false },
    effect: "fault",
    fault_ref: { fault_code: "F_ESTOP", severity: "fault" },
    auto_clear: false,
    priority: 0,
  };

  it("summarises tag_equals + fault", () => {
    expect(summariseMonitor(base)).toBe("E_STOP_PB = false → fault F_ESTOP");
  });

  it("summarises tag_compare + alarm", () => {
    expect(
      summariseMonitor({
        ...base,
        condition: { kind: "tag_compare", tag: "TEMP", op: ">", value: 90 },
        effect: "alarm",
        fault_ref: { fault_code: "A_HIGH_TEMP", severity: "warning" },
      }),
    ).toBe("TEMP > 90 → alarm A_HIGH_TEMP");
  });

  it("summarises hold (no fault_ref)", () => {
    expect(
      summariseMonitor({
        ...base,
        condition: { kind: "tag_equals", tag: "DOOR_OPEN", value: true },
        effect: "hold",
        fault_ref: undefined,
      }),
    ).toBe("DOOR_OPEN = true → hold");
  });

  it("summarises branch_to with target_step_id", () => {
    expect(
      summariseMonitor({
        ...base,
        condition: { kind: "tag_equals", tag: "RETRY_FLAG", value: true },
        effect: "branch_to",
        target_step_id: "s-3-2",
        fault_ref: undefined,
      }),
    ).toBe("RETRY_FLAG = true → branch to s-3-2");
  });

  it("summarises expression", () => {
    expect(
      summariseMonitor({
        ...base,
        condition: {
          kind: "expression",
          text: "PUMP_RUN AND NOT FILL_OK",
          referenced_tags: ["PUMP_RUN", "FILL_OK"],
        },
      }),
    ).toBe("PUMP_RUN AND NOT FILL_OK → fault F_ESTOP");
  });

  it("includes within_ms in summary when set", () => {
    expect(
      summariseMonitor({
        ...base,
        condition: { kind: "tag_equals", tag: "FB_RUN", value: false, within_ms: 5000 },
      }),
    ).toBe("FB_RUN = false (5000ms) → fault F_ESTOP");
  });
});

describe("validateMonitor", () => {
  const base: MonitorV2 = {
    monitor_id: "m1",
    condition: { kind: "tag_equals", tag: "X", value: true },
    effect: "fault",
    fault_ref: { fault_code: "F_X", severity: "fault" },
    auto_clear: false,
    priority: 0,
  };

  it("returns ok=true for a well-formed monitor", () => {
    expect(validateMonitor(base)).toEqual({ ok: true });
  });

  it("rejects blank tag in tag_equals condition", () => {
    const result = validateMonitor({ ...base, condition: { kind: "tag_equals", tag: "", value: true } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /tag/i.test(e))).toBe(true);
  });

  it("rejects fault effect without fault_ref", () => {
    const result = validateMonitor({ ...base, fault_ref: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /fault_ref/i.test(e))).toBe(true);
  });

  it("rejects alarm effect without fault_ref", () => {
    const result = validateMonitor({ ...base, effect: "alarm", fault_ref: undefined });
    expect(result.ok).toBe(false);
  });

  it("rejects branch_to effect without target_step_id", () => {
    const result = validateMonitor({ ...base, effect: "branch_to", fault_ref: undefined, target_step_id: undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /target_step_id/i.test(e))).toBe(true);
  });

  it("rejects blank fault_code", () => {
    const result = validateMonitor({ ...base, fault_ref: { fault_code: "", severity: "fault" } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => /fault_code/i.test(e))).toBe(true);
  });

  it("accepts hold effect without fault_ref or target_step_id", () => {
    const result = validateMonitor({
      ...base,
      effect: "hold",
      fault_ref: undefined,
    });
    expect(result.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/spec-builder/monitors/__tests__/monitor-helpers.test.ts`
Expected: FAIL — cannot resolve `../monitor-helpers`.

- [ ] **Step 3: Implement the helpers**

```ts
// src/components/spec-builder/monitors/monitor-helpers.ts
/**
 * Pure helpers for the MonitorPicker dialog: default construction,
 * one-line summary rendering for list rows, and inline validation
 * (Zod safeParse + effect-specific business rules).
 */
import { MonitorV2Schema, type CompletionCriterion, type MonitorV2 } from "@/types/spec-contract-v2";

export function createDefaultMonitor(): MonitorV2 {
  return {
    monitor_id: crypto.randomUUID(),
    condition: { kind: "tag_equals", tag: "", value: true },
    effect: "fault",
    fault_ref: { fault_code: "F_NEW", severity: "fault" },
    auto_clear: false,
    priority: 0,
  };
}

function summariseCondition(c: CompletionCriterion): string {
  const tail = "within_ms" in c && c.within_ms != null ? ` (${c.within_ms}ms)` : "";
  switch (c.kind) {
    case "tag_equals":
      return `${c.tag || "?"} = ${String(c.value)}${tail}`;
    case "tag_compare":
      return `${c.tag || "?"} ${c.op} ${c.value}${tail}`;
    case "expression":
      return `${c.text || "(no expression)"}${tail}`;
    case "manual_ack":
      return `manual: ${c.prompt}`;
    case "placeholder":
      return `placeholder: ${c.prompt}`;
  }
}

function summariseEffect(m: MonitorV2): string {
  switch (m.effect) {
    case "alarm":
      return `alarm ${m.fault_ref?.fault_code ?? "?"}`;
    case "fault":
      return `fault ${m.fault_ref?.fault_code ?? "?"}`;
    case "hold":
      return "hold";
    case "branch_to":
      return `branch to ${m.target_step_id ?? "?"}`;
  }
}

export function summariseMonitor(m: MonitorV2): string {
  return `${summariseCondition(m.condition)} → ${summariseEffect(m)}`;
}

export type ValidateResult = { ok: true } | { ok: false; errors: string[] };

export function validateMonitor(m: MonitorV2): ValidateResult {
  const errors: string[] = [];

  // Schema-level
  const parsed = MonitorV2Schema.safeParse(m);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
  }

  // Condition-level business rules
  if (m.condition.kind === "tag_equals" || m.condition.kind === "tag_compare") {
    if (!m.condition.tag || m.condition.tag.trim() === "") {
      errors.push("condition.tag: tag is required");
    }
  }
  if (m.condition.kind === "expression") {
    if (!m.condition.text || m.condition.text.trim() === "") {
      errors.push("condition.text: expression is required");
    }
  }

  // Effect-level business rules
  if ((m.effect === "alarm" || m.effect === "fault") && !m.fault_ref) {
    errors.push("fault_ref: required for alarm and fault effects");
  }
  if (m.fault_ref && (!m.fault_ref.fault_code || m.fault_ref.fault_code.trim() === "")) {
    errors.push("fault_ref.fault_code: code is required");
  }
  if (m.effect === "branch_to" && (!m.target_step_id || m.target_step_id.trim() === "")) {
    errors.push("target_step_id: required for branch_to effect");
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/spec-builder/monitors/__tests__/monitor-helpers.test.ts`
Expected: PASS — 14 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/spec-builder/monitors/monitor-helpers.ts src/components/spec-builder/monitors/__tests__/monitor-helpers.test.ts
git commit -m "$(cat <<'EOF'
feat(fds-engine): monitor-helpers — default + summary + validation

Foundational helpers for the MonitorPicker dialog (Phase 4):
createDefaultMonitor for the Add button, summariseMonitor for list
rows, validateMonitor wrapping Zod safeParse + effect-specific
business rules (alarm/fault need fault_ref, branch_to needs
target_step_id, etc).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Monitor condition form (kind picker + per-kind body)

**Files:**
- Create: `src/components/spec-builder/monitors/monitor-condition-form.tsx`
- Test: `src/components/spec-builder/monitors/__tests__/monitor-condition-form.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/spec-builder/monitors/__tests__/monitor-condition-form.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CompletionCriterion } from "@/types/spec-contract-v2";
import { MonitorConditionForm } from "../monitor-condition-form";

describe("MonitorConditionForm", () => {
  it("renders tag_equals tag + value fields", () => {
    const onChange = vi.fn();
    render(
      <MonitorConditionForm
        condition={{ kind: "tag_equals", tag: "E_STOP", value: false }}
        availableTags={["E_STOP", "FB_RUN"]}
        onChange={onChange}
      />,
    );
    expect(screen.getByDisplayValue("E_STOP")).toBeInTheDocument();
    // boolean value renders as a "True"/"False" select
    expect(screen.getByRole("combobox", { name: /value/i })).toBeInTheDocument();
  });

  it("switches kind to tag_compare and resets fields", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MonitorConditionForm
        condition={{ kind: "tag_equals", tag: "TEMP", value: true }}
        availableTags={["TEMP"]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: /kind/i }));
    await user.click(screen.getByRole("option", { name: /tag_compare/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "tag_compare", tag: "TEMP", op: "==", value: 0 }),
    );
  });

  it("switches kind to expression and renders textarea + referenced_tags chips", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MonitorConditionForm
        condition={{ kind: "expression", text: "X AND Y", referenced_tags: ["X", "Y"] }}
        availableTags={["X", "Y", "Z"]}
        onChange={onChange}
      />,
    );
    expect(screen.getByDisplayValue("X AND Y")).toBeInTheDocument();
    // chips for referenced tags
    expect(screen.getByText("X")).toBeInTheDocument();
    expect(screen.getByText("Y")).toBeInTheDocument();
    // user edits the textarea
    const ta = screen.getByDisplayValue("X AND Y");
    await user.clear(ta);
    await user.type(ta, "Z");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "expression", text: "Z" }),
    );
  });

  it("within_ms input round-trips", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const initial: CompletionCriterion = { kind: "tag_equals", tag: "X", value: true };
    render(
      <MonitorConditionForm condition={initial} availableTags={["X"]} onChange={onChange} />,
    );
    const input = screen.getByLabelText(/timeout/i);
    await user.type(input, "5000");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ within_ms: 5000 }),
    );
  });

  it("tag_compare op selection updates condition", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MonitorConditionForm
        condition={{ kind: "tag_compare", tag: "PRES", op: "==", value: 0 }}
        availableTags={["PRES"]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: /operator/i }));
    await user.click(screen.getByRole("option", { name: ">" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ op: ">" }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/spec-builder/monitors/__tests__/monitor-condition-form.test.tsx`
Expected: FAIL — cannot resolve `../monitor-condition-form`.

- [ ] **Step 3: Implement the form**

```tsx
// src/components/spec-builder/monitors/monitor-condition-form.tsx
/**
 * Condition picker for a single monitor. Kind Select (tag_equals /
 * tag_compare / expression) + per-kind body + optional within_ms.
 * Pure UI — parent owns state; this component just renders + calls
 * onChange with the next condition.
 */
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { X } from "lucide-react";
import type { CompletionCriterion } from "@/types/spec-contract-v2";

interface Props {
  condition: CompletionCriterion;
  availableTags: string[];
  onChange: (next: CompletionCriterion) => void;
}

type SupportedKind = "tag_equals" | "tag_compare" | "expression";

function isSupported(c: CompletionCriterion): c is Extract<CompletionCriterion, { kind: SupportedKind }> {
  return c.kind === "tag_equals" || c.kind === "tag_compare" || c.kind === "expression";
}

function defaultFor(kind: SupportedKind, prevTag = ""): CompletionCriterion {
  switch (kind) {
    case "tag_equals":
      return { kind: "tag_equals", tag: prevTag, value: true };
    case "tag_compare":
      return { kind: "tag_compare", tag: prevTag, op: "==", value: 0 };
    case "expression":
      return { kind: "expression", text: "", referenced_tags: [] };
  }
}

function patchWithinMs<T extends CompletionCriterion>(c: T, within_ms: number | undefined): T {
  if (!isSupported(c)) return c;
  const next = { ...c };
  if (within_ms === undefined) delete (next as { within_ms?: number }).within_ms;
  else (next as { within_ms?: number }).within_ms = within_ms;
  return next;
}

export function MonitorConditionForm({ condition, availableTags, onChange }: Props) {
  if (!isSupported(condition)) {
    // Picker doesn't author manual_ack / placeholder; fall back to a reset.
    return (
      <div className="text-xs text-muted-foreground">
        Unsupported condition kind: {condition.kind}.{" "}
        <Button variant="link" size="sm" onClick={() => onChange(defaultFor("tag_equals"))}>
          Reset to tag_equals
        </Button>
      </div>
    );
  }

  const current = condition;
  const withinMs = (current as { within_ms?: number }).within_ms;

  const updateKind = (next: SupportedKind) => {
    const prevTag = current.kind === "expression" ? "" : current.tag;
    onChange(defaultFor(next, prevTag));
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[120px_1fr] items-center gap-2">
        <Label className="text-xs">Kind</Label>
        <Select value={current.kind} onValueChange={(v) => updateKind(v as SupportedKind)}>
          <SelectTrigger aria-label="Kind" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tag_equals">tag_equals</SelectItem>
            <SelectItem value="tag_compare">tag_compare</SelectItem>
            <SelectItem value="expression">expression</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {current.kind === "tag_equals" && (
        <>
          <div className="grid grid-cols-[120px_1fr] items-center gap-2">
            <Label className="text-xs">Tag</Label>
            <Input
              list="monitor-tag-options"
              value={current.tag}
              onChange={(e) => onChange({ ...current, tag: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div className="grid grid-cols-[120px_1fr] items-center gap-2">
            <Label className="text-xs">Value</Label>
            <Select
              value={String(current.value)}
              onValueChange={(v) =>
                onChange({ ...current, value: v === "true" ? true : v === "false" ? false : Number(v) || v })
              }
            >
              <SelectTrigger aria-label="Value" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">True</SelectItem>
                <SelectItem value="false">False</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {current.kind === "tag_compare" && (
        <>
          <div className="grid grid-cols-[120px_1fr] items-center gap-2">
            <Label className="text-xs">Tag</Label>
            <Input
              list="monitor-tag-options"
              value={current.tag}
              onChange={(e) => onChange({ ...current, tag: e.target.value })}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div className="grid grid-cols-[120px_1fr_1fr] items-center gap-2">
            <Label className="text-xs">Operator</Label>
            <Select
              value={current.op}
              onValueChange={(v) => onChange({ ...current, op: v as typeof current.op })}
            >
              <SelectTrigger aria-label="Operator" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["<", "<=", ">", ">=", "=="] as const).map((op) => (
                  <SelectItem key={op} value={op}>
                    {op}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              value={current.value}
              onChange={(e) => onChange({ ...current, value: Number(e.target.value) })}
              className="h-8 text-xs font-mono"
            />
          </div>
        </>
      )}

      {current.kind === "expression" && (
        <>
          <div className="grid grid-cols-[120px_1fr] items-start gap-2">
            <Label className="text-xs pt-2">Expression</Label>
            <Textarea
              value={current.text}
              onChange={(e) => onChange({ ...current, text: e.target.value })}
              className="text-xs font-mono min-h-[60px]"
            />
          </div>
          <div className="grid grid-cols-[120px_1fr] items-start gap-2">
            <Label className="text-xs pt-1">Referenced tags</Label>
            <div className="flex flex-wrap gap-1">
              {current.referenced_tags.map((t) => (
                <Badge key={t} variant="outline" className="text-xs font-mono">
                  {t}
                  <button
                    aria-label={`Remove ${t}`}
                    className="ml-1 hover:text-destructive"
                    onClick={() =>
                      onChange({ ...current, referenced_tags: current.referenced_tags.filter((x) => x !== t) })
                    }
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              <Input
                placeholder="Add tag…"
                list="monitor-tag-options"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const input = e.currentTarget;
                    const v = input.value.trim();
                    if (v && !current.referenced_tags.includes(v)) {
                      onChange({ ...current, referenced_tags: [...current.referenced_tags, v] });
                      input.value = "";
                    }
                  }
                }}
                className="h-6 text-xs font-mono w-32"
              />
            </div>
          </div>
        </>
      )}

      <div className="grid grid-cols-[120px_1fr] items-center gap-2">
        <Label className="text-xs" htmlFor="monitor-within-ms">
          Timeout (ms)
        </Label>
        <Input
          id="monitor-within-ms"
          type="number"
          value={withinMs ?? ""}
          onChange={(e) => {
            const v = e.target.value;
            const n = v === "" ? undefined : Number(v);
            onChange(patchWithinMs(current, n));
          }}
          placeholder="(no timeout)"
          className="h-8 text-xs font-mono w-32"
        />
      </div>

      <datalist id="monitor-tag-options">
        {availableTags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/spec-builder/monitors/__tests__/monitor-condition-form.test.tsx`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/spec-builder/monitors/monitor-condition-form.tsx src/components/spec-builder/monitors/__tests__/monitor-condition-form.test.tsx
git commit -m "$(cat <<'EOF'
feat(fds-engine): MonitorConditionForm (tag_equals / tag_compare / expression)

Kind Select switches the body; tag inputs use a datalist autocomplete
from availableTags. Optional within_ms timeout input. manual_ack /
placeholder kinds are not surfaced (do not fit watchdog semantics);
the form falls back to a reset if seeded with one.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Monitor effect form (effect radio + per-effect extras)

**Files:**
- Create: `src/components/spec-builder/monitors/monitor-effect-form.tsx`
- Test: `src/components/spec-builder/monitors/__tests__/monitor-effect-form.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/spec-builder/monitors/__tests__/monitor-effect-form.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MonitorV2 } from "@/types/spec-contract-v2";
import { MonitorEffectForm } from "../monitor-effect-form";

const baseMonitor: MonitorV2 = {
  monitor_id: "m1",
  condition: { kind: "tag_equals", tag: "X", value: true },
  effect: "fault",
  fault_ref: { fault_code: "F_X", severity: "fault" },
  auto_clear: false,
  priority: 0,
};

describe("MonitorEffectForm", () => {
  it("renders fault_ref fields for fault effect", () => {
    render(
      <MonitorEffectForm monitor={baseMonitor} availableStepIds={[]} onChange={vi.fn()} />,
    );
    expect(screen.getByDisplayValue("F_X")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /severity/i })).toBeInTheDocument();
  });

  it("renders fault_ref fields for alarm effect", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MonitorEffectForm monitor={baseMonitor} availableStepIds={[]} onChange={onChange} />,
    );
    await user.click(screen.getByLabelText(/alarm/i));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ effect: "alarm" }),
    );
  });

  it("renders no fault_ref / target_step_id for hold effect", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MonitorEffectForm monitor={baseMonitor} availableStepIds={[]} onChange={onChange} />,
    );
    await user.click(screen.getByLabelText(/^hold$/i));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ effect: "hold", fault_ref: undefined, target_step_id: undefined }),
    );
  });

  it("renders target_step_id Select for branch_to effect", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <MonitorEffectForm
        monitor={baseMonitor}
        availableStepIds={["s-3-1", "s-3-2", "s-3-3"]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByLabelText(/branch/i));
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as MonitorV2;
    rerender(
      <MonitorEffectForm
        monitor={last}
        availableStepIds={["s-3-1", "s-3-2", "s-3-3"]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: /target step/i }));
    await user.click(screen.getByRole("option", { name: "s-3-2" }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ effect: "branch_to", target_step_id: "s-3-2" }),
    );
  });

  it("auto_clear checkbox round-trips", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MonitorEffectForm monitor={baseMonitor} availableStepIds={[]} onChange={onChange} />,
    );
    await user.click(screen.getByRole("checkbox", { name: /auto-clear/i }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ auto_clear: true }),
    );
  });

  it("priority input round-trips", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MonitorEffectForm monitor={baseMonitor} availableStepIds={[]} onChange={onChange} />,
    );
    const input = screen.getByLabelText(/priority/i);
    await user.clear(input);
    await user.type(input, "5");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ priority: 5 }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/spec-builder/monitors/__tests__/monitor-effect-form.test.tsx`
Expected: FAIL — cannot resolve `../monitor-effect-form`.

- [ ] **Step 3: Implement the form**

```tsx
// src/components/spec-builder/monitors/monitor-effect-form.tsx
/**
 * Effect picker for a single monitor. Effect radio (alarm/fault/hold/
 * branch_to) + per-effect extras (fault_ref / target_step_id) +
 * auto_clear + priority. Parent owns state.
 */
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FaultRef, MonitorV2 } from "@/types/spec-contract-v2";

interface Props {
  monitor: MonitorV2;
  availableStepIds: string[];
  onChange: (next: MonitorV2) => void;
}

type Effect = MonitorV2["effect"];

const SEVERITY_OPTIONS = ["warning", "fault", "critical"] as const;

function nextFaultRefForEffect(effect: Effect, prev: FaultRef | undefined): FaultRef | undefined {
  if (effect === "alarm" || effect === "fault") {
    return prev ?? { fault_code: "F_NEW", severity: "fault" };
  }
  return undefined;
}

function nextTargetForEffect(effect: Effect, prev: string | undefined): string | undefined {
  return effect === "branch_to" ? (prev ?? "") : undefined;
}

export function MonitorEffectForm({ monitor, availableStepIds, onChange }: Props) {
  const updateEffect = (e: Effect) => {
    onChange({
      ...monitor,
      effect: e,
      fault_ref: nextFaultRefForEffect(e, monitor.fault_ref),
      target_step_id: nextTargetForEffect(e, monitor.target_step_id),
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[120px_1fr] items-start gap-2">
        <Label className="text-xs pt-1">Effect</Label>
        <RadioGroup
          value={monitor.effect}
          onValueChange={(v) => updateEffect(v as Effect)}
          className="grid grid-cols-2 gap-1"
        >
          {(["alarm", "fault", "hold", "branch_to"] as const).map((e) => (
            <div key={e} className="flex items-center gap-2">
              <RadioGroupItem id={`effect-${e}`} value={e} />
              <Label htmlFor={`effect-${e}`} className="text-xs capitalize cursor-pointer">
                {e === "branch_to" ? "Branch to step" : e}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>

      {(monitor.effect === "alarm" || monitor.effect === "fault") && monitor.fault_ref && (
        <>
          <div className="grid grid-cols-[120px_1fr] items-center gap-2">
            <Label className="text-xs">Fault code</Label>
            <Input
              value={monitor.fault_ref.fault_code}
              onChange={(e) => {
                const fault_code = e.target.value.toUpperCase();
                onChange({
                  ...monitor,
                  fault_ref: { ...monitor.fault_ref!, fault_code },
                });
              }}
              className="h-8 text-xs font-mono"
            />
          </div>
          <div className="grid grid-cols-[120px_1fr] items-center gap-2">
            <Label className="text-xs">Severity</Label>
            <Select
              value={monitor.fault_ref.severity}
              onValueChange={(v) =>
                onChange({
                  ...monitor,
                  fault_ref: { ...monitor.fault_ref!, severity: v as (typeof SEVERITY_OPTIONS)[number] },
                })
              }
            >
              <SelectTrigger aria-label="Severity" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SEVERITY_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {monitor.effect === "branch_to" && (
        <div className="grid grid-cols-[120px_1fr] items-center gap-2">
          <Label className="text-xs">Target step</Label>
          <Select
            value={monitor.target_step_id ?? ""}
            onValueChange={(v) => onChange({ ...monitor, target_step_id: v })}
          >
            <SelectTrigger aria-label="Target step" className="h-8 text-xs">
              <SelectValue placeholder="(pick step)" />
            </SelectTrigger>
            <SelectContent>
              {availableStepIds.map((id) => (
                <SelectItem key={id} value={id}>
                  {id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="grid grid-cols-[120px_1fr] items-center gap-2">
        <Label className="text-xs">Auto-clear</Label>
        <div className="flex items-center gap-2">
          <Checkbox
            id="monitor-auto-clear"
            checked={monitor.auto_clear}
            onCheckedChange={(v) => onChange({ ...monitor, auto_clear: v === true })}
            aria-label="Auto-clear when condition clears"
          />
          <Label htmlFor="monitor-auto-clear" className="text-xs text-muted-foreground cursor-pointer">
            Automatically reset when condition clears
          </Label>
        </div>
      </div>

      <div className="grid grid-cols-[120px_1fr] items-center gap-2">
        <Label className="text-xs" htmlFor="monitor-priority">
          Priority
        </Label>
        <Input
          id="monitor-priority"
          type="number"
          value={monitor.priority}
          onChange={(e) => onChange({ ...monitor, priority: Number(e.target.value) || 0 })}
          className="h-8 text-xs font-mono w-32"
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/spec-builder/monitors/__tests__/monitor-effect-form.test.tsx`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/spec-builder/monitors/monitor-effect-form.tsx src/components/spec-builder/monitors/__tests__/monitor-effect-form.test.tsx
git commit -m "$(cat <<'EOF'
feat(fds-engine): MonitorEffectForm (alarm/fault/hold/branch_to)

Effect radio + per-effect extras: fault_ref (fault_code uppercase
coerced + severity Select) for alarm/fault; target_step_id Select
populated from availableStepIds for branch_to; nothing extra for
hold. auto_clear + priority always shown.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Monitor picker dialog (list + selection + save/cancel)

**Files:**
- Create: `src/components/spec-builder/monitors/monitor-picker.tsx`
- Test: `src/components/spec-builder/monitors/__tests__/monitor-picker.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/spec-builder/monitors/__tests__/monitor-picker.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MonitorV2 } from "@/types/spec-contract-v2";
import { MonitorPicker } from "../monitor-picker";

const seed: MonitorV2[] = [
  {
    monitor_id: "m1",
    condition: { kind: "tag_equals", tag: "E_STOP", value: false },
    effect: "fault",
    fault_ref: { fault_code: "F_ESTOP", severity: "fault" },
    auto_clear: false,
    priority: 0,
  },
];

function renderPicker(overrides: Partial<React.ComponentProps<typeof MonitorPicker>> = {}) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(
    <MonitorPicker
      open
      title="Monitors"
      monitors={seed}
      availableStepIds={["s-3-1", "s-3-2"]}
      availableTags={["E_STOP", "FB_RUN"]}
      onChange={onChange}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onChange, onClose };
}

describe("MonitorPicker", () => {
  it("renders the seed monitor in the list", () => {
    renderPicker();
    expect(screen.getByText(/E_STOP = false/)).toBeInTheDocument();
    expect(screen.getByText(/fault F_ESTOP/)).toBeInTheDocument();
  });

  it("Add appends a new default monitor", async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole("button", { name: /add/i }));
    // Two list rows now
    expect(screen.getAllByText(/→/).length).toBeGreaterThanOrEqual(2);
  });

  it("Save calls onChange with the current monitors and closes", async () => {
    const user = userEvent.setup();
    const { onChange, onClose } = renderPicker();
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onChange).toHaveBeenCalledWith(seed);
    expect(onClose).toHaveBeenCalled();
  });

  it("Cancel discards local edits", async () => {
    const user = userEvent.setup();
    const { onChange, onClose } = renderPicker();
    await user.click(screen.getByRole("button", { name: /add/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Delete removes the selected monitor", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();
    // Select the row, then click delete
    await user.click(screen.getByText(/E_STOP = false/));
    await user.click(screen.getByRole("button", { name: /delete monitor/i }));
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("Save is disabled when the selected monitor is invalid", async () => {
    const user = userEvent.setup();
    renderPicker({
      monitors: [
        {
          monitor_id: "bad",
          condition: { kind: "tag_equals", tag: "", value: true },
          effect: "fault",
          fault_ref: { fault_code: "F_X", severity: "fault" },
          auto_clear: false,
          priority: 0,
        },
      ],
    });
    await user.click(screen.getByText(/= true/));
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/spec-builder/monitors/__tests__/monitor-picker.test.tsx`
Expected: FAIL — cannot resolve `../monitor-picker`.

- [ ] **Step 3: Implement the picker**

```tsx
// src/components/spec-builder/monitors/monitor-picker.tsx
/**
 * Dialog for authoring a MonitorV2[] slice. Used both for step-level
 * monitors (StepV2.monitors) and state-level monitors
 * (SequentialStateV2.state_monitors) — same shape, two entry points.
 *
 * Holds a local copy of the array so Cancel is a real cancel; Save
 * calls onChange with the mutated array. Per-monitor validation gates
 * Save (errors listed inline above the footer).
 */
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AlarmTier, MonitorV2 } from "@/types/spec-contract-v2";
import { MonitorConditionForm } from "./monitor-condition-form";
import { MonitorEffectForm } from "./monitor-effect-form";
import { createDefaultMonitor, summariseMonitor, validateMonitor } from "./monitor-helpers";

interface Props {
  open: boolean;
  title: string;
  monitors: MonitorV2[];
  availableStepIds: string[];
  availableTags: string[];
  availableAlarmTiers?: AlarmTier[]; // currently informational
  onChange: (next: MonitorV2[]) => void;
  onClose: () => void;
}

const EFFECT_CHIP: Record<MonitorV2["effect"], string> = {
  alarm: "bg-amber-500/10 text-amber-300 border-amber-500/30",
  fault: "bg-red-500/10 text-red-300 border-red-500/30",
  hold: "bg-blue-500/10 text-blue-300 border-blue-500/30",
  branch_to: "bg-purple-500/10 text-purple-300 border-purple-500/30",
};

export function MonitorPicker({
  open,
  title,
  monitors,
  availableStepIds,
  availableTags,
  onChange,
  onClose,
}: Props) {
  const [local, setLocal] = useState<MonitorV2[]>(monitors);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(monitors.length > 0 ? 0 : null);

  // Re-seed when the dialog reopens with fresh props.
  useEffect(() => {
    if (open) {
      setLocal(monitors);
      setSelectedIdx(monitors.length > 0 ? 0 : null);
    }
  }, [open, monitors]);

  const selected = selectedIdx != null ? local[selectedIdx] : null;
  const validationOfSelected = useMemo(
    () => (selected ? validateMonitor(selected) : { ok: true as const }),
    [selected],
  );
  const allValid = useMemo(() => local.every((m) => validateMonitor(m).ok), [local]);

  const update = (next: MonitorV2) => {
    if (selectedIdx == null) return;
    setLocal((prev) => prev.map((m, i) => (i === selectedIdx ? next : m)));
  };

  const add = () => {
    const next = createDefaultMonitor();
    setLocal((prev) => [...prev, next]);
    setSelectedIdx(local.length);
  };

  const remove = (idx: number) => {
    setLocal((prev) => prev.filter((_, i) => i !== idx));
    setSelectedIdx((cur) => {
      if (cur == null) return null;
      if (cur === idx) return null;
      if (cur > idx) return cur - 1;
      return cur;
    });
  };

  const handleSave = () => {
    if (!allValid) return;
    onChange(local);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-[260px_1fr] gap-4 min-h-[360px]">
          {/* Left — list */}
          <div className="border rounded-md p-2 space-y-1 overflow-y-auto max-h-[400px]">
            <Button size="sm" variant="outline" className="w-full justify-start" onClick={add}>
              <Plus className="h-3 w-3 mr-1" /> Add
            </Button>
            {local.length === 0 && (
              <p className="text-xs text-muted-foreground px-2 py-1">No monitors yet.</p>
            )}
            {local.map((m, i) => {
              const summary = summariseMonitor(m);
              const isSelected = i === selectedIdx;
              return (
                <button
                  key={m.monitor_id}
                  type="button"
                  onClick={() => setSelectedIdx(i)}
                  className={`w-full text-left p-2 rounded text-xs border ${
                    isSelected ? "bg-accent border-accent-foreground/20" : "border-transparent hover:bg-muted"
                  }`}
                >
                  <div className="flex items-center gap-1 mb-1">
                    <Badge variant="outline" className={`text-[10px] ${EFFECT_CHIP[m.effect]}`}>
                      {m.effect}
                    </Badge>
                  </div>
                  <span className="font-mono leading-tight">{summary}</span>
                </button>
              );
            })}
          </div>

          {/* Right — form */}
          <div className="space-y-3">
            {selected ? (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase text-muted-foreground">Condition</p>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => selectedIdx != null && remove(selectedIdx)}
                    aria-label="Delete monitor"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
                <MonitorConditionForm
                  condition={selected.condition}
                  availableTags={availableTags}
                  onChange={(c) => update({ ...selected, condition: c })}
                />
                <p className="text-xs font-semibold uppercase text-muted-foreground mt-3">Effect</p>
                <MonitorEffectForm
                  monitor={selected}
                  availableStepIds={availableStepIds}
                  onChange={update}
                />
                {!validationOfSelected.ok && (
                  <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-xs text-destructive">
                    <ul className="list-disc pl-4 space-y-0.5">
                      {validationOfSelected.errors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <div className="text-xs text-muted-foreground py-8 text-center">
                Select a monitor from the list, or click Add.
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!allValid}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/spec-builder/monitors/__tests__/monitor-picker.test.tsx`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/components/spec-builder/monitors/monitor-picker.tsx src/components/spec-builder/monitors/__tests__/monitor-picker.test.tsx
git commit -m "$(cat <<'EOF'
feat(fds-engine): MonitorPicker dialog

Two-pane shadcn Dialog: scrollable monitor list on the left + a single-
monitor form on the right composed from MonitorConditionForm +
MonitorEffectForm. Save is gated by per-monitor validation; Cancel
drops the local copy untouched. Used for both step-monitors and
state-monitors (same shape).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Round-trip step-level monitors through FlatStep

**Files:**
- Modify: `src/components/spec-builder/fds-table-pane.tsx`
- Test: extend `src/components/spec-builder/monitors/__tests__/monitor-pane-integration.test.tsx` (created here)

The matrix pane's `FlatStep` representation currently drops `StepV2.monitors`. Add the field, wire it through `toFlatSteps` (read) and `fromFlatSteps` (write).

- [ ] **Step 1: Write the round-trip test**

```tsx
// src/components/spec-builder/monitors/__tests__/monitor-pane-integration.test.tsx
import { describe, expect, it } from "vitest";
import type { SequentialStateV2, MonitorV2 } from "@/types/spec-contract-v2";
import { __testing } from "@/components/spec-builder/fds-table-pane";

const monitor: MonitorV2 = {
  monitor_id: "m1",
  condition: { kind: "tag_equals", tag: "E_STOP", value: false },
  effect: "fault",
  fault_ref: { fault_code: "F_ESTOP", severity: "fault" },
  auto_clear: false,
  priority: 0,
};

describe("FlatStep monitors round-trip", () => {
  it("preserves StepV2.monitors through toFlatSteps → fromFlatSteps", () => {
    const state: SequentialStateV2 = {
      permissives: [],
      notes: null,
      steps: [
        {
          step_id: "s-1",
          step: 10,
          action: "Start motor",
          completion_criteria: [],
          completion_criteria_text: "",
          monitors: [monitor],
        },
      ],
    };
    const flat = __testing.toFlatSteps(state);
    expect(flat[0].monitors).toHaveLength(1);
    expect(flat[0].monitors?.[0].monitor_id).toBe("m1");

    const partial = __testing.fromFlatSteps(flat);
    expect(partial.steps?.[0].monitors).toHaveLength(1);
    expect(partial.steps?.[0].monitors?.[0].monitor_id).toBe("m1");
  });

  it("defaults to empty monitors when the step doesn't carry any", () => {
    const state: SequentialStateV2 = {
      permissives: [],
      notes: null,
      steps: [
        { step_id: "s-1", step: 10, action: "x", completion_criteria: [], completion_criteria_text: "" },
      ],
    };
    const flat = __testing.toFlatSteps(state);
    expect(flat[0].monitors ?? []).toHaveLength(0);
    const partial = __testing.fromFlatSteps(flat);
    expect(partial.steps?.[0].monitors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/spec-builder/monitors/__tests__/monitor-pane-integration.test.tsx`
Expected: FAIL — `__testing` export not present OR `flat[0].monitors` is undefined.

- [ ] **Step 3: Modify `fds-table-pane.tsx`**

Open `src/components/spec-builder/fds-table-pane.tsx` and make three edits:

a. Add `monitors` to the `FlatStep` interface (around line 67):

```ts
interface FlatStep {
  step_id: string; // UUID (internal key)
  step: string; // Display number "10", "20", "21" — AI-assigned, editable
  action: string; // Free text
  outputs: SimpleOutput[];
  branches: SimpleBranch[]; // 1 = normal step, 2+ = branch step
  timeout_ms?: number;
  monitors?: MonitorV2[]; // V2 step-monitors; round-tripped through to/fromFlatSteps
}
```

b. In `toFlatSteps`, the returned object at line ~377 — add `monitors`:

```ts
      return {
        step_id: stepId,
        step: String(sv2.step),
        action: sv2.action,
        outputs,
        branches,
        timeout_ms: sv2.timeout_ms,
        monitors: sv2.monitors ?? [],
      };
```

c. In `fromFlatSteps`, replace the `monitors: []` line at line ~445 with `monitors: flat.monitors ?? []`:

```ts
    return {
      step_id: flat.step_id,
      step: parseInt(flat.step) || 0,
      action: flat.action,
      completion_criteria_text: completionCriteriaText,
      completion_criteria: completionCriteria,
      actions,
      transitions,
      monitors: flat.monitors ?? [],
      on_fail: undefined,
      timeout_ms: flat.timeout_ms,
    };
```

d. Add `MonitorV2` to the existing `@/types/spec-contract-v2` import at the top of the file (find the line importing `ActionV2`, etc., and add `MonitorV2` to the list).

e. At the bottom of the file (after the default export or last export), add a testing escape hatch:

```ts
// Exposed for unit tests — these helpers are pure and have stable input/output.
export const __testing = {
  toFlatSteps,
  fromFlatSteps,
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/spec-builder/monitors/__tests__/monitor-pane-integration.test.tsx`
Expected: PASS — 2 tests.

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/spec-builder/fds-table-pane.tsx src/components/spec-builder/monitors/__tests__/monitor-pane-integration.test.tsx
git commit -m "$(cat <<'EOF'
feat(fds-engine): FlatStep round-trips step-level monitors

Previously toFlatSteps dropped StepV2.monitors and fromFlatSteps
wrote monitors:[], so any monitor authored before today would have
been wiped on the next save. Adds monitors? to FlatStep and threads
the field through both conversion functions. Test fixture exercises
both directions.

Also exports an internal `__testing` namespace so the conversion
helpers can be unit-tested without rendering the pane.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Wire state-level monitor button into the matrix pane

**Files:**
- Modify: `src/components/spec-builder/fds-table-pane.tsx`

Add a "State Monitors (N)" button in the state header area and a handler that opens the picker scoped to `currentState.state_monitors`. On save, build an updated `SequentialStateV2` and call `onUpdateState`.

- [ ] **Step 1: Locate the state header**

Read `src/components/spec-builder/fds-table-pane.tsx` around the active-tab/state header rendering (search for `activeTab` to find where the state title/permissives are rendered — likely between the tabs and the matrix table, somewhere around line 880-920 based on the earlier grep showing permissive UI at line 920).

Identify a sensible insertion point near the state title (next to the permissives summary or the state's "notes" field).

- [ ] **Step 2: Add MonitorPicker import + state**

Near the top of the file (with the other component imports), add:

```ts
import { MonitorPicker } from "./monitors/monitor-picker";
import type { MonitorV2 } from "@/types/spec-contract-v2";
```

(Skip the `MonitorV2` line if already imported.)

Inside the `FdsTablePane` function (with the other `useState` hooks around line 624), add:

```ts
const [stateMonitorPickerOpen, setStateMonitorPickerOpen] = useState(false);
const [stepMonitorPickerStepId, setStepMonitorPickerStepId] = useState<string | null>(null);
```

(The `stepMonitorPickerStepId` is for Task 7 — declare both here to avoid two edits to the same hook block.)

- [ ] **Step 3: Add handler for state-monitor save**

Inside the component, near the existing `save` callback (around line 658), add:

```ts
const saveStateMonitors = useCallback(
  (next: MonitorV2[]) => {
    const updated: SequentialStateV2 = {
      ...currentState,
      state_monitors: next,
      sequence_model_version: 2,
    };
    onUpdateState(activeTab, updated);
  },
  [activeTab, currentState, onUpdateState],
);
```

(The `SequentialStateV2` type should already be in scope from the file's existing imports.)

- [ ] **Step 4: Insert the state-monitor button**

Add a button somewhere in the state header. A minimal addition near the permissive UI block:

```tsx
<Button
  variant="outline"
  size="sm"
  onClick={() => setStateMonitorPickerOpen(true)}
  className="h-7 text-xs"
>
  State Monitors ({(currentState.state_monitors ?? []).length})
</Button>
```

(`Button` is already imported; if not, import from `@/components/ui/button`.)

- [ ] **Step 5: Render the MonitorPicker at the bottom of the component**

Just before the closing `</div>` of the component's top-level JSX (or alongside any existing dialog renders), add:

```tsx
<MonitorPicker
  open={stateMonitorPickerOpen}
  title={`State Monitors — ${activeTab}`}
  monitors={currentState.state_monitors ?? []}
  availableStepIds={currentState.steps.map((s) => s.step_id ?? "").filter(Boolean)}
  availableTags={allTags.map((t) => t.tag)}
  onChange={saveStateMonitors}
  onClose={() => setStateMonitorPickerOpen(false)}
/>
```

- [ ] **Step 6: Type check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Run the existing fds-table-pane tests (if any) + the monitors test suite**

Run: `npx vitest run src/components/spec-builder/monitors`
Expected: PASS — all monitor tests still pass; nothing regressed.

- [ ] **Step 8: Commit**

```bash
git add src/components/spec-builder/fds-table-pane.tsx
git commit -m "$(cat <<'EOF'
feat(fds-engine): state-level MonitorPicker entry in matrix pane

Adds a "State Monitors (N)" button in the state header that opens the
MonitorPicker scoped to currentState.state_monitors. Save propagates
through the existing onUpdateState callback chain → no new supabase
code in the pane.

Step-monitor entry in the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Wire step-level monitor button into each step row

**Files:**
- Modify: `src/components/spec-builder/fds-table-pane.tsx`

- [ ] **Step 1: Locate the step row rendering**

Find where each `flatSteps` row is rendered (look for `flatSteps.map` or the matrix-row rendering — around line 1030-1090 based on the earlier grep). The control column (`_ctrl`) is the natural place for a per-row button.

- [ ] **Step 2: Add saveStepMonitors handler**

Near the existing `updateStep` callback (around line 713), add:

```ts
const saveStepMonitors = useCallback(
  (stepId: string, next: MonitorV2[]) => {
    const nextFlat = flatSteps.map((f) => (f.step_id === stepId ? { ...f, monitors: next } : f));
    setFlatSteps(nextFlat);
    save(nextFlat);
  },
  [flatSteps, save],
);
```

- [ ] **Step 3: Add the per-row button**

In the row rendering (inside the `_ctrl` column for the primary row of each step — typically the existing Delete button block), add a "Monitors (N)" button:

```tsx
<Button
  variant="ghost"
  size="sm"
  onClick={() => setStepMonitorPickerStepId(flat.step_id)}
  className="h-6 text-[10px]"
>
  Monitors ({(flat.monitors ?? []).length})
</Button>
```

Only render this button on the primary row (`branchIdx === 0`) — same condition the existing Delete button uses.

- [ ] **Step 4: Render the step-scoped MonitorPicker**

Below the state-monitor MonitorPicker from Task 6, add:

```tsx
{(() => {
  const targetFlat = stepMonitorPickerStepId
    ? flatSteps.find((f) => f.step_id === stepMonitorPickerStepId)
    : undefined;
  if (!targetFlat) return null;
  return (
    <MonitorPicker
      open={!!stepMonitorPickerStepId}
      title={`Step ${targetFlat.step} Monitors`}
      monitors={targetFlat.monitors ?? []}
      availableStepIds={flatSteps.map((f) => f.step_id)}
      availableTags={allTags.map((t) => t.tag)}
      onChange={(next) => saveStepMonitors(targetFlat.step_id, next)}
      onClose={() => setStepMonitorPickerStepId(null)}
    />
  );
})()}
```

- [ ] **Step 5: Type check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Re-run the monitor suite**

Run: `npx vitest run src/components/spec-builder/monitors`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/spec-builder/fds-table-pane.tsx
git commit -m "$(cat <<'EOF'
feat(fds-engine): per-step MonitorPicker entry in matrix pane

Each step's control column gains a "Monitors (N)" button that opens
the picker scoped to that step's monitors. Save threads through
flatSteps so the existing save() helper (which rebuilds the V2 state
via fromFlatSteps) carries the new monitors. Round-trip is already
tested in Task 5.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Pane integration test — save call shape

**Files:**
- Modify: `src/components/spec-builder/monitors/__tests__/monitor-pane-integration.test.tsx` (extend)

Render `FdsTablePane` with a stub `onUpdateState`, open the picker via the buttons, save a new monitor, and assert the callback fires with the expected `SequentialStateV2` shape.

- [ ] **Step 1: Extend the integration test**

Append to `src/components/spec-builder/monitors/__tests__/monitor-pane-integration.test.tsx`:

```tsx
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { FdsTablePane } from "@/components/spec-builder/fds-table-pane";
import type { OperatingState } from "@/types/spec-builder";

const sequentialState: OperatingState = {
  state_id: "execute",
  state_name: "Execute",
  description: "x",
  state_pattern: "sequential",
};

const stateData: Record<string, SequentialStateV2> = {
  execute: {
    permissives: [],
    notes: null,
    steps: [
      {
        step_id: "s-1",
        step: 10,
        action: "Start motor",
        completion_criteria: [],
        completion_criteria_text: "",
        monitors: [],
      },
    ],
    state_monitors: [],
  },
};

describe("FdsTablePane — MonitorPicker integration", () => {
  it("opens the state-monitor picker and propagates a saved monitor through onUpdateState", async () => {
    const user = userEvent.setup();
    const onUpdateState = vi.fn();
    render(
      <FdsTablePane
        sequentialStates={[sequentialState]}
        stateData={stateData}
        onUpdateState={onUpdateState}
        allTags={[{ tag: "E_STOP", io_address: "%I0.0", signal_type: "DI", description: "" } as never]}
      />,
    );

    await user.click(screen.getByRole("button", { name: /state monitors/i }));
    await user.click(screen.getByRole("button", { name: /add/i }));
    // The default monitor has tag="" — invalid. Fill the tag.
    const tagInput = screen.getAllByRole("textbox").find((el) => el.getAttribute("list") === "monitor-tag-options");
    if (!tagInput) throw new Error("tag input not found");
    await user.type(tagInput, "E_STOP");
    await user.click(screen.getByRole("button", { name: /save/i }));

    expect(onUpdateState).toHaveBeenCalled();
    const [stateId, updated] = onUpdateState.mock.calls[onUpdateState.mock.calls.length - 1] as [
      string,
      SequentialStateV2,
    ];
    expect(stateId).toBe("execute");
    expect(updated.state_monitors).toHaveLength(1);
    expect(updated.state_monitors?.[0].condition.kind).toBe("tag_equals");
    if (updated.state_monitors?.[0].condition.kind === "tag_equals") {
      expect(updated.state_monitors[0].condition.tag).toBe("E_STOP");
    }
  });
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npx vitest run src/components/spec-builder/monitors/__tests__/monitor-pane-integration.test.tsx`
Expected: PASS — round-trip tests + integration test.

If a test fails because the test renderer can't find a particular role (e.g. shadcn Select renders aria-hidden until clicked), adjust the selector — but do NOT silence the assertion that `onUpdateState` was called with `state_monitors: [...]`.

- [ ] **Step 3: Commit**

```bash
git add src/components/spec-builder/monitors/__tests__/monitor-pane-integration.test.tsx
git commit -m "$(cat <<'EOF'
test(fds-engine): pane integration — state-monitor save reaches onUpdateState

Renders FdsTablePane with a stub onUpdateState, opens the state-monitor
picker via its button, adds a monitor, fills the tag (default is blank
and would fail validation), clicks Save. Asserts onUpdateState fires
with the new state_monitors array.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full type check**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 2: Full test suite**

Run: `npx vitest run`
Expected: all monitor tests pass (33 new ones across 5 files); pre-existing failures on the user's WIP quote/tnc files are acceptable (not touched here). Note count for the report.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: Lint sweep (only check our new files)**

Run: `npx eslint src/components/spec-builder/monitors src/components/spec-builder/fds-table-pane.tsx`
Expected: 0 errors. Warnings on pre-existing patterns acceptable.

- [ ] **Step 5: Manual smoke (pre-merge, in browser)**

Start the dev server: `npm run dev`. In a browser:

1. Open a project's matrix view; pick a sequential state (e.g. Starting).
2. Click "State Monitors (0)" in the state header. Picker opens. Click Add. Tag becomes blank → Save disabled → inline error shows.
3. Fill tag (e.g. `E_STOP_PB`), Save. Modal closes; button now reads "State Monitors (1)". Reload — count persists.
4. On any step row, click "Monitors (0)". Picker opens. Add a `tag_compare` monitor (e.g. `TEMP > 90`) with `effect: alarm`, `fault_code: A_HIGH_TEMP`. Save. Reload — persists.
5. Cancel test: open a picker, Add a monitor, Cancel. Reload — count unchanged.
6. Branch-to test: in a state with ≥2 steps, add a monitor with `effect: branch_to` → target step Select shows the sibling step ids → pick one → Save. Persist.
7. Confirm no console errors mentioning Zod or schema parse failures.

Report verification results.

---

## Phase done

When all 9 tasks check out, MonitorV2 authoring is live in the matrix view for both step-level and state-level monitors. The feature branch is ready to either merge to `master` (use `superpowers:finishing-a-development-branch`) or open as a PR.
