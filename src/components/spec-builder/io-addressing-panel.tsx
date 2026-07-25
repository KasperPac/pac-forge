/**
 * Re-address IO from hardware (G0-18) — diff preview and explicit apply.
 *
 * Presentational: it computes the plan and reports it, and never writes. The
 * wizard owns the state and persists through its existing save.
 *
 * Apply is all-or-nothing by design — channel assignment is positional, so
 * skipping one signal does not free its channel and a partial apply would
 * describe a rack that does not exist.
 * Design: Docs/superpowers/specs/2026-07-25-io-readdress-design.md
 */
import { AlertTriangle, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useIoAddressingPlan } from "@/hooks/use-io-addressing-plan";
import type { IoAddressingPlan } from "@/lib/spec-builder/io-addressing";
import type { HardwareModelV1 } from "@/types/spec-contract-v2";
import type { UnitConfig } from "@/types/spec-builder";

interface Props {
  hardware: HardwareModelV1;
  units: UnitConfig[];
  onApply: (plan: IoAddressingPlan) => void;
}

export function IoAddressingPanel({ hardware, units, onApply }: Props) {
  const plan = useIoAddressingPlan(hardware, units);
  const changed = plan.assignments.filter((a) => a.changed);
  const total = plan.assignments.length;

  if (total === 0 && plan.warnings.length === 0) return null;

  return (
    <Card className="p-3 space-y-2" data-testid="io-addressing-panel">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase">IO Addressing</p>
          <p className="text-xs text-muted-foreground">
            {changed.length === 0
              ? `All ${total} wired signals match the declared rack.`
              : `${changed.length} of ${total} wired signals would move.`}
          </p>
        </div>
        <Button size="sm" onClick={() => onApply(plan)} disabled={changed.length === 0}>
          <Wand2 className="h-3.5 w-3.5 mr-1" />
          {changed.length === 0
            ? "Addresses match hardware"
            : `Apply ${changed.length} move${changed.length === 1 ? "" : "s"}`}
        </Button>
      </div>

      {plan.warnings.length > 0 && (
        <Card
          data-testid="io-addressing-warnings"
          className="p-3 border-amber-500/50 bg-amber-500/5 space-y-1"
        >
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" /> Not every signal could be addressed (
            {plan.warnings.length})
          </div>
          <ul className="text-[11px] font-mono text-amber-800 space-y-0.5">
            {plan.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </Card>
      )}

      {changed.length > 0 && (
        <div className="max-h-52 overflow-y-auto">
          <table className="w-full text-[11px] font-mono">
            <tbody>
              {changed.map((a) => (
                <tr key={a.tag} className="border-b border-border/50 last:border-0">
                  <td className="py-0.5 pr-2">{a.tag}</td>
                  <td className="py-0.5 pr-2 text-muted-foreground">{a.from ?? "—"}</td>
                  <td className="py-0.5 pr-1 text-muted-foreground">→</td>
                  <td className="py-0.5">{a.to}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
