import { useState, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useUpdateSpecProject } from "@/hooks/use-spec-projects";
import { callNonStreaming } from "@/hooks/use-generation";
import type { PromptLayerMeta } from "@/hooks/use-generation";
import type {
  SpecProject,
  InstrumentRegister,
  UnitConfig,
  AlarmTier,
} from "@/types/spec-builder";
import { migrateUnitConfig, getUnitControlModuleCount } from "@/types/spec-builder";
import type { OperatorMode, SafetyGateV2 } from "@/types/spec-contract-v2";
import { seedDefaultModes, suggestSafetyGates } from "@/lib/spec-builder/wizard-machine-layer";
import { buildHierarchyFromTags } from "@/lib/spec-builder/instrument-parser";
import { MachineHierarchyTable } from "./machine-hierarchy-table";
import { cn } from "@/lib/utils";

const HMI_OPTIONS = ["WinCC Unified", "WinCC Comfort", "None", "Other"];

const COMMS_OPTIONS = ["OPC UA", "PROFINET", "Ethernet/IP", "None"];

const WIZARD_STEPS = [
  "Document Metadata",
  "Control System",
  "Machine Hierarchy",
  "Machine Modes",
  "Safety Gates",
  "Alarm Configuration",
  "Review & Confirm",
] as const;

interface Props {
  spec: SpecProject;
  register: InstrumentRegister;
  onComplete: () => void;
}

