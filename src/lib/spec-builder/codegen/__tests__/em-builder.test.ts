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
    expect(idle.staticCommands).toEqual([{ pin: "cmd_run_cmd", value: "FALSE" }]);
    expect(idle.exits).toEqual([
      { toIndex: 1, condition: "(#ilk_cmd_start = TRUE) AND (#fb_brake_open = TRUE)", viaCompletion: false },
    ]);
    const running = seq.states.find((s) => s.stateId === "running")!;
    expect(running.exits[0].viaCompletion).toBe(true);
  });

  it("types static holds per pin — Int pins keep numeric values instead of FALSE", () => {
    const c = contract();
    c.static_states["idle"] = [
      { tag: "run_cmd", description: "stop", state: "off" },
      { tag: "speed_ref", description: "zero speed", state: "0" },
    ];
    const seq = buildEmSequence(em(), c);
    const idle = seq.states.find((s) => s.stateId === "idle")!;
    expect(idle.staticCommands).toEqual([
      { pin: "cmd_run_cmd", value: "FALSE" },
      { pin: "cmd_speed_ref", value: "0" },
    ]);
  });

  it("routes symbolic static holds on Int pins through sp_ setpoint inputs", () => {
    const c = contract();
    c.static_states["idle"] = [{ tag: "speed_ref", description: "creep", state: "CREEP_SPEED" }];
    const seq = buildEmSequence(em(), c);
    const idle = seq.states.find((s) => s.stateId === "idle")!;
    expect(idle.staticCommands).toEqual([{ pin: "cmd_speed_ref", value: "#sp_CREEP_SPEED" }]);
    expect(seq.setpointPins).toContain("sp_CREEP_SPEED");
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
    expect(ex.staticCommands).toEqual([{ pin: "cmd_run_cmd", value: "TRUE" }]);
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

describe("buildEmSequence — telegram-word addressing (G1-5)", () => {
  function telegramEm() {
    return {
      equipment_module_id: "em1", equipment_module_name: "Feeder", description: "",
      control_modules: [
        {
          control_module_id: "cm-uuid-tg", control_module_name: "VFD1", control_module_class: "motor",
          is_safety: false, description: "",
          io_signals: [
            { tag: "VFD1_ZSW_Ready", signal_type: "DI", io_address: "", description: "", source: "network_telegram",
              telegram_offset: { word: 0, bit: 9, data_type: "BOOL" } },
            { tag: "VFD1_Act_Speed", signal_type: "AI", io_address: "", description: "", source: "network_telegram",
              telegram_offset: { word: 1, data_type: "INT" } },
            { tag: "VFD1_STW_Enable", signal_type: "DO", io_address: "", description: "", source: "network_telegram",
              telegram_offset: { word: 0, bit: 3, data_type: "BOOL" } },
          ],
        },
      ],
    } as unknown as Parameters<typeof buildEmSequence>[0];
  }
  const contract = {
    equipment_module_id: "em1", unit_id: "u1",
    states: [
      { state_id: "idle", name: "Idle", kind: "static", allowed_modes: [], is_safe_state: true },
      { state_id: "execute", name: "Execute", kind: "static", allowed_modes: [], is_safe_state: false },
    ],
    transitions: [
      { transition_id: "t1", from_state_id: "idle", to_state_id: "execute",
        trigger: { kind: "command", expr: { tag: "VFD1_ZSW_Ready", operator: "=", value: true } },
        guard: [{ tag: "VFD1_Act_Speed", operator: ">", value: 0 }] },
    ],
    static_states: { idle: [{ tag: "VFD1_STW_Enable", description: "", state: "STOP" }] },
    sequential_states: {},
  } as unknown as Parameters<typeof buildEmSequence>[1];

  it("computes absolute addresses from the recorded HW-config start bytes", () => {
    const seq = buildEmSequence(telegramEm(), contract, {
      drives: [{ control_module_id: "cm-uuid-tg", config_axis: 63, io_in_start_byte: 100, io_out_start_byte: 64 }],
      io_conditioning_defaults: undefined,
      axis_constants: [], encoder_presets: [], fb_assignments: [], upstream_endpoints: [],
    } as Parameters<typeof buildEmSequence>[2]);
    const byTag = new Map([...seq.sensors, ...seq.actuators].map((p) => [p.tag, p]));
    // Siemens word layout: %IW<b> = high byte I<b> (word bits 8..15) + low
    // byte I<b+1> (word bits 0..7)
    expect(byTag.get("VFD1_ZSW_Ready")?.address).toBe("I100.1"); // word 0 bit 9 → high byte, bit 1
    expect(byTag.get("VFD1_Act_Speed")?.address).toBe("IW102"); // word 1 → byte 100+2
    expect(byTag.get("VFD1_STW_Enable")?.address).toBe("Q65.3"); // word 0 bit 3 → low byte 64+1, bit 3
  });

  it("carries a specific telegram note when the base is unrecorded (never a bare TODO)", () => {
    const seq = buildEmSequence(telegramEm(), contract, undefined);
    const p = seq.sensors.find((s) => s.tag === "VFD1_Act_Speed")!;
    expect(p.address).toBe("");
    expect(p.telegramNote).toContain("telegram word 1");
    expect(p.telegramNote).toContain("INT");
  });
});
