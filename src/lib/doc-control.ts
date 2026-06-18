/**
 * doc-control.ts — deterministic Pac document numbering + control.
 *
 * Convention (generic): a controlled Pac document is named
 *   {ProjectNumber}-{FF}{SS}{NNN} {version}[ - description].ext
 * where FF = leading digits of the documents folder ("51 DOC" → "51"),
 * SS = leading digits of the sub-folder ("01 REFERENCE DOCS" → "01"),
 * NNN = 3-digit sequence, version e.g. "1.0".
 *
 * Nothing project-specific is hardcoded — codes come from folder names.
 */

export type DocState =
  | "conforming"
  | "non_conforming"
  | "needs_review"
  | "customer_supplied";

export interface ParsedDocNumber {
  projectNumber: string;
  folderCode: string;
  subfolderCode: string;
  seq: string;
  version: string | null;
  isPlaceholder: boolean;
}

// {prefix}-{mid}-{FF}{SS}{NNN}  e.g. SRE-2601-5101001 ; XXX-17XX-5003001
const DOC_NUMBER_RE =
  /\b([A-Za-z]{2,5})-([A-Za-z0-9]{2,4})-(\d{2})(\d{2})(\d{2,4})\b/;

const PLACEHOLDER_RE = /X{3,}/i;

/** Leading digits of a folder name, or null. */
export function folderCodeFromName(name: string): string | null {
  const m = name.match(/^\s*(\d+)/);
  return m ? m[1] : null;
}

/** A folder is vendor/customer-supplied by its name. */
export function isVendorFolderName(name: string): boolean {
  return /vendor/i.test(name);
}

/** Parse a Pac document-number token from a filename. */
export function parseDocNumber(filename: string): ParsedDocNumber | null {
  const m = filename.match(DOC_NUMBER_RE);
  if (!m) return null;
  const [, prefix, mid, folderCode, subfolderCode, rawSeq] = m;
  const projectNumber = `${prefix}-${mid}`;
  const isPlaceholder = PLACEHOLDER_RE.test(projectNumber);

  // Version: " 1.0" appearing after the token.
  const after = filename.slice((m.index ?? 0) + m[0].length);
  const vMatch = after.match(/^[\s-]*(\d+\.\d+)/);

  return {
    projectNumber,
    folderCode,
    subfolderCode,
    seq: rawSeq,
    version: vMatch ? vMatch[1] : null,
    isPlaceholder,
  };
}

export function buildDocNumber(p: {
  projectNumber: string;
  folderCode: string;
  subfolderCode: string;
  seq: string;
  version?: string | null;
}): string {
  const seq = p.seq.padStart(3, "0");
  const version = p.version ?? "1.0";
  return `${p.projectNumber}-${p.folderCode}${p.subfolderCode}${seq} ${version}`;
}

function splitExt(filename: string): { base: string; ext: string } {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0) return { base: filename, ext: "" };
  return { base: filename.slice(0, dot), ext: filename.slice(dot) };
}

/** Build a name for an un-numbered file being adopted as Pac-controlled. */
export function suggestAssignName(
  originalName: string,
  p: {
    projectNumber: string;
    folderCode: string;
    subfolderCode: string;
    seq: string;
    version?: string | null;
  },
): string {
  const { base, ext } = splitExt(originalName);
  return `${buildDocNumber(p)} - ${base}${ext}`;
}

/** Fix a file that already carries a (wrong) number token. */
function suggestFixName(
  originalName: string,
  parsed: ParsedDocNumber,
  correct: { projectNumber: string; folderCode: string; subfolderCode: string },
): string {
  const seq = parsed.seq.padStart(3, "0");
  const correctToken = `${correct.projectNumber}-${correct.folderCode}${correct.subfolderCode}${seq}`;
  return originalName.replace(DOC_NUMBER_RE, correctToken);
}

export interface ClassifyInput {
  filename: string;
  docFolderCode: string;
  subfolderCode: string | null;
  projectNumber: string;
  isVendorFolder: boolean;
  hasOverride: boolean;
}

export interface ClassifyResult {
  state: DocState;
  reasons: string[];
  suggestedName?: string;
}

export function classifyDoc(input: ClassifyInput): ClassifyResult {
  const { filename, docFolderCode, subfolderCode, projectNumber } = input;
  const parsed = parseDocNumber(filename);

  // No parseable number token.
  if (!parsed) {
    // A placeholder stub that didn't parse cleanly is still a Pac doc gone wrong.
    if (PLACEHOLDER_RE.test(filename)) {
      return {
        state: "non_conforming",
        reasons: ["malformed or placeholder document number"],
      };
    }
    if (input.isVendorFolder || input.hasOverride) {
      return { state: "customer_supplied", reasons: [] };
    }
    return { state: "needs_review", reasons: [] };
  }

  const reasons: string[] = [];
  if (parsed.isPlaceholder) {
    reasons.push(`placeholder project number "${parsed.projectNumber}"`);
  } else if (parsed.projectNumber !== projectNumber) {
    reasons.push(`project number "${parsed.projectNumber}" ≠ "${projectNumber}"`);
  }
  if (parsed.folderCode !== docFolderCode) {
    reasons.push(`folder code "${parsed.folderCode}" ≠ "${docFolderCode}"`);
  }
  if (subfolderCode !== null && parsed.subfolderCode !== subfolderCode) {
    reasons.push(`sub-folder code "${parsed.subfolderCode}" ≠ "${subfolderCode}"`);
  }
  if (parsed.seq.length !== 3) {
    reasons.push("sequence must be 3 digits");
  }

  if (reasons.length === 0) {
    return { state: "conforming", reasons: [] };
  }

  const suggestedName = suggestFixName(filename, parsed, {
    projectNumber,
    folderCode: docFolderCode,
    subfolderCode: subfolderCode ?? parsed.subfolderCode,
  });
  return { state: "non_conforming", reasons, suggestedName };
}

/** Next 3-digit sequence for a given folder + sub-folder, from existing names. */
export function nextSequence(
  filenames: string[],
  docFolderCode: string,
  subfolderCode: string,
): string {
  let max = 0;
  for (const name of filenames) {
    const p = parseDocNumber(name);
    if (!p) continue;
    if (p.folderCode !== docFolderCode || p.subfolderCode !== subfolderCode) continue;
    const n = parseInt(p.seq, 10);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return String(max + 1).padStart(3, "0");
}
