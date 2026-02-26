/**
 * Shared utilities for splitting documents into sections by headings.
 * Used by knowledge distribution and reference library systems.
 */

export interface DocSection {
  index: number;
  heading: string;
  content: string;
}

/** Minimum document size before paragraph-fallback splitting kicks in. */
const LARGE_DOC_THRESHOLD = 80_000;

export function isHeadingLine(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  // Markdown headings: # ## ### ####
  if (/^#{1,4}\s/.test(t)) return true;
  // Numbered headings: 1.1 Introduction, 2.3.4 Details
  if (/^\d+(\.\d+)+\s/.test(t)) return true;
  // ALL-CAPS lines (4-120 chars) as section headers
  if (t.length >= 4 && t.length < 120 && t === t.toUpperCase() && /[A-Z]/.test(t)) return true;
  return false;
}

export function splitIntoSections(content: string): DocSection[] {
  const lines = content.split("\n");
  const sections: DocSection[] = [];
  let heading = "Introduction";
  let buf: string[] = [];
  let idx = 0;

  function flush() {
    const text = buf.join("\n").trim();
    if (text) {
      sections.push({ index: idx++, heading, content: text });
    }
    buf = [];
  }

  for (const line of lines) {
    if (isHeadingLine(line) && buf.length > 0) {
      flush();
      heading = line.trim().replace(/^#+\s*/, "");
    } else {
      buf.push(line);
    }
  }
  flush();

  // Fallback: if only 1 section and document is large, split by paragraphs
  if (sections.length <= 1 && content.length > LARGE_DOC_THRESHOLD) {
    const paras = content.split(/\n\s*\n/).filter((p) => p.trim());
    return paras.map((p, i) => ({
      index: i,
      heading: `Section ${i + 1}`,
      content: p.trim(),
    }));
  }

  return sections;
}
