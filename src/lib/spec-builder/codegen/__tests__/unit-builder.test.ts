// src/lib/spec-builder/codegen/__tests__/unit-builder.test.ts
import { describe, it, expect } from "vitest";
import { buildUnitSequence, type UnitMemberEm } from "../unit-builder";
import type { UnitCoordinationV1, UnitTransitionV1 } from "@/types/spec-contract-v2";

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
