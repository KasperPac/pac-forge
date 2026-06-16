import { describe, expect, it } from "vitest";
import { createIoAllocator, computeSubsystemBases } from "../io-allocator";

describe("createIoAllocator", () => {
  it("allocates DI addresses in %I<byte>.<bit> form starting at the unit's DI base", () => {
    const alloc = createIoAllocator({ unitIndex: 0, diBase: 0, doBase: 0, aiBase: 64, aoBase: 80 });
    expect(alloc.next("DI")).toBe("%I0.0");
    expect(alloc.next("DI")).toBe("%I0.1");
    expect(alloc.next("DI")).toBe("%I0.2");
  });

  it("rolls over from bit 7 to the next byte", () => {
    const alloc = createIoAllocator({ unitIndex: 0, diBase: 0, doBase: 0, aiBase: 64, aoBase: 80 });
    for (let i = 0; i < 8; i++) alloc.next("DI");
    expect(alloc.next("DI")).toBe("%I1.0");
  });

  it("allocates AI in %IW<word> form, incrementing by 2", () => {
    const alloc = createIoAllocator({ unitIndex: 0, diBase: 0, doBase: 0, aiBase: 64, aoBase: 80 });
    expect(alloc.next("AI")).toBe("%IW64");
    expect(alloc.next("AI")).toBe("%IW66");
  });

  it("DI/DO/AI/AO are independent counters", () => {
    const alloc = createIoAllocator({ unitIndex: 0, diBase: 0, doBase: 0, aiBase: 64, aoBase: 80 });
    expect(alloc.next("DI")).toBe("%I0.0");
    expect(alloc.next("DO")).toBe("%Q0.0");
    expect(alloc.next("AI")).toBe("%IW64");
    expect(alloc.next("AO")).toBe("%QW80");
  });

  it("two units get disjoint address spaces", () => {
    const a = createIoAllocator({ unitIndex: 0, diBase: 0, doBase: 0, aiBase: 64, aoBase: 80 });
    const b = createIoAllocator({ unitIndex: 1, diBase: 16, doBase: 16, aiBase: 128, aoBase: 144 });
    const aAddrs = new Set<string>();
    const bAddrs = new Set<string>();
    for (let i = 0; i < 8; i++) {
      aAddrs.add(a.next("DI"));
      bAddrs.add(b.next("DI"));
    }
    for (const addr of aAddrs) expect(bAddrs.has(addr)).toBe(false);
  });

  it("no address overlap across 8 units × 60 signals per kind", () => {
    const kinds: Array<"DI" | "DO" | "AI" | "AO"> = ["DI", "DO", "AI", "AO"];
    for (const kind of kinds) {
      const seen = new Set<string>();
      for (let si = 0; si < 8; si++) {
        const alloc = createIoAllocator(computeSubsystemBases(si));
        for (let n = 0; n < 60; n++) {
          const addr = alloc.next(kind);
          expect(seen.has(addr), `${kind} address ${addr} duplicated (unit ${si}, signal ${n})`).toBe(false);
          seen.add(addr);
        }
      }
    }
  });
});
