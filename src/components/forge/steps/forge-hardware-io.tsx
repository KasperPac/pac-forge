import { useState, useEffect } from "react";
import { Plus, Trash2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { matchDevicesToTemplates, applyMatchesToDevices } from "@/lib/forge-device-matcher";
import type {
  SpecAnalysis,
  ForgeHardwareConfig,
  ForgeIoEntry,
  ForgeDeviceEntry,
  ForgeIoModule,
} from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";

export interface ForgeHardwareIoProps {
  specAnalysis: SpecAnalysis | null;
  fbTemplates: FbTemplate[];
  deviceFbLanguage?: "SCL" | "LAD";
  onComplete: (
    hardware: ForgeHardwareConfig,
    ioList: ForgeIoEntry[],
    devices: ForgeDeviceEntry[],
  ) => void;
}

const SIGNAL_TYPES = ["DI", "DQ", "AI", "AQ"] as const;

function devicesFromAnalysis(analysis: SpecAnalysis): ForgeDeviceEntry[] {
  return (analysis.devices ?? []).map(d => ({
    id: d.id,
    name: d.name,
    tag: d.tag,
    device_type: d.device_type,
    description: d.description,
    subsystem: d.subsystem,
    io_signals: d.io_signals,
    fb_template_id: null,
    fb_match_confidence: "none" as const,
    language_override: null,
    approved: false,
  }));
}

function ioFromAnalysis(analysis: SpecAnalysis): ForgeIoEntry[] {
  const entries: ForgeIoEntry[] = [];
  for (const device of (analysis.devices ?? [])) {
    for (const sig of device.io_signals) {
      entries.push({
        address: "",
        tag_name: sig.tag_name,
        signal_type: sig.signal_type,
        data_type: sig.signal_type.startsWith("A") ? "Real" : "Bool",
        description: sig.description,
        module: "",
        slot: 0,
        device_id: device.id,
      });
    }
  }
  return entries;
}

export function ForgeHardwareIo({ specAnalysis, fbTemplates, deviceFbLanguage = "SCL", onComplete }: ForgeHardwareIoProps) {
  const [hardware, setHardware] = useState<ForgeHardwareConfig>({
    cpu_type: specAnalysis?.plc_type ?? "S7-1500",
    tia_version: "V18",
    racks: [{ rack: 0, modules: [] }],
  });

  const [ioList, setIoList] = useState<ForgeIoEntry[]>(
    specAnalysis ? ioFromAnalysis(specAnalysis) : [],
  );

  const [devices, setDevices] = useState<ForgeDeviceEntry[]>(() => {
    const raw = specAnalysis ? devicesFromAnalysis(specAnalysis) : [];
    const matches = matchDevicesToTemplates(raw, fbTemplates);
    return applyMatchesToDevices(raw, matches);
  });

  // Re-run matcher when templates arrive
  useEffect(() => {
    if (fbTemplates.length > 0) {
      setDevices(prev => {
        const matches = matchDevicesToTemplates(prev, fbTemplates);
        return applyMatchesToDevices(prev, matches);
      });
    }
  }, [fbTemplates]);

  // --- Hardware tab helpers ---
  function addModule(rackIdx: number) {
    setHardware(prev => {
      const racks = [...prev.racks];
      const rack = { ...racks[rackIdx], modules: [...racks[rackIdx].modules, { slot: racks[rackIdx].modules.length + 1, rack: racks[rackIdx].rack, module_type: "", description: "" } as ForgeIoModule] };
      racks[rackIdx] = rack;
      return { ...prev, racks };
    });
  }

  function updateModule(rackIdx: number, modIdx: number, key: keyof ForgeIoModule, value: string | number) {
    setHardware(prev => {
      const racks = prev.racks.map((r, ri) => {
        if (ri !== rackIdx) return r;
        const modules = r.modules.map((m, mi) => mi === modIdx ? { ...m, [key]: value } : m);
        return { ...r, modules };
      });
      return { ...prev, racks };
    });
  }

  function removeModule(rackIdx: number, modIdx: number) {
    setHardware(prev => {
      const racks = prev.racks.map((r, ri) => ri === rackIdx
        ? { ...r, modules: r.modules.filter((_, mi) => mi !== modIdx) }
        : r
      );
      return { ...prev, racks };
    });
  }

  // --- IO list helpers ---
  function addIoRow() {
    setIoList(prev => [...prev, { address: "", tag_name: "", signal_type: "DI", data_type: "Bool", description: "", module: "", slot: 0 }]);
  }

  function updateIo(idx: number, key: keyof ForgeIoEntry, value: string | number) {
    setIoList(prev => prev.map((r, i) => i === idx ? { ...r, [key]: value } : r));
  }

  function removeIo(idx: number) {
    setIoList(prev => prev.filter((_, i) => i !== idx));
  }

  // --- Device list helpers ---
  function updateDeviceTemplate(deviceId: string, templateId: string) {
    setDevices(prev => prev.map(d => d.id === deviceId ? { ...d, fb_template_id: templateId === "__ai__" ? null : templateId, fb_match_confidence: templateId === "__ai__" ? "none" : "exact" } : d));
  }

  function updateDeviceLanguage(deviceId: string, value: string) {
    const override = value === "__default__" ? null : (value as "SCL" | "LAD");
    setDevices(prev => prev.map(d => d.id === deviceId ? { ...d, language_override: override } : d));
  }

  function confidenceBadge(conf: ForgeDeviceEntry["fb_match_confidence"]) {
    if (conf === "exact") return <Badge variant="outline" className="border-green-600/50 font-mono text-[10px] text-green-500">exact</Badge>;
    if (conf === "probable") return <Badge variant="outline" className="border-yellow-600/50 font-mono text-[10px] text-yellow-500">probable</Badge>;
    return <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">AI gen</Badge>;
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <Tabs defaultValue="io" className="flex flex-1 flex-col">
        <TabsList className="w-fit">
          <TabsTrigger value="hardware" className="font-mono text-xs uppercase tracking-wider">Hardware</TabsTrigger>
          <TabsTrigger value="io" className="font-mono text-xs uppercase tracking-wider">IO List</TabsTrigger>
          <TabsTrigger value="devices" className="font-mono text-xs uppercase tracking-wider">Devices</TabsTrigger>
        </TabsList>

        {/* Hardware Tab */}
        <TabsContent value="hardware" className="mt-3 flex-1">
          <ScrollArea className="h-full">
            {hardware.racks.map((rack, rackIdx) => (
              <div key={rackIdx} className="mb-4">
                <div className="mb-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  Rack {rack.rack} — CPU: {hardware.cpu_type}
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60">
                      {["Slot", "Module Type", "Order No.", "Description", ""].map(h => (
                        <th key={h} className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rack.modules.map((mod, modIdx) => (
                      <tr key={modIdx} className="border-b border-border/40">
                        <td className="px-3 py-1.5 w-16">
                          <Input value={mod.slot} onChange={e => updateModule(rackIdx, modIdx, "slot", parseInt(e.target.value) || 0)} className="h-7 w-14 font-mono text-xs" />
                        </td>
                        <td className="px-3 py-1.5">
                          <Input value={mod.module_type} onChange={e => updateModule(rackIdx, modIdx, "module_type", e.target.value)} className="h-7 font-mono text-xs" placeholder="e.g. DI 16x24VDC HF" />
                        </td>
                        <td className="px-3 py-1.5">
                          <Input value={mod.order_number ?? ""} onChange={e => updateModule(rackIdx, modIdx, "order_number", e.target.value)} className="h-7 font-mono text-xs" placeholder="6ES7..." />
                        </td>
                        <td className="px-3 py-1.5">
                          <Input value={mod.description ?? ""} onChange={e => updateModule(rackIdx, modIdx, "description", e.target.value)} className="h-7 text-xs" />
                        </td>
                        <td className="px-2">
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeModule(rackIdx, modIdx)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => addModule(rackIdx)}>
                  <Plus className="mr-1.5 h-3.5 w-3.5" /> Add Module
                </Button>
              </div>
            ))}
          </ScrollArea>
        </TabsContent>

        {/* IO List Tab */}
        <TabsContent value="io" className="mt-3 flex-1">
          <ScrollArea className="h-[420px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background/90">
                <tr className="border-b border-border/60">
                  {["Address", "Tag Name", "Type", "Data Type", "Description", "Module", "Slot", ""].map(h => (
                    <th key={h} className="px-2 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ioList.map((row, i) => (
                  <tr key={i} className="border-b border-border/40">
                    <td className="px-2 py-1">
                      <Input value={row.address} onChange={e => updateIo(i, "address", e.target.value)} className="h-7 w-24 font-mono text-xs" placeholder="%I0.0" />
                    </td>
                    <td className="px-2 py-1">
                      <Input value={row.tag_name} onChange={e => updateIo(i, "tag_name", e.target.value)} className="h-7 font-mono text-xs" />
                    </td>
                    <td className="px-2 py-1">
                      <Select value={row.signal_type} onValueChange={v => updateIo(i, "signal_type", v)}>
                        <SelectTrigger className="h-7 w-20 font-mono text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {SIGNAL_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-2 py-1">
                      <Input value={row.data_type} onChange={e => updateIo(i, "data_type", e.target.value)} className="h-7 w-20 font-mono text-xs" />
                    </td>
                    <td className="px-2 py-1">
                      <Input value={row.description} onChange={e => updateIo(i, "description", e.target.value)} className="h-7 text-xs" />
                    </td>
                    <td className="px-2 py-1">
                      <Input value={row.module} onChange={e => updateIo(i, "module", e.target.value)} className="h-7 w-20 font-mono text-xs" />
                    </td>
                    <td className="px-2 py-1">
                      <Input value={row.slot} onChange={e => updateIo(i, "slot", parseInt(e.target.value) || 0)} className="h-7 w-14 font-mono text-xs" type="number" />
                    </td>
                    <td className="px-1">
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive" onClick={() => removeIo(i)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
          <Button variant="outline" size="sm" className="mt-2" onClick={addIoRow}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add IO Point
          </Button>
        </TabsContent>

        {/* Devices Tab */}
        <TabsContent value="devices" className="mt-3 flex-1">
          <ScrollArea className="h-[420px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background/90">
                <tr className="border-b border-border/60">
                  {["Name", "Tag", "Type", "Subsystem", "FB Template", "Language", "IO", "Match"].map(h => (
                    <th key={h} className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {devices.map(d => (
                  <tr key={d.id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-mono text-xs">{d.name}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{d.tag}</td>
                    <td className="px-3 py-1.5 text-xs">{d.device_type}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{d.subsystem}</td>
                    <td className="px-3 py-1.5">
                      <Select
                        value={d.fb_template_id ?? "__ai__"}
                        onValueChange={v => updateDeviceTemplate(d.id, v)}
                      >
                        <SelectTrigger className="h-7 w-48 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__ai__">AI Generate</SelectItem>
                          {fbTemplates.map(t => (
                            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-1.5">
                      <Select
                        value={d.language_override ?? "__default__"}
                        onValueChange={v => updateDeviceLanguage(d.id, v)}
                      >
                        <SelectTrigger className="h-7 w-28 font-mono text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default__">
                            <span>Default <span className="text-muted-foreground">({deviceFbLanguage})</span></span>
                          </SelectItem>
                          <SelectItem value="SCL">SCL</SelectItem>
                          <SelectItem value="LAD">LAD</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs">{d.io_signals.length}</td>
                    <td className="px-3 py-1.5">{confidenceBadge(d.fb_match_confidence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </TabsContent>
      </Tabs>

      <Button className="w-full" onClick={() => onComplete(hardware, ioList, devices)}>
        Confirm Hardware & IO
        <ChevronRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}
