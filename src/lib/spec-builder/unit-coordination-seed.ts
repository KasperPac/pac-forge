// src/lib/spec-builder/unit-coordination-seed.ts
//
// G0-16: generic starter coordination for a unit — the canonical minimum
// PackML state set (mode changes legal in the resting states per the schema
// hint), safety-healthy over every declared machine gate, and the evidenced
// v1 command-routing policy. Pure; consumed by the Controls Data panel.
import type { SafetyGateV2, UnitCoordinationV1 } from "@/types/spec-contract-v2";

export function seedCoordination(unitId: string, gates: SafetyGateV2[]): UnitCoordinationV1 {
  return {
    unit_id: unitId,
    states: (
      [
        ["idle", true],
        ["execute", false],
        ["stopping", false],
        ["stopped", true],
        ["aborting", false],
        ["aborted", true],
      ] as const
    ).map(([state_id, mode_change_allowed]) => ({
      state_id,
      allowed_modes: [],
      mode_change_allowed,
    })),
    transitions: [],
    signal_routing: {
      ...(gates.length
        ? { safety_healthy: { gate_ids: gates.map((g) => g.gate_id), exclude_maintenance: true } }
        : {}),
      routing_rows: [],
      two_detent: [],
      command_routing: { policy: "walk_to_execute_stop_on_unhealthy", seq_test_release: true },
    },
  };
}
