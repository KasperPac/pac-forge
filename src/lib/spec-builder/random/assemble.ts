/**
 * Top-level Stage-2 assembler. Consumes a RandomFdsTheme and produces
 * everything the hook needs to persist a complete V2 spec:
 *   - SpecContractPatch (for writeSpecContract — validator-gated)
 *   - InstrumentRegister tags + summaries (for useSaveInstrumentRegister)
 *   - fds_operation_sessions rows (direct insert; V2-shaped)
 *   - spec_sections rows for functional_description (direct insert)
 */
import type {
  AlarmTier,
  EquipmentModuleContract,
  Hierarchy,
  SafetyGateV2,
  UnitV2,
  IoSignalV2,
} from "@/types/spec-contract-v2";
import type { SpecContractPatch } from "@/lib/spec-builder/contract";
import {
  EM_LOCAL_SEQUENTIAL_IDS,
  EM_LOCAL_IDLE,
  EM_LOCAL_COMPLETE,
  EM_LOCAL_ABORTED,
} from "./state-machine";
import { computeSubsystemBases, createIoAllocator, type IoSignalKind } from "./io-allocator";
import { DEVICE_TEMPLATES } from "./device-templates";
import { buildEquipmentModuleContracts, type ResolvedAssembly, type ResolvedDevice, type ResolvedIoSignal } from "./sequence-builder";
import { renderSequentialContentJson, renderStaticContentJson } from "./section-renderer";
import {
  buildEngineering,
  buildMaintenance,
  buildUnitCoordination,
  driveForClass,
  polarityFor,
  scalingFor,
} from "./controls-data-builder";
import type { RandomFdsTheme } from "./theme-schema";

export interface AssembleOptions {
  projectId: string;
}

export interface InstrumentTagRow {
  tag: string;
  device_type: string;
  description: string;
  signal_type: IoSignalKind;
  io_address: string;
  control_module_class: string;
  signal_direction: IoSignalKind;
  unit_prefix: string;
  is_safety: boolean;
  unit: string;
}

export interface InstrumentRegisterPayload {
  tags: InstrumentTagRow[];
  units: Array<{
    unit_id: string;
    unit_name: string;
    equipment_type: string;
    tag_count: number;
  }>;
}

export interface AssemblySessionRow {
  spec_project_id: string;
  unit_id: string;
  equipment_module_id: string;
  status: "complete";
  static_confirmed: true;
  static_states_v2: Record<string, unknown>;
  sequential_states: Record<string, unknown>;
  em_states: unknown[];
  em_transitions: unknown[];
  conversation: unknown[];
}

export interface FunctionalDescriptionRow {
  spec_project_id: string;
  section_type: "functional_description";
  unit_id: string;
  equipment_module_id: string;
  state_id: string;
  state_pattern: "static" | "sequential";
  granularity: "equipment_module_state";
  content_json: Record<string, unknown>;
  approved: true;
}

export interface AssembleResult {
  patch: SpecContractPatch;
  instrumentRegister: InstrumentRegisterPayload;
  equipment_moduleSessions: AssemblySessionRow[];
  functionalDescriptionRows: FunctionalDescriptionRow[];
  /** Cosmetic surface for the create-spec call. */
  projectFields: {
    title: string;
    plc_model: string;
    hmi_type: string;
    system_description: string;
    safety_classification: string | null;
    fault_philosophy: string;
    design_principles: string[];
  };
}

// ---------------------------------------------------------------------
// Tag prefix derivation — short ISA-style identifiers from theme names
// ---------------------------------------------------------------------

function tokenisePrefix(name: string, fallback: string): string {
  const cleaned = name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 12) : fallback;
}

// ---------------------------------------------------------------------
// Resolution: theme → ResolvedAssembly[] with real UUIDs + IO addresses
// ---------------------------------------------------------------------

interface ResolvedHierarchy {
  units: Array<{
    unit_id: string;
    unit_name: string;
    equipment_type: string;
    description: string;
    equipment_modules: ResolvedAssembly[];
  }>;
}

