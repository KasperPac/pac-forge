/**
 * S7-300/400 → S7-1500 CPU mapping table.
 * Source: Siemens Entry ID 109478811, Tables 7-1 and 7-2.
 *
 * Order numbers are for TIA Portal V18 (suffix /V2.x or /V1.x).
 * If provision-project fails with a version mismatch, the user can
 * override with the exact order number from the TIA Portal hardware catalog.
 */

export interface CpuTarget {
  cpuName: string;
  /** Without "OrderNumber:" prefix — bridge adds it */
  orderNumber: string;
}

export interface CpuMappingEntry {
  /** Pattern to match against the source TypeIdentifier or family string */
  sourcePattern: RegExp;
  /** Human-readable source name */
  sourceName: string;
  /** Recommended S7-1500 targets, best match first */
  targets: CpuTarget[];
}

/**
 * Ordered list of source→target mappings.
 * TypeIdentifier from TIA Openness looks like: "OrderNumber:6ES7 317-2EK14-0AB0/V3.3"
 * We match on the article number prefix (e.g. "6ES7 317").
 */
export const CPU_MAPPINGS: CpuMappingEntry[] = [
  // --- S7-300 ---
  {
    sourcePattern: /6ES7\s*31[23]-/i,
    sourceName: "CPU 312 / 313",
    targets: [
      { cpuName: "CPU 1511-1 PN", orderNumber: "6ES7 511-1AK02-0AB0/V2.1" },
    ],
  },
  {
    sourcePattern: /6ES7\s*313C/i,
    sourceName: "CPU 313C / 313C-2",
    targets: [
      { cpuName: "CPU 1511C-1 PN", orderNumber: "6ES7 511-1CK01-0AB0/V2.0" },
      { cpuName: "CPU 1511-1 PN", orderNumber: "6ES7 511-1AK02-0AB0/V2.1" },
    ],
  },
  {
    sourcePattern: /6ES7\s*314C/i,
    sourceName: "CPU 314C",
    targets: [
      { cpuName: "CPU 1512C-1 PN", orderNumber: "6ES7 512-1CK01-0AB0/V2.0" },
      { cpuName: "CPU 1511-1 PN", orderNumber: "6ES7 511-1AK02-0AB0/V2.1" },
    ],
  },
  {
    sourcePattern: /6ES7\s*314/i,
    sourceName: "CPU 314",
    targets: [
      { cpuName: "CPU 1511-1 PN", orderNumber: "6ES7 511-1AK02-0AB0/V2.1" },
      { cpuName: "CPU 1512C-1 PN", orderNumber: "6ES7 512-1CK01-0AB0/V2.0" },
    ],
  },
  {
    sourcePattern: /6ES7\s*31[56]F/i,
    sourceName: "CPU 315F / 317F (F-CPU)",
    targets: [
      { cpuName: "CPU 1513F-1 PN", orderNumber: "6ES7 513-1FL02-0AB0/V2.1" },
      { cpuName: "CPU 1515F-2 PN", orderNumber: "6ES7 515-2FM02-0AB0/V2.1" },
      { cpuName: "CPU 1516F-3 PN/DP", orderNumber: "6ES7 516-3FN02-0AB0/V2.9" },
    ],
  },
  {
    sourcePattern: /6ES7\s*315/i,
    sourceName: "CPU 315-2 DP/PN",
    targets: [
      { cpuName: "CPU 1513-1 PN", orderNumber: "6ES7 513-1AL02-0AB0/V2.1" },
      { cpuName: "CPU 1515-2 PN", orderNumber: "6ES7 515-2AM02-0AB0/V2.1" },
    ],
  },
  {
    sourcePattern: /6ES7\s*317/i,
    sourceName: "CPU 317-2",
    targets: [
      { cpuName: "CPU 1516-3 PN/DP", orderNumber: "6ES7 516-3AN02-0AB0/V2.9" },
    ],
  },
  {
    sourcePattern: /6ES7\s*319/i,
    sourceName: "CPU 319-3 PN/DP",
    targets: [
      { cpuName: "CPU 1517-3 PN/DP", orderNumber: "6ES7 517-3AP00-0AB0/V2.1" },
    ],
  },
  // --- S7-400 ---
  {
    sourcePattern: /6ES7\s*41[24]F/i,
    sourceName: "CPU 414F / CPU 412F (F-CPU)",
    targets: [
      { cpuName: "CPU 1515F-2 PN", orderNumber: "6ES7 515-2FM02-0AB0/V2.1" },
      { cpuName: "CPU 1518F-4 PN/DP", orderNumber: "6ES7 518-4FP00-0AB0/V2.6" },
    ],
  },
  {
    sourcePattern: /6ES7\s*412/i,
    sourceName: "CPU 412",
    targets: [
      { cpuName: "CPU 1513-1 PN", orderNumber: "6ES7 513-1AL02-0AB0/V2.1" },
    ],
  },
  {
    sourcePattern: /6ES7\s*414/i,
    sourceName: "CPU 414-2/3",
    targets: [
      { cpuName: "CPU 1515-2 PN", orderNumber: "6ES7 515-2AM02-0AB0/V2.1" },
      { cpuName: "CPU 1516-3 PN/DP", orderNumber: "6ES7 516-3AN02-0AB0/V2.9" },
    ],
  },
  {
    sourcePattern: /6ES7\s*416F/i,
    sourceName: "CPU 416F (F-CPU)",
    targets: [
      { cpuName: "CPU 1518F-4 PN/DP", orderNumber: "6ES7 518-4FP00-0AB0/V2.6" },
    ],
  },
  {
    sourcePattern: /6ES7\s*416/i,
    sourceName: "CPU 416-2/3",
    targets: [
      { cpuName: "CPU 1518-4 PN/DP", orderNumber: "6ES7 518-4AP00-0AB0/V2.6" },
    ],
  },
  {
    sourcePattern: /6ES7\s*417/i,
    sourceName: "CPU 417-4",
    targets: [
      { cpuName: "CPU 1518-4 PN/DP", orderNumber: "6ES7 518-4AP00-0AB0/V2.6" },
    ],
  },
];

