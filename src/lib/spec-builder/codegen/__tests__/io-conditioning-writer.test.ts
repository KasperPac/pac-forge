// src/lib/spec-builder/codegen/__tests__/io-conditioning-writer.test.ts
//
// G1-4b — project-level IO conditioning: FB_IO_Conditioning (TON/TOF per
// conditioned DI, multi-instance per the house SCL pattern) writing the
// IO_Cond global DB, called FIRST in OB1 so conditioned values are ready
// for the whole scan (the golden master's FORCE_Input_Cond pattern).
import { describe, expect, it } from "vitest";
import { writeIoConditioning } from "../io-conditioning-writer";

describe("writeIoConditioning", () => {
  it("emits nothing when no signals are conditioned", () => {
    const r = writeIoConditioning([]);
    expect(r.artifacts).toEqual([]);
    expect(r.callLine).toBeUndefined();
  });

  it("emits IO_Cond DB + conditioning FB + instance DB + first-in-OB1 call", () => {
    const r = writeIoConditioning([
      { tag: "M01_Therm", onDelayMs: undefined, offDelayMs: 5000 },
      { tag: "Gate_Closed", onDelayMs: 50, offDelayMs: 50 },
      { tag: "Level_OK", onDelayMs: 200, offDelayMs: undefined },
    ]);
    const names = r.artifacts.map((a) => a.name);
    expect(names).toEqual(["IO_Cond", "FB_IO_Conditioning", "FB_IO_Conditioning_DB"]);
    expect(r.callLine).toBe('   "FB_IO_Conditioning_DB"();');

    const db = r.artifacts.find((a) => a.name === "IO_Cond")!;
    expect(db.content).toContain("M01_Therm : Bool;");
    expect(db.content).toContain("Gate_Closed : Bool;");

    const fb = r.artifacts.find((a) => a.name === "FB_IO_Conditioning")!;
    // off-delay only → TOF straight from the raw tag
    expect(fb.content).toContain("t_off_M01_Therm : TOF;");
    expect(fb.content).toContain('#t_off_M01_Therm(IN := "M01_Therm", PT := T#5000MS);');
    expect(fb.content).toContain('"IO_Cond".M01_Therm := #t_off_M01_Therm.Q;');
    // on-delay only → TON
    expect(fb.content).toContain("t_on_Level_OK : TON;");
    expect(fb.content).toContain('"IO_Cond".Level_OK := #t_on_Level_OK.Q;');
    // both → TON chained into TOF
    expect(fb.content).toContain('#t_on_Gate_Closed(IN := "Gate_Closed", PT := T#50MS);');
    expect(fb.content).toContain("#t_off_Gate_Closed(IN := #t_on_Gate_Closed.Q, PT := T#50MS);");
    expect(fb.content).toContain('"IO_Cond".Gate_Closed := #t_off_Gate_Closed.Q;');
  });
});
