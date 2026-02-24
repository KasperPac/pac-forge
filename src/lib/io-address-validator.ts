import type { IoEntry } from "@/types";

/**
 * Valid S7-1200/1500 address formats:
 * %I0.0, %IB0, %IW0, %ID0
 * %Q0.0, %QB0, %QW0, %QD0
 * %M0.0, %MB0, %MW0, %MD0, %ML0
 * %DB1.DBX0.0, etc. (DB addressing — relaxed match)
 */
const S7_ADDRESS_RE = /^%(I|Q|M)(B|W|D|L)?(\d+)(\.\d+)?$/i;
const S7_DB_ADDRESS_RE = /^%DB\d+\.DB(X|B|W|D)\d+(\.\d+)?$/i;

export function validateAddress(address: string): { valid: boolean; error?: string } {
  if (!address) return { valid: true }; // empty is OK (not yet filled in)

  const trimmed = address.trim();
  if (S7_ADDRESS_RE.test(trimmed) || S7_DB_ADDRESS_RE.test(trimmed)) {
    return { valid: true };
  }

  return { valid: false, error: `Invalid S7 address format: "${trimmed}"` };
}

export interface IoSummary {
  inputs: number;
  outputs: number;
  markers: number;
  other: number;
  total: number;
}

export function summarizeIoEntries(entries: IoEntry[]): IoSummary {
  let inputs = 0;
  let outputs = 0;
  let markers = 0;
  let other = 0;

  for (const entry of entries) {
    const addr = entry.address.trim().toUpperCase();
    if (addr.startsWith("%I")) inputs++;
    else if (addr.startsWith("%Q")) outputs++;
    else if (addr.startsWith("%M")) markers++;
    else if (addr) other++;
  }

  return { inputs, outputs, markers, other, total: entries.length };
}
