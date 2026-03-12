import { useState, useMemo, useCallback } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown, ChevronRight, Save, Cpu, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { IoEntry, RackSlotLayout, CpuType } from "@/types";
import { getCompatibleModules, groupModulesBySignalType, getModuleByMlfb } from "@/lib/module-catalog";
import type { ModuleCatalogEntry } from "@/lib/module-catalog";
import {
  calculateRackAddresses,
  calculateEt200spAddresses,
  collectAllIoEntries,
} from "@/lib/address-calculator";
import type { ConfiguredSlot, RackAddressMap } from "@/lib/address-calculator";

interface HardwareConfigEditorProps {
  cpuType: CpuType;
  rackSlotLayout: RackSlotLayout[];
  onSave: (layout: RackSlotLayout[], ioEntries?: IoEntry[]) => void;
  existingIoEntries: IoEntry[];
  saving: boolean;
}

/**
 * Convert RackSlotLayout[] from DB → ConfiguredSlot[] for the editor.
 */
function rackLayoutToSlots(layout: RackSlotLayout[] | null | undefined, rack: number): ConfiguredSlot[] {
  if (!layout || !Array.isArray(layout)) return [];
  const found = layout.find((r) => r.rack === rack);
  if (!found) return [];
  return found.slots.map((s) => ({
    slot: s.slot,
    mlfb: s.order_number ?? null,
    description: s.description,
  }));
}

/**
 * Convert ConfiguredSlot[] from editor → RackSlotLayout for DB.
 */
function slotsToRackLayout(
  centralSlots: ConfiguredSlot[],
  et200spSlots: ConfiguredSlot[],
): RackSlotLayout[] {
  const racks: RackSlotLayout[] = [];

  if (centralSlots.length > 0) {
    racks.push({
      rack: 0,
      slots: centralSlots.map((s) => {
        const mod = s.mlfb ? getModuleByMlfb(s.mlfb) : undefined;
        return {
          slot: s.slot,
          module_type: mod?.shortLabel ?? (s.mlfb ? "Unknown" : "Empty"),
          order_number: s.mlfb ?? undefined,
          description: s.description,
        };
      }),
    });
  }

  if (et200spSlots.length > 0) {
    racks.push({
      rack: 1,
      slots: et200spSlots.map((s) => {
        const mod = s.mlfb ? getModuleByMlfb(s.mlfb) : undefined;
        return {
          slot: s.slot,
          module_type: mod?.shortLabel ?? (s.mlfb ? "Unknown" : "Empty"),
          order_number: s.mlfb ?? undefined,
          description: s.description,
        };
      }),
    });
  }

  return racks;
}

/**
 * Format address range for display.
 */
function formatAddressRange(result: RackAddressMap, direction: "input" | "output"): string {
  const slots = result.slots.filter((s) =>
    direction === "input" ? s.ioEntries.some((e) => e.address.startsWith("%I"))
      : s.ioEntries.some((e) => e.address.startsWith("%Q")),
  );
  if (slots.length === 0) return "—";

  const prefix = direction === "input" ? "%I" : "%Q";
  const addrs = slots.flatMap((s) =>
    s.ioEntries
      .filter((e) => e.address.startsWith(prefix))
      .map((e) => e.address),
  );
  if (addrs.length === 0) return "—";
  return `${addrs[0]}..${addrs[addrs.length - 1]}`;
}

// ─── Module Dropdown ─────────────────────────────────────────────────────────

const EMPTY_MODULE = "__none__";

