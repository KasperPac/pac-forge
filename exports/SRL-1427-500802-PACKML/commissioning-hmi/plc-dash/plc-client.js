// plc-client.js — in-browser replacement for server.mjs so the commissioning
// dashboard runs PLC-HOSTED (WebApp) with no laptop server. Talks same-origin
// to the S7-1200 G2 Web API at /api/jsonrpc. The UI is unchanged: it calls
// dashFetch(route, opts) with the exact same routes/shapes server.mjs served.
//
// Session discipline (G2 pool is finite, sessions linger 30 min):
//   - token cached in localStorage → reload/tab reuse the SAME session
//   - Api.Login only from the login overlay, with a 10 s cooldown
//   - only a genuine auth error clears the token (permission errors keep it)
(() => {
"use strict";

// ---- IO register (from the FDS) — mirror of server.mjs ---------------------
const DI = [
  ["ECB_Trip", "I0.0", "ECB Trip"], ["SR1_Healthy", "I0.1", "Safety Relay Healthy"],
  ["MS1_Healthy", "I0.2", "SPARE (was maint switch — removed)"], ["BR1_Fault", "I0.3", "Carriage Braking Resistor Fault"],
  ["VSD1_CB_Trip", "I0.4", "VSD1 CB Trip"], ["CM1_Fault", "I0.5", "Carriage Motor 1 OL Fault"],
  ["CM2_Fault", "I0.6", "Carriage Motor 2 OL Fault"], ["CM3_Fault", "I0.7", "Carriage Motor 3 OL Fault"],
  ["CM4_Fault", "I1.0", "Carriage Motor 4 OL Fault"], ["CM1_Therm", "I1.1", "Carriage Motor 1 Thermistor"],
  ["CM2_Therm", "I1.2", "Carriage Motor 2 Thermistor"], ["CM3_Therm", "I1.3", "Carriage Motor 3 Thermistor"],
  ["CM4_Therm", "I1.4", "Carriage Motor 4 Thermistor"], ["Carriage_Brake_Open", "I1.5", "Carriage Brake Open"],
  ["Carriage_Brake_Fault", "I2.0", "Carriage Brake Contactor Fault"], ["Rotate_Left", "I2.1", "Rotate Left"],
  ["Rotate_Left_Fast", "I2.2", "Rotate Left Fast"], ["Reset_PB", "I2.3", "Reset Pushbutton"],
  ["EStop_Healthy", "I2.4", "E-Stop Healthy"], ["BR2_Fault", "I2.5", "Rotator Braking Resistor Fault"],
  ["VSD2_CB_Trip", "I2.6", "Rotator VSD CB Trip"], ["M5_Therm", "I2.7", "Rotator Motor Thermistor"],
  ["Rot_Brake_Open", "I3.0", "Rotator Brake Open"], ["Rot_Brake_Fault", "I3.1", "Rotator Brake Contactor Fault"],
  ["Fwd_Carriage", "I3.2", "Forward Carriage"], ["Fwd_Fast_Carriage", "I3.3", "Forward Fast Carriage"],
  ["Rev_Carriage", "I3.4", "Reverse Carriage"], ["Rev_Fast_Carriage", "I3.5", "Reverse Fast Carriage"],
  ["Rot_Right", "I3.6", "Rotate Right"], ["Rot_Right_Fast", "I3.7", "Rotate Right Fast"],
  ["Long_Limit_Stop", "I4.0", "Longitudinal Limit Stop"],
  ["Spare_DI_1", "I4.1", "Spare"], ["Spare_DI_2", "I4.2", "Spare"], ["Spare_DI_3", "I4.3", "Spare"],
  ["Spare_DI_4", "I4.4", "Spare"], ["Spare_DI_5", "I4.5", "Spare"], ["Spare_DI_6", "I4.6", "Spare"],
  ["Spare_DI_7", "I4.7", "Spare"],
];
const DO = [
  ["Reset_ECB", "Q0.0"], ["Reset_Safety", "Q0.1"], ["Travel_Horn", "Q0.2"], ["Travel_Strobe", "Q0.3"],
  ["CM1_Run", "Q0.4"], ["CM2_Run", "Q0.5"], ["CM3_Run", "Q0.6"], ["CM4_Run", "Q0.7"],
  ["Carriage_Brake_Rel", "Q1.0"],
];
const MAINT = "Maintenance_CMD";
const MAINT_BOOLS = ["maintenance_mode", "seq_test_mode", "rot_preset_execute", "rot_preset_done", "rail_preset_execute", "rail_preset_done",
  ...DO.map(([n]) => `ov_${n}`)];
const MAINT_DINTS = ["rot_preset_value", "rail_preset_value"];
const SETPOINTS = [
  ["Carriage_Drive_CMD", ["sp_JOG_SPEED_FWD", "sp_FAST_SPEED_FWD", "sp_JOG_SPEED_REV", "sp_FAST_SPEED_REV"]],
  ["Rotator_Drive_CMD", ["sp_JOG_SPEED_LEFT", "sp_FAST_SPEED_LEFT", "sp_JOG_SPEED_RIGHT", "sp_FAST_SPEED_RIGHT"]],
];
const ENCODERS = [["Rotator_Encoder_Pos"], ["Carriage_Encoder_Pos"]];
const RAIL = "Rail_Config";
const RAIL_DINTS = ["mm_per_rev_x10", "rail_length_mm", "ramp_zone_mm", "end_margin_mm", "position_mm", "rot_counts_per_360", "rot_position_deg10"];
const RAIL_STATUS = ["dist_to_fwd_end_mm", "dist_to_rev_end_mm", "in_ramp_zone", "fwd_fast_allowed", "rev_fast_allowed", "fwd_allowed", "rev_allowed"];

const SIM = "Sim_CMD";
const SIM_BUTTONS = {
  Fwd_Carriage: "sim_Fwd_Carriage", Fwd_Fast_Carriage: "sim_Fwd_Fast_Carriage",
  Rev_Carriage: "sim_Rev_Carriage", Rev_Fast_Carriage: "sim_Rev_Fast_Carriage",
  Rotate_Left: "sim_Rotate_Left", Rotate_Left_Fast: "sim_Rotate_Left_Fast",
  Rot_Right: "sim_Rot_Right", Rot_Right_Fast: "sim_Rot_Right_Fast",
  Reset_PB: "sim_Reset_PB",
};
const sim = { held: new Set(), kick: 0 };

const FORCE = "Force_CMD";
const FORCIBLE = [
  "ECB_Trip", "BR1_Fault", "VSD1_CB_Trip", "CM1_Fault", "CM2_Fault", "CM3_Fault", "CM4_Fault",
  "CM1_Therm", "CM2_Therm", "CM3_Therm", "CM4_Therm", "Carriage_Brake_Open", "Carriage_Brake_Fault",
  "Rotate_Left", "Rotate_Left_Fast", "Reset_PB", "BR2_Fault", "VSD2_CB_Trip", "M5_Therm",
  "Rot_Brake_Open", "Rot_Brake_Fault", "Fwd_Carriage", "Fwd_Fast_Carriage", "Rev_Carriage",
  "Rev_Fast_Carriage", "Rot_Right", "Rot_Right_Fast", "Long_Limit_Stop",
];

// ---- HMI alarm mirror (same list the panel carries) -------------------------
const ALARMS = [
  ["CM1_Fault", "hi", "Fault", "Carriage motor 1 overload trip"],
  ["CM2_Fault", "hi", "Fault", "Carriage motor 2 overload trip"],
  ["CM3_Fault", "hi", "Fault", "Carriage motor 3 overload trip"],
  ["CM4_Fault", "hi", "Fault", "Carriage motor 4 overload trip"],
  ["CM1_Therm", "lo", "Fault", "Carriage motor 1 thermistor overtemperature"],
  ["CM2_Therm", "lo", "Fault", "Carriage motor 2 thermistor overtemperature"],
  ["CM3_Therm", "lo", "Fault", "Carriage motor 3 thermistor overtemperature"],
  ["CM4_Therm", "lo", "Fault", "Carriage motor 4 thermistor overtemperature"],
  ["VSD1_CB_Trip", "lo", "Fault", "Carriage VSD circuit breaker trip"],
  ["BR1_Fault", "lo", "Fault", "Carriage braking resistor fault"],
  ["VSD2_CB_Trip", "lo", "Fault", "Rotator VSD circuit breaker trip"],
  ["BR2_Fault", "lo", "Fault", "Rotator braking resistor fault"],
  ["M5_Therm", "lo", "Fault", "Rotator motor thermistor overtemperature"],
  ["ECB_Trip", "lo", "Fault", "Earth circuit breaker tripped"],
  ["Carriage_Brake_Fault", "lo", "Fault", "Carriage brake contactor fault"],
  ["Rot_Brake_Fault", "lo", "Fault", "Rotator brake contactor fault"],
  ["EStop_Healthy", "lo", "Fault", "Emergency stop active"],
  ["SR1_Healthy", "lo", "Fault", "Safety relay tripped"],
  ["Long_Limit_Stop", "hi", "Warning", "Carriage at end-of-travel limit"],
  ["SinaSpeed_Rail_DB.Error", "hi", "Fault", "Carriage drive fault — press reset"],
  ["SinaSpeed_Rot_DB.Error", "hi", "Fault", "Rotator drive fault — press reset"],
];
const alarmState = { active: {}, history: [] };
function evalAlarms() {
  for (const [tag, trig, cls, text] of ALARMS) {
    const v = state.values[tag];
    const act = v == null ? false : trig === "hi" ? v === true : v === false;
    const was = tag in alarmState.active;
    if (act && !was) {
      alarmState.active[tag] = Date.now();
      alarmState.history.push({ ts: Date.now(), tag, text, cls, kind: "raise" });
    } else if (!act && was) {
      delete alarmState.active[tag];
      alarmState.history.push({ ts: Date.now(), tag, text, cls, kind: "clear" });
    }
  }
  if (alarmState.history.length > 500) alarmState.history.splice(0, alarmState.history.length - 500);
}

// ---- EM registry ------------------------------------------------------------
const EMS = [
  { name: "Carriage Drive", db: "EM_Carriage_Drive_DB",
    pins: { clear: "ilk_CD_CMD_CLEAR", reset: "ilk_CD_CMD_RESET", start: "ilk_CD_CMD_START", stop: "ilk_CD_CMD_STOP", hold: "ilk_CD_CMD_HOLD", unhold: "ilk_CD_CMD_UNHOLD" },
    states: ["Aborted", "Clearing", "Stopped", "Resetting", "Idle", "Aborting", "Execute", "Stopping", "Holding", "Held", "Unholding"] },
  { name: "Carriage Brake", db: "EM_Carriage_Brake_DB",
    pins: { clear: "ilk_CMD_Clear", reset: "ilk_CMD_Reset", start: "ilk_CMD_Start", stop: "ilk_CMD_Stop" },
    states: ["Aborted", "Clearing", "Stopped", "Aborting", "Resetting", "Idle", "Starting", "Execute", "Stopping"] },
  { name: "Carriage Limits", db: "EM_Carriage_Limits_DB",
    pins: { reset: "ilk_CLIM_CMD_Reset", start: "ilk_CLIM_CMD_Start", stop: "ilk_CLIM_CMD_Stop", abort: "ilk_CLIM_CMD_Abort" },
    states: ["Aborted", "Resetting", "Idle", "Execute", "Stopping", "Aborting", "Stopped"] },
  { name: "Carriage Pendant", db: "EM_Carriage_Pendant_DB",
    pins: { clear: "ilk_PENDANT_CMD_CLEAR", reset: "ilk_PENDANT_CMD_RESET", start: "ilk_PENDANT_CMD_START", stop: "ilk_PENDANT_CMD_STOP", abort: "ilk_PENDANT_CMD_ABORT" },
    states: ["Aborted", "Clearing", "Stopped", "Resetting", "Aborting", "Idle", "Execute", "Stopping"] },
  { name: "Travel Indicators", db: "EM_Travel_Indicators_DB",
    pins: { reset: "ilk_Travel_CMD_Reset", start: "ilk_Travel_CMD_Start", stop: "ilk_Travel_CMD_Stop" },
    states: ["Aborted", "Resetting", "Idle", "Aborting", "Execute", "Stopping", "Stopped"] },
  { name: "Rotator Brake", db: "EM_Rotator_Brake_DB",
    pins: { clear: "ilk_CMD_Clear", reset: "ilk_CMD_Reset", start: "ilk_CMD_Start", stop: "ilk_CMD_Stop", hold: "ilk_CMD_Hold", unhold: "ilk_CMD_Unhold" },
    states: ["Aborted", "Clearing", "Stopped", "Resetting", "Aborting", "Idle", "Execute", "Stopping", "Holding", "Held", "Unholding"] },
  { name: "Rotator Drive", db: "EM_Rotator_Drive_DB",
    pins: { clear: "ilk_CMD_Clear", reset: "ilk_CMD_Reset", start: "ilk_CMD_Start", stop: "ilk_CMD_Stop" },
    states: ["Aborted", "Clearing", "Stopped", "Resetting", "Aborting", "Idle", "Execute", "Stopping"] },
  { name: "Rotator Pendant", db: "EM_Rotator_Pendant_DB",
    pins: { clear: "ilk_CMD_CLEAR", reset: "ilk_CMD_RESET", stop: "ilk_CMD_STOP", abort: "ilk_CMD_ABORT" },
    states: ["Aborted", "Clearing", "Stopped", "Resetting", "Idle", "Execute", "Stopping", "Aborting"] },
  { name: "Spare", db: "EM_Spare_DB",
    pins: { clear: "ilk_SPARE_CMD_CLEAR", reset: "ilk_SPARE_CMD_RESET", start: "ilk_SPARE_CMD_START", stop: "ilk_SPARE_CMD_STOP", abort: "ilk_SPARE_CMD_ABORT" },
    states: ["Aborted", "Clearing", "Stopped", "Resetting", "Aborting", "Idle", "Execute", "Stopping"] },
  { name: "E-Stop Circuit", db: "EM_E_Stop_Circuit_DB", pins: {},
    states: ["Aborted", "Clearing", "Stopped", "Resetting", "Aborting", "Idle"] },
];
const EM_STATES = [
  ["Carriage Drive", "EM_Carriage_Drive_DB.state"], ["Rotator Drive", "EM_Rotator_Drive_DB.state"],
  ["E-Stop Circuit", "EM_E_Stop_Circuit_DB.state"],
];
const READ_IDS = [
  ...DI.map(([n]) => n), ...DO.map(([n]) => n),
  ...MAINT_BOOLS.map((m) => `${MAINT}.${m}`), ...MAINT_DINTS.map((m) => `${MAINT}.${m}`),
  ...SETPOINTS.flatMap(([db, sps]) => sps.map((s) => `${db}.${s}`)),
  ...ENCODERS.map(([t]) => t), ...EMS.map((em) => `${em.db}.state`),
  ...RAIL_DINTS.map((m) => `${RAIL}.${m}`),
  "EM_Carriage_Drive_DB.cmd_VSD1_Speed_Ref", "EM_Rotator_Drive_DB.cmd_VSD2_Speed_Ref",
  "SinaSpeed_Rail_DB.ActVelocity", "SinaSpeed_Rail_DB.AxisEnabled", "SinaSpeed_Rail_DB.Error", "SinaSpeed_Rail_DB.Lockout",
  "SinaSpeed_Rail_DB.SpeedSp", "SinaSpeed_Rail_DB.ZSW1", "SinaSpeed_Rail_DB.Status", "SinaSpeed_Rail_DB.DiagId",
  "SinaSpeed_Rot_DB.ActVelocity", "SinaSpeed_Rot_DB.AxisEnabled", "SinaSpeed_Rot_DB.Error", "SinaSpeed_Rot_DB.Lockout",
  "SinaSpeed_Rot_DB.SpeedSp", "SinaSpeed_Rot_DB.ZSW1", "SinaSpeed_Rot_DB.Status", "SinaSpeed_Rot_DB.DiagId",
  "Rail_Config.rot_at_home",
  ...RAIL_STATUS.map((m) => `Rail_Status.${m}`),
  "Indicators_Config.horn_pre_travel_enable",
  `${SIM}.sim_enable`, ...Object.values(SIM_BUTTONS).map((m) => `${SIM}.${m}`),
  ...FORCIBLE.flatMap((t) => [`${FORCE}.f_${t}`, `${FORCE}.v_${t}`]),
  "EM_Travel_Indicators_DB.permit_travel",
  // straighten-up card (was missing from the laptop server's poll list too —
  // its permissive term always showed BLOCKING because the value never arrived)
  "Rotator_Drive_CMD.straighten_req", "Rotator_Drive_CMD.sp_STRAIGHTEN_SPEED",
];

// ---- sequence test runner ---------------------------------------------------
function defaultScript(em) {
  const s = [];
  if (em.pins.clear) s.push(["clear", ["Stopped"]]);
  if (em.pins.reset) s.push(["reset", ["Idle", "Stopped"]]);
  if (em.pins.start) s.push(["start", ["Execute"]]);
  if (em.pins.hold) s.push(["hold", ["Held"]]);
  if (em.pins.unhold) s.push(["unhold", ["Execute"]]);
  if (em.pins.stop) s.push(["stop", ["Stopped"]]);
  return s;
}
const seq = { running: false, em: null, log: [] };
const stateName = (em) => em.states[state.values[`${em.db}.state`]] ?? `#${state.values[`${em.db}.state`]}`;

async function pulseUntil(em, cmd, expect, timeoutMs) {
  const pin = `${em.db}.${em.pins[cmd]}`;
  await writeValue(pin, true);
  const t0 = Date.now();
  try {
    for (;;) {
      if (expect.includes(stateName(em))) return { ok: true, ms: Date.now() - t0 };
      if (Date.now() - t0 > timeoutMs) return { ok: false, ms: Date.now() - t0 };
      await new Promise((r) => setTimeout(r, 300));
    }
  } finally {
    await writeValue(pin, false).catch(() => {});
  }
}

async function runSequenceTest(em) {
  seq.running = true; seq.em = em.name; seq.log = [];
  try {
    if (state.values[`${MAINT}.seq_test_mode`] !== true)
      throw new Error("sequence-test mode is not active");
    for (const [cmd, expect] of defaultScript(em)) {
      seq.log.push({ cmd, expect: expect.join("/"), from: stateName(em), result: "running…" });
      const r = await pulseUntil(em, cmd, expect, 12_000);
      const entry = seq.log[seq.log.length - 1];
      entry.result = r.ok ? `PASS (${r.ms} ms)` : `FAIL — stuck in ${stateName(em)} after ${r.ms} ms`;
      if (!r.ok) break;
      await new Promise((r2) => setTimeout(r2, 600));
    }
  } catch (e) {
    seq.log.push({ cmd: "-", expect: "-", from: "-", result: `ERROR: ${e.message}` });
  } finally {
    seq.running = false;
  }
}

async function setSeqMode(on) {
  await writeValue(`${MAINT}.seq_test_mode`, on);
  if (on) {
    for (const em of EMS) for (const pin of Object.values(em.pins))
      await writeValue(`${em.db}.${pin}`, false).catch(() => {});
  }
}

const plcVar = (id) => {
  const i = id.indexOf(".");
  return i < 0 ? `"${id}"` : `"${id.slice(0, i)}"."${id.slice(i + 1)}"`;
};

// ---- JSON-RPC same-origin ---------------------------------------------------
const TOKEN_KEY = "plcdash_token";
let token = localStorage.getItem(TOKEN_KEY) || null;
const state = { connected: false, values: {}, error: null };

async function rpc(payload) {
  const r = await fetch("/api/jsonrpc", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "X-Auth-Token": token } : {}) },
    body: JSON.stringify(payload),
  });
  return r.json();
}

