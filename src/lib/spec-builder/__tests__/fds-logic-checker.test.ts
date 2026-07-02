import { describe, it, expect } from "vitest";
import { validateEquipmentModule } from "@/lib/spec-builder/fds-logic-checker";
import type {
  EquipmentModuleConfig,
  InstrumentTag,
  ControlModuleStateEntry,
} from "@/types/spec-builder";
import type { EmStateV2, SequentialStateV2, CommandBehaviorV2 } from "@/types/spec-contract-v2";

// ---------------------------------------------------------------------------
// Fixtures — illustrative machine (generic motor + command tags), NOT a
// real project's device names per CLAUDE.md ("all changes must be generic").
// ---------------------------------------------------------------------------

const em = {
  equipment_module_id: "em1",
  equipment_module_name: "Drive Module",
  description: "",
  control_modules: [
    {
      control_module_id: "cm1",
      control_module_name: "Drive M01",
      control_module_class: "motor",
      is_safety: false,
      description: "",
      io_signals: [
        { tag: "M01_RUN", signal_type: "DO", io_address: "Q0.0", description: "Run" },
        { tag: "CMD_FWD", signal_type: "DI", io_address: "I0.0", description: "Fwd command" },
      ],
    },
  ],
} as unknown as EquipmentModuleConfig;

const tags = [
  { tag: "M01_RUN", description: "Run", signal_direction: "DO" },
  { tag: "CMD_FWD", description: "Fwd command", signal_direction: "DI" },
] as unknown as InstrumentTag[];

const emStates: EmStateV2[] = [
  { state_id: "idle", name: "Idle", kind: "static", allowed_modes: [], is_safe_state: true },
  { state_id: "execute", name: "Execute", kind: "sequential", allowed_modes: [], is_safe_state: false },
];

const staticStates: Record<string, ControlModuleStateEntry[]> = {
  idle: [{ tag: "M01_RUN", description: "Run", state: "off" }],
};

function commandBehaviorFixture(whenTag = "CMD_FWD"): Record<string, CommandBehaviorV2> {
  return {
    execute: {
      branches: [
        {
          branch_id: "drive_fwd",
          label: "Drive Forward",
          when: [{ tag: whenTag, operator: "=", value: true }],
          control_modules: [{ tag: "M01_RUN", description: "Run", state: "on" }],
        },
      ],
      default_hold: [{ tag: "M01_RUN", description: "Run", state: "off" }],
    },
  };
}

function stepsSequentialState(overrides?: Partial<SequentialStateV2>): Record<string, SequentialStateV2> {
  return {
    execute: {
      permissives: [{ tag: "CMD_FWD", operator: "=", value: true }],
      steps: [
        {
          step: 1,
          action: "Run M01",
          completion_criteria: [
            { kind: "tag_equals", tag: "M01_RUN", value: true, within_ms: 2000 },
          ],
          completion_criteria_text: "M01_RUN = true within 2s, else fault",
        },
      ],
      notes: null,
      ...overrides,
    },
  };
}

describe("validateEquipmentModule — command_behavior (SP-3d)", () => {
  it("does not error on a command-driven sequential state with no steps but authored branches", () => {
    const result = validateEquipmentModule(
      em,
      staticStates,
      {}, // no sequential_states entry for "execute" — command_behavior only
      emStates,
      tags,
      commandBehaviorFixture(),
    );
    const stateCompleteness = result.issues.filter((i) => i.category === "state_completeness");
    expect(stateCompleteness).toHaveLength(0);
  });

  it("warns when a command branch's when-tag is not in the instrument register", () => {
    const result = validateEquipmentModule(
      em,
      staticStates,
      {},
      emStates,
      tags,
      commandBehaviorFixture("CMD_UNKNOWN"),
    );
    const warning = result.issues.find(
      (i) => i.category === "permissive_ref" && i.message.includes("CMD_UNKNOWN"),
    );
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toContain('Command branch "Drive Forward" when-tag "CMD_UNKNOWN"');
  });

  it("warns when a command hold tag (control_modules/default_hold) is not in the instrument register", () => {
    const cb = commandBehaviorFixture();
    cb.execute.default_hold = [{ tag: "M99_UNKNOWN", description: "Unknown", state: "off" }];
    const result = validateEquipmentModule(em, staticStates, {}, emStates, tags, cb);
    const warning = result.issues.find(
      (i) => i.category === "permissive_ref" && i.message.includes("M99_UNKNOWN"),
    );
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('Command hold tag "M99_UNKNOWN"');
  });

  it("warns with the branch label when a branch control-module tag is not in the instrument register", () => {
    const cb = commandBehaviorFixture();
    cb.execute.branches[0].control_modules = [
      { tag: "M98_UNKNOWN", description: "Unknown actuator", state: "on" },
    ];
    const result = validateEquipmentModule(em, staticStates, {}, emStates, tags, cb);
    const warning = result.issues.find(
      (i) => i.category === "permissive_ref" && i.message.includes("M98_UNKNOWN"),
    );
    expect(warning).toBeDefined();
    expect(warning?.severity).toBe("warning");
    expect(warning?.message).toContain(
      'Command branch "Drive Forward" control module tag "M98_UNKNOWN"',
    );
  });

  it("errors with the broadened message when a sequential state has neither steps nor command branches", () => {
    const result = validateEquipmentModule(em, staticStates, {}, emStates, tags, {});
    const error = result.issues.find((i) => i.category === "state_completeness");
    expect(error).toBeDefined();
    expect(error?.severity).toBe("error");
    expect(error?.message).toBe("No steps or command branches defined for Execute");
    expect(result.passed).toBe(false);
  });

  it("errors with the broadened message when command_behavior is present but has zero branches", () => {
    const result = validateEquipmentModule(em, staticStates, {}, emStates, tags, {
      execute: { branches: [], default_hold: [] },
    });
    const error = result.issues.find((i) => i.category === "state_completeness");
    expect(error).toBeDefined();
    expect(error?.message).toBe("No steps or command branches defined for Execute");
  });
});

describe("validateEquipmentModule — steps-based states (pre-existing behavior)", () => {
  it("does not error on a steps-based sequential state, even with command_behavior absent", () => {
    const result = validateEquipmentModule(
      em,
      staticStates,
      stepsSequentialState(),
      emStates,
      tags,
      {},
    );
    const stateCompleteness = result.issues.filter((i) => i.category === "state_completeness");
    expect(stateCompleteness).toHaveLength(0);
  });

  it("still runs Check 3 (permissive tag reference) for steps-based states", () => {
    const seq = stepsSequentialState({
      permissives: [{ tag: "CMD_UNKNOWN", operator: "=", value: true }],
    });
    const result = validateEquipmentModule(em, staticStates, seq, emStates, tags, {});
    const warning = result.issues.find(
      (i) => i.category === "permissive_ref" && i.message.includes("CMD_UNKNOWN"),
    );
    expect(warning).toBeDefined();
    expect(warning?.message).toBe('Permissive tag "CMD_UNKNOWN" is not in the instrument register');
  });

  it("backward-compat: compiles and behaves as before when called WITHOUT the 6th argument", () => {
    const result = validateEquipmentModule(
      em,
      staticStates,
      stepsSequentialState(),
      emStates,
      tags,
    );
    const stateCompleteness = result.issues.filter((i) => i.category === "state_completeness");
    expect(stateCompleteness).toHaveLength(0);
    expect(result.passed).toBe(true);
  });
});
