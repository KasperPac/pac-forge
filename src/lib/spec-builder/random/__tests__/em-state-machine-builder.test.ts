import { describe, expect, it } from "vitest";
import { buildEmCanonicalStateMachine } from "@/lib/spec-builder/random/em-state-machine-builder";
import { validateEmStateMachine, validateEmPackmlConformance } from "@/lib/spec-builder/em-state-machine";

describe("buildEmCanonicalStateMachine", () => {
  it("produces states + transitions that pass EM validation (exactly one safe state)", () => {
    const { states, transitions } = buildEmCanonicalStateMachine();
    const issues = validateEmStateMachine({
      equipment_module_id: "em1", unit_id: "u1",
      states, transitions, static_states: {}, sequential_states: {},
    });
    expect(issues).toEqual([]);
    expect(states.filter((s) => s.is_safe_state)).toHaveLength(1);
  });

  it("uses EM-local string ids that match the behavior-map keys", () => {
    const { states } = buildEmCanonicalStateMachine();
    expect(states.map((s) => s.state_id)).toContain("execute");
    expect(states.every((s) => typeof s.state_id === "string")).toBe(true);
  });

  it("uses the canonical PackML 'aborted' safe state and is conformance-clean", () => {
    const { states, transitions } = buildEmCanonicalStateMachine();
    const safe = states.filter((s) => s.is_safe_state);
    expect(safe).toHaveLength(1);
    expect(safe[0].state_id).toBe("aborted");
    expect(safe[0].name).toBe("Aborted");
    expect(states.some((s) => s.state_id === "estop")).toBe(false);

    const em = {
      equipment_module_id: "em1", unit_id: "u1",
      states, transitions, static_states: {}, sequential_states: {},
    };
    expect(validateEmPackmlConformance(em)).toEqual([]);
  });
});
