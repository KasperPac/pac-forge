/**
 * ActionBuilder — authors a single ActionV2 (9-kind union).
 *
 * Each action carries `prose` + `action_id`. Prose is auto-derived from the
 * structured form unless the engineer clicks the pencil to override. Override
 * is tracked via a `_prose_override` companion flag stored OUTSIDE the action
 * (engineer-facing widget state only) — we persist the prose string as-is.
 * When a form field changes and override is off, we regenerate prose.
 *
 * For `call_fb`, the FB template is picked via a free-text input for now;
 * when an `FbTemplate` picker lands in Wave C, wire it here.
 */
import { useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TagPicker } from "./tag-picker";
import { ChipInput } from "./chip-input";
import { ExpressionSubform } from "./expression-subform";
import type { ActionV2, Expression } from "@/types/spec-contract-v2";
import { cn } from "@/lib/utils";

export interface ActionBuilderProps {
  value: ActionV2 | null;
  onChange: (value: ActionV2) => void;
  specProjectId?: string;
  disabled?: boolean;
  className?: string;
}

type Kind = ActionV2["kind"];
const KINDS: Array<{ value: Kind; label: string }> = [
  { value: "assign", label: "Assign" },
  { value: "call_fb", label: "Call FB" },
  { value: "start_timer", label: "Start timer" },
  { value: "stop_timer", label: "Stop timer" },
  { value: "reset_timer", label: "Reset timer" },
  { value: "incr_counter", label: "Incr counter" },
  { value: "reset_counter", label: "Reset counter" },
  { value: "raise_alarm", label: "Raise alarm" },
  { value: "manual_prose", label: "Manual prose" },
];

const uuid = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;

function emptyExpr(): Expression {
  return { kind: "literal", value: "", value_type: "string" };
}

function proseForExpression(e: Expression): string {
  switch (e.kind) {
    case "tag_ref":
      return e.tag || "?";
    case "hmi_ref":
      return e.hmi_tag || "?";
    case "literal":
      return String(e.value);
    case "expr_text":
      return e.text || "?";
    case "placeholder":
      return `<${e.prompt || "TBD"}>`;
  }
}

function regenProse(a: ActionV2): string {
  switch (a.kind) {
    case "assign":
      return `${a.target_tag || "?"} := ${proseForExpression(a.source)}`;
    case "call_fb": {
      const params = Object.entries(a.params)
        .map(([k, v]) => `${k}=${proseForExpression(v)}`)
        .join(", ");
      return `CALL ${a.fb_template_id || "?"} AS ${a.instance_name || "?"}(${params})`;
    }
    case "start_timer":
      return `START ${a.timer_tag || "?"} (${proseForExpression(a.preset_ms)} ms)`;
    case "stop_timer":
      return `STOP ${a.timer_tag || "?"}`;
    case "reset_timer":
      return `RESET ${a.timer_tag || "?"}`;
    case "incr_counter":
      return `INC ${a.counter_tag || "?"}${a.by ? ` by ${proseForExpression(a.by)}` : ""}`;
    case "reset_counter":
      return `RESET ${a.counter_tag || "?"}`;
    case "raise_alarm":
      return `RAISE ${a.alarm_tag || "?"}`;
    case "manual_prose":
      return a.text || "?";
  }
}

function defaultForKind(kind: Kind): ActionV2 {
  const id = uuid();
  const base = { action_id: id, prose: "" };
  let next: ActionV2;
  switch (kind) {
    case "assign":
      next = {
        ...base,
        kind: "assign",
        target_tag: "",
        source: emptyExpr(),
      };
      break;
    case "call_fb":
      next = {
        ...base,
        kind: "call_fb",
        fb_template_id: "",
        instance_name: "",
        params: {},
      };
      break;
    case "start_timer":
      next = {
        ...base,
        kind: "start_timer",
        timer_tag: "",
        preset_ms: { kind: "literal", value: 1000, value_type: "number" },
      };
      break;
    case "stop_timer":
      next = { ...base, kind: "stop_timer", timer_tag: "" };
      break;
    case "reset_timer":
      next = { ...base, kind: "reset_timer", timer_tag: "" };
      break;
    case "incr_counter":
      next = { ...base, kind: "incr_counter", counter_tag: "" };
      break;
    case "reset_counter":
      next = { ...base, kind: "reset_counter", counter_tag: "" };
      break;
    case "raise_alarm":
      next = { ...base, kind: "raise_alarm", alarm_tag: "" };
      break;
    case "manual_prose":
      next = {
        ...base,
        kind: "manual_prose",
        text: "",
        referenced_tags: [],
      };
      break;
  }
  return { ...next, prose: regenProse(next) };
}

