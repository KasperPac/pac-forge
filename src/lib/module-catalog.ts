/**
 * Static Siemens IO module catalog for S7-1200, S7-1500, and ET 200SP.
 * Used by the Hardware Config editor to populate module dropdowns
 * and by the address calculator to determine address byte counts.
 */

export type ModuleSeries = "S7-1200" | "S7-1500" | "ET200SP";

export type SignalType = "DI" | "DQ" | "AI" | "AQ" | "DI_DQ" | "AI_AQ";

export interface ModuleCatalogEntry {
  /** Siemens MLFB (order number) — unique identifier */
  mlfb: string;
  /** Display name (e.g., "SM 1221 DI 8 x 24VDC") */
  name: string;
  /** Module series */
  series: ModuleSeries;
  /** Which CPU families can use this module in the central rack */
  compatibleCpus: ("S7-1200" | "S7-1500")[];
  /** Primary signal classification */
  signalType: SignalType;
  /** Channel counts */
  diChannels: number;
  dqChannels: number;
  aiChannels: number;
  aqChannels: number;
  /** Address space consumed (bytes) */
  inputAddressBytes: number;
  outputAddressBytes: number;
  /** Short label for IO list "module" column */
  shortLabel: string;
  /** Show in "Frequently Used" section of the dropdown */
  common: boolean;
}

