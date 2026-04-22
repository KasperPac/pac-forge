/**
 * AI residue prompt — everything deterministic is pre-computed and
 * handed to the model as context, so the model only has to produce the
 * prose residue (§7.2 of PAC_AUDIT_DERIVED_SPEC.md).
 *
 * The schema varies per block: fields omitted from `ResidueRequest` are
 * omitted from the JSON schema shown to the model. Keeps responses tight
 * and prevents the model from hallucinating structure we already have.
 */

import type {
  DataFlowAnalysis,
  InterfaceContract,
  StateMachineAnalysis,
  TimingAnalysis,
} from "@/types/audit";

import type { OrchestratorBlockInput } from "@/lib/audit-analysis/analysis-orchestrator";

// Re-declared locally to avoid a circular import. Matches the shape in
// analysis-orchestrator.ts exactly.
interface DeterministicAnalysis {
  interface_contract: InterfaceContract;
  data_flow: DataFlowAnalysis;
  timing_analysis: TimingAnalysis;
  state_machine: StateMachineAnalysis | null;
  fault_detection: {
    detected: boolean;
    patterns: string[];
    fault_writes: string[];
    fault_db_refs: string[];
  };
}

interface ResidueRequest {
  needsPurpose: boolean;
  needsCategory: boolean;
  needsDetailedNotes: boolean;
  needsCodeQuality: boolean;
  needsStateMachineTransitions: boolean;
  needsFaultDescription: boolean;
  needsTimingNotes: boolean;
  needsInterfaceFromAi: boolean;
}

const MAX_SOURCE_CHARS = 40_000;

function truncateSource(src: string): { text: string; truncated: boolean; original: number } {
  if (src.length <= MAX_SOURCE_CHARS) {
    return { text: src, truncated: false, original: src.length };
  }
  return {
    text:
      src.slice(0, MAX_SOURCE_CHARS) +
      `\n\n[TRUNCATED: source is ${src.length} chars, showing first ${MAX_SOURCE_CHARS}. Analyse what is visible; note truncation in confidence_notes.]`,
    truncated: true,
    original: src.length,
  };
}

/**
 * Compact the deterministic bundle for prompt injection. We strip empty
 * arrays / null fields so the AI isn't paying tokens for absence.
 */
function compactDeterministic(d: DeterministicAnalysis): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const iface = d.interface_contract;
  const ifaceOut: Record<string, unknown> = {};
  if (iface.inputs?.length) ifaceOut.inputs = iface.inputs;
  if (iface.outputs?.length) ifaceOut.outputs = iface.outputs;
  if (iface.in_out?.length) ifaceOut.in_out = iface.in_out;
  if (iface.members?.length) ifaceOut.members = iface.members;
  if (Object.keys(ifaceOut).length > 0) out.interface_contract = ifaceOut;

  const df = d.data_flow;
  const dfOut: Record<string, unknown> = {};
  if (df.called_blocks?.length) dfOut.called_blocks = df.called_blocks;
  if (df.reads_from?.length) dfOut.reads_from = df.reads_from;
  if (df.writes_to?.length) dfOut.writes_to = df.writes_to;
  if (Object.keys(dfOut).length > 0) out.data_flow = dfOut;

  if (d.timing_analysis.timers_used?.length) {
    out.timing = { timers_used: d.timing_analysis.timers_used };
  }

  if (d.state_machine) {
    out.state_machine = d.state_machine;
  }

  if (d.fault_detection.detected) {
    out.fault_detection = {
      detected: true,
      patterns: d.fault_detection.patterns,
      fault_writes: d.fault_detection.fault_writes,
      fault_db_refs: d.fault_detection.fault_db_refs,
    };
  }

  return out;
}

/**
 * Builds the JSON schema excerpt shown to the AI. Only fields the
 * orchestrator still needs appear here.
 */