// auth error codes per the Web API: 1 = not authenticated / invalid token;
// 2 = permission denied (session still valid — do NOT drop it)
const isAuthError = (e) => e && (e.code === 1 || /unauthori|not authenticated|invalid token/i.test(e.message ?? ""));

let lastLoginAt = 0;
async function login(user, password) {
  const wait = lastLoginAt + 10_000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastLoginAt = Date.now();
  const r = await rpc({ jsonrpc: "2.0", id: 1, method: "Api.Login", params: { user, password } });
  if (r.error) throw new Error(r.error.message ? `${r.error.message} (code ${r.error.code})` : JSON.stringify(r.error));
  token = r.result.token;
  localStorage.setItem(TOKEN_KEY, token);
}

async function logout() {
  if (!token) return;
  try { await rpc({ jsonrpc: "2.0", id: 1, method: "Api.Logout", params: {} }); } catch {}
  token = null;
  localStorage.removeItem(TOKEN_KEY);
}

async function writeValue(id, value) {
  if (!token) throw new Error("not logged in");
  const r = await rpc({ jsonrpc: "2.0", id: 1, method: "PlcProgram.Write", params: { var: plcVar(id), value, mode: "simple" } });
  if (r.error) {
    if (isAuthError(r.error)) { token = null; localStorage.removeItem(TOKEN_KEY); showLogin(""); }
    throw new Error(`write ${id}: ${r.error.message ?? JSON.stringify(r.error)}`);
  }
}