function resolveHierarchy(theme: RandomFdsTheme): ResolvedHierarchy {
  // Spec-wide set of device tag prefixes. tokenisePrefix truncates to 12
  // chars, so similar long names ("Dehumidifier Process Air 1" / "...2")
  // collapse onto the same prefix and produce duplicate IO tags, which the
  // contract validator's global IO-tag uniqueness check rejects. We
  // disambiguate by appending a numeric suffix until the prefix is unique
  // across the whole spec.
  const usedDevPrefixes = new Set<string>();
  const uniqueDevPrefix = (base: string): string => {
    if (!usedDevPrefixes.has(base)) {
      usedDevPrefixes.add(base);
      return base;
    }
    let n = 2;
    while (usedDevPrefixes.has(`${base}_${n}`)) n += 1;
    const out = `${base}_${n}`;
    usedDevPrefixes.add(out);
    return out;
  };

  const subs = theme.units.map((sub, si) => {
    const unit_id = crypto.randomUUID();
    const allocator = createIoAllocator(computeSubsystemBases(si));

    const equipment_modules: ResolvedAssembly[] = sub.equipment_modules.map((asm, ai) => {
      const equipment_module_id = crypto.randomUUID();
      const asmPrefix = tokenisePrefix(asm.equipment_module_name, `ASM${ai + 1}`);

      const control_modules: ResolvedDevice[] = asm.control_modules.map((dev, di) => {
        const control_module_id = crypto.randomUUID();
        const baseDevPrefix = `${asmPrefix}_${tokenisePrefix(dev.control_module_name, `D${di + 1}`)}`;
        const devPrefix = uniqueDevPrefix(baseDevPrefix);
        const tpl = DEVICE_TEMPLATES[dev.control_module_class];
        const ioSignals: ResolvedIoSignal[] = tpl.ioSlots.map((slot) => ({
          tag: `${devPrefix}_${slot.suffix}`,
          suffix: slot.suffix,
          kind: slot.kind,
          io_address: allocator.next(slot.kind),
          description: `${dev.control_module_name} — ${slot.description}`,
        }));
        return {
          control_module_id,
          control_module_name: dev.control_module_name,
          control_module_class: dev.control_module_class,
          description: dev.description,
          is_safety: dev.is_safety,
          tag_prefix: devPrefix,
          io_signals: ioSignals,
        };
      });

      return { equipment_module_id, equipment_module_name: asm.equipment_module_name, unit_id, control_modules };
    });

    return {
      unit_id,
      unit_name: sub.unit_name,
      equipment_type: sub.equipment_type,
      description: sub.description,
      equipment_modules,
    };
  });

  return { units: subs };
}

// ---------------------------------------------------------------------
// Patch builders
// ---------------------------------------------------------------------

function buildHierarchy(resolved: ResolvedHierarchy): Hierarchy {
  const units: UnitV2[] = resolved.units.map((sub) => ({
    unit_id: sub.unit_id,
    unit_name: sub.unit_name,
    equipment_type: sub.equipment_type,
    description: sub.description,
    excluded: false,
    equipment_modules: sub.equipment_modules.map((asm) => ({
      equipment_module_id: asm.equipment_module_id,
      equipment_module_name: asm.equipment_module_name,
      description: "",
      control_modules: asm.control_modules.map((d) => ({
        control_module_id: d.control_module_id,
        control_module_name: d.control_module_name,
        control_module_class: d.control_module_class,
        is_safety: d.is_safety,
        description: d.description,
        // G0-16 W3: drive-class CMs carry the tier-1 VSD model
        drive: driveForClass(d.control_module_class),
        io_signals: d.io_signals.map<IoSignalV2>((s) => ({
          tag: s.tag,
          signal_type: s.kind,
          io_address: s.io_address,
          description: s.description,
          source: "wired",
          tier: "wired",
          // G0-16 W3: fail-safe polarity on safety/fault DIs, S7 ADC scaling on AIs
          polarity: polarityFor(d, s.kind, s.suffix),
          scaling: scalingFor(s.kind),
        })),
      })),
    })),
  }));
  return { units };
}

