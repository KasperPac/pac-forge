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

type SupportedCondition = Extract<CompletionCriterion, { kind: SupportedKind }>;

function isSupported(c: CompletionCriterion): c is SupportedCondition {
  return c.kind === "tag_equals" || c.kind === "tag_compare" || c.kind === "expression";
}

function defaultFor(kind: SupportedKind, prevTag = ""): SupportedCondition {
  switch (kind) {
    case "tag_equals":
      return { kind: "tag_equals", tag: prevTag, value: true };
    case "tag_compare":
      return { kind: "tag_compare", tag: prevTag, op: "==", value: 0 };
    case "expression":
      return { kind: "expression", text: "", referenced_tags: [] };
  }
}

function patchWithinMs(c: SupportedCondition, within_ms: number | undefined): SupportedCondition {
  const next = { ...c } as SupportedCondition & { within_ms?: number };
  if (within_ms === undefined) {
    delete next.within_ms;
  } else {
    next.within_ms = within_ms;
  }
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
                onChange({
                  ...current,
                  value: v === "true" ? true : v === "false" ? false : Number(v) || v,
                })
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
                      onChange({
                        ...current,
                        referenced_tags: current.referenced_tags.filter((x) => x !== t),
                      })
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
