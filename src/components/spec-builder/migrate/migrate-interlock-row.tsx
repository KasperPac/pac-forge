import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { InterAssemblyInterlockEffectSchema } from "@/types/spec-contract-v2";
import type {
  InterAssemblyInterlockEffect,
  CompletionCriterion,
} from "@/types/spec-contract-v2";
import type { ProposedInterlock } from "@/lib/spec-builder/migrate/types";

interface Props {
  row: ProposedInterlock;
  onChange: (next: ProposedInterlock) => void;
}

function confidenceClass(c: number): string {
  if (c >= 0.9) return "bg-green-100 text-green-900 border-green-200";
  if (c >= 0.6) return "bg-amber-100 text-amber-900 border-amber-200";
  return "bg-red-100 text-red-900 border-red-200";
}

const EFFECT_OPTIONS = InterAssemblyInterlockEffectSchema.options;
const CONDITION_KINDS = ["tag_equals", "tag_compare", "expression", "placeholder"] as const;

export function MigrateInterlockRow({ row, onChange }: Props) {
  function setEffect(effect: InterAssemblyInterlockEffect) {
    onChange({ ...row, effect });
  }

  function setKind(kind: typeof CONDITION_KINDS[number]) {
    const empty: Record<string, CompletionCriterion> = {
      tag_equals: { kind: "tag_equals", tag: "", value: true },
      tag_compare: { kind: "tag_compare", tag: "", op: ">=", value: 0 },
      expression: { kind: "expression", text: "", referenced_tags: [] },
      placeholder: {
        kind: "placeholder",
        criterion_id: `placeholder-${row.interlock_id}`,
        prompt: row.original_prose_condition,
      },
    };
    onChange({ ...row, source_condition: empty[kind] });
  }

  function setField<K extends string>(field: K, val: unknown) {
    onChange({
      ...row,
      source_condition: { ...row.source_condition, [field]: val } as CompletionCriterion,
    });
  }

  const sc = row.source_condition;

  return (
    <div className="grid grid-cols-[100px_100px_1fr_120px_2fr_60px] gap-2 items-center px-3 py-2 border-b text-sm last:border-b-0">
      <div className="font-mono text-xs">
        <span className="block text-muted-foreground">{row.interlock_id}</span>
        {row.source_assembly}
      </div>
      <div className="font-mono text-xs">{row.target_assembly}</div>
      <div className="text-xs text-muted-foreground truncate" title={row.original_prose_condition}>
        {row.original_prose_condition}
      </div>
      <Select value={row.effect} onValueChange={(v) => setEffect(v as InterAssemblyInterlockEffect)}>
        <SelectTrigger className="h-8">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {EFFECT_OPTIONS.map((e) => (
            <SelectItem key={e} value={e}>
              {e}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1">
        <Select value={sc.kind} onValueChange={(v) => setKind(v as typeof CONDITION_KINDS[number])}>
          <SelectTrigger className="h-8 w-32 shrink-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CONDITION_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {k}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {sc.kind === "tag_equals" && (
          <>
            <Input
              value={sc.tag}
              onChange={(e) => setField("tag", e.target.value)}
              placeholder="TAG"
              className="h-8 font-mono"
            />
            <Select
              value={String(sc.value)}
              onValueChange={(v) => setField("value", v === "true" ? true : v === "false" ? false : v)}
            >
              <SelectTrigger className="h-8 w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="true">true</SelectItem>
                <SelectItem value="false">false</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
        {sc.kind === "tag_compare" && (
          <>
            <Input
              value={sc.tag}
              onChange={(e) => setField("tag", e.target.value)}
              placeholder="TAG"
              className="h-8 font-mono"
            />
            <Select value={sc.op} onValueChange={(v) => setField("op", v)}>
              <SelectTrigger className="h-8 w-16">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {["<", "<=", ">", ">=", "=="].map((op) => (
                  <SelectItem key={op} value={op}>{op}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              value={sc.value}
              onChange={(e) => setField("value", Number(e.target.value))}
              className="h-8 w-20"
            />
          </>
        )}
        {sc.kind === "expression" && (
          <Input
            value={sc.text}
            onChange={(e) => setField("text", e.target.value)}
            placeholder="expr"
            className="h-8 font-mono"
          />
        )}
        {sc.kind === "placeholder" && (
          <Input
            value={sc.prompt}
            onChange={(e) => setField("prompt", e.target.value)}
            placeholder="prose"
            className="h-8 italic"
          />
        )}
      </div>

      <Badge
        variant="outline"
        className={cn("text-[10px] uppercase justify-center", confidenceClass(row.confidence))}
        title={row.reasoning}
      >
        {Math.round(row.confidence * 100)}%
      </Badge>
    </div>
  );
}
