// src/lib/spec-builder/codegen/custom-region.ts
//
// G5-4 §3 — the regen-preserved custom-logic region in FC_<Unit>_Process.
// Markers are exact-match; any mangling aborts the merge WITH a warning so
// hand code is never silently dropped.

export const CUSTOM_REGION_BEGIN = "// --- custom process logic (preserved on regen) ---";
export const CUSTOM_REGION_END = "// --- end custom ---";

/** Inner text between the markers (exclusive), or null when either marker is
 *  missing or out of order. Whitespace inside the region is preserved. */
export function extractCustomRegion(content: string): string | null {
  const b = content.indexOf(CUSTOM_REGION_BEGIN);
  const e = content.indexOf(CUSTOM_REGION_END);
  if (b === -1 || e === -1 || e <= b) return null;
  return content.slice(b + CUSTOM_REGION_BEGIN.length, e);
}

/** Replace fresh's region body with the region body extracted from previous.
 *  Any marker problem returns fresh unchanged plus a warning. */
export function mergeCustomRegion(
  fresh: string,
  previous: string | null | undefined,
): { content: string; warning?: string } {
  if (!previous) return { content: fresh };
  const body = extractCustomRegion(previous);
  if (body === null) {
    return { content: fresh, warning: "custom-region markers missing/mangled in the previous edit — region NOT carried over" };
  }
  const b = fresh.indexOf(CUSTOM_REGION_BEGIN);
  const e = fresh.indexOf(CUSTOM_REGION_END);
  if (b === -1 || e === -1 || e <= b) {
    return { content: fresh, warning: "fresh generation lacks custom-region markers — region NOT carried over" };
  }
  return { content: fresh.slice(0, b + CUSTOM_REGION_BEGIN.length) + body + fresh.slice(e) };
}
