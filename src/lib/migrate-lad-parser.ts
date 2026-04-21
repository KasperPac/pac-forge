/**
 * Parse Siemens SimaticML FlgNet XML for LAD/FBD blocks exported by TIA Portal Openness.
 *
 * LAD/FBD blocks in TIA Portal do NOT need to be converted to SCL. They are already in
 * TIA Portal LAD/FBD editor and just need to be recompiled after retargeting to S7-1500.
 *
 * Absolute addresses (M10.0, MW10 etc.) are AUTO-CONVERTED to ABS_ symbolic names so
 * the block can compile. The engineer creates the generated tags in TIA Portal's tag
 * table and renames them to proper symbolic names over time.
 */

export interface LadNetwork {
  id: string;
  title: string;
  /** Instruction/block names used in this network */
  instructions: string[];
  /** Operand names accessed (may include absolute addresses) */
  operands: string[];
}

export interface LadAdvisoryFlag {
  location: string;
  issue: string;
  severity: "BREAKING" | "WARNING";
}

export interface ParsedLadBlock {
  blockName: string;
  language: string;
  networks: LadNetwork[];
  flags: LadAdvisoryFlag[];
  /** XML with absolute addresses replaced by ABS_ symbolic names — ready to re-import */
  fixedXml: string;
  /** Tags that were auto-created (name → AbsTag) — must be created in TIA Portal tag table */
  absTags: Map<string, AbsTag>;
  advisory: string;
}

import { replaceAbsoluteAddressesInXml, formatTagList } from "@/lib/migrate-abs-address";
import type { AbsTag } from "@/lib/migrate-abs-address";

// ─── Known deprecated / renamed instructions ──────────────────────────────────

// S7-300 timer part names in LAD FlgNet
const DEPRECATED_TIMERS: Record<string, string> = {
  "S_ODT":    "TON",
  "S_PULSE":  "TP",
  "S_OFFDT":  "TOF",
  "S_PEXT":   "TP",
  "S_ODTS":   "TON",
};

// S7-300 counter part names in LAD FlgNet
const DEPRECATED_COUNTERS: Record<string, string> = {
  "S_CU":  "CTU",
  "S_CD":  "CTD",
  "S_CUD": "CTUD",
};

// SFC names that appear as Call blocks
const DEPRECATED_SFCS: Record<string, string> = {
  "SFC14": "RDREC",  "SFC15": "WRREC",
  "SFC20": "MOVE_BLK", "SFC21": "FILL_BLK",
  "SFC58": "WRREC",  "SFC59": "RDREC",
  "SFC43": "RE_TRIGR", "SFC46": "STP",
  "SFC64": "TIME_TCK", "SFC78": "DPRD_DAT", "SFC79": "DPWR_DAT",
  "SFC51": "(no direct equivalent — use system diagnostics)",
};

// ─── XML parser ────────────────────────────────────────────────────────────────

