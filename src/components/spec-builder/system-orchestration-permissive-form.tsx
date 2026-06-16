/**
 * Inline form for creating/editing a SharedPermissive at the system level.
 *
 * Wave B is building richer picker components (SubsystemPicker,
 * ExpressionBuilder). Until those land this form ships a lightweight
 * fallback UI using existing shadcn primitives — raw text inputs for the
 * condition (`kind: "expression"`) with referenced_tags derived from the
 * raw string. When the pickers are available, replace the marked inputs.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { UnitConfig } from "@/types/spec-builder";
import type { SharedPermissive } from "@/types/spec-contract-v2";

interface Props {
  units: UnitConfig[];
  initial?: SharedPermissive;
  onSubmit: (value: SharedPermissive) => void;
  onCancel: () => void;
}

function genId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export function SystemProcedurePermissiveForm({
  units,
  initial,
  onSubmit,
  onCancel,
}: Props) {
  const [permissiveId, setPermissiveId] = useState(initial?.permissive_id ?? genId("SP"));
  const [prose, setProse] = useState(initial?.prose ?? "");
  const [sourceUnit, setSourceUnit] = useState(
    initial?.source_unit ?? "",
  );
  const [exprText, setExprText] = useState(() => {
    if (!initial) return "";
    const c = initial.condition;
    if (c.kind === "expression") return c.text;
    if (c.kind === "tag_equals") return `${c.tag} = ${String(c.value)}`;
    if (c.kind === "tag_compare") return `${c.tag} ${c.op} ${c.value}`;
    if (c.kind === "manual_ack") return c.prompt;
    return "";
  });

  const canSave = permissiveId.trim() && prose.trim() && exprText.trim();

  const handleSubmit = () => {
    if (!canSave) return;
    // Cheap referenced_tags extraction — words that look like tags
    const referenced_tags = Array.from(
      exprText.match(/[A-Z_][A-Z0-9_]{1,}/g) ?? [],
    );
    const value: SharedPermissive = {
      permissive_id: permissiveId,
      condition: {
        kind: "expression",
        text: exprText.trim(),
        referenced_tags,
      },
      source_unit: sourceUnit || undefined,
      prose: prose.trim(),
    };
    onSubmit(value);
  };

  return (
    <div className="space-y-3 p-3 border rounded-md bg-muted/30">
      <div className="grid gap-1">
        <Label className="text-xs">Permissive ID</Label>
        <Input
          value={permissiveId}
          onChange={(e) => setPermissiveId(e.target.value)}
          className="font-mono text-xs"
        />
      </div>
      <div className="grid gap-1">
        <Label className="text-xs">Source unit (optional)</Label>
        {/* FALLBACK: inline <Select> — Wave B replaces with SubsystemPicker */}
        <Select value={sourceUnit} onValueChange={setSourceUnit}>
          <SelectTrigger className="text-xs">
            <SelectValue placeholder="— none —" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">— none —</SelectItem>
            {units.map((s) => (
              <SelectItem key={s.unit_id} value={s.unit_id}>
                {s.unit_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1">
        <Label className="text-xs">Condition (expression)</Label>
        {/* FALLBACK: textarea — Wave B replaces with ExpressionBuilder */}
        <Textarea
          value={exprText}
          onChange={(e) => setExprText(e.target.value)}
          className="font-mono text-xs"
          rows={2}
          placeholder="e.g. ESTOP_OK AND DOOR_CLOSED"
        />
      </div>
      <div className="grid gap-1">
        <Label className="text-xs">Prose (one-line)</Label>
        <Input
          value={prose}
          onChange={(e) => setProse(e.target.value)}
          className="text-xs"
          placeholder="E-Stop chain is healthy across the machine"
        />
      </div>
      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" onClick={handleSubmit} disabled={!canSave}>
          {initial ? "Update" : "Add"} permissive
        </Button>
      </div>
    </div>
  );
}
