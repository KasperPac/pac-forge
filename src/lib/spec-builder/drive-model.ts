/**
 * G0-1 drive/VSD model semantics — pure helpers, no React/IO.
 * The telegram-support table is deliberately local: vfd-fb-family.ts stays
 * AI-prompt-only until G1-6 refactors it for deterministic consumption.
 * Design: Docs/superpowers/specs/2026-07-20-g0-1-drive-model-design.md
 */
import type {
  ControlModuleV2,
  EngineeringDataV1,
  VfdFamily,
} from "@/types/spec-contract-v2";

/** Allowed telegrams per family; "none" = must be absent; "any" = unconstrained. */
const FAMILY_TELEGRAMS: Record<VfdFamily, readonly number[] | "none" | "any"> = {
  sinamics_g120: [1, 20, 352],
  sinamics_s210: [102, 105],
  abb_acs880: "none", // EtherNet/IP assembly — telegram n/a
  sew_movidrive: "none", // vendor profile
  other: "any",
};

export interface DriveModelSpecView {
  control_modules: Pick<
    ControlModuleV2,
    "control_module_id" | "control_module_name" | "drive"
  >[];
  engineering?: EngineeringDataV1;
}

export interface DriveModelIssues {
  errors: string[];
  warnings: string[];
}

/**
 * Structural invariants over drive models + engineering entries (design §3).
 * Context-dependent checks skip when their context is absent — callers pass
 * whatever the patch carries (same convention as validateUnitCoordination).
 */
export function validateDriveModels(view: DriveModelSpecView): DriveModelIssues {
  const errors: string[] = [];
  const warnings: string[] = [];
  const byId = new Map(view.control_modules.map((cm) => [cm.control_module_id, cm]));

  for (const cm of view.control_modules) {
    if (!cm.drive) continue;
    const where = `control_modules[${cm.control_module_name}].drive`;
    const rule = FAMILY_TELEGRAMS[cm.drive.family];
    if (cm.drive.telegram !== undefined) {
      if (rule === "none") {
        errors.push(
          `${where}: family "${cm.drive.family}" does not use PROFINET telegrams — remove telegram`,
        );
      } else if (rule !== "any" && !rule.includes(cm.drive.telegram)) {
        errors.push(
          `${where}: telegram ${cm.drive.telegram} not supported by family "${cm.drive.family}" (supported: ${rule.join(", ")})`,
        );
      }
    } else if (rule !== "none" && rule !== "any") {
      warnings.push(
        `${where}: family "${cm.drive.family}" has no telegram selected — spec incomplete`,
      );
    }
  }

  const seen = new Set<string>();
  for (const entry of view.engineering?.drives ?? []) {
    const where = `engineering.drives[${entry.control_module_id}]`;
    const cm = byId.get(entry.control_module_id);
    if (!cm) {
      errors.push(`${where}: references unknown control module`);
    } else if (!cm.drive) {
      errors.push(
        `${where}: control module "${cm.control_module_name}" has no drive model`,
      );
    }
    if (seen.has(entry.control_module_id)) {
      errors.push(`${where}: duplicate entry for control module`);
    }
    seen.add(entry.control_module_id);
  }

  if (view.engineering) {
    for (const cm of view.control_modules) {
      if (cm.drive && !seen.has(cm.control_module_id)) {
        warnings.push(
          `control_modules[${cm.control_module_name}]: drive has no engineering.drives entry — HW ids / RefSpeed pending commissioning`,
        );
      }
    }
  }

  return { errors, warnings };
}
