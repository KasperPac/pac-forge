import { describe, it, expect } from "vitest";
import {
  computeLineSubtotal,
  aggregateByCategory,
  grandTotal,
} from "@/lib/quote-totals";
import type { DocLineItem } from "@/types";

function item(overrides: Partial<DocLineItem> = {}): DocLineItem {
  return {
    id: "x",
    parent_type: "quote_revision",
    parent_id: "p",
    category: "labour",
    description: "d",
    qty: null,
    unit: null,
    unit_price: null,
    hours: null,
    hour_rate: null,
    hour_rate_multiplier: "1",
    subtotal: null,
    show_in_customer_doc: true,
    customer_doc_label: null,
    ordering: 0,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

describe("computeLineSubtotal", () => {
  it("uses qty * unit_price when both present", () => {
    expect(
      computeLineSubtotal(item({ qty: "4", unit_price: "250" }))
    ).toBe(1000);
  });

  it("uses hours * hour_rate * multiplier when present", () => {
    expect(
      computeLineSubtotal(
        item({ hours: "10", hour_rate: "185", hour_rate_multiplier: "2" })
      )
    ).toBe(3700);
  });

  it("multiplier defaults to 1.0 when unparseable", () => {
    expect(
      computeLineSubtotal(
        item({
          hours: "10",
          hour_rate: "100",
          hour_rate_multiplier: "" as unknown as string,
        })
      )
    ).toBe(1000);
  });

  it("returns null when qty present without unit_price", () => {
    expect(computeLineSubtotal(item({ qty: "4" }))).toBeNull();
  });

  it("returns null when hours present without hour_rate", () => {
    expect(computeLineSubtotal(item({ hours: "10" }))).toBeNull();
  });

  it("returns null when no inputs are populated", () => {
    expect(computeLineSubtotal(item())).toBeNull();
  });

  it("prefers qty path when both qty/unit_price and hours/hour_rate are set", () => {
    expect(
      computeLineSubtotal(
        item({
          qty: "2",
          unit_price: "100",
          hours: "10",
          hour_rate: "999",
        })
      )
    ).toBe(200);
  });
});

describe("aggregateByCategory", () => {
  const items = [
    item({
      category: "labour",
      qty: "1",
      unit_price: "100",
      show_in_customer_doc: false,
    }),
    item({ category: "hardware_materials", qty: "2", unit_price: "50" }),
    item({ category: "hardware_materials", qty: "1", unit_price: "25" }),
    item({ category: "commissioning", qty: "1", unit_price: "500" }),
  ];

  it("aggregates subtotal and count per category", () => {
    const result = aggregateByCategory(items, { onlyCustomerVisible: false });
    expect(result).toEqual([
      { category: "labour", subtotal: 100, count: 1 },
      { category: "hardware_materials", subtotal: 125, count: 2 },
      { category: "commissioning", subtotal: 500, count: 1 },
    ]);
  });

  it("preserves canonical category order even when input is shuffled", () => {
    const reordered = [items[3], items[2], items[1], items[0]];
    const result = aggregateByCategory(reordered, {
      onlyCustomerVisible: false,
    });
    expect(result.map((r) => r.category)).toEqual([
      "labour",
      "hardware_materials",
      "commissioning",
    ]);
  });

  it("excludes hidden items when onlyCustomerVisible is true", () => {
    const result = aggregateByCategory(items, { onlyCustomerVisible: true });
    expect(result.find((r) => r.category === "labour")).toBeUndefined();
    expect(result.find((r) => r.category === "hardware_materials")).toEqual({
      category: "hardware_materials",
      subtotal: 125,
      count: 2,
    });
  });

  it("returns an empty array when input is empty", () => {
    expect(aggregateByCategory([], { onlyCustomerVisible: false })).toEqual([]);
  });

  it("skips items with no computable subtotal", () => {
    const result = aggregateByCategory(
      [item({ category: "labour", qty: "1" })],
      { onlyCustomerVisible: false }
    );
    expect(result).toEqual([]);
  });
});

describe("grandTotal", () => {
  it("sums every item regardless of show flag", () => {
    expect(
      grandTotal([
        item({ qty: "1", unit_price: "100", show_in_customer_doc: false }),
        item({ qty: "2", unit_price: "50" }),
      ])
    ).toBe(200);
  });

  it("returns 0 for an empty list", () => {
    expect(grandTotal([])).toBe(0);
  });

  it("ignores items without computable subtotal", () => {
    expect(grandTotal([item({ qty: "1" }), item({ qty: "2", unit_price: "50" })])).toBe(100);
  });
});
