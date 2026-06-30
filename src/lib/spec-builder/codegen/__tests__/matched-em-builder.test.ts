import { describe, it, expect } from "vitest";
import { buildEmCmLinks, linkKey, type CmLinkInfo } from "../matched-em-builder";
import type { FbInterfacePin } from "@/types/fb-interface";

const pin = (over: Partial<FbInterfacePin>): FbInterfacePin => ({
  name: "x", scl_type: "Bool", direction: "input", role: "sensor_in",
  default_binding: "fb_output", exposed: false, description: "", ...over,
});

const cm = (over: Partial<CmLinkInfo>): CmLinkInfo => ({
  instanceDb: "CM_X_DB", pins: [], tags: [], ...over,
});

describe("linkKey", () => {
  it("drops a role prefix and normalizes", () => {
    expect(linkKey("fb_at_top")).toBe("attop");
    expect(linkKey("cmd_Run")).toBe("run");
    expect(linkKey("AT_TOP")).toBe("attop");
  });
});

describe("buildEmCmLinks", () => {
  it("wires an unambiguous sensor_in from the CM output pin", () => {
    const emPins = [pin({ name: "fb_at_top", role: "sensor_in", direction: "input" })];
    const cms = [cm({
      instanceDb: "CM_LS_Top_DB", tags: ["at_top"],
      pins: [pin({ name: "at_top", role: "status", direction: "output" })],
    })];
    const { linkIn, warnings } = buildEmCmLinks("Carriage", "EM_Carriage_DB", emPins, cms);
    expect(linkIn.name).toBe("LINK_Carriage_IN");
    expect(linkIn.content).toContain('"EM_Carriage_DB".fb_at_top := "CM_LS_Top_DB".at_top;');
    expect(warnings).toEqual([]);
  });

  it("wires an unambiguous actuator_out into the CM input pin", () => {
    const emPins = [pin({ name: "cmd_run", role: "actuator_out", direction: "output" })];
    const cms = [cm({
      instanceDb: "CM_Motor_DB", tags: ["run"],
      pins: [pin({ name: "run", role: "actuator_out", direction: "input" })],
    })];
    const { linkOut } = buildEmCmLinks("Carriage", "EM_Carriage_DB", emPins, cms);
    expect(linkOut.name).toBe("LINK_Carriage_OUT");
    expect(linkOut.content).toContain('"CM_Motor_DB".run := "EM_Carriage_DB".cmd_run;');
  });

  it("emits a TODO + warning when no CM provides the tag", () => {
    const emPins = [pin({ name: "fb_missing", role: "sensor_in", direction: "input" })];
    const { linkIn, warnings } = buildEmCmLinks("Carriage", "EM_Carriage_DB", emPins, []);
    expect(linkIn.content).toContain("// TODO bind #fb_missing");
    expect(warnings[0]).toContain("no CM provides");
  });

  it("emits a TODO naming candidates when 2+ CMs match", () => {
    const emPins = [pin({ name: "cmd_lift", role: "actuator_out", direction: "output" })];
    const cms = [
      cm({ instanceDb: "CM_Motor_M01_DB", tags: ["lift"], pins: [pin({ name: "lift", role: "actuator_out", direction: "input" })] }),
      cm({ instanceDb: "CM_Motor_M02_DB", tags: ["lift"], pins: [pin({ name: "lift", role: "actuator_out", direction: "input" })] }),
    ];
    const { linkOut, warnings } = buildEmCmLinks("Carriage", "EM_Carriage_DB", emPins, cms);
    expect(linkOut.content).toContain("// TODO bind #cmd_lift");
    expect(linkOut.content).toContain("CM_Motor_M01_DB");
    expect(linkOut.content).toContain("CM_Motor_M02_DB");
    expect(warnings[0]).toContain("CMs consume");
  });

  it("ignores EM pins that are not sensor_in / actuator_out", () => {
    const emPins = [
      pin({ name: "enable", role: "cmd", direction: "input" }),
      pin({ name: "state", role: "status", direction: "output" }),
    ];
    const { linkIn, linkOut, warnings } = buildEmCmLinks("Carriage", "EM_Carriage_DB", emPins, []);
    expect(linkIn.content).not.toContain("enable");
    expect(linkOut.content).not.toContain("state");
    expect(warnings).toEqual([]);
  });
});