function buildSchemaExcerpt(req: ResidueRequest, smMechanism: string | null): string[] {
  const lines: string[] = ["{"];

  if (req.needsPurpose) {
    lines.push('  "purpose": "One or two sentences describing what this block does, strictly from the code.",');
  }
  if (req.needsCategory) {
    lines.push(
      '  "category": "device_control | process_logic | hmi | comms | safety | data_management | utility | timing | unknown",',
    );
  }
  if (req.needsInterfaceFromAi) {
    lines.push('  "interface_contract": {');
    lines.push('    "inputs":  [{ "name": "...", "type": "...", "meaning": "..." }],');
    lines.push('    "outputs": [{ "name": "...", "type": "...", "meaning": "..." }],');
    lines.push('    "in_out":  [{ "name": "...", "type": "...", "meaning": "..." }],');
    lines.push('    "members": [{ "name": "...", "type": "...", "initial": "value or null", "meaning": "..." }]');
    lines.push("  },");
  }
  if (req.needsStateMachineTransitions) {
    lines.push(
      `  "state_machine_transitions": [  // mechanism="${smMechanism}" — states are known; derive transitions from source`,
    );
    lines.push('    { "from": "<state>", "to": "<state>", "condition": "brief paraphrase" }');
    lines.push("  ],");
  }
  if (req.needsFaultDescription) {
    lines.push(
      '  "fault_description": "How this block detects, latches, and resets faults — one or two sentences, strictly from the code.",',
    );
  }
  if (req.needsTimingNotes) {
    lines.push(
      '  "timing_notes": "One sentence on non-trivial timing behaviour, or null.",',
    );
  }
  if (req.needsCodeQuality) {
    lines.push('  "code_quality": {');
    lines.push('    "deviations_from_conventions": ["concrete items that look inconsistent with typical Siemens style"],');
    lines.push('    "risks": ["anything fragile — scan-order dependencies, missing reset paths, race conditions"],');
    lines.push('    "analysis_confidence": "high | medium | low",');
    lines.push('    "confidence_notes": "null, or one sentence on what reduced confidence"');
    lines.push("  },");
  }
  if (req.needsDetailedNotes) {
    lines.push(
      '  "detailed_notes": "Anything a modification agent must know about THIS block in isolation. null if nothing."',
    );
  }

  // Trim trailing comma on the last field for clean JSON.
  const last = lines[lines.length - 1];
  if (last.endsWith(",")) lines[lines.length - 1] = last.slice(0, -1);
  lines.push("}");
  return lines;
}

export function buildResiduePrompt(
  block: OrchestratorBlockInput,
  deterministic: DeterministicAnalysis,
  req: ResidueRequest,
): { system: string; user: string } {
  const smMechanism = deterministic.state_machine?.mechanism ?? null;
  const schema = buildSchemaExcerpt(req, smMechanism).join("\n");

  const system = `You are a Siemens TIA Portal PLC block analyst. An upstream deterministic pass has already extracted all structural facts from this block — interface contract, call graph, data flow, timers, state-machine mechanism, and fault-handling detection. Your job is to add ONLY the prose residue that cannot be derived from structure.

## What you will receive

- Block metadata (name, type, language, folder, line count)
- Deterministic analysis (JSON) — facts already known; do NOT re-derive these
- Block source code (may be truncated — note in confidence_notes if so)

## What you must return

Raw JSON only — no markdown fences, no text before \`{\`, no text after \`}\`. The exact schema is shown in the user message. Every field listed in the schema must appear; fields NOT listed must NOT appear.

## Rules

- Describe only what the source shows. If you would write "this is probably…" or "likely intended to…", set the field to null instead.
- The deterministic analysis is authoritative for structural facts. Do not contradict it. Your job is interpretation, not re-extraction.
- Prose fields are short. One or two sentences. Never paragraphs.
- Fail closed. If a required field genuinely cannot be determined, set it to null (or empty array) and add a sentence to \`confidence_notes\`.
- Do not invent convention violations. Only flag concrete, visible issues in \`deviations_from_conventions\` / \`risks\`.
- No markdown anywhere in the response. First character \`{\`. Last character \`}\`.`;

  const { text: source, truncated, original } = truncateSource(block.source_code ?? "");
  const deterministicJson = JSON.stringify(compactDeterministic(deterministic), null, 2);

  const userLines: string[] = [
    `Block Name: ${block.name}`,
    `Block Type: ${block.block_type}`,
    `Programming Language: ${block.programming_language}`,
    `Folder Path: ${block.folder_path ?? "Program blocks (root)"}`,
    `Line Count: ${block.line_count ?? "unknown"}${truncated ? ` (source truncated from ${original} chars)` : ""}`,
    "",
    "--- DETERMINISTIC ANALYSIS (already extracted — do not re-derive) ---",
    deterministicJson,
    "",
    "--- SOURCE CODE ---",
    source,
    "",
    "--- RETURN JSON IN THIS EXACT SHAPE ---",
    schema,
  ];

  return { system, user: userLines.join("\n") };
}
