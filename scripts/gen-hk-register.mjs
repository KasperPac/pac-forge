// Generates a pre-filled HK Segment Wagon register in the Pac-Forge template
// format (Register + Instructions sheets). IO sourced from the electrical
// drawings (Herrenknecht - Segment Wagon.pdf). 35 hardwired IO points.
// Hierarchy: 1 subsystem (whole wagon) -> 4 assemblies -> 18 devices.
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx");

const HEADERS = [
  "tag", "description", "io_address", "signal_type",
  "device", "assembly", "subsystem", "device_type", "is_safety",
];

// rows: [tag, description, io_address, signal_type, device, assembly, subsystem, device_type, is_safety]
const ROWS = [
  // Carriage (assembly): VSD1 (braking resistor fault folded onto VSD1), M1-M4, K1 brake, LS1 limit
  ["VSD1_CB_TRIP", "VSD1 circuit breaker trip (Q2)", "%I0.4", "DI", "VSD1", "Carriage", "", "VSD", "FALSE"],
  ["VSD1_BR_FAULT", "Carriage braking resistor fault", "%I0.3", "DI", "VSD1", "Carriage", "", "VSD", "FALSE"],
  ["M1_FAULT", "Carriage motor 1 overload (Q3)", "%I0.5", "DI", "M1", "Carriage", "", "Motor", "FALSE"],
  ["M2_FAULT", "Carriage motor 2 overload (Q4)", "%I0.6", "DI", "M2", "Carriage", "", "Motor", "FALSE"],
  ["M3_FAULT", "Carriage motor 3 overload (Q5)", "%I0.7", "DI", "M3", "Carriage", "", "Motor", "FALSE"],
  ["M4_FAULT", "Carriage motor 4 overload (Q6)", "%I1.0", "DI", "M4", "Carriage", "", "Motor", "FALSE"],
  ["M1_THERM", "Carriage M1 thermistor fault (T1)", "%I1.1", "DI", "M1", "Carriage", "", "Motor", "FALSE"],
  ["M2_THERM", "Carriage M2 thermistor fault (T2)", "%I1.2", "DI", "M2", "Carriage", "", "Motor", "FALSE"],
  ["M3_THERM", "Carriage M3 thermistor fault (T3)", "%I1.3", "DI", "M3", "Carriage", "", "Motor", "FALSE"],
  ["M4_THERM", "Carriage M4 thermistor fault (T4)", "%I1.4", "DI", "M4", "Carriage", "", "Motor", "FALSE"],
  ["K1_BRAKE_OPEN", "Carriage brake open feedback (K1)", "%I1.5", "DI", "K1", "Carriage", "", "Brake Contactor", "FALSE"],
  ["K1_BRAKE_FAULT", "Carriage brake fault (Q7)", "%I2.0", "DI", "K1", "Carriage", "", "Brake Contactor", "FALSE"],
  ["LS1_LIMIT", "Longitudinal limit-stop", "%I4.0", "DI", "LS1", "Carriage", "", "Limit Switch", "FALSE"],
  // Rotator (assembly): VSD2 (braking resistor fault folded onto VSD2), M5, K2 brake
  ["VSD2_CB_TRIP", "Rotator VSD2 circuit breaker trip (Q8)", "%I2.6", "DI", "VSD2", "Rotator", "", "VSD", "FALSE"],
  ["VSD2_BR_FAULT", "Rotator braking resistor fault", "%I2.5", "DI", "VSD2", "Rotator", "", "VSD", "FALSE"],
  ["M5_THERM", "Rotator motor M5 thermistor fault (T5)", "%I2.7", "DI", "M5", "Rotator", "", "Motor", "FALSE"],
  ["K2_BRAKE_OPEN", "Rotator brake open feedback (K2)", "%I3.0", "DI", "K2", "Rotator", "", "Brake Contactor", "FALSE"],
  ["K2_BRAKE_FAULT", "Rotator brake fault (Q9)", "%I3.1", "DI", "K2", "Rotator", "", "Brake Contactor", "FALSE"],
  // Safety (assembly): ECB1, SR1, MS1, ES1
  ["ECB_TRIP", "ECB distribution trip", "%I0.0", "DI", "ECB1", "Safety", "", "Distribution", "TRUE"],
  ["SR1_HEALTHY", "Safety relay healthy (PSR)", "%I0.1", "DI", "SR1", "Safety", "", "Safety Relay", "TRUE"],
  ["MS1_HEALTHY", "Maintenance switch healthy", "%I0.2", "DI", "MS1", "Safety", "", "Maintenance Switch", "TRUE"],
  ["ES1_HEALTHY", "E-stop circuit healthy", "%I2.4", "DI", "ES1", "Safety", "", "Emergency Stop", "TRUE"],
  ["ECB_RESET", "Reset ECB distribution", "%Q0.0", "DO", "ECB1", "Safety", "", "Distribution", "FALSE"],
  ["SR1_RESET", "Reset safety relay", "%Q0.1", "DO", "SR1", "Safety", "", "Safety Relay", "FALSE"],
  // Operator Interface (assembly): REMOTE (wireless; wired pendant is a no-IO backup sharing these inputs), HORN, STROBE, RESET_PB
  ["RESET_PB", "Reset pushbutton", "%I2.3", "DI", "RESET_PB", "Operator Interface", "", "Push Button", "FALSE"],
  ["CTRL_FWD", "Forward", "%I3.2", "DI", "REMOTE", "Operator Interface", "", "Wireless Remote", "FALSE"],
  ["CTRL_FWD_FAST", "Forward fast motion", "%I3.3", "DI", "REMOTE", "Operator Interface", "", "Wireless Remote", "FALSE"],
  ["CTRL_REV", "Reverse", "%I3.4", "DI", "REMOTE", "Operator Interface", "", "Wireless Remote", "FALSE"],
  ["CTRL_REV_FAST", "Reverse fast motion", "%I3.5", "DI", "REMOTE", "Operator Interface", "", "Wireless Remote", "FALSE"],
  ["CTRL_ROT_L", "Rotate left", "%I2.1", "DI", "REMOTE", "Operator Interface", "", "Wireless Remote", "FALSE"],
  ["CTRL_ROT_L_FAST", "Rotate left fast motion", "%I2.2", "DI", "REMOTE", "Operator Interface", "", "Wireless Remote", "FALSE"],
  ["CTRL_ROT_R", "Rotate right", "%I3.6", "DI", "REMOTE", "Operator Interface", "", "Wireless Remote", "FALSE"],
  ["CTRL_ROT_R_FAST", "Rotate right fast motion", "%I3.7", "DI", "REMOTE", "Operator Interface", "", "Wireless Remote", "FALSE"],
  ["TRAVEL_HORN", "Travel warning horn", "%Q0.2", "DO", "HORN", "Operator Interface", "", "Horn", "FALSE"],
  ["TRAVEL_STROBE", "Travel warning strobe", "%Q0.3", "DO", "STROBE", "Operator Interface", "", "Beacon", "FALSE"],
];

