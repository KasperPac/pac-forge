/**
 * Spec generation orchestrator — runs all section generators in sequence/parallel,
 * then a single Opus gap audit pass.
 */
import { callNonStreaming } from "@/hooks/use-generation";
import type { PromptLayerMeta } from "@/hooks/use-generation";
import { supabase } from "@/lib/supabase";
import {
  // V1 prompts (kept for equipment preamble reuse)
  buildEquipmentDescriptionPrompt,
  buildGapAuditPrompt,
  // V2 prompts
  buildDocumentControlPrompt,
  buildSystemOverviewPrompt,
  buildControlPhilosophyPrompt,
  buildDeviceStateTablePrompt,
  buildStepTablePrompt,
  buildIoListPrompt,
  buildAlarmSpecificationPrompt,
  buildHmiSpecificationPrompt,
  buildTestingFatPrompt,
} from "./section-prompts";
import type {
  SpecProject,
  InstrumentRegister,
  InstrumentTag,
  SpecSection,
  UnitConfig,
  TokenUsage,
  IoSummaryRow,
} from "@/types/spec-builder";
import { migrateOperatingStates } from "@/types/spec-builder";
import { composeFdsToSections } from "./fds-compose";
import type { OperationSession, UnitProcedure } from "@/types/spec-builder";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GenerationProgress {
  phase: string;
  current: number;
  total: number;
  detail?: string;
}

export interface GenerationResult {
  sections: SpecSection[];
  totalUsage: TokenUsage;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Concurrency limiter
// ---------------------------------------------------------------------------

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = [];
  let idx = 0;

