import { useState, useEffect, useCallback, useId, useMemo } from "react";
import { ChevronRight, Plus, Trash2, ChevronDown, ChevronRight as ChevronRightIcon, Lightbulb, X as XIcon } from "lucide-react";
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
import { HardwareConfigEditor } from "@/components/hardware-config-editor";
import { IoListEditor } from "@/components/io-list-editor";
import { matchDevicesToTemplates, applyMatchesToDevices, suggestMissingDevices } from "@/lib/forge-device-matcher";
import type { MissingDeviceSuggestion } from "@/lib/forge-device-matcher";
import { DEVICE_TYPE_IO_DEFAULTS, DEVICE_TYPES } from "@/lib/device-type-io-defaults";
import { getCompatibleModules, getModuleByMlfb } from "@/lib/module-catalog";
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
    io_signals: d.io_signals ?? [],
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

// ── IO summary ────────────────────────────────────────────────────────────────

function countIoSignals(devices: ForgeDeviceEntry[]) {
  const counts = { DI: 0, DQ: 0, AI: 0, AQ: 0 };
  for (const d of devices) {
    for (const sig of d.io_signals ?? []) {
      const t = sig.signal_type.toUpperCase() as keyof typeof counts;
      if (t in counts) counts[t]++;
    }
  }
  return counts;
}

// ── Physical address pool ─────────────────────────────────────────────────────

export interface PhysicalPoint {
  address: string;
  slot: number;
  module: string;
  signalType: "DI" | "DQ" | "AI" | "AQ";
}

/**
 * Enumerate every physical IO point available in the current rack layout.
 * DI/DQ use bit addresses (%I/%Q); AI/AQ use word addresses (%IW/%QW).
 * Returns empty array when no modules have been recommended yet.
 */