// ---------------------------------------------------------------------------
// S7-1200 Signal Modules (SM 12xx)
// ---------------------------------------------------------------------------
const S7_1200_MODULES: ModuleCatalogEntry[] = [
  // ── DI ──────────────────────────────────────────────────────────────────
  {
    mlfb: "6ES7221-1BF32-0XB0",
    name: "SM 1221 DI 8 x 24VDC",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "DI",
    diChannels: 8, dqChannels: 0, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 1, outputAddressBytes: 0,
    shortLabel: "DI 8", common: true,
  },
  {
    mlfb: "6ES7221-1BH32-0XB0",
    name: "SM 1221 DI 16 x 24VDC",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "DI",
    diChannels: 16, dqChannels: 0, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 2, outputAddressBytes: 0,
    shortLabel: "DI 16", common: true,
  },
  {
    mlfb: "6ES7221-3BD30-0XB0",
    name: "SM 1221 DI 8 x 120/230VAC",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "DI",
    diChannels: 8, dqChannels: 0, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 1, outputAddressBytes: 0,
    shortLabel: "DI 8 AC", common: false,
  },

  // ── DQ ──────────────────────────────────────────────────────────────────
  {
    mlfb: "6ES7222-1BF32-0XB0",
    name: "SM 1222 DQ 8 x 24VDC",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "DQ",
    diChannels: 0, dqChannels: 8, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 0, outputAddressBytes: 1,
    shortLabel: "DQ 8", common: true,
  },
  {
    mlfb: "6ES7222-1BH32-0XB0",
    name: "SM 1222 DQ 16 x 24VDC",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "DQ",
    diChannels: 0, dqChannels: 16, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 0, outputAddressBytes: 2,
    shortLabel: "DQ 16", common: true,
  },
  {
    mlfb: "6ES7222-1XF32-0XB0",
    name: "SM 1222 DQ 8 x Relay",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "DQ",
    diChannels: 0, dqChannels: 8, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 0, outputAddressBytes: 1,
    shortLabel: "RQ 8", common: true,
  },
  {
    mlfb: "6ES7222-1HH32-0XB0",
    name: "SM 1222 DQ 16 x Relay",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "DQ",
    diChannels: 0, dqChannels: 16, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 0, outputAddressBytes: 2,
    shortLabel: "RQ 16", common: false,
  },
  {
    mlfb: "6ES7222-1HD32-0XB0",
    name: "SM 1222 DQ 4 x Relay",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "DQ",
    diChannels: 0, dqChannels: 4, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 0, outputAddressBytes: 1,
    shortLabel: "RQ 4", common: false,
  },

  // ── DI/DQ Combo ─────────────────────────────────────────────────────────
  {
    mlfb: "6ES7223-1BH32-0XB0",
    name: "SM 1223 DI 8 / DQ 8 x 24VDC",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "DI_DQ",
    diChannels: 8, dqChannels: 8, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 1, outputAddressBytes: 1,
    shortLabel: "DI8/DQ8", common: true,
  },
  {
    mlfb: "6ES7223-1BL32-0XB0",
    name: "SM 1223 DI 16 / DQ 16 x 24VDC",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "DI_DQ",
    diChannels: 16, dqChannels: 16, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 2, outputAddressBytes: 2,
    shortLabel: "DI16/DQ16", common: true,
  },
  {
    mlfb: "6ES7223-1PH32-0XB0",
    name: "SM 1223 DI 8 / DQ 8 x Relay",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "DI_DQ",
    diChannels: 8, dqChannels: 8, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 1, outputAddressBytes: 1,
    shortLabel: "DI8/RQ8", common: false,
  },
  {
    mlfb: "6ES7223-1PL32-0XB0",
    name: "SM 1223 DI 16 / DQ 16 x Relay",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "DI_DQ",
    diChannels: 16, dqChannels: 16, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 2, outputAddressBytes: 2,
    shortLabel: "DI16/RQ16", common: false,
  },

  // ── AI ──────────────────────────────────────────────────────────────────
  {
    mlfb: "6ES7231-4HD32-0XB0",
    name: "SM 1231 AI 4 x 13bit U/I",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "AI",
    diChannels: 0, dqChannels: 0, aiChannels: 4, aqChannels: 0,
    inputAddressBytes: 8, outputAddressBytes: 0,
    shortLabel: "AI 4", common: true,
  },
  {
    mlfb: "6ES7231-4HF32-0XB0",
    name: "SM 1231 AI 8 x 13bit U/I",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "AI",
    diChannels: 0, dqChannels: 0, aiChannels: 8, aqChannels: 0,
    inputAddressBytes: 16, outputAddressBytes: 0,
    shortLabel: "AI 8", common: false,
  },
  {
    mlfb: "6ES7231-5PD32-0XB0",
    name: "SM 1231 AI 4 x RTD",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "AI",
    diChannels: 0, dqChannels: 0, aiChannels: 4, aqChannels: 0,
    inputAddressBytes: 8, outputAddressBytes: 0,
    shortLabel: "AI 4 RTD", common: false,
  },
  {
    mlfb: "6ES7231-5QD32-0XB0",
    name: "SM 1231 AI 4 x TC",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "AI",
    diChannels: 0, dqChannels: 0, aiChannels: 4, aqChannels: 0,
    inputAddressBytes: 8, outputAddressBytes: 0,
    shortLabel: "AI 4 TC", common: false,
  },
  {
    mlfb: "6ES7231-5PF32-0XB0",
    name: "SM 1231 AI 8 x RTD",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "AI",
    diChannels: 0, dqChannels: 0, aiChannels: 8, aqChannels: 0,
    inputAddressBytes: 16, outputAddressBytes: 0,
    shortLabel: "AI 8 RTD", common: false,
  },
  {
    mlfb: "6ES7231-5QF32-0XB0",
    name: "SM 1231 AI 8 x TC",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "AI",
    diChannels: 0, dqChannels: 0, aiChannels: 8, aqChannels: 0,
    inputAddressBytes: 16, outputAddressBytes: 0,
    shortLabel: "AI 8 TC", common: false,
  },

  // ── AQ ──────────────────────────────────────────────────────────────────
  {
    mlfb: "6ES7232-4HB32-0XB0",
    name: "SM 1232 AQ 2 x 14bit",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "AQ",
    diChannels: 0, dqChannels: 0, aiChannels: 0, aqChannels: 2,
    inputAddressBytes: 0, outputAddressBytes: 4,
    shortLabel: "AQ 2", common: true,
  },
  {
    mlfb: "6ES7232-4HD32-0XB0",
    name: "SM 1232 AQ 4 x 14bit",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "AQ",
    diChannels: 0, dqChannels: 0, aiChannels: 0, aqChannels: 4,
    inputAddressBytes: 0, outputAddressBytes: 8,
    shortLabel: "AQ 4", common: false,
  },

  // ── AI/AQ Combo ─────────────────────────────────────────────────────────
  {
    mlfb: "6ES7234-4HE32-0XB0",
    name: "SM 1234 AI 4 / AQ 2",
    series: "S7-1200", compatibleCpus: ["S7-1200"], signalType: "AI_AQ",
    diChannels: 0, dqChannels: 0, aiChannels: 4, aqChannels: 2,
    inputAddressBytes: 8, outputAddressBytes: 4,
    shortLabel: "AI4/AQ2", common: true,
  },
];

