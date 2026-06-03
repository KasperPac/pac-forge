import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { detectColumns, buildHierarchyFromTags } from "@/lib/spec-builder/instrument-parser";
import type { InstrumentTag } from "@/types/spec-builder";

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

function tag(t: string, subsystem: string): InstrumentTag {
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
