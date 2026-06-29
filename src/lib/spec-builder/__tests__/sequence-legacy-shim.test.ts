import { describe, expect, it } from "vitest";
import { ensureV2 } from "../sequence-legacy-shim";
import { PhaseStepSchema } from "@/types/spec-contract-v2";

/**
 * Regression: the Stage-B FDS prompt instructs the model to emit the full SFC
 * shape (step_id + actions[] + transitions[]) with NO legacy v1 fields, but
 * PhaseStepSchema still REQUIRES step / action / completion_criteria /
 * completion_criteria_text. `ensureV2` must back-fill those deterministically so
 * a model-authored sequential state validates for every project.
 */
describe("ensureV2 — legacy back-fill for already-v2 steps", () => {
  // The exact shape the model emits for a ramp-down step: no legacy fields.
  const aiState = {
    state_id: "ramping_down",
    override_kind: "override",
    permissives: [],
    sequence_model_version: 2,
    branches: [
      { branch_id: "main", name: "Main", kind: "main", fork_step_id: "car_rampdown_step_10" },
    ],
    state_monitors: [],
    steps: [
      {
        step_id: "car_rampdown_step_10",
        branch_id: "main",
        actions: [
          {
            kind: "assign",
            action_id: "a1",
            target_tag: "VSD1_Speed_Ref",
            source: { kind: "literal", value: 0, value_type: "number" },
            prose: "Command zero speed reference",
          },
        ],
        monitors: [],
        transitions: [
          {
            transition_id: "t1",
            kind: "single",
            target_step_id: "",
            guard: [
              {
                kind: "tag_equals",
                tag: "CAR_POS_AT_STOP_FWD",
                value: true,
                within_ms: 3000,
                on_fail: { fault_code: "F_CM_DECEL_DWELL", severity: "fault" },
              },
            ],
            priority: 0,
            is_default: true,
            notes: null,
          },
        ],
      },
    ],
    notes: null,
  };

  it("back-fills the required legacy fields and validates", () => {
    const v2 = ensureV2(aiState as never, "ramping_down");
    const step = v2.steps[0];

    // Schema (the persist-path gate) now accepts the step.
    expect(PhaseStepSchema.safeParse(step).success).toBe(true);

    // Derivations.
    expect(step.step).toBe(10); // trailing digits of step_id
    expect(step.action).toBe("Command zero speed reference"); // first action prose
    expect(step.completion_criteria).toEqual(step.transitions![0].guard); // default transition guard
    expect(step.completion_criteria_text).toBe("CAR_POS_AT_STOP_FWD = true");
    expect(step.on_fail).toEqual({ fault_code: "F_CM_DECEL_DWELL", severity: "fault" });
  });

  it("preserves the SFC fields untouched", () => {
    const v2 = ensureV2(aiState as never, "ramping_down");
    const step = v2.steps[0];
    expect(step.step_id).toBe("car_rampdown_step_10");
    expect(step.actions).toHaveLength(1);
    expect(step.transitions).toHaveLength(1);
  });

  it("is idempotent", () => {
    const once = ensureV2(aiState as never, "ramping_down");
    const twice = ensureV2(once as never, "ramping_down");
    expect(twice).toEqual(once);
  });

  it("falls back to 1-based index when step_id has no trailing number", () => {
    const noNumber = {
      ...aiState,
      steps: [
        {
          step_id: "car_rampdown_settle",
          branch_id: "main",
          actions: [],
          monitors: [],
          transitions: [],
        },
      ],
    };
    const v2 = ensureV2(noNumber as never, "ramping_down");
    const step = v2.steps[0];
    expect(step.step).toBe(1);
    expect(step.completion_criteria).toEqual([]);
    expect(step.completion_criteria_text).toBe("");
    expect(PhaseStepSchema.safeParse(step).success).toBe(true);
  });
});