// ---- poll loop ---------------------------------------------------------------
let polling = false;
async function pollLoop() {
  if (polling) return;
  polling = true;
  for (;;) {
    try {
      if (!token) { state.connected = false; await new Promise((r) => setTimeout(r, 500)); continue; }
      const batch = READ_IDS.map((id, i) => ({
        jsonrpc: "2.0", id: i + 1, method: "PlcProgram.Read", params: { var: plcVar(id), mode: "simple" },
      }));
      const res = await rpc(batch);
      const rows = Array.isArray(res) ? res : [res];
      const byId = new Map(rows.map((r) => [r.id, r]));
      READ_IDS.forEach((id, i) => {
        const r = byId.get(i + 1);
        state.values[id] = r && !r.error ? r.result : null;
      });
      if (rows.some((r) => isAuthError(r.error))) {
        token = null; localStorage.removeItem(TOKEN_KEY);
        showLogin("session expired — log in again");
        continue;
      }
      const denied = rows.filter((r) => r.error?.code === 2).length;
      state.connected = true;
      state.error = denied === rows.length ? "all reads: permission denied — check web server rights" : null;
      evalAlarms();
      // sim watchdog: keep the PLC-side dead-man fed only while armed
      if (state.values[`${SIM}.sim_enable`] === true) {
        sim.kick = (sim.kick + 1) % 30000;
        await writeValue(`${SIM}.watchdog_kick`, sim.kick).catch(() => {});
      }
    } catch (e) {
      state.connected = false;
      state.error = e.message;
      await new Promise((r) => setTimeout(r, 2000));
    }
    await new Promise((r) => setTimeout(r, 400));
  }
}

