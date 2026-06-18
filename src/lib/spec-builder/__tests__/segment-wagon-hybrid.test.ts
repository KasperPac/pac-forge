/**
 * Contract-level smoke test: Segment Wagon hybrid state model.
 *
 * Proves the "done-bar" for the hybrid per-EM state model:
 *   - Carriage Drive and Rotator EMs hold independent states simultaneously
 *   - A machine-level E-Stop safety gate forces both to their safe states
 *   - Machine modes (Local / Remote / Maintenance) validate correctly
 *   - The whole patch validates cleanly via validateSpecContractPatch
 */
import { describe, expect, it } from "vitest";
import { validateSpecContractPatch } from "../contract";
import {
  resolveAllowedStates,
  resolveForcedSafeStates,
  validateEmStateMachine,
} from "@/lib/spec-builder/em-state-machine";
import { SpecContractV2Schema } from "@/types/spec-contract-v2";
import type {
  EquipmentModuleContract,
  SafetyGateV2,
} from "@/types/spec-contract-v2";

// ============================================================
// UUIDs (valid v4)
// ============================================================

const UNIT_ID = "a1b2c3d4-e5f6-4a7b-8c9d-000000000001";

const EM_CARRIAGE_ID = "a1b2c3d4-e5f6-4a7b-8c9d-000000000010";
const EM_ROTATOR_ID = "a1b2c3d4-e5f6-4a7b-8c9d-000000000020";

const CM_CARRIAGE_DRIVE_ID = "a1b2c3d4-e5f6-4a7b-8c9d-000000000011";
const CM_SAFETY_ID = "a1b2c3d4-e5f6-4a7b-8c9d-000000000012";
const CM_ROTATOR_MOTOR_ID = "a1b2c3d4-e5f6-4a7b-8c9d-000000000021";

// ============================================================
// Hierarchy: one unit, two equipment modules
// ============================================================

