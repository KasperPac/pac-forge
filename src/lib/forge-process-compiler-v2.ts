/**
 * Wave D — SFC-aware process compiler.
 *
 * Walks a `SequentialStateV2` graph (SFC model, sequence_model_version === 2)
 * and emits SCL. The legacy compiler (`forge-process-compiler.ts`) stays in
 * place for v1 `ProcessSequence` rows — this module is opt-in for v2 callers.
 *
 * Output shape (per state):
 *
 *   CASE "Inst<Assembly>_stateVar" OF
 *     "Inst<Assembly>_Step_<name>":
 *       <actions>
 *       IF <guard> THEN "Inst<Assembly>_stateVar" := <next>; END_IF;
 *     ...
 *   END_CASE;
 *
 *   (* state-level monitors — run every scan *)
 *   IF <monitor.condition> THEN ... END_IF;
 *
 * Multiple branches emit one CASE each, sharing the same state variable
 * name suffixed with the branch id.
 *
 * Placeholder expressions / criteria abort the whole state compile — the
 * caller decides whether to surface that as a contract-level failure or
 * just a per-equipment_module failure. See `compileSequentialStateV2`.
 */
import type {
  ActionV2,
  EquipmentModuleContract,
  BranchV2,
  CompletionCriterion,
  Expression,
  MonitorV2,
  SequentialStateV2,
  SpecContractV2,
  PhaseStep,
  TransitionV2,
} from "@/types/spec-contract-v2";
import { ensureV2 } from "@/lib/spec-builder/sequence-legacy-shim";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export interface UnresolvedPlaceholderError {
  kind: "unresolved_placeholder";
  equipment_module_id: string;
  state_id: string;
  step_id: string | null;
  action_id: string | null;
  path: string;
  prompt: string;
}

export interface ValidationError {
  kind: "validation";
  equipment_module_id: string;
  state_id: string;
  message: string;
}

export type SequenceCompileError =
  | UnresolvedPlaceholderError
  | ValidationError;

export type SequenceCompileResult =
  | { ok: true; scl: string }
  | { ok: false; errors: SequenceCompileError[] };

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface CompileV2Context {
  /** Optional FB template lookup (id → declared instance name). */
  fbTemplateInstanceName?: (fbTemplateId: string) => string | undefined;
}

/**
 * Compile a single sequential state from a contract. Walks
 * `contract.equipment_modules[equipment_moduleId].sequential_states[stateId]`.
 *
 * Returns SCL on success, or a list of errors (placeholder / validation).
 */
