import { describe, expect, it } from "vitest";
import {
  resolveCoAuthorPhase,
  isStaticReviewSatisfied,
} from "../fds-co-author-phase";
import type { EmStateV2 } from "@/types/spec-contract-v2";

/**
 * Regression: the FDS co-author used to gate "Static State Review" BEFORE the
 * EM authored any states. EM-local states are only created during Stage A, so
 * the review always saw zero static states, auto-filled nothing, and the
 * engineer confirmed an empty device-output table. The result was EMs with
 * authored static states but NO device-value tables (the core safe-state FDS
 * artifact). The phase must run in the correct order for EVERY machine type:
 *
 *   define_states (Stage A)  →  static_review (only once static states exist)
 *                            →  behavior (Stage B)
 */
const state = (
  id: string,
  kind: EmStateV2["kind"],
  is_safe_state = false,
): EmStateV2 => ({
  state_id: id,
  name: id,
  kind,
  allowed_modes: [],
  is_safe_state,
});

describe("resolveCoAuthorPhase — correct stage ordering", () => {
  it("starts in define_states when the EM has no authored states", () => {
    expect(
      resolveCoAuthorPhase({ emStates: [], staticConfirmed: false }),
    ).toBe("define_states");
  });

  it("never shows static_review before states exist (the original bug)", () => {
    // Even if a stale static_confirmed=true somehow exists, no states means
    // nothing to review — go define states.
    expect(
      resolveCoAuthorPhase({ emStates: [], staticConfirmed: true }),
    ).toBe("define_states");
  });

  it("shows static_review AFTER static states are authored and not yet confirmed", () => {
    const emStates = [state("brake_applied", "static", true), state("faulted", "static")];
    expect(
      resolveCoAuthorPhase({ emStates, staticConfirmed: false }),
    ).toBe("static_review");
  });

  it("advances to behavior once static states are confirmed", () => {
    const emStates = [state("brake_applied", "static", true), state("faulted", "static")];
    expect(
      resolveCoAuthorPhase({ emStates, staticConfirmed: true }),
    ).toBe("behavior");
  });

  it("skips static_review entirely for an all-sequential EM", () => {
    const emStates = [state("ramping_down", "sequential")];
    expect(
      resolveCoAuthorPhase({ emStates, staticConfirmed: false }),
    ).toBe("behavior");
  });

  it("shows static_review for a mixed EM (static + sequential) until confirmed", () => {
    const emStates = [state("stopped", "static", true), state("ramping_down", "sequential")];
    expect(
      resolveCoAuthorPhase({ emStates, staticConfirmed: false }),
    ).toBe("static_review");
    expect(
      resolveCoAuthorPhase({ emStates, staticConfirmed: true }),
    ).toBe("behavior");
  });
});

describe("isStaticReviewSatisfied — completion gate", () => {
  it("is satisfied when the EM has no static states (nothing to confirm)", () => {
    const emStates = [state("ramping_down", "sequential")];
    expect(isStaticReviewSatisfied(emStates, false)).toBe(true);
  });

  it("is NOT satisfied while static states exist but are unconfirmed", () => {
    const emStates = [state("brake_applied", "static", true)];
    expect(isStaticReviewSatisfied(emStates, false)).toBe(false);
  });

  it("is satisfied once static states are confirmed", () => {
    const emStates = [state("brake_applied", "static", true)];
    expect(isStaticReviewSatisfied(emStates, true)).toBe(true);
  });
});