// ---------------------------------------------------------------------------
// S7-1500 Signal Modules (SM 5xx)
// ---------------------------------------------------------------------------
const S7_1500_MODULES: ModuleCatalogEntry[] = [
  // ── DI ──────────────────────────────────────────────────────────────────
  {
    mlfb: "6ES7521-1BH10-0AA0",
    name: "SM 521 DI 16 x 24VDC HF",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "DI",
    diChannels: 16, dqChannels: 0, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 2, outputAddressBytes: 0,
    shortLabel: "DI 16 HF", common: true,
  },
  {
    mlfb: "6ES7521-1BL10-0AA0",
    name: "SM 521 DI 32 x 24VDC HF",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "DI",
    diChannels: 32, dqChannels: 0, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 4, outputAddressBytes: 0,
    shortLabel: "DI 32 HF", common: true,
  },
  {
    mlfb: "6ES7521-1BH50-0AA0",
    name: "SM 521 DI 16 x 24VDC BA",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "DI",
    diChannels: 16, dqChannels: 0, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 2, outputAddressBytes: 0,
    shortLabel: "DI 16 BA", common: false,
  },
  {
    mlfb: "6ES7521-1FH00-0AA0",
    name: "SM 521 DI 16 x 120VAC",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "DI",
    diChannels: 16, dqChannels: 0, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 2, outputAddressBytes: 0,
    shortLabel: "DI 16 AC", common: false,
  },
  {
    mlfb: "6ES7521-7EH00-0AB0",
    name: "SM 521 DI 16 x 230VAC",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "DI",
    diChannels: 16, dqChannels: 0, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 2, outputAddressBytes: 0,
    shortLabel: "DI 16 230V", common: false,
  },

  // ── DQ ──────────────────────────────────────────────────────────────────
  {
    mlfb: "6ES7522-1BF00-0AB0",
    name: "SM 522 DQ 8 x 24VDC/0.5A HF",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "DQ",
    diChannels: 0, dqChannels: 8, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 0, outputAddressBytes: 1,
    shortLabel: "DQ 8 HF", common: false,
  },
  {
    mlfb: "6ES7522-1BH10-0AA0",
    name: "SM 522 DQ 16 x 24VDC/0.5A HF",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "DQ",
    diChannels: 0, dqChannels: 16, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 0, outputAddressBytes: 2,
    shortLabel: "DQ 16 HF", common: true,
  },
  {
    mlfb: "6ES7522-1BL10-0AA0",
    name: "SM 522 DQ 32 x 24VDC/0.5A HF",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "DQ",
    diChannels: 0, dqChannels: 32, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 0, outputAddressBytes: 4,
    shortLabel: "DQ 32 HF", common: true,
  },
  {
    mlfb: "6ES7522-1BH50-0AA0",
    name: "SM 522 DQ 16 x 24VDC/0.5A BA",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "DQ",
    diChannels: 0, dqChannels: 16, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 0, outputAddressBytes: 2,
    shortLabel: "DQ 16 BA", common: false,
  },
  {
    mlfb: "6ES7522-5FF00-0AB0",
    name: "SM 522 DQ 8 x 230VAC/5A Relay",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "DQ",
    diChannels: 0, dqChannels: 8, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 0, outputAddressBytes: 1,
    shortLabel: "RQ 8", common: false,
  },
  {
    mlfb: "6ES7522-5HH00-0AB0",
    name: "SM 522 DQ 16 x Relay",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "DQ",
    diChannels: 0, dqChannels: 16, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 0, outputAddressBytes: 2,
    shortLabel: "RQ 16", common: false,
  },

  // ── DI/DQ Combo ─────────────────────────────────────────────────────────
  {
    mlfb: "6ES7523-1BL00-0AA0",
    name: "SM 523 DI 16 / DQ 16 x 24VDC",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "DI_DQ",
    diChannels: 16, dqChannels: 16, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 2, outputAddressBytes: 2,
    shortLabel: "DI16/DQ16", common: true,
  },
  {
    mlfb: "6ES7523-1BF00-0AA0",
    name: "SM 523 DI 8 / DQ 8 x 24VDC",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "DI_DQ",
    diChannels: 8, dqChannels: 8, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 1, outputAddressBytes: 1,
    shortLabel: "DI8/DQ8", common: false,
  },

  // ── AI ──────────────────────────────────────────────────────────────────
  {
    mlfb: "6ES7531-7KF00-0AB0",
    name: "SM 531 AI 8 x U/I/RTD/TC HF",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "AI",
    diChannels: 0, dqChannels: 0, aiChannels: 8, aqChannels: 0,
    inputAddressBytes: 16, outputAddressBytes: 0,
    shortLabel: "AI 8 HF", common: true,
  },
  {
    mlfb: "6ES7531-7NF10-0AB0",
    name: "SM 531 AI 4 x U/I HS",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "AI",
    diChannels: 0, dqChannels: 0, aiChannels: 4, aqChannels: 0,
    inputAddressBytes: 8, outputAddressBytes: 0,
    shortLabel: "AI 4 HS", common: false,
  },
  {
    mlfb: "6ES7531-7PF00-0AB0",
    name: "SM 531 AI 4 x RTD/TC HF",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "AI",
    diChannels: 0, dqChannels: 0, aiChannels: 4, aqChannels: 0,
    inputAddressBytes: 8, outputAddressBytes: 0,
    shortLabel: "AI 4 RTD", common: false,
  },
  {
    mlfb: "6ES7531-7QD00-0AB0",
    name: "SM 531 AI 8 x U/I BA",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "AI",
    diChannels: 0, dqChannels: 0, aiChannels: 8, aqChannels: 0,
    inputAddressBytes: 16, outputAddressBytes: 0,
    shortLabel: "AI 8 BA", common: false,
  },

  // ── AQ ──────────────────────────────────────────────────────────────────
  {
    mlfb: "6ES7532-5HD00-0AB0",
    name: "SM 532 AQ 4 x U/I HF",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "AQ",
    diChannels: 0, dqChannels: 0, aiChannels: 0, aqChannels: 4,
    inputAddressBytes: 0, outputAddressBytes: 8,
    shortLabel: "AQ 4 HF", common: true,
  },
  {
    mlfb: "6ES7532-5HF00-0AB0",
    name: "SM 532 AQ 8 x U/I HF",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "AQ",
    diChannels: 0, dqChannels: 0, aiChannels: 0, aqChannels: 8,
    inputAddressBytes: 0, outputAddressBytes: 16,
    shortLabel: "AQ 8 HF", common: false,
  },
  {
    mlfb: "6ES7532-5NB00-0AB0",
    name: "SM 532 AQ 4 x U/I BA",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "AQ",
    diChannels: 0, dqChannels: 0, aiChannels: 0, aqChannels: 4,
    inputAddressBytes: 0, outputAddressBytes: 8,
    shortLabel: "AQ 4 BA", common: false,
  },

  // ── AI/AQ Combo ─────────────────────────────────────────────────────────
  {
    mlfb: "6ES7534-7QE00-0AB0",
    name: "SM 534 AI 4 / AQ 2 x U/I",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "AI_AQ",
    diChannels: 0, dqChannels: 0, aiChannels: 4, aqChannels: 2,
    inputAddressBytes: 8, outputAddressBytes: 4,
    shortLabel: "AI4/AQ2", common: false,
  },

  // ── F-Modules (Safety) ─────────────────────────────────────────────────
  {
    mlfb: "6ES7526-1BH00-0AB0",
    name: "SM 526 F-DI 16 x 24VDC",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "DI",
    diChannels: 16, dqChannels: 0, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 6, outputAddressBytes: 0,
    shortLabel: "F-DI 16", common: false,
  },
  {
    mlfb: "6ES7526-2BF00-0AB0",
    name: "SM 526 F-DQ 8 x 24VDC/2A",
    series: "S7-1500", compatibleCpus: ["S7-1500"], signalType: "DQ",
    diChannels: 0, dqChannels: 8, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 0, outputAddressBytes: 5,
    shortLabel: "F-DQ 8", common: false,
  },
];

