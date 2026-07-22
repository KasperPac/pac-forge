// events-config.mjs — event rules for the CVL-2129 dashboard logger.
// Every var here was verified against the project extract (2026-07-21).
// Rule shape: { var, on: rise|fall|change|nonzero, cat, sev, text(v, prev, V, names), ctx? }
//   - rise/fall: Bool edges. change: any value delta. nonzero: change landing on a value ≠ 0.
//   - transitions involving null (comm loss / first poll) are never logged.
//   - ctx: extra ids snapshotted onto the event (they are polled too).
//
// "Who authorised Manual": the PLC has no user member — the HMI never mirrors
// its logged-in user. If that is ever added (e.g. DB_HMI_SYS.CurrentUser via an
// HMI user-change script), set USER_VAR to its id and mode events pick it up.
export const USER_VAR = null; // e.g. "DB_HMI_SYS.CurrentUser"

const SYS = "DB_HMI_SYS";
const ELV = { A: { db: "mk10_elevator_DB_A", faults: "ELV_A_Faults", lvl: `${SYS}.HMI_SYS_Elevator01CurrentLevel`, okBit: `${SYS}.HMI_SYS_Elevator01_Fault_Status_Ok` },
              B: { db: "mk10_elevator_DB_B", faults: null,           lvl: `${SYS}.HMI_SYS_Elevator02CurrentLevel`, okBit: `${SYS}.HMI_SYS_Elevator02_Fault_Status_Ok` } };

// pallet identity snapshot for elevator-A events (PTF02 = barcode validation,
// PTF03 = transport task). Elevator B has its own PTF instance DBs.
const PALLET_CTX_A = ["PTF02_DB_ELV_A.CheckedBarcodeStr", "PTF03_DB_ELV_A.TaskNo", "PTF03_DB_ELV_A.StartPosition", "PTF03_DB_ELV_A.TargetPosition"];
const PALLET_CTX_B = ["PTF03_DB_ELV_B.TaskNo", "PTF03_DB_ELV_B.StartPosition", "PTF03_DB_ELV_B.TargetPosition"];

// Feed_Control named conveyor structs (ConveyorControl UDT)
export const CONVEYORS = ["CB_1A", "CB_2A", "CB_3A", "CB_4A", "CB_5A",
  "CB_1B", "CB_2B", "CB_3B", "CB_4B", "CB_5B", "CB_6B",
  "HO_1B", "HO_2B", "HO_3B", "HO_4B", "HO_5B", "HO_6B", "HO_7B", "HO_8B", "HO_9B", "ELV_B"];

// device status/name parallel arrays in DB_HMI_SYS (drives; index 0 unused)
export const DEVICE_STATUS = { statusVar: (i) => `${SYS}.HMI_DEV_VSD_MOT_STATUS[${i}]`, nameVar: (i) => `${SYS}.HMI_DEV_VSD_MOT_TAG[${i}]`, from: 1, to: 50 };

const userSuffix = (V) => (USER_VAR && V[USER_VAR] ? ` (user: ${V[USER_VAR]})` : "");

