// mock-plc.mjs — offline stand-in for the S7-1500 Web API so the dashboard can
// be tested without the freezer. Answers /api/jsonrpc (Api.Login/Logout,
// PlcProgram.Read, batch-aware) over a store seeded from tags.mjs, with a
// slow animation so lamps flicker and analogs wander.
//   node mock-plc.mjs [port]      (default 9443; login = commission / test)
// Point the real server at it:
//   PLC_PORT=9443 PLC_PLAIN_HTTP=1 node server.mjs 127.0.0.1 commission test
import http from "node:http";
import { IO_TAGS } from "./tags.mjs";

const PORT = Number(process.argv[2] ?? 9443);
const USER = "commission", PASS = "test";
const sessions = new Set();

// ---- tag store seeded from the register ------------------------------------
const V = new Map();
const isBoolKind = (k) => k === "di" || k === "do";
for (const t of IO_TAGS) V.set(t.name, isBoolKind(t.kind) ? Math.random() < 0.3 : Math.round(Math.random() * 100));
// a few plausible DB members for watch-tab testing
V.set("TCP_1.Status", 7); V.set("TCP_2.Status", 7); V.set("TCP_3.Status", 0);

// ---- event-engine members (mirror events-config.mjs) ------------------------
import { CONVEYORS, DEVICE_STATUS, RULES } from "./events-config.mjs";
for (const r of RULES) if (!V.has(r.var)) V.set(r.var, /Ok|Healthy|Automatic$|Running$/.test(r.var) ? true : /Mode_Actual|Level|TaskNo|STATUS/.test(r.var) ? 2 : false);
for (const r of RULES) for (const c of r.ctx ?? []) if (!V.has(c)) V.set(c, /Level|TaskNo/.test(c) ? 1 : "");
for (let i = DEVICE_STATUS.from; i <= DEVICE_STATUS.to; i++) V.set(DEVICE_STATUS.nameVar(i), i <= 12 ? `F_PCC_${String(i).padStart(2, "0")}A` : "");
V.set("PTF02_DB_ELV_A.CheckedBarcodeStr", ""); V.set("PTF03_DB_ELV_A.StartPosition", ""); V.set("PTF03_DB_ELV_A.TargetPosition", "");

// ---- PLC ring-buffer emulation (EVENT_LOG_DB, mirrors EVENT_LOGGER_PKG.scl)
const RING = 500;
let head = 0;
V.set("EVENT_LOG_DB.Head", 0);
function plcPush(cat, code, val, info = "", val2 = 0) {
  head++;
  const i = (head - 1) % RING, d = new Date();
  const set = (m, v) => V.set(`EVENT_LOG_DB.Entries[${i}].${m}`, v);
  set("Seq", head);
  set("DateNum", d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate());
  set("TimeNum", d.getHours() * 10000000 + d.getMinutes() * 100000 + d.getSeconds() * 1000 + d.getMilliseconds());
  set("Cat", cat); set("Code", code); set("Val", val); set("Val2", val2); set("Info", info.slice(0, 32));
  V.set("EVENT_LOG_DB.Head", head);
}
plcPush(1, 7, 0); // logger-started marker, like the real FB's first scan