const INSTRUCTIONS = [
  ["Pac-Forge Instrument Register — Herrenknecht SRL Segment Wagon"],
  [""],
  ["IO extracted from the electrical drawings (Herrenknecht - Segment Wagon.pdf)."],
  ["35 hardwired IO points (31 DI + 4 DO). Hierarchy: 1 subsystem, 4 assemblies, 18 devices."],
  ["Hierarchy is extracted deterministically from the columns below — no AI for structure."],
  [""],
  ["Column", "Required", "Meaning / allowed values"],
  ["tag", "Yes", "The signal tag."],
  ["description", "Yes", "Human-readable description."],
  ["io_address", "No", "PLC address e.g. %I0.0 / %Q0.1."],
  ["signal_type", "Yes", "One of: DI, DO, AI, AO."],
  ["device", "Yes", "Groups signals onto one device, e.g. M1, VSD1, REMOTE."],
  ["assembly", "Yes", "Equipment module: Carriage, Rotator, Safety, Operator Interface."],
  ["subsystem", "No", "BLANK = one subsystem (whole wagon). Fill only for independent operating sequences."],
  ["device_type", "No", "Device kind for FB selection."],
  ["is_safety", "No", "TRUE or FALSE."],
  [""],
  ["NOTE: VSD1/VSD2 run/speed/direction and ENC1/ENC2 are PROFINET (not hardwired IO) — excluded."],
  ["NOTE: the wired pendant is a plug-in backup sharing the wireless remote's inputs, so it has no own IO."],
];

const wb = XLSX.utils.book_new();
// Register MUST be the first sheet — the parser reads SheetNames[0].
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HEADERS, ...ROWS]), "Register");
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(INSTRUCTIONS), "Instructions");

const out = "scripts/hk-segment-wagon-register.xlsx";
XLSX.writeFile(wb, out);
console.log(`Wrote ${out} — ${ROWS.length} IO rows.`);
