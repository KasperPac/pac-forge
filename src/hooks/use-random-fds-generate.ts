/**
 * Hook for generating a random FDS spec via the design engineer agent.
 * Creates a complete spec_project with subsystems, assemblies, devices, IO signals,
 * operating states, alarm tiers, and process sequences.
 */
import { useState, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { callNonStreaming } from "@/hooks/use-generation";
import {
  useCreateSpecProject,
  useUpdateSpecProject,
  useDeleteSpecProject,
  useSaveInstrumentRegister,
} from "@/hooks/use-spec-projects";
import { generateSpec } from "@/lib/spec-builder/orchestrator";
import { supabase } from "@/lib/supabase";
import type {
  SubsystemConfig,
  OperatingState,
  AlarmTier,
  DeviceConfig,
  AssemblyConfig,
  IoSignal,
  InstrumentTag,
  SubsystemSummary,
  DeviceClass,
  EquipmentType,
  SignalDirection,
} from "@/types/spec-builder";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RandomFdsParams {
  subsystems: number;
  assemblies: number;
  devices: number;
  projectId: string;
  projectNumber?: string;
  clientName?: string;
  autoComplete?: boolean;
  onProgress?: (stage: string, detail?: string) => void;
}

interface GeneratedFds {
  title: string;
  system_description: string;
  plc_model: string;
  hmi_type: string;
  safety_classification: string | null;
  fault_philosophy: string;
  design_principles: string[];
  operating_states: Array<{
    state_id: string;
    state_name: string;
    description: string;
    state_pattern: "static" | "sequential";
  }>;
  alarm_tiers: Array<{
    tier_id: string;
    tier_name: string;
    description: string;
  }>;
  subsystems: Array<{
    subsystem_id: string;
    subsystem_name: string;
    equipment_type: string;
    description: string;
    assemblies: Array<{
      assembly_id: string;
      assembly_name: string;
      description: string;
      devices: Array<{
        device_id: string;
        device_name: string;
        device_class: string;
        description: string;
        is_safety: boolean;
        io_signals: Array<{
          tag: string;
          signal_type: string;
          io_address: string;
          description: string;
        }>;
      }>;
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildRandomFdsPrompt(params: RandomFdsParams): string {
  return `You are a senior design engineer at an industrial automation company. Your task is to generate a **complete, realistic functional design specification (FDS)** for a random industrial machine or production system.

## Requirements

Generate a specification for a random type of industrial machine/system. Choose from realistic industrial applications such as:
- Material handling systems (conveyors, palletisers, pick & place)
- Packaging lines (filling, capping, labelling, case packing)
- Process systems (mixing, batching, CIP, pasteurisation)
- Assembly systems (press fitting, screwing, welding stations)
- Storage/retrieval (AS/RS, shuttle systems, vertical lifts)
- Treatment systems (coating, drying, curing, heat treatment)
- Food/beverage processing (forming, baking, cooling, freezing)
- Pharmaceutical (tablet press, coating pan, blister packing)
- Plastics (extrusion, injection moulding, blow moulding)
- Metal working (stamping, laser cutting, bending, deburring)

Pick something specific and interesting — not generic. Give it a realistic project name.

## Exact counts required

- **Subsystems**: exactly ${params.subsystems}
- **Assemblies**: exactly ${params.assemblies} total (distributed across subsystems)
- **Devices**: exactly ${params.devices} total (distributed across assemblies)

Each device MUST have at least 1 IO signal. Most devices should have 2-4 IO signals.
Motors typically have: run command (DO), feedback running (DI), fault (DI), and optionally speed reference (AO), speed feedback (AI).
Valves typically have: command (DO), open feedback (DI), closed feedback (DI).
Sensors: typically 1 DI or 1 AI signal.

## IO Signal Rules

- signal_type must be one of: "DI", "DO", "AI", "AO"
- io_address must use Siemens format: %I0.0, %Q0.0, %IW64, %QW80, etc.
  - DI: %I{byte}.{bit} (e.g. %I0.0, %I0.1, %I1.0)
  - DO: %Q{byte}.{bit} (e.g. %Q0.0, %Q0.1)
  - AI: %IW{word} (e.g. %IW64, %IW66) — word addresses, increment by 2
  - AO: %QW{word} (e.g. %QW80, %QW82)
- Tags should use realistic ISA-style naming (e.g. "CV01_M01_CMD", "LT01_LEVEL", "SOL_CLAMP_FWD")
- Addresses must not overlap

## Operating States

Include 4-7 operating states. Always include:
- IDLE (static) — all outputs off
- E_STOP (static) — emergency stop state
- At least 2 sequential states (e.g. STARTING, EXECUTE, STOPPING)
- Optionally: MANUAL, FAULT, COMPLETED, HOMING

## Alarm Tiers

Include 2-3 alarm tiers:
- Critical (immediate shutdown)
- Warning (operator notification)
- Optionally: Maintenance (logged only)

## Device Classes

device_class must be one of: "valve", "motor", "sensor_level", "sensor_pressure", "sensor_temperature", "sensor_weight", "sensor_flow", "sensor_position", "indicator", "transmitter", "filter", "conveyor", "hopper", "transporter", "dryer", "cooler", "push_button", "emergency_stop", "other"

## Equipment Types

equipment_type must be one of: "Hopper", "Pneumatic Transporter", "Dryer", "Cooler", "Unloading Station", "Magnetic Filter", "Fan/Blower", "Milling", "Conveyor", "Other"

## Output format

Return ONLY valid JSON matching this exact structure (no markdown fences, no explanation):

{
  "title": "string — project title",
  "system_description": "string — 2-3 sentence system overview",
  "plc_model": "string — e.g. S7-1500, CPU 1516-3 PN/DP",
  "hmi_type": "string — e.g. TP1200 Comfort, KTP700 Basic",
  "safety_classification": "string | null",
  "fault_philosophy": "string — e.g. fault → controlled stop → operator reset",
  "design_principles": ["string array — 3-5 design principles"],
  "operating_states": [{ "state_id": "string", "state_name": "string", "description": "string", "state_pattern": "static|sequential" }],
  "alarm_tiers": [{ "tier_id": "string", "tier_name": "string", "description": "string" }],
  "subsystems": [{
    "subsystem_id": "string",
    "subsystem_name": "string",
    "equipment_type": "string",
    "description": "string",
    "assemblies": [{
      "assembly_id": "string",
      "assembly_name": "string",
      "description": "string",
      "devices": [{
        "device_id": "string",
        "device_name": "string",
        "device_class": "string",
        "description": "string",
        "is_safety": false,
        "io_signals": [{
          "tag": "string",
          "signal_type": "DI|DO|AI|AO",
          "io_address": "string",
          "description": "string"
        }]
      }]
    }]
  }]
}`;
}

function normalizeSignalDirection(s: string): SignalDirection {
  const u = (s ?? "").toUpperCase();
  if (u === "DI" || u === "DO" || u === "AI" || u === "AO") return u;
  return "internal";
}

// ---------------------------------------------------------------------------
// JSON extractor — handles markdown fences and prose wrapping
// ---------------------------------------------------------------------------

function extractAndParseJson(raw: string): GeneratedFds {
  // Strip common markdown fence patterns
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "").trim();

  // Find the first '{' and the matching last '}'
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    throw new Error(`No JSON object found in response (length: ${raw.length})`);
  }

  const jsonStr = cleaned.slice(firstBrace, lastBrace + 1);
  try {
    return JSON.parse(jsonStr) as GeneratedFds;
  } catch (err) {
    const preview = jsonStr.slice(0, 200);
    throw new Error(`Failed to parse FDS JSON: ${err instanceof Error ? err.message : "unknown"}. Preview: ${preview}`);
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useRandomFdsGenerate() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const createSpec = useCreateSpecProject();
  const updateSpec = useUpdateSpecProject();
  const deleteSpec = useDeleteSpecProject();
  const saveRegister = useSaveInstrumentRegister();
  const queryClient = useQueryClient();

  const generate = useCallback(
    async (params: RandomFdsParams): Promise<string | null> => {
      setLoading(true);
      setError(null);
      abortRef.current = new AbortController();

      let createdSpecId: string | null = null;
      try {
        const systemPrompt = buildRandomFdsPrompt(params);
        const { content } = await callNonStreaming(
          systemPrompt,
          [{ role: "user", content: `Generate a random FDS now. Remember: exactly ${params.subsystems} subsystems, ${params.assemblies} assemblies, ${params.devices} devices.` }],
          abortRef.current.signal,
          16384,
          { prompt_name: "random-fds-generate", agent_role: "design_engineer", pipeline_step: "random_fds" },
        );

        // Parse JSON — strip markdown fences and extract first JSON object
        const fds = extractAndParseJson(content);
        console.log("[random-fds] parsed response:", fds);

        // Validate counts
        const subsystemsArr = fds.subsystems ?? [];
        const totalAssemblies = subsystemsArr.reduce((sum, s) => sum + (s.assemblies?.length ?? 0), 0);
        const totalDevices = subsystemsArr.reduce(
          (sum, s) => sum + (s.assemblies ?? []).reduce((aSum, a) => aSum + (a.devices?.length ?? 0), 0),
          0,
        );

        if (subsystemsArr.length !== params.subsystems) {
          console.warn(`[random-fds] expected ${params.subsystems} subsystems, got ${subsystemsArr.length}`);
        }
        if (totalAssemblies !== params.assemblies) {
          console.warn(`[random-fds] expected ${params.assemblies} assemblies, got ${totalAssemblies}`);
        }
        if (totalDevices !== params.devices) {
          console.warn(`[random-fds] expected ${params.devices} devices, got ${totalDevices}`);
        }

        // Convert to typed structures BEFORE creating the spec — surfaces errors early
        const confirmedSubsystems: SubsystemConfig[] = subsystemsArr.map((s) => ({
          subsystem_id: s.subsystem_id ?? "",
          subsystem_name: s.subsystem_name ?? "Unnamed",
          equipment_type: (s.equipment_type ?? "Other") as EquipmentType,
          description: s.description ?? "",
          excluded: false,
          assemblies: (s.assemblies ?? []).map((a) => ({
            assembly_id: a.assembly_id ?? "",
            assembly_name: a.assembly_name ?? "Unnamed",
            description: a.description ?? "",
            devices: (a.devices ?? []).map((d) => ({
              device_id: d.device_id ?? "",
              device_name: d.device_name ?? "Unnamed",
              device_class: (d.device_class ?? "other") as DeviceClass,
              description: d.description ?? "",
              is_safety: Boolean(d.is_safety),
              io_signals: (d.io_signals ?? []).map((io) => ({
                tag: io.tag ?? "",
                signal_type: io.signal_type ?? "DI",
                io_address: io.io_address ?? "",
                description: io.description ?? "",
              })) satisfies IoSignal[],
            })) satisfies DeviceConfig[],
          })) satisfies AssemblyConfig[],
        }));

        const confirmedStates: OperatingState[] = (fds.operating_states ?? []).map((s) => ({
          state_id: s.state_id ?? "",
          state_name: s.state_name ?? "Unnamed",
          description: s.description ?? "",
          state_pattern: s.state_pattern === "sequential" ? "sequential" : "static",
        }));

        const alarmTiers: AlarmTier[] = (fds.alarm_tiers ?? []).map((t) => ({
          tier_id: t.tier_id ?? "",
          tier_name: t.tier_name ?? "Unnamed",
          description: t.description ?? "",
        }));

        // Create the spec project (only AFTER data conversion succeeded)
        const docCode = `RAND-${Date.now().toString(36).toUpperCase()}`;
        const spec = await createSpec.mutateAsync({
          project_id: params.projectId,
          doc_code: docCode,
          title: fds.title ?? "Random FDS",
          client_name: params.clientName,
          project_number: params.projectNumber,
          plc_model: fds.plc_model,
          hmi_type: fds.hmi_type,
          system_description: fds.system_description,
          safety_classification: fds.safety_classification ?? undefined,
          fault_philosophy: fds.fault_philosophy,
          design_principles: fds.design_principles ?? [],
        });
        createdSpecId = spec.id;

        // Update spec with wizard data
        await updateSpec.mutateAsync({
          id: spec.id,
          confirmed_subsystems: confirmedSubsystems,
          confirmed_states: confirmedStates,
          alarm_tiers: alarmTiers,
        });

        // Synthesize an instrument register from the generated IO signals so
        // downstream phases (wizard, authoring, editor, export) unlock.
        const tags: InstrumentTag[] = [];
        const subsystemCounts = new Map<string, { name: string; equipment: EquipmentType; count: number }>();
        for (const s of confirmedSubsystems) {
          subsystemCounts.set(s.subsystem_id, {
            name: s.subsystem_name,
            equipment: s.equipment_type,
            count: 0,
          });
          for (const a of s.assemblies) {
            for (const d of a.devices) {
              for (const io of d.io_signals) {
                const sigDir = normalizeSignalDirection(io.signal_type);
                tags.push({
                  tag: io.tag,
                  device_type: d.device_class,
                  description: io.description || d.description,
                  signal_type: io.signal_type,
                  io_address: io.io_address,
                  device_class: d.device_class,
                  signal_direction: sigDir,
                  subsystem_prefix: s.subsystem_id,
                  is_safety: d.is_safety,
                  subsystem: s.subsystem_name,
                });
                const entry = subsystemCounts.get(s.subsystem_id);
                if (entry) entry.count += 1;
              }
            }
          }
        }
        const subsystemSummaries: SubsystemSummary[] = Array.from(subsystemCounts.entries()).map(
          ([id, v]) => ({
            subsystem_id: id,
            subsystem_name: v.name,
            equipment_type: v.equipment,
            tag_count: v.count,
          }),
        );

        const register = await saveRegister.mutateAsync({
          spec_project_id: spec.id,
          raw_filename: `${docCode}-random-fds.synthetic`,
          tags,
          subsystems: subsystemSummaries,
          parse_warnings: [],
          haiku_usage: { input: 0, output: 0, total: 0 },
        });

        // Optionally drive all remaining phases: section generation + auto-approval.
        if (params.autoComplete) {
          params.onProgress?.("Generating FDS sections…");
          const fullSpec = {
            ...spec,
            confirmed_subsystems: confirmedSubsystems,
            confirmed_states: confirmedStates,
            alarm_tiers: alarmTiers,
            scope_exclusions: spec.scope_exclusions ?? [],
            design_principles: fds.design_principles ?? [],
          };
          await generateSpec(
            fullSpec,
            register,
            abortRef.current.signal,
            (p) => params.onProgress?.(p.phase, `${p.detail} (${p.current}/${p.total})`),
          );

          // Auto-approve all generated sections
          params.onProgress?.("Approving sections…");
          await supabase
            .from("spec_sections")
            .update({ approved: true })
            .eq("spec_project_id", spec.id);

          // Seed fds_assembly_sessions so the co-author workspace and forge handoff
          // both reflect the generated sequence content. For each assembly, copy its
          // subsystem's generated per-state step tables into sequential_states.
          params.onProgress?.("Seeding assembly sessions…");
          const { data: funcSections } = await supabase
            .from("spec_sections")
            .select("subsystem_id,state_name,content_json")
            .eq("spec_project_id", spec.id)
            .eq("section_type", "functional_description");

          // Map: subsystemId → {stateId → {permissives, steps, notes}}
          const subsystemSequences: Record<string, Record<string, { permissives: string[]; steps: unknown[]; notes: string | null }>> = {};
          // Map: subsystemId → {stateId → device_states[]} for static states
          const subsystemStatics: Record<string, Record<string, Array<{ tag: string; state: string }>>> = {};
          for (const s of funcSections ?? []) {
            if (!s.subsystem_id || !s.state_name) continue;
            const c = s.content_json as { pattern?: string; permissives?: string[]; steps?: unknown[]; notes?: string | null; device_states?: Array<{ tag: string; state: string }> };
            if (c.pattern === "sequential") {
              subsystemSequences[s.subsystem_id] ??= {};
              subsystemSequences[s.subsystem_id][s.state_name] = {
                permissives: c.permissives ?? [],
                steps: c.steps ?? [],
                notes: c.notes ?? null,
              };
            } else if (c.pattern === "static" && Array.isArray(c.device_states)) {
              subsystemStatics[s.subsystem_id] ??= {};
              subsystemStatics[s.subsystem_id][s.state_name] = c.device_states;
            }
          }

          const sessionRows: Array<Record<string, unknown>> = [];
          for (const sub of confirmedSubsystems) {
            const seq = subsystemSequences[sub.subsystem_id] ?? {};
            const staticBySubsystem = subsystemStatics[sub.subsystem_id] ?? {};
            for (const asm of sub.assemblies) {
              const asmTags = new Set<string>();
              for (const d of asm.devices) for (const io of d.io_signals) asmTags.add(io.tag);
              // Scope static states to just this assembly's tags
              const staticStates: Record<string, Array<{ tag: string; state: string }>> = {};
              for (const [stateId, entries] of Object.entries(staticBySubsystem)) {
                staticStates[stateId] = entries.filter((e) => asmTags.has(e.tag));
              }
              sessionRows.push({
                spec_project_id: spec.id,
                subsystem_id: sub.subsystem_id,
                assembly_id: asm.assembly_id,
                status: "complete",
                static_confirmed: true,
                static_states: staticStates,
                sequential_states: seq,
                conversation: [],
              });
            }
          }
          if (sessionRows.length > 0) {
            await supabase.from("fds_assembly_sessions").delete().eq("spec_project_id", spec.id);
            await supabase.from("fds_assembly_sessions").insert(sessionRows);
          }

          // Seed subsystem orchestrations: for every multi-assembly subsystem,
          // default to parallel execution ordering (assemblies run independently
          // in the sequence they're declared) with no shared permissives or
          // inter-assembly interlocks. Gives the Orchestration tab a coherent
          // starting point and provides the forge handoff a valid payload.
          const sequentialStateIds = confirmedStates
            .filter((s) => s.state_pattern === "sequential")
            .map((s) => s.state_id);
          const orchRows: Array<Record<string, unknown>> = [];
          for (const sub of confirmedSubsystems) {
            if (sub.assemblies.length <= 1) continue;
            const stateSequences: Record<string, unknown> = {};
            for (const stateId of sequentialStateIds) {
              stateSequences[stateId] = {
                assembly_order: sub.assemblies.map((a) => a.assembly_id),
                shared_permissives: [],
                inter_assembly_interlocks: [],
                notes: "Auto-seeded: assemblies run in declaration order with no inter-assembly interlocks. Refine in the Orchestration tab.",
              };
            }
            orchRows.push({
              spec_project_id: spec.id,
              subsystem_id: sub.subsystem_id,
              state_sequences: stateSequences,
              conversation: [],
              validation_results: null,
              token_usage: { input: 0, output: 0 },
            });
          }
          if (orchRows.length > 0) {
            await supabase.from("fds_subsystem_orchestrations").delete().eq("spec_project_id", spec.id);
            await supabase.from("fds_subsystem_orchestrations").insert(orchRows);
          }

          queryClient.invalidateQueries({ queryKey: ["spec_sections", spec.id] });
          queryClient.invalidateQueries({ queryKey: ["fds_assembly_sessions", spec.id] });
          queryClient.invalidateQueries({ queryKey: ["fds_subsystem_orchestrations", spec.id] });
        }

        // Force a synchronous refetch of the list queries before returning,
        // so the caller sees the fully-populated spec (not a stale create-only snapshot).
        await queryClient.refetchQueries({
          queryKey: ["spec_projects", "by_project", params.projectId],
        });

        return spec.id;
      } catch (err) {
        if (abortRef.current?.signal.aborted) return null;
        const msg = err instanceof Error ? err.message : "Generation failed";
        console.error("[random-fds] generation failed:", err);
        setError(msg);
        // Clean up orphaned spec if we created one before failing
        if (createdSpecId) {
          try {
            await deleteSpec.mutateAsync({ id: createdSpecId, projectId: params.projectId });
          } catch (cleanupErr) {
            console.error("[random-fds] failed to clean up orphaned spec:", cleanupErr);
          }
        }
        return null;
      } finally {
        setLoading(false);
        abortRef.current = null;
      }
    },
    [createSpec, updateSpec, deleteSpec, saveRegister, queryClient],
  );

  const cancel = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { generate, loading, error, cancel };
}
