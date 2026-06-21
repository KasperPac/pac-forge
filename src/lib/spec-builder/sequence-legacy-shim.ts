/**
 * Wave D — legacy v1 → SFC v2 read-time shim.
 *
 * Used by the co-author UI and v2 consumers during the transition window
 * when some DB rows are still v1 (migration 068 not yet run, or a new
 * session was created against old writer code paths).
 *
 * `ensureV2(state)` inspects a `SequentialStateV2` value as it sits in
 * memory and, if it's still v1-shaped, returns an upgraded copy that
 * matches the v2 contract:
 *   - every step has `step_id`, `branch_id: "main"`, `actions[]`,
 *     `monitors[]`, `transitions[]`
 *   - the state carries `branches[]`, `state_monitors[]`,
 *     `sequence_model_version: 2`
 *
 * The shim is deliberately pure — no IO, no randomness outside stable
 * synthetic IDs (so rerunning it on the same input produces the same
 * output and the UI doesn't thrash). Matches the DB-side rewrite in
 * migration 068.
 */
import type {
  ActionV2,
  BranchV2,
  CompletionCriterion,
  FaultRef,
  FaultSeverity,
  MonitorV2,
  PermissiveCondition,
  PermissiveOperator,
  PermissiveValue,
  SequentialStateV2,
  PhaseStep,
  TransitionV2,
} from "@/types/spec-contract-v2";

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** Tiny deterministic hash → hex string. Not crypto — just stable IDs. */
function stableHash(input: string): string {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  // Expand to 32 hex chars by hashing twice with salts.
  const hex1 = (h >>> 0).toString(16).padStart(8, "0");
  let h2 = FNV_OFFSET;
  const salted = `${input}::round2`;
  for (let i = 0; i < salted.length; i++) {
    h2 ^= salted.charCodeAt(i);
    h2 = Math.imul(h2, FNV_PRIME);
  }
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return (hex1 + hex2 + hex1 + hex2).slice(0, 32);
}

function uuidish(seed: string): string {
  const h = stableHash(seed);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function stepIdFor(stateId: string, stepNumber: number): string {
  return uuidish(`step::${stateId}::${stepNumber}`);
}

function faultStepIdFor(stateId: string): string {
  return uuidish(`fault::${stateId}`);
}

function actionIdFor(stateId: string, stepNumber: number): string {
  return uuidish(`action::${stateId}::${stepNumber}`);
}

function transitionIdFor(stateId: string, stepNumber: number, suffix: string): string {
  return uuidish(`trans::${stateId}::${stepNumber}::${suffix}`);
}

/**
 * Parse a legacy free-text permissive string into a structured PermissiveCondition.
 * Handles forms like: "TAG = TRUE", "TAG != FALSE", "TAG > 50", "TAG = P_TRIG".
 * Returns null if the string can't be parsed (will be dropped).
 */
function parseStringPermissive(s: string): PermissiveCondition | null {
  const m = s.match(/^(\S+)\s*(>=|<=|!=|=|>|<)\s*(\S+)/);
  if (!m) return null;
  const [, tag, operator, rawValue] = m;
  let value: PermissiveValue;
  const upper = rawValue.toUpperCase();
  if (upper === "TRUE") value = true;
  else if (upper === "FALSE") value = false;
  else if (upper === "P_TRIG") value = "P_TRIG";
  else if (upper === "N_TRIG") value = "N_TRIG";
  else {
    const n = Number(rawValue);
    if (!isNaN(n)) value = n;
    else return null;
  }
  return { tag, operator: operator as PermissiveOperator, value };
}

/** Migrate a permissives array — converts legacy strings to PermissiveCondition objects. */
function migratePermissives(
  raw: unknown,
): PermissiveCondition[] {
  if (!Array.isArray(raw)) return [];
  const result: PermissiveCondition[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      const parsed = parseStringPermissive(item);
      if (parsed) result.push(parsed);
    } else if (item && typeof item === "object" && "tag" in item && "operator" in item && "value" in item) {
      result.push(item as PermissiveCondition);
    }
  }
  return result;
}

