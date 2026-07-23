import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BuilderStepper } from "@/components/code-builder/builder-stepper";

describe("BuilderStepper", () => {
  it("enables Device, EM and Unit, disables Export", () => {
    render(<BuilderStepper active="device" />);
    expect(screen.getByTestId("step-device")).not.toBeDisabled();
    expect(screen.getByTestId("step-em")).not.toBeDisabled();
    expect(screen.getByTestId("step-unit")).not.toBeDisabled();
    expect(screen.getByTestId("step-export")).toBeDisabled();
  });

  it("calls onSelect for enabled steps only", () => {
    const onSelect = vi.fn();
    render(<BuilderStepper active="device" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("step-em"));
    expect(onSelect).toHaveBeenCalledWith("em");
    fireEvent.click(screen.getByTestId("step-unit"));
    expect(onSelect).toHaveBeenCalledWith("unit");
    fireEvent.click(screen.getByTestId("step-export"));
    expect(onSelect).toHaveBeenCalledTimes(2); // disabled click ignored
  });
});
