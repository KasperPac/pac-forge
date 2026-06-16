/**
 * ExpressionSubform — single Expression authoring widget.
 * Shared by ActionBuilder (call_fb params, assign source, etc.)
 * and ExpressionBuilder for nested expression text.
 */
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TagPicker } from "./tag-picker";
import { ChipInput } from "./chip-input";
import type { Expression, PlaceholderInferredType } from "@/types/spec-contract-v2";
import { cn } from "@/lib/utils";

export interface ExpressionSubformProps {
  value: Expression | null;
  onChange: (value: Expression) => void;
  specProjectId?: string;
  disabled?: boolean;
  className?: string;
  /** Label for screen-readers / debugging only. */
  label?: string;
}

const KINDS: Array<{ value: Expression["kind"]; label: string }> = [
  { value: "tag_ref", label: "Tag" },
  { value: "hmi_ref", label: "HMI tag" },
  { value: "literal", label: "Literal" },
  { value: "expr_text", label: "Expression" },
  { value: "placeholder", label: "Placeholder" },
];

const PLACEHOLDER_TYPES: PlaceholderInferredType[] = [
  "tag",
  "control_module",
  "equipment_module",
  "unit",
  "state",
  "value",
];

function defaultForKind(kind: Expression["kind"]): Expression {
  switch (kind) {
    case "tag_ref":
      return { kind: "tag_ref", tag: "" };
    case "hmi_ref":
      return { kind: "hmi_ref", hmi_tag: "" };
    case "literal":
      return { kind: "literal", value: "", value_type: "string" };
    case "expr_text":
      return { kind: "expr_text", text: "", referenced_tags: [] };
    case "placeholder":
      return { kind: "placeholder", prompt: "" };
    case "parameter_ref":
      // Editor placeholder: Zod requires non-empty parameter_id at validation time,
      // but the picker UI fills this in before save.
      return { kind: "parameter_ref", parameter_id: "" };
  }
}

export function ExpressionSubform({
  value,
  onChange,
  specProjectId,
  disabled,
  className,
}: ExpressionSubformProps) {
  const kind: Expression["kind"] = value?.kind ?? "tag_ref";
  const v = value ?? defaultForKind(kind);

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Select
        value={kind}
        onValueChange={(next) =>
          onChange(defaultForKind(next as Expression["kind"]))
        }
        disabled={disabled}
      >
        <SelectTrigger className="h-7 text-xs w-32">
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

      {v.kind === "tag_ref" && (
        <TagPicker
          value={v.tag || null}
          specProjectId={specProjectId}
          disabled={disabled}
          onChange={(r) =>
            onChange({ kind: "tag_ref", tag: r?.tag ?? "" })
          }
        />
      )}

      {v.kind === "hmi_ref" && (
        <Input
          className="h-7 text-xs font-mono"
          placeholder="HMIData.Speed"
          value={v.hmi_tag}
          disabled={disabled}
          onChange={(e) =>
            onChange({ kind: "hmi_ref", hmi_tag: e.target.value })
          }
        />
      )}

      {v.kind === "literal" && (
        <div className="flex gap-1">
          <Select
            value={v.value_type}
            onValueChange={(t) => {
              const vt = t as "string" | "number" | "boolean";
              let lit: string | number | boolean = v.value;
              if (vt === "number") lit = Number(v.value) || 0;
              if (vt === "boolean") lit = v.value === "true" || v.value === true;
              if (vt === "string") lit = String(v.value);
              onChange({ kind: "literal", value: lit, value_type: vt });
            }}
            disabled={disabled}
          >
            <SelectTrigger className="h-7 text-xs w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="string" className="text-xs">string</SelectItem>
              <SelectItem value="number" className="text-xs">number</SelectItem>
              <SelectItem value="boolean" className="text-xs">boolean</SelectItem>
            </SelectContent>
          </Select>
          {v.value_type === "boolean" ? (
            <Select
              value={String(Boolean(v.value))}
              onValueChange={(b) =>
                onChange({
                  kind: "literal",
                  value: b === "true",
                  value_type: "boolean",
                })
              }
              disabled={disabled}
            >
              <SelectTrigger className="h-7 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true" className="text-xs">true</SelectItem>
                <SelectItem value="false" className="text-xs">false</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <Input
              className="h-7 text-xs flex-1"
              value={String(v.value)}
              disabled={disabled}
              type={v.value_type === "number" ? "number" : "text"}
              onChange={(e) =>
                onChange({
                  kind: "literal",
                  value:
                    v.value_type === "number"
                      ? Number(e.target.value) || 0
                      : e.target.value,
                  value_type: v.value_type,
                })
              }
            />
          )}
        </div>
      )}

      {v.kind === "expr_text" && (
        <ChipInput
          value={{ text: v.text, referenced_tags: v.referenced_tags }}
          specProjectId={specProjectId}
          disabled={disabled}
          onChange={(chip) =>
            onChange({
              kind: "expr_text",
              text: chip.text,
              referenced_tags: chip.referenced_tags,
            })
          }
        />
      )}

      {v.kind === "placeholder" && (
        <div className="flex gap-1">
          <Input
            className="h-7 text-xs flex-1"
            placeholder="TBD: describe what goes here"
            value={v.prompt}
            disabled={disabled}
            onChange={(e) =>
              onChange({
                kind: "placeholder",
                prompt: e.target.value,
                inferred_type: v.inferred_type,
              })
            }
          />
          <Select
            value={v.inferred_type ?? ""}
            onValueChange={(t) =>
              onChange({
                kind: "placeholder",
                prompt: v.prompt,
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
      )}
    </div>
  );
}
