export function nextQuoteNumber(existing: string[], jobCode: string): string {
  const prefix = `${jobCode}-Q`;
  const nums = existing
    .filter((n) => n.startsWith(prefix))
    .map((n) => parseInt(n.slice(prefix.length), 10))
    .filter((n) => Number.isFinite(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  return `${prefix}${String(next).padStart(2, "0")}`;
}

export function nextRevNumber(existing: number[]): number {
  return existing.length ? Math.max(...existing) + 1 : 1;
}

export function nextDocNumber(existing: number[]): number {
  return existing.length ? Math.max(...existing) + 1 : 1;
}

export function nextVariationNumber(
  existing: { variation_number: number }[],
): number {
  return existing.reduce(
    (max, v) => (v.variation_number > max ? v.variation_number : max),
    0,
  ) + 1;
}
