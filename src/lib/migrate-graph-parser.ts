/**
 * Parse Siemens SimaticML GRAPH (SFC) XML exported by TIA Portal Openness.
 *
 * GRAPH blocks in TIA Portal are already in TIA Portal GRAPH format — they do NOT
 * need to be converted to SCL. They just need to be recompiled targeting S7-1500
 * instead of S7-300 after the hardware retarget. This parser extracts the step/
 * transition structure and flags anything the engineer needs to fix before recompiling.
 */

export interface GraphStep {
  name: string;
  isInitial: boolean;
  /** Raw action statements / references */
  actions: Array<{ qualifier: string; statement: string }>;
  minTime?: string;
  maxTime?: string;
}

export interface GraphTransition {
  name: string;
  condition: string;
  interlocks: string[];
}

export interface GraphAdvisoryFlag {
  location: string;
  issue: string;
  severity: "BREAKING" | "WARNING";
}

export interface ParsedGraphBlock {
  blockName: string;
  steps: GraphStep[];
  transitions: GraphTransition[];
  flags: GraphAdvisoryFlag[];
  /** XML with absolute addresses replaced by ABS_ symbolic names — ready to re-import */
  fixedXml: string;
  /** Tags auto-converted from absolute addresses */
  absTags: Map<string, AbsTag>;
  /** Human-readable advisory for the engineer */
  advisory: string;
}

import { replaceAbsoluteAddressesInXml, formatTagList } from "@/lib/migrate-abs-address";
import type { AbsTag } from "@/lib/migrate-abs-address";

// SFC names that need replacement in GRAPH action statements
const SFC_NAMES = [
  "SFC14","SFC15","SFC20","SFC21","SFC22","SFC23","SFC36","SFC37","SFC38",
  "SFC43","SFC46","SFC47","SFC49","SFC50","SFC51","SFC52","SFC58","SFC59",
  "SFC64","SFC78","SFC79","SFC13","SFC24","SFC25","SFC26",
];

// S7-300 timer function names
const S7_TIMERS = ["S_ODT","S_PULSE","S_OFFDT","S_PEXT","S_ODT","S_ODTS"];

// S7-300 counter function names
const S7_COUNTERS = ["S_CU","S_CD","S_CUD"];

// Note: absolute addresses are handled by replaceAbsoluteAddresses() before checkStatement runs.
// checkStatement only flags things that cannot be auto-fixed in text.
function checkStatement(text: string, location: string): GraphAdvisoryFlag[] {
  const flags: GraphAdvisoryFlag[] = [];

  // Deprecated SFC calls
  for (const sfc of SFC_NAMES) {
    if (new RegExp(`\\b${sfc}\\b`, "i").test(text)) {
      flags.push({
        location,
        issue: `${sfc} call — replace with S7-1500 equivalent (see migration plan)`,
        severity: "BREAKING",
      });
    }
  }

  // S7-300 timer instructions
  for (const timer of S7_TIMERS) {
    if (new RegExp(`\\b${timer}\\s*\\(`, "i").test(text)) {
      flags.push({
        location,
        issue: `S7-300 timer ${timer}() — convert to IEC TON/TP/TOF instance declared in FB VAR_STAT`,
        severity: "BREAKING",
      });
    }
  }

  // S7-300 counter instructions
  for (const counter of S7_COUNTERS) {
    if (new RegExp(`\\b${counter}\\s*\\(`, "i").test(text)) {
      flags.push({
        location,
        issue: `S7-300 counter ${counter}() — convert to IEC CTU/CTD/CTUD instance declared in FB VAR_STAT`,
        severity: "BREAKING",
      });
    }
  }

  // S5TIME literals
  if (/\bS5TIME#|S5T#/i.test(text)) {
    flags.push({
      location,
      issue: `S5TIME# literal found — replace with T# (TIME) literal`,
      severity: "BREAKING",
    });
  }

  return flags;
}

// ─── XML parser ────────────────────────────────────────────────────────────────

