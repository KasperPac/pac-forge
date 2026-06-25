import { describe, it, expect } from "vitest";
import type {
  EquipmentModuleV2, EquipmentModuleContract,
} from "@/types/spec-contract-v2";
import { buildEmSequence } from "../em-builder";

function em(): EquipmentModuleV2 {
  return {
    equipment_module_id: "em-drive",
    equipment_module_name: "Carriage Drive",
    description: "",
    control_modules: [{
      control_module_id: "cm-1",
      control_module_name: "Drive",
      control_module_class: "motor",
      is_safety: false,
      description: "",
      io_signals: [
        { tag: "brake_open", signal_type: "DI", io_address: "I0.0", description: "", source: "wired" },
        { tag: "run_cmd", signal_type: "DO", io_address: "Q0.0", description: "", source: "wired" },
      ],
    }],
  };
}

function contract(): EquipmentModuleContract {
  return {
    equipment_module_id: "em-drive",
    unit_id: "u-1",
    states: [
      { state_id: "idle", name: "Idle", kind: "static", allowed_modes: [], is_safe_state: true },
      { state_id: "running", name: "Running", kind: "sequential", allowed_modes: [], is_safe_state: false },
    ],
    transitions: [
      { transition_id: "t1", from_state_id: "idle", to_state_id: "running",
        trigger: { kind: "command", expr: { tag: "cmd_start", operator: "=", value: true } },
        guard: [{ tag: "brake_open", operator: "=", value: true }] },
      { transition_id: "t2", from_state_id: "running", to_state_id: "idle",
        trigger: { kind: "completion" }, guard: [] },
    ],
    static_states: {
      idle: [{ tag: "run_cmd", description: "stop", state: "off" }],
    },
    sequential_states: {
      running: {
        permissives: [],
        notes: null,
        steps: [{
          step: 1, action: "Accelerate to speed",
          completion_criteria: [{ kind: "tag_compare", tag: "speed", op: ">=", value: 100 }],
          completion_criteria_text: "speed >= 100",
        }],
      },
    },
  };
}

describe("buildEmSequence", () => {
  it("orders states with the safe state first", () => {
    const seq = buildEmSequence(em(), contract());
    expect(seq.states.map((s) => s.stateId)).toEqual(["idle", "running"]);
    expect(seq.states[0].index).toBe(0);
    expect(seq.states[0].isSafe).toBe(true);
  });

  it("derives sensor/actuator/interlock pins from referenced tags", () => {
    const seq = buildEmSequence(em(), contract());
    expect(seq.sensors.map((p) => p.name)).toContain("fb_brake_open");
    expect(seq.sensors.find((p) => p.name === "fb_brake_open")!.address).toBe("I0.0");
    expect(seq.actuators.map((p) => p.name)).toContain("cmd_run_cmd");
    expect(seq.actuators.find((p) => p.name === "cmd_run_cmd")!.address).toBe("Q0.0");
    // cmd_start is not own IO → coordination interlock pin
    expect(seq.interlockPins).toContain("ilk_cmd_start");
  });

  it("emits a linear step with fillId and pin-mapped advance", () => {
    const seq = buildEmSequence(em(), contract());
    const running = seq.states.find((s) => s.stateId === "running")!;
    expect(running.steps).toHaveLength(1);
    expect(running.steps[0].fillId).toBe("running.1");
    // `speed` is not declared IO → routed to a coordination interlock pin
    // (same documented pinRef behaviour as the transition-guard exits).
    expect(running.steps[0].advance).toBe("(#ilk_speed >= 100)");
    expect(running.steps[0].actionProse).toBe("Accelerate to speed");
  });

  it("records static commands and state exits", () => {
    const seq = buildEmSequence(em(), contract());
    const idle = seq.states.find((s) => s.stateId === "idle")!;
    expect(idle.staticCommands).toEqual([{ pin: "cmd_run_cmd", active: false }]);
    expect(idle.exits).toEqual([
      { toIndex: 1, condition: "(#ilk_cmd_start = TRUE) AND (#fb_brake_open = TRUE)", viaCompletion: false },
    ]);
    const running = seq.states.find((s) => s.stateId === "running")!;
    expect(running.exits[0].viaCompletion).toBe(true);
  });

  it("warns on an out-of-EM transition target without throwing", () => {
    const c = contract();
    c.transitions.push({ transition_id: "t3", from_state_id: "idle", to_state_id: "ghost",
      trigger: { kind: "completion" }, guard: [] });
    const seq = buildEmSequence(em(), c);
    expect(seq.warnings.some((w) => w.includes("t3"))).toBe(true);
  });
});