export function SpecSkeletonWizard({ spec, register, onComplete }: Props) {
  const updateSpec = useUpdateSpecProject();
  const [step, setStep] = useState(0);

  // Step 1 — Document metadata
  const [meta, setMeta] = useState({
    doc_code: spec.doc_code,
    title: spec.title,
    client_name: spec.client_name ?? "",
    project_number: spec.project_number ?? "",
    revision: spec.revision,
    doc_date: spec.doc_date ?? new Date().toISOString().slice(0, 10),
    issued_by: spec.issued_by ?? "",
    verified_by: spec.verified_by ?? "",
    approved_by: spec.approved_by ?? "",
  });

  // Step 2 — Control system
  const [control, setControl] = useState({
    plc_model: spec.plc_model ?? "",
    hmi_type: spec.hmi_type ?? "",
    comms_protocol: spec.comms_protocol ?? "",
  });

  // Step 3 — Machine hierarchy (seeded from register tags)
  const [units, setSubsystems] = useState<UnitConfig[]>(() => {
    if (spec.confirmed_units?.length) {
      return migrateUnitConfig(spec.confirmed_units);
    }
    return buildHierarchyFromTags(register.tags);
  });
  const [inferringHierarchy, setInferringHierarchy] = useState(false);

  // Step 4 — Machine modes (extensible; seed Auto/Maintenance/Manual).
  const [modes, setModes] = useState<OperatorMode[]>(() => {
    const existing = (spec.confirmed_modes ?? []) as OperatorMode[];
    return existing.length > 0 ? existing : seedDefaultModes();
  });

  // Step 5 — Safety gates (auto-suggested from is_safety register tags).
  const [safetyGates, setSafetyGates] = useState<SafetyGateV2[]>(() => {
    const existing = (spec.safety_gates ?? []) as SafetyGateV2[];
    if (existing.length > 0) return existing;
    return suggestSafetyGates(
      register.tags.map((t) => ({ tag: t.tag, is_safety: Boolean(t.is_safety) })),
    );
  });

  // Step 6 — Alarm tiers
  const [alarmTiers, setAlarmTiers] = useState<AlarmTier[]>(
    spec.alarm_tiers?.length
      ? spec.alarm_tiers
      : [
          { tier_id: "immediate_shutdown", tier_name: "Immediate Shutdown", description: "Causes immediate de-energisation of all outputs" },
          { tier_id: "controlled_shutdown", tier_name: "Controlled Shutdown", description: "Initiates a controlled stop sequence" },
          { tier_id: "warning", tier_name: "Warning", description: "Alerts operator, no automatic action" },
          { tier_id: "interlock", tier_name: "Interlock", description: "Prevents start or specific action" },
        ]
  );

  const canNext = (() => {
    if (step === 0) return meta.doc_code.trim() && meta.title.trim() && meta.client_name.trim();
    if (step === 1) return control.plc_model.trim();
    if (step === 2) return units.some((s) => !s.excluded && s.equipment_modules.length > 0);
    if (step === 3) return modes.length > 0 && modes.filter((m) => m.is_default).length === 1;
    if (step === 4) return true; // safety gates optional
    if (step === 5) return alarmTiers.length > 0;
    return true;
  })();

  const handleNext = useCallback(async () => {
    if (step < 6) {
      setStep((s) => s + 1);
      return;
    }
    // Step 7 — confirm: save everything and mark ready
    await updateSpec.mutateAsync({
      id: spec.id,
      ...meta,
      ...control,
      confirmed_units: units,
      confirmed_modes: modes,
      safety_gates: safetyGates,
      alarm_tiers: alarmTiers,
    });
    onComplete();
  }, [step, spec.id, meta, control, units, modes, safetyGates, alarmTiers, updateSpec, onComplete]);

  const handleBack = () => setStep((s) => Math.max(0, s - 1));

  // Step 3 — infer machine hierarchy via Sonnet
  const inferHierarchy = useCallback(async () => {
    setInferringHierarchy(true);
    try {
      const controller = new AbortController();
      const tagSummary = register.tags.map((t) => ({
        tag: t.tag,
        device_type: t.device_type,
        description: t.description,
        signal_type: t.signal_type,
        unit: t.unit,
      }));

      const systemPrompt = `You are an industrial automation engineer applying the ISA-88 equipment model. Organize the instrument register tags into a machine hierarchy:

System (Process Cell) → Unit → Equipment Module → Control Module

Rules:
- **Unit** = the set of equipment modules governed by ONE coordinated operating sequence (e.g. "Fan Array", "Infeed Conveyor Station", "Hydraulic Lift Station"). DEFAULT TO A SINGLE UNIT containing all equipment modules. Create more than one unit ONLY when the provided specification clearly describes equipment modules running under INDEPENDENT operating sequences (for example a distinct infeed area vs. outfeed area). NEVER invent a unit split that is not stated in the specification. A lone equipment module is never its own unit.
- **Equipment Module** = a coordinated group of control modules that work together (a conveyor, a drive, a lift), e.g. "Conveyor CV01", "Fan GK01". Group related control modules into equipment modules by equipment ID prefix.
- **Control Module** = a single physical device with IO signals (motor, sensor, valve, push button). Gets its own FB. Tags with different suffixes (_CMD, _FB, _OL, _FAULT, _THERM) that belong to the same physical device MUST be grouped as io_signals on ONE control module, never as separate control modules.
- **System (Process Cell)** = the whole machine. Tags that share a unit prefix go under the same unit.
- Extract the structure as described in the source material. Do not invent groupings. When uncertain, prefer fewer units.

Return ONLY a JSON array matching this TypeScript interface:
[{
  "unit_id": "string",
  "unit_name": "string",
  "equipment_type": "Hopper"|"Pneumatic Transporter"|"Dryer"|"Cooler"|"Unloading Station"|"Magnetic Filter"|"Fan/Blower"|"Milling"|"Conveyor"|"Other",
  "description": "string",
  "equipment_modules": [{
    "equipment_module_id": "string",
    "equipment_module_name": "string",
    "description": "string",
    "control_modules": [{
      "control_module_id": "string",
      "control_module_name": "string",
      "control_module_class": "valve"|"motor"|"sensor_level"|"sensor_pressure"|"sensor_temperature"|"sensor_weight"|"sensor_flow"|"sensor_position"|"indicator"|"transmitter"|"filter"|"conveyor"|"hopper"|"transporter"|"dryer"|"cooler"|"push_button"|"emergency_stop"|"other",
      "description": "string",
      "is_safety": boolean,
      "io_signals": [{ "tag": "string", "signal_type": "string", "io_address": "string", "description": "string" }]
    }]
  }],
  "excluded": false
}]`;

      const plMeta: PromptLayerMeta = {
        prompt_name: "spec_infer_hierarchy",
        agent_role: "spec_skeleton_builder",
        model: "claude-sonnet-4-6",
      };

      const result = await callNonStreaming(
        systemPrompt,
        [{ role: "user" as const, content: JSON.stringify(tagSummary) }],
        controller.signal,
        16384,
        plMeta,
      );

      const parsed = JSON.parse(result.content) as UnitConfig[];
      setSubsystems(parsed);
    } catch {
      // Fallback to deterministic hierarchy builder
      setSubsystems(buildHierarchyFromTags(register.tags));
    } finally {
      setInferringHierarchy(false);
    }
  }, [register.tags]);

  return (
    <div className="space-y-4">
      {/* Step indicator */}
      <div className="flex items-center gap-1">
        {WIZARD_STEPS.map((label, i) => (
          <div key={i} className="flex items-center gap-1">
            {i > 0 && <div className={cn("h-px w-4", i <= step ? "bg-primary" : "bg-muted")} />}
            <button
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              className={cn(
                "flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors",
                i === step
                  ? "bg-primary/15 text-primary font-medium"
                  : i < step
                    ? "text-muted-foreground hover:text-foreground cursor-pointer"
                    : "text-muted-foreground/50"
              )}
            >
              <span
                className={cn(
                  "flex items-center justify-center h-4.5 w-4.5 rounded-full text-[10px] font-bold",
                  i < step
                    ? "bg-primary text-primary-foreground"
                    : i === step
                      ? "bg-primary/20 text-primary"
                      : "bg-muted text-muted-foreground"
                )}
              >
                {i < step ? <Check className="h-2.5 w-2.5" /> : i + 1}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </button>
          </div>
        ))}
      </div>

      <Separator />

      {/* Step content */}
      <div className="min-h-[300px]">
        {step === 0 && <StepMetadata meta={meta} onChange={setMeta} />}
        {step === 1 && <StepControlSystem control={control} onChange={setControl} />}
        {step === 2 && (
          <MachineHierarchyTable
            units={units}
            availableTags={register.tags}
            onChange={setSubsystems}
            onInferHierarchy={inferHierarchy}
            inferring={inferringHierarchy}
          />
        )}
        {step === 3 && <StepMachineModes modes={modes} onChange={setModes} />}
        {step === 4 && (
          <StepSafetyGates
            gates={safetyGates}
            onChange={setSafetyGates}
            safetyTags={register.tags.filter((t) => t.is_safety).map((t) => t.tag)}
            equipmentModules={units.flatMap((u) =>
              u.equipment_modules.map((e) => ({ id: e.equipment_module_id, name: e.equipment_module_name })),
            )}
          />
        )}
        {step === 5 && <StepAlarmConfig tiers={alarmTiers} onChange={setAlarmTiers} />}
        {step === 6 && (
          <StepReview
            meta={meta}
            control={control}
            units={units}
            modes={modes}
            safetyGates={safetyGates}
            alarmTiers={alarmTiers}
          />
        )}
      </div>

      {/* Nav buttons */}
      <div className="flex items-center justify-between pt-2">
        <Button
          variant="outline"
          size="sm"
          onClick={handleBack}
          disabled={step === 0}
        >
          <ChevronLeft className="h-3.5 w-3.5 mr-1" />
          Back
        </Button>
        <Button
          size="sm"
          onClick={handleNext}
          disabled={!canNext || updateSpec.isPending}
        >
          {updateSpec.isPending && <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />}
          {step === 6 ? "Confirm & Save" : "Next"}
          {step < 6 && <ChevronRight className="h-3.5 w-3.5 ml-1" />}
        </Button>
      </div>
    </div>
  );
}

