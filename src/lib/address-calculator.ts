/**
 * Address calculation engine for Siemens S7-1200/S7-1500 PLC rack configurations.
 *
 * Address rules:
 * - S7-1200: Digital addresses from byte 0 sequential. Analog from byte 64.
 * - S7-1500: All sequential from byte 0 in slot order (digital + analog share space).
 * - ET 200SP: Own address space, sequential from byte 0.
 * - Digital: %I{byte}.{bit} / %Q{byte}.{bit}, 1 byte per 8 channels
 * - Analog: %IW{byte} / %QW{byte}, 2 bytes per channel, word-aligned
 */

import type { IoEntry } from "@/types";
import { getModuleByMlfb } from "@/lib/module-catalog";
import type { ModuleCatalogEntry } from "@/lib/module-catalog";

export interface ConfiguredSlot {
  slot: number;
  mlfb: string | null;
  description?: string;
}

export interface SlotAddressResult {
  slot: number;
  mlfb: string;
  moduleName: string;
  shortLabel: string;
  inputStartAddress: number;
  outputStartAddress: number;
  ioEntries: IoEntry[];
}

export interface RackAddressMap {
  slots: SlotAddressResult[];
  totals: { di: number; dq: number; ai: number; aq: number };
}

/**
 * Generate IO entries for a single module at given start addresses.
 */
function generateModuleIoEntries(
  mod: ModuleCatalogEntry,
  slot: number,
  inputStart: number,
  outputStart: number,
  rackLabel: string,
): IoEntry[] {
  const entries: IoEntry[] = [];

  // Digital inputs
  for (let ch = 0; ch < mod.diChannels; ch++) {
    const byteOffset = Math.floor(ch / 8);
    const bitOffset = ch % 8;
    entries.push({
      address: `%I${inputStart + byteOffset}.${bitOffset}`,
      tag_name: `${rackLabel}DI_Slot${slot}_Ch${ch}`,
      data_type: "BOOL",
      description: `${mod.name} - Slot ${slot} Ch ${ch}`,
      module: mod.shortLabel,
      slot,
    });
  }

  // Digital outputs
  for (let ch = 0; ch < mod.dqChannels; ch++) {
    const byteOffset = Math.floor(ch / 8);
    const bitOffset = ch % 8;
    entries.push({
      address: `%Q${outputStart + byteOffset}.${bitOffset}`,
      tag_name: `${rackLabel}DQ_Slot${slot}_Ch${ch}`,
      data_type: "BOOL",
      description: `${mod.name} - Slot ${slot} Ch ${ch}`,
      module: mod.shortLabel,
      slot,
    });
  }

  // Analog inputs (word-aligned, 2 bytes per channel)
  const aiStartByte = mod.diChannels > 0
    ? inputStart + Math.ceil(mod.diChannels / 8)
    : inputStart;
  for (let ch = 0; ch < mod.aiChannels; ch++) {
    entries.push({
      address: `%IW${aiStartByte + ch * 2}`,
      tag_name: `${rackLabel}AI_Slot${slot}_Ch${ch}`,
      data_type: "INT",
      description: `${mod.name} - Slot ${slot} Ch ${ch}`,
      module: mod.shortLabel,
      slot,
    });
  }

  // Analog outputs (word-aligned, 2 bytes per channel)
  const aqStartByte = mod.dqChannels > 0
    ? outputStart + Math.ceil(mod.dqChannels / 8)
    : outputStart;
  for (let ch = 0; ch < mod.aqChannels; ch++) {
    entries.push({
      address: `%QW${aqStartByte + ch * 2}`,
      tag_name: `${rackLabel}AQ_Slot${slot}_Ch${ch}`,
      data_type: "INT",
      description: `${mod.name} - Slot ${slot} Ch ${ch}`,
      module: mod.shortLabel,
      slot,
    });
  }

  return entries;
}

/**
 * Calculate addresses for a central rack.
 *
 * - S7-1200: Digital starts at byte 0, analog starts at byte 64.
 * - S7-1500: All sequential from byte 0.
 */
