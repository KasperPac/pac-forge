/**
 * Siemens IO address allocator. Each subsystem gets its own byte/word
 * base; within a subsystem we walk DI/DO bit-by-bit and AI/AO word-by-
 * word. Bases are computed by the caller (assemble.ts) so they're
 * disjoint across subsystems.
 */

export type IoSignalKind = "DI" | "DO" | "AI" | "AO";

export interface IoAllocatorBases {
  subsystemIndex: number;
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
 * Compute disjoint per-subsystem IO bases given subsystem count.
 * Each subsystem reserves 16 bytes of DI, 16 bytes of DO, 32 words of
 * AI (64 bytes), 32 words of AO (64 bytes). 8 subsystems × 16 bytes
 * fits comfortably inside an S7-1500's process image.
 */
export function computeSubsystemBases(subsystemIndex: number): IoAllocatorBases {
  return {
    subsystemIndex,
    diBase: subsystemIndex * 16,
    doBase: subsystemIndex * 16,
    aiBase: 64 + subsystemIndex * 64,
    aoBase: 80 + subsystemIndex * 64,
  };
}
