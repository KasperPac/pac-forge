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
        { tag: "speed_ref", signal_type: "AO", io_address: "QW64", description: "", source: "wired" },
        { tag: "brake", signal_type: "DO", io_address: "Q0.1", description: "", source: "wired" },
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

  it("derives kind from the PackML slug and warns on mismatch", () => {
    const c = contract();
    // "execute" is PackML sequential; author it static with a hold (brake pattern)
    c.states.push({ state_id: "execute", name: "Execute", kind: "static", allowed_modes: [], is_safe_state: false });
    c.static_states["execute"] = [{ tag: "run_cmd", description: "hold open", state: "on" }];
    const seq = buildEmSequence(em(), c);
    const ex = seq.states.find((s) => s.stateId === "execute")!;
    expect(ex.kind).toBe("sequential");
    expect(ex.staticCommands).toEqual([{ pin: "cmd_run_cmd", active: true }]);
    expect(seq.warnings.some((w) => w.includes("execute") && w.includes("sequential"))).toBe(true);
  });

  it("keeps the authored kind for legacy non-PackML slugs", () => {
    const seq = buildEmSequence(em(), contract());
    // "running" is not a PackML slug — authored sequential kind survives, no warning
    expect(seq.states.find((s) => s.stateId === "running")!.kind).toBe("sequential");
    expect(seq.warnings).toHaveLength(0);
  });

  it("lowers steps for a state regardless of authored kind", () => {
    const c = contract();
    // author "running" as static but give it steps — data wins
    c.states = c.states.map((s) => (s.state_id === "running" ? { ...s, kind: "static" as const } : s));
    const seq = buildEmSequence(em(), c);
    expect(seq.states.find((s) => s.stateId === "running")!.steps).toHaveLength(1);
  });
});

