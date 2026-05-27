// src/components/spec-builder/monitors/__tests__/monitor-pane-integration.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SequentialStateV2, MonitorV2 } from "@/types/spec-contract-v2";
import type { OperatingState } from "@/types/spec-builder";
import { __testing, FdsTablePane } from "@/components/spec-builder/fds-table-pane";

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

// ---------------------------------------------------------------------------
// FdsTablePane — MonitorPicker integration
// ---------------------------------------------------------------------------

const EXECUTE_STATE: OperatingState = {
  state_id: "state-execute",
  state_name: "Execute",
  description: "Execute sequence",
  state_pattern: "sequential",
};

const EXECUTE_DATA: SequentialStateV2 = {
  permissives: [],
  notes: null,
  steps: [
    {
      step_id: "step-1",
      step: 10,
      action: "Start motor",
      completion_criteria: [],
      completion_criteria_text: "",
    },
  ],
};

describe("FdsTablePane — MonitorPicker integration", () => {
  it("state-monitor save reaches onUpdateState with the new state_monitors array", async () => {
    const user = userEvent.setup();
    const onUpdateState = vi.fn();

    render(
      <FdsTablePane
        sequentialStates={[EXECUTE_STATE]}
        stateData={{ "state-execute": EXECUTE_DATA }}
        onUpdateState={onUpdateState}
        allTags={[]}
      />,
    );

    // The button label is "State Monitors (0)" — the count is 0 initially.
    const stateMonitorBtn = screen.getByRole("button", { name: /state monitors/i });
    await user.click(stateMonitorBtn);

    // The MonitorPicker dialog should now be open.
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Click "Add" to append a default monitor.
    await user.click(screen.getByRole("button", { name: /add/i }));

    // The default monitor has tag: "" which fails validation.
    // Fill in the Tag input (the one inside the condition form for tag_equals).
    // It renders as <Input list="monitor-tag-options" value="" />.
    // The label element is not linked via htmlFor, so query by the datalist attribute.
    const tagInput = document.querySelector<HTMLInputElement>('input[list="monitor-tag-options"]');
    expect(tagInput).not.toBeNull();
    fireEvent.change(tagInput!, { target: { value: "E_STOP" } });

    // Save should now be enabled because the tag is non-empty.
    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).not.toBeDisabled();
    await user.click(saveBtn);

    // onUpdateState must have been called with state_monitors containing one monitor.
    expect(onUpdateState).toHaveBeenCalledOnce();
    const [calledStateId, calledData] = onUpdateState.mock.calls[0] as [string, SequentialStateV2];
    expect(calledStateId).toBe("state-execute");
    expect(calledData.state_monitors).toHaveLength(1);

    const saved = calledData.state_monitors![0] as MonitorV2;
    expect(saved.condition).toMatchObject({ kind: "tag_equals", tag: "E_STOP" });
    expect(saved.effect).toBe("fault");
  });
});
