import { useState, useEffect, useCallback, useId, useMemo, Fragment } from "react";
import { ChevronRight, Plus, Trash2, ChevronDown, ChevronRight as ChevronRightIcon, Lightbulb, X as XIcon, Loader2, CheckCircle2, AlertCircle, Sparkles } from "lucide-react";
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
import { matchDevicesToTemplates, applyMatchesToDevices, suggestMissingDevices, rankTemplatesForDevice } from "@/lib/forge-device-matcher";
import type { MissingDeviceSuggestion } from "@/lib/forge-device-matcher";
import { useForgeAiDeviceMatch } from "@/hooks/use-forge-ai-device-match";
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

/** Derive a tag name from device tag + signal description when AI leaves it blank. */
function deriveTagName(deviceTag: string, sig: { description?: string; signal_type?: string }, index: number): string {
  const base = deviceTag.toUpperCase().replace(/[^A-Z0-9_]/g, "");
  if (!base) return "";
  const desc = (sig.description ?? "").toLowerCase();
  // Common signal suffixes based on description keywords
  if (desc.includes("run feedback") || desc.includes("contactor auxiliary")) return `${base}_RUN`;
  if (desc.includes("overload") || desc.includes("thermal")) return `${base}_OL`;
  if (desc.includes("fault")) return `${base}_FLT`;
  if (desc.includes("command") || desc.includes("cmd")) return `${base}_CMD`;
  if (desc.includes("enable")) return `${base}_EN`;
  if (desc.includes("reset")) return `${base}_RST`;
  if (desc.includes("e-stop") || desc.includes("estop") || desc.includes("emergency")) return `${base}_OK`;
  if (desc.includes("raw") || desc.includes("4-20") || desc.includes("analog")) return `${base}_RAW`;
  // Fallback: type prefix + index
  const prefix = sig.signal_type?.toUpperCase() ?? "IO";
  return `${base}_${prefix}${index}`;
}

function devicesFromAnalysis(analysis: SpecAnalysis): ForgeDeviceEntry[] {
  return (analysis.devices ?? []).map((d) => ({
    id: d.id,
    name: d.name || d.tag || "",
    tag: d.tag || d.name || "",
    device_type: d.device_type,
    description: d.description,
    subsystem: d.subsystem,
    io_signals: (d.io_signals ?? []).map((sig, sigIdx) => {
      // Normalize: AI sometimes stores signal_name instead of tag_name
      const raw = sig as unknown as Record<string, unknown>;
      const tagName = sig.tag_name || (raw.signal_name as string) || (raw.name as string) || "";
      return {
        ...sig,
        tag_name: tagName || deriveTagName(d.tag || d.name || "", sig, sigIdx),
      };
    }),
    fb_template_id: null,
    fb_match_confidence: "none" as const,
    language_override: null,
    approved: false,
  }));
}