function isV2Step(step: PhaseStep): boolean {
  return (
    typeof step.step_id === "string" &&
    step.step_id.length > 0 &&
    Array.isArray(step.transitions) &&
    Array.isArray(step.actions)
  );
}

// AI emits this v2-authoring shape per the FDS interview system prompt:
//   step.outputs[]  = [{ tag, value }]
//   step.branches[] = [{ conditions: [{ tag, op, value, within_ms?, on_fail_code?, on_fail_severity? }], next_step }]
// next_step === 0 means end-of-state (DONE) — encoded as target_step_id: "".
interface AiAuthoringOutput {
  tag: string;
  value: unknown;
}
interface AiAuthoringCondition {
  tag: string;
  op?: string;
  value: unknown;
  within_ms?: number;
  on_fail_code?: string;
  on_fail_severity?: FaultSeverity;
}
interface AiAuthoringBranch {
  conditions?: AiAuthoringCondition[];
  next_step?: number;
}

function coerceLiteral(raw: unknown): string | number | boolean {
  if (typeof raw === "boolean" || typeof raw === "number") return raw;
  const s = String(raw ?? "").trim();
  const upper = s.toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE") return false;
  const n = Number(s);
  if (!Number.isNaN(n) && s !== "") return n;
  return s;
}

function literalValueType(v: string | number | boolean): "string" | "number" | "boolean" {
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "number") return "number";
  return "string";
}

function aiOutputToAssignAction(
  out: AiAuthoringOutput,
  stateId: string,
  stepNum: number,
  outIdx: number,
): ActionV2 {
  const value = coerceLiteral(out.value);
  return {
    kind: "assign",
    action_id: uuidish(`assign::${stateId}::${stepNum}::${outIdx}::${out.tag}`),
    target_tag: String(out.tag ?? ""),
    source: { kind: "literal", value, value_type: literalValueType(value) },
    prose: `${out.tag} := ${out.value}`,
  };
}

function aiConditionToCriterion(c: AiAuthoringCondition): CompletionCriterion {
  const value = coerceLiteral(c.value);
  const on_fail: FaultRef | undefined = c.on_fail_code
    ? { fault_code: c.on_fail_code, severity: c.on_fail_severity ?? "fault" }
    : undefined;
  const op = c.op ?? "=";
  // Numeric comparisons → tag_compare; equality / inequality / unset → tag_equals (with text fallback for !=).
  if ((op === ">" || op === ">=" || op === "<" || op === "<=") && typeof value === "number") {
    return { kind: "tag_compare", tag: c.tag, op, value, within_ms: c.within_ms, on_fail };
  }
  if (op === "!=") {
    // No tag_not_equals variant — encode as expression so semantics survive.
    return {
      kind: "expression",
      text: `${c.tag} != ${typeof value === "string" ? value : JSON.stringify(value)}`,
      referenced_tags: [c.tag],
      within_ms: c.within_ms,
      on_fail,
    };
  }
  return { kind: "tag_equals", tag: c.tag, value, within_ms: c.within_ms, on_fail };
}

function hasAiAuthoringFields(step: unknown): step is { outputs?: AiAuthoringOutput[]; branches?: AiAuthoringBranch[] } {
  if (!step || typeof step !== "object") return false;
  const s = step as Record<string, unknown>;
  return Array.isArray(s.outputs) || Array.isArray(s.branches);
}

/**
 * Detect when steps need upgrading.
 *
 * The version flag alone isn't sufficient: each AI turn replaces `steps[]`
 * with fresh authoring-shape entries (no step_id / transitions / actions),
 * but `sequence_model_version` carries over from the previous merge. So we
 * upgrade whenever the first step actually lacks v2 fields, regardless of
 * the marker.
 */
