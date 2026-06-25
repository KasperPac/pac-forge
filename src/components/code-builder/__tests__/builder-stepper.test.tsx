import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BuilderStepper } from "@/components/code-builder/builder-stepper";

describe("BuilderStepper", () => {
  it("enables Device and EM, disables Unit and Export", () => {
    render(<BuilderStepper active="device" />);
    expect(screen.getByTestId("step-device")).not.toBeDisabled();
    expect(screen.getByTestId("step-em")).not.toBeDisabled();
    expect(screen.getByTestId("step-unit")).toBeDisabled();
    expect(screen.getByTestId("step-export")).toBeDisabled();
  });

  it("calls onSelect for enabled steps only", () => {
    const onSelect = vi.fn();
    render(<BuilderStepper active="device" onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId("step-em"));
    expect(onSelect).toHaveBeenCalledWith("em");
    fireEvent.click(screen.getByTestId("step-unit"));
    expect(onSelect).toHaveBeenCalledTimes(1); // disabled click ignored
  });
});
