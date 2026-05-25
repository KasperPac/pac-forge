import { describe, expect, it } from "vitest";
import { ConfigParameterSchema, OperatorModeSchema } from "../spec-contract-v2";

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

describe("ConfigParameterSchema", () => {
  it("accepts a parameter with discrete enum values", () => {
    const param = {
      parameter_id: "battery_chemistry",
      name: "Battery chemistry",
      allowed_values: ["LFP", "NMC"],
      default: "LFP",
      description: "Cathode material selection",
    };
    expect(() => ConfigParameterSchema.parse(param)).not.toThrow();
  });

  it("rejects when default is not in allowed_values", () => {
    const param = {
      parameter_id: "x",
      name: "X",
      allowed_values: ["A", "B"],
      default: "C",
    };
    expect(() => ConfigParameterSchema.parse(param)).toThrow(/default/i);
  });

  it("rejects empty allowed_values", () => {
    const param = {
      parameter_id: "x",
      name: "X",
      allowed_values: [],
      default: "C",
    };
    expect(() => ConfigParameterSchema.parse(param)).toThrow();
  });

  it("rejects empty parameter_id", () => {
    const param = {
      parameter_id: "",
      name: "X",
      allowed_values: ["A"],
      default: "A",
    };
    expect(() => ConfigParameterSchema.parse(param)).toThrow();
  });
});
