import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { detectColumns } from "@/lib/spec-builder/instrument-parser";

describe("detectColumns — assembly alias", () => {
  it("maps an 'assembly' header to the grouping column", () => {
    const csv = "tag,io_address,signal_type,description,assembly\n" +
      "M1_CMD,%Q0.0,DO,Motor 1 run,Conveyor CV01\n" +
      "M1_FB,%I0.0,DI,Motor 1 feedback,Conveyor CV01\n" +
      "M1_OL,%I0.1,DI,Motor 1 overload,Conveyor CV01";
    const wb = XLSX.read(csv, { type: "string" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;

    const { mapping } = detectColumns(sheet);

    expect(mapping.subsystem).not.toBeNull();
    expect(mapping.tag).not.toBeNull();
  });
});
