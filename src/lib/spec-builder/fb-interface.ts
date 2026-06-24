// src/lib/spec-builder/fb-interface.ts
// THE single SCL var parser for the whole app. Replaces the three ad-hoc regex
// parsers (fb-library parseVarsFromScl, forge-device-matcher parseInterface,
// fb-flow-diagram parseVarSections). Returns a SUPERSET of all sections so the
// flow diagram (which traces static/temp intermediates) does not regress.

export type SclVarSection = "input" | "output" | "inout" | "static" | "temp";

export interface ParsedSclVar {
  name: string;
  /** first token of the declared type (e.g. "Int" from `Int := 0`) */
  scl_type: string;
  section: SclVarSection;
  /** trailing // comment, trimmed; "" when absent */
  description: string;
}

// One declaration line: `  name : Type[ := default][ // comment]`
const DECL_RE = /^\s+(\w+)\s*:\s*([^;]+);?\s*(?:\/\/\s*(.*))?$/gm;

function pushDecls(body: string, section: SclVarSection, out: ParsedSclVar[]): void {
  DECL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DECL_RE.exec(body)) !== null) {
    const rawType = m[2].trim();
    const scl_type = rawType.match(/^["']?[\w.]+["']?/)?.[0] ?? rawType;
    out.push({ name: m[1], scl_type, section, description: m[3]?.trim() ?? "" });
  }
}

/**
 * Single-pass: match every VAR_* / VAR block in source order so the output
 * array preserves the declaration order from the SCL text.
 * Superset: input / output / inout / static / temp.
 */
export function parseFbInterface(scl: string): ParsedSclVar[] {
  const out: ParsedSclVar[] = [];

  // Match VAR_INPUT | VAR_OUTPUT | VAR_IN_OUT | VAR_TEMP | plain VAR in one pass.
  // The alternation order matters: VAR_IN_OUT must come before VAR_ catch-alls,
  // and plain \bVAR\b must be last so it never swallows the typed sections.
  const allRe =
    /\b(VAR_INPUT|VAR_OUTPUT|VAR_IN_OUT|VAR_TEMP|VAR)\b([\s\S]*?)END_VAR/gi;

  let block: RegExpExecArray | null;
  while ((block = allRe.exec(scl)) !== null) {
    const keyword = block[1].toUpperCase();
    let section: SclVarSection;
    switch (keyword) {
      case "VAR_INPUT":   section = "input";  break;
      case "VAR_OUTPUT":  section = "output"; break;
      case "VAR_IN_OUT":  section = "inout";  break;
      case "VAR_TEMP":    section = "temp";   break;
      default:            section = "static"; break;
    }
    pushDecls(block[2], section, out);
  }

  return out;
}

/** Direction-bearing pins (input/output/inout) only — the contract surface. */
export function interfacePins(vars: ParsedSclVar[]): Array<{
  name: string;
  scl_type: string;
  direction: "input" | "output" | "inout";
  description: string;
}> {
  return vars
    .filter((v) => v.section === "input" || v.section === "output" || v.section === "inout")
    .map((v) => ({
      name: v.name,
      scl_type: v.scl_type,
      direction: v.section as "input" | "output" | "inout",
      description: v.description,
    }));
}
