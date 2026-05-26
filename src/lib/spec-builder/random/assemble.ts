/**
 * Top-level Stage-2 assembler. Consumes a RandomFdsTheme and produces
 * everything the hook needs to persist a complete V2 spec:
 *   - SpecContractPatch (for writeSpecContract — validator-gated)
 *   - InstrumentRegister tags + summaries (for useSaveInstrumentRegister)
 *   - fds_assembly_sessions rows (direct insert; V2-shaped)
 *   - fds_subsystem_orchestrations rows (direct insert; V2-shaped)
 *   - spec_sections rows for functional_description (direct insert)
 */
import type {
  AlarmTier,
  AssemblyContract,
  Hierarchy,
  OperatingStateV2,
  SubsystemStateSequence,
  SubsystemV2,
  IoSignalV2,
} from "@/types/spec-contract-v2";
import type { SpecContractPatch } from "@/lib/spec-builder/contract";
import { CANONICAL_STATES, SEQUENTIAL_STATE_IDS, STATE_ID_IDLE, STATE_ID_COMPLETE, STATE_ID_E_STOP } from "./state-machine";
import { computeSubsystemBases, createIoAllocator, type IoSignalKind } from "./io-allocator";
import { DEVICE_TEMPLATES } from "./device-templates";
import { buildAssemblyContracts, type ResolvedAssembly, type ResolvedDevice, type ResolvedIoSignal } from "./sequence-builder";
import { buildOrchestrations } from "./orchestration-builder";
import { renderSequentialContentJson, renderStaticContentJson } from "./section-renderer";
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
  device_class: string;
  signal_direction: IoSignalKind;
  subsystem_prefix: string;
  is_safety: boolean;
  subsystem: string;
}

export interface InstrumentRegisterPayload {
  tags: InstrumentTagRow[];
  subsystems: Array<{
    subsystem_id: string;
    subsystem_name: string;
    equipment_type: string;
    tag_count: number;
  }>;
}

export interface AssemblySessionRow {
  spec_project_id: string;
  subsystem_id: string;
  assembly_id: string;
  status: "complete";
  static_confirmed: true;
  static_states_v2: Record<string, unknown>;
  sequential_states: Record<string, unknown>;
  conversation: unknown[];
}

export interface OrchestrationRow {
  spec_project_id: string;
  subsystem_id: string;
  state_sequences: Record<string, SubsystemStateSequence>;
  conversation: unknown[];
  validation_results: null;
  token_usage: { input: 0; output: 0 };
}

export interface FunctionalDescriptionRow {
  spec_project_id: string;
  section_type: "functional_description";
  subsystem_id: string;
  assembly_id: string;
  state_id: string;
  state_pattern: "static" | "sequential";
  granularity: "assembly_state";
  content_json: Record<string, unknown>;
  approved: true;
}

