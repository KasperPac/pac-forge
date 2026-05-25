import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MigrateModesTab } from "../migrate-modes-tab";
import type { ProposedModes } from "@/lib/spec-builder/migrate/types";

const baseProposal: ProposedModes = {
  modes: [{ mode_id: "auto", name: "Auto", is_default: true }],
  hints: [{ detected_state: "Manual Run", hint: "Detected state 'Manual Run' — consider adding a Manual mode" }],
};

describe("MigrateModesTab", () => {
  it("renders the default mode and the hint", () => {
    render(
      <MigrateModesTab
        proposal={baseProposal}
        value={baseProposal.modes}
        onChange={vi.fn()}
        onTabComplete={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Auto")).toBeInTheDocument();
    expect(screen.getByText(/Manual Run/)).toBeInTheDocument();
  });

  it("reports tabComplete=true for a valid single default mode", () => {
    const onTabComplete = vi.fn();
    render(
      <MigrateModesTab
        proposal={baseProposal}
        value={baseProposal.modes}
        onChange={vi.fn()}
        onTabComplete={onTabComplete}
      />,
    );
    expect(onTabComplete).toHaveBeenCalledWith(true);
  });

  it("calls onChange when an Add Mode button is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <MigrateModesTab
        proposal={baseProposal}
        value={baseProposal.modes}
        onChange={onChange}
        onTabComplete={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /add mode/i }));
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0];
    expect(next).toHaveLength(2);
  });

  it("surfaces 'exactly one default' error when two defaults are present", () => {
    const onTabComplete = vi.fn();
    const value = [
      { mode_id: "auto", name: "Auto", is_default: true },
      { mode_id: "manual", name: "Manual", is_default: true },
    ];
    render(
      <MigrateModesTab
        proposal={baseProposal}
        value={value}
        onChange={vi.fn()}
        onTabComplete={onTabComplete}
      />,
    );
    expect(screen.getByText(/exactly one/i)).toBeInTheDocument();
    expect(onTabComplete).toHaveBeenCalledWith(false);
  });
});
