import { describe, it, expect } from "vitest";
import type { EmSequence } from "../types";
import { writeEmArtifacts } from "../em-writer";

function seq(): EmSequence {
  return {
    emId: "em-drive",
    emName: "Carriage Drive",
    sclName: "Carriage_Drive",
    cmdPins: ["cmd_start", "cmd_stop", "cmd_hold", "cmd_reset"],
    setpointPins: [],
    interlockPins: ["ilk_rotator_safe"],
    sensors: [{ name: "fb_brake_open", tag: "brake_open", scl_type: "Bool", address: "I0.0" }],
    actuators: [{ name: "cmd_run", tag: "run", scl_type: "Bool", address: "Q0.0" }],
    warnings: [],
    states: [
      { stateId: "idle", name: "Idle", index: 0, kind: "static", isSafe: true,
        staticCommands: [{ pin: "cmd_run", active: false }], steps: [],
        commandBranches: [], commandDefaults: [],
        exits: [{ toIndex: 1, condition: "(#ilk_rotator_safe = TRUE)", viaCompletion: false }] },
      { stateId: "running", name: "Running", index: 1, kind: "sequential", isSafe: false,
        staticCommands: [],
        steps: [
          { step: 1, fillId: "running.1", actionProse: "release brake", advance: "(#fb_brake_open = TRUE)", manual: false },
          { step: 2, fillId: "running.2", actionProse: "ramp drive", advance: "TRUE", manual: false },
        ],
        commandBranches: [], commandDefaults: [],
        exits: [{ toIndex: 0, condition: "TRUE", viaCompletion: true }] },
    ],
  };
}

describe("writeEmArtifacts", () => {
  it("emits the 5-artifact bundle with EM ownership and layer", () => {
    const { artifacts } = writeEmArtifacts(seq());
    expect(artifacts.map((a) => a.name)).toEqual([
      "EM_Carriage_Drive", "EM_Carriage_Drive_State", "Carriage_Drive_CMD",
      "MAP_Carriage_Drive", "EM_Carriage_Drive_DB",
    ]);
    expect(artifacts.map((a) => a.type)).toEqual(["FB", "UDT", "DB", "FC", "DB"]);
    expect(artifacts.every((a) => a.layer === "em")).toBe(true);
    expect(artifacts.every((a) => a.ownerId === "em-drive")).toBe(true);
  });

  it("builds a CASE state/step skeleton with AI-fill regions", () => {
    const fb = writeEmArtifacts(seq()).artifacts[0].content;
    expect(fb).toContain("CASE #state OF");
    expect(fb).toContain("0:   // Idle (safe)");
    expect(fb).toContain("#cmd_run := FALSE;");
    expect(fb).toContain("CASE #step OF");
    expect(fb).toContain("// <ai-fill Carriage_Drive:running.1>");
    expect(fb).toContain("// TODO (AI-fill): release brake");
    expect(fb).toContain("// </ai-fill Carriage_Drive:running.1>");
  });

  it("advances steps and gates exits correctly", () => {
    const fb = writeEmArtifacts(seq()).artifacts[0].content;
    // conditional advance off step 1
    expect(fb).toContain("IF (#fb_brake_open = TRUE) THEN #step := 2; END_IF;");
    // last step sets done unconditionally
    expect(fb).toContain("#done := TRUE;");
    // command exit into a sequential target resets #step
    expect(fb).toContain("IF (#ilk_rotator_safe = TRUE) THEN #state := 1; #done := FALSE; #step := 1; END_IF;");
    // completion exit gates on #done
    expect(fb).toContain("IF #done THEN #state := 0; #done := FALSE; END_IF;");
  });

  it("wires sensors and actuators through the MAP FC", () => {
    const map = writeEmArtifacts(seq()).artifacts[3];
    expect(map.content).toContain(`"EM_Carriage_Drive_DB".fb_brake_open := "I0.0";`);
    expect(map.content).toContain(`"Q0.0" := "EM_Carriage_Drive_DB".cmd_run;`);
    expect(map.dependencies).toContain("EM_Carriage_Drive_DB");
  });

  it("comments out wiring when an address is missing", () => {
    const s = seq();
    s.sensors[0].address = "";
    const map = writeEmArtifacts(s).artifacts[3];
    expect(map.content).toContain("// TODO wire sensor fb_brake_open");
  });

  it("references the FB type from the instance DB", () => {
    const inst = writeEmArtifacts(seq()).artifacts[4];
    expect(inst.content).toContain(`"EM_Carriage_Drive"`);
    expect(inst.dependencies).toContain("EM_Carriage_Drive");
  });

  it("instantiates the FB from the CMD DB and calls the MAP FC", () => {
    const { callLines } = writeEmArtifacts(seq());
    expect(callLines[0]).toContain(`"EM_Carriage_Drive_DB"(`);
    expect(callLines[0]).toContain(`enable := "Carriage_Drive_CMD".enable`);
    expect(callLines[0]).toContain(`cmd_reset := "Carriage_Drive_CMD".cmd_reset`);
    expect(callLines[1]).toBe(`   "MAP_Carriage_Drive"();`);
  });

  it("renders static holds for a step-less sequential state instead of an empty step CASE", () => {
    const s = seq();
    s.states[1].steps = [];
    s.states[1].staticCommands = [{ pin: "cmd_run", active: true }];
    const fb = writeEmArtifacts(s).artifacts[0].content;
    expect(fb).not.toContain("CASE #step OF");
    expect(fb.split("\n").filter((l) => l.includes("#cmd_run := TRUE;"))).toHaveLength(1);
  });

  it("resets #step when entering a state that carries steps regardless of its kind", () => {
    const s = seq();
    // mis-authored: target state is kind static but carries steps — entry must
    // still reset #step or no step ever matches and the machine deadlocks
    s.states[1].kind = "static";
    const fb = writeEmArtifacts(s).artifacts[0].content;
    expect(fb).toContain("IF (#ilk_rotator_safe = TRUE) THEN #state := 1; #done := FALSE; #step := 1; END_IF;");
  });

  it("renders a bare ; for a state with no steps, no static commands and no exits", () => {
    const s = seq();
    s.states[1].steps = [];
    s.states[1].staticCommands = [];
    s.states[1].exits = [];
    const fb = writeEmArtifacts(s).artifacts[0].content;
    const lines = fb.split("\n");
    const header = lines.findIndex((l) => l.includes("1:   // Running"));
    expect(header).toBeGreaterThan(-1);
    expect(lines[header + 1].trim()).toBe(";");
  });
});
