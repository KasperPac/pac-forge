import { describe, it, expect } from "vitest";
import { orderStates } from "../step-order";
import type { EmStateV2, EmTransitionV2 } from "@/types/spec-contract-v2";

const st = (id: string, safe = false): EmStateV2 => ({
  state_id: id, name: id, kind: "static", allowed_modes: [], is_safe_state: safe,
});
const tr = (from: string, to: string): EmTransitionV2 => ({
  transition_id: `${from}->${to}`, from_state_id: from, to_state_id: to,
  trigger: { kind: "completion" }, guard: [],
});

describe("orderStates", () => {
  it("puts the safe state first then follows transitions breadth-first", () => {
    const states = [st("driving"), st("stopped", true), st("faulted")];
    const trans = [tr("stopped", "driving"), tr("driving", "faulted"), tr("faulted", "stopped")];
    expect(orderStates(states, trans).map((s) => s.state_id))
      .toEqual(["stopped", "driving", "faulted"]);
  });
  it("falls back to the first declared state when none is flagged safe", () => {
    const states = [st("a"), st("b")];
    expect(orderStates(states, [tr("a", "b")]).map((s) => s.state_id)).toEqual(["a", "b"]);
  });
  it("terminates on cycles without duplicating", () => {
    const states = [st("a", true), st("b")];
    const trans = [tr("a", "b"), tr("b", "a")];
    expect(orderStates(states, trans).map((s) => s.state_id)).toEqual(["a", "b"]);
  });
  it("appends unreachable states in declaration order", () => {
    const states = [st("home", true), st("reachable"), st("orphan")];
    expect(orderStates(states, [tr("home", "reachable")]).map((s) => s.state_id))
      .toEqual(["home", "reachable", "orphan"]);
  });
  it("returns [] for no states", () => {
    expect(orderStates([], [])).toEqual([]);
  });
});
