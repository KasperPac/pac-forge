/**
 * FDS Logic Checker — pure client-side validation of co-authored functional descriptions.
 * No AI calls. Runs instantly for immediate feedback.
 */
import type {
  EquipmentModuleConfig,
  UnitConfig,
  InstrumentTag,
  ControlModuleStateEntry,
  FdsValidationResult,
  FdsValidationIssue,
  ProcessModel,
} from "@/types/spec-builder";
import type { EmStateV2, SequentialStateV2, CommandBehaviorV2 } from "@/types/spec-contract-v2";

// ---------------------------------------------------------------------------
// Equipment-module-level validation
// ---------------------------------------------------------------------------

/**
 * Validate one equipment module against its OWN authored states (hybrid state
 * model). `emStates` are this EM's states (EmStateV2.kind = static | sequential);
 * static/sequential behaviour is keyed by the EM-local state_id.
 */
export function validateEquipmentModule(
  equipment_module: EquipmentModuleConfig,
  staticStates: Record<string, ControlModuleStateEntry[]>,
  sequentialStates: Record<string, SequentialStateV2>,
  emStates: EmStateV2[],
  allTags: InstrumentTag[],
  commandBehavior: Record<string, CommandBehaviorV2> = {},
): FdsValidationResult {
  const issues: FdsValidationIssue[] = [];

  // Collect this equipment_module's tags
  const equipment_moduleTagNames = new Set<string>();
  for (const dev of equipment_module.control_modules) {
    for (const sig of dev.io_signals) {
      equipment_moduleTagNames.add(sig.tag);
    }
  }

  const equipment_moduleTags = allTags.filter((t) => equipment_moduleTagNames.has(t.tag));
  const outputTags = equipment_moduleTags.filter((t) => t.signal_direction === "DO" || t.signal_direction === "AO");
  const allTagNames = new Set(allTags.map((t) => t.tag));

  const staticStateIds = emStates.filter((s) => s.kind === "static");
  const sequentialStateIds = emStates.filter((s) => s.kind === "sequential");

  // --- Check 1: Tag coverage in static states ---
  for (const state of staticStateIds) {
    const entries = staticStates[state.state_id] ?? [];
    const coveredTags = new Set(entries.map((e) => e.tag));

    for (const tag of outputTags) {
      if (!coveredTags.has(tag.tag)) {
        issues.push({
          severity: "error",
          category: "tag_coverage",
          message: `Output tag ${tag.tag} missing from ${state.name} device state table`,
          equipment_module_id: equipment_module.equipment_module_id,
          state_id: state.state_id,
          tag: tag.tag,
        });
      }
    }
  }

  // --- Check 2: State completeness for sequential states ---
  // Sequential states are completed EITHER via authored steps (Checks 3/4
  // below) OR via SP-3c command_behavior (branches + default_hold) for
  // command-driven states (e.g. "execute" on a manually-jogged motion). The
  // two are mutually exclusive by design — enforced at persist by
  // use-fds-conversation.ts's steps-XOR-branches routing — so a state with
  // branches authored is complete without steps.
  for (const state of sequentialStateIds) {
    const data = sequentialStates[state.state_id];
    const cb = commandBehavior[state.state_id];

    if (data && data.steps.length > 0) {
      // Steps path — fall through to Checks 3/4 below.
    } else if (cb && cb.branches.length > 0) {
      // --- Check 2b: command_behavior tag references ---
      for (const branch of cb.branches) {
        for (const w of branch.when) {
          if (w.tag && !allTagNames.has(w.tag)) {
            issues.push({
              severity: "warning",
              category: "permissive_ref",
              message: `Command branch "${branch.label}" when-tag "${w.tag}" is not in the instrument register`,
              equipment_module_id: equipment_module.equipment_module_id,
              state_id: state.state_id,
            });
          }
        }
        for (const d of branch.control_modules) {
          if (d.tag && !allTagNames.has(d.tag)) {
            issues.push({
              severity: "warning",
              category: "permissive_ref",
              message: `Command branch "${branch.label}" control module tag "${d.tag}" is not in the instrument register`,
              equipment_module_id: equipment_module.equipment_module_id,
              state_id: state.state_id,
            });
          }
        }
      }
      for (const d of cb.default_hold) {
        if (d.tag && !allTagNames.has(d.tag)) {
          issues.push({
            severity: "warning",
            category: "permissive_ref",
            message: `Command hold tag "${d.tag}" is not in the instrument register`,
            equipment_module_id: equipment_module.equipment_module_id,
            state_id: state.state_id,
          });
        }
      }
      continue;
    } else {
      issues.push({
        severity: "error",
        category: "state_completeness",
        message: `No steps or command branches defined for ${state.name}`,
        equipment_module_id: equipment_module.equipment_module_id,
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
          equipment_module_id: equipment_module.equipment_module_id,
          state_id: state.state_id,
        });
      } else if (!perm.tag) {
        issues.push({
          severity: "warning",
          category: "permissive_ref",
          message: "Permissive has no tag selected",
          equipment_module_id: equipment_module.equipment_module_id,
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
          equipment_module_id: equipment_module.equipment_module_id,
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
          equipment_module_id: equipment_module.equipment_module_id,
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
          equipment_module_id: equipment_module.equipment_module_id,
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

// ---------------------------------------------------------------------------
// ISA-88 compliance validation
// ---------------------------------------------------------------------------

/**
 * Validate ISA-88 Part 1 compliance across the physical hierarchy
 * and optional Process Model.
 *
 * Checks:
 * 1. Every control module assigned to exactly one equipment module
 * 2. Every equipment module assigned to exactly one unit
 * 3. Process Model stage→unit and operation→equipment_module refs are valid
 * 4. Process Model stages cover all units
 * 5. No legacy terminology in free-text fields
 */
export function validateIsa88Compliance(
  units: UnitConfig[],
  processModel: ProcessModel | null,
): FdsValidationResult {
  const issues: FdsValidationIssue[] = [];
  const activeUnits = units.filter((u) => !u.excluded);

  // --- Check 1: Every control module appears in exactly one equipment module ---
  const cmAssignments = new Map<string, string[]>();
  for (const unit of activeUnits) {
    for (const em of unit.equipment_modules) {
      for (const cm of em.control_modules) {
        const key = cm.control_module_id;
        if (!cmAssignments.has(key)) cmAssignments.set(key, []);
        cmAssignments.get(key)!.push(
          `${unit.unit_name}/${em.equipment_module_name}`,
        );
      }
    }
  }
  for (const [cmId, locations] of cmAssignments) {
    if (locations.length > 1) {
      issues.push({
        severity: "error",
        category: "isa88_compliance",
        message: `Control Module "${cmId}" assigned to multiple Equipment Modules: ${locations.join(", ")}`,
      });
    }
  }

  // --- Check 2: Empty equipment modules (no control modules) ---
  for (const unit of activeUnits) {
    for (const em of unit.equipment_modules) {
      if (em.control_modules.length === 0) {
        issues.push({
          severity: "warning",
          category: "isa88_compliance",
          message: `Equipment Module "${em.equipment_module_name}" in Unit "${unit.unit_name}" has no Control Modules`,
          equipment_module_id: em.equipment_module_id,
        });
      }
    }
  }

  // --- Check 3: Units with no equipment modules ---
  for (const unit of activeUnits) {
    if (unit.equipment_modules.length === 0) {
      issues.push({
        severity: "warning",
        category: "isa88_compliance",
        message: `Unit "${unit.unit_name}" has no Equipment Modules`,
      });
    }
  }

  // --- Process Model checks (if present) ---
  if (processModel) {
    const validUnitIds = new Set(activeUnits.map((u) => u.unit_id));
    const validEmIds = new Set(
      activeUnits.flatMap((u) =>
        u.equipment_modules.map((em) => em.equipment_module_id),
      ),
    );
    const coveredUnitIds = new Set<string>();

    for (const stage of processModel.stages) {
      // Check 3a: stage references valid unit
      if (!validUnitIds.has(stage.unit_id)) {
        issues.push({
          severity: "error",
          category: "isa88_compliance",
          message: `Process Stage "${stage.stage_name}" references unknown Unit "${stage.unit_id}"`,
        });
      } else {
        coveredUnitIds.add(stage.unit_id);
      }

      for (const op of stage.operations) {
        // Check 3b: operation references valid equipment module
        if (!validEmIds.has(op.equipment_module_id)) {
          issues.push({
            severity: "error",
            category: "isa88_compliance",
            message: `Process Operation "${op.operation_name}" references unknown Equipment Module "${op.equipment_module_id}"`,
            equipment_module_id: op.equipment_module_id,
          });
        }
      }
    }

    // Check 4: all units covered by process model
    for (const unit of activeUnits) {
      if (!coveredUnitIds.has(unit.unit_id)) {
        issues.push({
          severity: "info",
          category: "isa88_compliance",
          message: `Unit "${unit.unit_name}" not covered by any Process Stage`,
        });
      }
    }

    // Check 5: duplicate stage orders
    const orderCounts = new Map<number, string[]>();
    for (const stage of processModel.stages) {
      if (!orderCounts.has(stage.order)) orderCounts.set(stage.order, []);
      orderCounts.get(stage.order)!.push(stage.stage_name);
    }
    for (const [order, names] of orderCounts) {
      if (names.length > 1) {
        issues.push({
          severity: "warning",
          category: "isa88_compliance",
          message: `Multiple Process Stages share order ${order}: ${names.join(", ")}`,
        });
      }
    }
  }

  // --- Check 6: legacy terminology in descriptions ---
  const legacyTerms = [
    { pattern: /\bsubsystem\b/i, replacement: "Unit" },
    { pattern: /\bassembly\b/i, replacement: "Equipment Module" },
  ];

  for (const unit of activeUnits) {
    for (const term of legacyTerms) {
      if (term.pattern.test(unit.description)) {
        issues.push({
          severity: "info",
          category: "isa88_compliance",
          message: `Unit "${unit.unit_name}" description uses legacy term — use "${term.replacement}" instead`,
        });
      }
    }
    for (const em of unit.equipment_modules) {
      for (const term of legacyTerms) {
        if (term.pattern.test(em.description)) {
          issues.push({
            severity: "info",
            category: "isa88_compliance",
            message: `Equipment Module "${em.equipment_module_name}" description uses legacy term — use "${term.replacement}" instead`,
            equipment_module_id: em.equipment_module_id,
          });
        }
      }
    }
  }

  return {
    passed: issues.filter((i) => i.severity === "error").length === 0,
    checked_at: new Date().toISOString(),
    issues,
  };
}

