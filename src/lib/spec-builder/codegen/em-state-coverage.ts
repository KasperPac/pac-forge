import type { EmStateV2 } from "@/types/spec-contract-v2";
import type { FbInterfaceState } from "@/types/fb-interface";

/** Normalize a state slug/id for comparison: trim + lowercase. */
export function normSlug(s: string): string {
  return s.trim().toLowerCase();
}

export interface CoverageResult {
  ok: boolean;
  /** FDS states with no declared counterpart. */
  missing: EmStateV2[];
}

/**
 * Assert the FDS-required states are a subset of the library FB's declared
 * states (by normalized slug). Surplus declared states are fine — a richer
 * library FB legitimately covers a leaner spec. Pure.
 */
export function checkStateCoverage(
  fdsStates: EmStateV2[],
  declared: FbInterfaceState[],
): CoverageResult {
  const have = new Set(declared.map((d) => normSlug(d.slug)));
  const missing = fdsStates.filter((s) => !have.has(normSlug(s.state_id)));
  return { ok: missing.length === 0, missing };
}
