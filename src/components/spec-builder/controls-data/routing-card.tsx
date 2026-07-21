/**
 * Signal-routing editor (G0-3, G0-16 W1 slice 3) — routing rows
 * (`target.pin := source AND gates`) and two-detent jog/fast pairs.
 * Pure controlled component; the parent owns the coordination object.
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
import { freshAuthoredId } from "@/lib/spec-builder/unit-coordination-seed";
import type {
  RoutingRow,
  SignalRoutingV1,
  SignalSourceRef,
  TwoDetent,
  UnitCoordinationV1,
} from "@/types/spec-contract-v2";

export interface EmOption {
  id: string;
  name: string;
}

function emptyRouting(coord: UnitCoordinationV1): SignalRoutingV1 {
  return {
    routing_rows: [],
    two_detent: [],
    ...coord.signal_routing,
  };
}

function SignalRefEditor({
  value,
  label,
  ems,
  declaredGateIds,
  onChange,
}: {
  value: SignalSourceRef;
  label: string;
  ems: EmOption[];
  declaredGateIds: string[];
  onChange: (next: SignalSourceRef) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Select
        value={value.kind}
        onValueChange={(v) => {
          if (v === "io_tag") onChange({ kind: "io_tag", tag: "" });
          else if (v === "em_status")
            onChange({ kind: "em_status", equipment_module_id: ems[0]?.id ?? "", member: "" });
          else onChange({ kind: "named_gate", gate_id: declaredGateIds[0] ?? "" });
        }}
      >
        <SelectTrigger className="h-6 w-24 text-[10px]" aria-label={`${label} kind`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="io_tag" className="text-xs">IO tag</SelectItem>
          <SelectItem value="em_status" className="text-xs">EM status</SelectItem>
          <SelectItem value="named_gate" className="text-xs">Named gate</SelectItem>
        </SelectContent>
      </Select>
      {value.kind === "io_tag" && (
        <Input
          aria-label={`${label} tag`}
          value={value.tag}
          placeholder="PLC tag"
          onChange={(e) => onChange({ kind: "io_tag", tag: e.target.value })}
          className="h-6 w-32 text-xs font-mono"
        />
      )}
      {value.kind === "em_status" && (
        <>
          <Select
            value={value.equipment_module_id}
            onValueChange={(v) => onChange({ ...value, equipment_module_id: v })}
          >
            <SelectTrigger className="h-6 w-28 text-[10px]" aria-label={`${label} EM`}>
              <SelectValue placeholder="EM…" />
            </SelectTrigger>
            <SelectContent>
              {ems.map((em) => (
                <SelectItem key={em.id} value={em.id} className="text-xs">
                  {em.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label={`${label} member`}
            value={value.member}
            placeholder="status member"
            onChange={(e) => onChange({ ...value, member: e.target.value })}
            className="h-6 w-28 text-xs font-mono"
          />
        </>
      )}
      {value.kind === "named_gate" && (
        <Input
          aria-label={`${label} gate id`}
          value={value.gate_id}
          placeholder={declaredGateIds.length ? `e.g. ${declaredGateIds[0]}` : "gate id (declare on an axis)"}
          onChange={(e) => onChange({ kind: "named_gate", gate_id: e.target.value })}
          className="h-6 w-32 text-xs font-mono"
        />
      )}
    </div>
  );
}

export function RoutingCard({
  coord,
  ems,
  declaredGateIds,
  patchCoord,
}: {
  coord: UnitCoordinationV1;
  ems: EmOption[];
  declaredGateIds: string[];
  patchCoord: (patch: Partial<UnitCoordinationV1>) => void;
}) {
  const routing = emptyRouting(coord);
  const rows = routing.routing_rows;
  const detents = routing.two_detent;

  const patchRouting = (patch: Partial<SignalRoutingV1>) =>
    patchCoord({ signal_routing: { ...routing, ...patch } });

  const patchRow = (i: number, patch: Partial<RoutingRow>) =>
    patchRouting({ routing_rows: rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">Signal routing (ilk_)</p>
        <Button
          variant="outline"
          size="sm"
          className="h-6 text-[10px]"
          disabled={!ems.length}
          onClick={() =>
            patchRouting({
              routing_rows: [
                ...rows,
                {
                  row_id: freshAuthoredId("row"),
                  target: { equipment_module_id: ems[0].id, pin: "" },
                  source: { kind: "io_tag", tag: "" },
                  gates: [],
                },
              ],
            })
          }
        >
          <Plus className="h-3 w-3 mr-0.5" />
          Add row
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">
          No routing rows — physical signals and gates are not routed into EM
          interlock pins.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div key={row.row_id} className="border rounded-md p-2 space-y-1.5">
              <div className="flex items-center gap-1">
                <Select
                  value={row.target.equipment_module_id}
                  onValueChange={(v) => patchRow(i, { target: { ...row.target, equipment_module_id: v } })}
                >
                  <SelectTrigger className="h-6 w-28 text-[10px]" aria-label={`Row ${i + 1} target EM`}>
                    <SelectValue placeholder="EM…" />
                  </SelectTrigger>
                  <SelectContent>
                    {ems.map((em) => (
                      <SelectItem key={em.id} value={em.id} className="text-xs">
                        {em.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  aria-label={`Row ${i + 1} target pin`}
                  value={row.target.pin}
                  placeholder="ilk_ pin"
                  onChange={(e) => patchRow(i, { target: { ...row.target, pin: e.target.value } })}
                  className="h-6 w-36 text-xs font-mono"
                />
                <span className="text-[10px] text-muted-foreground">:=</span>
                <SignalRefEditor
                  value={row.source}
                  label={`Row ${i + 1} source`}
                  ems={ems}
                  declaredGateIds={declaredGateIds}
                  onChange={(source) => patchRow(i, { source })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove row ${i + 1}`}
                  className="h-5 w-5 ml-auto"
                  onClick={() =>
                    patchRouting({
                      routing_rows: rows.filter((_, j) => j !== i),
                      // drop detent pairs referencing the removed row
                      two_detent: detents.filter(
                        (d) => d.jog_row_id !== row.row_id && d.fast_row_id !== row.row_id,
                      ),
                    })
                  }
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <div className="flex items-start gap-2 pl-2">
                <span className="text-[10px] text-muted-foreground pt-1 w-10">AND</span>
                <div className="space-y-1">
                  {row.gates.map((g, gi) => (
                    <div key={gi} className="flex items-center gap-1">
                      <SignalRefEditor
                        value={g}
                        label={`Row ${i + 1} gate ${gi + 1}`}
                        ems={ems}
                        declaredGateIds={declaredGateIds}
                        onChange={(next) =>
                          patchRow(i, { gates: row.gates.map((x, xj) => (xj === gi ? next : x)) })
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove row ${i + 1} gate ${gi + 1}`}
                        className="h-5 w-5"
                        onClick={() => patchRow(i, { gates: row.gates.filter((_, xj) => xj !== gi) })}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-[10px] text-muted-foreground"
                    onClick={() =>
                      patchRow(i, { gates: [...row.gates, { kind: "named_gate", gate_id: declaredGateIds[0] ?? "" }] })
                    }
                  >
                    <Plus className="h-3 w-3 mr-0.5" />
                    gate
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Two-detent pairs */}
      <div className="pt-1 border-t space-y-1.5">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase">
            Two-detent (fast wins; fallback keeps jog driven)
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] text-muted-foreground"
            disabled={rows.length < 2}
            onClick={() =>
              patchRouting({
                two_detent: [
                  ...detents,
                  { jog_row_id: rows[0].row_id, fast_row_id: rows[1].row_id, fallback: true },
                ],
              })
            }
          >
            <Plus className="h-3 w-3 mr-0.5" />
            pair
          </Button>
        </div>
        {detents.map((d, i) => {
          const rowSelect = (
            value: string,
            label: string,
            set: (v: string) => void,
          ) => (
            <Select value={value} onValueChange={set}>
              <SelectTrigger className="h-6 w-40 text-[10px] font-mono" aria-label={label}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {rows.map((r) => (
                  <SelectItem key={r.row_id} value={r.row_id} className="text-xs font-mono">
                    {r.target.pin || r.row_id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
          const patchDetent = (patch: Partial<TwoDetent>) =>
            patchRouting({ two_detent: detents.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
          return (
            <div key={i} className="flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">jog</span>
              {rowSelect(d.jog_row_id, `Pair ${i + 1} jog row`, (v) => patchDetent({ jog_row_id: v }))}
              <span className="text-[10px] text-muted-foreground">fast</span>
              {rowSelect(d.fast_row_id, `Pair ${i + 1} fast row`, (v) => patchDetent({ fast_row_id: v }))}
              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                <input
                  type="checkbox"
                  aria-label={`Pair ${i + 1} fallback`}
                  checked={d.fallback}
                  onChange={(e) => patchDetent({ fallback: e.target.checked })}
                />
                fallback
              </label>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Remove pair ${i + 1}`}
                className="h-5 w-5"
                onClick={() => patchRouting({ two_detent: detents.filter((_, j) => j !== i) })}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
