/**
 * Pure hardware-fit validation (G0-16). Compares the IO demanded by a project's
 * signals against the channels declared by the hardware model's modules, and
 * returns non-blocking warnings. No React, no IO.
 *
 * Data is IEC (dialect.ts): signals are normalized to DI/DO/AI/AO; "internal"
 * signals need no physical channel. Address-range checking is deferred to the
 * auto-addressing follow-on (declare-only modules carry no start address).
 */
import type { HardwareModelV1, HardwareSignalType } from "@/types/spec-contract-v2";
import { convertSignalDirection } from "@/lib/spec-builder/dialect";

export type FitSignal = { signal_type: string };

export type HardwareFitWarning = {
  kind: "capacity" | "type_incompatibility";
  signal_class: HardwareSignalType;
  message: string;
};

const CLASSES: HardwareSignalType[] = ["DI", "DO", "AI", "AO"];
const LABEL: Record<HardwareSignalType, string> = {
  DI: "digital input",
  DO: "digital output",
  AI: "analog input",
  AO: "analog output",
};

/** IEC class for a signal, or null for internal/unknown (needs no channel). */
function classOf(signalType: string): HardwareSignalType | null {
  const iec = convertSignalDirection(signalType);
  return iec === "internal" ? null : iec;
}

export function validateHardwareFit(
  hardware: HardwareModelV1 | null | undefined,
  signals: FitSignal[],
): HardwareFitWarning[] {
  if (!hardware) return [];

  const demand: Record<HardwareSignalType, number> = { DI: 0, DO: 0, AI: 0, AO: 0 };
  for (const s of signals) {
    const cls = classOf(s.signal_type);
    if (cls) demand[cls] += 1;
  }

  const provided: Record<HardwareSignalType, number> = { DI: 0, DO: 0, AI: 0, AO: 0 };
  const moduleCount: Record<HardwareSignalType, number> = { DI: 0, DO: 0, AI: 0, AO: 0 };
  for (const rack of hardware.racks) {
    for (const m of rack.modules) {
      if (!m.signal_type) continue;
      moduleCount[m.signal_type] += 1;
      provided[m.signal_type] += m.channel_count ?? 0;
    }
  }

  const warnings: HardwareFitWarning[] = [];
  for (const cls of CLASSES) {
    if (demand[cls] === 0) continue;
    if (moduleCount[cls] === 0) {
      warnings.push({
        kind: "type_incompatibility",
        signal_class: cls,
        message: `${demand[cls]} ${LABEL[cls]} signal(s) present, no ${cls} module declared.`,
      });
    } else if (demand[cls] > provided[cls]) {
      warnings.push({
        kind: "capacity",
        signal_class: cls,
        message: `${demand[cls]} ${cls} signals, ${provided[cls]} ${cls} channels declared — short ${demand[cls] - provided[cls]}.`,
      });
    }
  }
  return warnings;
}
