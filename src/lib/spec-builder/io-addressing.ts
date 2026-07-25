/**
 * Deterministic IO addressing: spec follows hardware (G0-18).
 *
 * The declared rack is the source of truth. Modules are laid out contiguously
 * in slot order, then every wired signal is assigned a channel on a module of
 * its class. The same layout is pinned onto the TIA modules' StartAddress, so
 * TIA's allocator cannot drift from what the tags expect.
 *
 * Address spaces (Siemens): %I and %IW share ONE input space — a DI card and an
 * AI card both consume input bytes — and %Q/%QW share the output space. So the
 * layout runs two counters, not four.
 *
 * Pure module: no React, no IO, no TIA. Offline-computable from the hardware
 * model alone, which is what makes the result reviewable before it is applied.
 */
import type { HardwareModelV1, HardwareSignalType } from "@/types/spec-contract-v2";

/** Which address space a signal class consumes. */
const SPACE: Record<HardwareSignalType, "input" | "output"> = {
  DI: "input",
  AI: "input",
  DO: "output",
  AO: "output",
};

const IS_ANALOG: Record<HardwareSignalType, boolean> = {
  DI: false,
  DO: false,
  AI: true,
  AO: true,
};

/** A module's allocated range, to be pinned onto the plugged DeviceItem. */
export interface ModuleAddressPlan {
  rack: number;
  slot: number;
  module_type: string;
  signal_type: HardwareSignalType;
  /** Byte offset within its address space. */
  start_address: number;
  /** Length in bytes. */
  length: number;
}

export interface IoAssignment {
  tag: string;
  signal_type: HardwareSignalType;
  /** Address currently on the spec, if any. */
  from: string | null;
  /** Address the hardware layout gives it. */
  to: string;
  changed: boolean;
}

export interface IoAddressingPlan {
  modules: ModuleAddressPlan[];
  assignments: IoAssignment[];
  /** Signals with no channel available — surfaced, never silently dropped. */
  warnings: string[];
}

/** A wired signal needing a physical channel, in stable register order. */
export interface AddressableSignal {
  tag: string;
  signal_type: HardwareSignalType;
  io_address?: string | null;
}

/** Bytes a module occupies: 1 byte per 8 digital channels, 2 per analog channel. */
export function moduleByteLength(signalType: HardwareSignalType, channels: number): number {
  return IS_ANALOG[signalType] ? channels * 2 : Math.ceil(channels / 8);
}

function formatAddress(
  signalType: HardwareSignalType,
  startByte: number,
  channel: number,
): string {
  const space = SPACE[signalType] === "input" ? "I" : "Q";
  if (IS_ANALOG[signalType]) return `%${space}W${startByte + channel * 2}`;
  return `%${space}${startByte + Math.floor(channel / 8)}.${channel % 8}`;
}

/**
 * Lay the declared rack out contiguously and assign every signal a channel.
 * Modules are taken in rack then slot order so the result is stable regardless
 * of the order rows were authored in.
 */
export function planIoAddressing(
  hardware: HardwareModelV1 | null | undefined,
  signals: AddressableSignal[],
): IoAddressingPlan {
  const plan: IoAddressingPlan = { modules: [], assignments: [], warnings: [] };
  if (!hardware) return plan;

  const placed = hardware.racks
    .flatMap((r) => r.modules.map((m) => ({ rack: r.rack, module: m })))
    .filter((x) => !!x.module.signal_type)
    .sort((a, b) => a.rack - b.rack || a.module.slot - b.module.slot);

  // Two counters, because %I/%IW and %Q/%QW each share one space.
  const next: Record<"input" | "output", number> = { input: 0, output: 0 };

  for (const { rack, module } of placed) {
    const signalType = module.signal_type as HardwareSignalType;
    const channels = module.channel_count ?? 0;
    if (channels <= 0) {
      plan.warnings.push(
        `Rack ${rack} slot ${module.slot} (${module.module_type || "unnamed"}) declares no channel count — cannot address it.`,
      );
      continue;
    }
    const space = SPACE[signalType];
    const length = moduleByteLength(signalType, channels);
    plan.modules.push({
      rack,
      slot: module.slot,
      module_type: module.module_type,
      signal_type: signalType,
      start_address: next[space],
      length,
    });
    next[space] += length;
  }

  // Assign signals to channels, per class, in register order.
  const cursor: Partial<Record<HardwareSignalType, number>> = {};
  for (const signal of signals) {
    const cls = signal.signal_type;
    if (!SPACE[cls]) continue;

    const modulesOfClass = plan.modules.filter((m) => m.signal_type === cls);
    const index = cursor[cls] ?? 0;

    // Walk this class's modules until the running index lands inside one.
    let remaining = index;
    let assigned: string | null = null;
    for (const m of modulesOfClass) {
      const capacity = IS_ANALOG[cls] ? m.length / 2 : m.length * 8;
      if (remaining < capacity) {
        assigned = formatAddress(cls, m.start_address, remaining);
        break;
      }
      remaining -= capacity;
    }

    if (assigned === null) {
      plan.warnings.push(
        `${signal.tag} (${cls}): no ${cls} channel left on the declared hardware — add a module or remove the signal.`,
      );
      continue;
    }

    cursor[cls] = index + 1;
    const from = signal.io_address?.trim() || null;
    plan.assignments.push({
      tag: signal.tag,
      signal_type: cls,
      from,
      to: assigned,
      changed: from !== assigned,
    });
  }

  return plan;
}
