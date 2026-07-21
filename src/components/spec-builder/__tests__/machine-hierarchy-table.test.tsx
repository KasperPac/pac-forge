// src/components/spec-builder/__tests__/machine-hierarchy-table.test.tsx
//
// G0-16 W1 slice 1: polarity / conditioning / scaling / drive authoring in the
// hierarchy table. Render-level coverage; the load-path pass-through is covered
// in lib/spec-builder/__tests__/contract.test.ts.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MachineHierarchyTable } from "../machine-hierarchy-table";
import type { UnitConfig } from "@/types/spec-builder";

function fixtureUnits(): UnitConfig[] {
  return [
    {
      unit_id: "u1",
      unit_name: "Test Unit",
      equipment_type: "Other",
      description: "",
      excluded: false,
      equipment_modules: [
        {
          equipment_module_id: "em1",
          equipment_module_name: "Test EM",
          description: "",
          control_modules: [
            {
              control_module_id: "cm1",
              control_module_name: "M01",
              control_module_class: "motor",
              description: "",
              is_safety: false,
              drive: {
                family: "sinamics_g120",
                telegram: 1,
                speed_ref: { unit: "percent_ref_speed", signed: true },
                enable_policy: "enable_on_nonzero_ref",
              },
              io_signals: [
                {
                  tag: "M01_Therm",
                  signal_type: "DI",
                  io_address: "I0.0",
                  description: "thermistor",
                  polarity: "nc",
                },
                {
                  tag: "PT01",
                  signal_type: "AI",
                  io_address: "IW100",
                  description: "pressure",
                  scaling: {
                    raw: { min: 4, max: 20, unit: "mA" },
                    eu: { min: 0, max: 10, unit: "bar" },
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  ];
}

/** Expand every collapsed row until the tree is fully open. */
function expandAll() {
  for (let guard = 0; guard < 10; guard++) {
    const buttons = screen.queryAllByRole("button", { name: "Expand" });
    if (!buttons.length) return;
    buttons.forEach((b) => fireEvent.click(b));
  }
}

describe("MachineHierarchyTable — G0-1/G0-2 authoring (G0-16 W1)", () => {
  it("shows the drive family chip for a VSD-modeled control module", () => {
    render(
      <MachineHierarchyTable units={fixtureUnits()} availableTags={[]} onChange={() => {}} />,
    );
    expandAll();
    expect(screen.getByText("G120")).toBeInTheDocument();
  });

  it("shows N/C polarity on the fail-safe digital input and no polarity control on the analog row", () => {
    render(
      <MachineHierarchyTable units={fixtureUnits()} availableTags={[]} onChange={() => {}} />,
    );
    expandAll();
    expect(screen.getByText("N/C")).toBeInTheDocument();
    // exactly one polarity select — the DI row only
    expect(screen.getAllByLabelText("Wiring polarity")).toHaveLength(1);
  });

  it("shows the analog scaling chip labeled with the EU unit", () => {
    render(
      <MachineHierarchyTable units={fixtureUnits()} availableTags={[]} onChange={() => {}} />,
    );
    expandAll();
    expect(screen.getByText("bar")).toBeInTheDocument();
  });

  it("emits updated units with the new polarity when changed", () => {
    const onChange = vi.fn();
    const units = fixtureUnits();
    units[0].equipment_modules[0].control_modules[0].io_signals[0].polarity = undefined;
    render(<MachineHierarchyTable units={units} availableTags={[]} onChange={onChange} />);
    expandAll();

    fireEvent.click(screen.getByLabelText("Wiring polarity"));
    fireEvent.click(screen.getByText(/N\/C — fail-safe/));

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as UnitConfig[];
    expect(next[0].equipment_modules[0].control_modules[0].io_signals[0].polarity).toBe("nc");
  });

  it("emits conditioning via the signal-conditioning popover", () => {
    const onChange = vi.fn();
    render(<MachineHierarchyTable units={fixtureUnits()} availableTags={[]} onChange={onChange} />);
    expandAll();

    fireEvent.click(screen.getByLabelText("Signal conditioning"));
    fireEvent.change(screen.getByLabelText("Off delay ms"), { target: { value: "5000" } });

    const next = onChange.mock.calls[0][0] as UnitConfig[];
    expect(
      next[0].equipment_modules[0].control_modules[0].io_signals[0].conditioning,
    ).toEqual({ off_delay_ms: 5000 });
  });
});
