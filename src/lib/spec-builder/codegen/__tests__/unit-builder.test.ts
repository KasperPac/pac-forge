// src/lib/spec-builder/codegen/__tests__/unit-builder.test.ts
import { describe, it, expect } from "vitest";
import { buildUnitSequence, type UnitMemberEm } from "../unit-builder";
import type { OperatorMode, UnitCoordinationV1, UnitTransitionV1 } from "@/types/spec-contract-v2";

const twoModes: OperatorMode[] = [
  { mode_id: "prod", name: "Production", is_default: true, kind: "production" },
  { mode_id: "maint", name: "Maintenance", is_default: false, kind: "maintenance" },
];

const twoMembers: UnitMemberEm[] = [
  { emId: "em-a", emName: "Drive", states: [{ slug: "idle", index: 0 }, { slug: "active", index: 1 }] },
  { emId: "em-b", emName: "Brake", states: [{ slug: "released", index: 0 }, { slug: "idle", index: 2 }] },
];

/** A minimal 2-state coord (idle→complete) with one supplied transition. */
function coordWithTransition(t: UnitTransitionV1): UnitCoordinationV1 {
  return {
    unit_id: "unit-1",
    states: [
      { state_id: "idle", allowed_modes: [], mode_change_allowed: true },
      { state_id: "complete", allowed_modes: [], mode_change_allowed: false },
    ],
    transitions: [t],
    em_command_overrides: null,
  };
}

describe("buildUnitSequence — Cur_St state indexing (G2-1)", () => {
  it("orders declared states by canonical UNIT_PACKML_STATES and assigns sequential Cur_St indices", () => {
    // Authored in a deliberately non-canonical order; the writer must index by
    // the canonical UNIT_PACKML_STATES order (G0-9 PackTags rule; G7-1 text
    // lists share this order), NOT authoring order.
    const coord: UnitCoordinationV1 = {
      unit_id: "unit-1",
      states: [
        { state_id: "held", allowed_modes: [], mode_change_allowed: false },
        { state_id: "idle", allowed_modes: [], mode_change_allowed: true },
        { state_id: "execute", allowed_modes: [], mode_change_allowed: false },
      ],
      transitions: [],
      em_command_overrides: null,
    };

    const ir = buildUnitSequence({ unitId: "unit-1", unitName: "Carriage", coord, members: [], modes: [] });

    // canonical order: idle (0) < execute (2) < held (7) → reindexed 0,1,2
    expect(ir.states.map((s) => s.stateId)).toEqual(["idle", "execute", "held"]);
    expect(ir.states.map((s) => s.index)).toEqual([0, 1, 2]);
    expect(ir.warnings).toEqual([]);
  });
});

describe("buildUnitSequence — per-state EM command table (G2-1/G2-3 seam)", () => {
  it("resolves each state's member-EM commands from the canonical map, applying per-EM overrides", () => {
    const coord: UnitCoordinationV1 = {
      unit_id: "unit-1",
      states: [
        { state_id: "execute", allowed_modes: [], mode_change_allowed: false },
        { state_id: "holding", allowed_modes: [], mode_change_allowed: false },
      ],
      transitions: [],
      // In "holding", override member "em-b" to STOP instead of the canonical HOLD.
      em_command_overrides: {
        holding: [{ equipment_module_id: "em-b", command: "STOP" }],
      },
    };
    const members: UnitMemberEm[] = [
      { emId: "em-a", emName: "Drive", states: [] },
      { emId: "em-b", emName: "Brake", states: [] },
    ];

    const ir = buildUnitSequence({ unitId: "unit-1", unitName: "Carriage", coord, members, modes: [] });
    const byState = Object.fromEntries(ir.states.map((s) => [s.stateId, s.commands]));

    // execute → canonical START for every member
    expect(byState.execute).toEqual([
      { emId: "em-a", command: "START" },
      { emId: "em-b", command: "START" },
    ]);
    // holding → canonical HOLD for em-a; overridden STOP for em-b; member order preserved
    expect(byState.holding).toEqual([
      { emId: "em-a", command: "HOLD" },
      { emId: "em-b", command: "STOP" },
    ]);
  });
});

