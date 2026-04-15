/**
 * Regex-level detectors for pac-forge sentinels embedded in a DOCX export.
 *
 * Sentinels live in the "Appendix Z — Machine-Readable Data" table and in
 * per-table captions. The detectors here work on raw extracted text — they
 * are the cheapest possible pre-filter before we commit to the expensive
 * deterministic XML parse.
 */

export interface RevisionSentinel {
  revisionId: string;
  revisionNumber: number;
  status: string;
}

/** UUID v4-ish (hex with dashes) — intentionally permissive. */
const UUID_RE = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * The top-of-document sentinel: `pac-forge:revision:{uuid}:{number}:{status}`.
 * Returns null if not found or malformed.
 */
export function parseRevisionSentinel(rawText: string): RevisionSentinel | null {
  const re = new RegExp(
    `pac-forge:revision:(${UUID_RE}):(\\d+):([a-z_]+)`,
    "i",
  );
  const m = re.exec(rawText);
  if (!m) return null;
  return {
    revisionId: m[1],
    revisionNumber: Number(m[2]),
    status: m[3],
  };
}

/** Detect the pac-forge hierarchy sentinel token anywhere in raw text. */
export function hasHierarchySentinel(rawText: string): boolean {
  return /pac-forge:hierarchy-v2/i.test(rawText);
}

/** Detect the appendix sentinel. */
export function hasAppendixSentinel(rawText: string): boolean {
  return /pac-forge:appendix-v2/i.test(rawText);
}

/** Extract the assembly state sentinel payload from a caption.
 *  Format: `Operating State: {name} (pac-forge:state:{id})`. */
export function parseStateSentinel(
  caption: string,
): { stateId: string; stateName: string } | null {
  const m = /Operating State:\s*(.+?)\s*\(pac-forge:state:([A-Za-z0-9_-]+)\)/.exec(
    caption,
  );
  if (!m) return null;
  return { stateName: m[1].trim(), stateId: m[2] };
}

/** Extract an assembly sentinel from a caption. */
export function parseAssemblySentinel(
  caption: string,
): { assemblyId: string } | null {
  const m = new RegExp(`pac-forge:assembly:(${UUID_RE})`, "i").exec(caption);
  if (!m) return null;
  return { assemblyId: m[1] };
}
