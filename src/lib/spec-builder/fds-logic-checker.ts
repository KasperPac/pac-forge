/**
 * FDS Logic Checker — pure client-side validation of co-authored functional descriptions.
 * No AI calls. Runs instantly for immediate feedback.
 */
import type {
  AssemblyConfig,
  SubsystemConfig,
  OperatingState,
  InstrumentTag,
  DeviceStateEntry,
  FdsValidationResult,
  FdsValidationIssue,
  SubsystemOrchestration,
  FdsAssemblySession,
} from "@/types/spec-builder";
import type { SequentialStateV2 } from "@/types/spec-contract-v2";

// ---------------------------------------------------------------------------
// Assembly-level validation
// ---------------------------------------------------------------------------

export function validateAssembly(
  assembly: AssemblyConfig,
  staticStates: Record<string, DeviceStateEntry[]>,
  sequentialStates: Record<string, SequentialStateV2>,
  allStates: OperatingState[],
  allTags: InstrumentTag[],
): FdsValidationResult {
  const issues: FdsValidationIssue[] = [];

  // Collect this assembly's tags
  const assemblyTagNames = new Set<string>();
  for (const dev of assembly.devices) {
    for (const sig of dev.io_signals) {
      assemblyTagNames.add(sig.tag);
    }
  }

  const assemblyTags = allTags.filter((t) => assemblyTagNames.has(t.tag));
  const outputTags = assemblyTags.filter((t) => t.signal_direction === "DO" || t.signal_direction === "AO");
  const allTagNames = new Set(allTags.map((t) => t.tag));

  const staticStateIds = allStates.filter((s) => s.state_pattern === "static");
  const sequentialStateIds = allStates.filter((s) => s.state_pattern === "sequential");

  // --- Check 1: Tag coverage in static states ---
  for (const state of staticStateIds) {
    const entries = staticStates[state.state_id] ?? [];
    const coveredTags = new Set(entries.map((e) => e.tag));

    for (const tag of outputTags) {
      if (!coveredTags.has(tag.tag)) {
        issues.push({
          severity: "error",
          category: "tag_coverage",
          message: `Output tag ${tag.tag} missing from ${state.state_name} device state table`,
          assembly_id: assembly.assembly_id,
          state_id: state.state_id,
          tag: tag.tag,
        });
      }
    }
  }

  // --- Check 2: State completeness for sequential states ---
  for (const state of sequentialStateIds) {
    const data = sequentialStates[state.state_id];
    if (!data || data.steps.length === 0) {
      issues.push({
        severity: "error",
        category: "state_completeness",
        message: `No steps defined for ${state.state_name}`,
        assembly_id: assembly.assembly_id,
        state_id: state.state_id,
      });
      continue;
    }

    // --- Check 3: Permissive tag references ---
    for (const perm of data.permissives) {
      if (perm.tag && !allTagNames.has(perm.tag)) {
        issues.push({
          severity: "warning",
          category: "permissive_ref",
          message: `Permissive tag "${perm.tag}" is not in the instrument register`,
          assembly_id: assembly.assembly_id,
          state_id: state.state_id,
        });
      } else if (!perm.tag) {
        issues.push({
          severity: "warning",
          category: "permissive_ref",
          message: "Permissive has no tag selected",
          assembly_id: assembly.assembly_id,
          state_id: state.state_id,
        });
      }
    }

    // --- Check 4: Completion criteria tag references + timeouts ---
    for (const step of data.steps) {
      // Extract tags from structured criteria (tag_equals / tag_compare) or referenced_tags arrays
      const structuredTags: string[] = [];
      for (const c of step.completion_criteria ?? []) {
        if ("tag" in c && typeof c.tag === "string") structuredTags.push(c.tag);
        if ("referenced_tags" in c && Array.isArray(c.referenced_tags)) structuredTags.push(...c.referenced_tags);
      }
      const knownStructured = structuredTags.filter((t) => allTagNames.has(t));
      const criteriaText = step.completion_criteria_text ?? "";
      const textTags = extractTagReferences(criteriaText, allTagNames);

      if (knownStructured.length === 0 && textTags.length === 0) {
        issues.push({
          severity: "warning",
          category: "completion_ref",
          message: `Step ${step.step} completion criteria doesn't reference any known tag`,
          assembly_id: assembly.assembly_id,
          state_id: state.state_id,
        });
      }

      // Check for timeout — within_ms on any criterion, or text fallback
      const hasStructuredTimeout = step.completion_criteria?.some((c) => "within_ms" in c && (c as { within_ms?: number }).within_ms != null);
      if (!hasStructuredTimeout && !hasTimeoutSpec(criteriaText)) {
        issues.push({
          severity: "warning",
          category: "completion_ref",
          message: `Step ${step.step} completion criteria has no timeout specified`,
          assembly_id: assembly.assembly_id,
          state_id: state.state_id,
        });
      }

      // --- Check 5: Failure path — on_fail on any criterion, or text fallback ---
      const hasStructuredFault = step.completion_criteria?.some((c) => "on_fail" in c && c.on_fail != null);
      if (!hasStructuredFault && !hasFailurePath(criteriaText)) {
        issues.push({
          severity: "warning",
          category: "missing_failure_path",
          message: `Step ${step.step} has no failure/fault handling defined`,
          assembly_id: assembly.assembly_id,
          state_id: state.state_id,
        });
      }
    }
  }

  return {
    passed: issues.filter((i) => i.severity === "error").length === 0,
    checked_at: new Date().toISOString(),
    issues,
  };
}

