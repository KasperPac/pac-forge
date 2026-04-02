import type { Project, Agent, IoEntry, TagDbDefinition, GenerationMode, PatternCandidate, FbTemplate, DesignProfile, AgentKnowledgeDoc, ReferenceLibrarySection, RackSlotLayout, Instruction } from "@/types";
import { INSTRUCTION_CATEGORIES } from "@/types/instruction";
import type { InstructionCategory } from "@/types/instruction";
import type { FolderRulesSchema, GeneralRulesSchema, FbRulesSchema, ProcessRulesSchema, StructuredRule } from "@/types/design-profile";
import { parseGeneralRules, parseFbRules, parseProcessRules } from "@/lib/design-profile-schemas";
import { resolveSection, interpolateAgent } from "@/lib/prompt-defaults";
import { getAgentProfile } from "@/lib/agent-profiles";
import { formatReferenceSections } from "@/lib/reference-lookup";
import { buildPriorityHierarchyBlock } from "@/lib/knowledge-priority";

/**
 * Output format instructions telling Claude how to structure its response
 * so the artifact parser can extract individual blocks.
 */
const OUTPUT_FORMAT = `## Output Format

You MUST output each artifact as a separate delimited block using this format:

\`\`\`scl filename="<BlockName>.scl" type="<ARTIFACT_TYPE>" name="<BlockName>" folder="<destination>" dependencies="<comma-separated names>"
<SCL code content>
\`\`\`

Where:
- filename: the block name with .scl extension (e.g., "typeMotorConfig.scl", "ControlMotor.scl", "InstMotor1.scl", "Main.scl")
- type: one of UDT, FB, FC, DB, OB
- name: the block name matching the SCL declaration (e.g., "typeMotorConfig", "ControlMotor", "InstMotor1", "Main")
- folder: TIA Portal destination folder (e.g., "Program blocks/Pac-ST/Devices"). Omit to use defaults.
- dependencies: comma-separated list of artifact names this block depends on (empty if none)

### Default Folder Structure
| Type | Default Folder |
|------|---------------|
| UDT | Types |
| FB, FC, DB | Program blocks/Pac-ST |
| OB | Program blocks |

If the Design Profile specifies a folder structure, use those paths in the folder attribute. Otherwise omit folder to use defaults.

After all artifact blocks, provide a brief summary of what was generated.

### Naming (MUST match platform rules)
- UDTs: \`type\` prefix, lowerCamelCase (e.g., typeMotorConfig, typeZoneIO)
- FBs: Verb-first UpperCamelCase (e.g., ControlMotor, MonitorConveyor)
- FCs: Verb-first UpperCamelCase (e.g., ScaleAnalog, CalcChecksum)
- Instance DBs: \`Inst\` prefix, UpperCamelCase (e.g., InstMotor1, InstConveyor1)
- Global DBs: UpperCamelCase, no prefix (e.g., Configuration, HmiData)
- OB1: Always named "Main"

### MANDATORY Artifact Checklist — Generate ALL of These

Before responding, verify your output includes EVERY required artifact in this exact order:

1. **UDTs** — One per reusable data structure (config, IO, diagnostics)
2. **Device FBs** — One per device type (motors, valves, conveyors, sensors). Each handles its own state machine, timers, alarms.
3. **Instance DBs** — **ONE per Device FB instance** (this is the #1 missed artifact)
4. **Process FC** — **ALWAYS generate this.** A stateless Function that orchestrates all Device FB calls. It receives IO as inputs/outputs, calls each Device FB via its instance DB, and wires device outputs to process logic. This is the central coordination layer.
5. **OB1 "Main"** — **ALWAYS generate this.** It calls the Process FC. Main should be minimal — just the FC call.
6. **Global DBs** — For configuration data, HMI interface, recipes if needed
7. **Utility FCs** — For stateless helper functions (scaling, clamping, conversion) if needed

**Program hierarchy (CRITICAL):**
- Main (OB1) calls the Process FC
- The Process FC calls Device FBs via their instance DBs
- Device FBs do NOT call each other — the Process FC wires data between them
- Main does NOT call Device FBs directly

**If you generate a Device FB, you MUST also generate:**
- An instance DB for it (type=DB, references the FB)
- A call to it in the Process FC (NOT in Main)

### Multi-Instance FB Wiring

When an FB contains multi-instance FBs (e.g., sensor FBs, edge triggers, timers), wire higher-level logic directly to the multi-instance outputs. Do NOT create redundant intermediate variables that just copy multi-instance outputs. For example, if you have #instStartSensor as a multi-instance FB with an output Q, use #instStartSensor.Q directly in your logic instead of creating a separate #startSensorActive variable to hold the same value.

### FB Body Structure
Each FB must follow this section structure:
1. VAR_INPUT / VAR_OUTPUT / VAR_IN_OUT declarations
2. VAR (static) declarations including state variables, timers, edge triggers (inst prefix)
3. VAR_TEMP for intermediate calculations (temp prefix)
4. Code body with clearly separated REGION blocks:
   - REGION IO Mapping
   - REGION State Machine (CASE-based with integer literal labels + ELSE)
   - REGION Alarm/Fault Handling
   - REGION Output Mapping`;