/** Full list of all S7-1500 targets (for the "Other" fallback dropdown) */
export const ALL_S7_1500_TARGETS: CpuTarget[] = [
  { cpuName: "CPU 1511-1 PN",      orderNumber: "6ES7 511-1AK02-0AB0/V2.1" },
  { cpuName: "CPU 1511C-1 PN",     orderNumber: "6ES7 511-1CK01-0AB0/V2.0" },
  { cpuName: "CPU 1512C-1 PN",     orderNumber: "6ES7 512-1CK01-0AB0/V2.0" },
  { cpuName: "CPU 1513-1 PN",      orderNumber: "6ES7 513-1AL02-0AB0/V2.1" },
  { cpuName: "CPU 1513F-1 PN",     orderNumber: "6ES7 513-1FL02-0AB0/V2.1" },
  { cpuName: "CPU 1515-2 PN",      orderNumber: "6ES7 515-2AM02-0AB0/V2.1" },
  { cpuName: "CPU 1515F-2 PN",     orderNumber: "6ES7 515-2FM02-0AB0/V2.1" },
  { cpuName: "CPU 1516-3 PN/DP",   orderNumber: "6ES7 516-3AN02-0AB0/V2.9" },
  { cpuName: "CPU 1516F-3 PN/DP",  orderNumber: "6ES7 516-3FN02-0AB0/V2.9" },
  { cpuName: "CPU 1517-3 PN/DP",   orderNumber: "6ES7 517-3AP00-0AB0/V2.1" },
  { cpuName: "CPU 1518-4 PN/DP",   orderNumber: "6ES7 518-4AP00-0AB0/V2.6" },
  { cpuName: "CPU 1518F-4 PN/DP",  orderNumber: "6ES7 518-4FP00-0AB0/V2.6" },
];

/**
 * Detect source CPU family from the device family string or TypeIdentifier.
 * Returns "S7-300", "S7-400", "S7-1500", or null.
 */
export function detectSourceFamily(sourcePlcFamily?: string | null, sourceCpuTypeId?: string | null): string | null {
  const combined = `${sourcePlcFamily ?? ""} ${sourceCpuTypeId ?? ""}`.toUpperCase();
  if (combined.includes("300") || combined.includes("6ES7 3")) return "S7-300";
  if (combined.includes("400") || combined.includes("6ES7 4")) return "S7-400";
  if (combined.includes("1500") || combined.includes("6ES7 5")) return "S7-1500";
  return null;
}

/**
 * Get recommended S7-1500 targets for the given source CPU TypeIdentifier.
 * Falls back to a safe default if no match found.
 */
export function getRecommendedTargets(sourceCpuTypeId?: string | null): { matched: boolean; sourceName: string; targets: CpuTarget[] } {
  if (sourceCpuTypeId) {
    for (const mapping of CPU_MAPPINGS) {
      if (mapping.sourcePattern.test(sourceCpuTypeId)) {
        return { matched: true, sourceName: mapping.sourceName, targets: mapping.targets };
      }
    }
  }
  // No match — default to 1516 as safe mid-range choice
  return {
    matched: false,
    sourceName: "Unknown",
    targets: [{ cpuName: "CPU 1516-3 PN/DP", orderNumber: "6ES7 516-3AN02-0AB0/V2.9" }],
  };
}