// ---- sim / force control ------------------------------------------------------
async function simReleaseAll() {
  sim.held.clear();
  for (const m of Object.values(SIM_BUTTONS)) await writeValue(`${SIM}.${m}`, false).catch(() => {});
}
async function simEnable(on) {
  if (on) {
    sim.kick = (sim.kick + 1) % 30000;
    await writeValue(`${SIM}.watchdog_kick`, sim.kick);
    await writeValue(`${SIM}.sim_enable`, true);
  } else {
    await simReleaseAll();
    await writeValue(`${SIM}.sim_enable`, false);
  }
}
async function simButton(tag, down) {
  const member = SIM_BUTTONS[tag];
  if (!member) throw new Error(`not a simulatable input: ${tag}`);
  if (down && state.values[`${SIM}.sim_enable`] !== true) throw new Error("sim not armed");
  if (down) sim.held.add(tag); else sim.held.delete(tag);
  await writeValue(`${SIM}.${member}`, down === true);
}
async function forceSet(tag, enable, value) {
  if (!FORCIBLE.includes(tag)) throw new Error(`not a forcible input: ${tag}`);
  if (enable && state.values[`${MAINT}.maintenance_mode`] !== true)
    throw new Error("forcing requires maintenance mode");
  await writeValue(`${FORCE}.v_${tag}`, value === true);
  await writeValue(`${FORCE}.f_${tag}`, enable === true);
}
async function forceClearAll() {
  for (const t of FORCIBLE) {
    if (state.values[`${FORCE}.f_${t}`] === true) await writeValue(`${FORCE}.f_${t}`, false).catch(() => {});
  }
}

