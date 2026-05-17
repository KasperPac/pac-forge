import { describe, it, expect } from "vitest";
import {
  nextQuoteNumber,
  nextRevNumber,
  nextDocNumber,
} from "@/lib/quote-numbering";

describe("nextQuoteNumber", () => {
  it("starts at Q01 when empty", () => {
    expect(nextQuoteNumber([], "CVL-2129")).toBe("CVL-2129-Q01");
  });

  it("increments past the highest", () => {
    expect(
      nextQuoteNumber(["CVL-2129-Q01", "CVL-2129-Q03"], "CVL-2129")
    ).toBe("CVL-2129-Q04");
  });

  it("ignores numbers for other jobs", () => {
    expect(nextQuoteNumber(["OTHER-1-Q09"], "CVL-2129")).toBe("CVL-2129-Q01");
  });

  it("zero-pads single digits", () => {
    expect(nextQuoteNumber(["CVL-2129-Q08"], "CVL-2129")).toBe("CVL-2129-Q09");
  });

  it("preserves a two-digit max without extra padding", () => {
    expect(nextQuoteNumber(["CVL-2129-Q12"], "CVL-2129")).toBe("CVL-2129-Q13");
  });

  it("ignores malformed entries with matching prefix", () => {
    expect(
      nextQuoteNumber(["CVL-2129-Q01", "CVL-2129-Qxyz"], "CVL-2129")
    ).toBe("CVL-2129-Q02");
  });
});

describe("nextRevNumber", () => {
  it("returns 1 when empty", () => {
    expect(nextRevNumber([])).toBe(1);
  });

  it("returns max+1 of mixed order", () => {
    expect(nextRevNumber([1, 3, 2])).toBe(4);
  });

  it("handles gappy sequences", () => {
    expect(nextRevNumber([1, 5])).toBe(6);
  });
});

describe("nextDocNumber", () => {
  it("returns 1 when empty", () => {
    expect(nextDocNumber([])).toBe(1);
  });

  it("returns max+1", () => {
    expect(nextDocNumber([5, 8, 2])).toBe(9);
  });
});
