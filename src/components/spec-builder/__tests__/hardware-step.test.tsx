import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { HardwareStep, emptyHardware, plcModelFromHardware } from "@/components/spec-builder/hardware-step";

describe("plcModelFromHardware", () => {
  it("derives plc_model from cpu_type, trimmed", () => {
    expect(plcModelFromHardware({ platform: "SIEMENS_TIA", cpu: { cpu_type: "  CPU 1515  " }, racks: [] })).toBe("CPU 1515");
    expect(plcModelFromHardware(null)).toBe("");
  });
});

describe("HardwareStep", () => {
  it("renders a fit warning when the register is short on channels", () => {
    const hardware = emptyHardware();
    hardware.racks[0].modules.push({ slot: 1, module_type: "DI 8", channel_count: 8, signal_type: "DI" });
    const signals = Array.from({ length: 12 }, () => ({ signal_type: "DI" }));
    render(<HardwareStep hardware={hardware} onChange={vi.fn()} signals={signals} />);
    expect(screen.getByText(/short 4/i)).toBeInTheDocument();
  });

  it("renders no warning banner when hardware fits", () => {
    const hardware = emptyHardware();
    hardware.racks[0].modules.push({ slot: 1, module_type: "DI 16", channel_count: 16, signal_type: "DI" });
    render(<HardwareStep hardware={hardware} onChange={vi.fn()} signals={[{ signal_type: "DI" }]} />);
    expect(screen.queryByTestId("hardware-fit-warnings")).not.toBeInTheDocument();
  });
});