// leaving the page: release any held sim buttons (PLC dead-man backstops us)
window.addEventListener("pagehide", () => {
  // best-effort sync writes are not possible; the SIM_Input_Guard watchdog
  // clears everything within 1.5 s of the kicks stopping — by design.
});

// ---- /state assembly (same shape server.mjs served) ---------------------------
function getState() {
  return {
    ...state, di: DI, do_: DO, setpoints: SETPOINTS, emStates: EM_STATES,
    ems: EMS.map((em) => ({ name: em.name, db: em.db, pins: Object.keys(em.pins), stateName: stateName(em) })),
    seq,
    simButtons: SIM_BUTTONS,
    sim: { armed: state.values[`${SIM}.sim_enable`] === true, held: [...sim.held] },
    forcible: FORCIBLE,
    forces: FORCIBLE.filter((t) => state.values[`${FORCE}.f_${t}`] === true)
      .map((t) => ({ tag: t, value: state.values[`${FORCE}.v_${t}`] === true })),
    alarms: {
      active: ALARMS.filter(([tag]) => tag in alarmState.active)
        .map(([tag, , cls, text]) => ({ tag, cls, text, since: alarmState.active[tag] })),
      history: alarmState.history.slice(-100).reverse(),
    },
  };
}

// ---- dashFetch: the fetch-compatible shim the UI calls -------------------------
const respond = (obj) => ({ ok: true, json: async () => obj });
window.dashFetch = async function dashFetch(url, opts) {
  const body = opts && opts.body ? JSON.parse(opts.body) : {};
  try {
    switch (url) {
      case "/state": return respond(getState());
      case "/write": await writeValue(body.id, body.value); return respond({ ok: true });
      case "/force/set": await forceSet(body.tag, body.enable, body.value); return respond({ ok: true });
      case "/force/clear": await forceClearAll(); return respond({ ok: true });
      case "/sim/enable": await simEnable(body.on === true); return respond({ ok: true });
      case "/sim/btn": await simButton(body.tag, body.down === true); return respond({ ok: true });
      case "/sim/heartbeat": return respond({ ok: true }); // page IS the client — nothing to keep alive
      case "/seq/mode": await setSeqMode(body.on === true); return respond({ ok: true });
      case "/seq/cmd": {
        const em = EMS.find((x) => x.db === body.db);
        if (!em || !em.pins[body.cmd]) throw new Error("unknown em/cmd");
        const pin = `${em.db}.${em.pins[body.cmd]}`;
        await writeValue(pin, true);
        setTimeout(() => writeValue(pin, false).catch(() => {}), 1500);
        return respond({ ok: true });
      }
      case "/seq/run": {
        const em = EMS.find((x) => x.db === body.db);
        if (!em) throw new Error("unknown em");
        if (seq.running) throw new Error("a test is already running");
        runSequenceTest(em); // async — progress shows via /state
        return respond({ ok: true });
      }
      default: throw new Error(`unknown route ${url}`);
    }
  } catch (e) {
    return respond({ ok: false, error: e.message });
  }
};

