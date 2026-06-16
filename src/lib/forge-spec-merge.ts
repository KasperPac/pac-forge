/**
 * forge-spec-merge.ts
 * Stage 3 of chunked spec analysis: merge partial extractions into
 * a complete SpecAnalysis. Deterministic — no AI calls.
 */

import type {
  SpecAnalysis,
  SpecSurveyResult,
  PartialSpecAnalysis,
  SpecAnalysisDevice,
  SpecAnalysisAssembly,
  SpecAnalysisAlarm,
  SpecAnalysisInterlock,
  SpecAnalysisProcessSetting,
  SpecAnalysisHardwareSlot,
} from "@/types/forge";

/**
 * Merge all partial analyses into a single complete SpecAnalysis.
 * Project-level fields come from the survey; array fields are merged + deduplicated.
 */
export function mergePartialAnalyses(
  survey: SpecSurveyResult,
  partials: PartialSpecAnalysis[],
): SpecAnalysis {
  // Concat all arrays from partials
  const allDevices = partials.flatMap((p) => p.control_modules);
  const allAssemblies = partials.flatMap((p) => p.equipment_modules ?? []);
  const allSequences = partials.flatMap((p) => p.process_sequences);
  const allAlarms = partials.flatMap((p) => p.alarms);
  const allInterlocks = partials.flatMap((p) => p.interlocks);
  const allSettings = partials.flatMap((p) => p.process_settings);
  const allHardware = partials.flatMap((p) => p.hardware_rack);
  const allSubsystems = partials.flatMap((p) => p.units);

  // Deduplicate
  const control_modules = deduplicateDevices(allDevices);
  const equipment_modules = deduplicateAssemblies(allAssemblies);
  const alarms = deduplicateAlarms(allAlarms);
  const interlocks = deduplicateInterlocks(allInterlocks);
  const processSettings = deduplicateSettings(allSettings);
  const hardwareRack = deduplicateHardware(allHardware);
  const units = deduplicateSubsystems(allSubsystems);

  // Assign sequential IDs
  control_modules.forEach((d, i) => {
    d.id = `DEV${String(i + 1).padStart(3, "0")}`;
  });
  equipment_modules.forEach((a, i) => {
    a.id = `ASM${String(i + 1).padStart(3, "0")}`;
  });

  return {
    project_name: survey.project_name,
    project_description: survey.project_description,
    plc_type: survey.plc_type,
    plc_order_number: survey.plc_order_number,
    hmi_type: survey.hmi_type,
    safety_classification: survey.safety_classification,
    hardware_rack: hardwareRack.length > 0 ? hardwareRack : undefined,
    process_settings: processSettings.length > 0 ? processSettings : undefined,
    fb_architecture: null,
    units,
    equipment_modules,
    control_modules,
    process_sequences: allSequences,
    alarms,
    interlocks,
  };
}

/** Deduplicate control_modules by tag (exact, case-insensitive). Keep the one with more IO signals. */
function deduplicateDevices(control_modules: SpecAnalysisDevice[]): SpecAnalysisDevice[] {
  const seen = new Map<string, SpecAnalysisDevice>();

  for (const device of control_modules) {
    const key = (device.tag || device.name).toLowerCase();
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, device);
    } else {
      // Keep the one with more IO signals
      const existingCount = (existing.io_signals ?? []).length;
      const newCount = (device.io_signals ?? []).length;
      if (newCount > existingCount) {
        seen.set(key, device);
      }
    }
  }

  return Array.from(seen.values());
}

/** Deduplicate alarms by name. Merge affected_sequences arrays. */
function deduplicateAlarms(alarms: SpecAnalysisAlarm[]): SpecAnalysisAlarm[] {
  const seen = new Map<string, SpecAnalysisAlarm>();

  for (const alarm of alarms) {
    const key = alarm.name.toLowerCase();
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { ...alarm });
    } else {
      // Merge affected_sequences
      const merged = new Set([
        ...(existing.affected_sequences ?? []),
        ...(alarm.affected_sequences ?? []),
      ]);
      existing.affected_sequences = Array.from(merged);
    }
  }

  return Array.from(seen.values());
}

/** Deduplicate interlocks by name. Merge affected_control_modules arrays. */
function deduplicateInterlocks(interlocks: SpecAnalysisInterlock[]): SpecAnalysisInterlock[] {
  const seen = new Map<string, SpecAnalysisInterlock>();

  for (const interlock of interlocks) {
    const key = interlock.name.toLowerCase();
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, { ...interlock });
    } else {
      const merged = new Set([
        ...(existing.affected_control_modules ?? []),
        ...(interlock.affected_control_modules ?? []),
      ]);
      existing.affected_control_modules = Array.from(merged);
    }
  }

  return Array.from(seen.values());
}

/** Deduplicate settings by name. Keep the entry with more non-null fields. */
function deduplicateSettings(settings: SpecAnalysisProcessSetting[]): SpecAnalysisProcessSetting[] {
  const seen = new Map<string, SpecAnalysisProcessSetting>();

  for (const setting of settings) {
    const key = setting.name.toLowerCase();
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, setting);
    } else {
      const existingScore = countNonNull(existing);
      const newScore = countNonNull(setting);
      if (newScore > existingScore) {
        seen.set(key, setting);
      }
    }
  }

  return Array.from(seen.values());
}

/** Deduplicate hardware rack by slot number. */
function deduplicateHardware(slots: SpecAnalysisHardwareSlot[]): SpecAnalysisHardwareSlot[] {
  const seen = new Map<number, SpecAnalysisHardwareSlot>();
  for (const slot of slots) {
    if (!seen.has(slot.slot)) {
      seen.set(slot.slot, slot);
    }
  }
  return Array.from(seen.values()).sort((a, b) => a.slot - b.slot);
}

/** Deduplicate units by name (case-insensitive). */
function deduplicateSubsystems(
  units: Array<{ name: string; description: string }>,
): Array<{ name: string; description: string }> {
  const seen = new Map<string, { name: string; description: string }>();
  for (const sub of units) {
    const key = sub.name.toLowerCase();
    if (!seen.has(key)) {
      seen.set(key, sub);
    }
  }
  return Array.from(seen.values());
}

/** Deduplicate equipment_modules by tag (case-insensitive). Keep the one with more control_module_ids. */
function deduplicateAssemblies(equipment_modules: SpecAnalysisAssembly[]): SpecAnalysisAssembly[] {
  const seen = new Map<string, SpecAnalysisAssembly>();

  for (const equipment_module of equipment_modules) {
    const key = (equipment_module.tag || equipment_module.name).toLowerCase();
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, equipment_module);
    } else {
      if ((equipment_module.control_module_ids ?? []).length > (existing.control_module_ids ?? []).length) {
        seen.set(key, equipment_module);
      }
    }
  }

  return Array.from(seen.values());
}

function countNonNull(obj: object): number {
  return Object.values(obj).filter((v) => v != null && v !== "").length;
}
