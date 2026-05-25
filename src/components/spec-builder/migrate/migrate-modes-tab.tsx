import { useEffect, useMemo } from "react";
import { Plus, Trash2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { validateSpecContractPatch } from "@/lib/spec-builder/contract";
import type { OperatorMode } from "@/types/spec-contract-v2";
import type { ProposedModes } from "@/lib/spec-builder/migrate/types";

interface Props {
  proposal: ProposedModes;
  value: OperatorMode[];
  onChange: (next: OperatorMode[]) => void;
  onTabComplete: (complete: boolean) => void;
}

export function MigrateModesTab({ proposal, value, onChange, onTabComplete }: Props) {
  const issues = useMemo(
    () => validateSpecContractPatch({ modes: value }).filter((i) => /mode|default/i.test(i)),
    [value],
  );

  useEffect(() => {
    onTabComplete(issues.length === 0 && value.length >= 1);
  }, [issues, value, onTabComplete]);

  function updateMode(index: number, partial: Partial<OperatorMode>) {
    onChange(value.map((m, i) => (i === index ? { ...m, ...partial } : m)));
  }

  function setDefault(index: number) {
    onChange(value.map((m, i) => ({ ...m, is_default: i === index })));
  }

  function removeMode(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function addMode() {
    onChange([
      ...value,
      { mode_id: `mode_${value.length + 1}`, name: "New Mode", is_default: false },
    ]);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Every project needs at least one mode. Most projects ship with just <strong>Auto</strong>.
        Add Manual / Service / etc. only if the spec actually authors per-mode overrides.
      </p>

      {proposal.hints.length > 0 && (
        <Card className="p-3 bg-amber-50 border-amber-200">
          <div className="flex items-start gap-2">
            <Info className="h-4 w-4 mt-0.5 text-amber-700" aria-hidden />
            <div className="flex flex-col gap-1 text-sm text-amber-900">
              {proposal.hints.map((h, i) => (
                <div key={i}>{h.hint}</div>
              ))}
            </div>
          </div>
        </Card>
      )}

      <div className="flex flex-col gap-2">
        {value.map((mode, i) => (
          <Card key={i} className="p-3 grid grid-cols-[1fr_1fr_auto_auto] gap-2 items-center">
            <div>
              <Label htmlFor={`mode-id-${i}`} className="text-xs">Mode ID</Label>
              <Input
                id={`mode-id-${i}`}
                value={mode.mode_id}
                onChange={(e) => updateMode(i, { mode_id: e.target.value })}
                className="h-8 font-mono"
              />
            </div>
            <div>
              <Label htmlFor={`mode-name-${i}`} className="text-xs">Display name</Label>
              <Input
                id={`mode-name-${i}`}
                value={mode.name}
                onChange={(e) => updateMode(i, { name: e.target.value })}
                className="h-8"
              />
            </div>
            <div className="flex flex-col items-center">
              <Label htmlFor={`mode-default-${i}`} className="text-xs">Default</Label>
              <Checkbox
                id={`mode-default-${i}`}
                checked={mode.is_default}
                onCheckedChange={() => setDefault(i)}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => removeMode(i)}
              disabled={value.length === 1}
              aria-label={`Remove mode ${mode.mode_id}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </Card>
        ))}
      </div>

      <Button variant="outline" size="sm" onClick={addMode} className="self-start">
        <Plus className="h-4 w-4 mr-1" />
        Add Mode
      </Button>

      {issues.length > 0 && (
        <Card className="p-3 bg-red-50 border-red-200 text-sm text-red-900">
          <ul className="list-disc pl-5">
            {issues.map((issue, i) => (
              <li key={i}>{issue}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
