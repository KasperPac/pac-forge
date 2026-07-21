/**
 * Maintenance editor (G0-5, G0-16 W1 slice 4) — which DOs the commissioning
 * output-override block may drive in maintenance mode. Tags are constrained
 * to the hierarchy's declared DOs (the same set the patch gate cross-checks).
 */
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MaintenanceV1 } from "@/types/spec-contract-v2";

export function MaintenanceCard({
  maintenance,
  doTags,
  onChange,
}: {
  maintenance: MaintenanceV1;
  /** DO tags declared in the hierarchy — the legal override targets. */
  doTags: string[];
  onChange: (next: MaintenanceV1) => void;
}) {
  const outputs = maintenance.overridable_outputs;
  const patchOutput = (i: number, patch: Partial<MaintenanceV1["overridable_outputs"][number]>) =>
    onChange({
      ...maintenance,
      overridable_outputs: outputs.map((o, j) => (j === i ? { ...o, ...patch } : o)),
    });

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">Overridable outputs</p>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[10px]"
          disabled={!doTags.length}
          onClick={() =>
            onChange({
              ...maintenance,
              overridable_outputs: [
                ...outputs,
                { tag: doTags[0], wire_check_only: false },
              ],
            })
          }
        >
          <Plus className="h-3 w-3 mr-0.5" />
          Add output
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Driven by the MAINT_Output_Override FC (last in OB1) while maintenance
        mode is active. Wire-check-only outputs are unused by logic.
      </p>
      {!doTags.length ? (
        <p className="text-[10px] text-muted-foreground italic">
          No DO signals in the hierarchy yet.
        </p>
      ) : outputs.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic">
          No overridable outputs — no override FC is emitted.
        </p>
      ) : (
        <div className="space-y-1">
          {outputs.map((o, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Select value={o.tag} onValueChange={(v) => patchOutput(i, { tag: v })}>
                <SelectTrigger className="h-6 w-44 text-xs font-mono" aria-label={`Output ${i + 1} tag`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {doTags.map((t) => (
                    <SelectItem key={t} value={t} className="text-xs font-mono">
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  aria-label={`Output ${i + 1} wire check only`}
                  checked={o.wire_check_only}
                  onChange={(e) => patchOutput(i, { wire_check_only: e.target.checked })}
                />
                wire check only
              </label>
              <Input
                aria-label={`Output ${i + 1} description`}
                value={o.description ?? ""}
                placeholder="description"
                onChange={(e) =>
                  patchOutput(i, { description: e.target.value === "" ? undefined : e.target.value })
                }
                className="h-6 flex-1 text-xs"
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove output ${i + 1}`}
                className="h-5 w-5"
                onClick={() =>
                  onChange({
                    ...maintenance,
                    overridable_outputs: outputs.filter((_, j) => j !== i),
                  })
                }
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
