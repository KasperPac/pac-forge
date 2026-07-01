import { describe, expect, it } from "vitest";
import {
  resolveAllowedStates,
  resolveForcedSafeStates,
  validateEmStateMachine,
  validateEmPackmlConformance,
  validateEmStateMachineAndPackml,
  parseStateMachineProposal,
  isLikelyTruncatedProposal,
} from "@/lib/spec-builder/em-state-machine";
import { defaultEmStates } from "@/lib/spec-builder/packml-states";
import type {
  EquipmentModuleContract,
  EmStateV2,
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

describe("parseStateMachineProposal", () => {
  const VALID = `Here is the proposed machine.

\`\`\`json
{
  "states": [
    { "state_id": "stopped", "name": "Stopped", "kind": "static", "allowed_modes": [], "is_safe_state": true },
    { "state_id": "auto_cycle", "name": "Auto Cycle", "kind": "sequential", "allowed_modes": ["auto"], "is_safe_state": false }
  ],
  "transitions": [
    { "transition_id": "t1", "from_state_id": "stopped", "to_state_id": "auto_cycle", "trigger": { "kind": "completion" }, "guard": [] }
  ]
}
\`\`\``;

  it("extracts states + transitions from a fenced json block", () => {
    const out = parseStateMachineProposal(VALID);
    expect(out).not.toBeNull();
    expect(out!.states.map((s) => s.state_id)).toEqual(["stopped", "auto_cycle"]);
    expect(out!.transitions.length).toBe(1);
  });

  it("applies schema defaults (allowed_modes, is_safe_state, guard)", () => {
    const minimal = `\`\`\`json
{
  "states": [
    { "state_id": "s1", "name": "S1", "kind": "static" }
  ]
}
\`\`\``;
    const out = parseStateMachineProposal(minimal);
    expect(out).not.toBeNull();
    expect(out!.states[0].allowed_modes).toEqual([]);
    expect(out!.states[0].is_safe_state).toBe(false);
    expect(out!.transitions).toEqual([]);
  });

  it("returns null when there is no json block (still gathering)", () => {
    expect(parseStateMachineProposal("Let me ask you a question first.")).toBeNull();
  });

  it("returns null for an empty states array", () => {
    const empty = `\`\`\`json
{ "states": [], "transitions": [] }
\`\`\``;
    expect(parseStateMachineProposal(empty)).toBeNull();
  });

  it("returns null for a structurally invalid proposal", () => {
    const bad = `\`\`\`json
{ "states": [ { "state_id": "s1", "kind": "bogus" } ] }
\`\`\``;
    expect(parseStateMachineProposal(bad)).toBeNull();
  });

  it("returns null for malformed json", () => {
    expect(parseStateMachineProposal("```json\n{ not valid }\n```")).toBeNull();
  });
});

/**
 * Generic robustness: a complete state machine for a complex EM can exceed the
 * streaming token budget and arrive TRUNCATED — the AI opened a ```json fence
 * but the closing fence (and tail of the JSON) never streamed. The parser then
 * returns null, which the persist path treats as "still gathering", silently
 * losing the whole machine with NO error shown. `isLikelyTruncatedProposal`
 * distinguishes that failure (fence opened but unparseable) from a legitimate
 * prose-only refine turn (no fence at all), so the UI can surface it loudly.
 */
describe("isLikelyTruncatedProposal", () => {
  it("is true when a json fence opened but never parsed (truncation)", () => {
    const truncated =
      "Here is the machine.\n\n```json\n" +
      '{ "states": [ { "state_id": "stopped", "name": "Stopped", "kind": "static"';
    // No closing fence, JSON cut mid-object.
    expect(parseStateMachineProposal(truncated)).toBeNull();
    expect(isLikelyTruncatedProposal(truncated)).toBe(true);
  });

  it("is true when a fenced block parsed but was schema-invalid", () => {
    const invalid = "```json\n" + '{ "states": [ { "state_id": "s1", "kind": "bogus" } ] }\n```';
    expect(parseStateMachineProposal(invalid)).toBeNull();
    expect(isLikelyTruncatedProposal(invalid)).toBe(true);
  });

  it("is false for a prose-only refine turn with no fence (still gathering)", () => {
    expect(isLikelyTruncatedProposal("Which state is the safe state?")).toBe(false);
  });

  it("is false when the proposal is complete and parseable", () => {
    const ok =
      "```json\n" +
      '{ "states": [ { "state_id": "s1", "name": "S1", "kind": "static", "is_safe_state": true } ], "transitions": [] }\n```';
    expect(parseStateMachineProposal(ok)).not.toBeNull();
    expect(isLikelyTruncatedProposal(ok)).toBe(false);
  });
});

describe("validateEmPackmlConformance", () => {
  it("passes for a machine seeded from defaultEmStates", () => {
    expect(validateEmPackmlConformance(em("cm", { states: defaultEmStates() }))).toEqual([]);
  });

  it("returns [] for an empty skeleton", () => {
    expect(validateEmPackmlConformance(em("empty"))).toEqual([]);
  });

  it("flags a non-PackML state_id", () => {
    const states: EmStateV2[] = [
      { state_id: "driving_fwd", name: "Driving Fwd", kind: "static", allowed_modes: [], is_safe_state: false },
      { state_id: "aborted", name: "Aborted", kind: "static", allowed_modes: [], is_safe_state: true },
    ];
    const issues = validateEmPackmlConformance(em("a", { states }));
    expect(issues.some((i) => i.includes('non-PackML state_id "driving_fwd"'))).toBe(true);
  });

  it("flags a safe state that is not aborted", () => {
    const states: EmStateV2[] = [
      { state_id: "stopped", name: "Stopped", kind: "static", allowed_modes: [], is_safe_state: true },
    ];
    const issues = validateEmPackmlConformance(em("b", { states }));
    expect(issues.some((i) => i.includes('safe state must be "aborted"'))).toBe(true);
  });

  it("flags command_behavior on a non-acting (static) state", () => {
    const issues = validateEmPackmlConformance(em("c", {
      states: defaultEmStates(),
      command_behavior: { idle: { branches: [], default_hold: [] } }, // idle is static → non-acting
    }));
    expect(issues.some((i) => /command_behavior.*"idle"/.test(i))).toBe(true);
  });
});

/**
 * Regression: the per-EM trigger model (EmTriggerSchema) only allows a command
 * trigger's `expr` to be a SINGLE condition. But the universal "any fault ->
 * Faulted" pattern needs an OR of many fault tags. AI authors emit
 * `expr: [c1..cN], trigger_logic: "OR"`, which fails schema validation, so the
 * ENTIRE proposal was silently rejected and NO states persisted (Stage A looked
 * like it never happened). The parser must deterministically expand an
 * OR-array trigger into N single-condition transitions (one per condition,
 * sharing from/to/guard, unique transition_ids) so persistence never silently
 * fails for ANY machine.
 */
describe("parseStateMachineProposal — OR-trigger expansion (regression)", () => {
  const OR_TRIGGER = `\`\`\`json
{
  "states": [
    { "state_id": "driving", "name": "Driving", "kind": "static", "allowed_modes": [], "is_safe_state": false },
    { "state_id": "faulted", "name": "Faulted", "kind": "static", "allowed_modes": [], "is_safe_state": true }
  ],
  "transitions": [
    {
      "transition_id": "driving_to_faulted",
      "from_state_id": "driving",
      "to_state_id": "faulted",
      "trigger": {
        "kind": "command",
        "expr": [
          { "tag": "CM1_Fault", "operator": "=", "value": true },
          { "tag": "CM2_Fault", "operator": "=", "value": true },
          { "tag": "VSD1_CB_Trip", "operator": "=", "value": true }
        ],
        "trigger_logic": "OR"
      },
      "guard": []
    }
  ]
}
\`\`\``;

  it("expands an array `expr` (OR list) into one single-condition transition per term", () => {
    const out = parseStateMachineProposal(OR_TRIGGER);
    expect(out).not.toBeNull();
    expect(out!.states.length).toBe(2);
    // 3 OR terms -> 3 single-condition transitions
    expect(out!.transitions.length).toBe(3);
    for (const t of out!.transitions) {
      expect(t.from_state_id).toBe("driving");
      expect(t.to_state_id).toBe("faulted");
      expect(t.trigger.kind).toBe("command");
      // each expanded trigger holds exactly ONE condition (schema-valid)
      if (t.trigger.kind === "command") {
        expect(Array.isArray(t.trigger.expr)).toBe(false);
        expect(typeof t.trigger.expr.tag).toBe("string");
      }
    }
    // unique transition_ids, all derived from the original
    const ids = out!.transitions.map((t) => t.transition_id);
    expect(new Set(ids).size).toBe(3);
    expect(ids.every((id) => id.startsWith("driving_to_faulted"))).toBe(true);
    // covers every original tag
    const tags = out!.transitions.map((t) =>
      t.trigger.kind === "command" ? t.trigger.expr.tag : "",
    );
    expect(tags.sort()).toEqual(["CM1_Fault", "CM2_Fault", "VSD1_CB_Trip"]);
  });

  it("preserves normal single-condition + completion transitions alongside an expanded OR", () => {
    const mixed = `\`\`\`json
{
  "states": [
    { "state_id": "stopped", "name": "Stopped", "kind": "static", "allowed_modes": [], "is_safe_state": true },
    { "state_id": "driving", "name": "Driving", "kind": "static", "allowed_modes": [], "is_safe_state": false }
  ],
  "transitions": [
    { "transition_id": "stopped_to_driving", "from_state_id": "stopped", "to_state_id": "driving",
      "trigger": { "kind": "command", "expr": { "tag": "Fwd", "operator": "=", "value": true } }, "guard": [] },
    { "transition_id": "driving_to_stopped", "from_state_id": "driving", "to_state_id": "stopped",
      "trigger": { "kind": "command",
        "expr": [ { "tag": "F1", "operator": "=", "value": true }, { "tag": "F2", "operator": "=", "value": true } ] },
      "guard": [] }
  ]
}
\`\`\``;
    const out = parseStateMachineProposal(mixed);
    expect(out).not.toBeNull();
    // 1 normal + 2 expanded = 3
    expect(out!.transitions.length).toBe(3);
    const single = out!.transitions.find((t) => t.transition_id === "stopped_to_driving");
    expect(single).toBeTruthy();
    expect(single!.trigger.kind === "command" && single!.trigger.expr.tag).toBe("Fwd");
  });
});

describe("validateEmStateMachineAndPackml", () => {
  it("returns [] for a canonical PackML machine", () => {
    expect(validateEmStateMachineAndPackml(em("cm", { states: defaultEmStates() }))).toEqual([]);
  });

  it("returns [] for an empty skeleton", () => {
    expect(validateEmStateMachineAndPackml(em("empty"))).toEqual([]);
  });

  it("surfaces a non-PackML slug as a conformance issue", () => {
    const states: EmStateV2[] = [
      { state_id: "driving_fwd", name: "Driving Fwd", kind: "static", allowed_modes: [], is_safe_state: false },
      { state_id: "aborted", name: "Aborted", kind: "static", allowed_modes: [], is_safe_state: true },
    ];
    const issues = validateEmStateMachineAndPackml(em("a", { states }));
    expect(issues.some((i) => i.includes('non-PackML state_id "driving_fwd"'))).toBe(true);
  });

  it("lists structural issues before conformance issues", () => {
    const states: EmStateV2[] = [
      { state_id: "driving_fwd", name: "Driving Fwd", kind: "static", allowed_modes: [], is_safe_state: true },
    ];
    const bad = em("b", {
      states,
      transitions: [
        { transition_id: "t1", from_state_id: "driving_fwd", to_state_id: "ghost",
          trigger: { kind: "completion" }, guard: [] },
      ],
    });
    const issues = validateEmStateMachineAndPackml(bad);
    const structuralIdx = issues.findIndex((i) => /unknown.*ghost/.test(i));
    const conformanceIdx = issues.findIndex((i) => /non-PackML/.test(i));
    expect(structuralIdx).toBeGreaterThanOrEqual(0);
    expect(conformanceIdx).toBeGreaterThanOrEqual(0);
    expect(structuralIdx).toBeLessThan(conformanceIdx);
  });
});
