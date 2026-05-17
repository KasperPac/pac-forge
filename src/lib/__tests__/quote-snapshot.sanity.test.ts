import { describe, it, expect } from "vitest";

describe("snapshot sanity thread", () => {
  it("placeholder — replaced when shared factories land in a later task", () => {
    expect(1).toBe(1);
  });
});