export function parseLadXml(blockName: string, xml: string, language = "LAD"): ParsedLadBlock {
  const networks: LadNetwork[] = [];
  const flags: LadAdvisoryFlag[] = [];

  // ── Pre-pass: replace absolute addresses with ABS_ symbolic names ─────────
  // This is done on the raw XML text so the fixed XML can be re-imported into
  // TIA Portal. Absolute addresses in Name="..." attributes become ABS_M10_0 etc.
  const { xml: fixedXml, tags: absTags } = replaceAbsoluteAddressesInXml(xml);

  // Also replace S5TIME# constants in the XML text
  const finalXml = fixedXml.replace(/S5TIME#([^\s"<]+)/gi, "T#$1");

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(finalXml, "application/xml");

    if (doc.querySelector("parsererror")) {
      return makeEmptyBlock(blockName, language, "XML parse error");
    }

    // Each CompileUnit = one network.
    // TIA Portal SimaticML uses <SW.Blocks.CompileUnit> — dots in the tag name make
    // querySelectorAll("CompileUnit") a no-op (CSS treats dots as class selectors).
    // getElementsByTagName does literal tag-name matching, so it works correctly.
    const compileUnits = Array.from(doc.getElementsByTagName("SW.Blocks.CompileUnit"));

    compileUnits.forEach((unit, idx) => {
      const networkId = unit.getAttribute("ID") ?? String(idx + 1);

      // Title is in a <Text> element inside a <MultilingualTextItem> — TIA Portal
      // SimaticML nests titles differently from a simple CSS selector chain.
      const titleEl =
        unit.getElementsByTagName("Text")[0] ??
        unit.getElementsByTagName("String")[0];
      const title = titleEl?.textContent?.trim() || `Network ${idx + 1}`;

      const instructions: string[] = [];
      const operands: string[] = [];
      const networkLabel = `Network ${idx + 1} "${title}"`;

      // ── Parts (instructions) ──────────────────────────────────────────────
      // Part elements live inside <FlgNet> which carries a namespace declaration.
      // querySelectorAll("Part") fails in namespace-aware XML mode; use
      // getElementsByTagName which matches by local name across any namespace.
      Array.from(unit.getElementsByTagName("Part")).forEach((part) => {
        const partName = part.getAttribute("Name") ?? "";
        if (!partName || partName === "Contact" || partName === "Coil" ||
            partName === "PCoil" || partName === "NCoil") return;

        instructions.push(partName);

        if (partName in DEPRECATED_TIMERS) {
          flags.push({
            location: networkLabel,
            issue: `S7-300 timer "${partName}" — replace with IEC ${DEPRECATED_TIMERS[partName]} in TIA Portal LAD editor`,
            severity: "BREAKING",
          });
        }

        if (partName in DEPRECATED_COUNTERS) {
          flags.push({
            location: networkLabel,
            issue: `S7-300 counter "${partName}" — replace with IEC ${DEPRECATED_COUNTERS[partName]} in TIA Portal LAD editor`,
            severity: "BREAKING",
          });
        }

        if (partName === "Call") {
          const calledBlock =
            Array.from(part.getElementsByTagName("TemplateValue"))
              .find((t) => t.getAttribute("Name") === "BlockName")
              ?.textContent?.trim() ??
            part.getAttribute("BlockName") ?? "";

          if (calledBlock && calledBlock in DEPRECATED_SFCS) {
            flags.push({
              location: networkLabel,
              issue: `Call to ${calledBlock} — replace with ${DEPRECATED_SFCS[calledBlock]} in TIA Portal LAD editor`,
              severity: "BREAKING",
            });
          }
        }
      });

      // ── Access nodes (operands — already ABS_-substituted) ────────────────
      Array.from(unit.getElementsByTagName("Access")).forEach((access) => {
        const components = Array.from(access.getElementsByTagName("Component"))
          .map((c) => c.getAttribute("Name") ?? "")
          .filter(Boolean);
        const fullName = components.join(".");
        if (fullName) operands.push(fullName);
      });

      networks.push({ id: networkId, title, instructions, operands });
    });

  } catch (err) {
    return makeEmptyBlock(blockName, language, String(err));
  }

  // Deduplicate flags
  const seen = new Set<string>();
  const uniqueFlags = flags.filter((f) => {
    const key = `${f.location}::${f.issue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const advisory = buildAdvisory(blockName, language, networks, uniqueFlags, absTags);
  return { blockName, language, networks, flags: uniqueFlags, fixedXml: finalXml, absTags, advisory };
}

// ─── Advisory text builder ────────────────────────────────────────────────────

function buildAdvisory(
  blockName: string,
  language: string,
  networks: LadNetwork[],
  flags: LadAdvisoryFlag[],
  absTags: Map<string, AbsTag> = new Map(),
): string {
  const breaking = flags.filter((f) => f.severity === "BREAKING");
  const warnings  = flags.filter((f) => f.severity === "WARNING");

  const lines: string[] = [
    `(* ═══════════════════════════════════════════════════════════════`,
    `   ${language} BLOCK MIGRATION ADVISORY: ${blockName}`,
    ``,
    `   This block is in TIA Portal ${language} editor format.`,
    `   It does NOT need to be converted to SCL.`,
    ``,
    `   ACTION REQUIRED:`,
    `   1. Retarget hardware configuration to your S7-1500 CPU`,
    `   2. Fix all BREAKING issues below in TIA Portal ${language} editor`,
    `   3. Recompile the block in TIA Portal`,
    ``,
    `   STRUCTURE: ${networks.length} network${networks.length !== 1 ? "s" : ""}`,
  ];

  if (networks.length > 0 && networks.length <= 20) {
    for (const net of networks) {
      const instSummary = net.instructions.length > 0
        ? ` [${net.instructions.slice(0, 5).join(", ")}${net.instructions.length > 5 ? "…" : ""}]`
        : "";
      lines.push(`   • ${net.title}${instSummary}`);
    }
  }
  lines.push(``);

  if (breaking.length > 0) {
    lines.push(`   ⚠ BREAKING — fix before recompiling (${breaking.length} issue${breaking.length !== 1 ? "s" : ""}):`);
    for (const f of breaking) {
      lines.push(`   • [${f.location}]`);
      lines.push(`     ${f.issue}`);
    }
    lines.push(``);
  }

  if (warnings.length > 0) {
    lines.push(`   ⚡ WARNINGS (${warnings.length}):`);
    for (const f of warnings) {
      lines.push(`   • [${f.location}] ${f.issue}`);
    }
    lines.push(``);
  }

  if (breaking.length === 0 && warnings.length === 0 && absTags.size === 0) {
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

function makeEmptyBlock(blockName: string, language: string, error: string): ParsedLadBlock {
  return {
    blockName,
    language,
    networks: [],
    flags: [],
    fixedXml: "",
    absTags: new Map(),
    advisory: [
      `(* ${language} BLOCK: ${blockName}`,
      `   Could not parse ${language} XML: ${error}`,
      `   Open this block in TIA Portal ${language} editor and review manually. *)`,
    ].join("\n"),
  };
}
