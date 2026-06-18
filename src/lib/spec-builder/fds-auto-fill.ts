/**
 * Deterministic auto-fill for static state device tables.
 * No AI needed — every output gets its safe state based on device type.
 */
import type {
  EquipmentModuleConfig,
  InstrumentTag,
  ControlModuleStateEntry,
} from "@/types/spec-builder";
import type { EmStateV2 } from "@/types/spec-contract-v2";

/**
 * Auto-fill device state tables for this EM's OWN static states (hybrid state
 * model). Returns { [em_local_state_id]: ControlModuleStateEntry[] } with every
 * DO/AO tag listed.
 */
export function autoFillStaticStates(
  equipment_module: EquipmentModuleConfig,
  staticStates: EmStateV2[],
  allTags: InstrumentTag[],
): Record<string, ControlModuleStateEntry[]> {
  // Collect all tag names for this equipment_module
  const equipment_moduleTagNames = new Set<string>();
  for (const dev of equipment_module.control_modules) {
    for (const sig of dev.io_signals) {
      equipment_moduleTagNames.add(sig.tag);
    }
  }

  // Filter to output tags only (DO, AO)
  const outputTags = allTags.filter(
    (t) => equipment_moduleTagNames.has(t.tag) && (t.signal_direction === "DO" || t.signal_direction === "AO"),
  );

  const result: Record<string, ControlModuleStateEntry[]> = {};

  for (const state of staticStates) {
    result[state.state_id] = outputTags.map((tag) => ({
      tag: tag.tag,
      description: tag.description,
      state: inferSafeState(tag, state),
    }));
  }

  return result;
}

/**
 * Infer the safe state for a given output tag in a given static state.
 * Uses device type and signal direction to determine the appropriate value.
 */
function inferSafeState(tag: InstrumentTag, state: EmStateV2): string {
  const isEstop = state.is_safe_state || /e-?stop|emergency/i.test(state.name);

  if (tag.signal_direction === "AO") {
    return "0";
  }

  // DO — infer from device class / type
  const deviceType = tag.device_type.toLowerCase();
  const deviceClass = tag.control_module_class;

  // Motor contactors
  if (deviceClass === "motor" || /motor|contactor|pump/i.test(deviceType)) {
    return "STOP";
  }

  // Solenoids / valves
  if (deviceClass === "valve" || /solenoid|valve/i.test(deviceType)) {
    return "DE-ENERGISED";
  }

  // VFDs — speed reference
  if (/vfd|drive|speed/i.test(deviceType)) {
    return "0";
  }

  // Indicators / lights
  if (deviceClass === "indicator" || /indicator|light|lamp/i.test(deviceType)) {
    // E-Stop might have a flashing beacon
    if (isEstop) return "FLASHING";
    return "OFF";
  }

  // Generic fallback — all outputs de-energised in safe states
  return "DE-ENERGISED";
}

/**
 * Apply a tag remap to device state entries (for duplicate & edit).
 */
export function remapDeviceStates(
  states: Record<string, ControlModuleStateEntry[]>,
  remap: Record<string, string>,
): Record<string, ControlModuleStateEntry[]> {
  const result: Record<string, ControlModuleStateEntry[]> = {};
  for (const [stateId, entries] of Object.entries(states)) {
    result[stateId] = entries.map((e) => ({
      ...e,
      tag: remap[e.tag] ?? e.tag,
    }));
  }
  return result;
}
