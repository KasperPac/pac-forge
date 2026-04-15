/**
 * Pure helpers for revision label formatting.
 *
 * Display label: `{number:02}{suffix}` — e.g. "01A", "02C", "27AA".
 * - `revision_number` is an int stored in the DB (`spec_project_revisions.revision_number`).
 * - The suffix is assigned when a revision is branched from another: first
 *   submission at a given number → A, branch → B, branch-of-branch → C, ...
 *   After Z (26 branches) the suffix rolls to AA, AB, ..., ZZ.
 *
 * The SQL side uses `_format_revision_label(int, int)` in migration 066.
 * This module is the TypeScript mirror for client-side formatting when we
 * only have a bare int + letter string and need to render or increment it.
 */

/** Format a revision number + suffix index (0 = A, 1 = B, ...) into a label. */
export function formatRevisionLabel(revisionNumber: number, suffixIndex = 0): string {
  const num = Math.max(0, Math.floor(revisionNumber));
  const idx = Math.max(0, Math.floor(suffixIndex));
  return `${num.toString().padStart(2, "0")}${indexToSuffix(idx)}`;
}

/**
 * Given the current letter suffix ("A", "B", ..., "Z", "AA", "AB", ...),
 * return the next one. Used when branching from an existing revision.
 */
export function nextSuffix(currentSuffix: string): string {
  const idx = suffixToIndex(currentSuffix);
  return indexToSuffix(idx + 1);
}

/** Suffix index → letter(s). 0 → "A", 25 → "Z", 26 → "AA", 27 → "AB", 51 → "AZ", 52 → "BA". */
export function indexToSuffix(index: number): string {
  let idx = Math.max(0, Math.floor(index));
  if (idx < 26) return String.fromCharCode(65 + idx);
  // base-26 with digits A..Z mapped to 0..25. Handle up to two letters here;
  // extend if we ever outgrow 702 branches at one revision_number (unlikely).
  if (idx < 26 + 26 * 26) {
    idx -= 26;
    const hi = Math.floor(idx / 26);
    const lo = idx % 26;
    return String.fromCharCode(65 + hi) + String.fromCharCode(65 + lo);
  }
  // Fallback: repeated division. Correctly handles arbitrary lengths.
  let out = "";
  let n = idx + 1; // shift to 1-based "spreadsheet" numbering for > 702
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Letter suffix → index. "A" → 0, "Z" → 25, "AA" → 26. Empty string → 0. */
export function suffixToIndex(suffix: string): number {
  if (!suffix) return 0;
  const s = suffix.toUpperCase();
  if (s.length === 1) return s.charCodeAt(0) - 65;
  // Spreadsheet-style base-26: "AA" = 26, "AB" = 27.
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    n = n * 26 + (s.charCodeAt(i) - 64); // A=1 for this accumulator
  }
  return n - 1;
}

/** Parse a label like "01B" into `{ number, suffix }`. Returns null on bad input. */
export function parseRevisionLabel(
  label: string,
): { number: number; suffix: string } | null {
  const m = /^(\d{1,6})([A-Z]+)$/i.exec(label.trim());
  if (!m) return null;
  return { number: Number(m[1]), suffix: m[2].toUpperCase() };
}
