import { describe, it, expect } from "vitest";
import { buildCommandSeam } from "../em-command-seam";

describe("buildCommandSeam", () => {
  it("builds a CMD DB with one member per pin", () => {
    const { cmdDb } = buildCommandSeam("Carriage", [
      { name: "enable", scl_type: "Bool" },
      { name: "mode", scl_type: "Int" },
      { name: "cmd_start", scl_type: "Bool" },
    ]);
    expect(cmdDb.name).toBe("Carriage_CMD");
    expect(cmdDb.type).toBe("DB");
    expect(cmdDb.content).toContain("enable : Bool;");
    expect(cmdDb.content).toContain("mode : Int;");
    expect(cmdDb.content).toContain("cmd_start : Bool;");
    expect(cmdDb.content).toContain('DATA_BLOCK "Carriage_CMD"');
  });

  it("produces call bindings that read each pin from the CMD DB", () => {
    const { callBindings } = buildCommandSeam("Carriage", [{ name: "enable", scl_type: "Bool" }]);
    expect(callBindings).toEqual(['enable := "Carriage_CMD".enable']);
  });

  it("warns and emits a valid empty DB when there are no command pins", () => {
    const { cmdDb, callBindings, warnings } = buildCommandSeam("Carriage", []);
    expect(callBindings).toEqual([]);
    expect(warnings.length).toBe(1);
    expect(cmdDb.content).toContain("STRUCT");
    expect(cmdDb.content).toContain("END_STRUCT;");
  });
});