function needsUpgrade(state: SequentialStateV2): boolean {
  if (!Array.isArray(state.steps) || state.steps.length === 0) {
    return state.sequence_model_version !== 2;
  }
  return !isV2Step(state.steps[0]);
}

/** Pick the transition that drives the happy path (legacy completion source). */
function pickDefaultTransition(
  transitions: TransitionV2[] | undefined,
): TransitionV2 | undefined {
  if (!Array.isArray(transitions) || transitions.length === 0) return undefined;
  return transitions.find((t) => t.is_default) ?? transitions[0];
}

/** A criterion's on_fail (only some criterion kinds carry one). */
function criterionFaultRef(c: CompletionCriterion): FaultRef | undefined {
  return "on_fail" in c ? c.on_fail : undefined;
}

/**
 * The fault a transition raises: its own `on_fail`, else the first guard
 * criterion that declares one. The model commonly nests on_fail inside the
 * guard rather than on the transition itself.
 */
function transitionFaultRef(t: TransitionV2 | undefined): FaultRef | undefined {
  if (!t) return undefined;
  if (t.on_fail) return t.on_fail;
  if (Array.isArray(t.guard)) {
    for (const c of t.guard) {
      const f = criterionFaultRef(c);
      if (f) return f;
    }
  }
  return undefined;
}

/** First action's prose (every ActionV2 variant carries `prose`). */
function actionToProse(action: ActionV2 | undefined): string {
  if (!action) return "";
  if (typeof action.prose === "string" && action.prose.length > 0) return action.prose;
  if (action.kind === "manual_prose" && action.text) return action.text;
  return "";
}

/** Human-readable rendering of a completion criterion (legacy *_text field). */
function criterionToText(c: CompletionCriterion): string {
  switch (c.kind) {
    case "tag_equals":
      return `${c.tag} = ${c.value}`;
    case "tag_compare":
      return `${c.tag} ${c.op} ${c.value}`;
    case "expression":
      return c.text;
    case "manual_ack":
      return c.prompt;
    case "placeholder":
      return c.prompt;
  }
}

function criteriaToText(criteria: CompletionCriterion[]): string {
  return criteria.map(criterionToText).filter(Boolean).join(" AND ");
}

/** Step number from a v2 step: trailing digits of step_id, else 1-based index. */
function deriveStepNumber(step: PhaseStep, idx: number): number {
  if (typeof step.step === "number" && Number.isInteger(step.step) && step.step > 0) {
    return step.step;
  }
  const m = typeof step.step_id === "string" ? step.step_id.match(/(\d+)\s*$/) : null;
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isInteger(n) && n > 0) return n;
  }
  return idx + 1;
}

/**
 * Back-fill the required legacy v1 fields on an already-v2 step.
 *
 * The Stage-B FDS prompt instructs the model to emit the full SFC shape
 * (step_id + actions[] + transitions[]) with NO legacy fields, but
 * PhaseStepSchema still REQUIRES step / action / completion_criteria /
 * completion_criteria_text (the DOCX exporter reads them). `ensureV2` only
 * synthesises those while UPGRADING a v1 step; it skips an already-v2 step via
 * `isV2Step`. Without this back-fill, every model-authored sequential state
 * fails validation for every project. Derivation is deterministic and additive:
 *   - step                     ← trailing digits of step_id, else 1-based index
 *   - action                   ← first action's prose, else step name
 *   - completion_criteria      ← the default transition's guard
 *   - completion_criteria_text ← prose for that guard
 *   - on_fail                  ← the default transition's on_fail (if present)
 */
