// mock-plc.mjs — offline stand-in for the S7-1200 G2 Web API so the PLC-hosted
// dashboard can be tested without the machine. Serves plc-dash/ at / and
// answers /api/jsonrpc for the four methods the page uses (Api.Login/Logout,
// PlcProgram.Read/Write, batch-aware) over a simulated tag store with just
// enough physics to light up every tab.
//   node mock-plc.mjs [port]        (default 8090; login = commission / test)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PORT = Number(process.argv[2] ?? 8090);
const here = path.dirname(fileURLToPath(import.meta.url));
const USER = "commission", PASS = "test";
const sessions = new Set(); // real PLC allows several concurrent sessions

// ---- tag store --------------------------------------------------------------
const V = new Map(); // plain "Tag" or "Db.member" -> value
const set = (id, v) => V.set(id, v);
const get = (id) => (V.has(id) ? V.get(id) : null);

// physical DIs (healthy machine at rest; N/C fail-safe inputs sit TRUE)
const NC_TRUE = ["SR1_Healthy", "EStop_Healthy", "CM1_Therm", "CM2_Therm", "CM3_Therm", "CM4_Therm",
  "VSD1_CB_Trip", "BR1_Fault", "VSD2_CB_Trip", "BR2_Fault", "M5_Therm", "ECB_Trip",
  "Carriage_Brake_Fault", "Rot_Brake_Fault"];
const DIS = ["ECB_Trip", "SR1_Healthy", "MS1_Healthy", "BR1_Fault", "VSD1_CB_Trip", "CM1_Fault", "CM2_Fault",
  "CM3_Fault", "CM4_Fault", "CM1_Therm", "CM2_Therm", "CM3_Therm", "CM4_Therm", "Carriage_Brake_Open",
  "Carriage_Brake_Fault", "Rotate_Left", "Rotate_Left_Fast", "Reset_PB", "EStop_Healthy", "BR2_Fault",
  "VSD2_CB_Trip", "M5_Therm", "Rot_Brake_Open", "Rot_Brake_Fault", "Fwd_Carriage", "Fwd_Fast_Carriage",
  "Rev_Carriage", "Rev_Fast_Carriage", "Rot_Right", "Rot_Right_Fast", "Long_Limit_Stop",
  "Spare_DI_1", "Spare_DI_2", "Spare_DI_3", "Spare_DI_4", "Spare_DI_5", "Spare_DI_6", "Spare_DI_7"];
for (const t of DIS) set(t, NC_TRUE.includes(t));
const DOS = ["Reset_ECB", "Reset_Safety", "Travel_Horn", "Travel_Strobe", "CM1_Run", "CM2_Run", "CM3_Run", "CM4_Run", "Carriage_Brake_Rel"];
for (const t of DOS) set(t, false);

// DBs
const MAINT_BOOLS = ["maintenance_mode", "seq_test_mode", "rot_preset_execute", "rot_preset_done",
  "rail_preset_execute", "rail_preset_done", ...DOS.map((n) => `ov_${n}`)];
for (const m of MAINT_BOOLS) set(`Maintenance_CMD.${m}`, false);
set("Maintenance_CMD.rot_preset_value", 0); set("Maintenance_CMD.rail_preset_value", 0);
["sp_JOG_SPEED_FWD", "sp_FAST_SPEED_FWD", "sp_JOG_SPEED_REV", "sp_FAST_SPEED_REV"]
  .forEach((sp, i) => set(`Carriage_Drive_CMD.${sp}`, [25, 50, -25, -50][i]));
// convention: left = negative, right = positive
["sp_JOG_SPEED_LEFT", "sp_FAST_SPEED_LEFT", "sp_JOG_SPEED_RIGHT", "sp_FAST_SPEED_RIGHT"]
  .forEach((sp, i) => set(`Rotator_Drive_CMD.${sp}`, [-25, -50, 25, 50][i]));
set("Rotator_Drive_CMD.sp_STRAIGHTEN_SPEED", 20); set("Rotator_Drive_CMD.straighten_req", false);
set("Rotator_Encoder_Pos", 500000); set("Carriage_Encoder_Pos", 3000000);
for (const m of ["mm_per_rev_x10", "rail_length_mm", "ramp_zone_mm", "end_margin_mm", "position_mm", "rot_counts_per_360", "rot_position_deg10"])
  set(`Rail_Config.${m}`, { mm_per_rev_x10: 1000, rail_length_mm: 20000, ramp_zone_mm: 2000, end_margin_mm: 300, rot_counts_per_360: 100000 }[m] ?? 0);