function ModuleSelect({
  value,
  modules,
  onChange,
}: {
  value: string | null;
  modules: ModuleCatalogEntry[];
  onChange: (mlfb: string | null) => void;
}) {
  const [showAll, setShowAll] = useState(false);

  const commonModules = useMemo(() => modules.filter((m) => m.common), [modules]);

  // If current value is a non-common module, force expanded view
  const currentIsNonCommon = value != null && !commonModules.some((m) => m.mlfb === value);
  const effectiveShowAll = showAll || currentIsNonCommon;

  const displayed = effectiveShowAll ? modules : commonModules;
  const grouped = useMemo(() => groupModulesBySignalType(displayed), [displayed]);
  const hasMore = modules.length > commonModules.length;

  return (
    <Select
      value={value ?? EMPTY_MODULE}
      onValueChange={(v) => onChange(v === EMPTY_MODULE ? null : v)}
    >
      <SelectTrigger className="h-7 font-mono text-xs">
        <SelectValue placeholder="Select module..." />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={EMPTY_MODULE} className="font-mono text-xs text-muted-foreground">
          (empty)
        </SelectItem>
        {!effectiveShowAll && (
          <div className="px-2 py-1 font-mono text-[10px] text-muted-foreground">Frequently Used</div>
        )}
        {grouped.map((group) => (
          <SelectGroup key={group.type}>
            <SelectLabel className="font-mono text-[10px]">{group.label}</SelectLabel>
            {group.modules.map((m) => (
              <SelectItem key={m.mlfb} value={m.mlfb} className="font-mono text-xs">
                {m.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
        {hasMore && (
          <>
            <SelectSeparator />
            <div
              role="button"
              className="w-full cursor-pointer px-2 py-1.5 text-center font-mono text-[10px] text-blue-400 hover:bg-accent"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setShowAll((prev) => !prev)}
            >
              {effectiveShowAll ? "Show common only" : `Show all modules (${modules.length})`}
            </div>
          </>
        )}
      </SelectContent>
    </Select>
  );
}

// ─── Slot Table ──────────────────────────────────────────────────────────────

function SlotTable({
  slots,
  addressResult,
  availableModules,
  cpuType,
  isCentralRack,
  onChange,
}: {
  slots: ConfiguredSlot[];
  addressResult: RackAddressMap;
  availableModules: ModuleCatalogEntry[];
  cpuType?: CpuType;
  isCentralRack: boolean;
  onChange: (slots: ConfiguredSlot[]) => void;
}) {
  const updateSlot = useCallback(
    (idx: number, update: Partial<ConfiguredSlot>) => {
      onChange(slots.map((s, i) => (i === idx ? { ...s, ...update } : s)));
    },
    [slots, onChange],
  );

  const moveSlot = useCallback(
    (idx: number, dir: -1 | 1) => {
      const next = [...slots];
      const target = idx + dir;
      if (target < (isCentralRack ? 1 : 0) || target >= next.length) return;
      [next[idx], next[target]] = [next[target], next[idx]];
      // Re-number slots
      onChange(next.map((s, i) => ({ ...s, slot: isCentralRack ? i + 1 : i + 1 })));
    },
    [slots, isCentralRack, onChange],
  );

  const removeSlot = useCallback(
    (idx: number) => {
      const next = slots.filter((_, i) => i !== idx);
      onChange(next.map((s, i) => ({ ...s, slot: isCentralRack ? i + 1 : i + 1 })));
    },
    [slots, isCentralRack, onChange],
  );

  const addSlot = useCallback(() => {
    const nextSlotNum = slots.length > 0 ? Math.max(...slots.map((s) => s.slot)) + 1 : (isCentralRack ? 1 : 1);
    onChange([...slots, { slot: nextSlotNum, mlfb: null }]);
  }, [slots, isCentralRack, onChange]);

  // Build address lookup from calculated results
  const addressBySlot = useMemo(() => {
    const map = new Map<number, { inputAddr: string; outputAddr: string; channels: string }>();
    for (const r of addressResult.slots) {
      const inputAddrs = r.ioEntries.filter((e) => e.address.startsWith("%I")).map((e) => e.address);
      const outputAddrs = r.ioEntries.filter((e) => e.address.startsWith("%Q")).map((e) => e.address);
      const mod = getModuleByMlfb(r.mlfb);
      const channels: string[] = [];
      if (mod) {
        if (mod.diChannels) channels.push(`${mod.diChannels} DI`);
        if (mod.dqChannels) channels.push(`${mod.dqChannels} DQ`);
        if (mod.aiChannels) channels.push(`${mod.aiChannels} AI`);
        if (mod.aqChannels) channels.push(`${mod.aqChannels} AQ`);
      }
      map.set(r.slot, {
        inputAddr: inputAddrs.length > 0 ? `${inputAddrs[0]}..${inputAddrs[inputAddrs.length - 1]}` : "—",
        outputAddr: outputAddrs.length > 0 ? `${outputAddrs[0]}..${outputAddrs[outputAddrs.length - 1]}` : "—",
        channels: channels.join(", "),
      });
    }
    return map;
  }, [addressResult]);

  return (
    <div>
      {/* Header */}
      <div className="mb-1 grid grid-cols-[48px_1fr_180px_120px_100px_100px_72px] gap-1 font-mono text-[9px] text-muted-foreground px-1">
        <span>SLOT</span>
        <span>MODULE</span>
        <span>MLFB</span>
        <span>CHANNELS</span>
        <span>I ADDR</span>
        <span>Q ADDR</span>
        <span />
      </div>

      {/* CPU row (only for central rack) */}
      {isCentralRack && (
        <div className="mb-1 grid grid-cols-[48px_1fr_180px_120px_100px_100px_72px] gap-1 items-center rounded-md bg-muted/30 px-1 py-1.5">
          <span className="font-mono text-xs text-muted-foreground text-center">0</span>
          <div className="flex items-center gap-1.5 font-mono text-xs">
            <Cpu className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-muted-foreground">{cpuType} (CPU)</span>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground">—</span>
          <span className="font-mono text-[10px] text-muted-foreground">—</span>
          <span className="font-mono text-[10px] text-muted-foreground">—</span>
          <span className="font-mono text-[10px] text-muted-foreground">—</span>
          <span />
        </div>
      )}

      {/* Module rows */}
      {slots.map((slot, idx) => {
        // Skip slot 1 for central rack (CPU row — TIA Portal slot 1 = CPU)
        if (isCentralRack && slot.slot === 1) return null;
        const mod = slot.mlfb ? getModuleByMlfb(slot.mlfb) : undefined;
        const addrInfo = addressBySlot.get(slot.slot);

        return (
          <div
            key={slot.slot}
            className="mb-1 grid grid-cols-[48px_1fr_180px_120px_100px_100px_72px] gap-1 items-center px-1 py-1 rounded-md border border-border/50"
          >
            <span className="font-mono text-xs text-muted-foreground text-center">{slot.slot}</span>

            <ModuleSelect
              value={slot.mlfb}
              modules={availableModules}
              onChange={(mlfb) => updateSlot(idx, { mlfb })}
            />

            <span className="font-mono text-[10px] text-muted-foreground truncate" title={mod?.mlfb}>
              {mod?.mlfb ?? "—"}
            </span>
            <span className="font-mono text-[10px]">{addrInfo?.channels ?? "—"}</span>
            <span className="font-mono text-[10px] text-blue-400">{addrInfo?.inputAddr ?? "—"}</span>
            <span className="font-mono text-[10px] text-orange-400">{addrInfo?.outputAddr ?? "—"}</span>

            <div className="flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => moveSlot(idx, -1)}
                disabled={idx <= (isCentralRack ? 1 : 0)}
              >
                <ChevronUp className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0"
                onClick={() => moveSlot(idx, 1)}
                disabled={idx >= slots.length - 1}
              >
                <ChevronDown className="h-3 w-3" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => removeSlot(idx)}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>
        );
      })}

      {/* Add slot button */}
      <Button variant="ghost" size="sm" className="mt-1 h-7 font-mono text-xs" onClick={addSlot}>
        <Plus className="mr-1 h-3 w-3" />
        Add Slot
      </Button>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function HardwareConfigEditor({
  cpuType,
  rackSlotLayout,
  onSave,
  existingIoEntries,
  saving,
}: HardwareConfigEditorProps) {
  // Defensive: ensure arrays are never null
  const safeLayout = rackSlotLayout ?? [];
  const safeExistingIo = existingIoEntries ?? [];

  // State: central rack and ET 200SP slots
  const [centralSlots, setCentralSlots] = useState<ConfiguredSlot[]>(() => {
    const loaded = rackLayoutToSlots(safeLayout, 0);
    // Ensure slot 1 (CPU) always exists — TIA Portal S7-1500 CPU is always slot 1
    if (loaded.length === 0) return [{ slot: 1, mlfb: null, description: "CPU" }];
    if (!loaded.some((s) => s.slot === 1)) return [{ slot: 1, mlfb: null, description: "CPU" }, ...loaded];
    return loaded;
  });

  const [et200spSlots, setEt200spSlots] = useState<ConfiguredSlot[]>(() =>
    rackLayoutToSlots(safeLayout, 1),
  );

  const [et200spOpen, setEt200spOpen] = useState(() => et200spSlots.length > 0);

  // Compatible modules
  const centralModules = useMemo(
    () => getCompatibleModules(cpuType, cpuType.startsWith("S7-12") ? "S7-1200" : "S7-1500"),
    [cpuType],
  );
  const et200spModules = useMemo(
    () => getCompatibleModules(cpuType, "ET200SP"),
    [cpuType],
  );

  // Address calculations
  const centralResult = useMemo(
    () => calculateRackAddresses(centralSlots.filter((s) => s.slot !== 1), cpuType),
    [centralSlots, cpuType],
  );
  const et200spResult = useMemo(
    () => calculateEt200spAddresses(et200spSlots),
    [et200spSlots],
  );

  // Combined totals
  const totals = useMemo(() => ({
    di: centralResult.totals.di + et200spResult.totals.di,
    dq: centralResult.totals.dq + et200spResult.totals.dq,
    ai: centralResult.totals.ai + et200spResult.totals.ai,
    aq: centralResult.totals.aq + et200spResult.totals.aq,
  }), [centralResult, et200spResult]);

  const generatedEntries = useMemo(
    () => collectAllIoEntries(centralResult, et200spResult),
    [centralResult, et200spResult],
  );

  const handleSaveLayout = useCallback(() => {
    const layout = slotsToRackLayout(centralSlots, et200spSlots);
    onSave(layout);
  }, [centralSlots, et200spSlots, onSave]);

  const handleGenerateIoList = useCallback(() => {
    const layout = slotsToRackLayout(centralSlots, et200spSlots);
    onSave(layout, generatedEntries);
  }, [centralSlots, et200spSlots, generatedEntries, onSave]);

  return (
    <div className="space-y-4">
      {/* IO Summary Bar */}
      <div className="flex items-center gap-3 rounded-md border bg-muted/20 px-4 py-2">
        <span className="font-mono text-xs text-muted-foreground">IO Summary:</span>
        <Badge variant={totals.di > 0 ? "secondary" : "outline"} className="font-mono text-[10px]">
          {totals.di} DI
        </Badge>
        <Badge variant={totals.dq > 0 ? "secondary" : "outline"} className="font-mono text-[10px]">
          {totals.dq} DQ
        </Badge>
        <Badge variant={totals.ai > 0 ? "secondary" : "outline"} className="font-mono text-[10px]">
          {totals.ai} AI
        </Badge>
        <Badge variant={totals.aq > 0 ? "secondary" : "outline"} className="font-mono text-[10px]">
          {totals.aq} AQ
        </Badge>
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          I: {formatAddressRange(centralResult, "input")} | Q: {formatAddressRange(centralResult, "output")}
        </span>
      </div>

      {/* Central Rack */}
      <Card className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Cpu className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-mono text-sm font-medium">Rack 0 — Central</h3>
          <Badge variant="outline" className="font-mono text-[10px]">
            {centralSlots.filter((s) => s.slot !== 0 && s.mlfb).length} modules
          </Badge>
        </div>
        <SlotTable
          slots={centralSlots}
          addressResult={centralResult}
          availableModules={centralModules}
          cpuType={cpuType}
          isCentralRack={true}
          onChange={setCentralSlots}
        />
      </Card>

      {/* ET 200SP Section */}
      <Card className="p-4">
        <button
          className="flex w-full items-center gap-2 text-left"
          onClick={() => setEt200spOpen(!et200spOpen)}
        >
          {et200spOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <Zap className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-mono text-sm font-medium">Distributed IO — ET 200SP</h3>
          <Badge variant="outline" className="font-mono text-[10px]">
            {et200spSlots.filter((s) => s.mlfb).length} modules
          </Badge>
        </button>

        {et200spOpen && (
          <div className="mt-3">
            {et200spSlots.length === 0 ? (
              <div className="mb-2">
                <p className="font-mono text-xs text-muted-foreground mb-2">
                  No ET 200SP modules configured. Add modules for distributed IO.
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 font-mono text-xs"
                  onClick={() => setEt200spSlots([{ slot: 1, mlfb: null }])}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Add Module
                </Button>
              </div>
            ) : (
              <>
                {et200spResult.totals.di + et200spResult.totals.dq + et200spResult.totals.ai + et200spResult.totals.aq > 0 && (
                  <div className="mb-2 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
                    <span>ET 200SP Addresses:</span>
                    <span className="text-blue-400">I: {formatAddressRange(et200spResult, "input")}</span>
                    <span className="text-orange-400">Q: {formatAddressRange(et200spResult, "output")}</span>
                  </div>
                )}
                <SlotTable
                  slots={et200spSlots}
                  addressResult={et200spResult}
                  availableModules={et200spModules}
                  isCentralRack={false}
                  onChange={setEt200spSlots}
                />
              </>
            )}
          </div>
        )}
      </Card>

      {/* Action Bar */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleSaveLayout}
          disabled={saving}
        >
          <Save className="mr-1 h-3.5 w-3.5" />
          Save Layout
        </Button>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              disabled={saving || generatedEntries.length === 0}
            >
              <Zap className="mr-1 h-3.5 w-3.5" />
              Generate IO List ({generatedEntries.length} entries)
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle className="font-mono">Generate IO List</AlertDialogTitle>
              <AlertDialogDescription className="font-mono text-xs">
                {safeExistingIo.length > 0
                  ? `This will replace ${safeExistingIo.length} existing IO entries with ${generatedEntries.length} generated entries from the hardware configuration.`
                  : `This will generate ${generatedEntries.length} IO entries from the hardware configuration.`}
                {"\n\n"}Tag names will be placeholders (e.g., DI_Slot1_Ch0) — rename them in the IO Lists tab.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="font-mono text-xs">Cancel</AlertDialogCancel>
              <AlertDialogAction className="font-mono text-xs" onClick={handleGenerateIoList}>
                {safeExistingIo.length > 0 ? "Replace IO List" : "Generate IO List"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Description input for ET 200SP naming */}
        <div className="ml-auto font-mono text-[10px] text-muted-foreground">
          {generatedEntries.length > 0 && (
            <span>{generatedEntries.length} IO entries ready</span>
          )}
        </div>
      </div>
    </div>
  );
}
