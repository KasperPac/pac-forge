/**
 * FDS Co-Author — Flat step editor for sequential states.
 *
 * Replaces the previous discriminated-union ActionBuilder/ExpressionBuilder
 * with a simple flat model where spec step numbers = PLC CASE step numbers.
 *
 * Internal types are local to this file (not exported). The public Props
 * interface matches the V2 contract types.
 */
import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, Trash2, ChevronUp, ChevronDown, Pencil } from "lucide-react";
import type { OperatingState, InstrumentTag } from "@/types/spec-builder";
import type {
  SequentialStateV2,
  CompletionCriterion,
  ActionV2,
  MonitorV2,
  PermissiveCondition,
  PermissiveValue,
} from "@/types/spec-contract-v2";
import { cn } from "@/lib/utils";
import { useResizableColumns } from "@/hooks/use-resizable-columns";
import { ActionBuilder } from "./pickers/action-builder";
import { ExpressionBuilder } from "./pickers/expression-builder";
import { MonitorPicker } from "./monitors/monitor-picker";

// ---------------------------------------------------------------------------
// Internal flat types
// ---------------------------------------------------------------------------

interface SimpleCondition {
  id: string;
  tag: string;
  op: "=" | "!=" | ">" | "<" | ">=" | "<=";
  value: string; // engineer types "TRUE", "FALSE", "1500", etc.
  within_ms?: number;
  on_fail_code?: string;
  on_fail_severity?: "warning" | "fault" | "critical";
}

interface SimpleOutput {
  id: string;
  tag: string;
  value: string; // "TRUE", "FALSE", "1500", etc.
}

interface SimpleBranch {
  id: string;
  conditions: SimpleCondition[];
  next_step: string; // "10", "20", "DONE" — editable string
}

interface FlatStep {
  step_id: string; // UUID (internal key)
  step: string; // Display number "10", "20", "21" — AI-assigned, editable
  action: string; // Free text
  outputs: SimpleOutput[];
  branches: SimpleBranch[]; // 1 = normal step, 2+ = branch step
  timeout_ms?: number;
  monitors?: MonitorV2[]; // V2 step-monitors; round-tripped through to/fromFlatSteps
}

type RowType = "action" | "monitor" | "branch" | "fault_exit" | "merge";

interface MatrixRow {
  step_id: string;       // FlatStep.step_id
  branchIdx: number;     // 0 = primary row
  branchId: string;      // SimpleBranch.id
  stepLabel: string;     // "10" or "10a"/"10b"
  type: RowType;
  isPrimary: boolean;
}

const ROW_TYPE_STYLE: Record<RowType, { chip: string; rowTint: string; label: string }> = {
  action:     { chip: "bg-teal-500/10 text-teal-300 border-teal-500/30",     rowTint: "",                       label: "action" },
  monitor:    { chip: "bg-purple-500/10 text-purple-300 border-purple-500/30", rowTint: "bg-purple-500/[0.04]", label: "monitor" },
  branch:     { chip: "bg-blue-500/10 text-blue-300 border-blue-500/30",     rowTint: "bg-blue-500/[0.04]",    label: "branch" },
  fault_exit: { chip: "bg-red-500/15 text-red-300 border-red-500/40",        rowTint: "bg-red-500/[0.06]",     label: "fault" },
  merge:      { chip: "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",     rowTint: "",                       label: "merge" },
};

function branchSuffix(idx: number, branchCount: number): string {
  if (branchCount <= 1) return "";
  return String.fromCharCode(97 + idx); // 0='a', 1='b', ...
}

function deriveRowTypeFor(
  flat: FlatStep,
  branchIdx: number,
  mergeStepIds: Set<string>,
): RowType {
  const branch = flat.branches[branchIdx];
  if (branch?.next_step === "FAULT") return "fault_exit";
  if (branchIdx > 0 && flat.branches.length > 1) return "branch";
  if (flat.outputs.length === 0 && (branch?.conditions.length ?? 0) > 0) return "monitor";
  // Merge = convergence target with no conditions of its own (pure join point).
  // Steps that actively monitor/branch are monitor/action, not merge.
  if (branchIdx === 0 && mergeStepIds.has(flat.step_id) && (branch?.conditions.length ?? 0) === 0 && flat.outputs.length === 0) return "merge";
  return "action";
}

type MatrixCol = "Step" | "Condition" | "Action" | "Output" | "Next" | "_ctrl";
const MATRIX_COLS: readonly MatrixCol[] = [
  "Step",
  "Condition",
  "Action",
  "Output",
  "Next",
  "_ctrl",
] as const;
const MATRIX_COL_LABELS: Record<MatrixCol, string> = {
  Step: "Step",
  Condition: "Condition",
  Action: "Action",
  Output: "Output",
  Next: "Next",
  _ctrl: "",
};

