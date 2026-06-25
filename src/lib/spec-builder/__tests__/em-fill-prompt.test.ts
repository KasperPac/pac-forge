import { describe, it, expect } from "vitest";
import {
  emFillBriefs,
  buildEmFillSystemPrompt,
  buildEmFillUserMessage,
  pinCatalogue,
} from "../em-fill-prompt";
import type { EmSequence } from "../codegen/types";

function seq(): EmSequence {
  return {
    emId: "em-drive",
    emName: "Carriage Drive",
    sclName: "Carriage_Drive",
    states: [
      {
        stateId: "idle",
        name: "Idle",
        index: 0,
        kind: "static",
        isSafe: true,
        staticCommands: [{ pin: "cmd_run", active: false }],
        steps: [],
        exits: [{ toIndex: 1, condition: "#cmd_start", viaCompletion: false }],
      },
      {
        stateId: "running",
        name: "Running",
        index: 1,
        kind: "sequential",
        isSafe: false,
        staticCommands: [],
        steps: [
          { step: 1, fillId: "running.1", actionProse: "release brake", advance: "#fb_brake_open", manual: false },
          { step: 2, fillId: "running.2", actionProse: "ramp to speed", advance: "TRUE", manual: false },
        ],
        exits: [{ toIndex: 0, condition: "TRUE", viaCompletion: true }],
      },
    ],
    cmdPins: ["cmd_start", "cmd_stop"],
    interlockPins: ["ilk_rotator_safe"],
    sensors: [{ name: "fb_brake_open", tag: "fb_brake_open", scl_type: "Bool", address: "I0.0" }],
    actuators: [{ name: "cmd_run", tag: "cmd_run", scl_type: "Bool", address: "Q0.0" }],
    warnings: [],
  };
}

describe("emFillBriefs", () => {
  it("emits one brief per sequential-state step only", () => {
    const briefs = emFillBriefs(seq());
    expect(briefs.map((b) => b.id)).toEqual([
      "Carriage_Drive:running.1",
      "Carriage_Drive:running.2",
    ]);
    expect(briefs[0].stateName).toBe("Running");
    expect(briefs[0].action).toBe("release brake");
    expect(briefs[1].advance).toBe("TRUE");
  });
});

describe("buildEmFillSystemPrompt", () => {
  it("is generic and forbids skeleton edits", () => {
    const p = buildEmFillSystemPrompt();
    expect(p).not.toMatch(/carriage|brake|drive/i); // no machine-specific names
    expect(p).toContain("// <ai-fill ID>");
    expect(p).toContain("NEVER emit the interface");
    expect(p).toMatch(/Do NOT write `#step/);
  });
});

describe("pinCatalogue + user message", () => {
  it("lists pins by role and one block per region with markers", () => {
    const s = seq();
    const cat = pinCatalogue(s);
    expect(cat).toContain("Command inputs: #cmd_start, #cmd_stop");
    expect(cat).toContain("Interlock inputs: #ilk_rotator_safe");
    expect(cat).toContain("Sensor inputs: #fb_brake_open");
    expect(cat).toContain("Actuator outputs (you MAY assign): #cmd_run");

    const msg = buildEmFillUserMessage(s, emFillBriefs(s));
    expect(msg).toContain("FUNCTION_BLOCK: EM_Carriage_Drive");
    expect(msg).toContain("// <ai-fill Carriage_Drive:running.1>");
    expect(msg).toContain("// </ai-fill Carriage_Drive:running.1>");
    expect(msg).toContain("complete when: #fb_brake_open");
  });
});
