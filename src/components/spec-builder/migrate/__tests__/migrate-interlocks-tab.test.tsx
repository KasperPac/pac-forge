import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MigrateInterlocksTab } from "../migrate-interlocks-tab";
import type { ProposedInterlock } from "@/lib/spec-builder/migrate/types";

const rows: ProposedInterlock[] = [
  {
    interlock_id: "il-1",
    source_equipment_module: "CV01",
    target_equipment_module: "LFT01",
    original_prose_condition: "CV01 is running",
    original_prose_effect: "hold the lift",
    effect: "hold",
    source_condition: { kind: "tag_equals", tag: "CV01.RUNNING", value: true },
    confidence: 0.95,
    reasoning: "exact tag",
  },
  {
    interlock_id: "il-2",
    source_equipment_module: "CV01",
    target_equipment_module: "LFT01",
    original_prose_condition: "CV01 has faulted",
    original_prose_effect: "block lift execute",
    effect: "hold",
    source_condition: { kind: "placeholder", criterion_id: "placeholder-il-2", prompt: "CV01 has faulted" },
    confidence: 0,
    reasoning: "fallback",
  },
];

describe("MigrateInterlocksTab", () => {
  it("renders one row per interlock", () => {
    render(
      <MigrateInterlocksTab rows={rows} onChange={vi.fn()} onTabComplete={vi.fn()} onReclassify={vi.fn()} />,
    );
    expect(screen.getByText("il-1")).toBeInTheDocument();
    expect(screen.getByText("il-2")).toBeInTheDocument();
  });

  it("reports tabComplete=false while any row has a placeholder source_condition", () => {
    const onTabComplete = vi.fn();
    render(
      <MigrateInterlocksTab rows={rows} onChange={vi.fn()} onTabComplete={onTabComplete} onReclassify={vi.fn()} />,
    );
    expect(onTabComplete).toHaveBeenLastCalledWith(false);
  });

  it("reports tabComplete=true once every row has a non-placeholder source_condition", () => {
    const onTabComplete = vi.fn();
    const resolved = rows.map((r, i) =>
      i === 1
        ? { ...r, source_condition: { kind: "tag_equals" as const, tag: "X", value: true } }
        : r,
    );
    render(
      <MigrateInterlocksTab rows={resolved} onChange={vi.fn()} onTabComplete={onTabComplete} onReclassify={vi.fn()} />,
    );
    expect(onTabComplete).toHaveBeenLastCalledWith(true);
  });

  it("fires onReclassify when 'Re-classify all' is clicked", async () => {
    const onReclassify = vi.fn();
    const user = userEvent.setup();
    render(
      <MigrateInterlocksTab rows={rows} onChange={vi.fn()} onTabComplete={vi.fn()} onReclassify={onReclassify} />,
    );
    await user.click(screen.getByRole("button", { name: /re-classify all/i }));
    expect(onReclassify).toHaveBeenCalledTimes(1);
  });
});
