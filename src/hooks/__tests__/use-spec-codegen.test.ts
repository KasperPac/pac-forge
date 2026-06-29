import { describe, it, expect } from "vitest";
import { toExportArtifacts } from "../use-spec-codegen";
import type { CodegenResult } from "@/lib/spec-builder/codegen";

const result: CodegenResult = {
  artifacts: [
    { name: "UDT_U", type: "UDT", filename: "UDT_U.udt", content: "TYPE", dependencies: [], folder: "PLC data types" },
    { name: "DB_U", type: "DB", filename: "DB_U.db", content: "DATA_BLOCK", dependencies: ["UDT_U"], folder: "Program blocks" },
  ],
  stubs: { controlModules: [], equipmentModules: [] },
  warnings: [],
};

describe("toExportArtifacts", () => {
  const out = toExportArtifacts(result, "proj-1", "sess-1");
  it("maps codegen artifacts onto the Artifact shape", () => {
    expect(out).toHaveLength(2);
    const udt = out.find((a) => a.name === "UDT_U")!;
    expect(udt.type).toBe("UDT");
    expect(udt.content).toBe("TYPE");
    expect(udt.dependencies).toEqual([]);
    expect(udt.project_id).toBe("proj-1");
    expect(udt.destination_folder).toBe("PLC data types");
  });
  it("preserves dependency edges", () => {
    const db = out.find((a) => a.name === "DB_U")!;
    expect(db.dependencies).toEqual(["UDT_U"]);
  });
});
