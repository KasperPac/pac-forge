import { describe, expect, it } from "vitest";
import { buildValidationFailureTurn } from "../validation-failure-turn";

describe("buildValidationFailureTurn", () => {
  it("returns a system-role turn with the issue list", () => {
    const turn = buildValidationFailureTurn({
      stateLabel: "Execute (state_id 6)",
      issues: ["override_kind is required", "next_step_id step_25 unknown"],
    });
    expect(turn.role).toBe("system");
    expect(turn.content).toContain("Execute (state_id 6)");
    expect(turn.content).toContain("override_kind is required");
    expect(turn.content).toContain("next_step_id step_25 unknown");
    expect(turn.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("records state_context for filtering / lookup", () => {
    const turn = buildValidationFailureTurn({
      stateLabel: "Execute (state_id 6)",
      stateContext: "6",
      issues: ["x"],
    });
    expect(turn.state_context).toBe("6");
  });

  it("renders the partial-merge guidance line", () => {
    const turn = buildValidationFailureTurn({
      stateLabel: "Execute (state_id 6)",
      issues: ["x"],
    });
    expect(turn.content).toMatch(/other state updates.*merged successfully/i);
  });
});
