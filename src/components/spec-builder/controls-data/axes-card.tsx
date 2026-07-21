/**
 * Axes editor (G0-4, G0-16 W1 slice 3) — per-unit envelope geometry: linear
 * (scale/length/end-margin/ramp-zone params + fwd/rev gates) and rotary
 * (counts-per-rev, preset offset, home windows, at-home gate). Gate ids
 * entered here form the named-gate registry routing rows resolve against.
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
import { seedLinearAxis, seedRotaryAxis } from "@/lib/spec-builder/unit-coordination-seed";
import type {
  AxisV1,
  GeometryParamDef,
  LinearAxis,
  RotaryAxis,
  UnitCoordinationV1,
} from "@/types/spec-contract-v2";
import type { EmOption } from "./routing-card";

function ParamRow({
  role,
  param,
  onChange,
}: {
  role: string;
  param: GeometryParamDef;
  onChange: (p: GeometryParamDef) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground w-20">{role}</span>
      <Input
        aria-label={`${role} DB member`}
        value={param.db_member}
        placeholder="db member"
        onChange={(e) => onChange({ ...param, db_member: e.target.value })}
        className="h-6 w-32 text-xs font-mono"
      />
      <Input
        type="number"
        aria-label={`${role} default`}
        value={param.default ?? ""}
        placeholder="seed"
        onChange={(e) =>
          onChange({ ...param, default: e.target.value === "" ? undefined : Number(e.target.value) })
        }
        className="h-6 w-20 text-xs font-mono"
      />
      <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <input
          type="checkbox"
          aria-label={`${role} retained`}
          checked={param.retain}
          onChange={(e) => onChange({ ...param, retain: e.target.checked })}
        />
        retain
      </label>
      <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <input
          type="checkbox"
          aria-label={`${role} operator settable`}
          checked={param.operator_settable}
          onChange={(e) => onChange({ ...param, operator_settable: e.target.checked })}
        />
        operator
      </label>
    </div>
  );
}

function GateIdInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground w-20">{label}</span>
      <Input
        aria-label={`${label} gate id`}
        value={value ?? ""}
        placeholder="gate id (empty = not exposed)"
        onChange={(e) => onChange(e.target.value === "" ? undefined : e.target.value)}
        className="h-6 w-40 text-xs font-mono"
      />
    </div>
  );
}

function LinearAxisForm({
  axis,
  onChange,
}: {
  axis: LinearAxis;
  onChange: (a: LinearAxis) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          aria-label="Encoder tag"
          value={axis.encoder_tag}
          placeholder="encoder tag"
          onChange={(e) => onChange({ ...axis, encoder_tag: e.target.value })}
          className="h-6 w-40 text-xs font-mono"
        />
        <Input
          aria-label="EU unit"
          value={axis.eu_unit}
          placeholder="mm"
          onChange={(e) => onChange({ ...axis, eu_unit: e.target.value })}
          className="h-6 w-16 text-xs font-mono"
        />
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            aria-label="Unconfigured open"
            checked={axis.unconfigured_open}
            onChange={(e) => onChange({ ...axis, unconfigured_open: e.target.checked })}
          />
          gates open while unconfigured
        </label>
      </div>
      <ParamRow role="scale" param={axis.scale} onChange={(p) => onChange({ ...axis, scale: p })} />
      <ParamRow role="length" param={axis.length} onChange={(p) => onChange({ ...axis, length: p })} />
      <ParamRow role="end margin" param={axis.end_margin} onChange={(p) => onChange({ ...axis, end_margin: p })} />
      <ParamRow role="ramp zone" param={axis.ramp_zone} onChange={(p) => onChange({ ...axis, ramp_zone: p })} />
      {(
        [
          ["fwd_ok", "fwd ok"],
          ["fwd_fast_ok", "fwd fast ok"],
          ["rev_ok", "rev ok"],
          ["rev_fast_ok", "rev fast ok"],
        ] as const
      ).map(([key, label]) => (
        <GateIdInput
          key={key}
          label={label}
          value={axis.gates[key]}
          onChange={(v) => onChange({ ...axis, gates: { ...axis.gates, [key]: v } })}
        />
      ))}
    </div>
  );
}

function RotaryAxisForm({
  axis,
  ems,
  onChange,
}: {
  axis: RotaryAxis;
  ems: EmOption[];
  onChange: (a: RotaryAxis) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          aria-label="Encoder tag"
          value={axis.encoder_tag}
          placeholder="encoder tag"
          onChange={(e) => onChange({ ...axis, encoder_tag: e.target.value })}
          className="h-6 w-40 text-xs font-mono"
        />
        <span className="text-[10px] text-muted-foreground">preset offset</span>
        <Input
          type="number"
          aria-label="Preset offset"
          value={axis.preset_offset}
          onChange={(e) => onChange({ ...axis, preset_offset: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
          className="h-6 w-24 text-xs font-mono"
        />
      </div>
      <ParamRow
        role="counts/360"
        param={axis.counts_per_rev}
        onChange={(p) => onChange({ ...axis, counts_per_rev: p })}
      />
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">home windows (deg ×10, ± band)</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5 text-[10px] text-muted-foreground"
            onClick={() =>
              onChange({ ...axis, home_windows: [...axis.home_windows, { center_deg10: 0, band_deg10: 20 }] })
            }
          >
            <Plus className="h-3 w-3 mr-0.5" />
            window
          </Button>
        </div>
        {axis.home_windows.map((w, i) => (
          <div key={i} className="flex items-center gap-1">
            <Input
              type="number"
              aria-label={`Window ${i + 1} center`}
              value={w.center_deg10}
              onChange={(e) =>
                onChange({
                  ...axis,
                  home_windows: axis.home_windows.map((x, j) =>
                    j === i ? { ...x, center_deg10: Math.floor(Number(e.target.value) || 0) } : x,
                  ),
                })
              }
              className="h-6 w-20 text-xs font-mono"
            />
            <span className="text-[10px] text-muted-foreground">±</span>
            <Input
              type="number"
              aria-label={`Window ${i + 1} band`}
              value={w.band_deg10}
              onChange={(e) =>
                onChange({
                  ...axis,
                  home_windows: axis.home_windows.map((x, j) =>
                    j === i ? { ...x, band_deg10: Math.max(1, Math.floor(Number(e.target.value) || 1)) } : x,
                  ),
                })
              }
              className="h-6 w-20 text-xs font-mono"
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Remove window ${i + 1}`}
              className="h-5 w-5"
              disabled={axis.home_windows.length <= 1}
              onClick={() =>
                onChange({ ...axis, home_windows: axis.home_windows.filter((_, j) => j !== i) })
              }
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        ))}
      </div>
      <GateIdInput
        label="at home"
        value={axis.gates.at_home}
        onChange={(v) => onChange({ ...axis, gates: { at_home: v } })}
      />
      <div className="flex items-center gap-1.5">
        <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <input
            type="checkbox"
            aria-label="Encoder presettable"
            checked={!!axis.preset}
            onChange={(e) => onChange({ ...axis, preset: e.target.checked ? {} : undefined })}
          />
          presettable encoder (channels recorded in Engineering Data)
        </label>
        {axis.preset && (
          <Select
            value={axis.preset.blocked_while_em_execute ?? "__none__"}
            onValueChange={(v) =>
              onChange({
                ...axis,
                preset: { blocked_while_em_execute: v === "__none__" ? undefined : v },
              })
            }
          >
            <SelectTrigger className="h-6 w-44 text-[10px]" aria-label="Preset run-interlock EM">
              <SelectValue placeholder="run-interlock EM…" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs text-muted-foreground">
                no run-interlock
              </SelectItem>
              {ems.map((em) => (
                <SelectItem key={em.id} value={em.id} className="text-xs">
                  blocked while {em.name} executes
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

export function AxesCard({
  coord,
  ems,
  patchCoord,
}: {
  coord: UnitCoordinationV1;
  ems: EmOption[];
  patchCoord: (patch: Partial<UnitCoordinationV1>) => void;
}) {
  const axes = coord.axes ?? [];
  const setAxis = (i: number, next: AxisV1) =>
    patchCoord({ axes: axes.map((a, j) => (j === i ? next : a)) });

  return (
    <Card className="p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold">Axes (envelope geometry)</p>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px]"
            onClick={() => patchCoord({ axes: [...axes, seedLinearAxis(`axis_${axes.length + 1}`)] })}
          >
            <Plus className="h-3 w-3 mr-0.5" />
            Linear
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[10px]"
            onClick={() => patchCoord({ axes: [...axes, seedRotaryAxis(`axis_${axes.length + 1}`)] })}
          >
            <Plus className="h-3 w-3 mr-0.5" />
            Rotary
          </Button>
        </div>
      </div>
      {axes.length === 0 ? (
        <p className="text-[10px] text-muted-foreground">
          No axes — no CFG/STAT DBs, no envelope gates; named-gate routing refs
          will fail validation.
        </p>
      ) : (
        <div className="space-y-3">
          {axes.map((axis, i) => (
            <div key={i} className="border rounded-md p-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Input
                  aria-label={`Axis ${i + 1} id`}
                  value={axis.axis_id}
                  onChange={(e) => setAxis(i, { ...axis, axis_id: e.target.value })}
                  className="h-6 w-32 text-xs font-mono"
                />
                <span className="text-[10px] text-muted-foreground uppercase">{axis.kind}</span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove axis ${i + 1}`}
                  className="h-5 w-5 ml-auto"
                  onClick={() => patchCoord({ axes: axes.filter((_, j) => j !== i) })}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              {axis.kind === "linear" ? (
                <LinearAxisForm axis={axis} onChange={(a) => setAxis(i, a)} />
              ) : (
                <RotaryAxisForm axis={axis} ems={ems} onChange={(a) => setAxis(i, a)} />
              )}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
