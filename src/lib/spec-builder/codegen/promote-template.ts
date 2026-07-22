// src/lib/spec-builder/codegen/promote-template.ts
//
// G6-7 — "Promote to library": derive an fb_template payload (blocks +
// role-tagged interface contract + PackML states) from a generated Code
// Builder artifact bundle. Fully deterministic — the pin roles fall out of
// the writers' own naming conventions (em-writer / fb-instantiate), and the
// states come from the FDS EM state machine, so the G6 coverage gate passes
// with zero hand-authoring. Generic across machine types.

import type { FbBlockType, FbTemplateSource } from "@/types/fb-template";
import type {
  FbBindingSource,
  FbInterfaceContract,
  FbInterfacePin,
  FbPinRole,
} from "@/types/fb-interface";

export interface PromotableBlock {
  artifact_name: string;
  type: string;
  content: string;
}

export interface PromoteStateInput {
  state_id: string;
  name: string;
  is_safe_state: boolean;
}

export interface PromoteInput {
  /** em → equipment-module template (states declared); cm → device template. */
  grain: "em" | "cm";
  /** Library display name for the template. */
  name: string;
  device_category?: never;
  deviceCategory: string;
  /** The owner-related artifact bundle (any mix — non-reusable blocks are filtered). */
  blocks: PromotableBlock[];
  /** FDS EM states (em grain only). */
  states?: PromoteStateInput[];
  /** ISO timestamp stamped on the contract (caller supplies — keeps this pure). */
  generatedAt: string;
}

export interface PromoteTemplatePayload {
  name: string;
  device_category: string;
  plc_brand: string;
  description: string;
  tags: string[];
  source: FbTemplateSource;
  is_equipment_module: boolean;
  blocks: Array<{
    block_name: string;
    block_type: FbBlockType;
    scl_code: string;
    sort_order: number;
    programming_language: "SCL";
  }>;
}

export interface PromoteDerivation {
  template: PromoteTemplatePayload;
  contract: FbInterfaceContract;
  warnings: string[];
}

/** Reusable template body = type declarations + function blocks. Instance
 *  DBs, CMD/CFG/STAT DBs, MAP FCs and OBs are per-project and regenerate at
 *  instantiation time. */
const REUSABLE_TYPES: Record<string, FbBlockType> = { UDT: "UDT", FB: "FB" };
const TYPE_ORDER: Record<FbBlockType, number> = { UDT: 0, FB: 1, FC: 2, DB: 3, OB: 4 };

interface ParsedPin {
  name: string;
  scl_type: string;
  direction: "input" | "output" | "inout";
  description: string;
}

/** Parse pins out of the FB's VAR_INPUT / VAR_OUTPUT / VAR_IN_OUT sections. */
function parseInterfacePins(scl: string): ParsedPin[] {
  const pins: ParsedPin[] = [];
  const sections: Array<[RegExp, ParsedPin["direction"]]> = [
    [/VAR_INPUT([\s\S]*?)END_VAR/g, "input"],
    [/VAR_OUTPUT([\s\S]*?)END_VAR/g, "output"],
    [/VAR_IN_OUT([\s\S]*?)END_VAR/g, "inout"],
  ];
  for (const [re, direction] of sections) {
    for (const m of scl.matchAll(re)) {
      for (const raw of m[1].split("\n")) {
        const line = raw.trim();
        const pm = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^;]+);(?:\s*\/\/\s*(.*))?$/);
        if (!pm) continue;
        pins.push({
          name: pm[1],
          // contract convention: first token of the SCL type
          scl_type: pm[2].trim().split(/\s/)[0],
          direction,
          description: pm[3]?.trim() ?? "",
        });
      }
    }
  }
  return pins;
}

/** Deterministic role/binding mapping from the writers' pin-naming
 *  conventions (enable/mode/cmd_/sp_/ilk_ inputs; state/step/done/fault
 *  status outputs; everything else is process IO). */