/**
 * Parse a GRAPH SimaticML XML string exported by TIA Portal Openness.
 * Returns structured step/transition data and advisory flags.
 */
export function parseGraphXml(blockName: string, xml: string): ParsedGraphBlock {
  const steps: GraphStep[] = [];
  const transitions: GraphTransition[] = [];
  const flags: GraphAdvisoryFlag[] = [];

  // ── Pre-pass: replace absolute addresses in XML Name attributes and statement text
  const { xml: xmlAfterAddr, tags: absTags } = replaceAbsoluteAddressesInXml(xml);
  // Also fix S5TIME# literals in the XML
  const fixedXml = xmlAfterAddr.replace(/S5TIME#([^\s"<]+)/gi, "T#$1");

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(fixedXml, "application/xml");

    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      return makeEmptyBlock(blockName, `XML parse error: ${parseError.textContent?.slice(0, 200)}`);
    }

    // ── Steps ──────────────────────────────────────────────────────────────────
    // TIA Portal GRAPH SimaticML uses namespaced elements inside SequencerChart.
    // querySelectorAll("Step") may fail in namespace-aware XML mode — use
    // getElementsByTagName which matches by local name across any namespace.
    const stepEls = Array.from(doc.getElementsByTagName("Step"));
    for (const stepEl of stepEls) {
      const name = stepEl.getAttribute("Name") ?? "Unknown";
      const isInitial = stepEl.getAttribute("InitialStep") === "True";
      const minTime = stepEl.getAttribute("MinTime") ?? undefined;
      const maxTime = stepEl.getAttribute("MaxTime") ?? undefined;

      const actions: Array<{ qualifier: string; statement: string }> = [];

      for (const actionEl of Array.from(stepEl.getElementsByTagName("Action"))) {
        const qualifier = actionEl.getAttribute("Qualifier") ?? "N";
        // Action content is either a <Statement> or a <Reference Name="...">
        const statementEl = actionEl.getElementsByTagName("Statement")[0];
        const referenceEl = actionEl.getElementsByTagName("Reference")[0];
        const statement =
          statementEl?.textContent?.trim() ??
          referenceEl?.getAttribute("Name") ??
          "";

        if (statement) {
          actions.push({ qualifier, statement });
          flags.push(...checkStatement(statement, `Step "${name}" action [${qualifier}]`));
        }
      }

      steps.push({ name, isInitial, actions, minTime, maxTime });
    }

    // ── Transitions ────────────────────────────────────────────────────────────
    // Same namespace issue — use getElementsByTagName throughout.
    const transitionEls = Array.from(doc.getElementsByTagName("Transition"));
    for (const transEl of transitionEls) {
      const name = transEl.getAttribute("Name") ?? "Unknown";

      // Get condition: first Statement inside first Condition element
      const conditionEl = transEl.getElementsByTagName("Condition")[0];
      const condition = conditionEl?.getElementsByTagName("Statement")[0]?.textContent?.trim() ?? "";

      // Interlocks: Statement inside each Interlock element
      const interlocks = Array.from(transEl.getElementsByTagName("Interlock"))
        .map((il) => il.getElementsByTagName("Statement")[0]?.textContent?.trim() ?? "")
        .filter(Boolean);

      transitions.push({ name, condition, interlocks });

      if (condition) {
        flags.push(...checkStatement(condition, `Transition "${name}" condition`));
      }
      for (const interlock of interlocks) {
        if (interlock) {
          flags.push(...checkStatement(interlock, `Transition "${name}" interlock`));
        }
      }
    }

  } catch (err) {
    return makeEmptyBlock(blockName, `Failed to parse GRAPH XML: ${String(err)}`);
  }

  // Deduplicate flags by location+issue
  const seen = new Set<string>();
  const uniqueFlags = flags.filter((f) => {
    const key = `${f.location}::${f.issue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const advisory = buildAdvisory(blockName, steps, transitions, uniqueFlags, absTags);

  return { blockName, steps, transitions, flags: uniqueFlags, fixedXml, absTags, advisory };
}

// ─── Advisory text builder ────────────────────────────────────────────────────

function buildAdvisory(
  blockName: string,
  steps: GraphStep[],
  transitions: GraphTransition[],
  flags: GraphAdvisoryFlag[],
  absTags: Map<string, AbsTag> = new Map(),
): string {
  const breakingFlags = flags.filter((f) => f.severity === "BREAKING");
  const warningFlags  = flags.filter((f) => f.severity === "WARNING");

  const lines: string[] = [
    `(* ═══════════════════════════════════════════════════════════════`,
    `   GRAPH BLOCK MIGRATION ADVISORY: ${blockName}`,
    ``,
    `   This block is a Sequential Function Chart (GRAPH/SFC).`,
    `   It is already in TIA Portal GRAPH format and does NOT need`,
    `   to be converted to SCL.`,
    ``,
    `   ACTION REQUIRED:`,
    `   1. Retarget the hardware configuration to your S7-1500 CPU`,
    `   2. Fix all BREAKING issues listed below in TIA Portal GRAPH editor`,
    `   3. Recompile the block in TIA Portal`,
    ``,
    `   STRUCTURE:`,
    `   • Steps: ${steps.length}  (${steps.filter((s) => s.isInitial).map((s) => s.name).join(", ") || "none"} = initial)`,
    `   • Transitions: ${transitions.length}`,
    ``,
  ];

  if (steps.length > 0) {
    lines.push(`   STEPS:`);
    for (const step of steps) {
      const init = step.isInitial ? " [INITIAL]" : "";
      const timing = step.minTime && step.minTime !== "T#0ms"
        ? ` (min: ${step.minTime}, max: ${step.maxTime})`
        : "";
      lines.push(`   • ${step.name}${init}${timing}`);
      for (const action of step.actions) {
        lines.push(`       [${action.qualifier}] ${action.statement}`);
      }
    }
    lines.push(``);
  }

  if (transitions.length > 0) {
    lines.push(`   TRANSITIONS:`);
    for (const trans of transitions) {
      lines.push(`   • ${trans.name}: ${trans.condition || "(no condition)"}`);
      for (const interlock of trans.interlocks) {
        lines.push(`       INTERLOCK: ${interlock}`);
      }
    }
    lines.push(``);
  }

  if (breakingFlags.length > 0) {
    lines.push(`   ⚠ BREAKING — fix before recompiling (${breakingFlags.length} issue${breakingFlags.length !== 1 ? "s" : ""}):`);
    for (const flag of breakingFlags) {
      lines.push(`   • [${flag.location}]`);
      lines.push(`     ${flag.issue}`);
    }
    lines.push(``);
  }

  if (warningFlags.length > 0) {
    lines.push(`   ⚡ WARNINGS (${warningFlags.length}):`);
    for (const flag of warningFlags) {
      lines.push(`   • [${flag.location}] ${flag.issue}`);
    }
    lines.push(``);
  }

  if (breakingFlags.length === 0 && warningFlags.length === 0 && absTags.size === 0) {
    lines.push(`   ✓ No issues detected — safe to recompile after CPU retarget.`);
    lines.push(``);
  }

  if (absTags.size > 0) {
    lines.push(`   AUTO-CONVERTED ${absTags.size} absolute address(es) → ABS_ symbolic names.`);
    lines.push(`   Create the following tags in TIA Portal before recompiling:`);
    lines.push(``);
    lines.push(formatTagList(absTags));
    lines.push(``);
  }

  lines.push(`═══════════════════════════════════════════════════════════════ *)`);

  return lines.join("\n");
}

function makeEmptyBlock(blockName: string, error: string): ParsedGraphBlock {
  return {
    blockName,
    steps: [],
    transitions: [],
    flags: [],
    fixedXml: "",
    absTags: new Map(),
    advisory: [
      `(* GRAPH BLOCK: ${blockName}`,
      `   Could not parse GRAPH XML: ${error}`,
      `   Open this block in TIA Portal GRAPH editor and review manually. *)`,
    ].join("\n"),
  };
}