describe("buildUnitSequence — resolved transitions (G2-1)", () => {
  it("resolves from/to Cur_St indices from canonical state ordering", () => {
    const coord = coordWithTransition({
      transition_id: "t1", from_state_id: "idle", to_state_id: "complete",
      trigger: { type: "command", command: "start" }, guard: [], allowed_modes: [],
    });
    const ir = buildUnitSequence({ unitId: "unit-1", unitName: "Carriage", coord, members: twoMembers, modes: [] });
    // idle=0, complete=4 in canonical order → but reindexed among declared: idle(0), complete(1)
    expect(ir.transitions[0].fromIndex).toBe(0);
    expect(ir.transitions[0].toIndex).toBe(1);
  });

  it("resolves a command trigger to the PackML command word", () => {
    const coord = coordWithTransition({
      transition_id: "t1", from_state_id: "idle", to_state_id: "complete",
      trigger: { type: "command", command: "start" }, guard: [], allowed_modes: [],
    });
    const ir = buildUnitSequence({ unitId: "unit-1", unitName: "Carriage", coord, members: twoMembers, modes: [] });
    expect(ir.transitions[0].trigger).toEqual({ kind: "command", command: "start" });
  });

  it("passes a condition trigger's expression through unchanged", () => {
    const expr = [{ tag: "Start_PB", operator: "=" as const, value: true }];
    const coord = coordWithTransition({
      transition_id: "t1", from_state_id: "idle", to_state_id: "complete",
      trigger: { type: "condition", expr }, guard: [], allowed_modes: [],
    });
    const ir = buildUnitSequence({ unitId: "unit-1", unitName: "Carriage", coord, members: twoMembers, modes: [] });
    expect(ir.transitions[0].trigger).toEqual({ kind: "condition", expr });
  });

  it("resolves em_aggregate 'all' to each member EM's own state index, in member order", () => {
    const coord = coordWithTransition({
      transition_id: "t1", from_state_id: "idle", to_state_id: "complete",
      trigger: { type: "em_aggregate", em_scope: "all", em_state: "idle" }, guard: [], allowed_modes: [],
    });
    const ir = buildUnitSequence({ unitId: "unit-1", unitName: "Carriage", coord, members: twoMembers, modes: [] });
    expect(ir.transitions[0].trigger).toEqual({
      kind: "em_aggregate",
      comparisons: [
        { emName: "Drive", stateIndex: 0 }, // "idle" is index 0 on Drive
        { emName: "Brake", stateIndex: 2 }, // "idle" is index 2 on Brake
      ],
      alwaysFalse: false,
    });
    expect(ir.warnings).toEqual([]);
  });

  it("renders em_aggregate FALSE + warns when a member EM lacks the referenced slug (never silently true)", () => {
    const coord = coordWithTransition({
      transition_id: "t1", from_state_id: "idle", to_state_id: "complete",
      trigger: { type: "em_aggregate", em_scope: "all", em_state: "purging" }, guard: [], allowed_modes: [],
    });
    const ir = buildUnitSequence({ unitId: "unit-1", unitName: "Carriage", coord, members: twoMembers, modes: [] });
    const trig = ir.transitions[0].trigger;
    expect(trig.kind).toBe("em_aggregate");
    if (trig.kind === "em_aggregate") expect(trig.alwaysFalse).toBe(true);
    expect(ir.warnings.some((w) => w.includes("purging") && w.includes("Drive"))).toBe(true);
  });
});

