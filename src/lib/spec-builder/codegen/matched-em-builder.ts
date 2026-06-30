import type { FbInterfacePin } from "@/types/fb-interface";
import type { CodegenArtifact } from "./types";

const PROGRAM = "Program blocks";

/** Per control-module facts the linker needs. */
export interface CmLinkInfo {
  /** instance DB name, e.g. "CM_Motor_M01_DB" */
  instanceDb: string;
  /** the CM's contract pins ([] when no reviewed contract) */
  pins: FbInterfacePin[];
  /** the FDS tags this CM owns (from its io_signals) */
  tags: string[];
}

export interface EmCmLinkResult {
  linkIn: CodegenArtifact;
  linkOut: CodegenArtifact;
  warnings: string[];
}

/** Comparison key for a pin name or tag: drop a leading role-ish prefix,
 *  lowercase, strip non-alphanumerics. Lets `fb_at_top` match tag `at_top`. */
export function linkKey(s: string): string {
  const stripped = s.replace(/^(fb|cmd|act|ilk|sensor|status|out|in)_/i, "");
  return stripped.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** CMs whose owned tags match `key`. */
function candidatesFor(key: string, cms: CmLinkInfo[]): CmLinkInfo[] {
  return cms.filter((cm) => cm.tags.some((t) => linkKey(t) === key));
}

/** Pick the CM pin of the wanted direction: same-key first, else the first of
 *  that direction; null if none. */
function pickCmPin(
  cm: CmLinkInfo,
  key: string,
  dir: FbInterfacePin["direction"],
): FbInterfacePin | null {
  return (
    cm.pins.find((p) => p.direction === dir && linkKey(p.name) === key) ??
    cm.pins.find((p) => p.direction === dir) ??
    null
  );
}

function fc(name: string, bodyLines: string[]): CodegenArtifact {
  return {
    name,
    type: "FC",
    filename: `${name}.scl`,
    content: [
      `FUNCTION "${name}" : Void`,
      `{ S7_Optimized_Access := 'TRUE' }`,
      `VERSION : 0.1`,
      `BEGIN`,
      ...bodyLines,
      `END_FUNCTION`,
      ``,
    ].join("\n"),
    dependencies: [],
    folder: PROGRAM,
    layer: "em",
  };
}

/**
 * Resolve EM↔CM wiring by role + tag. Produces LINK_<em>_IN (CM outputs → EM
 * inputs, run before the EM call) and LINK_<em>_OUT (EM outputs → CM inputs,
 * run after). Only `sensor_in` (IN) and `actuator_out` (OUT) EM pins are linked
 * here; command/mode/status/interlock pins are handled elsewhere. Ambiguous or
 * unresolved pins become `// TODO bind` lines + warnings; never guesses. Pure.
 */
export function buildEmCmLinks(
  emSclName: string,
  emInstanceDb: string,
  emPins: FbInterfacePin[],
  cms: CmLinkInfo[],
): EmCmLinkResult {
  const warnings: string[] = [];
  const inLines: string[] = [`   // CM status feedback -> EM inputs`];
  const outLines: string[] = [`   // EM commands -> CM inputs`];

  for (const p of emPins) {
    const key = linkKey(p.name);

    if (p.role === "sensor_in" && p.direction === "input") {
      const cands = candidatesFor(key, cms);
      if (cands.length !== 1) {
        const why =
          cands.length === 0
            ? `no CM provides "${p.name}"`
            : `${cands.length} CMs provide "${p.name}" (${cands.map((c) => c.instanceDb).join(" | ")})`;
        inLines.push(`   // TODO bind #${p.name} — ${why}`);
        warnings.push(`EM ${emSclName}: IN pin ${p.name} — ${why}`);
        continue;
      }
      const matchedCm = cands[0];
      const cmPin = pickCmPin(matchedCm, key, "output");
      if (!cmPin) {
        inLines.push(
          `   // TODO bind #${p.name} — ${matchedCm.instanceDb} exposes no output pin`,
        );
        warnings.push(
          `EM ${emSclName}: IN pin ${p.name} — ${matchedCm.instanceDb} has no output pin`,
        );
        continue;
      }
      inLines.push(
        `   "${emInstanceDb}".${p.name} := "${matchedCm.instanceDb}".${cmPin.name};`,
      );
      continue;
    }

    if (p.role === "actuator_out" && p.direction === "output") {
      const cands = candidatesFor(key, cms);
      if (cands.length !== 1) {
        const why =
          cands.length === 0
            ? `no CM consumes "${p.name}"`
            : `${cands.length} CMs consume "${p.name}" (${cands.map((c) => c.instanceDb).join(" | ")})`;
        outLines.push(`   // TODO bind #${p.name} — ${why}`);
        warnings.push(`EM ${emSclName}: OUT pin ${p.name} — ${why}`);
        continue;
      }
      const matchedCm = cands[0];
      const cmPin = pickCmPin(matchedCm, key, "input");
      if (!cmPin) {
        outLines.push(
          `   // TODO bind #${p.name} — ${matchedCm.instanceDb} exposes no input pin`,
        );
        warnings.push(
          `EM ${emSclName}: OUT pin ${p.name} — ${matchedCm.instanceDb} has no input pin`,
        );
        continue;
      }
      outLines.push(
        `   "${matchedCm.instanceDb}".${cmPin.name} := "${emInstanceDb}".${p.name};`,
      );
    }
  }

  return {
    linkIn: fc(`LINK_${emSclName}_IN`, inLines),
    linkOut: fc(`LINK_${emSclName}_OUT`, outLines),
    warnings,
  };
}