function ioFromAnalysis(analysis: SpecAnalysis): ForgeIoEntry[] {
  const entries: ForgeIoEntry[] = [];
  for (const device of (analysis.devices ?? [])) {
    for (const sig of device.io_signals ?? []) {
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

  // S7-1500: DI and AI share the I address space; DQ and AQ share the Q space.
  // Each module occupies a contiguous range. Track the next free byte in each space.
  let inputByte = 0;   // next free byte in the %I / %IW space
  let outputByte = 0;  // next free byte in the %Q / %QW space

  // S7-1200 uses fixed offsets for analog (starting at byte 64)
  if (is1200) {
    // DI/DQ start at 0; AI/AQ are handled separately below
  }

  for (const mod of modules) {
    const catalog = mod.order_number ? getModuleByMlfb(mod.order_number) : undefined;
    const label = catalog?.shortLabel ?? mod.module_type;

    const diCount = catalog?.diChannels ?? 0;
    const dqCount = catalog?.dqChannels ?? 0;
    const aiCount = catalog?.aiChannels ?? 0;
    const aqCount = catalog?.aqChannels ?? 0;

    if (diCount > 0) {
      // DI modules: bit-addressed, starting at current inputByte
      let bit = 0;
      let byte = inputByte;
      for (let i = 0; i < diCount; i++) {
        pool.push({ address: `%I${byte}.${bit}`, slot: mod.slot, module: label, signalType: "DI" });
        bit++; if (bit > 7) { bit = 0; byte++; }
      }
      // Advance inputByte past this module (round up to next byte boundary)
      inputByte = bit > 0 ? byte + 1 : byte;
    }

    if (dqCount > 0) {
      let bit = 0;
      let byte = outputByte;
      for (let i = 0; i < dqCount; i++) {
        pool.push({ address: `%Q${byte}.${bit}`, slot: mod.slot, module: label, signalType: "DQ" });
        bit++; if (bit > 7) { bit = 0; byte++; }
      }
      outputByte = bit > 0 ? byte + 1 : byte;
    }

    if (aiCount > 0) {
      // AI modules: word-addressed in the I space
      // S7-1200: fixed at byte 64+; S7-1500: continues from current inputByte (word-aligned)
      let wordAddr = is1200 ? 64 : inputByte;
      // Ensure word-aligned (even byte)
      if (wordAddr % 2 !== 0) wordAddr++;
      for (let i = 0; i < aiCount; i++) {
        pool.push({ address: `%IW${wordAddr}`, slot: mod.slot, module: label, signalType: "AI" });
        wordAddr += 2;
      }
      if (!is1200) inputByte = wordAddr;
    }

    if (aqCount > 0) {
      let wordAddr = is1200 ? 64 : outputByte;
      if (wordAddr % 2 !== 0) wordAddr++;
      for (let i = 0; i < aqCount; i++) {
        pool.push({ address: `%QW${wordAddr}`, slot: mod.slot, module: label, signalType: "AQ" });
        wordAddr += 2;
      }
      if (!is1200) outputByte = wordAddr;
    }
  }

  return pool;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ForgeHardwareIoProps {
  specAnalysis: SpecAnalysis | null;
  /** Previously saved device list from session — used when spec analysis has no devices. */
  savedDevices?: ForgeDeviceEntry[];
  /** Previously saved IO list from session — used when spec analysis has no IO. */
  savedIoList?: ForgeIoEntry[];
  /** Previously saved hardware config from session. */
  savedHardware?: ForgeHardwareConfig;
  fbTemplates: FbTemplate[];
  /** FB favourites map from design profile (device_type → template_id) */
  fbFavourites?: Record<string, string>;
  deviceFbLanguage?: "SCL" | "LAD";
  /** Status of TIA project provisioning (runs after confirm) */
  provisionStatus?: { phase: string; created?: boolean; message?: string; warnings?: string[] };
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
  savedDevices,
  savedIoList,
  savedHardware,
  fbTemplates,
  fbFavourites = {},
  deviceFbLanguage = "SCL",
  provisionStatus,
  onComplete,
}: ForgeHardwareIoProps) {
  const formId = useId();

  const [hardware, setHardware] = useState<ForgeHardwareConfig>(() => {
    if (savedHardware) return savedHardware;
    return {
      cpu_type: specAnalysis?.plc_type ?? "S7-1500",
      tia_version: "V20",
      racks: [{ rack: 0, modules: [] }],
    };
  });

  const [ioList, setIoList] = useState<ForgeIoEntry[]>(() => {
    if (savedIoList && savedIoList.length > 0) return savedIoList;
    return specAnalysis ? ioFromAnalysis(specAnalysis) : [];
  });

  // Incremented when hardware generates a new IO list — forces IoListEditor remount
  const [ioListKey, setIoListKey] = useState(0);

  // Incremented when Recommend Modules runs — forces HardwareConfigEditor remount
  // so its internal slot state re-initialises from the updated rackLayout prop
  const [hardwareKey, setHardwareKey] = useState(0);

  const [devices, setDevices] = useState<ForgeDeviceEntry[]>(() => {
    if (savedDevices && savedDevices.length > 0) {
      // Saved devices already have user-confirmed confidence (AI matcher / manual overrides) — do NOT re-run matcher
      return savedDevices;
    }
    // Fresh extraction from spec — run matcher to get initial confidence
    const raw = specAnalysis ? devicesFromAnalysis(specAnalysis) : [];
    const matches = matchDevicesToTemplates(raw, fbTemplates, fbFavourites);
    return applyMatchesToDevices(raw, matches);
  });

  // Expanded device rows (shows IO signals)
  const [expandedDeviceIds, setExpandedDeviceIds] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  // Missing device suggestions (dismissed by user)
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());

  // Add device form visibility
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<AddDeviceForm>(EMPTY_FORM);

  const { match: aiMatch, loading: aiMatchLoading } = useForgeAiDeviceMatch();

  const handleAiMatch = useCallback(async () => {
    const aiMatches = await aiMatch(devices, fbTemplates, fbFavourites);
    setDevices(applyMatchesToDevices(devices, aiMatches));
  }, [devices, fbTemplates, aiMatch]);

  // Populate from spec analysis when it arrives late (React Query async).
  // Only runs when there are no saved/existing devices — never overwrites user edits.
  useEffect(() => {
    if (!specAnalysis) return;

    setDevices((prev) => {
      if (prev.length > 0) return prev; // already have data (saved or derived)
      const raw = devicesFromAnalysis(specAnalysis);
      const matches = matchDevicesToTemplates(raw, fbTemplates, fbFavourites);
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
        const matches = matchDevicesToTemplates(prev, fbTemplates, fbFavourites);
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
      const matches = matchDevicesToTemplates(updated, fbTemplates, fbFavourites);
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
    const pool = buildAddressPool(hardware);

    if (pool.length > 0) {
      // ── Module-driven mode ────────────────────────────────────────────────
      // One row per physical address. Auto-assign device signals in order.

      // Collect all device signals bucketed by type
      const byType: Record<"DI" | "DQ" | "AI" | "AQ", Array<{ tag_name: string; description: string; device_id: string; signal_behaviour?: string; contact_type?: string }>> = {
        DI: [], DQ: [], AI: [], AQ: [],
      };
      for (const device of devices) {
        for (const sig of device.io_signals ?? []) {
          const raw = sig as unknown as Record<string, unknown>;
          const t = sig.signal_type.toUpperCase() as "DI" | "DQ" | "AI" | "AQ";
          if (t in byType) byType[t].push({ tag_name: sig.tag_name || (raw.signal_name as string) || "", description: sig.description, device_id: device.id, signal_behaviour: sig.signal_behaviour, contact_type: sig.contact_type });
        }
      }

      const counters: Record<"DI" | "DQ" | "AI" | "AQ", number> = { DI: 0, DQ: 0, AI: 0, AQ: 0 };
      const entries: ForgeIoEntry[] = pool.map((pt) => {
        const sig = byType[pt.signalType][counters[pt.signalType]];
        counters[pt.signalType]++;
        return {
          address: pt.address,
          tag_name: sig?.tag_name ?? "",
          signal_type: pt.signalType,
          data_type: pt.signalType.startsWith("A") ? "Int" : "Bool",
          description: sig?.description ?? "",
          module: pt.module,
          slot: pt.slot,
          device_id: sig?.device_id,
          ...(sig?.signal_behaviour && { signal_behaviour: sig.signal_behaviour as ForgeIoEntry["signal_behaviour"] }),
          ...(sig?.contact_type && { contact_type: sig.contact_type as ForgeIoEntry["contact_type"] }),
        };
      });

      setIoList(entries);
      setIoListKey((k) => k + 1);
      return;
    }

    // ── Device-driven fallback (no modules yet) ───────────────────────────
    // One row per device signal, sequential addresses assigned.
    const diSignals: ForgeIoEntry[] = [];
    const dqSignals: ForgeIoEntry[] = [];
    const aiSignals: ForgeIoEntry[] = [];
    const aqSignals: ForgeIoEntry[] = [];

    for (const device of devices) {
      for (const sig of device.io_signals ?? []) {
        const raw = sig as unknown as Record<string, unknown>;
        const sigType = sig.signal_type.toUpperCase() as "DI" | "DQ" | "AI" | "AQ";
        const entry: ForgeIoEntry = {
          address: "",
          tag_name: sig.tag_name || (raw.signal_name as string) || "",
          signal_type: sigType,
          data_type: sigType.startsWith("A") ? "Int" : "Bool",
          description: sig.description,
          module: "",
          slot: 0,
          device_id: device.id,
          ...(sig.signal_behaviour && { signal_behaviour: sig.signal_behaviour }),
          ...(sig.contact_type && { contact_type: sig.contact_type }),
        };
        switch (sigType) {
          case "DI": diSignals.push(entry); break;
          case "DQ": dqSignals.push(entry); break;
          case "AI": aiSignals.push(entry); break;
          case "AQ": aqSignals.push(entry); break;
        }
      }
    }

    const is1200 = hardware.cpu_type.startsWith("S7-12");
    let diByte = 0, diBit = 0;
    for (let i = 0; i < diSignals.length; i++) {
      diSignals[i].address = `%I${diByte}.${diBit}`;
      diBit++; if (diBit > 7) { diBit = 0; diByte++; }
    }
    let dqByte = 0, dqBit = 0;
    for (let i = 0; i < dqSignals.length; i++) {
      dqSignals[i].address = `%Q${dqByte}.${dqBit}`;
      dqBit++; if (dqBit > 7) { dqBit = 0; dqByte++; }
    }
    const aiStart = is1200 ? 64 : Math.ceil(diSignals.length / 8) * 2;
    let aiWord = aiStart;
    for (let i = 0; i < aiSignals.length; i++) { aiSignals[i].address = `%IW${aiWord}`; aiWord += 2; }
    const aqStart = is1200 ? 64 : Math.ceil(dqSignals.length / 8) * 2;
    let aqWord = aqStart;
    for (let i = 0; i < aqSignals.length; i++) { aqSignals[i].address = `%QW${aqWord}`; aqWord += 2; }

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

  // All device signals available as tag assignments in the IO list
  const availableTags = useMemo(() =>
    devices.flatMap(d =>
      (d.io_signals ?? []).map(sig => {
        const raw = sig as unknown as Record<string, unknown>;
        return {
          tag_name: sig.tag_name || (raw.signal_name as string) || "",
          description: sig.description,
          signal_type: sig.signal_type.toUpperCase() as "DI" | "DQ" | "AI" | "AQ",
        };
      })
    ),
    [devices]
  );
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

  const missingDeviceSuggestions = suggestMissingDevices(devices, specAnalysis?.assemblies).filter(
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
      const matches = matchDevicesToTemplates(combined, fbTemplates, fbFavourites);
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
            {/* Device list header */}
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {devices.length} device{devices.length !== 1 ? "s" : ""}
              </span>
              <div className="flex items-center gap-1.5">
                {fbTemplates.some((t) => t.ai_summary) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 font-mono text-xs"
                    onClick={handleAiMatch}
                    disabled={aiMatchLoading || devices.length === 0}
                    title="Re-match devices to FB templates using AI summaries"
                  >
                    {aiMatchLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5 text-violet-400" />
                    )}
                    AI Match
                  </Button>
                )}
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
            <ScrollArea className="h-[600px]">
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
                    {/* Subsystem → Assembly → Device hierarchy */}
                    {(() => {
                      const assemblies = specAnalysis?.assemblies ?? [];
                      const subsystems = specAnalysis?.subsystems ?? [];
                      const assemblyDeviceIds = new Set(assemblies.flatMap((a) => a.device_ids));

                      const toggleSection = (key: string) =>
                        setCollapsedSections((prev) => {
                          const next = new Set(prev);
                          if (next.has(key)) { next.delete(key); } else { next.add(key); }
                          return next;
                        });

                      const rows: React.ReactNode[] = [];

                      // Group by subsystem
                      const subsystemNames = subsystems.length > 0
                        ? subsystems.map((s) => s.name)
                        : [...new Set(devices.map((d) => d.subsystem))];

                      for (const subName of subsystemNames) {
                        const subKey = `ss-${subName}`;
                        const subCollapsed = collapsedSections.has(subKey);
                        const subAssemblies = assemblies.filter((a) => a.subsystem === subName);
                        const subStandalone = devices.filter(
                          (d) => d.subsystem === subName && !assemblyDeviceIds.has(d.id),
                        );
                        const subDeviceCount = devices.filter((d) => d.subsystem === subName).length;

                        if (subDeviceCount === 0 && subAssemblies.length === 0) continue;

                        // Subsystem header
                        rows.push(
                          <tr key={subKey} className="bg-muted/10 border-b border-border/50">
                            <td colSpan={10} className="px-2 py-1.5">
                              <button
                                type="button"
                                className="flex items-center gap-2 w-full text-left"
                                onClick={() => toggleSection(subKey)}
                              >
                                <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${subCollapsed ? "-rotate-90" : ""}`} />
                                <Badge variant="secondary" className="font-mono text-[10px] px-1.5 py-0">SS</Badge>
                                <span className="font-mono text-xs font-semibold">{subName}</span>
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  ({subAssemblies.length} asm, {subDeviceCount} dev)
                                </span>
                              </button>
                            </td>
                          </tr>,
                        );

                        if (subCollapsed) continue;

                        // Assemblies in this subsystem
                        for (const asm of subAssemblies) {
                          const asmKey = `asm-${asm.id}`;
                          const asmCollapsed = collapsedSections.has(asmKey);
                          const asmDevices = devices.filter((d) => asm.device_ids.includes(d.id));
                          if (asmDevices.length === 0) continue;

                          rows.push(
                            <tr key={asmKey} className="bg-blue-500/5 border-b border-blue-500/20">
                              <td colSpan={10} className="px-2 py-1.5 pl-6">
                                <button
                                  type="button"
                                  className="flex items-center gap-2 w-full text-left"
                                  onClick={() => toggleSection(asmKey)}
                                >
                                  <ChevronDown className={`h-3 w-3 text-blue-400/60 transition-transform ${asmCollapsed ? "-rotate-90" : ""}`} />
                                  <Badge variant="outline" className="font-mono text-[10px] px-1 py-0 border-blue-500/40 text-blue-400">
                                    {asm.tag}
                                  </Badge>
                                  <span className="font-mono text-xs font-semibold text-blue-300/80">{asm.name}</span>
                                  <span className="font-mono text-[10px] text-muted-foreground">({asm.assembly_type} — {asmDevices.length} devices)</span>
                                </button>
                              </td>
                            </tr>,
                          );

                          if (!asmCollapsed) {
                            for (const d of asmDevices) {
                              rows.push(renderDeviceRow(d));
                            }
                          }
                        }

                        // Standalone devices in this subsystem
                        if (subStandalone.length > 0) {
                          if (subAssemblies.length > 0) {
                            rows.push(
                              <tr key={`standalone-${subName}`} className="bg-muted/5 border-b border-border/40">
                                <td colSpan={10} className="px-2 py-1 pl-6">
                                  <span className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider">Standalone</span>
                                </td>
                              </tr>,
                            );
                          }
                          for (const d of subStandalone) {
                            rows.push(renderDeviceRow(d));
                          }
                        }
                      }

                      return rows;

                      function renderDeviceRow(d: ForgeDeviceEntry) {
                        return (
                      <Fragment key={d.id}>
                        <tr className="border-b border-border/40 hover:bg-muted/20">
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
                            <FbTemplateSelector
                              device={d}
                              templates={fbTemplates}
                              favourites={fbFavourites}
                              value={d.fb_template_id ?? "__ai__"}
                              onValueChange={(v) => updateDeviceTemplate(d.id, v)}
                            />
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
                      </Fragment>);
                      }
                    })()}
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
                availableTags={addressPool.length > 0 ? availableTags : undefined}
              />
            </ScrollArea>
          </div>
        </TabsContent>
      </Tabs>

      {provisionStatus && provisionStatus.phase !== "idle" && (
        <div className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-mono ${
          provisionStatus.phase === "provisioning" ? "border-border/50 text-muted-foreground" :
          provisionStatus.phase === "done" ? "border-green-600/30 bg-green-500/5 text-green-400" :
          provisionStatus.phase === "skipped" ? "border-border/40 text-muted-foreground/60" :
          "border-destructive/30 bg-destructive/10 text-destructive"
        }`}>
          {provisionStatus.phase === "provisioning" && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
          {provisionStatus.phase === "done" && <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
          {provisionStatus.phase === "error" && <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
          <span>
            {provisionStatus.phase === "provisioning" && "Provisioning TIA project…"}
            {provisionStatus.phase === "done" && (provisionStatus.created ? "TIA project created" : "TIA project opened")}
            {provisionStatus.phase === "skipped" && "TIA bridge offline — project will be created at compile"}
            {provisionStatus.phase === "error" && (provisionStatus.message ?? "TIA provision failed")}
          </span>
        </div>
      )}

      <Button variant="outline" className="w-full" onClick={() => onComplete(hardware, ioList, devices)}>
        Confirm Hardware & IO
        <ChevronRight className="ml-2 h-4 w-4" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FB Template Selector — grouped dropdown with compatibility scoring
// ---------------------------------------------------------------------------

function FbTemplateSelector({
  device,
  templates,
  favourites = {},
  value,
  onValueChange,
}: {
  device: ForgeDeviceEntry;
  templates: FbTemplate[];
  favourites?: Record<string, string>;
  value: string;
  onValueChange: (v: string) => void;
}) {
  const ranked = useMemo(() => rankTemplatesForDevice(device, templates, favourites), [device, templates, favourites]);

  const favId = favourites[device.device_type];

  // Split into groups: recommended (score >= 0.3), library, custom
  const recommended = ranked.filter((r) => r.combined >= 0.3);
  const recommendedIds = new Set(recommended.map((r) => r.template.id));

  const libraryOther = templates
    .filter((t) => t.source === "library" && !recommendedIds.has(t.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  const customOther = templates
    .filter((t) => t.source !== "library" && !recommendedIds.has(t.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Find selected template name for display
  const selectedName = value === "__ai__"
    ? "AI Generate"
    : templates.find((t) => t.id === value)?.name ?? "Unknown";

  return (
    <Select value={value} onValueChange={onValueChange}>
      <SelectTrigger className="h-7 w-52 text-xs">
        <SelectValue>{selectedName}</SelectValue>
      </SelectTrigger>
      <SelectContent className="max-h-[400px]">
        <SelectItem value="__ai__">
          <span className="text-muted-foreground">AI Generate (no template)</span>
        </SelectItem>

        {recommended.length > 0 && (
          <>
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-green-400/70">
              Recommended ({recommended.length})
            </div>
            {recommended.map((r) => (
              <SelectItem key={r.template.id} value={r.template.id}>
                <div className="flex items-center gap-1.5">
                  {r.template.id === favId && <span className="text-amber-400">★</span>}
                  <span>{r.template.name}</span>
                  <span className="text-[10px] text-green-400/60">{Math.round(r.combined * 100)}%</span>
                  {r.template.source === "library" && (
                    <span className="text-[10px] text-amber-400/60">lib</span>
                  )}
                </div>
              </SelectItem>
            ))}
          </>
        )}

        {libraryOther.length > 0 && (
          <>
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-amber-400/70">
              Library ({libraryOther.length})
            </div>
            {libraryOther.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </>
        )}

        {customOther.length > 0 && (
          <>
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Custom ({customOther.length})
            </div>
            {customOther.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.name}
              </SelectItem>
            ))}
          </>
        )}
      </SelectContent>
    </Select>
  );
}