function backfillLegacyFields(step: PhaseStep, idx: number): PhaseStep {
  const hasAll =
    typeof step.step === "number" &&
    typeof step.action === "string" &&
    Array.isArray(step.completion_criteria) &&
    typeof step.completion_criteria_text === "string";
  if (hasAll) return step;

  const def = pickDefaultTransition(step.transitions);
  const completion_criteria: CompletionCriterion[] = Array.isArray(step.completion_criteria)
    ? step.completion_criteria
    : Array.isArray(def?.guard)
    ? def.guard
    : [];
  const stepNum = deriveStepNumber(step, idx);
  const firstAction = Array.isArray(step.actions) ? step.actions[0] : undefined;
  const action =
    typeof step.action === "string" && step.action.length > 0
      ? step.action
      : actionToProse(firstAction) || step.name || `Step ${stepNum}`;
  const completion_criteria_text =
    typeof step.completion_criteria_text === "string" &&
    step.completion_criteria_text.length > 0
      ? step.completion_criteria_text
      : criteriaToText(completion_criteria);
  const on_fail = step.on_fail ?? transitionFaultRef(def);

  return {
    ...step,
    step: stepNum,
    action,
    completion_criteria,
    completion_criteria_text,
    ...(on_fail ? { on_fail } : {}),
  };
}

/**
 * Upgrade a v1 SequentialState in place-safe (returns a new object).
 * Pass `stateId` so synthetic IDs are stable across re-invocations.
 */