describe("buildUnitSequence — transition mode masks + guards (G2-1)", () => {
  it("resolves transition allowed_modes to a Cur_Mode index mask (empty = all modes)", () => {
    const coord: UnitCoordinationV1 = {
      unit_id: "unit-1",
      states: [
        { state_id: "idle", allowed_modes: [], mode_change_allowed: true },
        { state_id: "execute", allowed_modes: [], mode_change_allowed: false },
        { state_id: "stopping", allowed_modes: [], mode_change_allowed: false },
      ],
      transitions: [
        { transition_id: "t-maint", from_state_id: "idle", to_state_id: "execute",
          trigger: { type: "command", command: "start" }, guard: [], allowed_modes: ["maint"] },
        { transition_id: "t-any", from_state_id: "execute", to_state_id: "stopping",
          trigger: { type: "command", command: "stop" }, guard: [], allowed_modes: [] },
      ],
      em_command_overrides: null,
    };
    const ir = buildUnitSequence({ unitId: "unit-1", unitName: "Carriage", coord, members: twoMembers, modes: twoModes });
    const byId = Object.fromEntries(ir.transitions.map((t) => [t.transitionId, t.modeMask]));
    expect(byId["t-maint"]).toEqual([1]); // maint = Cur_Mode index 1
    expect(byId["t-any"]).toEqual([]); // empty = all modes
  });

  it("passes a transition's guard array through unchanged", () => {
    const guard = [{ tag: "Enable", operator: "=" as const, value: true }];
    const coord = coordWithTransition({
      transition_id: "t1", from_state_id: "idle", to_state_id: "complete",
      trigger: { type: "command", command: "start" }, guard, allowed_modes: [],
    });
    const ir = buildUnitSequence({ unitId: "unit-1", unitName: "Carriage", coord, members: twoMembers, modes: [] });
    expect(ir.transitions[0].guard).toEqual(guard);
  });
});

describe("buildUnitSequence — safety override target (G2-1)", () => {
  function coordWithStates(stateIds: string[]): UnitCoordinationV1 {
    return {
      unit_id: "unit-1",
      states: stateIds.map((s) => ({
        state_id: s as UnitCoordinationV1["states"][number]["state_id"],
        allowed_modes: [],
        mode_change_allowed: false,
      })),
      transitions: [],
      em_command_overrides: null,
      signal_routing: {
        safety_healthy: { gate_ids: ["estop"], exclude_maintenance: false },
        routing_rows: [],
        two_detent: [],
        command_routing: { policy: "walk_to_execute_stop_on_unhealthy", seq_test_release: false },
      },
    };
  }
  const gates = [
    { gate_id: "estop", name: "E-Stop", condition: [{ tag: "EStop_OK", operator: "=" as const, value: true }], scope: "all" as const },
  ];

  it("targets the declared aborting state and excludes aborting/aborted from the override", () => {
    const ir = buildUnitSequence({
      unitId: "unit-1", unitName: "Carriage",
      coord: coordWithStates(["idle", "execute", "aborting", "aborted"]),
      members: [], modes: [], safetyGates: gates,
    });
    // canonical order: idle 0, execute 1, aborting 2, aborted 3
    expect(ir.safetyHealthy?.overrideTargetIndex).toBe(2);
    expect(ir.safetyHealthy?.overrideExcludeIndices).toEqual([2, 3]);
  });

  it("falls back aborting -> aborted -> stopped", () => {
    const ir = buildUnitSequence({
      unitId: "unit-1", unitName: "Carriage",
      coord: coordWithStates(["idle", "stopped"]),
      members: [], modes: [], safetyGates: gates,
    });
    expect(ir.safetyHealthy?.overrideTargetIndex).toBe(1); // stopped
    expect(ir.safetyHealthy?.overrideExcludeIndices).toEqual([]);
  });

  it("warns and skips the override when no aborting/aborted/stopped state is declared", () => {
    const ir = buildUnitSequence({
      unitId: "unit-1", unitName: "Carriage",
      coord: coordWithStates(["idle", "execute"]),
      members: [], modes: [], safetyGates: gates,
    });
    expect(ir.safetyHealthy?.overrideTargetIndex).toBeUndefined();
    expect(ir.warnings.some((w) => w.includes("safety override"))).toBe(true);
  });
});

