import { describe, it, expect } from "vitest";
import {
  PACKML_STATES,
  PACKML_STATE_SLUGS,
  packmlStateBySlug,
  packmlStateById,
  isPackmlSlug,
  defaultFbStates,
  defaultEmStates,
} from "@/lib/spec-builder/packml-states";

describe("PACKML_STATES", () => {
  it("has 17 states with unique 1..17 ids and unique slugs", () => {
    expect(PACKML_STATES).toHaveLength(17);
    const ids = PACKML_STATES.map((s) => s.packml_id);
    expect(new Set(ids).size).toBe(17);
    expect(Math.min(...ids)).toBe(1);
    expect(Math.max(...ids)).toBe(17);
    expect(new Set(PACKML_STATES.map((s) => s.slug)).size).toBe(17);
  });

  it("marks exactly one safe state — aborted (id 9)", () => {
    const safe = PACKML_STATES.filter((s) => s.is_safe);
    expect(safe).toHaveLength(1);
    expect(safe[0].slug).toBe("aborted");
    expect(safe[0].packml_id).toBe(9);
  });

  it("uses PackML naming: execute present; running/pausing/paused absent", () => {
    expect(PACKML_STATE_SLUGS.has("execute")).toBe(true);
    expect(PACKML_STATE_SLUGS.has("running")).toBe(false);
    expect(PACKML_STATE_SLUGS.has("pausing")).toBe(false);
    expect(PACKML_STATE_SLUGS.has("paused")).toBe(false);
  });

  it("covers the pragmatic random-builder slugs, except non-canonical estop", () => {
    for (const slug of ["idle", "starting", "execute", "stopping", "complete"]) {
      expect(isPackmlSlug(slug)).toBe(true);
    }
    expect(isPackmlSlug("estop")).toBe(false);
  });

  it("pins state_pattern for representative acting/waiting states", () => {
    // Guards the hand-maintained table against an accidental static/sequential swap.
    const pattern = (slug: string) => PACKML_STATES.find((s) => s.slug === slug)?.state_pattern;
    expect(pattern("execute")).toBe("sequential");
    expect(pattern("starting")).toBe("sequential");
    expect(pattern("idle")).toBe("static");
    expect(pattern("stopped")).toBe("static");
    expect(pattern("complete")).toBe("static");
  });
});

describe("lookups", () => {
  it("packmlStateBySlug is trim/case-insensitive", () => {
    expect(packmlStateBySlug("  EXECUTE ")?.packml_id).toBe(6);
    expect(packmlStateBySlug("nope")).toBeUndefined();
  });

  it("packmlStateById resolves by number", () => {
    expect(packmlStateById(9)?.slug).toBe("aborted");
    expect(packmlStateById(99)).toBeUndefined();
  });

  it("isPackmlSlug rejects free EM slugs", () => {
    expect(isPackmlSlug("driving_fwd")).toBe(false);
  });
});

describe("defaultFbStates", () => {
  it("returns all 17 as FbInterfaceState with exactly one safe", () => {
    const states = defaultFbStates();
    expect(states).toHaveLength(17);
    expect(states.filter((s) => s.is_safe)).toHaveLength(1);
    expect(states.find((s) => s.is_safe)?.slug).toBe("aborted");
    expect(states.every((s) => typeof s.slug === "string" && typeof s.name === "string")).toBe(true);
  });
});

describe("defaultEmStates", () => {
  it("returns all 17 as EmStateV2 with aborted safe and kinds mapped from state_pattern", () => {
    const states = defaultEmStates();
    expect(states).toHaveLength(17);
    expect(states.filter((s) => s.is_safe_state)).toHaveLength(1);
    expect(states.find((s) => s.is_safe_state)?.state_id).toBe("aborted");
    expect(states.find((s) => s.state_id === "execute")?.kind).toBe("sequential");
    expect(states.find((s) => s.state_id === "idle")?.kind).toBe("static");
    expect(states.every((s) => s.allowed_modes.length === 0)).toBe(true);
  });
});
