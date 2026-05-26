import { useState, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Loader2,
  Plus,
  Trash2,
  Sparkles,
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
  SubsystemConfig,
  AlarmTier,
} from "@/types/spec-builder";
import { migrateSubsystemConfig, getSubsystemDeviceCount, inferStatePattern } from "@/types/spec-builder";
import type { StatePattern } from "@/types/spec-builder";
import type { OperatingStateV2 } from "@/types/spec-contract-v2";
import { CANONICAL_STATES } from "@/lib/spec-builder/random/state-machine";
import { packmlByName, packmlById } from "@/lib/spec-builder/migrate/packml-canonical";
import type { SpecProjectUpdate } from "@/types/spec-builder";
import { buildHierarchyFromTags } from "@/lib/spec-builder/instrument-parser";
import { MachineHierarchyTable } from "./machine-hierarchy-table";
import { cn } from "@/lib/utils";

const HMI_OPTIONS = ["WinCC Unified", "WinCC Comfort", "None", "Other"];

const COMMS_OPTIONS = ["OPC UA", "PROFINET", "Ethernet/IP", "None"];

const WIZARD_STEPS = [
  "Document Metadata",
  "Control System",
  "Machine Hierarchy",
  "Operating Modes",
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
  const [subsystems, setSubsystems] = useState<SubsystemConfig[]>(() => {
    if (spec.confirmed_subsystems?.length) {
      return migrateSubsystemConfig(spec.confirmed_subsystems);
    }
    return buildHierarchyFromTags(register.tags);
  });
  const [inferringHierarchy, setInferringHierarchy] = useState(false);

  // Step 4 — Operating modes (V2 shape: numeric PackML state_id where
  // possible, custom_state_id >= 101 for non-PackML names). Legacy
  // string-id state rows from older specs are upgraded on load via
  // packmlByName so the wizard never displays "Legacy" once an engineer
  // touches the spec.
  const [states, setStates] = useState<OperatingStateV2[]>(() =>
    upgradeLegacyStates((spec.confirmed_states ?? []) as unknown as OperatingStateV2[]),
  );
  const [inferring, setInferring] = useState(false);

  // Step 5 — Alarm tiers
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
    if (step === 2) return subsystems.some((s) => !s.excluded && s.assemblies.length > 0);
    if (step === 3) return states.length > 0;
    if (step === 4) return alarmTiers.length > 0;
    return true;
  })();

  const handleNext = useCallback(async () => {
    if (step < 5) {
      setStep((s) => s + 1);
      return;
    }
    // Step 6 — confirm: save everything and mark ready
    await updateSpec.mutateAsync({
      id: spec.id,
      ...meta,
      ...control,
      confirmed_subsystems: subsystems,
      // confirmed_states column is JSONB; the V2 shape is structurally a
      // superset of the V1 SpecProjectUpdate.confirmed_states type. Cast
      // bridges the explicit type bound without losing the V2 fields.
      confirmed_states: states as unknown as SpecProjectUpdate["confirmed_states"],
      alarm_tiers: alarmTiers,
    });
    onComplete();
  }, [step, spec.id, meta, control, subsystems, states, alarmTiers, updateSpec, onComplete]);

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
        subsystem: t.subsystem,
      }));

      const systemPrompt = `You are an industrial automation engineer. Given instrument register tags, organize them into a machine hierarchy:

System → Subsystem → Assembly → Device

Rules:
- **Subsystem** = functional station (e.g. "Fan Array", "Infeed Conveyor Station", "Hydraulic Lift Station")
- **Assembly** = coordinated group of devices working together (e.g. "Conveyor CV01", "Fan GK01"). An assembly has NO FB — it is orchestrated by process sequence logic.
- **Device** = single physical thing with IO signals (e.g. motor, sensor, valve). Gets an FB.
- Multiple tags with different suffixes (_CMD, _FB, _OL) that belong to the same physical device should be grouped as io_signals on ONE device, not separate devices.
- Tags that share a subsystem prefix go under the same subsystem.
- Within a subsystem, group related devices into assemblies by equipment ID prefix.

Return ONLY a JSON array matching this TypeScript interface:
[{
  "subsystem_id": "string",
  "subsystem_name": "string",
  "equipment_type": "Hopper"|"Pneumatic Transporter"|"Dryer"|"Cooler"|"Unloading Station"|"Magnetic Filter"|"Fan/Blower"|"Milling"|"Conveyor"|"Other",
  "description": "string",
  "assemblies": [{
    "assembly_id": "string",
    "assembly_name": "string",
    "description": "string",
    "devices": [{
      "device_id": "string",
      "device_name": "string",
      "device_class": "valve"|"motor"|"sensor_level"|"sensor_pressure"|"sensor_temperature"|"sensor_weight"|"sensor_flow"|"sensor_position"|"indicator"|"transmitter"|"filter"|"conveyor"|"hopper"|"transporter"|"dryer"|"cooler"|"push_button"|"emergency_stop"|"other",
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

      const parsed = JSON.parse(result.content) as SubsystemConfig[];
      setSubsystems(parsed);
    } catch {
      // Fallback to deterministic hierarchy builder
      setSubsystems(buildHierarchyFromTags(register.tags));
    } finally {
      setInferringHierarchy(false);
    }
  }, [register.tags]);

  // Step 4 — infer operating modes via Sonnet
  const inferStates = useCallback(async () => {
    setInferring(true);
    try {
      const controller = new AbortController();
      const subsystemList = subsystems
        .filter((s) => !s.excluded)
        .map((s) => `${s.subsystem_name} (${s.equipment_type}, ${s.assemblies.length} assemblies, ${getSubsystemDeviceCount(s)} devices)`)
        .join("\n");

      const systemPrompt = `You are an industrial automation engineering expert. Given this list of subsystems from an instrument register, infer the likely operating states/modes for this plant.

