import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HardwareStep, emptyHardware, plcModelFromHardware } from "@/components/spec-builder/hardware-step";
import type { CatalogProduct } from "@/lib/spec-builder/hardware-catalog";

const catalogState = {
  products: [] as CatalogProduct[],
  unavailable: false,
  searching: false,
  enabled: true,
};
const useHardwareCatalogMock = vi.fn(() => catalogState);

vi.mock("@/hooks/use-hardware-catalog", () => ({
  MIN_FILTER_LENGTH: 3,
  useHardwareCatalog: (...args: unknown[]) =>
    (useHardwareCatalogMock as unknown as (...a: unknown[]) => typeof catalogState)(...args),
}));

beforeEach(() => {
  catalogState.products = [];
  catalogState.unavailable = false;
  catalogState.searching = false;
  catalogState.enabled = true;
  useHardwareCatalogMock.mockClear();
});

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

describe("HardwareStep — catalogue picker (G0-17)", () => {
  const cpu: CatalogProduct = {
    articleNumber: "6ES7 516-3AN02-0AB0",
    typeName: "CPU 1516-3 PN/DP",
    description: "",
    catalogPath: "Root\\Controllers",
    versions: [
      { version: "V2.9", typeIdentifier: "OrderNumber:6ES7 516-3AN02-0AB0/V2.9" },
      { version: "V2.8", typeIdentifier: "OrderNumber:6ES7 516-3AN02-0AB0/V2.8" },
    ],
  };
  const card: CatalogProduct = {
    articleNumber: "6ES7 521-1BH00-0AB0",
    typeName: "DI 16x24VDC HF",
    description: "",
    catalogPath: "Root\\Modules",
    versions: [{ version: "V2.2", typeIdentifier: "OrderNumber:6ES7 521-1BH00-0AB0/V2.2" }],
  };

  it("writes order number and firmware onto the CPU when one is picked", () => {
    catalogState.products = [cpu];
    const onChange = vi.fn();
    render(<HardwareStep hardware={emptyHardware()} onChange={onChange} signals={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /browse catalogue/i }));
    fireEvent.click(screen.getByRole("button", { name: /CPU 1516-3 PN\/DP/ }));

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        cpu: {
          cpu_type: "CPU 1516-3 PN/DP",
          cpu_order_number: "6ES7 516-3AN02-0AB0",
          firmware: "V2.9", // newest installed firmware, not a guess
        },
      }),
    );
  });

  it("appends a module with its shape inferred from the catalogue name", () => {
    catalogState.products = [card];
    const onChange = vi.fn();
    render(<HardwareStep hardware={emptyHardware()} onChange={onChange} signals={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /add from catalogue/i }));
    fireEvent.click(screen.getByRole("button", { name: /DI 16x24VDC HF/ }));

    const next = onChange.mock.calls[0][0];
    expect(next.racks[0].modules[0]).toMatchObject({
      slot: 1,
      module_type: "DI 16x24VDC HF",
      order_number: "6ES7 521-1BH00-0AB0",
      signal_type: "DI",
      channel_count: 16,
    });
  });

  it("filters modules to the picked CPU by passing its type identifier", () => {
    catalogState.products = [card];
    const hardware = emptyHardware();
    hardware.cpu = {
      cpu_type: "CPU 1516-3 PN/DP",
      cpu_order_number: "6ES7 516-3AN02-0AB0",
      firmware: "V2.9",
    };
    render(<HardwareStep hardware={hardware} onChange={vi.fn()} signals={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /add from catalogue/i }));

    expect(useHardwareCatalogMock).toHaveBeenCalledWith(
      expect.any(String),
      "OrderNumber:6ES7 516-3AN02-0AB0/V2.9",
    );
  });

  it("tells the user to hand-enter when the bridge is unreachable", () => {
    catalogState.unavailable = true;
    render(<HardwareStep hardware={emptyHardware()} onChange={vi.fn()} signals={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /browse catalogue/i }));
    expect(screen.getByText(/bridge unavailable/i)).toBeInTheDocument();
  });
});