set("Rail_Config.rot_at_home", true);
for (const m of ["dist_to_fwd_end_mm", "dist_to_rev_end_mm"]) set(`Rail_Status.${m}`, 0);
for (const m of ["in_ramp_zone", "fwd_fast_allowed", "rev_fast_allowed", "fwd_allowed", "rev_allowed"]) set(`Rail_Status.${m}`, true);
set("Indicators_Config.horn_pre_travel_enable", true);
set("Sim_CMD.sim_enable", false); set("Sim_CMD.watchdog_kick", 0);
const SIMB = ["sim_Fwd_Carriage", "sim_Fwd_Fast_Carriage", "sim_Rev_Carriage", "sim_Rev_Fast_Carriage",
  "sim_Rotate_Left", "sim_Rotate_Left_Fast", "sim_Rot_Right", "sim_Rot_Right_Fast", "sim_Reset_PB"];
for (const m of SIMB) set(`Sim_CMD.${m}`, false);
const FORCIBLE = ["ECB_Trip", "BR1_Fault", "VSD1_CB_Trip", "CM1_Fault", "CM2_Fault", "CM3_Fault", "CM4_Fault",
  "CM1_Therm", "CM2_Therm", "CM3_Therm", "CM4_Therm", "Carriage_Brake_Open", "Carriage_Brake_Fault",
  "Rotate_Left", "Rotate_Left_Fast", "Reset_PB", "BR2_Fault", "VSD2_CB_Trip", "M5_Therm",
  "Rot_Brake_Open", "Rot_Brake_Fault", "Fwd_Carriage", "Fwd_Fast_Carriage", "Rev_Carriage",
  "Rev_Fast_Carriage", "Rot_Right", "Rot_Right_Fast", "Long_Limit_Stop"];