export const RULES = [
  // ---- system modes -------------------------------------------------------
  { var: `${SYS}.HMI_SYS_Manual`, on: "rise", cat: "mode", sev: "warn", text: (v, p, V) => `System mode → MANUAL${userSuffix(V)}` },
  { var: `${SYS}.HMI_SYS_SemiAutomatic`, on: "rise", cat: "mode", sev: "info", text: (v, p, V) => `System mode → SEMI-AUTO${userSuffix(V)}` },
  { var: `${SYS}.HMI_SYS_Automatic`, on: "rise", cat: "mode", sev: "info", text: (v, p, V) => `System mode → AUTOMATIC${userSuffix(V)}` },
  { var: `${SYS}.HMI_SYS_Running`, on: "rise", cat: "mode", sev: "info", text: () => "System RUNNING" },
  { var: `${SYS}.HMI_SYS_Stopped`, on: "rise", cat: "mode", sev: "info", text: (v, p, V) => `System STOPPED${userSuffix(V)}` },
  { var: `${ELV.A.db}.Mode_Actual`, on: "change", cat: "mode", sev: "info", text: (v, p) => `Elevator A mode ${p} → ${v}` },
  { var: `${ELV.B.db}.Mode_Actual`, on: "change", cat: "mode", sev: "info", text: (v, p) => `Elevator B mode ${p} → ${v}` },

  // ---- pallets at the elevators ------------------------------------------
  { var: `${SYS}.HMI_INFEEDOUTFEED_EL_A_PalletOnConveyor`, on: "rise", cat: "pallet", sev: "info", ctx: [ELV.A.lvl, ...PALLET_CTX_A], text: () => "Pallet ENTERED elevator-A infeed/outfeed conveyor" },
  { var: `${SYS}.HMI_INFEEDOUTFEED_EL_A_PalletOnConveyor`, on: "fall", cat: "pallet", sev: "info", ctx: [ELV.A.lvl, ...PALLET_CTX_A], text: () => "Pallet LEFT elevator-A infeed/outfeed conveyor" },
  { var: `${SYS}.HMI_INFEEDOUTFEED_EL_B_PalletOnConveyor`, on: "rise", cat: "pallet", sev: "info", ctx: [ELV.B.lvl, ...PALLET_CTX_B], text: () => "Pallet ENTERED elevator-B infeed/outfeed conveyor" },
  { var: `${SYS}.HMI_INFEEDOUTFEED_EL_B_PalletOnConveyor`, on: "fall", cat: "pallet", sev: "info", ctx: [ELV.B.lvl, ...PALLET_CTX_B], text: () => "Pallet LEFT elevator-B infeed/outfeed conveyor" },
  // on the elevator-A lift carriage itself (sensor pair on the lift conveyor)
  { var: "Lift_A_mk10_conveyor_DB.S1", on: "rise", cat: "pallet", sev: "info", ctx: [ELV.A.lvl, ...PALLET_CTX_A], text: (v, p, V) => `Pallet onto elevator-A carriage (level ${V[ELV.A.lvl] ?? "?"})` },
  { var: "Lift_A_mk10_conveyor_DB.S2", on: "fall", cat: "pallet", sev: "info", ctx: [ELV.A.lvl, ...PALLET_CTX_A], text: (v, p, V) => `Pallet off elevator-A carriage (level ${V[ELV.A.lvl] ?? "?"})` },
  // barcode validation results at the dimensioner
  { var: "PTF02_DB_ELV_A.BarcodeChecked", on: "rise", cat: "pallet", sev: "info", ctx: ["PTF02_DB_ELV_A.CheckedBarcodeStr", "PTF02_DB_ELV_A.RejetReason"], text: (v, p, V) => `Barcode validated: ${V["PTF02_DB_ELV_A.CheckedBarcodeStr"] ?? "?"}` },
  { var: `${SYS}.HMI_DIMENSION_A_BARCODE_FAIL`, on: "rise", cat: "pallet", sev: "warn", text: () => "Barcode read FAIL at dimensioner A" },

  // ---- per-conveyor occupancy + manual runs (generated below) -------------
  ...CONVEYORS.flatMap((c) => [
    { var: `Feed_Control.${c}.PalletOnConveyor`, on: "rise", cat: "pallet", sev: "info", text: () => `Pallet onto ${c}` },
    { var: `Feed_Control.${c}.PalletOnConveyor`, on: "fall", cat: "pallet", sev: "info", text: () => `Pallet off ${c}` },
    { var: `Feed_Control.${c}.Run_Manual`, on: "rise", cat: "mode", sev: "warn", text: (v, p, V) => `Conveyor ${c} run in MANUAL${userSuffix(V)}` },
  ]),

  // ---- faults -------------------------------------------------------------
  { var: `${SYS}.HMI_SYS_Safety_Healthy`, on: "fall", cat: "fault", sev: "fault", text: () => "SAFETY CHAIN TRIPPED" },
  { var: `${SYS}.HMI_SYS_Safety_Healthy`, on: "rise", cat: "fault", sev: "info", text: () => "Safety chain restored" },
  { var: `${SYS}.HMI_MajorFault`, on: "rise", cat: "fault", sev: "fault", text: () => "MAJOR FAULT active" },
  { var: `${SYS}.HMI_COMM_Error`, on: "rise", cat: "fault", sev: "warn", text: () => "Comms error (WMS/shuttle link)" },
  { var: `${SYS}.HMI_PLC_Error_Status`, on: "rise", cat: "fault", sev: "warn", text: () => "PLC error status set" },
  { var: ELV.A.okBit, on: "fall", cat: "fault", sev: "fault", ctx: [ELV.A.lvl], text: () => "Elevator A FAULT" },
  { var: ELV.A.okBit, on: "rise", cat: "fault", sev: "info", text: () => "Elevator A fault cleared" },
  { var: ELV.B.okBit, on: "fall", cat: "fault", sev: "fault", ctx: [ELV.B.lvl], text: () => "Elevator B FAULT" },
  { var: ELV.B.okBit, on: "rise", cat: "fault", sev: "info", text: () => "Elevator B fault cleared" },
  { var: "ELV_A_Faults.EncoerFault", on: "nonzero", cat: "fault", sev: "fault", text: (v) => `Elevator A encoder fault (code ${v})` },
  { var: "ELV_A_Faults.LockingPins", on: "nonzero", cat: "fault", sev: "fault", text: (v) => `Elevator A locking-pin fault (code ${v})` },
  { var: "ELV_A_Faults.ChainFault", on: "nonzero", cat: "fault", sev: "fault", text: (v) => `Elevator A chain fault (code ${v})` },
  { var: "ELV_A_Faults.StopProxFault", on: "nonzero", cat: "fault", sev: "fault", text: (v) => `Elevator A stop-prox fault (code ${v})` },
  ...["A", "B"].flatMap((e) => ["EncoderFault", "MotorSyncOutFault", "StopProxFault"].map((f) => (
    { var: `${ELV[e].db}.${f}`, on: "rise", cat: "fault", sev: "fault", text: () => `Elevator ${e} ${f.replace(/Fault$/, "")} fault` }))),
  { var: "INFEED_A_PALLET_ON_INFEED", on: "rise", cat: "fault", sev: "warn", text: () => "Pallet-on-infeed A fault (F38)" },

  // ---- device (drive) status transitions — names resolved at runtime ------
  ...Array.from({ length: DEVICE_STATUS.to - DEVICE_STATUS.from + 1 }, (_, k) => {
    const i = DEVICE_STATUS.from + k;
    return { var: DEVICE_STATUS.statusVar(i), on: "change", cat: "device", sev: "warn",
      text: (v, p, V, names) => `Drive ${names?.[i] || "#" + i}: status ${p} → ${v}` };
  }),
];
