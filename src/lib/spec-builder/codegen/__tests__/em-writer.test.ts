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
    drives: [],
    warnings: [],
    states: [
      { stateId: "idle", name: "Idle", index: 0, kind: "static", isSafe: true,
        staticCommands: [{ pin: "cmd_run", value: "FALSE" }], steps: [],
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

  it("wires sensors and actuators through the MAP FC by symbolic tag name", () => {
    const map = writeEmArtifacts(seq()).artifacts[3];
    expect(map.content).toContain(`"EM_Carriage_Drive_DB".fb_brake_open := "brake_open";   // %I0.0`);
    expect(map.content).toContain(`"run" := "EM_Carriage_Drive_DB".cmd_run;   // %Q0.0`);
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
    s.states[1].staticCommands = [{ pin: "cmd_run", value: "TRUE" }];
    const fb = writeEmArtifacts(s).artifacts[0].content;
    expect(fb).not.toContain("CASE #step OF");
    expect(fb.split("\n").filter((l) => l.includes("#cmd_run := TRUE;"))).toHaveLength(1);
  });

  it("emits typed static-hold values verbatim (Int pins hold 0, not FALSE)", () => {
    const s = seq();
    s.actuators.push({ name: "cmd_speed_ref", tag: "speed_ref", scl_type: "Int", address: "QW64" });
    s.states[0].staticCommands = [
      { pin: "cmd_run", value: "FALSE" },
      { pin: "cmd_speed_ref", value: "0" },
    ];
    const fb = writeEmArtifacts(s).artifacts[0].content;
    expect(fb).toContain("#cmd_speed_ref := 0;");
    expect(fb).not.toContain("#cmd_speed_ref := FALSE;");
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

describe("writeEmArtifacts command-driven states", () => {
  function commandSeq(): EmSequence {
    const s = seq();
    s.setpointPins = ["sp_JOG_SPEED_FWD"];
    s.actuators.push({ name: "cmd_speed_ref", tag: "speed_ref", scl_type: "Int", address: "QW64" });
    s.states[1] = {
      stateId: "execute", name: "Execute", index: 1, kind: "sequential", isSafe: false,
      staticCommands: [], steps: [],
      commandDefaults: [
        { pin: "cmd_run", value: "FALSE" },
        { pin: "cmd_speed_ref", value: "0" },
      ],
      commandBranches: [
        { label: "Drive Forward (Jog)", condition: "(#fb_brake_open = TRUE)",
          holds: [{ pin: "cmd_run", value: "TRUE" }, { pin: "cmd_speed_ref", value: "#sp_JOG_SPEED_FWD" }] },
        { label: "Creep Reverse", condition: "(#ilk_rotator_safe = TRUE)",
          holds: [{ pin: "cmd_speed_ref", value: "-50" }] },
      ],
      exits: [{ toIndex: 0, condition: "(#ilk_rotator_safe = FALSE)", viaCompletion: false }],
    };
    return s;
  }

  it("renders defaults first, then the labelled IF/ELSIF branch chain", () => {
    const fb = writeEmArtifacts(commandSeq()).artifacts[0].content;
    const body = fb.slice(fb.indexOf("1:   // Execute"));
    expect(body).toContain("// command-conditional holds (defaults first, active branch overrides)");
    // defaults precede the IF
    expect(body.indexOf("#cmd_run := FALSE;")).toBeLessThan(body.indexOf("IF (#fb_brake_open = TRUE) THEN"));
    expect(body).toContain("IF (#fb_brake_open = TRUE) THEN");
    expect(body).toContain("// Drive Forward (Jog)");
    expect(body).toContain("#cmd_speed_ref := #sp_JOG_SPEED_FWD;");
    expect(body).toContain("ELSIF (#ilk_rotator_safe = TRUE) THEN");
    expect(body).toContain("#cmd_speed_ref := -50;");
    expect(body).toContain("END_IF;");
  });

  it("emits no ai-fill markers and never assigns #done in a command state", () => {
    const fb = writeEmArtifacts(commandSeq()).artifacts[0].content;
    const body = fb.slice(fb.indexOf("1:   // Execute"));
    expect(body).not.toContain("<ai-fill");
    expect(body).not.toContain("#done := TRUE");
  });

  it("exposes setpoint pins in VAR_INPUT, the CMD DB, and the call bindings", () => {
    const { artifacts, callLines } = writeEmArtifacts(commandSeq());
    expect(artifacts[0].content).toContain("sp_JOG_SPEED_FWD : Int;");
    expect(artifacts[2].content).toContain("sp_JOG_SPEED_FWD : Int;");
    expect(callLines[0]).toContain(`sp_JOG_SPEED_FWD := "Carriage_Drive_CMD".sp_JOG_SPEED_FWD`);
  });

  it("renders defaults-only command behavior without an IF chain", () => {
    const s = commandSeq();
    s.states[1].commandBranches = [];
    const fb = writeEmArtifacts(s).artifacts[0].content;
    const body = fb.slice(fb.indexOf("1:   // Execute"));
    expect(body).toContain("#cmd_run := FALSE;");
    expect(body).not.toContain("IF (#fb_brake_open");
  });

  it("renders the hold chain, not the step CASE, when a state carries both", () => {
    const s = commandSeq();
    s.states[1].steps = [
      { step: 1, fillId: "execute.1", actionProse: "should not render", advance: "TRUE", manual: false },
    ];
    const fb = writeEmArtifacts(s).artifacts[0].content;
    const body = fb.slice(fb.indexOf("1:   // Execute"));
    expect(body).toContain("IF (#fb_brake_open = TRUE) THEN");
    expect(body).not.toContain("CASE #step OF");
  });

  it("emits a bare statement for a branch with no holds", () => {
    const s = commandSeq();
    s.states[1].commandBranches = [{ label: "Signal only", condition: "(#fb_brake_open = TRUE)", holds: [] }];
    const fb = writeEmArtifacts(s).artifacts[0].content;
    const body = fb.slice(fb.indexOf("1:   // Execute"));
    expect(body).toMatch(/\/\/ Signal only\r?\n\s*;/);
  });
});

describe("MAP drive emission (G1-2/G1-3)", () => {
  function driveSeq(): EmSequence {
    const s = seq();
    // the drive CM's telegram pins on the EM seam
    s.actuators.push({
      name: "cmd_VSD1_Speed_Ref", tag: "VSD1_Speed_Ref", scl_type: "Int", address: "",
    });
    s.sensors.push({
      name: "fb_VSD1_Speed_Fb", tag: "VSD1_Speed_Fb", scl_type: "Int", address: "",
    });
    s.drives = [
      {
        control_module_id: "cm-vsd",
        control_module_name: "Rail Motors VSD",
        sclName: "Rail_Motors_VSD",
        fb_name: "SINA_SPEED",
        io_tags: ["VSD1_Speed_Ref", "VSD1_Speed_Fb"],
        drive: {
          family: "sinamics_g120",
          telegram: 1,
          speed_ref: { unit: "percent_ref_speed", signed: true },
          enable_policy: "enable_on_nonzero_ref",
        },
        engineering: {
          control_module_id: "cm-vsd",
          hw_id_stw: 322,
          hw_id_zsw: 322,
          ref_speed_rpm: 1500.0,
          config_axis: 0x003f,
        },
        warnings: [],
      },
    ];
    return s;
  }

  it("emits the SINA_SPEED call converging on the golden master", () => {
    const { artifacts } = writeEmArtifacts(driveSeq());
    const map = artifacts.find((a) => a.name === "MAP_Carriage_Drive")!.content;
    expect(map).toContain('#ref_Rail_Motors_VSD := "EM_Carriage_Drive_DB".cmd_VSD1_Speed_Ref;');
    expect(map).toContain('"SINA_SPEED_Rail_Motors_VSD_DB"(');
    expect(map).toContain("EnableAxis := #ref_Rail_Motors_VSD <> 0");
    expect(map).toContain("SpeedSp := INT_TO_REAL(#ref_Rail_Motors_VSD) * 15.0");
    expect(map).toContain("RefSpeed := 1500.0");
    expect(map).toContain("ConfigAxis := 16#003F");
    expect(map).toContain("HWIDSTW := 322");
    expect(map).toContain("HWIDZSW := 322");
    expect(map).toContain(
      '"EM_Carriage_Drive_DB".fb_VSD1_Speed_Fb := REAL_TO_INT("SINA_SPEED_Rail_Motors_VSD_DB".ActVelocity / 15.0);',
    );
    // telegram pins are excluded from the plain symbolic copy loops
    expect(map).not.toContain('// TODO wire sensor fb_VSD1_Speed_Fb');
    expect(map).not.toContain('// TODO wire actuator cmd_VSD1_Speed_Ref');
    // VAR_TEMP for the ref
    expect(map).toContain("ref_Rail_Motors_VSD : Int;");
  });

  it("adds the drive instance DB to the artifact bundle", () => {
    const { artifacts } = writeEmArtifacts(driveSeq());
    const db = artifacts.find((a) => a.name === "SINA_SPEED_Rail_Motors_VSD_DB");
    expect(db?.type).toBe("DB");
    expect(db?.content).toContain('"SINA_SPEED"');
  });

  it("emits TODOs instead of guesses when engineering data is missing", () => {
    const s = driveSeq();
    s.drives[0].engineering = undefined;
    const map = writeEmArtifacts(s).artifacts.find((a) => a.name === "MAP_Carriage_Drive")!.content;
    expect(map).toContain("SpeedSp := INT_TO_REAL(#ref_Rail_Motors_VSD)");
    expect(map).not.toContain("* 15.0");
    expect(map).toMatch(/RefSpeed := 0\.0.*TODO/);
    expect(map).toMatch(/HWIDSTW := 0.*TODO/);
  });

  it("emits a TODO stub for drives without a deterministic FB", () => {
    const s = driveSeq();
    s.drives[0].fb_name = undefined;
    const map = writeEmArtifacts(s).artifacts.find((a) => a.name === "MAP_Carriage_Drive")!.content;
    expect(map).toContain("// TODO drive Rail Motors VSD");
    expect(map).not.toContain("SINA_SPEED_Rail_Motors_VSD_DB");
  });
});

describe("MAP N/C inversion (G1-4)", () => {
  it("emits NOT for nc-polarity sensors and plain copies otherwise", () => {
    const s = seq();
    s.sensors = [
      { name: "fb_CM1_Therm", tag: "CM1_Therm", scl_type: "Bool", address: "I1.1", polarity: "nc" },
      { name: "fb_brake_open", tag: "brake_open", scl_type: "Bool", address: "I0.0", polarity: "no" },
      { name: "fb_plain", tag: "plain", scl_type: "Bool", address: "I0.2" },
    ];
    const map = writeEmArtifacts(s).artifacts.find((a) => a.name === "MAP_Carriage_Drive")!.content;
    expect(map).toContain(
      '"EM_Carriage_Drive_DB".fb_CM1_Therm := NOT "CM1_Therm";   // %I1.1 N/C fail-safe (healthy = TRUE), inverted',
    );
    expect(map).toContain('"EM_Carriage_Drive_DB".fb_brake_open := "brake_open";   // %I0.0');
    expect(map).toContain('"EM_Carriage_Drive_DB".fb_plain := "plain";   // %I0.2');
  });
});
