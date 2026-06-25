import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../use-generation", () => ({ callNonStreaming: vi.fn() }));

import { callNonStreaming } from "../use-generation";
import { fillEmFb } from "../use-em-generate";
import type { EmSequence } from "@/lib/spec-builder/codegen/types";

const mockCall = vi.mocked(callNonStreaming);

function seq(): EmSequence {
  return {
    emId: "em-drive",
    emName: "Carriage Drive",
    sclName: "Carriage_Drive",
    states: [
      {
        stateId: "running",
        name: "Running",
        index: 0,
        kind: "sequential",
        isSafe: false,
        staticCommands: [],
        steps: [
          { step: 1, fillId: "running.1", actionProse: "release brake", advance: "#fb_brake_open", manual: false },
        ],
        exits: [{ toIndex: 0, condition: "TRUE", viaCompletion: true }],
      },
    ],
    cmdPins: ["cmd_start"],
    interlockPins: [],
    sensors: [{ name: "fb_brake_open", tag: "fb_brake_open", scl_type: "Bool", address: "I0.0" }],
    actuators: [{ name: "cmd_run", tag: "cmd_run", scl_type: "Bool", address: "Q0.0" }],
    warnings: [],
  };
}

const sig = new AbortController().signal;
const ID = "Carriage_Drive:running.1";

beforeEach(() => mockCall.mockReset());

describe("fillEmFb", () => {
  it("replaces a valid region body from AI output", async () => {
    mockCall.mockResolvedValue({
      content: `// <ai-fill ${ID}>\n               #cmd_run := TRUE;\n               // </ai-fill ${ID}>`,
      usage: null,
    });
    const res = await fillEmFb(seq(), sig);
    expect(res.filledRegions).toEqual([ID]);
    expect(res.fbContent).toContain("#cmd_run := TRUE;");
    expect(res.warnings).toHaveLength(0);
  });

  it("keeps stubs and records a warning when the AI call fails", async () => {
    // throwing impl (not mockRejectedValue) avoids vitest's eager-rejection
    // unhandled-promise detection — fillEmFb still catches it the same way.
    mockCall.mockImplementationOnce(async () => {
      throw new Error("boom");
    });
    const res = await fillEmFb(seq(), sig);
    expect(res.filledRegions).toEqual([]);
    expect(res.warnings[0]).toContain("AI fill failed (boom)");
    expect(res.fbContent).toContain("// <ai-fill " + ID + ">");
  });

  it("ignores invented and empty regions", async () => {
    mockCall.mockResolvedValue({
      content:
        `// <ai-fill Carriage_Drive:does.not.exist>\n   #x := TRUE;\n   // </ai-fill Carriage_Drive:does.not.exist>\n` +
        `// <ai-fill ${ID}>\n   \n// </ai-fill ${ID}>`,
      usage: null,
    });
    const res = await fillEmFb(seq(), sig);
    expect(res.filledRegions).toEqual([]); // invented ignored, empty body keeps stub
  });
});