// scripted story: a pallet walks the CB_A line into elevator A every ~20 s,
// modes flip occasionally, a fault fires now and then — enough to fill the tab.
// Every state change ALSO lands in the ring buffer, like the real EVENT_LOGGER.
let tick = 0, palletPos = -1, palletNo = 100;
setInterval(() => {
  tick++;
  for (const t of IO_TAGS) {
    if (isBoolKind(t.kind)) { if (Math.random() < 0.01) V.set(t.name, !V.get(t.name)); }
    else V.set(t.name, Math.round((V.get(t.name) + (Math.random() - 0.5) * 4) * 10) / 10);
  }
  const LINE = ["CB_1A", "CB_2A", "CB_3A", "CB_4A", "CB_5A"];
  if (tick % 4 === 0) { // advance the pallet every 2 s
    if (palletPos >= 0 && palletPos < LINE.length) { V.set(`Feed_Control.${LINE[palletPos]}.PalletOnConveyor`, false); plcPush(4, 31, palletPos); }
    if (palletPos === LINE.length) { V.set("Lift_A_mk10_conveyor_DB.S1", false); V.set("Lift_A_mk10_conveyor_DB.S2", true); }
    if (palletPos === LINE.length + 1) {
      V.set("Lift_A_mk10_conveyor_DB.S2", false); V.set("DB_HMI_SYS.HMI_INFEEDOUTFEED_EL_A_PalletOnConveyor", false);
      const lvl = V.get("DB_HMI_SYS.HMI_SYS_Elevator01CurrentLevel");
      plcPush(2, 23, lvl); plcPush(2, 21, lvl);
      palletPos = -2;
    }
    palletPos++;
    if (palletPos === 0) {
      palletNo++;
      V.set("PTF02_DB_ELV_A.CheckedBarcodeStr", `PAL${palletNo}00042`);
      V.set("PTF02_DB_ELV_A.BarcodeChecked", true); setTimeout(() => V.set("PTF02_DB_ELV_A.BarcodeChecked", false), 3000);
      V.set("PTF03_DB_ELV_A.TaskNo", palletNo); V.set("PTF03_DB_ELV_A.StartPosition", "DIM_A"); V.set("PTF03_DB_ELV_A.TargetPosition", `L${1 + (palletNo % 9)}`);
      plcPush(2, 24, 0, `PAL${palletNo}00042`);
      plcPush(2, 27, palletNo, `DIM_A>L${1 + (palletNo % 9)}`, palletNo * 10); // task received
      plcPush(2, 33, 5 + (palletNo % 3), "", 4200); // sequence step with dwell
    }
    if (palletPos >= 0 && palletPos < LINE.length) { V.set(`Feed_Control.${LINE[palletPos]}.PalletOnConveyor`, true); plcPush(4, 30, palletPos); }
    if (palletPos === LINE.length) {
      const lvl = 1 + (palletNo % 9);
      V.set("DB_HMI_SYS.HMI_INFEEDOUTFEED_EL_A_PalletOnConveyor", true); V.set("Lift_A_mk10_conveyor_DB.S1", true);
      V.set("DB_HMI_SYS.HMI_SYS_Elevator01CurrentLevel", lvl);
      plcPush(2, 20, lvl, `PAL${palletNo}00042`); plcPush(2, 22, lvl, `PAL${palletNo}00042`);
    }
  }
  if (tick % 60 === 20) { // mode dance every 30 s
    V.set("DB_HMI_SYS.HMI_SYS_Automatic", false); V.set("DB_HMI_SYS.HMI_SYS_Manual", true); plcPush(1, 1, 0);
    setTimeout(() => { V.set("DB_HMI_SYS.HMI_SYS_Manual", false); V.set("DB_HMI_SYS.HMI_SYS_Automatic", true); plcPush(1, 3, 0); }, 8000);
  }
  if (tick % 90 === 45) { // elevator fault pulse
    V.set("DB_HMI_SYS.HMI_SYS_Elevator01_Fault_Status_Ok", false); V.set("ELV_A_Faults.ChainFault", 3);
    plcPush(2, 11, 0); plcPush(2, 18, 3);
    setTimeout(() => { V.set("DB_HMI_SYS.HMI_SYS_Elevator01_Fault_Status_Ok", true); V.set("ELV_A_Faults.ChainFault", 0); plcPush(2, 12, 0, "", 6000); }, 6000);
  }
  if (tick % 50 === 10) { // drive status blip
    const i = 1 + (tick % 12);
    V.set(DEVICE_STATUS.statusVar(i), 3); plcPush(5, 40, 3, String(V.get(DEVICE_STATUS.nameVar(i)) ?? ""));
    setTimeout(() => { V.set(DEVICE_STATUS.statusVar(i), 2); plcPush(5, 40, 2, String(V.get(DEVICE_STATUS.nameVar(i)) ?? "")); }, 4000);
  }
}, 500);

// ---- JSON-RPC --------------------------------------------------------------
http.createServer((req, res) => {
  if (req.url !== "/api/jsonrpc" || req.method !== "POST") { res.writeHead(404); return res.end(); }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let payload;
    try { payload = JSON.parse(body); } catch { res.writeHead(400); return res.end(); }
    const tokenHdr = req.headers["x-auth-token"];
    const one = (m) => {
      if (m.method === "Api.Login") {
        if (m.params?.user === USER && m.params?.password === PASS) {
          const t = "mock-" + Math.random().toString(36).slice(2);
          sessions.add(t);
          return { jsonrpc: "2.0", id: m.id, result: { token: t } };
        }
        return { jsonrpc: "2.0", id: m.id, error: { code: 100, message: "Login failed (mock expects commission/test)" } };
      }
      if (m.method === "Api.Logout") { sessions.delete(tokenHdr); return { jsonrpc: "2.0", id: m.id, result: true }; }
      if (!tokenHdr || !sessions.has(tokenHdr))
        return { jsonrpc: "2.0", id: m.id, error: { code: 1, message: "not authenticated" } };
      if (m.method === "PlcProgram.Read") {
        const id = (m.params?.var ?? "").replaceAll('"', "");
        return V.has(id) ? { jsonrpc: "2.0", id: m.id, result: V.get(id) }
                         : { jsonrpc: "2.0", id: m.id, error: { code: 200, message: `unknown var ${id}` } };
      }
      return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "method not found (mock is read-only)" } };
    };
    const out = Array.isArray(payload) ? payload.map(one) : one(payload);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out));
  });
}).listen(PORT, () => console.log(`[mock-plc] Web API on http://localhost:${PORT}/api/jsonrpc — login commission / test`));
