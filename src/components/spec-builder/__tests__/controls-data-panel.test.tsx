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
    fireEvent.click(screen.getByText("Save controls data"));

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
    fireEvent.click(screen.getByText("Save controls data"));

    await waitFor(() => expect(writeSpecContract).toHaveBeenCalled());
    const patch = vi.mocked(writeSpecContract).mock.calls[0][1];
    expect(patch.unit_coordination?.u1.states.some((s) => s.state_id === "held")).toBe(true);
  });

  it("adds a command transition between declared states", async () => {
    renderPanel(fixtureSpec());
    fireEvent.click(screen.getByText("Enable coordination for this unit"));
    fireEvent.click(screen.getByText("Add transition"));
    fireEvent.click(screen.getByText("Save controls data"));

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

describe("ControlsDataPanel — routing rows + axes (W1 slice 3)", () => {
  function specWithEm(): SpecProject {
    const s = fixtureSpec();
    s.confirmed_units![0].equipment_modules = [
      {
        equipment_module_id: "em-a",
        equipment_module_name: "Drive EM",
        description: "",
        control_modules: [],
      },
    ];
    return s;
  }

  it("adds a routing row targeting an EM pin and saves it", async () => {
    renderPanel(specWithEm());
    fireEvent.click(screen.getByText("Enable coordination for this unit"));
    fireEvent.click(screen.getByText("Add row"));
    fireEvent.change(screen.getByLabelText("Row 1 target pin"), { target: { value: "ilk_Fwd" } });
    fireEvent.change(screen.getByLabelText("Row 1 source tag"), { target: { value: "Fwd_PB" } });
    fireEvent.click(screen.getByText("Save controls data"));

    await waitFor(() => expect(writeSpecContract).toHaveBeenCalled());
    const patch = vi.mocked(writeSpecContract).mock.calls[0][1];
    const row = patch.unit_coordination?.u1.signal_routing?.routing_rows?.[0];
    expect(row?.target).toEqual({ equipment_module_id: "em-a", pin: "ilk_Fwd" });
    expect(row?.source).toEqual({ kind: "io_tag", tag: "Fwd_PB" });
  });

  it("seeds a linear axis with the schema defaults and saves it", async () => {
    renderPanel(specWithEm());
    fireEvent.click(screen.getByText("Enable coordination for this unit"));
    fireEvent.click(screen.getByText("Linear"));
    fireEvent.click(screen.getByText("Save controls data"));

    await waitFor(() => expect(writeSpecContract).toHaveBeenCalled());
    const patch = vi.mocked(writeSpecContract).mock.calls[0][1];
    const axis = patch.unit_coordination?.u1.axes?.[0];
    expect(axis?.kind).toBe("linear");
    if (axis?.kind === "linear") {
      expect(axis.end_margin.default).toBe(500);
      expect(axis.ramp_zone.default).toBe(2000);
      expect(axis.unconfigured_open).toBe(true);
    }
  });

  it("declaring a linear gate id feeds the named-gate registry hint", () => {
    renderPanel(specWithEm());
    fireEvent.click(screen.getByText("Enable coordination for this unit"));
    fireEvent.click(screen.getByText("Linear"));
    fireEvent.change(screen.getByLabelText("fwd fast ok gate id"), { target: { value: "g-fwd-fast" } });
    // add a routing row and a named-gate gate on it — placeholder should hint the declared id
    fireEvent.click(screen.getByText("Add row"));
    fireEvent.click(screen.getByText("gate"));
    expect(screen.getByLabelText("Row 1 gate 1 gate id")).toHaveValue("g-fwd-fast");
  });

  it("pairs two routing rows as two-detent with fallback", async () => {
    renderPanel(specWithEm());
    fireEvent.click(screen.getByText("Enable coordination for this unit"));
    fireEvent.click(screen.getByText("Add row"));
    fireEvent.click(screen.getByText("Add row"));
    fireEvent.click(screen.getByText("pair"));
    fireEvent.click(screen.getByText("Save controls data"));

    await waitFor(() => expect(writeSpecContract).toHaveBeenCalled());
    const patch = vi.mocked(writeSpecContract).mock.calls[0][1];
    const detent = patch.unit_coordination?.u1.signal_routing?.two_detent?.[0];
    expect(detent?.fallback).toBe(true);
    expect(detent?.jog_row_id).toBeDefined();
    expect(detent?.jog_row_id).not.toBe(detent?.fast_row_id);
  });
});

describe("ControlsDataPanel — maintenance + engineering (W1 slice 4)", () => {
  function specWithDrive(): SpecProject {
    const s = fixtureSpec();
    s.confirmed_units![0].equipment_modules = [
      {
        equipment_module_id: "em-a",
        equipment_module_name: "Drive EM",
        description: "",
        control_modules: [
          {
            control_module_id: "cm-1",
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
              { tag: "M01_Run", signal_type: "DO", io_address: "Q0.0", description: "run" },
            ],
          },
        ],
      },
    ];
    return s;
  }

  it("adds an overridable output constrained to hierarchy DO tags", async () => {
    renderPanel(specWithDrive());
    fireEvent.click(screen.getByText("Maintenance"));
    fireEvent.click(screen.getByText("Add output"));
    fireEvent.click(screen.getByText("Save controls data"));

    await waitFor(() => expect(writeSpecContract).toHaveBeenCalled());
    const patch = vi.mocked(writeSpecContract).mock.calls[0][1];
    expect(patch.maintenance?.overridable_outputs[0]).toEqual({
      tag: "M01_Run",
      wire_check_only: false,
    });
    // maintenance-only edit — no coordination key in the patch
    expect(patch.unit_coordination).toBeUndefined();
  });

  it("records tier-2 drive commissioning values keyed by the drive-carrying CM", async () => {
    renderPanel(specWithDrive());
    fireEvent.click(screen.getByText("Engineering Data"));
    fireEvent.change(screen.getByLabelText("M01 ref speed rpm"), { target: { value: "1500" } });
    fireEvent.click(screen.getByText("Save controls data"));

    await waitFor(() => expect(writeSpecContract).toHaveBeenCalled());
    const patch = vi.mocked(writeSpecContract).mock.calls[0][1];
    expect(patch.engineering?.drives[0]).toMatchObject({
      control_module_id: "cm-1",
      ref_speed_rpm: 1500,
    });
  });

  it("clearing the only drive value removes the tier-2 entry", async () => {
    renderPanel(specWithDrive());
    fireEvent.click(screen.getByText("Engineering Data"));
    fireEvent.change(screen.getByLabelText("M01 ref speed rpm"), { target: { value: "1500" } });
    fireEvent.change(screen.getByLabelText("M01 ref speed rpm"), { target: { value: "" } });
    fireEvent.click(screen.getByText("Save controls data"));

    await waitFor(() => expect(writeSpecContract).toHaveBeenCalled());
    const patch = vi.mocked(writeSpecContract).mock.calls[0][1];
    expect(patch.engineering?.drives).toEqual([]);
  });

  it("derives axis-constant rows from axes declared under coordination", async () => {
    renderPanel(specWithDrive());
    fireEvent.click(screen.getByText("Enable coordination for this unit"));
    fireEvent.click(screen.getByText("Linear"));
    fireEvent.click(screen.getByText("Engineering Data"));
    fireEvent.change(screen.getByLabelText("axis_1 scale_x10 constant"), { target: { value: "157" } });
    fireEvent.click(screen.getByText("Save controls data"));

    await waitFor(() => expect(writeSpecContract).toHaveBeenCalled());
    const patch = vi.mocked(writeSpecContract).mock.calls[0][1];
    expect(patch.engineering?.axis_constants[0]).toMatchObject({
      unit_id: "u1",
      axis_id: "axis_1",
      values: { scale_x10: 157 },
    });
    // coordination was also edited this session — both keys ride one patch
    expect(patch.unit_coordination?.u1.axes?.length).toBe(1);
  });
});