// ===========================================================================
// Step 1 — Document Metadata
// ===========================================================================

interface MetaForm {
  doc_code: string;
  title: string;
  client_name: string;
  project_number: string;
  revision: string;
  doc_date: string;
  issued_by: string;
  verified_by: string;
  approved_by: string;
}

function StepMetadata({ meta, onChange }: { meta: MetaForm; onChange: (m: MetaForm) => void }) {
  const set = (key: keyof MetaForm, val: string) => onChange({ ...meta, [key]: val });

  return (
    <div className="grid gap-3 max-w-lg">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Document Code *" id="doc_code" value={meta.doc_code} onChange={(v) => set("doc_code", v)} mono />
        <Field label="Revision" id="revision" value={meta.revision} onChange={(v) => set("revision", v)} mono />
      </div>
      <Field label="Title *" id="title" value={meta.title} onChange={(v) => set("title", v)} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Client Name *" id="client_name" value={meta.client_name} onChange={(v) => set("client_name", v)} />
        <Field label="Project Number" id="project_number" value={meta.project_number} onChange={(v) => set("project_number", v)} mono />
      </div>
      <Field label="Date" id="doc_date" value={meta.doc_date} onChange={(v) => set("doc_date", v)} type="date" />
      <div className="grid grid-cols-3 gap-3">
        <Field label="Issued By" id="issued_by" value={meta.issued_by} onChange={(v) => set("issued_by", v)} />
        <Field label="Verified By" id="verified_by" value={meta.verified_by} onChange={(v) => set("verified_by", v)} />
        <Field label="Approved By" id="approved_by" value={meta.approved_by} onChange={(v) => set("approved_by", v)} />
      </div>
    </div>
  );
}

