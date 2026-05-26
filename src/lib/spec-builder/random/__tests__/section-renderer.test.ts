import { describe, expect, it } from "vitest";
import type { AssemblyContract } from "@/types/spec-contract-v2";
import {
  renderSequentialContentJson,
  renderStaticContentJson,
} from "../section-renderer";
import { STATE_ID_STARTING, STATE_ID_IDLE } from "../state-machine";

const contract: AssemblyContract = {
  assembly_id: "00000000-0000-0000-0000-000000000001",
  subsystem_id: "00000000-0000-0000-0000-0000000000ff",
  static_states: {
    [String(STATE_ID_IDLE)]: { override_kind: "override", devices: [], notes: null },
  },
  sequential_states: {
    [String(STATE_ID_STARTING)]: {
      override_kind: "override",
      permissives: [],
      steps: [
        {
          step_id: "s-3-1",
          branch_id: "b-x-3-main",
          name: "M01: Energise motor",
          actions: [],
          monitors: [],
          transitions: [],
          step: 1,
          action: "Set CV01_M01_CMD = TRUE",
          completion_criteria: [
            { kind: "tag_equals", tag: "CV01_M01_FB_RUN", value: true, within_ms: 3000 },
          ],
          completion_criteria_text: "CV01_M01_FB_RUN = true within 3000ms, else fault",
        },
      ],
      branches: [],
      state_monitors: [],
      sequence_model_version: 2,
      notes: null,
    },
  },
};

describe("renderSequentialContentJson", () => {
  it("produces a payload with pattern='sequential' and a steps array", () => {
    const json = renderSequentialContentJson(contract.sequential_states[String(STATE_ID_STARTING)]);
    expect(json.pattern).toBe("sequential");
    expect(Array.isArray(json.steps)).toBe(true);
    expect(json.steps).toHaveLength(1);
  });

  it("each rendered step has step/action/completion_criteria (prose) keys", () => {
    const json = renderSequentialContentJson(contract.sequential_states[String(STATE_ID_STARTING)]);
    const s = json.steps[0] as Record<string, unknown>;
    expect(s.step).toBe(1);
    expect(s.action).toBe("Set CV01_M01_CMD = TRUE");
    expect(s.completion_criteria).toBe("CV01_M01_FB_RUN = true within 3000ms, else fault");
  });

  it("preserves notes=null and permissives=[]", () => {
    const json = renderSequentialContentJson(contract.sequential_states[String(STATE_ID_STARTING)]);
    expect(json.notes).toBeNull();
    expect(json.permissives).toEqual([]);
  });
});

describe("renderStaticContentJson", () => {
  it("produces pattern='static' with empty device_states for an empty StaticStateV2", () => {
    const json = renderStaticContentJson(contract.static_states[String(STATE_ID_IDLE)]);
    expect(json.pattern).toBe("static");
    expect(json.device_states).toEqual([]);
  });
});
