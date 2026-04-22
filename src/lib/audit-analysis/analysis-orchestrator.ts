/**
 * Analysis orchestrator — step 10 of the Pac-Audit derivation plan
 * (see Docs/PAC_AUDIT_DERIVED_SPEC.md §7, §16).
 *
 * Runs the six deterministic extractors first, then invokes the AI only
 * for the residual prose fields that can't be computed from structure:
 * purpose, detailed_notes, non-standard state-machine transitions,
 * fault-handling description, code_quality risks + confidence. The
 * deterministic output is handed to the AI verbatim so the model doesn't
 * re-derive structural facts — cuts per-block tokens from ~2k to ~400.
 */

import type {
  AuditCrossReference,
  CodeQualityAnalysis,
  DataFlowAnalysis,
  InterfaceContract,
  StateMachineAnalysis,
  TimingAnalysis,
} from "@/types/audit";
import {
  extractInterfaceContract,
  type BlockKind,
} from "@/lib/audit-analysis/interface-extractor";
import { extractDataFlow } from "@/lib/audit-analysis/data-flow-extractor";
import { extractTimingAnalysis } from "@/lib/audit-analysis/timing-extractor";
import { detectFaultHandling } from "@/lib/audit-analysis/fault-handling-detector";
import { extractStateMachine } from "@/lib/audit-analysis/state-machine-case-parser";
import { buildResiduePrompt } from "@/lib/audit-analysis/residue-prompt";

// ---------------------------------------------------------------------------
// Inputs / outputs
// ---------------------------------------------------------------------------

export interface OrchestratorBlockInput {
  id: string;
  name: string;
  block_type: string;
  programming_language: string;
  source_code: string | null;
  folder_path: string | null;
  line_count: number | null;
}

export interface OrchestratorAiCallResult {
  content: string;
  usage: { input: number; output: number } | null;
}

export type OrchestratorAiCall = (
  systemPrompt: string,
  userMessage: string,
  signal: AbortSignal,
) => Promise<OrchestratorAiCallResult>;

export interface OrchestratorDeps {
  crossReferencesByBlockId: Map<string, AuditCrossReference[]>;
  projectBlockNames: Set<string>;
  aiCall: OrchestratorAiCall;
  /** Model identifier to record against the understanding row. */
  modelId: string;
}

export interface BlockUnderstandingResult {
  blockId: string;
  understanding: {
    purpose: string | null;
    category: string | null;
    has_state_machine: boolean;
    state_machine: StateMachineAnalysis | null;
    data_flow: DataFlowAnalysis;
    timing_analysis: TimingAnalysis;
    fault_handling: { description: string } | null;
    interface_contract: InterfaceContract;
    code_quality: CodeQualityAnalysis;
    detailed_notes: string | null;
    model_used: string | null;
    token_usage: Record<string, number>;
  };
  /** Indicates where the prose residue came from. */
  residueSource: "ai" | "deterministic-only" | "ai-failed";
  /** Non-fatal warning — e.g. "AI call failed, kept deterministic output". */
  warning?: string;
}

// ---------------------------------------------------------------------------
// Deterministic pass
// ---------------------------------------------------------------------------

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

function runDeterministic(
  block: OrchestratorBlockInput,
  crossReferences: AuditCrossReference[],
  projectBlockNames: Set<string>,
): DeterministicAnalysis {
  const source = block.source_code ?? "";
  const blockKind = block.block_type as BlockKind;

  const interface_contract = extractInterfaceContract(source, blockKind);
  const data_flow = extractDataFlow({
    crossReferences,
    projectBlockNames,
  });
  const timing_analysis = extractTimingAnalysis(source);
  const smDetection = extractStateMachine(source);
  const state_machine: StateMachineAnalysis | null = smDetection
    ? {
        mechanism: smDetection.mechanism,
        state_variable: smDetection.state_variable,
        states: smDetection.states,
        transitions: smDetection.transitions,
      }
    : null;
  const fault_detection = detectFaultHandling({
    source,
    crossReferences,
  });

  return {
    interface_contract,
    data_flow,
    timing_analysis,
    state_machine,
    fault_detection,
  };
}

// ---------------------------------------------------------------------------
// Residue expectation — what we still need AI for per block
// ---------------------------------------------------------------------------

interface ResidueRequest {
  /** The AI always owns these prose fields. */
  needsPurpose: boolean;
  needsCategory: boolean;
  needsDetailedNotes: boolean;
  needsCodeQuality: boolean;
  /** True only when mechanism is non-CASE (step_counter / seal_in / other). */
  needsStateMachineTransitions: boolean;
  /** True only when the detector fired. */
  needsFaultDescription: boolean;
  /** True only when timers were found. */
  needsTimingNotes: boolean;
  /** LAD/FBD/GRAPH — deterministic SCL parser returned empty interfaces;
   *  ask the AI to derive from raw XML. SCL/STL don't need this. */
  needsInterfaceFromAi: boolean;
}

