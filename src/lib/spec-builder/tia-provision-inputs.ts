/**
 * contract.hardware → TIA bridge provision inputs (G9-W9).
 *
 * Pure mapping, no React and no IO, so the fresh-project build is auditable
 * and unit-tested. The CPU table is generic Siemens catalogue data — never
 * add project-specific entries here.
 * Design: Docs/superpowers/specs/2026-07-24-fresh-project-build-design.md
 */
import type { HardwareModelV1 } from "@/types/spec-contract-v2";
import type { IoModuleDto, IoTagDto, MigrationTagDto } from "@/lib/tia-bridge-contract";
import { planIoAddressing } from "@/lib/spec-builder/io-addressing";

/**
 * CPU family → MLFB order number, firmware-suffixed. Matched by substring so
 * descriptive types ("CPU S7-1511-1 PN") resolve. The generic "S7-1500" entry
 * is last: no specific family string contains it, so it only catches types
 * that name no model.
 */
const CPU_ORDER_NUMBERS: Record<string, string> = {
  "S7-1511": "6ES7 511-1AK02-0AB0/V2.9",
  "S7-1512": "6ES7 512-1DK01-0AB0/V2.9",
  "S7-1513": "6ES7 513-1AL02-0AB0/V2.9",
  "S7-1515": "6ES7 515-2AM02-0AB0/V2.9",
  "S7-1516": "6ES7 516-3AN02-0AB0/V2.9",
  "S7-1517": "6ES7 517-3AP00-0AB0/V2.9",
  "S7-1518": "6ES7 518-4AP00-0AB0/V2.9",
  "S7-1500": "6ES7 516-3AN02-0AB0/V2.9", // generic fallback → S7-1516
};

export interface ProvisionIoModules {
  modules: IoModuleDto[];
  /** module_type of every module with no order number — cannot be plugged. */
  missingOrderNumbers: string[];
}

/**
 * The CPU the bridge should create. An authored order number always wins;
 * `firmware` is appended only when the order number carries no `/Vx.y` suffix
 * of its own. `undefined` means no CPU is resolvable — the caller must block
 * the fresh build rather than guess a default.
 */
export function cpuOrderNumberFromHardware(
  hardware: HardwareModelV1 | null | undefined,
): string | undefined {
  const cpu = hardware?.cpu;
  if (!cpu) return undefined;

  const explicit = cpu.cpu_order_number?.trim();
  if (explicit) {
    const firmware = cpu.firmware?.trim().replace(/^\//, "");
    return firmware && !explicit.includes("/") ? `${explicit}/${firmware}` : explicit;
  }

  const cpuType = cpu.cpu_type?.trim() ?? "";
  for (const [family, mlfb] of Object.entries(CPU_ORDER_NUMBERS)) {
    if (cpuType.includes(family)) return mlfb;
  }
  return undefined;
}

/**
 * Flatten racks → modules the bridge can plug, reporting the ones it can't.
 *
 * Each module also carries the byte offset from the deterministic layout, so
 * the bridge pins its IO range instead of letting TIA auto-assign — otherwise
 * the ranges and the generated tags line up only by coincidence (G0-18). The
 * layout depends on the hardware alone, so no signals are needed here.
 */
export function ioModulesFromHardware(
  hardware: HardwareModelV1 | null | undefined,
): ProvisionIoModules {
  const modules: IoModuleDto[] = [];
  const missingOrderNumbers: string[] = [];

  const layout = planIoAddressing(hardware, []);
  const startAddressOf = (rack: number, slot: number) =>
    layout.modules.find((m) => m.rack === rack && m.slot === slot)?.start_address;

  for (const rack of hardware?.racks ?? []) {
    for (const mod of rack.modules ?? []) {
      const mlfb = mod.order_number?.trim();
      if (mlfb) {
        const start = startAddressOf(rack.rack, mod.slot);
        modules.push({
          mlfb,
          rack: rack.rack,
          slot: mod.slot,
          description: mod.module_type,
          ...(start === undefined ? {} : { start_address: start }),
        });
      } else {
        missingOrderNumbers.push(mod.module_type);
      }
    }
  }
  return { modules, missingOrderNumbers };
}

/** The send plan carries MigrationTagDto; provisioning wants IoTagDto. */
export function ioTagsFromMigrationTags(tags: MigrationTagDto[]): IoTagDto[] {
  return tags.map((t) => ({
    name: t.name,
    data_type: t.dataType,
    logical_address: t.address,
  }));
}
