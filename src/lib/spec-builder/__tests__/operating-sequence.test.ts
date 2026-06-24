import { describe, it, expect } from "vitest";
import { buildEmOperationView } from "../operating-sequence";
import type { SpecSection } from "@/types/spec-builder";

/** Minimal SpecSection factory carrying just the fields the view reads. */
function fd(state_name: string, content: Record<string, unknown>): SpecSection {
  return {
    id: state_name,
    state_name,
    content_json: { ...content },
  } as unknown as SpecSection;
}

describe("buildEmOperationView", () => {
  // A carriage-drive-like EM: common fault guards on the command transitions,
  // a fault→Faulted transition per fault tag, plus direction-specific limits.
  const faultGuards = ["CM1_Fault = FALSE", "VSD1_CB_Trip = FALSE"];
  const states = [
    fd("Stopped", {
      pattern: "static",
      control_module_states: [{ tag: "CM1_Run", description: "m1", state: "STOP" }],
      transitions: [
        { trigger: "CMD_DRIVE_FWD = TRUE", to_state: "Driving Forward", permissives: [...faultGuards, "LS_FWD_LIMIT = FALSE"] },
        { trigger: "CMD_DRIVE_REV = TRUE", to_state: "Driving Reverse", permissives: [...faultGuards, "LS_REV_LIMIT = FALSE"] },
        { trigger: "CM1_Fault = TRUE", to_state: "Faulted", permissives: [] },
        { trigger: "VSD1_CB_Trip = TRUE", to_state: "Faulted", permissives: [] },
      ],
    }),
    fd("Driving Forward", {
      pattern: "static",
      control_module_states: [{ tag: "CM1_Run", description: "m1", state: "RUN" }],
      transitions: [
        { trigger: "CMD_DRIVE_FWD = FALSE", to_state: "Stopped", permissives: [] },
        { trigger: "CM1_Fault = TRUE", to_state: "Faulted", permissives: [] },
        { trigger: "VSD1_CB_Trip = TRUE", to_state: "Faulted", permissives: [] },
      ],
    }),
    fd("Driving Reverse", {
      pattern: "static",
      control_module_states: [{ tag: "CM1_Run", description: "m1", state: "RUN" }],
      transitions: [
        { trigger: "CMD_DRIVE_REV = FALSE", to_state: "Stopped", permissives: [] },
        { trigger: "CM1_Fault = TRUE", to_state: "Faulted", permissives: [] },
        { trigger: "VSD1_CB_Trip = TRUE", to_state: "Faulted", permissives: [] },
      ],
    }),
    fd("Faulted", {
      pattern: "static",
      control_module_states: [],
      transitions: [
        { trigger: "CMD_FAULT_RESET = TRUE", to_state: "Stopped", permissives: [...faultGuards] },
      ],
    }),
  ];

  const view = buildEmOperationView(states);

  it("hoists the guards common to all operational transitions into EM permissives", () => {
    expect(view.permissives).toEqual(faultGuards);
  });

  it("strips common permissives from each transition, keeping only transition-specific guards, and points at the target step", () => {
    const stopped = view.steps[0];
    expect(stopped.advance).toContainEqual({ condition: "CMD_DRIVE_FWD = TRUE AND LS_FWD_LIMIT = FALSE", nextStep: "20" });
    expect(stopped.advance).toContainEqual({ condition: "CMD_DRIVE_REV = TRUE AND LS_REV_LIMIT = FALSE", nextStep: "30" });
  });

  it("collapses the per-fault fan-in to a single boolean OR line → the Faulted step", () => {
    const stopped = view.steps[0];
    // Faulted is the 4th state → step 40.
    expect(stopped.advance).toContainEqual({ condition: "CM1_Fault = TRUE OR VSD1_CB_Trip = TRUE", nextStep: "40" });
    // The two fault trips are merged into one OR row, not two.
    expect(stopped.advance.filter((a) => a.nextStep === "40")).toHaveLength(1);
  });

  it("renders a reset transition cleanly once its guards equal the permissives", () => {
    const faulted = view.steps[3];
    expect(faulted.advance).toEqual([{ condition: "CMD_FAULT_RESET = TRUE", nextStep: "10" }]);
  });

  it("numbers steps 10, 20, 30, 40 … and carries the action summary", () => {
    expect(view.steps.map((s) => s.step)).toEqual([10, 20, 30, 40]);
    expect(view.steps[0].action).toEqual(["CM1_Run: STOP"]);
  });
});
