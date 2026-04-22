/**
 * Deterministic FB / FC / DB / UDT interface extractor for SCL (and
 * STL, which carries the same `VAR_*` grammar in its text dump). LAD
 * / FBD / GRAPH blocks return empty contracts — the orchestrator
 * falls back to Openness `interface_definition` or AI for those.
 *
 * See PAC_AUDIT_DERIVED_SPEC.md §7 (deterministic-first refactor of
 * the existing Analyze step).
 */

import type { InterfaceContract } from "@/types/audit";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface VarDeclaration {
  name: string;
  /** SCL type string — e.g. `Bool`, `Int`, `TON`, `ARRAY[1..10] OF Int`,
   *  `"UDT_Motor"`, `Struct`. Retained verbatim (with quotes for UDT refs). */
  type: string;
  /** Right-hand-side of `:=`, or null if no initializer. */
  initial: string | null;
  /** Line-attached `// ...` comment (trimmed, no leading slashes), or ''. */
  comment: string;
}

export interface ParsedVarBlocks {
  input: VarDeclaration[];
  output: VarDeclaration[];
  in_out: VarDeclaration[];
  /** `VAR` / `VAR RETAIN` — static on FB, locals on FC. */
  static: VarDeclaration[];
  temp: VarDeclaration[];
  constant: VarDeclaration[];
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

const VAR_OPEN_RE =
  /^\s*VAR(_INPUT|_OUTPUT|_IN_OUT|_TEMP|_STAT|_IN|_OUT)?(?:\s+(RETAIN|CONSTANT|NON_RETAIN|PUBLIC|PRIVATE|READ_ONLY))?\s*$/i;
const VAR_END_RE = /^\s*END_VAR\s*;?\s*$/i;

/**
 * Strip SCL comments before tokenising:
 *   • `(* ... *)` block comments (non-greedy, multi-line)
 *   • `// ...` line comments — retained as a sidecar map because they
 *     attach to declarations.
 *
 * Returns the source with block comments replaced by spaces (to preserve
 * line/column offsets) and line comments stripped. The per-line comment
 * is recovered in {@link parseDeclarationLine}.
 */
function stripBlockComments(src: string): string {
  return src.replace(/\(\*[\s\S]*?\*\)/g, (m) => m.replace(/[^\r\n]/g, " "));
}

export function parseVarBlocks(source: string): ParsedVarBlocks {
  const result: ParsedVarBlocks = {
    input: [],
    output: [],
    in_out: [],
    static: [],
    temp: [],
    constant: [],
  };
  if (!source) return result;

  const cleaned = stripBlockComments(source);
  const lines = cleaned.split(/\r?\n/);

  type Kind = keyof ParsedVarBlocks;

  let currentKind: Kind | null = null;
  // Buffer accumulates continuation lines — SCL allows a declaration to
  // span multiple lines (long types, multi-line initializers).
  let buffer = "";

  const flushBuffer = () => {
    if (!buffer.trim() || !currentKind) {
      buffer = "";
      return;
    }
    // A buffer may carry multiple declarations separated by `;`.
    for (const rawDecl of splitOnTopLevelSemicolons(buffer)) {
      const decl = parseDeclarationLine(rawDecl);
      if (decl) {
        // `A, B, C : Bool;` — expand into one decl per name.
        for (const expanded of expandMultiName(decl)) {
          result[currentKind].push(expanded);
        }
      }
    }
    buffer = "";
  };

  for (const line of lines) {
    const openMatch = line.match(VAR_OPEN_RE);
    if (openMatch) {
      flushBuffer();
      currentKind = openKindToSlot(openMatch[1], openMatch[2]);
      continue;
    }
    if (VAR_END_RE.test(line)) {
      flushBuffer();
      currentKind = null;
      continue;
    }
    if (currentKind) buffer += line + "\n";
  }
  // Defensive flush in case the last VAR block wasn't properly terminated.
  flushBuffer();

  return result;
}

function openKindToSlot(
  suffix: string | undefined,
  modifier: string | undefined,
): keyof ParsedVarBlocks {
  const s = (suffix ?? "").toUpperCase();
  const m = (modifier ?? "").toUpperCase();
  if (s === "_INPUT" || s === "_IN") return "input";
  if (s === "_OUTPUT" || s === "_OUT") return "output";
  if (s === "_IN_OUT") return "in_out";
  if (s === "_TEMP") return "temp";
  if (s === "_STAT") return "static";
  // Plain VAR — semantics depend on block type; treat `CONSTANT` specially,
  // otherwise bucket as static (correct for FB; FC callers interpret as local).
  if (m === "CONSTANT") return "constant";
  return "static";
}

/**
 * Split by `;` at brace/bracket depth 0 so we don't slice through array
 * initializers like `ARRAY[1..3] OF Int := [1, 2, 3]` or struct defaults.
 */
function splitOnTopLevelSemicolons(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "'" && s[i - 1] !== "$") inStr = !inStr;
    if (inStr) continue;
    if (ch === "[" || ch === "(") depth++;
    else if (ch === "]" || ch === ")") depth--;
    else if (ch === ";" && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  const tail = s.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

const DECL_RE =
  // name(s)  [{attrs}]  [AT addr]  :  type  [:= init]     [// comment]
  /^\s*([A-Za-z_][\w,\s]*?)\s*(?:\{[^}]*\})?\s*(?:AT\s+%?[A-Za-z0-9.]+\s+)?:\s*([^:=]+?)(?:\s*:=\s*([\s\S]+?))?\s*(?:\/\/(.*))?$/;

function parseDeclarationLine(raw: string): VarDeclaration | null {
  const clean = raw.replace(/\s+/g, " ").trim();
  if (!clean) return null;
  // Skip decorator lines like `{ S7_Optimized_Access := 'TRUE' }` that sit
  // before VAR blocks in some exported sources.
  if (clean.startsWith("{") && clean.endsWith("}")) return null;

  const m = clean.match(DECL_RE);
  if (!m) return null;

  const namesRaw = m[1].trim();
  const type = m[2].trim().replace(/;\s*$/, "");
  const initial = m[3] ? m[3].trim().replace(/;\s*$/, "") : null;
  const comment = m[4] ? m[4].trim() : "";

  return { name: namesRaw, type, initial, comment };
}

function expandMultiName(decl: VarDeclaration): VarDeclaration[] {
  if (!decl.name.includes(",")) return [decl];
  const names = decl.name
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean);
  return names.map((name) => ({ ...decl, name }));
}

