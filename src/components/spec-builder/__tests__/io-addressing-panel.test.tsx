import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { IoAddressingPanel } from "@/components/spec-builder/io-addressing-panel";
import type { HardwareModelV1 } from "@/types/spec-contract-v2";
import type { UnitConfig } from "@/types/spec-builder";

const hardware: HardwareModelV1 = {
  platform: "SIEMENS_TIA",
  cpu: { cpu_type: "CPU 1511-1 PN" },
  racks: [
    { rack: 0, modules: [{ slot: 2, module_type: "DI 16", channel_count: 16, signal_type: "DI" }] },
  ],
};

const unitsWith = (signals: Array<{ tag: string; io_address: string }>) =>
  [
    {
      unit_id: "U1",
      unit_name: "Unit 1",
      equipment_type: "Other",
      description: "",
      excluded: false,
      equipment_modules: [
        {
          equipment_module_id: "EM1",
          equipment_module_name: "EM 1",
          description: "",
          control_modules: [
            {
              control_module_id: "CM1",
              control_module_name: "CM 1",
              control_module_class: "other",
              description: "",
              is_safety: false,
              io_signals: signals.map((s) => ({ ...s, signal_type: "DI", description: "" })),
            },
          ],
        },
      ],
    },
  ] as unknown as UnitConfig[];

describe("IoAddressingPanel", () => {
  it("summarises how many signals would move and lists them", () => {
    render(
      <IoAddressingPanel
        hardware={hardware}
        units={unitsWith([
          { tag: "A", io_address: "%I9.9" },
          { tag: "B", io_address: "%I0.1" },
        ])}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText(/1 of 2/)).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("%I0.0")).toBeInTheDocument();
  });

  it("applies the plan when the button is pressed", () => {
    const onApply = vi.fn();
    render(
      <IoAddressingPanel
        hardware={hardware}
        units={unitsWith([{ tag: "A", io_address: "%I9.9" }])}
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply.mock.calls[0][0].assignments).toEqual([
      { tag: "A", signal_type: "DI", from: "%I9.9", to: "%I0.0", changed: true },
    ]);
  });

  it("disables apply when every address already matches the rack", () => {
    render(
      <IoAddressingPanel
        hardware={hardware}
        units={unitsWith([{ tag: "A", io_address: "%I0.0" }])}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /match/i })).toBeDisabled();
  });

  it("surfaces engine warnings rather than dropping signals silently", () => {
    render(
      <IoAddressingPanel
        hardware={{ ...hardware, racks: [{ rack: 0, modules: [] }] }}
        units={unitsWith([{ tag: "A", io_address: "" }])}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByTestId("io-addressing-warnings")).toHaveTextContent(/no DI channel left/i);
  });

  it("renders nothing when there is no hardware and no signals", () => {
    const { container } = render(
      <IoAddressingPanel
        hardware={{ platform: "SIEMENS_TIA", cpu: { cpu_type: "" }, racks: [] }}
        units={[]}
        onApply={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
