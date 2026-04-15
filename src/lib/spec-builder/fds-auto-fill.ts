/**
 * Deterministic auto-fill for static state device tables.
 * No AI needed — every output gets its safe state based on device type.
 */
import type {
  AssemblyConfig,
  OperatingState,
  InstrumentTag,
  DeviceStateEntry,
} from "@/types/spec-builder";

/**
 * Auto-fill device state tables for all static states for a given assembly.
 * Returns { [state_id]: DeviceStateEntry[] } with every DO/AO tag listed.
 */
export function autoFillStaticStates(
  assembly: AssemblyConfig,
  staticStates: OperatingState[],
  allTags: InstrumentTag[],
): Record<string, DeviceStateEntry[]> {
  // Collect all tag names for this assembly
  const assemblyTagNames = new Set<string>();
  for (const dev of assembly.devices) {
    for (const sig of dev.io_signals) {
      assemblyTagNames.add(sig.tag);
    }
  }

  // Filter to output tags only (DO, AO)
  const outputTags = allTags.filter(
    (t) => assemblyTagNames.has(t.tag) && (t.signal_direction === "DO" || t.signal_direction === "AO"),
  );

  const result: Record<string, DeviceStateEntry[]> = {};

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
function inferSafeState(tag: InstrumentTag, state: OperatingState): string {
  const isEstop = /e-?stop|emergency/i.test(state.state_name);

  if (tag.signal_direction === "AO") {
    return "0";
  }

  // DO — infer from device class / type
  const deviceType = tag.device_type.toLowerCase();
  const deviceClass = tag.device_class;

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
  states: Record<string, DeviceStateEntry[]>,
  remap: Record<string, string>,
): Record<string, DeviceStateEntry[]> {
  const result: Record<string, DeviceStateEntry[]> = {};
  for (const [stateId, entries] of Object.entries(states)) {
    result[stateId] = entries.map((e) => ({
      ...e,
      tag: remap[e.tag] ?? e.tag,
    }));
  }
  return result;
}
