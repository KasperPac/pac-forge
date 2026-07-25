// src/lib/__tests__/tia-provision-progress.test.ts
//
// Provision WS progress accumulation (G9-W9) — pure reducer.
import { describe, expect, it } from "vitest";
import { applyProvisionEvent, type ProvisionStep } from "../tia-provision-progress";

describe("applyProvisionEvent", () => {
  it("appends the first step as active", () => {
    expect(applyProvisionEvent([], { step: "Creating TIA project", progress: 15 })).toEqual([
      { label: "Creating TIA project", progress: 15, state: "active" },
    ]);
  });

  it("marks the previous active step done when a new one arrives", () => {
    const first = applyProvisionEvent([], { step: "Creating TIA project", progress: 15 });
    const second = applyProvisionEvent(first, { step: "Adding PLC device", progress: 35 });
    expect(second).toEqual([
      { label: "Creating TIA project", progress: 15, state: "done" },
      { label: "Adding PLC device", progress: 35, state: "active" },
    ]);
  });

  it("replaces a repeated label instead of duplicating it", () => {
    const steps: ProvisionStep[] = [{ label: "Importing program blocks", progress: 80, state: "active" }];
    const next = applyProvisionEvent(steps, { step: "Importing program blocks", progress: 85 });
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual({ label: "Importing program blocks", progress: 85, state: "active" });
  });

  it("marks a completed 100% step done and a failed step error", () => {
    expect(applyProvisionEvent([], { step: "Complete", progress: 100, complete: true })[0].state)
      .toBe("done");
    expect(applyProvisionEvent([], { step: "Adding PLC device", progress: 35, failed: true })[0].state)
      .toBe("error");
  });

  it("leaves an errored step errored when later steps arrive", () => {
    const failed = applyProvisionEvent([], { step: "Adding PLC device", progress: 35, failed: true });
    const next = applyProvisionEvent(failed, { step: "Saving project", progress: 90 });
    expect(next[0].state).toBe("error");
    expect(next[1].state).toBe("active");
  });
});
