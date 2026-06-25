import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmStateDiagram, formatTransition } from "@/components/code-builder/em-state-diagram";
import type { EmStateV2, EmTransitionV2 } from "@/types/spec-contract-v2";

const states: EmStateV2[] = [
  { state_id: "idle", name: "Idle", kind: "static", allowed_modes: [], is_safe_state: true },
  { state_id: "active", name: "Active", kind: "static", allowed_modes: [], is_safe_state: false },
];
const transitions: EmTransitionV2[] = [
  {
    transition_id: "t1", from_state_id: "idle", to_state_id: "active",
    trigger: { kind: "command", expr: { tag: "start_cmd", operator: "=", value: true } },
    guard: [{ tag: "enable", operator: "=", value: true }],
  },
  {
    transition_id: "t2", from_state_id: "active", to_state_id: "idle",
    trigger: { kind: "completion" }, guard: [],
  },
];

describe("formatTransition", () => {
  it("formats a command trigger with AND-joined guards", () => {
    expect(formatTransition(transitions[0])).toBe("start_cmd = TRUE AND enable = TRUE");
  });
  it("formats a completion trigger with no guard", () => {
    expect(formatTransition(transitions[1])).toBe("done");
  });
});

describe("EmStateDiagram", () => {
  it("renders a node per state and an edge label per transition", () => {
    render(<EmStateDiagram states={states} transitions={transitions} />);
    expect(screen.getByText("Idle")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("start_cmd = TRUE AND enable = TRUE")).toBeInTheDocument();
    expect(screen.getByText("done")).toBeInTheDocument();
  });

  it("renders a placeholder when there are no states", () => {
    render(<EmStateDiagram states={[]} transitions={[]} />);
    expect(screen.getByText(/no state machine/i)).toBeInTheDocument();
  });
});
