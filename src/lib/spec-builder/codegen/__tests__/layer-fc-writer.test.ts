import { describe, expect, it } from "vitest";
import { writeFcInputs, writeFcOutputs, writeFcMaintenance } from "../layer-fc-writer";
import type { EmMapLines } from "../types";

const em = (over: Partial<EmMapLines> = {}): EmMapLines => ({
  emName: "Agitator_Module",
  inputLines: [`   "EM_Agitator_Module_DB".fb_run := "AGITATOR_FB_RUN";   // %I0.0`],
  outputLines: [`   "AGITATOR_CMD" := "EM_Agitator_Module_DB".cmd_motor;   // %Q0.0`],
  tempVars: [],
  ...over,
});

describe("writeFcInputs", () => {
  it("calls IO_Cond FIRST, then per-EM banners with input lines", () => {
    const a = writeFcInputs({ ioCondCallLine: `   "FB_IO_Conditioning_DB"();`, ems: [em()] });
    expect(a.name).toBe("FC_Inputs");
    expect(a.layer).toBe("system");
    expect(a.folder).toBe("00_System");
    const body = a.content;
    expect(body.indexOf("FB_IO_Conditioning_DB")).toBeGreaterThan(-1);
    expect(body.indexOf("FB_IO_Conditioning_DB")).toBeLessThan(body.indexOf("// --- Agitator_Module ---"));
    expect(body).toContain(`"EM_Agitator_Module_DB".fb_run := "AGITATOR_FB_RUN"`);
    expect(body).not.toContain("AGITATOR_CMD :=");
  });

  it("emits an empty-body FC when there is nothing to map", () => {
    const a = writeFcInputs({ ems: [] });
    expect(a.content).toContain("// (nothing in this project)");
  });
});

describe("writeFcOutputs", () => {
  it("emits per-EM banners with output lines and hoists drive temp vars", () => {
    const a = writeFcOutputs({ ems: [em({ tempVars: [`      ref_M1 : Int;`], outputLines: [`   "AGITATOR_CMD" := "EM_Agitator_Module_DB".cmd_motor;`, `   #ref_M1 := "EM_Agitator_Module_DB".sp_speed;`] })] });
    expect(a.content).toContain("VAR_TEMP");
    expect(a.content).toContain("ref_M1 : Int;");
    expect(a.content).toContain("// --- Agitator_Module ---");
    expect(a.content).not.toContain("fb_run :=");
  });

  it("dedupes an identical tempVar declaration shared by two EMs (G5-4 final-review finding 4)", () => {
    const a = writeFcOutputs({
      ems: [
        em({ emName: "Agitator_Module", tempVars: [`      ref_M1 : Int;`] }),
        em({ emName: "Mixer_Module", tempVars: [`      ref_M1 : Int;`] }),
      ],
    });
    const occurrences = a.content.split("ref_M1 : Int;").length - 1;
    expect(occurrences).toBe(1);
  });
});

describe("writeFcMaintenance", () => {
  it("puts the override call LAST", () => {
    const a = writeFcMaintenance({
      presetCallLine: `   "MAINT_Encoder_Preset"();`,
      overrideCallLine: `   "MAINT_Output_Override"();   // MUST stay the last call`,
    });
    const preset = a.content.indexOf("MAINT_Encoder_Preset");
    const override = a.content.indexOf("MAINT_Output_Override");
    expect(preset).toBeGreaterThan(-1);
    expect(override).toBeGreaterThan(preset);
  });

  it("emits an empty FC when no maintenance exists", () => {
    expect(writeFcMaintenance({}).content).toContain("// (nothing in this project)");
  });
});
