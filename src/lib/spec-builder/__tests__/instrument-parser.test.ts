import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { detectColumns, buildHierarchyFromTags, extractRows, groupSubsystems, pickRegisterSheetName } from "@/lib/spec-builder/instrument-parser";
import type { InstrumentTag } from "@/types/spec-builder";

describe("detectColumns — equipment_module alias", () => {
  it("maps an 'equipment module' header to the equipment_module column", () => {
    const csv = "tag,io_address,signal_type,description,equipment module\n" +
      "M1_CMD,%Q0.0,DO,Motor 1 run,Conveyor CV01\n" +
      "M1_FB,%I0.0,DI,Motor 1 feedback,Conveyor CV01\n" +
      "M1_OL,%I0.1,DI,Motor 1 overload,Conveyor CV01";
    const wb = XLSX.read(csv, { type: "string" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;

    const { mapping } = detectColumns(sheet);

    expect(mapping.equipment_module).not.toBeNull();
    expect(mapping.tag).not.toBeNull();
  });

  it("maps signal_type to signal_type even with a device_type column present", () => {
    // Regression: a bare "type" alias on device_type used to greedily steal
    // the "Signal Type" column. It must resolve to signal_type.
    const wb = XLSX.read("tag,description,Signal Type,Device Type,io_address\nX,Y,DI,Motor,%I0.0", { type: "string" });
    const { mapping } = detectColumns(wb.Sheets[wb.SheetNames[0]!]!);
    expect(mapping.signal_type).not.toBeNull();
    expect(mapping.device_type).not.toBeNull();
    expect(mapping.signal_type).not.toBe(mapping.device_type);
  });

  it("maps control_module and device_type to different columns", () => {
    const wb = XLSX.read("tag,description,signal_type,io_address,control_module,equipment_module,device type\nA,B,DI,%I0.0,M1,CV01,Motor", { type: "string" });
    const { mapping } = detectColumns(wb.Sheets[wb.SheetNames[0]!]!);
    expect(mapping.control_module).not.toBeNull();
    expect(mapping.device_type).not.toBeNull();
    expect(mapping.control_module).not.toBe(mapping.device_type);
  });
});

function tag(
  t: string,
  unit: string,
  equipment_module = "",
  control_module = "",
): InstrumentTag {
  return {
    tag: t,
    device_type: "",
    description: t,
    signal_type: "DI",
    io_address: "",
    control_module_class: "other",
    signal_direction: "DI",
    unit_prefix: unit,
    is_safety: false,
    process_cell: "",
    unit,
    equipment_module,
    control_module,
  };
}

describe("buildHierarchyFromTags — grouping by unit", () => {
  it("groups tags into one unit per distinct unit value", () => {
    const tags: InstrumentTag[] = [
      tag("VSD1_ENABLE", "Carriage"),
      tag("VSD1_FWD", "Carriage"),
      tag("VSD2_ENABLE", "Rotator"),
    ];
    const result = buildHierarchyFromTags(tags);
    expect(result.map((u) => u.unit_name).sort()).toEqual(["Carriage", "Rotator"]);
  });

  it("empty tags → empty result", () => {
    expect(buildHierarchyFromTags([])).toHaveLength(0);
  });
});

describe("buildHierarchyFromTags — control module grouping", () => {
  it("keeps fault + thermistor tags on ONE control module", () => {
    const tags: InstrumentTag[] = [
      tag("CARR_M1_FAULT", "Carriage"),
      tag("CARR_M1_THERM", "Carriage"),
    ];
    const result = buildHierarchyFromTags(tags);
    expect(result).toHaveLength(1);
    const controlModules = result[0].equipment_modules.flatMap((e) => e.control_modules);
    expect(controlModules).toHaveLength(1);
    expect(controlModules[0].io_signals).toHaveLength(2);
  });
});

describe("buildHierarchyFromTags — explicit ISA-88 columns", () => {
  it("template-style: one unit, explicit equipment + control modules", () => {
    const tags: InstrumentTag[] = [
      tag("CV01_M1_CMD", "Infeed", "Conveyor CV01", "M1"),
      tag("CV01_M1_FB", "Infeed", "Conveyor CV01", "M1"),
      tag("CV01_PE1", "Infeed", "Conveyor CV01", "PE1"),
    ];
    const result = buildHierarchyFromTags(tags);
    expect(result).toHaveLength(1);
    expect(result[0].unit_name).toBe("Infeed");

    const ems = result[0].equipment_modules;
    expect(ems).toHaveLength(1);

    const cmIds = ems[0].control_modules.map((c) => c.control_module_id).sort();
    expect(cmIds).toEqual(["M1", "PE1"]);

    const m1 = ems[0].control_modules.find((c) => c.control_module_id === "M1")!;
    expect(m1.io_signals).toHaveLength(2);
  });

  it("multiple units when the unit column is filled", () => {
    const tags: InstrumentTag[] = [
      tag("A_M1_CMD", "Infeed", "Conveyor CV01", "M1"),
      tag("B_M2_CMD", "Outfeed", "Conveyor CV02", "M2"),
    ];
    const result = buildHierarchyFromTags(tags);
    expect(result.map((u) => u.unit_name).sort()).toEqual(["Infeed", "Outfeed"]);
  });
});

describe("extractRows — explicit grouping columns", () => {
  it("reads control_module, equipment_module, unit from the row", () => {
    const csv =
      "tag,description,signal_type,io_address,control_module,equipment_module,unit\n" +
      "CV01_M1_CMD,Run,DO,%Q0.0,M1,Conveyor CV01,Infeed";
    const wb = XLSX.read(csv, { type: "string" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const { mapping, headerRow } = detectColumns(sheet);
    const rows = extractRows(sheet, mapping, headerRow);
    expect(rows[0].control_module).toBe("M1");
    expect(rows[0].equipment_module).toBe("Conveyor CV01");
    expect(rows[0].unit).toBe("Infeed");
  });

  it("reads an explicit is_safety column into is_safety_raw", () => {
    const csv =
      "tag,signal_type,is_safety\n" +
      "ES1_HEALTHY,DI,TRUE";
    const wb = XLSX.read(csv, { type: "string" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const { mapping, headerRow } = detectColumns(sheet);
    expect(mapping.is_safety).not.toBeNull();
    const rows = extractRows(sheet, mapping, headerRow);
    // XLSX may coerce "TRUE" to a boolean; the parser lowercases before comparing.
    expect(String(rows[0].is_safety_raw).toLowerCase()).toBe("true");
  });
});

describe("pickRegisterSheetName", () => {
  it("prefers a sheet named Register", () => {
    expect(pickRegisterSheetName(["Instructions", "Register"])).toBe("Register");
  });
  it("falls back to the first non-Instructions sheet", () => {
    expect(pickRegisterSheetName(["Instructions", "Data"])).toBe("Data");
  });
  it("uses the only sheet when there is one", () => {
    expect(pickRegisterSheetName(["Sheet1"])).toBe("Sheet1");
  });
});

describe("groupSubsystems — unit summary", () => {
  it("groups by unit (no UNGROUPED when unit is present)", () => {
    const tags: InstrumentTag[] = [
      tag("M1_CMD", "Infeed", "Conveyor CV01", "M1"),
      tag("M1_FB", "Infeed", "Conveyor CV01", "M1"),
      tag("PE1", "Infeed", "Conveyor CV01", "PE1"),
    ];
    const g = groupSubsystems(tags);
    expect(g).toHaveLength(1);
    expect(g[0].unit_name).toBe("Infeed");
    expect(g.some((s) => s.unit_name === "UNGROUPED")).toBe(false);
  });
});