function buildAddressPool(hardware: ForgeHardwareConfig): PhysicalPoint[] {
  const modules = hardware.racks[0]?.modules ?? [];
  if (modules.length === 0) return [];

  const pool: PhysicalPoint[] = [];
  const is1200 = hardware.cpu_type.startsWith("S7-12");

  let diByte = 0, diBit = 0;
  let dqByte = 0, dqBit = 0;
  let aiWord = is1200 ? 64 : 0;
  let aqWord = is1200 ? 64 : 0;

  for (const mod of modules) {
    const catalog = mod.order_number ? getModuleByMlfb(mod.order_number) : undefined;
    const label = catalog?.shortLabel ?? mod.module_type;

    const diCount = catalog?.diChannels ?? 0;
    const dqCount = catalog?.dqChannels ?? 0;
    const aiCount = catalog?.aiChannels ?? 0;
    const aqCount = catalog?.aqChannels ?? 0;

    for (let i = 0; i < diCount; i++) {
      pool.push({ address: `%I${diByte}.${diBit}`, slot: mod.slot, module: label, signalType: "DI" });
      diBit++; if (diBit > 7) { diBit = 0; diByte++; }
    }
    for (let i = 0; i < dqCount; i++) {
      pool.push({ address: `%Q${dqByte}.${dqBit}`, slot: mod.slot, module: label, signalType: "DQ" });
      dqBit++; if (dqBit > 7) { dqBit = 0; dqByte++; }
    }
    for (let i = 0; i < aiCount; i++) {
      pool.push({ address: `%IW${aiWord}`, slot: mod.slot, module: label, signalType: "AI" });
      aiWord += 2;
    }
    for (let i = 0; i < aqCount; i++) {
      pool.push({ address: `%QW${aqWord}`, slot: mod.slot, module: label, signalType: "AQ" });
      aqWord += 2;
    }
  }

  return pool;
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

// ── Add Device Form State ─────────────────────────────────────────────────────

interface AddDeviceForm {
  device_type: string;
  name: string;
  tag: string;
  subsystem: string;
  description: string;
  quantity: number;
}

const EMPTY_FORM: AddDeviceForm = {
  device_type: "",
  name: "",
  tag: "",
  subsystem: "",
  description: "",
  quantity: 1,
};

// ── Component ─────────────────────────────────────────────────────────────────

export function ForgeHardwareIo({
  specAnalysis,
  fbTemplates,
  deviceFbLanguage = "SCL",
  onComplete,
}: ForgeHardwareIoProps) {
  const formId = useId();

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

  // Incremented when Recommend Modules runs — forces HardwareConfigEditor remount
  // so its internal slot state re-initialises from the updated rackLayout prop
  const [hardwareKey, setHardwareKey] = useState(0);

  const [devices, setDevices] = useState<ForgeDeviceEntry[]>(() => {
    const raw = specAnalysis ? devicesFromAnalysis(specAnalysis) : [];
    const matches = matchDevicesToTemplates(raw, fbTemplates);
    return applyMatchesToDevices(raw, matches);
  });

  // Expanded device rows (shows IO signals)
  const [expandedDeviceIds, setExpandedDeviceIds] = useState<Set<string>>(new Set());

  // Missing device suggestions (dismissed by user)
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());

  // Add device form visibility
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<AddDeviceForm>(EMPTY_FORM);

  // Populate from spec analysis when it arrives late (React Query async)
  useEffect(() => {
    if (!specAnalysis) return;

    setDevices((prev) => {
      if (prev.length > 0) return prev;
      const raw = devicesFromAnalysis(specAnalysis);
      const matches = matchDevicesToTemplates(raw, fbTemplates);
      return applyMatchesToDevices(raw, matches);
    });

    setIoList((prev) => {
      if (prev.length > 0) return prev;
      return ioFromAnalysis(specAnalysis);
    });

    setHardware((prev) => {
      if (prev.cpu_type !== "S7-1500" || prev.racks[0]?.modules?.length > 0) return prev;
      return { ...prev, cpu_type: specAnalysis.plc_type || prev.cpu_type };
    });
  }, [specAnalysis, fbTemplates]);

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
        const existingMap = new Map(ioList.map((e) => [e.tag_name, e]));
        const forgeIo = generatedIo.map((e) => ioEntryToForgeIo(e, existingMap));
        setIoList(forgeIo);
        setIoListKey((k) => k + 1);
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

  function removeDevice(deviceId: string) {
    setDevices((prev) => prev.filter((d) => d.id !== deviceId));
    setIoList((prev) => prev.filter((io) => io.device_id !== deviceId));
    setExpandedDeviceIds((prev) => {
      const next = new Set(prev);
      next.delete(deviceId);
      return next;
    });
  }

  function toggleExpand(deviceId: string) {
    setExpandedDeviceIds((prev) => {
      const next = new Set(prev);
      if (next.has(deviceId)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  }

  // ── Add device ────────────────────────────────────────────────────────────

  function handleAddDevice() {
    if (!addForm.device_type || !addForm.name || !addForm.tag) return;

    const defaults = DEVICE_TYPE_IO_DEFAULTS[addForm.device_type] ?? [];
    const qty = Math.max(1, addForm.quantity);

    const newDevices: ForgeDeviceEntry[] = [];
    const newIo: ForgeIoEntry[] = [];

    for (let i = 0; i < qty; i++) {
      const suffix = qty > 1 ? `_${String(i + 1).padStart(2, "0")}` : "";
      const id = `DEV_${Date.now()}_${i}`;
      const tag = qty > 1 ? `${addForm.tag}${suffix}` : addForm.tag;
      const name = qty > 1 ? `${addForm.name}${suffix}` : addForm.name;

      const signals = defaults.map((def) => ({
        tag_name: `${tag}${def.suffix}`,
        signal_type: def.signal_type,
        description: def.description,
      }));

      newDevices.push({
        id,
        name,
        tag,
        device_type: addForm.device_type,
        description: addForm.description,
        subsystem: addForm.subsystem,
        io_signals: signals,
        fb_template_id: null,
        fb_match_confidence: "none" as const,
        language_override: null,
        approved: false,
      });

      for (const sig of signals) {
        newIo.push({
          address: "",
          tag_name: sig.tag_name,
          signal_type: sig.signal_type,
          data_type: sig.signal_type.startsWith("A") ? "Real" : "Bool",
          description: sig.description,
          module: "",
          slot: 0,
          device_id: id,
        });
      }
    }

    setDevices((prev) => {
      const updated = [...prev, ...newDevices];
      const matches = matchDevicesToTemplates(updated, fbTemplates);
      return applyMatchesToDevices(updated, matches);
    });
    setIoList((prev) => [...prev, ...newIo]);
    setAddForm(EMPTY_FORM);
    setShowAddForm(false);
  }

  // ── CPU onboard IO lookup ─────────────────────────────────────────────────
  // Subtract onboard channels before recommending expansion modules.
  // Uses substring matching so "S7-1511C-1 PN" and "1511C" both match.

  function getCpuOnboardIo(cpuType: string): { di: number; dq: number; ai: number; aq: number } {
    const t = cpuType.toUpperCase();
    if (t.includes("1512C")) return { di: 32, dq: 32, ai: 5, aq: 2 };
    if (t.includes("1511C")) return { di: 16, dq: 16, ai: 5, aq: 2 };
    return { di: 0, dq: 0, ai: 0, aq: 0 };
  }

  // ── Recommend modules ─────────────────────────────────────────────────────

  function recommendModules() {
    const counts = countIoSignals(devices);
    const cpuIo = getCpuOnboardIo(hardware.cpu_type);

    // Only recommend modules for IO that exceeds what the CPU provides onboard
    const overflow = {
      DI: Math.max(0, counts.DI - cpuIo.di),
      DQ: Math.max(0, counts.DQ - cpuIo.dq),
      AI: Math.max(0, counts.AI - cpuIo.ai),
      AQ: Math.max(0, counts.AQ - cpuIo.aq),
    };

    const compatible = getCompatibleModules(hardware.cpu_type);

    function bestModule(type: "DI" | "DQ" | "AI" | "AQ", needed: number) {
      if (needed === 0) return [];
      const mods = compatible.filter((m) => {
        if (type === "DI") return m.signalType === "DI" && m.diChannels >= 8;
        if (type === "DQ") return m.signalType === "DQ" && m.dqChannels >= 8;
        if (type === "AI") return m.signalType === "AI" && m.aiChannels >= 4;
        if (type === "AQ") return m.signalType === "AQ" && m.aqChannels >= 2;
        return false;
      });
      if (mods.length === 0) return [];

      mods.sort((a, b) => {
        const aChans = type === "DI" ? a.diChannels : type === "DQ" ? a.dqChannels : type === "AI" ? a.aiChannels : a.aqChannels;
        const bChans = type === "DI" ? b.diChannels : type === "DQ" ? b.dqChannels : type === "AI" ? b.aiChannels : b.aqChannels;
        return bChans - aChans;
      });

      const best = mods[0];
      const bestChans = type === "DI" ? best.diChannels : type === "DQ" ? best.dqChannels : type === "AI" ? best.aiChannels : best.aqChannels;
      const qty = Math.ceil(needed / bestChans);
      return Array.from({ length: qty }, () => best);
    }

    const recommended = [
      ...bestModule("DI", overflow.DI),
      ...bestModule("DQ", overflow.DQ),
      ...bestModule("AI", overflow.AI),
      ...bestModule("AQ", overflow.AQ),
    ];

    if (recommended.length === 0) return;

    // Fill slots starting from slot 2 (slot 1 = CPU)
    let slot = 2;
    const newModules = recommended.map((mod) => ({
      slot: slot++,
      rack: 0,
      module_type: mod.name,
      order_number: mod.mlfb,
      description: mod.shortLabel,
    }));

    setHardware((prev) => ({
      ...prev,
      racks: prev.racks.map((r, i) =>
        i === 0 ? { ...r, modules: newModules } : r,
      ),
    }));
    setHardwareKey((k) => k + 1);
  }

  // ── Generate IO list from devices ─────────────────────────────────────────

  function generateIoListFromDevices() {
    // Separate signals by type for sequential address assignment
    const diSignals: ForgeIoEntry[] = [];
    const dqSignals: ForgeIoEntry[] = [];
    const aiSignals: ForgeIoEntry[] = [];
    const aqSignals: ForgeIoEntry[] = [];

    for (const device of devices) {
      for (const sig of device.io_signals ?? []) {
        const sigType = sig.signal_type.toUpperCase() as "DI" | "DQ" | "AI" | "AQ";
        const entry: ForgeIoEntry = {
          address: "",
          tag_name: sig.tag_name,
          signal_type: sigType,
          data_type: sigType.startsWith("A") ? "Int" : "Bool",
          description: sig.description,
          module: "",
          slot: 0,
          device_id: device.id,
        };
        switch (sigType) {
          case "DI": diSignals.push(entry); break;
          case "DQ": dqSignals.push(entry); break;
          case "AI": aiSignals.push(entry); break;
          case "AQ": aqSignals.push(entry); break;
        }
      }
    }

    // Build address pool from rack modules (if any have been recommended)
    const pool = buildAddressPool(hardware);
    const diPool = pool.filter(p => p.signalType === "DI");
    const dqPool = pool.filter(p => p.signalType === "DQ");
    const aiPool = pool.filter(p => p.signalType === "AI");
    const aqPool = pool.filter(p => p.signalType === "AQ");
    const hasPool = pool.length > 0;

    // Sequential address assignment
    // S7-1200: DI/DQ from %I/%Q 0.0; AI/AQ from %IW/%QW 64
    // S7-1500: All sequential from byte 0
    const is1200 = hardware.cpu_type.startsWith("S7-12");

    let diByte = 0, diBit = 0;
    for (let i = 0; i < diSignals.length; i++) {
      if (hasPool && i < diPool.length) {
        diSignals[i].address = diPool[i].address;
        diSignals[i].slot = diPool[i].slot;
        diSignals[i].module = diPool[i].module;
      } else {
        diSignals[i].address = `%I${diByte}.${diBit}`;
        diSignals[i].slot = 0;
      }
      diBit++;
      if (diBit > 7) { diBit = 0; diByte++; }
    }

    let dqByte = 0, dqBit = 0;
    for (let i = 0; i < dqSignals.length; i++) {
      if (hasPool && i < dqPool.length) {
        dqSignals[i].address = dqPool[i].address;
        dqSignals[i].slot = dqPool[i].slot;
        dqSignals[i].module = dqPool[i].module;
      } else {
        dqSignals[i].address = `%Q${dqByte}.${dqBit}`;
        dqSignals[i].slot = 0;
      }
      dqBit++;
      if (dqBit > 7) { dqBit = 0; dqByte++; }
    }

    const aiStart = is1200 ? 64 : Math.ceil(diSignals.length / 8) * 2;
    let aiWord = aiStart;
    for (let i = 0; i < aiSignals.length; i++) {
      if (hasPool && i < aiPool.length) {
        aiSignals[i].address = aiPool[i].address;
        aiSignals[i].slot = aiPool[i].slot;
        aiSignals[i].module = aiPool[i].module;
      } else {
        aiSignals[i].address = `%IW${aiWord}`;
        aiSignals[i].slot = 0;
      }
      aiWord += 2;
    }

    const aqStart = is1200 ? 64 : Math.ceil(dqSignals.length / 8) * 2;
    let aqWord = aqStart;
    for (let i = 0; i < aqSignals.length; i++) {
      if (hasPool && i < aqPool.length) {
        aqSignals[i].address = aqPool[i].address;
        aqSignals[i].slot = aqPool[i].slot;
        aqSignals[i].module = aqPool[i].module;
      } else {
        aqSignals[i].address = `%QW${aqWord}`;
        aqSignals[i].slot = 0;
      }
      aqWord += 2;
    }

    setIoList([...diSignals, ...dqSignals, ...aiSignals, ...aqSignals]);
    setIoListKey((k) => k + 1);
  }

  // ── Confidence badge ──────────────────────────────────────────────────────

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
  const addressPool = useMemo(() => buildAddressPool(hardware), [hardware]);
  const ioCounts = countIoSignals(devices);
  const totalIo = ioCounts.DI + ioCounts.DQ + ioCounts.AI + ioCounts.AQ;
  const cpuOnboard = getCpuOnboardIo(hardware.cpu_type);
  const hasOnboardIo = cpuOnboard.di > 0 || cpuOnboard.dq > 0 || cpuOnboard.ai > 0 || cpuOnboard.aq > 0;
  const overflow = {
    DI: Math.max(0, ioCounts.DI - cpuOnboard.di),
    DQ: Math.max(0, ioCounts.DQ - cpuOnboard.dq),
    AI: Math.max(0, ioCounts.AI - cpuOnboard.ai),
    AQ: Math.max(0, ioCounts.AQ - cpuOnboard.aq),
  };
  const needsExpansion = overflow.DI > 0 || overflow.DQ > 0 || overflow.AI > 0 || overflow.AQ > 0;

  const missingDeviceSuggestions = suggestMissingDevices(devices).filter(
    (s) => !dismissedSuggestions.has(s.suggestedTag),
  );

  function addSuggestedDevices(suggestions: MissingDeviceSuggestion[]) {
    const newDevices: ForgeDeviceEntry[] = suggestions.map((s) => ({
      id: `suggested_${s.suggestedTag}_${Date.now()}`,
      name: s.suggestedName,
      tag: s.suggestedTag,
      device_type: s.suggestedType,
      description: s.reason.split(".")[0] ?? s.suggestedType,
      subsystem: "",
      io_signals: [],
      fb_template_id: null,
      fb_match_confidence: "none" as const,
      language_override: null,
      approved: false,
    }));
    setDevices((prev) => {
      const combined = [...prev, ...newDevices];
      const matches = matchDevicesToTemplates(combined, fbTemplates);
      return applyMatchesToDevices(combined, matches);
    });
    setDismissedSuggestions((prev) => {
      const next = new Set(prev);
      suggestions.forEach((s) => next.add(s.suggestedTag));
      return next;
    });
  }

  return (
    <div className="flex h-full flex-col gap-3">
      {/* IO Summary Banner */}
      <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">IO Required</span>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-[10px]">{ioCounts.DI} DI</Badge>
            <Badge variant="outline" className="font-mono text-[10px]">{ioCounts.DQ} DQ</Badge>
            <Badge variant="outline" className="font-mono text-[10px]">{ioCounts.AI} AI</Badge>
            <Badge variant="outline" className="font-mono text-[10px]">{ioCounts.AQ} AQ</Badge>
          </div>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">{totalIo} points · {devices.length} devices</span>
        </div>
        {hasOnboardIo && (
          <div className="mt-1.5 flex items-center gap-3">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">CPU Onboard</span>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-muted-foreground">{cpuOnboard.di} DI · {cpuOnboard.dq} DQ · {cpuOnboard.ai} AI · {cpuOnboard.aq} AQ</span>
            </div>
            {needsExpansion ? (
              <span className="ml-auto font-mono text-[10px] text-amber-500">
                Overflow: {overflow.DI > 0 ? `${overflow.DI} DI ` : ""}{overflow.DQ > 0 ? `${overflow.DQ} DQ ` : ""}{overflow.AI > 0 ? `${overflow.AI} AI ` : ""}{overflow.AQ > 0 ? `${overflow.AQ} AQ` : ""} → expansion modules needed
              </span>
            ) : (
              <span className="ml-auto font-mono text-[10px] text-green-500">CPU onboard IO sufficient</span>
            )}
          </div>
        )}
      </div>

      <Tabs defaultValue="devices" className="flex flex-1 flex-col">
        <TabsList className="w-fit">
          <TabsTrigger value="devices" className="font-mono text-xs uppercase tracking-wider">
            Devices
          </TabsTrigger>
          <TabsTrigger value="hardware" className="font-mono text-xs uppercase tracking-wider">
            Hardware
          </TabsTrigger>
          <TabsTrigger value="io" className="font-mono text-xs uppercase tracking-wider">
            IO List
          </TabsTrigger>
        </TabsList>

        {/* Devices Tab */}
        <TabsContent value="devices" className="mt-3 flex-1">
          <div className="flex flex-col gap-2">
            {/* Add Device Button */}
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {devices.length} device{devices.length !== 1 ? "s" : ""}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 font-mono text-xs"
                onClick={() => setShowAddForm((v) => !v)}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Device
              </Button>
            </div>

            {/* Missing device suggestions */}
            {missingDeviceSuggestions.length > 0 && (
              <div className="rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Lightbulb className="h-3.5 w-3.5 text-blue-400" />
                    <span className="font-mono text-[10px] uppercase tracking-wider text-blue-400">
                      Suggested Missing Devices
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 gap-1 border-blue-500/40 font-mono text-[10px] text-blue-400 hover:bg-blue-500/10"
                      onClick={() => addSuggestedDevices(missingDeviceSuggestions)}
                    >
                      <Plus className="h-3 w-3" />
                      Add Suggested
                    </Button>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={() => setDismissedSuggestions((prev) => {
                        const next = new Set(prev);
                        missingDeviceSuggestions.forEach((s) => next.add(s.suggestedTag));
                        return next;
                      })}
                    >
                      <XIcon className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <div className="mt-1.5 space-y-1">
                  {missingDeviceSuggestions.map((s) => (
                    <div key={s.suggestedTag} className="text-xs text-muted-foreground">
                      <span className="font-mono text-foreground/80">{s.suggestedTag}</span>
                      {" "}({s.suggestedType}) — {s.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Inline Add Form */}
            {showAddForm && (
              <div className="rounded-md border border-border/70 bg-muted/10 p-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <div className="col-span-2 sm:col-span-1">
                    <label htmlFor={`${formId}-type`} className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Device Type *
                    </label>
                    <Select
                      value={addForm.device_type}
                      onValueChange={(v) => setAddForm((f) => ({ ...f, device_type: v }))}
                    >
                      <SelectTrigger id={`${formId}-type`} className="h-7 text-xs">
                        <SelectValue placeholder="Select type…" />
                      </SelectTrigger>
                      <SelectContent>
                        {DEVICE_TYPES.map((t) => (
                          <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label htmlFor={`${formId}-name`} className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Name *
                    </label>
                    <Input
                      id={`${formId}-name`}
                      className="h-7 font-mono text-xs"
                      placeholder="Conv1_Motor"
                      value={addForm.name}
                      onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label htmlFor={`${formId}-tag`} className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Tag *
                    </label>
                    <Input
                      id={`${formId}-tag`}
                      className="h-7 font-mono text-xs"
                      placeholder="M101"
                      value={addForm.tag}
                      onChange={(e) => setAddForm((f) => ({ ...f, tag: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label htmlFor={`${formId}-subsystem`} className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Subsystem
                    </label>
                    <Input
                      id={`${formId}-subsystem`}
                      className="h-7 font-mono text-xs"
                      placeholder="Conveyor"
                      value={addForm.subsystem}
                      onChange={(e) => setAddForm((f) => ({ ...f, subsystem: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label htmlFor={`${formId}-desc`} className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Description
                    </label>
                    <Input
                      id={`${formId}-desc`}
                      className="h-7 text-xs"
                      placeholder="Main conveyor drive"
                      value={addForm.description}
                      onChange={(e) => setAddForm((f) => ({ ...f, description: e.target.value }))}
                    />
                  </div>

                  <div>
                    <label htmlFor={`${formId}-qty`} className="mb-1 block font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      Quantity
                    </label>
                    <Input
                      id={`${formId}-qty`}
                      type="number"
                      min={1}
                      max={99}
                      className="h-7 font-mono text-xs"
                      value={addForm.quantity}
                      onChange={(e) => setAddForm((f) => ({ ...f, quantity: parseInt(e.target.value) || 1 }))}
                    />
                  </div>
                </div>

                {/* IO preview */}
                {addForm.device_type && (
                  <div className="mt-2 rounded border border-border/40 bg-background/40 px-2 py-1.5">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      Auto-generates {DEVICE_TYPE_IO_DEFAULTS[addForm.device_type]?.length ?? 0} IO signals:
                    </span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(DEVICE_TYPE_IO_DEFAULTS[addForm.device_type] ?? []).map((def) => (
                        <Badge key={def.suffix} variant="outline" className="font-mono text-[9px]">
                          {addForm.tag || "TAG"}{def.suffix} ({def.signal_type})
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    className="h-7 font-mono text-xs"
                    onClick={handleAddDevice}
                    disabled={!addForm.device_type || !addForm.name || !addForm.tag}
                  >
                    Add
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 font-mono text-xs"
                    onClick={() => { setShowAddForm(false); setAddForm(EMPTY_FORM); }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {/* Device List */}
            <ScrollArea className="h-[380px]">
              {devices.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                  No devices yet — add one above or upload a spec in Step 1.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-background/90">
                    <tr className="border-b border-border/60">
                      {["", "Name", "Tag", "Type", "Subsystem", "FB Template", "Language", "IO", "Match", ""].map(
                        (h, i) => (
                          <th
                            key={i}
                            className="px-2 py-2 text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                          >
                            {h}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {devices.map((d) => (
                      <>
                        <tr key={d.id} className="border-b border-border/40 hover:bg-muted/20">
                          {/* Expand toggle */}
                          <td className="px-1 py-1.5">
                            <button
                              type="button"
                              className="flex items-center text-muted-foreground hover:text-foreground"
                              onClick={() => toggleExpand(d.id)}
                            >
                              {expandedDeviceIds.has(d.id)
                                ? <ChevronDown className="h-3.5 w-3.5" />
                                : <ChevronRightIcon className="h-3.5 w-3.5" />
                              }
                            </button>
                          </td>
                          <td className="px-2 py-1.5 font-mono text-xs">{d.name}</td>
                          <td className="px-2 py-1.5 font-mono text-xs text-muted-foreground">{d.tag}</td>
                          <td className="px-2 py-1.5 text-xs">{d.device_type}</td>
                          <td className="px-2 py-1.5 text-xs text-muted-foreground">{d.subsystem}</td>
                          <td className="px-2 py-1.5">
                            <Select
                              value={d.fb_template_id ?? "__ai__"}
                              onValueChange={(v) => updateDeviceTemplate(d.id, v)}
                            >
                              <SelectTrigger className="h-7 w-44 text-xs">
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
                          <td className="px-2 py-1.5">
                            <Select
                              value={d.language_override ?? "__default__"}
                              onValueChange={(v) => updateDeviceLanguage(d.id, v)}
                            >
                              <SelectTrigger className="h-7 w-24 font-mono text-xs">
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
                          <td className="px-2 py-1.5 font-mono text-xs">{d.io_signals?.length ?? 0}</td>
                          <td className="px-2 py-1.5">{confidenceBadge(d.fb_match_confidence)}</td>
                          {/* Delete */}
                          <td className="px-1 py-1.5">
                            <button
                              type="button"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => removeDevice(d.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>

                        {/* Expanded IO signals */}
                        {expandedDeviceIds.has(d.id) && (
                          <tr key={`${d.id}_io`} className="border-b border-border/30 bg-muted/10">
                            <td />
                            <td colSpan={9} className="px-3 pb-2 pt-1">
                              <div className="flex flex-wrap gap-1.5">
                                {(d.io_signals ?? []).map((sig) => (
                                  <div key={sig.tag_name} className="flex items-center gap-1 rounded border border-border/40 bg-background/60 px-2 py-0.5">
                                    <span className="font-mono text-[10px] text-muted-foreground">{sig.signal_type}</span>
                                    <span className="font-mono text-[10px]">{sig.tag_name}</span>
                                    <span className="text-[10px] text-muted-foreground">— {sig.description}</span>
                                  </div>
                                ))}
                                {(d.io_signals?.length ?? 0) === 0 && (
                                  <span className="text-[11px] text-muted-foreground">No IO signals defined</span>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
              )}
            </ScrollArea>
          </div>
        </TabsContent>

        {/* Hardware Tab */}
        <TabsContent value="hardware" className="mt-3 flex-1">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Configure rack & modules
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 font-mono text-xs"
                onClick={recommendModules}
                disabled={totalIo === 0}
                title={totalIo === 0 ? "Add devices first to get recommendations" : ""}
              >
                Recommend Modules
              </Button>
            </div>
            <ScrollArea className="h-[420px] pr-1">
              <HardwareConfigEditor
                key={hardwareKey}
                cpuType={hardware.cpu_type as CpuType}
                rackSlotLayout={rackLayout}
                onSave={handleHardwareSave}
                existingIoEntries={ioEntries}
                saving={false}
              />
            </ScrollArea>
          </div>
        </TabsContent>

        {/* IO List Tab */}
        <TabsContent value="io" className="mt-3 flex-1">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {ioList.length} IO points
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 font-mono text-xs"
                onClick={generateIoListFromDevices}
                disabled={devices.length === 0}
              >
                Generate IO List (sequential addresses)
              </Button>
            </div>
            <ScrollArea className="h-[420px] pr-1">
              <IoListEditor
                key={ioListKey}
                value={ioEntries}
                onChange={handleIoChange}
                physicalAddresses={addressPool.length > 0 ? addressPool : undefined}
              />
            </ScrollArea>
          </div>
        </TabsContent>
      </Tabs>

      <Button className="w-full" onClick={() => onComplete(hardware, ioList, devices)}>
        Confirm Hardware & IO
        <ChevronRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}
