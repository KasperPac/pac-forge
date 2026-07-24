import { describe, it, expect } from "vitest";
import { buildDashboardModel } from "@/lib/spec-builder/dashboard/dashboard-model";
import { conveyorContract } from "./fixtures/conveyor-contract";
import { fillerContract } from "./fixtures/filler-contract";
import type { CodegenResult } from "@/lib/spec-builder/codegen/types";

// Genericity golden test (CLAUDE.md "All Changes Must Be Generic"): the SAME
// buildDashboardModel logic must produce correct, distinct output for two
// unrelated machine types built from hand-written contract fixtures that
// share no device names, tags, or vocabulary. Nothing here may be made to
// pass by special-casing a device name in the implementation.
const empty = { artifacts: [], warnings: [] } as unknown as CodegenResult;
const proj = { name: "X", specId: "s", revision: 1, generatedNote: "n" };

describe("generic across machine types", () => {
  it("conveyor line: 2 devices, 2 sim rules, 0 alarms", () => {
    const m = buildDashboardModel({ contract: conveyorContract, compile: empty, project: proj });
    expect(m.devices).toHaveLength(2);
    expect(m.simRules).toHaveLength(2);
    expect(m.alarms).toHaveLength(0);
  });

  it("filler: 1 device, 1 fault alarm, 0 sim rules (no run-feedback signal)", () => {
    const m = buildDashboardModel({ contract: fillerContract, compile: empty, project: proj });
    expect(m.devices).toHaveLength(1);
    expect(m.alarms.map((a) => a.tag)).toEqual(["VLV01_Ovl"]);
    expect(m.simRules).toHaveLength(0);
  });
});