function flattenForMatrix(flatSteps: FlatStep[]): MatrixRow[] {
  // Compute incoming convergence: count distinct source steps that target each step.
  const incoming = new Map<string, Set<string>>();
  const stepNumberToId = new Map<string, string>();
  for (const f of flatSteps) stepNumberToId.set(f.step, f.step_id);
  for (const f of flatSteps) {
    for (const b of f.branches) {
      const targetId = stepNumberToId.get(b.next_step);
      if (!targetId) continue;
      if (!incoming.has(targetId)) incoming.set(targetId, new Set());
      incoming.get(targetId)!.add(f.step_id);
    }
  }
  const mergeStepIds = new Set<string>();
  for (const [stepId, srcs] of incoming) {
    if (srcs.size >= 2) mergeStepIds.add(stepId);
  }

  const rows: MatrixRow[] = [];
  for (const flat of flatSteps) {
    flat.branches.forEach((b, i) => {
      rows.push({
        step_id: flat.step_id,
        branchIdx: i,
        branchId: b.id,
        stepLabel: flat.step + branchSuffix(i, flat.branches.length),
        type: deriveRowTypeFor(flat, i, mergeStepIds),
        isPrimary: i === 0,
      });
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Tiny uuid helper (crypto.randomUUID with fallback)
// ---------------------------------------------------------------------------

function uid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ---------------------------------------------------------------------------
// Value helpers
// ---------------------------------------------------------------------------

function parseValue(s: string): boolean | number | string {
  const lower = s.trim().toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  const n = Number(s.trim());
  if (!isNaN(n) && s.trim() !== "") return n;
  return s;
}

function inferValueType(s: string): "boolean" | "number" | "string" {
  const v = parseValue(s);
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return "number";
  return "string";
}

function sourceValueToString(source: { kind: string; value?: unknown; tag?: string; text?: string }): string {
  if (source.kind === "literal") return String(source.value ?? "");
  if (source.kind === "tag_ref") return String(source.tag ?? "");
  if (source.kind === "expr_text") return String(source.text ?? "");
  return "";
}

// ---------------------------------------------------------------------------
// criterionToSimpleCondition
// ---------------------------------------------------------------------------

function criterionToSimpleCondition(c: CompletionCriterion): SimpleCondition {
  if (c.kind === "tag_equals") {
    return {
      id: uid(),
      tag: c.tag,
      op: "=",
      value: String(c.value),
      within_ms: c.within_ms,
      on_fail_code: c.on_fail?.fault_code,
      on_fail_severity: c.on_fail?.severity,
    };
  }
  if (c.kind === "tag_compare") {
    // Map == → =
    const opMap: Record<string, SimpleCondition["op"]> = {
      "<": "<",
      "<=": "<=",
      ">": ">",
      ">=": ">=",
      "==": "=",
    };
    return {
      id: uid(),
      tag: c.tag,
      op: opMap[c.op] ?? "=",
      value: String(c.value),
      within_ms: c.within_ms,
      on_fail_code: c.on_fail?.fault_code,
      on_fail_severity: c.on_fail?.severity,
    };
  }
  // expression / manual_ack / placeholder — degrade gracefully
  return { id: uid(), tag: "?", op: "=", value: "?" };
}

// ---------------------------------------------------------------------------
// simpleConditionToCriterion
// ---------------------------------------------------------------------------

function simpleConditionToCriterion(c: SimpleCondition): CompletionCriterion {
  const on_fail =
    c.on_fail_code
      ? { fault_code: c.on_fail_code, severity: c.on_fail_severity ?? "fault" as const }
      : undefined;

  if (c.op === "=" || c.op === "!=") {
    // Use tag_equals for = only; != must fall back to expression
    if (c.op === "=") {
      return {
        kind: "tag_equals",
        tag: c.tag,
        value: parseValue(c.value),
        within_ms: c.within_ms,
        on_fail,
      };
    }
    return {
      kind: "expression",
      text: `${c.tag} ${c.op} ${c.value}`,
      referenced_tags: [c.tag],
      within_ms: c.within_ms,
      on_fail,
    };
  }

  // Numeric compare — tag_compare uses == only, so use expression for the rest
  if (c.op === ">" || c.op === "<" || c.op === ">=" || c.op === "<=") {
    const numVal = parseValue(c.value);
    if (typeof numVal === "number") {
      const opMap: Record<string, "<" | "<=" | ">" | ">=" | "=="> = {
        "<": "<", "<=": "<=", ">": ">", ">=": ">=",
      };
      return {
        kind: "tag_compare",
        tag: c.tag,
        op: opMap[c.op],
        value: numVal,
        within_ms: c.within_ms,
        on_fail,
      };
    }
    return {
      kind: "expression",
      text: `${c.tag} ${c.op} ${c.value}`,
      referenced_tags: [c.tag],
      within_ms: c.within_ms,
      on_fail,
    };
  }

  return {
    kind: "expression",
    text: `${c.tag} ${c.op} ${c.value}`,
    referenced_tags: [c.tag],
    within_ms: c.within_ms,
    on_fail,
  };
}

// ---------------------------------------------------------------------------
// toFlatSteps — SequentialStateV2 → FlatStep[]
// ---------------------------------------------------------------------------

function toFlatSteps(state: SequentialStateV2): FlatStep[] {
  // Build step_id → step number map for resolving transitions
  const idToStepNum = new Map<string, string>();
  for (const sv2 of state.steps) {
    if (sv2.step_id) {
      idToStepNum.set(sv2.step_id, String(sv2.step));
    }
  }

  return state.steps
    .map((sv2): FlatStep => {
      const stepId = sv2.step_id ?? uid();

      // Outputs from assign actions
      let outputs: SimpleOutput[] = [];
      if (sv2.actions && sv2.actions.length > 0) {
        outputs = sv2.actions
          .filter((a) => a.kind === "assign")
          .map((a) => {
            const assign = a as Extract<ActionV2, { kind: "assign" }>;
            return {
              id: uid(),
              tag: assign.target_tag,
              value: sourceValueToString(assign.source as { kind: string; value?: unknown; tag?: string; text?: string }),
            };
          });
      }

      // Branches from transitions, then completion_criteria, then default
      let branches: SimpleBranch[];

      if (sv2.transitions && sv2.transitions.length > 0) {
        branches = sv2.transitions
          .filter((t) => t.kind === "single")
          .map((t): SimpleBranch => {
            const single = t as Extract<typeof t, { kind: "single" }>;
            const nextStepNum = idToStepNum.get(single.target_step_id) ?? "DONE";
            const hasFault = !!single.on_fail || single.guard.some(
              (g) => "on_fail" in g && !!(g as { on_fail?: unknown }).on_fail,
            );
            const effectiveNext =
              !single.target_step_id || single.target_step_id === ""
                ? (hasFault ? "FAULT" : "DONE")
                : nextStepNum;
            return {
              id: uid(),
              conditions: single.guard.map(criterionToSimpleCondition),
              next_step: effectiveNext,
            };
          });
        if (branches.length === 0) {
          branches = [{ id: uid(), conditions: [], next_step: "DONE" }];
        }
      } else if (Array.isArray(sv2.completion_criteria) && sv2.completion_criteria.length > 0) {
        branches = [
          {
            id: uid(),
            conditions: sv2.completion_criteria.map(criterionToSimpleCondition),
            next_step: "DONE",
          },
        ];
      } else {
        branches = [{ id: uid(), conditions: [], next_step: "DONE" }];
      }

      return {
        step_id: stepId,
        step: String(sv2.step),
        action: sv2.action,
        outputs,
        branches,
        timeout_ms: sv2.timeout_ms,
        monitors: sv2.monitors ?? [],
      };
    })
    .sort((a, b) => (parseInt(a.step) || 0) - (parseInt(b.step) || 0));
}

// ---------------------------------------------------------------------------
// fromFlatSteps — FlatStep[] → Partial<SequentialStateV2>
// ---------------------------------------------------------------------------

function fromFlatSteps(flatSteps: FlatStep[]): Partial<SequentialStateV2> {
  // Build stepNumber → step_id map
  const stepNumberToId: Record<string, string> = {};
  for (const flat of flatSteps) {
    stepNumberToId[flat.step] = flat.step_id;
  }

  const steps = flatSteps.map((flat) => {
    const completionCriteriaText =
      flat.branches[0]?.conditions
        .map((c) => `${c.tag} ${c.op} ${c.value}`)
        .join(" AND ") ?? "";

    const completionCriteria =
      flat.branches[0]?.conditions.map(simpleConditionToCriterion) ?? [];

    const actions: ActionV2[] = flat.outputs.map((o) => ({
      kind: "assign" as const,
      action_id: uid(),
      target_tag: o.tag,
      source: {
        kind: "literal" as const,
        value: parseValue(o.value),
        value_type: inferValueType(o.value),
      },
      prose: `${o.tag} = ${o.value}`,
    }));

    const transitions = flat.branches.map((b, i) => {
      const isDone =
        b.next_step === "DONE" ||
        b.next_step === "FAULT" ||
        !stepNumberToId[b.next_step];
      return {
        transition_id: uid(),
        kind: "single" as const,
        target_step_id: isDone ? "" : (stepNumberToId[b.next_step] ?? ""),
        guard: b.conditions.map(simpleConditionToCriterion),
        priority: i,
        is_default: i === 0,
        notes: null,
      };
    });

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
  });

  return { steps };
}

// ---------------------------------------------------------------------------
// Tag picker popover
// ---------------------------------------------------------------------------

function TagPickerPopover({
  value,
  allTags,
  onSelect,
  placeholder,
}: {
  value: string;
  allTags: InstrumentTag[];
  onSelect: (tag: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const filterRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open && filterRef.current) {
      filterRef.current.focus();
    }
  }, [open]);

  const filtered = allTags.filter(
    (t) =>
      t.tag.toLowerCase().includes(filter.toLowerCase()) ||
      t.description.toLowerCase().includes(filter.toLowerCase()),
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Input
          className="h-6 text-[11px] font-mono w-36 cursor-pointer"
          value={value}
          readOnly
          placeholder={placeholder ?? "TAG"}
          onClick={() => setOpen(true)}
        />
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2" align="start">
        <Input
          ref={filterRef}
          className="h-6 text-xs mb-2"
          placeholder="Filter tags..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div className="max-h-48 overflow-auto space-y-0.5">
          {filtered.length === 0 && (
            <p className="text-[11px] text-muted-foreground px-1 py-2">No tags match</p>
          )}
          {filtered.map((t) => (
            <button
              key={t.tag}
              className="w-full text-left px-2 py-1 rounded hover:bg-accent flex flex-col gap-0"
              onClick={() => {
                onSelect(t.tag);
                setOpen(false);
                setFilter("");
              }}
            >
              <span className="text-[11px] font-mono text-foreground">{t.tag}</span>
              <span className="text-[10px] text-muted-foreground">{t.description}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Permissive row types (structured)
// ---------------------------------------------------------------------------

interface StructuredPermissive {
  id: string;
  tag: string;
  op: "=" | "!=" | ">" | "<" | ">=" | "<=";
  value: string;
}

function parsePermissives(raw: unknown): StructuredPermissive[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p): StructuredPermissive => {
    // New schema: PermissiveCondition object { tag, operator, value }
    if (p && typeof p === "object") {
      const obj = p as { tag?: unknown; operator?: unknown; value?: unknown };
      const op = typeof obj.operator === "string" ? obj.operator : "=";
      let value = "";
      if (obj.value === true) value = "TRUE";
      else if (obj.value === false) value = "FALSE";
      else if (obj.value !== undefined && obj.value !== null) value = String(obj.value);
      return {
        id: uid(),
        tag: typeof obj.tag === "string" ? obj.tag : "",
        op: op as StructuredPermissive["op"],
        value,
      };
    }
    // Legacy: free-text string "TAG op VALUE"
    const text = String(p);
    const match = text.match(/^(\S+)\s*(>=|<=|!=|=|>|<)\s*(\S+)/);
    if (match) {
      return {
        id: uid(),
        tag: match[1],
        op: match[2] as StructuredPermissive["op"],
        value: match[3],
      };
    }
    return { id: uid(), tag: text, op: "=" as const, value: "" };
  });
}

function coercePermissiveValue(raw: string): PermissiveValue {
  const v = raw.trim();
  if (v === "P_TRIG" || v === "N_TRIG") return v;
  const upper = v.toUpperCase();
  if (upper === "TRUE" || upper === "1") return true;
  if (upper === "FALSE" || upper === "0" || v === "") return false;
  const n = Number(v);
  if (!Number.isNaN(n)) return n;
  return false;
}

function permissivesToConditions(perms: StructuredPermissive[]): PermissiveCondition[] {
  return perms.map((p) => ({
    tag: p.tag,
    operator: p.op,
    value: coercePermissiveValue(p.value),
  }));
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  sequentialStates: OperatingState[];
  stateData: Record<string, SequentialStateV2>;
  onUpdateState: (stateId: string, data: SequentialStateV2) => void;
  specProjectId?: string;
  allTags?: InstrumentTag[];
}

const EMPTY_V2: SequentialStateV2 = {
  permissives: [],
  steps: [],
  notes: null,
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FdsTablePane({
  sequentialStates,
  stateData,
  onUpdateState,
  allTags = [],
}: Props) {
  const [activeTab, setActiveTab] = useState(sequentialStates[0]?.state_id ?? "");

  const currentState: SequentialStateV2 = stateData[activeTab] ?? EMPTY_V2;

  // Keep flat steps in local state — synced from currentState on tab change
  const [flatSteps, setFlatSteps] = useState<FlatStep[]>(() =>
    toFlatSteps(currentState),
  );

  // Structured permissives local state
  const [structuredPerms, setStructuredPerms] = useState<StructuredPermissive[]>(() =>
    parsePermissives(currentState.permissives),
  );

  // Monitor picker dialog state
  const [stateMonitorPickerOpen, setStateMonitorPickerOpen] = useState(false);
  const [stepMonitorPickerStepId, setStepMonitorPickerStepId] = useState<string | null>(null);

  // Re-sync when the active tab changes or external state arrives
  const prevTabRef = useRef(activeTab);
  const prevStepsCountRef = useRef(currentState.steps.length);

  useEffect(() => {
    const tabChanged = prevTabRef.current !== activeTab;
    // Also re-sync if external steps count changed significantly (AI update)
    const extCount = (stateData[activeTab]?.steps ?? []).length;
    const stepsChanged = extCount !== prevStepsCountRef.current && extCount !== flatSteps.length;

    if (tabChanged || stepsChanged) {
      const s = stateData[activeTab] ?? EMPTY_V2;
      setFlatSteps(toFlatSteps(s));
      setStructuredPerms(parsePermissives(s.permissives));
      prevTabRef.current = activeTab;
      prevStepsCountRef.current = s.steps.length;
    }
    // We intentionally only react to activeTab and stateData key changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, stateData]);

  // ---------------------------------------------------------------------------
  // Save helper — call after every mutation
  // ---------------------------------------------------------------------------

  const save = useCallback(
    (nextFlat: FlatStep[], nextPerms?: StructuredPermissive[]) => {
      const perms = nextPerms ?? structuredPerms;
      const partial = fromFlatSteps(nextFlat);
      const updated: SequentialStateV2 = {
        ...currentState,
        ...partial,
        permissives: permissivesToConditions(perms),
        sequence_model_version: 2,
      };
      onUpdateState(activeTab, updated);
    },
    [activeTab, currentState, onUpdateState, structuredPerms],
  );

  // ---------------------------------------------------------------------------
  // State monitor save handler
  // ---------------------------------------------------------------------------

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

  // ---------------------------------------------------------------------------
  // Step monitor save handler
  // ---------------------------------------------------------------------------

  const saveStepMonitors = useCallback(
    (stepId: string, next: MonitorV2[]) => {
      const nextFlat = flatSteps.map((f) =>
        f.step_id === stepId ? { ...f, monitors: next } : f,
      );
      setFlatSteps(nextFlat);
      save(nextFlat);
    },
    [flatSteps, save],
  );

  // ---------------------------------------------------------------------------
  // Permissive handlers
  // ---------------------------------------------------------------------------

  const addPermissive = () => {
    const next = [...structuredPerms, { id: uid(), tag: "", op: "=" as const, value: "TRUE" }];
    setStructuredPerms(next);
    save(flatSteps, next);
  };

  const updatePermissive = (idx: number, patch: Partial<StructuredPermissive>) => {
    const next = structuredPerms.map((p, i) => (i === idx ? { ...p, ...patch } : p));
    setStructuredPerms(next);
    save(flatSteps, next);
  };

  const removePermissive = (idx: number) => {
    const next = structuredPerms.filter((_, i) => i !== idx);
    setStructuredPerms(next);
    save(flatSteps, next);
  };

  // ---------------------------------------------------------------------------
  // Step handlers
  // ---------------------------------------------------------------------------

  const addStep = () => {
    const maxStep = flatSteps.reduce((m, s) => Math.max(m, parseInt(s.step) || 0), 0);
    const newStep: FlatStep = {
      step_id: uid(),
      step: String(maxStep + 10),
      action: "",
      outputs: [],
      branches: [{ id: uid(), conditions: [], next_step: "DONE" }],
    };
    const next = [...flatSteps, newStep];
    setFlatSteps(next);
    save(next);
  };

  const updateStep = (stepId: string, patch: Partial<FlatStep>) => {
    const next = flatSteps.map((s) => (s.step_id === stepId ? { ...s, ...patch } : s));
    setFlatSteps(next);
    save(next);
  };

  const removeStep = (stepId: string) => {
    const next = flatSteps.filter((s) => s.step_id !== stepId);
    setFlatSteps(next);
    save(next);
  };

  const moveStep = (stepId: string, dir: -1 | 1) => {
    const idx = flatSteps.findIndex((s) => s.step_id === stepId);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= flatSteps.length) return;

    // Swap the step numbers, keep the data in place
    const next = [...flatSteps];
    const tmpStep = next[idx].step;
    next[idx] = { ...next[idx], step: next[target].step };
    next[target] = { ...next[target], step: tmpStep };
    // Re-sort
    const sorted = [...next].sort(
      (a, b) => (parseInt(a.step) || 0) - (parseInt(b.step) || 0),
    );
    setFlatSteps(sorted);
    save(sorted);
  };

  // Output handlers
  const addOutput = (stepId: string) => {
    const next = flatSteps.map((s) =>
      s.step_id === stepId
        ? { ...s, outputs: [...s.outputs, { id: uid(), tag: "", value: "TRUE" }] }
        : s,
    );
    setFlatSteps(next);
    save(next);
  };

  const updateOutput = (stepId: string, outId: string, patch: Partial<SimpleOutput>) => {
    const next = flatSteps.map((s) =>
      s.step_id === stepId
        ? { ...s, outputs: s.outputs.map((o) => (o.id === outId ? { ...o, ...patch } : o)) }
        : s,
    );
    setFlatSteps(next);
    save(next);
  };

  const removeOutput = (stepId: string, outId: string) => {
    const next = flatSteps.map((s) =>
      s.step_id === stepId
        ? { ...s, outputs: s.outputs.filter((o) => o.id !== outId) }
        : s,
    );
    setFlatSteps(next);
    save(next);
  };

  // Branch handlers
  const addBranch = (stepId: string) => {
    const next = flatSteps.map((s) =>
      s.step_id === stepId
        ? {
            ...s,
            branches: [
              ...s.branches,
              { id: uid(), conditions: [], next_step: "DONE" },
            ],
          }
        : s,
    );
    setFlatSteps(next);
    save(next);
  };

  const removeBranch = (stepId: string, branchId: string) => {
    const next = flatSteps.map((s) => {
      if (s.step_id !== stepId) return s;
      const remaining = s.branches.filter((b) => b.id !== branchId);
      // Always keep at least one branch
      return {
        ...s,
        branches:
          remaining.length > 0
            ? remaining
            : [{ id: uid(), conditions: [], next_step: "DONE" }],
      };
    });
    setFlatSteps(next);
    save(next);
  };

  // Swap two branches by index. Indices ≥1 only — branches[0] is the default
  // and must stay primary (fromFlatSteps marks i===0 as is_default).
  const swapBranches = (stepId: string, i: number, j: number) => {
    if (i < 1 || j < 1) return;
    const next = flatSteps.map((s) => {
      if (s.step_id !== stepId) return s;
      if (i >= s.branches.length || j >= s.branches.length) return s;
      const branches = [...s.branches];
      [branches[i], branches[j]] = [branches[j], branches[i]];
      return { ...s, branches };
    });
    setFlatSteps(next);
    save(next);
  };

  const updateBranch = (stepId: string, branchId: string, patch: Partial<SimpleBranch>) => {
    const next = flatSteps.map((s) =>
      s.step_id === stepId
        ? {
            ...s,
            branches: s.branches.map((b) =>
              b.id === branchId ? { ...b, ...patch } : b,
            ),
          }
        : s,
    );
    setFlatSteps(next);
    save(next);
  };

  // Per-condition mutation goes through ConditionCell → ExpressionBuilder,
  // which round-trips the whole branch.conditions[] via updateBranch().

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const sortedFlat = useMemo(
    () =>
      [...flatSteps].sort(
        (a, b) => (parseInt(a.step) || 0) - (parseInt(b.step) || 0),
      ),
    [flatSteps],
  );

  const matrixRows = useMemo(() => flattenForMatrix(sortedFlat), [sortedFlat]);

  const { tableRef, colWidths, isFixed, onDragStart } =
    useResizableColumns(MATRIX_COLS);

  return (
    <div className="flex flex-col h-full">
      {/* State tabs */}
      <div className="flex gap-1 border-b px-2 shrink-0 overflow-x-auto">
        {sequentialStates.map((state) => {
          const data = stateData[state.state_id];
          const stepCount = data?.steps?.length ?? 0;
          return (
            <button
              key={state.state_id}
              onClick={() => setActiveTab(state.state_id)}
              className={cn(
                "px-3 py-1.5 text-xs font-medium border-b-2 transition-colors whitespace-nowrap shrink-0",
                activeTab === state.state_id
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {state.state_name}
              {stepCount > 0 && (
                <Badge
                  variant="outline"
                  className="ml-1.5 text-[9px] h-3.5 px-1"
                >
                  {stepCount}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Permissives */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Permissives
            </label>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setStateMonitorPickerOpen(true)}
                className="h-7 text-xs"
              >
                State Monitors ({(currentState.state_monitors ?? []).length})
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={addPermissive}
                className="h-6 text-[10px]"
              >
                <Plus className="h-3 w-3 mr-0.5" /> Add
              </Button>
            </div>
          </div>
          {structuredPerms.length === 0 ? (
            <p className="text-[11px] text-muted-foreground italic px-1">
              No permissives defined. Add conditions that must be TRUE before this
              sequence can begin.
            </p>
          ) : (
            <div className="space-y-1 bg-muted/30 rounded-md p-2">
              {structuredPerms.map((perm, i) => (
                <div key={perm.id} className="flex items-center gap-1">
                  <TagPickerPopover
                    value={perm.tag}
                    allTags={allTags}
                    onSelect={(tag) => updatePermissive(i, { tag })}
                    placeholder="TAG"
                  />
                  <select
                    className="h-6 text-[11px] bg-background border border-input rounded px-1 font-mono"
                    value={perm.op}
                    onChange={(e) =>
                      updatePermissive(i, {
                        op: e.target.value as StructuredPermissive["op"],
                      })
                    }
                  >
                    <option>=</option>
                    <option>!=</option>
                    <option>&gt;</option>
                    <option>&lt;</option>
                    <option>&gt;=</option>
                    <option>&lt;=</option>
                  </select>
                  <Input
                    className="h-6 text-[11px] font-mono w-20"
                    value={perm.value}
                    onChange={(e) => updatePermissive(i, { value: e.target.value })}
                    placeholder="VALUE"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => removePermissive(i)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Steps matrix */}
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border/40">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              Steps
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={addStep}
              className="h-6 text-[10px]"
            >
              <Plus className="h-3 w-3 mr-0.5" /> Add Step
            </Button>
          </div>
          <div className="overflow-x-auto">
            <table
              ref={tableRef}
              className={cn(
                "font-mono text-xs w-full",
                isFixed ? "table-fixed" : "table-auto",
              )}
              style={
                isFixed && colWidths
                  ? { width: MATRIX_COLS.reduce((s, c) => s + colWidths[c], 0) }
                  : undefined
              }
            >
              {isFixed && colWidths && (
                <colgroup>
                  {MATRIX_COLS.map((col) => (
                    <col key={col} style={{ width: colWidths[col] }} />
                  ))}
                </colgroup>
              )}
              <thead>
                <tr className="border-b border-border/40 bg-muted/20">
                  {MATRIX_COLS.map((col, idx) => (
                    <th
                      key={col}
                      className="relative px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground select-none"
                    >
                      {MATRIX_COL_LABELS[col]}
                      {idx < MATRIX_COLS.length - 1 && (
                        <div
                          className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-blue-500/40"
                          onMouseDown={(e) => onDragStart(col, e)}
                        />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrixRows.length === 0 && (
                  <tr>
                    <td
                      colSpan={MATRIX_COLS.length}
                      className="p-4 text-center text-muted-foreground text-xs"
                    >
                      No steps defined. Use the chat to describe the sequence,
                      or add steps manually.
                    </td>
                  </tr>
                )}
                {matrixRows.map((row) => {
                  const flat = sortedFlat.find((f) => f.step_id === row.step_id);
                  if (!flat) return null;
                  const branch = flat.branches[row.branchIdx];
                  if (!branch) return null;
                  const stepRowIdx = sortedFlat.findIndex(
                    (f) => f.step_id === flat.step_id,
                  );
                  return (
                    <tr
                      key={`${row.step_id}-${row.branchIdx}`}
                      className={cn(
                        "border-b border-border/20 last:border-0 transition-colors",
                        row.type === "fault_exit" ? "bg-red-500/5"
                          : row.type === "monitor" ? "bg-purple-500/5"
                          : row.type === "branch" ? "bg-blue-500/5"
                          : "",
                      )}
                    >
                      <td className="px-2 py-1.5 whitespace-nowrap overflow-hidden">
                        <StepCell
                          row={row}
                          flat={flat}
                          onChange={updateStep}
                        />
                      </td>
                      <td className="px-2 py-1.5 overflow-hidden">
                        <ConditionCell
                          branch={branch}
                          onChange={(patch) =>
                            updateBranch(flat.step_id, branch.id, patch)
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5 overflow-hidden">
                        <ActionCell
                          flat={flat}
                          onChange={updateStep}
                          onPatchOutputs={(outs) =>
                            updateStep(flat.step_id, { outputs: outs })
                          }
                        />
                      </td>
                      <td className="px-2 py-1.5 text-teal-400 overflow-hidden">
                        <OutputCell
                          flat={flat}
                          allTags={allTags}
                          onAdd={() => addOutput(flat.step_id)}
                          onUpdate={(outId, patch) =>
                            updateOutput(flat.step_id, outId, patch)
                          }
                          onRemove={(outId) =>
                            removeOutput(flat.step_id, outId)
                          }
                        />
                      </td>
                      <td className="px-2 py-1">
                        <NextCell
                          branch={branch}
                          allSteps={sortedFlat}
                          currentStepId={flat.step_id}
                          onChange={(patch) =>
                            updateBranch(flat.step_id, branch.id, patch)
                          }
                        />
                      </td>
                      <td className="px-1 py-1">
                        {row.isPrimary ? (
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setStepMonitorPickerStepId(flat.step_id)}
                              className="h-6 text-[10px]"
                            >
                              Monitors ({(flat.monitors ?? []).length})
                            </Button>
                            <RowControls
                              onAddBranch={() => addBranch(flat.step_id)}
                              onMoveUp={() => moveStep(flat.step_id, -1)}
                              onMoveDown={() => moveStep(flat.step_id, 1)}
                              onDelete={() => removeStep(flat.step_id)}
                              disableUp={stepRowIdx === 0}
                              disableDown={stepRowIdx === sortedFlat.length - 1}
                            />
                          </div>
                        ) : (
                          <BranchControls
                            branchIdx={row.branchIdx}
                            branchCount={flat.branches.length}
                            onSwapUp={() =>
                              swapBranches(
                                flat.step_id,
                                row.branchIdx,
                                row.branchIdx - 1,
                              )
                            }
                            onSwapDown={() =>
                              swapBranches(
                                flat.step_id,
                                row.branchIdx,
                                row.branchIdx + 1,
                              )
                            }
                            onDelete={() =>
                              removeBranch(flat.step_id, branch.id)
                            }
                          />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Notes */}
        {currentState.notes && (
          <div className="text-[11px] text-muted-foreground italic px-1">
            Note: {currentState.notes}
          </div>
        )}
      </div>

      {/* State-level MonitorPicker dialog */}
      <MonitorPicker
        open={stateMonitorPickerOpen}
        title={`State Monitors — ${sequentialStates.find((s) => s.state_id === activeTab)?.state_name ?? activeTab}`}
        monitors={currentState.state_monitors ?? []}
        availableStepIds={currentState.steps.map((s) => s.step_id ?? "").filter(Boolean)}
        availableTags={allTags.map((t) => t.tag)}
        onChange={saveStateMonitors}
        onClose={() => setStateMonitorPickerOpen(false)}
      />

      {/* Step-scoped MonitorPicker dialog */}
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// Matrix cell components
// ---------------------------------------------------------------------------

function StepCell({
  row,
  flat,
  onChange,
}: {
  row: MatrixRow;
  flat: FlatStep;
  onChange: (stepId: string, patch: Partial<FlatStep>) => void;
}) {
  const [editing, setEditing] = useState(false);
  const suffix = branchSuffix(row.branchIdx, flat.branches.length);
  const typeColor = ROW_TYPE_COLORS[row.type] ?? "text-muted-foreground";

  if (editing && row.isPrimary) {
    return (
      <input
        type="number"
        className="w-12 h-6 text-center font-mono text-xs bg-background border border-input rounded px-1"
        value={flat.step}
        onChange={(e) => onChange(flat.step_id, { step: e.target.value })}
        onBlur={() => setEditing(false)}
        autoFocus
      />
    );
  }

  return (
    <span
      className="whitespace-nowrap cursor-pointer"
      onClick={() => row.isPrimary && setEditing(true)}
    >
      <span className="font-bold text-primary">{flat.step}</span>
      {suffix && <span className="ml-0.5 text-muted-foreground">{suffix}</span>}
      <span className={cn("ml-1.5 text-[10px]", typeColor)}>{ROW_TYPE_STYLE[row.type].label}</span>
    </span>
  );
}

const ROW_TYPE_COLORS: Record<RowType, string> = {
  action: "text-teal-400",
  monitor: "text-purple-400",
  branch: "text-blue-400",
  fault_exit: "text-red-400",
  merge: "text-amber-400",
};

function summarizeCondition(c: SimpleCondition): string {
  return `${c.tag || "?"} ${c.op} ${c.value || "?"}`;
}

function ConditionCell({
  branch,
  onChange,
}: {
  branch: SimpleBranch;
  onChange: (patch: Partial<SimpleBranch>) => void;
}) {
  const [open, setOpen] = useState(false);

  const summary = useMemo(() => {
    if (branch.conditions.length === 0) return "(no conditions)";
    return branch.conditions.map(summarizeCondition).join(" AND ");
  }, [branch.conditions]);

  const setConditionAt = (
    idx: number,
    crit: CompletionCriterion | null,
  ) => {
    if (!crit) {
      onChange({
        conditions: branch.conditions.filter((_, i) => i !== idx),
      });
      return;
    }
    const next = [...branch.conditions];
    const converted = criterionToSimpleCondition(crit);
    // Preserve stable id for the row so React keys don't churn
    converted.id = next[idx]?.id ?? converted.id;
    next[idx] = converted;
    onChange({ conditions: next });
  };

  const addBlankCondition = () => {
    onChange({
      conditions: [
        ...branch.conditions,
        { id: uid(), tag: "", op: "=", value: "TRUE" },
      ],
    });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={cn(
            "w-full text-left text-xs font-mono truncate text-muted-foreground hover:text-foreground cursor-pointer",
            branch.conditions.length === 0 && "italic",
          )}
        >
          {summary}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[420px] p-2 space-y-2" align="start">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
          Conditions (joined with AND)
        </div>
        {branch.conditions.length === 0 && (
          <p className="text-[11px] text-muted-foreground italic">
            No conditions yet.
          </p>
        )}
        <div className="space-y-2 max-h-72 overflow-auto pr-1">
          {branch.conditions.map((cond, i) => (
            <div
              key={cond.id}
              className="border border-border/40 rounded p-1.5"
            >
              <ExpressionBuilder
                value={simpleConditionToCriterion(cond)}
                onChange={(crit) => setConditionAt(i, crit)}
              />
            </div>
          ))}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px] w-full"
          onClick={addBlankCondition}
        >
          <Plus className="h-3 w-3 mr-0.5" /> Condition
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function ActionCell({
  flat,
  onChange,
  onPatchOutputs,
}: {
  flat: FlatStep;
  onChange: (stepId: string, patch: Partial<FlatStep>) => void;
  onPatchOutputs: (outs: SimpleOutput[]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [popoverOpen, setPopoverOpen] = useState(false);

  const handleStructured = (a: ActionV2) => {
    if (a.kind === "assign") {
      const tag = a.target_tag;
      const val = sourceValueToString(
        a.source as { kind: string; value?: unknown; tag?: string; text?: string },
      );
      const existingIdx = flat.outputs.findIndex((o) => o.tag === tag);
      const nextOutputs = [...flat.outputs];
      if (existingIdx >= 0) {
        nextOutputs[existingIdx] = { ...nextOutputs[existingIdx], tag, value: val };
      } else if (tag) {
        nextOutputs.push({ id: uid(), tag, value: val });
      }
      onPatchOutputs(nextOutputs);
    }
    onChange(flat.step_id, { action: a.prose });
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          className="h-6 text-xs w-full bg-transparent border-border/60"
          value={flat.action}
          onChange={(e) => onChange(flat.step_id, { action: e.target.value })}
          onBlur={() => setEditing(false)}
          autoFocus
        />
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
              title="Structured action editor"
            >
              <Pencil className="h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[440px] p-2" align="start">
            <ActionBuilder value={null} onChange={handleStructured} />
          </PopoverContent>
        </Popover>
      </div>
    );
  }

  return (
    <span
      className={cn(
        "text-xs font-medium text-foreground truncate cursor-pointer block",
        !flat.action && "text-muted-foreground/50 italic",
      )}
      onClick={() => setEditing(true)}
    >
      {flat.action || "Describe the action..."}
    </span>
  );
}

function OutputCell({
  flat,
  allTags,
  onAdd,
  onUpdate,
  onRemove,
}: {
  flat: FlatStep;
  allTags: InstrumentTag[];
  onAdd: () => void;
  onUpdate: (outId: string, patch: Partial<SimpleOutput>) => void;
  onRemove: (outId: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (flat.outputs.length === 0) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="h-5 text-[10px] px-1 text-teal-300 hover:text-teal-200"
        onClick={onAdd}
      >
        <Plus className="h-2.5 w-2.5" />
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {flat.outputs.map((out) => (
        <div key={out.id} className="flex items-center gap-1">
          {editingId === out.id ? (
            <div className="flex items-center gap-1 text-[10px] font-mono">
              <TagPickerPopover
                value={out.tag}
                allTags={allTags}
                onSelect={(tag) => onUpdate(out.id, { tag })}
                placeholder="TAG"
              />
              <span className="text-muted-foreground">=</span>
              <Input
                className="h-5 text-[10px] font-mono w-16 px-1 bg-transparent border-border/60"
                value={out.value}
                onChange={(e) => onUpdate(out.id, { value: e.target.value })}
                onBlur={() => setEditingId(null)}
                autoFocus
              />
              <button
                className="shrink-0 text-muted-foreground hover:text-foreground"
                onClick={() => onRemove(out.id)}
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
            </div>
          ) : (
            <button
              className="text-[10px] font-mono text-teal-400 hover:text-teal-300 text-left truncate"
              onClick={() => setEditingId(out.id)}
              title="Click to edit"
            >
              {out.tag && out.value
                ? `${out.tag} = ${out.value}`
                : out.tag || "(click to set)"}
            </button>
          )}
        </div>
      ))}
      <Button
        size="sm"
        variant="ghost"
        className="h-5 text-[10px] px-1 text-teal-300 hover:text-teal-200 self-start"
        onClick={onAdd}
      >
        <Plus className="h-2.5 w-2.5" />
      </Button>
    </div>
  );
}

// Sentinel targets that are rendered as bold tokens in the Next column.
// Phase-1: FAULT is stored as a string; fromFlatSteps maps it to target_step_id=""
// (DONE-equivalent) on save. TODO: surface fault routing as a first-class
// transition kind once the spec contract supports it.
const NEXT_SENTINELS = ["IDLE", "DONE", "FAULT"] as const;
const CUSTOM_OPTION = "__custom__";

function NextCell({
  branch,
  allSteps,
  currentStepId,
  onChange,
}: {
  branch: SimpleBranch;
  allSteps: FlatStep[];
  currentStepId: string;
  onChange: (patch: Partial<SimpleBranch>) => void;
}) {
  const otherStepNumbers = allSteps
    .filter((s) => s.step_id !== currentStepId)
    .map((s) => s.step);

  const isSentinel = (NEXT_SENTINELS as readonly string[]).includes(
    branch.next_step,
  );
  const isStepNum = otherStepNumbers.includes(branch.next_step);
  const isKnown = isSentinel || isStepNum || branch.next_step === "";
  const [customMode, setCustomMode] = useState(!isKnown);

  const colorClass =
    branch.next_step === "FAULT"
      ? "text-red-400 font-bold"
      : branch.next_step === "IDLE" || branch.next_step === "DONE"
      ? "text-amber-400 font-bold"
      : "text-foreground";

  if (customMode) {
    return (
      <Input
        className={cn("h-6 text-[11px] font-mono w-24", colorClass)}
        value={branch.next_step}
        onChange={(e) => onChange({ next_step: e.target.value })}
        onBlur={() => {
          if (
            otherStepNumbers.includes(branch.next_step) ||
            (NEXT_SENTINELS as readonly string[]).includes(branch.next_step)
          ) {
            setCustomMode(false);
          }
        }}
        autoFocus
      />
    );
  }

  return (
    <Select
      value={branch.next_step || ""}
      onValueChange={(v) => {
        if (v === CUSTOM_OPTION) {
          setCustomMode(true);
          return;
        }
        onChange({ next_step: v });
      }}
    >
      <SelectTrigger
        className={cn(
          "h-6 text-[11px] font-mono w-24 px-2 py-0",
          colorClass,
        )}
      >
        <SelectValue placeholder="—" />
      </SelectTrigger>
      <SelectContent>
        {otherStepNumbers.map((n) => (
          <SelectItem key={n} value={n} className="text-xs font-mono">
            {n}
          </SelectItem>
        ))}
        <SelectItem value="IDLE" className="text-xs font-mono text-amber-400 font-bold">
          IDLE
        </SelectItem>
        <SelectItem value="DONE" className="text-xs font-mono text-amber-400 font-bold">
          DONE
        </SelectItem>
        <SelectItem value="FAULT" className="text-xs font-mono text-red-400 font-bold">
          FAULT
        </SelectItem>
        <SelectItem value={CUSTOM_OPTION} className="text-xs italic">
          Custom...
        </SelectItem>
      </SelectContent>
    </Select>
  );
}

function RowControls({
  onAddBranch,
  onMoveUp,
  onMoveDown,
  onDelete,
  disableUp,
  disableDown,
}: {
  onAddBranch: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  disableUp: boolean;
  disableDown: boolean;
}) {
  return (
    <div className="flex items-center gap-0.5">
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 text-blue-400 hover:text-blue-300"
        title="Add branch"
        onClick={onAddBranch}
      >
        <Plus className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5"
        title="Move up"
        disabled={disableUp}
        onClick={onMoveUp}
      >
        <ChevronUp className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5"
        title="Move down"
        disabled={disableDown}
        onClick={onMoveDown}
      >
        <ChevronDown className="h-3 w-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 text-muted-foreground hover:text-destructive"
        title="Delete step"
        onClick={onDelete}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

function BranchControls({
  branchIdx,
  branchCount,
  onSwapUp,
  onSwapDown,
  onDelete,
}: {
  branchIdx: number;
  branchCount: number;
  onSwapUp: () => void;
  onSwapDown: () => void;
  onDelete: () => void;
}) {
  // branches[0] is the default — only swap among indices ≥1.
  const showUp = branchIdx > 1;
  const showDown = branchIdx < branchCount - 1;
  return (
    <div className="flex items-center gap-0.5">
      {showUp ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          title="Swap with branch above"
          onClick={onSwapUp}
        >
          <ChevronUp className="h-3 w-3" />
        </Button>
      ) : (
        <span className="inline-block h-5 w-5" />
      )}
      {showDown ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5"
          title="Swap with branch below"
          onClick={onSwapDown}
        >
          <ChevronDown className="h-3 w-3" />
        </Button>
      ) : (
        <span className="inline-block h-5 w-5" />
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 text-muted-foreground hover:text-destructive"
        title="Delete branch"
        onClick={onDelete}
      >
        <Trash2 className="h-3 w-3" />
      </Button>
    </div>
  );
}

// Exposed for unit tests — these helpers are pure and have stable input/output.
// eslint-disable-next-line react-refresh/only-export-components
export const __testing = {
  toFlatSteps,
  fromFlatSteps,
};