export interface AssembleResult {
  patch: SpecContractPatch;
  instrumentRegister: InstrumentRegisterPayload;
  assemblySessions: AssemblySessionRow[];
  orchestrations: OrchestrationRow[];
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
  subsystems: Array<{
    subsystem_id: string;
    subsystem_name: string;
    equipment_type: string;
    description: string;
    assemblies: ResolvedAssembly[];
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

  const subs = theme.subsystems.map((sub, si) => {
    const subsystem_id = crypto.randomUUID();
    const allocator = createIoAllocator(computeSubsystemBases(si));

    const assemblies: ResolvedAssembly[] = sub.assemblies.map((asm, ai) => {
      const assembly_id = crypto.randomUUID();
      const asmPrefix = tokenisePrefix(asm.assembly_name, `ASM${ai + 1}`);

      const devices: ResolvedDevice[] = asm.devices.map((dev, di) => {
        const device_id = crypto.randomUUID();
        const baseDevPrefix = `${asmPrefix}_${tokenisePrefix(dev.device_name, `D${di + 1}`)}`;
        const devPrefix = uniqueDevPrefix(baseDevPrefix);
        const tpl = DEVICE_TEMPLATES[dev.device_class];
        const ioSignals: ResolvedIoSignal[] = tpl.ioSlots.map((slot) => ({
          tag: `${devPrefix}_${slot.suffix}`,
          suffix: slot.suffix,
          kind: slot.kind,
          io_address: allocator.next(slot.kind),
          description: `${dev.device_name} — ${slot.description}`,
        }));
        return {
          device_id,
          device_name: dev.device_name,
          device_class: dev.device_class,
          description: dev.description,
          is_safety: dev.is_safety,
          tag_prefix: devPrefix,
          io_signals: ioSignals,
        };
      });

      return { assembly_id, assembly_name: asm.assembly_name, subsystem_id, devices };
    });

    return {
      subsystem_id,
      subsystem_name: sub.subsystem_name,
      equipment_type: sub.equipment_type,
      description: sub.description,
      assemblies,
    };
  });

  return { subsystems: subs };
}

// ---------------------------------------------------------------------
// Patch builders
// ---------------------------------------------------------------------

function buildHierarchy(resolved: ResolvedHierarchy): Hierarchy {
  const subsystems: SubsystemV2[] = resolved.subsystems.map((sub) => ({
    subsystem_id: sub.subsystem_id,
    subsystem_name: sub.subsystem_name,
    equipment_type: sub.equipment_type,
    description: sub.description,
    excluded: false,
    assemblies: sub.assemblies.map((asm) => ({
      assembly_id: asm.assembly_id,
      assembly_name: asm.assembly_name,
      description: "",
      devices: asm.devices.map((d) => ({
        device_id: d.device_id,
        device_name: d.device_name,
        device_class: d.device_class,
        is_safety: d.is_safety,
        description: d.description,
        io_signals: d.io_signals.map<IoSignalV2>((s) => ({
          tag: s.tag,
          signal_type: s.kind,
          io_address: s.io_address,
          description: s.description,
          source: "wired",
          tier: "wired",
        })),
      })),
    })),
  }));
  return { subsystems };
}

function buildStates(): OperatingStateV2[] {
  return CANONICAL_STATES;
}

function buildAlarmTiers(): AlarmTier[] {
  return [
    { tier_id: "critical", tier_name: "Critical", description: "Immediate shutdown" },
    { tier_id: "warning", tier_name: "Warning", description: "Operator notification" },
  ];
}

function buildAlarms(resolved: ResolvedHierarchy): import("@/types/spec-contract-v2").AlarmRow[] {
  const alarms: import("@/types/spec-contract-v2").AlarmRow[] = [];
  for (const sub of resolved.subsystems) {
    for (const asm of sub.assemblies) {
      for (const dev of asm.devices) {
        // Motors / drives that expose a FAULT input get a "fault" alarm.
        const faultIo = dev.io_signals.find((s) => s.suffix === "FAULT");
        if (faultIo) {
          alarms.push({
            id: crypto.randomUUID(),
            tier_id: "critical",
            device_id: dev.device_id,
            assembly_id: asm.assembly_id,
            subsystem_id: sub.subsystem_id,
            tag: faultIo.tag,
            description: `${dev.device_name} drive fault`,
            action: "Stop assembly; require operator reset",
          });
        }
        // Safety devices (E-stops, safety gates) get a "tripped" alarm.
        if (dev.is_safety) {
          const stateIo = dev.io_signals.find((s) => s.suffix === "STATE") ?? dev.io_signals[0];
          if (stateIo) {
            alarms.push({
              id: crypto.randomUUID(),
              tier_id: "critical",
              device_id: dev.device_id,
              assembly_id: asm.assembly_id,
              subsystem_id: sub.subsystem_id,
              tag: stateIo.tag,
              description: `${dev.device_name} safety device tripped`,
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
  const flatAssemblies: ResolvedAssembly[] = resolved.subsystems.flatMap((s) => s.assemblies);
  const assemblies = buildAssemblyContracts(flatAssemblies);
  const orchestrationsMap = buildOrchestrations(
    resolved.subsystems.map((s) => ({
      subsystem_id: s.subsystem_id,
      assemblies: s.assemblies.map((a) => ({
        assembly_id: a.assembly_id,
        // Pick the first device's run-feedback tag (if any) as the interlock source.
        // If the assembly has no DI/DO devices with FB_RUN, fall back to the first IO tag.
        first_device_run_tag:
          a.devices[0]?.io_signals.find((s) => s.suffix === "FB_RUN")?.tag ??
          a.devices[0]?.io_signals[0]?.tag ??
          `PLACEHOLDER_${a.assembly_id.slice(0, 8)}`,
      })),
    })),
  );

  const patch: SpecContractPatch = {
    hierarchy: buildHierarchy(resolved),
    states: buildStates(),
    alarm_tiers: buildAlarmTiers(),
    alarms: buildAlarms(resolved),
    modes: [{ mode_id: "auto", name: "Auto", description: "Single default mode", is_default: true }],
    assemblies,
    orchestrations: orchestrationsMap,
    confirmation_status: "confirmed",
  };

  // Instrument register
  const tags: InstrumentTagRow[] = [];
  const subSummaries: InstrumentRegisterPayload["subsystems"] = [];
  for (const sub of resolved.subsystems) {
    let count = 0;
    for (const asm of sub.assemblies) {
      for (const dev of asm.devices) {
        for (const sig of dev.io_signals) {
          tags.push({
            tag: sig.tag,
            device_type: dev.device_class,
            description: sig.description,
            signal_type: sig.kind,
            io_address: sig.io_address,
            device_class: dev.device_class,
            signal_direction: sig.kind,
            subsystem_prefix: sub.subsystem_id,
            is_safety: dev.is_safety,
            subsystem: sub.subsystem_name,
          });
          count += 1;
        }
      }
    }
    subSummaries.push({
      subsystem_id: sub.subsystem_id,
      subsystem_name: sub.subsystem_name,
      equipment_type: sub.equipment_type,
      tag_count: count,
    });
  }

  // Assembly sessions (one row per assembly, V2-shaped)
  const assemblySessions: AssemblySessionRow[] = [];
  for (const sub of resolved.subsystems) {
    for (const asm of sub.assemblies) {
      const ctr: AssemblyContract = assemblies[asm.assembly_id];
      assemblySessions.push({
        spec_project_id: opts.projectId,
        subsystem_id: sub.subsystem_id,
        assembly_id: asm.assembly_id,
        status: "complete",
        static_confirmed: true,
        static_states_v2: ctr.static_states,
        sequential_states: ctr.sequential_states,
        conversation: [],
      });
    }
  }

  // Subsystem orchestration rows (only multi-assembly subsystems)
  const orchestrations: OrchestrationRow[] = [];
  for (const sub of resolved.subsystems) {
    if (sub.assemblies.length <= 1) continue;
    orchestrations.push({
      spec_project_id: opts.projectId,
      subsystem_id: sub.subsystem_id,
      state_sequences: orchestrationsMap[sub.subsystem_id],
      conversation: [],
      validation_results: null,
      token_usage: { input: 0, output: 0 },
    });
  }

  // functional_description spec_sections rows (one per assembly per state)
  const functionalDescriptionRows: FunctionalDescriptionRow[] = [];
  for (const sub of resolved.subsystems) {
    for (const asm of sub.assemblies) {
      const ctr = assemblies[asm.assembly_id];
      for (const stateId of SEQUENTIAL_STATE_IDS) {
        functionalDescriptionRows.push({
          spec_project_id: opts.projectId,
          section_type: "functional_description",
          subsystem_id: sub.subsystem_id,
          assembly_id: asm.assembly_id,
          state_id: String(stateId),
          state_pattern: "sequential",
          granularity: "assembly_state",
          content_json: renderSequentialContentJson(
            ctr.sequential_states[String(stateId)],
          ) as unknown as Record<string, unknown>,
          approved: true,
        });
      }
      for (const stateId of [STATE_ID_IDLE, STATE_ID_COMPLETE, STATE_ID_E_STOP]) {
        functionalDescriptionRows.push({
          spec_project_id: opts.projectId,
          section_type: "functional_description",
          subsystem_id: sub.subsystem_id,
          assembly_id: asm.assembly_id,
          state_id: String(stateId),
          state_pattern: "static",
          granularity: "assembly_state",
          content_json: renderStaticContentJson(
            ctr.static_states[String(stateId)],
          ) as unknown as Record<string, unknown>,
          approved: true,
        });
      }
    }
  }

  return {
    patch,
    instrumentRegister: { tags, subsystems: subSummaries },
    assemblySessions,
    orchestrations,
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
