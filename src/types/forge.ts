export const FORGE_STEPS = {
  SPEC_UPLOAD: "spec_upload",
  PROJECT_SETUP: "project_setup",
  HARDWARE_IO: "hardware_io",
  DEVICE_CODE: "device_code",
  PROCESS_CODE: "process_code",
  HMI: "hmi",
  TIA_EXPORT: "tia_export",
} as const;

export type ForgeStep = (typeof FORGE_STEPS)[keyof typeof FORGE_STEPS];

export const FORGE_STEP_LABELS: Record<ForgeStep, string> = {
  spec_upload: "Functional Spec",
  project_setup: "Project Setup",
  hardware_io: "Hardware & IO",
  device_code: "Device Code",
  process_code: "Process Code",
  hmi: "HMI Screens",
  tia_export: "TIA Export",
};

export const FORGE_STEP_ORDER: ForgeStep[] = [
  "spec_upload",
  "project_setup",
  "hardware_io",
  "device_code",
  "process_code",
  "hmi",
  "tia_export",
];
