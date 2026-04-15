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
  MonitorV2,
  SequentialStateV2,
  StepV2,
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

function isV2Step(step: StepV2): boolean {
  return (
    typeof step.step_id === "string" &&
    step.step_id.length > 0 &&
    Array.isArray(step.transitions) &&
    Array.isArray(step.actions)
  );
}

/**
 * Detect legacy v1 shape. A state is legacy if:
 *   - sequence_model_version !== 2, AND
 *   - first step is missing step_id OR transitions.
 */
function needsUpgrade(state: SequentialStateV2): boolean {
  if (state.sequence_model_version === 2) return false;
  if (!Array.isArray(state.steps) || state.steps.length === 0) {
    // Empty sequential state — still upgrade metadata.
    return true;
  }
  return !isV2Step(state.steps[0]);
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
    return state;
  }

  const legacySteps = Array.isArray(state.steps) ? state.steps : [];
  const hasFaultStep = legacySteps.some((s) => !!s.on_fail);
  const faultStepId = faultStepIdFor(stateId);

  const newSteps: StepV2[] = legacySteps.map((step, idx) => {
    const stepNum = step.step ?? idx + 1;
    const thisStepId = stepIdFor(stateId, stepNum);
    const nextStepId =
      idx + 1 < legacySteps.length
        ? stepIdFor(stateId, legacySteps[idx + 1].step ?? idx + 2)
        : undefined;

    const completion: CompletionCriterion[] = Array.isArray(step.completion_criteria)
      ? step.completion_criteria
      : [];

    const actions: ActionV2[] = [
      {
        kind: "manual_prose",
        action_id: actionIdFor(stateId, stepNum),
        text: step.action ?? "",
        referenced_tags: [],
        prose: step.action ?? "",
      },
    ];

    const transitions: TransitionV2[] = [];
    if (nextStepId) {
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

    const upgraded: StepV2 = {
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
