/**
 * G0-2 per-IO signal model semantics — pure helpers, no React/IO.
 * Kind constraints: polarity/conditioning are digital-only, scaling is
 * analog-only, internal signals accept none (no terminal wiring/raw range).
 * Design: Docs/superpowers/specs/2026-07-20-g0-2-io-signal-model-design.md
 */
import type { ControlModuleV2, IoSignalV2 } from "@/types/spec-contract-v2";

export interface IoSignalIssues {
  errors: string[];
  warnings: string[];
}

function isDigital(sig: IoSignalV2): boolean {
  return sig.signal_type === "DI" || sig.signal_type === "DO";
}

function isAnalog(sig: IoSignalV2): boolean {
  return sig.signal_type === "AI" || sig.signal_type === "AO";
}

export function validateIoSignals(
  control_modules: Pick<
    ControlModuleV2,
    "control_module_id" | "control_module_name" | "io_signals"
  >[],
): IoSignalIssues {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const cm of control_modules) {
    for (const sig of cm.io_signals) {
      const where = `control_modules[${cm.control_module_name}].io_signals[${sig.tag}]`;

      if (sig.polarity !== undefined && !isDigital(sig)) {
        errors.push(
          `${where}: polarity only applies to digital signals (signal_type ${sig.signal_type})`,
        );
      }
      if (sig.conditioning !== undefined && !isDigital(sig)) {
        errors.push(
          `${where}: conditioning only applies to digital signals — analog filtering is a tier-2 default (signal_type ${sig.signal_type})`,
        );
      }
      if (sig.scaling !== undefined && !isAnalog(sig)) {
        errors.push(
          `${where}: scaling only applies to analog signals (signal_type ${sig.signal_type})`,
        );
      }
      if (
        sig.conditioning !== undefined &&
        sig.conditioning.on_delay_ms === undefined &&
        sig.conditioning.off_delay_ms === undefined
      ) {
        errors.push(`${where}: conditioning is empty — set a delay or remove it`);
      }
      if (sig.scaling && sig.scaling.raw.min === sig.scaling.raw.max) {
        errors.push(`${where}: scaling raw range is empty (min === max)`);
      }
      if (isAnalog(sig) && sig.scaling === undefined) {
        warnings.push(
          `${where}: analog signal without scaling — setpoints referencing it have undefined units`,
        );
      }
    }
  }

  return { errors, warnings };
}
