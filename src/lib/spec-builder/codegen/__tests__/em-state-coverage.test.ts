import { describe, it, expect } from "vitest";
import { checkStateCoverage, normSlug } from "../em-state-coverage";
import type { EmStateV2 } from "@/types/spec-contract-v2";
import type { FbInterfaceState } from "@/types/fb-interface";
import { defaultFbStates } from "@/lib/spec-builder/packml-states";

const fds = (slug: string, over: Partial<EmStateV2> = {}): EmStateV2 => ({
  state_id: slug, name: slug, kind: "sequential", allowed_modes: [], is_safe_state: false, ...over,
});
const decl = (slug: string, over: Partial<FbInterfaceState> = {}): FbInterfaceState => ({
  slug, name: slug, ...over,
});

describe("normSlug", () => {
  it("trims and lowercases", () => {
    expect(normSlug("  Driving_Fwd ")).toBe("driving_fwd");
  });
});

describe("checkStateCoverage", () => {
  it("passes when every FDS state is declared", () => {
    const r = checkStateCoverage([fds("stopped"), fds("running")], [decl("stopped"), decl("running")]);
    expect(r.ok).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("ignores surplus declared states", () => {
    const r = checkStateCoverage([fds("stopped")], [decl("stopped"), decl("running"), decl("holding")]);
    expect(r.ok).toBe(true);
  });

  it("matches case- and whitespace-insensitively", () => {
    const r = checkStateCoverage([fds(" Stopped ")], [decl("stopped")]);
    expect(r.ok).toBe(true);
  });

  it("reports missing states", () => {
    const r = checkStateCoverage([fds("stopped"), fds("holding"), fds("aborting")], [decl("stopped")]);
    expect(r.ok).toBe(false);
    expect(r.missing.map((s) => s.state_id)).toEqual(["holding", "aborting"]);
  });

  it("treats an empty declared list as full miss", () => {
    const r = checkStateCoverage([fds("stopped")], []);
    expect(r.ok).toBe(false);
    expect(r.missing).toHaveLength(1);
  });
});

describe("checkStateCoverage against the default PackML FB state set", () => {
  it("verifies an FDS EM whose states are PackML slugs", () => {
    const states = [fds("execute"), fds("idle"), fds("aborted", { is_safe_state: true })];
    const res = checkStateCoverage(states, defaultFbStates());
    expect(res.ok).toBe(true);
    expect(res.missing).toHaveLength(0);
  });

  it("reports a non-PackML FDS slug as missing", () => {
    const res = checkStateCoverage([fds("driving_fwd")], defaultFbStates());
    expect(res.ok).toBe(false);
    expect(res.missing.map((s) => s.state_id)).toContain("driving_fwd");
  });
});
