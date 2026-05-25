import { describe, expect, it } from "vitest";
import {
  PACKML_STATES,
  packmlByName,
  packmlById,
  isPackmlId,
} from "../packml-canonical";

describe("packml-canonical", () => {
  it("exposes all 17 PackML states", () => {
    expect(PACKML_STATES).toHaveLength(17);
    const ids = PACKML_STATES.map((s) => s.packml_id);
    expect(new Set(ids).size).toBe(17);
    expect(Math.min(...ids)).toBe(1);
    expect(Math.max(...ids)).toBe(17);
  });

  it("includes the canonical Execute state at id 6", () => {
    expect(packmlById(6)?.name).toBe("Execute");
  });

  it("looks up by name case-insensitively", () => {
    expect(packmlByName("execute")?.packml_id).toBe(6);
    expect(packmlByName("EXECUTE")?.packml_id).toBe(6);
    expect(packmlByName("Execute")?.packml_id).toBe(6);
  });

  it("returns undefined for unknown names", () => {
    expect(packmlByName("Frobnicate")).toBeUndefined();
  });

  it("isPackmlId recognises 1..17 only", () => {
    expect(isPackmlId(1)).toBe(true);
    expect(isPackmlId(17)).toBe(true);
    expect(isPackmlId(0)).toBe(false);
    expect(isPackmlId(18)).toBe(false);
    expect(isPackmlId(101)).toBe(false);
  });
});
