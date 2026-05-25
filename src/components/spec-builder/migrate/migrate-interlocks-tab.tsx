import { useEffect, useMemo } from "react";
import { RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MigrateInterlockRow } from "./migrate-interlock-row";
import { CompletionCriterionSchema } from "@/types/spec-contract-v2";
import type { ProposedInterlock } from "@/lib/spec-builder/migrate/types";

interface Props {
  rows: ProposedInterlock[];
  onChange: (next: ProposedInterlock[]) => void;
  onTabComplete: (complete: boolean) => void;
  onReclassify: () => void;
}

function isRowResolved(row: ProposedInterlock): boolean {
  if (row.source_condition.kind === "placeholder") return false;
  return CompletionCriterionSchema.safeParse(row.source_condition).success;
}

export function MigrateInterlocksTab({ rows, onChange, onTabComplete, onReclassify }: Props) {
  const allResolved = useMemo(() => rows.length === 0 || rows.every(isRowResolved), [rows]);

  useEffect(() => {
    onTabComplete(allResolved);
  }, [allResolved, onTabComplete]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Review every inter-assembly interlock. The AI classifier proposed an effect and structured
          source_condition for each row; engineer-confirm or edit. Rows with a 0% confidence chip
          fell back to placeholder shape and need manual entry.
        </p>
        <Button variant="outline" size="sm" onClick={onReclassify}>
          <RefreshCw className="h-3.5 w-3.5 mr-1" />
          Re-classify all
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-[100px_100px_1fr_120px_2fr_60px] gap-2 px-3 py-2 border-b bg-muted/40 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <div>Source</div>
          <div>Target</div>
          <div>Original prose</div>
          <div>Effect</div>
          <div>Source condition</div>
          <div>Conf.</div>
        </div>
        {rows.map((row) => (
          <MigrateInterlockRow
            key={row.interlock_id}
            row={row}
            onChange={(next) =>
              onChange(rows.map((r) => (r.interlock_id === row.interlock_id ? next : r)))
            }
          />
        ))}
        {rows.length === 0 && (
          <div className="p-4 text-sm text-muted-foreground">
            No inter-assembly interlocks in this project — nothing to classify.
          </div>
        )}
      </Card>
    </div>
  );
}
