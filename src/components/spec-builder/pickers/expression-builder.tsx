/**
 * ExpressionBuilder — authors a single CompletionCriterion.
 * Handles 5 kinds: tag_equals, tag_compare, expression, manual_ack,
 * placeholder. Optional `within_ms` + `on_fail` for timed criteria.
 */
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TagPicker, type ResolvedTag } from "./tag-picker";
import { ChipInput } from "./chip-input";
import { FaultPicker } from "./fault-picker";
import type {
  CompletionCriterion,
  FaultRef,
  FaultSeverity,
  PlaceholderInferredType,
} from "@/types/spec-contract-v2";
import { cn } from "@/lib/utils";

export interface ExpressionBuilderProps {
  value: CompletionCriterion | null;
  onChange: (value: CompletionCriterion | null) => void;
  specProjectId?: string;
  disabled?: boolean;
  className?: string;
}

type Kind = CompletionCriterion["kind"];
const KINDS: Array<{ value: Kind; label: string }> = [
  { value: "tag_equals", label: "Tag equals" },
  { value: "tag_compare", label: "Tag compare" },
  { value: "expression", label: "Expression" },
  { value: "manual_ack", label: "Manual ack" },
  { value: "placeholder", label: "Placeholder (TBD)" },
];

const PLACEHOLDER_TYPES: PlaceholderInferredType[] = [
  "tag",
  "control_module",
  "equipment_module",
  "unit",
  "state",
  "value",
];

const uuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;

function defaultFor(kind: Kind): CompletionCriterion {
  switch (kind) {
    case "tag_equals":
      return { kind: "tag_equals", tag: "", value: true };
    case "tag_compare":
      return { kind: "tag_compare", tag: "", op: ">=", value: 0 };
    case "expression":
      return { kind: "expression", text: "", referenced_tags: [] };
    case "manual_ack":
      return { kind: "manual_ack", prompt: "" };
    case "placeholder":
      return { kind: "placeholder", criterion_id: uuid(), prompt: "" };
  }
}

type TimedCriterion = Extract<
  CompletionCriterion,
  { kind: "tag_equals" | "tag_compare" | "expression" }
>;

function isTimed(c: CompletionCriterion): c is TimedCriterion {
  return (
    c.kind === "tag_equals" ||
    c.kind === "tag_compare" ||
    c.kind === "expression"
  );
}

