import { AlertTriangle, Plus, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { HardwareModelV1, HardwareSignalType } from "@/types/spec-contract-v2";
import { validateHardwareFit, type FitSignal } from "@/lib/spec-builder/hardware-fit";

const SIGNAL_TYPES: HardwareSignalType[] = ["DI", "DO", "AI", "AO"];

export function emptyHardware(): HardwareModelV1 {
  return { platform: "SIEMENS_TIA", cpu: { cpu_type: "" }, racks: [{ rack: 0, modules: [] }] };
}

export function plcModelFromHardware(h?: HardwareModelV1 | null): string {
  return h?.cpu.cpu_type?.trim() ?? "";
}

export function HardwareStep({
  hardware,
  onChange,
  signals,
}: {
  hardware: HardwareModelV1;
  onChange: (h: HardwareModelV1) => void;
  signals: FitSignal[];
}) {
  const warnings = validateHardwareFit(hardware, signals);
  const modules = hardware.racks[0]?.modules ?? [];

  const setCpu = (patch: Partial<HardwareModelV1["cpu"]>) =>
    onChange({ ...hardware, cpu: { ...hardware.cpu, ...patch } });

  const setModules = (next: HardwareModelV1["racks"][number]["modules"]) => {
    const racks = hardware.racks.length ? [...hardware.racks] : [{ rack: 0, modules: [] }];
    racks[0] = { ...racks[0], modules: next };
    onChange({ ...hardware, racks });
  };

  const addModule = () =>
    setModules([...modules, { slot: modules.length + 1, module_type: "" }]);
  const removeModule = (i: number) => setModules(modules.filter((_, j) => j !== i));
  const updateModule = (i: number, patch: Partial<(typeof modules)[number]>) =>
    setModules(modules.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  return (
    <div className="space-y-4">
      {/* CPU */}
      <div className="grid gap-3 max-w-lg">
        <div className="grid grid-cols-2 gap-3">
          <Field label="CPU Model *" value={hardware.cpu.cpu_type}
            onChange={(v) => setCpu({ cpu_type: v })} placeholder="e.g. CPU 1515-2 PN" />
          <Field label="Order Number" mono value={hardware.cpu.cpu_order_number ?? ""}
            onChange={(v) => setCpu({ cpu_order_number: v || undefined })} placeholder="6ES7 …" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Firmware" mono value={hardware.cpu.firmware ?? ""}
            onChange={(v) => setCpu({ firmware: v || undefined })} placeholder="newest if blank" />
          <Field label="TIA Version" mono value={hardware.tia_version ?? ""}
            onChange={(v) => onChange({ ...hardware, tia_version: v || undefined })} placeholder="e.g. V20" />
        </div>
      </div>

      {/* Fit banner */}
      {warnings.length > 0 && (
        <Card data-testid="hardware-fit-warnings" className="p-3 border-amber-500/50 bg-amber-500/5 space-y-1">
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5" /> Hardware does not cover all IO ({warnings.length})
          </div>
          <ul className="text-[11px] font-mono text-amber-800 space-y-0.5">
            {warnings.map((w, i) => <li key={i}>{w.message}</li>)}
          </ul>
        </Card>
      )}

      {/* Module table */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          IO modules on the central rack. Warnings above are advisory — you can proceed regardless.
        </p>
        <Button variant="outline" size="sm" onClick={addModule}>
          <Plus className="h-3 w-3 mr-1" /> Add Module
        </Button>
      </div>
      <div className="grid gap-2">
        {modules.map((m, i) => (
          <Card key={i} className="p-2 grid grid-cols-[3rem_1fr_5rem_6rem_2rem] gap-2 items-center">
            <Input type="number" value={m.slot} className="h-7 text-xs"
              onChange={(e) => updateModule(i, { slot: Number(e.target.value) })} />
            <Input value={m.module_type} placeholder="Module type (e.g. DI 16x24VDC)" className="h-7 text-sm"
              onChange={(e) => updateModule(i, { module_type: e.target.value })} />
            <Input type="number" value={m.channel_count ?? ""} placeholder="ch" className="h-7 text-xs"
              onChange={(e) => updateModule(i, { channel_count: e.target.value ? Number(e.target.value) : undefined })} />
            <Select value={m.signal_type ?? ""}
              onValueChange={(v) => updateModule(i, { signal_type: v as HardwareSignalType })}>
              <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="type" /></SelectTrigger>
              <SelectContent>
                {SIGNAL_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeModule(i)}>
              <Trash2 className="h-3 w-3" />
            </Button>
          </Card>
        ))}
      </div>

      {/* DOCX appendix toggle */}
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <Checkbox checked={hardware.render_in_docx ?? false}
          onCheckedChange={(v) => onChange({ ...hardware, render_in_docx: v === true })} />
        Include a hardware schedule in the exported FDS document
      </label>
    </div>
  );
}

function Field({
  label, value, onChange, placeholder, mono,
}: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; mono?: boolean }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">{label}</Label>
      <Input value={value} placeholder={placeholder}
        className={mono ? "text-sm font-mono" : "text-sm"}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
