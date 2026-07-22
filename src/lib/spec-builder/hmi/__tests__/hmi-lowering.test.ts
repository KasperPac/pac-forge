// src/lib/spec-builder/hmi/__tests__/hmi-lowering.test.ts
//
// G7-8 dual lowering: bridge /tia/hmi/build JSON + build-pack markdown.
import { describe, expect, it } from "vitest";
import { buildHmiBridgeSpec } from "../hmi-bridge-spec";
import { renderHmiBuildPack } from "../hmi-build-pack";
import type { HmiIr } from "../hmi-ir";

function ir(): HmiIr {
  return {
    tags: [
      { name: "EM_Belt_DB_state", plcTag: "EM_Belt_DB.state" },
      { name: "EStop_Healthy", plcTag: "EStop_Healthy" },
      { name: "Belt_CMD_sp_SPEED", plcTag: "Belt_CMD.sp_SPEED" },
      { name: "Maintenance_CMD_maintenance_mode", plcTag: "Maintenance_CMD.maintenance_mode" },
    ],
    textLists: [
      { name: "Belt_States", stateTag: "EM_Belt_DB.state", entries: [{ index: 0, text: "Idle" }, { index: 1, text: "Execute" }] },
    ],
    alarmClasses: [{ name: "Fault", acknowledgement: true }],
    alarms: [
      { tag: "EStop_Healthy", triggerValue: 0, className: "Fault", text: "Emergency stop active" },
    ],
    setpoints: [{ tag: "Belt_CMD.sp_SPEED", label: "SPEED", group: "Belt" }],
    roles: [{ name: "Supervisor", level: 2 }],
    screens: [
      {
        name: "Overview", title: "Overview",
        items: [
          { kind: "state_field", label: "Belt", tag: "EM_Belt_DB.state", textList: "Belt_States" },
          { kind: "lamp", label: "E-Stop chain", tag: "EStop_Healthy", onValue: 1 },
        ],
      },
      {
        name: "Setpoints", title: "Setpoints", requiredLevel: 2,
        items: [{ kind: "numeric_field", label: "SPEED", tag: "Belt_CMD.sp_SPEED", writable: true, requiredLevel: 2 }],
      },
    ],
  };
}

describe("buildHmiBridgeSpec", () => {
  it("lowers tags, alarms with verified trigger modes, and screens to the bridge shape", () => {
    const { spec } = buildHmiBridgeSpec(ir(), { connection: "HMI_PLC_1" });
    expect(spec.connection).toBe("HMI_PLC_1");
    expect((spec.tags as unknown[]).length).toBe(4);
    const alarm = (spec.alarms as Record<string, unknown>[])[0];
    expect(alarm.trigger).toBe("OnFallingEdge"); // triggerValue 0 -> falling edge
    expect(alarm.tag).toBe("EStop_Healthy");
    const screens = spec.screens as Record<string, unknown>[];
    expect(screens.map((s) => s.name)).toEqual(["Overview", "Setpoints"]);
    const ovItems = screens[0].items as Record<string, unknown>[];
    // state field lowers to Label + IOField bound via the HMI tag NAME
    expect(ovItems.some((i) => i.type === "IOField" && i.tag === "EM_Belt_DB_state")).toBe(true);
    // lamp lowers to a Circle with a singleBit BackColor dynamization
    const lamp = ovItems.find((i) => i.type === "Circle") as Record<string, unknown>;
    const dyn = (lamp.dynamizations as Record<string, unknown>[])[0];
    expect(dyn.property).toBe("BackColor");
    expect(dyn.singleBit).toBeDefined();
  });

  it("reports non-automatable capabilities as manual steps (text lists, roles, screen levels)", () => {
    const { manualSteps } = buildHmiBridgeSpec(ir());
    expect(manualSteps.some((s) => s.includes("Belt_States"))).toBe(true);
    expect(manualSteps.some((s) => s.includes("Supervisor"))).toBe(true);
    expect(manualSteps.some((s) => s.includes("Setpoints") && s.includes("2"))).toBe(true);
  });
});

describe("renderHmiBuildPack", () => {
  it("renders screens, alarms, text lists, roles, and the manual steps", () => {
    const { manualSteps } = buildHmiBridgeSpec(ir());
    const md = renderHmiBuildPack(ir(), { projectName: "Test Machine", manualSteps });
    expect(md).toContain("# Test Machine — HMI Build Pack");
    expect(md).toContain("## Screen: Overview");
    expect(md).toContain("`EM_Belt_DB.state`");
    expect(md).toContain("| 1 | `EStop_Healthy` | =0 | Fault | Emergency stop active |");
    expect(md).toContain("**Belt_States**");
    expect(md).toContain("| Supervisor | 2 |");
    expect(md).toContain("## Manual build steps");
  });
});
