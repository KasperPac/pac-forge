// src/lib/spec-builder/__tests__/io-addressing-apply.test.ts
//
// Adapter between the legacy confirmed_units shape and the addressing engine
// (G0-18). The collector must select exactly the signals deriveIoTags turns
// into TIA tags — see Docs/superpowers/specs/2026-07-25-io-readdress-design.md
import { describe, expect, it } from "vitest";
import {
  collectAddressableSignals,
  applyIoAddresses,
  applyRegisterAddresses,
} from "../io-addressing-apply";
import type { InstrumentTag, IoSignal, UnitConfig } from "@/types/spec-builder";

/** One unit → one EM → one CM per signal group, so tests read as data. */
function units(
  groups: Array<{ signals: Partial<IoSignal>[]; excluded?: boolean }>,
): UnitConfig[] {
  return groups.map((g, i) => ({
    unit_id: `U${i}`,
    unit_name: `Unit ${i}`,
    equipment_type: "Other",
    description: "",
    excluded: g.excluded ?? false,
    equipment_modules: [
      {
        equipment_module_id: `EM${i}`,
        equipment_module_name: `EM ${i}`,
        description: "",
        control_modules: [
          {
            control_module_id: `CM${i}`,
            control_module_name: `CM ${i}`,
            control_module_class: "other",
            description: "",
            is_safety: false,
            io_signals: g.signals.map((s) => ({
              tag: "",
              signal_type: "DI",
              io_address: "",
              description: "",
              ...s,
            })) as IoSignal[],
          },
        ],
      },
    ],
  })) as UnitConfig[];
}

describe("collectAddressableSignals", () => {
  it("collects wired signals in hierarchy order", () => {
    const result = collectAddressableSignals(
      units([
        {
          signals: [
            { tag: "A", signal_type: "DI", io_address: "%I0.0" },
            { tag: "B", signal_type: "DO" },
          ],
        },
      ]),
    );
    expect(result).toEqual([
      { tag: "A", signal_type: "DI", io_address: "%I0.0" },
      { tag: "B", signal_type: "DO", io_address: "" },
    ]);
  });

  it("skips excluded units", () => {
    const result = collectAddressableSignals(
      units([
        { signals: [{ tag: "A", signal_type: "DI" }] },
        { signals: [{ tag: "B", signal_type: "DI" }], excluded: true },
      ]),
    );
    expect(result.map((s) => s.tag)).toEqual(["A"]);
  });

  it("skips network telegram signals — they are addressed through the drive path", () => {
    const result = collectAddressableSignals(
      units([
        {
          signals: [
            { tag: "A", signal_type: "DI" },
            { tag: "B", signal_type: "DI", source: "network_telegram" },
          ],
        },
      ]),
    );
    expect(result.map((s) => s.tag)).toEqual(["A"]);
  });

  it("skips blank placeholder rows", () => {
    const result = collectAddressableSignals(
      units([{ signals: [{ tag: "  ", signal_type: "DI" }, { tag: "A", signal_type: "DI" }] }]),
    );
    expect(result.map((s) => s.tag)).toEqual(["A"]);
  });

  it("skips signal types with no physical channel", () => {
    const result = collectAddressableSignals(
      units([
        {
          signals: [
            { tag: "A", signal_type: "internal" },
            { tag: "B", signal_type: "" },
            { tag: "C", signal_type: "DI" },
          ],
        },
      ]),
    );
    expect(result.map((s) => s.tag)).toEqual(["C"]);
  });

  it("normalises Siemens dialect to IEC classes", () => {
    const result = collectAddressableSignals(
      units([{ signals: [{ tag: "A", signal_type: "DQ" }, { tag: "B", signal_type: "aq" }] }]),
    );
    expect(result.map((s) => s.signal_type)).toEqual(["DO", "AO"]);
  });

  it("allocates one channel for a duplicated tag, first occurrence winning", () => {
    const result = collectAddressableSignals(
      units([
        { signals: [{ tag: "A", signal_type: "DI", io_address: "%I0.0" }] },
        { signals: [{ tag: "A", signal_type: "DI", io_address: "%I9.9" }] },
      ]),
    );
    expect(result).toEqual([{ tag: "A", signal_type: "DI", io_address: "%I0.0" }]);
  });
});

const assign = (tag: string, to: string, from: string | null = null) =>
  ({ tag, signal_type: "DI" as const, from, to, changed: from !== to });

describe("applyIoAddresses", () => {
  it("writes the assigned address onto the matching signal", () => {
    const before = units([{ signals: [{ tag: "A", signal_type: "DI", io_address: "%I9.9" }] }]);
    const after = applyIoAddresses(before, [assign("A", "%I0.0", "%I9.9")]);
    expect(after[0].equipment_modules[0].control_modules[0].io_signals[0].io_address).toBe("%I0.0");
  });

  it("leaves signals with no assignment untouched", () => {
    const before = units([{ signals: [{ tag: "A", signal_type: "DI", io_address: "%I9.9" }] }]);
    const after = applyIoAddresses(before, [assign("B", "%I0.0")]);
    expect(after[0].equipment_modules[0].control_modules[0].io_signals[0].io_address).toBe("%I9.9");
  });

  it("rewrites every occurrence of a duplicated tag", () => {
    const before = units([
      { signals: [{ tag: "A", signal_type: "DI", io_address: "%I9.9" }] },
      { signals: [{ tag: "A", signal_type: "DI", io_address: "%I8.8" }] },
    ]);
    const after = applyIoAddresses(before, [assign("A", "%I0.0")]);
    expect(after[0].equipment_modules[0].control_modules[0].io_signals[0].io_address).toBe("%I0.0");
    expect(after[1].equipment_modules[0].control_modules[0].io_signals[0].io_address).toBe("%I0.0");
  });

  it("does not mutate the input", () => {
    const before = units([{ signals: [{ tag: "A", signal_type: "DI", io_address: "%I9.9" }] }]);
    applyIoAddresses(before, [assign("A", "%I0.0")]);
    expect(before[0].equipment_modules[0].control_modules[0].io_signals[0].io_address).toBe("%I9.9");
  });

  it("returns the input unchanged when there are no assignments", () => {
    const before = units([{ signals: [{ tag: "A", signal_type: "DI" }] }]);
    expect(applyIoAddresses(before, [])).toBe(before);
  });
});

describe("applyRegisterAddresses", () => {
  const tag = (t: string, io_address: string) => ({ tag: t, io_address }) as InstrumentTag;

  it("rewrites matching register tags and leaves the rest alone", () => {
    const before = [tag("A", "%I9.9"), tag("B", "%I8.8")];
    const after = applyRegisterAddresses(before, [assign("A", "%I0.0", "%I9.9")]);
    expect(after[0].io_address).toBe("%I0.0");
    expect(after[1]).toBe(before[1]);
  });

  it("does not mutate the input", () => {
    const before = [tag("A", "%I9.9")];
    applyRegisterAddresses(before, [assign("A", "%I0.0")]);
    expect(before[0].io_address).toBe("%I9.9");
  });
});
