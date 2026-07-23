import { describe, expect, it } from "vitest";
import { writeOb1 } from "../ob1-writer";

describe("writeOb1 (G5-4 layer shape)", () => {
  it("emits the fixed layer order: Inputs, all Process, all Management, Outputs, Maintenance", () => {
    const a = writeOb1([{ sclName: "Process_Unit" }, { sclName: "Packaging_Unit" }]);
    const c = a.content;
    const order = [
      `"FC_Inputs"();`,
      `"FC_Process_Unit_Process"();`,
      `"FC_Packaging_Unit_Process"();`,
      `"FC_Process_Unit_Management"();`,
      `"FC_Packaging_Unit_Management"();`,
      `"FC_Outputs"();`,
      `"FC_Maintenance"();`,
    ];
    const idx = order.map((s) => c.indexOf(s));
    expect(idx.every((i) => i > -1)).toBe(true);
    expect([...idx].sort((x, y) => x - y)).toEqual(idx); // strictly in order
    expect(c).not.toContain("MAP_");
    expect(c).not.toContain(`"EM_`); // no direct EM instance calls in Main
  });

  it("lists the layer + unit FCs as dependencies", () => {
    const a = writeOb1([{ sclName: "Process_Unit" }]);
    expect(a.dependencies).toEqual(
      expect.arrayContaining(["FC_Inputs", "FC_Outputs", "FC_Maintenance", "FC_Process_Unit_Process", "FC_Process_Unit_Management"]),
    );
  });
});
