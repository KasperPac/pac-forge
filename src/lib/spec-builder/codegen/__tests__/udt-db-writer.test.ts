import { describe, it, expect } from "vitest";
import { writeUdt } from "../udt-writer";
import { writeSequenceDb } from "../db-writer";
import type { SaSequence } from "../types";

const seq: SaSequence = {
  unitId: "u1", unitName: "Carriage Unit", sclName: "Carriage_Unit",
  steps: [
    { index: 0, emId: "em1", stateId: "stopped", name: "stopped", isHome: true, incoming: [], leave: [], wires: [] },
    { index: 1, emId: "em1", stateId: "driving", name: "driving", isHome: false, incoming: [], leave: [], wires: [{ tag: "Motor_Run" }] },
  ],
};

describe("writeUdt", () => {
  const a = writeUdt(seq);
  it("names and types the artifact", () => {
    expect(a.name).toBe("UDT_Carriage_Unit");
    expect(a.type).toBe("UDT");
    expect(a.filename).toBe("UDT_Carriage_Unit.udt");
  });
  it("sizes the S/A arrays to the step count and declares control bits", () => {
    expect(a.content).toContain("S : ARRAY[0..1] OF BOOL;");
    expect(a.content).toContain("A : ARRAY[0..1] OF BOOL;");
    expect(a.content).toContain("Stop : Bool;");
    expect(a.content).toContain("Reset : Bool;");
  });
});

describe("writeSequenceDb", () => {
  const a = writeSequenceDb(seq);
  it("declares the UDT type and depends on it", () => {
    expect(a.name).toBe("DB_Carriage_Unit");
    expect(a.type).toBe("DB");
    expect(a.dependencies).toContain("UDT_Carriage_Unit");
    expect(a.content).toContain('"UDT_Carriage_Unit"');
  });
  it("initialises home step bits TRUE", () => {
    expect(a.content).toContain("S[0] := true;");
    expect(a.content).not.toContain("S[1] := true;");
  });
});