// ---- login overlay -------------------------------------------------------------
const ovl = document.createElement("div");
ovl.id = "plclogin";
ovl.innerHTML = `
  <style>
    #plclogin{position:fixed;inset:0;background:rgba(20,24,28,.92);z-index:9999;display:flex;align-items:center;justify-content:center;font-family:system-ui,Segoe UI,sans-serif}
    #plclogin .box{background:#fff;border-radius:10px;padding:28px 32px;width:320px;box-shadow:0 12px 40px rgba(0,0,0,.4)}
    #plclogin h2{margin:0 0 4px;font-size:18px;color:#1c2b33}
    #plclogin .sub{color:#59636d;font-size:12px;margin-bottom:16px}
    #plclogin label{display:block;font-size:11px;color:#59636d;margin:10px 0 3px;text-transform:uppercase;letter-spacing:.04em}
    #plclogin input{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid #c6ced4;border-radius:6px;font-size:14px}
    #plclogin button{width:100%;margin-top:16px;padding:10px;background:#2563eb;color:#fff;border:0;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer}
    #plclogin button:disabled{opacity:.5}
    #plclogin .err{color:#c22;font-size:12px;margin-top:10px;min-height:15px}
  </style>
  <div class="box">
    <h2>Segment Wagon — PLC login</h2>
    <div class="sub">served by the PLC · S7-1200 G2 Web API</div>
    <label>User</label><input id="plc_user" value="commission" autocomplete="username">
    <label>Password</label><input id="plc_pass" type="password" autocomplete="current-password">
    <button id="plc_go">CONNECT</button>
    <div class="err" id="plc_err"></div>
  </div>`;
