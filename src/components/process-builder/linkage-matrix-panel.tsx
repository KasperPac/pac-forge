import { useState, useCallback, useMemo } from "react";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  ArrowUp,
  ArrowDown,
  Shield,
  CheckCircle2,
  Pencil,
  AlertTriangle,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProcessBuilderStore } from "@/stores/process-builder-store";
import { MermaidDiagram } from "@/components/ui/mermaid-diagram";
import { buildMultiSequenceDiagram } from "@/lib/process-sequence-diagram";
import { formatTransitionLabel } from "@/lib/process-sequence-diagram";
import type {
  LinkageDevice,
  FbWire,
  LinkageInterlock,
  LinkageGlobalData,
  LinkageGlobalField,
  ProcessStep,
  ProcessSequence,
  ProcessAction,
  MatrixReviewStatus,
} from "@/types/forge-matrix";

// ---------------------------------------------------------------------------
// Device row with expandable IO signals + interlocks
// ---------------------------------------------------------------------------

// Wire type color coding
const WIRE_TYPE_STYLES: Record<string, string> = {
  fb: "bg-blue-500/20 text-blue-400",
  io: "bg-amber-500/20 text-amber-400",
  global: "bg-purple-500/20 text-purple-400",
  constant: "bg-muted text-muted-foreground",
};