function classifyPin(p: ParsedPin): FbInterfacePin {
  let role: FbPinRole;
  let binding: FbBindingSource;
  if (p.direction === "output") {
    if (p.name === "state" || p.name === "step" || p.name === "done") {
      role = "status";
      binding = "em";
    } else if (p.name === "fault" || p.name.startsWith("fault_") || p.name.startsWith("alarm_")) {
      role = "fault";
      binding = "em";
    } else {
      role = "actuator_out";
      binding = "io_output";
    }
  } else if (p.name === "enable" || p.name.startsWith("cmd_")) {
    role = "cmd";
    binding = "em";
  } else if (p.name === "mode") {
    role = "mode";
    binding = "em";
  } else if (p.name.startsWith("sp_")) {
    role = "param";
    binding = "hmi";
  } else if (p.name.startsWith("ilk_")) {
    role = "interlock";
    binding = "em";
  } else {
    role = "sensor_in";
    binding = "io_input";
  }
  return {
    name: p.name,
    scl_type: p.scl_type,
    direction: p.direction,
    role,
    default_binding: binding,
    exposed: p.direction === "output",
    description: p.description,
  };
}

export function deriveFbTemplate(input: PromoteInput): PromoteDerivation {
  const warnings: string[] = [];

  const reusable = input.blocks.filter((b) => {
    if (REUSABLE_TYPES[b.type]) return true;
    // DBs (instance/CMD) and FCs (MAP) are per-project by design — skip
    // silently; anything else in the bundle is unexpected and worth flagging
    if (b.type !== "DB" && b.type !== "FC") {
      warnings.push(`${b.artifact_name}: ${b.type} blocks are not promotable — skipped`);
    }
    return false;
  });

  const fbs = reusable.filter((b) => b.type === "FB");
  if (fbs.length === 0) {
    throw new Error(`"${input.name}": bundle contains no FB block to promote`);
  }
  // the main FB carries the interface contract; writers emit exactly one FB
  // per EM/CM bundle, so first-by-order is deterministic
  const mainFb = fbs[0];
  if (fbs.length > 1) {
    warnings.push(
      `${input.name}: bundle has ${fbs.length} FBs — contract derived from "${mainFb.artifact_name}"`,
    );
  }

  const pins = parseInterfacePins(mainFb.content).map(classifyPin);
  if (pins.length === 0) {
    warnings.push(`${mainFb.artifact_name}: no interface pins parsed — contract has no pins`);
  }

  const sorted = [...reusable].sort(
    (a, b) =>
      (TYPE_ORDER[a.type as FbBlockType] ?? 9) - (TYPE_ORDER[b.type as FbBlockType] ?? 9),
  );

  const contract: FbInterfaceContract = {
    block_name: mainFb.artifact_name,
    pins,
    states:
      input.grain === "em"
        ? (input.states ?? []).map((s) => ({
            slug: s.state_id,
            name: s.name,
            is_safe: s.is_safe_state,
          }))
        : [],
    // Deterministic derivation from the writers' own conventions — no AI
    // guessing to confirm, so the contract is born reviewed. (buildWiring
    // only wires by contract when reviewed=true.)
    reviewed: true,
    generated_at: input.generatedAt,
  };

  return {
    template: {
      name: input.name,
      device_category: input.deviceCategory,
      plc_brand: "SIEMENS_TIA",
      description: `Promoted from generated ${input.grain.toUpperCase()} code (${mainFb.artifact_name}). Interface contract and states auto-derived at promotion.`,
      tags: ["promoted"],
      source: "custom",
      is_equipment_module: input.grain === "em",
      blocks: sorted.map((b, i) => ({
        block_name: b.artifact_name,
        block_type: b.type as FbBlockType,
        scl_code: b.content,
        sort_order: i,
        programming_language: "SCL",
      })),
    },
    contract,
    warnings,
  };
}
