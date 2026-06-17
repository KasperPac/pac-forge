// Generates a clean Segment Wagon IO register CSV with ISA-88 column headers
// the current parser maps directly (tag / equipment_module / signal_type /
// io_address / description / is_safety). control_module is derived by the
// parser from the tag prefix (matching the original register's behaviour).
//
// Tags + equipment-module grouping are the real Segment Wagon register
// (51 points). Run: node scripts/gen-segment-wagon-register.mjs
import { writeFileSync } from "node:fs";

/** equipment_module -> tags */
const GROUPS = {
  "Carriage Brake": ["Carriage_Brake_Fault", "Carriage_Brake_Open", "Carriage_Brake_Rel"],
  "Carriage Drive": [
    "CM1_Run", "CM1_Fault", "CM1_Therm", "CM2_Run", "CM2_Fault", "CM2_Therm",
    "CM3_Run", "CM3_Fault", "CM3_Therm", "CM4_Run", "CM4_Fault", "CM4_Therm",
    "BR1_Fault", "VSD1_CB_Trip", "VSD1_Speed_Ref", "VSD1_Speed_Fb",
  ],
  "Carriage Limits": ["Long_Limit_Stop"],
  "Carriage Pendant": ["Fwd_Carriage", "Fwd_Fast_Carriage", "Rev_Carriage", "Rev_Fast_Carriage"],
  "E-Stop Circuit": ["EStop_Healthy", "MS1_Healthy", "SR1_Healthy", "Reset_PB", "Reset_Safety"],
  "Power Distribution": ["ECB_Trip", "Reset_ECB"],
  "Rotator Brake": ["Rot_Brake_Fault", "Rot_Brake_Open"],
  "Rotator Drive": ["M5_Therm", "BR2_Fault", "VSD2_CB_Trip", "VSD2_Speed_Ref", "VSD2_Speed_Fb"],
  "Rotator Pendant": ["Rot_Right", "Rot_Right_Fast", "Rotate_Left", "Rotate_Left_Fast"],
  "Travel Indicators": ["Travel_Horn", "Travel_Strobe"],
  "Spare": ["Spare_DI_c1", "Spare_DI_c2", "Spare_DI_c3", "Spare_DI_c4", "Spare_DI_c5", "Spare_DI_c6", "Spare_DI_c7"],
};

const SAFETY = new Set(["EStop_Healthy", "MS1_Healthy", "SR1_Healthy", "Reset_Safety"]);

function signalType(tag) {
  if (/_Speed_Ref$/.test(tag)) return "AO";
  if (/_Speed_Fb$/.test(tag)) return "AI";
  if (/^Travel_(Horn|Strobe)$/.test(tag)) return "DO";
  return "DI";
}

const rows = [];
let di = 0, dq = 0, ai = 0, aq = 0;
function addr(t) {
  if (t === "AO") return `%QW${(aq++ * 2).toString().padStart(2, "0")}`;
  if (t === "AI") return `%IW${(ai++ * 2).toString().padStart(2, "0")}`;
  if (t === "DO") return `%Q${Math.floor(dq / 8)}.${dq++ % 8}`;
  return `%I${Math.floor(di / 8)}.${di++ % 8}`;
}

for (const [em, tags] of Object.entries(GROUPS)) {
  for (const tag of tags) {
    const st = signalType(tag);
    rows.push({
      tag,
      equipment_module: em,
      signal_type: st,
      io_address: addr(st),
      description: tag.replace(/_/g, " "),
      is_safety: SAFETY.has(tag) ? "Yes" : "No",
    });
  }
}

const headers = ["tag", "equipment_module", "signal_type", "io_address", "description", "is_safety"];
const csv = [
  headers.join(","),
  ...rows.map((r) => headers.map((h) => `"${String(r[h]).replace(/"/g, '""')}"`).join(",")),
].join("\n");

const out = "Docs/Functional Specs/Herrenknecht/Segment-Wagon-IO-Register.csv";
writeFileSync(out, csv);
console.log(`Wrote ${rows.length} tags to ${out}`);
