// src/components/spec-builder/__tests__/controls-data-panel.test.tsx
//
// G0-16 W1 slice 2: unit-coordination authoring. writeSpecContract is mocked —
// the panel's job is producing a valid patch; the gate itself is covered in
// lib/spec-builder/__tests__/contract.test.ts.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ControlsDataPanel } from "../controls-data-panel";
import { seedCoordination } from "@/lib/spec-builder/unit-coordination-seed";
import type { SpecProject } from "@/types/spec-builder";

vi.mock("@/lib/spec-builder/contract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/spec-builder/contract")>();
  return { ...actual, writeSpecContract: vi.fn().mockResolvedValue(undefined) };
});
import { writeSpecContract } from "@/lib/spec-builder/contract";

function fixtureSpec(overrides?: Partial<SpecProject>): SpecProject {
  return {
    id: "spec-1",
    confirmed_units: [
      {
        unit_id: "u1",
        unit_name: "Carriage Unit",
        equipment_type: "Other",
        description: "",
        excluded: false,
        equipment_modules: [],
      },
    ],
    confirmed_modes: [
      { mode_id: "prod", name: "Production", is_default: true, kind: "production" },
      { mode_id: "maint", name: "Maintenance", is_default: false, kind: "maintenance" },
    ],
    safety_gates: [
      { gate_id: "estop", name: "E-Stop", condition: [{ tag: "EStop_OK", operator: "=", value: true }], scope: "all" },
    ],
    unit_coordination: null,
    ...overrides,
  } as unknown as SpecProject;
}

function renderPanel(spec: SpecProject) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ControlsDataPanel spec={spec} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(writeSpecContract).mockClear();
});

describe("seedCoordination", () => {
  it("seeds the canonical resting/acting state set with mode changes legal at rest", () => {
    const coord = seedCoordination("u1", []);
    expect(coord.states.map((s) => s.state_id)).toEqual([
      "idle", "execute", "stopping", "stopped", "aborting", "aborted",
    ]);
    expect(coord.states.filter((s) => s.mode_change_allowed).map((s) => s.state_id)).toEqual([
      "idle", "stopped", "aborted",
    ]);
    expect(coord.signal_routing?.command_routing?.seq_test_release).toBe(true);
  });

  it("aggregates every declared machine gate into safety_healthy", () => {
    const coord = seedCoordination("u1", [
      { gate_id: "estop", name: "E-Stop", condition: [], scope: "all" },
      { gate_id: "relay", name: "Relay", condition: [], scope: "all" },
    ]);
    expect(coord.signal_routing?.safety_healthy).toEqual({
      gate_ids: ["estop", "relay"],
      exclude_maintenance: true,
    });
  });
});

describe("ControlsDataPanel", () => {
  it("offers to seed coordination for an uncoordinated unit, then shows the state checklist", () => {
    renderPanel(fixtureSpec());
    fireEvent.click(screen.getByText("Enable coordination for this unit"));
    expect(screen.getByLabelText("Declare state idle")).toBeChecked();
    expect(screen.getByLabelText("Declare state execute")).toBeChecked();
    expect(screen.getByLabelText("Declare state held")).not.toBeChecked();
    expect(screen.getByLabelText("Gate E-Stop")).toBeChecked();
  });

  it("saves through writeSpecContract with the modes co-sent (G0-9-F1 rule)", async () => {
    renderPanel(fixtureSpec());
    fireEvent.click(screen.getByText("Enable coordination for this unit"));
    fireEvent.click(screen.getByText("Save coordination"));

    await waitFor(() => expect(writeSpecContract).toHaveBeenCalledTimes(1));
    const [specId, patch] = vi.mocked(writeSpecContract).mock.calls[0];
    expect(specId).toBe("spec-1");
    expect(patch.unit_coordination?.u1.states.length).toBe(6);
    expect(patch.modes?.map((m) => m.mode_id)).toEqual(["prod", "maint"]);
  });

  it("declares an additional PackML state via the checklist", async () => {
    renderPanel(fixtureSpec());
    fireEvent.click(screen.getByText("Enable coordination for this unit"));
    fireEvent.click(screen.getByLabelText("Declare state held"));
    fireEvent.click(screen.getByText("Save coordination"));

    await waitFor(() => expect(writeSpecContract).toHaveBeenCalled());
    const patch = vi.mocked(writeSpecContract).mock.calls[0][1];
    expect(patch.unit_coordination?.u1.states.some((s) => s.state_id === "held")).toBe(true);
  });

  it("adds a command transition between declared states", async () => {
    renderPanel(fixtureSpec());
    fireEvent.click(screen.getByText("Enable coordination for this unit"));
    fireEvent.click(screen.getByText("Add transition"));
    fireEvent.click(screen.getByText("Save coordination"));

    await waitFor(() => expect(writeSpecContract).toHaveBeenCalled());
    const patch = vi.mocked(writeSpecContract).mock.calls[0][1];
    const t = patch.unit_coordination?.u1.transitions[0];
    expect(t?.trigger).toEqual({ type: "command", command: "start" });
    expect(t?.from_state_id).toBe("idle");
  });

  it("renders existing coordination from the spec row", () => {
    renderPanel(
      fixtureSpec({
        unit_coordination: { u1: seedCoordination("u1", []) },
      } as Partial<SpecProject>),
    );
    expect(screen.queryByText("Enable coordination for this unit")).toBeNull();
    expect(screen.getByLabelText("Declare state idle")).toBeChecked();
  });
});