describe("buildEmSequence command_behavior lowering", () => {
  function commandContract(): EquipmentModuleContract {
    const c = contract();
    c.states.push({ state_id: "execute", name: "Execute", kind: "sequential", allowed_modes: [], is_safe_state: false });
    c.command_behavior = {
      execute: {
        branches: [
          { branch_id: "b1", label: "Drive Forward (Jog)",
            when: [{ tag: "brake_open", operator: "=", value: true }],
            control_modules: [
              { tag: "run_cmd", description: "", state: "run" },
              { tag: "speed_ref", description: "", state: "JOG_SPEED_FWD" },
            ] },
          { branch_id: "b2", label: "Creep Reverse",
            when: [{ tag: "rev_sel", operator: "=", value: true }],
            control_modules: [{ tag: "speed_ref", description: "", state: "-50" }] },
        ],
        default_hold: [
          { tag: "run_cmd", description: "", state: "run" },
          { tag: "brake", description: "", state: "on" },
        ],
      },
    };
    return c;
  }

  it("lowers branches with serialized conditions, labels, and typed hold values", () => {
    const seq = buildEmSequence(em(), commandContract());
    const ex = seq.states.find((s) => s.stateId === "execute")!;
    expect(ex.commandBranches).toHaveLength(2);
    expect(ex.commandBranches[0]).toEqual({
      label: "Drive Forward (Jog)",
      condition: "(#fb_brake_open = TRUE)",
      holds: [
        { pin: "cmd_run_cmd", value: "TRUE" },
        { pin: "cmd_speed_ref", value: "#sp_JOG_SPEED_FWD" },
      ],
    });
    // signed numeric literal on an Int pin assigns directly
    expect(ex.commandBranches[1].holds).toEqual([{ pin: "cmd_speed_ref", value: "-50" }]);
    expect(seq.setpointPins).toEqual(["sp_JOG_SPEED_FWD"]);
  });

  it("builds anti-latch defaults from the union of branch + default_hold pins", () => {
    const seq = buildEmSequence(em(), commandContract());
    const ex = seq.states.find((s) => s.stateId === "execute")!;
    // default_hold OVERRIDES the inactive default for run_cmd ("run" → TRUE),
    // speed_ref falls to the inactive 0, and brake — touched by default_hold
    // alone — EXTENDS the union. Pins both the override and extend paths.
    expect(ex.commandDefaults).toEqual([
      { pin: "cmd_run_cmd", value: "TRUE" },
      { pin: "cmd_speed_ref", value: "0" },
      { pin: "cmd_brake", value: "TRUE" },
    ]);
  });

  it("prefers command branches over steps and warns (XOR guard)", () => {
    const c = commandContract();
    c.sequential_states["execute"] = {
      permissives: [], notes: null,
      steps: [{ step: 1, action: "should be dropped", completion_criteria: [], completion_criteria_text: "" }],
    };
    const seq = buildEmSequence(em(), c);
    const ex = seq.states.find((s) => s.stateId === "execute")!;
    expect(ex.commandBranches).toHaveLength(2);
    expect(ex.steps).toHaveLength(0);
    expect(seq.warnings.some((w) => w.includes("execute") && w.includes("command"))).toBe(true);
  });

  it("warns once per EM naming the setpoint pins and CMD DB", () => {
    const seq = buildEmSequence(em(), commandContract());
    const w = seq.warnings.filter((x) => x.includes("setpoint"));
    expect(w).toHaveLength(1);
    expect(w[0]).toContain("sp_JOG_SPEED_FWD");
    expect(w[0]).toContain("Carriage_Drive_CMD");
  });

  it("leaves non-command states and EMs untouched", () => {
    const seq = buildEmSequence(em(), contract());
    expect(seq.setpointPins).toEqual([]);
    for (const s of seq.states) {
      expect(s.commandBranches).toEqual([]);
      expect(s.commandDefaults).toEqual([]);
    }
  });

  it("warns on a setpoint name collision and keeps the first registration", () => {
    const c = commandContract();
    // "JOG SPEED" and "JOG_SPEED" both sanitize to sp_JOG_SPEED
    c.command_behavior!.execute.branches = [
      { branch_id: "b1", label: "Fwd",
        when: [{ tag: "brake_open", operator: "=", value: true }],
        control_modules: [{ tag: "speed_ref", description: "", state: "JOG SPEED" }] },
      { branch_id: "b2", label: "Rev",
        when: [{ tag: "rev_sel", operator: "=", value: true }],
        control_modules: [{ tag: "speed_ref", description: "", state: "JOG_SPEED" }] },
    ];
    const seq = buildEmSequence(em(), c);
    expect(seq.setpointPins).toEqual(["sp_JOG_SPEED"]);
    expect(seq.warnings.some((w) => w.includes("collision") && w.includes("sp_JOG_SPEED"))).toBe(true);
  });

  it("warns on a completion transition out of a command-driven state but still wires the exit", () => {
    const c = commandContract();
    c.transitions.push({ transition_id: "t_done", from_state_id: "execute", to_state_id: "idle",
      trigger: { kind: "completion" }, guard: [] });
    const seq = buildEmSequence(em(), c);
    const ex = seq.states.find((s) => s.stateId === "execute")!;
    // exit is still emitted (warn-don't-throw)
    expect(ex.exits).toContainEqual({ toIndex: 0, condition: "TRUE", viaCompletion: true });
    expect(seq.warnings.some(
      (w) => w.includes("t_done") && w.includes("execute") && w.includes("never fire"),
    )).toBe(true);
  });

  it("warns when a command hold references a tag that is not an output of this EM", () => {
    const c = commandContract();
    c.command_behavior!.execute.branches[0].control_modules.push(
      { tag: "ghost", description: "", state: "on" },
    );
    const seq = buildEmSequence(em(), c);
    const ex = seq.states.find((s) => s.stateId === "execute")!;
    // pin is still created (warn-don't-throw)
    expect(ex.commandBranches[0].holds).toContainEqual({ pin: "cmd_ghost", value: "TRUE" });
    expect(seq.warnings.some((w) => w.includes("ghost") && w.includes("not an output"))).toBe(true);
  });
});
