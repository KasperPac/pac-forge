import { useState, useEffect, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { HardwareConfigEditor } from "@/components/hardware-config-editor";
import { IoListEditor } from "@/components/io-list-editor";
import { matchDevicesToTemplates, applyMatchesToDevices } from "@/lib/forge-device-matcher";
import type { IoEntry, RackSlotLayout, CpuType } from "@/types";
import type {
  SpecAnalysis,
  ForgeHardwareConfig,
  ForgeIoEntry,
  ForgeDeviceEntry,
} from "@/types/forge";
import type { FbTemplate } from "@/types/fb-template";

// ── Type conversions ──────────────────────────────────────────────────────────

function inferSignalType(address: string): ForgeIoEntry["signal_type"] {
  const upper = address.toUpperCase();
  if (upper.startsWith("%IW") || upper.startsWith("%ID") || upper.startsWith("%IR")) return "AI";
  if (upper.startsWith("%QW") || upper.startsWith("%QD") || upper.startsWith("%QR")) return "AQ";
  if (upper.startsWith("%I")) return "DI";
  if (upper.startsWith("%Q")) return "DQ";
  return "DI";
}

function forgeIoToIoEntry(e: ForgeIoEntry): IoEntry {
  return {
    address: e.address,
    tag_name: e.tag_name,
    data_type: e.data_type,
    description: e.description,
    module: e.module,
    slot: e.slot,
  };
}

function ioEntryToForgeIo(
  e: IoEntry,
  existingMap?: Map<string, ForgeIoEntry>,
): ForgeIoEntry {
  const existing = existingMap?.get(e.tag_name);
  return {
    address: e.address,
    tag_name: e.tag_name,
    data_type: e.data_type,
    description: e.description,
    module: e.module,
    slot: e.slot,
    signal_type: existing?.signal_type ?? inferSignalType(e.address),
    device_id: existing?.device_id,
  };
}

function forgeHardwareToRackLayout(hardware: ForgeHardwareConfig): RackSlotLayout[] {
  return hardware.racks.map((r) => ({
    rack: r.rack,
    slots: r.modules.map((m) => ({
      slot: m.slot,
      module_type: m.module_type,
      order_number: m.order_number,
      description: m.description,
    })),
  }));
}

function rackLayoutToForgeHardware(
  layout: RackSlotLayout[],
  existing: ForgeHardwareConfig,
): ForgeHardwareConfig {
  return {
    ...existing,
    racks: layout.map((r) => ({
      rack: r.rack,
      modules: r.slots.map((s) => ({
        slot: s.slot,
        rack: r.rack,
        module_type: s.module_type,
        order_number: s.order_number,
        description: s.description,
      })),
    })),
  };
}

// ── Spec-analysis helpers ─────────────────────────────────────────────────────

function devicesFromAnalysis(analysis: SpecAnalysis): ForgeDeviceEntry[] {
  return (analysis.devices ?? []).map((d) => ({
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

// ── Props ─────────────────────────────────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

export function ForgeHardwareIo({
  specAnalysis,
  fbTemplates,
  deviceFbLanguage = "SCL",
  onComplete,
}: ForgeHardwareIoProps) {
  const [hardware, setHardware] = useState<ForgeHardwareConfig>({
    cpu_type: specAnalysis?.plc_type ?? "S7-1500",
    tia_version: "V18",
    racks: [{ rack: 0, modules: [] }],
  });

  const [ioList, setIoList] = useState<ForgeIoEntry[]>(
    specAnalysis ? ioFromAnalysis(specAnalysis) : [],
  );

  // Incremented when hardware generates a new IO list — forces IoListEditor remount
  const [ioListKey, setIoListKey] = useState(0);

  const [devices, setDevices] = useState<ForgeDeviceEntry[]>(() => {
    const raw = specAnalysis ? devicesFromAnalysis(specAnalysis) : [];
    const matches = matchDevicesToTemplates(raw, fbTemplates);
    return applyMatchesToDevices(raw, matches);
  });

  // Re-run matcher when templates arrive
  useEffect(() => {
    if (fbTemplates.length > 0) {
      setDevices((prev) => {
        const matches = matchDevicesToTemplates(prev, fbTemplates);
        return applyMatchesToDevices(prev, matches);
      });
    }
  }, [fbTemplates]);

  // ── Hardware save handler ─────────────────────────────────────────────────

  const handleHardwareSave = useCallback(
    (layout: RackSlotLayout[], generatedIo?: IoEntry[]) => {
      setHardware((prev) => rackLayoutToForgeHardware(layout, prev));

      if (generatedIo) {
        // Build lookup by tag_name to preserve signal_type / device_id from existing entries
        const existingMap = new Map(ioList.map((e) => [e.tag_name, e]));
        const forgeIo = generatedIo.map((e) => ioEntryToForgeIo(e, existingMap));
        setIoList(forgeIo);
        setIoListKey((k) => k + 1); // remount IoListEditor with new initial value
      }
    },
    [ioList],
  );

  // ── IO list change handler ────────────────────────────────────────────────

  const handleIoChange = useCallback(
    (updated: IoEntry[]) => {
      const existingMap = new Map(ioList.map((e) => [e.tag_name, e]));
      setIoList(updated.map((e) => ioEntryToForgeIo(e, existingMap)));
    },
    [ioList],
  );

  // ── Device helpers ────────────────────────────────────────────────────────

  function updateDeviceTemplate(deviceId: string, templateId: string) {
    setDevices((prev) =>
      prev.map((d) =>
        d.id === deviceId
          ? {
              ...d,
              fb_template_id: templateId === "__ai__" ? null : templateId,
              fb_match_confidence: templateId === "__ai__" ? "none" : "exact",
            }
          : d,
      ),
    );
  }

  function updateDeviceLanguage(deviceId: string, value: string) {
    const override = value === "__default__" ? null : (value as "SCL" | "LAD");
    setDevices((prev) =>
      prev.map((d) => (d.id === deviceId ? { ...d, language_override: override } : d)),
    );
  }

  function confidenceBadge(conf: ForgeDeviceEntry["fb_match_confidence"]) {
    if (conf === "exact")
      return (
        <Badge variant="outline" className="border-green-600/50 font-mono text-[10px] text-green-500">
          exact
        </Badge>
      );
    if (conf === "probable")
      return (
        <Badge variant="outline" className="border-yellow-600/50 font-mono text-[10px] text-yellow-500">
          probable
        </Badge>
      );
    return (
      <Badge variant="outline" className="font-mono text-[10px] text-muted-foreground">
        AI gen
      </Badge>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const rackLayout = forgeHardwareToRackLayout(hardware);
  const ioEntries = ioList.map(forgeIoToIoEntry);

  return (
    <div className="flex h-full flex-col gap-3">
      <Tabs defaultValue="hardware" className="flex flex-1 flex-col">
        <TabsList className="w-fit">
          <TabsTrigger value="hardware" className="font-mono text-xs uppercase tracking-wider">
            Hardware
          </TabsTrigger>
          <TabsTrigger value="io" className="font-mono text-xs uppercase tracking-wider">
            IO List
          </TabsTrigger>
          <TabsTrigger value="devices" className="font-mono text-xs uppercase tracking-wider">
            Devices
          </TabsTrigger>
        </TabsList>

        {/* Hardware Tab */}
        <TabsContent value="hardware" className="mt-3 flex-1">
          <ScrollArea className="h-[480px] pr-1">
            <HardwareConfigEditor
              cpuType={hardware.cpu_type as CpuType}
              rackSlotLayout={rackLayout}
              onSave={handleHardwareSave}
              existingIoEntries={ioEntries}
              saving={false}
            />
          </ScrollArea>
        </TabsContent>

        {/* IO List Tab */}
        <TabsContent value="io" className="mt-3 flex-1">
          <ScrollArea className="h-[480px] pr-1">
            <IoListEditor
              key={ioListKey}
              value={ioEntries}
              onChange={handleIoChange}
            />
          </ScrollArea>
        </TabsContent>

        {/* Devices Tab */}
        <TabsContent value="devices" className="mt-3 flex-1">
          <ScrollArea className="h-[480px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-background/90">
                <tr className="border-b border-border/60">
                  {["Name", "Tag", "Type", "Subsystem", "FB Template", "Language", "IO", "Match"].map(
                    (h) => (
                      <th
                        key={h}
                        className="px-3 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                      >
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {devices.map((d) => (
                  <tr key={d.id} className="border-b border-border/40 hover:bg-muted/20">
                    <td className="px-3 py-1.5 font-mono text-xs">{d.name}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{d.tag}</td>
                    <td className="px-3 py-1.5 text-xs">{d.device_type}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{d.subsystem}</td>
                    <td className="px-3 py-1.5">
                      <Select
                        value={d.fb_template_id ?? "__ai__"}
                        onValueChange={(v) => updateDeviceTemplate(d.id, v)}
                      >
                        <SelectTrigger className="h-7 w-48 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__ai__">AI Generate</SelectItem>
                          {fbTemplates.map((t) => (
                            <SelectItem key={t.id} value={t.id}>
                              {t.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-3 py-1.5">
                      <Select
                        value={d.language_override ?? "__default__"}
                        onValueChange={(v) => updateDeviceLanguage(d.id, v)}
                      >
                        <SelectTrigger className="h-7 w-28 font-mono text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__default__">
                            <span>
                              Default{" "}
                              <span className="text-muted-foreground">({deviceFbLanguage})</span>
                            </span>
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
