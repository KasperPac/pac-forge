// src/components/spec-builder/monitors/__tests__/monitor-pane-integration.test.tsx
import { describe, expect, it } from "vitest";
import type { SequentialStateV2, MonitorV2 } from "@/types/spec-contract-v2";
import { __testing } from "@/components/spec-builder/fds-table-pane";

const monitor: MonitorV2 = {
  monitor_id: "m1",
  condition: { kind: "tag_equals", tag: "E_STOP", value: false },
  effect: "fault",
  fault_ref: { fault_code: "F_ESTOP", severity: "fault" },
  auto_clear: false,
  priority: 0,
};

describe("FlatStep monitors round-trip", () => {
  it("preserves StepV2.monitors through toFlatSteps → fromFlatSteps", () => {
    const state: SequentialStateV2 = {
      permissives: [],
      notes: null,
      steps: [
        {
          step_id: "s-1",
          step: 10,
          action: "Start motor",
          completion_criteria: [],
          completion_criteria_text: "",
          monitors: [monitor],
        },
      ],
    };
    const flat = __testing.toFlatSteps(state);
    expect(flat[0].monitors).toHaveLength(1);
    expect(flat[0].monitors?.[0].monitor_id).toBe("m1");

    const partial = __testing.fromFlatSteps(flat);
    expect(partial.steps?.[0].monitors).toHaveLength(1);
    expect(partial.steps?.[0].monitors?.[0].monitor_id).toBe("m1");
  });

  it("defaults to empty monitors when the step doesn't carry any", () => {
    const state: SequentialStateV2 = {
      permissives: [],
      notes: null,
      steps: [
        { step_id: "s-1", step: 10, action: "x", completion_criteria: [], completion_criteria_text: "" },
      ],
    };
    const flat = __testing.toFlatSteps(state);
    expect(flat[0].monitors ?? []).toHaveLength(0);
    const partial = __testing.fromFlatSteps(flat);
    expect(partial.steps?.[0].monitors).toEqual([]);
  });
});
