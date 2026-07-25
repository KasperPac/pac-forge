// src/lib/spec-builder/__tests__/io-addressing.test.ts
//
// Spec-follows-hardware IO addressing (G0-18). The declared rack is the source
// of truth; every wired signal is re-addressed onto it deterministically.
import { describe, expect, it } from "vitest";
import { planIoAddressing, moduleByteLength, type AddressableSignal } from "../io-addressing";
import type { HardwareModelV1 } from "@/types/spec-contract-v2";

const hw = (modules: HardwareModelV1["racks"][number]["modules"]): HardwareModelV1 => ({
  platform: "SIEMENS_TIA",
  cpu: { cpu_type: "CPU 1511-1 PN" },
  racks: [{ rack: 0, modules }],
});

const sig = (tag: string, signal_type: AddressableSignal["signal_type"], io_address?: string) =>
  ({ tag, signal_type, io_address }) as AddressableSignal;

describe("moduleByteLength", () => {
  it("gives digital cards one byte per 8 channels and analog two bytes per channel", () => {
    expect(moduleByteLength("DI", 16)).toBe(2);
    expect(moduleByteLength("DI", 8)).toBe(1);
    expect(moduleByteLength("DO", 32)).toBe(4);
    expect(moduleByteLength("AI", 8)).toBe(16);
    expect(moduleByteLength("AO", 4)).toBe(8);
  });
});

describe("planIoAddressing", () => {
  it("lays modules out contiguously in slot order", () => {
    const plan = planIoAddressing(
      hw([
        { slot: 2, module_type: "DQ 16", channel_count: 16, signal_type: "DO" },
        { slot: 3, module_type: "AI 8", channel_count: 8, signal_type: "AI" },
        { slot: 4, module_type: "DI 16", channel_count: 16, signal_type: "DI" },
      ]),
      [],
    );
    expect(plan.modules).toEqual([
      { rack: 0, slot: 2, module_type: "DQ 16", signal_type: "DO", start_address: 0, length: 2 },
      { rack: 0, slot: 3, module_type: "AI 8", signal_type: "AI", start_address: 0, length: 16 },
      { rack: 0, slot: 4, module_type: "DI 16", signal_type: "DI", start_address: 16, length: 2 },
    ]);
  });

  it("shares one input space between digital and analog input cards", () => {
    // The AI card consumes input bytes 0-15, so the DI card must start at 16 —
    // this is the bug that %I/%IW being separate counters would produce.
    const plan = planIoAddressing(
      hw([
        { slot: 2, module_type: "AI 8", channel_count: 8, signal_type: "AI" },
        { slot: 3, module_type: "DI 16", channel_count: 16, signal_type: "DI" },
      ]),
      [sig("LT", "AI"), sig("PB", "DI")],
    );
    expect(plan.assignments.find((a) => a.tag === "LT")!.to).toBe("%IW0");
    expect(plan.assignments.find((a) => a.tag === "PB")!.to).toBe("%I16.0");
  });

  it("keeps input and output spaces independent", () => {
    const plan = planIoAddressing(
      hw([
        { slot: 2, module_type: "DI 16", channel_count: 16, signal_type: "DI" },
        { slot: 3, module_type: "DQ 16", channel_count: 16, signal_type: "DO" },
      ]),
      [sig("IN", "DI"), sig("OUT", "DO")],
    );
    // Both start at byte 0 — different spaces.
    expect(plan.assignments.find((a) => a.tag === "IN")!.to).toBe("%I0.0");
    expect(plan.assignments.find((a) => a.tag === "OUT")!.to).toBe("%Q0.0");
  });

  it("walks bits then bytes within a digital card", () => {
    const plan = planIoAddressing(
      hw([{ slot: 2, module_type: "DI 16", channel_count: 16, signal_type: "DI" }]),
      Array.from({ length: 10 }, (_, i) => sig(`D${i}`, "DI")),
    );
    expect(plan.assignments.map((a) => a.to)).toEqual([
      "%I0.0", "%I0.1", "%I0.2", "%I0.3", "%I0.4", "%I0.5", "%I0.6", "%I0.7",
      "%I1.0", "%I1.1", // rolls into the second byte
    ]);
  });

  it("steps analog channels by one word", () => {
    const plan = planIoAddressing(
      hw([{ slot: 2, module_type: "AI 8", channel_count: 8, signal_type: "AI" }]),
      [sig("A0", "AI"), sig("A1", "AI"), sig("A2", "AI")],
    );
    expect(plan.assignments.map((a) => a.to)).toEqual(["%IW0", "%IW2", "%IW4"]);
  });

  it("spills onto a second card of the same class", () => {
    const plan = planIoAddressing(
      hw([
        { slot: 2, module_type: "DI 8", channel_count: 8, signal_type: "DI" },
        { slot: 3, module_type: "DI 8", channel_count: 8, signal_type: "DI" },
      ]),
      Array.from({ length: 9 }, (_, i) => sig(`D${i}`, "DI")),
    );
    expect(plan.assignments[7].to).toBe("%I0.7"); // last channel of card 1
    expect(plan.assignments[8].to).toBe("%I1.0"); // first channel of card 2
  });

  it("marks which signals actually move, so a diff can be previewed", () => {
    const plan = planIoAddressing(
      hw([{ slot: 2, module_type: "DI 16", channel_count: 16, signal_type: "DI" }]),
      [sig("KEEP", "DI", "%I0.0"), sig("MOVE", "DI", "%I16.1")],
    );
    expect(plan.assignments[0]).toMatchObject({ from: "%I0.0", to: "%I0.0", changed: false });
    expect(plan.assignments[1]).toMatchObject({ from: "%I16.1", to: "%I0.1", changed: true });
  });

  it("warns rather than silently dropping signals with no channel left", () => {
    const plan = planIoAddressing(
      hw([{ slot: 2, module_type: "DI 8", channel_count: 8, signal_type: "DI" }]),
      Array.from({ length: 9 }, (_, i) => sig(`D${i}`, "DI")),
    );
    expect(plan.assignments).toHaveLength(8);
    expect(plan.warnings.some((w) => w.includes("D8") && w.includes("no DI channel left"))).toBe(true);
  });

  it("warns on a module with no channel count instead of mis-addressing the rack", () => {
    const plan = planIoAddressing(
      hw([
        { slot: 2, module_type: "DI ?", signal_type: "DI" },
        { slot: 3, module_type: "DI 16", channel_count: 16, signal_type: "DI" },
      ]),
      [sig("D0", "DI")],
    );
    expect(plan.warnings.some((w) => w.includes("no channel count"))).toBe(true);
    // the usable card still starts at 0 — the unusable one consumed nothing
    expect(plan.assignments[0].to).toBe("%I0.0");
  });

  it("returns an empty plan with no hardware", () => {
    expect(planIoAddressing(null, [sig("D0", "DI")])).toEqual({
      modules: [], assignments: [], warnings: [],
    });
  });
});
