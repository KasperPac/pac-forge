/**
 * G1-1 drive detection — lowers G0-1 DriveModelV1 CMs into the codegen IR.
 * Pure, deterministic, warn-don't-throw (writer philosophy: the bundle
 * always compiles; unfilled data becomes // TODO in G1-2 emission).
 * The family→FB table is deterministic and local; a G0-8 fb_assignment
 * naming a library template overrides it in G6-2 (not wired here).
 * Design: Docs/superpowers/specs/2026-07-20-g0-1-drive-model-design.md (§consumers)
 */
import type {
  DriveEngineeringEntry,
  DriveModelV1,
  EngineeringDataV1,
  EquipmentModuleV2,
} from "@/types/spec-contract-v2";
import { sclIdent } from "./sa-builder";
import { deterministicDriveFb } from "../vfd-fb-family";

export interface DriveInstance {
  control_module_id: string;
  control_module_name: string;
  /** SCL-safe identifier derived from the CM name. */
  sclName: string;
  /** Driver FB to instantiate; undefined when no deterministic template. */
  fb_name?: string;
  drive: DriveModelV1;
  /** Tier-2 commissioning values when recorded (HW ids, RefSpeed, ConfigAxis). */
  engineering?: DriveEngineeringEntry;
  /** The CM's signal tags — lets the MAP writer resolve which EM pins are
   *  this drive's speed reference/feedback (G1-2). */
  io_tags: string[];
  warnings: string[];
}

/**
 * Detect the drive CMs of one EM and join their tier-2 engineering entries.
 * Returns [] for EMs without drive models — non-drive codegen is untouched.
 */
export function detectDrives(
  em: EquipmentModuleV2,
  engineering?: EngineeringDataV1,
): DriveInstance[] {
  const out: DriveInstance[] = [];
  for (const cm of em.control_modules) {
    if (!cm.drive) continue;
    const warnings: string[] = [];
    const fb_name = deterministicDriveFb(cm.drive.family);
    if (!fb_name) {
      warnings.push(
        `drive CM ${cm.control_module_name}: no deterministic driver FB for family "${cm.drive.family}" — assign a library template (fb_assignments) or the MAP emission stays a TODO`,
      );
    }
    const eng = engineering?.drives.find(
      (d) => d.control_module_id === cm.control_module_id,
    );
    if (!eng) {
      warnings.push(
        `drive CM ${cm.control_module_name}: no engineering entry (HW ids / RefSpeed pending) — emission will carry // TODO values`,
      );
    }
    out.push({
      control_module_id: cm.control_module_id,
      control_module_name: cm.control_module_name,
      sclName: sclIdent(cm.control_module_name),
      fb_name,
      drive: cm.drive,
      engineering: eng,
      io_tags: cm.io_signals.map((s) => s.tag),
      warnings,
    });
  }
  return out;
}