export function compileSequentialStateV2(
  contract: SpecContractV2,
  stateId: string,
  equipment_moduleId: string,
  ctx: CompileV2Context = {},
): SequenceCompileResult {
  const equipment_module = contract.equipment_modules[equipment_moduleId] as
    | EquipmentModuleContract
    | undefined;
  if (!equipment_module) {
    return {
      ok: false,
      errors: [
        {
          kind: "validation",
          equipment_module_id: equipment_moduleId,
          state_id: stateId,
          message: `equipment_module ${equipment_moduleId} not found in contract`,
        },
      ],
    };
  }

  const rawState = equipment_module.sequential_states[stateId];
  if (!rawState) {
    return {
      ok: false,
      errors: [
        {
          kind: "validation",
          equipment_module_id: equipment_moduleId,
          state_id: stateId,
          message: `state ${stateId} not found on equipment_module ${equipment_moduleId}`,
        },
      ],
    };
  }

  // Defensive: if someone passes v1 data, upgrade it in memory so the
  // compiler can run without blowing up.
  const state: SequentialStateV2 = ensureV2(rawState, stateId);

  const equipment_moduleName = resolveAssemblyName(contract, equipment_moduleId) ?? equipment_moduleId;
  const instPrefix = `Inst${sanitizeIdent(equipment_moduleName)}`;
  const stateVarQualified = `"${instPrefix}_stateVar"`;

  const errors: SequenceCompileError[] = [];
  const lines: string[] = [];

  const branches = deriveBranches(state);

  for (const branch of branches) {
    const branchSteps = state.steps.filter(
      (s) => (s.branch_id ?? "main") === branch.branch_id,
    );
    if (branchSteps.length === 0) continue;

    lines.push(`(* Branch: ${branch.name} *)`);
    lines.push(`CASE ${stateVarQualified} OF`);

    for (const step of branchSteps) {
      const stepLabel = `"${instPrefix}_Step_${sanitizeIdent(step.step_id ?? "unknown")}"`;
      lines.push(`  ${stepLabel}:  (* ${step.name ?? step.action} *)`);

      // --- Actions ---
      if (step.actions && step.actions.length > 0) {
        for (const action of step.actions) {
          const rendered = renderAction(action, {
            equipment_module_id: equipment_moduleId,
            state_id: stateId,
            step_id: step.step_id ?? null,
            ctx,
            errors,
          });
          for (const l of rendered) lines.push(`    ${l}`);
        }
      } else {
        lines.push(`    (* no actions *)`);
      }

      // --- Transitions (priority order) ---
      const transitions = [...(step.transitions ?? [])].sort(
        (a, b) => a.priority - b.priority,
      );
      if (transitions.length > 0) {
        lines.push(`    (* Transitions *)`);
        transitions.forEach((tr, idx) => {
          const guardExpr = renderGuard(tr.guard, {
            equipment_module_id: equipment_moduleId,
            state_id: stateId,
            step_id: step.step_id ?? null,
            errors,
          });
          const keyword = idx === 0 ? "IF" : "ELSIF";
          lines.push(`    ${keyword} ${guardExpr} THEN`);
          for (const assign of renderTransitionTargets(tr, instPrefix, stateVarQualified)) {
            lines.push(`      ${assign}`);
          }
          if (tr.on_fail) {
            lines.push(
              `      (* on_fail → fault ${tr.on_fail.fault_code} (${tr.on_fail.severity}) *)`,
            );
          }
        });
        lines.push(`    END_IF;`);
      }

      // --- Step monitors ---
      if (step.monitors && step.monitors.length > 0) {
        lines.push(`    (* Step monitors *)`);
        for (const mon of step.monitors) {
          for (const l of renderMonitor(mon, instPrefix, stateVarQualified, {
            equipment_module_id: equipment_moduleId,
            state_id: stateId,
            step_id: step.step_id ?? null,
            errors,
          })) {
            lines.push(`    ${l}`);
          }
        }
      }

      lines.push("");
    }

    lines.push(`END_CASE;`);
    lines.push("");
  }

  // --- State-level monitors (always-on) ---
  if (state.state_monitors && state.state_monitors.length > 0) {
    lines.push(`(* State monitors — evaluated every scan *)`);
    for (const mon of state.state_monitors) {
      for (const l of renderMonitor(mon, instPrefix, stateVarQualified, {
        equipment_module_id: equipment_moduleId,
        state_id: stateId,
        step_id: null,
        errors,
      })) {
        lines.push(l);
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, scl: lines.join("\n") };
}

// ---------------------------------------------------------------------------
// Branch derivation
// ---------------------------------------------------------------------------

function deriveBranches(state: SequentialStateV2): BranchV2[] {
  if (Array.isArray(state.branches) && state.branches.length > 0) {
    return state.branches;
  }
  // Fallback: synthesise a main branch from step.branch_id fingerprint.
  const ids = new Set<string>();
  for (const s of state.steps) ids.add(s.branch_id ?? "main");
  return Array.from(ids).map((id) => ({
    branch_id: id,
    name: id,
    kind: id === "main" ? "main" : "parallel",
    fork_step_id: state.steps[0]?.step_id ?? "",
  }));
}

// ---------------------------------------------------------------------------
// Action rendering (all 9 kinds)
// ---------------------------------------------------------------------------

interface EmitCtx {
  equipment_module_id: string;
  state_id: string;
  step_id: string | null;
  errors: SequenceCompileError[];
  ctx?: CompileV2Context;
}

function renderAction(action: ActionV2, ec: EmitCtx): string[] {
  switch (action.kind) {
    case "assign": {
      const rhs = renderExpression(action.source, {
        ...ec,
        pathHint: `action:${action.action_id}.source`,
      });
      return [`"${action.target_tag}" := ${rhs};`];
    }
    case "call_fb": {
      const instance =
        ec.ctx?.fbTemplateInstanceName?.(action.fb_template_id) ??
        action.instance_name;
      const paramPairs = Object.entries(action.params).map(([name, expr]) => {
        const val = renderExpression(expr, {
          ...ec,
          pathHint: `action:${action.action_id}.params.${name}`,
        });
        return `${name} := ${val}`;
      });
      if (paramPairs.length === 0) {
        return [`"${instance}"();`];
      }
      return [`"${instance}"(${paramPairs.join(", ")});`];
    }
    case "start_timer": {
      const preset = renderExpression(action.preset_ms, {
        ...ec,
        pathHint: `action:${action.action_id}.preset_ms`,
      });
      // Preset may be a literal number (ms) or an expression.
      const pt = formatTimerPreset(preset);
      return [`"${action.timer_tag}"(IN := TRUE, PT := ${pt});`];
    }
    case "stop_timer":
    case "reset_timer":
      return [`"${action.timer_tag}"(IN := FALSE, PT := T#0ms);`];
    case "incr_counter": {
      const by = action.by
        ? renderExpression(action.by, {
            ...ec,
            pathHint: `action:${action.action_id}.by`,
          })
        : "1";
      return [`"${action.counter_tag}" := "${action.counter_tag}" + ${by};`];
    }
    case "reset_counter":
      return [`"${action.counter_tag}" := 0;`];
    case "raise_alarm":
      return [`"${action.alarm_tag}" := TRUE;`];
    case "manual_prose":
      return [`(* MANUAL: ${escapeComment(action.text)} *)`];
    default: {
      const _exhaustive: never = action;
      void _exhaustive;
      return [`(* unknown action *)`];
    }
  }
}

/** Timer preset is an Expression. If it's a literal number, emit T#<N>ms. */
function formatTimerPreset(rendered: string): string {
  const asNum = Number(rendered);
  if (!Number.isNaN(asNum) && Number.isFinite(asNum)) {
    return `T#${Math.round(asNum)}ms`;
  }
  // Assume the engineer put a TIME literal or a DInt ms value wrapped appropriately.
  return rendered;
}

// ---------------------------------------------------------------------------
// Expression rendering (5 kinds)
// ---------------------------------------------------------------------------

function renderExpression(
  expr: Expression,
  ec: EmitCtx & { pathHint: string },
): string {
  switch (expr.kind) {
    case "tag_ref":
      return `"${expr.tag}"`;
    case "hmi_ref":
      return `"${expr.hmi_tag}"`;
    case "literal":
      return renderLiteral(expr.value, expr.value_type);
    case "expr_text":
      return expr.text;
    case "placeholder":
      ec.errors.push({
        kind: "unresolved_placeholder",
        equipment_module_id: ec.equipment_module_id,
        state_id: ec.state_id,
        step_id: ec.step_id,
        action_id: null,
        path: ec.pathHint,
        prompt: expr.prompt,
      });
      return `/* PLACEHOLDER: ${escapeComment(expr.prompt)} */`;
    case "parameter_ref":
      // Phase 1: parameter_ref values are not yet substituted by the compiler.
      // Parameter resolution (defaults, project-specific overrides) is a future
      // pipeline stage. Surface as a validation error so the caller knows the
      // emitted SCL is incomplete; emit a TBD comment so the surrounding code
      // remains syntactically inspectable.
      ec.errors.push({
        kind: "validation",
        equipment_module_id: ec.equipment_module_id,
        state_id: ec.state_id,
        message: `parameter_ref expression at ${ec.pathHint} (parameter_id=${expr.parameter_id}) is not yet supported by the compiler`,
      });
      return `/* PARAMETER_REF: ${escapeComment(expr.parameter_id)} */`;
    default: {
      const _exhaustive: never = expr;
      void _exhaustive;
      return `/* unknown expression */`;
    }
  }
}

function renderLiteral(
  value: string | number | boolean,
  type: "string" | "number" | "boolean",
): string {
  if (type === "boolean") return value ? "TRUE" : "FALSE";
  if (type === "number") return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// Completion-criterion rendering (5 kinds)
// ---------------------------------------------------------------------------

function renderGuard(
  guard: CompletionCriterion[],
  ec: EmitCtx,
): string {
  if (!guard || guard.length === 0) return "TRUE";
  const parts = guard.map((g, i) =>
    renderCriterion(g, { ...ec, pathHint: `guard[${i}]` }),
  );
  return parts.length === 1 ? parts[0] : parts.map((p) => `(${p})`).join(" AND ");
}

function renderCriterion(
  c: CompletionCriterion,
  ec: EmitCtx & { pathHint: string },
): string {
  switch (c.kind) {
    case "tag_equals": {
      const rhs = renderLiteral(c.value, typeof c.value === "boolean"
        ? "boolean"
        : typeof c.value === "number" ? "number" : "string");
      return `"${c.tag}" = ${rhs}`;
    }
    case "tag_compare":
      return `"${c.tag}" ${normaliseOp(c.op)} ${c.value}`;
    case "expression":
      return c.text;
    case "manual_ack":
      return `TRUE (* MANUAL ACK: ${escapeComment(c.prompt)} *)`;
    case "placeholder":
      ec.errors.push({
        kind: "unresolved_placeholder",
        equipment_module_id: ec.equipment_module_id,
        state_id: ec.state_id,
        step_id: ec.step_id,
        action_id: null,
        path: ec.pathHint,
        prompt: c.prompt,
      });
      return `FALSE /* PLACEHOLDER: ${escapeComment(c.prompt)} */`;
    default: {
      const _exhaustive: never = c;
      void _exhaustive;
      return `FALSE`;
    }
  }
}

function normaliseOp(op: "<" | "<=" | ">" | ">=" | "=="): string {
  // SCL uses `=` for equality, not `==`.
  return op === "==" ? "=" : op;
}

// ---------------------------------------------------------------------------
// Transition & monitor rendering
// ---------------------------------------------------------------------------

function renderTransitionTargets(
  tr: TransitionV2,
  instPrefix: string,
  stateVarQualified: string,
): string[] {
  if (tr.kind === "single") {
    return [
      `${stateVarQualified} := "${instPrefix}_Step_${sanitizeIdent(tr.target_step_id)}";`,
    ];
  }
  // parallel — SFC AND-split. Emit one assignment per branch's step variable.
  // The multi-branch state machine uses a state var per branch; here we
  // conservatively emit comments + the main assignment to the first target
  // (full AND-split needs per-branch state vars Wave C hasn't wired).
  return tr.target_step_ids.map(
    (t, i) =>
      `${stateVarQualified}_b${i} := "${instPrefix}_Step_${sanitizeIdent(t)}"; (* parallel split *)`,
  );
}

function renderMonitor(
  mon: MonitorV2,
  instPrefix: string,
  stateVarQualified: string,
  ec: EmitCtx,
): string[] {
  const cond = renderCriterion(mon.condition, {
    ...ec,
    pathHint: `monitor:${mon.monitor_id}.condition`,
  });
  const body: string[] = [];

  switch (mon.effect) {
    case "alarm":
      body.push(
        `(* alarm, priority ${mon.priority}${mon.fault_ref ? ` → ${mon.fault_ref.fault_code}` : ""} *)`,
      );
      if (mon.fault_ref) body.push(`"${mon.fault_ref.fault_code}" := TRUE;`);
      break;
    case "fault":
      body.push(`(* fault, priority ${mon.priority} *)`);
      if (mon.fault_ref) body.push(`"${mon.fault_ref.fault_code}" := TRUE;`);
      body.push(`${stateVarQualified} := "${instPrefix}_Fault";`);
      break;
    case "hold":
      body.push(`(* hold, priority ${mon.priority} *)`);
      body.push(`${stateVarQualified} := "${instPrefix}_Hold";`);
      break;
    case "branch_to":
      if (mon.target_step_id) {
        body.push(
          `${stateVarQualified} := "${instPrefix}_Step_${sanitizeIdent(mon.target_step_id)}"; (* branch_to *)`,
        );
      }
      break;
  }

  return [
    `IF ${cond} THEN`,
    ...body.map((l) => `  ${l}`),
    `END_IF;`,
  ];
}

// ---------------------------------------------------------------------------
// Identifier / name helpers
// ---------------------------------------------------------------------------

function sanitizeIdent(s: string): string {
  return (s ?? "").replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+/, "");
}

function escapeComment(s: string): string {
  return (s ?? "").replace(/\*\)/g, "* )");
}

function resolveAssemblyName(
  contract: SpecContractV2,
  equipment_moduleId: string,
): string | undefined {
  for (const sub of contract.hierarchy.units) {
    for (const asy of sub.equipment_modules) {
      if (asy.equipment_module_id === equipment_moduleId) return asy.equipment_module_name;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Unused re-exports for callers that want the narrow types.
// ---------------------------------------------------------------------------

// ts re-exports (avoid circular import of runtime values).
export type { PhaseStep };
