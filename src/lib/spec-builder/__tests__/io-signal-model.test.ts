import { describe, expect, it } from "vitest";
import { validateIoSignals } from "@/lib/spec-builder/io-signal-model";
import type { IoSignalV2 } from "@/types/spec-contract-v2";

function cm(io_signals: IoSignalV2[]) {
  return [
    {
      control_module_id: "00000000-0000-4000-8000-000000000001",
      control_module_name: "VSD1",
      io_signals,
    },
  ];
}

const di: IoSignalV2 = {
  tag: "CM1_Therm",
  signal_type: "DI",
  io_address: "%I1.1",
  description: "",
  source: "wired",
};
const ai: IoSignalV2 = {
  tag: "PT01",
  signal_type: "AI",
  io_address: "%IW96",
  description: "",
  source: "wired",
};

describe("validateIoSignals — kind constraints", () => {
  it("accepts a correctly annotated mixed set (no errors)", () => {
    const out = validateIoSignals(
      cm([
        { ...di, polarity: "nc", conditioning: { off_delay_ms: 5000 } },
        {
          ...ai,
          scaling: {
            raw: { min: 4, max: 20, unit: "mA" },
            eu: { min: 0, max: 10, unit: "bar" },
          },
        },
      ]),
    );
    expect(out.errors).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  it("errors on polarity on an analog signal", () => {
    const out = validateIoSignals(cm([{ ...ai, polarity: "nc" }]));
    expect(out.errors.some((e) => e.includes("polarity"))).toBe(true);
  });

  it("errors on scaling on a digital signal", () => {
    const out = validateIoSignals(
      cm([
        {
          ...di,
          scaling: {
            raw: { min: 4, max: 20, unit: "mA" },
            eu: { min: 0, max: 1, unit: "x" },
          },
        },
      ]),
    );
    expect(out.errors.some((e) => e.includes("scaling"))).toBe(true);
  });

  it("errors on conditioning on an analog signal", () => {
    const out = validateIoSignals(
      cm([{ ...ai, conditioning: { on_delay_ms: 10 } }]),
    );
    expect(out.errors.some((e) => e.includes("conditioning"))).toBe(true);
  });

  it("errors on any G0-2 field on an internal signal", () => {
    const internal: IoSignalV2 = { ...di, signal_type: "internal", polarity: "no" };
    expect(validateIoSignals(cm([internal])).errors).toHaveLength(1);
  });

  it("errors on raw.min === raw.max", () => {
    const out = validateIoSignals(
      cm([
        {
          ...ai,
          scaling: {
            raw: { min: 4, max: 4, unit: "mA" },
            eu: { min: 0, max: 10, unit: "bar" },
          },
        },
      ]),
    );
    expect(out.errors.some((e) => e.includes("raw range"))).toBe(true);
  });

  it("errors on an empty conditioning object", () => {
    const out = validateIoSignals(cm([{ ...di, conditioning: {} }]));
    expect(out.errors.some((e) => e.includes("empty"))).toBe(true);
  });

  it("warns on AI without scaling", () => {
    const out = validateIoSignals(cm([ai]));
    expect(out.errors).toEqual([]);
    expect(out.warnings.some((w) => w.includes("scaling"))).toBe(true);
  });
});
