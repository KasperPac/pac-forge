/**
 * Siemens IO address allocator. Each unit gets its own byte/word
 * base; within a unit we walk DI/DO bit-by-bit and AI/AO word-by-
 * word. Bases are computed by the caller (assemble.ts) so they're
 * disjoint across units.
 */

export type IoSignalKind = "DI" | "DO" | "AI" | "AO";

export interface IoAllocatorBases {
  unitIndex: number;
  diBase: number; // byte
  doBase: number; // byte
  aiBase: number; // word
  aoBase: number; // word
}

export interface IoAllocator {
  next(kind: IoSignalKind): string;
}

interface BitCursor {
  byte: number;
  bit: number;
}

function bumpBit(c: BitCursor): void {
  c.bit += 1;
  if (c.bit > 7) {
    c.bit = 0;
    c.byte += 1;
  }
}

export function createIoAllocator(bases: IoAllocatorBases): IoAllocator {
  const diCursor: BitCursor = { byte: bases.diBase, bit: 0 };
  const doCursor: BitCursor = { byte: bases.doBase, bit: 0 };
  let aiWord = bases.aiBase;
  let aoWord = bases.aoBase;

  return {
    next(kind) {
      switch (kind) {
        case "DI": {
          const addr = `%I${diCursor.byte}.${diCursor.bit}`;
          bumpBit(diCursor);
          return addr;
        }
        case "DO": {
          const addr = `%Q${doCursor.byte}.${doCursor.bit}`;
          bumpBit(doCursor);
          return addr;
        }
        case "AI": {
          const addr = `%IW${aiWord}`;
          aiWord += 2;
          return addr;
        }
        case "AO": {
          const addr = `%QW${aoWord}`;
          aoWord += 2;
          return addr;
        }
      }
    },
  };
}

/**
 * Compute disjoint per-unit IO bases given unit count.
 * Each unit reserves 16 bytes of DI, 16 bytes of DO, 64 words of
 * AI (128 bytes), 64 words of AO (128 bytes). The AI/AO stride covers
 * ≥60 signals per kind per unit (slider max — see spec §8.3).
 * 8 units × 128 bytes = 1024 bytes fits the default S7-1500
 * process image (1024 bytes I, 1024 bytes Q).
 */
export function computeSubsystemBases(unitIndex: number): IoAllocatorBases {
  return {
    unitIndex,
    diBase: unitIndex * 16,
    doBase: unitIndex * 16,
    aiBase: 128 + unitIndex * 128,
    aoBase: 128 + unitIndex * 128,
  };
}