function planResidue(
  block: OrchestratorBlockInput,
  deterministic: DeterministicAnalysis,
): ResidueRequest {
  const lang = block.programming_language.toUpperCase();
  const isXmlLang = lang === "LAD" || lang === "FBD" || lang === "GRAPH";
  const isDataOnly = block.block_type === "DB" || block.block_type === "UDT";
  const ifaceEmpty =
    !deterministic.interface_contract.inputs?.length &&
    !deterministic.interface_contract.outputs?.length &&
    !deterministic.interface_contract.in_out?.length &&
    !deterministic.interface_contract.members?.length;

  return {
    needsPurpose: true,
    needsCategory: true,
    needsDetailedNotes: !isDataOnly,
    needsCodeQuality: !isDataOnly,
    needsStateMachineTransitions:
      !!deterministic.state_machine &&
      deterministic.state_machine.mechanism !== "case_on_variable" &&
      deterministic.state_machine.transitions.length === 0,
    needsFaultDescription: deterministic.fault_detection.detected,
    needsTimingNotes: (deterministic.timing_analysis.timers_used ?? []).length > 0,
    needsInterfaceFromAi: isXmlLang && ifaceEmpty,
  };
}

// ---------------------------------------------------------------------------
// AI residue schema + parse
// ---------------------------------------------------------------------------

interface ResidueAiOutput {
  purpose?: string | null;
  category?: string | null;
  detailed_notes?: string | null;
  state_machine_transitions?: Array<{ from: string; to: string; condition: string }>;
  fault_description?: string | null;
  timing_notes?: string | null;
  code_quality?: {
    deviations_from_conventions?: string[];
    risks?: string[];
    analysis_confidence?: "high" | "medium" | "low";
    confidence_notes?: string | null;
  };
  interface_contract?: InterfaceContract;
}

/** Extract the first balanced JSON object from the response. Mirrors the
 *  walker used in the legacy audit-analyze path so truncated responses
 *  surface as parse errors instead of silently salvaging nested objects. */
function extractJsonBlock(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1].trim() : text.trim();
  const start = raw.indexOf("{");
  if (start === -1) return raw;

  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\" && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return raw.slice(start);
}

function parseResidue(content: string): ResidueAiOutput {
  const json = extractJsonBlock(content);
  return JSON.parse(json) as ResidueAiOutput;
}

// ---------------------------------------------------------------------------
// Merge deterministic + AI
// ---------------------------------------------------------------------------

function mergeUnderstanding(
  deterministic: DeterministicAnalysis,
  residue: ResidueAiOutput | null,
  residueSource: BlockUnderstandingResult["residueSource"],
  modelId: string,
  usage: { input: number; output: number } | null,
): BlockUnderstandingResult["understanding"] {
  // State machine — deterministic transitions win when CASE-driven; AI
  // transitions fill in when mechanism is step_counter / seal_in / other.
  let state_machine: StateMachineAnalysis | null = deterministic.state_machine;
  if (
    state_machine &&
    state_machine.mechanism !== "case_on_variable" &&
    state_machine.transitions.length === 0 &&
    residue?.state_machine_transitions?.length
  ) {
    state_machine = {
      ...state_machine,
      transitions: residue.state_machine_transitions,
    };
  }

  // Interface contract — AI fallback only when deterministic returned empty
  // (LAD/FBD/GRAPH). SCL/STL deterministic output wins.
  const det_iface = deterministic.interface_contract;
  const det_iface_empty =
    !det_iface.inputs?.length &&
    !det_iface.outputs?.length &&
    !det_iface.in_out?.length &&
    !det_iface.members?.length;
  const interface_contract: InterfaceContract =
    det_iface_empty && residue?.interface_contract ? residue.interface_contract : det_iface;

  // Timing — merge deterministic timers with AI-supplied notes.
  const timing_analysis: TimingAnalysis = {
    ...deterministic.timing_analysis,
    ...(residue?.timing_notes ? { notes: residue.timing_notes } : {}),
  };

  // Fault handling — description is AI-only; deterministic surfaces
  // detection booleans via the code_quality / detailed_notes paths.
  const fault_handling =
    deterministic.fault_detection.detected && residue?.fault_description
      ? { description: residue.fault_description }
      : null;

  // Code quality.
  const code_quality: CodeQualityAnalysis = {
    deviations_from_conventions: residue?.code_quality?.deviations_from_conventions ?? [],
    risks: residue?.code_quality?.risks ?? [],
    analysis_confidence:
      residue?.code_quality?.analysis_confidence ??
      (residueSource === "ai-failed" ? "low" : undefined),
    confidence_notes:
      residue?.code_quality?.confidence_notes ??
      (residueSource === "ai-failed"
        ? "AI residue call failed — deterministic fields only"
        : null),
  };

  return {
    purpose: residue?.purpose ?? null,
    category: residue?.category ?? null,
    has_state_machine: state_machine !== null,
    state_machine,
    data_flow: deterministic.data_flow,
    timing_analysis,
    fault_handling,
    interface_contract,
    code_quality,
    detailed_notes: residue?.detailed_notes ?? null,
    model_used: residueSource === "ai" ? modelId : null,
    token_usage: usage
      ? { input_tokens: usage.input, output_tokens: usage.output }
      : {},
  };
}