export function ensureV2(
  state: SequentialStateV2,
  stateId = "inline",
): SequentialStateV2 {
  if (!needsUpgrade(state)) {
    // Already v2-shaped. Two additive clean-ups still apply:
    //  - legacy permissive strings → structured PermissiveCondition[]
    //  - back-fill the required legacy step fields the SFC-only prompt omits
    const migratedPerms = migratePermissives(state.permissives);
    const steps = Array.isArray(state.steps) ? state.steps : [];
    const backfilledSteps = steps.map(backfillLegacyFields);
    const permsChanged = migratedPerms !== state.permissives;
    const stepsChanged = backfilledSteps.some((s, i) => s !== steps[i]);
    if (!permsChanged && !stepsChanged) return state;
    return { ...state, permissives: migratedPerms, steps: backfilledSteps };
  }

  const legacySteps = Array.isArray(state.steps) ? state.steps : [];
  const hasFaultStep = legacySteps.some((s) => !!s.on_fail);
  const faultStepId = faultStepIdFor(stateId);

  const newSteps: PhaseStep[] = legacySteps.map((step, idx) => {
    const stepNum = step.step ?? idx + 1;
    const thisStepId = stepIdFor(stateId, stepNum);
    const nextStepId =
      idx + 1 < legacySteps.length
        ? stepIdFor(stateId, legacySteps[idx + 1].step ?? idx + 2)
        : undefined;

    const completion: CompletionCriterion[] = Array.isArray(step.completion_criteria)
      ? step.completion_criteria
      : typeof (step.completion_criteria as unknown) === "string" &&
        (step.completion_criteria as unknown as string).trim()
      ? [{ kind: "expression", text: step.completion_criteria as unknown as string, referenced_tags: [] }]
      : [];

    const aiAuthored = hasAiAuthoringFields(step);
    const aiOutputs = aiAuthored && Array.isArray(step.outputs) ? step.outputs : [];
    const aiBranches = aiAuthored && Array.isArray(step.branches) ? step.branches : [];

    const actions: ActionV2[] = [];
    actions.push({
      kind: "manual_prose",
      action_id: actionIdFor(stateId, stepNum),
      text: step.action ?? "",
      referenced_tags: [],
      prose: step.action ?? "",
    });
    aiOutputs.forEach((out, outIdx) => {
      actions.push(aiOutputToAssignAction(out, stateId, stepNum, outIdx));
    });

    const transitions: TransitionV2[] = [];
    if (aiBranches.length > 0) {
      // resolveTarget: 0 → "" (DONE), known step number → its step_id, unknown → ""
      const stepNumbers = new Set(legacySteps.map((s, i) => s.step ?? i + 1));
      aiBranches.forEach((br, brIdx) => {
        const guard = (br.conditions ?? []).map(aiConditionToCriterion);
        const next = br.next_step;
        const target = !next || next === 0
          ? ""
          : stepNumbers.has(next)
          ? stepIdFor(stateId, next)
          : "";
        // Pull on_fail off the first condition that has one — it lives on the transition in v2.
        const onFailCond = (br.conditions ?? []).find((c) => !!c.on_fail_code);
        const on_fail: FaultRef | undefined = onFailCond?.on_fail_code
          ? { fault_code: onFailCond.on_fail_code, severity: onFailCond.on_fail_severity ?? "fault" }
          : undefined;
        transitions.push({
          transition_id: transitionIdFor(stateId, stepNum, `br${brIdx}`),
          kind: "single",
          target_step_id: target,
          guard,
          priority: brIdx,
          is_default: brIdx === 0,
          ...(on_fail ? { on_fail } : {}),
          notes: null,
        });
      });
    } else if (nextStepId) {
      const happy: TransitionV2 = {
        transition_id: transitionIdFor(stateId, stepNum, "happy"),
        kind: "single",
        target_step_id: nextStepId,
        guard: completion,
        priority: 0,
        is_default: false,
        notes: null,
      };
      if (hasFaultStep && step.on_fail) {
        transitions.push(happy);
        transitions.push({
          transition_id: transitionIdFor(stateId, stepNum, "fault"),
          kind: "single",
          target_step_id: faultStepId,
          guard: [],
          priority: 1,
          is_default: false,
          on_fail: step.on_fail,
          notes: null,
        });
      } else {
        if (step.on_fail) happy.on_fail = step.on_fail;
        transitions.push(happy);
      }
    }

    const upgraded: PhaseStep = {
      step_id: thisStepId,
      branch_id: "main",
      name: step.action && step.action.length > 0
        ? step.action.slice(0, 60)
        : `Step ${stepNum}`,
      actions,
      monitors: [],
      transitions,
      // Retain legacy fields — they're still on the schema.
      step: stepNum,
      action: step.action ?? "",
      completion_criteria: completion,
      completion_criteria_text: step.completion_criteria_text ?? "",
      on_fail: step.on_fail,
    };
    return upgraded;
  });

  if (hasFaultStep) {
    newSteps.push({
      step_id: faultStepId,
      branch_id: "main",
      name: "Fault",
      actions: [
        {
          kind: "manual_prose",
          action_id: actionIdFor(stateId, 0),
          text: "Fault handling — engineer authored",
          referenced_tags: [],
          prose: "Fault handling — engineer authored",
        },
      ],
      monitors: [],
      transitions: [],
      step: 9999,
      action: "Fault handling",
      completion_criteria: [],
      completion_criteria_text: "",
    });
  }

  const branches: BranchV2[] = [
    {
      branch_id: "main",
      name: "Main",
      kind: "main",
      fork_step_id: newSteps[0]?.step_id ?? stepIdFor(stateId, 1),
    },
  ];

  const stateMonitors: MonitorV2[] = Array.isArray(state.state_monitors)
    ? state.state_monitors
    : [];

  return {
    ...state,
    permissives: migratePermissives(state.permissives),
    steps: newSteps,
    branches: Array.isArray(state.branches) ? state.branches : branches,
    state_monitors: stateMonitors,
    sequence_model_version: 2,
  };
}

/** Convenience: upgrade every state in a record. */
export function ensureV2Record(
  states: Record<string, SequentialStateV2>,
): Record<string, SequentialStateV2> {
  const out: Record<string, SequentialStateV2> = {};
  for (const [sid, st] of Object.entries(states)) {
    out[sid] = ensureV2(st, sid);
  }
  return out;
}

/** True if the given state is already v2-shaped (no upgrade needed). */
export function isV2(state: SequentialStateV2): boolean {
  return !needsUpgrade(state);
}
