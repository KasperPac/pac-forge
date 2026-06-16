import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildRegisterTemplateWorkbook, REGISTER_TEMPLATE_HEADERS } from "@/lib/spec-builder/register-template";
import { detectColumns } from "@/lib/spec-builder/instrument-parser";

describe("register template", () => {
  it("has Instructions and Register sheets", () => {
    const wb = buildRegisterTemplateWorkbook();
    expect(wb.SheetNames).toContain("Instructions");
    expect(wb.SheetNames).toContain("Register");
  });

  it("puts Register first so the parser (SheetNames[0]) reads the data", () => {
    const wb = buildRegisterTemplateWorkbook();
    expect(wb.SheetNames[0]).toBe("Register");
  });

  it("Register header row matches the documented columns", () => {
    const wb = buildRegisterTemplateWorkbook();
    const sheet = wb.Sheets["Register"]!;
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    expect(rows[0]).toEqual(REGISTER_TEMPLATE_HEADERS);
  });

  it("parser detects tag/control_module/equipment_module/unit from the template header", () => {
    const wb = buildRegisterTemplateWorkbook();
    const { mapping } = detectColumns(wb.Sheets["Register"]!);
    expect(mapping.tag).not.toBeNull();
    expect(mapping.control_module).not.toBeNull();
    expect(mapping.equipment_module).not.toBeNull();
    expect(mapping.unit).not.toBeNull();
    expect(mapping.signal_type).not.toBeNull();
    expect(mapping.control_module).not.toBe(mapping.device_type);
  });
});
