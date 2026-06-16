import type {
  EquipmentModuleContract,
  ControlModuleStateEntry,
  SequentialStateV2,
  StaticStateV2,
} from "@/types/spec-contract-v2";

/**
 * Wraps every existing per-state row with `override_kind: "override"` so the
 * contract is valid against the post-Phase-1 schema under a single default
 * mode. Multi-mode authoring (inherit / suppressed) is a later phase.
 *
 * Idempotent — already-wrapped rows pass through unchanged.
 */
export function applyOverrideKind(
  equipment_modules: Record<string, EquipmentModuleContract>,
): Record<string, EquipmentModuleContract> {
  const out: Record<string, EquipmentModuleContract> = {};

  for (const [equipment_moduleId, contract] of Object.entries(equipment_modules)) {
    const sequential_states: Record<string, SequentialStateV2> = {};
    for (const [stateKey, seq] of Object.entries(contract.sequential_states ?? {})) {
      sequential_states[stateKey] = {
        ...seq,
        override_kind: seq.override_kind ?? "override",
      };
    }

    const static_states: Record<string, ControlModuleStateEntry[] | StaticStateV2> = {};
    for (const [stateKey, val] of Object.entries(contract.static_states ?? {})) {
      if (Array.isArray(val)) {
        // Legacy bare-array shape → wrap into StaticStateV2 container.
        static_states[stateKey] = {
          override_kind: "override",
          control_modules: val,
          notes: null,
        };
      } else {
        // Already a StaticStateV2 — pass through, defaulting override_kind.
        static_states[stateKey] = {
          ...val,
          override_kind: val.override_kind ?? "override",
        };
      }
    }

    out[equipment_moduleId] = {
      ...contract,
      sequential_states,
      static_states,
    };
  }

  return out;
}