// ===========================================================================
// Step 2 — Control System
// ===========================================================================

interface ControlForm {
  plc_model: string;
  hmi_type: string;
  comms_protocol: string;
}

function StepControlSystem({ control, onChange }: { control: ControlForm; onChange: (c: ControlForm) => void }) {
  return (
    <div className="grid gap-3 max-w-lg">
      <Field
        label="PLC Model *"
        id="plc_model"
        value={control.plc_model}
        onChange={(v) => onChange({ ...control, plc_model: v })}
        placeholder="e.g. Siemens S7-1500 CPU 1517F"
      />
      <div className="grid gap-1.5">
        <Label className="text-xs">HMI Type</Label>
        <Select value={control.hmi_type} onValueChange={(v) => onChange({ ...control, hmi_type: v })}>
          <SelectTrigger className="text-sm"><SelectValue placeholder="Select HMI..." /></SelectTrigger>
          <SelectContent>
            {HMI_OPTIONS.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label className="text-xs">Communications Protocol</Label>
        <Select value={control.comms_protocol} onValueChange={(v) => onChange({ ...control, comms_protocol: v })}>
          <SelectTrigger className="text-sm"><SelectValue placeholder="Select protocol..." /></SelectTrigger>
          <SelectContent>
            {COMMS_OPTIONS.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ===========================================================================
// Step 4 — Machine Modes (extensible; exactly one default)
// ===========================================================================

function StepMachineModes({
  modes,
  onChange,
}: {
  modes: OperatorMode[];
  onChange: (m: OperatorMode[]) => void;
}) {
  const updateAt = (i: number, patch: Partial<OperatorMode>) => {
    const next = modes.map((m) => ({ ...m }));
    next[i] = { ...next[i], ...patch };
    if (patch.is_default) next.forEach((m, j) => { if (j !== i) m.is_default = false; });
    onChange(next);
  };
  const add = () => {
    const id = `mode_${Date.now()}`;
    onChange([...modes, { mode_id: id, name: "New Mode", is_default: false }]);
  };
  const remove = (i: number) => onChange(modes.filter((_, j) => j !== i));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Machine-level operating modes. States are scoped per equipment module, not here.
          Exactly one mode is the default.
        </p>
        <Button variant="outline" size="sm" onClick={add}>
          <Plus className="h-3 w-3 mr-1" /> Add Mode
        </Button>
      </div>
      <div className="grid gap-2">
        {modes.map((m, i) => (
          <Card key={m.mode_id} className="p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <Input
                value={m.name}
                onChange={(e) => updateAt(i, { name: e.target.value })}
                className="text-sm font-medium h-7"
              />
              <Button
                variant={m.is_default ? "default" : "outline"}
                size="sm"
                className="h-7 text-xs"
                onClick={() => updateAt(i, { is_default: true })}
              >
                {m.is_default ? "Default" : "Set default"}
              </Button>
              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => remove(i)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
            <Input
              value={m.description ?? ""}
              onChange={(e) => updateAt(i, { description: e.target.value })}
              placeholder="Description…"
              className="text-xs h-7"
            />
          </Card>
        ))}
      </div>
    </div>
  );
}

// ===========================================================================
// Step 5 — Safety Gates (condition → force scoped EMs to safe)
// ===========================================================================

function StepSafetyGates({
  gates,
  onChange,
  safetyTags,
  equipmentModules,
}: {
  gates: SafetyGateV2[];
  onChange: (g: SafetyGateV2[]) => void;
  safetyTags: string[];
  equipmentModules: Array<{ id: string; name: string }>;
}) {
  const updateAt = (i: number, patch: Partial<SafetyGateV2>) => {
    const next = gates.map((g) => ({ ...g }));
    next[i] = { ...next[i], ...patch };
    onChange(next);
  };
  const add = () => {
    const tag = safetyTags[0] ?? "";
    onChange([
      ...gates,
      {
        gate_id: `gate_${Date.now()}`,
        name: tag || "New Gate",
        condition: [{ tag, operator: "=", value: false }],
        scope: "all",
      },
    ]);
  };
  const remove = (i: number) => onChange(gates.filter((_, j) => j !== i));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          When a gate's condition is violated, the scoped equipment modules are forced to
          their safe state. Suggested from <code>is_safety</code> register tags.
        </p>
        <Button variant="outline" size="sm" onClick={add}>
          <Plus className="h-3 w-3 mr-1" /> Add Gate
        </Button>
      </div>
      {gates.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No safety gates. Add one, or proceed — gates are optional.
        </Card>
      ) : (
        <div className="grid gap-2">
          {gates.map((g, i) => (
            <Card key={g.gate_id} className="p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <Input
                  value={g.name}
                  onChange={(e) => updateAt(i, { name: e.target.value })}
                  className="text-sm font-medium h-7"
                />
                <Select
                  value={g.scope === "all" ? "all" : "scoped"}
                  onValueChange={(v) =>
                    updateAt(i, { scope: v === "all" ? "all" : equipmentModules.map((e) => e.id) })
                  }
                >
                  <SelectTrigger className="h-7 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All EMs</SelectItem>
                    <SelectItem value="scoped">Scoped…</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className="h-6 w-6 ml-auto" onClick={() => remove(i)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <p className="text-[11px] font-mono text-muted-foreground">
                Violated when: {g.condition.map((c) => `${c.tag} ${c.operator} ${String(c.value)}`).join(" OR ")}
              </p>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// Step 5 — Alarm Configuration
// ===========================================================================

function StepAlarmConfig({
  tiers,
  onChange,
}: {
  tiers: AlarmTier[];
  onChange: (t: AlarmTier[]) => void;
}) {
  const updateAt = (idx: number, patch: Partial<AlarmTier>) => {
    const next = [...tiers];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const addTier = () => {
    const id = `custom_${Date.now()}`;
    onChange([...tiers, { tier_id: id, tier_name: "Custom Tier", description: "" }]);
  };

  const removeTier = (idx: number) => onChange(tiers.filter((_, i) => i !== idx));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Configure alarm tiers for the specification.
        </p>
        <Button variant="outline" size="sm" onClick={addTier}>
          <Plus className="h-3 w-3 mr-1" />
          Add Tier
        </Button>
      </div>
      <div>
        <div className="grid gap-2">
          {tiers.map((tier, i) => (
            <Card key={tier.tier_id} className="p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="text-xs shrink-0">
                  Tier {i + 1}
                </Badge>
                <Input
                  value={tier.tier_name}
                  onChange={(e) => updateAt(i, { tier_name: e.target.value })}
                  className="text-sm font-medium h-7"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  onClick={() => removeTier(i)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              <Input
                value={tier.description}
                onChange={(e) => updateAt(i, { description: e.target.value })}
                placeholder="What happens when this alarm fires..."
                className="text-xs h-7"
              />
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Step 6 — Review & Confirm
// ===========================================================================

function StepReview({
  meta,
  control,
  units,
  modes,
  safetyGates,
  alarmTiers,
}: {
  meta: MetaForm;
  control: ControlForm;
  units: UnitConfig[];
  modes: OperatorMode[];
  safetyGates: SafetyGateV2[];
  alarmTiers: AlarmTier[];
}) {
  const activeSubs = units.filter((s) => !s.excluded);
  const totalAssemblies = activeSubs.reduce((s, sub) => s + sub.equipment_modules.length, 0);
  const totalDevices = activeSubs.reduce(
    (s, sub) => s + sub.equipment_modules.reduce((a, asm) => a + asm.control_modules.length, 0),
    0,
  );

  return (
    <div className="space-y-4 max-w-lg">
      <Card className="p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase">Document</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">Code</span>
          <span className="font-mono">{meta.doc_code}</span>
          <span className="text-muted-foreground">Title</span>
          <span>{meta.title}</span>
          <span className="text-muted-foreground">Client</span>
          <span>{meta.client_name}</span>
          <span className="text-muted-foreground">Revision</span>
          <span className="font-mono">{meta.revision}</span>
        </div>
      </Card>

      <Card className="p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase">Control System</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">PLC</span>
          <span>{control.plc_model}</span>
          <span className="text-muted-foreground">HMI</span>
          <span>{control.hmi_type || "—"}</span>
          <span className="text-muted-foreground">Comms</span>
          <span>{control.comms_protocol || "—"}</span>
        </div>
      </Card>

      <Card className="p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase">
          Machine Hierarchy
        </p>
        <div className="grid grid-cols-3 gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">Subsystems</span>
          <span className="font-mono col-span-2">{activeSubs.length}</span>
          <span className="text-muted-foreground">Assemblies</span>
          <span className="font-mono col-span-2">{totalAssemblies}</span>
          <span className="text-muted-foreground">Devices</span>
          <span className="font-mono col-span-2">{totalDevices}</span>
        </div>
        <div className="space-y-1 mt-2">
          {activeSubs.map((sub) => (
            <div key={sub.unit_id} className="text-xs">
              <span className="font-medium">{sub.unit_name}</span>
              <span className="text-muted-foreground ml-1">
                ({sub.equipment_type}, {sub.equipment_modules.length}A / {getUnitControlModuleCount(sub)}D)
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase">Machine Modes ({modes.length})</p>
        <div className="flex flex-wrap gap-1.5">
          {modes.map((m) => (
            <Badge key={m.mode_id} variant="outline" className="text-xs">
              {m.name}{m.is_default ? " · default" : ""}
            </Badge>
          ))}
        </div>
      </Card>
      <Card className="p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase">Safety Gates ({safetyGates.length})</p>
        <div className="flex flex-wrap gap-1.5">
          {safetyGates.map((g) => (
            <Badge key={g.gate_id} variant="outline" className="text-xs">{g.name}</Badge>
          ))}
        </div>
      </Card>

      <Card className="p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase">
          Alarm Tiers ({alarmTiers.length})
        </p>
        <div className="flex flex-wrap gap-1.5">
          {alarmTiers.map((t) => (
            <Badge key={t.tier_id} variant="outline" className="text-xs">
              {t.tier_name}
            </Badge>
          ))}
        </div>
      </Card>

    </div>
  );
}

// ===========================================================================
// Shared field component
// ===========================================================================

function Field({
  label,
  id,
  value,
  onChange,
  placeholder,
  mono,
  type = "text",
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  type?: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn("text-sm", mono && "font-mono")}
      />
    </div>
  );
}