Use PackML state-model conventions where applicable. Canonical state names:
Idle, Starting, Execute, Stopping, Complete, E-Stop (also Held, Suspended for advanced machines).

Each state has a "state_pattern" — either "static" or "sequential":
- "static" = states where all outputs are in a defined position (e.g. Idle, Complete, E-Stop, Held) — documented as a Device State Table (Tag | Description | State)
- "sequential" = states with ordered steps and transition conditions (e.g. Starting, Execute, Stopping) — documented as a Step Table (Step | Action | Completion Criteria)

Return ONLY a JSON array of state objects. No preamble.
[
  { "state_id": "idle", "state_name": "Idle", "state_pattern": "static", "description": "All outputs de-energised; awaiting start command." }
]`;

      const plMeta: PromptLayerMeta = {
        prompt_name: "spec_infer_states",
        agent_role: "spec_skeleton_builder",
        model: "claude-sonnet-4-6",
      };

      const result = await callNonStreaming(
        systemPrompt,
        [{ role: "user" as const, content: `Subsystems:\n${subsystemList}` }],
        controller.signal,
        4096,
        plMeta
      );

      const raw = JSON.parse(result.content) as Array<{
        state_id?: string;
        state_name?: string;
        description?: string;
        state_pattern?: "static" | "sequential";
      }>;
      setStates(rawAiStatesToV2(raw));
    } catch {
      // Fallback to the canonical PackML state set (same one the random
      // builder uses — numeric state_id = packml_id, both state_name and
      // display_name populated).
      setStates([...CANONICAL_STATES]);
    } finally {
      setInferring(false);
    }
  }, [subsystems]);

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
            subsystems={subsystems}
            availableTags={register.tags}
            onChange={setSubsystems}
            onInferHierarchy={inferHierarchy}
            inferring={inferringHierarchy}
          />
        )}
        {step === 3 && (
          <StepOperatingModes
            states={states}
            onChange={setStates}
            onInfer={inferStates}
            inferring={inferring}
          />
        )}
        {step === 4 && <StepAlarmConfig tiers={alarmTiers} onChange={setAlarmTiers} />}
        {step === 5 && (
          <StepReview
            meta={meta}
            control={control}
            subsystems={subsystems}
            states={states}
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
          {step === 5 ? "Confirm & Save" : "Next"}
          {step < 5 && <ChevronRight className="h-3.5 w-3.5 ml-1" />}
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
// Step 4 — Operating Modes (V2 shape)
// ===========================================================================

/**
 * Common PackML states surfaced in the wizard's name picker. The full
 * 17-state PackML model is exposed via `packmlByName`, but the wizard's
 * dropdown only lists the eight that real specs need — the remaining
 * intermediate states (Clearing, Unsuspending, etc.) can be added by
 * choosing Custom if a project genuinely needs them.
 */
const PACKML_PICKER_IDS = [4, 3, 6, 7, 17, 9, 11, 5] as const; // Idle, Starting, Execute, Stopping, Complete, Aborted (=E-Stop), Held, Suspended
const PACKML_PICKER_OPTIONS = PACKML_PICKER_IDS.map((id) => {
  const s = packmlById(id);
  if (!s) throw new Error(`PACKML_PICKER_IDS contains unknown id ${id}`);
  // E-Stop is the user-facing label for PackML's "Aborted" (id 9).
  const label = id === 9 ? "E-Stop" : s.name;
  return { packml_id: s.packml_id, label, state_pattern: s.state_pattern };
});

/**
 * Map an AI/user state name onto V2 shape. Names matching a canonical
 * PackML entry get the matching numeric `state_id` + `packml_id`; other
 * names become custom states with `state_id >= 101` (the validator's
 * required custom-id range) and `custom_name` set.
 */
function buildV2State(args: {
  name: string;
  description: string;
  pattern: StatePattern;
  takenCustomIds: Set<number>;
}): OperatingStateV2 {
  const canonical = packmlByName(args.name);
  if (canonical) {
    return {
      state_id: canonical.packml_id,
      packml_id: canonical.packml_id,
      state_name: args.name,
      display_name: args.name,
      description: args.description,
      state_pattern: args.pattern,
    };
  }
  // Custom state — find the next free id >= 101.
  let nextId = 101;
  while (args.takenCustomIds.has(nextId)) nextId += 1;
  args.takenCustomIds.add(nextId);
  return {
    state_id: nextId,
    state_name: args.name,
    display_name: args.name,
    description: args.description,
    state_pattern: args.pattern,
    custom_name: args.name,
  };
}

/**
 * Upgrade any legacy string-id state rows from older specs:
 *   "idle"/"Idle" → packml_id 4
 *   unrecognised names → next available custom id (>= 101)
 * Already-numeric ids pass through unchanged.
 */
function upgradeLegacyStates(input: OperatingStateV2[]): OperatingStateV2[] {
  const takenCustomIds = new Set<number>(
    input
      .map((s) => (typeof s.state_id === "number" ? s.state_id : NaN))
      .filter((n) => Number.isInteger(n) && n > 100),
  );
  return input.map((st) => {
    if (typeof st.state_id === "number") return st;
    const name = st.state_name ?? st.display_name ?? String(st.state_id);
    const upgraded = buildV2State({
      name,
      description: st.description,
      pattern: st.state_pattern,
      takenCustomIds,
    });
    return upgraded;
  });
}

function rawAiStatesToV2(
  raw: Array<{
    state_id?: string;
    state_name?: string;
    description?: string;
    state_pattern?: "static" | "sequential";
  }>,
): OperatingStateV2[] {
  const takenCustomIds = new Set<number>();
  return raw.map((r) => {
    const name = String(r.state_name ?? r.state_id ?? "Unnamed");
    return buildV2State({
      name,
      description: String(r.description ?? ""),
      pattern: (r.state_pattern as StatePattern | undefined) ?? inferStatePattern(name),
      takenCustomIds,
    });
  });
}

function isCustomState(st: OperatingStateV2): boolean {
  return typeof st.state_id === "number" && st.state_id > 100;
}

function isPackmlState(st: OperatingStateV2): boolean {
  return typeof st.state_id === "number" && st.state_id >= 1 && st.state_id <= 17;
}

function StepOperatingModes({
  states,
  onChange,
  onInfer,
  inferring,
}: {
  states: OperatingStateV2[];
  onChange: (s: OperatingStateV2[]) => void;
  onInfer: () => void;
  inferring: boolean;
}) {
  const updateAt = (idx: number, patch: Partial<OperatingStateV2>) => {
    const next = [...states];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const addState = () => {
    // Prefer the first unused PackML canonical (Idle/Starting/...) over
    // a Custom slot so the engineer gets a sensible default they can
    // change via the dropdown if they want something else.
    const usedPackmlIds = new Set(
      states
        .map((s) => (typeof s.state_id === "number" && s.state_id >= 1 && s.state_id <= 17 ? s.state_id : NaN))
        .filter((n) => Number.isInteger(n)),
    );
    const firstFreePackml = PACKML_PICKER_OPTIONS.find((o) => !usedPackmlIds.has(o.packml_id));
    if (firstFreePackml) {
      onChange([
        ...states,
        {
          state_id: firstFreePackml.packml_id,
          packml_id: firstFreePackml.packml_id,
          state_name: firstFreePackml.label,
          display_name: firstFreePackml.label,
          description: "",
          state_pattern: firstFreePackml.state_pattern as StatePattern,
        },
      ]);
      return;
    }
    // All PackML pickers are used — fall back to a Custom state.
    const takenCustomIds = new Set<number>(
      states
        .map((s) => (typeof s.state_id === "number" && s.state_id > 100 ? s.state_id : NaN))
        .filter((n) => Number.isInteger(n)),
    );
    let nextId = 101;
    while (takenCustomIds.has(nextId)) nextId += 1;
    onChange([
      ...states,
      {
        state_id: nextId,
        state_name: "Custom State",
        display_name: "Custom State",
        custom_name: "Custom State",
        description: "",
        state_pattern: "sequential",
      },
    ]);
  };

  const removeState = (idx: number) => {
    onChange(states.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Define the operating states for each subsystem.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onInfer} disabled={inferring}>
            {inferring ? (
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
            ) : (
              <Sparkles className="h-3 w-3 mr-1" />
            )}
            Infer with AI
          </Button>
          <Button variant="outline" size="sm" onClick={addState}>
            <Plus className="h-3 w-3 mr-1" />
            Add
          </Button>
        </div>
      </div>

      {states.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No states defined. Click "Infer with AI" to auto-detect from subsystems, or add manually.
        </Card>
      ) : (
        <div>
          <div className="grid gap-2">
            {(() => {
              const usedPackmlIds = new Set(
                states
                  .map((s) => (isPackmlState(s) && typeof s.state_id === "number" ? s.state_id : NaN))
                  .filter((n) => Number.isInteger(n)),
              );
              return states.map((st, i) => {
                const customMode = isCustomState(st);
                const pickerValue = isPackmlState(st)
                  ? `packml-${st.state_id}`
                  : customMode
                    ? "custom"
                    : "custom"; // fall-through for any edge case
                const badgeLabel = isPackmlState(st)
                  ? `PackML ${st.state_id}`
                  : `Custom ${st.state_id}`;
                return (
                  <Card key={String(st.state_id) || `idx-${i}`} className="p-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      <Select
                        value={pickerValue}
                        onValueChange={(v) => {
                          if (v === "custom") {
                            // Switch this row to a custom state
                            const takenCustomIds = new Set<number>(
                              states
                                .map((s, idx) =>
                                  idx !== i && typeof s.state_id === "number" && s.state_id > 100
                                    ? s.state_id
                                    : NaN,
                                )
                                .filter((n): n is number => Number.isInteger(n)),
                            );
                            let nextId = 101;
                            while (takenCustomIds.has(nextId)) nextId += 1;
                            updateAt(i, {
                              state_id: nextId,
                              packml_id: undefined,
                              state_name: "Custom State",
                              display_name: "Custom State",
                              custom_name: "Custom State",
                            });
                            return;
                          }
                          // PackML selection — e.g. "packml-4"
                          const id = Number(v.replace(/^packml-/, ""));
                          const opt = PACKML_PICKER_OPTIONS.find((o) => o.packml_id === id);
                          if (!opt) return;
                          updateAt(i, {
                            state_id: opt.packml_id,
                            packml_id: opt.packml_id,
                            state_name: opt.label,
                            display_name: opt.label,
                            custom_name: undefined,
                            state_pattern: opt.state_pattern as StatePattern,
                          });
                        }}
                      >
                        <SelectTrigger className="h-7 w-[180px] text-sm font-medium">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PACKML_PICKER_OPTIONS.map((opt) => {
                            const inUseElsewhere =
                              usedPackmlIds.has(opt.packml_id) && st.packml_id !== opt.packml_id;
                            return (
                              <SelectItem
                                key={opt.packml_id}
                                value={`packml-${opt.packml_id}`}
                                disabled={inUseElsewhere}
                              >
                                {opt.label} <span className="text-muted-foreground">· PackML {opt.packml_id}</span>
                              </SelectItem>
                            );
                          })}
                          <SelectItem value="custom">Custom…</SelectItem>
                        </SelectContent>
                      </Select>

                      {customMode && (
                        <Input
                          value={st.display_name ?? st.state_name ?? ""}
                          onChange={(e) => {
                            const newName = e.target.value;
                            updateAt(i, {
                              state_name: newName,
                              display_name: newName,
                              custom_name: newName,
                            });
                          }}
                          placeholder="Custom state name"
                          className="text-sm font-medium h-7 w-44 font-mono"
                        />
                      )}

                      <Select
                        value={st.state_pattern}
                        onValueChange={(v) => updateAt(i, { state_pattern: v as StatePattern })}
                        disabled={isPackmlState(st)}
                      >
                        <SelectTrigger className="h-7 w-[130px] text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="static">Static (table)</SelectItem>
                          <SelectItem value="sequential">Sequential (steps)</SelectItem>
                        </SelectContent>
                      </Select>
                      <Badge variant="outline" className="text-[10px] font-mono">
                        {badgeLabel}
                      </Badge>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 ml-auto"
                        onClick={() => removeState(i)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                    <Input
                      value={st.description}
                      onChange={(e) => updateAt(i, { description: e.target.value })}
                      placeholder="Description of this state..."
                      className="text-xs h-7"
                    />
                  </Card>
                );
              });
            })()}
          </div>
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
  subsystems,
  states,
  alarmTiers,
}: {
  meta: MetaForm;
  control: ControlForm;
  subsystems: SubsystemConfig[];
  states: OperatingStateV2[];
  alarmTiers: AlarmTier[];
}) {
  const activeSubs = subsystems.filter((s) => !s.excluded);
  const totalAssemblies = activeSubs.reduce((s, sub) => s + sub.assemblies.length, 0);
  const totalDevices = activeSubs.reduce(
    (s, sub) => s + sub.assemblies.reduce((a, asm) => a + asm.devices.length, 0),
    0,
  );
  // V2: Sections 0-8 + audit = up to 10 top-level + per-subsystem functional descriptions
  const funcDescSections = activeSubs.length * (1 + states.length); // equipment preamble + states
  const totalSections = 9 + funcDescSections + 1; // 9 numbered sections + func desc details + audit

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
            <div key={sub.subsystem_id} className="text-xs">
              <span className="font-medium">{sub.subsystem_name}</span>
              <span className="text-muted-foreground ml-1">
                ({sub.equipment_type}, {sub.assemblies.length}A / {getSubsystemDeviceCount(sub)}D)
              </span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-3 space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase">
          Operating States ({states.length})
        </p>
        <div className="flex flex-wrap gap-1.5">
          {states.map((s, i) => (
            <Badge key={String(s.state_id) || `idx-${i}`} variant="outline" className="text-xs">
              {s.state_name ?? s.display_name ?? "(unnamed)"}
              <span className="ml-1 text-muted-foreground">
                ({s.state_pattern === "static" ? "table" : "steps"})
              </span>
            </Badge>
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

      <Card className="p-3 bg-primary/5 border-primary/20">
        <p className="text-xs">
          <span className="font-semibold">Generation scope:</span>{" "}
          9 document sections + {activeSubs.length} subsystems × {states.length} states ={" "}
          <span className="font-mono font-bold">{totalSections} AI calls</span> + Opus audit
        </p>
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
