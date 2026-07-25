// src/lib/spec-builder/__tests__/hardware-catalog.test.ts
//
// Grouping raw TIA catalogue entries for the Hardware step picker (G0-17).
// Fixtures mirror real payloads observed from GET /tia/hardware-catalog.
import { describe, expect, it } from "vitest";
import { groupCatalogEntries, inferModuleShape, isStandardPart } from "../hardware-catalog";
import type { CatalogEntryDto } from "@/lib/tia-bridge-contract";

function entry(over: Partial<CatalogEntryDto>): CatalogEntryDto {
  return {
    article_number: "6ES7 521-1BH00-0AB0",
    type_name: "DI 16x24VDC HF",
    description: "",
    catalog_path: "Root\\...",
    type_identifier: "OrderNumber:6ES7 521-1BH00-0AB0/V1.0",
    version: "V1.0",
    ...over,
  };
}

describe("isStandardPart", () => {
  it("treats 6ES7 as standard and SIPLUS 6AG variants as not", () => {
    expect(isStandardPart("6ES7 521-1BH00-0AB0")).toBe(true);
    expect(isStandardPart("6AG1 521-1BH00-7AB0")).toBe(false);
    expect(isStandardPart("6AG2 516-3AN02-4AB0")).toBe(false);
  });
});

describe("inferModuleShape", () => {
  it("reads channel count and signal type off a catalogue type name", () => {
    expect(inferModuleShape("DI 16x24VDC HF")).toEqual({ signal_type: "DI", channel_count: 16 });
    expect(inferModuleShape("AI 8xU/I/RTD/TC ST")).toEqual({ signal_type: "AI", channel_count: 8 });
  });

  it("maps Siemens DQ/AQ onto the FDS's IEC DO/AO", () => {
    expect(inferModuleShape("DQ 16x24VDC/0.5A ST")).toEqual({ signal_type: "DO", channel_count: 16 });
    expect(inferModuleShape("AQ 4xU/I ST")).toEqual({ signal_type: "AO", channel_count: 4 });
  });

  it("returns nothing it cannot read, leaving the fields hand-editable", () => {
    expect(inferModuleShape("CPU 1516-3 PN/DP")).toEqual({});
    expect(inferModuleShape("")).toEqual({});
  });
});

describe("groupCatalogEntries", () => {
  it("collapses one article number across firmware versions into a single product", () => {
    const products = groupCatalogEntries([
      entry({ version: "V1.0", type_identifier: "OrderNumber:6ES7 521-1BH00-0AB0/V1.0" }),
      entry({ version: "V2.2", type_identifier: "OrderNumber:6ES7 521-1BH00-0AB0/V2.2" }),
      entry({ version: "V2.1", type_identifier: "OrderNumber:6ES7 521-1BH00-0AB0/V2.1" }),
    ]);
    expect(products).toHaveLength(1);
    expect(products[0].articleNumber).toBe("6ES7 521-1BH00-0AB0");
    // newest firmware first — that's what the picker defaults to
    expect(products[0].versions.map((v) => v.version)).toEqual(["V2.2", "V2.1", "V1.0"]);
    expect(products[0].versions[0].typeIdentifier).toBe("OrderNumber:6ES7 521-1BH00-0AB0/V2.2");
  });

  it("orders firmware numerically, so V2.10 beats V2.9", () => {
    const products = groupCatalogEntries([
      entry({ version: "V2.9" }),
      entry({ version: "V2.10" }),
    ]);
    expect(products[0].versions.map((v) => v.version)).toEqual(["V2.10", "V2.9"]);
  });

  it("sorts standard parts ahead of SIPLUS variants", () => {
    const products = groupCatalogEntries([
      entry({ article_number: "6AG1 521-1BH00-7AB0", type_name: "DI 16x24VDC HF SIPLUS" }),
      entry({ article_number: "6ES7 521-1BH00-0AB0", type_name: "DI 16x24VDC HF" }),
    ]);
    expect(products.map((p) => p.articleNumber)).toEqual([
      "6ES7 521-1BH00-0AB0",
      "6AG1 521-1BH00-7AB0",
    ]);
  });

  it("drops entries with no article number — they cannot be plugged", () => {
    expect(groupCatalogEntries([entry({ article_number: "" })])).toEqual([]);
  });

  it("returns an empty list for no entries", () => {
    expect(groupCatalogEntries([])).toEqual([]);
  });
});