export function ActionBuilder({
  value,
  onChange,
  specProjectId,
  disabled,
  className,
}: ActionBuilderProps) {
  const [proseOverride, setProseOverride] = useState(false);
  const a = value ?? defaultForKind("manual_prose");

  const commit = (next: ActionV2) => {
    const withProse: ActionV2 = proseOverride
      ? next
      : { ...next, prose: regenProse(next) };
    onChange(withProse);
  };

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex gap-1">
        <Select
          value={a.kind}
          onValueChange={(k) => commit(defaultForKind(k as Kind))}
          disabled={disabled}
        >
          <SelectTrigger className="h-7 text-xs w-32 shrink-0">
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

        <div className="flex-1">
          <ActionFields
            a={a}
            onChange={commit}
            specProjectId={specProjectId}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Prose preview + override */}
      <div className="flex items-center gap-1 pl-32">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0"
          disabled={disabled}
          onClick={() => setProseOverride((v) => !v)}
          aria-label="Edit prose"
          title={proseOverride ? "Stop overriding" : "Override prose"}
        >
          <Pencil
            className={cn(
              "h-3 w-3",
              proseOverride ? "text-amber-400" : "text-muted-foreground",
            )}
          />
        </Button>
        {proseOverride ? (
          <Input
            className="h-6 text-[11px] font-mono flex-1"
            value={a.prose}
            disabled={disabled}
            onChange={(e) => onChange({ ...a, prose: e.target.value })}
          />
        ) : (
          <span className="text-[11px] font-mono text-muted-foreground truncate flex-1">
            {a.prose}
          </span>
        )}
      </div>
    </div>
  );
}

function ActionFields({
  a,
  onChange,
  specProjectId,
  disabled,
}: {
  a: ActionV2;
  onChange: (a: ActionV2) => void;
  specProjectId?: string;
  disabled?: boolean;
}) {
  switch (a.kind) {
    case "assign":
      return (
        <div className="flex gap-1">
          <div className="flex-1">
            <TagPicker
              value={a.target_tag || null}
              specProjectId={specProjectId}
              disabled={disabled}
              onChange={(r) =>
                onChange({ ...a, target_tag: r?.tag ?? "" })
              }
              placeholder="target tag"
            />
          </div>
          <span className="text-[10px] text-muted-foreground self-center">:=</span>
          <div className="flex-1">
            <ExpressionSubform
              value={a.source}
              specProjectId={specProjectId}
              disabled={disabled}
              onChange={(e) => onChange({ ...a, source: e })}
            />
          </div>
        </div>
      );
    case "call_fb":
      return (
        <CallFbFields
          a={a}
          onChange={onChange}
          specProjectId={specProjectId}
          disabled={disabled}
        />
      );
    case "start_timer":
      return (
        <div className="flex gap-1">
          <div className="flex-1">
            <TagPicker
              value={a.timer_tag || null}
              specProjectId={specProjectId}
              disabled={disabled}
              placeholder="timer tag"
              onChange={(r) =>
                onChange({ ...a, timer_tag: r?.tag ?? "" })
              }
            />
          </div>
          <span className="text-[10px] text-muted-foreground self-center">preset</span>
          <div className="flex-1">
            <ExpressionSubform
              value={a.preset_ms}
              specProjectId={specProjectId}
              disabled={disabled}
              onChange={(e) => onChange({ ...a, preset_ms: e })}
            />
          </div>
        </div>
      );
    case "stop_timer":
    case "reset_timer":
      return (
        <TagPicker
          value={a.timer_tag || null}
          specProjectId={specProjectId}
          disabled={disabled}
          placeholder="timer tag"
          onChange={(r) => onChange({ ...a, timer_tag: r?.tag ?? "" })}
        />
      );
    case "incr_counter":
      return (
        <div className="flex gap-1">
          <div className="flex-1">
            <TagPicker
              value={a.counter_tag || null}
              specProjectId={specProjectId}
              disabled={disabled}
              placeholder="counter tag"
              onChange={(r) =>
                onChange({ ...a, counter_tag: r?.tag ?? "" })
              }
            />
          </div>
          <span className="text-[10px] text-muted-foreground self-center">by</span>
          <div className="flex-1">
            <ExpressionSubform
              value={a.by ?? { kind: "literal", value: 1, value_type: "number" }}
              specProjectId={specProjectId}
              disabled={disabled}
              onChange={(e) => onChange({ ...a, by: e })}
            />
          </div>
        </div>
      );
    case "reset_counter":
      return (
        <TagPicker
          value={a.counter_tag || null}
          specProjectId={specProjectId}
          disabled={disabled}
          placeholder="counter tag"
          onChange={(r) => onChange({ ...a, counter_tag: r?.tag ?? "" })}
        />
      );
    case "raise_alarm":
      return (
        <TagPicker
          value={a.alarm_tag || null}
          specProjectId={specProjectId}
          disabled={disabled}
          placeholder="alarm tag"
          onChange={(r) => onChange({ ...a, alarm_tag: r?.tag ?? "" })}
        />
      );
    case "manual_prose":
      return (
        <div className="flex-1">
          <ChipInput
            value={{ text: a.text, referenced_tags: a.referenced_tags }}
            specProjectId={specProjectId}
            disabled={disabled}
            placeholder="Prose. @ to insert tag."
            onChange={(chip) =>
              onChange({
                ...a,
                text: chip.text,
                referenced_tags: chip.referenced_tags,
              })
            }
          />
          {/* manual_prose has no structured payload beyond text; the
              Textarea is also offered for longer content. */}
          <Textarea
            className="text-xs font-mono mt-1"
            rows={2}
            placeholder="(optional multi-line detail)"
            value={a.text}
            disabled={disabled}
            onChange={(e) => onChange({ ...a, text: e.target.value })}
          />
        </div>
      );
  }
}

