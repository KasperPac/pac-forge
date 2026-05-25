import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MigrateStatesTab } from "../migrate-states-tab";
import type { ProposedStateMapping } from "@/lib/spec-builder/migrate/types";

const proposal: ProposedStateMapping[] = [
  { legacy_name: "Execute", match_source: "exact", packml_id: 6 },
  { legacy_name: "Running", match_source: "synonym", packml_id: 6 },
  { legacy_name: "Lubrication", match_source: "unmapped" },
];

describe("MigrateStatesTab", () => {
  it("renders one row per legacy state", () => {
    render(
      <MigrateStatesTab
        proposal={proposal}
        value={proposal}
        onChange={vi.fn()}
        onTabComplete={vi.fn()}
      />,
    );
    expect(screen.getByText("Execute")).toBeInTheDocument();
    expect(screen.getByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Lubrication")).toBeInTheDocument();
  });

  it("reports tabComplete=false while an unmapped row is unresolved", () => {
    const onTabComplete = vi.fn();
    render(
      <MigrateStatesTab
        proposal={proposal}
        value={proposal}
        onChange={vi.fn()}
        onTabComplete={onTabComplete}
      />,
    );
    expect(onTabComplete).toHaveBeenLastCalledWith(false);
  });

  it("reports tabComplete=true once every row resolves", () => {
    const onTabComplete = vi.fn();
    const resolved: ProposedStateMapping[] = [
      { legacy_name: "Execute", match_source: "exact", packml_id: 6 },
      { legacy_name: "Running", match_source: "synonym", packml_id: 6 },
      { legacy_name: "Lubrication", match_source: "unmapped", custom_state_id: 101, custom_name: "Lubrication" },
    ];
    render(
      <MigrateStatesTab
        proposal={proposal}
        value={resolved}
        onChange={vi.fn()}
        onTabComplete={onTabComplete}
      />,
    );
    expect(onTabComplete).toHaveBeenLastCalledWith(true);
  });

  it("calls onChange when a custom_state_id is entered", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(
      <MigrateStatesTab
        proposal={proposal}
        value={proposal}
        onChange={onChange}
        onTabComplete={vi.fn()}
      />,
    );
    // Find the row for Lubrication, click "Mark as custom"
    const customButtons = screen.getAllByRole("button", { name: /mark as custom/i });
    await user.click(customButtons[0]);
    expect(onChange).toHaveBeenCalled();
  });
});