const hierarchy = {
  units: [
    {
      unit_id: UNIT_ID,
      unit_name: "Segment Wagon Unit",
      equipment_type: "Transport",
      description: "Herrenknecht segment wagon — carriage + rotator station",
      excluded: false,
      equipment_modules: [
        {
          equipment_module_id: EM_CARRIAGE_ID,
          equipment_module_name: "Carriage Drive",
          description: "Drives the carriage forward and reverse along the track",
          control_modules: [
            {
              control_module_id: CM_CARRIAGE_DRIVE_ID,
              control_module_name: "CM_Motor_CAR",
              control_module_class: "motor",
              is_safety: false,
              description: "Carriage drive motor with pendant commands",
              io_signals: [
                {
                  tag: "CAR_PENDANT_FWD",
                  signal_type: "DI" as const,
                  io_address: "%I0.0",
                  description: "Pendant FWD pushbutton (carriage)",
                  source: "wired" as const,
                },
                {
                  tag: "CAR_PENDANT_REV",
                  signal_type: "DI" as const,
                  io_address: "%I0.1",
                  description: "Pendant REV pushbutton (carriage)",
                  source: "wired" as const,
                },
                {
                  tag: "CAR_DRV_FWD",
                  signal_type: "DO" as const,
                  io_address: "%Q0.0",
                  description: "Drive forward output",
                  source: "wired" as const,
                },
                {
                  tag: "CAR_DRV_REV",
                  signal_type: "DO" as const,
                  io_address: "%Q0.1",
                  description: "Drive reverse output",
                  source: "wired" as const,
                },
              ],
            },
            {
              control_module_id: CM_SAFETY_ID,
              control_module_name: "CM_Safety_ESM",
              control_module_class: "safety",
              is_safety: true,
              description: "Safety module — E-Stop monitoring",
              io_signals: [
                {
                  tag: "EStop_Healthy",
                  signal_type: "DI" as const,
                  io_address: "%I0.7",
                  description: "E-Stop circuit healthy (de-energised = tripped)",
                  source: "wired" as const,
                },
              ],
            },
          ],
        },
        {
          equipment_module_id: EM_ROTATOR_ID,
          equipment_module_name: "Rotator",
          description: "Rotates the segment to the required orientation",
          control_modules: [
            {
              control_module_id: CM_ROTATOR_MOTOR_ID,
              control_module_name: "CM_Motor_ROT",
              control_module_class: "motor",
              is_safety: false,
              description: "Rotator motor",
              io_signals: [
                {
                  tag: "ROT_START_CMD",
                  signal_type: "DI" as const,
                  io_address: "%I1.0",
                  description: "Rotator start command from HMI",
                  source: "wired" as const,
                },
                {
                  tag: "ROT_STOP_CMD",
                  signal_type: "DI" as const,
                  io_address: "%I1.1",
                  description: "Rotator stop command from HMI",
                  source: "wired" as const,
                },
                {
                  tag: "ROT_MOTOR_RUN",
                  signal_type: "DO" as const,
                  io_address: "%Q1.0",
                  description: "Rotator motor run output",
                  source: "wired" as const,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

// ============================================================
// Equipment module contracts
// ============================================================

const carriageContract: EquipmentModuleContract = {
  equipment_module_id: EM_CARRIAGE_ID,
  unit_id: UNIT_ID,
  states: [
    {
      state_id: "stopped",
      name: "Stopped",
      kind: "static",
      allowed_modes: [],
      is_safe_state: true,
    },
    {
      state_id: "driving_fwd",
      name: "Driving Forward",
      kind: "static",
      allowed_modes: [],
      is_safe_state: false,
    },
    {
      state_id: "driving_rev",
      name: "Driving Reverse",
      kind: "static",
      allowed_modes: [],
      is_safe_state: false,
    },
  ],
  transitions: [
    {
      transition_id: "car_t1",
      from_state_id: "stopped",
      to_state_id: "driving_fwd",
      trigger: { kind: "command", expr: { tag: "CAR_PENDANT_FWD", operator: "=", value: true } },
      guard: [],
    },
    {
      transition_id: "car_t2",
      from_state_id: "driving_fwd",
      to_state_id: "stopped",
      trigger: { kind: "command", expr: { tag: "CAR_PENDANT_FWD", operator: "=", value: false } },
      guard: [],
    },
    {
      transition_id: "car_t3",
      from_state_id: "stopped",
      to_state_id: "driving_rev",
      trigger: { kind: "command", expr: { tag: "CAR_PENDANT_REV", operator: "=", value: true } },
      guard: [],
    },
    {
      transition_id: "car_t4",
      from_state_id: "driving_rev",
      to_state_id: "stopped",
      trigger: { kind: "command", expr: { tag: "CAR_PENDANT_REV", operator: "=", value: false } },
      guard: [],
    },
  ],
  static_states: {},
  sequential_states: {},
};

const rotatorContract: EquipmentModuleContract = {
  equipment_module_id: EM_ROTATOR_ID,
  unit_id: UNIT_ID,
  states: [
    {
      state_id: "idle",
      name: "Idle",
      kind: "static",
      allowed_modes: [],
      is_safe_state: true,
    },
    {
      state_id: "rotating",
      name: "Rotating",
      kind: "static",
      allowed_modes: [],
      is_safe_state: false,
    },
  ],
  transitions: [
    {
      transition_id: "rot_t1",
      from_state_id: "idle",
      to_state_id: "rotating",
      trigger: { kind: "command", expr: { tag: "ROT_START_CMD", operator: "=", value: true } },
      guard: [],
    },
    {
      transition_id: "rot_t2",
      from_state_id: "rotating",
      to_state_id: "idle",
      trigger: { kind: "command", expr: { tag: "ROT_STOP_CMD", operator: "=", value: true } },
      guard: [],
    },
  ],
  static_states: {},
  sequential_states: {},
};

// ============================================================
// Modes
// ============================================================

const modes = [
  { mode_id: "local", name: "Local", description: "Pendant / local-panel operation", is_default: true },
  { mode_id: "remote", name: "Remote", description: "SCADA / supervisor commands", is_default: false },
  { mode_id: "maintenance", name: "Maintenance", description: "Maintenance jog & bypass", is_default: false },
];

// ============================================================
// Safety gate
// ============================================================

const safetyGates: SafetyGateV2[] = [
  {
    gate_id: "gate_estop",
    name: "Machine E-Stop",
    condition: [{ tag: "EStop_Healthy", operator: "=", value: false }],
    scope: "all",
  },
];

// ============================================================
// Full patch
// ============================================================

const patch = {
  hierarchy,
  modes,
  safety_gates: safetyGates,
  equipment_modules: {
    [EM_CARRIAGE_ID]: carriageContract,
    [EM_ROTATOR_ID]: rotatorContract,
  },
};

// ============================================================
// Tests
// ============================================================

describe("Segment Wagon — hybrid state model done-bar", () => {
  // ---- 1. Patch-level validation ----
  it("1. validateSpecContractPatch returns no issues for the full patch", () => {
    const issues = validateSpecContractPatch(patch);
    expect(issues).toEqual([]);
  });

  // ---- 2. Per-EM structural invariants ----
  it("2a. Carriage Drive EM has a valid state machine (no issues)", () => {
    expect(validateEmStateMachine(carriageContract)).toEqual([]);
  });

  it("2b. Rotator EM has a valid state machine (no issues)", () => {
    expect(validateEmStateMachine(rotatorContract)).toEqual([]);
  });

  // ---- 3. Independent simultaneous states ----
  it("3a. Carriage and Rotator state_ids are fully disjoint", () => {
    const carriageIds = carriageContract.states.map((s) => s.state_id);
    const rotatorIds = rotatorContract.states.map((s) => s.state_id);
    const shared = carriageIds.filter((id) => rotatorIds.includes(id));
    expect(shared).toEqual([]);
  });

  it("3b. Carriage can be in driving_fwd while Rotator is in idle (both are valid members of their own machines)", () => {
    // driving_fwd belongs to carriage, not rotator
    expect(carriageContract.states.map((s) => s.state_id)).toContain("driving_fwd");
    expect(rotatorContract.states.map((s) => s.state_id)).not.toContain("driving_fwd");

    // idle belongs to rotator, not carriage
    expect(rotatorContract.states.map((s) => s.state_id)).toContain("idle");
    expect(carriageContract.states.map((s) => s.state_id)).not.toContain("idle");
  });

  it("3c. resolveAllowedStates resolves each EM's own state list independently in 'remote' mode", () => {
    const carriageAllowed = resolveAllowedStates(carriageContract, "remote");
    const rotatorAllowed = resolveAllowedStates(rotatorContract, "remote");

    // All states have allowed_modes:[] so all are allowed in every mode
    expect(carriageAllowed.map((s) => s.state_id)).toEqual(["stopped", "driving_fwd", "driving_rev"]);
    expect(rotatorAllowed.map((s) => s.state_id)).toEqual(["idle", "rotating"]);

    // Each list is independent — no cross-contamination
    const carriageIds = new Set(carriageAllowed.map((s) => s.state_id));
    const rotatorIds = new Set(rotatorAllowed.map((s) => s.state_id));
    for (const id of carriageIds) {
      expect(rotatorIds.has(id)).toBe(false);
    }
  });

  // ---- 4. Safety gate forces BOTH EMs to safe simultaneously ----
  it("4. E-Stop gate forces Carriage→stopped and Rotator→idle simultaneously", () => {
    const forced = resolveForcedSafeStates(
      [carriageContract, rotatorContract],
      safetyGates,
      ["gate_estop"],
    );
    expect(forced.get(EM_CARRIAGE_ID)).toBe("stopped");
    expect(forced.get(EM_ROTATOR_ID)).toBe("idle");
    expect(forced.size).toBe(2);
  });

  // ---- 5. No gate violated → map is empty ----
  it("5. No violated gates → forced safe states map is empty", () => {
    const forced = resolveForcedSafeStates(
      [carriageContract, rotatorContract],
      safetyGates,
      [], // none violated
    );
    expect(forced.size).toBe(0);
  });

  // ---- 6. SpecContractV2Schema parses a full contract built from this data ----
  it("6. SpecContractV2Schema.safeParse succeeds on a contract assembled from this fixture", () => {
    const contract = {
      schema_version: 3 as const,
      confirmation_status: "confirmed" as const,
      project: {
        id: "a1b2c3d4-e5f6-4a7b-8c9d-000000000099",
        doc_code: "HK-FDS-001",
        title: "Herrenknecht Segment Wagon FDS",
        client_name: "Herrenknecht AG",
        project_number: "S-1427",
        plc_model: "S7-1500",
        hmi_type: "WinCC Unified",
        comms_protocol: "PROFINET",
        safety_classification: "SIL 2",
        fault_philosophy: "Fault-to-safe",
        design_principles: ["ISA-88 Part 1 compliant", "PackML state model"],
        scope_exclusions: [],
      },
      hierarchy,
      alarm_tiers: [],
      equipment_modules: {
        [EM_CARRIAGE_ID]: carriageContract,
        [EM_ROTATOR_ID]: rotatorContract,
      },
      safety_gates: safetyGates,
      alarms: [],
      io_list: [],
      faults: [],
      sections: {
        document_control: [],
        system_overview: [],
        control_philosophy: [],
        functional_description: [],
        io_list: [],
        alarm_specification: [],
        hmi_specification: [],
        interfaces: [],
        testing_fat: [],
        audit_report: [],
        introduction: [],
        equipment_description: [],
        functional_state: [],
        alarm_table: [],
        settings_table: [],
      },
      modes,
    };

    const result = SpecContractV2Schema.safeParse(contract);
    expect(result.success).toBe(true);
  });
});
