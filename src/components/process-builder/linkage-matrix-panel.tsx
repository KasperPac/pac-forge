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
import type {
  LinkageDevice,
  LinkageIoSignal,
  LinkageInterlock,
  LinkageGlobalData,
  LinkageGlobalField,
  ProcessStep,
  MatrixReviewStatus,
} from "@/types/process-builder";

// ---------------------------------------------------------------------------
// Device row with expandable IO signals + interlocks
// ---------------------------------------------------------------------------

function DeviceRow({ device }: { device: LinkageDevice }) {
  const [expanded, setExpanded] = useState(false);
  const store = useProcessBuilderStore;

  const updateField = useCallback(
    (field: keyof LinkageDevice, value: string) => {
      store.getState().updateLinkageDevice(device.id, { [field]: value } as Partial<LinkageDevice>);
    },
    [device.id, store],
  );

  const addSignal = useCallback(() => {
    const signal: LinkageIoSignal = {
      id: crypto.randomUUID(),
      tagName: "",
      signalType: "DI",
      purpose: "",
    };
    store.getState().addDeviceIoSignal(device.id, signal);
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
          {device.ioSignals.length} IO
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

      {/* Expanded: IO signals + interlocks */}
      {expanded && (
        <div className="ml-6 space-y-2 border-l border-border/50 pb-2 pl-3">
          {/* IO Signals */}
          <div className="pt-1">
            <div className="mb-1 flex items-center gap-1">
              <span className="font-mono text-[10px] font-medium text-muted-foreground">IO SIGNALS</span>
              <Button variant="ghost" size="sm" className="h-4 w-4 p-0" onClick={addSignal}>
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            {device.ioSignals.map((sig) => (
              <div key={sig.id} className="flex items-center gap-1 py-0.5">
                <Input
                  value={sig.tagName}
                  onChange={(e) => store.getState().updateDeviceIoSignal(device.id, sig.id, { tagName: e.target.value })}
                  className="h-5 w-36 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none focus-visible:ring-1"
                  placeholder="Tag name"
                />
                <Select
                  value={sig.signalType}
                  onValueChange={(v) => store.getState().updateDeviceIoSignal(device.id, sig.id, { signalType: v as "DI" | "DQ" | "AI" | "AQ" })}
                >
                  <SelectTrigger className="h-5 w-16 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="DI">DI</SelectItem>
                    <SelectItem value="DQ">DQ</SelectItem>
                    <SelectItem value="AI">AI</SelectItem>
                    <SelectItem value="AQ">AQ</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={sig.purpose}
                  onChange={(e) => store.getState().updateDeviceIoSignal(device.id, sig.id, { purpose: e.target.value })}
                  className="h-5 min-w-0 flex-1 border-0 bg-muted/30 px-1 font-mono text-[11px] shadow-none focus-visible:ring-1"
                  placeholder="Purpose"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-4 w-4 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => store.getState().removeDeviceIoSignal(device.id, sig.id)}
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
  const steps = useProcessBuilderStore((s) => s.linkageMatrix?.processSteps ?? []);
  const deviceLinkage = useProcessBuilderStore((s) => s.linkageMatrix?.deviceLinkage ?? []);
  const deviceNames = useMemo(() => deviceLinkage.map((d) => d.name), [deviceLinkage]);
  const store = useProcessBuilderStore;

  const addStep = useCallback(() => {
    const step: ProcessStep = {
      id: crypto.randomUUID(),
      stepNumber: steps.length + 1,
      action: "",
      completionCriteria: "",
      devicesInvolved: [],
      notes: "",
    };
    store.getState().addProcessStep(step);
  }, [steps.length, store]);

  const moveStep = useCallback(
    (stepId: string, direction: "up" | "down") => {
      const ids = steps.map((s) => s.id);
      const idx = ids.indexOf(stepId);
      if (direction === "up" && idx > 0) {
        [ids[idx - 1], ids[idx]] = [ids[idx], ids[idx - 1]];
      } else if (direction === "down" && idx < ids.length - 1) {
        [ids[idx], ids[idx + 1]] = [ids[idx + 1], ids[idx]];
      }
      store.getState().reorderProcessSteps(ids);
    },
    [steps, store],
  );

  const toggleDevice = useCallback(
    (stepId: string, deviceName: string) => {
      const step = steps.find((s) => s.id === stepId);
      if (!step) return;
      const involved = step.devicesInvolved.includes(deviceName)
        ? step.devicesInvolved.filter((d) => d !== deviceName)
        : [...step.devicesInvolved, deviceName];
      store.getState().updateProcessStep(stepId, { devicesInvolved: involved });
    },
    [steps, store],
  );

  return (
    <div className="space-y-1 p-2">
      {/* Header */}
      <div className="flex items-center gap-1 px-1 font-mono text-[10px] font-medium text-muted-foreground">
        <span className="w-8">#</span>
        <span className="flex-[2]">Action</span>
        <span className="flex-[2]">Completion Criteria</span>
        <span className="flex-1">Devices</span>
        <span className="w-16" />
      </div>

      {steps.map((step) => (
        <div key={step.id} className="flex items-start gap-1 rounded-md border bg-muted/20 px-1 py-1">
          <span className="flex h-6 w-8 shrink-0 items-center justify-center font-mono text-xs text-muted-foreground">
            {step.stepNumber}
          </span>
          <Input
            value={step.action}
            onChange={(e) => store.getState().updateProcessStep(step.id, { action: e.target.value })}
            className="h-6 flex-[2] border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-1"
            placeholder="What happens in this step"
          />
          <Input
            value={step.completionCriteria}
            onChange={(e) => store.getState().updateProcessStep(step.id, { completionCriteria: e.target.value })}
            className="h-6 flex-[2] border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-1"
            placeholder="When is this step done"
          />
          <div className="flex flex-1 flex-wrap gap-0.5">
            {deviceNames.map((dn) => (
              <button
                key={dn}
                onClick={() => toggleDevice(step.id, dn)}
                className={`rounded px-1 py-0.5 font-mono text-[9px] transition-colors ${
                  step.devicesInvolved.includes(dn)
                    ? "bg-blue-500/20 text-blue-400"
                    : "bg-muted/40 text-muted-foreground/50 hover:bg-muted/60"
                }`}
              >
                {dn}
              </button>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => moveStep(step.id, "up")}>
              <ArrowUp className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={() => moveStep(step.id, "down")}>
              <ArrowDown className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0 text-muted-foreground hover:text-destructive" onClick={() => store.getState().removeProcessStep(step.id)}>
              <Trash2 className="h-2.5 w-2.5" />
            </Button>
          </div>
        </div>
      ))}

      <Button variant="outline" size="sm" className="h-7 gap-1 font-mono text-xs" onClick={addStep}>
        <Plus className="h-3 w-3" />
        Add Step
      </Button>
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
      ioSignals: [],
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

  // Group devices by type
  const devicesByType = new Map<string, LinkageDevice[]>();
  for (const d of matrix.deviceLinkage) {
    const key = d.deviceType || "Uncategorized";
    if (!devicesByType.has(key)) devicesByType.set(key, []);
    devicesByType.get(key)!.push(d);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div>
          <div className="text-sm font-medium">Linkage Matrix</div>
          <div className="font-mono text-[10px] text-muted-foreground">
            {matrix.deviceLinkage.length} devices &middot; {matrix.processSteps.length} steps &middot; {matrix.globalData.length} global DBs
          </div>
        </div>
        <Badge className={`font-mono text-[10px] ${statusConfig.className}`}>
          {statusConfig.label}
        </Badge>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="devices" className="flex min-h-0 flex-1 flex-col">
        <TabsList className="mx-3 mt-2 w-fit">
          <TabsTrigger value="devices" className="gap-1 font-mono text-xs">
            <Shield className="h-3 w-3" /> Device Linkage
          </TabsTrigger>
          <TabsTrigger value="sequence" className="gap-1 font-mono text-xs">
            <ArrowDown className="h-3 w-3" /> Process Sequence
          </TabsTrigger>
        </TabsList>

        {/* Device Linkage tab */}
        <TabsContent value="devices" className="mt-0 min-h-0 flex-1">
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
                <span className="w-12">IO</span>
                <span className="w-5" />
              </div>

              {/* Grouped by device type */}
              {[...devicesByType.entries()].map(([type, devices]) => (
                <div key={type} className="mb-2">
                  <div className="mb-0.5 flex items-center gap-1.5 px-2">
                    <Badge variant="outline" className="font-mono text-[10px]">{type}</Badge>
                    <span className="font-mono text-[10px] text-muted-foreground">{devices.length} device(s)</span>
                  </div>
                  <div className="rounded-md border">
                    {devices.map((device) => (
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
