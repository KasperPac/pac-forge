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
  SequentialStateData,
  FdsValidationResult,
  FdsValidationIssue,
  SubsystemOrchestration,
  FdsAssemblySession,
} from "@/types/spec-builder";

// ---------------------------------------------------------------------------
// Assembly-level validation
// ---------------------------------------------------------------------------

export function validateAssembly(
  assembly: AssemblyConfig,
  staticStates: Record<string, DeviceStateEntry[]>,
  sequentialStates: Record<string, SequentialStateData>,
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
  const inputTags = assemblyTags.filter((t) => t.signal_direction === "DI" || t.signal_direction === "AI");
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
      const referencedTags = extractTagReferences(perm, allTagNames);
      if (referencedTags.length === 0) {
        issues.push({
          severity: "warning",
          category: "permissive_ref",
          message: `Permissive "${truncate(perm)}" doesn't reference any known tag`,
          assembly_id: assembly.assembly_id,
          state_id: state.state_id,
        });
      }
    }

    // --- Check 4: Completion criteria tag references + timeouts ---
    for (const step of data.steps) {
      const referencedTags = extractTagReferences(step.completion_criteria, allTagNames);
      if (referencedTags.length === 0) {
        issues.push({
          severity: "warning",
          category: "completion_ref",
          message: `Step ${step.step} completion criteria doesn't reference any known tag`,
          assembly_id: assembly.assembly_id,
          state_id: state.state_id,
        });
      }

      // Check for timeout specification
      if (!hasTimeoutSpec(step.completion_criteria)) {
        issues.push({
          severity: "warning",
          category: "completion_ref",
          message: `Step ${step.step} completion criteria has no timeout specified`,
          assembly_id: assembly.assembly_id,
          state_id: state.state_id,
        });
      }

      // --- Check 5: Failure path ---
      if (!hasFailurePath(step.completion_criteria)) {
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

function truncate(s: string, max = 60): string {
  return s.length > max ? s.slice(0, max) + "..." : s;
}