document.body.appendChild(ovl);

function showLogin(msg) {
  ovl.style.display = "flex";
  ovl.querySelector("#plc_err").textContent = msg || "";
  ovl.querySelector("#plc_pass").focus();
}
function hideLogin() { ovl.style.display = "none"; }

async function doLogin() {
  const btn = ovl.querySelector("#plc_go"), err = ovl.querySelector("#plc_err");
  btn.disabled = true; err.textContent = "logging in…";
  try {
    await login(ovl.querySelector("#plc_user").value, ovl.querySelector("#plc_pass").value);
    err.textContent = "";
    hideLogin();
  } catch (e) {
    err.textContent = e.message;
  } finally {
    btn.disabled = false;
  }
}
ovl.querySelector("#plc_go").onclick = doLogin;
ovl.querySelector("#plc_pass").addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });

// startup: validate any cached token with a single read, else show the overlay
(async () => {
  if (token) {
    try {
      const r = await rpc({ jsonrpc: "2.0", id: 1, method: "PlcProgram.Read", params: { var: '"EStop_Healthy"', mode: "simple" } });
      if (r.error && isAuthError(r.error)) { token = null; localStorage.removeItem(TOKEN_KEY); }
    } catch { /* network issue — keep token, poll loop will surface it */ }
  }
  if (token) hideLogin(); else showLogin("");
  pollLoop();
})();

})();
