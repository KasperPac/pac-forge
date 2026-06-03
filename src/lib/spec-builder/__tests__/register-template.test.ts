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

  it("Register header row matches the documented columns", () => {
    const wb = buildRegisterTemplateWorkbook();
    const sheet = wb.Sheets["Register"]!;
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    expect(rows[0]).toEqual(REGISTER_TEMPLATE_HEADERS);
  });

  it("parser detects tag/device/assembly/subsystem from the template header", () => {
    const wb = buildRegisterTemplateWorkbook();
    const { mapping } = detectColumns(wb.Sheets["Register"]!);
    expect(mapping.tag).not.toBeNull();
    expect(mapping.device).not.toBeNull();
    expect(mapping.assembly).not.toBeNull();
    expect(mapping.subsystem).not.toBeNull();
    expect(mapping.signal_type).not.toBeNull();
    expect(mapping.device).not.toBe(mapping.device_type);
  });
});
