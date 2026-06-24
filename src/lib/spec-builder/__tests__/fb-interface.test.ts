// src/lib/spec-builder/__tests__/fb-interface.test.ts
import { describe, it, expect } from "vitest";
import { parseFbInterface, interfacePins } from "../fb-interface";

const SCL = `FUNCTION_BLOCK "CM_Motor"
{ S7_Optimized_Access := 'TRUE' }
VERSION : 0.1
   VAR_INPUT
      Run : Bool;   // start command
      Speed : Int := 0; // setpoint
   END_VAR
   VAR_OUTPUT
      Running : Bool; // status
      Fault : Bool;
   END_VAR
   VAR_IN_OUT
      Cfg : "udtCfg";
   END_VAR
   VAR
      iState : Int;  // internal
   END_VAR
   VAR_TEMP
      tEdge : Bool;
   END_VAR
BEGIN
END_FUNCTION_BLOCK`;

describe("parseFbInterface", () => {
  it("extracts every section as a superset", () => {
    const vars = parseFbInterface(SCL);
    const sections = vars.map((v) => v.section).sort();
    expect(sections).toEqual(["inout", "input", "input", "output", "output", "static", "temp"]);
  });

  it("captures name, type and inline comment", () => {
    const run = parseFbInterface(SCL).find((v) => v.name === "Run");
    expect(run).toMatchObject({ name: "Run", scl_type: "Bool", section: "input", description: "start command" });
  });

  it("keeps static and temp vars (flow-diagram dependency)", () => {
    const names = parseFbInterface(SCL).filter((v) => v.section === "static" || v.section === "temp").map((v) => v.name);
    expect(names).toEqual(["iState", "tEdge"]);
  });
});

describe("interfacePins", () => {
  it("returns only input/output/inout, mapped to direction", () => {
    const pins = interfacePins(parseFbInterface(SCL));
    expect(pins.map((p) => p.name)).toEqual(["Run", "Speed", "Running", "Fault", "Cfg"]);
    expect(pins.find((p) => p.name === "Cfg")?.direction).toBe("inout");
    expect(pins.find((p) => p.name === "Running")?.direction).toBe("output");
  });
});