// ---------------------------------------------------------------------------
// Subsystem-level validation (cross-assembly)
// ---------------------------------------------------------------------------

export function validateSubsystem(
  subsystem: SubsystemConfig,
  sessions: FdsAssemblySession[],
  orchestration: SubsystemOrchestration | null,
  allStates: OperatingState[],
  allTags: InstrumentTag[],
): FdsValidationResult {
  const issues: FdsValidationIssue[] = [];
  const sequentialStates = allStates.filter((s) => s.state_pattern === "sequential");

  // Run assembly-level validation for each session
  for (const session of sessions) {
    const assembly = subsystem.assemblies.find((a) => a.assembly_id === session.assembly_id);
    if (!assembly) continue;

    const assemblyResult = validateAssembly(
      assembly,
      session.static_states,
      session.sequential_states,
      allStates,
      allTags,
    );
    issues.push(...assemblyResult.issues);
  }

  // --- Check: Orchestration exists ---
  if (subsystem.assemblies.length > 1 && !orchestration) {
    issues.push({
      severity: "warning",
      category: "orchestration",
      message: `Subsystem "${subsystem.subsystem_name}" has ${subsystem.assemblies.length} assemblies but no orchestration defined`,
    });
  }

  if (orchestration) {
    const assemblyIds = new Set(subsystem.assemblies.map((a) => a.assembly_id));

    for (const state of sequentialStates) {
      const seq = orchestration.state_sequences[state.state_id];
      if (!seq) {
        issues.push({
          severity: "warning",
          category: "orchestration",
          message: `No orchestration order defined for ${state.state_name}`,
          state_id: state.state_id,
        });
        continue;
      }

      // Check assembly order references valid assemblies
      for (const asmId of seq.assembly_order) {
        if (!assemblyIds.has(asmId)) {
          issues.push({
            severity: "error",
            category: "orchestration",
            message: `Assembly order references unknown assembly "${asmId}" in ${state.state_name}`,
            state_id: state.state_id,
            assembly_id: asmId,
          });
        }
      }

      // Check all assemblies are in the order
      for (const asmId of assemblyIds) {
        if (!seq.assembly_order.includes(asmId)) {
          issues.push({
            severity: "warning",
            category: "orchestration",
            message: `Assembly "${asmId}" not included in ${state.state_name} execution order`,
            state_id: state.state_id,
            assembly_id: asmId,
          });
        }
      }

      // --- Check: Circular interlocks ---
      const circularIssues = detectCircularInterlocks(seq.inter_assembly_interlocks);
      issues.push(...circularIssues.map((msg) => ({
        severity: "error" as const,
        category: "circular_interlock" as const,
        message: msg,
        state_id: state.state_id,
      })));
    }
  }

  return {
    passed: issues.filter((i) => i.severity === "error").length === 0,
    checked_at: new Date().toISOString(),
    issues,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract tag references from a text string by matching against known tags */
function extractTagReferences(text: string, allTagNames: Set<string>): string[] {
  const found: string[] = [];
  for (const tag of allTagNames) {
    if (text.includes(tag)) {
      found.push(tag);
    }
  }
  return found;
}

/** Check if text contains a timeout specification */
function hasTimeoutSpec(text: string): boolean {
  return /within\s+\d+\s*s/i.test(text) ||
    /timeout/i.test(text) ||
    /\d+\s*second/i.test(text) ||
    /T#\d+/i.test(text);
}

/** Check if text contains a failure/fault handling clause */
function hasFailurePath(text: string): boolean {
  return /else\s+fault/i.test(text) ||
    /fault\s*[—–-]/i.test(text) ||
    /otherwise/i.test(text) ||
    /on\s+failure/i.test(text) ||
    /if\s+not\s+confirmed/i.test(text) ||
    /timeout.*transition/i.test(text);
}

/** Detect circular interlocks via DFS cycle detection */
function detectCircularInterlocks(
  interlocks: Array<{ source_assembly: string; target_assembly: string }>,
): string[] {
  // Build adjacency list: target depends on source
  const deps = new Map<string, Set<string>>();
  for (const il of interlocks) {
    if (!deps.has(il.target_assembly)) deps.set(il.target_assembly, new Set());
    deps.get(il.target_assembly)!.add(il.source_assembly);
  }

  const issues: string[] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): boolean {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      const cycle = [...path.slice(cycleStart), node];
      issues.push(`Circular interlock: ${cycle.join(" → ")}`);
      return true;
    }
    if (visited.has(node)) return false;

    visited.add(node);
    inStack.add(node);

    for (const dep of deps.get(node) ?? []) {
      dfs(dep, [...path, node]);
    }

    inStack.delete(node);
    return false;
  }

  for (const node of deps.keys()) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }

  return issues;
}

