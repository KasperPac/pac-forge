// src/lib/spec-builder/codegen/__tests__/ob1-writer.test.ts
import { describe, it, expect } from "vitest";
import { writeOb1 } from "../ob1-writer";

describe("writeOb1", () => {
  const a = writeOb1(
    ['   "CM_Motor_M01_DB"(\n      M01_Fault := "I0.0"\n   );'],
    [{ sclName: "Carriage_Unit" }],
  );
  it("names and types OB1", () => {
    expect(a.name).toBe("Main");
    expect(a.type).toBe("OB");
    expect(a.filename).toBe("Main.ob");
  });
  it("emits device calls then per-Unit sequencer calls", () => {
    expect(a.content).toContain('"CM_Motor_M01_DB"(');
    expect(a.content).toContain('"UC_Carriage_Unit"(db := "DB_Carriage_Unit");');
  });
  it("declares dependencies on the unit DB + FC", () => {
    expect(a.dependencies).toContain("UC_Carriage_Unit");
    expect(a.dependencies).toContain("DB_Carriage_Unit");
  });
});