function buildSafetyGates(resolved: ResolvedHierarchy): SafetyGateV2[] {
  const safetyTags: string[] = [];
  for (const sub of resolved.units)
    for (const asm of sub.equipment_modules)
      for (const dev of asm.control_modules)
        if (dev.is_safety)
          for (const sig of dev.io_signals) safetyTags.push(sig.tag);
  const seen = new Set<string>();
  const gates: SafetyGateV2[] = [];
  for (const tag of safetyTags) {
    if (seen.has(tag)) continue;
    seen.add(tag);
    gates.push({
      gate_id: `gate_${tag.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
      name: tag,
      condition: [{ tag, operator: "=", value: false }],
      scope: "all",
    });
  }
  return gates;
}

function buildAlarmTiers(): AlarmTier[] {
  return [
    { tier_id: "critical", tier_name: "Critical", description: "Immediate shutdown" },
    { tier_id: "warning", tier_name: "Warning", description: "Operator notification" },
  ];
}

function buildAlarms(resolved: ResolvedHierarchy): import("@/types/spec-contract-v2").AlarmRow[] {
  const alarms: import("@/types/spec-contract-v2").AlarmRow[] = [];
  for (const sub of resolved.units) {
    for (const asm of sub.equipment_modules) {
      for (const dev of asm.control_modules) {
        // Motors / drives that expose a FAULT input get a "fault" alarm.
        const faultIo = dev.io_signals.find((s) => s.suffix === "FAULT");
        if (faultIo) {
          alarms.push({
            id: crypto.randomUUID(),
            tier_id: "critical",
            control_module_id: dev.control_module_id,
            equipment_module_id: asm.equipment_module_id,
            unit_id: sub.unit_id,
            tag: faultIo.tag,
            description: `${dev.control_module_name} drive fault`,
            action: "Stop equipment_module; require operator reset",
          });
        }
        // Safety control_modules (E-stops, safety gates) get a "tripped" alarm.
        if (dev.is_safety) {
          const stateIo = dev.io_signals.find((s) => s.suffix === "STATE") ?? dev.io_signals[0];
          if (stateIo) {
            alarms.push({
              id: crypto.randomUUID(),
              tier_id: "critical",
              control_module_id: dev.control_module_id,
              equipment_module_id: asm.equipment_module_id,
              unit_id: sub.unit_id,
              tag: stateIo.tag,
              description: `${dev.control_module_name} safety device tripped`,
              action: "E-stop machine",
            });
          }
        }
      }
    }
  }
  return alarms;
}

// ---------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------

export function assembleRandomFds(theme: RandomFdsTheme, opts: AssembleOptions): AssembleResult {
  const resolved = resolveHierarchy(theme);
  const flatAssemblies: ResolvedAssembly[] = resolved.units.flatMap((s) => s.equipment_modules);
  const equipment_modules = buildEquipmentModuleContracts(flatAssemblies);

  const safetyGates = buildSafetyGates(resolved);
  const engineering = buildEngineering(resolved.units);
  const maintenance = buildMaintenance(resolved.units);
  const patch: SpecContractPatch = {
    hierarchy: buildHierarchy(resolved),
    alarm_tiers: buildAlarmTiers(),
    alarms: buildAlarms(resolved),
    modes: [{ mode_id: "auto", name: "Auto", description: "Single default mode", is_default: true, kind: "production" }],
    safety_gates: safetyGates,
    equipment_modules,
    // G0-16 W3: controls-data seeding so random specs exercise the G1–G5
    // deterministic writers end-to-end
    unit_coordination: buildUnitCoordination(resolved.units, safetyGates),
    ...(engineering ? { engineering } : {}),
    ...(maintenance ? { maintenance } : {}),
    confirmation_status: "confirmed",
  };

  // Instrument register
  const tags: InstrumentTagRow[] = [];
  const subSummaries: InstrumentRegisterPayload["units"] = [];
  for (const sub of resolved.units) {
    let count = 0;
    for (const asm of sub.equipment_modules) {
      for (const dev of asm.control_modules) {
        for (const sig of dev.io_signals) {
          tags.push({
            tag: sig.tag,
            device_type: dev.control_module_class,
            description: sig.description,
            signal_type: sig.kind,
            io_address: sig.io_address,
            control_module_class: dev.control_module_class,
            signal_direction: sig.kind,
            unit_prefix: sub.unit_id,
            is_safety: dev.is_safety,
            unit: sub.unit_name,
          });
          count += 1;
        }
      }
    }
    subSummaries.push({
      unit_id: sub.unit_id,
      unit_name: sub.unit_name,
      equipment_type: sub.equipment_type,
      tag_count: count,
    });
  }

  // Equipment Module sessions (one row per equipment_module, V2-shaped)
  const equipment_moduleSessions: AssemblySessionRow[] = [];
  for (const sub of resolved.units) {
    for (const asm of sub.equipment_modules) {
      const ctr: EquipmentModuleContract = equipment_modules[asm.equipment_module_id];
      equipment_moduleSessions.push({
        spec_project_id: opts.projectId,
        unit_id: sub.unit_id,
        equipment_module_id: asm.equipment_module_id,
        status: "complete",
        static_confirmed: true,
        static_states_v2: ctr.static_states,
        sequential_states: ctr.sequential_states,
        em_states: ctr.states,
        em_transitions: ctr.transitions,
        conversation: [],
      });
    }
  }

  // functional_description spec_sections rows (one per equipment_module per state)
  const functionalDescriptionRows: FunctionalDescriptionRow[] = [];
  for (const sub of resolved.units) {
    for (const asm of sub.equipment_modules) {
      const ctr = equipment_modules[asm.equipment_module_id];
      for (const stateId of EM_LOCAL_SEQUENTIAL_IDS) {
        functionalDescriptionRows.push({
          spec_project_id: opts.projectId,
          section_type: "functional_description",
          unit_id: sub.unit_id,
          equipment_module_id: asm.equipment_module_id,
          state_id: stateId,
          state_pattern: "sequential",
          granularity: "equipment_module_state",
          content_json: renderSequentialContentJson(
            ctr.sequential_states[stateId],
          ) as unknown as Record<string, unknown>,
          approved: true,
        });
      }
      for (const stateId of [EM_LOCAL_IDLE, EM_LOCAL_COMPLETE, EM_LOCAL_ABORTED]) {
        functionalDescriptionRows.push({
          spec_project_id: opts.projectId,
          section_type: "functional_description",
          unit_id: sub.unit_id,
          equipment_module_id: asm.equipment_module_id,
          state_id: stateId,
          state_pattern: "static",
          granularity: "equipment_module_state",
          content_json: renderStaticContentJson(
            ctr.static_states[stateId],
          ) as unknown as Record<string, unknown>,
          approved: true,
        });
      }
    }
  }

  return {
    patch,
    instrumentRegister: { tags, units: subSummaries },
    equipment_moduleSessions,
    functionalDescriptionRows,
    projectFields: {
      title: theme.title,
      plc_model: theme.plc_model,
      hmi_type: theme.hmi_type,
      system_description: theme.system_description,
      safety_classification: theme.safety_classification,
      fault_philosophy: theme.fault_philosophy,
      design_principles: theme.design_principles,
    },
  };
}
