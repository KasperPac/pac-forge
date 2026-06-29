/**
 * AI-fill region markers. A generated EM FB interleaves a deterministic
 * skeleton with AI-fillable regions delimited by stable comment markers:
 *
 *   // <ai-fill Carriage_Drive:running.1>
 *   ...region body (AI- or stub-filled)...
 *   // </ai-fill Carriage_Drive:running.1>
 *
 * The markers are the contract between the deterministic writer (em-writer)
 * and the AI fill path (use-em-generate): the AI may rewrite a body but never
 * the markers or the surrounding skeleton, so the audit backbone is
 * reproducible. Pure string helpers — no IO, no AI.
 */

/** Compose a region id from the FB SCL name and the step's fillId. */
export function regionId(sclName: string, fillId: string): string {
  return `${sclName}:${fillId}`;
}

/** Escape a region id for use inside a dynamic RegExp. */
function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Deterministic placeholder body for an unfilled region (valid SCL comment,
 *  so the FB always compiles even before any AI fill). */
export function defaultStub(prose: string, indent = ""): string {
  return `${indent}// TODO (AI-fill): ${prose}`;
}

/** Wrap a body in open/close markers at the given indent. `body` is emitted
 *  verbatim (callers pre-indent their body lines). */
export function renderRegion(id: string, body: string, indent = ""): string {
  return `${indent}// <ai-fill ${id}>\n${body}\n${indent}// </ai-fill ${id}>`;
}

/** Extract every region body keyed by id. Tolerant of `\r\n` and `\n`. */
export function parseRegions(scl: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /\/\/ <ai-fill ([^>\n]+)>\r?\n([\s\S]*?)\r?\n[ \t]*\/\/ <\/ai-fill \1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(scl)) !== null) out.set(m[1], m[2]);
  return out;
}

/** Replace exactly one region's body. Markers are preserved; an unknown id is
 *  a no-op (returns the input unchanged). */
export function replaceRegion(scl: string, id: string, body: string): string {
  const re = new RegExp(
    `(// <ai-fill ${esc(id)}>\\r?\\n)([\\s\\S]*?)(\\r?\\n[ \\t]*// <\\/ai-fill ${esc(id)}>)`,
  );
  return scl.replace(re, (_m, open: string, _old: string, close: string) => `${open}${body}${close}`);
}

/** Region ids whose bodies differ between two FB versions (present in both). */
export function regionDrift(a: string, b: string): string[] {
  const ra = parseRegions(a);
  const rb = parseRegions(b);
  const drift: string[] = [];
  for (const [id, body] of ra) if (rb.has(id) && rb.get(id) !== body) drift.push(id);
  return drift;
}