for (const t of FORCIBLE) { set(`Force_CMD.f_${t}`, false); set(`Force_CMD.v_${t}`, false); }
for (const db of ["SinaSpeed_Rail_DB", "SinaSpeed_Rot_DB"]) {
  set(`${db}.ActVelocity`, 0); set(`${db}.AxisEnabled`, false); set(`${db}.Error`, false);
  set(`${db}.Lockout`, false); set(`${db}.SpeedSp`, 0); set(`${db}.ZSW1`, 0x0237);
  set(`${db}.Status`, 0x7002); set(`${db}.DiagId`, 0);
}
// EMs: {db: [state list]} — index of "Execute"/"Stopped"/... varies per EM
const EMS = {
  EM_Carriage_Drive_DB: ["Aborted", "Clearing", "Stopped", "Resetting", "Idle", "Aborting", "Execute", "Stopping", "Holding", "Held", "Unholding"],
  EM_Carriage_Brake_DB: ["Aborted", "Clearing", "Stopped", "Aborting", "Resetting", "Idle", "Starting", "Execute", "Stopping"],
  EM_Carriage_Limits_DB: ["Aborted", "Resetting", "Idle", "Execute", "Stopping", "Aborting", "Stopped"],
  EM_Carriage_Pendant_DB: ["Aborted", "Clearing", "Stopped", "Resetting", "Aborting", "Idle", "Execute", "Stopping"],
  EM_Travel_Indicators_DB: ["Aborted", "Resetting", "Idle", "Aborting", "Execute", "Stopping", "Stopped"],
  EM_Rotator_Brake_DB: ["Aborted", "Clearing", "Stopped", "Resetting", "Aborting", "Idle", "Execute", "Stopping", "Holding", "Held", "Unholding"],
  EM_Rotator_Drive_DB: ["Aborted", "Clearing", "Stopped", "Resetting", "Aborting", "Idle", "Execute", "Stopping"],
  EM_Rotator_Pendant_DB: ["Aborted", "Clearing", "Stopped", "Resetting", "Idle", "Execute", "Stopping", "Aborting"],
  EM_Spare_DB: ["Aborted", "Clearing", "Stopped", "Resetting", "Aborting", "Idle", "Execute", "Stopping"],
  EM_E_Stop_Circuit_DB: ["Aborted", "Clearing", "Stopped", "Resetting", "Aborting", "Idle"],
};
const emIdx = (db, name) => EMS[db].indexOf(name);
for (const db of Object.keys(EMS)) set(`${db}.state`, emIdx(db, "Execute") >= 0 ? emIdx(db, "Execute") : 0);
set("EM_E_Stop_Circuit_DB.state", emIdx("EM_E_Stop_Circuit_DB", "Idle"));
set("EM_Carriage_Drive_DB.cmd_VSD1_Speed_Ref", 0); set("EM_Rotator_Drive_DB.cmd_VSD2_Speed_Ref", 0);
set("EM_Travel_Indicators_DB.permit_travel", true);
// EM command pins (all writable, default false)
const EM_PINS = {
  EM_Carriage_Drive_DB: { clear: "ilk_CD_CMD_CLEAR", reset: "ilk_CD_CMD_RESET", start: "ilk_CD_CMD_START", stop: "ilk_CD_CMD_STOP", hold: "ilk_CD_CMD_HOLD", unhold: "ilk_CD_CMD_UNHOLD" },
  EM_Carriage_Brake_DB: { clear: "ilk_CMD_Clear", reset: "ilk_CMD_Reset", start: "ilk_CMD_Start", stop: "ilk_CMD_Stop" },
  EM_Carriage_Limits_DB: { reset: "ilk_CLIM_CMD_Reset", start: "ilk_CLIM_CMD_Start", stop: "ilk_CLIM_CMD_Stop", abort: "ilk_CLIM_CMD_Abort" },
  EM_Carriage_Pendant_DB: { clear: "ilk_PENDANT_CMD_CLEAR", reset: "ilk_PENDANT_CMD_RESET", start: "ilk_PENDANT_CMD_START", stop: "ilk_PENDANT_CMD_STOP", abort: "ilk_PENDANT_CMD_ABORT" },
  EM_Travel_Indicators_DB: { reset: "ilk_Travel_CMD_Reset", start: "ilk_Travel_CMD_Start", stop: "ilk_Travel_CMD_Stop" },
  EM_Rotator_Brake_DB: { clear: "ilk_CMD_Clear", reset: "ilk_CMD_Reset", start: "ilk_CMD_Start", stop: "ilk_CMD_Stop", hold: "ilk_CMD_Hold", unhold: "ilk_CMD_Unhold" },
  EM_Rotator_Drive_DB: { clear: "ilk_CMD_Clear", reset: "ilk_CMD_Reset", start: "ilk_CMD_Start", stop: "ilk_CMD_Stop" },
  EM_Rotator_Pendant_DB: { clear: "ilk_CMD_CLEAR", reset: "ilk_CMD_RESET", stop: "ilk_CMD_STOP", abort: "ilk_CMD_ABORT" },
  EM_Spare_DB: { clear: "ilk_SPARE_CMD_CLEAR", reset: "ilk_SPARE_CMD_RESET", start: "ilk_SPARE_CMD_START", stop: "ilk_SPARE_CMD_STOP", abort: "ilk_SPARE_CMD_ABORT" },
};
for (const [db, pins] of Object.entries(EM_PINS)) for (const p of Object.values(pins)) set(`${db}.${p}`, false);
// seq-test pin semantics: pulse a pin -> EM walks to the state that command targets
const CMD_TARGET = { clear: "Stopped", reset: "Idle", start: "Execute", hold: "Held", unhold: "Execute", stop: "Stopped" };