// ---------------------------------------------------------------------------
// Interface contract builder
// ---------------------------------------------------------------------------

export type BlockKind = "FB" | "FC" | "DB" | "UDT" | "OB" | "SFB" | "SFC";

/**
 * Build the `interface_contract` shape that persists on
 * `audit_block_understanding`. Returns empty arrays when source is
 * unavailable or empty (caller decides whether to fall back to Openness
 * interface_definition or AI).
 */
export function extractInterfaceContract(
  source: string | null | undefined,
  blockType: BlockKind | string,
): InterfaceContract {
  if (!source || source.trim().length === 0) return {};
  const blocks = parseVarBlocks(source);

  const toIfaceEntry = (d: VarDeclaration) => ({
    name: d.name,
    type: d.type,
    meaning: d.comment,
  });
  const toMemberEntry = (d: VarDeclaration) => ({
    name: d.name,
    type: d.type,
    initial: d.initial,
    meaning: d.comment,
  });

  // DB / UDT — flat members (BEGIN block may carry assignments, but we
  // surface declared members + their initials, which is the primary audit
  // artefact).
  if (blockType === "DB" || blockType === "UDT") {
    const membersSource = parseStructMembers(source);
    const members = membersSource.length > 0
      ? membersSource
      : blocks.static.map(toMemberEntry);
    return members.length > 0 ? { members } : {};
  }

  // FB / FC / OB — I/O-shaped.
  const contract: InterfaceContract = {};
  if (blocks.input.length) contract.inputs = blocks.input.map(toIfaceEntry);
  if (blocks.output.length) contract.outputs = blocks.output.map(toIfaceEntry);
  if (blocks.in_out.length) contract.in_out = blocks.in_out.map(toIfaceEntry);
  return contract;
}

/**
 * UDTs / globals can be shaped as `TYPE "name" STRUCT ... END_STRUCT END_TYPE`
 * or `DATA_BLOCK "name" STRUCT ... END_STRUCT BEGIN ... END_DATA_BLOCK`.
 * Pull the members out of the top-level STRUCT when present; fall back to
 * VAR-block parsing otherwise.
 */
function parseStructMembers(
  source: string,
): Array<{ name: string; type: string; initial: string | null; meaning: string }> {
  const cleaned = stripBlockComments(source);
  const match = cleaned.match(/\bSTRUCT\b([\s\S]*?)\bEND_STRUCT\b/i);
  if (!match) return [];
  const body = match[1];
  const members: Array<{
    name: string;
    type: string;
    initial: string | null;
    meaning: string;
  }> = [];
  for (const rawDecl of splitOnTopLevelSemicolons(body)) {
    const decl = parseDeclarationLine(rawDecl);
    if (!decl) continue;
    for (const expanded of expandMultiName(decl)) {
      members.push({
        name: expanded.name,
        type: expanded.type,
        initial: expanded.initial,
        meaning: expanded.comment,
      });
    }
  }
  return members;
}
