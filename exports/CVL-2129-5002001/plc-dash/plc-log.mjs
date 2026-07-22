// plc-log.mjs — decoder for the PLC-side event ring buffer (EVENT_LOG_DB,
// written by the EVENT_LOGGER FB — see plc-logger/EVENT_LOGGER_PKG.scl rev 2).
// Cat/Code map MUST stay in sync with the SCL package header.
export const PLC_LOG = { db: "EVENT_LOG_DB", size: 500, entryMembers: ["Seq", "DateNum", "TimeNum", "Cat", "Code", "Val", "Val2", "Info"] };

const CATS = { 1: "mode", 2: "lift-a", 3: "lift-b", 4: "pallet", 5: "device", 6: "fault", 7: "fault" };

const dur = (ms) => ms == null || ms <= 0 ? "" : ms < 10_000 ? `${ms} ms` : ms < 600_000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60_000)} min`;
const active = (ms) => (dur(ms) ? ` — was active ${dur(ms)}` : "");

const LIFT = (cat) => (cat === 2 ? "A" : "B");
function describe(cat, code, val, val2, info) {
  const L = LIFT(cat);
  if (cat === 1) return {
    1: ["warn", "System mode → MANUAL"], 2: ["info", "System mode → SEMI-AUTO"], 3: ["info", "System mode → AUTOMATIC"],
    4: ["info", "System RUNNING"], 5: ["info", "System STOPPED"], 6: ["warn", "PLC error status set"],
    7: ["warn", "Event logger started (PLC restart or download)"] }[code];
  if (cat === 2 || cat === 3) return {
    10: ["info", `Elevator ${L} mode → ${val}`],
    11: ["fault", `Elevator ${L} FAULT`], 12: ["info", `Elevator ${L} fault cleared${active(val2)}`],
    13: ["fault", `Elevator ${L} encoder fault`], 14: ["fault", `Elevator ${L} motor-sync fault`], 15: ["fault", `Elevator ${L} stop-prox fault`],
    16: ["fault", `Elevator ${L} encoder fault (code ${val})`], 17: ["fault", `Elevator ${L} locking-pin fault (code ${val})`],
    18: ["fault", `Elevator ${L} chain fault (code ${val})`], 19: ["fault", `Elevator ${L} stop-prox fault (code ${val})`],
    20: ["info", `Pallet ENTERED elevator ${L} (level ${val}${info ? ", " + info : ""})`],
    21: ["info", `Pallet LEFT elevator ${L} (level ${val})`],
    22: ["info", `Pallet onto elevator-${L} carriage (level ${val}${info ? ", " + info : ""})`],
    23: ["info", `Pallet off elevator-${L} carriage (level ${val})`],
    24: ["info", `Barcode validated: ${info}`], 25: ["warn", `Barcode read FAIL at dimensioner ${L}`],
    26: ["warn", "Pallet-on-infeed fault (F38)"],
    27: ["info", `Elevator ${L}: task ${val} received (${info || "?"}, step ${val2})`],
    28: ["info", `Elevator ${L}: task ${val} status sent${info ? ": " + info : ""}`],
    29: ["warn", `Elevator ${L}: task step ${val2} reason ${val}${info ? " — " + info : ""}`],
    33: ["info", `Elevator ${L} sequence step → ${val} (prev step ${dur(val2) || "?"})`],
    34: ["info", `Elevator ${L} conveyor step → ${val} (prev step ${dur(val2) || "?"})`] }[code];
  if (cat === 4) return { 30: ["info", `Pallet onto position ${val}`], 31: ["info", `Pallet off position ${val}`] }[code];
  if (cat === 5) return { 40: ["warn", `Drive ${info || "?"}: status → ${val}`] }[code];
  if (cat === 6) return { 50: ["fault", "SAFETY CHAIN TRIPPED"], 51: ["info", `Safety chain restored${active(val2)}`], 52: ["fault", "MAJOR FAULT active"] }[code];
  if (cat === 7) return { 60: ["warn", "Comms error active"], 61: ["info", `Comms error cleared${active(val2)}`] }[code];
  return null;
}

// DateNum YYYYMMDD + TimeNum HHMMSSmmm (PLC local time) -> ISO string
function stampToIso(dateNum, timeNum) {
  const d = Number(dateNum), t = Number(timeNum);
  if (!d || d < 20000101) return new Date().toISOString();
  const dt = new Date(Math.floor(d / 10000), Math.floor(d / 100) % 100 - 1, d % 100,
    Math.floor(t / 10000000), Math.floor(t / 100000) % 100, Math.floor(t / 1000) % 100, t % 1000);
  return dt.toISOString();
}

export function decodeEntry(e) {
  const known = describe(e.Cat, e.Code, e.Val, e.Val2, e.Info);
  const [sev, text] = known ?? ["info", `PLC event cat=${e.Cat} code=${e.Code} val=${e.Val}/${e.Val2} ${e.Info ?? ""}`];
  return { ts: stampToIso(e.DateNum, e.TimeNum), cat: CATS[e.Cat] ?? "system", sev, text, seq: e.Seq, source: "plc" };
}