function CallFbFields({
  a,
  onChange,
  specProjectId,
  disabled,
}: {
  a: Extract<ActionV2, { kind: "call_fb" }>;
  onChange: (a: ActionV2) => void;
  specProjectId?: string;
  disabled?: boolean;
}) {
  const paramEntries = Object.entries(a.params);

  const setParam = (key: string, expr: Expression) => {
    onChange({ ...a, params: { ...a.params, [key]: expr } });
  };
  const renameParam = (oldKey: string, newKey: string) => {
    if (oldKey === newKey) return;
    const next = { ...a.params };
    const v = next[oldKey];
    delete next[oldKey];
    next[newKey] = v;
    onChange({ ...a, params: next });
  };
  const removeParam = (key: string) => {
    const next = { ...a.params };
    delete next[key];
    onChange({ ...a, params: next });
  };
  const addParam = () => {
    let base = "param";
    let i = 1;
    while (a.params[`${base}${i}`] !== undefined) i += 1;
    setParam(
      `${base}${i}`,
      { kind: "literal", value: "", value_type: "string" },
    );
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <Input
          className="h-7 text-xs flex-1 font-mono"
          placeholder="fb_template_id"
          value={a.fb_template_id}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...a, fb_template_id: e.target.value })
          }
        />
        <span className="text-[10px] text-muted-foreground self-center">as</span>
        <Input
          className="h-7 text-xs flex-1 font-mono"
          placeholder="Inst_Name"
          value={a.instance_name}
          disabled={disabled}
          onChange={(e) =>
            onChange({ ...a, instance_name: e.target.value })
          }
        />
      </div>
      <div className="flex flex-col gap-1 pl-2 border-l border-neutral-800 ml-1">
        {paramEntries.map(([key, expr]) => (
          <div key={key} className="flex items-start gap-1">
            <Input
              className="h-7 text-xs w-28 font-mono"
              value={key}
              disabled={disabled}
              onChange={(e) => renameParam(key, e.target.value)}
            />
            <span className="text-[10px] text-muted-foreground self-center">=</span>
            <div className="flex-1">
              <ExpressionSubform
                value={expr}
                specProjectId={specProjectId}
                disabled={disabled}
                onChange={(e) => setParam(key, e)}
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0"
              disabled={disabled}
              onClick={() => removeParam(key)}
              aria-label={`Remove ${key}`}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-6 text-[10px] self-start"
          disabled={disabled}
          onClick={addParam}
        >
          <Plus className="h-3 w-3 mr-0.5" /> Add param
        </Button>
      </div>
    </div>
  );
}
