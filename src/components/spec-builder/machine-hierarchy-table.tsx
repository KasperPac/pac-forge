/**
 * Machine Hierarchy Table — editable tree-table for the 4-level hierarchy:
 * System → Subsystem → Assembly → Device → IO Signals (tags)
 *
 * Renders a dense, collapsible table with inline editing at every level.
 * Devices are expandable to show their IO tag assignments, selectable from
 * the instrument register.
 */
import { useState, useMemo, useCallback } from "react";
import {
  ChevronRight,
  ChevronDown,
  Plus,
  Trash2,
  Layers,
  Box,
  Cpu,
  Cable,
  Sparkles,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type {
  UnitConfig,
  EquipmentModuleConfig,
  ControlModuleConfig,
  IoSignal,
  InstrumentTag,
  EquipmentType,
  ControlModuleClass,
} from "@/types/spec-builder";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EQUIPMENT_TYPES: EquipmentType[] = [
  "Hopper",
  "Pneumatic Transporter",
  "Dryer",
  "Cooler",
  "Unloading Station",
  "Magnetic Filter",
  "Fan/Blower",
  "Milling",
  "Conveyor",
  "Other",
];

const DEVICE_CLASSES: ControlModuleClass[] = [
  "valve",
  "motor",
  "sensor_level",
  "sensor_pressure",
  "sensor_temperature",
  "sensor_weight",
  "sensor_flow",
  "sensor_position",
  "indicator",
  "transmitter",
  "filter",
  "conveyor",
  "hopper",
  "transporter",
  "dryer",
  "cooler",
  "push_button",
  "emergency_stop",
  "other",
];

// ---------------------------------------------------------------------------
// Flat row type for rendering the tree
// ---------------------------------------------------------------------------

type RowLevel = "unit" | "equipment_module" | "device" | "io_signal";

interface FlatRow {
  key: string;
  level: RowLevel;
  unitIdx: number;
  equipment_moduleIdx?: number;
  deviceIdx?: number;
  signalIdx?: number;
  expanded: boolean;
  hasChildren: boolean;
  childCount: number;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  units: UnitConfig[];
  availableTags: InstrumentTag[];
  onChange: (s: UnitConfig[]) => void;
  onInferHierarchy?: () => void;
  inferring?: boolean;
}

export function MachineHierarchyTable({
  units,
  availableTags,
  onChange,
  onInferHierarchy,
  inferring,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    // Start with all units expanded
    const keys = new Set<string>();
    units.forEach((_, i) => keys.add(`sub-${i}`));
    return keys;
  });

  const toggleExpand = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Build set of all assigned tags for the "already used" filter
  const assignedTags = useMemo(() => {
    const set = new Set<string>();
    for (const sub of units) {
      for (const asm of sub.equipment_modules) {
        for (const dev of asm.control_modules) {
          for (const sig of dev.io_signals) {
            if (sig.tag) set.add(sig.tag);
          }
        }
      }
    }
    return set;
  }, [units]);

  // Flatten tree for rendering
  const rows = useMemo<FlatRow[]>(() => {
    const result: FlatRow[] = [];
    units.forEach((sub, si) => {
      const subKey = `sub-${si}`;
      const subExpanded = expanded.has(subKey);
      result.push({
        key: subKey,
        level: "unit",
        unitIdx: si,
        expanded: subExpanded,
        hasChildren: sub.equipment_modules.length > 0,
        childCount: sub.equipment_modules.reduce((s, a) => s + a.control_modules.length, 0),
      });
      if (subExpanded) {
        sub.equipment_modules.forEach((asm, ai) => {
          const asmKey = `sub-${si}-asm-${ai}`;
          const asmExpanded = expanded.has(asmKey);
          result.push({
            key: asmKey,
            level: "equipment_module",
            unitIdx: si,
            equipment_moduleIdx: ai,
            expanded: asmExpanded,
            hasChildren: asm.control_modules.length > 0,
            childCount: asm.control_modules.length,
          });
          if (asmExpanded) {
            asm.control_modules.forEach((dev, di) => {
              const devKey = `sub-${si}-asm-${ai}-dev-${di}`;
              const devExpanded = expanded.has(devKey);
              result.push({
                key: devKey,
                level: "device",
                unitIdx: si,
                equipment_moduleIdx: ai,
                deviceIdx: di,
                expanded: devExpanded,
                hasChildren: dev.io_signals.length > 0,
                childCount: dev.io_signals.length,
              });
              if (devExpanded) {
                dev.io_signals.forEach((_, sigIdx) => {
                  result.push({
                    key: `sub-${si}-asm-${ai}-dev-${di}-sig-${sigIdx}`,
                    level: "io_signal",
                    unitIdx: si,
                    equipment_moduleIdx: ai,
                    deviceIdx: di,
                    signalIdx: sigIdx,
                    expanded: false,
                    hasChildren: false,
                    childCount: 0,
                  });
                });
              }
            });
          }
        });
      }
    });
    return result;
  }, [units, expanded]);

  // --- Mutation helpers ---

  const updateSubsystem = useCallback(
    (idx: number, patch: Partial<UnitConfig>) => {
      const next = [...units];
      next[idx] = { ...next[idx], ...patch };
      onChange(next);
    },
    [units, onChange],
  );

  const updateAssembly = useCallback(
    (si: number, ai: number, patch: Partial<EquipmentModuleConfig>) => {
      const next = [...units];
      const sub = { ...next[si], equipment_modules: [...next[si].equipment_modules] };
      sub.equipment_modules[ai] = { ...sub.equipment_modules[ai], ...patch };
      next[si] = sub;
      onChange(next);
    },
    [units, onChange],
  );

  const updateDevice = useCallback(
    (si: number, ai: number, di: number, patch: Partial<ControlModuleConfig>) => {
      const next = [...units];
      const sub = { ...next[si], equipment_modules: [...next[si].equipment_modules] };
      const asm = { ...sub.equipment_modules[ai], control_modules: [...sub.equipment_modules[ai].control_modules] };
      asm.control_modules[di] = { ...asm.control_modules[di], ...patch };
      sub.equipment_modules[ai] = asm;
      next[si] = sub;
      onChange(next);
    },
    [units, onChange],
  );

  const updateIoSignal = useCallback(
    (si: number, ai: number, di: number, sigIdx: number, patch: Partial<IoSignal>) => {
      const next = [...units];
      const sub = { ...next[si], equipment_modules: [...next[si].equipment_modules] };
      const asm = { ...sub.equipment_modules[ai], control_modules: [...sub.equipment_modules[ai].control_modules] };
      const dev = { ...asm.control_modules[di], io_signals: [...asm.control_modules[di].io_signals] };
      dev.io_signals[sigIdx] = { ...dev.io_signals[sigIdx], ...patch };
      asm.control_modules[di] = dev;
      sub.equipment_modules[ai] = asm;
      next[si] = sub;
      onChange(next);
    },
    [units, onChange],
  );

  const assignTagToSignal = useCallback(
    (si: number, ai: number, di: number, sigIdx: number, tagName: string) => {
      const tag = availableTags.find((t) => t.tag === tagName);
      if (!tag) return;
      updateIoSignal(si, ai, di, sigIdx, {
        tag: tag.tag,
        signal_type: tag.signal_type || tag.signal_direction,
        io_address: tag.io_address,
        description: tag.description,
      });
    },
    [availableTags, updateIoSignal],
  );

  const addSubsystem = useCallback(() => {
    const id = `sub_${Date.now()}`;
    onChange([
      ...units,
      {
        unit_id: id,
        unit_name: "New Subsystem",
        equipment_type: "Other",
        description: "",
        equipment_modules: [],
        excluded: false,
      },
    ]);
    setExpanded((prev) => new Set([...prev, `sub-${units.length}`]));
  }, [units, onChange]);

  const addAssembly = useCallback(
    (si: number) => {
      const next = [...units];
      const sub = { ...next[si], equipment_modules: [...next[si].equipment_modules] };
      sub.equipment_modules.push({
        equipment_module_id: `asm_${Date.now()}`,
        equipment_module_name: "New Assembly",
        description: "",
        control_modules: [],
      });
      next[si] = sub;
      onChange(next);
      const asmKey = `sub-${si}-asm-${sub.equipment_modules.length - 1}`;
      setExpanded((prev) => new Set([...prev, `sub-${si}`, asmKey]));
    },
    [units, onChange],
  );

  const addDevice = useCallback(
    (si: number, ai: number) => {
      const next = [...units];
      const sub = { ...next[si], equipment_modules: [...next[si].equipment_modules] };
      const asm = { ...sub.equipment_modules[ai], control_modules: [...sub.equipment_modules[ai].control_modules] };
      asm.control_modules.push({
        control_module_id: `dev_${Date.now()}`,
        control_module_name: "New Device",
        control_module_class: "other",
        description: "",
        is_safety: false,
        io_signals: [],
      });
      sub.equipment_modules[ai] = asm;
      next[si] = sub;
      onChange(next);
      setExpanded((prev) => new Set([...prev, `sub-${si}`, `sub-${si}-asm-${ai}`]));
    },
    [units, onChange],
  );

  const addIoSignal = useCallback(
    (si: number, ai: number, di: number) => {
      const next = [...units];
      const sub = { ...next[si], equipment_modules: [...next[si].equipment_modules] };
      const asm = { ...sub.equipment_modules[ai], control_modules: [...sub.equipment_modules[ai].control_modules] };
      const dev = { ...asm.control_modules[di], io_signals: [...asm.control_modules[di].io_signals] };
      dev.io_signals.push({ tag: "", signal_type: "", io_address: "", description: "N/A" });
      asm.control_modules[di] = dev;
      sub.equipment_modules[ai] = asm;
      next[si] = sub;
      onChange(next);
      const devKey = `sub-${si}-asm-${ai}-dev-${di}`;
      setExpanded((prev) => new Set([...prev, devKey]));
    },
    [units, onChange],
  );

  const removeSubsystem = useCallback(
    (si: number) => {
      onChange(units.filter((_, i) => i !== si));
    },
    [units, onChange],
  );

  const removeAssembly = useCallback(
    (si: number, ai: number) => {
      const next = [...units];
      const sub = { ...next[si], equipment_modules: next[si].equipment_modules.filter((_, i) => i !== ai) };
      next[si] = sub;
      onChange(next);
    },
    [units, onChange],
  );

  const removeDevice = useCallback(
    (si: number, ai: number, di: number) => {
      const next = [...units];
      const sub = { ...next[si], equipment_modules: [...next[si].equipment_modules] };
      const asm = { ...sub.equipment_modules[ai], control_modules: sub.equipment_modules[ai].control_modules.filter((_, i) => i !== di) };
      sub.equipment_modules[ai] = asm;
      next[si] = sub;
      onChange(next);
    },
    [units, onChange],
  );

  const removeIoSignal = useCallback(
    (si: number, ai: number, di: number, sigIdx: number) => {
      const next = [...units];
      const sub = { ...next[si], equipment_modules: [...next[si].equipment_modules] };
      const asm = { ...sub.equipment_modules[ai], control_modules: [...sub.equipment_modules[ai].control_modules] };
      const dev = { ...asm.control_modules[di], io_signals: asm.control_modules[di].io_signals.filter((_, i) => i !== sigIdx) };
      asm.control_modules[di] = dev;
      sub.equipment_modules[ai] = asm;
      next[si] = sub;
      onChange(next);
    },
    [units, onChange],
  );

  const activeCount = units.filter((s) => !s.excluded).length;

  // Group available tags by unit for the IO checklist
  const tagsBySubsystem = useMemo(() => {
    const groups = new Map<string, InstrumentTag[]>();
    for (const t of availableTags) {
      const key = t.unit || "UNGROUPED";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(t);
    }
    return groups;
  }, [availableTags]);

  const allocatedCount = assignedTags.size;
  const totalTags = availableTags.length;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {activeCount} unit{activeCount !== 1 ? "s" : ""} active
          {" / "}
          {units.reduce((s, sub) => s + sub.equipment_modules.length, 0)} equipment_modules
          {" / "}
          {units.reduce(
            (s, sub) => s + sub.equipment_modules.reduce((a, asm) => a + asm.control_modules.length, 0),
            0,
          )}{" "}
          control_modules
        </p>
        <div className="flex gap-2">
          {onInferHierarchy && (
            <Button variant="outline" size="sm" onClick={onInferHierarchy} disabled={inferring}>
              {inferring ? (
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              ) : (
                <Sparkles className="h-3 w-3 mr-1" />
              )}
              Suggest with AI
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={addSubsystem}>
            <Plus className="h-3 w-3 mr-1" />
            Add Subsystem
          </Button>
        </div>
      </div>

      {/* Two-panel layout: hierarchy table + IO checklist */}
      <div className="flex gap-4">
        {/* Left: Hierarchy table */}
        <div className="flex-1 min-w-0 border rounded-md">
          <Table>
            <TableHeader>
              <TableRow className="text-xs">
                <TableHead className="w-8" />
                <TableHead className="min-w-[240px]">Name</TableHead>
                <TableHead className="w-[140px]">Type</TableHead>
                <TableHead className="w-12 text-center">Signal</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-16 text-center">Count</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-sm text-muted-foreground py-8">
                    No hierarchy defined. Click "Suggest with AI" or "Add Subsystem" to start.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => {
                  if (row.level === "io_signal") {
                    return (
                      <IoSignalRow
                        key={row.key}
                        row={row}
                        units={units}
                        availableTags={availableTags}
                        assignedTags={assignedTags}
                        onAssignTag={assignTagToSignal}
                        onRemove={removeIoSignal}
                      />
                    );
                  }
                  return (
                    <HierarchyRow
                      key={row.key}
                      row={row}
                      units={units}
                      onToggle={toggleExpand}
                      onUpdateSubsystem={updateSubsystem}
                      onUpdateAssembly={updateAssembly}
                      onUpdateDevice={updateDevice}
                      onAddAssembly={addAssembly}
                      onAddDevice={addDevice}
                      onAddIoSignal={addIoSignal}
                      onRemoveSubsystem={removeSubsystem}
                      onRemoveAssembly={removeAssembly}
                      onRemoveDevice={removeDevice}
                    />
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>

        {/* Right: IO Allocation checklist */}
        <div className="w-[240px] shrink-0 border rounded-md">
          <div className="px-3 py-2 border-b flex items-center justify-between">
            <span className="text-xs font-semibold">IO Allocation</span>
            <Badge
              variant={allocatedCount === totalTags ? "default" : "outline"}
              className="text-[10px] px-1.5"
            >
              {allocatedCount}/{totalTags}
            </Badge>
          </div>
          <div className="divide-y">
            {Array.from(tagsBySubsystem.entries()).map(([unitName, tags]) => (
              <div key={unitName} className="px-3 py-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase mb-1">
                  {unitName}
                </p>
                <div className="space-y-0.5">
                  {tags.map((t) => {
                    const allocated = assignedTags.has(t.tag);
                    return (
                      <div
                        key={t.tag}
                        className={cn(
                          "flex items-center gap-2 text-xs py-0.5",
                          allocated ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        <span
                          className={cn(
                            "flex items-center justify-center h-3.5 w-3.5 rounded-sm border text-[8px] shrink-0",
                            allocated
                              ? "bg-emerald-500/20 border-emerald-500/50 text-emerald-400"
                              : "border-muted-foreground/30",
                          )}
                        >
                          {allocated ? "✓" : ""}
                        </span>
                        <span className="font-mono text-[11px] truncate">{t.tag}</span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[9px] px-1 ml-auto shrink-0",
                            t.signal_direction === "DO" || t.signal_direction === "AO"
                              ? "text-red-400 border-red-400/30"
                              : "text-green-400 border-green-400/30",
                          )}
                        >
                          {t.signal_direction}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row renderer — unit / equipment_module / device
// ---------------------------------------------------------------------------

interface RowProps {
  row: FlatRow;
  units: UnitConfig[];
  onToggle: (key: string) => void;
  onUpdateSubsystem: (si: number, patch: Partial<UnitConfig>) => void;
  onUpdateAssembly: (si: number, ai: number, patch: Partial<EquipmentModuleConfig>) => void;
  onUpdateDevice: (si: number, ai: number, di: number, patch: Partial<ControlModuleConfig>) => void;
  onAddAssembly: (si: number) => void;
  onAddDevice: (si: number, ai: number) => void;
  onAddIoSignal: (si: number, ai: number, di: number) => void;
  onRemoveSubsystem: (si: number) => void;
  onRemoveAssembly: (si: number, ai: number) => void;
  onRemoveDevice: (si: number, ai: number, di: number) => void;
}

function HierarchyRow({
  row,
  units,
  onToggle,
  onUpdateSubsystem,
  onUpdateAssembly,
  onUpdateDevice,
  onAddAssembly,
  onAddDevice,
  onAddIoSignal,
  onRemoveAssembly,
  onRemoveDevice,
}: RowProps) {
  const indent =
    row.level === "unit" ? 0 : row.level === "equipment_module" ? 24 : 48;
  const LevelIcon =
    row.level === "unit" ? Layers : row.level === "equipment_module" ? Box : Cpu;
  const iconColor =
    row.level === "unit"
      ? "text-blue-400"
      : row.level === "equipment_module"
        ? "text-amber-400"
        : "text-emerald-400";

  // Expand/collapse button (shared pattern)
  const expandBtn = row.hasChildren ? (
    <button
      onClick={() => onToggle(row.key)}
      className="p-0.5 hover:bg-muted rounded"
    >
      {row.expanded ? (
        <ChevronDown className="h-3.5 w-3.5" />
      ) : (
        <ChevronRight className="h-3.5 w-3.5" />
      )}
    </button>
  ) : null;

  if (row.level === "unit") {
    const sub = units[row.unitIdx];
    return (
      <TableRow
        className={cn(
          "group text-xs transition-opacity",
          sub.excluded && "opacity-40",
        )}
      >
        <TableCell className="px-1 py-1">{expandBtn}</TableCell>
        <TableCell className="px-1 py-1">
          <div className="flex items-center gap-1.5" style={{ paddingLeft: indent }}>
            <LevelIcon className={cn("h-3.5 w-3.5 shrink-0", iconColor)} />
            <Input
              value={sub.unit_name}
              onChange={(e) =>
                onUpdateSubsystem(row.unitIdx, { unit_name: e.target.value })
              }
              className="h-6 text-xs font-mono font-medium border-transparent hover:border-border focus:border-border bg-transparent"
            />
          </div>
        </TableCell>
        <TableCell className="px-1 py-1">
          <Select
            value={sub.equipment_type}
            onValueChange={(v) =>
              onUpdateSubsystem(row.unitIdx, { equipment_type: v as EquipmentType })
            }
          >
            <SelectTrigger className="h-6 text-xs border-transparent hover:border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EQUIPMENT_TYPES.map((t) => (
                <SelectItem key={t} value={t} className="text-xs">
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell className="px-1 py-1" />
        <TableCell className="px-1 py-1">
          <Input
            value={sub.description}
            onChange={(e) =>
              onUpdateSubsystem(row.unitIdx, { description: e.target.value })
            }
            placeholder="Subsystem description..."
            className="h-6 text-xs border-transparent hover:border-border focus:border-border bg-transparent"
          />
        </TableCell>
        <TableCell className="px-1 py-1 text-center">
          <Badge variant="outline" className="text-[10px] px-1.5">
            {sub.equipment_modules.length}A / {row.childCount}D
          </Badge>
        </TableCell>
        <TableCell className="px-1 py-1">
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => onAddAssembly(row.unitIdx)}
              title="Add Assembly"
            >
              <Plus className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() =>
                onUpdateSubsystem(row.unitIdx, { excluded: !sub.excluded })
              }
              title={sub.excluded ? "Include" : "Exclude"}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  if (row.level === "equipment_module") {
    const asm = units[row.unitIdx].equipment_modules[row.equipment_moduleIdx!];
    return (
      <TableRow className="group text-xs">
        <TableCell className="px-1 py-1">{expandBtn}</TableCell>
        <TableCell className="px-1 py-1">
          <div className="flex items-center gap-1.5" style={{ paddingLeft: indent }}>
            <LevelIcon className={cn("h-3.5 w-3.5 shrink-0", iconColor)} />
            <Input
              value={asm.equipment_module_name}
              onChange={(e) =>
                onUpdateAssembly(row.unitIdx, row.equipment_moduleIdx!, {
                  equipment_module_name: e.target.value,
                })
              }
              className="h-6 text-xs font-mono border-transparent hover:border-border focus:border-border bg-transparent"
            />
          </div>
        </TableCell>
        <TableCell className="px-1 py-1">
          <span className="text-muted-foreground text-[10px]">equipment_module</span>
        </TableCell>
        <TableCell className="px-1 py-1" />
        <TableCell className="px-1 py-1">
          <Input
            value={asm.description}
            onChange={(e) =>
              onUpdateAssembly(row.unitIdx, row.equipment_moduleIdx!, {
                description: e.target.value,
              })
            }
            placeholder="Assembly description..."
            className="h-6 text-xs border-transparent hover:border-border focus:border-border bg-transparent"
          />
        </TableCell>
        <TableCell className="px-1 py-1 text-center">
          <Badge variant="outline" className="text-[10px] px-1.5">
            {asm.control_modules.length}D
          </Badge>
        </TableCell>
        <TableCell className="px-1 py-1">
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => onAddDevice(row.unitIdx, row.equipment_moduleIdx!)}
              title="Add Device"
            >
              <Plus className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={() => onRemoveAssembly(row.unitIdx, row.equipment_moduleIdx!)}
              title="Remove Assembly"
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  // Device row — expandable to show IO signals
  const dev = units[row.unitIdx].equipment_modules[row.equipment_moduleIdx!].control_modules[row.deviceIdx!];
  return (
    <TableRow className="group text-xs">
      <TableCell className="px-1 py-1">{expandBtn}</TableCell>
      <TableCell className="px-1 py-1">
        <div className="flex items-center gap-1.5" style={{ paddingLeft: indent }}>
          <LevelIcon className={cn("h-3.5 w-3.5 shrink-0", iconColor)} />
          <Input
            value={dev.control_module_name}
            onChange={(e) =>
              onUpdateDevice(row.unitIdx, row.equipment_moduleIdx!, row.deviceIdx!, {
                control_module_name: e.target.value,
              })
            }
            className="h-6 text-xs font-mono border-transparent hover:border-border focus:border-border bg-transparent"
          />
        </div>
      </TableCell>
      <TableCell className="px-1 py-1">
        <Select
          value={dev.control_module_class}
          onValueChange={(v) =>
            onUpdateDevice(row.unitIdx, row.equipment_moduleIdx!, row.deviceIdx!, {
              control_module_class: v as ControlModuleClass,
            })
          }
        >
          <SelectTrigger className="h-6 text-xs border-transparent hover:border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DEVICE_CLASSES.map((c) => (
              <SelectItem key={c} value={c} className="text-xs">
                {c.replace(/_/g, " ")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell className="px-1 py-1" />
      <TableCell className="px-1 py-1">
        <Input
          value={dev.description}
          onChange={(e) =>
            onUpdateDevice(row.unitIdx, row.equipment_moduleIdx!, row.deviceIdx!, {
              description: e.target.value,
            })
          }
          placeholder="Device description..."
          className="h-6 text-xs border-transparent hover:border-border focus:border-border bg-transparent"
        />
      </TableCell>
      <TableCell className="px-1 py-1 text-center">
        <Badge variant="outline" className="text-[10px] px-1.5">
          {dev.io_signals.length} IO
        </Badge>
      </TableCell>
      <TableCell className="px-1 py-1">
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {dev.is_safety && (
            <Badge variant="destructive" className="text-[10px] px-1 mr-1">
              Safety
            </Badge>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => onAddIoSignal(row.unitIdx, row.equipment_moduleIdx!, row.deviceIdx!)}
            title="Add IO Signal"
          >
            <Plus className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() =>
              onRemoveDevice(row.unitIdx, row.equipment_moduleIdx!, row.deviceIdx!)
            }
            title="Remove Device"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// IO Signal row — tag selector from instrument register
// ---------------------------------------------------------------------------

interface IoSignalRowProps {
  row: FlatRow;
  units: UnitConfig[];
  availableTags: InstrumentTag[];
  assignedTags: Set<string>;
  onAssignTag: (si: number, ai: number, di: number, sigIdx: number, tagName: string) => void;
  onRemove: (si: number, ai: number, di: number, sigIdx: number) => void;
}

function IoSignalRow({
  row,
  units,
  availableTags,
  assignedTags,
  onAssignTag,
  onRemove,
}: IoSignalRowProps) {
  const sig =
    units[row.unitIdx].equipment_modules[row.equipment_moduleIdx!].control_modules[row.deviceIdx!]
      .io_signals[row.signalIdx!];

  const indent = 72; // device(48) + extra indent for signals

  // Tags available for selection: unassigned + the currently assigned one
  const selectableTags = availableTags.filter(
    (t) => !assignedTags.has(t.tag) || t.tag === sig.tag,
  );

  const isAssigned = sig.tag && sig.tag.length > 0;

  const signalColor =
    sig.signal_type === "DO" || sig.signal_type === "AO"
      ? "text-red-400 bg-red-400/10 border-red-400/30"
      : sig.signal_type === "DI" || sig.signal_type === "AI"
        ? "text-green-400 bg-green-400/10 border-green-400/30"
        : "text-muted-foreground bg-muted";

  return (
    <TableRow className="group text-xs bg-muted/20">
      <TableCell className="px-1 py-0.5" />
      {/* Tag selector */}
      <TableCell className="px-1 py-0.5">
        <div className="flex items-center gap-1.5" style={{ paddingLeft: indent }}>
          <Cable className="h-3 w-3 shrink-0 text-muted-foreground" />
          <Select
            value={sig.tag || "__none__"}
            onValueChange={(v) => {
              if (v !== "__none__") {
                onAssignTag(
                  row.unitIdx,
                  row.equipment_moduleIdx!,
                  row.deviceIdx!,
                  row.signalIdx!,
                  v,
                );
              }
            }}
          >
            <SelectTrigger
              className={cn(
                "h-6 text-xs font-mono",
                isAssigned
                  ? "border-transparent hover:border-border"
                  : "border-dashed border-muted-foreground/30 text-muted-foreground",
              )}
            >
              <SelectValue placeholder="Select tag..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs text-muted-foreground">
                N/A — no tag assigned
              </SelectItem>
              {selectableTags.map((t) => (
                <SelectItem key={t.tag} value={t.tag} className="text-xs font-mono">
                  {t.tag}
                  <span className="text-muted-foreground ml-2 font-sans">
                    — {t.description}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </TableCell>
      {/* IO address */}
      <TableCell className="px-1 py-0.5">
        {isAssigned && sig.io_address ? (
          <span className="text-muted-foreground text-[10px] font-mono">{sig.io_address}</span>
        ) : null}
      </TableCell>
      {/* Signal type badge */}
      <TableCell className="px-1 py-0.5 text-center">
        {isAssigned && sig.signal_type ? (
          <Badge
            variant="outline"
            className={cn("text-[10px] px-1.5 font-mono font-bold", signalColor)}
          >
            {sig.signal_type}
          </Badge>
        ) : (
          <span className="text-muted-foreground/50 text-[10px]">—</span>
        )}
      </TableCell>
      {/* Description */}
      <TableCell className="px-1 py-0.5">
        {isAssigned ? (
          <span className="text-muted-foreground text-[10px]">{sig.description}</span>
        ) : (
          <span className="text-muted-foreground/50 text-[10px] italic">N/A</span>
        )}
      </TableCell>
      <TableCell className="px-1 py-0.5" />
      {/* Remove */}
      <TableCell className="px-1 py-0.5">
        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() =>
              onRemove(row.unitIdx, row.equipment_moduleIdx!, row.deviceIdx!, row.signalIdx!)
            }
            title="Remove IO Signal"
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