export function ExpressionBuilder({
  value,
  onChange,
  specProjectId,
  disabled,
  className,
}: ExpressionBuilderProps) {
  const v = value ?? defaultFor("tag_equals");

  const setOnFail = (fault: FaultRef | undefined) => {
    if (!isTimed(v)) return;
    onChange({ ...v, on_fail: fault });
  };

  const setWithin = (ms: number | undefined) => {
    if (!isTimed(v)) return;
    onChange({ ...v, within_ms: ms });
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex gap-1">
        <Select
          value={v.kind}
          onValueChange={(k) => onChange(defaultFor(k as Kind))}
          disabled={disabled}
        >
          <SelectTrigger className="h-7 text-xs w-36 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {KINDS.map((k) => (
              <SelectItem key={k.value} value={k.value} className="text-xs">
                {k.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {v.kind === "tag_equals" && (
          <TagEqualsFields
            v={v}
            onChange={onChange}
            specProjectId={specProjectId}
            disabled={disabled}
          />
        )}
        {v.kind === "tag_compare" && (
          <TagCompareFields
            v={v}
            onChange={onChange}
            specProjectId={specProjectId}
            disabled={disabled}
          />
        )}
        {v.kind === "expression" && (
          <div className="flex-1">
            <ChipInput
              value={{ text: v.text, referenced_tags: v.referenced_tags }}
              specProjectId={specProjectId}
              disabled={disabled}
              onChange={(chip) =>
                onChange({
                  ...v,
                  text: chip.text,
                  referenced_tags: chip.referenced_tags,
                })
              }
            />
          </div>
        )}
        {v.kind === "manual_ack" && (
          <Textarea
            className="text-xs flex-1 min-h-[28px]"
            rows={1}
            placeholder="Operator ack prompt…"
            value={v.prompt}
            disabled={disabled}
            onChange={(e) => onChange({ ...v, prompt: e.target.value })}
          />
        )}
        {v.kind === "placeholder" && (
          <PlaceholderFields v={v} onChange={onChange} disabled={disabled} />
        )}
      </div>

      {isTimed(v) && (
        <div className="flex items-center gap-2 pl-36">
          <label className="text-[10px] text-muted-foreground">within</label>
          <Input
            type="number"
            className="h-6 text-xs w-20 font-mono"
            value={v.within_ms ?? ""}
            disabled={disabled}
            placeholder="ms"
            onChange={(e) =>
              setWithin(
                e.target.value === "" ? undefined : Number(e.target.value),
              )
            }
          />
          <label className="text-[10px] text-muted-foreground">on fail</label>
          <div className="flex-1 max-w-[220px]">
            <FaultPicker
              value={v.on_fail?.fault_code ?? null}
              specProjectId={specProjectId}
              disabled={disabled}
              onChange={(r) =>
                setOnFail(
                  r
                    ? { fault_code: r.fault_code, severity: r.severity }
                    : undefined,
                )
              }
            />
          </div>
          {v.on_fail && (
            <Select
              value={v.on_fail.severity}
              onValueChange={(s) =>
                setOnFail({
                  fault_code: v.on_fail!.fault_code,
                  severity: s as FaultSeverity,
                })
              }
              disabled={disabled}
            >
              <SelectTrigger className="h-6 text-xs w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="warning" className="text-xs">warning</SelectItem>
                <SelectItem value="fault" className="text-xs">fault</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  );
}

function TagEqualsFields({
  v,
  onChange,
  specProjectId,
  disabled,
}: {
  v: Extract<CompletionCriterion, { kind: "tag_equals" }>;
  onChange: (v: CompletionCriterion) => void;
  specProjectId?: string;
  disabled?: boolean;
}) {
  // Decide value control shape from current tag resolution.
  // For V2-compat we don't have tag metadata here; fall back to a toggle
  // when the current value is boolean, or a text input otherwise.
  return (
    <div className="flex gap-1 flex-1">
      <div className="flex-1">
        <TagPicker
          value={v.tag || null}
          specProjectId={specProjectId}
          disabled={disabled}
          onChange={(r) => handleTagChange(r, v, onChange)}
        />
      </div>
      <span className="text-[10px] text-muted-foreground self-center">=</span>
      {typeof v.value === "boolean" ? (
        <Select
          value={String(v.value)}
          onValueChange={(b) => onChange({ ...v, value: b === "true" })}
          disabled={disabled}
        >
          <SelectTrigger className="h-7 text-xs w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true" className="text-xs">TRUE</SelectItem>
            <SelectItem value="false" className="text-xs">FALSE</SelectItem>
          </SelectContent>
        </Select>
      ) : typeof v.value === "number" ? (
        <Input
          type="number"
          className="h-7 text-xs w-28 font-mono"
          value={v.value}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...v, value: Number(e.target.value) || 0 })
          }
        />
      ) : (
        <Input
          className="h-7 text-xs w-40 font-mono"
          value={String(v.value)}
          disabled={disabled}
          onChange={(e) => onChange({ ...v, value: e.target.value })}
        />
      )}
    </div>
  );
}

function handleTagChange(
  r: ResolvedTag | null,
  v: Extract<CompletionCriterion, { kind: "tag_equals" }>,
  onChange: (v: CompletionCriterion) => void,
) {
  if (!r) {
    onChange({ ...v, tag: "" });
    return;
  }
  // Auto-adjust value shape: bool for DI/DO, number for AI/AO, keep string otherwise.
  let nextVal: string | number | boolean = v.value;
  if (r.signal_type === "DI" || r.signal_type === "DO") {
    if (typeof nextVal !== "boolean") nextVal = true;
  } else if (r.signal_type === "AI" || r.signal_type === "AO") {
    if (typeof nextVal !== "number")
      nextVal = typeof nextVal === "string" ? Number(nextVal) || 0 : 0;
  }
  onChange({ ...v, tag: r.tag, value: nextVal });
}

function TagCompareFields({
  v,
  onChange,
  specProjectId,
  disabled,
}: {
  v: Extract<CompletionCriterion, { kind: "tag_compare" }>;
  onChange: (v: CompletionCriterion) => void;
  specProjectId?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-1 flex-1">
      <div className="flex-1">
        <TagPicker
          value={v.tag || null}
          specProjectId={specProjectId}
          filter={{ numericOnly: true }}
          disabled={disabled}
          onChange={(r) => onChange({ ...v, tag: r?.tag ?? "" })}
        />
      </div>
      <Select
        value={v.op}
        onValueChange={(op) =>
          onChange({ ...v, op: op as typeof v.op })
        }
        disabled={disabled}
      >
        <SelectTrigger className="h-7 text-xs w-16">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="<" className="text-xs">{"<"}</SelectItem>
          <SelectItem value="<=" className="text-xs">{"<="}</SelectItem>
          <SelectItem value=">" className="text-xs">{">"}</SelectItem>
          <SelectItem value=">=" className="text-xs">{">="}</SelectItem>
          <SelectItem value="==" className="text-xs">==</SelectItem>
        </SelectContent>
      </Select>
      <Input
        type="number"
        className="h-7 text-xs w-28 font-mono"
        value={v.value}
        disabled={disabled}
        onChange={(e) =>
          onChange({ ...v, value: Number(e.target.value) || 0 })
        }
      />
    </div>
  );
}

function PlaceholderFields({
  v,
  onChange,
  disabled,
}: {
  v: Extract<CompletionCriterion, { kind: "placeholder" }>;
  onChange: (v: CompletionCriterion) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex gap-1 flex-1">
      <Input
        className="h-7 text-xs flex-1"
        placeholder="TBD: describe what goes here"
        value={v.prompt}
        disabled={disabled}
        onChange={(e) => onChange({ ...v, prompt: e.target.value })}
      />
      <Select
        value={v.inferred_type ?? ""}
        onValueChange={(t) =>
          onChange({
            ...v,
            inferred_type: (t || undefined) as
              | PlaceholderInferredType
              | undefined,
          })
        }
        disabled={disabled}
      >
        <SelectTrigger className="h-7 text-xs w-28">
          <SelectValue placeholder="type" />
        </SelectTrigger>
        <SelectContent>
          {PLACEHOLDER_TYPES.map((t) => (
            <SelectItem key={t} value={t} className="text-xs">
              {t}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
