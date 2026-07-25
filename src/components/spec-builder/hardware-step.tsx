import { useState } from "react";
import { AlertTriangle, Loader2, Plus, Search, Trash2 } from "lucide-react";
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
import { inferModuleShape, type CatalogProduct } from "@/lib/spec-builder/hardware-catalog";
import { useHardwareCatalog, MIN_FILTER_LENGTH } from "@/hooks/use-hardware-catalog";

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
  const [pickingCpu, setPickingCpu] = useState(false);
  const [pickingModule, setPickingModule] = useState(false);

  /* The catalogue's compatibility filter keys off the CPU's type identifier,
   * which is exactly `OrderNumber:<mlfb>/<firmware>` — so it can be rebuilt
   * from what a CPU pick already stored, with no extra field on the model. */
  const cpuTypeIdentifier =
    hardware.cpu.cpu_order_number && hardware.cpu.firmware
      ? `OrderNumber:${hardware.cpu.cpu_order_number}/${hardware.cpu.firmware}`
      : undefined;

  const setCpu = (patch: Partial<HardwareModelV1["cpu"]>) =>
    onChange({ ...hardware, cpu: { ...hardware.cpu, ...patch } });

  const setModules = (next: HardwareModelV1["racks"][number]["modules"]) => {
    const racks = hardware.racks.length ? [...hardware.racks] : [{ rack: 0, modules: [] }];
    racks[0] = { ...racks[0], modules: next };
    onChange({ ...hardware, racks });
  };

  /* Next free slot is max+1, not length+1 — deleting a row from the middle used
   * to hand the next card an already-occupied slot, and the collision only
   * surfaced as unplugged hardware in TIA. */
  const nextSlot = () => modules.reduce((max, m) => Math.max(max, m.slot), 0) + 1;

  const addModule = () =>
    setModules([...modules, { slot: nextSlot(), module_type: "" }]);
  const removeModule = (i: number) => setModules(modules.filter((_, j) => j !== i));
  const updateModule = (i: number, patch: Partial<(typeof modules)[number]>) =>
    setModules(modules.map((m, j) => (j === i ? { ...m, ...patch } : m)));

  return (
    <div className="space-y-4">
      {/* CPU */}
      <div className="grid gap-3 max-w-lg">
        <div className="flex items-center justify-between">
          <Label className="text-xs font-medium">CPU</Label>
          <Button variant="outline" size="sm" className="h-7 gap-1 text-xs"
            onClick={() => setPickingCpu((v) => !v)}>
            <Search className="h-3 w-3" /> Browse catalogue
          </Button>
        </div>
        {pickingCpu && (
          <CatalogPicker
            placeholder="Search CPUs — e.g. 1516 or 6ES7 516"
            onPick={(product, version) => {
              setCpu({
                cpu_type: product.typeName,
                cpu_order_number: product.articleNumber,
                firmware: version,
              });
              setPickingCpu(false);
            }}
          />
        )}
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
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPickingModule((v) => !v)}>
            <Search className="h-3 w-3 mr-1" /> Add from catalogue
          </Button>
          <Button variant="ghost" size="sm" onClick={addModule}>
            <Plus className="h-3 w-3 mr-1" /> Blank row
          </Button>
        </div>
      </div>
      {pickingModule && (
        <CatalogPicker
          placeholder={
            cpuTypeIdentifier
              ? "Search IO cards — e.g. DI 16 or 6ES7 521"
              : "Search IO cards (pick a CPU first to filter to compatible cards)"
          }
          typeIdentifier={cpuTypeIdentifier}
          onPick={(product, version) => {
            setModules([
              ...modules,
              {
                slot: nextSlot(),
                module_type: product.typeName,
                order_number: product.articleNumber,
                // Firmware is known from the catalogue, so the bridge never has
                // to ladder-try suffixes for this card.
                description: version,
                ...inferModuleShape(product.typeName),
              },
            ]);
            setPickingModule(false);
          }}
        />
      )}
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

/**
 * Search TIA's installed catalogue and pick a part. Purely an accelerator over
 * the free-text fields — when the bridge is offline it says so and gets out of
 * the way, because the FDS has to stay authorable with no TIA running.
 */
function CatalogPicker({
  placeholder,
  typeIdentifier,
  onPick,
}: {
  placeholder: string;
  typeIdentifier?: string;
  onPick: (product: CatalogProduct, version: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const { products, unavailable, searching, enabled } = useHardwareCatalog(filter, typeIdentifier);

  return (
    <Card className="p-2 space-y-2" data-testid="catalog-picker">
      <div className="flex items-center gap-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Input
          autoFocus
          value={filter}
          placeholder={placeholder}
          className="h-7 text-sm"
          onChange={(e) => setFilter(e.target.value)}
        />
        {searching && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
      </div>

      {!enabled && (
        <p className="text-[11px] text-muted-foreground">
          Type at least {MIN_FILTER_LENGTH} characters. Matches article numbers and
          product names.
        </p>
      )}
      {unavailable && (
        <p className="text-[11px] text-amber-600">
          TIA bridge unavailable — enter the CPU and modules by hand below. The
          catalogue only works with TIA Portal running.
        </p>
      )}
      {enabled && !searching && !unavailable && products.length === 0 && (
        <p className="text-[11px] text-muted-foreground">No catalogue matches.</p>
      )}

      {products.length > 0 && (
        <ul className="max-h-56 overflow-y-auto divide-y divide-border">
          {products.map((p) => (
            <li key={p.articleNumber}>
              <button
                type="button"
                className="w-full text-left py-1.5 px-1 hover:bg-muted/50 focus:bg-muted/50 focus:outline-none"
                onClick={() => onPick(p, p.versions[0]?.version ?? "")}
              >
                <span className="text-xs font-medium">{p.typeName}</span>
                <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                  {p.articleNumber}
                </span>
                {p.versions.length > 0 && (
                  <span className="ml-2 font-mono text-[10px] text-muted-foreground">
                    {p.versions[0].version}
                    {p.versions.length > 1 ? ` (+${p.versions.length - 1})` : ""}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
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