export function calculateRackAddresses(
  slots: ConfiguredSlot[],
  cpuType: string,
): RackAddressMap {
  const is1200 = cpuType.startsWith("S7-12");

  // For S7-1200 we track digital and analog address pointers separately
  let inputDigitalPtr = 0;
  let outputDigitalPtr = 0;
  let inputAnalogPtr = is1200 ? 64 : -1; // -1 means unused (S7-1500 is sequential)
  let outputAnalogPtr = is1200 ? 64 : -1;

  // For S7-1500 a single sequential pointer for each direction
  let inputSeqPtr = 0;
  let outputSeqPtr = 0;

  const results: SlotAddressResult[] = [];
  const totals = { di: 0, dq: 0, ai: 0, aq: 0 };

  for (const slot of slots) {
    if (!slot.mlfb) continue;
    const mod = getModuleByMlfb(slot.mlfb);
    if (!mod) continue;

    const hasDigital = mod.diChannels > 0 || mod.dqChannels > 0;
    const hasAnalog = mod.aiChannels > 0 || mod.aqChannels > 0;

    let inputStart: number;
    let outputStart: number;

    if (is1200) {
      // S7-1200: separate address spaces for digital and analog
      if (hasDigital && !hasAnalog) {
        inputStart = inputDigitalPtr;
        outputStart = outputDigitalPtr;
        inputDigitalPtr += mod.inputAddressBytes;
        outputDigitalPtr += mod.outputAddressBytes;
      } else if (hasAnalog && !hasDigital) {
        inputStart = inputAnalogPtr;
        outputStart = outputAnalogPtr;
        inputAnalogPtr += mod.inputAddressBytes;
        outputAnalogPtr += mod.outputAddressBytes;
      } else {
        // Combo module: digital part from digital ptr, analog part from analog ptr
        // For IO entries, we handle this specially in generateModuleIoEntries
        inputStart = inputDigitalPtr;
        outputStart = outputDigitalPtr;

        const digitalInputBytes = Math.ceil(mod.diChannels / 8);
        const digitalOutputBytes = Math.ceil(mod.dqChannels / 8);
        inputDigitalPtr += digitalInputBytes;
        outputDigitalPtr += digitalOutputBytes;

        // We'll need to override analog addresses for combo modules
        // This is handled below by generating entries separately
      }
    } else {
      // S7-1500: sequential addressing
      inputStart = inputSeqPtr;
      outputStart = outputSeqPtr;
      inputSeqPtr += mod.inputAddressBytes;
      outputSeqPtr += mod.outputAddressBytes;
    }

    let ioEntries: IoEntry[];

    if (is1200 && hasDigital && hasAnalog) {
      // Combo module on S7-1200: generate digital and analog parts separately
      const digitalEntries = generateModuleIoEntries(
        { ...mod, aiChannels: 0, aqChannels: 0 },
        slot.slot,
        inputStart,
        outputStart,
        "",
      );
      const analogEntries = generateAnalogOnlyEntries(
        mod,
        slot.slot,
        inputAnalogPtr,
        outputAnalogPtr,
        "",
      );
      inputAnalogPtr += mod.aiChannels * 2;
      outputAnalogPtr += mod.aqChannels * 2;
      ioEntries = [...digitalEntries, ...analogEntries];
    } else {
      ioEntries = generateModuleIoEntries(mod, slot.slot, inputStart, outputStart, "");
    }

    totals.di += mod.diChannels;
    totals.dq += mod.dqChannels;
    totals.ai += mod.aiChannels;
    totals.aq += mod.aqChannels;

    results.push({
      slot: slot.slot,
      mlfb: mod.mlfb,
      moduleName: mod.name,
      shortLabel: mod.shortLabel,
      inputStartAddress: inputStart,
      outputStartAddress: outputStart,
      ioEntries,
    });
  }

  return { slots: results, totals };
}

/**
 * Generate only analog IO entries for combo modules on S7-1200
 * where analog addresses come from a separate address range.
 */
function generateAnalogOnlyEntries(
  mod: ModuleCatalogEntry,
  slot: number,
  inputStart: number,
  outputStart: number,
  rackLabel: string,
): IoEntry[] {
  const entries: IoEntry[] = [];

  for (let ch = 0; ch < mod.aiChannels; ch++) {
    entries.push({
      address: `%IW${inputStart + ch * 2}`,
      tag_name: `${rackLabel}AI_Slot${slot}_Ch${ch}`,
      data_type: "INT",
      description: `${mod.name} - Slot ${slot} Ch ${ch}`,
      module: mod.shortLabel,
      slot,
    });
  }

  for (let ch = 0; ch < mod.aqChannels; ch++) {
    entries.push({
      address: `%QW${outputStart + ch * 2}`,
      tag_name: `${rackLabel}AQ_Slot${slot}_Ch${ch}`,
      data_type: "INT",
      description: `${mod.name} - Slot ${slot} Ch ${ch}`,
      module: mod.shortLabel,
      slot,
    });
  }

  return entries;
}

/**
 * Calculate addresses for an ET 200SP distributed IO station.
 * Own address space, sequential from byte 0.
 */
export function calculateEt200spAddresses(
  slots: ConfiguredSlot[],
): RackAddressMap {
  let inputPtr = 0;
  let outputPtr = 0;

  const results: SlotAddressResult[] = [];
  const totals = { di: 0, dq: 0, ai: 0, aq: 0 };

  for (const slot of slots) {
    if (!slot.mlfb) continue;
    const mod = getModuleByMlfb(slot.mlfb);
    if (!mod) continue;

    const inputStart = inputPtr;
    const outputStart = outputPtr;
    inputPtr += mod.inputAddressBytes;
    outputPtr += mod.outputAddressBytes;

    const ioEntries = generateModuleIoEntries(
      mod,
      slot.slot,
      inputStart,
      outputStart,
      "ET200SP_",
    );

    totals.di += mod.diChannels;
    totals.dq += mod.dqChannels;
    totals.ai += mod.aiChannels;
    totals.aq += mod.aqChannels;

    results.push({
      slot: slot.slot,
      mlfb: mod.mlfb,
      moduleName: mod.name,
      shortLabel: mod.shortLabel,
      inputStartAddress: inputStart,
      outputStartAddress: outputStart,
      ioEntries,
    });
  }

  return { slots: results, totals };
}

/**
 * Collect all IO entries from both central rack and ET 200SP results.
 */
export function collectAllIoEntries(
  rackResult: RackAddressMap,
  et200spResult: RackAddressMap,
): IoEntry[] {
  const entries: IoEntry[] = [];
  for (const slot of rackResult.slots) {
    entries.push(...slot.ioEntries);
  }
  for (const slot of et200spResult.slots) {
    entries.push(...slot.ioEntries);
  }
  return entries;
}
