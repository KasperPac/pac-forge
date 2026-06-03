import * as XLSX from "xlsx";

/** Column headers for the Register sheet, in order. Must stay in sync with
 *  CANONICAL_COLUMN_NAMES so the parser detects every column. */
export const REGISTER_TEMPLATE_HEADERS = [
  "tag",
  "description",
  "io_address",
  "signal_type",
  "device",
  "assembly",
  "subsystem",
  "device_type",
  "is_safety",
] as const;

const EXAMPLE_ROWS: string[][] = [
  ["CV01_M1_CMD", "Conveyor CV01 run command", "%Q0.0", "DO", "M1", "Conveyor CV01", "", "Motor", "FALSE"],
  ["CV01_M1_FB", "Conveyor CV01 run feedback", "%I0.0", "DI", "M1", "Conveyor CV01", "", "Motor", "FALSE"],
  ["CV01_PE1", "Conveyor CV01 jam photo-eye", "%I0.1", "DI", "PE1", "Conveyor CV01", "", "Sensor", "FALSE"],
];

const INSTRUCTIONS: string[][] = [
  ["Pac-Forge Instrument Register Template"],
  [""],
  ["Fill in the Register sheet. One row per signal. The hierarchy is extracted"],
  ["deterministically from the columns below — no AI is used for structure."],
  [""],
  ["Column", "Required", "Meaning / allowed values"],
  ["tag", "Yes", "The signal tag."],
  ["description", "Yes", "Human-readable description."],
  ["io_address", "No", "PLC address e.g. %I0.0 / %Q0.1. Blank for network/derived."],
  ["signal_type", "Yes", "One of: DI, DO, AI, AO."],
  ["device", "Yes", "Groups signals onto one device, e.g. M1, VSD1. Same device = same value."],
  ["assembly", "Yes", "Equipment module the device belongs to, e.g. Conveyor CV01, Carriage."],
  ["subsystem", "No", "Leave BLANK for a single-machine job. Fill ONLY when groups of"],
  ["", "", "assemblies run under independent operating sequences (e.g. Infeed vs Outfeed)."],
  ["device_type", "No", "Device kind for FB selection, e.g. Motor, Sensor, VSD, Push Button."],
  ["is_safety", "No", "TRUE or FALSE. Marks safety-critical signals."],
  [""],
  ["Hierarchy: System (the machine) > Subsystem (Unit) > Assembly (Equipment Module) > Device (Control Module)."],
  ["Default is ONE subsystem. Only add subsystems for independent operating sequences."],
];

/** Build the two-sheet register template workbook. */
export function buildRegisterTemplateWorkbook(): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  const instructions = XLSX.utils.aoa_to_sheet(INSTRUCTIONS);
  XLSX.utils.book_append_sheet(wb, instructions, "Instructions");

  const register = XLSX.utils.aoa_to_sheet([
    [...REGISTER_TEMPLATE_HEADERS],
    ...EXAMPLE_ROWS,
  ]);
  XLSX.utils.book_append_sheet(wb, register, "Register");

  return wb;
}

/** Serialize the template workbook to an .xlsx Blob for download. */
export function buildRegisterTemplateBlob(): Blob {
  const wb = buildRegisterTemplateWorkbook();
  const data = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return new Blob([data], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
