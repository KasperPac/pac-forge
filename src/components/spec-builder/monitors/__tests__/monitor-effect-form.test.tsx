// src/components/spec-builder/monitors/__tests__/monitor-effect-form.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MonitorV2 } from "@/types/spec-contract-v2";
import { MonitorEffectForm } from "../monitor-effect-form";

const baseMonitor: MonitorV2 = {
  monitor_id: "m1",
  condition: { kind: "tag_equals", tag: "X", value: true },
  effect: "fault",
  fault_ref: { fault_code: "F_X", severity: "fault" },
  auto_clear: false,
  priority: 0,
};

describe("MonitorEffectForm", () => {
  it("renders fault_ref fields for fault effect", () => {
    render(
      <MonitorEffectForm monitor={baseMonitor} availableStepIds={[]} onChange={vi.fn()} />,
    );
    expect(screen.getByDisplayValue("F_X")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /severity/i })).toBeInTheDocument();
  });

  it("renders fault_ref fields for alarm effect", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MonitorEffectForm monitor={baseMonitor} availableStepIds={[]} onChange={onChange} />,
    );
    await user.click(screen.getByLabelText(/alarm/i));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ effect: "alarm" }),
    );
  });

  it("renders no fault_ref / target_step_id for hold effect", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MonitorEffectForm monitor={baseMonitor} availableStepIds={[]} onChange={onChange} />,
    );
    await user.click(screen.getByLabelText(/^hold$/i));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ effect: "hold", fault_ref: undefined, target_step_id: undefined }),
    );
  });

  it("renders target_step_id Select for branch_to effect", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <MonitorEffectForm
        monitor={baseMonitor}
        availableStepIds={["s-3-1", "s-3-2", "s-3-3"]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByLabelText(/branch/i));
    const last = onChange.mock.calls[onChange.mock.calls.length - 1][0] as MonitorV2;
    rerender(
      <MonitorEffectForm
        monitor={last}
        availableStepIds={["s-3-1", "s-3-2", "s-3-3"]}
        onChange={onChange}
      />,
    );
    await user.click(screen.getByRole("combobox", { name: /target step/i }));
    await user.click(screen.getByRole("option", { name: "s-3-2" }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ effect: "branch_to", target_step_id: "s-3-2" }),
    );
  });

  it("auto_clear checkbox round-trips", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MonitorEffectForm monitor={baseMonitor} availableStepIds={[]} onChange={onChange} />,
    );
    await user.click(screen.getByRole("checkbox", { name: /auto-clear/i }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ auto_clear: true }),
    );
  });

  it("priority input round-trips", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <MonitorEffectForm monitor={baseMonitor} availableStepIds={[]} onChange={onChange} />,
    );
    const input = screen.getByLabelText(/priority/i);
    await user.clear(input);
    await user.type(input, "5");
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ priority: 5 }),
    );
  });
});