// ---------------------------------------------------------------------------
// ET 200SP Modules
// ---------------------------------------------------------------------------
const ET200SP_MODULES: ModuleCatalogEntry[] = [
  // ── DI ──────────────────────────────────────────────────────────────────
  {
    mlfb: "6ES7131-6BF01-0BA0",
    name: "DI 8 x 24VDC ST",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "DI",
    diChannels: 8, dqChannels: 0, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 1, outputAddressBytes: 0,
    shortLabel: "DI 8 ST", common: true,
  },
  {
    mlfb: "6ES7131-6BH01-0BA0",
    name: "DI 16 x 24VDC ST",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "DI",
    diChannels: 16, dqChannels: 0, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 2, outputAddressBytes: 0,
    shortLabel: "DI 16 ST", common: true,
  },
  {
    mlfb: "6ES7131-6BF01-0AA0",
    name: "DI 8 x 24VDC HF",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "DI",
    diChannels: 8, dqChannels: 0, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 1, outputAddressBytes: 0,
    shortLabel: "DI 8 HF", common: false,
  },
  {
    mlfb: "6ES7131-6BH01-0AA0",
    name: "DI 16 x 24VDC HF",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "DI",
    diChannels: 16, dqChannels: 0, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 2, outputAddressBytes: 0,
    shortLabel: "DI 16 HF", common: false,
  },
  {
    mlfb: "6ES7131-6TF00-0CA0",
    name: "DI 4 x NAMUR HF",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "DI",
    diChannels: 4, dqChannels: 0, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 1, outputAddressBytes: 0,
    shortLabel: "DI 4 NAMUR", common: false,
  },

  // ── F-DI (Safety) ──────────────────────────────────────────────────────
  {
    mlfb: "6ES7136-6BA01-0CA0",
    name: "F-DI 8 x 24VDC HF",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "DI",
    diChannels: 8, dqChannels: 0, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 3, outputAddressBytes: 1,
    shortLabel: "F-DI 8", common: false,
  },

  // ── DQ ──────────────────────────────────────────────────────────────────
  {
    mlfb: "6ES7132-6BF01-0BA0",
    name: "DQ 8 x 24VDC/0.5A ST",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "DQ",
    diChannels: 0, dqChannels: 8, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 0, outputAddressBytes: 1,
    shortLabel: "DQ 8 ST", common: true,
  },
  {
    mlfb: "6ES7132-6BH01-0BA0",
    name: "DQ 16 x 24VDC/0.5A ST",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "DQ",
    diChannels: 0, dqChannels: 16, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 0, outputAddressBytes: 2,
    shortLabel: "DQ 16 ST", common: true,
  },
  {
    mlfb: "6ES7132-6BF01-0AA0",
    name: "DQ 8 x 24VDC/0.5A HF",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "DQ",
    diChannels: 0, dqChannels: 8, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 0, outputAddressBytes: 1,
    shortLabel: "DQ 8 HF", common: false,
  },
  {
    mlfb: "6ES7132-6FD01-0BA0",
    name: "DQ 4 x 24VDC/2A HF",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "DQ",
    diChannels: 0, dqChannels: 4, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 0, outputAddressBytes: 1,
    shortLabel: "DQ 4 2A", common: false,
  },
  {
    mlfb: "6ES7132-6HD01-0BB1",
    name: "DQ 8 x Relay/2A",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "DQ",
    diChannels: 0, dqChannels: 8, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 0, outputAddressBytes: 1,
    shortLabel: "RQ 8", common: false,
  },
  {
    mlfb: "6ES7132-6GD51-0BA0",
    name: "DQ 4 x Relay/2A CO",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "DQ",
    diChannels: 0, dqChannels: 4, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 0, outputAddressBytes: 1,
    shortLabel: "RQ 4", common: false,
  },

  // ── F-DQ (Safety) ──────────────────────────────────────────────────────
  {
    mlfb: "6ES7136-6DB00-0CA0",
    name: "F-DQ 4 x 24VDC/2A PP",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "DQ",
    diChannels: 0, dqChannels: 4, aiChannels: 0, aqChannels: 0,
    inputAddressBytes: 1, outputAddressBytes: 5,
    shortLabel: "F-DQ 4", common: false,
  },

  // ── AI ──────────────────────────────────────────────────────────────────
  {
    mlfb: "6ES7134-6GD01-0BA1",
    name: "AI 4 x I 2-wire ST",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "AI",
    diChannels: 0, dqChannels: 0, aiChannels: 4, aqChannels: 0,
    inputAddressBytes: 8, outputAddressBytes: 0,
    shortLabel: "AI 4xI ST", common: true,
  },
  {
    mlfb: "6ES7134-6HB00-0DA1",
    name: "AI 4 x U/I HF",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "AI",
    diChannels: 0, dqChannels: 0, aiChannels: 4, aqChannels: 0,
    inputAddressBytes: 8, outputAddressBytes: 0,
    shortLabel: "AI 4 HF", common: true,
  },
  {
    mlfb: "6ES7134-6JD00-0CA1",
    name: "AI 8 x U/I HF",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "AI",
    diChannels: 0, dqChannels: 0, aiChannels: 8, aqChannels: 0,
    inputAddressBytes: 16, outputAddressBytes: 0,
    shortLabel: "AI 8 HF", common: false,
  },
  {
    mlfb: "6ES7134-6FB00-0BA1",
    name: "AI 2 x U/I 2-wire ST",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "AI",
    diChannels: 0, dqChannels: 0, aiChannels: 2, aqChannels: 0,
    inputAddressBytes: 4, outputAddressBytes: 0,
    shortLabel: "AI 2 ST", common: false,
  },
  {
    mlfb: "6ES7134-6JF00-0CA1",
    name: "AI 4 x RTD/TC HF",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "AI",
    diChannels: 0, dqChannels: 0, aiChannels: 4, aqChannels: 0,
    inputAddressBytes: 8, outputAddressBytes: 0,
    shortLabel: "AI 4 RTD", common: false,
  },
  {
    mlfb: "6ES7134-6PA01-0BD0",
    name: "AI Energy Meter 480VAC",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "AI",
    diChannels: 0, dqChannels: 0, aiChannels: 4, aqChannels: 0,
    inputAddressBytes: 48, outputAddressBytes: 0,
    shortLabel: "AI Energy", common: false,
  },

  // ── AQ ──────────────────────────────────────────────────────────────────
  {
    mlfb: "6ES7135-6HD00-0BA1",
    name: "AQ 2 x U/I ST",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "AQ",
    diChannels: 0, dqChannels: 0, aiChannels: 0, aqChannels: 2,
    inputAddressBytes: 0, outputAddressBytes: 4,
    shortLabel: "AQ 2 ST", common: true,
  },
  {
    mlfb: "6ES7135-6HB00-0DA1",
    name: "AQ 2 x U/I HF",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "AQ",
    diChannels: 0, dqChannels: 0, aiChannels: 0, aqChannels: 2,
    inputAddressBytes: 0, outputAddressBytes: 4,
    shortLabel: "AQ 2 HF", common: false,
  },
  {
    mlfb: "6ES7135-6JD00-0CA1",
    name: "AQ 4 x U/I HF",
    series: "ET200SP", compatibleCpus: ["S7-1200", "S7-1500"], signalType: "AQ",
    diChannels: 0, dqChannels: 0, aiChannels: 0, aqChannels: 4,
    inputAddressBytes: 0, outputAddressBytes: 8,
    shortLabel: "AQ 4 HF", common: false,
  },
];

