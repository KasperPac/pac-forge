// src/components/spec-builder/__tests__/spec-skeleton-wizard-io.test.tsx
//
// G0-18: re-addressing IO from the declared rack inside the skeleton wizard.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SpecSkeletonWizard } from "@/components/spec-builder/spec-skeleton-wizard";
import type { InstrumentRegister, SpecProject } from "@/types/spec-builder";

vi.mock("@/hooks/use-spec-projects", () => ({
  useUpdateSpecProject: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-hardware-catalog", () => ({
  MIN_FILTER_LENGTH: 3,
  useHardwareCatalog: () => ({
    products: [],
    unavailable: false,
    searching: false,
    enabled: true,
  }),
}));

const spec = {
  id: "s1",
  doc_code: "DOC-1",
  title: "T",
  client_name: "C",
  revision: "A",
  hardware: {
    platform: "SIEMENS_TIA",
    cpu: { cpu_type: "CPU 1511-1 PN" },
    racks: [
      {
        rack: 0,
        modules: [{ slot: 2, module_type: "DI 16", channel_count: 16, signal_type: "DI" }],
      },
    ],
  },
  confirmed_units: [
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
              io_signals: [
                { tag: "A", signal_type: "DI", io_address: "%I9.9", description: "" },
              ],
            },
          ],
        },
      ],
    },
  ],
} as unknown as SpecProject;

const register = {
  id: "r1",
  spec_project_id: "s1",
  tags: [{ tag: "A", signal_type: "DI", io_address: "%I9.9" }],
  units: [],
  parse_warnings: [],
  source: "upload",
} as unknown as InstrumentRegister;

describe("SpecSkeletonWizard — IO re-addressing", () => {
  it("applies the planned addresses to the hierarchy from the Hardware step", () => {
    render(<SpecSkeletonWizard spec={spec} register={register} onComplete={vi.fn()} />);

    // Step 1 → 2 → 3 (Hardware).
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));

    expect(screen.getByTestId("io-addressing-panel")).toBeInTheDocument();
    expect(screen.getByText(/1 of 1/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /apply 1 move/i }));

    // Re-planning after apply finds nothing left to move.
    expect(screen.getByRole("button", { name: /match/i })).toBeDisabled();
  });

  it("flags drift on Review when addresses no longer match the rack", () => {
    render(<SpecSkeletonWizard spec={spec} register={register} onComplete={vi.fn()} />);
    // Walk to Review & Confirm (step index 7) without applying.
    for (let i = 0; i < 7; i++) {
      fireEvent.click(screen.getByRole("button", { name: /next/i }));
    }
    expect(screen.getByTestId("io-addressing-drift")).toHaveTextContent(/1 .*(signal|address)/i);
  });
});