describe("buildUnitSequence — mode manager legality expansion (G2-1)", () => {
  it("resolves per-mode unit-state masks, member-EM allowed-state indices, and the mode-change-allowed set", () => {
    const members: UnitMemberEm[] = [
      {
        emId: "em-a",
        emName: "Drive",
        states: [
          { slug: "idle", index: 0, allowedModes: [] },        // all modes
          { slug: "active", index: 1, allowedModes: ["prod"] }, // prod only
        ],
      },
    ];
    const coord: UnitCoordinationV1 = {
      unit_id: "unit-1",
      states: [
        { state_id: "idle", allowed_modes: [], mode_change_allowed: true },
        { state_id: "execute", allowed_modes: ["prod"], mode_change_allowed: false },
        { state_id: "stopped", allowed_modes: [], mode_change_allowed: true },
      ],
      transitions: [],
      em_command_overrides: null,
    };
    const ir = buildUnitSequence({ unitId: "unit-1", unitName: "Carriage", coord, members, modes: twoModes });

    expect(ir.modeManager).toBeDefined();
    const mm = ir.modeManager!;
    // canonical order: idle 0, execute 1, stopped 2
    expect(mm.modeChangeAllowedIndices).toEqual([0, 2]);
    expect(mm.defaultModeIndex).toBe(0); // prod is_default

    const prod = mm.modes[0];
    expect(prod.name).toBe("Production");
    expect(prod.index).toBe(0);
    expect(prod.unitStateIndices).toBeNull(); // every unit state allows prod
    expect(prod.emTerms).toEqual([]); // Drive: all states allow prod -> unrestricted, no term

    const maint = mm.modes[1];
    expect(maint.index).toBe(1);
    expect(maint.unitStateIndices).toEqual([0, 2]); // execute is prod-only
    // Drive may only be in idle (index 0) for a maint grant
    expect(maint.emTerms).toEqual([{ emName: "Drive", stateIndices: [0] }]);
  });

  it("emits no mode manager when the project declares no modes", () => {
    const coord: UnitCoordinationV1 = {
      unit_id: "unit-1",
      states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
      transitions: [],
      em_command_overrides: null,
    };
    const ir = buildUnitSequence({ unitId: "unit-1", unitName: "Carriage", coord, members: [], modes: [] });
    expect(ir.modeManager).toBeUndefined();
  });
});

describe("buildUnitSequence — mode-kind command gating (G2-3)", () => {
  const kindModes: OperatorMode[] = [
    { mode_id: "prod", name: "Production", is_default: true, kind: "production" },
    { mode_id: "maint", name: "Maintenance", is_default: false, kind: "maintenance" },
    { mode_id: "eng", name: "Seq Test", is_default: false, kind: "engineering" },
  ];

  it("resolves engineering- and maintenance-kind modes to Cur_Mode index sets", () => {
    const coord: UnitCoordinationV1 = {
      unit_id: "unit-1",
      states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
      transitions: [],
      em_command_overrides: null,
    };
    const ir = buildUnitSequence({ unitId: "unit-1", unitName: "Carriage", coord, members: [], modes: kindModes });
    expect(ir.commandGating).toEqual({
      engineeringModeIndices: [2],
      maintenanceModeIndices: [1],
    });
  });

  it("flags library-seam members with a warning (no command-role contract yet)", () => {
    const members: UnitMemberEm[] = [
      { emId: "em-a", emName: "Drive", states: [] },
      { emId: "em-b", emName: "Lifter", states: [], librarySeam: "FB_Lift_Std" },
    ];
    const coord: UnitCoordinationV1 = {
      unit_id: "unit-1",
      states: [{ state_id: "idle", allowed_modes: [], mode_change_allowed: true }],
      transitions: [],
      em_command_overrides: null,
    };
    const ir = buildUnitSequence({ unitId: "unit-1", unitName: "Carriage", coord, members, modes: [] });
    expect(ir.members.find((m) => m.emName === "Lifter")?.librarySeam).toBe("FB_Lift_Std");
    expect(ir.warnings.some((w) => w.includes("Lifter") && w.includes("FB_Lift_Std"))).toBe(true);
  });
});