function DeviceRow({ device }: { device: LinkageDevice }) {
  const [expanded, setExpanded] = useState(false);
  const store = useProcessBuilderStore;

  const updateField = useCallback(
    (field: keyof LinkageDevice, value: string) => {
      store.getState().updateLinkageDevice(device.id, { [field]: value } as Partial<LinkageDevice>);
    },
    [device.id, store],
  );

  const addWire = useCallback(() => {
    const wire: FbWire = {
      id: crypto.randomUUID(),
      paramName: "",
      direction: "in",
      connectedTo: "",
      wireType: "io",
    };
    store.getState().addDeviceWire(device.id, wire);
  }, [device.id, store]);

  const addInterlock = useCallback(() => {
    const interlock: LinkageInterlock = {
      id: crypto.randomUUID(),
      targetDeviceName: "",
      condition: "",
      direction: "requires",
    };
    store.getState().addDeviceInterlock(device.id, interlock);
  }, [device.id, store]);

  const fbCount = device.wiring.filter((w) => w.wireType === "fb").length;
  const ioCount = device.wiring.filter((w) => w.wireType === "io").length;

  return (
    <div className="border-b last:border-b-0">
      {/* Main row */}
      <div className="flex items-center gap-1 px-2 py-1.5 hover:bg-accent/20">
        <button onClick={() => setExpanded((v) => !v)} className="shrink-0 p-0.5">
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </button>
        <Input
          value={device.name}
          onChange={(e) => updateField("name", e.target.value)}
          className="h-6 w-28 border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-1"
          placeholder="Device name"
        />
        <Input
          value={device.deviceType}
          onChange={(e) => updateField("deviceType", e.target.value)}
          className="h-6 w-20 border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-1"
          placeholder="Type"
        />
        <Input
          value={device.description}
          onChange={(e) => updateField("description", e.target.value)}
          className="h-6 min-w-0 flex-1 border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-1"
          placeholder="Description"
        />
        <Input
          value={device.fbName}
          onChange={(e) => updateField("fbName", e.target.value)}
          className="h-6 w-28 border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-1"
          placeholder="FB name"
        />
        <Input
          value={device.instanceDbName}
          onChange={(e) => updateField("instanceDbName", e.target.value)}
          className="h-6 w-32 border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-1"
          placeholder="Instance DB"
        />
        <Badge variant="outline" className="shrink-0 font-mono text-[10px]">
          {fbCount > 0 ? `${fbCount} FB` : ""}{fbCount > 0 && ioCount > 0 ? " / " : ""}{ioCount > 0 ? `${ioCount} IO` : ""}{fbCount === 0 && ioCount === 0 ? `${device.wiring.length} wires` : ""}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 shrink-0 p-0 text-muted-foreground hover:text-destructive"
          onClick={() => store.getState().removeLinkageDevice(device.id)}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      {/* Expanded: Wiring + interlocks */}
      {expanded && (
        <div className="ml-6 space-y-2 border-l border-border/50 pb-2 pl-3">
          {/* Wiring */}
          <div className="pt-1">
            <div className="mb-1 flex items-center gap-1">
              <span className="font-mono text-[10px] font-medium text-muted-foreground">WIRING</span>
              <Button variant="ghost" size="sm" className="h-4 w-4 p-0" onClick={addWire}>
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            {device.wiring.map((wire) => (
              <div key={wire.id} className="flex items-center gap-1 py-0.5">
                <Input
                  value={wire.paramName}
                  onChange={(e) => store.getState().updateDeviceWire(device.id, wire.id, { paramName: e.target.value })}
                  className="h-5 w-28 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none focus-visible:ring-1"
                  placeholder="Param"
                />
                <Select
                  value={wire.direction}
                  onValueChange={(v) => store.getState().updateDeviceWire(device.id, wire.id, { direction: v as "in" | "out" })}
                >
                  <SelectTrigger className="h-5 w-14 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">IN</SelectItem>
                    <SelectItem value="out">OUT</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={wire.connectedTo}
                  onChange={(e) => store.getState().updateDeviceWire(device.id, wire.id, { connectedTo: e.target.value })}
                  className="h-5 min-w-0 flex-1 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none focus-visible:ring-1"
                  placeholder="Connected to"
                />
                <Select
                  value={wire.wireType}
                  onValueChange={(v) => store.getState().updateDeviceWire(device.id, wire.id, { wireType: v as "fb" | "io" | "global" | "constant" })}
                >
                  <SelectTrigger className={`h-5 w-20 border-0 px-1 font-mono text-[11px] shadow-none ${WIRE_TYPE_STYLES[wire.wireType] ?? ""}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fb">fb</SelectItem>
                    <SelectItem value="io">io</SelectItem>
                    <SelectItem value="global">global</SelectItem>
                    <SelectItem value="constant">constant</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => store.getState().removeDeviceWire(device.id, wire.id)}
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </Button>
              </div>
            ))}
          </div>

          {/* Interlocks */}
          <div>
            <div className="mb-1 flex items-center gap-1">
              <span className="font-mono text-[10px] font-medium text-muted-foreground">INTERLOCKS</span>
              <Button variant="ghost" size="sm" className="h-4 w-4 p-0" onClick={addInterlock}>
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            {device.interlocks.map((il) => (
              <div key={il.id} className="flex items-center gap-1 py-0.5">
                <Select
                  value={il.direction}
                  onValueChange={(v) => store.getState().updateDeviceInterlock(device.id, il.id, { direction: v as "requires" | "blocks" | "follows" })}
                >
                  <SelectTrigger className="h-5 w-20 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="requires">requires</SelectItem>
                    <SelectItem value="blocks">blocks</SelectItem>
                    <SelectItem value="follows">follows</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={il.targetDeviceName}
                  onChange={(e) => store.getState().updateDeviceInterlock(device.id, il.id, { targetDeviceName: e.target.value })}
                  className="h-5 w-28 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none focus-visible:ring-1"
                  placeholder="Target device"
                />
                <Input
                  value={il.condition}
                  onChange={(e) => store.getState().updateDeviceInterlock(device.id, il.id, { condition: e.target.value })}
                  className="h-5 min-w-0 flex-1 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none focus-visible:ring-1"
                  placeholder="Condition"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => store.getState().removeDeviceInterlock(device.id, il.id)}
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Global Data section
// ---------------------------------------------------------------------------

function GlobalDataSection() {
  const globalData = useProcessBuilderStore((s) => s.linkageMatrix?.globalData ?? []);
  const store = useProcessBuilderStore;
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const addGlobalData = useCallback(() => {
    const gd: LinkageGlobalData = {
      id: crypto.randomUUID(),
      dbName: "",
      purpose: "",
      fields: [],
    };
    store.getState().addGlobalData(gd);
  }, [store]);

  const addField = useCallback(
    (gdId: string) => {
      const existing = globalData.find((g) => g.id === gdId);
      if (!existing) return;
      const field: LinkageGlobalField = {
        id: crypto.randomUUID(),
        fieldName: "",
        dataType: "Bool",
        description: "",
      };
      store.getState().updateGlobalData(gdId, {
        fields: [...existing.fields, field],
      });
    },
    [globalData, store],
  );

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1">
        <span className="font-mono text-[10px] font-medium text-muted-foreground">GLOBAL DATA BLOCKS</span>
        <Button variant="ghost" size="sm" className="h-4 w-4 p-0" onClick={addGlobalData}>
          <Plus className="h-3 w-3" />
        </Button>
      </div>
      {globalData.map((gd) => (
        <div key={gd.id} className="rounded-md border bg-muted/20">
          <div className="flex items-center gap-1 px-2 py-1">
            <button onClick={() => setExpandedId(expandedId === gd.id ? null : gd.id)} className="p-0.5">
              {expandedId === gd.id ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </button>
            <Input
              value={gd.dbName}
              onChange={(e) => store.getState().updateGlobalData(gd.id, { dbName: e.target.value })}
              className="h-5 w-32 border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-1"
              placeholder="DB name"
            />
            <Input
              value={gd.purpose}
              onChange={(e) => store.getState().updateGlobalData(gd.id, { purpose: e.target.value })}
              className="h-5 min-w-0 flex-1 border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-1"
              placeholder="Purpose"
            />
            <Badge variant="outline" className="font-mono text-[10px]">{gd.fields.length} fields</Badge>
            <Button variant="ghost" size="sm" className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive" onClick={() => store.getState().removeGlobalData(gd.id)}>
              <Trash2 className="h-2.5 w-2.5" />
            </Button>
          </div>
          {expandedId === gd.id && (
            <div className="border-t px-3 py-1.5">
              <div className="mb-1 flex items-center gap-1">
                <span className="font-mono text-[10px] text-muted-foreground">Fields</span>
                <Button variant="ghost" size="sm" className="h-4 w-4 p-0" onClick={() => addField(gd.id)}>
                  <Plus className="h-2.5 w-2.5" />
                </Button>
              </div>
              {gd.fields.map((f) => (
                <div key={f.id} className="flex items-center gap-1 py-0.5">
                  <Input
                    value={f.fieldName}
                    onChange={(e) => {
                      store.getState().updateGlobalData(gd.id, {
                        fields: gd.fields.map((ff) => ff.id === f.id ? { ...ff, fieldName: e.target.value } : ff),
                      });
                    }}
                    className="h-5 w-28 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none focus-visible:ring-1"
                    placeholder="Field"
                  />
                  <Input
                    value={f.dataType}
                    onChange={(e) => {
                      store.getState().updateGlobalData(gd.id, {
                        fields: gd.fields.map((ff) => ff.id === f.id ? { ...ff, dataType: e.target.value } : ff),
                      });
                    }}
                    className="h-5 w-20 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none focus-visible:ring-1"
                    placeholder="Type"
                  />
                  <Input
                    value={f.description}
                    onChange={(e) => {
                      store.getState().updateGlobalData(gd.id, {
                        fields: gd.fields.map((ff) => ff.id === f.id ? { ...ff, description: e.target.value } : ff),
                      });
                    }}
                    className="h-5 min-w-0 flex-1 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none focus-visible:ring-1"
                    placeholder="Description"
                  />
                  <Button variant="ghost" size="sm" className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive" onClick={() => {
                    store.getState().updateGlobalData(gd.id, { fields: gd.fields.filter((ff) => ff.id !== f.id) });
                  }}>
                    <Trash2 className="h-2.5 w-2.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Process Sequence tab
// ---------------------------------------------------------------------------

function ProcessSequenceTab() {
  const sequences = useProcessBuilderStore((s) => s.linkageMatrix?.processSequences ?? []);
  const deviceLinkage = useProcessBuilderStore((s) => s.linkageMatrix?.deviceLinkage ?? []);
  const deviceNames = useMemo(() => deviceLinkage.map((d) => d.name).filter((n) => n !== ""), [deviceLinkage]);
  const store = useProcessBuilderStore;
  const [selectedSeqId, setSelectedSeqId] = useState<string | null>(null);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const [diagramOpen, setDiagramOpen] = useState(true);

  const activeSeq = sequences.find((s) => s.id === selectedSeqId) ?? sequences[0] ?? null;
  const activeSeqId = activeSeq?.id ?? null;

  const addSequence = useCallback(() => {
    const seq: ProcessSequence = {
      id: crypto.randomUUID(),
      name: "New Sequence",
      description: "",
      permissives: [],
      safetyConditions: [],
      steps: [],
    };
    store.getState().addProcessSequence(seq);
    setSelectedSeqId(seq.id);
  }, [store]);

  const addStep = useCallback(() => {
    if (!activeSeqId) return;
    const step: ProcessStep = {
      id: crypto.randomUUID(),
      stepNumber: (activeSeq?.steps?.length ?? 0) + 1,
      transition: { combinator: "AND", conditions: [] },
      actions: [],
      control_modulesInvolved: [],
      notes: "",
    };
    store.getState().addProcessStep(activeSeqId, step);
  }, [activeSeqId, activeSeq, store]);

  const moveStep = useCallback(
    (stepId: string, direction: "up" | "down") => {
      if (!activeSeqId || !activeSeq) return;
      const ids = (activeSeq.steps ?? []).map((s) => s.id);
      const idx = ids.indexOf(stepId);
      if (direction === "up" && idx > 0) {
        [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
      } else if (direction === "down" && idx < ids.length - 1) {
        [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
      }
      store.getState().reorderProcessSteps(activeSeqId, ids);
    },
    [activeSeq, activeSeqId, store],
  );

  const toggleDevice = useCallback(
    (stepId: string, deviceName: string) => {
      if (!activeSeqId || !activeSeq) return;
      const step = (activeSeq.steps ?? []).find((s) => s.id === stepId);
      if (!step) return;
      const involved = step.control_modulesInvolved.includes(deviceName)
        ? step.control_modulesInvolved.filter((d) => d !== deviceName)
        : [...step.control_modulesInvolved, deviceName];
      store.getState().updateProcessStep(activeSeqId, stepId, { control_modulesInvolved: involved });
    },
    [activeSeq, activeSeqId, store],
  );

  const diagramChart = useMemo(() => {
    if (sequences.length === 0) return "";
    return buildMultiSequenceDiagram(sequences, activeSeqId ?? undefined);
  }, [sequences, activeSeqId]);

  return (
    <div className="space-y-2 p-2">
      {/* Sequence selector */}
      <div className="flex items-center gap-1">
        {sequences.length > 1 ? (
          <Select value={activeSeqId ?? ""} onValueChange={(v) => setSelectedSeqId(v)}>
            <SelectTrigger className="h-7 flex-1 font-mono text-xs">
              <SelectValue placeholder="Select sequence" />
            </SelectTrigger>
            <SelectContent>
              {sequences.map((sq) => (
                <SelectItem key={sq.id} value={sq.id}>{sq.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : activeSeq ? (
          <Input
            value={activeSeq.name}
            onChange={(e) => store.getState().updateProcessSequence(activeSeq.id, { name: e.target.value })}
            className="h-7 flex-1 border-0 bg-transparent px-1 font-mono text-sm font-medium shadow-none focus-visible:ring-1"
            placeholder="Sequence name"
          />
        ) : null}
        <Button variant="outline" size="sm" className="h-7 gap-1 font-mono text-xs" onClick={addSequence}>
          <Plus className="h-3 w-3" />
          {sequences.length === 0 ? "Add Sequence" : "Add"}
        </Button>
        {activeSeq && sequences.length > 1 && (
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" onClick={() => {
            store.getState().removeProcessSequence(activeSeq.id);
            setSelectedSeqId(null);
          }}>
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>

      {activeSeq && (
        <>
          {/* Sequence name (only when multi-seq and using dropdown) */}
          {sequences.length > 1 && (
            <Input
              value={activeSeq.name}
              onChange={(e) => store.getState().updateProcessSequence(activeSeq.id, { name: e.target.value })}
              className="h-6 border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-1"
              placeholder="Sequence name"
            />
          )}

          {/* Safety Conditions */}
          <div className="rounded-md border border-red-500/20 bg-red-500/5">
            <button
              onClick={() => {/* always visible */}}
              className="flex w-full items-center gap-1.5 px-2 py-1.5"
            >
              <ShieldAlert className="h-3 w-3 text-red-400" />
              <span className="font-mono text-[10px] font-medium text-red-400">SAFETY CONDITIONS</span>
              <Badge variant="outline" className="ml-auto font-mono text-[10px] text-red-400">
                {activeSeq.safetyConditions.length}
              </Badge>
              <Button variant="ghost" size="sm" className="h-4 w-4 p-0" onClick={(e) => {
                e.stopPropagation();
                store.getState().addSafetyCondition(activeSeq.id, {
                  id: crypto.randomUUID(), description: "", deviceName: null, polarity: true,
                });
              }}>
                <Plus className="h-3 w-3" />
              </Button>
            </button>
            {activeSeq.safetyConditions.length > 0 && (
              <div className="border-t border-red-500/10 px-2 py-1 space-y-0.5">
                {activeSeq.safetyConditions.map((sc) => (
                  <div key={sc.id} className="flex items-center gap-1">
                    <Input
                      value={sc.description}
                      onChange={(e) => store.getState().updateSafetyCondition(activeSeq.id, sc.id, { description: e.target.value })}
                      className="h-5 min-w-0 flex-1 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none focus-visible:ring-1"
                      placeholder="E-Stop circuit OK"
                    />
                    <Select
                      value={sc.deviceName ?? "__null__"}
                      onValueChange={(v) => store.getState().updateSafetyCondition(activeSeq.id, sc.id, { deviceName: v === "__null__" ? null : v })}
                    >
                      <SelectTrigger className="h-5 w-24 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none">
                        <SelectValue placeholder="Device" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__null__">None</SelectItem>
                        {deviceNames.map((dn) => <SelectItem key={dn} value={dn}>{dn}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <button
                      onClick={() => store.getState().updateSafetyCondition(activeSeq.id, sc.id, { polarity: !sc.polarity })}
                      className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${sc.polarity ? "bg-green-500/20 text-green-400" : "bg-amber-500/20 text-amber-400"}`}
                    >
                      {sc.polarity ? "Active" : "Inactive"}
                    </button>
                    <Button variant="ghost" size="sm" className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => store.getState().removeSafetyCondition(activeSeq.id, sc.id)}>
                      <Trash2 className="h-2.5 w-2.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Permissives */}
          <div className="rounded-md border border-amber-500/20 bg-amber-500/5">
            <button
              onClick={() => {/* always visible */}}
              className="flex w-full items-center gap-1.5 px-2 py-1.5"
            >
              <AlertTriangle className="h-3 w-3 text-amber-400" />
              <span className="font-mono text-[10px] font-medium text-amber-400">PERMISSIVES</span>
              <Badge variant="outline" className="ml-auto font-mono text-[10px] text-amber-400">
                {activeSeq.permissives.length}
              </Badge>
              <Button variant="ghost" size="sm" className="h-4 w-4 p-0" onClick={(e) => {
                e.stopPropagation();
                store.getState().addPermissive(activeSeq.id, {
                  id: crypto.randomUUID(), description: "", deviceName: null, polarity: true,
                });
              }}>
                <Plus className="h-3 w-3" />
              </Button>
            </button>
            {activeSeq.permissives.length > 0 && (
              <div className="border-t border-amber-500/10 px-2 py-1 space-y-0.5">
                {activeSeq.permissives.map((p) => (
                  <div key={p.id} className="flex items-center gap-1">
                    <Input
                      value={p.description}
                      onChange={(e) => store.getState().updatePermissive(activeSeq.id, p.id, { description: e.target.value })}
                      className="h-5 min-w-0 flex-1 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none focus-visible:ring-1"
                      placeholder="Sensor A active"
                    />
                    <Select
                      value={p.deviceName ?? "__null__"}
                      onValueChange={(v) => store.getState().updatePermissive(activeSeq.id, p.id, { deviceName: v === "__null__" ? null : v })}
                    >
                      <SelectTrigger className="h-5 w-24 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none">
                        <SelectValue placeholder="Device" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__null__">None</SelectItem>
                        {deviceNames.map((dn) => <SelectItem key={dn} value={dn}>{dn}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <button
                      onClick={() => store.getState().updatePermissive(activeSeq.id, p.id, { polarity: !p.polarity })}
                      className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] ${p.polarity ? "bg-green-500/20 text-green-400" : "bg-amber-500/20 text-amber-400"}`}
                    >
                      {p.polarity ? "Active" : "Inactive"}
                    </button>
                    <Button variant="ghost" size="sm" className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => store.getState().removePermissive(activeSeq.id, p.id)}>
                      <Trash2 className="h-2.5 w-2.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Steps header */}
          <div className="flex items-center gap-1 px-1 font-mono text-[10px] font-medium text-muted-foreground">
            <span className="w-6">#</span>
            <span className="flex-[2]">Transition</span>
            <span className="flex-[2]">Actions</span>
            <span className="flex-1">Devices</span>
            <span className="w-16" />
          </div>

          {/* Step rows */}
          {(activeSeq.steps ?? []).map((step) => {
            const isExpanded = expandedStepId === step.id;
            const transLabel = formatTransitionLabel(step.transition);
            const firstAction = step.actions[0]?.description ?? "";
            return (
              <div key={step.id} className="rounded-md border bg-muted/20">
                {/* Collapsed row */}
                <div className="flex items-center gap-1 px-1 py-1">
                  <button onClick={() => setExpandedStepId(isExpanded ? null : step.id)} className="shrink-0 p-0.5">
                    {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                  </button>
                  <span className="flex h-6 w-5 shrink-0 items-center justify-center font-mono text-xs text-muted-foreground">
                    {step.stepNumber}
                  </span>
                  <span className="flex-[2] truncate font-mono text-xs text-foreground/80">
                    {transLabel || <span className="text-muted-foreground/50">No transition</span>}
                  </span>
                  <span className="flex-[2] truncate font-mono text-xs text-foreground/80">
                    {firstAction || <span className="text-muted-foreground/50">No actions</span>}
                    {step.actions.length > 1 && <span className="text-muted-foreground/50"> +{step.actions.length - 1}</span>}
                  </span>
                  <div className="flex flex-1 flex-wrap gap-0.5">
                    {step.control_modulesInvolved.map((dn) => (
                      <Badge key={dn} variant="outline" className="font-mono text-[9px]">{dn}</Badge>
                    ))}
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => moveStep(step.id, "up")}>
                      <ArrowUp className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => moveStep(step.id, "down")}>
                      <ArrowDown className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive"
                      onClick={() => store.getState().removeProcessStep(activeSeq.id, step.id)}>
                      <Trash2 className="h-2.5 w-2.5" />
                    </Button>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="ml-6 space-y-2 border-t border-border/50 pb-2 pl-3 pt-2">
                    {/* Transition section */}
                    <div>
                      <div className="mb-1 flex items-center gap-1">
                        <span className="font-mono text-[10px] font-medium text-muted-foreground">TRANSITION</span>
                        <div className="flex rounded border text-[10px]">
                          <button
                            onClick={() => store.getState().setTransitionCombinator(activeSeq.id, step.id, "AND")}
                            className={`px-1.5 py-0.5 font-mono ${step.transition.combinator === "AND" ? "bg-blue-500/20 text-blue-400" : "text-muted-foreground/50"}`}
                          >AND</button>
                          <button
                            onClick={() => store.getState().setTransitionCombinator(activeSeq.id, step.id, "OR")}
                            className={`px-1.5 py-0.5 font-mono ${step.transition.combinator === "OR" ? "bg-blue-500/20 text-blue-400" : "text-muted-foreground/50"}`}
                          >OR</button>
                        </div>
                        <Button variant="ghost" size="sm" className="h-4 w-4 p-0" onClick={() => {
                          store.getState().addTransitionSubCondition(activeSeq.id, step.id, {
                            id: crypto.randomUUID(), description: "", deviceName: null,
                          });
                        }}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      {step.transition.conditions.map((cond) => (
                        <div key={cond.id} className="flex items-center gap-1 py-0.5">
                          <Input
                            value={cond.description}
                            onChange={(e) => store.getState().updateTransitionSubCondition(activeSeq.id, step.id, cond.id, { description: e.target.value })}
                            className="h-5 min-w-0 flex-1 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none focus-visible:ring-1"
                            placeholder="Condition description"
                          />
                          <Select
                            value={cond.deviceName ?? "__null__"}
                            onValueChange={(v) => store.getState().updateTransitionSubCondition(activeSeq.id, step.id, cond.id, { deviceName: v === "__null__" ? null : v })}
                          >
                            <SelectTrigger className="h-5 w-24 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none">
                              <SelectValue placeholder="Device" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__null__">None</SelectItem>
                              {deviceNames.map((dn) => <SelectItem key={dn} value={dn}>{dn}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Button variant="ghost" size="sm" className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => store.getState().removeTransitionSubCondition(activeSeq.id, step.id, cond.id)}>
                            <Trash2 className="h-2.5 w-2.5" />
                          </Button>
                        </div>
                      ))}
                    </div>

                    {/* Actions section */}
                    <div>
                      <div className="mb-1 flex items-center gap-1">
                        <span className="font-mono text-[10px] font-medium text-muted-foreground">ACTIONS</span>
                        <Button variant="ghost" size="sm" className="h-4 w-4 p-0" onClick={() => {
                          const newAction: ProcessAction = { id: crypto.randomUUID(), description: "", deviceName: null };
                          store.getState().updateProcessStep(activeSeq.id, step.id, {
                            actions: [...step.actions, newAction],
                          });
                        }}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      {step.actions.map((action) => (
                        <div key={action.id} className="flex items-center gap-1 py-0.5">
                          <Input
                            value={action.description}
                            onChange={(e) => {
                              store.getState().updateProcessStep(activeSeq.id, step.id, {
                                actions: step.actions.map((a) => a.id === action.id ? { ...a, description: e.target.value } : a),
                              });
                            }}
                            className="h-5 min-w-0 flex-1 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none focus-visible:ring-1"
                            placeholder="Action description"
                          />
                          <Select
                            value={action.deviceName ?? "__null__"}
                            onValueChange={(v) => {
                              store.getState().updateProcessStep(activeSeq.id, step.id, {
                                actions: step.actions.map((a) => a.id === action.id ? { ...a, deviceName: v === "__null__" ? null : v } : a),
                              });
                            }}
                          >
                            <SelectTrigger className="h-5 w-24 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none">
                              <SelectValue placeholder="Device" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__null__">None</SelectItem>
                              {deviceNames.map((dn) => <SelectItem key={dn} value={dn}>{dn}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <Button variant="ghost" size="sm" className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => {
                              store.getState().updateProcessStep(activeSeq.id, step.id, {
                                actions: step.actions.filter((a) => a.id !== action.id),
                              });
                            }}>
                            <Trash2 className="h-2.5 w-2.5" />
                          </Button>
                        </div>
                      ))}
                    </div>

                    {/* Devices */}
                    <div>
                      <span className="font-mono text-[10px] font-medium text-muted-foreground">DEVICES</span>
                      <div className="mt-0.5 flex flex-wrap gap-0.5">
                        {deviceNames.map((dn) => (
                          <button
                            key={dn}
                            onClick={() => toggleDevice(step.id, dn)}
                            className={`rounded px-1.5 py-0.5 font-mono text-[9px] transition-colors ${
                              step.control_modulesInvolved.includes(dn)
                                ? "bg-blue-500/20 text-blue-400"
                                : "bg-muted/40 text-muted-foreground/50 hover:bg-muted/60"
                            }`}
                          >
                            {dn}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Notes */}
                    <div>
                      <span className="font-mono text-[10px] font-medium text-muted-foreground">NOTES</span>
                      <Input
                        value={step.notes}
                        onChange={(e) => store.getState().updateProcessStep(activeSeq.id, step.id, { notes: e.target.value })}
                        className="mt-0.5 h-5 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none focus-visible:ring-1"
                        placeholder="Optional notes"
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <Button variant="outline" size="sm" className="h-7 gap-1 font-mono text-xs" onClick={addStep}>
            <Plus className="h-3 w-3" />
            Add Step
          </Button>

          {/* Diagram section */}
          <div className="mt-2 rounded-md border">
            <button
              onClick={() => setDiagramOpen((v) => !v)}
              className="flex w-full items-center gap-1.5 px-2 py-1.5"
            >
              {diagramOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
              <span className="font-mono text-[10px] font-medium text-muted-foreground">STATE DIAGRAM</span>
            </button>
            {diagramOpen && (
              <div className="border-t px-2 py-2">
                <MermaidDiagram chart={diagramChart} className="min-h-[120px]" />
              </div>
            )}
          </div>
        </>
      )}

      {sequences.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 py-6 text-center">
          <ArrowDown className="h-6 w-6 text-muted-foreground/30" />
          <div className="font-mono text-xs text-muted-foreground/60">
            No sequences defined. Add a sequence to define the process flow.
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<MatrixReviewStatus, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  user_edited: { label: "User Edited", className: "bg-amber-500/20 text-amber-400" },
  pm_validated: { label: "PM Validated", className: "bg-green-500/20 text-green-400" },
};

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface LinkageMatrixPanelProps {
  onValidate: () => void;
  onProceed: () => void;
  validating: boolean;
}

export function LinkageMatrixPanel({ onValidate, onProceed, validating }: LinkageMatrixPanelProps) {
  const matrix = useProcessBuilderStore((s) => s.linkageMatrix);
  const store = useProcessBuilderStore;

  const addDevice = useCallback(() => {
    const device: LinkageDevice = {
      id: crypto.randomUUID(),
      name: "",
      deviceType: "",
      description: "",
      wiring: [],
      fbName: "",
      fbTemplateName: null,
      fbTemplateId: null,
      instanceDbName: "",
      interlocks: [],
    };
    store.getState().addLinkageDevice(device);
  }, [store]);

  if (!matrix) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <Shield className="h-8 w-8 text-muted-foreground/30" />
        <div className="font-mono text-sm text-muted-foreground">
          No linkage matrix yet
        </div>
        <div className="max-w-xs font-mono text-xs text-muted-foreground/60">
          Continue the Q&A conversation until the PM produces a Process Linkage Matrix.
        </div>
      </div>
    );
  }

  const statusConfig = STATUS_CONFIG[matrix.reviewStatus];

  // Group control_modules by type
  const control_modulesByType = new Map<string, LinkageDevice[]>();
  for (const d of matrix.deviceLinkage) {
    const key = d.deviceType || "Uncategorized";
    if (!control_modulesByType.has(key)) control_modulesByType.set(key, []);
    control_modulesByType.get(key)!.push(d);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div>
          <div className="text-sm font-medium">Linkage Matrix</div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {matrix.deviceLinkage.length} control_modules &middot; {matrix.processSequences.length} sequence(s) &middot; {matrix.globalData.length} global DBs
          </div>
        </div>
        <Badge className={`font-mono text-[10px] ${statusConfig.className}`}>
          {statusConfig.label}
        </Badge>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="control_modules" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-3 mt-2 w-fit">
          <TabsTrigger value="control_modules" className="gap-1 font-mono text-xs">
            <Shield className="h-3 w-3" /> Device Linkage
          </TabsTrigger>
          <TabsTrigger value="sequence" className="gap-1 font-mono text-xs">
            <ArrowDown className="h-3 w-3" /> Process Sequence
          </TabsTrigger>
        </TabsList>

        {/* Device Linkage tab */}
        <TabsContent value="control_modules" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="h-full">
            <div className="p-2">
              {/* Column headers */}
              <div className="flex items-center gap-1 px-2 pb-1 font-mono text-[10px] font-medium text-muted-foreground">
                <span className="w-4" />
                <span className="w-28">Name</span>
                <span className="w-20">Type</span>
                <span className="min-w-0 flex-1">Description</span>
                <span className="w-28">FB</span>
                <span className="w-32">Instance DB</span>
                <span className="w-12">Wires</span>
                <span className="w-5" />
              </div>

              {/* Grouped by device type */}
              {[...control_modulesByType.entries()].map(([type, control_modules]) => (
                <div key={type} className="mb-2">
                  <div className="mb-0.5 flex items-center gap-1.5 px-2">
                    <Badge variant="outline" className="font-mono text-[10px]">{type}</Badge>
                    <span className="font-mono text-[10px] text-muted-foreground">{control_modules.length} device(s)</span>
                  </div>
                  <div className="rounded-md border">
                    {control_modules.map((device) => (
                      <DeviceRow key={device.id} device={device} />
                    ))}
                  </div>
                </div>
              ))}

              <Button variant="outline" size="sm" className="mt-2 h-7 gap-1 font-mono text-xs" onClick={addDevice}>
                <Plus className="h-3 w-3" />
                Add Device
              </Button>

              {/* Global Data */}
              <div className="mt-4 border-t pt-3">
                <GlobalDataSection />
              </div>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* Process Sequence tab */}
        <TabsContent value="sequence" className="mt-0 min-h-0 flex-1">
          <ScrollArea className="h-full">
            <ProcessSequenceTab />
          </ScrollArea>
        </TabsContent>
      </Tabs>

      {/* Bottom bar */}
      <div className="flex items-center gap-2 border-t px-3 py-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-1 font-mono text-xs"
          onClick={onValidate}
          disabled={validating}
        >
          {validating ? (
            <Pencil className="h-3 w-3 animate-pulse" />
          ) : (
            <CheckCircle2 className="h-3 w-3" />
          )}
          Validate with PM
        </Button>
        <Button
          size="sm"
          className="ml-auto gap-1 font-mono text-xs"
          onClick={onProceed}
        >
          Proceed to Generation
        </Button>
      </div>
    </div>
  );
}