// ---- physics tick (100 ms) ----------------------------------------------------
const eff = (t) => {
  if (get(`Force_CMD.f_${t}`) === true && get("Maintenance_CMD.maintenance_mode") === true) return get(`Force_CMD.v_${t}`) === true;
  const simMap = { Fwd_Carriage: "sim_Fwd_Carriage", Fwd_Fast_Carriage: "sim_Fwd_Fast_Carriage", Rev_Carriage: "sim_Rev_Carriage",
    Rev_Fast_Carriage: "sim_Rev_Fast_Carriage", Rotate_Left: "sim_Rotate_Left", Rotate_Left_Fast: "sim_Rotate_Left_Fast",
    Rot_Right: "sim_Rot_Right", Rot_Right_Fast: "sim_Rot_Right_Fast", Reset_PB: "sim_Reset_PB" };
  return get(t) === true || (simMap[t] ? get(`Sim_CMD.${simMap[t]}`) === true && get("Sim_CMD.sim_enable") === true : false);
};
setInterval(() => {
  const maint = get("Maintenance_CMD.maintenance_mode") === true;
  const seqT = get("Maintenance_CMD.seq_test_mode") === true;
  const safety = get("EStop_Healthy") === true && get("SR1_Healthy") === true;

  // EM auto-walk (coordinators) unless seq-test released
  for (const db of Object.keys(EMS)) {
    if (db === "EM_E_Stop_Circuit_DB") continue;
    if (seqT) {
      // respond to command pins: any pin TRUE -> jump to its target state
      for (const [cmd, pin] of Object.entries(EM_PINS[db] ?? {})) {
        if (get(`${db}.${pin}`) === true) {
          const t = emIdx(db, CMD_TARGET[cmd] ?? "Stopped");
          if (t >= 0) set(`${db}.state`, t);
        }
      }
    } else {
      const target = !safety ? "Aborted" : maint ? "Stopped" : "Execute";
      const t = emIdx(db, target);
      if (t >= 0 && get(`${db}.state`) !== t) set(`${db}.state`, t);
    }
  }
  set("EM_E_Stop_Circuit_DB.state", emIdx("EM_E_Stop_Circuit_DB", safety ? "Idle" : "Aborted"));

  // carriage drive: pendant/sim/force -> ref -> motion
  const armed = get("EM_Carriage_Drive_DB.state") === emIdx("EM_Carriage_Drive_DB", "Execute");
  let ref1 = 0;
  if (armed && !eff("Long_Limit_Stop")) {
    if (eff("Fwd_Fast_Carriage") && get("Rail_Config.rot_at_home") === true) ref1 = get("Carriage_Drive_CMD.sp_FAST_SPEED_FWD");
    else if (eff("Fwd_Carriage") || eff("Fwd_Fast_Carriage")) ref1 = get("Carriage_Drive_CMD.sp_JOG_SPEED_FWD");
    else if (eff("Rev_Fast_Carriage") && get("Rail_Config.rot_at_home") === true) ref1 = get("Carriage_Drive_CMD.sp_FAST_SPEED_REV");
    else if (eff("Rev_Carriage")) ref1 = get("Carriage_Drive_CMD.sp_JOG_SPEED_REV");
  }
  set("EM_Carriage_Drive_DB.cmd_VSD1_Speed_Ref", ref1);
  set("SinaSpeed_Rail_DB.AxisEnabled", ref1 !== 0);
  set("SinaSpeed_Rail_DB.ActVelocity", ref1 * 15);
  set("SinaSpeed_Rail_DB.SpeedSp", ref1 * 15);
  // position physics + envelope
  let pos = get("Rail_Config.position_mm") + ref1 * 0.8; // mm per tick, sign follows ref
  pos = Math.max(-500, Math.min(get("Rail_Config.rail_length_mm") + 500, pos));
  set("Rail_Config.position_mm", Math.round(pos));
  set("Carriage_Encoder_Pos", Math.round(pos * 10)); // matches 1000 x0.1mm/rev scale
  const len = get("Rail_Config.rail_length_mm"), margin = get("Rail_Config.end_margin_mm"), ramp = get("Rail_Config.ramp_zone_mm");
  const home = get("Rail_Config.rot_at_home") === true;
  set("Rail_Status.dist_to_fwd_end_mm", Math.round(len - margin - pos));
  set("Rail_Status.dist_to_rev_end_mm", Math.round(pos - margin));
  set("Rail_Status.fwd_allowed", pos < len - margin);
  set("Rail_Status.rev_allowed", pos > margin);
  const fwdFastZone = pos < len - ramp, revFastZone = pos > ramp;
  set("Rail_Status.in_ramp_zone", !fwdFastZone || !revFastZone);
  set("Rail_Status.fwd_fast_allowed", fwdFastZone && home);
  set("Rail_Status.rev_fast_allowed", revFastZone && home);

  // rotator drive
  const rArmed = get("EM_Rotator_Drive_DB.state") === emIdx("EM_Rotator_Drive_DB", "Execute");
  let ref2 = 0;
  if (rArmed) {
    if (eff("Rotate_Left_Fast")) ref2 = get("Rotator_Drive_CMD.sp_FAST_SPEED_LEFT");
    else if (eff("Rotate_Left")) ref2 = get("Rotator_Drive_CMD.sp_JOG_SPEED_LEFT");
    else if (eff("Rot_Right_Fast")) ref2 = get("Rotator_Drive_CMD.sp_FAST_SPEED_RIGHT");
    else if (eff("Rot_Right")) ref2 = get("Rotator_Drive_CMD.sp_JOG_SPEED_RIGHT");
    else if (get("Rotator_Drive_CMD.straighten_req") === true) {
      const d = get("Rail_Config.rot_position_deg10");
      if (Math.abs(d) <= 5) { set("Rotator_Drive_CMD.straighten_req", false); }
      else ref2 = (d > 0 ? -1 : 1) * Math.max(5, Math.min(get("Rotator_Drive_CMD.sp_STRAIGHTEN_SPEED"), Math.abs(d) * get("Rotator_Drive_CMD.sp_STRAIGHTEN_SPEED") / 300));
    }
  }
  set("EM_Rotator_Drive_DB.cmd_VSD2_Speed_Ref", Math.round(ref2));
  set("SinaSpeed_Rot_DB.AxisEnabled", ref2 !== 0);
  set("SinaSpeed_Rot_DB.ActVelocity", ref2 * 15);
  set("SinaSpeed_Rot_DB.SpeedSp", ref2 * 15);
  let deg10 = get("Rail_Config.rot_position_deg10") + ref2 * 0.4;
  deg10 = ((deg10 % 3600) + 3600) % 3600; if (deg10 > 1800) deg10 -= 3600;
  set("Rail_Config.rot_position_deg10", Math.round(deg10));
  set("Rotator_Encoder_Pos", 500000 + Math.round(deg10 * get("Rail_Config.rot_counts_per_360") / 3600));
  set("Rail_Config.rot_at_home", Math.abs(deg10) < 20 || Math.abs(deg10) > 1780);

  // encoder presets (maintenance mode, done handshake)
  for (const [ex, done, target] of [["rail_preset_execute", "rail_preset_done", "rail"], ["rot_preset_execute", "rot_preset_done", "rot"]]) {
    if (maint && get(`Maintenance_CMD.${ex}`) === true) {
      if (get(`Maintenance_CMD.${done}`) !== true) {
        if (target === "rail") { set("Rail_Config.position_mm", get("Maintenance_CMD.rail_preset_value")); set("Carriage_Encoder_Pos", get("Maintenance_CMD.rail_preset_value") * 10); }
        else { set("Rotator_Encoder_Pos", 500000 + get("Maintenance_CMD.rot_preset_value")); set("Rail_Config.rot_position_deg10", 0); }
        set(`Maintenance_CMD.${done}`, true);
      }
    } else if (get(`Maintenance_CMD.${done}`) === true && get(`Maintenance_CMD.${ex}`) !== true) {
      set(`Maintenance_CMD.${done}`, false);
    }
  }

  // output overrides drive the DOs while maintenance is active
  for (const n of DOS) set(n, maint ? get(`Maintenance_CMD.ov_${n}`) === true : n === "Travel_Strobe" ? ref1 !== 0 : false);
  set("EM_Travel_Indicators_DB.permit_travel", true);
}, 100);

