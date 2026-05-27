// src/components/spec-builder/monitors/__tests__/monitor-picker.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MonitorV2 } from "@/types/spec-contract-v2";
import { MonitorPicker } from "../monitor-picker";

const seed: MonitorV2[] = [
  {
    monitor_id: "m1",
    condition: { kind: "tag_equals", tag: "E_STOP", value: false },
    effect: "fault",
    fault_ref: { fault_code: "F_ESTOP", severity: "fault" },
    auto_clear: false,
    priority: 0,
  },
];

function renderPicker(overrides: Partial<React.ComponentProps<typeof MonitorPicker>> = {}) {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(
    <MonitorPicker
      open
      title="Monitors"
      monitors={seed}
      availableStepIds={["s-3-1", "s-3-2"]}
      availableTags={["E_STOP", "FB_RUN"]}
      onChange={onChange}
      onClose={onClose}
      {...overrides}
    />,
  );
  return { onChange, onClose };
}

describe("MonitorPicker", () => {
  it("renders the seed monitor in the list", () => {
    renderPicker();
    expect(screen.getByText(/E_STOP = false/)).toBeInTheDocument();
    expect(screen.getByText(/fault F_ESTOP/)).toBeInTheDocument();
  });

  it("Add appends a new default monitor", async () => {
    const user = userEvent.setup();
    renderPicker();
    await user.click(screen.getByRole("button", { name: /add/i }));
    // Two list rows now
    expect(screen.getAllByText(/→/).length).toBeGreaterThanOrEqual(2);
  });

  it("Save calls onChange with the current monitors and closes", async () => {
    const user = userEvent.setup();
    const { onChange, onClose } = renderPicker();
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onChange).toHaveBeenCalledWith(seed);
    expect(onClose).toHaveBeenCalled();
  });

  it("Cancel discards local edits", async () => {
    const user = userEvent.setup();
    const { onChange, onClose } = renderPicker();
    await user.click(screen.getByRole("button", { name: /add/i }));
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onChange).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("Delete removes the selected monitor", async () => {
    const user = userEvent.setup();
    const { onChange } = renderPicker();
    // Select the row, then click delete
    await user.click(screen.getByText(/E_STOP = false/));
    await user.click(screen.getByRole("button", { name: /delete monitor/i }));
    await user.click(screen.getByRole("button", { name: /save/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("Save is disabled when the selected monitor is invalid", async () => {
    const user = userEvent.setup();
    renderPicker({
      monitors: [
        {
          monitor_id: "bad",
          condition: { kind: "tag_equals", tag: "", value: true },
          effect: "fault",
          fault_ref: { fault_code: "F_X", severity: "fault" },
          auto_clear: false,
          priority: 0,
        },
      ],
    });
    await user.click(screen.getByText(/= true/));
    expect(screen.getByRole("button", { name: /save/i })).toBeDisabled();
  });
});