interface PromptBuilderInput {
  project: Project;
  agents: Agent[];
  generationMode: GenerationMode;
  approvedPatterns?: PatternCandidate[];
  fbTemplates?: FbTemplate[];
  designProfile?: DesignProfile;
  agentKnowledgeDocs?: Record<string, AgentKnowledgeDoc[]>;
  promptSections?: Record<string, string>;
  referenceSections?: ReferenceLibrarySection[];
  userMessage: string;
  conversationHistory?: Array<{ role: "user" | "assistant"; content: string }>;
}

interface BuiltPrompt {
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

export function formatIoList(ioList: IoEntry[]): string {
  if (ioList.length === 0) return "No IO entries defined.";
  const header = "| Address | Tag Name | Data Type | Description | Module | Slot |";
  const separator = "|---------|----------|-----------|-------------|--------|------|";
  const rows = ioList.map(
    (io) => `| ${io.address} | ${io.tag_name} | ${io.data_type} | ${io.description} | ${io.module} | ${io.slot} |`
  );
  return [header, separator, ...rows].join("\n");
}

function formatTagDbs(tagDbs: TagDbDefinition[]): string {
  if (tagDbs.length === 0) return "No tag DB definitions.";
  return tagDbs
    .map((db) => {
      const tags = db.tags
        .map((t) => `  - ${t.name}: ${t.data_type}${t.default_value ? ` = ${t.default_value}` : ""}${t.comment ? ` // ${t.comment}` : ""}`)
        .join("\n");
      return `### ${db.name}\n${tags}`;
    })
    .join("\n\n");
}

function formatAgentRoles(
  agents: Agent[],
  knowledgeDocs?: Record<string, AgentKnowledgeDoc[]>
): string {
  if (agents.length === 0) return "No agents assigned.";
  return agents
    .map((a) => {
      const profile = getAgentProfile(a.display_name);
      const skillsList = profile.skills.map((s) => `  - ${s}`).join("\n");
      const sections = [
        `### ${a.display_name} [${a.specialties.join(", ")}]`,
        `**Role:** ${profile.tagline}`,
        `**Personality:** ${profile.description}`,
        `**Skills:**\n${skillsList}`,
      ];
      if (a.system_prompt) {
        sections.push(`**Instructions:** ${a.system_prompt}`);
      }
      // Inject agent's knowledge base documents
      const docs = knowledgeDocs?.[a.id];
      if (docs && docs.length > 0) {
        const docSections = docs.map((d) => `#### [${d.short_id}] ${d.title}\n${d.content}`);
        sections.push(`**Reference Documentation:**\n${docSections.join("\n\n")}`);
      }
      return sections.join("\n");
    })
    .join("\n\n");
}

/**
 * Format design profile rules for prompt injection.
 * @param context - Which generation context to include rules for.
 *   "general" = general + folder rules only (default, used by most paths)
 *   "process" = general + folder + process rules (used by process code generation)
 *   "fb" = general + folder + fb rules (used by FB generation, future)
 *   "all" = everything (used by PM planning)
 */
// ── Structured rule renderers ────────────────────────────────────────────────

function renderStructuredRule(rule: StructuredRule): string {
  if (!rule.enabled) return '';
  const target = rule.target === 'ALL' ? 'All blocks' : rule.target;
  const header = `RULE: ${rule.category} — ${target} ${rule.strength} ${rule.statement}.`;
  if (rule.example?.trim()) {
    return `${header}\n  Example:\n${rule.example.split('\n').map(l => `    ${l}`).join('\n')}`;
  }
  return header;
}

function renderExtraRules(rules: StructuredRule[]): string {
  if (!rules?.length) return '';
  return rules
    .filter(r => r.enabled)
    .map(renderStructuredRule)
    .filter(Boolean)
    .join('\n');
}

function renderGeneralRules(schema: GeneralRulesSchema): string {
  const lines: string[] = [];
  const n = schema.naming;
  const sm = schema.state_machine;

  if (n.fb_prefix) {
    lines.push(`RULE: Naming — FB MUST use the prefix "${n.fb_prefix}" (e.g. ${n.fb_prefix}Motor, ${n.fb_prefix}Sensor). Do NOT generate FBs without this prefix.`);
  }
  if (n.fc_prefix) {
    lines.push(`RULE: Naming — FC MUST use the prefix "${n.fc_prefix}" (e.g. ${n.fc_prefix}Motor, ${n.fc_prefix}Sensor). Do NOT generate FCs without this prefix.`);
  }
  if (n.db_prefix) {
    lines.push(`RULE: Naming — DB MUST use the prefix "${n.db_prefix}" (e.g. ${n.db_prefix}Motor, ${n.db_prefix}Sensors). Do NOT generate DBs without this prefix.`);
  }
  if (n.udt_prefix) {
    lines.push(`RULE: Naming — UDT MUST use the prefix "${n.udt_prefix}" (e.g. ${n.udt_prefix}MotorConfig, ${n.udt_prefix}SensorIO).`);
  }
  if (n.instance_db_prefix) {
    lines.push(`RULE: Naming — Instance DB MUST use the prefix "${n.instance_db_prefix}" (e.g. ${n.instance_db_prefix}Motor1, ${n.instance_db_prefix}Sensor001).`);
  }
  if (n.block_name_casing !== 'custom') {
    lines.push(`RULE: Naming — All block names MUST use ${n.block_name_casing} casing.`);
  }
  if (n.param_casing !== 'custom') {
    lines.push(`RULE: Naming — All formal parameters (VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT) MUST use ${n.param_casing} casing.`);
  }
  if (n.static_var_prefix) {
    lines.push(`RULE: Naming — Static variables MUST use the "${n.static_var_prefix}" prefix (e.g. ${n.static_var_prefix}State, ${n.static_var_prefix}AlarmLatch).`);
  }
  if (n.temp_var_prefix) {
    lines.push(`RULE: Naming — Temporary variables MUST use the "${n.temp_var_prefix}" prefix (e.g. ${n.temp_var_prefix}RunPermit, ${n.temp_var_prefix}Index).`);
  }
  if (n.instance_var_prefix) {
    lines.push(`RULE: Naming — Multi-instance variables (FBs, timers, counters, edge triggers declared in VAR) MUST use the "${n.instance_var_prefix}" prefix (e.g. ${n.instance_var_prefix}StartDelay, ${n.instance_var_prefix}RisingEdge).`);
  }
  if (n.custom_notes?.trim()) {
    lines.push(`\nAdditional naming notes:\n${n.custom_notes}`);
  }

  lines.push('');
  lines.push(`RULE: State Machine — FB MUST use CASE-based state machines with step values starting at ${sm.step_start} and incrementing by ${sm.step_increment} (e.g. ${sm.step_start}, ${sm.step_start + sm.step_increment}, ${sm.step_start + sm.step_increment * 2}...). Intermediate steps (e.g. ${sm.step_start + 1}, ${sm.step_start + 2}) MAY be used as branches between main steps.`);
  lines.push(`RULE: State Machine — FB MUST reserve step ${sm.fault_step} as the FAULT state.`);
  if (sm.always_has_else) {
    lines.push(`RULE: State Machine — ALL CASE statements MUST include an ELSE branch. ELSE action: ${sm.else_action}.`);
  }
  if (sm.custom_notes?.trim()) {
    lines.push(`\nAdditional state machine notes:\n${sm.custom_notes}`);
  }

  const extras = renderExtraRules(schema.extra_rules);
  if (extras) { lines.push(''); lines.push(extras); }

  if (schema.freetext?.trim()) {
    lines.push('');
    lines.push(`Additional general rules:\n${schema.freetext}`);
  }

  return lines.filter(l => l !== undefined).join('\n');
}

function renderFbRules(schema: FbRulesSchema): string {
  const lines: string[] = [];
  const iface = schema.interface_pattern;
  const alarm = schema.alarm_handling;

  if (iface.pattern === 'plcopen_enable') {
    lines.push('RULE: FB Interface — DEVICE_FB MUST use the PLCopen enable pattern: EN (Bool input) controls activation. MUST NOT use rising-edge execute pattern for device FBs.');
  } else if (iface.pattern === 'plcopen_execute') {
    lines.push('RULE: FB Interface — DEVICE_FB MUST use the PLCopen execute pattern: rising edge on execute input triggers one-shot command.');
  }
  if (iface.include_busy)   lines.push('RULE: FB Interface — DEVICE_FB MUST include a "busy : Bool" VAR_OUTPUT.');
  if (iface.include_done)   lines.push('RULE: FB Interface — DEVICE_FB MUST include a "done : Bool" VAR_OUTPUT.');
  if (iface.include_error)  lines.push('RULE: FB Interface — DEVICE_FB MUST include an "error : Bool" VAR_OUTPUT.');
  if (iface.include_status) {
    lines.push(`RULE: FB Interface — DEVICE_FB MUST include a "status : Word" VAR_OUTPUT with initial value ${iface.status_initial_value}.`);
  }
  if (iface.custom_notes?.trim()) {
    lines.push(`\nAdditional interface notes:\n${iface.custom_notes}`);
  }

  lines.push('');
  if (alarm.latching) {
    lines.push('RULE: Alarm Handling — FB MUST latch alarms on fault condition. Alarms MUST NOT auto-clear when the fault condition clears.');
  }
  if (alarm.reset_via_input) {
    lines.push(`RULE: Alarm Handling — FB MUST provide a "${alarm.reset_input_name} : Bool" VAR_INPUT for operator alarm reset.`);
  }
  if (alarm.custom_notes?.trim()) {
    lines.push(`\nAdditional alarm notes:\n${alarm.custom_notes}`);
  }

  const extras = renderExtraRules(schema.extra_rules);
  if (extras) { lines.push(''); lines.push(extras); }

  if (schema.freetext?.trim()) {
    lines.push('');
    lines.push(`Additional FB rules:\n${schema.freetext}`);
  }

  return lines.join('\n');
}

function renderProcessRules(schema: ProcessRulesSchema): string {
  const lines: string[] = [];
  const sad = schema.step_action_db;
  const seq = schema.sequence_structure;

  if (sad.enabled) {
    lines.push(`RULE: Process Structure — PROCESS_FC MUST use the step/action DB pattern. Each process section requires a dedicated DB named using the pattern "${sad.db_name_pattern}".`);
    lines.push(`RULE: Process Structure — PROCESS_FC MUST store step activation bits in a Bool array named "${sad.step_array_name}" (e.g. DB.${sad.step_array_name}[0], DB.${sad.step_array_name}[1]...).`);
    lines.push(`RULE: Process Structure — PROCESS_FC MUST store action activation bits in a Bool array named "${sad.action_array_name}" (e.g. DB.${sad.action_array_name}[0], DB.${sad.action_array_name}[1]...).`);
    if (sad.custom_notes?.trim()) {
      lines.push(`\nAdditional step/action DB notes:\n${sad.custom_notes}`);
    }
  }

  lines.push('');
  if (seq.safety_inline) {
    lines.push('RULE: Sequence Structure — PROCESS_FC MUST place safety interlock contacts inline within the step transition rung. MUST NOT use a separate dedicated safety network.');
  }
  if (seq.permissives_as_first_rung) {
    lines.push('RULE: Sequence Structure — PROCESS_FC MUST check all permissive preconditions in the first network before any step transitions.');
  }
  if (seq.custom_notes?.trim()) {
    lines.push(`\nAdditional sequence notes:\n${seq.custom_notes}`);
  }

  const extras = renderExtraRules(schema.extra_rules);
  if (extras) { lines.push(''); lines.push(extras); }

  if (schema.freetext?.trim()) {
    lines.push('');
    lines.push(`Additional process rules:\n${schema.freetext}`);
  }

  return lines.join('\n');
}

function renderFolderRulesFromSchema(schema: FolderRulesSchema): string {
  const rules: string[] = [];

  if (schema.pattern === 'section_per_area') {
    rules.push(
      '- RULE: Each area/section of the plant MUST have its own top-level program block group' +
      ' (e.g. CONVEYORS, ELEVATORS, DIMENSIONNERS). Do NOT mix sections into a single group.'
    );
  }

  if (schema.shared_device_group) {
    rules.push(
      `- RULE: ALL device FBs, instance DBs, and call FCs MUST be placed in a single shared` +
      ` group named "${schema.device_group_name}" at the root level — NOT inside per-section groups.`
    );
    rules.push(
      `- RULE: Inside "${schema.device_group_name}":` +
      ` FBs go in subfolder "${schema.device_subfolders.fbs}",` +
      ` DBs go in subfolder "${schema.device_subfolders.dbs}".`
    );
    if (schema.device_subfolders.call_fcs_at_root) {
      rules.push(
        `- RULE: Call FCs (CALL_MOTOR, CALL_SENSOR, etc.) are placed directly at the root` +
        ` of "${schema.device_group_name}", NOT inside any subfolder.`
      );
    }
  }

  if (schema.call_fc_rules.one_fc_per_device_type) {
    rules.push(
      '- RULE: Generate exactly ONE call FC per device type (e.g. CALL_MOTOR, CALL_SENSOR,' +
      ' CALL_VALVE). Do NOT combine multiple device types in a single call FC.'
    );
  }
  if (schema.call_fc_rules.one_network_per_instance) {
    rules.push(
      '- RULE: Each call FC MUST contain exactly ONE network per device instance.' +
      ' Each network calls the FB via its instance DB with ALL parameters explicitly wired.'
    );
  }
  if (schema.call_fc_rules.networks_contain_wiring_only) {
    rules.push(
      '- RULE: Call FC networks contain ONLY the FB call with parameter wiring.' +
      ' No logic, no conditions, no branching — parameter wiring only.'
    );
  }

  if (schema.section_groups?.length > 0) {
    rules.push(
      `- RULE: The following section groups MUST exist at root level:` +
      ` ${schema.section_groups.map(g => `"${g}"`).join(', ')}.`
    );
  }

  if (schema.other_root_groups?.length > 0) {
    rules.push(
      `- RULE: The following utility/system groups MUST also exist at root level:` +
      ` ${schema.other_root_groups.map(g => `"${g}"`).join(', ')}.`
    );
  }

  if (schema.custom_notes?.trim()) {
    rules.push(`\nAdditional folder/structure notes:\n${schema.custom_notes}`);
  }

  return rules.join('\n');
}

export function formatDesignProfile(
  profile: DesignProfile,
  context: "general" | "process" | "fb" | "all" = "general",
): string {
  const sections: string[] = [];

  // General rules (always included) — schema-aware rendering
  const generalSchema = parseGeneralRules(profile.general_rules || profile.rules || '');
  const generalRendered = renderGeneralRules(generalSchema);
  if (generalRendered.trim()) {
    sections.push(`### General Code Rules\n\n${generalRendered}`);
  }

  // Folder rules (always included when present) — supports structured schema or freetext
  if (profile.folder_rules?.trim()) {
    let folderSection: string;
    try {
      const parsed = JSON.parse(profile.folder_rules);
      if (parsed?.version === 2) {
        folderSection = renderFolderRulesFromSchema(parsed as FolderRulesSchema);
      } else {
        folderSection = profile.folder_rules;
      }
    } catch {
      // Legacy freetext — use as-is
      folderSection = profile.folder_rules;
    }
    sections.push(`### Program Folder Structure\n\n${folderSection}`);
  }

  // Process rules (only for process/all contexts) — schema-aware rendering
  if (context === 'process' || context === 'all') {
    const processSchema = parseProcessRules(profile.process_rules as string);
    const processRendered = renderProcessRules(processSchema);
    if (processRendered.trim()) {
      sections.push(`### Process Code Rules\n\n${processRendered}`);
    }
  }

  // FB rules (only for fb/all contexts) — schema-aware rendering
  if (context === 'fb' || context === 'all') {
    const fbSchema = parseFbRules(profile.fb_rules as string);
    const fbRendered = renderFbRules(fbSchema);
    if (fbRendered.trim()) {
      sections.push(`### Function Block Rules\n\n${fbRendered}`);
    }
  }

  if (sections.length === 0) return "";

  return `## MANDATORY: Code Design Profile — ${profile.name}

**IMPORTANT:** The following rules define the customer's mandatory code standards. These rules take PRIORITY over any default patterns or conventions. ALL generated code MUST follow these rules exactly. If a rule contradicts a default pattern, the customer's rule wins.

${sections.join("\n\n")}`;
}


export function formatRackLayout(rackLayout: RackSlotLayout[]): string {
  if (rackLayout.length === 0) return "";
  const sections: string[] = [];
  for (const rack of rackLayout) {
    const label = rack.rack === 0 ? "Central Rack" : rack.rack === 1 ? "ET 200SP" : `Rack ${rack.rack}`;
    const header = `| Slot | Module | Order Number | Description |`;
    const sep = `|------|--------|--------------|-------------|`;
    const rows = rack.slots.map(
      (s) => `| ${s.slot} | ${s.module_type} | ${s.order_number ?? "—"} | ${s.description ?? "—"} |`,
    );
    sections.push(`### ${label}\n${header}\n${sep}\n${rows.join("\n")}`);
  }
  return `## Hardware Configuration\n\n${sections.join("\n\n")}`;
}

export function formatFbTemplates(templates: FbTemplate[]): string {
  if (templates.length === 0) return "";
  const sections = templates.map((t) => {
    const header = `### ${t.name} [${t.device_category}] (ID: ${t.id})`;
    const desc = t.description ? `${t.description}\n` : "";
    const summary = t.ai_summary ? `**Summary:** ${t.ai_summary}\n` : "";
    const blocks = t.blocks ?? [];
    if (blocks.length === 0) return `${header}\n${desc}${summary}(no blocks defined)`;
    const blockSections = blocks.map(
      (b) => `#### ${b.block_name} (${b.block_type})\n\`\`\`scl\n${b.scl_code}\n\`\`\``
    );
    const docSection = t.documentation
      ? `\n\n#### Manufacturer Documentation\n${t.documentation}`
      : "";
    return `${header}\n${desc}${summary}${blockSections.join("\n\n")}${docSection}`;
  });
  return `## FB Library Templates (USE THESE — Template Code is Locked)

The following are company-standard, pre-approved FB templates. When a template matches the device type being generated, you **MUST use it** — do NOT generate equivalent logic from scratch.

**HOW TO USE TEMPLATES:**
1. **EMIT the template FB/UDT code exactly as shown** — copy it character-for-character into your output artifacts. Do not rename blocks, parameters, variables, or modify internal logic.
2. **CREATE instance DBs** for each template FB you use (e.g., \`"InstConveyor1" : "ControlConveyor"\`).
3. **WIRE the template's parameters** to the project's IO tags in your calling code (OB1/Process FC):
   \`\`\`
   "InstConveyor1"(
       cmdStart := "Tag_StartButton",
       cmdStop  := "Tag_StopButton",
       fdbkRun  => "Tag_MotorRunning"
   );
   \`\`\`
4. **CREATE multiple instances** if the project has multiple devices of the same type.
5. **Generate additional FBs from scratch** only for device types that have NO matching template.

**TEMPLATE RELATIONSHIPS — multiple FBs per device:**
Multiple templates often work together for a single physical device. For example:
- A VFD-driven motor uses BOTH a VFD FB (drive communication, speed reference, fault codes) AND a Motor FB (start/stop sequencing, interlocks, status)
- An analog sensor uses an IO FB (scaling, filtering, fault detection) whose output feeds into process control FBs (PID, totalizer, level monitor)
- Companion UDTs included with a template define the HMI data structure — always emit them alongside the FB
When multiple templates are selected, wire their outputs/inputs together in the calling code so data flows correctly between related FBs.

**TEMPLATE CODE IS LOCKED — what you must NOT change:**
- Internal logic, state machine structure, or control flow
- VAR_INPUT, VAR_OUTPUT, VAR_IN_OUT, or VAR sections (names, types, order, defaults)
- Block names, UDT names, comments, whitespace

**What you MUST do:**
- Use every template that matches a device in the project — skipping a matching template is an error
- Create the instance DBs and wiring code needed to integrate the template into this specific project
- If the user's requirements conflict with a template's interface, use the template as-is and note the limitation

${sections.join("\n\n")}`;
}

export function formatInstructions(instructions: Instruction[]): string {
  if (instructions.length === 0) return "";

  // Group by category
  const byCategory = new Map<string, Instruction[]>();
  for (const inst of instructions) {
    const arr = byCategory.get(inst.category) ?? [];
    arr.push(inst);
    byCategory.set(inst.category, arr);
  }

  const categoryBlocks: string[] = [];
  for (const [cat, items] of byCategory) {
    const catLabel = INSTRUCTION_CATEGORIES[cat as InstructionCategory] ?? cat;
    const entries = items.map((inst) => {
      const pins = (inst.pins ?? [])
        .map(
          (p) =>
            `    - \`${p.pin_name}\` (${p.direction}, ${p.data_type}${p.is_rung_flow ? ", rung flow" : ""})${p.description ? " — " + p.description : ""}`,
        )
        .join("\n");
      const opsLine =
        inst.operators && inst.operators.length > 0
          ? `\n  Operators: ${inst.operators.join(", ")}${inst.operator_part_names ? ` → Part Names: ${JSON.stringify(inst.operator_part_names)}` : ""}`
          : "";
      const instanceNote = inst.has_instance
        ? "\n  Requires: static instance variable (instanceDb)"
        : "";
      const outputNote = inst.is_output
        ? "\n  Position: must be the LAST element in the rung"
        : "";
      return `### ${inst.name} (element_type: \`${inst.element_type}\`, Part: \`${inst.simatic_part_name}\`)
  ${inst.description ?? ""}${opsLine}${instanceNote}${outputNote}
  Pins:
${pins}`;
    });
    categoryBlocks.push(`## ${catLabel}\n\n${entries.join("\n\n")}`);
  }

  // Build the allowed element_type list for the hard constraint
  const allowedTypes = instructions.map((i) => `"${i.element_type}"`).join(", ");

  return `## Available LAD Instructions Reference

⛔ HARD CONSTRAINT: You may ONLY use element_type values from this list: ${allowedTypes}
Any element_type not in this list DOES NOT EXIST in the system and will cause an import failure.
If you need functionality not covered by these instructions (e.g., edge detection, flip-flops), implement it using the available instructions (contacts, coils, timers) with static variables.

The \`element_type\` value goes in the JSON \`type\` field. Pin names are the exact SimaticML XML pin names used during import.

${categoryBlocks.join("\n\n")}`;
}

export function formatPatterns(patterns: PatternCandidate[]): string {
  if (patterns.length === 0) return "No learned corrections.";
  const rules = patterns
    .map((p) => {
      const parts = [
        `### ${p.short_id}: ${p.explanation_tag}`,
        `**Category:** ${p.correction_type} | **Device:** ${p.device_type}`,
      ];
      if (p.original_snippet) {
        parts.push(`**WRONG (do NOT generate this):**\n\`\`\`scl\n${p.original_snippet}\n\`\`\``);
      }
      if (p.corrected_snippet) {
        parts.push(`**CORRECT (use this instead):**\n\`\`\`scl\n${p.corrected_snippet}\n\`\`\``);
      }
      return parts.join("\n");
    })
    .join("\n\n");
  return rules;
}

/**
 * Build prefixed context messages for reference sections and correction patterns.
 * These are prepended before conversation messages to keep the system prompt
 * under the 100K character limit while preserving all reference material.
 */
export function buildContextMessages(
  referenceSections: ReferenceLibrarySection[],
  approvedPatterns: PatternCandidate[],
): Array<{ role: "user" | "assistant"; content: string }> {
  const refBlock = formatReferenceSections(referenceSections);
  const hasPatterns = approvedPatterns && approvedPatterns.length > 0;

  if (!refBlock && !hasPatterns) return [];

  const parts: string[] = [];

  if (refBlock) {
    parts.push(refBlock);
  }

  if (hasPatterns) {
    parts.push(`## MANDATORY: Learned Corrections from Previous Compile Errors

The following corrections were learned from real TIA Portal compile failures. You MUST apply every one of these rules. Generating code that violates these rules will cause compile errors.

${formatPatterns(approvedPatterns)}`);
  }

  return [
    { role: "user" as const, content: parts.join("\n\n") },
    { role: "assistant" as const, content: "Understood. I have reviewed the reference documentation and correction rules provided. I will use these as authoritative sources and apply all learned corrections to this task." },
  ];
}

export function buildPrompt(input: PromptBuilderInput): BuiltPrompt {
  const { project, agents, generationMode, approvedPatterns, fbTemplates, designProfile, agentKnowledgeDocs, promptSections, referenceSections, userMessage, conversationHistory } = input;

  const codeArchitect = getAgentProfile("Code Architect");
  const identity = interpolateAgent(
    resolveSection(promptSections, "generate", "identity"),
    { name: "Code Architect", tagline: codeArchitect.tagline, description: codeArchitect.description, personality: codeArchitect.personality },
  );
  const instructions = resolveSection(promptSections, "generate", "instructions");
  const platformRules = resolveSection(promptSections, "shared", "platform_rules");
  const codeExamples = resolveSection(promptSections, "shared", "code_examples");

  const generationModeDesc =
    generationMode === "FB_PER_DEVICE"
      ? "Generate one FB per device type with UDT-based IO arrays. Each device type gets its own FB, UDT, and instance DB template."
      : "Generate a complete project-level structure with all FBs, UDTs, DBs, and OBs needed for the full system.";

  const systemPrompt = `${identity}

${instructions}

${buildPriorityHierarchyBlock()}

${platformRules}

${codeExamples}

## Project Context
- Client: ${project.client_name}
- PLC Brand: ${project.plc_brand}
- TIA Version: ${project.tia_version}
- CPU Type: ${project.cpu_type}
- Safety Level: ${project.safety_level}
${project.safety_notes ? `- Safety Notes: ${project.safety_notes}` : ""}

${designProfile ? formatDesignProfile(designProfile) : ""}
${formatRackLayout(project.rack_slot_layout)}
## IO List
${formatIoList(project.io_lists)}

## Tag DB Definitions
${formatTagDbs(project.tag_db_definitions)}

## Generation Mode
${generationModeDesc}

## Agent Roles
${formatAgentRoles(agents, agentKnowledgeDocs)}

${formatFbTemplates(fbTemplates ?? [])}

${OUTPUT_FORMAT}`;

  // Reference sections + patterns are sent as prefixed context messages
  // to keep the system prompt under the 100K character limit
  const contextMessages = buildContextMessages(referenceSections ?? [], approvedPatterns ?? []);

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    ...contextMessages,
    ...(conversationHistory ?? []),
    { role: "user" as const, content: userMessage },
  ];

  return { systemPrompt, messages };
}

/**
 * Builds a structured prompt from the guided question flow answers.
 */
export interface GuidedAnswers {
  deviceType: string;
  instanceCount: number;
  ioMapping: "array_indexed" | "individual_tags";
  states: string[];
  alarmRequirements: string;
  specialRequirements: string;
}

export function buildGuidedPrompt(answers: GuidedAnswers): string {
  const stateList = answers.states.join(", ");
  return `Generate a complete, runnable PLC program for a ${answers.deviceType} device with the following specifications:

- **Instances**: ${answers.instanceCount} instance(s)
- **IO Mapping**: ${answers.ioMapping === "array_indexed" ? "Array-indexed via UDT" : "Individual tags per instance"}
- **State Machine States**: ${stateList}
- **Alarm Requirements**: ${answers.alarmRequirements || "Standard latching alarms with operator reset"}
${answers.specialRequirements ? `- **Special Requirements**: ${answers.specialRequirements}` : ""}

You MUST generate ALL of these artifacts:
1. UDT(s) for IO structure and configuration
2. FB with CASE-based state machine
3. Instance DB for each FB instance (${answers.instanceCount} instance(s))
4. OB1 "Main" that calls each FB instance with its instance DB
5. Any utility FCs needed (scaling, etc.)

Follow all platform rules and naming conventions.`;
}
