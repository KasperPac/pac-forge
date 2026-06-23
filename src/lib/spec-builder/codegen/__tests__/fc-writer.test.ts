import { describe, it, expect } from "vitest";
import { writeSequenceFc } from "../fc-writer";
import type { SaSequence } from "../types";

const seq: SaSequence = {
  unitId: "u1", unitName: "Carriage Unit", sclName: "Carriage_Unit",
  steps: [
    {
      index: 0, emId: "em1", stateId: "stopped", name: "stopped", isHome: true,
      incoming: [{ fromIndex: 1, condition: "(CMD_FWD = FALSE)" }],
      leave: ["(CMD_FWD = TRUE) AND (Brake_Open = TRUE)"], wires: [],
    },
    {
      index: 1, emId: "em1", stateId: "driving", name: "driving", isHome: false,
      incoming: [{ fromIndex: 0, condition: "(CMD_FWD = TRUE) AND (Brake_Open = TRUE)" }],
      leave: ["(CMD_FWD = FALSE)"], wires: [{ tag: "Motor_Run" }],
    },
  ],
};

describe("writeSequenceFc", () => {
  const a = writeSequenceFc(seq);
  it("names and types the FC and takes the DB in-out", () => {
    expect(a.name).toBe("UC_Carriage_Unit");
    expect(a.type).toBe("FC");
    expect(a.content).toContain('db : "UDT_Carriage_Unit";');
    expect(a.dependencies).toContain("UDT_Carriage_Unit");
  });
  it("emits a graph seal-in for each step", () => {
    expect(a.content).toContain(
      "#db.S[1] := ((#db.S[0] AND ((CMD_FWD = TRUE) AND (Brake_Open = TRUE))) OR #db.S[1]) AND NOT ((CMD_FWD = FALSE));",
    );
  });
  it("ORs Reset into the home step activation", () => {
    expect(a.content).toContain("OR #db.Reset");
    expect(a.content).toMatch(/#db\.S\[0\] := \(\(#db\.S\[1\] AND \(\(CMD_FWD = FALSE\)\)\) OR #db\.Reset OR #db\.S\[0\]\) AND NOT \(\(CMD_FWD = TRUE\) AND \(Brake_Open = TRUE\)\);/);
  });
  it("mirrors actions and wires the active output", () => {
    expect(a.content).toContain("#db.A[0] := #db.S[0];");
    expect(a.content).toContain("#db.A[1] := #db.S[1];");
    expect(a.content).toContain('"Motor_Run" := #db.A[1];');
  });
});
