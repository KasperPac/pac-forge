/**
 * FDS co-author stage ordering (hybrid per-EM state model).
 *
 * Each EM is authored in three phases. The ORDER matters: static-state device
 * tables can only be built once the EM's static states exist, and those states
 * are authored in Stage A. Gating the static review BEFORE Stage A (the old
 * behaviour) meant the review always saw zero states and produced empty tables.
 *
 *   define_states  — Stage A: interview defines the EM's own states + transitions
 *   static_review  — confirm the auto-filled DO/AO output table for each static
 *                    state (only reached once static states have been authored)
 *   behavior       — Stage B: per-sequential-state permissives + steps
 */
import type { EmStateV2 } from "@/types/spec-contract-v2";

export type CoAuthorPhase = "define_states" | "static_review" | "behavior";

/**
 * Decide which phase the active EM session is in, from the persisted state.
 * Pure + deterministic so it can gate the UI and be unit-tested.
 */
export function resolveCoAuthorPhase(args: {
  emStates: EmStateV2[];
  staticConfirmed: boolean;
}): CoAuthorPhase {
  const { emStates, staticConfirmed } = args;

  // No states authored yet → Stage A interview.
  if (emStates.length === 0) return "define_states";

  // Static states exist and haven't been signed off → review their device
  // tables. (An EM with only sequential states skips this entirely.)
  if (hasStaticStates(emStates) && !staticConfirmed) return "static_review";

  // Everything that needs confirming is confirmed → Stage B behaviour.
  return "behavior";
}

/**
 * Completion gate: an EM may be marked complete only when its static states (if
 * any) have been confirmed. An all-sequential EM has nothing to confirm, so it
 * is satisfied by default.
 */
export function isStaticReviewSatisfied(
  emStates: EmStateV2[],
  staticConfirmed: boolean,
): boolean {
  return !hasStaticStates(emStates) || staticConfirmed;
}

function hasStaticStates(emStates: EmStateV2[]): boolean {
  return emStates.some((s) => s.kind === "static");
}