/** Full catalog of all modules */
export const MODULE_CATALOG: ModuleCatalogEntry[] = [
  ...S7_1200_MODULES,
  ...S7_1500_MODULES,
  ...ET200SP_MODULES,
];

/**
 * Resolve CPU type to its base family (ignoring F/T/TF suffixes).
 */
function cpuFamily(cpuType: string): "S7-1200" | "S7-1500" {
  return cpuType.startsWith("S7-12") ? "S7-1200" : "S7-1500";
}

/**
 * Get modules compatible with a CPU type, optionally filtered by series.
 */
export function getCompatibleModules(
  cpuType: string,
  series?: ModuleSeries,
): ModuleCatalogEntry[] {
  const family = cpuFamily(cpuType);
  return MODULE_CATALOG.filter((m) => {
    if (series && m.series !== series) return false;
    return m.compatibleCpus.includes(family);
  });
}

const SIGNAL_TYPE_LABELS: Record<SignalType, string> = {
  DI: "Digital Inputs",
  DQ: "Digital Outputs",
  AI: "Analog Inputs",
  AQ: "Analog Outputs",
  DI_DQ: "Digital Combo (DI + DQ)",
  AI_AQ: "Analog Combo (AI + AQ)",
};

const SIGNAL_TYPE_ORDER: SignalType[] = ["DI", "DQ", "DI_DQ", "AI", "AQ", "AI_AQ"];

export interface ModuleGroup {
  label: string;
  type: SignalType;
  modules: ModuleCatalogEntry[];
}

/**
 * Group modules by signal type for dropdown display.
 */
export function groupModulesBySignalType(modules: ModuleCatalogEntry[]): ModuleGroup[] {
  const groups = new Map<SignalType, ModuleCatalogEntry[]>();
  for (const m of modules) {
    const list = groups.get(m.signalType) ?? [];
    list.push(m);
    groups.set(m.signalType, list);
  }
  return SIGNAL_TYPE_ORDER
    .filter((t) => groups.has(t))
    .map((t) => ({
      label: SIGNAL_TYPE_LABELS[t],
      type: t,
      modules: groups.get(t)!,
    }));
}

/**
 * Look up a module by its MLFB (order number).
 */
export function getModuleByMlfb(mlfb: string): ModuleCatalogEntry | undefined {
  return MODULE_CATALOG.find((m) => m.mlfb === mlfb);
}
