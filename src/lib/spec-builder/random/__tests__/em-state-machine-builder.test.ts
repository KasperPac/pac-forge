import { describe, expect, it } from "vitest";
import { buildEmCanonicalStateMachine } from "@/lib/spec-builder/random/em-state-machine-builder";
import { validateEmStateMachine } from "@/lib/spec-builder/em-state-machine";

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
});
