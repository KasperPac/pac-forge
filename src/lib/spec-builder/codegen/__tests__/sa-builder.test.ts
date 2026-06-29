import { describe, it, expect } from "vitest";
import { buildUnitSequence, sclIdent, isActiveCommand } from "../sa-builder";
import type {
  EquipmentModuleContract, EmStateV2, EmTransitionV2, ControlModuleStateEntry,
} from "@/types/spec-contract-v2";

const state = (id: string, kind: EmStateV2["kind"], safe = false): EmStateV2 => ({
  state_id: id, name: id, kind, allowed_modes: [], is_safe_state: safe,
});
const entry = (tag: string, s: string): ControlModuleStateEntry => ({ tag, description: tag, state: s });

/** A minimal one-EM "carriage" contract: Stopped <-> Driving, driving holds the motor. */
function carriageEm(): EquipmentModuleContract {
  return {
    equipment_module_id: "em-1",
    unit_id: "unit-1",
    states: [state("stopped", "static", true), state("driving", "static")],
    transitions: [
      {
        transition_id: "t1", from_state_id: "stopped", to_state_id: "driving",
        trigger: { kind: "command", expr: { tag: "CMD_FWD", operator: "=", value: true } },
        guard: [{ tag: "Brake_Open", operator: "=", value: true }],
      } as EmTransitionV2,
      {
        transition_id: "t2", from_state_id: "driving", to_state_id: "stopped",
        trigger: { kind: "command", expr: { tag: "CMD_FWD", operator: "=", value: false } },
        guard: [],
      } as EmTransitionV2,
    ],
    static_states: {
      stopped: [entry("Motor_Run", "STOP")],
      driving: [entry("Motor_Run", "RUN")],
    },
    sequential_states: {},
  };
}

describe("sclIdent", () => {
  it("sanitises a name into a legal SCL identifier", () => {
    expect(sclIdent("Carriage Unit #1")).toBe("Carriage_Unit_1");
    expect(sclIdent("3-Axis")).toBe("_3_Axis");
  });
});

describe("isActiveCommand", () => {
  it("treats RUN/ON/OPEN/EXTEND/TRUE as active", () => {
    expect(isActiveCommand("RUN")).toBe(true);
    expect(isActiveCommand("open")).toBe(true);
  });
  it("treats STOP/OFF/CLOSED as inactive", () => {
    expect(isActiveCommand("STOP")).toBe(false);
    expect(isActiveCommand("")).toBe(false);
  });
});

describe("buildUnitSequence", () => {
  const seq = buildUnitSequence("unit-1", "Carriage Unit", [carriageEm()]);

  it("flattens ordered states into indexed steps with the home flagged", () => {
    expect(seq.steps.map((s) => [s.index, s.stateId, s.isHome]))
      .toEqual([[0, "stopped", true], [1, "driving", false]]);
  });
  it("records the advance from stopped→driving as an incoming edge on driving", () => {
    expect(seq.steps[1].incoming).toEqual([
      { fromIndex: 0, condition: "(CMD_FWD = TRUE) AND (Brake_Open = TRUE)" },
    ]);
  });
  it("adds each transition's condition to its source step's leave list", () => {
    expect(seq.steps[0].leave).toEqual(["(CMD_FWD = TRUE) AND (Brake_Open = TRUE)"]);
    expect(seq.steps[1].leave).toEqual(["(CMD_FWD = FALSE)"]);
  });
  it("wires only the active-commanded device of each static state", () => {
    expect(seq.steps[0].wires).toEqual([]);                       // STOP → not driven
    expect(seq.steps[1].wires).toEqual([{ tag: "Motor_Run" }]);   // RUN → driven by A[1]
  });
});