  async function runNext(): Promise<void> {
    while (idx < tasks.length) {
      const i = idx++;
      try {
        const value = await tasks[i]();
        results[i] = { status: "fulfilled", value };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => runNext());
  await Promise.all(workers);
  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function extractSectionJson(raw: string): string {
  let cleaned = raw.trim();
  // Strip ```json ... ``` or ``` ... ``` fences
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```\s*$/, "").trim();
  // If there's prose before/after, find the outermost JSON object/array
  const firstObj = cleaned.indexOf("{");
  const firstArr = cleaned.indexOf("[");
  const lastObj = cleaned.lastIndexOf("}");
  const lastArr = cleaned.lastIndexOf("]");
  const start = (firstObj === -1 ? Infinity : firstObj) < (firstArr === -1 ? Infinity : firstArr) ? firstObj : firstArr;
  const end = Math.max(lastObj, lastArr);
  if (start !== -1 && start !== Infinity && end > start) {
    cleaned = cleaned.slice(start, end + 1);
  }
  return cleaned;
}

async function callSonnet(
  systemPrompt: string,
  userMessage: string,
  signal: AbortSignal,
  promptName: string,
): Promise<{ content: string; usage: TokenUsage }> {
  const plMeta: PromptLayerMeta = {
    prompt_name: promptName,
    agent_role: "spec_generator",
    model: "claude-sonnet-4-6",
  };
  const result = await callNonStreaming(
    systemPrompt,
    [{ role: "user" as const, content: userMessage }],
    signal,
    8192,
    plMeta,
  );
  return {
    content: extractSectionJson(result.content),
    usage: { input: result.usage?.input ?? 0, output: result.usage?.output ?? 0 },
  };
}

async function callOpus(
  systemPrompt: string,
  userMessage: string,
  signal: AbortSignal,
  promptName: string,
): Promise<{ content: string; usage: TokenUsage }> {
  const plMeta: PromptLayerMeta = {
    prompt_name: promptName,
    agent_role: "spec_auditor",
    model: "claude-opus-4-6",
  };
  const result = await callNonStreaming(
    systemPrompt,
    [{ role: "user" as const, content: userMessage }],
    signal,
    16384,
    plMeta,
  );
  return {
    content: extractSectionJson(result.content),
    usage: { input: result.usage?.input ?? 0, output: result.usage?.output ?? 0 },
  };
}

function addUsage(total: TokenUsage, add: TokenUsage): void {
  total.input = (total.input ?? 0) + (add.input ?? 0);
  total.output = (total.output ?? 0) + (add.output ?? 0);
  total.total = (total.input ?? 0) + (total.output ?? 0);
}

interface SaveSectionV2Opts {
  unitId?: string;
  stateName?: string;
  /** V2 — equipment_module uuid (required for equipment_module_state granularity) */
  equipment_moduleId?: string;
  /** V2 — canonical state identifier */
  stateId?: string;
  /** V2 — static vs sequential */
  statePattern?: "static" | "sequential" | null;
  /** V2 — row granularity */
  granularity?: "equipment_module_state" | "unit" | "project";
}

async function saveSection(
  specProjectId: string,
  sectionType: SpecSection["section_type"],
  contentJson: Record<string, unknown>,
  modelUsed: string,
  prompt: string,
  usage: TokenUsage,
  v2OrUnit?: SaveSectionV2Opts | string,
  stateNameLegacy?: string,
): Promise<SpecSection> {
  // Back-compat: legacy signature (unitId, stateName) still supported.
  let opts: SaveSectionV2Opts;
  if (typeof v2OrUnit === "string" || v2OrUnit === undefined) {
    opts = { unitId: v2OrUnit, stateName: stateNameLegacy };
  } else {
    opts = v2OrUnit;
  }

  const inferredGranularity: SaveSectionV2Opts["granularity"] = opts.granularity ??
    (opts.equipment_moduleId || opts.stateId
      ? "equipment_module_state"
      : opts.unitId
        ? "unit"
        : "project");

  const { data, error } = await supabase
    .from("spec_sections")
    .insert({
      spec_project_id: specProjectId,
      section_type: sectionType,
      unit_id: opts.unitId ?? null,
      state_name: opts.stateName ?? null,
      // V2 additive columns — safe to write even when null.
      equipment_module_id: opts.equipment_moduleId ?? null,
      state_id: opts.stateId ?? null,
      state_pattern: opts.statePattern ?? null,
      granularity: inferredGranularity,
      content_json: contentJson,
      model_used: modelUsed,
      generation_prompt: prompt,
      token_usage: usage,
    })
    .select()
    .single();
  if (error) throw error;
  return data as SpecSection;
}

function getTagsForUnit(register: InstrumentRegister, sub: UnitConfig): InstrumentTag[] {
  // Build set of all tag names referenced in this unit's device hierarchy
  const tagNames = new Set<string>();
  for (const asm of sub.equipment_modules) {
    for (const dev of asm.control_modules) {
      for (const sig of dev.io_signals) {
        tagNames.add(sig.tag);
      }
    }
  }
  // If hierarchy has tags, use them; otherwise fall back to unit field match
  if (tagNames.size > 0) {
    return register.tags.filter((t) => tagNames.has(t.tag));
  }
  return register.tags.filter((t) => t.unit === sub.unit_id);
}

/** Compute IO summary table deterministically from register data */
function computeIoSummary(
  units: UnitConfig[],
  register: InstrumentRegister,
): IoSummaryRow[] {
  return units
    .filter((s) => !s.excluded)
    .map((sub) => {
      const tags = getTagsForUnit(register, sub);
      return {
        unit_id: sub.unit_id,
        unit_name: sub.unit_name,
        di_count: tags.filter((t) => t.signal_direction === "DI").length,
        do_count: tags.filter((t) => t.signal_direction === "DO").length,
        ai_count: tags.filter((t) => t.signal_direction === "AI").length,
        ao_count: tags.filter((t) => t.signal_direction === "AO").length,
      };
    });
}

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

export async function generateSpec(
  spec: SpecProject,
  register: InstrumentRegister,
  signal: AbortSignal,
  onProgress: (p: GenerationProgress) => void,
): Promise<GenerationResult> {
  const totalUsage: TokenUsage = { input: 0, output: 0, total: 0 };
  const errors: string[] = [];
  const sections: SpecSection[] = [];
  const activeUnits = spec.confirmed_units.filter((s) => !s.excluded);
  const states = migrateOperatingStates(spec.confirmed_states);
  const staticStates = states.filter((s) => s.state_pattern === "static");
  const sequentialStates = states.filter((s) => s.state_pattern === "sequential");
  const hasHmi = !!(spec.hmi_type && spec.hmi_type !== "None");

  // Clear existing sections for this project
  await supabase
    .from("spec_sections")
    .delete()
    .eq("spec_project_id", spec.id);

  // Update status to generating
  await supabase
    .from("spec_projects")
    .update({ status: "generating" })
    .eq("id", spec.id);

  // Total steps:
  //   Section 0 (doc control) + Section 1 (system overview) + Section 2 (control philosophy)
  //   + per unit: 1 (equipment) + 1 (batched static states) + N (sequential states)
  //   + Section 4 (IO list) + Section 5 (alarm spec) + Section 6 (HMI, conditional)
  //   + Section 8 (testing) + audit
  const unitSteps = activeUnits.length * (1 + 1 + sequentialStates.length);
  const totalSteps = 3 + unitSteps + 1 + 1 + (hasHmi ? 1 : 0) + 1 + 1;
  let completedSteps = 0;

  const reportProgress = (detail: string) => {
    completedSteps++;
    onProgress({ phase: "Generating", current: completedSteps, total: totalSteps, detail });
  };

  try {
    // -----------------------------------------------------------------------
    // Section 0 — Document Control
    // -----------------------------------------------------------------------
    onProgress({ phase: "Generating", current: 0, total: totalSteps, detail: "Section 0: Document Control" });
    try {
      const prompt = buildDocumentControlPrompt(
        spec.title,
        spec.doc_code,
        spec.revision,
        spec.client_name ?? "",
        activeUnits,
      );
      const result = await callSonnet(prompt, "Generate the document control section.", signal, "spec_document_control");
      const parsed = JSON.parse(result.content);
      const section = await saveSection(spec.id, "document_control", parsed, "claude-sonnet-4-6", prompt, result.usage);
      sections.push(section);
      addUsage(totalUsage, result.usage);
      reportProgress("Section 0: Document Control");
    } catch (err) {
      errors.push(`Document Control: ${err instanceof Error ? err.message : "Failed"}`);
      reportProgress("Section 0: Document Control (failed)");
    }

    // -----------------------------------------------------------------------
    // Section 1 — System Overview
    // -----------------------------------------------------------------------
    onProgress({ phase: "Generating", current: completedSteps, total: totalSteps, detail: "Section 1: System Overview" });
    try {
      const prompt = buildSystemOverviewPrompt(
        spec.title,
        spec.plc_model ?? "",
        spec.hmi_type ?? "",
        spec.comms_protocol ?? "",
        activeUnits,
        spec.scope_exclusions ?? [],
        spec.safety_classification ?? null,
      );
      const result = await callSonnet(prompt, "Generate the system overview section.", signal, "spec_system_overview");
      const parsed = JSON.parse(result.content);
      // Inject deterministically computed IO summary
      parsed.io_summary = computeIoSummary(activeUnits, register);
      // Inject full System → Unit → Equipment Module → Device hierarchy deterministically
      parsed.machine_hierarchy = activeUnits.map((s) => ({
        unit_id: s.unit_id,
        unit_name: s.unit_name,
        equipment_type: s.equipment_type,
        description: s.description,
        equipment_modules: s.equipment_modules.map((a) => ({
          equipment_module_id: a.equipment_module_id,
          equipment_module_name: a.equipment_module_name,
          description: a.description,
          control_modules: a.control_modules.map((d) => ({
            control_module_id: d.control_module_id,
            control_module_name: d.control_module_name,
            control_module_class: d.control_module_class,
            is_safety: d.is_safety,
            description: d.description,
            signal_count: d.io_signals.length,
            signals: d.io_signals.map((io) => ({
              tag: io.tag,
              signal_type: io.signal_type,
              io_address: io.io_address,
            })),
          })),
        })),
      }));
      const section = await saveSection(spec.id, "system_overview", parsed, "claude-sonnet-4-6", prompt, result.usage);
      sections.push(section);
      addUsage(totalUsage, result.usage);
      reportProgress("Section 1: System Overview");
    } catch (err) {
      errors.push(`System Overview: ${err instanceof Error ? err.message : "Failed"}`);
      reportProgress("Section 1: System Overview (failed)");
    }

    // -----------------------------------------------------------------------
    // Section 2 — Control Philosophy
    // -----------------------------------------------------------------------
    onProgress({ phase: "Generating", current: completedSteps, total: totalSteps, detail: "Section 2: Control Philosophy" });
    try {
      const prompt = buildControlPhilosophyPrompt(
        activeUnits,
        states,
        spec.alarm_tiers,
        spec.fault_philosophy ?? null,
        spec.design_principles ?? [],
      );
      const result = await callSonnet(prompt, "Generate the control philosophy section.", signal, "spec_control_philosophy");
      const parsed = JSON.parse(result.content);
      const section = await saveSection(spec.id, "control_philosophy", parsed, "claude-sonnet-4-6", prompt, result.usage);
      sections.push(section);
      addUsage(totalUsage, result.usage);
      reportProgress("Section 2: Control Philosophy");
    } catch (err) {
      errors.push(`Control Philosophy: ${err instanceof Error ? err.message : "Failed"}`);
      reportProgress("Section 2: Control Philosophy (failed)");
    }

    // -----------------------------------------------------------------------
    // Section 3 — Functional Descriptions (parallel per unit)
    // -----------------------------------------------------------------------
    const equipmentResults: Record<string, Array<{ device: string; tag: string; description: string }>> = {};

    const unitTasks = activeUnits.map((sub) => async () => {
      const tags = getTagsForUnit(register, sub);

      // Check for co-authored data — skip AI generation if equipment_modules are co-authored
      const { data: coAuthoredSessions } = await supabase
        .from("fds_operation_sessions")
        .select("*")
        .eq("spec_project_id", spec.id)
        .eq("unit_id", sub.unit_id)
        .eq("status", "complete");

      if (coAuthoredSessions && coAuthoredSessions.length > 0) {
        // Fetch orchestration if exists
        const { data: orchData } = await supabase
          .from("fds_unit_procedures")
          .select("*")
          .eq("spec_project_id", spec.id)
          .eq("unit_id", sub.unit_id)
          .maybeSingle();

        try {
          await composeFdsToSections(
            spec.id, sub,
            coAuthoredSessions as OperationSession[],
            orchData as UnitProcedure | null,
            states,
          );
          // Still generate equipment preamble via AI (prose + device table)
          const eqPrompt = buildEquipmentDescriptionPrompt(sub, tags);
          const eqResult = await callSonnet(eqPrompt, "Generate the equipment description section.", signal, "spec_equipment_desc");
          const eqParsed = JSON.parse(eqResult.content);
          await saveSection(spec.id, "equipment_description", eqParsed, "claude-sonnet-4-6", eqPrompt, eqResult.usage, sub.unit_id);
          reportProgress(`Section 3: ${sub.unit_name} — Co-authored + Equipment`);
        } catch (err) {
          errors.push(`${sub.unit_name} compose: ${err instanceof Error ? err.message : "Failed"}`);
          reportProgress(`Section 3: ${sub.unit_name} — Compose failed`);
        }
        return; // Skip AI generation for this unit
      }

      // 3a — Equipment preamble (prose + device instrumentation table)
      try {
        const eqPrompt = buildEquipmentDescriptionPrompt(sub, tags);
        const eqResult = await callSonnet(eqPrompt, "Generate the equipment description section.", signal, "spec_equipment_desc");
        const eqParsed = JSON.parse(eqResult.content);
        const eqSection = await saveSection(spec.id, "equipment_description", eqParsed, "claude-sonnet-4-6", eqPrompt, eqResult.usage, sub.unit_id);
        sections.push(eqSection);
        addUsage(totalUsage, eqResult.usage);
        equipmentResults[sub.unit_id] = eqParsed.control_module_table ?? [];
        reportProgress(`Section 3: ${sub.unit_name} — Equipment`);
      } catch (err) {
        errors.push(`Equipment ${sub.unit_name}: ${err instanceof Error ? err.message : "Failed"}`);
        equipmentResults[sub.unit_id] = tags.map((t) => ({
          device: `${t.tag} (${t.device_type})`,
          tag: t.tag,
          description: t.description,
        }));
        reportProgress(`Section 3: ${sub.unit_name} — Equipment (failed)`);
      }

      // 3b — Pattern A: Batched device state tables for all static states
      if (staticStates.length > 0) {
        try {
          const deviceTable = equipmentResults[sub.unit_id] ?? [];
          const prompt = buildDeviceStateTablePrompt(sub, staticStates, tags, deviceTable);
          const result = await callSonnet(prompt, "Generate device state tables.", signal, "spec_device_state_table");
          const parsed = JSON.parse(result.content);
          // Save one section per (equipment_module, static state). The prompt emits a
          // unit-level table; fan it out across equipment_modules deterministically
          // so V2's per-(equipment_module, state) row shape is honoured. Equipment-module-specific
          // refinement is delegated to later ingest/co-author passes.
          const statesData = parsed.states as Record<string, Array<{ tag: string; description: string; state: string }>>;
          const equipment_moduleTagSets = sub.equipment_modules.map((asm) => {
            const names = new Set<string>();
            for (const dev of asm.control_modules) for (const sig of dev.io_signals) names.add(sig.tag);
            return { equipment_module_id: asm.equipment_module_id, tags: names };
          });
          for (const st of staticStates) {
            const deviceStates = statesData[st.state_name] ?? [];
            for (const asm of equipment_moduleTagSets) {
              const scoped = deviceStates.filter((e) => asm.tags.has(e.tag));
              const content = {
                pattern: "static" as const,
                control_module_states: scoped,
              };
              const stateSection = await saveSection(
                spec.id, "functional_description", content, "claude-sonnet-4-6",
                prompt, { input: 0, output: 0 },
                {
                  unitId: sub.unit_id,
                  stateName: st.state_id,
                  equipment_moduleId: asm.equipment_module_id,
                  stateId: st.state_id,
                  statePattern: "static",
                  granularity: "equipment_module_state",
                },
              );
              sections.push(stateSection);
            }
          }
          addUsage(totalUsage, result.usage);
          reportProgress(`Section 3: ${sub.unit_name} — Static states`);
        } catch (err) {
          errors.push(`${sub.unit_name} static states: ${err instanceof Error ? err.message : "Failed"}`);
          reportProgress(`Section 3: ${sub.unit_name} — Static states (failed)`);
        }
      }

      // 3c — Pattern B: Individual step tables for each sequential state
      for (const state of sequentialStates) {
        try {
          const deviceTable = equipmentResults[sub.unit_id] ?? [];
          const prompt = buildStepTablePrompt(sub, state, tags, deviceTable);
          const result = await callSonnet(prompt, "Generate step table.", signal, "spec_step_table");
          const parsed = JSON.parse(result.content);
          const content = {
            pattern: "sequential" as const,
            permissives: parsed.permissives ?? [],
            steps: parsed.steps ?? [],
            notes: parsed.notes ?? null,
          };
          // Fan out the unit-level step table across equipment_modules. Each
          // equipment_module gets the same steps until later passes refine per-equipment_module
          // ownership. This keeps V2's (equipment_module_id, state_id) key honoured.
          for (const asm of sub.equipment_modules) {
            const stateSection = await saveSection(
              spec.id, "functional_description", content, "claude-sonnet-4-6",
              prompt, result.usage,
              {
                unitId: sub.unit_id,
                stateName: state.state_id,
                equipment_moduleId: asm.equipment_module_id,
                stateId: state.state_id,
                statePattern: "sequential",
                granularity: "equipment_module_state",
              },
            );
            sections.push(stateSection);
          }
          addUsage(totalUsage, result.usage);
          reportProgress(`Section 3: ${sub.unit_name} — ${state.state_name}`);
        } catch (err) {
          errors.push(`${sub.unit_name}/${state.state_name}: ${err instanceof Error ? err.message : "Failed"}`);
          reportProgress(`Section 3: ${sub.unit_name} — ${state.state_name} (failed)`);
        }
      }
    });

    await runWithConcurrency(unitTasks, 3);

    // -----------------------------------------------------------------------
    // Section 4 — I/O List
    // -----------------------------------------------------------------------
    onProgress({ phase: "Generating", current: completedSteps, total: totalSteps, detail: "Section 4: I/O List" });
    try {
      const prompt = buildIoListPrompt(register.tags);
      const result = await callSonnet(prompt, "Generate the I/O list.", signal, "spec_io_list");
      const parsed = JSON.parse(result.content);
      const section = await saveSection(spec.id, "io_list", parsed, "claude-sonnet-4-6", prompt, result.usage);
      sections.push(section);
      addUsage(totalUsage, result.usage);
      reportProgress("Section 4: I/O List");
    } catch (err) {
      errors.push(`I/O List: ${err instanceof Error ? err.message : "Failed"}`);
      reportProgress("Section 4: I/O List (failed)");
    }

    // -----------------------------------------------------------------------
    // Section 5 — Alarm Specification
    // -----------------------------------------------------------------------
    onProgress({ phase: "Generating", current: completedSteps, total: totalSteps, detail: "Section 5: Alarm Specification" });
    try {
      const tagsByUnit: Record<string, InstrumentTag[]> = {};
      for (const sub of activeUnits) {
        tagsByUnit[sub.unit_id] = getTagsForUnit(register, sub);
      }
      const prompt = buildAlarmSpecificationPrompt(activeUnits, tagsByUnit, spec.alarm_tiers);
      const result = await callSonnet(prompt, "Generate the alarm specification.", signal, "spec_alarm_specification");
      const parsed = JSON.parse(result.content);
      const section = await saveSection(spec.id, "alarm_specification", parsed, "claude-sonnet-4-6", prompt, result.usage);
      sections.push(section);
      addUsage(totalUsage, result.usage);
      reportProgress("Section 5: Alarm Specification");
    } catch (err) {
      errors.push(`Alarm Specification: ${err instanceof Error ? err.message : "Failed"}`);
      reportProgress("Section 5: Alarm Specification (failed)");
    }

    // -----------------------------------------------------------------------
    // Section 6 — HMI Specification (conditional)
    // -----------------------------------------------------------------------
    if (hasHmi) {
      onProgress({ phase: "Generating", current: completedSteps, total: totalSteps, detail: "Section 6: HMI Specification" });
      try {
        const prompt = buildHmiSpecificationPrompt(spec.hmi_type!, activeUnits, register.tags);
        const result = await callSonnet(prompt, "Generate the HMI specification.", signal, "spec_hmi_specification");
        const parsed = JSON.parse(result.content);
        const section = await saveSection(spec.id, "hmi_specification", parsed, "claude-sonnet-4-6", prompt, result.usage);
        sections.push(section);
        addUsage(totalUsage, result.usage);
        reportProgress("Section 6: HMI Specification");
      } catch (err) {
        errors.push(`HMI Specification: ${err instanceof Error ? err.message : "Failed"}`);
        reportProgress("Section 6: HMI Specification (failed)");
      }
    }

    // -----------------------------------------------------------------------
    // Section 7 — Interfaces (placeholder — no AI call)
    // -----------------------------------------------------------------------
    try {
      const section = await saveSection(
        spec.id, "interfaces",
        { placeholder: true, note: "Reserved for future interface specifications. To be completed when third-party system integration requirements are defined." },
        "none", "", { input: 0, output: 0 },
      );
      sections.push(section);
    } catch (err) {
      errors.push(`Interfaces: ${err instanceof Error ? err.message : "Failed"}`);
    }

    // -----------------------------------------------------------------------
    // Section 8 — Testing / FAT
    // -----------------------------------------------------------------------
    onProgress({ phase: "Generating", current: completedSteps, total: totalSteps, detail: "Section 8: Testing / FAT" });
    try {
      const prompt = buildTestingFatPrompt(activeUnits, states, spec.alarm_tiers, register.tags);
      const result = await callSonnet(prompt, "Generate the FAT test procedure.", signal, "spec_testing_fat");
      const parsed = JSON.parse(result.content);
      const section = await saveSection(spec.id, "testing_fat", parsed, "claude-sonnet-4-6", prompt, result.usage);
      sections.push(section);
      addUsage(totalUsage, result.usage);
      reportProgress("Section 8: Testing / FAT");
    } catch (err) {
      errors.push(`Testing/FAT: ${err instanceof Error ? err.message : "Failed"}`);
      reportProgress("Section 8: Testing / FAT (failed)");
    }

    // -----------------------------------------------------------------------
    // Gap Audit (Opus)
    // -----------------------------------------------------------------------
    onProgress({ phase: "Auditing", current: completedSteps, total: totalSteps, detail: "Gap audit (Opus)" });
    try {
      // Build markdown summary of all generated sections
      const markdownParts: string[] = [];
      for (const s of sections) {
        const json = s.content_json as Record<string, unknown>;
        if (s.section_type === "document_control") {
          markdownParts.push(`# Section 0 — Document Control\n${JSON.stringify(json, null, 2)}`);
        } else if (s.section_type === "system_overview") {
          markdownParts.push(`# Section 1 — System Overview\n${json.hardware_description}\nIO Summary: ${JSON.stringify(json.io_summary)}\nExclusions: ${json.scope_exclusions}`);
        } else if (s.section_type === "control_philosophy") {
          markdownParts.push(`# Section 2 — Control Philosophy\nTransitions: ${json.mode_transitions}\nFault Philosophy: ${json.fault_philosophy}`);
        } else if (s.section_type === "equipment_description") {
          markdownParts.push(`## Section 3 — Equipment: ${s.unit_id}\n${json.prose}\n`);
          const table = json.control_module_table as Array<Record<string, string>> | undefined;
          if (table) {
            markdownParts.push("| Device | Tag | Description |\n|---|---|---|");
            for (const row of table) {
              markdownParts.push(`| ${row.device} | ${row.tag} | ${row.description} |`);
            }
          }
        } else if (s.section_type === "functional_description") {
          const pattern = json.pattern as string;
          if (pattern === "static") {
            markdownParts.push(`### ${s.unit_id} — ${s.state_name} (Device State Table)\n${JSON.stringify(json.control_module_states, null, 2)}`);
          } else {
            markdownParts.push(`### ${s.unit_id} — ${s.state_name} (Step Table)\nPermissives: ${JSON.stringify(json.permissives)}\nSteps: ${JSON.stringify(json.steps, null, 2)}`);
          }
        } else if (s.section_type === "alarm_specification") {
          markdownParts.push(`# Section 5 — Alarms\n${JSON.stringify(json.alarm_tiers, null, 2)}\nCause & Effect: ${JSON.stringify(json.cause_effect_matrix, null, 2)}`);
        } else if (s.section_type === "io_list") {
          markdownParts.push(`# Section 4 — I/O List\n${JSON.stringify(json.io_entries, null, 2)}`);
        } else if (s.section_type === "hmi_specification") {
          markdownParts.push(`# Section 6 — HMI\n${JSON.stringify(json, null, 2)}`);
        } else if (s.section_type === "testing_fat") {
          markdownParts.push(`# Section 8 — Testing\n${JSON.stringify(json.test_procedures, null, 2)}`);
        }
        // Legacy types for backward compat
        else if (s.section_type === "introduction") {
          markdownParts.push(`# Introduction\n${json.overview}\n\n${json.brief_description}`);
        } else if (s.section_type === "functional_state") {
          markdownParts.push(`### ${s.unit_id} — ${s.state_name}\n${json.state_narrative}`);
        } else if (s.section_type === "alarm_table") {
          markdownParts.push(`## Alarms\n${JSON.stringify(json.alarm_tiers, null, 2)}`);
        } else if (s.section_type === "settings_table") {
          markdownParts.push(`## Settings\n${JSON.stringify(json.units, null, 2)}`);
        }
      }
      const fullMarkdown = markdownParts.join("\n\n");

      const auditPrompt = buildGapAuditPrompt(register.tags, fullMarkdown);
      const auditResult = await callOpus(auditPrompt, "Run the gap audit.", signal, "spec_gap_audit");
      const auditParsed = JSON.parse(auditResult.content);
      const auditSection = await saveSection(spec.id, "audit_report", auditParsed, "claude-opus-4-6", auditPrompt, auditResult.usage);
      sections.push(auditSection);
      addUsage(totalUsage, auditResult.usage);
      reportProgress("Gap audit");
    } catch (err) {
      errors.push(`Gap audit: ${err instanceof Error ? err.message : "Failed"}`);
      reportProgress("Gap audit (failed)");
    }

    // Update status to review + flip schema_version to 2 (one-way) now that a
    // V2-shape write pass has completed. Guard on existing value so we never
    // downgrade or re-flip an already-V2 project.
    const { data: currentRow } = await supabase
      .from("spec_projects")
      .select("schema_version")
      .eq("id", spec.id)
      .single();
    const currentVersion = Number(
      (currentRow as { schema_version?: number } | null)?.schema_version ?? 1,
    );
    const projectUpdate: Record<string, unknown> = { status: "review" };
    if (currentVersion < 2) projectUpdate.schema_version = 2;
    await supabase
      .from("spec_projects")
      .update(projectUpdate)
      .eq("id", spec.id);

  } catch (err) {
    // Fatal error — reset status
    await supabase
      .from("spec_projects")
      .update({ status: "draft" })
      .eq("id", spec.id);
    throw err;
  }

  return { sections, totalUsage, errors };
}
