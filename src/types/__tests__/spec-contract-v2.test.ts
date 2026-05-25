import { describe, expect, it } from "vitest";
import { OperatorModeSchema } from "../spec-contract-v2";

describe("OperatorModeSchema", () => {
  it("accepts a valid default mode", () => {
    const mode = {
      mode_id: "auto",
      name: "Auto",
      description: "Fully automatic",
      is_default: true,
    };
    expect(() => OperatorModeSchema.parse(mode)).not.toThrow();
  });

  it("accepts a non-default mode without description", () => {
    const mode = { mode_id: "manual", name: "Manual", is_default: false };
    expect(() => OperatorModeSchema.parse(mode)).not.toThrow();
  });

  it("rejects empty mode_id", () => {
    const mode = { mode_id: "", name: "X", is_default: true };
    expect(() => OperatorModeSchema.parse(mode)).toThrow();
  });

  it("rejects missing is_default", () => {
    const mode = { mode_id: "auto", name: "Auto" };
    expect(() => OperatorModeSchema.parse(mode)).toThrow();
  });
});