// ---- HTTP -----------------------------------------------------------------
const MIME = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css" };
http.createServer((req, res) => {
  if (req.url === "/api/jsonrpc" && req.method === "POST") {
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
        const id = (m.params?.var ?? "").replaceAll('"', "");
        if (m.method === "PlcProgram.Read") {
          const v = get(id);
          return v == null ? { jsonrpc: "2.0", id: m.id, error: { code: 200, message: `unknown var ${id}` } }
                           : { jsonrpc: "2.0", id: m.id, result: v };
        }
        if (m.method === "PlcProgram.Write") { set(id, m.params.value); return { jsonrpc: "2.0", id: m.id, result: true }; }
        return { jsonrpc: "2.0", id: m.id, error: { code: -32601, message: "method not found" } };
      };
      const out = Array.isArray(payload) ? payload.map(one) : one(payload);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    });
    return;
  }
  // static: serve plc-dash/
  const file = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const p = path.join(here, file);
  if (p.startsWith(here) && fs.existsSync(p) && fs.statSync(p).isFile()) {
    res.writeHead(200, { "Content-Type": MIME[path.extname(p)] ?? "application/octet-stream" });
    res.end(fs.readFileSync(p));
  } else { res.writeHead(404); res.end(); }
}).listen(PORT, () => console.log(`[mock-plc] dashboard http://localhost:${PORT} — login commission / test`));
