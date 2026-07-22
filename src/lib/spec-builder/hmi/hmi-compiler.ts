// src/lib/spec-builder/hmi/hmi-compiler.ts
//
// G7 — the FDS → HMI derivation layer. Pure and deterministic: every binding
// is derived from the contract via the SAME ordering + naming rules the SCL
// writers use (orderStates / codegen/naming.ts), so the HMI can never
// desynchronize from the generated code. No AI in this path.
// Design: Docs/superpowers/specs/2026-07-22-g7-hmi-compiler-design.md
import { UNIT_PACKML_STATES, type AlarmTier, type SpecContractV2 } from "@/types/spec-contract-v2";
import { orderStates } from "@/lib/spec-builder/codegen/step-order";
import { sclIdent } from "@/lib/spec-builder/codegen/sa-builder";
import { emDbName, unDbName } from "@/lib/spec-builder/codegen/naming";
import type { HmiAlarmClass, HmiIr, HmiTextList } from "./hmi-ir";

/** Display text for a PackML slug: "unholding" → "Unholding". */
function slugText(slug: string): string {
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

/** G7-6: tier → class. Generic rule — critical/fault-ish tiers demand
 *  acknowledgement; everything else is a Warning. */
export function alarmClassForTier(tier: AlarmTier): HmiAlarmClass {
  const faultish = /critical|fault/i.test(`${tier.tier_id} ${tier.tier_name}`);
  return faultish
    ? { name: "Fault", acknowledgement: true }
    : { name: "Warning", acknowledgement: false };
}

/** G7-1: one text list per contracted EM (dispatch order == runtime state
 *  value, guaranteed by sharing orderStates with em-builder) plus one per
 *  coordinated unit (canonical UNIT_PACKML_STATES order == Cur_St). */
function buildTextLists(contract: SpecContractV2): HmiTextList[] {
  const lists: HmiTextList[] = [];
  for (const unit of contract.hierarchy.units) {
    if (unit.excluded) continue;
    for (const em of unit.equipment_modules) {
      const emContract = contract.equipment_modules[em.equipment_module_id];
      if (!emContract) continue; // no state machine → nothing to display
      const scl = sclIdent(em.equipment_module_name);
      lists.push({
        name: `${scl}_States`,
        stateTag: `${emDbName(scl)}.state`,
        entries: orderStates(emContract.states, emContract.transitions).map((s, index) => ({
          index,
          text: s.name || slugText(s.state_id),
        })),
      });
    }
    const coord = contract.unit_coordination?.[unit.unit_id];
    if (coord) {
      const scl = sclIdent(unit.unit_name);
      const ordered = [...coord.states].sort(
        (a, b) =>
          UNIT_PACKML_STATES.indexOf(a.state_id) - UNIT_PACKML_STATES.indexOf(b.state_id),
      );
      lists.push({
        name: `${scl}_States`,
        stateTag: `${unDbName(scl)}.Cur_St`,
        entries: ordered.map((s, index) => ({ index, text: slugText(s.state_id) })),
      });
    }
  }
  return lists;
}

/** Build the full HMI IR from a confirmed contract. */
export function buildHmiIr(contract: SpecContractV2): HmiIr {
  const seen = new Set<string>();
  const alarmClasses: HmiAlarmClass[] = [];
  for (const tier of contract.alarm_tiers) {
    const cls = alarmClassForTier(tier);
    if (seen.has(cls.name)) continue;
    seen.add(cls.name);
    alarmClasses.push(cls);
  }
  return {
    textLists: buildTextLists(contract),
    alarmClasses,
  };
}
