import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FbQualityGates } from "../fb-quality-gates";
import type { SafetyWarning } from "@/types";
import type { ReviewFinding } from "@/lib/forge-review-parser";

const warning = (over: Partial<SafetyWarning>): SafetyWarning => ({
  id: crypto.randomUUID(), type: "MISSING_INTERLOCK", artifact_name: "EM_X",
  description: "Motor coil without interlock", line: 12, acknowledged: false, ...over,
});

const base = {
  warnings: [] as SafetyWarning[],
  blocked: false,
  acknowledged: [] as string[],
  reviewStatus: null as "pass" | "findings" | null,
  findings: [] as ReviewFinding[],
  reviewing: false,
  onAcknowledge: vi.fn(),
  onRunReview: vi.fn(),
};

describe("FbQualityGates", () => {
  it("shows a clean safety state with no warnings", () => {
    render(<FbQualityGates {...base} />);
    expect(screen.getByTestId("safety-gate")).toHaveTextContent(/safe|pass|no warnings/i);
  });

  it("lists warnings and fires onAcknowledge", () => {
    const w = warning({ type: "UNSAFE_MOTOR", line: 7 });
    const onAcknowledge = vi.fn();
    render(<FbQualityGates {...base} warnings={[w]} blocked onAcknowledge={onAcknowledge} />);
    expect(screen.getByText(/Motor coil without interlock/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("ack-UNSAFE_MOTOR:7"));
    expect(onAcknowledge).toHaveBeenCalledWith("UNSAFE_MOTOR:7");
  });

  it("hides the acknowledge button for already-acknowledged warnings", () => {
    const w = warning({ type: "ARRAY_OOB", line: 5 });
    render(<FbQualityGates {...base} warnings={[w]} acknowledged={["ARRAY_OOB:5"]} />);
    expect(screen.queryByTestId("ack-ARRAY_OOB:5")).not.toBeInTheDocument();
  });

  it("runs the standards review and renders findings", () => {
    const onRunReview = vi.fn();
    const findings: ReviewFinding[] = [{ severity: "WARNING", artifactName: "EM_X", message: "Prefer SR over RS" }];
    const { rerender } = render(<FbQualityGates {...base} onRunReview={onRunReview} />);
    fireEvent.click(screen.getByTestId("run-review"));
    expect(onRunReview).toHaveBeenCalled();

    rerender(<FbQualityGates {...base} reviewStatus="findings" findings={findings} />);
    expect(screen.getByTestId("review-badge")).toHaveTextContent(/findings/i);
    expect(screen.getByText(/Prefer SR over RS/)).toBeInTheDocument();
  });

  it("disables the run button while reviewing", () => {
    render(<FbQualityGates {...base} reviewing />);
    expect(screen.getByTestId("run-review")).toBeDisabled();
  });
});
