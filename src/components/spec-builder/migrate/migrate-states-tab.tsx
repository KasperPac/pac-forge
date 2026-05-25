import { useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PACKML_STATES } from "@/lib/spec-builder/migrate/packml-canonical";
import type { ProposedStateMapping } from "@/lib/spec-builder/migrate/types";

interface Props {
  proposal: ProposedStateMapping[];
  value: ProposedStateMapping[];
  onChange: (next: ProposedStateMapping[]) => void;
  onTabComplete: (complete: boolean) => void;
}

function isResolved(row: ProposedStateMapping): boolean {
  if (typeof row.packml_id === "number" && row.packml_id >= 1 && row.packml_id <= 17) {
    return true;
  }
  if (
    typeof row.custom_state_id === "number" &&
    row.custom_state_id > 100 &&
    !!row.custom_name &&
    row.custom_name.trim().length > 0
  ) {
    return true;
  }
  return false;
}

export function MigrateStatesTab({ proposal: _proposal, value, onChange, onTabComplete }: Props) {
  const allResolved = useMemo(() => value.every(isResolved), [value]);

  useEffect(() => {
    onTabComplete(allResolved);
  }, [allResolved, onTabComplete]);

  function updateRow(i: number, partial: Partial<ProposedStateMapping>) {
    onChange(value.map((r, idx) => (idx === i ? { ...r, ...partial } : r)));
  }

  function markCustom(i: number) {
    updateRow(i, {
      packml_id: undefined,
      custom_state_id: 101,
      custom_name: value[i].legacy_name,
    });
  }

  function pickPackml(i: number, packml_id: number) {
    updateRow(i, { packml_id, custom_state_id: undefined, custom_name: undefined });
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Map every legacy state name to either a PackML 1-17 state or a custom state (ID &gt; 100).
      </p>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[1fr_auto_2fr_auto] gap-2 px-3 py-2 border-b bg-muted/40 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <div>Legacy name</div>
          <div>Match</div>
          <div>Mapping</div>
          <div></div>
        </div>
        {value.map((row, i) => (
          <div key={i} className="grid grid-cols-[1fr_auto_2fr_auto] gap-2 px-3 py-2 border-b items-center text-sm last:border-b-0">
            <div className="font-mono">{row.legacy_name}</div>
            <div>
              <Badge variant={row.match_source === "unmapped" ? "destructive" : "secondary"} className="text-[10px] uppercase">
                {row.match_source}
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              {row.custom_state_id !== undefined ? (
                <>
                  <Input
                    type="number"
                    min={101}
                    value={row.custom_state_id}
                    onChange={(e) => updateRow(i, { custom_state_id: Number(e.target.value) })}
                    className="h-8 w-24"
                    aria-label="custom state id"
                  />
                  <Input
                    value={row.custom_name ?? ""}
                    onChange={(e) => updateRow(i, { custom_name: e.target.value })}
                    placeholder="Display name"
                    className="h-8"
                    aria-label="custom name"
                  />
                </>
              ) : (
                <Select
                  value={row.packml_id !== undefined ? String(row.packml_id) : ""}
                  onValueChange={(v) => pickPackml(i, Number(v))}
                >
                  <SelectTrigger className="h-8 w-64">
                    <SelectValue placeholder="Pick PackML state…" />
                  </SelectTrigger>
                  <SelectContent>
                    {PACKML_STATES.map((s) => (
                      <SelectItem key={s.packml_id} value={String(s.packml_id)}>
                        {s.packml_id}. {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => (row.custom_state_id !== undefined ? pickPackml(i, 6) : markCustom(i))}
            >
              {row.custom_state_id !== undefined ? "Use PackML" : "Mark as custom"}
            </Button>
          </div>
        ))}
      </Card>
    </div>
  );
}
