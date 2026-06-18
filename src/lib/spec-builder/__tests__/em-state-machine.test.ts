import { describe, expect, it } from "vitest";
import {
  resolveAllowedStates,
  resolveForcedSafeStates,
  validateEmStateMachine,
} from "@/lib/spec-builder/em-state-machine";
import type {
  EquipmentModuleContract,
  SafetyGateV2,
} from "@/types/spec-contract-v2";

function em(id: string, overrides: Partial<EquipmentModuleContract> = {}): EquipmentModuleContract {
  return {
    equipment_module_id: id,
    unit_id: "u1",
    states: [],
    transitions: [],
    static_states: {},
    sequential_states: {},
    ...overrides,
  };
}

describe("resolveAllowedStates", () => {
  it("returns states whose allowed_modes is empty or includes the mode", () => {
    const carriage = em("carriage", {
      states: [
        { state_id: "idle", name: "Idle", kind: "static", allowed_modes: [], is_safe_state: false },
        { state_id: "jog", name: "Jog", kind: "static", allowed_modes: ["manual"], is_safe_state: false },
        { state_id: "auto_run", name: "AutoRun", kind: "sequential", allowed_modes: ["auto"], is_safe_state: false },
      ],
    });
    expect(resolveAllowedStates(carriage, "manual").map((s) => s.state_id)).toEqual(["idle", "jog"]);
    expect(resolveAllowedStates(carriage, "auto").map((s) => s.state_id)).toEqual(["idle", "auto_run"]);
  });
});

describe("resolveForcedSafeStates", () => {
  const carriage = em("carriage", {
    states: [
      { state_id: "running", name: "Running", kind: "static", allowed_modes: [], is_safe_state: false },
      { state_id: "faulted", name: "Faulted", kind: "static", allowed_modes: [], is_safe_state: true },
    ],
  });
  const rotator = em("rotator", {
    states: [{ state_id: "safe", name: "Safe", kind: "static", allowed_modes: [], is_safe_state: true }],
  });

  it("forces all EMs to their safe state when an 'all'-scope gate is violated", () => {
    const gate: SafetyGateV2 = {
      gate_id: "estop", name: "E-Stop",
      condition: [{ tag: "EStop_Healthy", operator: "=", value: false }],
      scope: "all",
    };
    const forced = resolveForcedSafeStates([carriage, rotator], [gate], ["estop"]);
    expect(forced.get("carriage")).toBe("faulted");
    expect(forced.get("rotator")).toBe("safe");
  });

  it("forces only scoped EMs for a scoped gate", () => {
    const gate: SafetyGateV2 = {
      gate_id: "z1", name: "Zone1",
      condition: [{ tag: "SR1_Healthy", operator: "=", value: false }],
      scope: ["rotator"],
    };
    const forced = resolveForcedSafeStates([carriage, rotator], [gate], ["z1"]);
    expect(forced.has("carriage")).toBe(false);
    expect(forced.get("rotator")).toBe("safe");
  });

  it("returns empty when no gate is violated", () => {
    const gate: SafetyGateV2 = {
      gate_id: "estop", name: "E-Stop",
      condition: [{ tag: "EStop_Healthy", operator: "=", value: false }],
      scope: "all",
    };
    expect(resolveForcedSafeStates([carriage, rotator], [gate], []).size).toBe(0);
  });
});

describe("validateEmStateMachine", () => {
  it("accepts a valid EM with exactly one safe state and resolvable transitions", () => {
    const carriage = em("carriage", {
      states: [
        { state_id: "stopped", name: "Stopped", kind: "static", allowed_modes: [], is_safe_state: true },
        { state_id: "running", name: "Running", kind: "static", allowed_modes: [], is_safe_state: false },
      ],
      transitions: [
        { transition_id: "t1", from_state_id: "stopped", to_state_id: "running",
          trigger: { kind: "command", expr: { tag: "Start", operator: "=", value: true } }, guard: [] },
      ],
    });
    expect(validateEmStateMachine(carriage)).toEqual([]);
  });

  it("flags zero and multiple safe states", () => {
    const none = em("a", { states: [{ state_id: "x", name: "X", kind: "static", allowed_modes: [], is_safe_state: false }] });
    expect(validateEmStateMachine(none).some((i) => /exactly one is_safe_state/.test(i))).toBe(true);

    const two = em("b", {
      states: [
        { state_id: "x", name: "X", kind: "static", allowed_modes: [], is_safe_state: true },
        { state_id: "y", name: "Y", kind: "static", allowed_modes: [], is_safe_state: true },
      ],
    });
    expect(validateEmStateMachine(two).some((i) => /exactly one is_safe_state/.test(i))).toBe(true);
  });

  it("flags a transition referencing an unknown state", () => {
    const bad = em("c", {
      states: [{ state_id: "x", name: "X", kind: "static", allowed_modes: [], is_safe_state: true }],
      transitions: [
        { transition_id: "t1", from_state_id: "x", to_state_id: "ghost",
          trigger: { kind: "completion" }, guard: [] },
      ],
    });
    expect(validateEmStateMachine(bad).some((i) => /unknown.*ghost/.test(i))).toBe(true);
  });

  it("flags duplicate transition_ids", () => {
    const dup = em("d", {
      states: [
        { state_id: "x", name: "X", kind: "static", allowed_modes: [], is_safe_state: true },
        { state_id: "y", name: "Y", kind: "static", allowed_modes: [], is_safe_state: false },
      ],
      transitions: [
        { transition_id: "t", from_state_id: "x", to_state_id: "y", trigger: { kind: "completion" }, guard: [] },
        { transition_id: "t", from_state_id: "y", to_state_id: "x", trigger: { kind: "completion" }, guard: [] },
      ],
    });
    expect(validateEmStateMachine(dup).some((i) => /duplicate transition_id/.test(i))).toBe(true);
  });

  it("does not require a safe state when the EM has no states (skeleton not authored)", () => {
    expect(validateEmStateMachine(em("empty"))).toEqual([]);
  });
});
