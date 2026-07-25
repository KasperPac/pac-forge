/**
 * The deterministic IO layout for a declared rack + hierarchy (G0-18).
 *
 * Shared by the Hardware step's re-addressing panel and the Review step's
 * drift banner, so the two can never disagree about what "matches the
 * hardware" means. Lives apart from the panel because a module that exports
 * both a component and a hook breaks Fast Refresh.
 *
 * Pure: `planIoAddressing` and `collectAddressableSignals` do no IO, so this
 * is only a memo around arithmetic — cheap enough to re-run on any render.
 * Design: Docs/superpowers/specs/2026-07-25-io-readdress-design.md
 */
import { useMemo } from "react";
import { planIoAddressing, type IoAddressingPlan } from "@/lib/spec-builder/io-addressing";
import { collectAddressableSignals } from "@/lib/spec-builder/io-addressing-apply";
import type { HardwareModelV1 } from "@/types/spec-contract-v2";
import type { UnitConfig } from "@/types/spec-builder";

export function useIoAddressingPlan(
  hardware: HardwareModelV1 | null | undefined,
  units: UnitConfig[],
): IoAddressingPlan {
  return useMemo(
    () => planIoAddressing(hardware, collectAddressableSignals(units)),
    [hardware, units],
  );
}