// ---------------------------------------------------------------------------
// Single-block orchestration
// ---------------------------------------------------------------------------

export async function analyzeBlock(
  block: OrchestratorBlockInput,
  deps: OrchestratorDeps,
  signal: AbortSignal,
): Promise<BlockUnderstandingResult> {
  const xrefs = deps.crossReferencesByBlockId.get(block.id) ?? [];
  const deterministic = runDeterministic(block, xrefs, deps.projectBlockNames);
  const residuePlan = planResidue(block, deterministic);

  // Skip AI entirely when no residue is genuinely needed (all signals
  // deterministic + block is a pure data block). Extremely rare — most
  // blocks at minimum need `purpose` + `category`.
  const needsAi =
    residuePlan.needsPurpose ||
    residuePlan.needsCategory ||
    residuePlan.needsDetailedNotes ||
    residuePlan.needsCodeQuality ||
    residuePlan.needsStateMachineTransitions ||
    residuePlan.needsFaultDescription ||
    residuePlan.needsTimingNotes ||
    residuePlan.needsInterfaceFromAi;

  if (!needsAi) {
    return {
      blockId: block.id,
      understanding: mergeUnderstanding(deterministic, null, "deterministic-only", deps.modelId, null),
      residueSource: "deterministic-only",
    };
  }

  const { system, user } = buildResiduePrompt(block, deterministic, residuePlan);

  let residue: ResidueAiOutput | null = null;
  let usage: { input: number; output: number } | null = null;
  let residueSource: BlockUnderstandingResult["residueSource"] = "ai";
  let warning: string | undefined;

  try {
    const result = await deps.aiCall(system, user, signal);
    usage = result.usage;
    residue = parseResidue(result.content);
  } catch (err) {
    if (signal.aborted) throw err;
    residueSource = "ai-failed";
    warning = err instanceof Error ? err.message : String(err);
  }

  return {
    blockId: block.id,
    understanding: mergeUnderstanding(deterministic, residue, residueSource, deps.modelId, usage),
    residueSource,
    warning,
  };
}

// ---------------------------------------------------------------------------
// Batch with concurrency cap
// ---------------------------------------------------------------------------

export interface BatchProgress {
  blockId: string;
  status: "started" | "completed" | "failed" | "cancelled";
  result?: BlockUnderstandingResult;
  error?: string;
}

/**
 * Runs `analyzeBlock` across an array of blocks with a fixed concurrency
 * cap. `onProgress` fires for every lifecycle event so the caller can
 * update UI state without awaiting the whole batch. Resolves once every
 * block has either completed, failed, or the signal aborted.
 */
export async function analyzeBlocks(
  blocks: OrchestratorBlockInput[],
  deps: OrchestratorDeps,
  signal: AbortSignal,
  concurrency: number,
  onProgress: (event: BatchProgress) => void | Promise<void>,
): Promise<void> {
  const cap = Math.max(1, Math.floor(concurrency));
  let cursor = 0;

  async function worker() {
    while (!signal.aborted) {
      const index = cursor++;
      if (index >= blocks.length) return;
      const block = blocks[index];
      await onProgress({ blockId: block.id, status: "started" });
      try {
        const result = await analyzeBlock(block, deps, signal);
        await onProgress({ blockId: block.id, status: "completed", result });
      } catch (err) {
        if (signal.aborted) {
          await onProgress({ blockId: block.id, status: "cancelled" });
          return;
        }
        await onProgress({
          blockId: block.id,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  const workers: Promise<void>[] = [];
  for (let i = 0; i < cap; i++) workers.push(worker());
  await Promise.all(workers);
}
