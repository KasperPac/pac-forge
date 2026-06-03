import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { detectColumns, buildHierarchyFromTags, extractRows } from "@/lib/spec-builder/instrument-parser";
import type { InstrumentTag } from "@/types/spec-builder";

describe("detectColumns — assembly alias", () => {
  it("maps an 'assembly' header to the assembly column (not subsystem)", () => {
    const csv = "tag,io_address,signal_type,description,assembly\n" +
      "M1_CMD,%Q0.0,DO,Motor 1 run,Conveyor CV01\n" +
      "M1_FB,%I0.0,DI,Motor 1 feedback,Conveyor CV01\n" +
      "M1_OL,%I0.1,DI,Motor 1 overload,Conveyor CV01";
    const wb = XLSX.read(csv, { type: "string" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;

    const { mapping } = detectColumns(sheet);

    expect(mapping.assembly).not.toBeNull();
    expect(mapping.tag).not.toBeNull();
  });
});

function tag(
  t: string,
  subsystem: string,
  assembly = "",
  device = "",
): InstrumentTag {
  return {
    tag: t,
    device_type: "",
    description: t,
    signal_type: "DI",
    io_address: "",
    device_class: "other",
    signal_direction: "DI",
    subsystem_prefix: subsystem,
    is_safety: false,
    device,
    assembly,
    subsystem,
  };
}

describe("buildHierarchyFromTags — single subsystem, column = assembly", () => {
  const tags: InstrumentTag[] = [
    tag("VSD1_ENABLE", "Carriage"),
    tag("VSD1_FWD", "Carriage"),
    tag("VSD2_ENABLE", "Rotator"),
    tag("SR1_HEALTHY", "Safety & Control"),
    tag("CARR_FWD", "Operator Interface"),
  ];

  it("returns exactly one subsystem", () => {
    const result = buildHierarchyFromTags(tags);
    expect(result).toHaveLength(1);
  });

  it("puts the register groups in as assemblies, sorted", () => {
    const result = buildHierarchyFromTags(tags);
    const assemblyNames = result[0].assemblies.map((a) => a.assembly_name);
    expect(assemblyNames).toEqual([
      "Carriage",
      "Operator Interface",
      "Rotator",
      "Safety & Control",
    ]);
  });

  it("never emits an UNGROUPED subsystem", () => {
    const result = buildHierarchyFromTags(tags);
    expect(result.some((s) => s.subsystem_name === "UNGROUPED")).toBe(false);
  });
});

describe("buildHierarchyFromTags — device grouping", () => {
  it("keeps fault + thermistor tags on ONE device", () => {
    const tags: InstrumentTag[] = [
      tag("CARR_M1_FAULT", "Carriage"),
      tag("CARR_M1_THERM", "Carriage"),
    ];
    const result = buildHierarchyFromTags(tags);
    const carriage = result[0].assemblies.find((a) => a.assembly_id === "Carriage")!;
    expect(carriage.devices).toHaveLength(1);
    expect(carriage.devices[0].io_signals).toHaveLength(2);
  });
});

describe("buildHierarchyFromTags — system name", () => {
  it("names the single subsystem from the passed systemName", () => {
    const tags: InstrumentTag[] = [tag("VSD1_ENABLE", "Carriage")];
    const result = buildHierarchyFromTags(tags, "Segment Wagon");
    expect(result[0].subsystem_name).toBe("Segment Wagon");
  });

  it("defaults the subsystem name to 'System'", () => {
    const tags: InstrumentTag[] = [tag("VSD1_ENABLE", "Carriage")];
    const result = buildHierarchyFromTags(tags);
    expect(result[0].subsystem_name).toBe("System");
  });
});

describe("detectColumns — distinct grouping columns", () => {
  function mappingFor(header: string) {
    const wb = XLSX.read(header + "\nX,Y,Z,W,D,A,S", { type: "string" });
    return detectColumns(wb.Sheets[wb.SheetNames[0]!]!).mapping;
  }

  it("maps device and device type to different columns", () => {
    const m = mappingFor("tag,description,signal_type,io_address,device,assembly,device type");
    expect(m.device).not.toBeNull();
    expect(m.device_type).not.toBeNull();
    expect(m.device).not.toBe(m.device_type);
  });

  it("maps assembly and subsystem to different columns", () => {
    const m = mappingFor("tag,subsystem,assembly,signal_type,io_address,device,description");
    expect(m.subsystem).not.toBeNull();
    expect(m.assembly).not.toBeNull();
    expect(m.subsystem).not.toBe(m.assembly);
  });
});

describe("extractRows — explicit grouping columns", () => {
  it("reads device, assembly, subsystem from the row", () => {
    const csv =
      "tag,description,signal_type,io_address,device,assembly,subsystem\n" +
      "CV01_M1_CMD,Run,DO,%Q0.0,M1,Conveyor CV01,Infeed";
    const wb = XLSX.read(csv, { type: "string" });
    const sheet = wb.Sheets[wb.SheetNames[0]!]!;
    const { mapping, headerRow } = detectColumns(sheet);
    const rows = extractRows(sheet, mapping, headerRow);
    expect(rows[0].device).toBe("M1");
    expect(rows[0].assembly).toBe("Conveyor CV01");
    expect(rows[0].subsystem).toBe("Infeed");
  });
});

describe("buildHierarchyFromTags — explicit columns", () => {
  it("template-style: one subsystem, explicit assemblies + devices", () => {
    const tags: InstrumentTag[] = [
      tag("CV01_M1_CMD", "", "Conveyor CV01", "M1"),
      tag("CV01_M1_FB", "", "Conveyor CV01", "M1"),
      tag("CV01_PE1", "", "Conveyor CV01", "PE1"),
    ];
    const result = buildHierarchyFromTags(tags, "Line A");
    expect(result).toHaveLength(1);
    expect(result[0].subsystem_name).toBe("Line A");
    const asm = result[0].assemblies;
    expect(asm).toHaveLength(1);
    expect(asm[0].assembly_name).toBe("Conveyor CV01");
    const devIds = asm[0].devices.map((d) => d.device_id).sort();
    expect(devIds).toEqual(["M1", "PE1"]);
    const m1 = asm[0].devices.find((d) => d.device_id === "M1")!;
    expect(m1.io_signals).toHaveLength(2);
  });

  it("multi-subsystem when subsystem column is filled", () => {
    const tags: InstrumentTag[] = [
      tag("A_M1_CMD", "Infeed", "Conveyor CV01", "M1"),
      tag("B_M2_CMD", "Outfeed", "Conveyor CV02", "M2"),
    ];
    const result = buildHierarchyFromTags(tags);
    expect(result.map((s) => s.subsystem_name).sort()).toEqual(["Infeed", "Outfeed"]);
    expect(result.find((s) => s.subsystem_name === "Infeed")!.subsystem_id).toBe("infeed");
  });

  it("legacy lone grouping column stays at assembly level (one subsystem)", () => {
    const tags: InstrumentTag[] = [tag("VSD1_FWD", "Carriage"), tag("VSD2_FWD", "Rotator")];
    const result = buildHierarchyFromTags(tags);
    expect(result).toHaveLength(1);
    expect(result[0].assemblies.map((a) => a.assembly_name).sort()).toEqual(["Carriage", "Rotator"]);
  });

  it("no grouping at all → one subsystem, one Unassigned assembly", () => {
    const tags: InstrumentTag[] = [tag("M1_CMD", ""), tag("M1_FB", "")];
    const result = buildHierarchyFromTags(tags);
    expect(result).toHaveLength(1);
    expect(result[0].assemblies).toHaveLength(1);
    expect(result[0].assemblies[0].assembly_name).toBe("Unassigned");
  });

  it("empty tags → empty result", () => {
    expect(buildHierarchyFromTags([])).toHaveLength(0);
  });
});
