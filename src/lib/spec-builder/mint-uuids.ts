import type { Hierarchy } from "@/types/spec-contract-v2";
import type { UnitConfig } from "@/types/spec-builder";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): boolean {
  return typeof v === "string" && UUID_RE.test(v);
}

const mint = (v: string) => (isUuid(v) ? v : crypto.randomUUID());

/**
 * Deterministically ensure every unit/EM/CM id in a V2 hierarchy is a UUID.
 * Idempotent: ids that are already valid UUIDs are preserved. Names + IO untouched.
 */
export function mintHierarchyUuids(hierarchy: Hierarchy): Hierarchy {
  return {
    units: hierarchy.units.map((u) => ({
      ...u,
      unit_id: mint(u.unit_id),
      equipment_modules: u.equipment_modules.map((em) => ({
        ...em,
        equipment_module_id: mint(em.equipment_module_id),
        control_modules: em.control_modules.map((cm) => ({
          ...cm,
          control_module_id: mint(cm.control_module_id),
        })),
      })),
    })),
  };
}

/**
 * Same minting over the wizard's `UnitConfig[]` shape (the hierarchy form that
 * flows into `spec_projects.confirmed_units`). Idempotent: preserves valid
 * UUIDs, names, IO, and all other fields. Keeps `confirmed_units` ids UUID-typed
 * so foreign-spec requirement binding (uuid-typed `spec_source_sections`) works.
 */
export function mintUnitConfigUuids(units: UnitConfig[]): UnitConfig[] {
  return units.map((u) => ({
    ...u,
    unit_id: mint(u.unit_id),
    equipment_modules: u.equipment_modules.map((em) => ({
      ...em,
      equipment_module_id: mint(em.equipment_module_id),
      control_modules: em.control_modules.map((cm) => ({
        ...cm,
        control_module_id: mint(cm.control_module_id),
      })),
    })),
  }));
}
